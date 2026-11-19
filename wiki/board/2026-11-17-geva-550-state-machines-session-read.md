---
id: 2026-11-17-geva-550-state-machines-session-read
kind: finding
title: "What the state machines prompt's sessions did: restructuring with edge changes, and why the next fix failed"
summary: A read of the session records behind the state machines results. The prompt restructured code and changed edge behaviour, and the next fix failed on the mismatch, not a lost agent.
author: GEVA-550
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-17
status: done
source: "A first-pass draft kept outside this repo, sha256 eeb6fdb0cbc72ce0b9166e504d04c0a6b1525ee30dd4d5af490475749b0c0fb3; only the opening line changed, to link the results and correction posts"
links:
  - 2026-11-17-geva-520-state-machines-prompt-results
  - 2026-11-17-geva-551-state-machines-break-rates-correction
  - garrytan/gstack-evals#360
  - garrytan/gstack-evals#363
---

# Why the implicit state machines prompt failed: what the session records show

First pass, 2026-11-17. This is a read of the session records behind the published results: [the results post](2026-11-17-geva-520-state-machines-prompt-results/README.md) from [garrytan/gstack-evals#360](https://github.com/garrytan/gstack-evals/pull/360), verdict CUT-CANDIDATE. [The correction post](2026-11-17-geva-551-state-machines-break-rates-correction.md) from [#363](https://github.com/garrytan/gstack-evals/pull/363) adds this read's second-reading break rates and its two scoring caveats to the record. #363 was still open when this post was written. No new runs were made. Unless a line says "sample", a count comes from the records of every session. A number marked "post hoc" was chosen after seeing the data, and it decides nothing.

## Takeaways

1. **The prompt restructures working code, and while it does, it changes behaviour at the edges.** We read 18 of its sessions. All 18 rewrote production code, none only documented state machines, and 16 changed observable behaviour, 13 of them while saying they had fixed bugs along the way. The refactor control made the same kind of edits, only bigger. Treat this prompt as a refactor with side effects, not as a documentation pass.
2. **The next fix lost ground because the restructured code no longer matched what the real fix and its tests expected. The next agent did not get lost.** On the restructured tree, follow-on agents edited the file the real fix changes as often as they did on the untouched tree. On Opus, they then failed the fix's tests more often. On Sol, most of the loss came from the fix's own tests refusing to merge onto the restructured code. On particle-1, the whole loss sits in two units where the next fix passed the real fix's tests but failed a test that only the restructured tree's start set counts. We found no session where the restructuring plainly helped.
3. **Part of the measured cost comes from the scoring, so trust the direction more than the size.** On one unit, every model's follow-ons lose through a gap between the untouched tree's start set and the restructured tree's start set. And 6 of the 62 "broke a test" verdicts are log lines that the dataset's parser read as test results. Leaving that one unit out (post hoc) moves the next-fix difference from -7.1 to -5.2 points on Opus, from -5.6 to -3.5 on Sol, and from -3.8 to -1.9 on particle-1. No model gains.

## How we read it

- **Full records:** the outcome, follow-on and start-set records of all 323 scored first stages and 1,455 follow-on rows, plus every session's patch. The break and follow-on counts below come from these.
- **Sample, 53 sessions:** read through compact digests. Each digest holds the agent's own text, a summary of its tool calls, the tool results that looked like errors, its final message and its patch. Three Opus 5.5 readers sorted the digests into fixed columns. We checked every reader claim that the records could check, and corrected three of them (the log-line and start-set findings below).
- **Sample rule.**
  1. For each model, the 54 test units were shuffled with a fixed seed and the first 6 were taken. We read both the A1 (prompt) and the S2 (refactor control) first stages on those 6 units: 36 sessions, paired by unit.
  2. Losses. For each model, we took every unit where the A1 tree's mean follow-on score was below the untouched tree's and the A1 first stage had edited a file that the real fix later changes (Opus 3 units, Sol 2, particle-1 4), plus one more loss unit per model drawn with the seed. On each, we read the first A1 follow-on that failed. That is 12 sessions. The "edited a file the real fix changes" part of this rule was set after seeing that the losses gather there (post hoc).
  3. Wins. For each model, we took the first two units in seeded order where the A1 tree beat the untouched tree (Sol had only one). On each, we read the first A1 follow-on that passed. That is 5 sessions.
- **What wasn't kept:** raw test logs. The records keep only parsed digests and pass/fail lists, so the reason a fix's test failed is often not recorded.

## 1. What did the first stage actually do?

It restructured working code in nearly every session, and in most of them it also changed behaviour at an edge. It almost never just documented.

| Sample, 18 A1 sessions (6 per model) | Count |
|---|---|
| Restructured production code | 18 of 18 |
| Only documented state machines, no logic change | 0 of 18 |
| Changed observable behaviour (new guards, rejections, changed defaults or messages) | 16 of 18 |
| Said in its final message that it fixed at least one bug | 13 of 18 |
| Added a new state type (enum, phase type, transition table) | 17 of 18 |
| Wrote tests | 16 of 18 |
| Ran the project's full test suite | 12 of 18 (3 ran some tests, 3 ran none) |
| Final message said nothing broke or the tests pass | 16 of 18 |
| Scored as breaking a previously passing test | 3 of 18 (1 build failure; 2 involve the log-line artifact in question 5) |

The 2 sessions that kept behaviour the same, by their own account, were Opus on MudBlazor and particle-1 on lean-ctx.

Across all 161 recorded A1 first stages:

- 159 changed production code. Only 2 changed none (1 Opus, 1 particle-1).
- New state constructs appeared in 40 of 54 Opus sessions, 19 of 53 Sol and 48 of 54 particle-1, as published.
- Sol wrote a new state-machine document in 53 of 53 sessions, always alongside code changes. Opus did this 3 times and particle-1 20 times.
- Between 44% and 68% of the sessions touched an existing test file: Opus 30 of 54, Sol 36 of 53, particle-1 24 of 54.

So "document the state machines" happened in 0 of 18 sampled sessions and in at most 2 of 161 overall.

## 2. What broke previously passing tests?

**Both readings.** The strict reading puts back any existing test the agent edited and runs the original. The second reading keeps the agent's own test edits. Its denominators are smaller because it drops units where the fix's tests conflict with those edits.

| First stages that broke a previously passing test | Opus | Sol | particle-1 |
|---|---|---|---|
| A1, strict | 8 of 54 (15%) | 6 of 53 (11%) | 11 of 54 (20%) |
| A1, second reading | 4 of 52 (8%) | 5 of 49 (10%) | 7 of 54 (13%) |
| S2 (refactor control), strict | 10 of 54 (19%) | 12 of 54 (22%) | 15 of 54 (28%) |
| S2, second reading | 7 of 52 (13%) | 10 of 49 (20%) | 7 of 52 (13%) |

**What broke them, all 62 strict breaks**, sorted by the first matching kind:

| Kind | A1 (25) | S2 (37) | Under the second reading |
|---|---|---|---|
| The build failed | 6 | 11 | A1: all 6 still break. S2: 10 still break, 1 clears |
| Previously passing tests were missing from every run (a test target stopped building, the runner ran nothing, or tests were moved) | 9 | 17 | A1: 3 clear. S2: 5 clear |
| Existing tests ran and failed | 7 | 6 | A1: 5 clear. S2: 4 clear, 2 become gaps |
| Only pytest log lines read as tests (question 5) | 3 | 3 | 2 still break, 1 becomes a gap, in each cell |

Most "existing test ran and failed" breaks were tests the agent had rewritten to match its own behaviour change. The second reading accepts those rewrites, so 9 of the 13 clear. That is question 1's edge changes showing up as test failures.

**The two arms made the same kind of edits.** In the paired sample (the same 18 units under each arm):

- Both restructured production code in 18 of 18.
- Behaviour changed in 16 A1 sessions and 14 S2 sessions.
- A claimed bug fix appeared in 13 and 12.
- The final message said the change was safe in 16 and 17.
- The full suite was run in 12 and 15.

What differed was the shape and size of the edits:

- A1 added new state types (17 of 18 against 2 of 18).
- S2 mostly split large files or moved code into new modules (12 of 18, by our count from the readers' notes).
- Across all sessions, S2 moved far more production code. Lines added plus removed: Opus 11,142 against 167,436; Sol 31,967 against 118,329; particle-1 60,907 against 241,402.
- S2's extra breaks are mostly build failures and tests missing from every run: 28 of its 37 breaks, against 15 of A1's 25. Guess: moving code between files is what causes that.

**The breaks cluster.** The 62 strict breaks fall in 24 units, and 6 of those units carry 31 of them. On three of the six (tespy, obscura, biome), every follow-on on the untouched tree passed. So small edits don't break those units, but restructuring them does.

**Question 2 and question 3 are mostly separate problems.** The follow-on loss doesn't come from units whose first stage broke a test. On Opus, the 7 units with a breaking A1 first stage add 0.0 points to the -7.1 difference. All of it comes from the 43 units where the first stage neither fixed nor broke anything. Sol is the same: all -5.6 points come from units with no break. On particle-1, -2.5 of the -3.8 points come from units with no break.

## 3. When the next fix didn't go through, why not?

Follow-on outcomes from all records (162 planned per tree; incremental score):

| | Untouched tree (S0) | A1 tree | S2 tree |
|---|---|---|---|
| Opus: passed / gaps | 113 / 0 | 96 / 6 | 99 / 9 |
| Sol: passed / gaps | 108 / 3 | 88 / 20 | 92 / 21 |
| particle-1: passed / gaps | 106 / 1 | 101 / 2 | 100 / 6 |

Where the missing passes went, A1 against S0:

- **Opus, 17 fewer passes.** 6 are gaps where the real fix's tests would not merge onto the restructured tree. 12 more failed the fix's tests. Build failures account for 4 of those 12: there were 6 on A1 trees whose build the first stage had broken, against 2 on the untouched tree. There was 1 fewer "broke a test".
- **Sol, 20 fewer passes.** There are 17 more gaps: 11 where the fix's tests would not merge, and 6 from infrastructure (an egress helper timing out, plus three follow-ons removed because their first stage had hit it). There were 4 more "broke a test", 3 of them on the start-set unit below. There was 1 fewer failure of the fix's tests.
- **particle-1, 5 fewer passes.** 3 more "broke a test", plus 1 gap and 1 failure of the fix's tests. 6 of A1's 8 "broke a test" rows sit on two units, both described below.

Against the four reasons in the brief:

- **The fix was written against code that had moved.** In the most literal case, the real fix's own tests could not merge onto the restructured tree. That happened on 6 extra Opus follow-ons, 11 Sol and 0 particle-1. In the 12 sampled losses there is 1 clear case: particle-1 on obscura. The first stage had half-fixed the bug with a new registry, and the next agent finished the fix inside the new structure. The harness's drift detector found a renamed identifier that the fix's tests use. It found that on this one unit only, across all models.
- **The agent could not find the bug in the new structure.** No. In the 12 sampled losses, 10 follow-on agents found the bug's location, 2 partly, and 0 missed it. Across all records, Opus's failed A1 follow-ons had edited a file the real fix changes in 42 of 52 cases, against 30 of 40 on the untouched tree. So the extra failures all sit in the right file. Sol (37 of 44 against 33 of 45) and particle-1 (38 of 51 against 38 of 50) look the same.
- **A broken test or build masked the fix.** There are two kinds.
  - A build the first stage broke. A1 follow-ons whose scoring build failed: Opus 6, Sol 4, particle-1 7, almost all on the duckdb and Cataclysm units.
  - A test that the next fix broke and that only the restructured tree's start set counts. Two units:
    - apache/paimon, on all three models. All 9 A1 follow-ons passed the real fix's tests and every base test, yet scored 0 (question 5).
    - particle-1 on Ombi. The fix passed its tests but broke tests that the first stage itself had written.
  - Sampled losses of these kinds: 3 start-set cases, 2 inherited build breaks and 1 fix that broke the first stage's own tests.
- **Something else.** One sampled Sol follow-on stopped on the session allowance mid-edit, one of the four reservation-only stops the results post reports. Four sampled losses have no cause the records show:
  - On c-ares, Opus read the first stage's commit and built a different fix from the one that passed on the untouched tree.
  - On httrack, Opus wrote the same one-line fix as on the untouched tree, and still broke one base test in 2 of its 3 follow-ons.
  - On schemathesis (Sol) and NAudio (particle-1), the agent chose a different design. Neither first stage had touched those files.

  Without test logs, we can't say why the rest of Opus's extra fix-test failures happened.

**The losses gather where the restructuring touched the bug's code (post hoc).** Here, "touched" means the A1 first stage edited a file the real fix later changes:

| A1 minus S0, units with no first-stage fix or break | Opus | Sol | particle-1 |
|---|---|---|---|
| First stage edited a file the real fix changes | 13 units, -17.9 points | 13 units, -10.3 | 21 units, -7.9 |
| First stage didn't | 30 units, -4.4 | 26 units, -5.1 | 21 units, +1.6 |

The start-set unit falls in the first row on every model.

## 4. Were the 54 bugs the kind this prompt is aimed at?

Fewer than half were, by design.

**Share.** Two judges labelled the pool of 470 real bug fixes before the draw. Both called 101 of them state-shaped (21%), 338 other and 31 unclear (agreement kappa 0.81). The draw aimed for 30 of each, so the 54 test units hold 24 state-shaped units (44%). State bugs were over-represented on purpose.

**Did the prompt do better on them?** Not against the refactor control. These readings are post hoc: the preregistration froze strata for claim 1 only. Intervals come from our own bootstrap over repositories (10,000 draws, a different seed from the post's).

| Paired difference in points | Opus | Sol | particle-1 |
|---|---|---|---|
| A1 minus S0, state-shaped units | -5.8 [-17.2, 4.8] | -2.9 [-8.7, 2.6] | +2.8 [-10.1, 13.0] |
| A1 minus S0, other units | -8.0 [-17.8, 0.0] | -8.0 [-17.9, -1.3] | -9.2 [-19.5, 0.0] |
| S2 minus S0, state-shaped units | -8.7 [-20.3, 1.7] | -2.9 [-6.9, 0.0] | +5.8 [0.0, 15.2] |
| A1 minus S2, state-shaped units | +3.0 [-8.3, 15.9] | +1.5 [0.0, 4.8] | -2.9 [-15.9, 5.8] |

Both restructurings hurt less on state-shaped units. That looks like a month effect, not a lens effect:

- 22 of the 24 state-shaped units are from March to June.
- 18 of the 30 other units are from July, the stratum where every tree lost most.
- Within March to June, pooled over the three models, A1 minus S0 is +0.5 on state-shaped units and -8.3 on the others.

As a bug finder, the A1 first stage clean-fixed the target bug in 4 of 72 sessions on state-shaped units, against 3 of 89 on the others.

## 5. What in the records argues against the result?

These points shrink the size of the result. None of them turns it into a gain.

- **A start-set gap in the incremental score (one unit, every model).** The untouched tree's start set is the base stable set, which the oracle filters against the real fix. A restructured tree's start set is every test that passes on that tree before the follow-on. On apache/paimon, one test that the oracle saw but kept out of the stable set passed on all three A1 trees. Every A1 follow-on that fixed the bug then failed it, while the untouched tree ignores it. Our guess, which the records can't confirm because the oracle's per-run results weren't kept: the real fix makes that test fail too. This costs each model about 2 points: -7.1 becomes -5.2 on Opus, -5.6 becomes -3.5 on Sol, and -3.8 becomes -1.9 on particle-1 without the unit (post hoc). particle-1's remaining -1.9 is its Ombi unit, where the next fix broke tests the first stage itself had written. That is a real cost, though a small one.
- **Log lines read as test results.** The dataset's pytest parser treats any log line starting with ERROR as a failed test, named by file and line number. On tespy, any edit that shifts lines in the logging file turns into "new failing tests". This explains 6 of the 62 strict breaks outright: tespy in five cells and nicegui once. A seventh break, particle-1's A1 on tespy, also had three real failures. Without the 6, the strict A1 break rates are 13%, 9% and 19% (Opus, Sol, particle-1), and S2's are 17%, 20% and 26%.
- **A fragile build.** On Cataclysm, the build also failed on 7 of the 9 follow-ons on the untouched tree. Its 6 first-stage build breaks say as much about the scoring build as about the edits.
- **No session where the restructuring plainly helped.** In all 5 sampled wins, the untouched-tree follow-on failed for reasons unrelated to structure, and the first stage had not touched the code that got fixed. None of the 12 sampled losses showed help either.
- **Unasked fixes.** The first stage itself clean-fixed the target bug on 2 Opus units and 5 Sol units. The one we read, Opus on Ombi, is a real fix nobody asked for. The post's sensitivity check already covers these.
- **Reading the new files went with passing, but not because of the state machines (post hoc).** Follow-ons that read a file the first stage created passed more often: Opus 10 of 10 against 86 of 146, Sol 43 of 64 against 45 of 78, particle-1 29 of 44 against 72 of 116. The refactor's trees show the same pattern (Sol 57 of 74 against 35 of 67). Guess: agents read new files when those files sit next to the bug. This is not evidence that the state-machine documents helped.

## What the sessions said

- Opus 5.5, A1: "I rewrote three of them as explicit enums, which also fixed three bugs, and left six unchanged on purpose."
- Opus 5.5, A1, on a unit later scored as broken only by the log-line artifact: "Along the way I fixed a real bug in how a solve ends."
- GPT-6.1 Sol, A1: "The changes are tested within that boundary, but “nothing breaks” cannot yet be guaranteed."
- particle-1, S2, which the strict reading scored as breaking 9 existing tests whose mocks the agent had rewritten: "The solution builds and the full `Ombi.Core.Tests` suite passes (271 passed, 5 pre-existing skips)."
- particle-1, the next fix on A1's tree: "The repo already has a partial registry-based fix (from `first-stage`), but it still deviates from the issue's required invariant"

## How these numbers reconcile with the published results

- **Recomputed and matching.** From the published analysis input, we recomputed A1 minus S0 per model with its n and its counts of worse and better units (Opus -7.1, n 52, 10 and 5; Sol -5.6, n 48, 7 and 1; particle-1 -3.8, n 53, 8 and 7). We also recomputed the first-stage outcome table and the strict break rates (15%, 11%, 20% and 19%, 22%, 28%). All of them match. The session records agree with the analysis input on every first-stage outcome and every follow-on score, with 0 mismatches.
- **Not in the post.** The second-reading break rates (A1 8%, 10%, 13%; S2 13%, 20%, 13%) come from the same records. The post reports the strict reading.
- **Right as scored, but needing a caveat.** The post says A1's first stages broke a previously passing test on 15%, 11% and 20% of units. That is right as scored, but one break per model in A1 is the log-line artifact. The post's explanation that the mismatch "cost a little more than the clearer structure saved" fits the cost side. On the other side, the records show no session where the structure saved anything.
- **Outside the post's analysis.** The start-set gap and the log-line artifact are not in the post's analysis. Both are post hoc observations, and neither changes a verdict.

## What this pass could not show

- Why most of Opus's extra failures of the fix's tests happened. No test logs were kept.
- For each "tests missing from every run" break, whether a test target failed to build or tests were moved. Exit codes only hint at it: 3 of the 9 A1 cases end with cargo's exit code 101 and no tests reported, which reads as a compile failure.
- Whether the real upstream fix fails the start-set test on apache/paimon. That is an inference from the oracle leaving the test out of the stable set.
- Readers worked from digests, not full transcripts. A digest keeps the agent's words and actions but drops most tool output.
- The sample is 53 sessions out of 1,779 recorded. Its counts describe what kinds of things happened. They don't give rates.
