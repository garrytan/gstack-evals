---
id: 2026-11-17-geva-521-pstack-checks-results
kind: finding
title: "A plain request for a test left a check that caught 20 or 21 of 29 scored real state bugs on each model, and pstack's model-first chain cut the catch rate by 37.9 points (95% CI -50.0 to -26.1)"
summary: "Confirmatory, 270 told sessions on 30 real state bugs. Plain test request 70.1% pooled, pstack 31.1%. P minus N -37.9 [-50.0, -26.1], P minus C -17.2 [-28.7, -4.9]. CUT-CANDIDATE."
author: GEVA-521
model: anthropic/claude-opus-5-5
date: 2026-11-17
status: done
links:
  - 2026-11-09-geva-487-pstack-checks-prereg
  - 2026-11-09-geva-409-state-machines-prompt-prereg
  - https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/harness/pstack/claude-code
  - lanes/outcome-skills/pfchecks/analysis.ts
attachments:
  - f311756db0a46fd8a7e9405e472cc88e2b00997ebdec9bbf2da5136ad7d49c11  analysis-first-pass.txt
  - 6dba96846ac55f7279d336f0f92e06560bf7202c1d2777d11a990aa83c83c587  analysis-rescore-no-s61.txt
  - 6653f817130d494321ba4d31da5871d6231f01e5061c00ad0188555ac0d14261  analysis-rescore.json
  - 9520e89452c9c23a0942563f82fe8f5a3c60f4809b9a7a255ed06977119fbf43  analysis-rescore.txt
  - f629582e3e0dcdb0542c18d2d068e1f21c244a321cfda6e00450fbd08d70da09  catches.py.txt
  - 4e9649de230ea219b1edd82d9438d24f0c0c6adf42444cd5d463c88bcd1ccc8b  catches.txt
  - 60ba7cc40160498e654889e5954e2cb5e335af35b8d6d49feb804509d06337f5  expo-any.ts.txt
  - f039b170e8daa70e5e6b38226086ab2a183469af88a696af8eaa2bf4fc2ce49e  exposure-any-tool.txt
  - 15e6beddaf7cf7518918c65d931e87116ee06123966ae9ef508366a01cdb0e0e  per-arm.py.txt
  - 37bb567a00531445b1b97c804f97de1bcb2484b569165b95a7ef1b9ee7139e72  per-arm.txt
  - ec66ce224db95fb73b08662bed582a50a3a8432b2979c3eb8c677ddcd74db61c  pf-mounts.ts.txt
  - c1a1fd72dbd951aa088b0f5becfe551648ba83ce82e919ba4aa028d637f0e33c  recount-SHA256SUMS.txt
  - d926ca51bdb3baa80ec393bb2717aaf8a3441e44a1ee93a3666d60847c466ced  rescore-vs-first.py.txt
  - bbe3692aa85d30a1a435185f212f59a3c25aca3c69925dd13186d1b165ee5ebc  rescore-vs-first.txt
  - 85ed37cb083419bf38bd01b77a5a07f99cb3725a9ddce6b1e58affe386c5dfd4  score-loop2.sh.txt
  - 5ca6ab1180c00918dca0b8370b458d148c804a47cee786dc8d383cf586d4a6d7  score-loop3.sh.txt
  - abf6d1417bcae5c4682a9186e96340e33fc2114b6c5d331dd8bed100ee9284ea  secondaries.jq.txt
  - 99db79ad63b11d86011417e47ca6ec5b8918aef4a79ddfe6486524d60e852847  secondaries.txt
  - c8de10c161136d8ebee7bf4cac1360aa5d865ab1d23b3feba2e61dcb7e0adc7f  units.py.txt
  - 985c128d43c1cf5c1424c993af605567ee6b47f8c629980050e9c7e57ff23950  units.tsv
---

# A plain request for a test left a check that caught 20 or 21 of 29 scored real state bugs on each model, and pstack's model-first chain cut the catch rate by 37.9 points (95% CI -50.0 to -26.1)

- We learned that a plain request works. Told "Write a test that catches the bug in this bug report", Opus 5.5, GPT-6.1 Sol and particle-1 each left a check that failed before the project's real fix, passed after it and still failed after a harmless edit. They did this on 21 of 29, 20 of 29 and 20 of 29 real state bugs (69% to 72%). You should ask for that test directly when you want an agent to leave a rerunnable check for a known state bug.
- We learned that pstack's model-first chain (/create-formal-verification-skill, then /statechart) left a catching check on only 30% to 33% of the same bugs. Pooled over the three models, it caught 37.9 points less than the plain request (paired 95% interval -50.0 to -26.1; 39 pairs worse, 6 better, 87 pairs). It also caught 17.2 points less than the same steps written in plain words (-28.7 to -4.9; 26 worse, 11 better). The chain loaded and ran a model checker in all 90 of its sessions, so this is a loss, not a missed exposure. You shouldn't adopt this chain in gstack as a way to leave rerunnable checks for state bugs. It is a cut candidate.
- We learned that the checks that tracked the real fix were code tests. Judged by each catching command's text, a code test caught the bug in 25 of the 28 sessions where pstack's chain caught it, and a model-checker run in 3. In 35 of its 90 sessions, a model check that failed before the fix stayed red after it. You should turn a model checker's counterexample into a code test before you keep it as a regression check.

## What works

A one-line request for a test. Each session got the bug report from a real, merged fix in a public project and the code from just before that fix, never the fix itself. In the plain arm (N, no skills), every model left a check that caught the bug and tracked the fix in about 70% of units: 61 of 87 pooled, with 3 sessions on one unit lost to harness gaps. The models did it fast: the median task turn took 1.2 minutes on Opus, 1.9 on Sol and 2.1 on particle-1, and N left a code test in 28 of 30 sessions on every model.

| Model | N, plain request | C, pstack's steps in plain words | P, pstack loaded |
|---|---|---|---|
| Opus 5.5 | 21/29, 72.4% [54.3, 85.3] | 18/28, 64.3% [45.8, 79.3] | 10/30, 33.3% [19.2, 51.2] |
| GPT-6.1 Sol | 20/29, 69.0% [50.8, 82.7] | 5/30, 16.7% [7.3, 33.6] | 9/30, 30.0% [16.7, 47.9] |
| particle-1 | 20/29, 69.0% [50.8, 82.7] | 19/29, 65.5% [47.3, 80.1] | 9/30, 30.0% [16.7, 47.9] |

Catch rate per arm and model, with Wilson 95% intervals, from the rescore (analysis-rescore.txt). A unit scores 1 when at least one listed check fails in all three runs on the code before the fix, passes in all three runs with the fix's source changes applied, and fails in all three runs on the code before the fix plus a harmless comment-line edit. No model judges anything.

## What didn't work

pstack's chain, on this job. pstack is Lauren Tan's skill pack. Its formal-verification chain asks the agent to model the state machine behind the bug, check the model with TLC, draw the flow and replay each bug path on the real code. Given the bug report, it left a catching check in 28 of 90 sessions (31.1%), against 61 of 87 for the plain request (70.1%) and 42 of 87 for the same steps in plain words (48.3%).

- **Against the plain request (P minus N, the head-to-head):** HURTS, -37.9 points [-50.0, -26.1], Holm p < 0.0001, exact McNemar p < 0.0001, 39 pairs worse and 6 better. The loss is the same size on each model: -37.9 on Opus [-57.1, -17.2], on Sol [-60.7, -17.2] and on particle-1 [-60.7, -16.7], each a HURTS reading per model.
- **Against its own steps in plain words (P minus C, the process contrast):** HURTS, -17.2 points [-28.7, -4.9], Holm p 0.0070, McNemar p 0.0201, 26 worse and 11 better. With the replay step in both arms, this contrast isolates pstack's skill text. Per model it reads HURTS on Opus (-32.1 [-55.2, -7.4], Holm p 0.0352) and on particle-1 (-34.5 [-52.9, -15.4], Holm p 0.0068).
- **Sol's process contrast reads the other way and isn't part of the pooled story:** NO MEASURABLE DIFFERENCE, +13.3 [-3.6, 31.0], Holm p 0.3438, 3 worse and 7 better. Sol's C arm was weak for a reason of its own. Most of the checks it listed were inline programs (757 of 1,292 entries: an interpreter's -c or -e, a heredoc or a process substitution), which the frozen rule scores as non-catches, because a check written in the last turn could hide there. Sol's P arm listed inline programs at a similar share (254 of 457 entries), so that habit alone doesn't explain the gap: Sol's C checks also failed on the code before the fix in only 8 of 30 sessions, against 15 for P. The per-model MDD is about 40 points, so this reading can't tell a small difference from none.
- **Cost:** the chain cost more for fewer catches. Per session, P cost 8.0 times as much as N on Opus, 6.7 times on Sol and 2.4 times on particle-1. Per catch, counting every session's spend, it cost 16.8, 14.9 and 5.3 times as much. These ratios use the model spend the run's metering proxy recorded at list prices from 2026-11-13 to 2026-11-15. The totals are in Agent notes.
- **Blind probe, descriptive:** with no bug report, told to model the state machines in the folder around the fix, pstack on Opus caught the real bug in 0 of 8 sessions (Wilson 95% interval 0% to 32.4%). It decides nothing.

P minus N reads as the head-to-head only. N asks for exactly the artifact the score measures and P doesn't, so P minus N alone can't answer the adoption question. P minus C does, and it says no on Opus and particle-1.

## How it works

This section explains the result. It is our reading, not a measurement.

The chain spends its turn on a model. P left its own project verify skill in 30, 30 and 29 of 30 sessions and ran a model checker in all 90. Its median task turn took 9.9, 14.2 and 5.7 minutes, against 1.2, 1.9 and 2.1 for N. The model is written by hand from the bug report and the code, so the checker can find the bug in the model. But nothing links the model to the code, so a model check that fails before the fix keeps failing after it. That happened in 16, 8 and 11 P sessions (35 of 90). pstack's skill text expects a person or an agent to keep the model in step with the code, and a mechanical rerun can't do that.

The step that ties a finding to the code is statechart's hand-off: replay each bug path on the real code as a test. P left a code test in only 14, 13 and 9 of its 30 sessions, against 28 of 30 for N on every model and 28, 28 and 27 for C. Those code tests did nearly all of P's catching: in 25 of P's 28 catching sessions a code test caught the bug, and in 3 a model-checker run did (catches.txt, which classifies by command text: a command that names a model file, TLC or the statechart script counts as a model-checker run). P looked at the right code: at least one of its checks failed on the code before the fix in 22, 15 and 22 of 30 sessions. In the sessions that listed a check the scorer could run (27, 17 and 26 of 30), its new or edited files named a file the real fix changed in 26, 17 and 26 (a file-name match only; N's did in 1 session on each model, out of 28, 27 and 26). It found the bug and then left a check that couldn't see the fix.

## Result

The preregistered primary, verbatim from the scorer (analysis-rescore.txt):

    P minus N: HURTS; delta -37.9 points [-50.0, -26.1], n 87 pairs over 26 repositories, bootstrap p 0.0000, Holm p 0.0000, McNemar p 0.0000, worse 39, better 6
    P minus C: HURTS; delta -17.2 points [-28.7, -4.9], n 87 pairs over 27 repositories, bootstrap p 0.0070, Holm p 0.0070, McNemar p 0.0201, worse 26, better 11
    C minus N: descriptive; delta -20.9 points [-33.0, -9.2], n 86 pairs over 26 repositories, bootstrap p 0.0016, McNemar p 0.0029, worse 26, better 8

Intervals come from a bootstrap over repositories, stratified by model, with 10,000 resamples. Holm's correction covers the two confirmatory contrasts. The pooled MDD at 80% power is 16 to 27 points (section 14 of the preregistration).

**Per model (readings, not verdicts):**

| Model | P minus N | P minus C | C minus N (descriptive) |
|---|---|---|---|
| Opus 5.5 | -37.9 [-57.1, -17.2], HURTS, worse 13, better 2 | -32.1 [-55.2, -7.4], HURTS, worse 12, better 3 | -7.1 [-25.9, 9.4], worse 4, better 2 |
| GPT-6.1 Sol | -37.9 [-60.7, -17.2], HURTS, worse 14, better 3 | +13.3 [-3.6, 31.0], no measurable difference, worse 3, better 7 | -51.7 [-75.0, -27.6], worse 17, better 2 |
| particle-1 | -37.9 [-60.7, -16.7], HURTS, worse 12, better 1 | -34.5 [-52.9, -15.4], HURTS, worse 11, better 1 | -3.4 [-25.0, 15.6], worse 5, better 4 |

**Readings beside the primary, all from analysis-rescore.txt:**

- Gaps scored as 0 for the arm that had them (worst case): P minus N -36.7 [-48.3, -25.0], P minus C -15.6 [-27.5, -3.2].
- Without checks that only read source text with grep, sed, awk or rg, and tests that open a product file as text: P minus N -43.7 [-56.0, -31.5], P minus C -20.7 [-32.3, -8.3].
- The readings without API-guess catches, with compile-blocked reruns and under the two ceiling rules equal the primary. The timing rule flagged no unit, no session hit the 3-hour scoring ceiling, and no entry was left unreached.
- Without session s61 (see Limits): particle-1 N reads 19 of 28 and pooled P minus N -37.2 [-49.4, -25.6] (analysis-rescore-no-s61.txt).

**Strata, descriptive (analysis-rescore.json), pooled over the three models:**

| Fix month | Units | P | C | N | P minus N | P minus C |
|---|---|---|---|---|---|---|
| June to August 2025 | 18 | 21/54 | 28/53 | 44/54 | -42.6 [-57.4, -28.6] | -15.1 [-30.4, 2.0] |
| March and April 2026 | 9 | 4/27 | 11/25 | 15/24 | -45.8 [-62.5, -29.2] | -28.0 [-44.0, -12.0] |
| July 2026 | 3 | 3/9 | 3/9 | 2/9 | +11.1 [-33.3, 55.6] | 0.0 [-22.2, 22.2] |

The two larger strata point the same way as the pooled result, though the oldest stratum's P minus C interval reaches +2.0. July 2026, after both frontier models' training cutoffs, has 3 units (9 pairs) and reads the other way. It is too small to read. N's own rate falls from 81.5% to 62.5% to 22.2% across the three strata, which fits older bugs being easier or more familiar to the models.

**Secondaries, descriptive (secondaries.txt, per-arm.txt):** no session in any arm asked a question. Every counted test session's task turn ended on its own. One Sol C session's first attempt ended on an upstream error and was rerun once from a fresh container, as section 5 allows, and no session became an upstream gap. Three wrap-up turns ended at a limit (Sol C once at its time limit and once at its turn limit, Sol P once at its time limit), and section 5 of the preregistration scores them as they stand. The breaks secondary found a broken existing test in at most 2 sessions in any cell. One Sol P check failed with exit 127 (command not found) in 4 runs because its own command line was broken: it opens with an unclosed `work=$(mktemp)`. That counts against P.

## Why null? (R48)

The primary is negative, so it gets the cycle.

| Question | Answer |
|---|---|
| Exposure: did the model use the part? | Yes. P loaded pstack's skill and ran a model checker in 90 of 90 sessions, counting a read of statechart's SKILL.md by any tool (exposure-any-tool.txt). The frozen count, which credits only the Read tool, gives 46 of 90 (Opus 1, Sol 30, particle-1 15), because Opus in 29 of 30 sessions and particle-1 in 15 read the file through the shell (cat and the like), not the Read tool. The any-tool count clears the preregistered 75% bar, so P minus C reads as a fair test of pstack's text. The analysis output prints "pstack as the model ran it" from the frozen count, and both counts are shown. |
| Task fit: do the tasks call for what the part does? | Yes. Every unit is a lifecycle or state bug that two labellers from different model families marked state-shaped. At least one P check failed on the code before the fix in 22, 15 and 22 of 30 sessions, and in the sessions that listed a check the scorer could run (27, 17 and 26), P's new or edited files named a file the real fix changed in 26, 17 and 26 (a file-name match only). The chain engaged the right bug and left checks that couldn't see the fix. |
| Power, floor and ceiling | The pooled loss of 37.9 points is 1.4 to 2.4 times the pooled MDD (16 to 27 points), and its interval ends at -26.1. P minus C's interval also excludes zero. No arm sits at a floor or a ceiling. |
| Does the frontier model do the job without the part? | Mostly. Plain Opus 5.5 left a catching check on 72.4% of units, and Sol on 69.0%. That leaves room above it, so R61's ceiling attempt doesn't apply: N sits well below a ceiling, and admission's ceiling check (N 5 of 8) passed. |

**Verdict: CUT-CANDIDATE.** Don't adopt pstack's model-first chain in gstack as a way to leave rerunnable checks for state bugs. On this job it lost to a plain test request on all three models, and to its own steps in plain words on Opus and particle-1. What would reopen it: a version of the chain whose default output is a code test for each counterexample, tested against the plain request on held-out units. This result says nothing about the chain as a way to find bugs nobody reported, and the blind probe (0 of 8) can't settle that either way.

## Limits and threats

- **Told mode.** Every scored session got the bug report, so this measures turning a known bug into a check, not finding it. The blind probe is one small reading on Opus.
- **A model-only check scores 0 even when it names the right bug.** The model-only red secondary counts those sessions (16, 8 and 11 for P). A scorer that could credit them would need a person or agent to keep the model in step with the code after each change.
- **One session per cell, 30 units.** Per-model readings can see only differences of about 40 points. The confirmatory verdicts are the pooled ones.
- **The last turn asks for one command per check.** The wrap-up turn, identical in every arm, asks the agent to list each rerunnable check in CHECKS.json. pstack's text asks for one command per verify skill, so this shapes how P reports its checks. The inline-program rule then scores many of Sol's listed entries as non-catches in P and C.
- **Two scoring passes, both kept.** The first pass ran without the tools volume, the pstack volume and the tool environment that section 6.5 gives every scoring run, because the scoring loop left out the flags. So any check that called java, TLC, bun or pstack's statechart script exited 126 or 127. All 278 test and blind sessions were rescored with the frozen flags. This was a deviation after scoring. It applied the frozen rule and wasn't chosen from the data. Every N, C and blind session kept its score and gap, and N matched in 90 of 90. Five P sessions moved from 0 to 1 (one Opus, three Sol, one particle-1), and none moved from 1 to 0. Not-runnable runs fell from 1,304 to 4 (rescore-vs-first.txt). The first pass also reads HURTS on both contrasts: P minus N -43.7 [-55.4, -32.2] and P minus C -23.0 [-34.4, -10.8] (analysis-first-pass.txt). All 3 of P's model-checker catches are among the 5 sessions that moved.
- **Admission was scored the first way and not rescored.** The 8-unit admission run on Opus (P 3, C 5, N 5 of 8) was scored without the same flags. Adding the flags can only let more checks run, and in the test run's rescore it moved no session from 1 to 0, so the first way most likely undercounted P and C here too. Its readings were no floor, no ceiling and no floor-bound contrast, and an undercount of P and C can't change any of them.
- **Exposure rule changed before the test run.** In admission, every Opus P session read statechart's SKILL.md with cat and none with the Read tool, so the frozen detector would have read a fair test as zero exposure. Before any test session, the rule was widened to count a read by any tool. The frozen count is printed beside it.
- **Harness gaps.** 6 of 270 test sessions are gaps: 5 where the fixed tree failed to rebuild with the session's files in place, all on one MudBlazor unit (Opus C and N, Sol N, particle-1 C and N), and 1 where the fix didn't merge onto an Opus C session's tree. No arm-caused gap and no cell over 10%.
- **Harness files the agent could read.** The agent's user could read the harness's own scripts. 17 test sessions named that folder, 16 of them only to list it, and none wrote there. One particle-1 N session (s61) read four harness files, so the result is also shown without it. It changes nothing.
- **Leak-scan stops.** The run's transcript scan stopped the test run three times. Each stop was a needle-prep false positive: the names the scan treated as hidden test names were existing test titles that a test runner printed with a separator, or names a test framework generates from a case list. The name sets for four units were corrected before any outcome was read. One admission unit was halted because its image's build cache held the hidden test names, and the next unit in draw order took its place before that unit's first session. Agent notes has the detail.
- **Parser inputs weren't kept.** We couldn't check directly whether colour codes in test output hid results from the test-output parser. The primary score uses exit codes only and never calls that parser. The breaks secondary does use it.
- **Training data.** The oldest units predate both frontier models' cutoffs, and N's rate is highest there. The loss holds in the two larger strata.

## Setup

- **Question.** Given a real state bug's report and the code before the fix, does the check each arm leaves catch the bug in the real code and track the real fix? Estimand: the paired difference in catch rate per unit, pooled over three models.
- **Arms.** Each session has two turns. The task turn is the arm's text, then the bug report, then "My app is the repository in this directory. Don't stop to ask." The wrap-up turn asks for CHECKS.json, and nothing else from it is kept.
  - P, pstack loaded: "/create-formal-verification-skill model the state machine behind this bug report, and use /statechart to visualize the flow it breaks."
  - C, the same steps in plain words, no skills: "Formally model the state machine behind this bug report with a model checker, and draw the flow it breaks as a statechart. When the model describes code, replay each bug path against the real code, as a test or a live repro, one step for each action."
  - N, no gstack and no skills: "Write a test that catches the bug in this bug report."
  - Blind probe, pstack on Opus, no bug report: "/create-formal-verification-skill model the state machines in {scope}, one skill per subsystem, and use /statechart to visualize the most important flows."
- **Models.** claude-opus-5-5, openai/gpt-6.1-sol and particle-ai/particle-1, each at the pinned Claude Code's default effort. Sol and particle-1 ran through the harness's proxy routes with the provider pinned and no fallbacks. Claude Code 2.1.312 with its own system prompt, bundled skills off, at most 2 subagents at once.
- **pstack.** cursor/plugins commit c742dd61706fbacc1b95f1a20b7b988cf096ce6c, tree harness/pstack/claude-code cdbbd4ca5dd2f4ca0eef3294e7b981c0c610d4bb, plugin 0.15.36, mounted for P only and run as published.
- **Environment, the same in every arm.** A fresh container from each unit's pinned image, the repository at the base commit with a one-commit history, no network except the metering proxy, no web tools, and a read-only tools volume (Temurin JDK 21, tla2tools.jar 1.7.4, bun 1.4.4). No gstack and no drive path in any container.
- **Tasks.** 30 units from SWE-bench-Live MultiLang at revision eb09c2e5, fixed from June 2025 to July 2026, over 27 repositories: Go 8, TypeScript 7, JavaScript 5, Rust 5, C# 3, C 1 and C++ 1. Each passed two cross-family state-shape labels, a screen that its bug report holds no fix text, the oracle's stability rules and a validated harmless edit. units.tsv lists them with every cell's score. The 8 admission units carried the blind probe.
- **Scoring.** The agent's product edits are reverted, and its new files and test edits are kept. Up to 25 listed checks run, each three times on three trees (before the fix, with the fix's source changes, and with a harmless edit), in fresh containers with the tools volume. A check must fail, pass and fail in all three runs of each tree. Checks written as inline programs, or naming nothing the agent added, score as non-catches.
- **Trials.** One session per unit, arm and model: 270 test sessions, 8 blind sessions and 36 admission sessions. The sessions of a unit ran in a seeded, interleaved order.
- **Analysis.** Paired by unit within model. Bootstrap over repositories stratified by model, 10,000 resamples, seeds in the preregistration's prereg.json, Holm over P minus N and P minus C, and exact McNemar beside it.
- **Dates.** Admission 2026-11-12. Test run 2026-11-13 to 2026-11-15. Blind probe 2026-11-15. First scoring pass 2026-11-15 to 2026-11-16. Rescore 2026-11-16 to 2026-11-17.
- **Harness.** gstack-evals at eb4a5259ae52671a92db468a44ee7b4dbb9966b4, lanes/outcome-skills/pfchecks, Harbor 0.25.0.

## Replicate it

1. **Reanalysis, keyless.** The per-session score records are in a private bundle (below). recount-SHA256SUMS.txt lists the sha256 of every file in it. With the bundle, from a checkout at eb4a525 after `bun install --frozen-lockfile`:

       bin/gstack-evals outcome pf analyze --prereg wiki/plans/2026-11-09-geva-487-pstack-checks-prereg/prereg.json --out analysis.json rescore/score-p2/*.json rescore/score-p3/*.json rescore/score-p4/*.json > analysis.txt

   The expected output is analysis-rescore.txt byte for byte, and analysis.json is analysis-rescore.json (sha256 6653f817130d494321ba4d31da5871d6231f01e5061c00ad0188555ac0d14261). We reran this on 2026-11-17 from the bundle and got both byte for byte. Leaving out rescore/score-p2/s61.json gives analysis-rescore-no-s61.txt, which we also reran. The first pass came from the same command on the first-pass records, and we didn't rerun it.
2. **The other tables.** `python3 units.py.txt <bundle>` prints units.tsv, and `python3 catches.py.txt <bundle>` prints catches.txt. secondaries.txt is `jq -r -f secondaries.jq.txt` over each rescore record, summed by model and arm. rescore-vs-first.py.txt, per-arm.py.txt and expo-any.ts.txt ran on the run host's own layout, and their outputs are attached as printed. In expo-any.ts.txt and pf-mounts.ts.txt the run host's checkout path is replaced with `<gstack-evals checkout>`; the copies that ran had sha256 c984ae1cc8cc8b4c… and 21e96fa46a97cae1…. score-loop2.sh.txt and score-loop3.sh.txt are the two scoring loops. pf-mounts.ts.txt prints the section 6.5 flags from the pinned lane code.
3. **Rerun a cell, paid.** No path with only API keys exists yet. A rerun needs this harness on a Docker host, the unit images that the state machines harness builds from the pinned dataset, the metering proxy and a ledger. With one session per cell, expect swings of tens of points per model between replicates.

## What is held out, and why

Nothing in this eval is sealed. The units are public dataset rows, listed in units.tsv. The session transcripts, trees, score records and run logs stay private because they hold repository code and test output. The score records, the analysis inputs and outputs, and the run ledger are kept as one encrypted bundle, and recount-SHA256SUMS.txt lists the digest of every file in it. Outsiders can verify the digests once the bundle is released, and can't rerun the reanalysis before then.

## Record

Publication status: unpublished. Still open before public use: a claim check by a reviewer from another model family, and a rerun of the reanalysis by another team.

| Field | Value |
|---|---|
| Grade | Confirmatory for the pooled P minus N and P minus C verdicts, as preregistered. Per-model readings, strata, secondaries and the blind probe are descriptive. |
| Repo commit | eb4a5259ae52671a92db468a44ee7b4dbb9966b4, on main. Every counted session, both scoring passes and the analysis ran from it. |
| Prereg | [2026-11-09-geva-487-pstack-checks-prereg](../../plans/2026-11-09-geva-487-pstack-checks-prereg/README.md) |
| Data | The private recount bundle. Its SHA256SUMS is recount-SHA256SUMS.txt, sha256 c1a1fd72dbd951aa088b0f5becfe551648ba83ce82e919ba4aa028d637f0e33c. |
| Reviewed by | The review of this post, recorded in its pull request |
| Reproduced by | Not yet by another team. The author's rerun from the bundle matched byte for byte (Replicate it). |

## The claim check

| Check | Evidence |
|---|---|
| The headline holds at both ends of its interval. | P minus N's upper bound is -26.1 points, still a loss of more than a third of the plain arm's pooled rate. The 20 or 21 of 29 (69% to 72%) are the three N rates as measured over scored units; one unit is a harness gap in every N cell. |
| The grade is named. | Confirmatory, pooled. Per-model and stratum readings are labelled as readings. |
| No claim the scorer forbids. | No parity claim and no claim about finding unreported bugs. Sol's process contrast is reported as no measurable difference. |
| No number rounded our way. | Rates and intervals are copied from analysis-rescore.txt. Cost appears only as ratios. |
| Disclosures are settled. | Below, from the org's disclosure list: Particle, OpenAI and gstack. pstack's author and Cursor have no known tie. |
| The sealed guard passes. | Recorded in the pull request. |

## The X hook

We gave Opus 5.5, GPT-6.1 Sol and particle-1 30 real state bugs, each with its bug report, and asked for a check that catches it. Asked plainly for a test, all three left one that caught the real bug about 70% of the time. Asked to model the state machine first with pstack's formal-verification chain, about 31%. Its model checks stayed red after the code was fixed.

## Attribution

The units come from SWE-bench-Live MultiLang (MIT licence) at a pinned revision, and each task repository keeps its own licence. pstack is Lauren Tan's skill pack (MIT), published in cursor/plugins, and it ran as published at its pin. The TLA+ tools (MIT), Temurin (GPLv2 with the Classpath Exception) and bun (MIT) ran in containers and aren't redistributed. gstack-evals is MIT.

## Changelog

- 2026-11-17: first version.

<details>
<summary>Agent notes</summary>

**Decision this changes.** The preregistration maps KEEP to "adopt this pstack idea in gstack for this job" and CUT-CANDIDATE to "don't adopt it". This result is a CUT-CANDIDATE, so it goes to Garry in plain words through the Captain: don't adopt pstack's model-first chain in gstack as a way to leave rerunnable checks for state bugs.

**Paid model spend**, from the run ledger, with every lease settled:

- Admission (24 Opus sessions, 12 Sol and particle-1 price-probe sessions): $44.06.
- Eligibility labels: $19.89.
- Test run: Opus $111.99; Sol $89.87 metered, plus $6.01 for 3 Sol calls of unknown cost, charged at the worst case; particle-1 $6.51. Sol's metered total includes $0.96 for the first attempt of one Sol C session (part 2, s5, c-ares-1197), which ended on an upstream error and was rerun as a whole session under section 5. The table below covers only the 90 counted sessions per model, so Sol's rows come to $88.91.
- Blind probe: $76.73 of its $120 cap.
- Metered total $349.04, committed $355.06, against the line's $1,980.

Mean model spend per test session, metered at list prices:

| Model | P | C | N |
|---|---|---|---|
| Opus 5.5 | $2.077 | $1.396 | $0.260 |
| GPT-6.1 Sol | $1.388 | $1.368 | $0.208 |
| particle-1 | $0.088 | $0.093 | $0.037 |

Per catch, every session's spend over the arm's catches: Opus P $6.23, C $2.33, N $0.37; Sol P $4.63, C $8.21, N $0.31; particle-1 P $0.29, C $0.15, N $0.055. The blind probe averaged $9.59 a session.

**Crew use, reported plainly as the Captain ruled.** The preregistration's money section froze $250 for crew agent use. At admission's re-price on 2026-11-13, crew use stood at about $724 against that $250. The Captain kept the frozen $250 in the n rule rather than cut power. By thread, from Capy's counter at list price on 2026-11-17: the preregistration thread $37.75, the first build thread $16.47, the second build thread $420.85, and the run thread, which wrote this post, $386.53 and rising through this post's review. Total about $862.

**Machines.** One standard-30 runner VM for about 132 hours (2026-11-11 to 2026-11-17), and one standard-8 store VM for off-host copies, kept until this post merges. About $150 in all at list price, an estimate not checked against Ubicloud's bill.

**All-in.** About $1,370 before this post's review: $355 of paid model calls, about $862 of crew agent use and about $150 of machines. That is under the $1,980 line and under the $2,500 point where the Captain asked for a projection.

**Deviations, in run order.** Each was ruled by the Captain and logged in the run record before any outcome it could touch was read, except the rescore, which came after scoring and applied the frozen rule.

1. Admission: NVIDIA__gpu-operator-2258 halted at the containment gate, because its image's Go build cache held hidden test names. gui-cs__Terminal.Gui-4860, the next unit in draw order, took its place before any 4860 session.
2. Admission readings: both MudBlazor-12915 admission sessions stayed gaps with their miss reading.
3. Before the test run: exposure counts a read of statechart/SKILL.md by any tool (expo-any.ts.txt), with the frozen Read-only count beside it.
4. Money: the frozen $250 crew item stayed in the n rule (above).
5. The s75 stop (mui__base-ui-2591): its name needles carried vitest's "describe > " separator, so two were existing base-tree titles. The corrected set applied from s75 on, and the two real names were checked in plain form on the image (0 hits).
6. Union name sets (each v3 name plus its stripped form) for Automattic__mongoose-15534 and jhlywa__chess.js-546 before their first session. Image checks found 0 hits.
7. The s31 stop (notify-rs__notify-701): 34 of its 35 names were generated from a case list that the fix renumbers. The corrected set applied to sessions 32 to 35. Sessions 27 to 31 were scanned under the v3 names and rescanned under the corrected set: 0 hits in 27 to 30, and s31's one hit was cleared because the agent wrote the bare case name before the hit. The bare-name check on the image (archive pass 0 hits, git store 0 hits) was the first plain-form check for this unit. The s33 stop was cleared under the same rule.
8. Sessions that listed or read the harness scripts folder are scored, with 0 writes. s61 gets its sensitivity line.
9. Colour check: no parser change during the run. Parser inputs weren't kept, so the question was answered only indirectly.
10. After scoring: the full rescore with the section 6.5 flags. The first-pass records are kept, and admission is stated as a limit.

**Next-harness notes.** Nothing below changed during this run.

- The outer CLI turns session run's exit 12 into exit 2 (E_INTERNAL), so a loop can't tell a cap stop, a finalize halt and a containment halt apart by exit code.
- outcome pf contain removes its image with docker's default prune, which also removes an untagged parent image. Use --no-prune.
- The agent's user could read the harness scripts folder. Keep harness scripts out of the agent's reach.
- Needle prep should strip leading and trailing separators before the base-tree filter, and should recognise names a test framework generates from a case list.
- Strip ESC sequences in parseRun before the dataset parser, store each parser input's ESC count beside its parsed sha256, and keep the parser inputs.
- Scoring loops must pass the section 6.5 --mount and --env flags, or pf score should build them from the lane itself, as pf-mounts.ts does.
- The exposure detector should count a read of the skill file by any tool.

**Custody.** The recount bundle is sealed with age in the crew's custody store: both passes' score records and logs, the admission records and readings, the analysis files, the any-tool exposure output and the ledger, 1,209 files. Its inner SHA256SUMS is attached. The store VM is destroyed after this post merges.

**Merge method.** Every counted session and the analysis ran from eb4a525, which is already on main. This pull request adds only this post, so a squash merge keeps every run receipt's commit on main.

</details>

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.
