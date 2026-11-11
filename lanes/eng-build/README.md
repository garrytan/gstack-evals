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
- leak.ts: checks that no line the fix added is in the unit's exact image.
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
- dryrun.ts, dryrun-seams.ts, dryrun-pipeline.ts: `gstack-evals eb dryrun`. Seams that need Docker run under
  GSTACK_EVALS_DOCKER=1 and print SKIP otherwise, which is never a pass.

Harness constants (not frozen by the prereg): NOTE_MAX_TOKENS in launch.ts caps each note writer and audit answer at
4000 output tokens. The prereg fixes the note as one paragraph and sets no token count.

Limits: Go and Python need the project at the repository root. An image holds at most two toolchains, and the
second must be Rust or Node. The base check runs the merge's own test files that exist at base, or else the
nearest test files at base.
