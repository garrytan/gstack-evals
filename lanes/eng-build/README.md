# Eng-review build read

The lane for the eng-review build read (prereg 2026-11-11-geva-522-eng-review-build-read-prereg): Opus 5.5 builds each change from a plan that each arm reviewed, and the real later fix's tests grade the build, with no judge.

- types.ts: the shared types every module codes against.
- frozen.ts: every frozen number, with the comparison size as one parameter.
- errors.ts: the lane's refusal, a reason code from src/errors/codes.ts and a message.
- recipes.ts: the frozen recipe per ecosystem (Go, Node with npm, pnpm, yarn or bun, Python with pip or uv, Rust),
  the case classifier and the verifier runner each recipe picks.
- screen.ts: the candidate screen. It runs a mined candidate's tests at base, at the merge and on each fix, and
  says whether it qualifies or which code drops it.
- unit.ts: the unit builder. It writes a real-outcome task directory with eb.json (schema eng-build.unit.v1), one
  restore set for the merge's own tests (tests/), one for base (base/) and one per later fix (aftermath/<item>/),
  builds the image, grades each real tree 3 times and applies the fail-to-pass rule, the anchors and the base split.
  Every tree builds cold, and a real tree's product hashes are recorded so a recount can refuse a changed tree.
- leak.ts: checks that no line the fix added is in the unit's exact image, and (sessionLeakCheck) in the session image
  a builder runs in.
- contain.ts: the unit stage's containment gates, run on every unit before the pilot (`eb units --repos`). It runs the
  leak check on the session image, then opens the real sandbox sidecar on the unit's build tree with the build
  launcher's own trial spec. The origin must hold the base branch at base and nothing else: no tag or other ref, no
  object beyond those reachable from base, nothing unreachable. The gh stub must answer nothing about any pull request
  or issue in any state, by list, REST path or search. A failure drops the unit with E_EB_LEAK, step leak,
  sidecar-origin or sidecar-gh.
- note.ts: the statement note writer and its audit (prompts/note-writer.md, prompts/note-audit.md). The model call
  is injected, so tests make none.
- catch.ts: real-bug catch. A build's own new and changed test files move onto the unit's real merged tree and its
  real fixed tree, with product files at the real content (the pfchecks transplant, under the test-region rule). A B
  item is caught when one of the build's cases fails at assertion level in all 3 merged runs and passes in all 3
  fixed runs. It also counts the real trees the build's tests compiled and ran on. A file the rule can't split drops
  with E_EB_TRANSPLANT. The dry run's "transplant catch" and "transplant no-catch" seams live here.
- coverage.ts: changed-line coverage. The share of the build's changed product lines its own tests execute, with go
  test -coverprofile, pytest-cov, c8 or cargo-llvm-cov in a coverage image layered on the unit image. A tree the tool
  gives no data for is unscored.
- recount.ts: regrades built units in the verifier's sandbox and prints counts only. Under 16 clean units it exits 2
  with E_EB_FEW_UNITS.
- pipeline.ts: the run's stages (screen, units, notes, reviews and bundles, builds, grading) behind the eb
  subcommands. Each paid stage runs under one lease on its item and stops if the lease is still open after it.
- launch.ts: the paid stages' real launchers: the product-value meter for notes, the Docker rig for reviews, and the
  outcome driver with Harbor and real_agent for builds.
- session-image.ts: the build session's image. It layers Claude Code at the review stage's pin (docker/host-cli.json
  and the checksum line in docker/trial.Dockerfile) and a pinned Node on the unit image, which keeps its id for the
  grader. It adds no gstack and no drive, and it sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. It copies each in-project
  dependency folder the base commit does not track (Node's node_modules) from the unit image's project to the same
  path under /work/repo. The launcher mounts each one as a volume over the build tree, so the session runs the tests
  offline, lists it in task.json's exclude so real_agent leaves it out of the patch, and removes the empty mountpoints
  after the session. Python, Go and Rust keep their dependencies outside the project, so they need nothing.
- e2e.ts: the build stage's paid path end to end, keyless. It builds one Go fixture unit and runs it through the build
  launcher, the outcome driver on a temporary ledger, Harbor, real_agent, the sandbox sidecar and Claude Code against a
  stub upstream. Then it grades the built tree. `bun lanes/eng-build/e2e.ts --harbor <harbor bin>` prints one PASS or
  FAIL line per check. `--fixture node` runs the Node (vitest) fixture instead and also checks that the recipe's test
  command runs at /work/repo and that the patch holds no file from node_modules.
- dryrun.ts, dryrun-seams.ts, dryrun-pipeline.ts: `gstack-evals eb dryrun`. Seams that need Docker run under
  GSTACK_EVALS_DOCKER=1 and print SKIP otherwise, which is never a pass.

## Run steps for the build items

The build launcher runs on the outcome driver, and the driver serves only an item that belongs to a program. Before the
first build, record the program's envelope once. Then init each build item into it with the one skill the build stage
charges, eb-build (ledger.ts EB_PROGRAM and EB_BUILD_SKILL). The driver reserves an item's whole remaining cap when it
opens a lease, so the envelope must hold every build item's plan cap:

```
gstack-evals ledger envelope --program geva-522-eb --cap 5880 --skill-cap 5880 --skills eb-build --credit-rate 1 --words <owner's words> --by <who> --source <ref>
gstack-evals ledger init --item eb-builds-opus --cap 2150 --admission required --program geva-522-eb --skills eb-build --words <owner's words> --by <who> --source <ref>
gstack-evals ledger init --item eb-stage-sol --cap 2400 --admission required --program geva-522-eb --skills eb-build --words <owner's words> --by <who> --source <ref>
gstack-evals ledger init --item eb-stage-particle --cap 1330 --admission required --program geva-522-eb --skills eb-build --words <owner's words> --by <who> --source <ref>
```

An item's program is fixed at init, so these steps come before any lease on the item. The run host needs Docker, the
review stage's trial image (`gstack-evals doctor`), and Harbor at quick/laneb/runner/vm-bootstrap.sh's pin. It serves the
sandbox sidecar (`gstack-evals real sandbox serve`) and passes its control URL as `eb build --sidecar`. Run e2e.ts once
on that host before the first paid build.

Harness constants (not frozen by the prereg): NOTE_MAX_TOKENS in launch.ts caps each note writer and audit answer at
4000 output tokens. The prereg fixes the note as one paragraph and sets no token count.

Limits: Go and Python need the project at the repository root. An image holds at most two toolchains, and the
second must be Rust or Node. The base check runs the merge's own test files that exist at base, or else the
nearest test files at base.
