---
id: 2026-11-09-geva-431-claim-check-corrections
kind: finding
title: "Claim check of six gstack-evals results posts: every claimed number reproduced in a keyless rerun, and the verdict words change where the posts claimed more than the data"
summary: "A keyless rerun matched every claimed number. Verdict words change: CUT-CANDIDATEs narrow to FIX-METHOD on task fit, and saturated or null readings are scoped to what ran."
author: GEVA-431
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: done
supersedes:
  - 2026-11-06-geva-350-l1-overhaul-results
  - 2026-11-08-geva-353-l1-sol-particle-results
  - 2026-11-08-geva-402-ceo-stage-2-results
  - 2026-11-03-geva-250-panel-v3-headroom-results
  - 2026-11-03-geva-232-panel-v3-e0-results
  - 2026-11-06-geva-364-g-admission-results
---

# Claim check of six gstack-evals results posts: every claimed number reproduced in a keyless rerun, and the verdict words change where the posts claimed more than the data

- We learned that gstack's overhaul, taken as one route-and-contract package, gets an untold agent to open /investigate on Opus 5.5 (+21.3 points, 95% CI +12.5 to +30.0) and on particle-1 (+15.0, 95% CI +7.5 to +22.5). You should read that as the skill getting opened, not as better task outcomes, which this run didn't measure with enough power.
- We learned that plain Opus 5.5 already finds the seeded plan flaws (eng 15 of 16, dx 20 of 20) and already solves the G admission tasks (22 valid trials on 11 of 12 tasks). You should build harder tasks, or tasks that test what the planning skills are meant to do, before reading any lift for plan-eng-review, plan-devex-review or autoplan.
- We learned that plan-ceo-review showed no measurable gain under the preregistered Holm test on Opus 5.5 (+0.0 points, 95% CI -6.0 to +6.0), GPT-6.1 Sol or particle-1. You should treat that as FIX-METHOD on task fit, because hit@3 never scored whether a review makes a plan better. The plan-ceo-review section gives particle-1's unadjusted interval.

This post replaces six results posts. The runs, their data and their numbers are unchanged. A second crew reran every claimed number on a clean machine with no keys, and every one matched. What changes is the words: verdicts the registry narrowed after the posts merged, intervals the posts called flat or null, and attributions wider than the design supports. The Run D post is not part of this check yet; it waits for a keyless rerun of its written procedure.

Each section below gives the corrected row for that finding, the old and new wording, and the rerun result. "P:N" is line N of the merged post at main 09d7a8f7. Merged posts are not edited; this post carries the fixes.

## L1: gstack's overhaul before and after (Opus 5.5, GPT-6.1 Sol, particle-1)

Replaces [the Opus post](2026-11-06-geva-350-l1-overhaul-results/README.md) and [the Sol and particle-1 post](2026-11-08-geva-353-l1-sol-particle-results/README.md).

Pending: the corrected rows, the wording list and the rerun result land here once the second rerun of this bundle matches.

## G admission: plan-eng-review and autoplan

Replaces [the G admission post](2026-11-06-geva-364-g-admission-results/README.md).

### Row

| Skill | Model | Verdict | Effect | Interval | Caveat |
|---|---|---|---|---|---|
| plan-eng-review and autoplan (told), admission | Opus 5.5 | untested | No skill effect read. Admission stopped for saturation: with no gstack, Opus 5.5 solved 22 of 22 valid trials (100%), above the prereg's 20% to 80% band | none arm, 95% Clopper-Pearson 84.6% to 100% (trials treated as independent; 11 tasks; about 83% at an assumed within-task ICC of 0.10, a repository-level assumption from the prereg's power simulation, by the design-effect approximation) | The exposure detector marked the procedure in 0 of 18 (plan-eng-review) and 0 of 23 (autoplan) scored told sessions, a descriptive reading. plan-eng-review: FIX-METHOD on task fit and exposure; the post's CUT-CANDIDATE was narrowed on 2026-11-08 (registry), and this run measured no null. autoplan: FIX-METHOD (saturation and exposure; admission route saturation). 12 held-out tasks x 2 trials; hidden tests decide solved. |

### Old -> new

1. P:4: "solved 22 of 22 valid tasks" -> "solved 22 trials on 11 of 12 tasks"
2. P:46: "Plain Opus 5.5 solved every valid task." -> "Plain Opus 5.5 solved every valid trial: 22 trials on 11 of 12 tasks (both none trials on the twelfth task stopped at the allowance and are gaps)."
3. P:46: "The 2 none trials that ended as gaps can't move this: counted unsolved, none is 22 of 24 (91.7%), still above the band." -> "The 2 none trials that ended as gaps don't change the point-rule stop: counted unsolved, none is 22 of 24 (91.7%), still above the band, though that share's independent-trial 95% Clopper-Pearson interval (73.0% to 99.0%) reaches into it."
4. P:48: "Told sessions cost 7.1 times a none session for plan-eng-review and 19.7 times for autoplan" -> "Scored told sessions cost 7.1 times a scored none session for plan-eng-review and 19.7 times for autoplan (6.9 and 15.8 times a none session when the gap sessions count in every arm, which prereg section 6 item 5 includes)"
5. P:50: "R48: plan-eng-review is a **CUT-CANDIDATE**, sent to the project owner, decision pending." -> "R48: plan-eng-review is FIX-METHOD on task fit and exposure. The CUT-CANDIDATE this post first gave was narrowed on 2026-11-08 (registry): this run measured no skill effect, and the skill's engineering-planning intentions are untested."
6. P:129: "It changes no reading here:" -> "It doesn't change the admission route here:"
7. P:136: "A none session averaged 4.9 times plan v3's house none price, and told sessions 7.1 and 19.7 times a none session" -> "A scored none session averaged 4.9 times plan v3's house none price (6.3 counting the 2 none gap sessions), and scored told sessions 7.1 and 19.7 times a scored none session (6.9 and 15.8 when the gap sessions count in every arm)"
8. P:141: "**plan-eng-review: CUT-CANDIDATE**, sent to the project owner, decision pending." -> "**plan-eng-review: FIX-METHOD on task fit and exposure.** The CUT-CANDIDATE this post first gave was narrowed on 2026-11-08 (registry): this run measured no skill effect, and the skill's engineering-planning intentions are untested."
9. P:145: "On these tasks there is no solve-rate room for any skill to show a gain." -> "None solved all 22 valid trials. Its 95% interval, 84.6% to 100% with trials treated as independent, leaves about 15 points of room at its lower end, and no skill effect was estimated."
10. P:156: "A told autoplan session cost 19.7 times a none session, about four times plan v3's house multiple." -> "A scored told autoplan session cost 19.7 times a scored none session (15.8 counting the gap sessions), 3.2 to 3.9 times plan v3's house multiple of 5.0."
11. P:158: "unattended autoplan costs about 20 times a none session" -> "unattended autoplan costs 16 to 20 times a none session"

### Rerun

A second crew reran the bundle on a clean machine with no keys. All 25 claimed rows matched, and the procedure's output was byte-identical to the expected block. Since then the bundle fixed the ICC label, the trial and task count, the cost multiples that count the gap sessions, the cross-lab read cost and the procedure text, and the procedure was rerun twice with the same output.

## Panel v3: E0 and the headroom check

Replaces [the headroom post](2026-11-03-geva-250-panel-v3-headroom-results.md) and [the E0 post](2026-11-03-geva-232-panel-v3-e0-results.md).

### Row

| Skill | Model | Verdict | Effect | Interval | Caveat |
|---|---|---|---|---|---|
| Plan reviews, seeded-flaw panel v3 (eng and dx strata; ceo and design not read) | Opus 5.5, no-gstack arm only | saturated (under the frozen seeded-flaw rules) | Plain Opus found eng 15 of 16 and dx 20 of 20 planted-flaw readings, and 137 of 138 candidate readings across E0's four strata | eng 0.698 to 0.998, dx 0.832 to 1.000, E0 0.960 to 1.000 (Clopper-Pearson, readings treated as independent) | No gstack arm ran, so no skill effect was measured. 4 eng and 5 dx items on 2 code bases per stratum, so the intervals don't cover new items. Seeded-flaw recall only, judged by Sol, Opus and Sonnet. The registry narrowed both CUT-CANDIDATEs to FIX-METHOD on task fit, and the skills' main intentions are untested. |

### Old -> new

1. Headroom post, P:4 (title): "on large code bases plain Opus 5.5 still found the planted flaws (eng 15 of 16, dx 20 of 20), so no stratum has headroom and the seeded-flaw E-line ends" -> "on larger, pruned code slices plain Opus 5.5 still found the planted flaws (eng 15 of 16, dx 20 of 20), so no stratum read HEADROOM and the seeded-flaw E-line ends"
2. Headroom post, P:21 (H1): "on large code bases plain Opus 5.5 still found the planted flaws in eng 15 of 16 and dx 20 of 20 readings, so no stratum has headroom and the seeded-flaw E-line ends" -> "on larger, pruned code slices plain Opus 5.5 still found the planted flaws in eng 15 of 16 and dx 20 of 20 readings, so no stratum read HEADROOM and the seeded-flaw E-line ends"
3. Headroom post, P:5 (summary): "No headroom." -> "No stratum read HEADROOM."
4. Headroom post, P:5 (summary): "R48: eng, dx CUT-CANDIDATE" -> "R48: eng, dx FIX-METHOD on task fit"
5. Headroom post, P:44: "made eng and dx a CUT-CANDIDATE for plan-eng-review and plan-devex-review as seeded-flaw panels measure them" -> "made eng and dx FIX-METHOD on task fit for plan-eng-review and plan-devex-review as seeded-flaw panels measure them"
6. Headroom post, P:199: "**Verdict: CUT-CANDIDATE** for plan-eng-review and plan-devex-review, as measured by seeded flaws." -> "**Verdict: FIX-METHOD on task fit** for plan-eng-review and plan-devex-review (registry lines 136 and 139): plain Opus already finds these seeded flaws, so a seeded-flaw panel can't show what either skill adds, and the skills' main intentions stay untested."
7. Headroom post, P:215: "go to the project owner as CUT-CANDIDATEs" -> "are FIX-METHOD on task fit (registry lines 136 and 139)"
8. Headroom post, P:197: "but no draw this far above the edge is a near miss." -> "The counts sit well above the frozen edges, but item-level uncertainty stays wide (eng 3 of 4 and dx 5 of 5 items fully matched)."
9. Headroom post, P:198: "and now on large code-heavy ones" -> "and now on larger, pruned code slices"
10. E0 post, P:141: "a kind whose true recall is 0.6 reads KEEP about 55% of the time, so twelve kinds at 0.917 or above are a ceiling, not noise from the draw" -> "a six-item kind whose true recall is 0.6 reads KEEP about 55% of the time and a five-item kind about 59 to 61%, so twelve kinds at 0.917 or above sit above the frozen ceiling in this draw"
11. Headroom post, P:95: "so the true intervals are wider." -> "so these reading-level intervals may be too narrow; no cluster-adjusted interval was estimated."
12. E0 post, P:99: "so the true intervals are somewhat wider." -> "so these reading-level intervals may be too narrow; no cluster-adjusted interval was estimated."

### Rerun

A second crew reran this check with no keys: all six claimed rows matched, every checked value reproduced, and the procedure's output matched the expected block byte for byte. Since then the bundle's allowlist record, its verdict scope and its wording list were fixed, and the expected block was regenerated because the manifest now also lists that record.

## plan-ceo-review stage 2

Replaces [the stage 2 post](2026-11-08-geva-402-ceo-stage-2-results/README.md).

Pending: the corrected row, the wording list and the rerun result land here.

## Limits and threats

- A claim check tests whether the published numbers follow from the recorded data and whether the words match the numbers. It doesn't rerun any model, so it can't catch a fault in how the sessions themselves ran.
- New numbers this check computed stay out of this post until the second crew's rerun of them matches.
- The registry corrections cited above are the project's own verdict register, which is not public. The corrected verdicts are stated here in full, so nothing in this post depends on reading it.

## Replicate it

Each finding's claim-check bundle holds its text-free inputs, a git bundle of this repo at 09d7a8f7, a written keyless procedure and its expected output. The procedure runs from an empty directory under `env -i` with bun and python3 3.10 or newer, and prints a line per check. The held-out task bodies and labels are not in the bundles.

## What is held out, and why

The G admission tasks and the panel v3 held-out slices stay held out so they can be reused. The bundles carry counts and digests only. An 8-word overlap check found no run of the held-out slices in the merged posts or the bundles.

## Record

| Field | Value |
|---|---|
| Grade | Claim check of merged results. No new run. |
| repo_commit | 09d7a8f7 |
| reproduced_by | a second crew, keyless, on a clean machine |

## Changelog

- 2026-11-09: first version.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

## Agent notes

- Panel v3 bundle MANIFEST 803b9cc5..., G admission bundle MANIFEST 3aa62f8d.... L1 and CEO digests to follow.
- The G admission bundle corrected its cross-lab read cost by pricing cache writes at their own rate (prices.ts:60). The figures are in the private claim-check record.
