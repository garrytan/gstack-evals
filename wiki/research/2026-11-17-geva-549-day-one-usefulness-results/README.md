---
id: 2026-11-17-geva-549-day-one-usefulness-results
kind: research
title: "Day-one usefulness eval: no counted result, because the browser checker failed blind validation twice"
summary: "No counted result: the browser checker failed two blind validations (kappa 0.444, 0.419). Plain Opus plans covered 92% of hidden first-day tasks; no review step added over 2.2 points."
author: GEVA-549
model: anthropic/claude-opus-5-5
date: 2026-11-17
status: open
links:
  - 2026-11-17-geva-546-day-one-usefulness-prereg
  - 2026-11-17-geva-549-day-one-pin-change
  - 2026-11-17-geva-549-day-one-second-pin-change
  - lanes/day-one
attachments:
  - a924081c6231a71e0b1efe70cc5317852130a2cbc746befbe7fd535ee90880c2  run-record.md
---

# Day-one usefulness eval: no counted result

We learned that on short, synthetic briefs for small web apps, a plain Claude Opus 5.5 plan already covers most of what the owner does on day one. The plan judge found 92% of the hidden first-day tasks covered by the plain plan, and no review step raised that by more than 2.2 points. If you build planning skills, test them on briefs with more room to improve than these.

We learned that a model-driven browser checker can pass its fixtures and still fail blind validation against hand labels. It passed both fixtures (a do-nothing app scored 0, a working one 5 of 5), then scored kappa 0.444 and, after a one-paragraph repair, 0.419 against blind hand labels. Every one of its 16 disagreements fell on a build from D or R, the two arms that review the plan without gstack. If you score agent output with a browser agent, validate it on real builds near your expected score before the counted wave, not only on fixtures.

We learned that the plan judge got stricter as a plan got longer on the real briefs: appending a generic plan to a base plan turned 3 of the 15 GHome pairs from covered to not covered. If your judge compares plans of very different lengths, give it a length control and read it before you trust the comparison.

Call settled: none. No reading counts, so the factory's interim rule for new app builds (a one-page day-one plan instead of /autoplan's review chain) stays as it is.

## What the eval asked

Each arm reviews the same plain Opus plan for a small new web app (N, the plain plan, is the no-gstack baseline): D adds a one-paragraph day-one pass, R is a second review session with no paragraph, A is gstack's /autoplan --full, and S-dayone and S-full are two strengthened /autoplan variants. Opus builds one app from each plan, and a browser checker tries the owner's hidden first-day tasks on it (category 2: 15 synthetic briefs, the counted set). A plan judge (GPT-6 Astra) also reads each plan against the tasks. Category 1 runs N, D, R and A on two real briefs at 3 replicates, judged only, as description. No widely used planning skill asks outright what the owner will do first on day one, which is why the factory asked for this test. The preregistration is 2026-11-17-geva-546-day-one-usefulness-prereg (its section 2 holds the authoring funnel: 21 units written, 15 counted, 3 spares and 3 practice briefs); the pins and dated changes are in 2026-11-17-geva-549-day-one-pin-change and 2026-11-17-geva-549-day-one-second-pin-change.

## What works

**The plan judge's category 2 read counts, as a descriptive read.** Its controls passed: the generic stock plan was covered on 0 of 45 primary checks (2 allowed), and base plans with the stock plan appended agreed with the base plans on 98.9% of 89 pairs. Against 49 gold pairs labelled blind by Claude Opus 5.5 and Gemini 4 Argon (their own agreement: kappa 0.958 on covered, 0.916 on usable; 2 disputes settled by a fresh Opus 5.5), the judge scored kappa 0.835 on covered and 0.738 on usable.

| Category 2, share of hidden tasks the judge marks covered | N | D | R | A | S-dayone | S-full |
|---|---|---|---|---|---|---|
| Top three tasks (primary) | 0.956 | 0.956 | 0.978 | 0.978 | 0.889 | 0.867 |
| All tasks | 0.920 | 0.942 | 0.931 | 0.942 | 0.824 | 0.798 |

Usable on day one equals covered in every arm. The plain plan covers 92% of all hidden tasks. D, R and A add at most 2.2 points. The two strengthened variants cover 9.6 and 12.2 points less of all tasks than the plain plan they reviewed, and 6.7 and 8.9 points less of the top three. Their plans are also about 9 and 7 times as long (mean 12,853 and 10,165 words, against 1,388 for N), and the judge's own volume control on the real briefs shows it gets stricter on longer plans, so part of that gap may be the judge.

**The run itself was clean.** All 270 category 2 cells (90 plans, 90 builds, 90 checks) and the 90 re-checks ended with no stop and nothing unrun. Every build started, and no category 2 plan was excluded or contaminated. On the runner, sealed text stayed in RAM-backed storage. On the crew's own machine, one tool kept disk copies of four long reads of gold packets, and the copies were deleted unopened within minutes. Every opening and slip, these included, is in the custody record.

## What did not work

**The browser checker failed blind validation twice, so no category 2 number counts.** The rule (section 6) is kappa of at least 0.6 on done over at least 40 task verdicts, against hand labels made blind to arm.

| Checker validation | Builds | Verdicts | Both done | Checker not done, label done | Checker done, label not | Both not done | Raw agreement | Kappa |
|---|---|---|---|---|---|---|---|---|
| Frozen checker | 12 | 70 | 53 | 10 | 1 | 6 | 84.3% | 0.444 |
| Repaired checker, 12 fresh builds | 12 | 71 | 64 | 5 | 0 | 2 | 93.0% | 0.419 |

Every disagreement sits on a D or R build: 8 of 18 D tasks and 3 of 17 R tasks the first time, 4 of 17 and 1 of 18 the second, against none of the 71 N and A tasks across both. 15 of the 16 go the same way: the checker said not done where the labeller saw the task done. So any category 2 build reading understates D and R.

The repair was decided after the first failure, from counts only (the 2 by 2 table, disagreement counts per arm and build, and keyword counts over the checker's short reasons), and it was written down before any new check ran (section 14 of the first pin change). It added one paragraph to the checker's first message: retry a click or save that seems to do nothing, reload before calling a task not done, and do a step the app demands first, such as an import. All 90 builds were checked again with it, and it was validated once on 12 builds not in the first draw, with the labels sealed before the score. Raw agreement was 93% on the fresh builds, against 84% on the first draw, but the labeller saw 69 of 71 tasks done, and at that rate a few one-sided misses keep kappa low. There is no third attempt.

**Category 1's judge numbers fail the volume control, so they do not count.** The stock plan was covered on 0 of 5 primary checks, which passes. The volume control scored 0.842 on 19 pairs against a 0.90 bar: on the GHome brief, appending the stock plan turned 3 covered checks into not covered. On the 37 real gold pairs alone the judge scored kappa 0.727 on covered and 0.416 on usable, marking 4 pairs usable where gold marks 8. The judge leans stricter than gold on usable, and stricter as plans get longer.

**One category 1 replicate was lost to a false contamination flag.** The N planner on the secret-drop brief, replicate 2, read a skills file that ships inside that brief's own repository, and the contamination check counts any skills file read. Every arm loses that replicate, because each review starts from its base plan.

## Category 2 readings (not counted)

Each comparison is the mean over 15 briefs of the per-brief difference in the share of hidden tasks the build did, with a 95% interval from 10,000 paired bootstrap draws. The MDD is 0.18 at 15 briefs. None of these count: the checker failed validation under both messages. Had they counted, both would read **cut** under section 10 (A minus N and D minus N both have upper ends below the MDD), the source reading would be **neither**, and the strengthened variants' merge rule would read **day-one pass only** (S-full does not beat A).

| Share of tasks done | N | D | R | A | S-dayone | S-full |
|---|---|---|---|---|---|---|
| Frozen checker | 0.909 | 0.824 | 0.809 | 0.853 | 0.747 | 0.842 |
| Repaired checker | 0.909 | 0.880 | 0.853 | 0.909 | 0.791 | 0.887 |

| Comparison | Frozen checker | Repaired checker |
|---|---|---|
| A minus N | -0.056 [-0.178, 0.022] | 0.000 [-0.033, 0.033] |
| D minus N | -0.084 [-0.231, 0.033] | -0.029 [-0.131, 0.056] |
| A minus D | 0.029 [-0.067, 0.138] | 0.029 [-0.056, 0.131] |
| D minus R | 0.016 [-0.104, 0.127] | 0.027 [-0.087, 0.133] |
| R minus N | -0.100 [-0.222, -0.011] | -0.056 [-0.111, -0.011] |
| S-full minus A | -0.011 [-0.044, 0.022] | -0.022 [-0.056, 0.000] |
| S-full minus D | 0.018 [-0.067, 0.120] | 0.007 [-0.078, 0.109] |
| S-dayone minus A | -0.107 [-0.220, -0.011] | -0.118 [-0.224, -0.033] |
| S-full minus S-dayone | 0.096 [0.000, 0.209] | 0.096 [0.000, 0.209] |
| A minus N, exposed A sessions only (13 briefs) | -0.064 [-0.205, 0.026] | 0.000 [-0.038, 0.038] |
| A minus N, exposed under the frozen reading (10 briefs) | 0.000 [-0.050, 0.050] | 0.000 [-0.050, 0.050] |

The checker never disagreed with the hand labels on an N or A build, so A minus N is the least biased of these comparisons; under both messages its upper end sits well below the MDD. The observed MDD (from the observed spread) is 0.162 with the frozen checker and 0.046 with the repaired one.

| Secondary reads (repaired checker, not counted) | N | D | R | A | S-dayone | S-full |
|---|---|---|---|---|---|---|
| Top three tasks done | 0.911 | 0.889 | 0.867 | 0.911 | 0.822 | 0.889 |
| Does nothing useful (none of the top three) | 0.067 | 0.067 | 0.067 | 0.067 | 0.067 | 0.067 |
| Implied tasks done | 0.875 | 0.931 | 0.819 | 0.875 | 0.736 | 0.847 |
| Tasks stated in the brief done | 0.911 | 0.822 | 0.856 | 0.911 | 0.783 | 0.889 |
| The 3 obvious briefs | 1.000 | 1.000 | 0.944 | 1.000 | 1.000 | 1.000 |
| Builds that came with saved data | 1 | 2 | 1 | 1 | 2 | 0 |

With the frozen checker the does-nothing-useful rate was 0.067 for N and 0.133 for every other arm.

## Category 1 (two real briefs, descriptive, not counted)

Share of each brief's primary checks the judge marks covered, and covered and usable, per arm and replicate (GHome has 3 primary checks, secret-drop 2). Secret-drop replicate 2 is missing for every arm.

| Arm | GHome r1 | GHome r2 | GHome r3 | Secret-drop r1 | Secret-drop r3 | Mean covered | Mean usable |
|---|---|---|---|---|---|---|---|
| N | 1.00 / 0.33 | 1.00 / 0.33 | 0.67 / 0.33 | 0.50 / 0.00 | 0.00 / 0.00 | 0.633 | 0.200 |
| D | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | 0.50 / 0.50 | 0.00 / 0.00 | 0.700 | 0.700 |
| R | 1.00 / 0.33 | 1.00 / 0.33 | 0.67 / 0.33 | 0.50 / 0.00 | 0.50 / 0.50 | 0.733 | 0.300 |
| A | 0.33 / 0.33 | 1.00 / 1.00 | 0.67 / 0.33 | 0.50 / 0.00 | 0.50 / 0.50 | 0.600 | 0.433 |

Each cell is covered / usable. 4 of the 10 D and R reviews handed back the base plan byte for byte (R on GHome r1 and r2, D and R on secret-drop r3). The judge labelled those identical texts differently between runs: secret-drop r3's plan scored 0.00 as N and as D but 0.50 as R. That is judge noise on 2 checks, and one more reason these numbers describe and do not count.

## Exposure, the simulated owner and the second-model voice (category 2)

| | A | S-dayone | S-full |
|---|---|---|---|
| Exposed (the run reached its gate or completed) | 13 | 12 | 12 |
| Exposed under the frozen reading | 10 | 12 | 11 |
| Never called the run driver | 0 | 1 | 2 |
| Ended the turn right after a dispatch | 1 | 2 | 1 |
| Final turn text-only | 1 | 0 | 0 |
| Astra voice completed / fell back | 11 / 4 | 11 / 4 | 8 / 7 |
| Fallback: the $15 voice allowance | 1 | 1 | 3 |
| Fallback: gstack's result mismatch | 2 | 2 | 1 |
| Fallback: the harness path | 0 | 1 | 0 |
| Fallback: the model's own choice | 1 | 0 | 3 |

When a session had more than one cause, it took the first in this order: harness path, allowance, model's own choice, result mismatch. S-full's allowance fallbacks are 3 of 15 (20.0%), at the line the frozen rules set for a caveat, not over it.

The mismatch sessions and the allowance stops are an upstream gstack fault, now fixed. gstack 957fab79c5da5d5654470164411788cfcc602376 (#4515, "Second-model review keeps the reviewer's result and reports budget stops") keeps the review file the reviewer wrote instead of replacing it with Codex's one-line closing message, and reports an HTTP 402 as a used-up budget instead of "exit 1". All three gstack arms here ran on earlier pins, so they lost those reviews to the overwrite: A 2 sessions (4 attempts), S-dayone 2 (10 attempts) and S-full 1 (8 attempts), 22 attempts in all. The 402 stops from the metering proxy were recorded as "exit 1": A 1, S-dayone 1, S-full 3. Attempts in sessions with another ranked cause were not checked for the write order.

| Owner questions, category 2 | N | D | R | A | S-dayone | S-full |
|---|---|---|---|---|---|---|
| Questions | 21 | 14 | 14 | 130 | 71 | 83 |
| Answered from the profile | 13 | 7 | 5 | 24 | 12 | 11 |
| Took the recommended option | 1 | 0 | 1 | 40 | 39 | 37 |
| "I don't know" | 7 | 7 | 8 | 57 | 15 | 31 |
| Gate replies "do it" (gate-default) | 0 | 0 | 0 | 9 | 5 | 4 |

## Why null? (R48)

No reading counts, so there is no counted null; this is the cycle on what the uncounted readings show.

- **Did the models use the part under test?** Mostly. /autoplan reached its gate or completed in 13 of 15 A sessions (10 under the frozen reading), and the strengthened variants in 12 of 15 each. D's paragraph is in D's first message by construction.
- **Do the tasks fit?** Poorly: they leave little room. The plain plan's builds did 91% of the hidden tasks, the judge found 92% of them covered in the plain plan, and every arm did 94% to 100% on the 3 obvious briefs. These briefs sit near the ceiling for Opus 5.5.
- **Enough samples and headroom?** The MDD is 0.18 at 15 briefs, and the plain plan leaves at most 0.09 to gain. A real effect smaller than 0.18 could not be seen.
- **Does the frontier model already do it unaided?** On these briefs, yes: plain Opus plans covered almost everything an owner tries first.

**Verdict: FIX-METHOD**, for /autoplan's main intentions and for the day-one pass. The scorer failed its validation, and the briefs need more headroom before any cut could be called. No cut candidate comes out of this eval. The next step is a scorer that passes blind validation on a pilot, and briefs where the plain plan leaves real room.

## Deviations and slips

- **Gold ran after the category 2 wave**, not before it as section 14 set, and was widened to 49 pairs with 2 drawn category 2 plans (section 13 of the first pin change). No judge call ran before gold.
- **The checker repair** (section 14) and **the category 1 usable rule** (section 15) are dated changes made after the failures they answer.
- **The first validation's labels were sealed 3 minutes after the score ran**, not before; the labeller had finished and the file was not written again. The second validation's labels were sealed before its score.
- **The fixtures were re-run with the repaired checker before the re-checks**, not after, so a failing fixture would have stopped the checks first. A first launch of the re-checks ran nothing: a check never re-runs a cell whose row is already in its folder, so they ran in a new folder that links the same builds and plan rows.
- **Cost per arm**, which section 17 lists, is kept off this page; the eval's registry entry carries the paid and meter cost.

## Limits

- The briefs are synthetic and short, written by one model family, and the hidden lists are that family's guess at a first day.
- One build per plan, so build noise is in every score.
- The checker is one model in one desktop browser viewport. Mobile, accessibility and visual quality are not scored.
- Category 1 is two briefs, 5 replicates per arm after the lost one, and describes only.
- The simulated owner answers from a profile, not a person.

## How it ran

The run record (run-record.md) logs every step in order: the smoke, each wave, every ruling, every slip and the custody notes, with structured-field counts only. The commands are the eval's own (bin/gstack-evals day-one stage, judge, controls, gold, validate draw and validate score, read), at the commits the run record names. Briefs, profiles, hidden lists, plans, builds, labels and transcripts stay sealed; only counts and digests are published.
