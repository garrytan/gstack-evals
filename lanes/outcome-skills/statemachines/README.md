# The implicit state machines family (SM)

The harness for the preregistration in wiki/plans/2026-11-09-geva-409-state-machines-prompt-prereg/README.md (the post).
The post is the source of truth; this file records the rules as built and the readings the build chose where the post
leaves a detail open. This part (unit prep) covers post sections 3 and 4 and the prep half of section 18.

## Commands

`gstack-evals outcome sm --help` lists them: `source fetch`, `source pin`, `screen`, `convert`, `draw`, `oracle`, `size`
and `sample`. Every refusal prints its reason code first (docs/errors.md, codes E_SM_*).

## Source (source.ts)

- SWE-bench-Live MultiLang at revision eb09c2e5db6e4c5a95e01c903c8fd1d5da33c4f3, read from the dataset's eight parquet
  files (c, cpp, cs, go, java, js, rust, ts), each checked against the sha256 that source.ts pins. The files are read
  keylessly with pyarrow 22.0.0 under uv (parquet.py). 1,077 rows.
- Each image is pinned to its linux/amd64 manifest digest by a registry HEAD, which Docker Hub does not count as a pull.
  An index needs one GET, which the pull pacing counts. Image sizes come from the manifest's layer sizes (one counted
  GET each).
- candidates.json holds ids, months, languages, digests and counts only. Row bytes stay in the local cache.
- The SWE-rebench part (quick/laneb/tasks/swerebench-r3a4.json) is not converted yet: its fail-to-pass and pass-to-pass
  lists and test command live in the Harbor package's tests/, which this part does not read.

## Unit format (unit.ts, sm-unit.v1)

One dir per unit: unit.json, fix.patch, test.patch, issue.md, parser.py and harbor/ (task.toml with docker_image set to
the pinned repository@sha256 reference, environment/Dockerfile FROM that reference only, instruction.md). unit.json
carries every payload file's sha256; readUnit refuses a dir whose files differ (E_SM_UNIT). repo_dir and work_dir are
read from the image at prep: the repository is the image's work dir when it holds .git, else /testbed, else
/testbed/repo. Most MultiLang images hold it at /testbed.

## Prep (history.ts, leak.ts, scope.ts, sh/)

Each step is a bash script under sh/ that runs on a host dir (tests) or in a container from the runtime image as root
with no network, on the unit's tree volume.

1. Strip (list.sh, then rewrite.sh): every CLAUDE.md, CLAUDE.local.md and AGENTS.md (so .claude/AGENTS.md too) and every
   .claude dir at any depth, then each @import that a removed CLAUDE.md or CLAUDE.local.md names and that resolves inside
   the repository, one level, outside code blocks and code spans. Home (~) and outside paths are not followed. The
   removed paths are recorded in unit.json strip.removed.
2. History (rewrite.sh): the tree must be at base_commit with no tracked file changed (E_SM_HISTORY otherwise). The files
   the old repository tracked and that remain after the strip are committed as one commit on main, with a fixed author,
   committer and date. Nested .git dirs are removed. Untracked build output stays on disk, untracked. Then reflog expiry,
   .git/logs removal and git gc --prune=now.
3. Follow-on trees (followon.sh): the first stage's full-tree patch, staged with git apply --index, as commit two.
4. Preflight (preflight.sh): commit count 1 on a base tree and 2 on a follow-on tree, every commit reachable from HEAD,
   refs only refs/heads/main, no remote, stash, reflog file or loose object. Else E_SM_HISTORY.
5. Scope (scope.ts): the deepest dir holding every non-test source file the fix changed, widened one parent at a time
   until it holds 10 tracked source files of the unit's language (test files excluded); the root stops it. Records dir
   ("." for the root), file count, line count and widening steps.
6. Leak scan (leak.ts, baselines.sh, scan.sh): needles are the fix's "+" lines (not "+++") of 30 code points or more,
   counted after removing only the newline, that are no whole line of any tracked file of the stripped one-commit tree
   (binary files included). The scan reads every top-level entry of / except /proc and /sys (and its own input dir) with
   grep -r -a -F -x, devices skipped. A hit logs the path and the needle's sha256, never the line, and drops the unit
   (E_SM_LEAKED). A scan that does not finish fails closed.

## Screen (screen.ts) and draw (draw.ts)

- Screen, in order: image digest present; fail-to-pass at least 1; pass-to-pass at least 1; the fix changes 1 to 6
  non-test source files (langs.ts classify, the unit's test.patch files counting as test files); the feature-request
  screen. Each drop is E_SM_INELIGIBLE with its rule name.
- Draw seed: draw_seed from the post bundle's prereg.json (schema sm-prereg.v1, also bootstrap_seed and order_seed,
  unsigned 32-bit). A missing file, schema or key refuses with E_SM_SEED; a MultiLang pin other than eb09c2e5 refuses
  with E_SM_SOURCE. Tests use tests/outcome-skills/fixtures/sm/prereg.json, with invented seeds.
- Order: one seededRandom(draw_seed) (src/runner/stats/paired.ts) shuffles each month's units, ids sorted first, months
  ascending. Admission walks 2026-03 to 2026-06; each test stratum walks 2026-07, 06, 05, 04, 03.
- Fill (lazy, the oracle as its test): admission 15, then state 30, then other 30; a short stratum's gap is filled from
  the other; then a reserve of 10, taken alternately from the state and other orders; then, only on a FLOOR reading,
  15 retry units next in admission order. At most 3 kept units per repository across all of them. A unit the oracle
  drops does not use a repository's slot. Each unit is asked once.

## Oracle (oracle.ts, testrun.ts)

Per unit in draw order: pull by digest under the pacing, the runtime layer (images/manifest.ts withRuntime), the smoke,
prep, then base 1, fixed 1, base 2, fixed 2, base 3, fixed 3, each on a fresh copy of the tree volume. Base is the tree
plus test.patch; fixed adds fix.patch. Each run is the unit's rebuild, test and print commands in one container, as
published, then the dataset parser in its sandbox over the print output. Only the parser's "pass" counts as a pass: that is the dataset's
status word (1,076 of the 1,077 pinned parsers write pass, fail and skip; the last lowercases its own). P1 compared with
"PASSED", so every sampled base run read as all failing; the container itself ran the tests fine.

- Fail-to-pass set (judge, read through unit.ts oracleF2p by score.ts and followon.ts): the dataset ids that fail in
  all three base runs, fix-tests.patch applied. A dataset id that passes in every base run leaves the set (f2p_removed);
  one that passes in some base runs and fails in others leaves it as flaky on base (f2p_flaky, Captain ruling 2 of
  2026-11-09), never a reason for E_SM_ORACLE_UNSTABLE. unit.json's oracle record keeps the set (f2p), each removal's
  count, ids and reason and the verdict reason. hidden.ts and sample.ts still read the dataset list: both run before the
  oracle.
- Run record: each run keeps its rebuild and test commands' exit statuses (runs[].exits). A Rust unit's record also keeps
  the cargo target reading (oracle.targets, targetReading): the targets each run reached (cargo's "Running <path>" and
  "Doc-tests <crate>" lines), the fixed runs' targets no base run reached (not_on_base), whether a base run printed
  cargo's fail-fast stop line (fail_fast_stop), and cargo_stopped_early, true when not_on_base is not empty. It changes no
  command and no verdict.
- Keep: every id left in the set passes in all three fixed runs, else E_SM_ORACLE_UNSTABLE; an empty set is
  E_SM_ORACLE_UNSTABLE ("no fail-to-pass test"). sm oracle prints drops per code and reason. Stable set: every id the parser reports "pass" in all six runs; an empty one is
  E_SM_ORACLE_UNSTABLE ("no stable test").
- 15 minutes: a run whose wall time reaches 900 s is stopped and the unit drops (E_SM_SLOW_TEST).
- Smoke (E_SM_SMOKE): the runtime layer builds, claude --version prints 2.1.312, node runs a probe and no denied target
  (1.1.1.1:443, 8.8.8.8:53, 93.184.216.34:80) opens. P1's prep container has no network at all, so the proxy route is
  checked in the session's own preflight.
- Pacing (Pacer): 60 counted registry GETs per rolling hour per host, in a shared log file. A rate-limit refusal waits for
  the window and is not a retry; a second other failure is E_SM_PULL.
- Parser sandbox: the pinned python image, no network, no mount, read-only root, uid 10001, no capabilities, 2 GB, 64
  pids; the parser source and log arrive on stdin. A crash, timeout or non-dict is E_SM_PARSER.
- Container modes: hardened (uid 10001, read-only root, tmpfs /tmp, no capabilities, no new privileges, no network, 4
  CPUs, 12 GB, 8192 pids) and root (root, writable container filesystem, no network). See the sample below for which one
  the oracle can use.
- Hardened home: the images keep their build tools' caches in root's home (Maven's repository, NuGet packages, the pnpm
  store), which uid 10001 cannot read, so with no network those builds failed hardened and passed as root. Each hardened
  run now gets a fresh copy of the image's home, owned by uid 10001 and mounted at the same path with HOME set to it, and
  a read-only copy of the image's /etc/passwd whose line for uid 10001 names that home, because Java reads its home from
  passwd and not from HOME. Both are discarded after the run like the tree copy. The uid, the read-only root, tmpfs /tmp,
  no capabilities, no new privileges, no network and the CPU, memory and pid caps are unchanged, and so are the test
  commands.

## Frozen per-language lists (frozen at this commit, langs.ts)

- Languages: rust, java, c, cpp, csharp, go, js, ts, python.
- Source extensions: rust .rs; java .java; c .c .h; cpp .cc .cpp .cxx .c++ .c .h .hh .hpp .hxx .ipp .tpp .inl; csharp .cs;
  go .go; js .js .mjs .cjs .jsx; ts .ts .mts .cts .tsx .js .mjs .cjs .jsx; python .py.
- Not source (any language): paths under node_modules, vendor, third_party, target, .git, dist, build, __pycache__,
  .venv, venv.
- Test-file conventions: Rust tests/, benches/; Java src/test/, *Test.java, *Tests.java, *IT.java; C test/, tests/,
  *_test.c, *_unittest.cc, test_*.c; C++ test/, tests/, *_test.cc, *_test.cpp, *_unittest.cc, test_*.c, test_*.cc,
  test_*.cpp; C# *.Tests/, *Tests.cs, *Test.cs; Go *_test.go; JS and TS *.test.*, *.spec.*, __tests__/, test/, tests/;
  Python test_*.py, *_test.py, tests/, test/, conftest.py. A unit's own test.patch files count as test files too.
- Protected test and build configuration: Cargo.toml, Cargo.lock, build.rs, rust-toolchain, rust-toolchain.toml,
  .cargo/config*; pom.xml, build.gradle(.kts), settings.gradle(.kts), gradle.properties, gradle/wrapper/; CMakeLists.txt,
  *.cmake, Makefile, meson.build, configure*; *.csproj, *.sln, Directory.Build.*, global.json, nuget.config; go.mod,
  go.sum; package.json, package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lock, bun.lockb, npm-shrinkwrap.json,
  jest/vitest/karma/mocha/babel .config.*, .mocharc*, .babelrc*, karma.conf.*, tsconfig*.json; conftest.py, pytest.ini,
  tox.ini, setup.cfg, pyproject.toml, sitecustomize.py, *.pth.
- Skip markers: Rust #[ignore; Java @Disabled, @Ignore, Assumptions.assume, Assume.assume; C and C++ GTEST_SKIP, DISABLED_,
  SKIP(; C# [Ignore, Skip =, [Fact(Skip; Go t.Skip(, t.SkipNow(, t.Skipf(; JS and TS .skip(, xit(, xdescribe(, .todo(;
  Python @pytest.mark.skip, skipif, xfail, unittest.skip, pytest.skip(.
- Feature-request screen: supply-count.py's FEAT pattern, byte for byte, sha256
  d1d17a14b6888740aa8c3a6e0b0c53f88194c3c76d1d9c6b4b4217f7d4103f7d, case-insensitive, over the issue's first 800 code
  points. JavaScript's \b is ASCII where Python's is Unicode; the two differ only beside non-ASCII word characters.

## Literal readings (none moves a scored outcome)

- "Test command takes over 15 minutes": the wall time of one oracle run (rebuild, test and print in one container).
- Stable set: every id passed in all six oracle runs, not only PASS_TO_PASS.
- @imports of a stripped CLAUDE.md are stripped when they resolve inside the repository, whatever they are, one level.
- "30 characters": code points, after removing only the line's newline (a trailing carriage return stays).
- Reserve: the next kept units after the fill, alternating state and other.
- Unclear units are never drawn into a test stratum; they can be admission or retry units and count in every total.
- Reason code owner: the code table's owner type allows only build units, so the family's codes carry U20, the
  outcome-skills lane's unit.

## Sessions (P2)

Arms. Family SM's arms live in lanes/outcome-skills/arms/registry.json under "sm", beside family G's arms and not among
them, so G's checks read G's arms only. statemachines/arms.ts checks the block (E_SM_ARM) and builds each arm's one turn.
tests/outcome-skills/sm-arms.test.ts pins every text by sha256 and checks it against the post. Literal readings:

- "Its sentence, then this suffix": the sentence, a blank line, then the suffix, as the follow-on turn puts its blank line.
- A3 runs on the first stage's limits (section 6), since section 17 scores it by section 7.
- The /qa pin (sha, version and install command) is recorded in sm.pins.qa: garrytan/gstack b6155921 (1.98.0.0), main's
  last commit on 2026-11-08 UTC, installed with `./setup --host claude`. qa:told refuses to build a turn while the pin is
  null, and arms/qa-install.sh refuses a missing sha or command.
- The proxy routes: Opus on anthropic, Sol (openai/gpt-6.1-sol) and particle-1 on OpenRouter's Messages route, as Claude
  Code arms used before.

Driver. An SM stage is { item, arm (its label), model, arms }: one lease per model's item serves every SM arm it lists,
at each arm's allowance for that model, and its proxy runs with refuseServerTools on (E_PROXY_SERVER_TOOL before
pricing). G stages are unchanged. An SM item carries the skill "qa" for qa:told and "sm" for the other arms (P4's items).

real_agent's family SM mode (arm in the registry's "sm" block): one turn, no sidecar, no origin and no gh stub, so the
tree keeps its one-commit or two-commit history; egress allows only the proxy. Before any session opens it checks, in the
container, the commit count and head the task names, that no CLAUDE.md, CLAUDE.local.md, AGENTS.md or .claude is in the
tree (E_SM_STRIP), and that a no-gstack home holds no ~/.claude/skills, ~/.claude/CLAUDE.md, ~/.local/share/gstack, ~/.capy
or ~/.gstack, while A3's home holds gstack at the /qa pin and no ~/.claude/CLAUDE.md. Nobody answers: AskUserQuestion gets section 6's fixed line,
a prose question ends the turn, and both are counted (sm_user.py). Claude Code's own transcripts are copied out as
claude-projects.tar for the memory audit.

Memory audit (strip.ts). Measured on the real 2.1.312 binary with a stub upstream (sm-claude.test.ts): an unstripped
tree's CLAUDE.md, its @import and .claude/rules reach the request; AGENTS.md and .claude/AGENTS.md reach it through a
built-in plugin when the tree has no CLAUDE.md; CLAUDE.local.md and nested files do not load at start. Stripped, none
reaches it. Claude Code's transcript records each loaded file as an instructions attachment, so a paid run's audit reads
the transcript; the dry run also reads request bodies. The init record's memory_paths names only the auto-memory folder.

Session plan (session.ts): per unit and model, the first-stage cells shuffled by order_seed plus the part number, then the
nine follow-ons shuffled the same way, each after its tree's first stage. End kinds and the one-retry rule follow section
6; a second upstream or infra end is E_SM_UPSTREAM_GAP or E_SM_INFRA_GAP.

## Prep readings added after the first sample (fixsplit.ts, langs.ts, leak.ts, history.ts)

- Pass word. The dataset's parsers write pass, fail and skip, so testrun.ts counts only "pass". With it, graphql-go-727
  passes 799 of 799 pass-to-pass tests on the base tree and both fail-to-pass tests after the fix, in hardened mode with no
  network. The container needed no change; the dataset's commands need no network at test time on the units sampled.
- The repository at the base commit (section 4) is read as the base commit's tree. When the image's tree has tracked
  files that differ from it, restore.sh checks them out again from the base commit before the history rewrite, and
  unit.json's strip.restored names them. A file that still differs refuses (E_SM_HISTORY). On less.js-4349 the one such
  file is a built bundle the image holds with CRLF line endings where the commit holds LF; its content is otherwise the same.
- The rewrite and the follow-on commit run git with gc.auto=0, so git's automatic gc can't collide with the explicit one.
- Tests inside the fix patch (sections 3 and 7). TEST_MODULES in langs.ts is the frozen detector: Rust's #[cfg(test)]
  inline modules, found on the code with comments, strings and char literals blanked, from the attribute (widened over
  directly preceding attribute lines) to the module's closing brace. An out-of-line mod (mod tests;) and a #[cfg(test)]
  item that is not a mod are not ranges. The other languages have no detector, since their tests live in test files.
- fixsplit.ts places each hunk of the fix patch by its changed lines: removed lines against the base file's ranges, added
  lines against the fixed file's. Wholly inside goes to fix-tests.patch, wholly outside stays in fix-source.patch, and
  anything else drops the unit with E_SM_MIXED_TEST_HUNK. A hunk is the fix patch's hunk as published; it is not
  re-split. The 1 to 6 file rule counts source files with a hunk left in fix-source.patch. fix.patch stays the published
  patch (the leak scan's needles come from it). The oracle's fixed runs apply test.patch, fix-source.patch, then
  fix-tests.patch; base runs never see fix-tests.patch. unit.json's split.in_source_tests records whether a unit scores
  through in-source tests.
- The screen uses sm source split's fields: base files come from GitHub's raw host at the base commit. A file the split
  can't match (3 Rust rows, the patch does not fit the fetched file) drops at the screen as split_base_file, fail closed.
  At prep the split runs again on the prepared tree.
- Leak hits keep the literal rule (any hit drops) and are reported by kind: own_package when a dependency cache file
  belongs to a package the repository publishes (its repository name, github.com/<repo>, or a name owned.sh reads from the
  tree's Cargo.toml, package.json, go.mod, pom.xml or .csproj files), other_package for any other cache (cargo registry,
  cargo git, the Rust standard library source, Go module cache, node_modules, Maven, Gradle, NuGet), and not_cache.

## P2b: session images, the session CLI and the end-to-end stub session

- image.ts builds one image per session. It runs a build container from the unit's runtime image id with the entrypoint
  cleared and the build script as its command: the image's repo_dir removed, the prepared tree volume (stripped, one
  commit) copied in, git clean -fd as a guard (prep already cleans untracked files in sh/rewrite.sh; ignored files stay),
  then for A3 the /qa install's home copied into /root, and for a follow-on the first stage's patch committed as the
  second commit (sh/followon.sh, after a git update-index --refresh, since the copy changes every file's stat data).
  The container is committed with the runtime image's own command, work dir and user, and its entrypoint only when the
  runtime has one; a committed entrypoint that is not the runtime's is refused (E_SM_INFRA_GAP). The image is pinned by
  id. The session sees only the top layer, so the image's original repository and history never reach it (the e2e
  checks the original base commit is absent). sessionManifest writes the one-row tg-images.v1 manifest real_agent's U4
  image check reads.
- run.ts runs one session: the image, a Harbor run copy whose task.toml names the session tag as its prebuilt
  docker_image (so Harbor runs the pinned image itself and builds nothing), task.json (repo_dir, commits, head, scope =
  unit scope.dir), an empty arm tar, Harbor with real_agent in SM mode on ledger u4 with every provider key unset, then
  sm-session.v1 from real_agent's files. A first stage's instruction.md holds no issue text; the follow-on's holds
  issue.md. Opus runs on the anthropic route. Sol and particle-1 run on the openrouter route as
  anthropic/openai/gpt-6.1-sol and anthropic/particle-ai/particle-1: Harbor drops the leading anthropic/, so Claude Code sends
  the OpenRouter id the slot allows, and the proxy pins the price row's provider with allow_fallbacks false.
- CLI: gstack-evals outcome sm session plan and sm session run. The driver serves an SM stage with
  gstack-evals outcome serve --stage <item>=<model>@<arm>,<arm>.
- e2e.ts (keyless, P5 reruns it): bun lanes/outcome-skills/statemachines/e2e.ts --unit <unit dir> --harbor <bin> [--keep].
  It runs each session through gstack-evals outcome sm session run in a child process, as a paid run does, so its own
  process keeps serving the driver's control plane and the stub (run.ts calls Harbor with spawnSync).

## First-stage scorer (score.ts, P3a)

`gstack-evals outcome sm score first --unit <dir> (--session <session.json> | --patch <file> --cell <name>) --out <file>`
scores one change as section 7 reads and writes sm-outcome.v1. Steps, in order:

1. Extraction: the session's snapshot patch (real_agent's working tree against base, untracked files included) split per
   file by extractChange, which e2e.ts also uses. Binary files are listed and left out. An unsafe path makes the change
   one that won't apply.
2. Readings. Protected test and build configuration is never applied in either reading, whether edited, deleted or new
   (logged, and listed in deps_changed). An existing test file (isTestPath: one of the unit's test.patch files, or a path
   that matches the language's test-file convention, whatever its extension) goes back to base in strict and stays in
   adapted. In a file with in-source test modules (TEST_MODULES, the frozen detector, unchanged), strict puts each test
   module back to the base file's module of the same name, drops a test module the arm added and puts back one the arm
   removed; the arm's edits outside test modules stay. New files that are not protected apply in both. Every exclusion is
   in the record's excluded list with its rule and reading.
3. The fix's tests: test.patch, then fix-tests.patch, one patch per hunk under its file header, each applied with
   git apply --3way after the arm's tree is staged. A hunk that still conflicts is a gap for that reading,
   E_SM_TEST_PATCH_CONFLICT. three_way counts the hunks git merged by falling back to the three-way merge.
4. Runs: the unit's rebuild, test and print commands on a fresh copy, hardened, then the dataset parser in its sandbox.
5. Rules (decide): fixed when every fail-to-pass id passes; broke when any stable id does not pass, or a new test fails in
   all three runs. A build failure (a rebuild command that exits non-zero, a stopped run, or a log that does not parse)
   misses every test. A new test is an id the run reports that the unit's known ids (one base and one fixed oracle run,
   cached in the unit dir as oracle-ids.json) do not hold. A tree with a new test gets three runs.
6. Two more runs when the outcome rests on 2 tests or fewer: the fail-to-pass ids when the first run fixes, plus the
   stable ids that fail in it. Each of those takes its majority over the three runs.
7. Outcomes clean_fix, fix_broke, no_fix, no_fix_broke. An empty change scores no fix and not broke without a run
   (--run-empty runs it anyway, for the dry run).
8. A change that won't apply is read and split once more from the session's pinned patch file; if it still fails, both
   readings score no fix with E_SM_APPLY_FAILED.

Adapted falls back to the strict result, with the reason recorded, when an added line in the adapted change holds a skip
marker, when a stable id is absent from every adapted run (a build failure counts as absent), or when the adapted change
won't apply. When the adapted change equals the strict one, adapted is the strict result (same_tree).

### Frozen per-language lists for scoring (frozen at this commit)

The lists in "Frozen per-language lists" above are the scorer's lists, frozen at this commit, with one addition:
isTestPath (langs.ts) matches the test-file conventions on the whole path, whatever the extension.

| List | Where the post fixes it | What the build chose |
|---|---|---|
| Test-file conventions | Section 7 step 2 names "the dataset's test patterns plus each language's conventions"; the contents are left to the build | TEST_PATH, plus each unit's test.patch files |
| Protected test and build configuration | Section 7 step 2 and section 9 name conftest, build scripts and runner configs; the list is left to the build | PROTECTED, starting from real-outcome's PROTECT_ERE |
| Skip markers | Section 7 step 2: "a frozen per-language list"; contents left to the build | SKIP_MARKERS |
| In-source test-module detector | Section 7 names Rust's #[cfg(test)] modules and leaves other languages to the build | TEST_MODULES: Rust only (P1b) |

Sources for the conventions: the Cargo book (tests/ and benches/ targets, #[cfg(test)] unit tests, #[ignore]); Maven's
standard directory layout (src/test) and Surefire and Failsafe's default includes (*Test, *Tests, *IT); Go's testing
package (*_test.go, t.Skip, t.SkipNow, t.Skipf); Jest's default testMatch (__tests__, .test., .spec.) and the Jest and
Mocha skip forms (.skip, xit, xdescribe, .todo); pytest's discovery rules (test_*.py, *_test.py, conftest.py) and its
skip and xfail marks, plus unittest.skip; GoogleTest (DISABLED_ prefix, GTEST_SKIP); JUnit 5 @Disabled and
Assumptions, JUnit 4 @Ignore and Assume; NUnit [Ignore] and xUnit Skip =; each ecosystem's build and lock files.

### Scorer readings

- Module restore: strict reads "the arm's hunks inside test modules are dropped" as each test module going back to its
  base text, matched by mod name. Diff alignment makes hunk placement unreliable (git can fold a source edit and a new
  test module into one hunk), so the scorer places modules, not hunks.
- Skip markers are checked on every added line of the adapted change, not only on test code.
- A new test is "failed" only when the parser's status is fail in all three runs; skip or absent is not failed.
- A conflict on the adapted tree is a gap for the adapted reading; strict keeps its own result.
- The extraction retry reads the session's pinned patch file again; scoring never reaches back into a session container.
- Docker tests (tests/outcome-skills/sm-score-docker.test.ts) need GSTACK_EVALS_DOCKER=1 and two images:
  SM_SCORE_RUST_IMAGE (cargo and git) and SM_SCORE_GO_IMAGE (go, python3 and git). The dry-run units' runtime images serve.

## Follow-on scorer (followon.ts) and drift (drift.ts), P3b

`gstack-evals outcome sm score followon` scores one follow-on replicate (section 8) and writes sm-followon.v1;
`--summary` turns a dir of those records (and the first stages' sm-outcome.v1 records) into per-tree scores.

- **Trees.** S0 is the stripped base tree. A1 and S2 are that tree with the first stage's whole tree patch committed as
  commit two by sh/followon.sh, after the same git clean the session image runs, so the scored tree is the tree the
  follow-on session saw. The follow-on's own change (real_agent's snapshot against that tree's head) is read under
  section 7's strict reading with the start tree as the base (score.ts readings): hunks on existing test files and
  protected configuration stay at the start tree, hunks inside in-source test modules are dropped, new test files are
  applied unless protected. Binary files are listed and left out; unsafe paths fail the apply.
- **Start sets.** On S0 the base stable set. On A1 and S2: three runs of the unit's commands on the tree with the oracle's
  base-run patches (oracle.ts basePatches, one function for both) merged hunk by hunk with git apply --3way; the start
  set is the ids that pass in all three. On an unchanged base tree that merge gives what the oracle's plain git apply
  gives. The base-run patches are test.patch and, for a split fix, fix-tests.patch (section 7 step 3: the fix's in-source
  tests go everywhere test.patch goes), so the stable set and every start set are computed with them. The start set is cached in the file `--start` names, pinned by the tree
  patch's sha256 and the tree's head.
- **Scores.** The fix's tests merge as in section 7 step 3 (score.ts fixTestHunks and mergeTests, the same code the
  first-stage scorer runs), then one run (score.ts scoringRun). Incremental: every fail-to-pass id passes and every
  start-set id passes. End to end: every fail-to-pass id passes and every base stable id passes. An id that did not
  pass (failed, skipped, missing) fails, and a build failure fails every id, as in section 7's broke rule.
- **Strict and whole.** The strict score (record field strict, copied to the top-level incremental, end_to_end,
  f2p_pass, start_failed and stable_failed) is the verdict. The whole change, with nothing restored, is scored beside it
  on its own volume (whole, whole_run) and never sets a verdict. When the two readings are the same text, strict's run
  is reused and whole_note says so. A whole change that won't apply scores 0 on both; whole is null only when it was not
  scored (a gap, or its own fix-test merge conflict, named in whole_note).
- **Gaps and the keep rule.** A follow-on test-patch conflict on the strict tree, a start-set conflict (gap
  start_set_conflict on every replicate of the tree; start.gap keeps the code), a first stage's strict test-patch
  conflict (gap first_stage_test_patch_conflict), or a follow-on session that ended upstream or infra on its second
  attempt is a gap and removes the replicate. The summary counts the two literal choices on their own
  (removed_first_test_patch_conflict, removed_start_set_conflict) apart from other first-stage gaps. A tree is kept with at least 2 of 3
  replicates scored; its score is the mean over them; pass3 is set only when all 3 scored. A first stage's gap (its
  session gap, or its strict reading's test-patch conflict) removes its tree. A first stage whose strict outcome is clean
  fix marks the tree as an inherited fix, counted per arm for the sensitivity reading.
- **Drift.** When a fail-to-pass id fails on A1 or S2, drift.ts reads the run's log (stderr and the print output) with the
  language's frozen drift forms. A named identifier that occurs (git grep -w, fixed string) in the source files of commit
  two's parent and in none of commit two's is a drift id; any drift id makes the follow-on a drift case. Both scores have
  already failed; the count goes to the sensitivity reading. S0 never drifts.
- **Secondaries.** Cost (spent and unknown micros), turns and wall time from the follow-on's session record; files
  changed; and the paths the first stage created that any tool input in the follow-on's transcript names.

### Drift forms (frozen at this commit, langs.ts DRIFT_FORMS)

| Language | Forms (the captured identifier) | Source |
|---|---|---|
| Rust | E0425, E0412, E0422, E0531, E0405, E0433 cannot find or failed to resolve; cannot find macro; E0432 unresolved import; E0599 no method or item named; E0609 no field; E0560 no field named | rustc error index |
| Go | undefined: x (and pkg.X); has no field or method F; unknown field F in struct literal | go/types error codes UndeclaredName, UndeclaredImportedName, MissingFieldOrMethod, MissingLitField |
| Java | cannot find symbol with its symbol: line; package a.b does not exist | javac compiler.properties cant.resolve, doesnt.exist |
| C, C++ | GCC: was not declared in this scope, undeclared, implicit declaration of function (an error), has no member named, is not a member of, has not been declared, does not name a type, unknown type name; Clang: use of undeclared identifier, call to undeclared function, no member or type named | GCC diagnostics, Clang DiagnosticSemaKinds.td |
| C# | CS0103, CS0117, CS1061, CS0246, CS0234 | C# compiler error reference |
| JS | ReferenceError x is not defined; TypeError x is not a function (Babel's (0, _m.x) form); the requested module does not provide an export named x; Cannot find module (last path segment) | V8 message-template.h, Node and Jest module resolution |
| TypeScript | the JS forms, and tsc 2304, 2552, 2339, 2551, 2305, 2614, 2724, 2307 | TypeScript diagnosticMessages.json |
| Python | ImportError cannot import name; ModuleNotFoundError (last dotted segment); AttributeError has no attribute; NameError name is not defined | CPython import.c, object.c, moduleobject.c, ceval.c |

Not forms, by design: Python's "object is not callable" and JS's "Cannot read properties of undefined (reading 'x')"
name a type or the next property, never the missing identifier; a C implicit declaration that is only a warning is not
a compiler error.

### Follow-on readings

- The follow-on's change is scored under section 7's strict reading against the start tree (section 8 item 3, a
  ruling): a follow-on that edits a start-set test to pass loses that edit. The whole change is reported beside it only.
  No adapted reading runs on follow-ons.
- A start-set merge conflict is a gap for every replicate on that tree (section 6 and section 8 item 2).
- A first stage's strict test-patch conflict removes that tree's follow-ons and is counted on its own (section 6).
- Drift is decided when any fail-to-pass id fails and at least one drift id is named (the design's reading of "fail only
  because").

## Packets, the R78 check and keyless secondaries (packets.ts, secondary.ts), P4b

No model is called here. packets.ts writes packet files and reads replies; a separate paid step under sm-labels and
sm-judges sends them. Every packet holds only what its reader may see, and its id is a digest of that content. A key file
beside it maps the id back to unit, model, cell and judge. `assertBlind` refuses a packet whose text names the session's
model or unit (E_SM_PACKET).

- Labeller packet (section 3): the issue, fix.patch as published, and the fix's tests (test.patch, plus fix-tests.patch
  when prep wrote one), the two frozen questions and section 2's state-shaped definition word for word. Never an arm's
  output, never the unit id. Answer: one JSON object `{defect, state_shaped, reason}`, each "yes" or "no".
- Labels: eligible only when both labellers say defect; state or other when both agree, else unclear. Cohen's kappa on
  both questions over units where both answers read. `combineLabels` returns `stratum` as "state", "other" or
  "unclear", the field analysis.ts `buildInput` reads from `unit.labels.stratum`.
- Judge packet (section 10): the folder's file list and the first-stage diff cut at 1,500 lines with `cut` set, plus
  at most 8 hunks, largest first. Never the issue, the fix, the arm, the model or the session. Judge by session model:
  GPT-6 Astra for claude-opus-5-5; Opus 5.5 for openai/gpt-6.1-sol and particle-ai/particle-1.
- Answer reader: the reply must be one bare JSON object with exactly the frozen keys; scores are whole numbers from -2 to
  2; every listed hunk id answered once with "yes" or "no". Anything else (a code fence, extra text, an extra key, a
  missing hunk) is E_SM_JUDGE_ANSWER and counts as missing.
- Stock diffs: three per judge after every 50th diff, built from one file of that diff's unit by keyless transforms, sent
  as ordinary judge packets (the key marks them). A judge scoring above 0 on more than 10% of its stock diffs is flagged. The R78 check runs on a labelled set (labelledSet, plantDiffs; `sm packets labelled`): 8 units in draw order, each giving three known-bad plants (UX, DX, AX) and its three stock diffs as known-neutral, 48 items that both judges grade. r78Check reports each judge's catch and false-fail rates with counts and kappa per axis over the first 60 real diffs beside them; judgedVerdict lets a judged verdict stand only at kappa 0.6 or more. The real diffs' agreement share is one descriptive line. `sm packets r78-price` prices the sm-judges calls against the item cap.
- R78 check: diffs graded by both judges in seeded order; the first 60, then one more at a time until 40 are labelled or
  supply ends (`short`). Kappa per axis; a judged difference on an axis counts only at kappa 0.6 or more, else it reads
  "judge failed its check".
- Secondaries (`sm secondary`, sm-secondary.v1): found it, found but not fixed, what it changed, and later-fix overlap
  when given `--clone`, a local clone of the public repository. The clone comes from git over HTTPS, never a paid or
  keyed API: `git clone --filter=blob:none <repo url>` then `git fetch origin pull/<n>/head:refs/sm/pull-<n>`. Check
  the host's robots.txt and terms before the first clone and record it in the build log.

### Frozen lists for P4 (frozen at this commit, langs.ts and packets.ts)

- State constructs, counted per added line of a source file: enum (Rust, Java, C#, TypeScript `enum Name`; C and C++
  `enum`; Go `iota`; JavaScript `Object.freeze({`; Python a class over Enum, IntEnum, StrEnum, Flag or IntFlag),
  sealed (Rust `mod sealed` or `trait Sealed`; Java `sealed class|interface` or `permits`; C# `abstract record`; Go
  a lone `isName()` marker method), union (TypeScript string-literal type unions, Python `Literal["`, C++
  `std::variant<`), table (any language: a line that defines or assigns a name containing "transition").
- Fix-title words, case-insensitive, whole words: fix, fixes, fixed, fixing, bugfix, hotfix, bug, regression, crash,
  panic, resolve, resolves, resolved (`fixTitleDigest()` pins the pattern).
- Generated marks: a `linguist-generated` attribute in any .gitattributes on the path (a later or deeper line wins), or
  "generated" or "do not edit" as words on one of the first 5 lines, case-insensitive.
- Stock transforms: comments and whitespace only (a blank line and a "Reviewed." comment above each function, or one
  comment at the top when none is found); rename only (the file's first local declared with four or more characters,
  renamed to name plus "Value", or "_value" in Python and Rust, everywhere in the file); logging (one log call per
  function: Go log.Println, Rust eprintln!, Java System.err.println, C fprintf(stderr), C++ std::cerr, C#
  System.Console.Error.WriteLine, JS and TS console.log, Python print). A kind the file cannot give is skipped and
  printed as none.

### P4b readings (literal; each one that can move a reported number is marked)

- Hunk: a run of consecutive changed lines, as git diff -U0 writes it, whatever context the patch carries. Positions are
  base-file lines; a run that only adds lines sits between two base lines (k + 0.5). "Within N lines" is a gap of N or
  less between the two spans. The real fix's hunks are all of fix.patch, in-source test hunks included. (Reported.)
- Found but not fixed uses the strict reading's outcome: fixed means clean_fix or fix_broke.
- What it changed: lines are added plus removed; a file is outside the folder when its old or new path lies outside the
  unit's scope dir (null before scope is set); test files follow the test-file conventions or test.patch; build files
  are the protected test and build configuration list; state constructs count per file as added matches minus removed
  matches, never below 0, in source files only.
- Later-fix overlap: non-merge commits on the clone's HEAD (the default branch), committer date after the base commit's
  and at most 120 days later, subject matching the fix words. The target fix's commits are those on refs/sm/pull-<n>
  past the base and any commit whose message names #<n>. A hunk is outside the real fix when it shares no line with a
  fix hunk; hunks in every file count, test files included. Each candidate's runs map to base lines through the diff
  from the base to the candidate's parent. (Exploratory; reported.)
- UX, DX and AX are not defined in the post; the judge text reads them as the effect on people who use the software,
  developers who work in the code, and AI agents that work in the code. (Reported.)
- Hunks listed for the "real defect" question are the 8 largest wholly inside the 1,500-line cut, so a hunk past the cut
  is never asked about. Size is added plus removed lines; ties keep diff order. (Reported.)
- Stock diffs come after each judge's 50th, 100th, ... diff, from the unit of that diff. "Scores a stock diff above 0"
  means above 0 on any of the three axes; a malformed stock answer counts as above 0 (fail closed). (Reported.)
- R78 labels: a diff is labelled when both answers read and give the same sign on all three axes. Kappa is per axis on
  signs (-, 0, +) over every used diff where both answers read. Catch rate is the share of bad-labelled diffs a judge
  scores below 0; false-fail rate the share of good-labelled diffs it scores below 0. On this label set both judges
  agree by construction, so the literal rates are 1 and 0 (open point). (Reported.)

## The paid sender for packets (send.ts, GST-1959)

`sm packets send --item sm-labels|sm-judges --run <id> --packets <dir> --out <dir>` is the paid step for the packets
above. It leases its own item through the ledger (openLease, settleLease) and sends each call through an in-process
metering proxy, one slot per call and one call at a time, as the product-value meter and noloss judge-run do. The stage driver cannot serve
these two items: neither names a session model, sm-labels pays for two models, and a driver stage takes one model and
counts sessions.

- Readers. Labels: GPT-6 Astra and Opus 5.5 each answer every label packet. Judges: each key's frozen judge (Astra for
  Opus runs, Opus for Sol and particle-1 runs), plus every judge whose queue (queue-astra.json, queue-opus.json, from
  `sm packets queue`) names the packet; an R78 labelled item must be in both queues. Two sessions with the same diff and
  files share one packet: every key that names it is checked, and each of their judges reads it once. Each judge sends its queue in
  order, then its other packets by id, and the two readers take turns.
- The prompt is the packet's body as JSON, the exact text its id digests. A packet that no longer matches its digest, or
  has no key, is refused before anything is opened (E_SM_PACKET). The routes and request shape are judge.ts's
  (JUDGE_ROUTE, judgeRequest, JUDGE_REASONING_EFFORT on OpenAI), with a 1,500-token output cap.
- Each call reserves its packet's byte worst case by the proxy's own formula (prices.ts priceRequest and
  reservationMicros): request bytes plus 64 at the input rate (Astra's $12.50/M cache-write rate, Opus's $4/M), plus
  1,500 output tokens. The sender prices the exact body the proxy forwards, so it adds service_tier and inference_geo
  itself. Before each call the lease's room (reserved, less held) must hold that worst case. A call that does not fit
  cap-stops the item before it is sent: the stop is written to the record, nothing more is sent, and the lease closes
  with cap_stop, so the ledger admits no new lease (CAP_STOP).
- Before any call: no recorded cap is E_LEDGER_MISSING; a cap-stopped item, or one with nothing left, is CAP_STOP; an
  item bound to another run is E_ITEM_BOUND.
- After each call settles, its reported usage (input with cache reads and writes, output with reasoning) is checked
  against the prereg's bound of 20,000 input and 1,500 output tokens (R78_PRICE_BOUND). A call past it halts the item
  before the next send (E_SM_USAGE_HALT): a halt line in replies.jsonl names the meter, packet, reader and usage, and
  every later send is refused until `--lift-halt <meter>` records the Captain's ruling. The halted call keeps its reply
  and is never sent again. A call the proxy refuses at its own allowance check halts the item the same way
  (E_ALLOWANCE). The slot's allowance is one worst case, so the proxy does not resend a charged 5xx.
- Each reply goes through the readers `sm packets read` uses. A malformed one is recorded (E_SM_JUDGE_ANSWER) with its
  raw text and never asked again: the prereg allows no re-ask.
- An upstream failure is recorded (UPSTREAM) and stops the send. The lease settles by the ledger's rules: a 4xx releases
  the reservation, a lost send keeps it as unknown, and a 5xx without usage is charged. A failure with no answer and
  nothing charged ($0 spent, $0 unknown and nothing lost in transit, such as a provider 401) is recorded as uncharged.
  A rerun with the same --run and --out sends calls with no record, and sends each uncharged call at most once more: if
  that resend also fails uncharged, the call is recorded as a gap that keeps the first failure's code (first_code) and
  is never sent again. A charged failure is never resent, and a call that a stopped send sent but never recorded is
  recorded as lost and never sent again.
- One live send holds an item on a host, through a lock file beside the record, so a second send on it is refused
  (E_USAGE) and never settles a lease the live one meters. Each send line is fsynced before its call goes out. A send
  whose replies.jsonl does not name every call the ledger holds for the item and run (another --out, or a file emptied
  or cut short) is refused before it recovers, settles or sends anything (E_USAGE).
- --out holds replies.jsonl (a send line with the call's worst case before each call, then one reply line per call with
  packet, reader, model, outcome, code, why, answer, raw and micros, plus a halt line for each halt and a lift line for
  each ruling), raw/<reader>/<packet>.txt and each lease's proxy journal.


## Stale report readings (reports.ts, testrun.ts)

- Every run (oracle base and fixed runs, sample runs, scoring runs) goes through runTests, so the rule lives there. Before
  the rebuild, the run script deletes every file the print command's report paths name under the repo dir that git does
  not track. After the test commands it moves aside every file they name that is older than the run's start mark, and
  writes the counts on an SM_REPORTS line. File times tick coarsely, so a file as new as the mark counts as fresh.
- Report directories (pre-data build change, 2026-11-09): prep's git clean removes the untracked report directory the
  image's own runs left, and in 89 of the 1,077 cached rows the test command tees or redirects its report into a
  relative directory it never makes (casey__just-2785: `... | tee reports/test-output.log`, then `cat
  reports/test-output.log`). tee could not open the file, so every run read no_fresh_report. Between the stale deletion
  and the mark, the run script now creates, as the run user (uid 10001 in hardened mode), each missing parent directory
  of a report path that both the print command reads and a test command writes by tee or redirection (reports.ts
  reportDirs). It skips a directory the test command makes itself, an absolute path, a .. step, a glob in the
  directory (a glob file name gives its parent) and any path whose nearest existing parent resolves outside the tree.
  Each created directory gets an SM_MKDIR line; the run's created_dirs and the oracle record list them.
- Commands read no stdin (pre-data build change, 2026-11-09): the run script reaches bash -s on stdin, so a command
  that reads stdin (ant, mvn, gradle, npx) swallowed the rest of the script and later commands never ran
  (gwtproject__gwt-10054: ant test never ran). 219 of the 1,077 cached rows start one of those tools, all 160 Java rows
  among them. Every rebuild, test and print command now reads its stdin from /dev/null.
- Absolute report paths inside the tree (pre-data build change, 2026-11-09): reportDirs takes the unit's repo dir and
  work dir, and reads a print path that is absolute (or absolute through the print command's cd) and under the repo dir
  as its tree-relative path. It matches it against what the test commands write after their own cd's, with the same
  rules: no directory the test command makes or cd's into, no .. step, no glob in the directory, nothing outside the
  tree. 9 more of the 1,077 cached rows are selected (oauth2-proxy__oauth2-proxy-2524: `cd /testbed && go test -v -json
  ./... > reports/results.json`, then `cat /testbed/reports/results.json`).
- A /tmp the run user can write (pre-data build change, 2026-11-09): a tmpfs mounted with no mode copies the image's
  /tmp mode, which is 0755 root in some images (both vercel__turborepo units), so uid 10001 could not make the mark dir
  and every run read fresh=0. The hardened /tmp tmpfs now mounts rw,exec,size=4g,mode=1777. A run that still cannot
  make its mark dir writes SM_INFRA no_mark_dir and stops; TestRun.infra and the oracle run record carry it, the unit's
  verdict is E_SM_INFRA_GAP (neither kept nor dropped, counted per language on its own line, rerun on the next pass;
  fill lists it under infra, and sm oracle exits with E_SM_INFRA_GAP while any remain, so that fill is not final),
  and a scoring run with it fails as E_SM_INFRA_GAP instead of scoring broke. The pstack eval (#305) shares this
  container code.
- Bare Go test names (pre-data build change, 2026-11-09, goids.ts): for a Go unit the oracle maps each top-level test
  func to the package dirs whose *_test.go files define it (the tree plus the base patches; vendor, testdata and dirs
  starting with . or _ left out). judge drops a bare id (no package path; a subtest counts as its top-level test) whose
  name more than one dir defines from the fail-to-pass and stable sets and lists it under ambiguous; the oracle record
  keeps the dropped fail-to-pass ids and the dropped stable count. A unit whose every fail-to-pass id goes this way drops
  as E_SM_AMBIGUOUS_TEST; a scan that runs and fails in the image drops as E_SM_TEST_SCAN, and one that never finishes
  is E_SM_INFRA_GAP. Package-qualified ids are never touched.
- A volume inside the repo dir (pre-data build change, 2026-11-09, image.ts): a runtime image that declares a VOLUME
  under repo_dir (0xERR0R__blocky-2016: /testbed/mnt_tmp) gets an anonymous volume there in the build container, and
  rm -rf failed on it. The build now reads the mount points under repo_dir from /proc/self/mountinfo, deletes around
  them, keeps them out of git clean (as sh/rewrite.sh does), and stops with SM_MOUNT_NOT_EMPTY under E_SM_HISTORY when
  one still holds files after the copy. The build container goes with docker rm -f -v, and harbor run gets --delete
  (compose down --volumes), so neither a failed build nor a session leaves an anonymous volume. With no such mount the
  build runs the same commands as before.
- The same mount point in the follow-on start tree (pre-data build change, 2026-11-10, followon.ts startTree): its git
  clean runs in a runtime-image container, failed on a VOLUME under repo_dir (cthackers__adm-zip-559: /testbed/mnt_tmp)
  and stopped every follow-on on the unit with E_SM_HISTORY. It now keeps those mount points out of git clean the same
  way. With no such mount it runs the same commands as before.
- The same mount point in the strip (pre-data build change, 2026-11-10, sh/rewrite.sh): a strip path that is a mount
  point, or holds one, failed the history rewrite with E_SM_HISTORY. The mount point now stays and everything around it
  goes, so a VOLUME at a .claude dir leaves an empty .claude dir, which the build's empty-mount check still covers. No
  unit in the oracle run failed there; with no such mount the strip removes the same paths as before.
- Allowance stops end as limits (pre-data build fix, 2026-11-10, session.ts sessionEnd, stage.ts, real_agent.py): the
  proxy's meter keeps the distinct codes of its refusals, the driver's close answer carries them as refusals, and
  real-summary.json's proxy block copies them with unknown_micros. sessionEnd reads both, so an E_ALLOWANCE stop ends
  limit_allowance and is scored as section 6 says, not retried as upstream. Refusals that are not an array of codes, or
  an unknown_micros that is not a number, refuse the session (E_SM_ARM). The session record's unknown_micros is the
  close answer's, not 0. No rule changes.
- Only the allowance check ends a session as a limit (pre-data build fix, 2026-11-10, metering-proxy.ts, stage.ts,
  real_agent.py, session.ts): E_ALLOWANCE also names the proxy's route, model, body, output-cap and price refusals, so
  the meter now counts allowance_stops, the refusals at the slot's allowance check alone. The close answer and
  real-summary.json carry it, and endKind reads only that count. No refusal's code, status or body changes. A proxy
  block with no field set, which real_agent writes when no close answer came, ends the session as infra and the
  session keeps its record, instead of being refused. An allowance_stops that is not a number refuses the session
  (E_SM_ARM). No rule changes.
- A close whose proxy finalize failed halts its item (pre-data build change, 2026-11-10, session.ts sessionEnd,
  driver/stage.ts; #314 review note 8; the Captain accepted, GSTA-2): a close answer with finalized false still ends
  limit_allowance when it names an allowance stop (allowance_stops above 0), so a real stop is scored as is and never
  spends again. The driver's own close path can't report one: when finalize fails, allowance_stops is null, so the
  session ends infra. The driver then halts that SM line item before any retry: it writes a halt line with the session
  id and its proxy journal path to the run's sessions.jsonl, opens no more sessions on the item (E_SM_FINALIZE_HALT,
  HTTP 423), settles its lease, exits 2, and refuses a lease on the item at the next launch. The Captain reads the
  journal and rules; a launch with --lift-halt <session id> records the lift and serves the item again. Section 6's
  retry rule is unchanged: the halt only delays the retry until that ruling. With today's in-process proxy, finalize
  can't fail, so this path does not fire.
- A3's home is installed at /root (pre-data build change, 2026-11-10, arms/qa-install.sh, image.ts qaHomeCopy; #314
  review note 4; the Captain accepted, GSTA-2): qa-install.sh runs the clone, checkout and `./setup --host claude` in a
  throwaway container (buildpack-deps trixie with Bun 1.4.4, both by digest) with the home dir mounted at /root, no API
  key, no drive and no host environment, and removes the container afterwards. Every link, text file and compiled binary
  then names /root, so the image build copies the home as written, owned by root as a root install's is (cp -a had kept
  the host user's uid, so git refused the gstack checkout, the session check read no commit and refused every A3
  session); the old rewrite of host-dir links and text is gone (no other arm used it). The copy fails closed (E_SM_ARM) on a link that leaves the home, a file that names the host
  dir, or a binary that names gstack's checkout under any home but /root, and names the files. At the pin, a home
  installed on the host left the host dir in gstack's browse binary, which resolves its root from it. The session
  record keeps the copied home's file digest (qa_home_sha256). A3 still has no Chromium (GSTACK_SKIP_PLAYWRIGHT=1), so
  /qa's browser steps can't run in it.
- No home CLAUDE.md in A3 (pre-data build fix, 2026-11-10, real_agent.py; #314 review note 5): A3's home check took any
  path the image build listed, so a /root/.claude/CLAUDE.md the install wrote would pass. It is now refused in A3 as in
  every no-gstack arm, even when listed. No rule changes.
- Two /qa caps above section 17's $50 (deviation, 2026-11-10, items.ts, recorded before any outcome data; the Captain
  accepted, GSTA-2): an item opens a session only while its remaining cap covers the allowance, so n sessions at mean m
  with k concurrent need (n - k) * m + k * allowance. At the /qa line's planning price (twice section 16's first-stage
  price with VMs: $6.16 on Opus and Sol, $0.76 on particle-1), k = 1 and E1's doubled allowance, sm-qa-admit needs
  4 * 6.16 + 30 = $54.64 and sm-qa-particle 59 * 0.76 + 6 = $50.84. They are $55 and $51; the $6 comes from the line's
  reserve, so the line stays $1,100 (items $986, crew use $60 counted). No other cap moves.
- A containment check runs in every session image before any session (pre-data build change, 2026-11-10, contain.ts,
  sh/contain.sh, run.ts, cli.ts `sm contain`, dryrun.ts; the Captain's scope, GSTA-2, after GEVA-503 found the upstream
  fix behind git tags past the base in 12 of 40 SWE-rebench images). Inside the first-stage, A3 and follow-on images, as
  the session sees them: (a) HEAD is the recorded head and every ref (peeled tags, branches, remotes, notes, replace refs,
  the stash), FETCH_HEAD, ORIG_HEAD, MERGE_HEAD, CHERRY_PICK_HEAD and each packed-refs line names it or an ancestor;
  (b) every commit object in the store does too; (c) no alternates (file or GIT_ALTERNATE_OBJECT_DIRECTORIES), no
  .gitmodules or nested .git under the repo, and no other git object store on the filesystem but proc and sys, except
  A3's gstack checkout when its HEAD is the /qa pin; (d) no file outside the repo, /tmp included, holds a hidden test
  name (a FAIL_TO_PASS leaf name the base tree never names, as a whole word) or a marker (a line of 30 code points or
  more that test.patch or fix-tests.patch adds and no base file holds, anywhere in a line, so a patch file's added lines
  count). A hit keeps the path and the sha256, never the text; compressed archives outside the repo are listed by path,
  never failed. Any failure is E_SM_CONTAIN: the unit halts before any session and is not dropped, so section 4's drop
  rule is unchanged; the fix goes into the image or setup step, test-first, and a repin waits for the next part.
  `sm contain --unit <dir>` runs it before sm-admit and writes one run-record line per image and check.
- Paid packet sends reserve each call's byte worst case, one call at a time (pre-data build change, 2026-11-10, send.ts,
  accepted by GSTA-2): the proxy reserves input at one token per request byte, so at the prereg's per-call price a
  request over 15,936 bytes (Astra) or 19,936 bytes (Opus) could never be sent, and a full judge packet is larger (1,500
  lines of 40 bytes is about 65 KB). Each label and judge call now reserves its packet's byte worst case by the proxy's
  own formula (about $0.89 for Astra and $0.29 for Opus on that packet) and runs alone, and a call that does not fit the
  item's remaining cap cap-stops the item before it is sent. After each call settles, its reported usage is checked
  against the prereg's bound of 20,000 input and 1,500 output tokens, and a call past it halts the item for the
  Captain's ruling (E_SM_USAGE_HALT). The pricing bound (R78_PRICE_BOUND, r78Price), the $160.05 plan and the $180
  sm-judges cap do not change.
- Stock diffs build before a judge sees them (pre-data build fix, 2026-11-10, GST-1959, packets.ts buildStock and
  stockDiffs, cli.ts): `sm packets stock` (now with --unit-dir) and `sm packets labelled` (now with unit_dir in each
  spec entry) apply each stock diff to a fresh copy of the unit's prepared tree in its runtime image and run the unit's
  rebuild commands there, plus a compile of the file for Python and node --check for JavaScript. The same commands run
  first on the tree without the diff (the control). A kind that does not apply, or fails a command its control passes,
  is none, and so is every kind of a unit whose control passes no command. stock-build-<unit>.json (stock-build.json for
  the labelled set) records why, and the labelled set skips such a unit, as section 10 says. The transforms now read
  each file's code with multi-line strings, block comments and Go runes blanked, and a JavaScript or TypeScript
  template's ${...} read as code; put a C or C++ header after the
  includes before the first line of code, and take an include guard only when its #endif ends the file; put a Python
  log line after a docstring's whole statement; leave out a Python keyword argument on any line of a call and a Java or
  C# anonymous class whose constructor call nests parentheses; and rename a local only where every use sits in the
  scope of a declaration of that name. No rule changes.
- A rename stays inside its declaration's scope (pre-data build fix, 2026-11-11, GST-1959, packets.ts renameOnly): a
  local declared in a for, if, while, switch, catch, using or try header now has the scope of the block or statement
  that header opens, wherever its line starts, so a use after a block that closes on the header's own line, or after the
  header's block inside an outer block opened on that line, is no longer renamed. A Go local's scope ends at the next
  case of its switch or select and starts after its statement's real end, a Rust let's scope starts after its whole
  statement, and a C++ declaration that is a braceless if or loop body has no scope past it. In Python, a use in a class
  body or on a nested def's or a lambda's parameters blocks the rename, since a class attribute is no local and a caller
  can pass a parameter by name. No rule changes.
- JavaScript and TypeScript renames keep their bindings (pre-data build fix, 2026-11-11, GST-1959, bindcheck.ts,
  packets.ts renameOnly): the build check gives these files only node --check or the unit's rebuild, which a rename that
  changes behavior can pass. The rename-only diff now stands only when TypeScript's own binder, from the pinned
  typescript package, reads the file before and after the rename and finds each renamed name a local variable, every
  reference to it renamed, and the same bindings on both sides. So a destructured property, an object method or class
  field in the local's scope, a regular expression, JSX text, a function that takes its name from the local, a parameter
  property, and a file with a with statement or a direct eval all give no rename. The check runs keyless on the harness,
  in a child process, and a check that cannot run stops the step (E_SM_PACKET). No rule changes.
- A failed tree copy leaves no volume (pre-data build fix, 2026-11-11, GST-1959, packets.ts buildStock): the build check
  now makes its copy volume inside the try that drops it, so a copy that fails after the volume exists no longer leaves
  it behind.
- The stock commands check their unit (pre-data build fix, 2026-11-11, GST-1959, cli.ts): sm packets stock refuses an
  --unit that is not the unit in --unit-dir, and sm packets labelled refuses a unit listed twice or a spec entry whose
  unit_dir holds another unit (E_USAGE), so no stock-build record or judge key names a unit other than the one its diffs
  came from.
- A run builds nothing when a rebuild command exits non-zero (rebuild_failed), when the print command reads report paths
  and none of them holds a fresh file (no_fresh_report), or when a stale file could not be moved aside (stale_unhidden).
  The parser does not run then, and the run parses nothing. A test command's own exit never sets it. Every one of the
  1,077 cached rows has a separate rebuild step, so rebuild_failed can apply to every unit.
- Report paths are read literally from the print command: a glob given to cat or to a for loop, expanded by bash from the
  directory the command cd's to, or a find with its root, -L, depth and -path or -name tests, one path per -o branch. A
  print command with any other reader is unreadable: it gets no paths, the run touches no file and keeps the old reading.
- A print command is a log when every path it reads is a plain file the unit's own rebuild or test commands write by
  redirection or tee; otherwise it reads report files. Counts over the 1,077 cached rows (report / log / unreadable): c
  32 / 78 / 1, cpp 71 / 71 / 0, cs 120 / 9 / 7, go 14 / 124 / 0, java 141 / 1 / 18, js 30 / 78 / 0, rust 7 / 162 / 2,
  ts 29 / 81 / 1. In all, 444 read report files, 604 only a log and 29 cannot be read literally (xargs with another
  command, sed, awk, perl, bash -lc, ls, a find -exec of sh).
- The oracle records the reading on the unit (reports) and each run's stale_deleted, stale_refused and built_nothing. A
  scoring run that built nothing is a build failure.
- Rebuild rule (c): the oracle runs every tree with the rule off, then sets oracle.rebuild_rule from the fixed runs:
  applies when the rebuild exits 0 on every fixed run (fixed_rebuild_exits records each), and then a base run whose
  rebuild failed parses nothing. Scoring refuses a unit without the flag. An exempt unit keeps the freshness check and the
  fail-to-pass rule. Stale binary guard, as read here: each fixed run whose rebuild failed passes every kept fail-to-pass
  id and wrote a report newer than its start mark, and no kept id passes on any base run. A print command read as having
  no report paths shows no fresh output, so an exempt unit with one drops. A unit that fails the guard drops as
  E_SM_ORACLE_UNSTABLE with a reason starting "stale binary guard".

