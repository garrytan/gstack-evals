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
- recount.ts: regrades built units in the verifier's sandbox and prints counts only. Under 16 clean units it exits 2
  with E_EB_FEW_UNITS.

Limits: Go and Python need the project at the repository root. An image holds at most two toolchains, and the
second must be Rust or Node. The base check runs the merge's own test files that exist at base, or else the
nearest test files at base. There is no lanes/eng-build/cli.ts yet, so `gstack-evals eb` still exits "not built yet".
