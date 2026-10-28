// Renders every replay prompt from a pinned gstack checkout and writes the run plan.
// bun quick/replay/build.ts   (GSTACK_DIR, GSTACK_SHA, PROMPTS=~/.capy/work/replay/prompts)
// Prompt text comes from gstack at GSTACK_SHA: review/checklist.md, review/SKILL.md (Step 4 and
// Confidence Calibration), review/sections/review-army.md (the specialist and Red Team prompts)
// and review/specialists/*.md. Each replacement asserts its anchor, so a gstack change that
// moves the text fails the build instead of silently changing an arm.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { diffLines, filterDiff, selectSpecialists, splitFiles, FIXTURE_RE, type Scope } from './lib.ts';

const G = process.env.GSTACK_DIR ?? '/workspace/gstack';
export const GSTACK_SHA = process.env.GSTACK_SHA ?? '61e201ec08bcf59163ef2d3a69a26e334a536c04';
const PROMPTS = process.env.PROMPTS ?? path.join(process.env.HOME!, '.capy/work/replay/prompts');
const WT = process.env.WT ?? path.join(process.env.HOME!, '.capy/work/replay/wt');
const HERE = import.meta.dir;
const BT = String.fromCharCode(96);

function run(cmd: string, args: string[], cwd = G, ok = [0]): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (!ok.includes(r.status ?? -1)) throw new Error(cmd + ' ' + args.join(' ') + ' exit ' + r.status + ': ' + (r.stderr ?? '').slice(0, 400));
  return r.stdout;
}
const git = (...a: string[]) => run('git', a);
const at = (p: string) => git('show', GSTACK_SHA + ':' + p);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function must(text: string, from: string | RegExp, to: string): string {
  const hit = typeof from === 'string' ? text.includes(from) : from.test(text);
  if (!hit) throw new Error('anchor not found: ' + String(from).slice(0, 80));
  return text.replace(from, to);
}
function between(text: string, start: string, end: string, inclusive = true): string {
  const i = text.indexOf(start);
  if (i < 0) throw new Error('start anchor not found: ' + start.slice(0, 60));
  const j = text.indexOf(end, i + start.length);
  if (j < 0) throw new Error('end anchor not found: ' + end.slice(0, 60));
  return inclusive ? text.slice(i, j + end.length) : text.slice(i + start.length, j);
}
// A backtick-quoted command, as a regex source.
const CMD = BT + '[^' + BT + ']+' + BT;

const SKILL = at('review/SKILL.md');
const ARMY = at('review/sections/review-army.md');
const CHECKLIST = at('review/checklist.md');

// Item 5 of the specialist dispatch, unquoted, with its two tool steps rewritten to the
// pasted checklist and diff (a replay call has no tools).
const SPEC_RAW = between(ARMY, '"You are a specialist code reviewer.', "Past learnings: {learnings or 'none'}\"").slice(1, -1).replace(/\\"/g, '"');
const SPEC = must(SPEC_RAW, new RegExp('Read the checklist at \\{checklist path\\}, then run\\n' + CMD + ' to get the full diff\\.'), 'Read the checklist below, then read the full diff below.');
export const SCHEMA = between(SPEC, BT + 'NO FINDINGS' + BT + ' alone is the expected', 'Without it the finding reads as pre-existing code.');

const FRAMING = between(ARMY, 'Begin the prompt with:\n"', '"\nand replace its full-diff command with: "', false);
const FIXTURE_TEXT = must(must(between(ARMY, 'and replace its full-diff command with: "', '"\nEvery other specialist', false),
  new RegExp('read full content: ' + CMD), 'read full content (the non-fixture diff below)'),
  new RegExp('review in SUMMARY mode only \\(' + CMD + '\\)'), 'review in SUMMARY mode only (the --stat summary below)');

const RED_RAW = between(ARMY, '"You are a red team reviewer.', "checklists\ndon't cover.\"").slice(1, -1).replace(/\\"/g, '"');
const RED = must(must(must(RED_RAW, 'Read the checklist at {red-team checklist path}', 'Read the checklist below'),
  new RegExp('list changed files with ' + CMD + ', read them as that fixture handling says'), 'read the changed files listed below as that fixture handling says (the non-fixture diff and the fixture summary are below)'),
  'reviewed by N specialists', 'reviewed by {N} specialists');

const CORE_FLOOR = between(SKILL, 'Apply both checklist passes in order', BT + 'NO FINDINGS' + BT + ' is a complete result from any reviewer.');
const CALIBRATION = between(SKILL, '## Confidence Calibration', '\n## ', false);

export const BASELINE_HEAD = 'Review this pull request diff for bugs. Output one JSON object per line for each bug, {"severity":"CRITICAL|INFORMATIONAL","path":"<file>","line":<n>,"summary":"<what breaks>"}, or the two words NO FINDINGS if there are none.';

const fence = (d: string) => BT.repeat(3) + 'diff\n' + d + (d.endsWith('\n') ? '' : '\n') + BT.repeat(3);

function baseline(diff: string): string {
  return [BASELINE_HEAD, '', '## Diff', fence(diff)].join('\n');
}

function core(diff: string): string {
  return [
    "You are the core reviewer in gstack's pre-landing review (/review Step 4, the critical pass). Apply the checklist below against the diff below.",
    '', CORE_FLOOR, '', '## Confidence Calibration', CALIBRATION.trim(), '',
    "Output: instead of the checklist's prose report, use this machine-readable form.", SCHEMA,
    '', '## Checklist', CHECKLIST.trim(), '', '## Diff', fence(diff),
  ].join('\n');
}

function nonFixture(diff: string): { code: string; stat: string } {
  const files = splitFiles(diff);
  const code = files.filter(f => !FIXTURE_RE.test(f.path)).map(f => f.text).join('');
  const stat = files.filter(f => FIXTURE_RE.test(f.path)).map(f => ' ' + f.path + ' | ' + diffLines(f.text)).join('\n') || ' (no fixture or test files changed)';
  return { code, stat };
}

function specialist(name: string, diff: string, stack: string, testFw: string): string {
  const checklist = name === 'design' ? at('review/design-checklist.md') : at('review/specialists/' + name + '.md');
  const body = must(must(must(SPEC, '({TEST_FW})', '(' + testFw + ')'), 'Stack context: {STACK}', 'Stack context: This is a ' + stack + ' project.'), "Past learnings: {learnings or 'none'}", 'Past learnings: none');
  if (name !== 'security') return [body, '', '## Checklist', checklist.trim(), '', '## Diff', fence(diff)].join('\n');
  const { code, stat } = nonFixture(diff);
  return [FRAMING, '', FIXTURE_TEXT, '', body, '', '## Checklist', checklist.trim(), '', '## Diff (non-fixture source)', fence(code), '', '## Fixture and test files (summary mode)', stat].join('\n');
}

// The Red Team prompt is completed at run time with the trial's merged specialist findings.
export function redTeam(template: string, n: number, merged: string): string {
  return must(must(template, '{N}', String(n)), '{merged findings summary}', merged || 'none');
}
function redTeamTemplate(diff: string, nameStatus: string): string {
  const { code, stat } = nonFixture(diff);
  return [FRAMING, '', FIXTURE_TEXT, '', RED, '', '## Checklist', at('review/specialists/red-team.md').trim(), '', '## Changed files', nameStatus.trim(), '', '## Diff (non-fixture source)', fence(code), '', '## Fixture and test files (summary mode)', stat].join('\n');
}

// The scope and state-machine detectors run from a clean worktree at GSTACK_SHA, so the
// dispatch comes from the same gstack as the prompt text, whatever GSTACK_DIR has checked out.
function pinnedBin(): string {
  fs.mkdirSync(WT, { recursive: true });
  const dir = path.join(WT, 'gstack-' + GSTACK_SHA.slice(0, 12));
  if (!fs.existsSync(dir)) git('worktree', 'add', '-q', '--detach', dir, GSTACK_SHA);
  if (run('git', ['rev-parse', 'HEAD'], dir).trim() !== GSTACK_SHA || run('git', ['status', '--porcelain'], dir).trim()) throw new Error(dir + ' is not a clean checkout of ' + GSTACK_SHA);
  return path.join(dir, 'bin');
}

function scopeAt(bin: string, base: string, head: string): Scope & { raw: string } {
  const wt = path.join(WT, 'scope');
  if (!fs.existsSync(wt)) git('worktree', 'add', '-q', '--detach', wt, head);
  run('git', ['checkout', '-q', '--detach', head], wt);
  const ds = run(path.join(bin, 'gstack-diff-scope'), [base], wt, [0, 2]);
  const sm = run(path.join(bin, 'gstack-state-matrix'), ['detect', '--diff-base', base], wt, [0, 1, 2]);
  const flag = (k: string) => new RegExp('^SCOPE_' + k + '=true$', 'm').test(ds);
  const smv = /^SCOPE_STATE_MACHINE=(true|false)$/m.exec(sm)?.[1] as 'true' | 'false' | undefined;
  return { BACKEND: flag('BACKEND'), FRONTEND: flag('FRONTEND'), AUTH: flag('AUTH'), MIGRATIONS: flag('MIGRATIONS'), API: flag('API'), STATE_MACHINE: smv ?? 'unknown', raw: (ds + sm).split('\n').filter(l => l.startsWith('SCOPE_')).join(' ') };
}

function stackAt(head: string): { stack: string; testFw: string } {
  const has = (f: string) => spawnSync('git', ['cat-file', '-e', head + ':' + f], { cwd: G }).status === 0;
  let stack = '';
  if (has('Gemfile')) stack += 'ruby ';
  if (has('package.json')) stack += 'node ';
  if (has('requirements.txt') || has('pyproject.toml')) stack += 'python ';
  if (has('go.mod')) stack += 'go ';
  if (has('Cargo.toml')) stack += 'rust ';
  if (has('pubspec.yaml')) stack += 'dart ';
  let testFw = '';
  if (has('jest.config.ts') || has('jest.config.js')) testFw = 'jest';
  if (has('vitest.config.ts')) testFw = 'vitest';
  if (has('spec/spec_helper.rb') || has('.rspec')) testFw = 'rspec';
  if (has('pytest.ini') || has('conftest.py')) testFw = 'pytest';
  if (has('go.mod')) testFw = 'go-test';
  return { stack: stack.trim() || 'unknown', testFw: testFw || 'unknown' };
}

if (import.meta.main) {
  const { cases } = JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8'));
  fs.mkdirSync(PROMPTS, { recursive: true });
  const bin = pinnedBin();
  const frozen: string[] = [];
  const plan: any[] = [];
  const write = (rel: string, text: string) => {
    const f = path.join(PROMPTS, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    frozen.push(sha(text) + '  ' + rel);
    return rel;
  };
  for (const c of cases) {
    // Reviewed heads of defect cases live on PR branches, not on main.
    for (const s of [c.base, c.head, c.fix].filter(Boolean)) {
      if (spawnSync('git', ['cat-file', '-e', s + '^{commit}'], { cwd: G }).status !== 0) git('fetch', '-q', 'origin', 'pull/' + c.pr + '/head:refs/pr/' + c.pr);
    }
    const diff = filterDiff(git('diff', c.base, c.head), f => git('show', c.head + ':' + f).slice(0, 400));
    if (sha(diff) !== c.diff_sha256) throw new Error(c.id + ': diff digest moved');
    const n = diffLines(diff);
    const scope = scopeAt(bin, c.base, c.head);
    const { stack, testFw } = stackAt(c.head);
    const specs = selectSpecialists(n, scope);
    const kept = new Set(splitFiles(diff).map(f => f.path));
    const nameStatus = git('diff', '--name-status', c.base, c.head).split('\n').filter(l => kept.has(l.split('\t').pop() ?? '')).join('\n');
    plan.push({
      case: c.id, kind: c.kind, diff_lines: n, scope: scope.raw, stack, test_fw: testFw, specialists: specs, red_team_by_size: n > 200,
      prompts: {
        baseline: write(c.id + '/baseline.md', baseline(diff)),
        core: write(c.id + '/core.md', core(diff)),
        ...Object.fromEntries(specs.map(s => [s, write(c.id + '/' + s + '.md', specialist(s, diff, stack, testFw))])),
        red_team_template: write(c.id + '/red-team.template.md', redTeamTemplate(diff, nameStatus)),
      },
    });
    console.log(c.id, c.kind, 'lines', n, 'specialists', specs.join(',') || '-', n > 200 ? '+red-team' : '', scope.raw);
  }
  fs.writeFileSync(path.join(HERE, 'plan.json'), JSON.stringify({ gstack_sha: GSTACK_SHA, cases: plan }, null, 2) + '\n');
  fs.writeFileSync(path.join(HERE, 'frozen.sha256'), frozen.join('\n') + '\n');
  const bytes = frozen.map(l => fs.statSync(path.join(PROMPTS, l.slice(66))).size);
  console.log('prompts', frozen.length, 'bytes', bytes.reduce((a, b) => a + b, 0));
}
