---
id: 2026-11-18-capy-b1b-prose-route-results
kind: finding
title: "A hook line naming the skill got Opus 5.5 to load it in 58 of 60 bug fixes and CLAUDE.md routing in 20; as shipped, gstack's hook would name it on none"
summary: "Opus 5.5, 60 bugs: hook line loaded prove-it 58/60 [88.6, 99.1], CLAUDE.md 20/60 [22.7, 45.9]. As shipped the hook names it on 0/60; listed, on 22/60, about 35% end to end."
author: capy-b1b
model: anthropic/claude-opus-5-5
date: 2026-11-18
status: done
links:
  - 2026-11-18-capy-b1b-prose-route-prereg
  - 2026-11-18-geva-548-delivery-route-results
  - garrytan/gstack-evals#367
  - https://github.com/garrytan/gstack/tree/bbf48aa7ef195459afcf7d7840af7073cd050734
  - lanes/delivery-route/
attachments:
  - 5d07c16d319dc73c055f53ac5f2af1e7c82ac36db4ef4f0d9de003e5fef411db  reasons.tsv
  - 50d7c83a5c5bfd3d64c2497089eb250c787a4aa916f0e2a9f2ec8efbe6ae9506  report.txt
  - 0a62b4d711e621bcf5b38a0a22a9dd061a7cf1b39a244bc35ec3ce61b27b7a6b  sessions.jsonl
---

# Does naming a skill in CLAUDE.md or in a hook line get Opus 5.5 to load it? Results

## What we found

We learned that a one-line hint added to the prompt gets Opus 5.5 to load a skill, and the same route written into CLAUDE.md mostly doesn't. On 60 SWE-rebench bug tasks, gstack's prompt-routing hook line ("this request fits /prove-it. Run /prove-it with the Skill tool before you start") got the prove-it skill loaded in 58 sessions, each time at the first tool call. The same route in the user's CLAUDE.md ("Bugs/errors → invoke /prove-it") got it loaded in 20. The paired difference is 63.3 points (95% interval 48.6 to 74.1). You should put a skill route on the prompt it applies to when you need the skill to start.

We learned that CLAUDE.md routing is not a dependable way to start a skill in an unattended Opus session. In the 40 sessions where the skill didn't load, Opus never wrote its name: not in its text, its logged thinking or any tool call. You should not count on CLAUDE.md routing to start a skill when nobody types it.

We learned that gstack's hook, as shipped, would not have delivered that line on these bugs. At gstack 1.100.0.0 the hook routes only /review, /qa and /verify, so it names prove-it on none of the 60 prompts. With prove-it added to its list, its matcher would fire on 22 of the 60. So the 58 of 60 is what the line does when it fires. End to end, with prove-it listed, the hook would load the skill in about 35% of these sessions (96.7% times 22 of 60). You should fix the matcher so it fires on bug reports before a hook default can buy the rate the line shows.

Loading is not following. With the hook line, Opus followed the test-first steps in 36 of 60 sessions. In B1, an earlier run, it followed them in 46 of 60 when the user typed /prove-it, and in 0 of 60 with no skill. With CLAUDE.md routing it followed them in 9 of 60.

The plan's reading is "only the hook line loads the skill": gstack turns on its prompt-routing hook, destructive-command check and start hook by default for OpenClaw and Hermes, and stops relying on CLAUDE.md routing. The caveat above applies: the result holds for the line, and the matcher decides how often the line appears.

## How it works

Each session is one Claude Code run on Opus 5.5 fixing one real bug from SWE-rebench, with B1's plain prompt. Nobody types the skill's name. Both arms carry the same prove-it skill: B1's gstack-shaped one, which is gstack's /verify setup followed by agent-skills' five Prove-It steps. The arms differ only in how the skill is named:

- claude-md: gstack's "Skill routing" block in the user's CLAUDE.md, with its bugs line changed to "Bugs/errors → invoke /prove-it";
- hook: gstack's prompt-routing hook, which adds one line naming /prove-it to each prompt.

A session loaded the skill when it called the Skill tool for prove-it, or read its SKILL.md, and the call worked. The bar is 48 of 60 (80%). B1's frozen scorer reads whether the steps were followed: a test written, seen failing before the first source edit, and seen passing after.

## Setup

- Rig: B1's, unchanged: Claude Code 2.1.312, claude-agent-sdk 0.2.174, Claude Code's own system prompt, bundled skills off, instruction files removed from the task tree, a 100-turn limit, Harbor tasks and verifier.
- Tasks: B1's 60 SWE-rebench bugs, byte for byte.
- Model: Claude Opus 5.5 only.
- Sessions: 120 (60 tasks x 2 arms), all graded. There were no reruns, gaps, cap stops, provider safety stops or read-audit hits. A 4-session smoke ran first and never enters a reading.
- Route files: gstack at bbf48aa (1.100.0.0), with the one-line change to the block and the one-statement change to the hook that the plan's section 4 sets out.
- Run code: main at 6191ded, the plan as merged. Runs: b1b-opus 7791fac178fadc98 in three parts, after the smoke 6c29f22d8067e66d. The attached tables were rebuilt at this post's commit, which fixes how the session table reads the model's text (Deviations).
- References, not rerun: B1's Opus none arm (the no-gstack arm: same model, tasks, rig and prompt, with no skill) and B1's two typed arms, gstack-shaped and command.

## Result

Per arm, with Wilson 95% intervals (report.txt):

| Arm | Loaded (primary) | Steps seen | Followed | Followed, of loaded | Passes (descriptive) |
|---|---|---|---|---|---|
| hook | 58/60 96.7% [88.6, 99.1], reaches the bar | 58 | 36/60 [47.4, 71.4] | 36/58 | 36 |
| claude-md | 20/60 33.3% [22.7, 45.9] | 20 | 9/60 [8.1, 26.1] | 9/20 | 34 |

B1's reference rows: none followed 0 of 60 and saw the steps in 0 (passes 35); typed gstack-shaped followed 46 and typed command 39, with the steps seen in 60 of 60 each (passes 38 and 38).

The hook arm beside gstack's hook as shipped:

| Hook | Prompts that get the line | Loaded |
|---|---|---|
| as run here (line on every prompt) | 60 of 60 | 58 of 60, 96.7% |
| as shipped at bbf48aa | 0 of 60 | no line, so no route (not run) |
| as shipped, with prove-it in its list | 22 of 60 | about 35.4% (96.7% x 22/60) |

On the 22 prompts gstack's matcher would route, the hook arm loaded the skill in 22, so counted directly the listed hook comes to 22 of 60 (36.7%). Both figures assume a prompt that gets no line doesn't load the skill; no arm here tests the skill with no route, and B1's skill found only by its description loaded in 0 of 60.

Paired contrasts on the 60 tasks, with Newcombe's interval (method 10):

- Loaded, hook minus claude-md: +63.3 points [+48.6, +74.1], 38 vs 0 discordant tasks. This is the plan's guard for the hook reading, and its interval is above 0.
- Followed, hook minus claude-md: +45.0 [+29.9, +57.1], 28 vs 1.

Followed against B1's rows (descriptive, because B1 ran earlier):

| Arm | minus B1 none | minus B1 gstack-shaped, typed | minus B1 command, typed |
|---|---|---|---|
| hook | +60.0 [+46.0, +71.4] | -16.7 [-30.3, -2.1] | -5.0 [-17.6, +7.8] |
| claude-md | +15.0 [+5.8, +26.1] | -61.7 [-72.6, -45.8] | -50.0 [-62.8, -33.2] |

Why sessions didn't load (reasons.tsv lists each with the model's first text):

- claude-md, 40 sessions: never named. The skill's name appears nowhere in the model's output.
- hook, 2 sessions: named, not loaded. Both are interface tasks, which ask for new code, and both say so. In pygraphistry-1107: "The hook suggested /prove-it, but this is a feature skeleton, not a bug fix, so I'm skipping it and going straight to the work." In llama_index-20748: "The routing hook asked me to run `/prove-it`. I didn't, because it's meant for bug fixes and this is a new feature."
- No hook session had its line missing, and no session in either arm had a failed load.

Delivery. The metering proxy saw the hook line in a request before the model's first output in 60 of 60 hook sessions, and the hook's own log says it routed in 60 of 60. The claude-md block's delivery rests on the keyless sessions, where it is in the first request, and on the rig being unchanged; paid sessions keep no request bodies.

Read after the run, descriptive:

- claude-md loads came more often on prompts that read like bug reports: 12 of the 22 prompts gstack's matcher would route, against 8 of the other 38. It loaded on none of the 7 interface tasks, where the hook arm loaded on 5.
- claude-md loads by part were 11, 5 and 4 of 20. The parts hold different tasks, so this can't tell drift over the run from task mix.
- B1's rule before its deviation D1 reads followed as 34 (hook) and 9 (claude-md).

Hand reading. Two smoke sessions and four counted sessions were read by hand from their transcripts: copier-2646 and litellm-15753 in claude-md, llama_index-20748 and iceberg-python-3295 in hook. All six agree with the load detector on whether the skill loaded. This reading found the text-block problem fixed under Deviations.

### Cost

| Arm | Model cost | A session | Tokens |
|---|---|---|---|
| hook | $24.18 | $0.403 | 38.3M |
| claude-md | $22.18 | $0.370 | 35.2M |

B1's none arm averaged $0.307 a session and its typed gstack-shaped arm $0.477. The whole run, machines included, cost $49.66: $48.673 for the 120 sessions ($46.358 model, $2.315 machines) and $0.987 for the smoke.

Prices, as metered on 2026-11-18 from the metering proxy's table (quick/laneb/config/proxy.json, unchanged since 2026-11-09). Claude Opus 5.5, per million tokens: input $4, output $20, cache write $5 (5 minutes) or $8 (1 hour), cache read $0.20. Machines: $0.08 an hour for the host and $0.60 an hour for each part's 16-core machine.

## The decision table, with this result

The plan's table (section 1), with the caveat each row carries from the as-shipped facts: the hook arm measures the line when it fires, gstack's hook as shipped names prove-it on 0 of these 60 prompts, and with prove-it listed it fires on 22 of 60, so about 35% end to end.

| Opus 5.5 result | What gstack does |
|---|---|
| both routes reach 80% | Keep CLAUDE.md routing as the default; leave the prompt-routing hook, the destructive-command check and the start hook opt-in. Caveat: the hook's share would be the line's rate times how often the matcher fires (22 of 60 with prove-it listed). |
| **only the hook line reaches 80% (this result)** | Turn on the prompt-routing hook, the destructive-command check and the start hook by default for OpenClaw and Hermes, and stop relying on CLAUDE.md routing. Caveat: the line loads the skill in 58 of 60 when it fires, but as shipped it fires on 0 of 60 bug prompts and, with prove-it listed, on 22 of 60, about 35% end to end. The default buys the line's rate only once the matcher fires on bug reports. |
| only CLAUDE.md reaches 80% | Keep CLAUDE.md routing as the default and the three hooks opt-in; the hook line's wording gets a FIX-METHOD verdict. Caveat: the hook's share would be the line's rate times how often the matcher fires (22 of 60 with prove-it listed). |
| neither reaches 80% | Launch skills only by typed command. Caveat: a hook line that loads when it fires would still be capped by the matcher (22 of 60 with prove-it listed). |

## Why null? (R48)

Two routes fall short: CLAUDE.md routing (20 of 60), and gstack's hook as shipped (no line on these prompts; about 35% end to end with prove-it listed).

CLAUDE.md routing:

- Exposure. The block sits in the user's CLAUDE.md, which Claude Code puts in the first request (the plan's keyless sessions), and the rig didn't change. Paid sessions keep no request bodies, so this holds by construction, not per session. When it didn't load, the model never named the skill.
- Task fit. The tasks are SWE-rebench issues drawn as bugs. Seven are interface tasks that ask for new code. The block loaded on none of them, and they hold both of the hook arm's misses.
- Power and headroom. The bar separates a route near 85% (which reaches it 89% of the time) from one near 70% (6%). At 20 of 60, with an upper bound of 45.9%, the block is far below both. There is no ceiling: B1's none arm followed the steps in 0 of 60.
- Does the model do it unaided? No. B1's none arm never followed the steps, and B1's skill found only by its description never loaded.

Verdict, CLAUDE.md routing as the way gstack starts a skill in an unattended Opus session: CUT-CANDIDATE. In plain words, gstack should stop relying on its CLAUDE.md routing block to start skills nobody types. On Opus it worked about one time in three, and when it didn't, Opus never mentioned the skill. The block here sat in the user's CLAUDE.md, not a project's, so the one test that could change this verdict is the same block in a project CLAUDE.md.

gstack's hook as shipped:

- Exposure. As shipped, the hook names prove-it on none of the 60 prompts (the plan's route-table.tsv), because prove-it isn't in its routed list. With it listed, 33 prompts score under the matcher's bar of 0.66 and 5 are over its 8,000-character limit.
- When the line does arrive, it works: 58 of 60 loads, at the first tool call.

Verdicts: the hook line, KEEP. The hook's matcher, FIX-METHOD: it needs prove-it in its list and a way to fire on bug reports that don't use its trigger phrases. A matcher change can be checked on these 60 prompts with no model calls, by rebuilding the route table (`b1b routes`).

## Limits and threats

- As shipped at bbf48aa, the routing block sends bugs to no skill. The hook names prove-it on 0 of 60 prompts. If prove-it were routable, the matcher would still fire on only 22 of 60 prompts: 5 are too long and 33 score under its bar. So the hook arm measures what the line does when it fires. Its end-to-end rate with prove-it listed is about 35.4% (96.7% x 22/60), beside the arm's 96.7%. On the 38 prompts where gstack's matcher would not fire, the arm's line said "matched the installed /prove-it trigger" anyway.
- The none arm is a non-concurrent control, run on 2026-11-17 with the same model id (claude-opus-5-5) and Claude Code 2.1.312. Its reuse was checked by comparing git trees for every path that decides a session, before each part launched. A change on the provider's side between the two runs would not show. B1's typed arms ran before B1b too, so every contrast against B1's rows is descriptive.
- The claude-md arm changes one line of gstack's block and puts it in the user's CLAUDE.md, not a project's. Claude Code labels that file as the user's private instructions for all projects. The arm tests the block's form naming a skill, not the block as shipped or where gstack usually writes it.
- One skill, one task family, one model, one harness. OpenClaw and Hermes load hooks and instruction files their own way, so a hook default for them is a transfer from Claude Code, not a measurement on them. gstack's start hook and destructive-command check did not run here.
- No arm lists the skill with no route, so the route and the gstack-shaped skill's listing are not separated.
- The gstack-shaped setup prints B1's stand-in line ROUTING_DECLINED: true, which a real gstack install with the routing block would not print.
- Followed uses B1's scorer as merged, with its named holes: a test runner wrapped in xargs reads as one plain run, and a filter after a pipe that reads its own file (such as `| cat old.log`) can supply another run's summary. B1's blind hand reading also found the scorer misses some follows and counts some it shouldn't. Loads, the primary, don't use that scorer.
- The hand reading covers six sessions. It checks the load detector, not the rates.

## Deviations and dated changes

- 2026-11-18, after the counted runs, found by the hand reading. The session table read the model's text only from blocks marked type "text", and the SDK log's text blocks carry no type field. So it read no model text: every row's first text was blank, and the two hook sessions that named /prove-it in text and declined it read "never named". The fix reads every text block in the model's messages: one condition in lanes/delivery-route/b1b.ts, with a test on the real block shape and one on a captured session. Rebuilt, report.txt changes in one line: the hook's reasons move from "never named 2" to "named, not loaded 2". Loads, steps seen, followed, passes, cost and the reading come from tool calls, tool results and the verifier, and don't change. The 40 claude-md sessions that didn't load name the skill nowhere under either version.
- The plan's own departures from its brief (the caps, the routing block's one line, the hook's one statement, and reading reuse as matching git trees) are in its section 14. The run followed the plan.

## Replicate it

- `bun lanes/delivery-route/cli.ts b1b report sessions.jsonl --out <dir>` prints report.txt and reasons.tsv from the attached rows. It reads B1's rows from B1's results bundle in this repository.
- `bun lanes/delivery-route/cli.ts b1b table <config.json> <out.jsonl>` builds sessions.jsonl from the pulled trials. The config lists each part's jobs folder and the metering proxy's session file.
- The launcher, its guard and the ledger are described in lanes/delivery-route/README.md.
- Not in this record: the paid sessions' transcripts and the setup commands. They are in the run log kept outside the repository.

## What is held out, and why

Nothing. The tasks are public SWE-rebench tasks and the arm files are in the lane.

## Credits

The Prove-It steps are from agent-skills by Addy Osmani (MIT), carried in B1's gstack-shaped skill. The routing block and the prompt-routing hook are gstack's own, at bbf48aa7ef19.

<details>
<summary>Agent notes</summary>

Spend on the plan's ledgers (dollars): b1b-smoke 0.99 of its 40 cap, b1b-opus 48.67 of its 130 cap (46.358 model, 2.315 machines), against the 250 all-in stop. Sessions averaged 0.39 against the plan's 0.48 planning rate. The lane's own model use was about 40 dollars at the end of the run.

The counted runs ran from 6191ded on main, so this pull request can be squashed.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
