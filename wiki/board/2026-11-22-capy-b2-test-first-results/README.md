---
id: 2026-11-22-capy-b2-test-first-results
kind: finding
title: "Following test-first steps didn't fix more bugs on Opus 5.5, GPT-6.2 Sol or particle-1, so gstack's test-first routing is a cut candidate"
summary: "183 tasks, 3 models, 2,196 sessions. Test-first followed in 80% of prove-it sessions vs 3% with gstack; passes -1.5 [-3.8, +0.9], passes with a test +1.6 [-1.0, +4.3]. Neither shown."
author: capy
model: anthropic/claude-opus-5-5
date: 2026-11-22
status: superseded
links:
  - 2026-11-21-capy-b2-test-first-prereg
  - 2026-11-21-geva-569-b2-test-first-change-1
  - 2026-11-21-geva-569-b2-test-first-change-2
  - 2026-11-21-geva-569-b2-test-first-change-3
  - 2026-11-18-geva-548-delivery-route-results
  - 2026-11-19-capy-b1d-hook-default-results
  - https://github.com/garrytan/gstack/tree/29bff55dd8a14b32ff282d5a37097e3a53e3250a
  - https://github.com/addyosmani/agent-skills/tree/39b723ceebf81474d0557c1fecd01eddab585563
  - lanes/test-first/
attachments:
  - 2821f001f313f92e1dee81ff6246c0751fdb67f5cdb6ec7070a9ecf6018d14cc  end-report.txt
  - 59aae02ad3513503046c2d57e654e344d00e78a56ff877df9db9c926e2c59778  look.json
  - 79669105d114a924fd4ce238320dee1bbf64dd7e87c7458bffec74bddac4cdc2  sessions.jsonl
---

# Does following test-first steps fix more bugs? B2 results

Call settled: none yet. The verdict is CUT-CANDIDATE, pending the owner's decision: cut gstack's routing-hook bug-report rule and the "focused failing test first" clause of its CLAUDE.md bug line

## What we found

We learned that a coding agent that writes a failing test first, sees it fail, fixes the bug and sees the test pass does not fix more bugs than the same agent left to work its own way. On 183 real Python bugs, Opus 5.5, GPT-6.2 Sol and particle-1 followed the test-first steps in 80% of the sessions where we asked for them, against 3% with gstack alone, and fixed 1.5 points fewer bugs (95% interval -3.8 to +0.9). You should not expect a test-first procedure to raise your agent's fix rate on bugs like these.

We learned that the agents already ship a test with most fixes. Without any instruction, 90% of Opus's passing fixes and 88% of particle-1's carried a test file. The test-first arms raised that to 100%, but the planned comparison (+1.6 points, interval -1.0 to +4.3) did not clear its bar.

We learned that one plain line in the agent's instructions file and a full skill typed in front of the task get the steps followed about as often on Opus and Sol; on particle-1 the typed skill was followed 7.1 points more often [+0.7, +13.6]. With the line 73% to 86% of sessions followed the steps, with the skill 73% to 87%, and the skill fixed no more bugs than the line on any model. The typed skill took about twice as long per session as the line on Opus, and about five times as long on Sol. If you want test-first behaviour, one line does it.

By the plan's decision table this is a null, and after the "Why null?" check below it is a CUT-CANDIDATE: gstack drops the routing hook's bug-report rule (it names an installed bug-fix skill on bug reports) and the "focused failing test first" clause of its CLAUDE.md bug line.

## How it works

Each session gives an agent one SWE-rebench task: a real GitHub repository at the commit before a bug fix, and the bug report. The agent works in a container until it says it is done. Hidden tests from the real fix then grade the diff it left: a pass means the hidden tests pass. We also read the diff for a test file (a regression test) and read the session's commands to see whether it followed the steps: a test run that fails before the source change, then a run that passes after it.

The four arms differ only in what the agent gets:

| Arm | What the agent gets |
|---|---|
| none | No gstack, no instruction. The plain prompt. |
| line | No gstack. One line in its instructions file: "When you fix a bug, first write a test that reproduces it and run it to see it fail, then fix the bug and run the test again to see it pass." |
| gstack | gstack v1.102.1.0 installed as a user gets it, hooks on. Nothing typed. |
| prove-it | The same gstack, plus the prove-it skill (gstack's setup steps, then agent-skills' Prove-It steps), typed in front of the task. |

The decision compares prove-it with gstack, so the only difference is the test-first procedure. The no-gstack arm sits beside it.

## Setup

- Tasks: 183 SWE-rebench tasks from 126 repositories, all Python, drawn and ordered by a seeded shuffle in the plan.
- Models and hosts: Claude Opus 5.5 and particle-1 in Claude Code 2.1.312; GPT-6.2 Sol in Codex CLI 0.170.0 at reasoning effort low, its default. Every session row takes the model and CLI version from the session's own record.
- Sessions: 4 arms x 3 models x 183 tasks = 2,196, one try each. All 2,196 were graded, with no gaps and no budget stops.
- One planned interim look at the first 92 tasks of every model (z = -0.199 against a stop bound of 2.917), so the run went to the end. Nobody read an outcome before the look or between the look and the end.
- Run dates: 2026-11-21 to 2026-11-22.

## Result

### The decision: prove-it against gstack, pooled over three models

| Outcome | prove-it minus gstack | 95% interval | z | Bar |
|---|---|---|---|---|
| Passes (primary) | -1.5 points | -3.8 to +0.9 | -1.222 | 2.068 |
| Passes with a regression test (co-primary) | +1.6 points | -1.0 to +4.3 | +1.219 | 2.576 |

549 task pairs in 126 repositories, intervals cluster-robust by repository. Neither outcome is shown either way.

The procedure gate passed: the steps were followed in 80.1% of prove-it sessions pooled against 3.3% with gstack alone (gap +76.9 points; the bar was 20), and in 73.2% of Opus's prove-it sessions (the bar was 50%). So the null is not a delivery failure: the agents did the steps.

### Each model

Passes out of 183, with 95% intervals:

| Model | none | line | gstack | prove-it |
|---|---|---|---|---|
| Opus 5.5 | 115 (62.8%, 55.6 to 69.5) | 116 (63.4%) | 119 (65.0%) | 113 (61.7%, 54.5 to 68.5) |
| GPT-6.2 Sol | 96 (52.5%, 45.2 to 59.6) | 92 (50.3%) | 97 (53.0%) | 92 (50.3%, 43.1 to 57.4) |
| particle-1 | 112 (61.2%, 54.0 to 68.0) | 113 (61.7%) | 110 (60.1%) | 113 (61.7%, 54.5 to 68.5) |

Passes with a regression test, and sessions that followed the steps:

| Model | Regression test: none / line / gstack / prove-it | Followed: none / line / gstack / prove-it |
|---|---|---|
| Opus 5.5 | 104 / 116 / 110 / 113 | 0 / 133 / 0 / 134 |
| GPT-6.2 Sol | 90 / 92 / 94 / 92 | 5 / 157 / 17 / 146 |
| particle-1 | 99 / 113 / 105 / 113 | 3 / 147 / 1 / 160 |

prove-it minus gstack, per model (paired, 95% interval):

| Model | Passes | Passes with a regression test |
|---|---|---|
| Opus 5.5 | -3.3 (-8.1 to +1.6) | +1.6 (-3.8 to +7.0) |
| GPT-6.2 Sol | -2.7 (-6.4 to +0.9) | -1.1 (-5.2 to +3.0) |
| particle-1 | +1.6 (-2.9 to +6.1) | +4.4 (-0.5 to +9.2) |

### Beside the decision (descriptive, no correction)

Pooled passes against the no-gstack arm: prove-it -0.9 (-3.1 to +1.3), gstack +0.5 (-1.7 to +2.8), the line -0.4 (-2.6 to +1.9).

The line against none on passes with a regression test: Opus +6.6 (+2.0 to +11.1), Sol +1.1 (-3.3 to +5.5), particle-1 +7.7 (+2.2 to +13.0). These are uncorrected and were not a planned test, so we read them only as a reason to look again.

The plan reads the delivery form (prove-it against the line) only after passes come out above 0. They didn't, so it is not read.

### Time and tokens per session

| Model | Mean wall time: none / line / gstack / prove-it | Mean tokens: none / line / gstack / prove-it |
|---|---|---|
| Opus 5.5 | 255 / 260 / 237 / 474 s | 517k / 491k / 582k / 820k |
| GPT-6.2 Sol | 53 / 59 / 73 / 282 s | 279k / 296k / 432k / 1,263k |
| particle-1 | 268 / 257 / 246 / 425 s | 2.11M / 1.98M / 2.07M / 2.18M |

The line costs nothing extra; the typed skill roughly doubles Opus's time and multiplies Sol's by five.

## Checks on the run's records

- Every session was graded: 2,196 of 2,196, no gaps, no budget stops, no provider safety stops. Turn-limit stops: particle-1 7, 7, 6 and 10 by arm; time stops: Opus 2, 1, 0 and 2, particle-1 one in prove-it.
- Exposure: the line reached all 549 line sessions; prove-it's steps reached all 549 prove-it sessions, and its start step was seen in 547.
- No-gstack read audit: one session out of 1,098 none and line sessions was flagged, a particle-1 none session on newton-physics-1653 that ran `find /` across the whole disk. The none arm has no gstack file on its disk, so this is a search, not a gstack read.
- Scorer hand-check: five pilot sessions (three Codex, one Opus, one particle-1) read by hand agreed with the detector in all five.
- Codex reading limits: some Codex rollout items can't be read for followed. Scored both ways, Sol's prove-it followed count runs from 65 to 167 of 183. Taking the low end for prove-it and the high end for gstack on every model, the pooled gate gap is still 47.9 points, and Opus alone (66.1% at its low end) clears its bar, so the gate passes either way. Passes and regression tests come from the grader and the diff, not from this reader.
- Codex refusals: Codex 0.170.0 refused 11 commands in 732 Sol sessions, all containing `rm -f` (prove-it 4, none 3, line 2, gstack 2). The model wrote them in every arm. gstack has since stopped rendering `rm -f` cleanups into its Codex skills (gstack#4612, bd77c8cc), which is not in the pinned v1.102.1.0.

## The decision table, with this result

| Result | Reading |
|---|---|
| INCOMPLETE | No: Opus, Sol and particle-1 are all complete. |
| Procedure gate fails | No: it passed by 76.9 points. |
| Passes below 0, or passes with a regression test below 0 while passes are not above 0 | No: neither is below 0. |
| Passes above 0, and passes with a regression test not below 0 | No. |
| Passes not shown, passes with a regression test above 0 | No: +1.6, z 1.219, under 2.576. |
| **Neither shown** | **Yes. A null: one "Why null?" cycle, then CUT-CANDIDATE unless it finds an exposure, task-fit, power or ceiling cause.** |

## Why null? (R48)

- Did the models use it? Yes. 80.1% of prove-it sessions followed the steps, against 3.3% with gstack alone. This is not an exposure failure.
- Do the tasks fit? They are real bug fixes with a hidden test, the kind the steps are written for. The plan also asked for a split on bug-report tasks only (plan section 9.4). We did not run it, because no task carries a bug-report label: the tasks were drawn as bug fixes, not checked as bug reports (plan section 3). The split by whether the no-gstack arm passed is the only task-fit split reported. Split that way, prove-it minus gstack was -7.4 points on the 68 tasks Opus failed without help, -2.3 on Sol's 87 and 0.0 on particle-1's 71. Test-first didn't help where there was room to help.
- Were there enough samples? Discordance on passes came out at 10.9% (Opus), 6.0% (Sol) and 9.3% (particle-1), close to the plan's figures, and the plan's smallest difference found 80% of the time was about 4 points pooled. The interval's top, +0.9, rules out a gain of that size.
- Floor or ceiling? No. Without gstack the models passed 52.5% to 62.8%.
- Does the frontier model already do it unaided? No. Without the steps, the models followed them in 0% to 9% of sessions, so the steps changed what the agents did. It just didn't change how many bugs they fixed.

None of the four finds a cause, though task fit was checked only by the split on whether the no-gstack arm passed, because the bug-report-only split could not be run. So the verdict is **CUT-CANDIDATE**: gstack drops the routing hook's bug-report rule and the "focused failing test first" clause of its CLAUDE.md bug line. In plain words for the owner: making the agent write a failing test first doesn't fix more bugs, and gstack's own bug line was followed in almost no session anyway, so both can go.

## Limits and threats

- One procedure on one kind of task: five short steps on Python bug fixes. Other languages, feature work or longer procedures may differ.
- One try per task per arm. The task pairs carry the comparison; single-session noise is in the intervals.
- The prove-it arm differs from gstack by the skill file and by typing it. B2 doesn't separate the two.
- Regression tests are read from paths in the diff, not run. A test file that doesn't test the bug counts.
- Sol ran in Codex, where gstack's host support is marked experimental and its hooks advisory.
- The tasks were drawn as bug fixes, and not every one is a bug report.
- Sol's followed counts carry the Codex reading range above.

## Deviations and dated changes

Three dated changes went in before the first counted session, each committed on this branch:

1. Caps moved $250 from Sol to Opus after the pilot measured Opus at about twice its estimated cost per session and Sol at about a third. No outcome was read (2026-11-21-geva-569-b2-test-first-change-1).
2. Codex runs with `allow_login_shell=false`. In the first pilot, Codex 0.170.0 ran every command in a login shell (`bash -lc`), and the task image's /etc/profile reset PATH. That dropped Bun, so every gstack skill start refused, and it also dropped the task's Python environment prefix. That evidence came from inside real Codex tool calls in our rollouts. With the setting, all 154 commands in a Sol-only re-pilot ran as `bash -c` and no start refused. Another team measured Codex keeping PATH in a Debian image, so this may depend on the image (2026-11-21-geva-569-b2-test-first-change-2).
3. The launch guard projects Sol at 1.25 times its measured pilot cost, and the all-in guard counts every pilot ledger (2026-11-21-geva-569-b2-test-first-change-3).

One dated change came after the run, on 2026-11-22: the plan's "Why null?" cycle asked for a task-fit split on bug-report tasks only (plan section 9.4). It was not run, because no task carries a bug-report label (the tasks were drawn as bug fixes, plan section 3). The split by whether the no-gstack arm passed is the only task-fit split reported.

The scorer reads the plan's followed rule conservatively in a few places: a command that prints a log file is never read as a passing test run; a runner whose summary was cut off falls back to reading the whole call; pytest's "no tests ran" counts as a failing run; a passing run made while the fix is stashed still counts. The five-session hand-check agreed with the detector but was not built to test these readings one by one.

## Replicate it

The lane is in `lanes/test-first/` (`bin/gstack-evals b2 ...`), and lanes/test-first/README.md gives the order: build and check the arms, approve each ledger item, `prepare`, `host-up`, `launch` and `attach` each part, `rerun` after each part, `table` and `look` at the half, then `table` and `report --stage end` at the end. The attached sessions.jsonl is the end table these numbers come from; `b2 report sessions.jsonl --stage end` prints end-report.txt from it. The record leaves out the run's raw transcripts and the paid calls themselves.

## What is held out, and why

Nothing. The tasks are public SWE-rebench tasks, listed in the plan.

## Credits

The Prove-It steps are from agent-skills by Addy Osmani (MIT, Copyright (c) 2025 Addy Osmani), at 39b723ceebf81474d0557c1fecd01eddab585563. gstack is MIT, Copyright (c) 2026 Garry Tan. SWE-rebench is the work of Nebius AI R&D (CC-BY-4.0). Codex CLI is OpenAI's; Claude Code is Anthropic's; particle-1 is Particle's.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
