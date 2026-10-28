---
id: 2026-10-28-gsta-14-u2-stats-prereg-handoff
kind: handoff
title: "U2 handoff: the statistics and preregistration kit"
summary: What U2 landed (vendored stats kit with its fixes, per-task means, sizing tables, preregistration checker and format, admission check), how later units call it, and what is still open.
author: GSTA-14
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
links:
  - https://github.com/garrytan/gstack-evals/pull/8
  - https://github.com/garrytan/gstack-evals/pull/11
  - src/runner/stats/README.md
  - src/runner/prereg/format.ts
  - 2026-10-28-gsta-14-sizing-tables-round-to-nearest
  - 2026-10-28-gsta-3-v1-build-breakdown
---

# U2 handoff: the statistics and preregistration kit

U2 is milestone M0's statistics and preregistration unit. It landed as three stacked pull requests: the vendored kit with the first fix (#8), per-task means and the sizing tables (#11), and the preregistration checker and format (the third).

## What landed

- **Vendored kit.** `src/runner/stats/` from harness-evals at `70cb3d0197b7` (from gbrain-evals `6999ebc9`): cluster bootstrap, exact sign-flip over clusters (enumerated up to 20, Monte Carlo above), Holm, exact McNemar, the power note and the four-gate family in `gates.ts`. `src/runner/prereg/prereg.ts`: attestation against origin and the commit-order check. Both keep their upstream tests.
- **Fix 1.** With every paired difference zero, `nonInferiorityP` returned p = 0. Now there is no p-value and the gate says why.
- **Fix 2.** `pairTaskMeans` in `task-means.ts` compares on per-task means, so 5 cheap-rung trials pair with 3 Opus trials, and a preregistered missing-cell rule (`min_trials`, `drop_task` or `refuse`, optional `max_dropped_share`) replaces the refusal of mismatched ids. `pairTrials` keeps trial-level pairing and its equal-trials check.
- **Sizing.** `sizing.ts` gives tasks needed, covered SD, minimum detectable difference and per-task SD, plus decision 9's table and Amendment A2's table as Markdown. Counts round up; see the rounding finding.
- **Preregistration format.** `format.ts` defines prereg.json and `preregistrationProblems`. The format covers every section the three quick-look preregistrations wrote, and `tests/prereg/fixtures/` holds each one as prereg.json. It adds what a runner reads: seed and resamples, pairing, the missing-cell rule, gates, Holm families, power checks, funding and the OpenRouter peg. It refuses unfilled placeholders, sealed sets that list task ids, trial pairing with unequal trials, decisions in an exploratory preregistration, confirmatory gates without a passing power check (with the Holm split), parity without a ceiling rule, paid runs without the owner's words, and open-weight models without the peg.
- **Admission.** `admissionProblems` (GSTA-8's CI plan, decision 3, approved) refuses a program-funded paid preregistration unless the ledger's record of its line item has `admission: "required"`. `loadPreregistration(path, item)` runs both checks.

## How later units use it

- **U6, the verdict engine.** Per model: `pairTaskMeans(before, after, rule, tasks)`, then `clusteredPairedDelta(pairs, { seed, draws })` for the interval and the one-sided sign-flip p (`p_less` is WORSE's test); `nonInferiorityP(stats, margin, "higher")` for `--margin`, where null means not attempted; `powerNote` for the detectable effect; `holmAdjusted` across models or families. The pooled rerun round is just more trials per task.
- **U15 and U17.** `decision9Table(sds)` and `releaseSplitTable(sds)` at the estimated SD; `taskDiffSd(between, [{ rate, trials }, ...])` builds the SD from its parts.
- **U11, U16 and later preregistrations.** Write prereg.json beside PREREGISTRATION.md, run `preregistrationProblems` before committing, and `attestPreregistration` plus `admissionProblems` before the first paid call.
- **U4.** `admissionProblems` reads only `{ item, admission }` from the item record, so the ledger's record needs those two fields under those names. No type was added to src/types.ts.

## Changes to vendored behaviour

Fix 1; an exploratory comparison that cannot pair no longer blocks its family; the cluster minimum is checked before an interval can fail a comparison; and prereg.ts lost its command-line block, whose stderr lines had no reason code. The first three came from Capy's review of #8. harness-evals and gbrain-evals still carry the original code.

## Open

- The percentile bootstrap is generous at 5 to 12 task clusters (run 2's review, finding native-7). Fix 1 does not change that. U6 chooses Lane A's non-inferiority test; a sign-flip test shifted by the margin is one conservative option.
- Only the all-zero case is fixed. When every task moves by the same nonzero amount, the bootstrap still has no spread.
- The missing-cell rule works per comparison. A family-wide complete-case rule means filtering rows to the common tasks first.
- No command yet. The `plan` command (v1.1) is the entry point, and `loadManifest` reads docs/benchmarks/preregistrations.json, while the quick-look preregistrations live in wiki/plans/. CI wiring is GSTA-8's units.
- The model policy (no Sonnet, newest generation) is not part of this check; it belongs to U7's policy file in preflight.
