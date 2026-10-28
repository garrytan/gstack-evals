---
id: 2026-10-28-gsta-14-sizing-tables-round-to-nearest
kind: finding
title: The plan's parity sizing tables round to the nearest task; the kit rounds up
summary: Plan v3.2's decision 9 table and Amendment A2's table round task counts to the nearest task. The U2 kit rounds up, so some cells read one task higher. No decision changes.
author: GSTA-14
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
links:
  - src/runner/stats/sizing.ts
  - tests/stats/sizing.test.ts
  - 2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2
  - 2026-10-28-gsta-3-v1-plan-amendment-a2
  - 2026-10-28-gsta-3-v1-build-breakdown
---

# The plan's parity sizing tables round to the nearest task; the kit rounds up

U2 put the parity sizing formula in code: n = ((z_alpha + z_power) x SD / 0.07)^2, one-sided. Every number in plan v3.2's decision 9 table and in Amendment A2's release-split table equals that n **rounded to the nearest task**. A sample size is normally rounded up, because rounding down leaves the design a little short of its stated power. So `requiredTasks` in `src/runner/stats/sizing.ts` rounds up, and the tables it renders read one task higher wherever the exact n has a fraction below one half.

## Where the counts differ

- Decision 9, at SD 0.2, 0.3, 0.33, 0.38 and 0.42:
  - three cheap models: 95, 214, **259** (plan 258), 343, 419;
  - one primary model: 70, **158** (157), **191** (190), **253** (252), **309** (308);
  - one primary model at 80% power: **51** (50), 114, **138** (137), **183** (182), 223.
- A2, at SD 0.30 / 0.38, the same cells move in the v3.2 and B rows, plus A (240 for 239, 137 for 136, 219 for 218), C (283 for 282, 281 for 280) and the steering variant of C (347 for 346, 556 for 555, 294 for 293, 471 for 470, 233 for 232, 373 for 372).
- The same rounding sits in "213 tasks cover SD 0.30" under the current design: the covered SD is 0.2996, so 213 tasks fall just short at 0.30, which is why the table says 214 there.

## What it changes

Nothing that decides anything. Every difference is one task in 157 or more, and the SDs a 213-task ceiling covers are unchanged at two decimals (0.30, 0.35, 0.41; under A2's option C, 0.26, 0.29, 0.33). The design is unchanged.

`tests/stats/sizing.test.ts` checks every printed number in both tables as the exact n rounded to the nearest task, checks that the kit's count is that number or one more, and pins the rendered tables. When U15 and U17 print the tables at the estimated SD, they print the rounded-up counts.
