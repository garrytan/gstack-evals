# Parity SD estimate from DeepSWE v1.1 (U15)

GSTA-27, 2026-10-29, for the pilot report (U17). Build unit U15 of the v1.0 breakdown (M1c). No model calls and no spend.

## What it stands in for

Decision 9 sizes the parity backbone with n = ((z_alpha + z_power) x SD / 0.07)^2. There SD is the per-task SD of (C+gstack minus F+none) task means at 5 cheap-rung and 3 Opus trials: C is a cheap rung (Haiku 5.5 or an open-weight slot) with gstack, F is Opus 5.5 without it, both in Claude Code, on the minted build-fix tasks. Plan v3.2 expected a realistic SD of 0.33 to 0.42 and asked M1c to estimate it from DeepSWE's published per-task results.

DeepSWE v1.1 has none of those arms. Datacurve ran 70 model and effort configurations with mini-swe-agent, a minimal agent with no skills, 4 trials on each of its 113 tasks. So this note measures the SD of (C' minus F') task means, where F' is Claude Opus 5 at max effort and each C' is the board model nearest a cheap rung, and carries it to 5 and 3 trials with the plan's formula. The proxy differs from the target in four ways:

- **No gstack arm.** No cell loads a skill, so the proxy cannot show how gstack's lift varies from task to task. The results give the estimate if that lift varied with an SD of 0.10 or 0.20, independently of the gap. If gstack helps most where C trails F, the two partly cancel and the SD falls instead.
- **Other models.** Opus 5.5 and Haiku 5.5 are not on the board. claude-opus-5 [max] stands in for F. No small Anthropic model is on the board, so gpt-5-6-luna [max], the newest minimal-cost model from a frontier lab there, stands in for Haiku 5.5. deepseek-v4-flash [max] stands in for DeepSeek V4.1 Flash, and glm-5-3-flash [max] is GLM 5.3 Flash itself. Each runs at the effort the board ranks best, and each rung has an alternate at max effort: gpt-5-6-terra, deepseek-v4-pro and glm-5-3.
- **Another harness.** mini-swe-agent, not Claude Code. Published DeepSWE scores swing by about 20 points between harnesses (plan v3.2, Harness check).
- **Other tasks.** DeepSWE's tasks are long feature requests written from scratch (106 of 113), and the mean reference patch adds 668 lines (GSTA-4's research). The build-fix tasks will be minted from PRs merged after 2026-10-17. DeepSWE's tests and gold patches have been public since May 2026, so newer models may have seen them.

So the estimate anchors the size of the SD with measured data; it is not the SD of the parity test. Phase 2b measures that on Haiku 5.5 plus gstack cells before minting, as the plan says.

## Data

- File: [trials.json](https://deepswe.datacurve.ai/artifacts/v1.1/trials.json), the export behind Datacurve's DeepSWE v1.1 board ("Every DeepSWE rollout and every cross-benchmark trial, after fairness filtering"), 31,617 trials.
- Retrieved 2026-10-29T19:27:59Z: sha256 310cb428fe8914cff21b8edcb0b17256884efca55666bd6d6646d223c77d2ce6, 51,023,870 bytes, Last-Modified Fri, 23 Oct 2026 19:16:54 GMT. [source.json](source.json) records these fields, and the fetch step refuses any other digest.
- Licence: none is stated for the file. The benchmark's GitHub repository (datacurve-ai/deep-swe) is Apache-2.0 but holds only the tasks. So this folder commits the digest, the fetch script and the derived per-task pass counts of the 12 configurations it uses ([counts.json](counts.json)), never the file.
- Check: for all 70 configurations, the file's scored passes and attempts equal n_passed and n_attempted on the board's leaderboard-live.json, read the same day.

## Method

1. Keep scored trials only. Datacurve excluded 155 of the 31,617 as provider, verifier or network errors; context-window failures and agent timeouts count as failures.
2. For each pair (C', F') and task, take each arm's pass rate over its trials (4, a few 3 or fewer). A task needs at least 2 scored trials in both arms. dynamodb-toolbox-lazy-recursive-schemas has one for gpt-5-6-luna [max], so that pair uses 112 tasks.
3. Estimate the between-task variance of the true difference by the method of moments: the sample variance of the observed differences, minus the mean unbiased trial-noise term p(1-p)/(n-1) + q(1-q)/(m-1), floored at 0.
4. Apply the plan's formula, SD^2 = between + p(1-p)/5 + q(1-q)/3, with p(1-p) and q(1-q) read per task and averaged, each estimated without bias as p(1-p)n/(n-1). The SD is over task means, so each task's own binomial variance is what counts. One overall pass rate per arm in p(1-p), the way U2's `taskDiffSd` takes it, adds the spread of the rates themselves and overstates the SD. The results give that reading for comparison.
5. Pool the three rung stand-ins' variances against claude-opus-5 [max] and take the root mean square. The three-model design must cover the largest of its three models' SDs; a one-primary design covers only the primary's. The per-rung rows give both.
6. Bound the uncertainty two ways. Sampling: a task bootstrap, 10,000 resamples of the 113 tasks with replacement, where a resampled task carries all its trials in both arms and the three pairs share each resample (seed 20261029, percentile 95% interval). Proxy choice: the sensitivity range runs from the lowest to the highest SD over 24 pairs, each of the six cheap stand-ins and alternates against each of the board's top four configurations (72.7% to 74.1% pass@1; the fifth is 69.9%).
7. Print U2's `decision9Table` and `releaseSplitTable` at five SDs: both ends of both ranges and the estimate, each rounded to 3 decimals. Counts round up, as U2's rounding finding explains. These sizes are for the bootstrap bound in `nonInferiorityP`, which holds its level at 30 tasks and up. The margin-shifted sign-flip is for Lane A's few-task margins and plays no part here.

I fixed the stand-ins and the two sets after a first look at every pair's SD. That is why the sensitivity grid shows every pair in the stated sets, not a chosen few.

## Results

<!-- parity-sd-estimate:start (bun scripts/parity-sd-estimate.ts report writes this block; do not edit by hand) -->

**Estimate.** The per-task SD of (C+gstack minus F+none) at 5 cheap-rung and 3 Opus trials is **0.376** (95% task-bootstrap interval 0.340 to 0.408), pooled over the three cheap rungs' stand-ins against claude-opus-5 [max] on 113 DeepSWE v1.1 tasks. Across the 24 stand-in pairs it runs from 0.270 (gpt-5-6-terra [max] against gpt-5-6-sol [max]) to 0.432 (deepseek-v4-flash [max] against gemini-3-8-flash [high]).

| Rung | DeepSWE stand-in | Tasks | Gap to claude-opus-5 [max] (points) | Between-task SD | SD at 5 and 3 trials | 95% bootstrap interval |
|---|---|---|---|---|---|---|
| Haiku 5.5 | gpt-5-6-luna [max] | 112 | -6.4 | 0.344 | 0.421 | 0.364 to 0.470 |
| DeepSeek V4.1 Flash | deepseek-v4-flash [max] | 113 | -20.5 | 0.320 | 0.407 | 0.354 to 0.456 |
| GLM 5.3 Flash | glm-5-3-flash [max] | 113 | -10.3 | 0.157 | 0.286 | 0.240 to 0.329 |
| Pooled (root mean square) | | | | | 0.376 | 0.340 to 0.408 |

The sensitivity grid: the SD at 5 and 3 trials for every pair of a cheap stand-in or its alternate (rows) and a top-four configuration (columns).

| Cheap stand-in | claude-opus-5 [max] | gpt-6-astra [xhigh] | gemini-3-8-flash [high] | gpt-5-6-sol [max] |
|---|---|---|---|---|
| gpt-5-6-luna [max] | 0.421 | 0.398 | 0.367 | 0.351 |
| gpt-5-6-terra [max] | 0.407 | 0.354 | 0.350 | 0.270 |
| deepseek-v4-flash [max] | 0.407 | 0.425 | 0.432 | 0.390 |
| deepseek-v4-pro [max] | 0.380 | 0.397 | 0.398 | 0.337 |
| glm-5-3-flash [max] | 0.286 | 0.405 | 0.394 | 0.380 |
| glm-5-3 [max] | 0.296 | 0.409 | 0.377 | 0.387 |

- Plugging each arm's overall pass rate into p(1-p), as `taskDiffSd` does with one rate per arm, would give 0.440 for the pooled estimate instead of 0.376.
- With 5 Opus trials instead of 3, the pooled estimate would be 0.360.
- When only its effort changes, Claude Opus 5's per-task pass rates move with a between-task SD of 0.069 (high to xhigh) and 0.083 (xhigh to max) beyond trial noise. If gstack's lift varied across tasks with an SD of 0.10 or 0.20, independently of the gap, the pooled estimate would be 0.389 or 0.426.

### Decision 9 at the estimate

Build-fix tasks needed at the low end of the sensitivity range, the low end of the bootstrap interval, the estimate, the high end of the bootstrap interval and the high end of the sensitivity range. Counts round up.

| Design | SD 0.27 | SD 0.34 | SD 0.376 | SD 0.408 | SD 0.432 | SD that 213 tasks cover |
| --- | --- | --- | --- | --- | --- | --- |
| Three cheap models, Holm, 90% power: the current design | 173 | 275 | 336 | 395 | 443 | 0.30 |
| One preregistered primary cheap model, 90% power | 128 | 203 | 248 | 291 | 327 | 0.35 |
| One primary cheap model, 80% power | 92 | 146 | 179 | 211 | 236 | 0.41 |

### Amendment A2 at the estimate

Each cell gives the tasks needed at SD 0.27 / 0.34 / 0.376 / 0.408 / 0.432.

| Option | Three cheap models, Holm, 90% power: the current design: SD 0.27 / 0.34 / 0.376 / 0.408 / 0.432 | One preregistered primary cheap model, 90% power: SD 0.27 / 0.34 / 0.376 / 0.408 / 0.432 | One primary cheap model, 80% power: SD 0.27 / 0.34 / 0.376 / 0.408 / 0.432 |
| --- | --- | --- | --- |
| v3.2 as written (parity takes the whole alpha at one release) | 173 / 275 / 336 / 395 / 443 | 128 / 203 / 248 / 291 / 327 | 92 / 146 / 179 / 211 / 236 |
| A. Parity gets a bigger preregistered share (0.03 to parity) | 194 / 308 / 376 / 443 / 496 | 149 / 236 / 289 / 340 / 381 | 111 / 175 / 214 / 252 / 283 |
| B. Parity runs on its own sealed tranche, used once at the full 0.05 | 173 / 275 / 336 / 395 / 443 for the tranche, plus the tasks the other releases use | 128 / 203 / 248 / 291 / 327 for the tranche, plus the tasks the other releases use | 92 / 146 / 179 / 211 / 236 for the tranche, plus the tasks the other releases use |
| C. Mint more: four frozen releases at 0.0125 each | 229 / 363 / 444 / 522 / 586 | 185 / 293 / 359 / 422 / 473 | 142 / 225 / 275 / 323 / 363 |
| C, if each release steers the next candidate (0.05/15 per node) | 281 / 445 / 544 / 640 / 718 | 238 / 377 / 461 / 543 / 608 | 188 / 299 / 365 / 430 / 482 |

### Which rows fit under 213 tasks

| Option | Design | SD 213 tasks cover | At 0.376 | Bootstrap 0.340 to 0.408 | Sensitivity 0.270 to 0.432 |
|---|---|---|---|---|---|
| v3.2 as written | Three cheap models, 90% power | 0.300 | does not fit | does not fit | changes |
| v3.2 as written | One primary model, 90% power | 0.349 | does not fit | changes | changes |
| v3.2 as written | One primary model, 80% power | 0.411 | fits | fits | changes |
| A, a bigger share (0.03) | Three cheap models, 90% power | 0.283 | does not fit | does not fit | changes |
| A, a bigger share (0.03) | One primary model, 90% power | 0.323 | does not fit | does not fit | changes |
| A, a bigger share (0.03) | One primary model, 80% power | 0.375 | does not fit | changes | changes |
| B, its own tranche (the tranche alone) | Three cheap models, 90% power | 0.300 | does not fit | does not fit | changes |
| B, its own tranche (the tranche alone) | One primary model, 90% power | 0.349 | does not fit | changes | changes |
| B, its own tranche (the tranche alone) | One primary model, 80% power | 0.411 | fits | fits | changes |
| C, four frozen releases (0.0125) | Three cheap models, 90% power | 0.261 | does not fit | does not fit | does not fit |
| C, four frozen releases (0.0125) | One primary model, 90% power | 0.290 | does not fit | does not fit | changes |
| C, four frozen releases (0.0125) | One primary model, 80% power | 0.331 | does not fit | does not fit | changes |
| C, if releases steer (0.05/15) | Three cheap models, 90% power | 0.235 | does not fit | does not fit | does not fit |
| C, if releases steer (0.05/15) | One primary model, 90% power | 0.256 | does not fit | does not fit | does not fit |
| C, if releases steer (0.05/15) | One primary model, 80% power | 0.287 | does not fit | does not fit | changes |

At the estimate, 2 of 15 rows fit under 213 tasks: v3.2 as written, one primary model, 80% power; B, its own tranche (the tranche alone), one primary model, 80% power.

Rows that change across the bootstrap interval:

- v3.2 as written, one primary model, 90% power: fits up to SD 0.349.
- A, a bigger share (0.03), one primary model, 80% power: fits up to SD 0.375.
- B, its own tranche (the tranche alone), one primary model, 90% power: fits up to SD 0.349.

Rows that change across the sensitivity range:

- v3.2 as written, three cheap models, 90% power: fits up to SD 0.300.
- v3.2 as written, one primary model, 90% power: fits up to SD 0.349.
- v3.2 as written, one primary model, 80% power: fits up to SD 0.411.
- A, a bigger share (0.03), three cheap models, 90% power: fits up to SD 0.283.
- A, a bigger share (0.03), one primary model, 90% power: fits up to SD 0.323.
- A, a bigger share (0.03), one primary model, 80% power: fits up to SD 0.375.
- B, its own tranche (the tranche alone), three cheap models, 90% power: fits up to SD 0.300.
- B, its own tranche (the tranche alone), one primary model, 90% power: fits up to SD 0.349.
- B, its own tranche (the tranche alone), one primary model, 80% power: fits up to SD 0.411.
- C, four frozen releases (0.0125), one primary model, 90% power: fits up to SD 0.290.
- C, four frozen releases (0.0125), one primary model, 80% power: fits up to SD 0.331.
- C, if releases steer (0.05/15), one primary model, 80% power: fits up to SD 0.287.

<!-- parity-sd-estimate:end -->

## For the pilot report

- The estimate lands inside the plan's expected 0.33 to 0.42. At the estimate, only the one-primary-model design at 80% power fits under 213 tasks (as written in v3.2, or on its own tranche under A2's option B). At 90% power the one-primary design fits only at the low end of the bootstrap interval. The three-model design fits only at the low end of the sensitivity range, which comes from a same-family pair.
- Under Amendment A2, option C (four frozen releases) fits no design at the estimate, and option A at 80% power needs 214 tasks, one over the ceiling.
- The pairs disagree more than the bootstrap does. The GLM stand-in tracks Claude Opus 5 closely, while gpt-5-6-luna and deepseek-v4-flash do not, so the choice of primary cheap model may matter as much as the design.
- 5 Opus trials instead of 3 lower the estimate, and the results give by how much. Feeding `taskDiffSd` one overall pass rate per arm would overstate the SD; use per-task averages or this estimate.

## Reproduce

```sh
bun scripts/parity-sd-estimate.ts fetch ~/deepswe-v1.1-trials.json
bun scripts/parity-sd-estimate.ts build ~/deepswe-v1.1-trials.json --check
bun scripts/parity-sd-estimate.ts report --check
```

`build --check` checks the file's sha256, derives counts.json and the report from it and compares every byte with the committed files. `report --check` starts from counts.json, needs no download and no key, and tests/parity-sd-estimate.test.ts runs it in CI. Datacurve serves a live file, so the fetch step refuses a copy whose digest has changed.
