---
id: 2026-10-28-gsta-14-noninferiority-bootstrap-few-tasks
kind: finding
title: The bootstrap non-inferiority bound runs high on few tasks; Lane A's --margin moves to a sign-flip test
summary: Decision 9's bootstrap bound falsely passed 6.7% of runs at 12 tasks, against the plan's 5%. The Captain chose the margin-shifted sign-flip (4.9%) for Lane A's --margin; parity keeps the bound.
author: GSTA-14
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
links:
  - src/runner/stats/paired.ts
  - src/runner/stats/gates.ts
  - 2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2
  - 2026-10-28-gsta-3-v1-build-breakdown
---

# The bootstrap non-inferiority bound runs high on few tasks; Lane A's --margin moves to a sign-flip test

gstack's /ship outside review of PR #8 found that the kit's one-sided p-values from the task-clustered bootstrap are anti-conservative on few tasks. For superiority the plan already names the exact sign-flip test, so U2 switched `superiorityP` to it. For non-inferiority the plan names the bootstrap: decision 9 holds a parity claim when "the one-sided 95% lower bound" of the difference clears minus the margin, and intervals are task-clustered bootstrap intervals. Changing that is a plan decision, so U2 measured it and asked.

## What was measured

A simulation with the kit's own functions, at 2,000 bootstrap draws. Each task has a pass rate drawn uniformly from 0.2 to 0.8, each arm runs 3 trials, and B's pass rate is A's minus exactly the 0.10 margin, so every rejection at alpha 0.05 is a false non-inferiority claim. The Monte Carlo standard error is about 0.6 points at 1,500 runs and 1.3 points at 300. `tests/stats/sign-flip.test.ts` (PR #16, with the sign-flip function) reproduces these counts exactly.

| Tasks | Runs | Bootstrap bound false passes | Margin-shifted sign-flip false passes |
|---|---|---|---|
| 12 | 1,500 | 101 (6.7%) | 73 (4.9%) |
| 30 | 1,000 | 41 (4.1%) | 41 (4.1%) |
| 200 | 300 | 16 (5.3%) | 16 (5.3%) |

At 12 tasks the bootstrap bound is about three standard errors above 5%. At 30 and 200 tasks both tests hold their level.

## Where it matters

- **Parity (decision 9, Amendment A2).** Sized at 95 to 380 tasks, where the bootstrap holds its level.
- **Lane A's `--margin`.** Plan v3.2 promotes a cut-track candidate only with `noninferior: true`, on skill evals of about 12 to 20 tasks, where the bootstrap bound breaks the plan's 5%.

## Decision

The Captain (GSTA-2), 2026-10-28, took the recommendation:

- Lane A's `--margin` uses the margin-shifted exact sign-flip over task clusters: flip the signs of each task cluster's (difference + margin), every pattern up to 20 clusters. The bootstrap bound's 6.7% false-pass rate at 12 tasks breaks the 5% the plan promises; the sign-flip test keeps it (4.9%). This corrects the method so the plan's stated error rate holds; it does not change what the plan claims.
- Parity keeps decision 9's bootstrap bound for parity sizes (30 tasks and up) in v1.1. It held 5% there, and Garry picks the parity design at the pilot report.
- U2 adds the function, `marginShiftedSignFlipP` in `src/runner/stats/sign-flip.ts`, with the test above. U6's brief carries the rule.

The sign-flip test assumes the shifted differences are symmetric under the null, which is close but not exact for pass rates; the table is the check.
