// Runs the replay: every case x arm x model x trial, through the ledger.
// bun quick/replay/run.ts [--models deepseek,haiku,opus] [--cases d01,y01] [--arms baseline,gstack] [--trials 3] [--dry-run]
// env: LEDGER (the Captain-drive ledger file), PROMPTS, RESULTS, RUN_LIMIT (USD the review
// calls may commit, below the cap, so the judge keeps its share), PREREG_SHA.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { CapError, Ledger, MODELS, ProviderError, meteredCall, worstUsd, type ModelSpec } from './llm.ts';
import { fillRedTeam, parseFindings, redTeamActive, shown, type Finding } from './lib.ts';

const HERE = import.meta.dir;
const arg = (k: string, d?: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PROMPTS = process.env.PROMPTS ?? path.join(process.env.HOME!, '.capy/work/replay/prompts');
const RESULTS = process.env.RESULTS ?? path.join(process.env.HOME!, '.capy/work/replay/results');
export const CAP = 60;
const RUN_LIMIT = Number(process.env.RUN_LIMIT ?? '55');
const LEDGER = process.env.LEDGER ?? path.join(process.env.HOME!, '.capy/drive/captain-gstack-evals/ledger/replay-quick.jsonl');
const PREREG_SHA = process.env.PREREG_SHA ?? '';
const DRY = process.argv.includes('--dry-run');

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const plan = JSON.parse(fs.readFileSync(process.env.PLAN_FILE ?? path.join(HERE, 'plan.json'), 'utf8'));
const frozen = new Map(fs.readFileSync(process.env.FROZEN_FILE ?? path.join(HERE, 'frozen.sha256'), 'utf8').split('\n').filter(Boolean).map(l => [l.slice(66), l.slice(0, 64)]));

function prompt(rel: string): string {
  const text = fs.readFileSync(path.join(PROMPTS, rel), 'utf8');
  if (frozen.get(rel) !== sha(text)) throw new Error('prompt ' + rel + ' does not match frozen.sha256');
  return text;
}

// A concurrency limit with two queues; a waiting high-priority call goes first.
class Gate {
  private n = 0; private q: (() => void)[] = []; private hi: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(f: () => Promise<T>, high = false): Promise<T> {
    if (this.n >= this.max) await new Promise<void>(r => (high ? this.hi : this.q).push(r));
    this.n++;
    try { return await f(); } finally { this.n--; (this.hi.shift() ?? this.q.shift())?.(); }
  }
}
const gates: Record<string, Gate> = { anthropic: new Gate(8), openrouter: new Gate(8), openai: new Gate(4) };

let inFlight = 0;
let capStopped = false;
const settled: (() => void)[] = [];

// Wakes every call waiting on a cap refusal. Only a call that held a reservation and settled,
// or the cap stop, wakes them, so refused waiters never wake each other.
const wake = () => { for (const w of settled.splice(0)) w(); };

// Provider failures with no HTTP status in a row. Three stop the run, so a network outage marks
// a handful of calls INFRA instead of every call left in the plan.
let noStatusStreak = 0;

function writeAtomic(file: string, rec: any) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(rec, null, 2));
  fs.renameSync(file + '.tmp', file);
}

// One reviewer call, resumable: an existing result file is the answer, and an existing error
// record is a terminal INFRA failure that a rerun leaves incomplete. A cap refusal while
// other calls are open waits for one to settle and tries again; with nothing open it is the
// hard stop, and every later call is skipped.
async function call(ledger: Ledger, spec: ModelSpec, rel: string, text: string, out: string, meta: any, opts: { high?: boolean; cache?: boolean } = {}): Promise<any> {
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  if (fs.existsSync(out.replace(/\.json$/, '.error.json'))) return null;
  if (capStopped) return null;
  if (DRY) {
    const rec = { ...meta, dry_run: true, worst_usd: worstUsd(spec, Buffer.byteLength(text)) };
    return rec;
  }
  return gates[spec.provider]!.run(async () => {
    for (;;) {
      if (capStopped) return null;
      inFlight++;
      let r;
      try {
        r = await meteredCall(ledger, meta.call_id, spec, text, { limit: RUN_LIMIT, cache: opts.cache });
      } catch (e: any) {
        inFlight--;
        if (e instanceof CapError) {
          if (inFlight > 0) { await new Promise<void>(res => settled.push(res)); continue; }
          capStopped = true;
          console.error('CAP STOP: ' + e.message);
          wake();
          return null;
        }
        wake();
        if (!(e instanceof ProviderError)) throw e;
        const rec = { ...meta, prompt: rel, model: spec.model, effort: spec.effort, prereg_sha: PREREG_SHA, error: String(e.message ?? e).slice(0, 500), at: new Date().toISOString() };
        writeAtomic(out.replace(/\.json$/, '.error.json'), rec);
        console.error('INFRA ' + meta.call_id + ': ' + rec.error);
        noStatusStreak = e.http ? 0 : noStatusStreak + 1;
        if (noStatusStreak >= 3) throw new Error('STOP: three provider failures in a row with no HTTP status (network?); calls not yet sent stay unsent');
        return null;
      }
      inFlight--;
      wake();
      noStatusStreak = 0;
      const rec = { ...meta, prompt: rel, prompt_sha256: sha(text), model: spec.model, effort: spec.effort, prereg_sha: PREREG_SHA, ...r, at: new Date().toISOString() };
      writeAtomic(out, rec);
      return rec;
    }
  }, opts.high);
}

// The one-line form /review's Step 4.6 prints for each merged specialist finding.
function summaryLine(f: Finding): string {
  return '[' + (f.severity || 'INFORMATIONAL') + '] (confidence: ' + (f.confidence ?? '?') + '/10, specialist: ' + (f.specialist ?? '?') + ') ' + f.path + (f.line ? ':' + f.line : '') + ' — ' + f.summary;
}

// One case and arm, all trials. Each reviewer prompt runs trial 1, then its later trials at
// once as soon as trial 1 returns, ahead of other waiting calls, so they read the prompt cache
// trial 1 wrote while it is live. Each trial's Red Team follows that trial's first-stage
// reviewers and is sent without cache_control.
async function group(ledger: Ledger, spec: ModelSpec, c: any, arm: 'baseline' | 'gstack', trials: number) {
  const dir = (t: number) => path.join(RESULTS, spec.key, c.case, arm, 't' + t);
  const meta = (t: number, reviewer: string) => ({ call_id: [spec.key, c.case, arm, 't' + t, reviewer].join('/'), case: c.case, kind: c.kind, arm, trial: t, reviewer });
  const reviewers = arm === 'baseline' ? ['baseline'] : ['core', ...c.specialists];
  const ts = Array.from({ length: trials }, (_, i) => i + 1);
  const runs = reviewers.map((r: string) => {
    const text = prompt(c.prompts[r]);
    const one = (t: number) => call(ledger, spec, c.prompts[r], text, path.join(dir(t), r + '.json'), meta(t, r), { high: t > 1 });
    const first = one(1);
    return [first, ...ts.slice(1).map(t => first.then(() => one(t)))];
  });
  if (arm === 'baseline') { await Promise.all(runs.flat()); return; }
  await Promise.all(ts.map(async t => {
    const recs = await Promise.all(runs.map(x => x[t - 1]!));
    if (recs.some(r => r === null || r?.dry_run)) {
      if (DRY && c.red_team_by_size) await call(ledger, spec, c.prompts.red_team_template, prompt(c.prompts.red_team_template), path.join(dir(t), 'red-team.json'), meta(t, 'red-team'));
      return;
    }
    const specFindings = recs.slice(1).flatMap((r: any) => parseFindings(r.text).findings.filter(shown));
    if (!redTeamActive(c.diff_lines, specFindings)) return;
    const text = fillRedTeam(prompt(c.prompts.red_team_template), c.specialists.length, specFindings.map(summaryLine).join('\n'));
    const rt = path.join(dir(t), 'red-team');
    if (!fs.existsSync(rt + '.json') && !fs.existsSync(rt + '.error.json')) { fs.mkdirSync(dir(t), { recursive: true }); fs.writeFileSync(rt + '.prompt.md', text); }
    await call(ledger, spec, c.prompts.red_team_template, text, path.join(dir(t), 'red-team.json'), meta(t, 'red-team'), { cache: false });
  }));
}

if (import.meta.main) {
  const models = (arg('models', 'deepseek,haiku,opus')!).split(',');
  const only = arg('cases') ? new Set(arg('cases')!.split(',')) : null;
  const trials = Number(arg('trials', '3'));
  const arms = arg('arms', 'baseline,gstack')!.split(',') as ('baseline' | 'gstack')[];
  const cases = plan.cases.filter((c: any) => !only || only.has(c.case));
  if (!DRY && !PREREG_SHA) throw new Error('PREREG_SHA is required for a paid run');
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  const ledger = new Ledger(LEDGER, 'replay-quick', CAP);
  let worst = 0;
  for (const m of models) {
    const spec = MODELS[m]!;
    // Case-arm groups run four at a time in plan order, so a cap stop cuts the tail of the plan
    // rather than scattered units.
    const groups = new Gate(4);
    await Promise.all(cases.flatMap((c: any) => arms.map(arm => groups.run(() => group(ledger, spec, c, arm, trials)))));
    if (DRY) {
      for (const c of cases) for (const r of [...(arms.includes('baseline') ? ['baseline'] : []), ...(arms.includes('gstack') ? ['core', ...c.specialists, ...(c.red_team_by_size ? ['red_team_template'] : [])] : [])]) worst += worstUsd(spec, fs.statSync(path.join(PROMPTS, c.prompts[r])).size) * trials;
    }
    console.log(m + ' done' + (capStopped ? ' (cap stop)' : ''));
  }
  if (DRY) console.log('dry run: worst case of the static calls ' + worst.toFixed(2) + ' USD');
  else console.log('ledger committed ' + ledger.committed().toFixed(4) + ' USD of ' + CAP);
  if (capStopped) process.exit(2);
}
