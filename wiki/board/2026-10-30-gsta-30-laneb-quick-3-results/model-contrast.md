### Cells

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost per success | Median tokens per trial | Median wall min per trial |
|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 39 | 117 | 76% [64%, 86%] | $0.07 | 87893 | 0.3 |
| claude-sonnet-5-5 | gstack | 39 | 117 | 74% [61%, 86%] | $0.12 | 146537 | 0.4 |
| claude-sonnet-5-5 | placebo | 39 | 117 | 76% [63%, 87%] | $0.12 | 146385 | 0.4 |
| particle-1 | none | 39 | 117 | 71% [58%, 84%] | $0.10 | 351604 | 1.6 |
| particle-1 | gstack | 39 | 117 | 73% [62%, 83%] | n/a | 553449 | 1.7 |
| particle-1 | placebo | 39 | 117 | 77% [66%, 87%] | $0.11 | 532499 | 2.0 |
| deepseek-v4.1-flash-1017 | none | 39 | 117 | 81% [71%, 91%] | $0.08 | 492113 | 2.5 |
| deepseek-v4.1-flash-1017 | gstack | 39 | 117 | 78% [67%, 87%] | $0.08 | 797892 | 2.9 |
| deepseek-v4.1-flash-1017 | placebo | 39 | 117 | 79% [68%, 90%] | $0.08 | 790182 | 2.9 |
| claude-haiku-5-5 | none | 39 | 117 | 77% [66%, 87%] | $0.01 | 163426 | 0.7 |
| claude-haiku-5-5 | gstack | 39 | 117 | 72% [60%, 83%] | $0.02 | 311412 | 1.0 |
| claude-haiku-5-5 | placebo | 39 | 117 | 77% [65%, 88%] | $0.02 | 294547 | 0.9 |
| claude-opus-5-5 | none | 39 | 117 | 79% [68%, 91%] | $0.21 | 114043 | 0.6 |

### Model pairs within each arm

| Arm | Contrast | Paired tasks | Model A | Model B | Difference, pp [95% CI] |
|---|---|---|---|---|---|
| none | particle-1 - deepseek-v4.1-flash-1017 | 39 | 71% | 81% | -10 [-20, -2] |
| none | claude-sonnet-5-5 - claude-haiku-5-5 | 39 | 76% | 77% | -1 [-15, +13] |
| gstack | particle-1 - deepseek-v4.1-flash-1017 | 39 | 73% | 78% | -5 [-13, +2] |
| gstack | claude-sonnet-5-5 - claude-haiku-5-5 | 39 | 74% | 72% | +3 [-11, +16] |
| placebo | particle-1 - deepseek-v4.1-flash-1017 | 39 | 77% | 79% | -3 [-9, +4] |
| placebo | claude-sonnet-5-5 - claude-haiku-5-5 | 39 | 76% | 77% | -1 [-15, +13] |

### Against claude-opus-5-5 none

| Contrast | Paired tasks | Cell | Reference | Difference, pp [95% CI] |
|---|---|---|---|---|
| claude-sonnet-5-5 none - claude-opus-5-5 none | 39 | 76% | 79% | -3 [-13, +6] |
| claude-sonnet-5-5 gstack - claude-opus-5-5 none | 39 | 74% | 79% | -5 [-15, +4] |
| claude-sonnet-5-5 placebo - claude-opus-5-5 none | 39 | 76% | 79% | -3 [-11, +5] |
| particle-1 none - claude-opus-5-5 none | 39 | 71% | 79% | -9 [-23, +6] |
| particle-1 gstack - claude-opus-5-5 none | 39 | 73% | 79% | -7 [-21, +7] |
| particle-1 placebo - claude-opus-5-5 none | 39 | 77% | 79% | -3 [-16, +11] |
| deepseek-v4.1-flash-1017 none - claude-opus-5-5 none | 39 | 81% | 79% | +2 [-10, +15] |
| deepseek-v4.1-flash-1017 gstack - claude-opus-5-5 none | 39 | 78% | 79% | -2 [-15, +12] |
| deepseek-v4.1-flash-1017 placebo - claude-opus-5-5 none | 39 | 79% | 79% | +0 [-14, +15] |
| claude-haiku-5-5 none - claude-opus-5-5 none | 39 | 77% | 79% | -3 [-15, +11] |
| claude-haiku-5-5 gstack - claude-opus-5-5 none | 39 | 72% | 79% | -8 [-21, +6] |
| claude-haiku-5-5 placebo - claude-opus-5-5 none | 39 | 77% | 79% | -3 [-17, +12] |

### Share of the claude-opus-5-5 gap closed by gstack

| Model | Tasks | Share [95% CI] | Resamples with a gap | claude-opus-5-5 none - model none, pp [95% CI] | Stability |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | 39 | -50% [-1200%, 200%] | 76% | +3 [-6, +13] | unstable |
| particle-1 | 39 | 20% [-200%, 200%] | 87% | +9 [-6, +23] | unstable |
| deepseek-v4.1-flash-1017 | 39 | n/a [-11547691352231982%, 200%] | 39% | -2 [-15, +10] | unstable |
| claude-haiku-5-5 | 39 | -200% [-1500%, 133%] | 64% | +3 [-11, +15] | unstable |

## Subset: original_20 (20 tasks)

### Cells

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost per success | Median tokens per trial | Median wall min per trial |
|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 20 | 60 | 62% [43%, 80%] | $0.11 | 89921 | 0.4 |
| claude-sonnet-5-5 | gstack | 20 | 60 | 52% [32%, 72%] | $0.19 | 147975 | 0.5 |
| claude-sonnet-5-5 | placebo | 20 | 60 | 55% [35%, 75%] | $0.18 | 146820 | 0.5 |
| particle-1 | none | 20 | 60 | 48% [30%, 67%] | $0.18 | 619952 | 3.2 |
| particle-1 | gstack | 20 | 60 | 55% [40%, 70%] | n/a | 851900 | 2.6 |
| particle-1 | placebo | 20 | 60 | 62% [45%, 77%] | $0.16 | 826538 | 3.0 |
| deepseek-v4.1-flash-1017 | none | 20 | 60 | 67% [50%, 82%] | $0.12 | 843734 | 5.3 |
| deepseek-v4.1-flash-1017 | gstack | 20 | 60 | 58% [42%, 73%] | $0.14 | 1291057 | 5.5 |
| deepseek-v4.1-flash-1017 | placebo | 20 | 60 | 65% [47%, 82%] | $0.13 | 1070257 | 5.8 |
| claude-haiku-5-5 | none | 20 | 60 | 57% [40%, 73%] | $0.02 | 212458 | 1.0 |
| claude-haiku-5-5 | gstack | 20 | 60 | 50% [32%, 67%] | $0.04 | 395699 | 1.6 |
| claude-haiku-5-5 | placebo | 20 | 60 | 58% [40%, 77%] | $0.03 | 350079 | 1.2 |
| claude-opus-5-5 | none | 20 | 60 | 67% [47%, 85%] | $0.31 | 128332 | 0.7 |

### Model pairs within each arm

| Arm | Contrast | Paired tasks | Model A | Model B | Difference, pp [95% CI] |
|---|---|---|---|---|---|
| none | particle-1 - deepseek-v4.1-flash-1017 | 20 | 48% | 67% | -18 [-33, -5] |
| none | claude-sonnet-5-5 - claude-haiku-5-5 | 20 | 62% | 57% | +5 [-22, +30] |
| gstack | particle-1 - deepseek-v4.1-flash-1017 | 20 | 55% | 58% | -3 [-15, +8] |
| gstack | claude-sonnet-5-5 - claude-haiku-5-5 | 20 | 52% | 50% | +2 [-25, +28] |
| placebo | particle-1 - deepseek-v4.1-flash-1017 | 20 | 62% | 65% | -3 [-13, +8] |
| placebo | claude-sonnet-5-5 - claude-haiku-5-5 | 20 | 55% | 58% | -3 [-28, +23] |

### Against claude-opus-5-5 none

| Contrast | Paired tasks | Cell | Reference | Difference, pp [95% CI] |
|---|---|---|---|---|
| claude-sonnet-5-5 none - claude-opus-5-5 none | 20 | 62% | 67% | -5 [-18, +7] |
| claude-sonnet-5-5 gstack - claude-opus-5-5 none | 20 | 52% | 67% | -15 [-30, -2] |
| claude-sonnet-5-5 placebo - claude-opus-5-5 none | 20 | 55% | 67% | -12 [-22, -2] |
| particle-1 none - claude-opus-5-5 none | 20 | 48% | 67% | -18 [-43, +7] |
| particle-1 gstack - claude-opus-5-5 none | 20 | 55% | 67% | -12 [-32, +10] |
| particle-1 placebo - claude-opus-5-5 none | 20 | 62% | 67% | -5 [-27, +17] |
| deepseek-v4.1-flash-1017 none - claude-opus-5-5 none | 20 | 67% | 67% | +0 [-20, +22] |
| deepseek-v4.1-flash-1017 gstack - claude-opus-5-5 none | 20 | 58% | 67% | -8 [-30, +15] |
| deepseek-v4.1-flash-1017 placebo - claude-opus-5-5 none | 20 | 65% | 67% | -2 [-25, +22] |
| claude-haiku-5-5 none - claude-opus-5-5 none | 20 | 57% | 67% | -10 [-33, +13] |
| claude-haiku-5-5 gstack - claude-opus-5-5 none | 20 | 50% | 67% | -17 [-40, +8] |
| claude-haiku-5-5 placebo - claude-opus-5-5 none | 20 | 58% | 67% | -8 [-33, +17] |

### Share of the claude-opus-5-5 gap closed by gstack

| Model | Tasks | Share [95% CI] | Resamples with a gap | claude-opus-5-5 none - model none, pp [95% CI] | Stability |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | 20 | -200% [-1200%, 14%] | 74% | +5 [-7, +18] | unstable |
| particle-1 | 20 | 36% [-125%, 200%] | 92% | +18 [-7, +43] | unstable |
| deepseek-v4.1-flash-1017 | 20 | n/a [-1100%, 100%] | 48% | 0 [-22, +20] | unstable |
| claude-haiku-5-5 | 20 | -67% [-800%, 120%] | 80% | +10 [-13, +33] | unstable |

## Subset: added_20 (19 tasks)

### Cells

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost per success | Median tokens per trial | Median wall min per trial |
|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 19 | 57 | 91% [82%, 98%] | $0.04 | 87380 | 0.3 |
| claude-sonnet-5-5 | gstack | 19 | 57 | 98% [95%, 100%] | $0.08 | 142127 | 0.4 |
| claude-sonnet-5-5 | placebo | 19 | 57 | 98% [95%, 100%] | $0.09 | 144379 | 0.4 |
| particle-1 | none | 19 | 57 | 95% [84%, 100%] | $0.05 | 175502 | 0.8 |
| particle-1 | gstack | 19 | 57 | 91% [79%, 100%] | $0.06 | 381070 | 1.0 |
| particle-1 | placebo | 19 | 57 | 93% [81%, 100%] | $0.07 | 315487 | 0.8 |
| deepseek-v4.1-flash-1017 | none | 19 | 57 | 96% [91%, 100%] | $0.04 | 316700 | 1.3 |
| deepseek-v4.1-flash-1017 | gstack | 19 | 57 | 98% [95%, 100%] | $0.04 | 418965 | 1.5 |
| deepseek-v4.1-flash-1017 | placebo | 19 | 57 | 95% [86%, 100%] | $0.05 | 440801 | 1.4 |
| claude-haiku-5-5 | none | 19 | 57 | 98% [95%, 100%] | $0.01 | 135660 | 0.5 |
| claude-haiku-5-5 | gstack | 19 | 57 | 95% [89%, 100%] | $0.01 | 256103 | 0.6 |
| claude-haiku-5-5 | placebo | 19 | 57 | 96% [91%, 100%] | $0.01 | 243390 | 0.6 |
| claude-opus-5-5 | none | 19 | 57 | 93% [81%, 100%] | $0.14 | 108916 | 0.5 |

### Model pairs within each arm

| Arm | Contrast | Paired tasks | Model A | Model B | Difference, pp [95% CI] |
|---|---|---|---|---|---|
| none | particle-1 - deepseek-v4.1-flash-1017 | 19 | 95% | 96% | -2 [-11, +5] |
| none | claude-sonnet-5-5 - claude-haiku-5-5 | 19 | 91% | 98% | -7 [-16, +0] |
| gstack | particle-1 - deepseek-v4.1-flash-1017 | 19 | 91% | 98% | -7 [-16, +0] |
| gstack | claude-sonnet-5-5 - claude-haiku-5-5 | 19 | 98% | 95% | +4 [-4, +11] |
| placebo | particle-1 - deepseek-v4.1-flash-1017 | 19 | 93% | 95% | -2 [-11, +5] |
| placebo | claude-sonnet-5-5 - claude-haiku-5-5 | 19 | 98% | 96% | +2 [-4, +7] |

### Against claude-opus-5-5 none

| Contrast | Paired tasks | Cell | Reference | Difference, pp [95% CI] |
|---|---|---|---|---|
| claude-sonnet-5-5 none - claude-opus-5-5 none | 19 | 91% | 93% | -2 [-14, +12] |
| claude-sonnet-5-5 gstack - claude-opus-5-5 none | 19 | 98% | 93% | +5 [-4, +18] |
| claude-sonnet-5-5 placebo - claude-opus-5-5 none | 19 | 98% | 93% | +5 [-4, +18] |
| particle-1 none - claude-opus-5-5 none | 19 | 95% | 93% | +2 [-14, +18] |
| particle-1 gstack - claude-opus-5-5 none | 19 | 91% | 93% | -2 [-18, +14] |
| particle-1 placebo - claude-opus-5-5 none | 19 | 93% | 93% | 0 [-16, +16] |
| deepseek-v4.1-flash-1017 none - claude-opus-5-5 none | 19 | 96% | 93% | +4 [-7, +18] |
| deepseek-v4.1-flash-1017 gstack - claude-opus-5-5 none | 19 | 98% | 93% | +5 [-4, +18] |
| deepseek-v4.1-flash-1017 placebo - claude-opus-5-5 none | 19 | 95% | 93% | +2 [-11, +16] |
| claude-haiku-5-5 none - claude-opus-5-5 none | 19 | 98% | 93% | +5 [-4, +18] |
| claude-haiku-5-5 gstack - claude-opus-5-5 none | 19 | 95% | 93% | +2 [-7, +14] |
| claude-haiku-5-5 placebo - claude-opus-5-5 none | 19 | 96% | 93% | +4 [-7, +18] |

### Share of the claude-opus-5-5 gap closed by gstack

| Model | Tasks | Share [95% CI] | Resamples with a gap | claude-opus-5-5 none - model none, pp [95% CI] | Stability |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | 19 | 400% [50%, 7901051977842950%] | 58% | +2 [-12, +14] | unstable |
| particle-1 | 19 | n/a [-300%, 0%] | 33% | -2 [-18, +14] | unstable |
| deepseek-v4.1-flash-1017 | 19 | n/a [0%, 7901051977843050%] | 27% | -4 [-18, +7] | unstable |
| claude-haiku-5-5 | 19 | n/a [-23703155933528900%, 0%] | 15% | -5 [-18, +4] | unstable |

## Subset: tier_a (10 tasks)

### Cells

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost per success | Median tokens per trial | Median wall min per trial |
|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 10 | 30 | 43% [20%, 70%] | $0.15 | 65145 | 0.4 |
| claude-sonnet-5-5 | gstack | 10 | 30 | 30% [10%, 57%] | $0.35 | 146925 | 0.5 |
| claude-sonnet-5-5 | placebo | 10 | 30 | 37% [13%, 63%] | $0.29 | 144399 | 0.5 |
| particle-1 | none | 10 | 30 | 53% [27%, 80%] | $0.15 | 546256 | 2.3 |
| particle-1 | gstack | 10 | 30 | 63% [40%, 87%] | $0.12 | 687949 | 1.7 |
| particle-1 | placebo | 10 | 30 | 67% [43%, 87%] | $0.16 | 908715 | 3.1 |
| deepseek-v4.1-flash-1017 | none | 10 | 30 | 77% [53%, 97%] | $0.12 | 575933 | 4.1 |
| deepseek-v4.1-flash-1017 | gstack | 10 | 30 | 67% [43%, 87%] | $0.12 | 985176 | 5.1 |
| deepseek-v4.1-flash-1017 | placebo | 10 | 30 | 70% [43%, 93%] | $0.13 | 925090 | 4.2 |
| claude-haiku-5-5 | none | 10 | 30 | 50% [23%, 77%] | $0.03 | 194436 | 1.1 |
| claude-haiku-5-5 | gstack | 10 | 30 | 40% [17%, 67%] | $0.04 | 356561 | 1.6 |
| claude-haiku-5-5 | placebo | 10 | 30 | 53% [27%, 80%] | $0.04 | 352093 | 1.9 |
| claude-opus-5-5 | none | 10 | 30 | 47% [20%, 73%] | $0.51 | 96898 | 0.6 |

### Model pairs within each arm

| Arm | Contrast | Paired tasks | Model A | Model B | Difference, pp [95% CI] |
|---|---|---|---|---|---|
| none | particle-1 - deepseek-v4.1-flash-1017 | 10 | 53% | 77% | -23 [-47, -3] |
| none | claude-sonnet-5-5 - claude-haiku-5-5 | 10 | 43% | 50% | -7 [-47, +30] |
| gstack | particle-1 - deepseek-v4.1-flash-1017 | 10 | 63% | 67% | -3 [-20, +13] |
| gstack | claude-sonnet-5-5 - claude-haiku-5-5 | 10 | 30% | 40% | -10 [-47, +27] |
| placebo | particle-1 - deepseek-v4.1-flash-1017 | 10 | 67% | 70% | -3 [-13, +7] |
| placebo | claude-sonnet-5-5 - claude-haiku-5-5 | 10 | 37% | 53% | -17 [-53, +23] |

### Against claude-opus-5-5 none

| Contrast | Paired tasks | Cell | Reference | Difference, pp [95% CI] |
|---|---|---|---|---|
| claude-sonnet-5-5 none - claude-opus-5-5 none | 10 | 43% | 47% | -3 [-23, +17] |
| claude-sonnet-5-5 gstack - claude-opus-5-5 none | 10 | 30% | 47% | -17 [-43, +7] |
| claude-sonnet-5-5 placebo - claude-opus-5-5 none | 10 | 37% | 47% | -10 [-23, +3] |
| particle-1 none - claude-opus-5-5 none | 10 | 53% | 47% | +7 [-23, +33] |
| particle-1 gstack - claude-opus-5-5 none | 10 | 63% | 47% | +17 [-3, +40] |
| particle-1 placebo - claude-opus-5-5 none | 10 | 67% | 47% | +20 [+0, +43] |
| deepseek-v4.1-flash-1017 none - claude-opus-5-5 none | 10 | 77% | 47% | +30 [+10, +57] |
| deepseek-v4.1-flash-1017 gstack - claude-opus-5-5 none | 10 | 67% | 47% | +20 [-3, +50] |
| deepseek-v4.1-flash-1017 placebo - claude-opus-5-5 none | 10 | 70% | 47% | +23 [+0, +50] |
| claude-haiku-5-5 none - claude-opus-5-5 none | 10 | 50% | 47% | +3 [-33, +40] |
| claude-haiku-5-5 gstack - claude-opus-5-5 none | 10 | 40% | 47% | -7 [-40, +27] |
| claude-haiku-5-5 placebo - claude-opus-5-5 none | 10 | 53% | 47% | +7 [-33, +43] |

### Share of the claude-opus-5-5 gap closed by gstack

| Model | Tasks | Share [95% CI] | Resamples with a gap | claude-opus-5-5 none - model none, pp [95% CI] | Stability |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | 10 | -400% [-60047995031606584%, 0%] | 58% | +3 [-17, +23] | unstable |
| particle-1 | 10 | n/a [50%, 813%] | 29% | -7 [-33, +23] | unstable |
| deepseek-v4.1-flash-1017 | 10 | n/a [n/a, n/a] | 0% | -30 [-57, -10] | unstable |
| claude-haiku-5-5 | 10 | n/a [-900%, 250%] | 41% | -3 [-40, +33] | unstable |

## Subset: native_5 (5 tasks)

### Cells

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost per success | Median tokens per trial | Median wall min per trial |
|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 5 | 15 | 80% [53%, 100%] | $0.09 | 125894 | 0.9 |
| claude-sonnet-5-5 | gstack | 5 | 15 | 67% [27%, 100%] | $0.14 | 199169 | 0.8 |
| claude-sonnet-5-5 | placebo | 5 | 15 | 73% [53%, 93%] | $0.13 | 195974 | 1.4 |
| particle-1 | none | 5 | 15 | 67% [27%, 100%] | $0.11 | 520880 | 2.5 |
| particle-1 | gstack | 5 | 15 | 60% [40%, 80%] | $0.15 | 794134 | 3.9 |
| particle-1 | placebo | 5 | 15 | 80% [67%, 93%] | $0.08 | 497257 | 2.9 |
| deepseek-v4.1-flash-1017 | none | 5 | 15 | 73% [47%, 100%] | $0.05 | 798066 | 3.9 |
| deepseek-v4.1-flash-1017 | gstack | 5 | 15 | 67% [47%, 87%] | $0.11 | 1653362 | 6.2 |
| deepseek-v4.1-flash-1017 | placebo | 5 | 15 | 80% [53%, 100%] | $0.06 | 807015 | 3.1 |
| claude-haiku-5-5 | none | 5 | 15 | 53% [20%, 87%] | $0.02 | 318303 | 1.8 |
| claude-haiku-5-5 | gstack | 5 | 15 | 60% [40%, 80%] | $0.03 | 465898 | 3.6 |
| claude-haiku-5-5 | placebo | 5 | 15 | 60% [27%, 93%] | $0.02 | 435206 | 2.7 |
| claude-opus-5-5 | none | 5 | 15 | 100% [100%, 100%] | $0.18 | 194173 | 2.2 |

### Model pairs within each arm

| Arm | Contrast | Paired tasks | Model A | Model B | Difference, pp [95% CI] |
|---|---|---|---|---|---|
| none | particle-1 - deepseek-v4.1-flash-1017 | 5 | 67% | 73% | -7 [-20, +0] |
| none | claude-sonnet-5-5 - claude-haiku-5-5 | 5 | 80% | 53% | +27 [-33, +80] |
| gstack | particle-1 - deepseek-v4.1-flash-1017 | 5 | 60% | 67% | -7 [-33, +20] |
| gstack | claude-sonnet-5-5 - claude-haiku-5-5 | 5 | 67% | 60% | +7 [-40, +47] |
| placebo | particle-1 - deepseek-v4.1-flash-1017 | 5 | 80% | 80% | 0 [-27, +33] |
| placebo | claude-sonnet-5-5 - claude-haiku-5-5 | 5 | 73% | 60% | +13 [-13, +47] |

### Against claude-opus-5-5 none

| Contrast | Paired tasks | Cell | Reference | Difference, pp [95% CI] |
|---|---|---|---|---|
| claude-sonnet-5-5 none - claude-opus-5-5 none | 5 | 80% | 100% | -20 [-47, +0] |
| claude-sonnet-5-5 gstack - claude-opus-5-5 none | 5 | 67% | 100% | -33 [-73, +0] |
| claude-sonnet-5-5 placebo - claude-opus-5-5 none | 5 | 73% | 100% | -27 [-47, -7] |
| particle-1 none - claude-opus-5-5 none | 5 | 67% | 100% | -33 [-73, +0] |
| particle-1 gstack - claude-opus-5-5 none | 5 | 60% | 100% | -40 [-60, -20] |
| particle-1 placebo - claude-opus-5-5 none | 5 | 80% | 100% | -20 [-33, -7] |
| deepseek-v4.1-flash-1017 none - claude-opus-5-5 none | 5 | 73% | 100% | -27 [-53, +0] |
| deepseek-v4.1-flash-1017 gstack - claude-opus-5-5 none | 5 | 67% | 100% | -33 [-53, -13] |
| deepseek-v4.1-flash-1017 placebo - claude-opus-5-5 none | 5 | 80% | 100% | -20 [-47, +0] |
| claude-haiku-5-5 none - claude-opus-5-5 none | 5 | 53% | 100% | -47 [-80, -13] |
| claude-haiku-5-5 gstack - claude-opus-5-5 none | 5 | 60% | 100% | -40 [-60, -20] |
| claude-haiku-5-5 placebo - claude-opus-5-5 none | 5 | 60% | 100% | -40 [-73, -7] |

### Share of the claude-opus-5-5 gap closed by gstack

| Model | Tasks | Share [95% CI] | Resamples with a gap | claude-opus-5-5 none - model none, pp [95% CI] | Stability |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | 5 | -67% [-500%, 100%] | 93% | +20 [+0, +47] | unstable |
| particle-1 | 5 | -20% [-300%, 55%] | 92% | +33 [+0, +73] | unstable |
| deepseek-v4.1-flash-1017 | 5 | -25% [-200%, 33%] | 92% | +27 [+0, +53] | unstable |
| claude-haiku-5-5 | 5 | 14% [-100%, 43%] | 99% | +47 [+13, +80] | stable |
