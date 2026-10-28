# Statistics kit

Vendored from [harness-evals](https://github.com/garrytan/harness-evals) at `70cb3d0197b7` (`runner/stats/`), which took it unchanged from [gbrain-evals](https://github.com/garrytan/gbrain-evals) v0.10.128 (`6999ebc9`, `eval/runner/stats/`). MIT, Copyright (c) 2026 Garry Tan. Each file names its source in its header and marks every gstack-evals change with `gstack-evals:`.

- `gates.ts`: a preregistered comparison family with four gate kinds. `exact` is a correctness or safety assertion that one violating item fails. `noninferiority` passes only when the candidate is shown to be no worse than the baseline by more than a stated tolerance. `superiority` passes only when it is shown to beat the baseline by more than a preregistered minimum effect. `exploratory` is reported with intervals and never decides. Holm correction covers the confirmatory comparisons.
- `paired.ts`: paired observations, a cluster-aware bootstrap (a resampled cluster carries every item inside it), the exact sign-flip test over clusters (enumerated up to 20 clusters, Monte Carlo above), exact McNemar, Holm, one-sided p-values and a power note.
- `rows.ts`: row to observation mapping and eligibility.
- `exact.ts`, `fixed-sequence.ts`: helpers.

In gstack-evals the cluster is the task: the trials of one task are one cluster, and across-task claims use task-clustered intervals and sign-flip tests.

gstack-evals adds two files of its own:

- `task-means.ts` (fix 2): `pairTaskMeans` averages each arm's valid trials within a task and pairs the arms by task, so arms with different trial counts (5 cheap-rung trials against 3 Opus trials) compare with every task weighted equally. A task with too few valid trials in an arm is a missing cell, handled by the preregistered rule (`drop_task` or `refuse`, with a minimum and an optional cap on the share dropped). `pairTrials` keeps trial-level pairing and is the only place that needs equal trials. Feed either pairing to `clusteredPairedDelta`.
- `sizing.ts`: tasks needed for a one-sided paired test, the SD a number of tasks covers, the minimum detectable difference, the per-task SD of a difference of task means, and plan v3.2's decision 9 table and Amendment A2's release-split table as code. Counts round up; the plan's printed tables round to the nearest task (wiki finding 2026-10-28-gsta-14-sizing-tables-round-to-nearest).

## Fix: no p-value when nothing varies

Upstream, when every paired difference was zero, the bootstrap held the single draw 0 and `nonInferiorityP` returned p = 0 for any tolerance above 0. So two arms that both passed every task "showed" non-inferiority at any size, 3 tasks or 300. Now the bootstrap is empty in that case, `nonInferiorityP` and `superiorityP` return null, and `gates.ts` reports the comparison inconclusive with the reason. Identical results on every task usually mean a ceiling or a floor, which the plan treats as not attempted, never as shown. A one-draw bootstrap no longer short-cuts to p = 0 or 1. Tests: `tests/stats/fixes.test.ts`.

## Two more changes to `gates.ts`

Capy's review of this vendoring found two places where `gates.ts` broke its own documented rules, so they are fixed here too:

- An exploratory comparison that cannot pair (for example, a dashboard metric missing from both runs) is marked blocked on its own. Upstream it blocked the whole family, which could hide an exact safety failure behind a dashboard.
- The family's cluster minimum is checked before an interval can fail a comparison. Upstream, two clusters could fail a non-inferiority or superiority comparison although the minimum promises an inconclusive result.
