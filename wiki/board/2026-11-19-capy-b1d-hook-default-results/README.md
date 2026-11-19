---
id: 2026-11-19-capy-b1d-hook-default-results
kind: finding
title: "gstack main's default hook got Opus 5.5 to load the skill in 32 of 60 tasks, under the bar of 39, so the CLAUDE.md routing block stays"
summary: "Opus 5.5, B1's 60 tasks: gstack main 5afef04, hooks on, loaded prove-it 32/60 [40.9, 65.4], under 39. Held-out: gstack main 39/60, project CLAUDE.md block 45/60 (matches), none 0/60."
author: capy-b1d
model: anthropic/claude-opus-5-5
date: 2026-11-19
status: done
links:
  - 2026-11-19-capy-b1d-hook-default-prereg
  - 2026-11-18-capy-b1c-project-route-results
  - 2026-11-18-capy-b1b-prose-route-results
  - 2026-11-19-capy-description-route-corrections
  - https://github.com/garrytan/gstack/tree/5afef04e31de1cb30c727c7f827bdd729d04713e
  - lanes/delivery-route/
attachments:
  - c12ff26d9fd21cd7c8615e0615cd8d036763462a3808092da5c5882e56868cd5  heldout-list.txt
  - 9044fe8de145b36c04db9acaf8b5d15831c91833f75fff5e1008bb190c683d9f  ho-reasons.tsv
  - 84f7ab2c7f4187900dffcc24c0bc75bc0a5ee943e848601832bfada0f0687ff5  ho-report.txt
  - 409afc6dcfb1ded4892a3b6a7432eccc6c402410a8d0cab8cfc465545b213478  ho-sessions.jsonl
  - 8de6f7f6d68ed5494f9016674910bd656f760989889a17a20a93cc336cf0e2c2  in-reasons.tsv
  - 6892edef7f4eeaea9fd1cd91107e056f1e0b80aa8729f987c91fc2f942e837aa  in-report.txt
  - b8ffd9c0a988e769637b1519bd9e8b90c4d4ff3a25ffa3e39b9504cf63ff88af  in-sessions.jsonl
  - f6d60f7f9eb83ed00e31bbf3bf83d833bf44c92bde0ccdef59cbdfff375b8577  pilot-report.txt
  - 19c3376a6478d8f2345e159ae16bd8602e4561e58f977bd5347ce260695fcc0c  routes-heldout.tsv
  - 47efaf1f6d41d69991d0b36a1f05f835a04a24467a8b69265618879a485d7255  seed.txt
---

# Does gstack main, with its hooks on by default, get Opus to load the skill without anyone typing it? Results

## What we found

We learned that gstack's prompt-routing hook, now on by default, starts a skill nobody typed most of the time it names that skill. On B1's 60 SWE-rebench tasks, when the hook's line named prove-it alone, Opus 5.5 loaded it in 29 of 33 sessions. On 60 fresh held-out tasks it loaded it in 35 of 39. Every load but one came at the model's first tool call. You should route skills with a line on the prompt, as this hook does.

We learned that the hook as shipped at 5afef04 does not yet replace gstack's CLAUDE.md routing block. It named prove-it on only 40 of B1's 60 prompts. On 7 of those it named /verify first, and Opus took /verify on 4 of them. End to end, prove-it loaded in 32 of 60 (53.3%, 95% interval 40.9 to 65.4), under gstack's owner's bar of 39. By the plan's rule, the block stays and the result goes to gstack's owner. On the held-out set the hook did better (39 of 60), but B1c's block in the project CLAUDE.md loaded more there (45 of 60). You should fix the matcher, so it names the skill on more bug reports and stops putting /verify ahead of prove-it, before cutting the block.

We learned that loading the skill didn't raise passes in this run. On the held-out set, the no-gstack arm passed 46 of 60, the same as gstack main, and the two block arms passed 43 and 45. Passes are descriptive here and the run isn't powered for them, but nothing in it shows a pass gain from loading prove-it.

## How it works

Each session is one unattended Claude Code run on Opus 5.5 fixing one SWE-rebench task with B1's plain prompt. Nobody types a skill's name. The gstack-main arm is gstack main at 5afef04 (1.101.0.0), installed the way a user installs it (`./setup`, the full loadout, hooks on by default), with B1's gstack-shaped prove-it skill installed beside it. On each prompt, gstack's routing hook may add a line that names one or two installed skills. A session loaded the skill when it called the Skill tool for prove-it, or read its SKILL.md, and the call worked.

B1's 60 tasks are "in-sample for routing": gstack's matcher was tuned with them in view. So the plan added a held-out set of 60 other tasks, drawn by a seeded rule and sealed until every held-out arm finished. Four arms ran on it side by side: gstack main; B1c's routing block in the project CLAUDE.md (project-md); the same block without its escape clause (project-md-noescape); and no gstack (none).

## Setup

- Rig: B1's, B1b's and B1c's, unchanged: Claude Code 2.1.312, claude-agent-sdk 0.2.174, Claude Code's own system prompt, bundled skills off, a 100-turn limit, Harbor tasks and verifier. A check of every path that decides what a session gets passed against B1c's run before each launch.
- Tasks: B1's 60 SWE-rebench tasks, drawn as bug fixes, 7 of them interface tasks that ask for new code (in-sample). A held-out 60 drawn from B1's screened pool minus B1's repositories, one task per repository, 6 of them interface tasks.
- Model: Claude Opus 5.5 only.
- Sessions: 60 in-sample and 240 held-out, all graded. No reruns, gaps, cap stops, provider safety stops or read-audit hits. An 8-session pilot ran first on two calibration tasks and never enters a reading.
- Run code: 709dae5 on this pull request's branch: the plan as merged (594c96f) plus one commit, listed under deviations. Runs: pilot 4681829b01a2429c, in-sample 719776bf4ff7d87a and held-out 0bbfd009283d113b, each in parts of 20 tasks.
- Controls: B1c's published project-md rows for the in-sample comparison (ran 2026-11-18), and B1's none arm for followed. On the held-out set every arm ran in this run.

## Result

### In-sample: B1's 60 tasks (the decision)

| Arm | Loaded (primary) | At first call | /verify loaded | Followed | Passes (descriptive) |
|---|---|---|---|---|---|
| gstack main | 32/60 53.3% [40.9, 65.4] | 31 | 4 | 17/60 [18.5, 40.8] | 39 |

Against the bar: 32 is 7 short of 39.

Why the other 28 didn't load (in-reasons.tsv lists each with the model's first text): the hook didn't name prove-it on 20; it named /verify first and Opus loaded /verify on 4; on 4 the hook named prove-it and Opus wrote its name but didn't load it. No session lacked its hook log, and no load failed.

What the hook printed, and what loaded:

| Hook line at the pin | Tasks | prove-it loaded | /verify loaded | Neither |
|---|---|---|---|---|
| prove-it only | 33 | 29 | 0 | 4 |
| prove-it first of two | 0 | 0 | 0 | 0 |
| prove-it second of two (after /verify) | 7 | 3 | 4 | 0 |
| prove-it not named | 20 | 0 | 0 | 20 |

The hook printed a line, naming some skill, before the model's first output in 42 of 60 sessions, read from the metering proxy. On the other 18 prompts it names nothing.

Paired contrasts on the 60 tasks, with Newcombe's interval (method 10):

- Loaded, gstack main minus B1c's project-md rows: -11.7 points [-22.9, +0.2], 3 vs 10 discordant tasks. The plan's in-sample MDD is +19.9 above and -23.3 below, and the plan said before any data that the interval couldn't show the hook above the block.
- Followed, gstack main minus B1's none arm: +28.3 points [+16.8, +40.8], 17 vs 0.

Strata, descriptive: the hook named prove-it on 40 tasks and it loaded on 32 of them; on the 20 it didn't name, 0. Interface tasks 0 of 7; other tasks 32 of 53. By prompt length, the tertiles loaded 8, 8 and 16 of 20.

### Held-out: 60 sealed tasks, four arms side by side

Keyless coverage first: at the pin, the hook names prove-it alone on 39 of these prompts, first of two on 3, second of two on 7, and not at all on 11. That is more coverage than on the in-sample 60 (33 alone, 20 not named), even though the matcher was tuned on those.

| Arm | Loaded | At first call | /verify loaded | Followed | Passes (descriptive) |
|---|---|---|---|---|---|
| gstack main | 39/60 65.0% [52.4, 75.8] | 39 | 5 | 15/60 [15.8, 37.2] | 46 |
| project-md | 45/60 75.0% [62.8, 84.2] | 45 | 0 | 18/60 [19.9, 42.5] | 43 |
| project-md-noescape | 47/60 78.3% [66.4, 86.9] | 47 | 0 | 23/60 [27.1, 51.0] | 45 |
| none | 0/60 0.0% [0.0, 6.0] | 0 | 0 | 0/60 [0.0, 6.0] | 46 |

Why gstack main didn't load on 21: the hook didn't name prove-it on 11; Opus loaded /verify instead on 5; on 3 it wrote prove-it's name and didn't load it; on 2 it never named it. The block arms' misses are all "never named" (15 and 13); no block went unplaced.

| Hook line at the pin (gstack main) | Tasks | prove-it loaded | /verify loaded | Neither |
|---|---|---|---|---|
| prove-it only | 39 | 35 | 0 | 4 |
| prove-it first of two | 3 | 3 | 0 | 0 |
| prove-it second of two (after /verify) | 7 | 1 | 5 | 1 |
| prove-it not named | 11 | 0 | 0 | 11 |

The hook printed a line before the model's first output in 49 of 60 sessions. On the other 11 prompts it names nothing.

Paired contrasts, Newcombe's interval, the plan's margin of -15 points for the bands:

- Loaded, gstack main minus project-md: -10.0 [-21.3, +1.5], 3 vs 9. The disagreement rule fires at -26 or below: it doesn't.
- Loaded, project-md minus gstack main: +10.0 [-1.5, +21.3]. The lower end is above -15, so the band is "matches".
- Loaded, project-md-noescape minus gstack main: +13.3 [+2.0, +24.5], 10 vs 2. Band "matches".
- Loaded, project-md-noescape minus project-md (the escape clause alone): +3.3 [-4.3, +11.2], 3 vs 1.
- Followed, each arm minus none: gstack main +25.0 [+14.0, +37.2]; project-md +30.0 [+18.2, +42.5]; project-md-noescape +38.3 [+25.6, +51.0]. No none session followed the steps.

Strata, descriptive (gstack main, project-md, project-md-noescape, none):

- Hook names prove-it (49 tasks): 39, 41, 42, 0. Hook doesn't (11 tasks): 0, 4, 5, 0.
- Interface tasks (6): 1, 4, 4, 0. Other tasks (54): 38, 41, 43, 0.
- Prompt-length tertiles of 20: 11, 11, 13, 0; 14, 18, 18, 0; 14, 16, 16, 0.

### Cost

| Run, arm | Model cost | A session | Tokens |
|---|---|---|---|
| in-sample, gstack main | $25.29 | $0.421 | 39.2M |
| held-out, gstack main | $21.92 | $0.365 | 35.9M |
| held-out, project-md | $19.88 | $0.331 | 33.4M |
| held-out, project-md-noescape | $19.30 | $0.322 | 32.1M |
| held-out, none | $15.80 | $0.263 | 25.4M |

The whole run cost $114.91 on the plan's ledgers, which are not attached: the pilot $7.91 ($0.38 of it machines), in-sample $27.02 ($1.74 machines) and held-out $79.98 ($3.08 machines). The plan's caps summed to $325.

Prices, as metered on 2026-11-19 from the metering proxy's table (quick/laneb/config/proxy.json, unchanged since d85f75a). Claude Opus 5.5, per million tokens: input $4, output $20, cache write $5 (5 minutes) or $8 (1 hour), cache read $0.20. Machines: $0.08 an hour for the host and $0.60 an hour for each part's 16-core machine.

## Checks on the run's records

1. Completeness. Every part's result file lists no cap stop, no loss and nothing unclassified, with one exception: the first launch of the held-out set's third part never got a machine (the provider reported "waiting for capacity" for 10 minutes), its ledger holds no session row, and no trial started. It was relaunched once and that relaunch ran all 80 sessions. No cell owed a rerun.
2. Hook logs. Every gstack-main session has its hook log, so "hook log missing" is 0 in both sets and no miss rests on a missing log.
3. The sealed route table. Before the held-out report, the held-out route table was rebuilt from the held-out list at 709dae5 (`b1d routes --sealed`). It matched the sealed copy byte for byte (sha256 19c3376a...). The report also checks its coverage against the counts committed before the run.
4. The draw. `draw.py seed.txt <out>` with the attached seed reproduces heldout-list.txt exactly, and both committed digests match.
5. Hand reading. Four counted gstack-main sessions were read by hand from their transcripts and hook logs: schemathesis-3933 and virtualizarr-97, where the hook named prove-it alone and the Skill call came first; ophyd-async-1164, where the hook named prove-it alone and none of the model's 12 tool calls was a Skill call; and smolvm-172, where the hook named /verify first and the first call loaded /verify. All four agree with the load detector, the /verify reader and the hook log.
6. Reproduction. Both reports and both reason files rebuild byte for byte from the attached session rows.

## The decision table, with this result

The plan's table (section 1):

| In-sample result (60 tasks) | What gstack does |
|---|---|
| prove-it loaded in 39 or more | gstack cuts its CLAUDE.md routing block and relies on the hook, unless a held-out stop applies |
| **prove-it loaded in 38 or fewer (this result: 32)** | **the block stays, and the result goes to gstack's owner** |
| INCOMPLETE | no decision |

The held-out stops apply only when the in-sample count clears 39, so none applies. For the record, none would have fired: the held-out set is complete, the disagreement reading is -10.0 (the rule needs -26 or below), and the current block "matches" the hook, so the rewrite rule doesn't apply.

## Why null? (R48)

The plan froze its R48 verdict for CLAUDE.md routing, read from the held-out bands. Project-md "matches" gstack main, so the table's first row applies: **no R48 verdict for CLAUDE.md routing**. The current block is not a losing part on the held-out set, and whether it is cut as redundant rests on the in-sample rule, which keeps it.

The hook is not a null either: on the held-out set it loaded the skill on 39 tasks and the none arm on 0, and the steps were followed 25 points more often. Its shortfall against the bar, read the same way:

- Exposure. The hook named prove-it on 40 of the in-sample prompts and 49 held-out. Where it didn't name it, the skill never loaded (0 of 20 and 0 of 11). Where it named prove-it alone, it loaded 29 of 33 and 35 of 39.
- Order. On the two-name lines that put /verify first, Opus took /verify on 9 of 14 across both sets, as the hook's own text tells it to when both fit.
- Power and headroom. The plan computed, before any data, that with 40 prompts named the hook would clear 39 with even odds only if Opus followed it about 96% of the time or more (0.61 at 96.7%, 0.40 at 95%), and almost never if it took /verify on the two-name prompts. There is no ceiling: none loaded 0 of 60.
- Does the model do it unaided? No. The none arm never loaded prove-it or followed its steps.

In plain words: the hook route works when it names the skill; the matcher doesn't name it often enough on these tasks, and when it names two skills it puts the other one first.

## Limits and threats

- The primary is in-sample for routing: gstack's matcher was tuned with these 60 prompts in view. The decision rule reads it anyway, by the plan.
- The in-sample control is non-concurrent: B1c ran on 2026-11-18 from 6a72369, with the same model id and rig. A change on the provider's side under the same model id would not show. The held-out arms ran side by side.
- The held-out comparison is gstack main as installed against B1c's block as B1c ran it. gstack main's skill listing holds 64 skills; the block arms' hold 2. The difference measures the two routes as each reaches a user, and can't say how much comes from the listing.
- The rig allows every tool the model asks for. gstack's destructive-command check answers "ask" on commands such as `git reset --hard`; here those run, where an interactive user would be asked. gstack's two Stop hooks run as installed.
- gstack is installed with --no-browser, so its browser binary isn't built; the browse skill is still listed.
- One skill, one task family, one model, one harness. GPT-6.1 Sol and particle-1 are not run, because the question is about Claude Code's hooks and skill listing.
- Followed uses B1's scorer as merged, with the holes B1b's results name. Loads, the primary, don't use it. Passes are descriptive and not powered.
- The hand reading covers four counted sessions. It checks the detectors, not the rates.

## Deviations and dated changes

- 2026-11-19, after the plan merged and before any counted run, one commit (709dae5): a relaunch of a part that lost its machine is never refused on money. It prints an overshoot line and runs, with the item's ledger still bounding what it spends. The plan's stop on the run's total spend went from $340 to $400, and that total now counts the model use of the agents running the eval, read from our own meter. Item caps are unchanged. Tests for both were written first and failed before the change. No session's setup, scoring or reading changed, and no relaunch overshot. So from 709dae5 on, `b1d plan` prints "all-in stop $400" where the plan's pinned plan.txt says $340. Nothing else in its output changes.
- The pilot cost about 2.3 times the plan's rate per session ($1.20, $0.91, $0.93 and $0.72 for the four arms), on two calibration tasks. Every arm passed its pilot. The counted sessions came in under the plan's rate.
- The held-out third part was relaunched once after its machine never started (check 1).
- The held-out route table's digest was not written into the custody log when the table was sealed. Check 3 rebuilt it from the list and found the same bytes.
- Wording: the plan called the tasks "B1's 60 bugs". Following our correction to B1, B1b and B1c, this post calls them SWE-rebench tasks drawn as bug fixes and counts the interface tasks.

## Replicate it

- `bun lanes/delivery-route/cli.ts b1d report in-sessions.jsonl --item b1d-in --out <dir>` prints in-report.txt and in-reasons.tsv. It reads B1c's and B1's rows from their results bundles in this repository.
- `B1D_HELDOUT=heldout-list.txt bun lanes/delivery-route/cli.ts b1d report ho-sessions.jsonl --item b1d-ho --in in-sessions.jsonl --routes routes-heldout.tsv --out <dir>` prints ho-report.txt and ho-reasons.tsv.
- `python3 wiki/plans/2026-11-19-capy-b1d-hook-default-prereg/draw.py seed.txt <out>` redraws the held-out list. `B1D_HELDOUT=<list> bun lanes/delivery-route/cli.ts b1d routes --export <swe-rebench export> --sealed <out>` rebuilds its route table.
- `bun lanes/delivery-route/cli.ts b1d table <config.json> <out.jsonl>` builds the session rows from the pulled trials. The launcher, its guard and the ledger are described in lanes/delivery-route/README.md.
- Not in this record: the paid sessions' transcripts, the part result files and ledgers the checks above read, and the setup commands. They are in the run log kept outside the repository.

## What is held out, and why

Nothing now. The held-out list, its seed and its route table stayed outside this repository until every held-out arm finished, so no change to gstack's matcher could be tuned on them. They are attached here so anyone can redraw and rerun the set.

## Credits

The Prove-It steps are from agent-skills by Addy Osmani (MIT), carried in B1's gstack-shaped skill. The routing hook, the skill listing and the routing block are gstack's own, at 5afef04e31de.

<details>
<summary>Agent notes</summary>

Spend on the plan's ledgers (dollars): b1d-smoke 7.91 of its 50 cap, b1d-in 27.02 of 90, b1d-ho 79.98 of 185, against the 400 all-in stop. Before the held-out relaunch the guard's projection left out the relaunched part, as the open note on the plan's pull request says, so the all-in was checked by hand first: about 244 of 400.

gstack main's counted sessions averaged 0.421 in-sample and 0.365 held-out, against the plan's 0.48 planning rate.

The counted runs ran from 709dae5 on this pull request's branch, so this pull request keeps a merge commit.

</details>

## Disclosures

gstack is Garry Tan's own project.
