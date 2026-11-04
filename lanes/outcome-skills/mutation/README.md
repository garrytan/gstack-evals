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
2. Prepares a fresh volume as root with no network: copies the repository, applies the patch as the verifier does, and reads back the changed files and the file list.
3. Finds the test units the patch added or changed: a unit counts when a line the patch touched falls inside it. Units are pytest functions and methods, Go `TestXxx` functions, Rust `#[test]` functions, and TypeScript `test()` and `it()` calls.
4. Runs those units on the tree. A unit that fails, errors, is skipped or never runs is dropped and counted.
5. Lists the tool's mutants within its restriction, samples at most 200 by the order of sha256(seed, id) with the frozen seed, and runs them against the passing units only.
6. Scores.
7. Removes its volumes and hands the work folder, which keeps each step's logs, back to the caller's user.

Every step after the prepare runs as uid 10001 with no network, no capabilities, a read-only root, a tmpfs /tmp and CPU, memory and process limits. The tools need no network: Go runs with `GOPROXY=off` and `GOTOOLCHAIN=local`, Cargo with `CARGO_NET_OFFLINE=true`.

How each tool runs only the agent's tests: pytest node ids in mutmut's test selection; `go test -run` with the exact names, per package; `cargo test -- --exact` with the full test paths; and for Stryker, every other `test()` or `it()` call in the agent's test files is turned into `.skip` in the scorer's copy, because the vitest runner clears any name filter for its dry run.

How each tool's sample runs: cargo-mutants with `-F` naming the sampled mutants exactly; mutmut with the sampled mutant names; go-mutesting through an exec script that runs only sampled mutants and records each outcome, checked against go-mutesting's own score line; Stryker with each sampled mutant's exact location as a `mutate` range, keeping only the sampled mutants from its report.

## Scoring rules (plan v3 section 3)

- Score = killed / (killed + survived). Timeouts and tool errors are excluded and counted.
- A mutant that no selected test covers survived (Stryker's NoCoverage, mutmut's "no tests").
- Errors are mutants that do not build or that the tool could not judge: cargo-mutants' unviable, Stryker's CompileError and RuntimeError, mutmut's segfault, suspicious, skipped and not checked, and a Go mutant that fails to build.
- `no-tests`: the patch added or changed no test unit. Score 0.
- `no-passing-tests`: every added or changed unit failed on the tree. Score 0, so failing tests never beat writing none.
- `no-mutants`: the tool made no mutant within its restriction, for example a patch that changes only tests. No score; excluded and counted.
- `no-scorable-mutants`: every sampled mutant timed out or errored. No score; excluded and counted.
- `tool-error`: the patch did not apply, a container failed, or the tool failed. No score; counted. `summary()` reports the tool-error rate the G admission's instrument check reads.

The transplant reading, when a gold patch is given, applies gold to the starting tree, copies in the agent's changed test files, and runs the same units against gold's changed-line mutants with the same rules. It ran when the record's transplant status is `scored` or `no-scorable-mutants`; `no-passing-tests` means the agent's tests could not run unchanged on gold. Tests that sit inside source files (Rust inline test modules) cannot move, and read `not-transplantable`. `summary()` counts how often the transplant ran.

## Tests

tests/outcome-skills/mutation.test.ts runs without Docker: the patch reader, the unit finders, the frozen sample, the rules, the tool output readers and the image pins. tests/outcome-skills/mutation-docker.test.ts runs the real pinned tools on fixture repositories with `GSTACK_EVALS_DOCKER=1`: in each language, tests that pin the behaviour score at least 0.75 and tests that only call the code score at most 0.25 on a sample of the same mutants, plus the rules above in both directions. Building the tool images needs the network once.

## Limits

- Python 3.11 to 3.14 on x86_64 Linux only: coverage 7.17.1, a mutmut dependency, has no wheel for 3.10. A project on another Python gets a scorer image build failure.
- The project's vitest must be 2.0 or newer, the vitest runner's peer range. vitest-runner and Stryker need `ps`; images/node-ps.sh stands in when the image has no procps.
- A sampled Stryker mutant whose location holds other mutants, such as a block statement, runs those too; only the sampled ones are scored.
- Rust doc tests and tests outside `--tests` targets are not units. TypeScript units are found by their `test(` or `it(` call sites; tests built by helpers that wrap those calls are not found.
- Go runs `go test -vet=off`, so a mutant that only breaks a vet check is judged by the tests.
- CI's rig tier does not run the Docker test yet; run it with `GSTACK_EVALS_DOCKER=1 bun test tests/outcome-skills`.
