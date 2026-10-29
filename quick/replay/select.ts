// Picks the replay's cases from the miner's candidates and writes quick/replay/cases.json.
// Defects: one per PR, chosen by hand from candidates whose filtered diff is at most 750
// lines (EXCLUDED lists every other candidate in that range with the reason), in two strata:
// review-caught (gstack's own review fixed it on the PR branch) and escaped (a later PR fixed
// it). Decoys: by rule, nearest diff size to each defect among clean, mostly-code PRs that no
// escaped candidate names as its introducer.
// bun quick/replay/select.ts   (reads OUT from mine.ts)
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { filterDiff } from './lib.ts';

const G = process.env.GSTACK_DIR ?? '/workspace/gstack';
const OUT = process.env.OUT ?? path.join(process.env.HOME!, '.capy/work/replay/candidates');
const git = (...a: string[]) => {
  const r = spawnSync('git', a, { cwd: G, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git ' + a.join(' ') + ' exit ' + r.status + ': ' + (r.stderr ?? '').slice(0, 300));
  return r.stdout;
};

const DEFECTS: { id: string; pr: number; fix: string; file: string; also_files?: string[]; source: 'review-caught' | 'escaped'; defect: string }[] = [
  { id: 'd01', pr: 3515, fix: 'f1635d0f6', file: 'scripts/ubicloud/ubi-runner.sh', source: 'review-caught',
    defect: 'cmd_pack sets its EXIT trap in single quotes on a function-local $tmp. When a set -e failure unwinds the function, the trap runs after the local is gone, $tmp expands empty, and the temporary snapshot directory leaks.' },
  { id: 'd02', pr: 3540, fix: '0e2e11218', file: 'bin/gstack-doctor', source: 'review-caught',
    defect: 'cfg() calls gstack_config_select, which reselects the state root and overwrites _gstack_sr_var. After the doctor has set GSTACK_STATE_ROOT, the --check and --json state-root row therefore always says the root was selected by GSTACK_STATE_ROOT, whatever really selected it.' },
  { id: 'd03', pr: 3527, fix: 'f659bd6d5', file: 'ship/sections/adversarial.md.tmpl', source: 'review-caught',
    defect: 'The step prints ADVERSARIAL: skipped (review plan) only when the plan has neither DISPATCH line. On a plan with only the outside-voice line the native pass is skipped with no skip line printed, so the skip is silent.' },
  { id: 'd04', pr: 339, fix: 'ffd9ab29b', file: 'scripts/gen-skill-docs.ts', source: 'escaped',
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
  { id: 'd11', pr: 104, fix: '318ffdbdf', file: 'browse/src/read-commands.ts', source: 'escaped',
    defect: 'The js command wraps any code that contains await as an expression, (async()=>(code))(), and eval does the same for a one-line file. A statement inside those parentheses (const, let, a semicolon, return) is a SyntaxError, so browse js with await fails on anything but a single expression.' },
  { id: 'd12', pr: 595, fix: 'a7593d70e', file: 'browse/src/cookie-picker-ui.ts', also_files: ['browse/src/cookie-picker-routes.ts'], source: 'escaped',
    defect: 'GET /cookie-picker stays unauthenticated, but the HTML it serves now inlines the server\'s master bearer token (AUTH_TOKEN) for the picker\'s fetch calls. Any local process that fetches that URL reads the token and can then call the authenticated /command route, which runs arbitrary JavaScript in the browser.' },
  { id: 'd13', pr: 897, fix: 'c43c850ca', file: 'bin/gstack-slug', source: 'escaped',
    defect: 'A slug read from the cache file (~/.gstack/slug-cache/<key>) is echoed without the [a-zA-Z0-9._-] filter that the compute and fallback paths apply, though the header promises sanitized output because callers eval or source it. A planted or corrupted cache file therefore injects shell into eval "$(gstack-slug)".' },
  { id: 'd14', pr: 199, fix: 'bd834aead', file: 'retro/SKILL.md.tmpl', source: 'escaped',
    defect: 'The template tells the agent to pass --since="YYYY-MM-DD" (and --until the same way in compare mode) and says git reads a bare date as local midnight. Git reads a bare date as that date at the current wall-clock time, so a retro run late in the day drops most of the first day from its window.' },
  { id: 'd15', pr: 3143, fix: 'db87940e2', file: 'lib/outside-review-result.ts', source: 'escaped',
    defect: 'classifyOutsideReview honors a reviewer\'s explicit not-ready verdict only when no severity parsed (notReady = !findings.highest && verdictNotReady(...)). When the reviewer says not ready but lists only advisory P2 or P3 findings, the verdict is ignored and the review classifies as clean, so the gate passes a review its own reviewer rejected.' },
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
  '130': 'escaped: plan mode self-censoring is model behaviour; the fix adds a reasoning note, not a correction',
  '326 scripts/gen-skill-docs.ts, 135': 'escaped: a feature gap, /review did not write the review log until #387 added it',
  '62': 'escaped: #391 added a one-time cleanup migration, not a fix to a defect in #62',
  '431': 'escaped: a Bun-on-Windows runtime quirk (a stdio string) with nothing in the diff to show it; environment-only',
  '471': 'escaped: a hang from xhigh reasoning effort in an external CLI; environment-only',
  '791': 'escaped: a feature (new DX review modes), not a defect',
  '844': 'escaped: a revert that states no defect',
  '602': 'escaped: the stated cause (pipefail empties the slug) does not follow from the old lines; the fix that cured the symptom is a new cache',
  '255': 'escaped: the failure came from @ngrok/ngrok, a dependency added after #255',
  '693': 'escaped: the fix adds a VERSION and package.json drift repair step, a feature',
  '1025': 'escaped: a design change (a user close now exits 0 for supervisors); #1025 chose 2 on purpose',
  '3044': 'escaped: Rails gem installs failing on many threads on the export host; environment-only',
  '3111': 'escaped: a new file-name pattern for dependency-closure artifacts, not a defect in the diff',
  '3230': 'escaped: nested Git repos, long history and macOS sockets; environment-only',
  '3358': 'escaped: a version-stamp data file, not a defect',
  '3323': "escaped: this file's fix is a message; the behaviour fix sits in another file",
  '346': 'escaped: one case per fixing PR (#391 also fixed d04, which is kept); the setup staleness check it fixed is a real defect',
};

const C = path.join(OUT, 'defect-candidates.json');
const all = [...JSON.parse(fs.readFileSync(C, 'utf8')), ...JSON.parse(fs.readFileSync(path.join(OUT, 'missed-candidates.json'), 'utf8')).map((m: any) => ({ ...m, scope: 'full' }))];
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const diffOf = (base: string, head: string) => filterDiff(git('diff', base, head), f => git('show', head + ':' + f).slice(0, 400));

const defects = DEFECTS.map(d => {
  const c = all.find((x: any) => x.pr === d.pr && x.fix.startsWith(d.fix) && x.file === d.file);
  if (!c) throw new Error('no candidate for ' + d.id);
  const diff = diffOf(c.base, c.reviewedHead);
  const fixDiff = git('-c', 'core.abbrev=9', 'diff', c.fix + '^', c.fix, '--', d.file, ...(d.also_files ?? []));
  return { id: d.id, kind: 'defect', source: d.source, pr: d.pr, title: c.title, base: c.base, head: c.reviewedHead, scope: c.scope, file: d.file, ...(d.also_files ? { also_files: d.also_files } : {}), lines: c.ranges, fix: c.fix, fix_pr: c.fixPr ?? d.pr, defect: d.defect, diff_lines: c.diffLines, diff_sha256: sha(diff), fix_diff_sha256: sha(fixDiff), ...(d.source === 'escaped' ? { review_receipt: !!c.introducerHasReview } : {}) } as any;
});
const logGap = (a: number, b: number) => Math.abs(Math.log(a / b));

// Every escaped defect is kept. The review-caught stratum is size-matched to it: for each
// escaped defect, smallest first, the unused caught defect nearest in diff size.
const escaped = defects.filter(d => d.source === 'escaped').sort((a, b) => a.diff_lines - b.diff_lines);
const caughtPool = defects.filter(d => d.source === 'review-caught');
const caught: any[] = [];
for (const e of escaped) {
  const pick = caughtPool.filter(c => !caught.some(k => k.id === c.id)).sort((a, b) => logGap(a.diff_lines, e.diff_lines) - logGap(b.diff_lines, e.diff_lines) || a.id.localeCompare(b.id))[0]!;
  caught.push({ ...pick, size_matched_to: e.id });
}
for (const c of caughtPool.filter(c => !caught.some(k => k.id === c.id))) EXCLUDED[c.pr + ' ' + c.file] = 'review-caught: not the nearest size match to an escaped defect (' + c.diff_lines + ' lines)';

const introducers = new Set(JSON.parse(fs.readFileSync(path.join(OUT, 'missed-candidates.json'), 'utf8')).map((m: any) => m.pr));
const decoyPool = JSON.parse(fs.readFileSync(path.join(OUT, 'decoy-candidates.json'), 'utf8'))
  .filter((x: any) => !x.dirty && x.codeLines >= 0.5 * x.diffLines && !introducers.has(x.pr));
const used = new Set<number>();
const decoyOf = new Map<string, any>();
for (const d of [...escaped, ...caught].sort((a, b) => a.diff_lines - b.diff_lines)) {
  const pick = decoyPool.filter((x: any) => !used.has(x.pr)).sort((a: any, b: any) => logGap(a.diffLines, d.diff_lines) - logGap(b.diffLines, d.diff_lines) || b.pr - a.pr)[0];
  used.add(pick.pr);
  const diff = diffOf(pick.mainBefore, pick.squash);
  decoyOf.set(d.id, { id: 'y' + d.id.slice(1), kind: 'decoy', pr: pick.pr, title: pick.title, base: pick.mainBefore, head: pick.squash, receipt: pick.receipt, matched_to: d.id, later_fixes_checked: pick.laterFixesChecked, diff_lines: pick.diffLines, diff_sha256: sha(diff) });
}

// Run order: escaped defects, each followed by its decoy, then the review-caught pairs, so a
// cap stop cuts the review-caught tail first.
const cases = [...escaped, ...caught].flatMap(d => [d, decoyOf.get(d.id)]);
fs.writeFileSync(path.join(import.meta.dir, 'cases.json'), JSON.stringify({ gstack_repo: 'garrytan/gstack', excluded: EXCLUDED, cases }, null, 2) + '\n');
for (const c of cases) console.log(c.id, c.kind, c.source ?? '', '#' + c.pr, c.diff_lines, c.size_matched_to ?? c.matched_to ?? '', c.file ?? c.receipt?.slice(0, 40));
