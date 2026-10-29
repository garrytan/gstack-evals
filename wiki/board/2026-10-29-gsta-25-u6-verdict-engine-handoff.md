---
id: 2026-10-29-gsta-25-u6-verdict-engine-handoff
kind: handoff
title: "U6 handoff: the verdict engine"
summary: What U6 landed for Lane A (M1a), the seams U7, U9, U10, U20 and U21 code against, the readings it took of interface v0.5, and what is still open.
author: GSTA-25
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-29
status: open
links:
  - https://github.com/garrytan/gstack-evals/pull/40
  - https://github.com/garrytan/gstack-evals/pull/41
  - https://github.com/garrytan/gstack-evals/pull/42
  - 2026-10-29-gsta-25-skill-eval-interface-v0-5
  - src/skill-eval/verdict/
  - schema/verdict.schema.json
---

# U6 handoff: the verdict engine

U6 is the M1a unit that turns graded trials into verdict.json and an exit code. It landed in four stacked pull requests: #40 (interface v0.5 and trial grading), #41 (gates, rerun stage, margin test, exit code), #42 (lock re-derivation, gate removals, error record) and the fourth, stacked on #42 (verdict.json, its schema and this post). No paid call was made.

## What landed

- **Grading** (`grade.ts`). A non-interactive task grades the final answer; an interactive task grades every user-visible assistant turn (interface v0.5). Patterns use U5's skill-diet rules, the check must pass, a judge's not done fails and unknown leaves the run ungraded, and judges never touch a safety task. An arm failure scores 0 on pass; any other metric takes its preregistered `failure_value` or blocks its comparison.
- **Decision** (`gates.ts`). gstack's floor on the before arm (REGRESSION, SAFETY, WORSE), the additions on the old copies (MISS, DEGRADED, the sign-flip WORSE, SAFETY_BREAK with FLAKY_SAFETY, UNOPENED, NONE_MATCHES, BROKEN_TASK, NOT_MEASURABLE), ceiling after every arm has run, NOT_NONINFERIOR and MARGIN_NOT_ATTEMPTED, calibration codes, the runner's stops, and the exit code 3, then 1, then 2, then 0.
- **Rerun stage** (`rerun.ts`). `rerunPlan` after round 1, pooled rounds, FLAKY, and the two-stage rule's simulated false-negative rate at each model's minimum detectable difference.
- **Lock checks** (`lock.ts`). Rows re-derived from the before copy (LOCK_DRIFT on any mismatch) and UNCOVERED_GATE_REMOVAL with coverage gaps.
- **Files** (`verdict.ts`, `error-record.ts`). verdict.json as a superset of gstack's contract file, `schema/verdict.schema.json` 1.0.0 (with `#/$defs/error`), and the versioned error record with secret scrubbing, its stderr mirror and the stdout fallback.

## The decisions it carries

1. Statistics: `pairTaskMeans`, then `clusteredPairedDelta` (`p_less` is WORSE's test); `marginShiftedSignFlipP` for `--margin`, null meaning not attempted; `powerNote` at one-sided 0.05 and 80% power for the minimum detectable difference; `holmAdjusted` across every requested model for the margin p-values, an unattempted model entering at p = 1. No bootstrap bound.
2. Failed runs: `failedRunScore` and `metricValue` in grade.ts.
3. The rig block: `RigBlock` in src/types.ts and `#/$defs/rig` in the schema, `{recipe_sha256}` plus any fields U20 adds; the engine writes what it is handed, null today.
4. Lock rows: `rederiveLock` in lock.ts.
5. Interactive grading: `scoreTurns` and `gradeScope` in grade.ts, and interface v0.5.

## For the next units

- **U7 (CLI).** Build a `VerdictInput` (tasks from `verdictTasks(loadContract(...))`, models, arms, records, calibration, stops, and the gate evidence when the run has a lock), call `rerunPlan` after round 1 and run every task in every compared arm for the models it names, then `decide`, `buildVerdict` with a `VerdictContext`, and `writeVerdict`. A `VerdictInputError` is a caller defect: map it to E_INTERNAL with `errorRecord` and `writeErrorRecord`. `DEFAULT_OPTIONS` holds the seed, 10,000 draws, 2,000 simulations and the missing-cell rule `{min_trials: 1, on_missing: "drop_task"}`; a preregistration can set others, and the verdict records them under `effective`.
- **U9 and U10.** Write one `TrialRecord` (src/types.ts) per finished trial. `turns` is the user-visible assistant turns in order, the last being the final answer: each text the main agent shows and each AskUserQuestion's question with its option labels, with subagent output left out. Record `check: null` only when the check did not run, since a check task without one is a missing cell. `opened`, `files_read` and `asked` feed UNOPENED and contract-line coverage. Calibration reports a `CalibrationResult` per model.
- **U20.** Fill `rig` through `VerdictContext.rig`; adding fields to the block needs no schema change.
- **U21.** The verdict's field list is `schema/verdict.schema.json`; a test keeps its top-level fields equal to what `buildVerdict` writes.

## Readings of the interface

These follow from v0.5's wording; each is a line of code to change if the Captain reads it otherwise.

- "Interactive" is the task's declared interactivity (sidecar `user` or `interactive: true`), which v1 runs only on Claude Code. Non-interactive tasks on Claude Code keep final-answer grading, as gstack's contract says.
- The contract's gates read the before arm, as their wording says ("before panel", "before's pass rate"); the additions read before and before2 pooled ("the old copies").
- SAFETY and SAFETY_BREAK fire together: SAFETY is the contract's name and SAFETY_BREAK marks it sticky.
- A red task is one REGRESSION or MISS names. A safety break alone does not trigger the rerun, since no rerun clears it, and WORSE alone does not either, since it names no task. A round 2 that lacks some task and arm can add losses but clears none.
- A model is at ceiling when its old copies passed every run. Without `--margin` that adds CEILING beside the gates, and with `--margin` it makes the model MARGIN_NOT_ATTEMPTED.
- With several models, the contract's `model` lists them comma-separated and its `arms` and `tasks` hold the first model's blocks; every model has its own block under `models`. A timeout or missing cell is null in a contract tasks array. The contract's UNCOVERED is the BROKEN_TASK warning.

## Left open

- The sign-flip WORSE is per model and not Holm-adjusted, since each model has its own verdict and adjusting would weaken loss detection. Decide whether a run-level family is wanted.
- The false-negative simulation models the pass-rate gates only (REGRESSION, MISS, SAFETY and both WORSE tests), with the same loss on every task, floored at 0.
- LOCK_DRIFT is U5's code, and its text names the files, not the re-derived rows. U5 may want to extend it.
- The default missing-cell rule drops a task only when a cell has no valid trial. A stricter preregistered minimum is a numbers call for the Captain.
