---
id: 2026-11-23-geva-401-tbv-held-out-results
kind: finding
title: "Trust-but-verify held-out results: the principle added 3.6 points of first-level recall on Opus 5.5, not distinguished, with more unsupported claims; Sol and particle-1 untested; both judges pass R78; FIX-METHOD"
summary: "97 held-out tasks: Opus principle minus none +3.6 points [-1.1, +8.4], not distinguished (MDD 8.2), more unsupported claims. Sol and particle-1 untested. Judges pass R78. FIX-METHOD."
author: GEVA-401
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-23
status: done
links:
  - 2026-11-05-geva-313-trust-but-verify-prereg
  - 2026-11-05-geva-326-tbv-prereg-amendment-1
  - 2026-11-06-geva-349-tbv-scorer-pin
  - 2026-11-06-geva-356-tbv-pins-addendum
  - 2026-11-06-geva-361-tbv-split-addendum
  - 2026-11-06-geva-363-tbv-rebuild-pins-addendum
  - 2026-11-07-geva-379-tbv-mine-b-addendum
  - 2026-11-07-geva-383-tbv-argon-routing-addendum
  - 2026-11-07-geva-392-tbv-render-turns-addendum
  - 2026-11-07-geva-395-tbv-held-b-frame-amendment
  - 2026-11-08-geva-400-tbv-p-and-c-record
  - 2026-11-22-geva-401-tbv-r78-addendum
  - lanes/tbv/README.md
  - lanes/tbv/rule.ts
  - lanes/tbv/r78.ts
attachments:
  - aa207d722dbec9015a32442fd52ef7fa0dd875a19548c08b92ace3b244c94450  by-source-all.txt
  - 39605df89c056ae0fe19e93eabb8f0152db2b493229fed8c832e1275872d9139  by-source-headline.txt
  - 80add336d2021fb1bd809ae2443c2590b56ae27902fb1abdbe3c84e6a81f088d  compare-all.txt
  - 19b81d69a0f7682a8fa35781248f21db7e725b7506aeb753ef341da7f4f792d7  compare-astra-all.txt
  - f2df0dfef27b04e7b7b446fdedf2adab14eb75c5d32f8c1b16cc41558ab76fe8  compare-astra-headline.txt
  - 249dbba5b8c1d7fec3703b04d59b6cea540003f6d97bc7c89a4bf8eafdb9c1d7  compare-headline.txt
  - 1f3e8fcfd989f5860bf7200389a424fd43477c8921a04fe8b9818171c48965bc  coverage.txt
  - edf7e84ca4a822f27957e8d513600471217d5c08f321072e7cc466c09f87c81a  r78-all.txt
  - 6b2fe2168980f340d58a78c7170c66aa373ccdf312f81bfee2f8f438b8f6d8df  r78-headline.txt
---

# Trust-but-verify held-out results

## Takeaways

- **We learned that you can grade whether an agent's report tells the user what happened.** Frozen real work, a hidden key of the facts the agent itself could see, and a judge from another model family gave stable numbers: checked against labels two other judges agree on, the Sol judge scored kappa 0.98, and the stock and oracle controls read exactly 0 and 1. **You should test report guidance this way before you ship it,** not with a layout check that frontier models pass by default.
- **We learned that gstack's trust-but-verify principle did not measurably improve Opus 5.5's reports on held-out work.** In the first 250 words, Opus with the principle disclosed 3.6 more points of the key facts than Opus with no gstack [-1.1, +8.4], under the 8.2 points this test could detect, and its reports carried about 1.5 more unsupported claims each. GPT-6.1 Sol and particle-1 mostly did not follow the principle, so their results are untested. **You should treat the principle as unproven, and fix how it reaches non-Claude models and how it keeps claims tied to evidence before you claim a gain** (R48 verdict FIX-METHOD).
- **We learned that today's gstack report guidance may cost disclosure.** Reports written with current gstack named fewer key facts up front than reports with no gstack: Sol -7.9 points [-11.7, -4.2] and Opus -4.8 [-8.9, -0.6]. The frozen rule reads both as untested, because current gstack's own report markers showed up in fewer than 80% of reports, so **this is a descriptive signal, not a verdict.** **You should look at the shared closer that asks agents to report in a few short lines,** which the preregistration named as the likely cause before any data.

Call settled: gstack's trust-but-verify principle (P, f83eba4) is not shown to improve Opus reports, so no gain is claimed for it (FIX-METHOD)

## What works

**The measurement.** The held-out read ran 2,300 readings on 100 tasks, with no reading left unjudged that a contrast needed. Headline coverage is 0.990 raw and 1.000 once the one held-back control task is set aside (below). Both cross-family judges pass the R78 judge check: Sol at kappa 0.983 [0.961, 1.000] and Opus at 0.614 [0.530, 0.698], each on more than 200 labelled outputs. The stock report of generic concerns scores 0.000 and the oracle report written from the key scores 1.000 under both judges and under GPT-6.2 Astra. The seeded double read agrees at kappa 0.677 (positive agreement 0.804). On the run host, the R78 build reproduced the counted readings and comparison files byte for byte before Astra spent anything. If you build agents, this is a test you can reuse: it grades substance (did the report name the failed check, the skipped step, the unverified claim) and not layout.

**The principle reaches Opus.** Opus wrote at least one of the principle's three line labels (Failed or skipped, Unverified, Also changed) in 87% of skill-layer reports and 93% of Capy-layer reports, above the 80% exposure gate. On the four long-list tasks, every Opus report with the principle named all the flagged items and named no other item before them; with no gstack, half the reports named all of them and a quarter kept that order. Four tasks is too few to read as more than a sign that the list part works as written.

**Where it leaned positive.** On held-out source A (sessions from earlier agent trials on public repositories, with test results in the record), Opus with the principle disclosed 7.6 more points than with no gstack [-0.7, +14.8], and Sol 10.0 more [+5.2, +14.5]. These are by-source breakdowns: unadjusted, outside the frozen test families, and decide nothing. They say where to look next.

## What didn't work

**The pooled gain is not distinguished.** On the 97-task headline, Opus with the principle beats no gstack by 3.6 points [-1.1, +8.4], Holm p 0.417. That is under the 8.2-point minimum detectable difference, so a real gain of 3 or 4 points could hide here, but this test can't show it. The as-run 100-task line agrees: +3.7 [-0.9, +8.3], Holm p 0.340, MDD 6.8.

**It adds unsupported claims.** Opus reports with the principle carried about 1.5 more unsupported claims each than reports with no gstack, with an interval above zero, so the frozen rule flags the contrast "more unsupported claims". They also ran longer: 258 of 291 Opus principle reports went past 250 words, against 207 of 291 with no gstack.

**Nothing moved on our own pull requests.** On held-out source B (histories assembled from the checks, review findings and commits of our own merged pull requests), Opus with the principle came out +0.4 points [-5.2, +5.8] against no gstack.

**Sol and particle-1 mostly ignored it.** The principle's labels showed up in 17.5% of Sol reports and 36.6% of particle-1 reports. Under the frozen exposure gate every contrast that holds the principle on those models reads untested, with no verdict.

**Current gstack text read worse than none.** This is descriptive only, because current gstack's own markers (a completion status or a DEBUG REPORT block) showed up in 42.3% of Opus reports, 24.7% of Sol reports and 19.6% of particle-1 reports, all under the 80% gate. Sol with current gstack disclosed 7.9 points fewer than Sol with no gstack [-11.7, -4.2], and Opus 4.8 fewer [-8.9, -0.6]. By source, the Opus loss sits in source A (-9.6 [-15.2, -4.3]) and the Sol loss in source B (-15.8 [-20.8, -11.0]). The preregistration predicted this direction for Opus before any data: current gstack's evidence rule asks for disclosure, but its shared closer asks for a few short lines.

## Result

All numbers are points of first-level recall: the share of a task's key facts that the first 250 words of the report state specifically, times 100. Contrasts pair the two arms on the same tasks and passes, average within lineage clusters, and give a 95% cluster-bootstrap interval and a sign-flip p (seed 20261105, 10,000 draws), Holm-adjusted within each model's family of three contrasts.

### Headline: 97 tasks (ruling C1)

The headline drops the 3 held-out tasks the escape-code miss affected (method notes). Opus arms are judged by GPT-6.1 Sol; Sol and particle-1 arms by Opus 5.5. Opus ran 3 passes, Sol and particle-1 2.

| Model | Contrast | Difference | 95% CI | Holm p | Exposure | Verdict |
|---|---|---|---|---|---|---|
| Opus 5.5 | principle - none | +3.6 | [-1.1, +8.4] | 0.417 | principle 0.869 | not distinguished (MDD 8.2); more unsupported claims |
| Opus 5.5 | principle - current | +8.4 | [+5.0, +12.0] | 1 (untested) | principle 0.869, current 0.423 | untested (current's exposure) |
| Opus 5.5 | current - none | -4.8 | [-8.9, -0.6] | 1 (untested) | current 0.423 | untested (current's exposure); more unsupported claims |
| GPT-6.1 Sol | principle - none | -1.3 | [-5.8, +3.1] | 1 (untested) | principle 0.175 | untested |
| GPT-6.1 Sol | principle - current | +6.6 | [+3.6, +9.8] | 1 (untested) | principle 0.175, current 0.247 | untested |
| GPT-6.1 Sol | current - none | -7.9 | [-11.7, -4.2] | 1 (untested) | current 0.247 | untested; descriptive only |
| particle-1 | principle - none | -0.5 | [-8.4, +7.3] | 1 (untested) | principle 0.366 | untested |
| particle-1 | principle - current | +2.3 | [-3.5, +8.1] | 1 (untested) | principle 0.366, current 0.196 | untested |
| particle-1 | current - none | -2.7 | [-10.2, +4.7] | 1 (untested) | current 0.196 | untested |
| Opus 5.5, Capy layer | principle - none | +0.8 | [-5.2, +7.0] | 1.000 | principle 0.930 | not distinguished (MDD 11.6); the Astra reading flips its sign, so nothing is claimed |
| Opus 5.5, Capy layer | principle - current | +0.6 | [-4.2, +5.6] | 1 (untested) | principle 0.930, current 0.010 | untested |
| Opus 5.5, Capy layer | current - none | +0.2 | [-5.0, +5.7] | 1 (untested) | current 0.010 | untested; the Astra reading flips its sign |

The skill layer covers 88 lineage clusters (97 tasks) per model; the Capy layer 48 clusters (50 tasks). Sol and particle-1's MDD is 10.0 points at 97 tasks. Mean first-level recall by arm, over readings: Opus none 0.425, current 0.367, principle 0.460; Sol none 0.455, current 0.382, principle 0.449; particle-1 none 0.284, current 0.243, principle 0.270. Sol never wrote past 250 words (0 of 194 reports in each arm), so its first level is its whole reply.

Unsupported claims per reading, principle minus none: Opus +1.50, Sol +0.31, particle-1 +0.61. Current minus none: Opus +1.57, Sol +0.17, particle-1 +0.62. Every one of these carries the flag. The held-out set has no clean runs, so the invented-caveats check reads n/a.

Task by task, Opus principle minus none: 42 tasks better, 30 worse, 25 the same (Sol's labels); 44, 33 and 20 under Astra's.

**Coverage (ruling E1).** Raw headline coverage is 0.990 on every skill-layer contrast (Opus 291 of 294 planned task-passes, Sol and particle-1 194 of 196) and 1.000 in the Capy layer. The only gap is the held-back control task, which ruling C1 excludes; with its planned rows out of the denominator, coverage is 1.000. Neither figure is near the 0.90 bar. coverage.txt has every row.

### Sensitivity: the as-run 100 tasks

| Model | principle - none | principle - current | current - none |
|---|---|---|---|
| Opus 5.5 | +3.7 [-0.9, +8.3], Holm p 0.340, MDD 6.8, not distinguished | +8.5 [+5.1, +12.0], untested | -4.8 [-8.7, -0.7], untested |
| GPT-6.1 Sol | -1.4 [-5.7, +2.8], untested | +6.5 [+3.5, +9.6], untested | -7.9 [-11.6, -4.3], untested |
| particle-1 | -1.1 [-8.9, +6.8], untested | +2.1 [-3.4, +7.8], untested | -3.2 [-10.7, +4.3], untested |

Coverage is 1.000 everywhere. The Capy layer is the same as the headline, since all 3 affected tasks are source A. The verdicts don't change.

### By source and repository (descriptive)

Ruling C1 asks for the headline estimate for held A beside the pooled one, and amendment 2 asks for held B's per-repository results. These split the frozen families. The intervals are unadjusted and decide nothing. by-source-headline.txt and by-source-all.txt have every row.

| Subset (headline) | Tasks (clusters) | Strata | Opus principle - none | Sol current - none | particle-1 principle - none |
|---|---|---|---|---|---|
| held A, source A | 47 (40) | long 3, other 14, short 31 (48 rows) | +7.6 [-0.7, +14.8] | +1.6 [-2.7, +5.6] | -15.2 [-26.4, -3.5] |
| held B, both repositories | 50 (48) | see below | +0.4 [-5.2, +5.8] | -15.8 [-20.8, -11.0] | +11.8 [+2.0, +21.6] |
| held B, garrytan/gstack | 25 (23) | other 25 | -2.1 [-9.1, +5.1] | -18.8 [-25.5, -12.2] | +6.2 [-5.1, +17.0] |
| held B, garrytan/gstack-evals | 25 (25) | long 1, other 22, short 2 | +2.6 [-5.7, +10.6] | -13.2 [-20.8, -6.5] | +17.0 [+0.9, +32.0] |

Other rows, held A: Opus principle minus current +17.2 [+11.6, +22.9], Opus current minus none -9.6 [-15.2, -4.3], Sol principle minus none +10.0 [+5.2, +14.5]. Held B: Sol principle minus none -10.6 [-16.5, -4.7]. Capy layer, Opus principle minus none: gstack -5.4 [-13.0, +2.2], gstack-evals +6.6 [-2.5, +15.7].

**The shift.** Amendment 2 added gstack's own crew pull requests, merged after the principle pin, to held-out source B, because our repository alone could not supply enough. Those pull requests are the product under test, written by the crews that build gstack, the principle's builder included; their histories hold only checks, review findings and commits, never PR bodies or comments. Half of held B comes from each repository. On gstack's half, every task is in the "other" stratum (no flagged list), and Opus with the principle reads slightly below no gstack.

## The R78 judge check and the Astra reading

The R78 addendum (2026-11-22-geva-401-tbv-r78-addendum) checks each judge against labels from the seeded double reads, with GPT-6.2 Astra at medium effort as the third reader. The Sol judge is checked on facts where Astra and Opus agree, the Opus judge on facts where Astra and Sol agree. Astra read all 2,339 packets Sol judged (1,325 first-level packets, 974 D2 packets and 40 control packets), with 0 unjudged.

| Judge | First packets | Labelled facts (outputs) | Catch rate | False-fail rate | Kappa [95% CI] | R78 (0.6) |
|---|---|---|---|---|---|---|
| GPT-6.1 Sol | 222 | 605 (220) | 0.997 (322 of 323) | 0.014 (4 of 282) | 0.983 [0.961, 1.000] | passes |
| Opus 5.5 | 219 | 740 (219) | 0.818 (498 of 609) | 0.000 (0 of 131) | 0.614 [0.530, 0.698] | passes |

Headline line; the 100-task line gives Sol 0.984 and Opus 0.608. Both pass, but the Opus judge's interval reaches below 0.6, and it credits about one fact in five that the other two agree was missed (111 of 609), while it never marks missed a fact they agree was disclosed (0 of 131). Opus judges Sol's and particle-1's reports, so their recall levels are probably overstated next to Opus's. Contrasts compare arms under the same judge, so the error falls on both arms alike, but the levels across models should not be compared. Astra's own stock and oracle controls read 0.000 and 1.000.

**The Astra reading** puts Astra's labels in place of Sol's on every reading Sol judged (that is, every Opus arm). Headline Opus principle minus none becomes +2.5 points [-1.3, +6.5], Holm p 0.623, still not distinguished. Principle minus current becomes +6.3 [+3.2, +9.4] and current minus none -3.8 [-7.2, -0.1], both still untested. Under the addendum's section 3, when the two readings disagree on the sign of a headline Opus comparison, the post shows both and claims nothing from it. The three skill-layer Opus contrasts agree in sign. Two Capy-layer contrasts disagree: principle minus none (+0.8 with Sol's labels, -2.3 with Astra's) and current minus none (+0.2 and -4.2). Nothing is claimed for either. Sol and particle-1 rows don't change, because Opus judged them.

## Why null? (R48)

The question is Opus principle minus none, the one tested contrast with a null.

- **Exposure.** Opus used the principle: 0.869 in the skill layer and 0.930 in the Capy layer, above the 0.80 gate. The render gate checked every request before the run (1,350 of 1,350 valid), so the principle's text and gstack's closer were in every gstack-arm request by construction. Sol (0.175) and particle-1 (0.366) did not use it, so the principle's wording does not carry to them. That makes their results untested, not null.
- **Task fit.** The principle leaned positive on source A, agent trial sessions with test results (+7.6), and did nothing on source B, our own PR histories of checks, reviews and commits (+0.4). It also asks for list handling, and held-out work has only 4 long-list tasks (3 in A, 1 in B), so that part had little to act on.
- **Power.** The test detects 8.2 points 80% of the time on 97 tasks. The prior expected 5 to 15 points; the three climb rounds on dev read +0.7, +0.4 and +2.7; the held-out read is +3.6. A real gain of that size is plausible and below what this test can detect.
- **Ceiling or floor.** Neither. Opus with no gstack disclosed 42.5% of key facts in its first 250 words, with room both ways.
- **Frontier competence.** Opus and Sol with no gstack already disclose 42.5% and 45.5%. The principle didn't add enough to separate from that.
- **The cost of the gain.** Opus reports with the principle carry about 1.5 more unsupported claims each and run longer. A report that names more and claims more without evidence is not plainly better for the user, so even a distinguished gain would carry the flag.

**Verdict: FIX-METHOD** (the Captain's reading, 2026-11-23: "B: FIX-METHOD, with the reasons you gave"). The kind is exposure on Sol and particle-1, and task fit on source B. What a fix needs: wording that Sol and particle-1 follow (their exposure is the first thing to measure), a guard in the principle against claims the evidence doesn't support, and a re-read sized for a 4-point effect (more tasks or passes on Opus) with more long-list work in the mix. The current-gstack loss signal goes to gstack's maintainers as a descriptive finding about the shared closer.

## Setup

The preregistration (2026-11-05-geva-313-trust-but-verify-prereg) has the full design; here is what this read used.

- **The task.** Each task is a frozen piece of finished agent work: the full session up to the agent's final report, with tools off at the report turn. A hidden key lists the material facts a user would want to hear, written by Gemini 4 Argon (a family neither under test nor judging) only from what the agent could see. The model writes the final report; the judge marks which key facts the first 250 words state specifically and counts unsupported claims.
- **Sources.** Held-out source A: 50 none-arm trial sessions from earlier merged eval runs on public repositories (SWE-rebench trials). Held-out source B: 50 histories from merged pull requests, 25 in garrytan/gstack-evals and 25 in garrytan/gstack (amendment 2), drawn in merge order. The Capy layer reuses source B's 50 tasks with gstack's Capy report templates.
- **Arms.** none: the work with no gstack. current: gstack at C (acbc88d, whose tree equals 641d622, the eval's base). principle: gstack at P (f83eba4), which adds five commits: gstack's closing report, /investigate's DEBUG REPORT and the Capy report templates open with what failed or was skipped, what is unverified and what else changed.
- **Models.** Claude Opus 5.5 (3 passes), GPT-6.1 Sol (2 passes) and particle-1 (2 passes) in the skill layer; Opus 5.5 in the Capy layer (2 passes). 2,300 readings in all.
- **Judges.** One cross-family judge per reading: Sol for Opus arms, Opus for Sol and particle-1 arms, with a seeded 20% double read by the other. Stock and oracle controls on 20 tasks.
- **Exposure.** For principle, a frozen detector (the P and C record) that looks for the three line labels. For current, a gstack completion status or DEBUG REPORT block (skill layer) or an Unverified line (Capy layer). Under 0.80 on a model, the arm reads untested there.

## The climb that chose P

GStack Minder climbed three rounds on the 40-task dev split, on Opus. These are dev numbers, never the result:

| Round | Candidate | principle - none | principle - current | Capy principle - none | Exposure (skill, Capy) |
|---|---|---|---|---|---|
| 1 | b3d17a1 | +0.7 [-6.5, +7.6] | +5.6 [-0.3, +11.4] | -7.7 [-14.7, -0.0] | 0.563, 1.000 |
| 2 | 404c608 | +0.4 [-5.1, +5.7] | +5.3 [+0.1, +10.2] | +3.8 [-5.3, +13.6] | 0.838, 0.375 |
| 3 | f83eba4 (P) | +2.7 [-5.1, +10.6] | +7.6 [+0.9, +14.2] | +3.9 [-5.7, +14.0] | 0.875, 0.875 |

The dev MDD was 13.1 points. Stage 1 had found headroom: Opus with no gstack at 0.466 [0.373, 0.567] on the 20 headroom tasks, inside the 0.15 to 0.75 band.

## Method notes and deviations

1. **The escape-code miss (ruling C1).** The extractor's parseTests read test output without stripping terminal colour codes, so on some histories a colour-coded test line was missed. On dev it changed nothing that counted: 0 of 20 kept dev source A tasks moved, 2 of 41 considered source A histories gained test facts and both fell under the 3-fact floor anyway, and 0 of 188 source B histories hold the escape character. On held A, 8 of 50 kept tasks hold it, 3 tasks change, 3 keys lack a fact the stripped extract adds, and 2 tasks flip stratum. The Captain ruled to run all 100 as frozen, drop the 3 affected tasks from the headline (the 97-task line here) and report the as-run 100 as the sensitivity line. One of the 3 is a control task, so the headline manifest keeps 98 rows with all 20 controls, and that task's reading records are held back inside custody; it counts as excluded, not as a coverage miss (ruling E1). The extract fix (strip escape sequences before parseTests, with a test each way) lands on main in its own pull request after this one.
2. **Capture files for the current arm (ruling B1).** The P and C record froze C's splice-set digests but archived no capture files, and no current-arm shape was captured at C. The read used the dev baseline's archived captures at 641d622 for current (C's tree equals 641d622's), climb 3's at P for principle and the dev baseline's for none. Every file matches a frozen digest.
3. **Held-out source B's frame (amendment 2).** Source B adds gstack's crew pull requests merged after P, drawn in merge order. The first keys driver stopped at its pool step because the cluster cap dropped 9 rows, before any spend; it resumed with a rewritten driver and the same seed.
4. **Held clean runs.** The frozen keys walk keyed 46 held clean rows although stage 1's ruling said no keys would be spent on held clean runs. The split kept no clean runs, so the clean-task checks read n/a.
5. **The third Opus pass ran.** Amendment 2 made the $2,000 all-in a guideline, so the third Opus pass and the Capy layer ran. Opus's MDD is the 3-pass row.
6. **One unjudged judge record.** The held judge batch ended with 1 of 4,392 records unjudged. No contrast needed it: coverage is 1.000 on the 100-task line.
7. **No rig admission.** Every lease printed "leased without admission", because the tbv items run with admission set to warn and the tbv rig has no admission record. Nothing stopped.
8. **R78 came after the freeze.** The preregistration predates R78's judge check. The R78 addendum added the Astra reader and the labels before any Astra call, and its tooling (lanes/tbv/r78.ts) ships in this pull request. The first R78 start stopped at its pricing check (projected $180.60 against a $180 cap) before any lease. The Captain raised the cap to $200, and a relaunch stopped once on a custody guard before any spend (the first attempt's sealed keys were still in place) before the third start ran.

## Custody

Held-out task bodies, keys, histories and reports never left sealed storage or RAM-backed /dev/shm. The run host held its own run key, which was deleted before the host was destroyed. Every output was sealed as written, and nothing was opened until it passed the handoff check, which looks for any held-out identifier or any 8-word run from held-out text (3,479 identifiers, 3,364 unique to held-out). Only tables left custody (ruling K1). The six comparison files, the by-source tables, the host's status log and its custody log all read CLEAR. One host log file, gstack's install-check output, matched one held-out identifier; it was sealed and is not published. Every custody opening is logged with its script, the digests it checked and its teardown check.

## Limits

- The test grades only the report turn. The work before it is frozen and was not driven by the skill, so it cannot show whether gstack changes the work itself.
- Held-out work is mostly "other" and "short" strata; only 4 tasks have a long flagged list.
- The held set has no clean runs, so it cannot show whether the principle invents worries on clean work.
- Half of source B is gstack's own crew work, written after P by the people building the principle.
- The Opus judge credits about one fact in five that the other two judges agree was missed, so cross-model recall levels are not comparable. Contrasts within a model are.
- Two Capy-layer contrasts change sign under Astra's labels.
- particle-1 runs through OpenRouter; its exposure is low enough that every principle contrast on it is untested.

## Replicate it

The scorer is lanes/tbv/rule.ts. It changed twice after the scorer pin: in #250 (a0f61d44), which the pins addendum records, and in the R78 commit 9125c870, which lets Astra stand in for Sol. The held read ran at 65401337, where rule.ts matches #250's version, and at 9125c870 the counted readings and comparison files came out byte for byte the same before Astra spent anything. With the sealed inputs, the two lines are:

```
gstack-evals tbv readings --records <reading records> --split held.json --keys <keys> --packet-key <packet keys> \
  --judges <judge records> --models opus,sol,particle --passes opus=3,sol=2,particle=2 \
  --skill-arms none,current,principle --capy-passes 2 --principle-detector principle-detector.txt --out readings-all.json
gstack-evals tbv compare readings-all.json --split held.json
```

The headline is the same with held-headline.json and the records of the 3 held-back tasks removed. The R78 reading adds `gstack-evals tbv r78 ... --astra <Astra judge records>`. The attachments are the CLEAR outputs, byte for byte: compare-headline.txt (sha256 249dbba5), compare-all.txt (80add336), compare-astra-headline.txt (f2df0dfe), compare-astra-all.txt (19b81d69), r78-headline.txt (6b2fe216) and r78-all.txt (edf7e84c).

## What is held out, and why

The 100 held-out tasks, their keys, histories and reports stay sealed, so this read can't leak into the work it measures and the split can be reread later. Outsiders can check the published digests; they can't rerun the held-out read. The digests are: held.json 4e12bc67, held-headline.json f7a77a86, the held-back list 0437193a, the counted readings 112600ca (100-task line) and 2a72d967 (headline).

## Changelog

- 2026-11-23: first version.

## Agent notes

- **The third pass's caching miss.** tbv-held-p3's 300 Opus readings wrote as many prompt-cache tokens (20.6M) as the main batch's 600, so each reading cost more than projected. The figures are in the experiment's registry row.
- **Custody openings** 8 to 15 for this thread are in the Captain drive (handoffs/GEVA-401/CUSTODY.md), with the run record beside them.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
