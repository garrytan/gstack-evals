---
id: 2026-11-18-geva-548-delivery-route-results
kind: finding
title: "Handing Opus 5.5 test-first steps directly got them followed in about three sessions of four; putting the steps first did no better, and a skill found by its description never loaded"
summary: "Opus: gstack-shaped 46/60, command 39/60, described 0 (never loaded), none 0; no route reaches 80%, a call inside scorer error. Sol follows unprompted (48/60). particle-1 53 and 49."
author: GEVA-548
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-18
status: superseded
links:
  - 2026-11-17-geva-547-delivery-route-prereg
  - 2026-11-15-geva-503-harness-mechanics-results
  - garrytan/gstack-evals#361
  - lanes/delivery-route/
attachments:
  - 51a9b121aec415189faddda19ef73cdf27d86ba896d86e7f7afdfa17f9aee1af  admission-d1.txt
  - e9f7c01f1032a75995fcce30c7e44b1bb4375e680c08d17b66c0f26dd097e994  hand-criterion.md
  - c6b96fb2343733ce91638f0ec3031dfce979cc087529bcdbdef28e5e824ab25c  hand-excerpts.ts.txt
  - b2cd0c6a9908e4cddaf0eabc6e5c1e2a846f2cdb7feca640cba31c47dacbc0f5  hand-reading.tsv
  - d48a32ab41afecd405438c35abb3f1a413a49e7e3212f1f3fefc3bb6124247fb  hand-score.ts.txt
  - 1919f96ad21b506ebe5faa8d14b0f975289c6c334784b271564e32f5881e7bbb  hand-score.txt
  - 420a44ebc16a483b9d45ff77be5050698912e7745e50300542a87d90507faf52  report.txt
  - 982bbc5d7dab66758bdc76d8ade7e3103bca30f322c156cef28962f4fe49e843  sessions.jsonl
---

# Which delivery route gets a coding agent to follow test-first steps: results on Opus 5.5, GPT-6.1 Sol and particle-1

## What we found

We learned that a model follows a short procedure when the procedure is put in front of it, and not when it has to find it. Claude Opus 5.5 never wrote a failing test before its fix when told nothing (0 of 60 sessions). Given agent-skills' Prove-It steps as a gstack-shaped skill, it did in 46 of 60. Given them as a typed command, it did in 39 of 60. You should hand checkable steps to the model directly, through a typed command or a named skill, and not count on it finding them.

We learned that putting the steps first did not help. The typed command holds the steps alone. The gstack-shaped skill puts about 9 KB of setup before the same steps. The command did no better on any model, and on Opus it was 11.7 points lower (95% interval -24.1 to +1.1). You should not rewrite gstack's routed skills to move the checkable steps to the top on this evidence.

We learned that on Opus neither route clearly reaches the 80% bar that decides this eval, so the reading is the plan's "no route reaches the bar: keep hooks for steps that must run, and stop spending on wording". That call is close. A blind hand reading found the scorer misses some follows and counts some it shouldn't, and it puts both routes near the bar (gstack-shaped about 47 of 60, command 44 to 48). You should treat the bar call as undecided. Steps first still was not better: the scorer puts command 7 sessions below gstack-shaped, and by hand the two routes are within a few sessions of each other (command 3.3 lower under one reader, 0.6 higher under the other).

What didn't work: the route where the agent must find the skill by its description. Opus never loaded it (0 of 60), so that route is untested on Opus, not a loss. GPT-6.1 Sol loaded it in all 60 sessions and followed the steps in 59. Sol already follows the steps unprompted in 48 of 60, at the bar, so Sol can't show what a route adds here.

## How it works

Each session is one Claude Code run fixing one real bug from SWE-rebench. Four arms hand the agent the same five Prove-It steps (write a failing test, confirm it fails, fix, confirm it passes, run the suite):

- none: nothing;
- described: a skill the agent finds by its description in Claude Code's skill list;
- gstack-shaped: a named skill laid out the way gstack lays out its skills, with a long setup block first and the steps after;
- command: a typed command that holds only the steps.

A scorer reads each session's transcript and final patch and counts a session as followed when it wrote a test, saw it fail before its first source edit, and saw it pass after. The bar is 48 of 60 sessions (80%), read on Opus.

## Setup

- Rig: the harness mechanics eval's, unchanged: Claude Code 2.1.312, claude-agent-sdk 0.2.174, its own system prompt, bundled skills off, auto-loaded instruction files removed, a 100-turn limit, Harbor tasks and verifier.
- Tasks: 60 SWE-rebench bugs from 60 repositories, drawn once from a seeded shuffle (tasks.txt in the plan).
- Models: Claude Opus 5.5 (the decision model), GPT-6.1 Sol and particle-1. Sol and particle-1 are read the same way and reported as descriptive.
- Sessions: 720 (60 tasks x 4 arms x 3 models), all graded. There were no reruns, gaps, cap stops, safety stops or read-audit hits.
- Run code: commit b12a7b7 on this post's branch (the plan's code plus deviation D1, below). Runs: b1-opus 627d49babacb36d0, b1-sol 82e87eb05b00fe35, b1-p1 248492f26fdf6bae, after a 24-session smoke (f5931294973ec045) that never enters a reading.
- The gstack-shaped arm carries gstack 1.99.5.0's /verify setup block. gstack 1.100.0.0, stable since 2026-11-17, changed /verify's text: it moved the Stop hook's check-after-last-edit rule into /verify's prose.

## Result

Followed sessions, with Wilson 95% intervals (report.txt):

| Model | none | described | gstack-shaped | command | Reading |
|---|---|---|---|---|---|
| Opus 5.5 (decision) | 0/60 [0.0, 6.0] | 0/60 [0.0, 6.0] | 46/60 76.7% [64.6, 85.6] | 39/60 65.0% [52.4, 75.8] | no route reaches the bar: keep hooks for steps that must run, and stop spending on wording |
| GPT-6.1 Sol | 48/60 80.0% [68.2, 88.2] | 59/60 [91.1, 99.7] | 60/60 [94.0, 100] | 60/60 [94.0, 100] | none reaches the bar: the model follows the steps unprompted, so no route can show lift here |
| particle-1 | 1/60 [0.3, 8.9] | 4/60 [2.6, 15.9] | 53/60 88.3% [77.8, 94.2] | 49/60 81.7% [70.1, 89.4] | gstack-shaped reaches the bar and so does command: no layout change (descriptive) |

Paired contrasts on the 60 tasks, with Newcombe's interval (method 10):

| Model | gstack-shaped minus none | command minus none | command minus gstack-shaped | described minus none |
|---|---|---|---|---|
| Opus 5.5 | +76.7 [+63.2, +85.6] | +65.0 [+51.0, +75.8] | -11.7 [-24.1, +1.1] (4 vs 11 discordant) | 0.0 [-6.0, +6.0] |
| GPT-6.1 Sol | +20.0 [+9.9, +31.8] | +20.0 [+9.9, +31.8] | 0.0 [-6.0, +6.0] | +18.3 [+7.1, +30.3] |
| particle-1 | +86.7 [+73.9, +92.7] | +80.0 [+66.4, +87.9] | -6.7 [-18.8, +5.3] | +5.0 [-2.4, +14.0] |

The plan's power analysis puts the smallest difference this design finds 80% of the time at about 20 points when a quarter to a third of task pairs disagree, as Opus's command and gstack-shaped pairs did (15 of 60). So a gain from steps first smaller than about 20 points can't be ruled out, but the estimate points the other way on two models and is zero on the third.

The reading follows the order the plan's section 8 sets, with the clarification recorded before the smoke: "reaches" means the 80% bar alone, and the paired-interval guard applies after it. Neither guarded reading came into play on Opus, because no route reached the bar.

Exposure. The step text reached the transcript in every typed-arm session (60 of 60 on each model). The described skill loaded through the Skill tool in 0 of 60 Opus sessions, 60 of 60 Sol sessions and 1 of 60 particle-1 sessions. Opus made every source edit through Bash in 50 of its none sessions and 52 of its described sessions, and in 35 gstack-shaped and 38 command sessions.

Sensitivity lines from the report:

- Writes no parser can name and spec-folder writes, scored both ways: Opus gstack-shaped 43 to 50 (the report says the bar reading rests on them) and command 31 to 42. Sol none is 44 to 48 (rests on them), and particle-1 command is 46 to 50 (rests on them).
- Only Write and Edit seen as writes: Opus gstack-shaped 8, command 7.
- Sessions with a Bash run sent to the background and never read (the plan's section 6 asks for these; report.txt leaves them out, so they are counted from sessions.jsonl): Opus 3, 4, 4 and 5 across none, described, gstack-shaped and command; Sol 6, 30, 33 and 38; particle-1 1, 3, 1 and 2.
- The rule as merged, before deviation D1: Opus gstack-shaped 44, every other cell unchanged, with the same readings.
- Passes (verifier reward 1, descriptive): Opus 35, 34, 38 and 38 across none, described, gstack-shaped and command; Sol 34, 32, 31 and 32; particle-1 34, 36, 32 and 32. Following the steps did not visibly change how many bugs got fixed, which this eval does not measure.

In the admission data (the plan's section 10), Sol's none arm sat at the bar with a range of 45 to 48 of 60. The drop of three came from two spec-folder sessions and one session with a write no parser can name. Here it is 48, with a range of 44 to 48.

### Blind hand reading, post hoc

This line was added after the outcome data, when hand reading showed the scorer missing follows near the bar. The primary above stays the result of record, and the decision table is read on it alone.

The rule was frozen before anyone read further (hand-criterion.md): the same three steps, with a call that holds several commands split into its commands, each test runner's own summary read for it, and failures in other files, linters and missing tools ignored. The excerpts (hand-excerpts.ts.txt) keep only the file writes and the test runs, with anything that names an arm removed.

Two readers labelled all 116 excerpts independently and blind to arm: fresh Claude Opus 5.5 contexts (reader A) and GPT-6.2 Sol (reader B). The excerpts were every near-follow (a failing run before the fix, with no passing run the scorer saw after it) on every model, plus 10 randomly drawn sessions the scorer counted as followed per arm and model (all of them where an arm had fewer). The readers agreed on 111 of 116 (Cohen's kappa 0.86). In all 5 disagreements, A read followed and B could not tell. Disagreements are left as a range (hand-reading.tsv).

| Model and arm | Primary | Near-follows read as followed (A, B) | Sampled follows read as not followed (A, B) | Hand estimate (A, B) |
|---|---|---|---|---|
| Opus gstack-shaped | 46 | 6, 6 of 12 | 1, 1 of 10 | 47.4, 47.4 |
| Opus command | 39 | 9, 9 of 14 | 0, 1 of 10 | 48.0, 44.1 |
| Sol none | 48 | 0, 0 of 1 | 1, 1 of 10 | 43.2, 43.2 |
| Sol described | 59 | none | 1, 2 of 10 | 53.1, 47.2 |
| Sol gstack-shaped | 60 | none | 1, 3 of 10 | 54.0, 42.0 |
| Sol command | 60 | none | 0, 1 of 10 | 60.0, 54.0 |
| particle-1 gstack-shaped | 53 | 1, 1 of 3 | 0, 0 of 10 | 54, 54 |
| particle-1 command | 49 | 0, 0 of 1 | 0, 0 of 10 | 49, 49 |
| particle-1 described | 4 | none | 0, 0 of 4 | 4, 4 |
| particle-1 none | 1 | none | 0, 0 of 1 | 1, 1 |

The hand estimate is the primary, plus the near-follows read as followed, minus the sample's not-followed rate times the primary. Opus none and described have no near-follows and nothing to sample.

What it says:

- On Opus, the scorer errs both ways. It missed 6 gstack-shaped and 9 command follows, mostly passing runs chained with grep, a python -c check, a linter or another suite in one call, plus one fix written by a python heredoc. It also counted one gstack-shaped session that both readers read as not followed.
- So the bar call on gstack-shaped sits inside the scorer's error: about 47 of 60 by hand against 46 by the rule, with the bar at 48. Command showed no clear gain over gstack-shaped under either reading: the scorer puts it 7 sessions lower, and by hand which route is ahead depends on the reader (command 3.3 sessions lower under reader B, 0.6 higher under reader A). Beside the decision reading this line adds "undecided on the bar".
- Every Sol sample session read as not followed is a "can't tell" at step 2: the excerpt cut the failing run's output. So those numbers bound what the excerpts show, not the scorer's error.
- The over-count estimates rest on 10 sessions each, so each carries wide uncertainty (1 of 10 has a 95% interval of about 2% to 40%).

## Why null? (R48)

The question was whether a route lifts Opus past the bar, and whether steps first beats setup first.

- Exposure. The typed routes delivered the step text in 60 of 60 sessions on every model. The described route never fired on Opus (0 of 60 loads), so on Opus it is untested, not a loss. On Sol it fired every time.
- Task fit. Every task is a bug report, so the steps fit each one.
- Power and headroom. Opus's none arm is at 0 of 60, so there is no ceiling. The bar separates a route near 85% from one near 70%, and gstack-shaped's interval (64.6 to 85.6) straddles the region where the bar lands either side. Sol is at the bar without any route (a ceiling).
- Does the frontier model do it unaided? Sol does, in 48 of 60. Opus does not, in 0 of 60.

Verdicts:

- Steps-first layout, the proposed change to gstack's routed skills: CUT-CANDIDATE. The command route showed no gain over the gstack-shaped skill on any model, with full exposure and room to move on Opus.
- gstack-shaped layout: KEEP. It moved Opus from 0 to 46 of 60 and particle-1 from 1 to 53 of 60, and the setup block before the steps did not stop them.
- Described route on Opus: FIX-METHOD. The skill never loaded, so the arm measured Claude Code's skill listing on Opus, not the description. A next test has to find out why Opus doesn't load it before a description can be judged.
- Scorer: FIX-METHOD, noted for the next eval's scorer. Split a Bash call that holds several commands into its commands, read each test runner's own output, and read fixes written by a heredoc script. Its tests belong with that scorer, not here.

## Limits and threats

- One procedure on one task family. Five short steps on bug fixes may not carry over to a long procedure.
- The bar call on Opus sits inside the scorer's error (above). The route comparison has a clear direction only on the scorer: by hand the two routes are within a few sessions, and which is ahead depends on the reader.
- D1's per-command reading has two holes a reviewer found. A test runner wrapped in xargs reads as one plain run, and a filter after a pipe that reads its own file (such as `| cat old.log`) can supply another run's summary. D1 changed two counted readings, both Opus gstack-shaped, and both were read by hand from the full call during the run. In newton-1582 (trial JKG2ZNX), the test passed after the fix ("1 passed, 9 deselected"), then the call stashed the fix and ran the test again ("1 failed"). The rule as merged let that second count hide a real pass. In sdk-python-1719 (trial PppoKQb), a run of tests/strands with -x stopped on a collection error, then the test file alone printed "21 passed", then mypy and ruff ran. Both read as followed, so neither changed reading rests on these holes. Their transcripts are not in this bundle, and these two checks are not part of the blind reading. The fix belongs with the next eval's scorer.
- The hand reading is post hoc, its over-count side rests on 10-session samples, and its excerpts can cut a failing run's output.
- The described arm can't tell a description's wording from Claude Code's listing mechanism, and on Opus it never got past the listing.
- The gstack-shaped arm uses one gstack setup block (/verify's, at 1.99.5.0), not every skill's.
- Passes are descriptive. Whether test-first fixes more bugs is a later eval's question.

## Deviations and dated changes

- D1, 2026-11-17, before any counted session. A smoke hand check found two Opus sessions on getmoto__moto-9590 that followed the steps but were scored as not followed. In one, another suite's collection errors were printed next to the test's own "1 passed". In the other, a missing linter made the call exit 127 after "178 passed". The passing run is now also read per test-runner command when a call's runners and test summaries pair one to one, and the rule as merged is kept and reported beside every primary (lanes/delivery-route/README.md, "Deviation D1").
- A second-model review of D1's first version found two ways it could read a pass that did not happen. One was runners started together with &. The other was a summary cut off and paired with a summary printed by a script. Both were closed before any counted session (b12a7b7).
- Rerun over the admission sessions, D1 changes two section 10 readings, both Sol: none 151 to 152 of 200 (48 of the 60 unchanged), and verify-prose 144 to 145 of 200 and 47 to 48 of the 60 (admission-d1.txt). In the counted runs it changed two Opus gstack-shaped sessions, 44 to 46, and nothing else.
- The blind hand reading above, added after outcome data.

## Replicate it

- Code: lanes/delivery-route at b12a7b7. `gstack-evals b1 table <config> <out.jsonl>` builds the session table from pulled trials, and `gstack-evals b1 report <table.jsonl>` prints report.txt from sessions.jsonl.
- The hand reading: hand-excerpts.ts.txt built the excerpts and drew the sample (xorshift32 seeded from crypto random bytes, seed 2176078244), hand-score.ts.txt scored the labels (hand-score.txt), and hand-reading.tsv holds every label.
- Not in this record: the paid sessions themselves and the setup commands. They are in the run log kept outside the repository.

## What is held out, and why

Nothing. The tasks are public SWE-rebench tasks and the arm texts are in the lane.

<details>
<summary>Agent notes</summary>

Spend, on the plan's ledgers (dollars): smoke 3.23 of 90, Opus 93.13 of 170, Sol 144.70 of 230, particle-1 41.97 of 70. That is 283.03 of the 560 approved, plus VM hours inside those items. Mean model cost a session: Opus 0.31, 0.31, 0.48 and 0.39 (none, described, gstack-shaped, command); Sol 0.45, 0.62, 0.61 and 0.65; particle-1 0.15, 0.16, 0.17 and 0.15. The hand reading's readers came to about 11 dollars of model use.

The counted runs ran from b12a7b7, on this post's branch, so this PR keeps a merge commit.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
