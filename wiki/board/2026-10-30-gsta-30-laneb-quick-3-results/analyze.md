| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 39 | 117 | 76% [64%, 86%] | $6.07 | $0.07 | 0% | 0 | 1 | 0 |
| claude-sonnet-5-5 | gstack | 39 | 117 | 74% [61%, 86%] | $10.51 | $0.12 | 0% | 0 | 3 | 0 |
| claude-sonnet-5-5 | placebo | 39 | 117 | 76% [63%, 87%] | $10.79 | $0.12 | 0% | 0 | 2 | 0 |
| particle-1 | none | 39 | 117 | 71% [58%, 84%] | $8.07 | $0.10 | 0% | 5 | 4 | 0 |
| particle-1 | gstack | 39 | 117 | 73% [62%, 83%] | n/a (1 missing) | n/a | 0% | 4 | 7 | 0 |
| particle-1 | placebo | 39 | 117 | 77% [66%, 87%] | $9.51 | $0.11 | 3% | 8 | 3 | 0 |
| deepseek-v4.1-flash-1017 | none | 39 | 117 | 81% [71%, 91%] | $7.22 | $0.08 | 0% | 4 | 7 | 0 |
| deepseek-v4.1-flash-1017 | gstack | 39 | 117 | 78% [67%, 87%] | $7.05 | $0.08 | 0% | 1 | 12 | 0 |
| deepseek-v4.1-flash-1017 | placebo | 39 | 117 | 79% [68%, 90%] | $7.90 | $0.08 | 3% | 4 | 15 | 0 |
| claude-haiku-5-5 | none | 39 | 117 | 77% [66%, 87%] | $1.03 | $0.01 | 0% | 0 | 4 | 1 |
| claude-haiku-5-5 | gstack | 39 | 117 | 72% [60%, 83%] | $1.81 | $0.02 | 0% | 0 | 4 | 0 |
| claude-haiku-5-5 | placebo | 39 | 117 | 77% [65%, 88%] | $1.70 | $0.02 | 0% | 0 | 3 | 1 |
| claude-opus-5-5 | none | 39 | 117 | 79% [68%, 91%] | $19.85 | $0.21 | 0% | 0 | 1 | 0 |
| claude-opus-5-5 | gstack | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |
| claude-opus-5-5 | placebo | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |

| Model | Contrast | Paired tasks | Difference, pp [95% CI] |
|---|---|---|---|
| claude-sonnet-5-5 | gstack - none | 39 | -2 [-10, +6] |
| claude-sonnet-5-5 | gstack - placebo | 39 | -2 [-9, +5] |
| claude-sonnet-5-5 | placebo - none | 39 | +0 [-6, +6] |
| particle-1 | gstack - none | 39 | +2 [-7, +11] |
| particle-1 | gstack - placebo | 39 | -4 [-9, +0] |
| particle-1 | placebo - none | 39 | +6 [-2, +15] |
| deepseek-v4.1-flash-1017 | gstack - none | 39 | -3 [-11, +4] |
| deepseek-v4.1-flash-1017 | gstack - placebo | 39 | -2 [-8, +5] |
| deepseek-v4.1-flash-1017 | placebo - none | 39 | -2 [-9, +6] |
| claude-haiku-5-5 | gstack - none | 39 | -5 [-15, +5] |
| claude-haiku-5-5 | gstack - placebo | 39 | -5 [-12, +2] |
| claude-haiku-5-5 | placebo - none | 39 | +0 [-7, +8] |
| claude-opus-5-5 | gstack - none | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | gstack - placebo | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | placebo - none | 0 | n/a [n/a, n/a] |

| Model | Tasks | Opus none | Model none | Model gstack | Share of Opus gap closed [95% CI] | Resamples with a gap |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 39 | 79% | 76% | 74% | -50% [-1200%, 200%] | 76% |
| particle-1 | 39 | 79% | 71% | 73% | 20% [-200%, 200%] | 87% |
| deepseek-v4.1-flash-1017 | 39 | 79% | 81% | 78% | n/a [-11547691352231982%, 200%] | 39% |
| claude-haiku-5-5 | 39 | 79% | 77% | 72% | -200% [-1500%, 133%] | 64% |

## Subset: original_20 (20 tasks)

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 20 | 60 | 62% [43%, 80%] | $4.01 | $0.11 | 0% | 0 | 1 | 0 |
| claude-sonnet-5-5 | gstack | 20 | 60 | 52% [32%, 72%] | $5.99 | $0.19 | 0% | 0 | 3 | 0 |
| claude-sonnet-5-5 | placebo | 20 | 60 | 55% [35%, 75%] | $6.02 | $0.18 | 0% | 0 | 2 | 0 |
| particle-1 | none | 20 | 60 | 48% [30%, 67%] | $5.30 | $0.18 | 0% | 2 | 4 | 0 |
| particle-1 | gstack | 20 | 60 | 55% [40%, 70%] | n/a (1 missing) | n/a | 0% | 3 | 6 | 0 |
| particle-1 | placebo | 20 | 60 | 62% [45%, 77%] | $6.02 | $0.16 | 5% | 4 | 1 | 0 |
| deepseek-v4.1-flash-1017 | none | 20 | 60 | 67% [50%, 82%] | $4.95 | $0.12 | 0% | 3 | 5 | 0 |
| deepseek-v4.1-flash-1017 | gstack | 20 | 60 | 58% [42%, 73%] | $4.84 | $0.14 | 0% | 1 | 8 | 0 |
| deepseek-v4.1-flash-1017 | placebo | 20 | 60 | 65% [47%, 82%] | $4.95 | $0.13 | 5% | 2 | 11 | 0 |
| claude-haiku-5-5 | none | 20 | 60 | 57% [40%, 73%] | $0.68 | $0.02 | 0% | 0 | 4 | 1 |
| claude-haiku-5-5 | gstack | 20 | 60 | 50% [32%, 67%] | $1.18 | $0.04 | 0% | 0 | 4 | 0 |
| claude-haiku-5-5 | placebo | 20 | 60 | 58% [40%, 77%] | $1.13 | $0.03 | 0% | 0 | 3 | 1 |
| claude-opus-5-5 | none | 20 | 60 | 67% [47%, 85%] | $12.55 | $0.31 | 0% | 0 | 1 | 0 |
| claude-opus-5-5 | gstack | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |
| claude-opus-5-5 | placebo | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |

| Model | Contrast | Paired tasks | Difference, pp [95% CI] |
|---|---|---|---|
| claude-sonnet-5-5 | gstack - none | 20 | -10 [-23, +2] |
| claude-sonnet-5-5 | gstack - placebo | 20 | -3 [-15, +8] |
| claude-sonnet-5-5 | placebo - none | 20 | -7 [-17, +3] |
| particle-1 | gstack - none | 20 | +7 [-10, +23] |
| particle-1 | gstack - placebo | 20 | -7 [-17, +2] |
| particle-1 | placebo - none | 20 | +13 [-0, +28] |
| deepseek-v4.1-flash-1017 | gstack - none | 20 | -8 [-23, +5] |
| deepseek-v4.1-flash-1017 | gstack - placebo | 20 | -7 [-17, +3] |
| deepseek-v4.1-flash-1017 | placebo - none | 20 | -2 [-15, +13] |
| claude-haiku-5-5 | gstack - none | 20 | -7 [-25, +13] |
| claude-haiku-5-5 | gstack - placebo | 20 | -8 [-22, +5] |
| claude-haiku-5-5 | placebo - none | 20 | +2 [-12, +17] |
| claude-opus-5-5 | gstack - none | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | gstack - placebo | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | placebo - none | 0 | n/a [n/a, n/a] |

| Model | Tasks | Opus none | Model none | Model gstack | Share of Opus gap closed [95% CI] | Resamples with a gap |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 20 | 67% | 62% | 52% | -200% [-1200%, 14%] | 74% |
| particle-1 | 20 | 67% | 48% | 55% | 36% [-125%, 200%] | 92% |
| deepseek-v4.1-flash-1017 | 20 | 67% | 67% | 58% | n/a [-1100%, 100%] | 48% |
| claude-haiku-5-5 | 20 | 67% | 57% | 50% | -67% [-800%, 120%] | 80% |

## Subset: added_20 (19 tasks)

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 19 | 57 | 91% [82%, 98%] | $2.06 | $0.04 | 0% | 0 | 0 | 0 |
| claude-sonnet-5-5 | gstack | 19 | 57 | 98% [95%, 100%] | $4.52 | $0.08 | 0% | 0 | 0 | 0 |
| claude-sonnet-5-5 | placebo | 19 | 57 | 98% [95%, 100%] | $4.77 | $0.09 | 0% | 0 | 0 | 0 |
| particle-1 | none | 19 | 57 | 95% [84%, 100%] | $2.77 | $0.05 | 0% | 3 | 0 | 0 |
| particle-1 | gstack | 19 | 57 | 91% [79%, 100%] | $3.17 | $0.06 | 0% | 1 | 1 | 0 |
| particle-1 | placebo | 19 | 57 | 93% [81%, 100%] | $3.50 | $0.07 | 0% | 4 | 2 | 0 |
| deepseek-v4.1-flash-1017 | none | 19 | 57 | 96% [91%, 100%] | $2.28 | $0.04 | 0% | 1 | 2 | 0 |
| deepseek-v4.1-flash-1017 | gstack | 19 | 57 | 98% [95%, 100%] | $2.21 | $0.04 | 0% | 0 | 4 | 0 |
| deepseek-v4.1-flash-1017 | placebo | 19 | 57 | 95% [86%, 100%] | $2.95 | $0.05 | 0% | 2 | 4 | 0 |
| claude-haiku-5-5 | none | 19 | 57 | 98% [95%, 100%] | $0.35 | $0.01 | 0% | 0 | 0 | 0 |
| claude-haiku-5-5 | gstack | 19 | 57 | 95% [89%, 100%] | $0.63 | $0.01 | 0% | 0 | 0 | 0 |
| claude-haiku-5-5 | placebo | 19 | 57 | 96% [91%, 100%] | $0.57 | $0.01 | 0% | 0 | 0 | 0 |
| claude-opus-5-5 | none | 19 | 57 | 93% [81%, 100%] | $7.29 | $0.14 | 0% | 0 | 0 | 0 |
| claude-opus-5-5 | gstack | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |
| claude-opus-5-5 | placebo | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |

| Model | Contrast | Paired tasks | Difference, pp [95% CI] |
|---|---|---|---|
| claude-sonnet-5-5 | gstack - none | 19 | +7 [+0, +16] |
| claude-sonnet-5-5 | gstack - placebo | 19 | +0 [-5, +5] |
| claude-sonnet-5-5 | placebo - none | 19 | +7 [+2, +14] |
| particle-1 | gstack - none | 19 | -4 [-9, +0] |
| particle-1 | gstack - placebo | 19 | -2 [-5, +0] |
| particle-1 | placebo - none | 19 | -2 [-5, +0] |
| deepseek-v4.1-flash-1017 | gstack - none | 19 | +2 [+0, +5] |
| deepseek-v4.1-flash-1017 | gstack - placebo | 19 | +4 [+0, +11] |
| deepseek-v4.1-flash-1017 | placebo - none | 19 | -2 [-5, +0] |
| claude-haiku-5-5 | gstack - none | 19 | -4 [-9, +0] |
| claude-haiku-5-5 | gstack - placebo | 19 | -2 [-5, +0] |
| claude-haiku-5-5 | placebo - none | 19 | -2 [-5, +0] |
| claude-opus-5-5 | gstack - none | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | gstack - placebo | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | placebo - none | 0 | n/a [n/a, n/a] |

| Model | Tasks | Opus none | Model none | Model gstack | Share of Opus gap closed [95% CI] | Resamples with a gap |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 19 | 93% | 91% | 98% | 400% [50%, 7901051977842950%] | 58% |
| particle-1 | 19 | 93% | 95% | 91% | n/a [-300%, 0%] | 33% |
| deepseek-v4.1-flash-1017 | 19 | 93% | 96% | 98% | n/a [0%, 7901051977843050%] | 27% |
| claude-haiku-5-5 | 19 | 93% | 98% | 95% | n/a [-23703155933528900%, 0%] | 15% |

## Subset: tier_a (10 tasks)

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 10 | 30 | 43% [20%, 70%] | $1.96 | $0.15 | 0% | 0 | 0 | 0 |
| claude-sonnet-5-5 | gstack | 10 | 30 | 30% [10%, 57%] | $3.12 | $0.35 | 0% | 0 | 0 | 0 |
| claude-sonnet-5-5 | placebo | 10 | 30 | 37% [13%, 63%] | $3.14 | $0.29 | 0% | 0 | 0 | 0 |
| particle-1 | none | 10 | 30 | 53% [27%, 80%] | $2.33 | $0.15 | 0% | 0 | 1 | 0 |
| particle-1 | gstack | 10 | 30 | 63% [40%, 87%] | $2.35 | $0.12 | 0% | 0 | 2 | 0 |
| particle-1 | placebo | 10 | 30 | 67% [43%, 87%] | $3.21 | $0.16 | 0% | 3 | 0 | 0 |
| deepseek-v4.1-flash-1017 | none | 10 | 30 | 77% [53%, 97%] | $2.87 | $0.12 | 0% | 3 | 2 | 0 |
| deepseek-v4.1-flash-1017 | gstack | 10 | 30 | 67% [43%, 87%] | $2.47 | $0.12 | 0% | 1 | 1 | 0 |
| deepseek-v4.1-flash-1017 | placebo | 10 | 30 | 70% [43%, 93%] | $2.72 | $0.13 | 7% | 2 | 2 | 0 |
| claude-haiku-5-5 | none | 10 | 30 | 50% [23%, 77%] | $0.38 | $0.03 | 0% | 0 | 1 | 1 |
| claude-haiku-5-5 | gstack | 10 | 30 | 40% [17%, 67%] | $0.47 | $0.04 | 0% | 0 | 0 | 0 |
| claude-haiku-5-5 | placebo | 10 | 30 | 53% [27%, 80%] | $0.60 | $0.04 | 0% | 0 | 1 | 1 |
| claude-opus-5-5 | none | 10 | 30 | 47% [20%, 73%] | $7.18 | $0.51 | 0% | 0 | 1 | 0 |
| claude-opus-5-5 | gstack | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |
| claude-opus-5-5 | placebo | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |

| Model | Contrast | Paired tasks | Difference, pp [95% CI] |
|---|---|---|---|
| claude-sonnet-5-5 | gstack - none | 10 | -13 [-33, +0] |
| claude-sonnet-5-5 | gstack - placebo | 10 | -7 [-23, +7] |
| claude-sonnet-5-5 | placebo - none | 10 | -7 [-20, +7] |
| particle-1 | gstack - none | 10 | +10 [-7, +33] |
| particle-1 | gstack - placebo | 10 | -3 [-10, +0] |
| particle-1 | placebo - none | 10 | +13 [-3, +37] |
| deepseek-v4.1-flash-1017 | gstack - none | 10 | -10 [-20, +0] |
| deepseek-v4.1-flash-1017 | gstack - placebo | 10 | -3 [-13, +7] |
| deepseek-v4.1-flash-1017 | placebo - none | 10 | -7 [-20, +7] |
| claude-haiku-5-5 | gstack - none | 10 | -10 [-40, +23] |
| claude-haiku-5-5 | gstack - placebo | 10 | -13 [-33, +3] |
| claude-haiku-5-5 | placebo - none | 10 | +3 [-20, +30] |
| claude-opus-5-5 | gstack - none | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | gstack - placebo | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | placebo - none | 0 | n/a [n/a, n/a] |

| Model | Tasks | Opus none | Model none | Model gstack | Share of Opus gap closed [95% CI] | Resamples with a gap |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 10 | 47% | 43% | 30% | -400% [-60047995031606584%, 0%] | 58% |
| particle-1 | 10 | 47% | 53% | 63% | n/a [50%, 813%] | 29% |
| deepseek-v4.1-flash-1017 | 10 | 47% | 77% | 67% | n/a [n/a, n/a] | 0% |
| claude-haiku-5-5 | 10 | 47% | 50% | 40% | n/a [-900%, 250%] | 41% |

## Subset: native_5 (5 tasks)

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 5 | 15 | 80% [53%, 100%] | $1.05 | $0.09 | 0% | 0 | 0 | 0 |
| claude-sonnet-5-5 | gstack | 5 | 15 | 67% [27%, 100%] | $1.44 | $0.14 | 0% | 0 | 0 | 0 |
| claude-sonnet-5-5 | placebo | 5 | 15 | 73% [53%, 93%] | $1.38 | $0.13 | 0% | 0 | 0 | 0 |
| particle-1 | none | 5 | 15 | 67% [27%, 100%] | $1.08 | $0.11 | 0% | 1 | 0 | 0 |
| particle-1 | gstack | 5 | 15 | 60% [40%, 80%] | $1.32 | $0.15 | 0% | 1 | 2 | 0 |
| particle-1 | placebo | 5 | 15 | 80% [67%, 93%] | $0.92 | $0.08 | 0% | 0 | 1 | 0 |
| deepseek-v4.1-flash-1017 | none | 5 | 15 | 73% [47%, 100%] | $0.57 | $0.05 | 0% | 0 | 2 | 0 |
| deepseek-v4.1-flash-1017 | gstack | 5 | 15 | 67% [47%, 87%] | $1.07 | $0.11 | 0% | 0 | 2 | 0 |
| deepseek-v4.1-flash-1017 | placebo | 5 | 15 | 80% [53%, 100%] | $0.73 | $0.06 | 0% | 0 | 4 | 0 |
| claude-haiku-5-5 | none | 5 | 15 | 53% [20%, 87%] | $0.16 | $0.02 | 0% | 0 | 1 | 0 |
| claude-haiku-5-5 | gstack | 5 | 15 | 60% [40%, 80%] | $0.30 | $0.03 | 0% | 0 | 2 | 0 |
| claude-haiku-5-5 | placebo | 5 | 15 | 60% [27%, 93%] | $0.20 | $0.02 | 0% | 0 | 2 | 0 |
| claude-opus-5-5 | none | 5 | 15 | 100% [100%, 100%] | $2.70 | $0.18 | 0% | 0 | 1 | 0 |
| claude-opus-5-5 | gstack | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |
| claude-opus-5-5 | placebo | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |

| Model | Contrast | Paired tasks | Difference, pp [95% CI] |
|---|---|---|---|
| claude-sonnet-5-5 | gstack - none | 5 | -13 [-60, +20] |
| claude-sonnet-5-5 | gstack - placebo | 5 | -7 [-47, +33] |
| claude-sonnet-5-5 | placebo - none | 5 | -7 [-40, +27] |
| particle-1 | gstack - none | 5 | -7 [-47, +33] |
| particle-1 | gstack - placebo | 5 | -20 [-47, +0] |
| particle-1 | placebo - none | 5 | +13 [-27, +53] |
| deepseek-v4.1-flash-1017 | gstack - none | 5 | -7 [-27, +13] |
| deepseek-v4.1-flash-1017 | gstack - placebo | 5 | -13 [-33, +13] |
| deepseek-v4.1-flash-1017 | placebo - none | 5 | +7 [+0, +20] |
| claude-haiku-5-5 | gstack - none | 5 | +7 [-13, +27] |
| claude-haiku-5-5 | gstack - placebo | 5 | -0 [-20, +20] |
| claude-haiku-5-5 | placebo - none | 5 | +7 [+0, +20] |
| claude-opus-5-5 | gstack - none | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | gstack - placebo | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | placebo - none | 0 | n/a [n/a, n/a] |

| Model | Tasks | Opus none | Model none | Model gstack | Share of Opus gap closed [95% CI] | Resamples with a gap |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 5 | 100% | 80% | 67% | -67% [-500%, 100%] | 93% |
| particle-1 | 5 | 100% | 67% | 60% | -20% [-300%, 55%] | 92% |
| deepseek-v4.1-flash-1017 | 5 | 100% | 73% | 67% | -25% [-200%, 33%] | 92% |
| claude-haiku-5-5 | 5 | 100% | 53% | 60% | 14% [-100%, 43%] | 99% |

## Sensitivity: 2 paid trials without a verifier reward dropped

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 39 | 117 | 76% [64%, 86%] | $6.07 | $0.07 | 0% | 0 | 1 | 0 |
| claude-sonnet-5-5 | gstack | 39 | 117 | 74% [61%, 86%] | $10.51 | $0.12 | 0% | 0 | 3 | 0 |
| claude-sonnet-5-5 | placebo | 39 | 117 | 76% [63%, 87%] | $10.79 | $0.12 | 0% | 0 | 2 | 0 |
| particle-1 | none | 39 | 117 | 71% [58%, 84%] | $8.07 | $0.10 | 0% | 5 | 4 | 0 |
| particle-1 | gstack | 39 | 117 | 73% [62%, 83%] | n/a (1 missing) | n/a | 0% | 4 | 7 | 0 |
| particle-1 | placebo | 39 | 117 | 77% [66%, 87%] | $9.51 | $0.11 | 3% | 8 | 3 | 0 |
| deepseek-v4.1-flash-1017 | none | 39 | 117 | 81% [71%, 91%] | $7.22 | $0.08 | 0% | 4 | 7 | 0 |
| deepseek-v4.1-flash-1017 | gstack | 39 | 117 | 78% [67%, 87%] | $7.05 | $0.08 | 0% | 1 | 12 | 0 |
| deepseek-v4.1-flash-1017 | placebo | 39 | 117 | 79% [68%, 90%] | $7.90 | $0.08 | 3% | 4 | 15 | 0 |
| claude-haiku-5-5 | none | 39 | 116 | 78% [67%, 88%] | $1.00 | $0.01 | 0% | 0 | 3 | 0 |
| claude-haiku-5-5 | gstack | 39 | 117 | 72% [60%, 83%] | $1.81 | $0.02 | 0% | 0 | 4 | 0 |
| claude-haiku-5-5 | placebo | 39 | 116 | 77% [65%, 88%] | $1.68 | $0.02 | 0% | 0 | 3 | 0 |
| claude-opus-5-5 | none | 39 | 117 | 79% [68%, 91%] | $19.85 | $0.21 | 0% | 0 | 1 | 0 |
| claude-opus-5-5 | gstack | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |
| claude-opus-5-5 | placebo | 0 | 0 | n/a [n/a, n/a] | $0.00 | n/a | n/a | 0 | 0 | 0 |

| Model | Contrast | Paired tasks | Difference, pp [95% CI] |
|---|---|---|---|
| claude-sonnet-5-5 | gstack - none | 39 | -2 [-10, +6] |
| claude-sonnet-5-5 | gstack - placebo | 39 | -2 [-9, +5] |
| claude-sonnet-5-5 | placebo - none | 39 | +0 [-6, +6] |
| particle-1 | gstack - none | 39 | +2 [-7, +11] |
| particle-1 | gstack - placebo | 39 | -4 [-9, +0] |
| particle-1 | placebo - none | 39 | +6 [-2, +15] |
| deepseek-v4.1-flash-1017 | gstack - none | 39 | -3 [-11, +4] |
| deepseek-v4.1-flash-1017 | gstack - placebo | 39 | -2 [-8, +5] |
| deepseek-v4.1-flash-1017 | placebo - none | 39 | -2 [-9, +6] |
| claude-haiku-5-5 | gstack - none | 39 | -6 [-16, +5] |
| claude-haiku-5-5 | gstack - placebo | 39 | -5 [-12, +2] |
| claude-haiku-5-5 | placebo - none | 39 | -1 [-8, +7] |
| claude-opus-5-5 | gstack - none | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | gstack - placebo | 0 | n/a [n/a, n/a] |
| claude-opus-5-5 | placebo - none | 0 | n/a [n/a, n/a] |

| Model | Tasks | Opus none | Model none | Model gstack | Share of Opus gap closed [95% CI] | Resamples with a gap |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 39 | 79% | 76% | 74% | -50% [-1200%, 200%] | 76% |
| particle-1 | 39 | 79% | 71% | 73% | 20% [-200%, 200%] | 87% |
| deepseek-v4.1-flash-1017 | 39 | 79% | 81% | 78% | n/a [-11547691352231982%, 200%] | 39% |
| claude-haiku-5-5 | 39 | 79% | 78% | 72% | -350% [-2000%, 118%] | 60% |

{
  "skillCounts": {
    "deepseek-v4.1-flash-1017|gstack": {},
    "deepseek-v4.1-flash-1017|none": {},
    "claude-opus-5-5|none": {},
    "claude-sonnet-5-5|gstack": {},
    "claude-sonnet-5-5|none": {},
    "particle-1|none": {},
    "particle-1|gstack": {},
    "claude-haiku-5-5|gstack": {},
    "deepseek-v4.1-flash-1017|placebo": {
      "investigate": 3
    },
    "claude-haiku-5-5|none": {},
    "claude-sonnet-5-5|placebo": {},
    "claude-haiku-5-5|placebo": {},
    "particle-1|placebo": {
      "investigate": 3
    }
  },
  "infra": [],
  "noReward": [
    {
      "task": "model-extraction-relu-logits",
      "arm": "none",
      "model": "claude-haiku-5-5",
      "trial": "model-extraction-relu-logits__AW2iXEq",
      "reason": "AgentTimeoutError, no reward after a model response, scored 0 (evidence read from agent/)"
    },
    {
      "task": "torch-tensor-parallelism",
      "arm": "placebo",
      "model": "claude-haiku-5-5",
      "trial": "torch-tensor-parallelism__jjxjNEf",
      "reason": "VerifierTimeoutError, no reward after a model response, scored 0 (evidence read from agent/)"
    }
  ],
  "costMissing": [
    {
      "task": "pytorch-model-cli",
      "arm": "gstack",
      "model": "particle-1",
      "trial": "pytorch-model-cli__LLPXjm4",
      "reason": "agent timeout, graded (evidence read from agent/)"
    }
  ],
  "nTrials": 1521
}
