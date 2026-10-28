// Keyless tests for the review replay. bun test quick/replay
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { diffLines, filterDiff, introducedRanges, parseFindings, redTeamActive, sameFile, selectSpecialists, shown, bootstrap, isReviewFix } from './lib.ts';
import { CapError, Ledger, MODELS, meteredCall, worstUsd } from './llm.ts';
import { startFake } from './fake-upstream.ts';
import { findingKey, summarize, type Unit } from './score.ts';

const HERE = import.meta.dir;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
// The fake upstream runs in this process, so child runs must not block its event loop.
async function bun(args: string[], env: Record<string, string | undefined>) {
  const p = Bun.spawn(['bun', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { status: await p.exited, stdout, stderr };
}
const QUOTES = [{ words: 'Rec', by: 'Garry', context: 'test' }];

describe('findings', () => {
  test('reads JSON lines, fenced objects and NO FINDINGS', () => {
    const a = parseFindings('{"severity":"CRITICAL","confidence":8,"path":"a.ts","line":3,"summary":"x breaks","specialist":"testing"}\n{"severity":"INFORMATIONAL","path":"b.ts","summary":"nit"}');
    expect(a.findings.length).toBe(2);
    expect(a.findings[0]!.confidence).toBe(8);
    expect(a.findings[1]!.line).toBeNull();
    const b = parseFindings('Here:\n~~~json\n{\n  "severity": "CRITICAL",\n  "path": "c.sh",\n  "summary": "a } inside a string"\n}\n~~~');
    expect(b.findings[0]!.summary).toBe('a } inside a string');
    expect(parseFindings('NO FINDINGS').clean).toBe(true);
    expect(parseFindings('Looks fine to me.').unparsed).toBe(true);
    expect(parseFindings('{"specialist":"state-machines","matrix":{"machine":"m"}}\nNO FINDINGS').clean).toBe(true);
  });
  test('cause path and the display gate', () => {
    const f = parseFindings('{"severity":"CRITICAL","confidence":4,"path":"caller.ts","summary":"s","cause":{"path":"lib/x.ts","line":2}}').findings[0]!;
    expect(f.cause_path).toBe('lib/x.ts');
    expect(shown(f)).toBe(false);
    expect(shown({ ...f, confidence: null })).toBe(true);
  });
  test('file matching', () => {
    expect(sameFile('./bin/gstack-doctor', 'bin/gstack-doctor')).toBe(true);
    expect(sameFile('b/lib/prose-lint.ts:113', 'lib/prose-lint.ts')).toBe(true);
    expect(sameFile('prose-lint.ts', 'lib/prose-lint.ts')).toBe(true);
    expect(sameFile('lib/prose.ts', 'lib/prose-lint.ts')).toBe(false);
    expect(sameFile(null, 'x')).toBe(false);
  });
});

describe('dispatch', () => {
  const none = { BACKEND: false, FRONTEND: false, AUTH: false, MIGRATIONS: false, API: false, STATE_MACHINE: 'false' as const };
  test('small diffs skip every specialist but State Machines', () => {
    expect(selectSpecialists(49, none)).toEqual([]);
    expect(selectSpecialists(10, { ...none, STATE_MACHINE: 'unknown' })).toEqual(['state-machines']);
  });
  test('scope signals add conditional specialists', () => {
    expect(selectSpecialists(80, none)).toEqual(['testing', 'maintainability']);
    expect(selectSpecialists(150, { ...none, BACKEND: true })).toEqual(['testing', 'maintainability', 'security', 'performance', 'simplification']);
    expect(selectSpecialists(60, { ...none, AUTH: true, FRONTEND: true, STATE_MACHINE: 'true' })).toEqual(['testing', 'maintainability', 'security', 'performance', 'design', 'state-machines']);
  });
  test('Red Team activates on size or a specialist CRITICAL', () => {
    expect(redTeamActive(201, [])).toBe(true);
    expect(redTeamActive(100, [])).toBe(false);
    expect(redTeamActive(100, parseFindings('{"severity":"CRITICAL","path":"a","summary":"s"}').findings)).toBe(true);
  });
});

describe('diffs and mining helpers', () => {
  const d = 'diff --git a/CHANGELOG.md b/CHANGELOG.md\n+x\ndiff --git a/lib/a.ts b/lib/a.ts\n--- a/lib/a.ts\n+++ b/lib/a.ts\n+y\n-z\ndiff --git a/x/SKILL.md b/x/SKILL.md\n+gen\n';
  test('drops CHANGELOG and generated files, counts changed lines', () => {
    const kept = filterDiff(d, p => (p.endsWith('SKILL.md') ? '<!-- AUTO-GENERATED from SKILL.md.tmpl -->' : ''));
    expect(kept).toContain('lib/a.ts');
    expect(kept).not.toContain('CHANGELOG');
    expect(kept).not.toContain('SKILL.md');
    expect(diffLines(kept)).toBe(2);
  });
  test('review-fix commits', () => {
    expect(isReviewFix('fix: pre-landing review fixes (pass 2)')).toBe(true);
    expect(isReviewFix('chore: stamp v1.2.3 for #1')).toBe(false);
    expect(isReviewFix("Merge remote-tracking branch 'origin/main'")).toBe(false);
  });
  test('escaped ranges use the introducing commit\'s line numbers', () => {
    const a = 'a'.repeat(40), b = 'b'.repeat(40);
    const porcelain = [a + ' 218 266 2', 'author x', '\tline', a + ' 219 267', '\tline', b + ' 10 268 1', 'author y', '\tline', a + ' 225 280 1', '\tline'].join('\n');
    expect(introducedRanges(porcelain, a)).toEqual([[218, 219], [225, 225]]);
    expect(introducedRanges(porcelain, 'c'.repeat(40))).toEqual([]);
  });
  test('bootstrap is seeded and brackets the mean', () => {
    const rows = [[1], [0], [1], [1], [0]];
    const a = bootstrap(rows, s => s.reduce((x, r) => x + r[0]!, 0) / s.length, 2000, 7);
    expect(a).toEqual(bootstrap(rows, s => s.reduce((x, r) => x + r[0]!, 0) / s.length, 2000, 7));
    expect(a[0]).toBeLessThanOrEqual(0.6);
    expect(a[1]).toBeGreaterThanOrEqual(0.6);
  });
});

describe('scoring', () => {
  const cases = [
    { id: 'd1', kind: 'defect', source: 'escaped', file: 'lib/a.ts', lines: [[2, 4]] },
    { id: 'y1', kind: 'decoy', matched_to: 'd1' },
  ];
  const f = (summary: string) => ({ severity: 'CRITICAL', confidence: 8, path: 'lib/a.ts', line: 3, summary, cause_path: null, specialist: null }) as any;
  const u = (trial: number, findings: any[], complete = true, usd = 1): Unit => ({ model: 'haiku', arm: 'gstack', case: 'd1', kind: 'defect', trial, complete, usd, input_tokens: 0, output_tokens: 0, calls: 1, findings, unparsed: 0 });
  test('an unjudged right-file finding makes its unit incomplete, not a miss', () => {
    const hit = f('x breaks'), open = f('never judged');
    const s = summarize([u(1, [hit]), u(2, [open])], cases, { [findingKey(hit)]: { names_defect: true } });
    const row = s.rows[0];
    expect(row.recall).toBe(1);
    expect(row.defect_units).toBe(1);
    expect(row.unjudged).toBe(1);
  });
  test('cost per catch counts the spend of incomplete units', () => {
    const hit = f('x breaks');
    const s = summarize([u(1, [hit], true, 1), u(2, [], false, 3)], cases, { [findingKey(hit)]: { names_defect: true } });
    const row = s.rows[0];
    expect(row.incomplete).toBe(1);
    expect(row.catches).toBe(1);
    expect(row.usd_defects).toBe(4);
    expect(row.usd_per_catch).toBe(4);
  });
});

describe('ledger', () => {
  test('refuses without an approval row', () => {
    const l = new Ledger(path.join(tmp(), 'l.jsonl'), 'x', 1);
    expect(() => l.reserve('c', MODELS.opus!, 0.1)).toThrow(CapError);
  });
  test('open reservations count against the cap, settles replace them', () => {
    const l = new Ledger(path.join(tmp(), 'l.jsonl'), 'x', 1);
    l.approve(QUOTES, 'test');
    l.approve(QUOTES, 'twice');
    const a = l.reserve('a', MODELS.opus!, 0.6);
    expect(() => l.reserve('b', MODELS.opus!, 0.6)).toThrow(CapError);
    l.settle(a, 'a', 'ok', 0.1, {});
    expect(l.committed()).toBeCloseTo(0.1, 6);
    l.reserve('b', MODELS.opus!, 0.6);
    expect(() => l.reserve('c', MODELS.opus!, 0.2, 0.75)).toThrow(CapError);
    const rows = l.rows();
    expect(rows.filter(r => r.type === 'approval').length).toBe(1);
    expect(rows.map(r => r.type)).toEqual(['approval', 'reserve', 'settle', 'reserve']);
  });
  test('worst case covers max_tokens and a cache write', () => {
    expect(worstUsd(MODELS.opus!, 20000)).toBeCloseTo((10000 * 5 + 32000 * 20) / 1e6, 9);
  });
});

describe('providers against the fake upstream', () => {
  let fake: ReturnType<typeof startFake>;
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => { fake = startFake(); for (const [k, v] of Object.entries(fake.env)) { saved[k] = process.env[k]; process.env[k] = v; } });
  afterAll(() => { fake.server.stop(true); for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  test('each provider settles its measured cost', async () => {
    const l = new Ledger(path.join(tmp(), 'l.jsonl'), 'x', 5);
    l.approve(QUOTES, 'test');
    const p = 'diff --git a/lib/a.ts b/lib/a.ts\n+x';
    const o = await meteredCall(l, 'o', MODELS.opus!, p);
    expect(parseFindings(o.text).findings[0]!.path).toBe('lib/a.ts');
    expect(o.usd).toBeCloseTo((Math.ceil(p.length / 3) * 4 + 100 * 20) / 1e6, 9);
    const d = await meteredCall(l, 'd', MODELS.deepseek!, p);
    expect(d.usd).toBe(0.0001);
    expect(d.provider_served).toBe('DeepSeek');
    const j = await meteredCall(l, 'j', MODELS.judge!, '{"id":"abc123"}', { schema: { type: 'object' } });
    expect(JSON.parse(j.text).verdicts[0].id).toBe('abc123');
    const body = fake.calls.find(c => c.route === '/api/v1/chat/completions')!.body;
    expect(body.provider).toEqual({ order: ['deepseek'], allow_fallbacks: false });
    expect(fake.calls.find(c => c.route === '/v1/messages')!.body.output_config).toEqual({ effort: 'medium' });
    const rows = l.rows();
    expect(rows.filter(r => r.type === 'reserve').length).toBe(3);
    expect(rows.filter(r => r.type === 'settle').length).toBe(3);
  });
  test('a 500 retries once and settles once', async () => {
    const l = new Ledger(path.join(tmp(), 'l.jsonl'), 'x', 5);
    l.approve(QUOTES, 'test');
    const r = await meteredCall(l, 'r', MODELS.haiku!, 'FAKE_500_ONCE diff --git a/q.ts b/q.ts');
    expect(r.usage).toBeTruthy();
    const s = l.rows().filter(x => x.type === 'settle');
    expect(s.length).toBe(1);
    expect(s[0].usage.attempts).toBe(2);
  }, 20000);

  test('run and score end to end on a synthetic plan', async () => {
    const dir = tmp();
    const prompts = path.join(dir, 'prompts');
    const files: Record<string, string> = {
      'd1/baseline.md': 'base diff --git a/lib/a.ts b/lib/a.ts\n+x',
      'd1/core.md': 'core diff --git a/lib/a.ts b/lib/a.ts\n+x',
      'd1/testing.md': 'testing diff --git a/lib/a.ts b/lib/a.ts\n+x',
      'd1/red-team.template.md': 'red {N} {merged findings summary} diff --git a/lib/a.ts b/lib/a.ts',
      'y1/baseline.md': 'NO DIFF',
      'y1/core.md': 'NO DIFF',
      'y1/red-team.template.md': 'red {N} {merged findings summary}',
    };
    for (const [k, v] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(prompts, k)), { recursive: true }); fs.writeFileSync(path.join(prompts, k), v); }
    fs.writeFileSync(path.join(dir, 'frozen.sha256'), Object.entries(files).map(([k, v]) => sha(v) + '  ' + k).join('\n') + '\n');
    const mk = (id: string, kind: string, specs: string[]) => ({ case: id, kind, diff_lines: 60, specialists: specs, red_team_by_size: false, prompts: { baseline: id + '/baseline.md', core: id + '/core.md', red_team_template: id + '/red-team.template.md', ...Object.fromEntries(specs.map(s => [s, id + '/' + s + '.md'])) } });
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ cases: [mk('d1', 'defect', ['testing']), mk('y1', 'decoy', [])] }));
    fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify({ cases: [{ id: 'd1', kind: 'defect', source: 'escaped', file: 'lib/a.ts', lines: [[2, 4]], fix: 'f', fix_diff: '-x\n+y', defect: 'x breaks' }, { id: 'y1', kind: 'decoy', matched_to: 'd1' }] }));
    const ledger = path.join(dir, 'ledger.jsonl');
    new Ledger(ledger, 'replay-quick', 60).approve(QUOTES, 'test');
    const env = { ...process.env, ...fake.env, PLAN_FILE: path.join(dir, 'plan.json'), FROZEN_FILE: path.join(dir, 'frozen.sha256'), CASES_FILE: path.join(dir, 'cases.json'), PROMPTS: prompts, RESULTS: path.join(dir, 'results'), LEDGER: ledger, PREREG_SHA: 'test' };
    const r1 = await bun([path.join(HERE, 'run.ts'), '--models', 'haiku,deepseek'], env);
    expect(r1.status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'results/haiku/d1/gstack/t3/red-team.json'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'results/haiku/d1/gstack/t1/red-team.prompt.md'), 'utf8')).toContain('red 1 [CRITICAL]');
    expect(fs.existsSync(path.join(dir, 'results/deepseek/y1/gstack/t2/core.json'))).toBe(true);
    const r2 = await bun([path.join(HERE, 'score.ts')], env);
    expect(r2.status).toBe(0);
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'results/summary.json'), 'utf8'));
    const hg = s.strata.all.primary.rows.find((r: any) => r.model === 'haiku' && r.arm === 'gstack');
    expect(hg.recall).toBe(1);
    expect(hg.false_alarm).toBe(0);
    expect(hg.defect_units).toBe(3);
    expect(s.strata.escaped.primary.rows.find((r: any) => r.model === 'haiku' && r.arm === 'gstack').recall).toBe(1);
    expect(s.strata['review-caught'].primary.rows.length).toBe(0);
    const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(rows.filter(r => r.type === 'reserve').length).toBe(rows.filter(r => r.type === 'settle').length);
    expect(hg.usd_all).toBeCloseTo(rows.filter(r => r.type === 'settle' && r.call_id.startsWith('haiku/') && r.call_id.split('/')[2] === 'gstack').reduce((a, r) => a + r.usd, 0), 6);
    // A recorded INFRA failure is terminal: the rerun below must not call again for it.
    const t1 = path.join(dir, 'results/haiku/d1/baseline/t1/baseline.json');
    fs.renameSync(t1, t1.replace(/\.json$/, '.error.json'));
    const before = rows.length;
    const r3 = await bun([path.join(HERE, 'run.ts'), '--models', 'haiku,deepseek'], env);
    expect(r3.status).toBe(0);
    expect(fs.readFileSync(ledger, 'utf8').trim().split('\n').length).toBe(before);
    expect(fs.existsSync(t1)).toBe(false);
  }, 60000);

  test('a prompt that moved after freezing is refused', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'prompts/d1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompts/d1/baseline.md'), 'changed');
    fs.writeFileSync(path.join(dir, 'frozen.sha256'), sha('original') + '  d1/baseline.md\n');
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ cases: [{ case: 'd1', kind: 'defect', diff_lines: 10, specialists: [], red_team_by_size: false, prompts: { baseline: 'd1/baseline.md', core: 'd1/baseline.md', red_team_template: 'd1/baseline.md' } }] }));
    const ledger = path.join(dir, 'ledger.jsonl');
    new Ledger(ledger, 'replay-quick', 60).approve(QUOTES, 'test');
    const r = await bun([path.join(HERE, 'run.ts'), '--models', 'haiku'], { ...process.env, ...fake.env, PLAN_FILE: path.join(dir, 'plan.json'), FROZEN_FILE: path.join(dir, 'frozen.sha256'), PROMPTS: path.join(dir, 'prompts'), RESULTS: path.join(dir, 'results'), LEDGER: ledger, PREREG_SHA: 'x' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('does not match frozen.sha256');
    expect(fs.readFileSync(ledger, 'utf8').trim().split('\n').length).toBe(1);
  });
});
