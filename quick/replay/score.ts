// Scores the replay: deterministic file matching, a blind gpt-6.1-sol judge for whether a
// right-file finding names the defect, and the per-model, per-arm tables.
// bun quick/replay/score.ts [--no-judge]   env: LEDGER, RESULTS, GSTACK_DIR
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CapError, Ledger, MODELS, meteredCall } from './llm.ts';
import { bootstrap, mean, parseFindings, redTeamActive, rng, sameFile, shown, type Finding } from './lib.ts';

const HERE = import.meta.dir;
const G = process.env.GSTACK_DIR ?? '/workspace/gstack';
const RESULTS = process.env.RESULTS ?? path.join(process.env.HOME!, '.capy/work/replay/results');
const LEDGER = process.env.LEDGER ?? '/home/user/.capy/drive/captain-gstack-evals/ledger/replay-quick.jsonl';
const CAP = 60;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const git = (...a: string[]) => spawnSync('git', a, { cwd: G, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout;

export const MODEL_KEYS = ['opus', 'haiku', 'deepseek'];
export const ARMS = ['baseline', 'gstack'] as const;

export type Unit = { model: string; arm: string; case: string; kind: string; trial: number; complete: boolean; usd: number; input_tokens: number; output_tokens: number; calls: number; findings: Finding[]; unparsed: number };

// Reads one case x arm x model x trial. A gstack unit is complete when the core reviewer,
// every dispatched specialist and (when it activates) the Red Team returned.
export function loadUnit(resultsDir: string, planCase: any, model: string, arm: string, trial: number): Unit {
  const dir = path.join(resultsDir, model, planCase.case, arm, 't' + trial);
  const names = arm === 'baseline' ? ['baseline'] : ['core', ...planCase.specialists];
  const read = (n: string) => { const f = path.join(dir, n + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const recs = names.map(read);
  let complete = recs.every(Boolean);
  if (complete && arm === 'gstack') {
    const specF = recs.slice(1).flatMap((r: any) => parseFindings(r.text).findings.filter(shown));
    if (redTeamActive(planCase.diff_lines, specF)) { const rt = read('red-team'); recs.push(rt); complete = !!rt; }
  }
  const got = recs.filter(Boolean);
  const parsed = got.map((r: any) => parseFindings(r.text));
  return {
    model, arm, case: planCase.case, kind: planCase.kind, trial, complete,
    usd: got.reduce((a: number, r: any) => a + (r.usd ?? 0), 0),
    input_tokens: got.reduce((a: number, r: any) => a + (r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0), 0),
    output_tokens: got.reduce((a: number, r: any) => a + (r.usage?.output_tokens ?? r.usage?.completion_tokens ?? 0), 0),
    calls: got.length,
    findings: parsed.flatMap(p => p.findings),
    unparsed: parsed.filter(p => p.unparsed).length,
  };
}

export const findingKey = (f: Finding) => sha([f.path, f.line ?? '', f.summary].join('\u0000')).slice(0, 16);

export function candidates(u: Unit, c: any, gated: boolean): Finding[] {
  return u.findings.filter(f => (!gated || shown(f)) && (sameFile(f.path, c.file) || sameFile(f.cause_path, c.file)));
}

export function nearLine(f: Finding, c: any, slack = 10): boolean {
  return f.line !== null && c.lines.some(([a, b]: [number, number]) => f.line! >= a - slack && f.line! <= b + slack);
}

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdicts'],
  properties: { verdicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'names_defect', 'reason'], properties: { id: { type: 'string' }, names_defect: { type: 'boolean' }, reason: { type: 'string' } } } } },
};

export function judgePrompt(c: any, fixDiff: string, items: { id: string; f: Finding }[]): string {
  return [
    'You grade code-review findings against one known defect. For each finding, decide whether it names this defect: the same failure at this place in the code, stated specifically enough that a developer who read only the finding would find and fix this defect. A finding about a different problem in the same file is not a match. A vague worry that does not state this failure is not a match. Severity, style and confidence do not matter.',
    '', '## Known defect', 'File: ' + c.file + ' (lines ' + c.lines.map((r: number[]) => r[0] === r[1] ? r[0] : r[0] + '-' + r[1]).join(', ') + ' in the reviewed version)', c.defect,
    '', '## The later fix to that file', '~~~diff', fixDiff.trim(), '~~~',
    '', '## Findings', ...items.map(x => JSON.stringify({ id: x.id, path: x.f.path, line: x.f.line, summary: x.f.summary })),
    '', 'Return {"verdicts":[{"id":"...","names_defect":true|false,"reason":"one sentence"}]} with one verdict per finding id.',
  ].join('\n');
}

async function judgeCase(ledger: Ledger, c: any, findings: Finding[], cache: Record<string, any>, cacheFile: string) {
  const todo = new Map<string, Finding>();
  for (const f of findings) { const k = findingKey(f); if (!cache[k] && !todo.has(k)) todo.set(k, f); }
  if (!todo.size) return;
  const fixDiff = c.fix_diff ?? git('diff', c.fix + '^', c.fix, '--', c.file);
  const r = rng(parseInt(sha(c.id).slice(0, 8), 16));
  const list = [...todo.entries()].map(([k, f]) => ({ k, f, id: Math.floor(r() * 0xffffff).toString(16).padStart(6, '0') + k.slice(0, 2), o: r() })).sort((a, b) => a.o - b.o);
  for (let i = 0; i < list.length; i += 12) {
    const batch = list.slice(i, i + 12);
    const p = judgePrompt(c, fixDiff, batch);
    const res = await meteredCall(ledger, 'judge/' + c.id + '/' + i, MODELS.judge!, p, { schema: JUDGE_SCHEMA, limit: CAP });
    const v = JSON.parse(res.text).verdicts as { id: string; names_defect: boolean; reason: string }[];
    for (const x of batch) {
      const hit = v.find(y => y.id === x.id);
      if (hit) cache[x.k] = { case: c.id, path: x.f.path, line: x.f.line, summary: x.f.summary, names_defect: hit.names_defect, reason: hit.reason, judge_call: 'judge/' + c.id + '/' + i, usd: res.usd / batch.length };
    }
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }
}

export function summarize(units: Unit[], cases: any[], verdicts: Record<string, any>, gated = true) {
  const byCase = new Map(cases.map(c => [c.id, c]));
  const rows: any[] = [];
  const perCaseRate = (model: string, arm: string, kind: string, hit: (u: Unit) => boolean) =>
    cases.filter(c => c.kind === kind).map(c => units.filter(u => u.model === model && u.arm === arm && u.case === c.id && u.complete).map(u => (hit(u) ? 1 : 0)));
  const catchOf = (u: Unit) => candidates(u, byCase.get(u.case), gated).some(f => verdicts[findingKey(f)]?.names_defect === true);
  const critCatch = (u: Unit) => candidates(u, byCase.get(u.case), gated).some(f => f.severity === 'CRITICAL' && verdicts[findingKey(f)]?.names_defect === true);
  const fileLine = (u: Unit) => candidates(u, byCase.get(u.case), gated).some(f => nearLine(f, byCase.get(u.case)));
  const falseAlarm = (u: Unit) => u.findings.some(f => (!gated || shown(f)) && f.severity === 'CRITICAL');
  const anyFinding = (u: Unit) => u.findings.some(f => !gated || shown(f));
  const rate = (rowsPerCase: number[][]) => mean(rowsPerCase.filter(r => r.length).map(r => mean(r)));
  for (const model of MODEL_KEYS) for (const arm of ARMS) {
    const mine = units.filter(u => u.model === model && u.arm === arm && u.complete);
    const d = mine.filter(u => u.kind === 'defect'), y = mine.filter(u => u.kind === 'decoy');
    if (!mine.length) continue;
    const rc = perCaseRate(model, arm, 'defect', catchOf), fa = perCaseRate(model, arm, 'decoy', falseAlarm);
    const catches = d.filter(catchOf).length;
    const usdD = d.reduce((a, u) => a + u.usd, 0), usdAll = mine.reduce((a, u) => a + u.usd, 0);
    rows.push({
      model, arm, defect_units: d.length, decoy_units: y.length, incomplete: units.filter(u => u.model === model && u.arm === arm && !u.complete).length,
      recall: rate(rc), recall_ci: bootstrap(rc.filter(r => r.length), s => rate(s)), catches,
      recall_critical: rate(perCaseRate(model, arm, 'defect', critCatch)), file_line: rate(perCaseRate(model, arm, 'defect', fileLine)),
      false_alarm: rate(fa), false_alarm_ci: bootstrap(fa.filter(r => r.length), s => rate(s)), decoy_any_finding: rate(perCaseRate(model, arm, 'decoy', anyFinding)),
      usd_defects: usdD, usd_all: usdAll, usd_per_catch: catches ? usdD / catches : null, usd_all_per_catch: catches ? usdAll / catches : null,
      calls: mine.reduce((a, u) => a + u.calls, 0), in_tokens_per_unit: mean(mine.map(u => u.input_tokens)), out_tokens_per_unit: mean(mine.map(u => u.output_tokens)),
      unparsed_outputs: mine.reduce((a, u) => a + u.unparsed, 0),
    });
  }
  const paired = (a: [string, string], b: [string, string]) => {
    const pa = perCaseRate(a[0], a[1], 'defect', catchOf), pb = perCaseRate(b[0], b[1], 'defect', catchOf);
    const diffs = pa.map((r, i) => (r.length && pb[i]!.length ? [mean(r) - mean(pb[i]!)] : [])).filter(r => r.length);
    const fa = perCaseRate(a[0], a[1], 'decoy', falseAlarm), fb = perCaseRate(b[0], b[1], 'decoy', falseAlarm);
    const fdiffs = fa.map((r, i) => (r.length && fb[i]!.length ? [mean(r) - mean(fb[i]!)] : [])).filter(r => r.length);
    return {
      a: a.join('-'), b: b.join('-'), cases: diffs.length, recall_diff: mean(diffs.map(r => r[0]!)), recall_diff_ci: bootstrap(diffs, s => mean(s.map(r => r[0]!))),
      cases_a_better: diffs.filter(r => r[0]! > 0).length, cases_b_better: diffs.filter(r => r[0]! < 0).length,
      false_alarm_diff: mean(fdiffs.map(r => r[0]!)), false_alarm_diff_ci: bootstrap(fdiffs, s => mean(s.map(r => r[0]!))),
    };
  };
  const comparisons = [
    ...MODEL_KEYS.map(m => paired([m, 'gstack'], [m, 'baseline'])),
    paired(['haiku', 'gstack'], ['opus', 'baseline']), paired(['haiku', 'gstack'], ['opus', 'gstack']),
    paired(['deepseek', 'gstack'], ['opus', 'baseline']), paired(['deepseek', 'gstack'], ['opus', 'gstack']),
  ];
  return { rows, comparisons };
}

if (import.meta.main) {
  const { cases } = JSON.parse(fs.readFileSync(process.env.CASES_FILE ?? path.join(HERE, 'cases.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(process.env.PLAN_FILE ?? path.join(HERE, 'plan.json'), 'utf8'));
  const units: Unit[] = [];
  for (const pc of plan.cases) for (const m of MODEL_KEYS) for (const arm of ARMS) for (let t = 1; t <= 3; t++) units.push(loadUnit(RESULTS, pc, m, arm, t));
  const judgeDir = path.join(RESULTS, 'judge');
  fs.mkdirSync(judgeDir, { recursive: true });
  const verdicts: Record<string, any> = {};
  const ledger = new Ledger(LEDGER, 'replay-quick', CAP);
  for (const c of cases.filter((c: any) => c.kind === 'defect')) {
    const file = path.join(judgeDir, c.id + '.json');
    const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const all = units.filter(u => u.case === c.id && u.complete).flatMap(u => candidates(u, c, false));
    if (!process.argv.includes('--no-judge')) {
      try { await judgeCase(ledger, c, all, cache, file); } catch (e: any) { if (e instanceof CapError) console.error('CAP STOP in judging: ' + e.message); else throw e; }
    }
    Object.assign(verdicts, cache);
  }
  const primary = summarize(units, cases, verdicts, true);
  const ungated = summarize(units, cases, verdicts, false);
  const out = { primary, ungated, judged_findings: Object.keys(verdicts).length, ledger_committed_usd: ledger.committed() };
  fs.writeFileSync(path.join(RESULTS, 'summary.json'), JSON.stringify(out, null, 2));
  const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? '-' : (100 * x).toFixed(0) + '%');
  const ci = (c: [number, number]) => '[' + pct(c[0]) + ', ' + pct(c[1]) + ']';
  console.log('| model | arm | recall | 95% CI | recall at CRITICAL | false alarms | 95% CI | cost per catch | out tokens per case |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of primary.rows) console.log('| ' + [r.model, r.arm, pct(r.recall), ci(r.recall_ci), pct(r.recall_critical), pct(r.false_alarm), ci(r.false_alarm_ci), r.usd_per_catch === null ? '-' : '$' + r.usd_per_catch.toFixed(3), Math.round(r.out_tokens_per_unit)].join(' | ') + ' |');
  console.log();
  for (const c of primary.comparisons) console.log(c.a + ' vs ' + c.b + ': recall ' + (c.recall_diff * 100).toFixed(0) + ' pts ' + ci(c.recall_diff_ci) + ', false alarms ' + (c.false_alarm_diff * 100).toFixed(0) + ' pts ' + ci(c.false_alarm_diff_ci) + ' (' + c.cases_a_better + ' cases better, ' + c.cases_b_better + ' worse)');
  console.log('ledger committed ' + ledger.committed().toFixed(4) + ' USD');
}
