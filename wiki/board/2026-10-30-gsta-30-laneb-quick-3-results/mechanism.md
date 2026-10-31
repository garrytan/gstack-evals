# Mechanism and failure lines (all 39 tasks)

From the session rows and trial results, graded trials only. Cost per success sums the trials that have a session row.

| Model | Arm | Trials | Agent timeouts | Agent-timeout share | Budget stops | Median requests per trial | Cost with a session row | Trials without a session row | Cost per success |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 117 | 1 | 1% | 0 | 4 | $6.07 | 0 | $0.07 |
| claude-sonnet-5-5 | gstack | 117 | 3 | 3% | 0 | 4 | $10.51 | 0 | $0.12 |
| claude-sonnet-5-5 | placebo | 117 | 2 | 2% | 0 | 4 | $10.79 | 0 | $0.12 |
| particle-1 | none | 117 | 4 | 3% | 5 | 15 | $8.07 | 0 | $0.10 |
| particle-1 | gstack | 117 | 7 | 6% | 4 | 16 | $8.91 | 1 | $0.10 |
| particle-1 | placebo | 117 | 3 | 3% | 8 | 15 | $9.51 | 0 | $0.11 |
| deepseek-v4.1-flash-1017 | none | 117 | 7 | 6% | 4 | 19 | $7.22 | 0 | $0.08 |
| deepseek-v4.1-flash-1017 | gstack | 117 | 12 | 10% | 1 | 20 | $7.05 | 0 | $0.08 |
| deepseek-v4.1-flash-1017 | placebo | 117 | 15 | 13% | 4 | 20 | $7.90 | 0 | $0.08 |
| claude-haiku-5-5 | none | 117 | 4 | 3% | 0 | 6 | $1.03 | 0 | $0.01 |
| claude-haiku-5-5 | gstack | 117 | 4 | 3% | 0 | 8 | $1.81 | 0 | $0.02 |
| claude-haiku-5-5 | placebo | 117 | 3 | 3% | 0 | 7 | $1.70 | 0 | $0.02 |
| claude-opus-5-5 | none | 117 | 1 | 1% | 0 | 5 | $19.85 | 0 | $0.21 |

## Sensitivity: drop tasks with a session-cap stop in every arm of a model

| Model | Tasks dropped | Tasks left | gstack - placebo, pp [95% CI] | gstack - none, pp [95% CI] |
|---|---|---|---|---|
| claude-sonnet-5-5 | none | 39 | unchanged | unchanged |
| particle-1 | extract-elf, largest-eigenval | 37 | -5 [-10, +0] | +2 [-7, +11] |
| deepseek-v4.1-flash-1017 | filter-js-from-html | 38 | -2 [-8, +5] | -4 [-11, +4] |
| claude-haiku-5-5 | none | 39 | unchanged | unchanged |
