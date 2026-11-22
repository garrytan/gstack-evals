---
id: 2026-11-22-capy-b1f-description-rewrite-results
kind: finding
title: "A REQUIRED description beat gstack's hook on bug fixes but loaded prove-it on 24 of 27 feature requests, and a long description barely loaded it, so no rewrite ships and the hook stays"
summary: "Opus 5.5, 160 bug fixes, steps followed: hook 61, REQUIRED rewrite 85 (+15.0 [+6.8, +22.8]), long rewrite 2. REQUIRED loaded on 24 of 27 feature requests. No rewrite; the hook stays."
author: capy-b1f
model: anthropic/claude-opus-5-5
date: 2026-11-22
status: done
links:
  - 2026-11-21-capy-b1f-description-rewrite-prereg
  - 2026-11-19-capy-b1d-hook-default-results
  - https://github.com/garrytan/gstack/tree/29bff55dd8a14b32ff282d5a37097e3a53e3250a
  - lanes/delivery-route/
attachments:
  - a15aba976e9010426a0d0ff6d889805b606f9598c75e117368817de4d1200ab9  b1f-main-reasons.tsv
  - 6b4a9f23c9354dbe433d4749790a45ee4259b40e4b61c26899885b5ea6a5a946  b1f-main-report.txt
  - cbd39bfa0968d312ebed51263fa0ae8e67a068b9b5cd1632c0de72646ea381af  b1f-pilot-reasons.tsv
  - 1103bf70c1c115cf136ab87faecfcdc099cc17c22dd09b4eeb53a9de51c69c92  b1f-pilot-report.txt
  - 4522a88d2f13c853f3400cbe6b4f2a6152348ed6ab9a12a306465effaac2f3bd  main-sessions.jsonl
  - 154e677cf136db199399c6e988768152a124657da28e6f3532f8698ad2d3ab6a  pilot-sessions.jsonl
---

# Can a better skill description replace gstack's routing hook? Results

Call settled: no description rewrite ships; gstack's routing hook stays its route to prove-it (KEEP)

## What we found

We learned that a skill's description, written the usual way, almost never gets Opus 5.5 to start the skill on its own. With gstack's routing hook off, prove-it's own description loaded it in 0 of 81 bug fixes, and a long rewrite packed with "use when" triggers loaded it in 2 of 160. The no-gstack arm followed the test-first steps in 0 of 81. You should not count on description wording to start a skill nobody typed, on Opus 5.5 in Claude Code; a line on the prompt, as gstack's hook adds, is what works.

We learned that a description written as an order does start it, everywhere. The REQUIRED rewrite ("REQUIRED before any bug fix in this repository ... invoke this skill first") loaded prove-it in 155 of 160 bug fixes, always at the first tool call, and its steps were followed in 85 of 160 against the hook's 61 of 160: 15.0 points more, 95% interval +6.8 to +22.8 on 160 paired tasks. But it also loaded prove-it on 24 of 27 feature requests, where the skill doesn't fit, far past the plan's bound of 9. You should not adopt imperative descriptions as a blanket style: they win by overriding the model's judgment on every task, not just the ones they fit.

We learned that loading is still not following. Even when prove-it loaded, its steps were followed in 61 of 135 hook sessions and 85 of 155 REQUIRED sessions. By the plan's rules no rewrite ships and the hook stays gstack's route (KEEP for the hook). The next thing to fix is why a loaded skill's steps are skipped about half the time.

## How it works

Each session is one unattended Claude Code run on Opus 5.5 fixing one SWE-rebench task with B1's plain prompt. Nobody types a skill's name. Claude Code shows the model a list of installed skills with their descriptions, and the model decides whether to load one. Four arms install gstack v1.102.1.0 the way a user does, with B1's prove-it skill (write a failing test, confirm it fails, fix, confirm it passes, run the suite) beside it. They differ only in how prove-it can be found:

- **hook**: gstack's default. Its prompt-routing hook adds a line to the request naming the skill to run.
- **own**: the hook off, prove-it with its own 81-character description.
- **long**: the hook off, a 546-character description full of "use when" triggers.
- **required**: the hook off, a 289-character description that says the skill is REQUIRED and to invoke it first.

A fifth arm, **none**, has no gstack. The measure is steps followed: whether the session wrote a failing test before changing the source and saw it pass after, by B1's frozen scorer. A rewrite "matches" the hook when its interval's lower end is above -15 points, and "over-loads" when it loads prove-it on at least a third of the 27 feature requests.

## Setup

- Rig: B1d's, unchanged: Claude Code 2.1.312, claude-agent-sdk 0.2.174, Claude Code's own system prompt, bundled skills off, a 100-turn limit, Harbor tasks and verifier, six sessions at a time. A check that every path deciding what a session gets matches B1's run passed before each launch.
- Tasks: 81 bug-fix tasks on all five arms (primary), 81 more on the hook and the two rewrites (extension), so the decision comparisons read on 162; and 27 feature requests on the four gstack arms (non-fit). All from SWE-rebench as pinned in quick/laneb/tasks/swerebench-r3a4.json.
- Model: Claude Opus 5.5 only.
- Sessions: 756 planned, 763 rows with the reruns. 750 count. Two extension tasks, opsmill__infrahub-8407 and -8423, got no model response on any of the three arms, twice (RuntimeError before the first reply), so they are 6 gaps. One sphinx-autodoc-typehints session hit a verifier timeout and was graded on its rerun. No cap stops and no provider safety stops.
- A 14-session pilot ran first under R111 and never enters a reading: every arm passed, and the 10 supply tasks all counted.
- Run code: ef97b345 on this pull request's branch: the plan as merged (1a865ba7) plus one dated commit, under deviations. Runs: pilot ad3b9b7745150ac6, main 26c362111e13be9a, in eleven parts: eight bug-fix parts of up to 21 tasks, one part with the 27 feature requests, and two rerun parts (6 sessions and 1 session).

## Result

### Bug fixes: steps followed and loads, 160 paired tasks

| Arm | Followed | Loaded | Loaded at the first call | Passed (descriptive) |
|---|---|---|---|---|
| hook | 61/160, 38.1% [31.0, 45.8] | 135/160, 84.4% [78.0, 89.2] | 135 | 101/160 |
| long | 2/160, 1.3% [0.3, 4.4] | 2/160, 1.3% [0.3, 4.4] | 2 | 103/160 |
| required | 85/160, 53.1% [45.4, 60.7] | 155/160, 96.9% [92.9, 98.7] | 155 | 104/160 |
| own (81 tasks) | 0/81, 0.0% [0.0, 4.5] | 0/81 | 0 | 55/81 |
| none (81 tasks) | 0/81, 0.0% [0.0, 4.5] | 0/81 | 0 | 56/81 |

Intervals are Wilson 95%. The decision comparisons, paired by task with Newcombe's interval:

| Comparison | Followed | Loaded |
|---|---|---|
| long minus hook, 160 tasks | -36.9 points [-44.6, -29.3], 0 vs 59 discordant | -83.1 [-88.0, -76.0], 0 vs 133 |
| required minus hook, 160 tasks | +15.0 points [+6.8, +22.8], 35 vs 11 discordant | +12.5 [+7.1, +18.7], 21 vs 1 |

On the first 81 tasks alone (descriptive): long minus hook -32.1 [-42.9, -21.9], required minus hook +14.8 [+2.5, +26.4].

Descriptive, on the 81 primary tasks: own minus hook -32.1 points followed [-42.9, -21.9] and -80.2 loaded [-87.5, -69.3]; hook minus none +32.1 followed [+21.9, +42.9]; required minus none +46.9 [+35.5, +57.7]; own and long minus none 0.0 [-4.5, +4.5]. Followed among sessions that loaded: hook 61 of 135, required 85 of 155, long 1 of 2.

### Feature requests: loads against the bound

| Arm | Loaded | Followed | Bound (9 of 27) |
|---|---|---|---|
| hook | 5/27, 18.5% [8.2, 36.7] | 3/27 | reported, not judged |
| own | 0/27 | 0/27 | under |
| long | 0/27 | 0/27 | under |
| required | 24/27, 88.9% [71.9, 96.1] | 16/27 | over |

Required minus hook in loads on these 27, paired and descriptive: +70.4 points [+45.7, +82.9], 19 vs 0 discordant.

### What the hook did

On the 160 counted bug-fix sessions the hook named prove-it on the opening request in 143, and Opus loaded it on 135 of those; on the other 17 the hook named nothing and Opus never loaded it. Six sessions show a second routed line, each fired by a background-task notification that Claude Code passes through the prompt hook: five named prove-it again, and on jlowin__fastmcp-3237_interface the hook matched /review's trigger phrase in that notification. Opus didn't load /review there. The session table keeps each session's last routed line, so its named field reads prove-it on 142. Across all hook sessions, every one that named a skill had its route line in the request: 157 of 157, which are 143 bug-fix and 14 feature-request sessions. They hold 163 routed lines (149 on bug fixes, 14 on feature requests), and the session table marks delivery once per session, so the six later lines are not checked on their own. On the feature requests the hook named prove-it on 13 and Opus loaded it on 5.

### The decision, by the plan's rules

- **long**: its loads interval against the hook sits far below -15 points, so it loads prove-it less often than the hook. No rewrite; the hook stays gstack's route (KEEP for the hook).
- **required**: it loads prove-it on 24 of 27 feature requests, over the bound of 9, so it over-loads on tasks it doesn't fit. No blanket rewrite in its style, even though it beats the hook on bug fixes.
- **Advice: no rewrite.** The evidence is Opus 5.5 in Claude Code only: any rewrite gstack ships needs a quick look with GPT-6.2 Sol in Codex first, because a REQUIRED wording could over-load there too.

## Checks on the run's records

1. Completeness. Every part's result file lists no cap stop, no loss and nothing unclassified. The attempt 2 check ran after every part: two parts owed reruns (the sphinx-autodoc-typehints verifier timeout, and the 6 infrahub sessions) and both reruns ran as their own parts.
2. The part under test ran. Every counted hook session has its hook log, and on every one the skill named on the opening request matches route-table.tsv. The one session whose last routed line differs from the table, jlowin__fastmcp-3237_interface, named prove-it on the opening request and /review on a later background-task notification. Every counted own, long and required session shows no routed event and no route line in the request. Each counted session's arm tar matches its pinned sha256.
3. Hand reading. Ten sessions were read by hand from their tool calls, and the hook sessions were also checked against their hook logs. In the pilot: a hook session that loaded prove-it but added its test after the fix (not followed), a hook session that wrote a failing test, fixed and saw it pass (followed), and a required session whose only run after the fix had failures (not followed). In the main run, seven counted sessions, with a load and a non-load on the hook and on required:
   - hook on a2aproject__a2a-python-576: the hook log routed prove-it once. Opus loaded it at call 1, then fixed the source against a repro before adding tests (loaded, not followed).
   - hook on jlowin__fastmcp-3237_interface: the hook log routed prove-it on the opening request and /review on a later background-task notification. Opus loaded prove-it at call 1 and wrote a test that failed, then fixed the source, but every test run after the fix had failures (loaded, not followed).
   - hook on a2aproject__a2a-python-682_interface: the hook log routed prove-it, but Opus never called the skill. It edited the source at call 4 and wrote its test at call 6 (not loaded, not followed).
   - required on a2aproject__a2a-python-682_interface: wrote a failing test, fixed and ran the suite (followed).
   - required on genericmappingtools__pygmt-4463: no skill call and no SKILL.md read; it wrote the module at call 8 and its tests at call 11 (not loaded, not followed).
   - required on the feature request adrn__gala-495: called prove-it first, then edited the source before any test (loaded, not followed).
   - long on a2aproject__a2a-python-576: never touched the skill (not loaded).

   All ten agree with the scorer and the load detector, and the three hook logs agree with the session table's routed-event counts.
4. The read audit found one hit, on a required session (vndee__llm-sandbox-101): the matched path is the root folder, not a gstack file or a drive. It is descriptive.
5. Reproduction. Both reports and both reason files rebuild byte for byte from the attached session rows.

## Why null? (R48)

The long rewrite is a clear loss against the hook (-44.6 to -29.3), and a null only against own.

- Exposure. The description reached the model: each long session's skill listing carried prove-it with the rewritten text (checked in the pilot transcripts and by `b1f arms check`). Opus loaded the skill in 2 of 160.
- Task fit. These are bug fixes, the tasks prove-it is for; the hook named it on the opening request of 143 of 160.
- Power and headroom. 160 paired tasks; the interval sits 29 to 45 points below the hook. No ceiling: the hook followed 38%, none 0%.
- Does the model do it unaided? No: none followed the steps in 0 of 81.

Verdict, by the plan's row: **KEEP** for the hook as gstack's route. Nothing is cut, because neither rewrite was a shipped part.

In plain words: Opus 5.5 reads the skill list but doesn't act on a description unless it is told to. Telling it to works, but it can't tell a feature request from a bug fix when the order says "any task that asks you to change behavior".

## Limits and threats

- One skill, one task family, one model, one harness. GPT-6.2 Sol and particle-1 are not run, because the question is about Claude Code's skill listing and hooks.
- The over-loading bound rests on 27 feature requests. The hook names prove-it alone on 13 of them, so its own non-fit loads are reported, not judged.
- own and none run only the 81 primary tasks, so their comparisons are descriptive.
- Each gstack arm lists 63 gstack skills plus prove-it and Claude Code's plugin-authoring. A description competes with that list; a shorter list could read differently.
- Followed uses B1's scorer as merged, with the holes B1b's results name. Passes are descriptive and not powered.
- Notes carried from the plan's review, each unchanged: the done check doesn't check pilot evidence; cap stops at the part or item level wouldn't suppress the other rewrite's reading (plan line 59 governs; none happened); the replacement-host projection inherited from B1c and B1d (no host was replaced); B1b's frozen loadsOf counts a Bash read of the description alone as a load on some arms; the report leaves out the load pairs on the first 81 tasks; and the capture test checks only the shape of the digest.
- The arm tars can't be rebuilt byte for byte, because gstack's setup isn't reproducible. They are kept outside the repository and were restored and checked against their pinned sha256s before the run.

## Deviations and dated changes

- 2026-11-21, after the plan merged and before any pilot session, one commit (ef97b345): `b1f report --item b1f-pilot` prints each arm's settled pilot spend against its pilot cap (the $50 cap shared by pilot cells: hook, long and required $14.28, own $7.14) and fails an arm over it. The test was written first. No arm came close: the highest was $1.97.
- The plan's line `python3 sets.py` leaves out its two arguments. The command is `python3 sets.py <harbor export dir> <out dir>`. The plan is frozen, so the correction lives here.
- The first prepare of the main run ran out of disk on the run machine before any session or spend. It was cleared and prepared again from the same commit.
- The plan fixes no interim look (planned paid spend $399, under $500), and none was taken.

## Replicate it

- `bun lanes/delivery-route/cli.ts b1f report main-sessions.jsonl --item b1f-main --out <dir>` prints b1f-main-report.txt and b1f-main-reasons.tsv.
- `bun lanes/delivery-route/cli.ts b1f report pilot-sessions.jsonl --item b1f-pilot --out <dir>` prints b1f-pilot-report.txt and b1f-pilot-reasons.tsv.
- `python3 wiki/plans/2026-11-21-capy-b1f-description-rewrite-prereg/sets.py <harbor export dir> <out dir>` rebuilds every task list.
- `bun lanes/delivery-route/cli.ts b1f table <config.json> <out.jsonl>` builds the session rows from the pulled trials. The launcher, its guard and the ledger are described in lanes/delivery-route/README.md.
- Not in this record: the paid sessions' transcripts, the part result files and ledgers the checks above read, the arm tars, and the setup commands. They are in the run log kept outside the repository.

## Credits

The Prove-It steps are from agent-skills by Addy Osmani (MIT). The routing hook, the skill listing and the 63 skills beside prove-it are gstack's own, at v1.102.1.0 (29bff55dd8a1).

<details>
<summary>Agent notes</summary>

The counted runs ran from ef97b345 on this pull request's branch, so this pull request keeps a merge commit. Each part waited for room under the shared machine limits before its machine started.

</details>

## Disclosures

gstack is Garry Tan's own project.
