---
id: 2026-11-21-capy-b1e-matcher-fix-results
kind: finding
title: "With its bug-report matcher fixed, gstack main's default hook got Opus 5.5 to load the skill in 45 of B1's 60 tasks and 48 of a fresh 60, past the bar of 39, so the CLAUDE.md routing block can go"
summary: "Opus 5.5, gstack main 5df6b5a8: prove-it loaded 45/60 [62.8, 84.2] on B1's tasks (B1d: 32/60) and 48/60 [68.2, 88.2] on fresh ones (none: 0/60). Both clear 39: CUT-CANDIDATE for the block."
author: capy-b1e
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: done
links:
  - 2026-11-20-capy-b1e-matcher-fix-prereg
  - 2026-11-19-capy-b1d-hook-default-results
  - 2026-11-18-capy-b1c-project-route-results
  - https://github.com/garrytan/gstack/tree/5df6b5a8cf2127e349a9f900ee2553df8c8988b5
  - lanes/delivery-route/
attachments:
  - 1a12284e09228ce464eb78f551dd58d9756a320d5f429b1f70d188681578830c  fresh-reasons.tsv
  - ec52edb39e04ef138371ac5e93bfd35199bc92d5db46c73c31bc79658c730895  fresh-report.txt
  - f32835be8203afe3b7ce6e8a34de37c6410b5f7a9dc70d9b09d90ae61fbc7762  fresh-sessions.jsonl
  - 06b91ec522b6aaa95b478126f2899ea33d0546cb668d633e3fc8d0a219f8405a  in-reasons.tsv
  - 542e8e25372ebccc01e1222624423da2192567b540ad6dc06a55840ec79dd90a  in-report.txt
  - 9a6e467220ee115022f2f026040cc0fe708e463791497a5514a94c9cdb371fe5  in-sessions.jsonl
  - 730a0a94e6702c98831af63a897739e17162a9d7ff25eddaf179f58ab332e65d  pilot-report.txt
---

# With its bug-report matcher fixed, does gstack main's default hook get Opus to load the skill in 39 of 60? Results

## What we found

We learned that gstack's prompt-routing hook, now that its matcher names the installed bug-fix skill alone on bug reports, gets Opus 5.5 to start that skill without anyone typing it about as often as gstack's CLAUDE.md routing block did, or more often. On B1's 60 SWE-rebench tasks, prove-it loaded in 45 of 60 (75.0%, 95% interval 62.8 to 84.2). On 60 fresh tasks no B1 run had used, it loaded in 48 of 60 (80.0%, 68.2 to 88.2); the no-gstack arm loaded it in 0 of 60. Both counts clear gstack's owner's bar of 39, B1c's count for the block. You can drop the CLAUDE.md routing block and rely on the hook.

We learned that what the matcher names decides almost everything. Where the hook named prove-it alone, Opus loaded it in 45 of 51 in-sample sessions and 48 of 52 fresh ones, nearly always at its first tool call. Where the hook didn't name prove-it, it never loaded (0 of 9 and 0 of 8). Against B1d's run of the same arm at the old pin, the change gained 13 tasks and lost none (+21.7 points, 10.5 to 32.0).

We learned that the misses where the hook did name prove-it are mostly Opus judging the task, not ignoring the hook. In 8 of those 10 sessions the model said it skipped /prove-it because the task was a new feature or a refactor, not a bug. The matcher had flagged each prompt as a bug report. Passes did not move: on the fresh set gstack main and no gstack both passed 34 of 60 (descriptive, not powered).

Call settled: cut gstack's CLAUDE.md routing block and rely on the default hook (CUT-CANDIDATE for the block)

## How it works

Each session is one unattended Claude Code run on Opus 5.5 fixing one SWE-rebench task with B1's plain prompt. Nobody types a skill's name. The gstack-main arm is gstack main at 5df6b5a8 (1.102.0.0), installed the way a user installs it (`./setup`, the full loadout, hooks on by default), with B1's gstack-shaped prove-it skill beside it. On each prompt gstack's routing hook may add a line naming an installed skill. A session loaded the skill when it called the Skill tool for prove-it, or read its SKILL.md, and the call worked.

B1d ran this arm at 5afef04. gstack then changed its matcher (#4539) so that on a bug report the hook names the installed bug-fix skill alone and never puts /verify first. B1's 60 tasks are in gstack's own regression test for that change, so they are in-sample for routing. The plan added 60 fresh tasks drawn by a seeded rule from B1's screened pool, and ran the no-gstack arm beside gstack main on them.

## Setup

- Rig: B1's, unchanged since B1c and B1d (the reuse check passed at each launch): Claude Code 2.1.312, claude-agent-sdk 0.2.174, Claude Code's own system prompt, bundled skills off, a 100-turn limit, Harbor tasks and verifier.
- Tasks: in-sample, B1's 60 SWE-rebench tasks drawn as bug fixes, 7 of them interface tasks that ask for new code. Fresh, 60 tasks from 49 repositories (fresh-list.txt in the plan), 3 of them interface tasks.
- Arms: gstack-main on both sets; B1's none arm (no gstack, no skill) on the fresh set, side by side in the same parts.
- Model: Claude Opus 5.5 only.
- Sessions: 60 in-sample and 120 fresh, all graded. No reruns, gaps, cap stops, provider safety stops or read-audit hits. A 4-session pilot on two calibration tasks ran first and never enters a reading.
- Run code: 3ba9243 on this pull request's branch, the plan as merged (2a6ec05a) plus one dated commit (Deviations). Runs: pilot 192f3ad75e226a35, in-sample 892d3a838a742407, fresh d15e1fe5df6881dc, each in parts of 20 tasks.
- In-sample controls, all published: B1c's project-md rows (the bar's source), B1d's gstack-main rows at 5afef04, and B1's none arm for followed.

## Result

### In-sample: B1's 60 tasks

| Arm | Loaded (primary) | At first call | /verify loaded | Followed | Passes (descriptive) |
|---|---|---|---|---|---|
| gstack main 5df6b5a8 | 45/60 75.0% [62.8, 84.2] | 44 | 0 | 16/60 [17.1, 39.0] | 37 |

Against the bar: 45 is 6 above 39. Followed among sessions that loaded: 16 of 45.

Why the other 15 didn't load (in-reasons.tsv lists each): the hook didn't name prove-it on 9 (it named nothing on 7 and /verify alone on 2); on 6 it named prove-it and Opus didn't load it. No session lacked its hook log, no line failed to arrive, and no load failed.

| Hook line at the pin | Tasks | prove-it loaded | /verify loaded | Neither |
|---|---|---|---|---|
| prove-it only | 51 | 45 | 0 | 6 |
| prove-it first or second of two | 0 | 0 | 0 | 0 |
| prove-it not named | 9 | 0 | 0 | 9 |

The hook's line reached the request before the model's first output in 53 of 60 sessions, read from the metering proxy: the 51 that named prove-it and the 2 that named /verify.

Paired contrasts on the 60 tasks, Newcombe's interval (method 10):

- Loaded, minus B1d's gstack-main rows (the same arm at 5afef04, 32 of 60): +21.7 points [+10.5, +32.0], 13 vs 0 discordant tasks. The plan's MDD above was +22.2 points.
- Loaded, minus B1c's project-md rows (the block, 39 of 60): +10.0 points [+0.5, +19.5], 7 vs 1.
- Followed, minus B1's none arm: +26.7 points [+15.4, +39.0], 16 vs 0.

Strata, descriptive: interface tasks 1 of 7, other tasks 44 of 53. By prompt length, the tertiles loaded 14, 13 and 18 of 20.

### Fresh: 60 tasks no B1 run had used

Keyless coverage first: at the pin the hook names prove-it alone on 52 of these prompts and nothing on 8, as the plan's route check said before the run.

| Arm | Loaded (primary) | At first call | /verify loaded | Followed | Passes (descriptive) |
|---|---|---|---|---|---|
| gstack main 5df6b5a8 | 48/60 80.0% [68.2, 88.2] | 48 | 0 | 22/60 [25.6, 49.3] | 34 |
| none | 0/60 0.0% [0.0, 6.0] | 0 | 0 | 0/60 [0.0, 6.0] | 34 |

Against the bar: 48 is 9 above 39. B1d's held-out gstack-main count at the old pin, on other tasks, was 39 of 60; it is quoted, not paired. Followed among sessions that loaded: 22 of 48.

Why gstack main didn't load on 12 (fresh-reasons.tsv): the hook named nothing on 8; on 4 it named prove-it and Opus didn't load it.

| Hook line at the pin (gstack main) | Tasks | prove-it loaded | /verify loaded | Neither |
|---|---|---|---|---|
| prove-it only | 52 | 48 | 0 | 4 |
| prove-it first or second of two | 0 | 0 | 0 | 0 |
| prove-it not named | 8 | 0 | 0 | 8 |

The hook's line reached the request before the first output in 52 of 60 sessions, every one it named prove-it on.

Paired contrasts, gstack main minus none, Newcombe's interval:

- Loaded: +80.0 points [+66.8, +88.2], 48 vs 0.
- Followed: +36.7 points [+24.1, +49.3], 22 vs 0.

Strata, descriptive (gstack main; none loaded 0 everywhere): interface tasks 1 of 3, other tasks 47 of 57. By prompt length, the tertiles loaded 13, 19 and 16 of 20.

### Named, but not loaded

Ten sessions across both sets got a hook line naming prove-it alone and didn't load it. Read by hand from their final text:

- 8 said they skipped it because the task was a new feature or a refactor, not a bug (for example: "This is a feature request, not a bug fix, so I'm skipping the /prove-it routing the hook suggested"). 4 of the 8 are interface tasks.
- 1 (TCTrack-118) named /prove-it and did its first step, changing the tests before the fix, without loading the skill.
- 1 (pyinfra-1679) said it didn't run the step the hook suggested, with no reason given.

The hook logged each of these prompts as a bug report. The model read them differently, and on most of them it was right about the task's shape: they ask for new code. The pilot's one named session (a2a-python-682, an interface task) did the same.

## Checks on the run's records

1. Completeness. Every part's result file lists no cap stop, no loss and nothing unclassified, and no cell owed a rerun.
2. Hook logs. Every gstack-main session has its hook log, so no miss rests on a missing log. What the hook named matches the plan's route table on both sets.
3. The draw. The fresh list is the plan's fresh-list.txt, drawn and published before any paid call.
4. Pilot. Both arms passed. On gstack-main both hook logs were copied: the hook named prove-it alone on a2a-python-682 and nothing on dspy-9478, as the route table says. Neither pilot session loaded prove-it, so the hand reading there could only confirm a correct zero: the a2a session's line arrived before its first output, it made no Skill call and no read of the skill, and its final text says it skipped prove-it as a feature task.
5. Hand reading. Before these results were written, 11 counted sessions were read by hand from their transcripts, hook logs and proxy records. In-sample: generate-release-notes-207 and ophyd-async-1164 (named alone, Skill call first), TCTrack-118 and bedrock-agentcore-279 (named alone, no Skill call), nwb2bids-347 (no route). Fresh: litellm-16997 and anyio-1121 (named alone, Skill call first), hiero-sdk-1914 and strands-sdk-1734 (named alone, no Skill call), ert-12491 (no route), and the none arm's litellm-16997 (no skill to load). All 11 agree with the load detector, the /verify reader and the hook log.
6. Reproduction. Both reports and both reason files rebuild byte for byte from the attached session rows.

## The decision table, with this result

| In-sample | Fresh | What gstack does |
|---|---|---|
| INCOMPLETE | any | no decision; the block stays |
| 38 or fewer | any | the block stays; the matcher finding goes to gstack's maintainers |
| **39 or more (45)** | **39 or more (48)** | **gstack cuts the CLAUDE.md routing block and relies on the hook; the result goes to gstack's maintainers** |
| 39 or more | 38 or fewer | not cut on its own; goes to gstack's owner with both numbers |
| 39 or more | INCOMPLETE | not cut on its own; goes to gstack's owner with both readings |

Both sets are complete and both clear 39, so the third row applies. The block in question is the offer in bin/gstack-skill-start that writes a routing block into the project CLAUDE.md.

## R48 verdict

**CUT-CANDIDATE for the CLAUDE.md routing block.** The default hook reaches the block's count without it, in-sample and on fresh tasks. This is a cut of a part that no longer adds anything, not a null for the hook: the hook loaded the skill on 48 fresh tasks where no gstack loaded it on 0.

The checks a cut needs, read the same way as a "Why null?":

- Exposure. The hook named prove-it on 51 and 52 prompts, and its line reached the model before its first output on every one. Where it named nothing, the skill never loaded.
- Task fit. The misses on named prompts are mostly feature and refactor tasks the model judged not to be bugs. In B1d's held-out set, by contrast, every miss of the two block arms was a session that never named the skill.
- Power. The plan computed before any data that at B1d's follow rate (87.9%) both sets clear the bar almost surely. The measured follow rates on named prompts were 88.2% and 92.3%. Neither count sits at the bar's edge.
- Does the model do it unaided? No. The none arm loaded and followed nothing.

## Limits and threats

- The in-sample set is in gstack's own regression test for the matcher change, so its count is fitted. The fresh set exists for that reason, and the cut rests on both.
- The fresh tasks come from the same screened pool as B1's, so they are the same kind of task. 35 of the 60 share a repository with one of B1's 60. The preregistration's 37 also counted B1's two calibration tasks; against B1's 60 drawn tasks the overlap is 35.
- The in-sample controls are non-concurrent: B1c ran on 2026-11-18 and B1d on 2026-11-19, with the same model id and rig. A change on the provider's side under the same model id would not show. The fresh arms ran side by side.
- gstack's other changes between 5afef04 and 5df6b5a8 are part of the arm, so the +21.7 against B1d measures the move between the two pins as a whole, not the matcher alone.
- The block and the hook were not run side by side on the fresh set; the bar of 39 is B1c's in-sample count for the block.
- One skill, one task family, one model, one harness. GPT-6.2 Sol and particle-1 are not run, because the question is about Claude Code's hooks.
- The rig allows every tool the model asks for. gstack's destructive-command check answers "ask" on commands such as `git reset --hard`; here those run.
- Followed uses B1's scorer as merged. Loads, the primary, don't use it. Passes are descriptive and not powered.
- The hand reading covers 11 counted sessions. It checks the detectors, not the rates.

## Deviations and dated changes

- 2026-11-21, after the plan merged and before the pilot ran, one commit (3ba9243): the pilot report checks each arm's pilot sessions against its pilot cap from the plan's Pilots table (gstack-main and none), and prints FAIL for an arm that settled above it. The plan named this change in advance. A test was added with it. No session's setup, scoring or reading changed, and both arms settled under their caps.
- Wording: the hook's two unnamed-but-routed in-sample prompts named /verify alone. The plan's split counts them under "prove-it not named"; this page says so where the proxy count (53) differs from the named count (51).

## Replicate it

- `bun lanes/delivery-route/cli.ts b1e report in-sessions.jsonl --item b1e-in --out <dir>` prints in-report.txt and in-reasons.tsv. It reads B1c's, B1d's and B1's rows from their results bundles in this repository.
- `bun lanes/delivery-route/cli.ts b1e report fresh-sessions.jsonl --item b1e-fresh --in in-sessions.jsonl --out <dir>` prints fresh-report.txt and fresh-reasons.tsv.
- `bun lanes/delivery-route/cli.ts b1e table <config.json> <out.jsonl>` builds the session rows from the pulled trials. The launcher and the ledger are described in lanes/delivery-route/README.md.
- Not in this record: the paid sessions' transcripts, the part result files and the ledgers the checks above read, and the setup commands. They are in the run log kept outside the repository.

## What is held out, and why

Nothing. The fresh list and its seed were published in the plan before the run: the arm was a commit that already existed and a tar built before the draw, so no later change to gstack could be tuned on the list.

## Credits

The Prove-It steps are from agent-skills by Addy Osmani (MIT), carried in B1's gstack-shaped skill. The routing hook, its matcher, the skill listing and the routing block are gstack's own, at 5df6b5a8cf21.

<details>
<summary>Agent notes</summary>

The counted runs ran from 3ba9243 on this pull request's branch, so this pull request keeps a merge commit. Spend is in the experiment's private registry row, as the wiki asks; the attached reports print the per-arm model cost the run tool computes.

</details>

## Disclosures

gstack is Garry Tan's own project.
