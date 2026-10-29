// Scores the replay: deterministic file matching, a blind gpt-6.1-sol judge for whether a
// right-file finding names the defect, and the per-model, per-arm tables.
// bun quick/replay/score.ts [--no-judge]   env: LEDGER, RESULTS, GSTACK_DIR
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CapError, Ledger, MODELS, ProviderError, accountFailure, meteredCall, writeAtomic } from './llm.ts';
import { bootstrap, mean, parseFindings, redTeamActive, rng, sameFile, shown, type Finding } from './lib.ts';

const HERE = import.meta.dir;
const G = process.env.GSTACK_DIR ?? '/workspace/gstack';
const RESULTS = process.env.RESULTS ?? path.join(process.env.HOME!, '.capy/work/replay/results');
const LEDGER = process.env.LEDGER ?? path.join(process.env.HOME!, '.capy/drive/captain-gstack-evals/ledger/replay-quick.jsonl');
const CAP = 60;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
function git(...a: string[]): string {
  const r = spawnSync('git', a, { cwd: G, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git ' + a.join(' ') + ' exit ' + r.status + ': ' + (r.stderr ?? '').slice(0, 300));
  return r.stdout;
}

export const MODEL_KEYS = ['opus', 'haiku', 'deepseek'];
export const ARMS = ['baseline', 'gstack'] as const;

export type Unit = { model: string; arm: string; case: string; kind: string; trial: number; complete: boolean; usd: number; input_tokens: number; output_tokens: number; calls: number; findings: Finding[]; unparsed: number; truncated?: number; cut_empty?: number };

const FROZEN_FILE = process.env.FROZEN_FILE ?? path.join(HERE, 'frozen.sha256');
let frozen: Record<string, string> | null = null;
const frozenSha = (rel: string): string | undefined =>
  (frozen ??= fs.existsSync(FROZEN_FILE) ? Object.fromEntries(fs.readFileSync(FROZEN_FILE, 'utf8').trim().split('\n').map(l => { const [h, f] = l.split(/\s+/); return [f, h]; })) : {})[rel];

// Reads one case x arm x model x trial. A gstack unit is complete when the core reviewer,
// every dispatched specialist and (when it activates) the Red Team returned. A result whose
// prompt hash differs from its frozen prompt, or from its saved Red Team prompt, counts as
// missing, and so does a reply the provider ended in error.
export function loadUnit(resultsDir: string, planCase: any, model: string, arm: string, trial: number): Unit {
  const dir = path.join(resultsDir, model, planCase.case, arm, 't' + trial);
  const names = arm === 'baseline' ? ['baseline'] : ['core', ...planCase.specialists];
  const read = (n: string) => {
    const f = path.join(dir, n + '.json');
    if (!fs.existsSync(f)) return null;
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    const rtPrompt = path.join(dir, 'red-team.prompt.md');
    const want = n === 'red-team' ? (fs.existsSync(rtPrompt) ? sha(fs.readFileSync(rtPrompt, 'utf8')) : undefined) : frozenSha(rec.prompt);
    if (rec.stop === 'error') return null;
    return rec.prompt_sha256 && want && rec.prompt_sha256 !== want ? null : rec;
  };
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
    truncated: got.filter((r: any) => r.stop === 'max_tokens' || r.stop === 'length').length,
    cut_empty: got.filter((r: any) => (r.stop === 'max_tokens' || r.stop === 'length') && !String(r.text ?? '').trim()).length,
  };
}

export const findingKey = (f: Finding) => sha([f.path, f.line ?? '', f.summary].join('\u0000')).slice(0, 16);
// Verdicts are per case: the same finding text can name one case's defect and not another's.
export const verdictKey = (caseId: string, f: Finding) => caseId + '/' + findingKey(f);

// A defect's files: the file the fix rewrote, plus also_files when the defect spans files.
const defectFiles = (c: any): string[] => [c.file, ...(c.also_files ?? [])];

export function candidates(u: Unit, c: any, gated: boolean): Finding[] {
  return u.findings.filter(f => (!gated || shown(f)) && defectFiles(c).some(p => sameFile(f.path, p) || sameFile(f.cause_path, p)));
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
    '', '## Known defect', 'File: ' + c.file + ' (lines ' + c.lines.map((r: number[]) => r[0] === r[1] ? r[0] : r[0] + '-' + r[1]).join(', ') + ' in the reviewed version)' + (c.also_files ? '; also ' + c.also_files.join(', ') : ''), c.defect,
    '', '## The later fix to ' + (c.also_files ? 'those files' : 'that file'), '~~~diff', fixDiff.trim(), '~~~',
    '', '## Findings', ...items.map(x => JSON.stringify({ id: x.id, path: x.f.path, line: x.f.line, summary: x.f.summary })),
    '', 'Return {"verdicts":[{"id":"...","names_defect":true|false,"reason":"one sentence"}]} with one verdict per finding id.',
  ].join('\n');
}

let judgeNoStatus = 0;

// Judges every not-yet-judged finding of one case in batches of 12. A batch whose call fails
// (other than the retried 429 and 5xx) is recorded in failedFile and never sent again, so its
// findings stay unjudged and their units count as incomplete. An account failure stops judging
// before its batch is recorded, so a later run sends it.
export async function judgeCase(ledger: Ledger, c: any, findings: Finding[], cache: Record<string, any>, cacheFile: string, failedFile: string) {
  const failed: Record<string, string> = fs.existsSync(failedFile) ? JSON.parse(fs.readFileSync(failedFile, 'utf8')) : {};
  const todo = new Map<string, Finding>();
  for (const f of findings) { const k = findingKey(f); if (!cache[k] && !failed[k] && !todo.has(k)) todo.set(k, f); }
  if (!todo.size) return;
  const fixDiff = c.fix_diff ?? git('-c', 'core.abbrev=9', 'diff', c.fix + '^', c.fix, '--', ...defectFiles(c));
  if (c.fix_diff_sha256 && sha(fixDiff) !== c.fix_diff_sha256) throw new Error(c.id + ': fix diff digest moved');
  const r = rng(parseInt(sha(c.id).slice(0, 8), 16));
  const list = [...todo.entries()].map(([k, f]) => ({ k, f, id: Math.floor(r() * 0xffffff).toString(16).padStart(6, '0') + k.slice(0, 2), o: r() })).sort((a, b) => a.o - b.o);
  for (let i = 0; i < list.length; i += 12) {
    const batch = list.slice(i, i + 12);
    const p = judgePrompt(c, fixDiff, batch);
    let res, v: { id: string; names_defect: boolean; reason: string }[];
    try {
      res = await meteredCall(ledger, 'judge/' + c.id + '/' + i, MODELS.judge!, p, { schema: JUDGE_SCHEMA, limit: CAP });
      v = JSON.parse(res.text).verdicts;
      if (!Array.isArray(v)) throw new SyntaxError('judge reply has no verdicts array');
      judgeNoStatus = 0;
    } catch (e: any) {
      if (!(e instanceof ProviderError) && !(e instanceof SyntaxError)) throw e;
      if (e instanceof ProviderError && accountFailure(e)) throw new Error('STOP: judge account failure: ' + String(e.message).slice(0, 200));
      judgeNoStatus = e instanceof ProviderError && !e.http ? judgeNoStatus + 1 : 0;
      for (const x of batch) failed[x.k] = String(e.message ?? e).slice(0, 300);
      writeAtomic(failedFile, failed);
      console.error('JUDGE INFRA ' + c.id + '/' + i + ': ' + String(e.message ?? e).slice(0, 200));
      if (judgeNoStatus >= 3) throw new Error('STOP: three judge failures in a row with no HTTP status (network?)');
      continue;
    }
    for (const x of batch) {
      const hit = v.find(y => y.id === x.id);
      if (hit) cache[x.k] = { case: c.id, path: x.f.path, line: x.f.line, summary: x.f.summary, names_defect: hit.names_defect, reason: hit.reason, judge_call: 'judge/' + c.id + '/' + i, usd: res.usd / batch.length };
      else failed[x.k] = 'the judge returned no verdict for this id';
    }
    writeAtomic(cacheFile, cache);
    writeAtomic(failedFile, failed);
  }
}

// The stratum of a case: a defect's own source, a decoy the source of the defect it was
// size-matched to.
export function stratumOf(c: any, cases: any[]): string {
  return c.kind === 'defect' ? c.source : cases.find(d => d.id === c.matched_to)?.source;
}

type Cell = [string, string];
export const MAIN_PAIRS: [Cell, Cell][] = [
  ...MODEL_KEYS.map(m => [[m, 'gstack'], [m, 'baseline']] as [Cell, Cell]),
  [['haiku', 'gstack'], ['opus', 'baseline']], [['haiku', 'gstack'], ['opus', 'gstack']],
  [['deepseek', 'gstack'], ['opus', 'baseline']], [['deepseek', 'gstack'], ['opus', 'gstack']],
];

// Tables over the given cases. A unit is valid when every reviewer call returned and, for a
// defect, every right-file finding (gated or not) has a judge verdict; only valid units count
// toward rates and catches. Spend counts every unit of the cell, valid or not, including what
// the ledger charged for failed calls (usd on each unit, set from the ledger by the caller).

export function summarize(allUnits: Unit[], cases: any[], verdicts: Record<string, any>, gated = true, models = MODEL_KEYS, pairs = MAIN_PAIRS) {
  const byCase = new Map(cases.map(c => [c.id, c]));
  const units = allUnits.filter(u => byCase.has(u.case));
  const judged = (u: Unit) => u.kind !== 'defect' || candidates(u, byCase.get(u.case), false).every(f => verdicts[verdictKey(u.case, f)] !== undefined);
  const valid = (u: Unit) => u.complete && judged(u);
  const rows: any[] = [];
  const perCaseRate = (model: string, arm: string, kind: string, hit: (u: Unit) => boolean) =>
    cases.filter(c => c.kind === kind).map(c => units.filter(u => u.model === model && u.arm === arm && u.case === c.id && valid(u)).map(u => (hit(u) ? 1 : 0)));
  const catchOf = (u: Unit) => candidates(u, byCase.get(u.case), gated).some(f => verdicts[verdictKey(u.case, f)]?.names_defect === true);
  const critCatch = (u: Unit) => candidates(u, byCase.get(u.case), gated).some(f => f.severity === 'CRITICAL' && verdicts[verdictKey(u.case, f)]?.names_defect === true);
  const fileLine = (u: Unit) => candidates(u, byCase.get(u.case), gated).some(f => sameFile(f.path, byCase.get(u.case).file) && nearLine(f, byCase.get(u.case)));
  const falseAlarm = (u: Unit) => u.findings.some(f => (!gated || shown(f)) && f.severity === 'CRITICAL');
  const anyFinding = (u: Unit) => u.findings.some(f => !gated || shown(f));
  const rate = (rowsPerCase: number[][]) => mean(rowsPerCase.filter(r => r.length).map(r => mean(r)));
  for (const model of models) for (const arm of ARMS) {
    const cell = units.filter(u => u.model === model && u.arm === arm);
    const mine = cell.filter(valid);
    const d = mine.filter(u => u.kind === 'defect'), y = mine.filter(u => u.kind === 'decoy');
    if (!cell.length) continue;
    const rc = perCaseRate(model, arm, 'defect', catchOf), fa = perCaseRate(model, arm, 'decoy', falseAlarm);
    const catches = d.filter(catchOf).length;
    const usdD = cell.filter(u => u.kind === 'defect').reduce((a, u) => a + u.usd, 0), usdAll = cell.reduce((a, u) => a + u.usd, 0);
    rows.push({
      model, arm, defect_units: d.length, decoy_units: y.length,
      incomplete: cell.filter(u => !u.complete).length, unjudged: cell.filter(u => u.complete && !judged(u)).length,
      recall: rate(rc), recall_ci: bootstrap(rc.filter(r => r.length), s => rate(s)), catches,
      recall_critical: rate(perCaseRate(model, arm, 'defect', critCatch)), file_line: rate(perCaseRate(model, arm, 'defect', fileLine)),
      false_alarm: rate(fa), false_alarm_ci: bootstrap(fa.filter(r => r.length), s => rate(s)), decoy_any_finding: rate(perCaseRate(model, arm, 'decoy', anyFinding)),
      usd_defects: usdD, usd_all: usdAll, usd_per_catch: catches ? usdD / catches : null, usd_all_per_catch: catches ? usdAll / catches : null,
      calls: mine.reduce((a, u) => a + u.calls, 0), in_tokens_per_unit: mean(mine.map(u => u.input_tokens)), out_tokens_per_unit: mean(mine.map(u => u.output_tokens)),
      unparsed_outputs: mine.reduce((a, u) => a + u.unparsed, 0), truncated_outputs: mine.reduce((a, u) => a + (u.truncated ?? 0), 0),
      cut_off_empty_calls: cell.reduce((a, u) => a + (u.cut_empty ?? 0), 0), units_with_cut_off_empty_call: cell.filter(u => (u.cut_empty ?? 0) > 0).length,
    });
  }
  const paired = (a: Cell, b: Cell) => {
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
  return { rows, comparisons: pairs.map(([a, b]) => paired(a, b)) };
}

if (import.meta.main) {
  const { cases } = JSON.parse(fs.readFileSync(process.env.CASES_FILE ?? path.join(HERE, 'cases.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(process.env.PLAN_FILE ?? path.join(HERE, 'plan.json'), 'utf8'));
  const units: Unit[] = [];
  for (const pc of plan.cases) for (const m of MODEL_KEYS) for (const arm of ARMS) for (let t = 1; t <= 3; t++) units.push(loadUnit(RESULTS, pc, m, arm, t));
  // The exploratory Opus-high cell: gstack arm, trial 1, on whichever cases it reached.
  for (const pc of plan.cases) if (fs.existsSync(path.join(RESULTS, 'opus-high', pc.case, 'gstack', 't1'))) units.push(loadUnit(RESULTS, pc, 'opus-high', 'gstack', 1));
  const judgeDir = path.join(RESULTS, 'judge');
  fs.mkdirSync(judgeDir, { recursive: true });
  const verdicts: Record<string, any> = {};
  const ledger = new Ledger(LEDGER, 'replay-quick', CAP);
  // Each unit's spend is what the ledger settled for its calls, failed ones included.
  const charged = new Map<string, number>();
  for (const r of ledger.rows()) if (r.type === 'settle') { const k = String(r.call_id).split('/').slice(0, 4).join('/'); charged.set(k, (charged.get(k) ?? 0) + r.usd); }
  for (const u of units) { const k = [u.model, u.case, u.arm, 't' + u.trial].join('/'); if (charged.has(k)) u.usd = charged.get(k)!; }
  let judgeStopped = false;
  for (const c of cases.filter((c: any) => c.kind === 'defect')) {
    const file = path.join(judgeDir, c.id + '.json');
    const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const all = units.filter(u => u.case === c.id && u.complete).flatMap(u => candidates(u, c, false));
    if (!process.argv.includes('--no-judge') && !judgeStopped) {
      try { await judgeCase(ledger, c, all, cache, file, path.join(judgeDir, c.id + '.failed.json')); } catch (e: any) { if (!(e instanceof CapError)) throw e; judgeStopped = true; console.error('CAP STOP in judging: ' + e.message); }
    }
    for (const [k, v] of Object.entries(cache)) verdicts[c.id + '/' + k] = v;
  }
  const strata: Record<string, any[]> = { all: cases, 'review-caught': cases.filter((c: any) => stratumOf(c, cases) === 'review-caught'), escaped: cases.filter((c: any) => stratumOf(c, cases) === 'escaped') };
  // Sensitivity, not primary: drop every unit with a call cut off at max_tokens before any answer.
  const answered = units.map(u => ((u.cut_empty ?? 0) > 0 ? { ...u, complete: false } : u));
  const tables = Object.fromEntries(Object.entries(strata).map(([k, cs]) => [k, { primary: summarize(units, cs, verdicts, true), ungated: summarize(units, cs, verdicts, false), answered_only: summarize(answered, cs, verdicts, true) }]));
  const hiCases = new Set(units.filter(u => u.model === 'opus-high').map(u => u.case));
  const exploratory = hiCases.size ? summarize(units.filter(u => u.model === 'opus-high' || (u.model === 'opus' && u.arm === 'gstack' && u.trial === 1)), cases.filter((c: any) => hiCases.has(c.id)), verdicts, true, ['opus-high', 'opus'], [[['opus-high', 'gstack'], ['opus', 'gstack']]]) : null;
  const out = { strata: tables, exploratory_opus_high_vs_opus_t1: exploratory, judged_findings: Object.keys(verdicts).length, judge_cap_stop: judgeStopped, ledger_committed_usd: ledger.committed() };
  fs.writeFileSync(path.join(RESULTS, 'summary.json'), JSON.stringify(out, null, 2));
  const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? '-' : (100 * x).toFixed(0) + '%');
  const ci = (c: [number, number]) => '[' + pct(c[0]) + ', ' + pct(c[1]) + ']';
  for (const [k, t] of Object.entries(tables)) {
    console.log('## ' + k + ' (' + strata[k]!.filter(c => c.kind === 'defect').length + ' defects, ' + strata[k]!.filter(c => c.kind === 'decoy').length + ' decoys)');
    console.log('| model | arm | recall | 95% CI | recall at CRITICAL | false alarms | 95% CI | cost per catch | out tokens per unit | incomplete | unjudged |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of t.primary.rows) console.log('| ' + [r.model, r.arm, pct(r.recall), ci(r.recall_ci), pct(r.recall_critical), pct(r.false_alarm), ci(r.false_alarm_ci), r.usd_per_catch === null ? '-' : '$' + r.usd_per_catch.toFixed(3), Math.round(r.out_tokens_per_unit), r.incomplete, r.unjudged].join(' | ') + ' |');
    console.log();
    for (const c of t.primary.comparisons) console.log(c.a + ' vs ' + c.b + ': recall ' + (c.recall_diff * 100).toFixed(0) + ' pts ' + ci(c.recall_diff_ci) + ', false alarms ' + (c.false_alarm_diff * 100).toFixed(0) + ' pts ' + ci(c.false_alarm_diff_ci) + ' (' + c.cases_a_better + ' cases better, ' + c.cases_b_better + ' worse)');
    console.log();
  }
  console.log('ledger committed ' + ledger.committed().toFixed(4) + ' USD' + (judgeStopped ? ' (judge cap stop: unjudged units are incomplete)' : ''));
}
