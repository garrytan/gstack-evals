# Mutation scorer (O2)

Build step O2 of the outcome-per-skill plan v3 (wiki/plans/2026-11-03-geva-225-outcome-per-skill-plan, sections 3, 10 and 13). It scores how well the tests an agent wrote pin the code it wrote: the mutation score of the agent's added or changed tests, on its own final tree, against mutants of the source lines its diff changed. It is a secondary measure for family G and is compared only within one language.

No model runs here. Scoring is keyless and every scoring step runs with no network.

## Pinned tools

| Language | Tool | Version | Licence | Restriction to the diff |
|---|---|---|---|---|
| Rust | cargo-mutants | 27.1.0 | MIT | changed lines (`--in-diff`) |
| TypeScript | StrykerJS (`@stryker-mutator/core` with `@stryker-mutator/vitest-runner`) | 10.1.1 | Apache-2.0 | changed lines (`mutate` ranges) |
| Python | mutmut | 3.8.1 | BSD-3-Clause | functions holding a changed line |
| Go | go-mutesting (avito-tech fork) | v0.0.0-20261002081621-9ce5f731e321 | MIT | changed files |

pins.ts holds this table and the record carries it. Each tool image under images/ installs exactly these bytes: a FROM by digest, git at an exact Debian version, `cargo install --locked`, a Go module the checksum database pins, `npm ci` from images/node-package-lock.json, and wheels hash-checked against images/python-requirements.txt. Each image records the licence its package metadata states, and the Docker test checks it against the table. None of these tools is vendored; NOTICE.md lists them.

## How a tree is scored

The tree is a git patch against a project image that holds the repository at its starting tree with its dependencies, as the verifier's task image does. `scoreTree()` in run.ts:

1. Builds a scorer image on the project image with no network: it copies the tool in. Python installs mutmut's wheels into a folder of their own that is appended to `sys.path`, so the project's own packages, pytest included, still win. TypeScript links the project's vitest into Stryker's folder, so the runner uses the project's version and config.
2. Prepares a fresh volume as root with no network: copies the repository, keeps the changed files as they were, applies the patch as the verifier does, and reads back the changed files and the file list.
3. Finds the test units the patch added or changed: a unit counts when an added line falls inside it, or when a removed line fell inside it before the patch and some of its lines remain. So a test deleted whole credits none of its neighbours. Units are pytest functions and methods, Go `TestXxx` functions, Rust `#[test]` functions, and TypeScript `test()` and `it()` calls, found in code only: text inside strings, comments, templates and regex literals is never taken for a unit or a block boundary.
4. Runs those units on the tree. A unit that fails, errors, is skipped or never runs is dropped and counted. If the runner itself did not run them (it exits outside its pass and fail codes, or its report names none of the selected units), the tree is a tool error. Go runs the units twice in one container, as the first two mutant runs in go-mutesting's one container will, and keeps only units that pass both times. It then runs the passing units once more, each package's together, as each mutant run will, and drops a package's units if its run fails: go-mutesting has no unmutated control of its own, so a package that fails anyway or a test that passes only once would turn every mutant into a kill. A test that passes twice and fails later is not caught.
5. Lists the tool's mutants within its restriction, samples at most 200 by the order of sha256(seed, id) with the frozen seed, and runs them against the passing units only.
6. Scores.
7. Removes its volumes and hands the work folder, which keeps each step's logs, back to the caller's user.

Every step after the prepare runs as uid 10001 with no network, no capabilities, a read-only root, a tmpfs /tmp and CPU, memory and process limits. The scorer's inputs to the tools (configs, exec scripts, the sample, Stryker's rewritten test files) sit in a folder mounted read-only at /in. The containers write only to /out, and the host reads /out through regular files only: a symlink anywhere on the path, a non-file, or a file over 64 MiB counts as missing. The tools need no network: Go runs with `GOPROXY=off` and `GOTOOLCHAIN=local`, Cargo with `CARGO_NET_OFFLINE=true`.

How each tool runs only the agent's tests: pytest node ids in mutmut's test selection; `go test -run` with the exact names, per package; `cargo test` limited to the targets that may hold the agent's tests (`--test <name>` for an integration test; `--bins` for a binary's own files or a crate with no library; otherwise `--lib`, plus `--bins` when the crate also has binaries, since either may declare the module) with `-- --exact` and the full test paths, across the workspace; and for Stryker, every other `test()` or `it()` call in the agent's test files is turned into `.skip` in the scorer's copy, because the vitest runner clears any name filter for its dry run.

mutmut's work tree gets a copy of every top-level entry of the repository, so unchanged modules the code imports are there; only the functions that hold a changed line are mutated. Rust tests inside a binary (src/main.rs, src/bin/<name>.rs, src/bin/<name>/) carry the binary's own module paths; src/bin.rs is a library module named bin and keeps that path.

How each tool's sample runs: cargo-mutants with `-F` naming the sampled mutants exactly; mutmut with the sampled mutant names; go-mutesting through an exec script that runs only sampled mutants and records each outcome, checked against go-mutesting's own score line; Stryker with each sampled mutant's exact location as a `mutate` range, keeping only the sampled mutants from its report.

## Scoring rules (plan v3 section 3)

- Score = killed / (killed + survived). Timeouts and tool errors are excluded and counted.
- A mutant that no selected test covers survived (Stryker's NoCoverage, mutmut's "no tests").
- Errors are mutants that do not build or that the tool could not judge: cargo-mutants' unviable, Stryker's CompileError and RuntimeError, mutmut's segfault, suspicious, skipped and not checked, and a Go mutant that fails to build.
- `no-tests`: the patch added or changed no test unit. Score 0.
- `no-passing-tests`: every added or changed unit failed on the tree. Score 0, so failing tests never beat writing none.
- A test runner that exits outside its pass and fail codes (0 or 1; cargo's 0 or 101), or whose report names none of the selected units, makes the tree a `tool-error`, never `no-passing-tests`, and it counts in the tool-error rate (GSTA-2, 2026-11-04).
- `no-mutants`: the tool made no mutant within its restriction, for example a patch that changes only tests. No score; excluded and counted.
- `no-scorable-mutants`: every sampled mutant timed out or errored. No score; excluded and counted.
- `tool-error`: the patch did not apply, a container failed, or the tool failed. No score; counted. `summary()` reports the tool-error rate the G admission's instrument check reads. A patch that names an absolute path, or a path with an empty, `.` or `..` segment, is refused before anything runs.

The transplant reading, when a gold patch is given, applies gold to the starting tree, copies in the agent's changed test files, and runs the same units against gold's changed-line mutants with the same rules. It ran when the record's transplant status is `scored` or `no-scorable-mutants`; `no-passing-tests` means the agent's tests ran on gold and failed there, and `tool-error` that the runner could not run them at all, most often because they import a name gold lacks. Tests that sit inside source files (Rust inline test modules) cannot move, and read `not-transplantable`. `summary()` counts how often the transplant ran.

## Tests

tests/outcome-skills/mutation.test.ts runs without Docker: the patch reader, the unit finders, the frozen sample, the rules, the tool output readers and the image pins. tests/outcome-skills/mutation-docker.test.ts runs the real pinned tools on fixture repositories with `GSTACK_EVALS_DOCKER=1`. In each language, each image records its pinned licence, tests that pin the behaviour score at least 0.75 with each tool's exact killed and survived counts, and tests that only call the code score at most 0.25 on a sample of the same mutants. Python also covers the rules above in both directions, the transplant reading, a patch that does not apply, a patch that names a path outside the repository, a pytest that cannot start, changed code that imports an unchanged top-level module, and symlinks planted in the output folder. TypeScript keeps a pre-existing test in the agent's test file out and reads a vitest whose config fails to load as a tool error. Rust gets the same verdicts on three runs of one tree, scores tests inside a binary target, reads inline tests as `not-transplantable` and keeps a same-named test in a target the agent did not touch out. Go scores 0 when a TestMain fails the package and drops a test that fails on its second run. Building the tool images needs the network once.

## Limits

- Python 3.11 to 3.14 on x86_64 Linux only: coverage 7.17.1, a mutmut dependency, has no wheel for 3.10. A project on another Python gets a scorer image build failure.
- The project's vitest must be 2.0 or newer, the vitest runner's peer range. vitest-runner and Stryker need `ps`; images/node-ps.sh stands in when the image has no procps.
- A sampled Stryker mutant whose location holds other mutants, such as a block statement, runs those too; only the sampled ones are scored.
- Rust doc tests and tests outside `--tests` targets are not units. TypeScript units are found by their `test(` or `it(` call sites; tests built by helpers that wrap those calls are not found.
- Go runs `go test -vet=off`, so a mutant that only breaks a vet check is judged by the tests.
- cargo-mutants builds each of its two jobs in its own copy of the tree under the 4 GiB tmpfs /tmp, with its own target folder; sharing one made parallel jobs test each other's builds. A crate whose builds outgrow /tmp reads as a tool error.
- If an unchanged Rust test has the same full path as one of the agent's tests in a target the scorer runs, the tree is a tool error, because their runs can't be told apart.
- Under the runner rule above, an agent test file that does not build or collect (a syntax error, a missing import) reads as a tool error rather than as failing tests, because the runner reports none of its units.
- The agent's tests run in the same container as the tool, so a test written to tamper with the tool's own records could fake outcomes. The scorer keeps its inputs read-only and never follows the containers' output on the host, but it does not defend the tool's records inside the container.
- CI's rig tier does not run the Docker test yet; run it with `GSTACK_EVALS_DOCKER=1 bun test tests/outcome-skills`.
