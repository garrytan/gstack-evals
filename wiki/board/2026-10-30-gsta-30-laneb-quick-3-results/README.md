---
id: 2026-10-30-gsta-30-laneb-quick-3-results
kind: finding
title: "Lane B quick look 3 results: gstack's invoked body beats placebo on none of Sonnet 5.5, particle-1, DeepSeek V4.1 Flash and Haiku 5.5"
summary: "On 39 TB2 tasks the invoked gstack /investigate body loaded every time and trailed a length-matched placebo by 2 to 5 points on all four models. Exploratory."
author: GSTA-30
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: open
links:
  - 2026-10-29-gsta-30-laneb-quick-3-prereg
  - 2026-10-29-gsta-12-laneb-quick-2-results
  - 2026-10-29-gsta-30-laneb-quick-2-body-load-correction
  - https://github.com/garrytan/gstack-evals/pull/46
  - https://github.com/garrytan/gstack-evals/tree/laneb-quick-3-runner
  - quick/laneb/analysis/
attachments:
  - 0ec5db6c4ca273f6ea576a1f3c41a334fbcac5d50acc728ea2601a858782e6f9  analysis-config.md
  - 60842cde0710be252f671d9438683ba9fd47321f2176f1c2348210a5d6a098c9  analyze.md
  - 9d7f42f736c86553582d4c33ddafac1676f2cb435b158be99f527179c3f24766  manip.md
  - e40eae9b2a9184e738723c06f4bf493aab00ad03dd1d06d0a710a28c6d583750  mechanism.md
  - 7b1e3dc3f64ab38a06ae2362b56115762121b4b20a36c3779786838b2c30e136  model-contrast.md
  - 5549d09fe71912979bd5ce3db05303dca033044ed56333edb081e80df75a654a  placebo-counts.md
---
# Lane B quick look 3 results: Sonnet 5.5, particle-1, DeepSeek V4.1 Flash and Haiku 5.5, with an Opus 5.5 reference

Thread GEVA-30 (first named GSTA-30; the Ubicloud owner tag and ledger prefixes still say GSTA-30 and laneb3), for the gstack-evals Captain (GSTA-2). Exploratory run, preregistered in [2026-10-29-gsta-30-laneb-quick-3-prereg](../../plans/2026-10-29-gsta-30-laneb-quick-3-prereg.md) (PR #46, prereg commit 82cda7db), runner tag `laneb-quick-3-runner` at 9c4e2121. The numbers steer gstack's research and support no public claim.

## Headline

gstack's invoked `/investigate` body does not beat a length-matched placebo on any of the four models. The body loaded on every invoked session, so this is a test of the body's content, and the content lost. gstack minus placebo is -2 points on Sonnet 5.5, -4 on particle-1, -2 on DeepSeek V4.1 Flash and -5 on Haiku 5.5, on 39 tasks with three replicates. Every interval spans zero except particle-1's, whose upper end is zero. Against no skills, gstack is within a few points either way on every model, and no interval excludes zero.

Quick look 2's Haiku loss to placebo (-20 [-28, -12]) does not repeat by the preregistered rule: on the original 20 tasks this run's figure is -8 [-22, +5], which is not wholly below zero. particle-1 trails DeepSeek V4.1 Flash with no skills by 10 points [-20, -2] and costs more per success, despite using fewer tokens. Opus 5.5 with no skills passes 79%, and every cheaper model's cells sit within intervals that include Opus's rate, so these tasks leave little room for the ladder question, and every share of the Opus gap closed is unstable.

## What ran

- 39 tasks: the preregistered 40 minus crack-7z-hash, dropped by the in-run oracle rule with no swap (see Deviations). The original 20 are quick look 2's tasks; the added set has 19 tasks.
- 13 cells per task: Sonnet 5.5, particle-1, DeepSeek V4.1 Flash and Haiku 5.5 on none, gstack and placebo, plus Opus 5.5 on none. Three replicates: job laneb3-r1 (507 trials, one attempt) and job laneb3-r23 (1,014 trials, two attempts), 1,521 trials in total.
- Two trials of laneb3-r23 were infrastructure under the Failure handling rule and were rerun once in job laneb3-r23x. Both reruns got model responses and graded. So every cell has 117 graded trials.
- Arms are the pinned tars: none `8bab4833...`, placebo `ff6b909d...`, gstack `b9399468...` (the rebuilt arm the prereg records). Every job manifest records these digests.
- Analysis: `analyze.ts` and `model-contrast.ts` with [analysis-config.md](analysis-config.md), `manip.ts`, `placebo-behavior.ts` and `audit.py`, task-clustered bootstrap with 10,000 resamples and seed 20261028. Full outputs: [analyze.md](analyze.md), [model-contrast.md](model-contrast.md), [manip.md](manip.md), [placebo-counts.md](placebo-counts.md), [mechanism.md](mechanism.md).

## Manipulation check: the body loaded every time

Every invoked session loaded its body: 234 of 234 for Sonnet, Haiku and DeepSeek, and 233 of 233 for particle-1 (its one missing session is pytorch-model-cli__LLPXjm4, whose row was never written, see Integrity). The pilot loaded 10 of 10 for both Sonnet and particle-1. Median first-request prompt tokens rise from about 20,600 (none) to about 34,300 (gstack) and 34,500 (placebo) on the Claude models, and from about 58,000 to 93,500 (gstack) and 105,500 (placebo) on particle-1 and DeepSeek, whose counts run higher for the same arms. Opus 5.5 has no invoked arm, so `manip.ts` lists it as not measuring skill bodies, by construction. Details: [manip.md](manip.md).

## Primary: gstack minus placebo, and the secondary arm contrasts

Paired by task, percentage points with 95% intervals. All 39 tasks:

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

Original 20 tasks:

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

The primary contrast is negative on every model on both task sets. None is clearly positive, so the prereg's "gstack's body helps that model" branch does not apply to any rung.

## Pass rates, cost and failure lines

All 39 tasks. Cost comes only from the proxy's session rows. "Budget stops" are session-cap stops; "Timeouts" are agent timeouts, graded as they stand.

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 39 | 117 | 76% [64%, 86%] | $0.07 | 0% | 0 | 1 | 0 |
| claude-sonnet-5-5 | gstack | 39 | 117 | 74% [61%, 86%] | $0.12 | 0% | 0 | 3 | 0 |
| claude-sonnet-5-5 | placebo | 39 | 117 | 76% [63%, 87%] | $0.12 | 0% | 0 | 2 | 0 |
| particle-1 | none | 39 | 117 | 71% [58%, 84%] | $0.10 | 0% | 5 | 4 | 0 |
| particle-1 | gstack | 39 | 117 | 73% [62%, 83%] | n/a | 0% | 4 | 7 | 0 |
| particle-1 | placebo | 39 | 117 | 77% [66%, 87%] | $0.11 | 3% | 8 | 3 | 0 |
| deepseek-v4.1-flash-1017 | none | 39 | 117 | 81% [71%, 91%] | $0.08 | 0% | 4 | 7 | 0 |
| deepseek-v4.1-flash-1017 | gstack | 39 | 117 | 78% [67%, 87%] | $0.08 | 0% | 1 | 12 | 0 |
| deepseek-v4.1-flash-1017 | placebo | 39 | 117 | 79% [68%, 90%] | $0.08 | 3% | 4 | 15 | 0 |
| claude-haiku-5-5 | none | 39 | 117 | 77% [66%, 87%] | $0.01 | 0% | 0 | 4 | 1 |
| claude-haiku-5-5 | gstack | 39 | 117 | 72% [60%, 83%] | $0.02 | 0% | 0 | 4 | 0 |
| claude-haiku-5-5 | placebo | 39 | 117 | 77% [65%, 88%] | $0.02 | 0% | 0 | 3 | 1 |
| claude-opus-5-5 | none | 39 | 117 | 79% [68%, 91%] | $0.21 | 0% | 0 | 1 | 0 |

particle-1 gstack shows n/a because one trial, pytorch-model-cli__LLPXjm4, has no session row (Integrity). Over its other 116 trials, its cost per success is $0.10 ([mechanism.md](mechanism.md)).

Original 20 tasks:

| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | none | 20 | 60 | 62% [43%, 80%] | $0.11 | 0% | 0 | 1 | 0 |
| claude-sonnet-5-5 | gstack | 20 | 60 | 52% [32%, 72%] | $0.19 | 0% | 0 | 3 | 0 |
| claude-sonnet-5-5 | placebo | 20 | 60 | 55% [35%, 75%] | $0.18 | 0% | 0 | 2 | 0 |
| particle-1 | none | 20 | 60 | 48% [30%, 67%] | $0.18 | 0% | 2 | 4 | 0 |
| particle-1 | gstack | 20 | 60 | 55% [40%, 70%] | n/a | 0% | 3 | 6 | 0 |
| particle-1 | placebo | 20 | 60 | 62% [45%, 77%] | $0.16 | 5% | 4 | 1 | 0 |
| deepseek-v4.1-flash-1017 | none | 20 | 60 | 67% [50%, 82%] | $0.12 | 0% | 3 | 5 | 0 |
| deepseek-v4.1-flash-1017 | gstack | 20 | 60 | 58% [42%, 73%] | $0.14 | 0% | 1 | 8 | 0 |
| deepseek-v4.1-flash-1017 | placebo | 20 | 60 | 65% [47%, 82%] | $0.13 | 5% | 2 | 11 | 0 |
| claude-haiku-5-5 | none | 20 | 60 | 57% [40%, 73%] | $0.02 | 0% | 0 | 4 | 1 |
| claude-haiku-5-5 | gstack | 20 | 60 | 50% [32%, 67%] | $0.04 | 0% | 0 | 4 | 0 |
| claude-haiku-5-5 | placebo | 20 | 60 | 58% [40%, 77%] | $0.03 | 0% | 0 | 3 | 1 |
| claude-opus-5-5 | none | 20 | 60 | 67% [47%, 85%] | $0.31 | 0% | 0 | 1 | 0 |

Failure lines:

- Safeguard refusals: the proxy refused requests for two reasons only, session caps (54 in laneb3-r1, 108 in laneb3-r23, all in particle-1 and DeepSeek cells) and one server-tools request in laneb3-r23. The audit has no category for model safeguard refusals, so none are reported.
- Session-cap stops per cell: in the Budget stops column. Sonnet, Haiku and Opus had none.
- Upstream errors: one in laneb3-r1, none in laneb3-r23.
- Agent timeouts per cell: in the Timeouts column; DeepSeek has the most (7, 12 and 15 of 117).
- Two paid trials had no reward after a model response and score 0: model-extraction-relu-logits__AW2iXEq (Haiku none, agent timeout) and torch-tensor-parallelism__jjxjNEf (Haiku placebo, verifier timeout). Dropping them instead moves Haiku's gstack minus none from -5 to -6 and placebo minus none from +0 to -1, and leaves gstack minus placebo at -5 [-12, +2].
- Cap sensitivity: dropping tasks with a session-cap stop in every arm of a model removes extract-elf and largest-eigenval for particle-1 (gstack minus placebo -5 [-10, +0]) and filter-js-from-html for DeepSeek (-2 [-8, +5]). No other model has such a task.

The Mechanism table (agent-timeout share, median requests per trial, cost per success) is in [mechanism.md](mechanism.md); median tokens per trial are in the model comparison below. The gstack and placebo arms cost 65% to 78% more than none on Sonnet and Haiku, from the longer prompt, and up to 18% more on particle-1 and DeepSeek. DeepSeek's agent-timeout share rises from 6% (none) to 10% (gstack) and 13% (placebo).

Subsets (native-5 and tier A) are in [analyze.md](analyze.md), with wide intervals and no claim.

## Haiku check

Haiku's gstack minus placebo is -8 [-22, +5] on the original 20 and -5 [-12, +2] on all 39. Quick look 2's -20 [-28, -12] holds only if this run's original-20 interval is wholly below zero, and it is not. So quick look 2's 20-point loss was at least partly day-to-day noise. Haiku's gstack arm still has the lowest point estimate of its three arms on both task sets.

## particle-1 beside DeepSeek V4.1 Flash

Same day, same jobs, paired by task. particle-1 minus DeepSeek is -10 [-20, -2] with no skills, -5 [-13, +2] with gstack and -3 [-9, +4] with placebo. particle-1 uses fewer tokens per trial (median 352k vs 492k with no skills) but its cache reads cost five times DeepSeek's, so its cost per success is higher ($0.10 to $0.11 vs $0.08). By the prereg's rule, particle-1's token savings come at a cost in passes, and DeepSeek stays the cheaper rung to carry forward.

## Model comparison (secondary, exploratory)

All 39 tasks. Median tokens are billed tokens (input, both cache writes, cache reads and output) summed over the trial's proxy sessions. No parity or ranking claim is made.

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

The wall-time column is the agent's own `wall_s` from its summary, which is what the pinned `model-contrast.ts` reads. The prereg's text says "from the trial's own start and finish times". Measured that way, which adds environment start and the verifier, the medians over the 1,521 grid trials are 1.1 to 1.2 minutes for Sonnet and Opus, 1.7 to 2.0 for Haiku, 2.6 to 2.8 for particle-1 and 3.6 to 3.9 for DeepSeek. The order of the models is the same either way.

Paired by task within each arm:

| Arm | Contrast | Paired tasks | Model A | Model B | Difference, pp [95% CI] |
|---|---|---|---|---|---|
| none | particle-1 - deepseek-v4.1-flash-1017 | 39 | 71% | 81% | -10 [-20, -2] |
| none | claude-sonnet-5-5 - claude-haiku-5-5 | 39 | 76% | 77% | -1 [-15, +13] |
| gstack | particle-1 - deepseek-v4.1-flash-1017 | 39 | 73% | 78% | -5 [-13, +2] |
| gstack | claude-sonnet-5-5 - claude-haiku-5-5 | 39 | 74% | 72% | +3 [-11, +16] |
| placebo | particle-1 - deepseek-v4.1-flash-1017 | 39 | 77% | 79% | -3 [-9, +4] |
| placebo | claude-sonnet-5-5 - claude-haiku-5-5 | 39 | 76% | 77% | -1 [-15, +13] |

Every cell minus Opus 5.5 none:

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

Share of the Opus gap closed by gstack, (C gstack minus C none) over (Opus none minus C none), with the denominator's interval. A share is unstable wherever that interval does not lie wholly above zero.

| Model | Tasks | Share [95% CI] | Resamples with a gap | claude-opus-5-5 none - model none, pp [95% CI] | Stability |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | 39 | -50% [-1200%, 200%] | 76% | +3 [-6, +13] | unstable |
| particle-1 | 39 | 20% [-200%, 200%] | 87% | +9 [-6, +23] | unstable |
| deepseek-v4.1-flash-1017 | 39 | n/a [-11547691352231982%, 200%] | 39% | -2 [-15, +10] | unstable |
| claude-haiku-5-5 | 39 | -200% [-1500%, 133%] | 64% | +3 [-11, +15] | unstable |

Original 20:

| Model | Tasks | Share [95% CI] | Resamples with a gap | claude-opus-5-5 none - model none, pp [95% CI] | Stability |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | 20 | -200% [-1200%, 14%] | 74% | +5 [-7, +18] | unstable |
| particle-1 | 20 | 36% [-125%, 200%] | 92% | +18 [-7, +43] | unstable |
| deepseek-v4.1-flash-1017 | 20 | n/a [-1100%, 100%] | 48% | 0 [-22, +20] | unstable |
| claude-haiku-5-5 | 20 | -67% [-800%, 120%] | 80% | +10 [-13, +33] | unstable |

Every share is unstable on both task sets, so none is read. On all 39 tasks DeepSeek with no skills has a higher point estimate than Opus with no skills, so it has no gap to close.

The original-20 versions of every table are in [model-contrast.md](model-contrast.md).

## Beside quick look 2 (original 20, different day)

Quick look 2 ran these 20 tasks with the same harness, three replicates per cell (60 trials). The two runs are on different days, so read the columns side by side, not as a contrast.

| Cell | Quick look 2 pass rate | Quick look 3 pass rate |
|---|---|---|
| Opus 5.5 none | 72% [53%, 88%] | 67% [47%, 85%] |
| Haiku 5.5 none | 47% [30%, 63%] | 57% [40%, 73%] |
| Haiku 5.5 gstack | 43% [25%, 62%] | 50% [32%, 67%] |
| Haiku 5.5 placebo | 63% [48%, 78%] | 58% [40%, 77%] |
| DeepSeek V4.1 Flash none | 53% [33%, 72%] | 67% [50%, 82%] |
| DeepSeek V4.1 Flash gstack | 60% [43%, 75%] | 58% [42%, 73%] |
| DeepSeek V4.1 Flash placebo | 67% [53%, 80%] | 65% [47%, 82%] |

Quick look 2's lift for a long body on the cheap models (placebo over none) does not show here: placebo minus none is +2 on Haiku and -2 on DeepSeek on the original 20.

## Placebo-behavior coding

Quick look 2's unit, categories and regexes, no model judges. Counts are in [placebo-counts.md](placebo-counts.md); quoted windows stay out of the repo. Almost every invoked trial codes as "continues": the model starts on the task. Sonnet is the exception, with 3 "ends" in each of gstack and placebo and 2 "dismisses" in gstack.

## Integrity

`audit.py` ran on the pilot and on every grid job. Flag counts per cell, summed over laneb3-r1, laneb3-r23 and laneb3-r23x:

| Cell | network_bypass | offlist_attempt | offlist_unclear | pypi_direct | solution_seeking | bench_package |
|---|---|---|---|---|---|---|
| claude-haiku-5-5/gstack | 0 | 1 | 1 | 9 | 5 | 0 |
| claude-haiku-5-5/none | 0 | 1 | 1 | 5 | 5 | 0 |
| claude-haiku-5-5/placebo | 0 | 2 | 2 | 8 | 3 | 0 |
| claude-opus-5-5/none | 0 | 3 | 3 | 2 | 4 | 0 |
| claude-sonnet-5-5/gstack | 0 | 0 | 0 | 5 | 1 | 0 |
| claude-sonnet-5-5/none | 0 | 0 | 0 | 2 | 0 | 0 |
| claude-sonnet-5-5/placebo | 0 | 0 | 0 | 3 | 0 | 0 |
| deepseek-v4.1-flash-1017/gstack | 0 | 14 | 14 | 7 | 13 | 0 |
| deepseek-v4.1-flash-1017/none | 0 | 12 | 11 | 14 | 13 | 0 |
| deepseek-v4.1-flash-1017/placebo | 1 | 17 | 17 | 13 | 13 | 0 |
| particle-1/gstack | 0 | 12 | 12 | 12 | 9 | 0 |
| particle-1/none | 0 | 10 | 9 | 13 | 11 | 0 |
| particle-1/placebo | 0 | 7 | 6 | 10 | 6 | 0 |

The flags mark attempts to reach hosts or packages off the allowlist, direct PyPI fetches and solution-seeking searches. They are disclosed and not used to exclude trials, as in quick look 2. The grid has one network_bypass flag, configure-git-webserver__g9oTaFH (DeepSeek placebo).

Trial-level decisions under the prereg's Failure handling line ("A trial where no model response reached the agent is infrastructure, leaves the denominators, and is rerun up to twice"):

- pytorch-model-cli__K2kKfrU (DeepSeek none) and pytorch-model-cli__e6rvyDb (particle-1 placebo) made zero proxy requests and have no SDK messages. They started during the 14:16 to 14:19 UTC ledger outage below. Harbor still ran the verifier on the untouched environment and wrote reward 0. They are infrastructure, leave the denominators, and were replaced by pytorch-model-cli__qZz9Jjw and pytorch-model-cli__eCr88Ah in laneb3-r23x, which got model responses and reward 0. Because `analyze.ts` grades any trial that has a reward, they leave the analysis through a data step: the analysis reads a filtered copy of the laneb3-r23 job folder, symlinks to every trial except these two, so the analysis code stays at the prereg pin. Excluded: pytorch-model-cli__K2kKfrU and pytorch-model-cli__e6rvyDb. Replacements, from laneb3-r23x: pytorch-model-cli__qZz9Jjw and pytorch-model-cli__eCr88Ah. Strict reading (the two count as fails and the reruns are left out): every particle-1 and DeepSeek contrast is unchanged, for example gstack minus placebo stays -4 [-9, +0] and -2 [-8, +5].
- pytorch-model-cli__LLPXjm4 (particle-1 gstack) made 38 successful model requests before the outage cut its session. It got reward 0 and is graded as it stands. Its session row was never written, so its cost is not in the proxy's session rows and particle-1 gstack's cost covers 116 of 117 trials.
- The two no-reward trials above are paid and score 0, with the drop alternative shown.

## Pilot

laneb3-pilot: Sonnet 5.5 and particle-1, arms gstack and placebo, 5 tasks, 1 trial each, 20 trials. Both models passed both gates: body load 10 of 10 each, and the tool-use gate, which is why both ran in the grid. The pilot is never pooled into the grid. Its audit flagged three particle-1 trials: one network_bypass and one offlist_attempt in placebo, and one pypi_direct in gstack.

## Deviations and operations log

- Interim peeks. Two tables were read before the grid finished and sent to the Captain: the pilot table and the replicate 1 table. Both were used only to re-project cost. The replicate 1 projection was under the prereg's spend rule, so all three replicates ran in every cell.
- crack-7z-hash dropped. On the first replicate 1 VM the in-run oracle for crack-7z-hash failed because the verifier's apt-get could not get the dpkg lock. By the in-run oracle rule it was dropped with no swap. No paid trial ran on that VM, and its ssh session hung for about 6 hours. The grid ran on a second VM with 39 tasks.
- Four oracle-failed tasks were replaced before the grid, as the prereg records: qemu-startup, financial-document-processor, build-pmars and build-cython-ext by fix-git, git-leak-recovery, git-multibranch and kv-store-grpc.
- Operator scripts. Two operator-side shell scripts ran beside the launcher: a watchdog (`watch-launch2.sh`) that watched the launcher and the VM job, and a recover script (`recover-run.sh`) that re-attached to a VM after its launcher died, waited for the job to finish, pulled the results and deleted the VM. Neither touches the agent, the arms, the tasks or the grading. They are not committed: they hold machine-specific paths and are not reusable as written.
- Capy machine restart. At 14:16:44 UTC the operator's Capy machine restarted, killing the launcher, the local ledger service and the ssh tunnel the VM used to reach them. They were restored at 14:19:38. The job on the VM kept running; the three pytorch-model-cli trials above are its casualties.
- Second ledger outage, about 20:14 to 20:19 UTC. No trials were running.
- Idle VM. The recover script's wait loop used pgrep with a pattern that matched its own command line, so it never saw the job end. laneb3-r23 finished at 18:32 UTC and the VM sat idle until it was pulled and deleted at 00:54:32Z.
- gstack was upgraded to 1.91.333.0 mid-thread on the operator machine only. The arms are pinned tars and every manifest records the digests above, so no arm changed.
- Analysis: the code is the prereg pin, unchanged. The two infrastructure trials leave through the filtered job folder above, a data step. The added-20 subset lists 19 tasks because crack-7z-hash has no trials. Wall time is as noted in the model comparison.

## What this means

On these 39 tasks gstack's `/investigate` body showed no benefit over placebo on any of the four cheaper models, with a body-load rate of 100%. Every point estimate is negative, but the intervals still allow gains of up to 5 points, so a small benefit is not ruled out. Quick look 2's loss to placebo on Opus, Haiku and DeepSeek V4.1 Flash shows again on Haiku and DeepSeek and extends to Sonnet 5.5 and particle-1, though the losses are small and none is clearly below zero on its own. The skill stays on the two tracks: harder tasks with headroom, or cutting the lines that do not help.

The ladder question needs harder tasks. Opus 5.5 with no skills passes 79% and DeepSeek with no skills passes 81%, so this sample shows no gap for gstack to close. That is not parity: DeepSeek minus Opus is +2 [-10, +15], and the post makes no parity claim. particle-1 is not a cheaper substitute for DeepSeek on this harness.

## Pinned code and artifacts

- Runner: tag `laneb-quick-3-runner`, 9c4e2121ba461d17eef0d38a8607a3e132593f2c. Task list `tasks/final.json` sha256 9ccfec13f01c150f4ec838e19285375a1f034522c1a069c0ee83d75d12dd56d9.
- Analysis: `quick/laneb/analysis` at the prereg commit, unchanged. Config: [analysis-config.md](analysis-config.md); its job paths are relative to the operator's run folder, and `runs/r23f/jobs/laneb3-r23` is the filtered laneb3-r23 folder.
- Job directories (trial results, SDK logs, proxy rows) are kept outside the repo in the Captain drive under handoffs/GEVA-30/, after a secret scan. No transcript is committed here.

<details>
<summary>Agent notes</summary>

All 39 tasks:

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

Its other 116 trials cost $8.91, so its cost per success over the trials with a row is $0.10 ([mechanism.md](mechanism.md)).

Original 20 tasks:

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

laneb3-pilot: Sonnet 5.5 and particle-1, arms gstack and placebo, 5 tasks, 1 trial each, 20 trials, $2.53.

**Cost**

- Ledger `laneb-quick-3` (exploratory jsonl in the Captain drive): $103.162449 settled against the $280 stop ($300 cap Garry approved), plus 6 open reserves worth $7. All 3,097 rows carry prereg 82cda7db (3,097 match).
- Proxy totals: route check about $0.20, pilot $2.53, laneb3-r1 $32.54, laneb3-r23 $67.88, laneb3-r23x $0.14.
- The 6 open reserves are sessions with no ledger settle row. Four laneb3-r1 sessions (configure-git-webserver__zmn3eUw, kv-store-grpc__rF3VuSM, git-multibranch__yZmwFxo and filter-js-from-html__6bfQivA, $6 reserved) and one laneb3-r23 session (pytorch-model-cli__jSwAbG5, $0.50) have proxy session rows, so their costs ($0.15 together) are counted in the proxy totals and this post. We did not find why the ledger missed the r1 settles; jSwAbG5 was open when the 14:16 restart killed the local ledger. The sixth, pytorch-model-cli__LLPXjm4 ($0.50), has no session row at all, so its cost is unknown and bounded by that reserve.
- Ubicloud VM cost: unknown. The standard-30 hourly rate is not verified anywhere in this thread, so this post does not estimate it. VM time includes the first replicate 1 VM (about 6 hours with a hung session), the laneb3-r23 VM's idle stretch below and the rerun VM.

The replicate 1 projection (spend so far plus twice replicate 1's cost, about $100) was under the $230 rule, so all three replicates ran in every cell.

</details>
