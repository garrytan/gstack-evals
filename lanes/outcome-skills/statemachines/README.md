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
published, then the dataset parser in its sandbox over the print output. Only the parser's PASSED counts as a pass.

- Keep: every fail-to-pass test does not pass in all three base runs and passes in all three fixed runs, else
  E_SM_ORACLE_UNSTABLE. Stable set: every id the parser reports PASSED in all six runs; an empty one is
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
- The /qa pin (sha, version and install command) is recorded at freeze in sm.pins.qa. Until then qa:told refuses to
  build a turn, and arms/qa-install.sh refuses a missing sha or command.
- The proxy routes: Opus on anthropic, Sol (openai/gpt-6.1-sol) and particle-1 on OpenRouter's Messages route, as Claude
  Code arms used before.

Driver. An SM stage is { item, arm (its label), model, arms }: one lease per model's item serves every SM arm it lists,
at each arm's allowance for that model, and its proxy runs with refuseServerTools on (E_PROXY_SERVER_TOOL before
pricing). G stages are unchanged. An SM item carries the skill "qa" for qa:told and "sm" for the other arms (P4's items).

real_agent's family SM mode (arm in the registry's "sm" block): one turn, no sidecar, no origin and no gh stub, so the
tree keeps its one-commit or two-commit history; egress allows only the proxy. Before any session opens it checks, in the
container, the commit count and head the task names, that no CLAUDE.md, CLAUDE.local.md, AGENTS.md or .claude is in the
tree (E_SM_STRIP), and that a no-gstack home holds no ~/.claude/skills, ~/.claude/CLAUDE.md, ~/.local/share/gstack, ~/.capy
or ~/.gstack, while A3's home holds gstack at the /qa pin. Nobody answers: AskUserQuestion gets section 6's fixed line,
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
