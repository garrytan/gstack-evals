---
id: 2026-11-18-capy-b1c-project-route-results
kind: finding
title: "The routing block in the project CLAUDE.md got Opus 5.5 to load the skill in 39 of 60 bug fixes, up from 20 in the user file, and still clearly loses to the hook line's 58"
summary: "Opus 5.5, 60 bugs: the project CLAUDE.md block loaded prove-it 39/60 [52.4, 75.8]. Minus the hook line -31.7 points [-44.2, -19.2], clearly loses; minus the user-file block +31.7 [+18.8, +42.6]."
author: capy-b1c
model: anthropic/claude-opus-5-5
date: 2026-11-18
status: done
links:
  - 2026-11-18-capy-b1c-project-route-prereg
  - 2026-11-18-capy-b1b-prose-route-results
  - 2026-11-18-capy-b1b-prose-route-prereg
  - garrytan/gstack-evals#371
  - https://github.com/garrytan/gstack/tree/bbf48aa7ef195459afcf7d7840af7073cd050734
  - lanes/delivery-route/
attachments:
  - 6777ff58f857fdf1ad63fadde611a6ac008775042305279fb93f375731cb130a  reasons.tsv
  - 25935deaeec8b1c92f1191d978c6017c84236d9665cd5a7561d0b6f75e7ec585  report.txt
  - d21b0d0b8fa52c7e65acae092f30892d8c5c11f58d80f3dc21461d5efedb77e1  sessions.jsonl
---

# Does gstack's CLAUDE.md routing block load the skill on Opus 5.5 when it sits in the project's CLAUDE.md? Results

## What we found

We learned that where a routing block sits changes how often Opus 5.5 acts on it. gstack's CLAUDE.md routing block, with its bug line naming the prove-it skill, got the skill loaded in 20 of 60 bug fixes from the user's CLAUDE.md (an earlier run, B1b). The same bytes in the task's project CLAUDE.md, where gstack's project install writes them, got it loaded in 39 of 60. Every task that loaded from the user file loaded here too, and 19 more did: +31.7 points, 95% interval +18.8 to +42.6. You should put routing text in the project's CLAUDE.md, not the user's.

We learned that even in the project file, a CLAUDE.md block is not a dependable way to start a skill. gstack's prompt-routing hook line loaded the skill in 58 of 60 on the same tasks. The paired difference is -31.7 points (95% interval -44.2 to -19.2), wholly below the plan's -15 point margin, so the plan's reading is "clearly loses". In all 21 sessions where the block didn't load the skill, Opus never wrote its name, in text, thinking or any tool call. You should start a skill with a route on the prompt, such as gstack's hook line, and not count on CLAUDE.md to do it.

We learned that the hook can't take the block's place yet. B1b found that gstack's hook, as shipped, names prove-it on none of these 60 prompts, and with prove-it added to its list its matcher would fire on 22. So on these bugs the project block loads the skill more often end to end (39 of 60) than the listed hook would (22 of 60, counted directly). You should fix the hook's matcher before gstack drops the block.

The plan's reading is that CLAUDE.md routing is a CUT-CANDIDATE wherever it sits: gstack stops relying on its routing block to start skills. The caveat above applies to how it stops: relying on the hook instead pays off only once the matcher fires on bug reports.

## How it works

Each session is one Claude Code run on Opus 5.5 fixing one real bug from SWE-rebench, with B1's plain prompt. Nobody types the skill's name. The arm carries B1's gstack-shaped prove-it skill (gstack's /verify setup followed by agent-skills' five Prove-It steps) and gstack's "Skill routing" block with its bugs line changed to "- Bugs/errors → invoke /prove-it". Before the session starts, a script writes the block to /testbed/CLAUDE.md, the project root, and commits it with gstack's own message, as gstack's project install does. Claude Code then loads it as "Contents of /testbed/CLAUDE.md (project instructions, checked into the codebase)".

The comparison arms are B1b's published rows, on the same 60 tasks: the hook line (gstack's prompt-routing hook adding one line naming /prove-it to each prompt) and the same block in the user's CLAUDE.md. A session loaded the skill when it called the Skill tool for prove-it, or read its SKILL.md, and the call worked.

## Setup

- Rig: B1's and B1b's, unchanged: Claude Code 2.1.312, claude-agent-sdk 0.2.174, Claude Code's own system prompt, bundled skills off, instruction files removed from the task tree before the block goes in, a 100-turn limit, Harbor tasks and verifier.
- Tasks: B1's 60 SWE-rebench bugs, byte for byte.
- Model: Claude Opus 5.5 only.
- Sessions: 60, all graded. There were no reruns, gaps, cap stops, provider safety stops or read-audit hits. A 2-session smoke ran first and never enters a reading.
- Route file: gstack at bbf48aa (1.100.0.0), with the one-line change to the block that B1b made.
- Run code: main at 6a72369, the plan as merged. Runs: b1c-opus c66bd17a1271d4c7 in three parts of 20, after the smoke e8630f209774d729.
- Controls, not rerun: B1b's hook and user-file arms, ran on 2026-11-18 from 6191ded. A check of every path that decides what a session gets passed before each launch (the plan, section 5). B1's Opus none arm is the no-gstack arm: same model, tasks, rig and prompt, with no skill.

## Result

Per arm, with Wilson 95% intervals (report.txt):

| Arm | Loaded (primary) | Steps seen | Followed | Followed, of loaded | Passes (descriptive) |
|---|---|---|---|---|---|
| project CLAUDE.md (this run) | 39/60 65.0% [52.4, 75.8] | 39 | 23/60 [27.1, 51.0] | 23/39 | 39 |
| hook line (B1b) | 58/60 96.7% [88.6, 99.1] | 58 | 36/60 [47.4, 71.4] | 36/58 | 36 |
| user CLAUDE.md (B1b) | 20/60 33.3% [22.7, 45.9] | 20 | 9/60 [8.1, 26.1] | 9/20 | 34 |

B1's reference rows: none followed 0 of 60 (passes 35); typed gstack-shaped followed 46 (passes 38).

Paired contrasts on the 60 tasks, with Newcombe's interval (method 10):

- Loaded, project block minus hook line (the primary, margin -15): -31.7 points [-44.2, -19.2], 0 vs 19 discordant tasks. The whole interval sits below -15, so the band is "clearly loses".
- Loaded, project block minus user-file block (placement): +31.7 [+18.8, +42.6], 19 vs 0. The project placement loads more.
- Followed, project block minus hook line: -21.7 [-36.1, -5.6], 6 vs 19. Minus user-file block: +23.3 [+10.0, +35.8], 16 vs 2.
- Followed against B1's rows (descriptive, because B1 ran earlier): minus B1 none +38.3 [+25.6, +51.0]; minus B1 typed gstack-shaped -38.3 [-52.7, -20.8].

The project block never loaded the skill on a task where the hook line didn't. Its 39 loads include all 20 of the user-file block's loads. Every load came through the Skill tool at the first tool call.

Why sessions didn't load (reasons.tsv lists each with the model's first text): all 21 are "never named". None had the block missing or a failed load. The 21 name prove-it nowhere in the model's text, thinking or tool calls. The only mention in their logs is Claude Code's own skill list at the start.

Placement. All 60 sessions carry the placement line, and every session's Claude Code transcript holds the block's bug line under the project-instructions label. None shows a user CLAUDE.md. In 10 sessions the repo tracked its own root CLAUDE.md, which the strip removed and the block replaced; 8 of those 10 loaded. No shipped diff names the root CLAUDE.md.

Read after the run, descriptive:

- On the 7 interface tasks, which ask for new code rather than a fix, the block loaded on none. The hook line loaded on 5 and the user-file block on none. On the other 53 tasks the block loaded on 39 (73.6%) and the hook line on 53.
- On the 22 prompts gstack's hook matcher would route with prove-it listed, the block loaded on 19; on the other 38, on 20.
- Loads by part were 15, 15 and 9 of 20 (B1b's user-file block: 11, 5 and 4). The parts hold different tasks, so this can't tell drift from task mix.
- B1's rule before its deviation D1 reads followed as 22.

### Cost

| Arm | Model cost | A session | Tokens |
|---|---|---|---|
| project CLAUDE.md | $24.86 | $0.414 | 39.5M |
| hook line (B1b) | $24.18 | $0.403 | 38.3M |
| user CLAUDE.md (B1b) | $22.18 | $0.370 | 35.2M |

The whole run, machines included, cost $27.35 on the plan's ledgers, which are not attached: $26.827 for the 60 sessions ($24.858 model, $1.970 machines) and $0.518 for the smoke.

Prices, as metered on 2026-11-18 and 2026-11-19 from the metering proxy's table (quick/laneb/config/proxy.json, unchanged since commit 1b82ca5). Claude Opus 5.5, per million tokens: input $4, output $20, cache write $5 (5 minutes) or $8 (1 hour), cache read $0.20. Machines: $0.08 an hour for the host and $0.60 an hour for each part's 16-core machine.

## Checks on the run's records

After the plan merged, a second-model review of the analysis code found three ways the session table could misread a run. They became checks on the run's own files before this post was written. None found anything.

1. Refused reserves and cap stops. A spend reserve refused at launch is recorded only in that part's result file, which the report doesn't read. Every part's result file (the smoke and all three parts) lists no cap stop, no loss and nothing unclassified. Both ledgers settle every reserve they open, and none records a refusal. The metering proxy refused no request in any of the 60 sessions. So the run is complete.
2. Missing session logs. A graded session with no SDK log would read as not loaded. All 60 graded sessions have one, so the primary reads 39 of 60 with missing logs counted as not loaded (as B1b did) and 39 of 60 with them left out. The band is the same either way.
3. Patch failures. If the model edited the placed CLAUDE.md, its shipped diff might not apply to the original snapshot and score as a fail. No verifier log in the 60 sessions or the smoke reports a diff that did not apply, and no shipped diff names the root CLAUDE.md. Five diffs carry the strip's deletions of a repo's nested instruction files (for example xarray/tests/CLAUDE.md), as the plan's section 4 says they still do.

Hand reading. Two smoke sessions and four counted sessions were read by hand from their transcripts: copier-2646 and xarray-10863, which loaded, and generate-release-notes-207 and black-4952, which didn't. All six agree with the load detector. The two that didn't load edit the source within their first two tool calls and never mention the skill.

## The decision table, with this result

The plan's table (section 1). The caveat on the bold row comes from B1b's as-shipped facts: gstack's hook names prove-it on 0 of these 60 prompts, and with prove-it listed it fires on 22.

| Opus 5.5 result | Band | What gstack does |
|---|---|---|
| the interval lies wholly above -15 points | matches | CLAUDE.md routing stays as a way to start skills, written to the project CLAUDE.md. |
| the interval crosses -15 points | middle | gstack keeps writing the block but relies on the hook line; the block gets FIX-METHOD. |
| **the interval lies wholly below -15 points (this result: -31.7 [-44.2, -19.2])** | **clearly loses** | **CLAUDE.md routing is a CUT-CANDIDATE wherever it sits: gstack stops relying on its routing block to start skills, and the cut goes to gstack's owner in plain words. Caveat: on these prompts the block loads the skill on 39 of 60 and the listed hook as shipped would fire on 22, so the hook takes over only after its matcher fires on bug reports.** |
| INCOMPLETE | none | No reading. |

## Why null? (R48)

The project block falls short of the hook line by 31.7 points.

- Exposure. The block reached every session: all 60 carry the placement line, and every transcript holds the block under Claude Code's project-instructions label. When the skill didn't load, the model never named it. So the block was read and not acted on, rather than missing.
- Task fit. The tasks are SWE-rebench issues drawn as bugs, and the block's line is about bugs. Seven are interface tasks that ask for new code; the block loaded on none of them. On the other 53 it loaded on 39, still 14 short of the hook line's 53.
- Power and headroom. The plan's rule detects a true load rate of 63% or less as "clearly loses" 80% of the time. The upper end of the interval, -19.2, clears the margin by 4.2 points. There is no ceiling: B1's none arm followed the steps in 0 of 60.
- Does the model do it unaided? No. B1's none arm never followed the steps, and B1's skill found only by its description never loaded.

Verdict, CLAUDE.md routing as the way gstack starts a skill in an unattended Opus session: CUT-CANDIDATE. In plain words, gstack should stop relying on its CLAUDE.md routing block to start skills nobody types. In the project CLAUDE.md, where gstack writes it, it worked about two times in three on these bugs, against nearly every time for the hook line, and when it didn't work Opus never wrote the skill's name. The block still loads the skill more often than gstack's hook would on these prompts as shipped, so dropping the block before the hook's matcher is fixed would lose loads.

## Limits and threats

- The controls are non-concurrent. B1b's arms ran earlier on 2026-11-18 and B1's none arm on 2026-11-17, with the same model id (claude-opus-5-5) and Claude Code 2.1.312. A check of git trees for every path that decides a session passed before each launch. A change on the provider's side between the runs would not show.
- One skill, one task family, one model, one harness. The block's form is B1b's: one line of gstack's block changed so it names a skill for bugs, since as shipped it routes bugs to no skill.
- The strip removes each repo's own instruction files, so the block is the whole project CLAUDE.md. In a real project it would often sit after the project's own text, which this run doesn't test.
- The placement is a script run before the session, not gstack's interactive offer: the same file, bytes and commit message, with a stand-in author.
- No arm carries both the block and the hook line, so this run doesn't say what the two do together.
- The gstack-shaped setup prints B1's stand-in line ROUTING_DECLINED: true, which a real gstack install with the block would not print.
- Followed uses B1's scorer as merged, with the holes B1b's results name. Loads, the primary, don't use that scorer.
- The hand reading covers six sessions. It checks the load detector, not the rates.

## Deviations and dated changes

- 2026-11-18, after the plan merged and before any paid call: the three checks on the run's records above were added from a second-model review of the analysis code. They read the run's files and don't change how the primary or the band is computed. Each found nothing.
- The plan expected the block's delivery in paid sessions to rest on its keyless sessions, because paid sessions keep no request bodies. Each session's Claude Code transcript records the project CLAUDE.md it loaded, and all 60 hold the block. This is a descriptive check the plan didn't freeze.
- The plan's own departure from its brief (the placement path) is in its section 14. The run followed the plan.

## Replicate it

- `bun lanes/delivery-route/cli.ts b1c report sessions.jsonl --out <dir>` prints report.txt and reasons.tsv from the attached rows. It reads B1b's rows from B1b's results bundle in this repository.
- `bun lanes/delivery-route/cli.ts b1c table <config.json> <out.jsonl>` builds sessions.jsonl from the pulled trials. The config lists each part's jobs folder and the metering proxy's session file.
- The launcher, its guard and the ledger are described in lanes/delivery-route/README.md.
- Not in this record: the paid sessions' transcripts, the part result files and ledgers the checks above read, and the setup commands. They are in the run log kept outside the repository.

## What is held out, and why

Nothing. The tasks are public SWE-rebench tasks and the arm files are in the repository.

## Credits

The Prove-It steps are from agent-skills by Addy Osmani (MIT), carried in B1's gstack-shaped skill. The routing block and the project-install steps are gstack's own, at bbf48aa7ef19.

<details>
<summary>Agent notes</summary>

Spend on the plan's ledgers (dollars): b1c-smoke 0.52 of its 20 cap, b1c-opus 26.83 of its 80 cap (24.858 model, 1.970 machines), against the 150 all-in stop. Sessions averaged 0.414 against the plan's 0.41 planning rate. The lane's own model use was about 40 dollars at the end of the run, including the preregistration's /ship.

The three checks on the run's records are the hand checks the Captain bound to the review-loop exception on #371: a refused reserve or cap stop reads INCOMPLETE, rows with no SDK log are named and the primary is reported both ways, and patch-apply failures are counted.

The counted runs ran from 6a72369 on main, so this pull request can be squashed.

</details>

## Disclosures

gstack is Garry Tan's own project.
