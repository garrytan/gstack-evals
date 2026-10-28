// Picks the replay's cases from the miner's candidates and writes quick/replay/cases.json.
// Defects: one per PR, chosen by hand from candidates whose filtered diff is at most 750
// lines (EXCLUDED lists every other candidate in that range with the reason). Decoys: by
// rule, nearest diff size to each defect among clean, mostly-code PRs from #1000 on.
// bun quick/replay/select.ts   (reads OUT from mine.ts)
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { filterDiff } from './lib.ts';

const G = process.env.GSTACK_DIR ?? '/workspace/gstack';
const OUT = process.env.OUT ?? path.join(process.env.HOME!, '.capy/work/replay/candidates');
const git = (...a: string[]) => spawnSync('git', a, { cwd: G, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }).stdout;

const DEFECTS: { id: string; pr: number; fix: string; file: string; source: 'review-caught' | 'missed'; defect: string }[] = [
  { id: 'd01', pr: 3515, fix: 'f1635d0f6', file: 'scripts/ubicloud/ubi-runner.sh', source: 'review-caught',
    defect: 'cmd_pack sets its EXIT trap in single quotes on a function-local $tmp. When a set -e failure unwinds the function, the trap runs after the local is gone, $tmp expands empty, and the temporary snapshot directory leaks.' },
  { id: 'd02', pr: 3540, fix: '0e2e11218', file: 'bin/gstack-doctor', source: 'review-caught',
    defect: 'cfg() calls gstack_config_select, which reselects the state root and overwrites _gstack_sr_var. After the doctor has set GSTACK_STATE_ROOT, the --check and --json state-root row therefore always says the root was selected by GSTACK_STATE_ROOT, whatever really selected it.' },
  { id: 'd03', pr: 3527, fix: 'f659bd6d5', file: 'ship/sections/adversarial.md.tmpl', source: 'review-caught',
    defect: 'The step prints ADVERSARIAL: skipped (review plan) only when the plan has neither DISPATCH line. On a plan with only the outside-voice line the native pass is skipped with no skip line printed, so the skip is silent.' },
  { id: 'd04', pr: 339, fix: 'ffd9ab29b', file: 'scripts/gen-skill-docs.ts', source: 'missed',
    defect: 'transformFrontmatter re-emits the Codex frontmatter with the full skill description and no length check. Codex rejects a skill description over 1024 characters, so a long description yields a Codex SKILL.md that fails to load, and the build does not catch it.' },
  { id: 'd05', pr: 1916, fix: '7ffccb929', file: 'plan-devex-review/sections/review-sections.md.tmpl', source: 'review-caught',
    defect: 'The compressed review-log instruction says how to fill STATUS and COMMIT but no longer says how to fill TIMESTAMP, so the agent writes the literal "timestamp":"TIMESTAMP". The dashboard cannot parse that date, and its 7-day freshness window silently drops the plan-devex-review row.' },
  { id: 'd06', pr: 3422, fix: '1a1f2cebd', file: 'bin/gstack-design-craft', source: 'review-caught',
    defect: 'When the --accepted exceptions file is missing or malformed, the tool prints an error and exits 2 with no CRAFT_RESULT line. The craft section reads a missing CRAFT_RESULT as check unavailable, so one bad finalized.json turns the craft gate off (fails open) instead of running the full check.' },
  { id: 'd07', pr: 3426, fix: 'a3d402d07', file: 'setup', source: 'review-caught',
    defect: 'install_runtime_deps falls back to bun install --production after the --frozen-lockfile install fails, but Bun\'s --production implies a frozen lockfile, so the fallback cannot recover a stale bun.lock: a fork or local edit that leaves the lockfile out of date makes the dependency install fail.' },
  { id: 'd08', pr: 1296, fix: '640b4e359', file: 'office-hours/SKILL.md.tmpl', source: 'review-caught',
    defect: 'The fallback for a session with no callable AskUserQuestion always writes ## Decisions to confirm into the plan file and calls ExitPlanMode, even outside plan mode, where there is no plan file or plan mode to exit. Outside plan mode it should output the decision brief as prose and stop.' },
  { id: 'd09', pr: 3475, fix: 'b01754469', file: 'bin/gstack-doctor-check.sh', source: 'review-caught',
    defect: 'The project-floor reader pipes the whole policy file through tr (twice) before sed, with no size bound, so a very large .gstack/ship-policy.json is read and held whole (about 2 GB of memory for a 95 MB file).' },
  { id: 'd10', pr: 3501, fix: '0a741933b', file: 'lib/prose-lint.ts', source: 'review-caught',
    defect: 'maskProse looks for an unterminated <!-- before it masks inline code, so a <!-- inside a backtick code span opens a multi-line comment and blanks the following lines, hiding them from every lint rule. sectionsOnly likewise treats a ## line inside a fenced code block as a section heading.' },
];

const EXCLUDED: Record<string, string> = {
  '2772': 'fix makes a vague instruction literal (where to record UNAVAILABLE); no failing behaviour named',
  '3527 scripts/resolvers/review-army.ts': 'a size-pin wording change, not a defect',
  '1916 scripts/resolvers/review.ts': 'a refactor to fit a parity budget, not a defect',
  '3491': 'the single-file fix is help text; the behaviour fixes sit in lib/restamp.ts, which the miner could not isolate',
  '297': 'a feature (tier override), not a defect fix',
  '3074': 'a timeout too short for arm64 Rails builds; not findable from the diff',
  '3515 other passes': 'one case per PR (pass 2 kept)',
  '3426 bin/gstack-browser-ensure': 'one case per PR (the setup fallback kept; the other is a remediation hint)',
  '3422 design-html/sections/craft.md.tmpl': 'one case per PR',
  '3475 bin/gstack-capy-install': 'one case per PR',
};

const C = path.join(OUT, 'defect-candidates.json');
const all = [...JSON.parse(fs.readFileSync(C, 'utf8')), ...JSON.parse(fs.readFileSync(path.join(OUT, 'missed-candidates.json'), 'utf8')).map((m: any) => ({ ...m, scope: 'full' }))];
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const diffOf = (base: string, head: string) => filterDiff(git('diff', base, head), f => git('show', head + ':' + f).slice(0, 400));

const cases: any[] = [];
for (const d of DEFECTS) {
  const c = all.find((x: any) => x.pr === d.pr && x.fix.startsWith(d.fix) && x.file === d.file);
  if (!c) throw new Error('no candidate for ' + d.id);
  const diff = diffOf(c.base, c.reviewedHead);
  const fixDiff = git('diff', c.fix + '^', c.fix, '--', d.file);
  cases.push({ id: d.id, kind: 'defect', source: d.source, pr: d.pr, title: c.title, base: c.base, head: c.reviewedHead, scope: c.scope, file: d.file, lines: c.ranges, fix: c.fix, fix_pr: c.fixPr ?? d.pr, defect: d.defect, diff_lines: c.diffLines, diff_sha256: sha(diff), fix_diff_sha256: sha(fixDiff) });
}

const decoyPool = JSON.parse(fs.readFileSync(path.join(OUT, 'decoy-candidates.json'), 'utf8'))
  .filter((x: any) => !x.dirty && x.pr >= 1000 && x.codeLines >= 0.5 * x.diffLines);
const used = new Set<number>();
for (const d of [...cases].sort((a, b) => a.diff_lines - b.diff_lines)) {
  const pick = decoyPool.filter((x: any) => !used.has(x.pr)).sort((a: any, b: any) => Math.abs(Math.log(a.diffLines / d.diff_lines)) - Math.abs(Math.log(b.diffLines / d.diff_lines)) || b.pr - a.pr)[0];
  used.add(pick.pr);
  const diff = diffOf(pick.mainBefore, pick.squash);
  cases.push({ id: 'y' + d.id.slice(1), kind: 'decoy', pr: pick.pr, title: pick.title, base: pick.mainBefore, head: pick.squash, receipt: pick.receipt, matched_to: d.id, later_fixes_checked: pick.laterFixesChecked, diff_lines: pick.diffLines, diff_sha256: sha(diff) });
}

fs.writeFileSync(path.join(import.meta.dir, 'cases.json'), JSON.stringify({ gstack_repo: 'garrytan/gstack', excluded: EXCLUDED, cases }, null, 2) + '\n');
for (const c of cases) console.log(c.id, c.kind, '#' + c.pr, c.diff_lines, c.file ?? c.receipt?.slice(0, 40));
