---
id: 2026-10-28-gsta-14-noninferiority-bootstrap-few-tasks
kind: finding
title: The bootstrap non-inferiority bound runs high on few tasks; parity sizes are fine
summary: The bootstrap non-inferiority bound of decision 9 falsely passed 6.7% of runs at 12 tasks, against 5%, and held its level at 30 and 200. Parity is safe; Lane A's --margin needs a rule.
author: GSTA-14
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
links:
  - src/runner/stats/paired.ts
  - src/runner/stats/gates.ts
  - 2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2
  - 2026-10-28-gsta-3-v1-build-breakdown
---

# The bootstrap non-inferiority bound runs high on few tasks; parity sizes are fine

gstack's /ship outside review of PR #8 found that the kit's one-sided p-values from the task-clustered bootstrap are anti-conservative on few tasks. For superiority the plan already names the exact sign-flip test, so U2 switched `superiorityP` to it. For non-inferiority the plan names the bootstrap: decision 9 holds a parity claim when "the one-sided 95% lower bound" of the difference clears minus the margin, and intervals are task-clustered bootstrap intervals. U2 kept that, because changing it changes the plan. This post records how far off it is so U6 can choose.

## What was measured

A simulation with the kit's own functions, at 2,000 bootstrap draws. Each task has a pass rate drawn uniformly from 0.2 to 0.8, each arm runs 3 trials, and B's pass rate is A's minus exactly the 0.10 margin, so every rejection is a false non-inferiority claim. Nominal level 5%. The Monte Carlo standard error is about 0.6 points at 1,500 runs.

| Tasks | Runs | Bootstrap bound rejects | Margin-shifted sign-flip rejects |
|---|---|---|---|
| 12 | 1,500 | 6.7% | 4.3% |
| 30 | 1,000 | 4.4% | 4.7% |
| 200 | 300 | 5.0% | 5.0% |

For superiority at a true difference of zero, the bootstrap rejected 6.1% at 10 tasks and 4.5% at 30; the exact sign-flip rejected 2.8% at both.

## Where it matters

- **Parity (decision 9, Amendment A2).** Sized at 95 to 380 tasks. The bootstrap holds its level there, so the parity design stands.
- **Lane A's `--margin`.** Plan v3.2 has a cut-track candidate promoted only with `noninferior: true`, on skill evals of about 12 to 20 tasks. There the bootstrap overstates confidence by a point or two, and more on sparse data with many tied tasks.

## Options for U6

1. Use the margin-shifted clustered sign-flip p for non-inferiority: flip the signs of (difference + margin) per task cluster. It held 4.3% to 5.0% above and matches the plan's line that p-values are exact sign-flip tests over task clusters. It assumes the shifted differences are symmetric under the null, which is close but not exact for pass rates. This is the recommendation, and it needs the Captain's (and Garry's) yes because it changes decision 9's wording for small runs.
2. Keep the bootstrap bound and require at least 30 informative task clusters for a non-inferiority pass; fewer is inconclusive. Simple, but most skill evals could then never show non-inferiority.
3. Keep it as is and print the caveat beside every non-inferiority verdict under 30 tasks.

Until U6 chooses, `nonInferiorityP` stays as decision 9 wrote it, and the U6 verdict tests should include a 12-task case at the margin.
