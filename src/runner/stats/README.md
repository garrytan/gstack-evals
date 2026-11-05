# Statistics kit

Vendored from [harness-evals](https://github.com/garrytan/harness-evals) at `70cb3d0197b7` (`runner/stats/`), which took it unchanged from [gbrain-evals](https://github.com/garrytan/gbrain-evals) v0.10.128 (`6999ebc9`, `eval/runner/stats/`). MIT, Copyright (c) 2026 Garry Tan. Each file names its source in its header and marks every gstack-evals change with `gstack-evals:`.

- `gates.ts`: a preregistered comparison family with four gate kinds. `exact` is a correctness or safety assertion that one violating item fails. `noninferiority` passes only when the candidate is shown to be no worse than the baseline by more than a stated tolerance. `superiority` passes only when the clustered sign-flip p is at or below alpha (after Holm) and the point estimate reaches the preregistered minimum effect. `exploratory` is reported with intervals and never decides. Holm correction covers the confirmatory comparisons.
- `paired.ts`: paired observations, a cluster-aware bootstrap (a resampled cluster carries every item inside it), the exact sign-flip test over clusters (enumerated up to 20 clusters, Monte Carlo above), exact McNemar, Holm, one-sided p-values and a power note.
- `rows.ts`: row to observation mapping and eligibility.
- `exact.ts`, `fixed-sequence.ts`: helpers.

In gstack-evals the cluster is the task: the trials of one task are one cluster, and across-task claims use task-clustered intervals and sign-flip tests.

gstack-evals adds three files of its own:

- `task-means.ts` (fix 2): `pairTaskMeans` averages each arm's valid trials within a task and pairs the arms by task, so arms with different trial counts (5 cheap-rung trials against 3 Opus trials) compare with every task weighted equally. A task with too few valid trials in an arm is a missing cell, handled by the preregistered rule (`drop_task` or `refuse`, with a minimum and an optional cap on the share dropped). `pairTrials` keeps trial-level pairing and is the only place that needs equal trials. Feed either pairing to `clusteredPairedDelta`.
- `sizing.ts`: tasks needed for a one-sided paired test, the SD a number of tasks covers, the minimum detectable difference, the per-task SD of a difference of task means, and plan v3.2's decision 9 table and Amendment A2's release-split table as code. Counts round up; the plan's printed tables round to the nearest task (wiki finding 2026-10-28-gsta-14-sizing-tables-round-to-nearest).
- `sign-flip.ts`: `marginShiftedSignFlipP`, the one-sided non-inferiority test the Captain chose for Lane A's `--margin`. It flips the signs of each task cluster's difference plus the margin, exact up to 20 clusters, and returns null when nothing varies or there are fewer than 2 clusters. `tests/stats/sign-flip.test.ts` reproduces the size table in the non-inferiority finding.

## Fix: no p-value when nothing varies

Upstream, when every paired difference was zero, the bootstrap held the single draw 0 and `nonInferiorityP` returned p = 0 for any tolerance above 0. So two arms that both passed every task "showed" non-inferiority at any size, 3 tasks or 300. Now the bootstrap is empty in that case, `nonInferiorityP` and `superiorityP` return null, and `gates.ts` reports the comparison inconclusive with the reason. Identical results on every task usually mean a ceiling or a floor, which the plan treats as not attempted, never as shown. A one-draw bootstrap no longer short-cuts to p = 0 or 1. Tests: `tests/stats/fixes.test.ts`.

## Two more changes to `gates.ts`

Capy's review of this vendoring found two places where `gates.ts` broke its own documented rules, so they are fixed here too:

- An exploratory comparison that cannot pair (for example, a dashboard metric missing from both runs) is marked blocked on its own. Upstream it blocked the whole family, which could hide an exact safety failure behind a dashboard.
- The family's cluster minimum is checked before an interval can fail a comparison. Upstream, two clusters could fail a non-inferiority or superiority comparison although the minimum promises an inconclusive result.

## Two changes from the ship review

The outside reviewer in gstack's /ship found two more, both reproduced. Tests: `tests/stats/fixes.test.ts`.

- `superiorityP` returned the share of bootstrap draws at or below the minimum effect. On few tasks that runs anti-conservative: ten tasks where B wins three and ties seven gave p = 0.027 and passed, while the exact sign-flip p is 0.125. Plan v3.2 says p-values are exact sign-flip tests over task clusters, and that a claimed improvement needs a one-sided sign-flip p below 0.05 and a point estimate of at least the minimum effect. `superiorityP` now returns that p, or 1 when the point estimate falls short.
- `rows.ts` scored a system failure with no metric value as 0. That is a miss on pass rate, but the best possible score on latency or cost, so a run that crashed on every task won on latency. A failure now scores 0 only when the comparison's direction is higher; otherwise it takes the comparison's preregistered `failure_value`, or its comparison is blocked. An exact gate may state its metric's `direction` too, so a crash on a pass metric still fails the gate with the item listed. On a `no_item_regression` assertion the two directions must agree, or the family is refused.

`nonInferiorityP` still uses the bootstrap bound, as plan v3.2's decision 9 states. Its level on few tasks is a separate finding: `wiki/board/2026-10-28-gsta-14-noninferiority-bootstrap-few-tasks.md`. Lane A's `--margin` uses `sign-flip.ts` instead.

## O4: the outcome-per-skill scorer

Build step O4 of the outcome-per-skill plan v3 (`wiki/plans/2026-11-03-geva-225-outcome-per-skill-plan`) adds seven files for the G family. Where the G admission prereg (`wiki/plans/2026-11-04-geva-262-g-family-admission-prereg`) or plan v3 froze a rule in a script, the file ports that script and its tests prove parity on the script's own output.

- `outcome-decision.ts`: `contrast` reads one told-minus-none contrast with the prereg's section 8 decision test. Task means pair across arms, z is delta over the cluster-robust SE by repository, and a claim needs |z| > 1.959964 and an exact repository sign-flip p of at most 0.025 in z's direction, counted inclusively. The sign-flip count is exact for any number of repositories (a convolution over integer cluster sums). A control arm above 85% makes no claim, and past 5% truncated trials the readings with and without them must agree. `futilityLook` is plan v3 section 6's two-sided look in power.py's B-value form at the panel's frozen half: it stops only when conditional power for plus and for minus the planned MDD are both under 10%, and never for efficacy.
- `outcome-cost.ts`: `costGuard` is #169's G3. Told's metered dollars per solved trial over none's, a task-clustered bootstrap (10,000 draws, seed 20261102), and it holds when the upper bound is at most 1.5. `breakEvenGain` is plan v3 section 8's break-even column.
- `outcome-r48.ts`: `r48` routes a skill's contrast, exposure, cost guard and futility look by plan v3 section 9, and `renderR48` prints the table.
- `g-resize.ts`: resize.py, cost.py and survivor.py's alone(), ported with Python's float sum and round, so `renderResizeCases` prints resize.txt byte for byte and `renderResizeMetered` prints what resize.py prints at metered inputs. `m1Decide` applies M1's ladder and the Captain's pick C.
- `g-admission.ts`: `admitG` reads admission items 1 to 5 on the slice (prereg section 6). Its metered means are settled spend. `authPaidFromLedger` reads AUTH_PAID from the slice's settled U4 leases, and `unknownFromRun` counts an arm's calls of unknown cost at its sessions' closes, from the run directory's `close` lines, which item 5 prints beside the means. Every path that closes a driver's lease writes the close lines its open sessions lack: the driver's recovery, `ledger settle --lease` and `ledger reconcile`.
- `g-projection.ts`: `projectionCheck` re-sizes the live G skills between stages from O6's envelope and the metered means, and stops a skill as FIX-METHOD (price) before the stage spends.
- `outcome-power.ts`: power.py's simulation re-run through `decideCells` and `futilityCells`, so the scorer as built shows power.txt's power, null size and futility behavior within Monte Carlo error.

Spend reads go through O6's envelope and U4 leases only. `tests/stats/fixtures/g-power-parity.json` holds power.py's own simulated panels and its readings of them; regenerate it with `uv run --no-project --with numpy==2.3.4 python3 tests/stats/fixtures/g-power-parity.py` from the repo root.
