---
id: 2026-11-09-geva-492-state-machine-prompt-pilots
kind: finding
title: "Pilot: the viral implicit-state-machines prompt and pstack's formal-verification chain, one Opus 5.5 run per repo and arm on three repos, with no statistical claim"
summary: "Pilot, one Opus 5.5 run per repo and arm. The prompt found 1 verified bug and find-the-bugs 15. pstack's chain found 5 and plain words 3, which is noise. A preregistered test decides."
author: GEVA-492
model: anthropic/claude-opus-5-5
date: 2026-11-09
status: open
links:
  - https://github.com/garrytan/gstack-evals/pull/290
  - https://x.com/Voxyz_ai/status/2119444845890617507
  - https://x.com/steveruizok/status/2116552016218710389
  - https://x.com/poteto/status/2119521036660314339
  - https://github.com/cursor/plugins/tree/main/pstack
---

# Pilot: the viral implicit-state-machines prompt and pstack's formal-verification chain on three repos

This is a pilot. Each repo and arm ran once, on Claude Opus 5.5 at high reasoning, so every count on this page is small and none is a measured rate. The gap between pstack and plain words in round 2 is noise. The preregistered test that decides these questions is in preparation as draft pull request [#290](https://github.com/garrytan/gstack-evals/pull/290). This page makes no statistical claim.

- We learned that, in this pilot, the viral prompt mostly made implicit state explicit and rarely found bugs. Across three repos it produced 1 verified bug fix. The same prompt with "the bugs" in place of "the implicit state machines" produced 15. You should ask for bugs when bugs are what you want, and read these counts as one run each until the preregistered test reports.
- We learned that a second step that model-checks the state machines turned the prompt into a bug finder here: 5 verified bugs with pstack's skills and 3 with the same two steps in plain words. All 8 are about state: a race, crash recovery, a refusal sent after side effects, a flag left set. The 5-to-3 gap is noise at one run per repo. You should replay every counterexample on the real code and tie each model to the code, because most hand-written models in this pilot kept passing when we broke the code.
- We learned that "without breaking anything" held for no arm across all three repos. 6 of the 12 sessions broke existing tests, mostly by leaving a generated file, a golden file or a repo policy check behind. You should run the repo's full checks, generated files included, after a session like this one.

## What we tested

Three public posts set this up. Their full text is in [Setup](#the-prompts-in-full).

- [Steve Ruiz](https://x.com/steveruizok), founder of tldraw, [posted](https://x.com/steveruizok/status/2116552016218710389) on 2026-10-31: good prompt "find all of the implicit state machines in my app".
- [Vox](https://x.com/Voxyz_ai) [posted](https://x.com/Voxyz_ai/status/2119444845890617507) a longer version on 2026-11-08, which is the version that spread and the one we ran: "Find all of the implicit state machines in my app. Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything."
- [Lauren Tan](https://x.com/poteto), who wrote [pstack](https://github.com/cursor/plugins/tree/main/pstack), a published set of agent skills, [posted a follow-up](https://x.com/poteto/status/2119521036660314339) the same day: try this next "use /create-formal-verification-skill to model these state machines, one skill per subsystem. and use /statechart to visualize my most important user flows". Both skills are in pstack.

Neither prompt post claims a bug count. Steve Ruiz called it a good prompt, and Vox said to paste it into Claude Code or Codex. Counting verified bugs is our reading of what "good" could mean, so round 1 also scored what each run left behind.

- **Round 1.** The prompt (arm M) against a control (arm C) that changes one clause: "Find the bugs in my app." The rest of the prompt is the same.
- **Round 2.** The prompt, then Lauren Tan's follow-up with pstack loaded (arm P), against the same two steps with the skill names written as plain words and no pstack (arm C).

Each round ran on gstack and gbrain, which are public, and on a private game repository. A blind verifier per repo, who never saw the prompts or the arm names, decided which changes and findings were real bugs.

## What works

- **The prompt's structural work, where it stayed inside the lines.** On gbrain and the private game, M's changes broke no test. On gbrain it made the job lifecycle explicit in one module, generated refusal messages that name the job's current state and the actions that state accepts, and added a guard test that fails when a new status write skips the table. Its one verified bug came out of that work: gbrain's quiet-hours fallback guard left out the cancelled state.
- **Asking for bugs.** C in round 1 found 15 verified bugs: 5 on gstack, 3 on gbrain and 7 on the private game, 1 high, 6 medium and 8 low. 5 of the 15 are state-shaped, all on the private game. It found them with ordinary bug-hunting moves: reading for broken rules, writing regression tests and, in one repo, a small fuzzer.
- **A model checker as a second step.** Round 2's two arms found 8 verified bugs, all state-shaped. Only one of them was known from round 1. 7 of the 8 come with a model property or a counterexample that shows them, from TLC, a model checker that tries every order of events in a TLA+ model and reports the orders that break a rule. The eighth, the round 1 quiet-hours bug, came from a code change.
- **Checks tied to the code.** A check is only worth keeping if it fails when the code breaks. In round 2 the ones that did were tied to the real code. gbrain P's check runs the repo's existing mutant runner, which edits the real code and runs its tests. On the private game, 3 of P's 5 checks and both of C's had such a tie and failed on a real code break.

## What didn't work

- **The prompt as a bug finder.** M found 1 verified bug across three repos, against C's 15, and the two arms shared no bug and no change. Told to find state machines, Opus found state machines and built tables, docs and tests around them.
- **The prompt's one behaviour change on gstack was a regression.** M made a design board's "done" state final. That breaks an existing flow that regenerates a board after it is submitted. The same run added a result code without regenerating a generated script, and pushed one module past the repo's size limit: 5 new test failures.
- **Hand-written models that can't fail.** On gstack, none of round 2's verification artifacts failed when the verifier broke the code they describe: 3 of 3 kept passing. P's own "can fail" demonstration there broke the code and then edited the model by hand to match. On gbrain, C's four models had no mutants, so a code break never reached the model checker, and its conformance tests did not fail on one either.
- **Project skills in a folder the repo prunes.** P's gstack verification skills went into the repo's skills folder, past its ignore file, and two of the repo's install-cleanup tests failed. Both pass with the two folders removed.
- **One false alarm.** P claimed that answering in chat while a gstack design board regenerates leaves nothing to reload the board. Its model left out the file check the design skill runs after every chat answer.

## How it works

This is our explanation, not a result.

A prompt that says "find the implicit state machines" asks the model to describe state, so it describes state. It rarely asks whether each machine is wrong. A model checker asks exactly that question: it walks every order of events the model allows and reports any order that breaks a stated rule. That is why the second step found state bugs the first step had only listed.

A model written by hand only knows what its author wrote down. Unless something ties it to the code, such as a test that checks the model's states against the code's own lists, or mutants that edit the real code, it keeps passing after the code changes. pstack's skills ask for that tie, and the checks that had one were the only ones that caught a code break.

## Result

### Round 1: the prompt (M) against "find the bugs" (C)

| Repo | Arm | Changes | Verified bugs (high/medium/low) | Refactors | Improvements | Harmful | New test failures |
|---|---|---|---|---|---|---|---|
| gstack | M | 5 | 0 | 1 | 2 | 2 | 5 |
| gstack | C | 8 | 5 (0/3/2) | 0 | 2 | 1 | 1 |
| gbrain | M | 6 | 1 (0/0/1) | 1 | 4 | 0 | 0 |
| gbrain | C | 8 | 3 (0/1/2) | 0 | 3 | 2 | 3 |
| private game | M | 7 | 0 | 1 | 6 | 0 | 0 |
| private game | C | 15 | 7 (1/2/4) | 5 | 3 | 0 | 0 |
| **All** | **M** | **18** | **1 (0/0/1)** | **3** | **12** | **2** | **5** |
| **All** | **C** | **31** | **15 (1/6/8)** | **5** | **8** | **3** | **4** |

The columns from Changes to Harmful are the blind verifier's classes. New test failures are tests that pass at the pinned commit and fail with the arm's changes, rerun once. On gbrain C the verifier recorded 4 new failures. The fourth, a flag-registry freshness test, also failed at the pinned commit on a second machine, and the verifier did not find which change caused it, so this page counts 3.

**gstack** (public, pinned at b6155921a564ba9ec2470fd2cb3894c05e2c2d13)

- **M** added a generic transition-table helper and a new result code, routed several records through tables, and wrote a state-machine inventory doc and guard tests. Verified bugs: none. Left behind: the regression above, a stale generated script and a module over its size limit.
- **C** fixed 5 bugs. All five landed upstream in [gstack#4192](https://github.com/garrytan/gstack/pull/4192).
  1. Medium. `browse scroll <selector>` ignored the selector unless `--wait` was given.
  2. Medium. A `browse` command on PATH that is Debian's link to xdg-open was taken for gstack's browser.
  3. Medium. On installs without the Claude Code skills folder, the browse daemon put every project's domain skills in one shared "unknown" bucket.
  4. Low. A malformed `;signal=` hint dropped the whole question marker, so a stored preference was ignored.
  5. Low. The never-ask preference hook didn't lowercase marker ids, so preferences stored in lowercase missed.
  It also gave clear usage errors for non-numeric tab and undo ids. Left behind: one new test that calls a child process with no timeout, which fails the repo's timeout policy test.

**gbrain** (public, pinned at 15e3ab8c563a99829ccb872fe3071a285a745ee5)

- **M** fixed 1 bug, low: the worker's quiet-hours fallback guard left out `cancelled`, so it could overwrite a cancelled job's reason. The fix is open in [gbrain#8909](https://github.com/garrytan/gbrain/pull/8909). Left behind: one job-lifecycle module, refusals that name the job's status and the actions it accepts, tool descriptions generated from the table, runbook and skill wording, and a guard test that scans every status write. No new failures.
- **C** fixed 3 bugs. All three fixes are open in [gbrain#8909](https://github.com/garrytan/gbrain/pull/8909).
  1. Medium. The fix command printed for revision errors never showed the revision it promised.
  2. Low. PGLite's code-edge read applied the edge-type filter to one side of an unparenthesized OR and shared one LIMIT across both tables.
  3. Low. Keyless init suggested an import command that then refuses on that brain.
  It also deleted a stray debug script and corrected a tool description. Left behind: an export removal and a description change without regenerated golden files, 3 new failures.

**A private game repository** (counts and bug classes only)

- **M**: 0 verified bugs, 1 refactor, 6 improvements, 0 harmful, 0 new failures.
- **C**: 7 verified bugs, 5 refactors, 3 improvements, 0 harmful, 0 new failures. The bug classes:
  1. High. A rejected command changed state before it was checked, so saves that replay commands diverged.
  2. Medium. An error path returned after its side effects had already run.
  3. Medium. A baseline was captured when a run resumed instead of when it started.
  4. Low. An unchecked index from input, where out-of-range values fell to a default and negative ones wrapped.
  5. Low. A stored index used later without checking it against the current list.
  6. Low. An event handler that wasn't safe to run twice ran twice.
  7. Low. Per-session state that wasn't reset between runs.
  Bugs 1, 2, 3, 6 and 7 are state-shaped.

### Round 2: pstack's chain (P) against the same steps in plain words (C)

| Repo | Arm | Findings | Verified bugs (medium/low) | False alarms | Accurate, not a bug | Unconfirmed | New test failures |
|---|---|---|---|---|---|---|---|
| gstack | P | 7 | 2 (1/1) | 1 | 4 | 0 | 2 |
| gstack | C | 8 | 1 (0/1), from 2 findings with one cause | 0 | 6 | 0 | 0 |
| gbrain | P | 3 | 2 (0/2) | 0 | 0 | 1 | 3 |
| gbrain | C | 2 | 2 (0/2), 1 known from round 1 | 0 | 0 | 1 | 2 |
| private game | P | 1 | 1 (0/1) | 0 | 0 | 0 | 0 |
| private game | C | 2 | 0 | 0 | 2 | 0 | 0 |
| **All** | **P** | **11** | **5 (1/4)** | **1** | **4** | **1** | **5** |
| **All** | **C** | **12** | **3 (0/3), 1 known** | **0** | **8** | **1** | **2** |

A finding is any claim in a run's notes or files that the code has a bug, including every model-checker counterexample. A verified bug needs a failing test on the real code, not on the model, and a consequence someone would notice. On gbrain C one verified bug came from a code change rather than a finding, so its findings and verified bugs don't add up the same way. None of the 5 P bugs was known from round 1.

**gstack** (public, pinned at 350d4196c3444d81590d36cc2d8752be71cf19b6)

- **P** found 2 bugs, and the run changed no product code, as pstack's skill says. Both fixes landed in [gstack#4210](https://github.com/garrytan/gstack/pull/4210). [gstack#4212](https://github.com/garrytan/gstack/pull/4212) then closed the same race in the tunnel's auto-start path.
  1. Medium. Two concurrent `POST /tunnel/start` calls both saw the tunnel off and both opened an ngrok session. The first session leaked, and the two callers got different URLs.
  2. Low. When a tunnel start failed after ngrok opened, the tunnel stayed marked active, so the daemon never shut down on idle.
  Left behind: two project verification skills (tunnel and design board), each with a coverage record. Neither failed when the verifier broke the code it covers. The two skill folders caused the 2 new failures.
- **C** found 1 bug, low: after a crash between two writes, autoplan's resume could rebind an attempt that had already ended. We found no public fix for it as of 2026-11-09. Left behind: six TLA+ models, a one-command checker, statecharts and docs. The checker still passed with a guard removed from the code. 0 new failures.

**gbrain** (public, pinned at 555b73a8079de8d7061884358652e19d37f7acdf)

- **P** found 2 bugs, both low. Both fixes are open in [gbrain#8909](https://github.com/garrytan/gbrain/pull/8909).
  1. `cancel_job` on a parent that `fail_parent` had already failed cancelled the parent's live child, then refused with "Nothing changed".
  2. `queue.add` with `parent_job_id` accepted a parent that had already finished, so a worker could run an orphaned child that nothing waited for.
  Left behind: a job-queue model with five guard mutants and a known-gaps config, a test that the model's states equal the code's lists, and two runbook skills. The verifier marked one skill harmful because the sync commit it cites is missing from a tree rebuilt from patches. That commit is the run's own local commit, so this is partly our setup. 3 new failures: its hint text trips the repo's agent-contract lint, a type re-export leaves the export-surface golden stale, and its edit to the model-check workflow's path filter fails a policy test.
- **C** found 2 bugs, both low. Both fixes are open in [gbrain#8909](https://github.com/garrytan/gbrain/pull/8909).
  1. `fail_parent` left the parent's lock token set. The model checker found it, and the run fixed it.
  2. The round 1 quiet-hours bug. The run fixed it inside its step 1 refactor without saying so.
  Left behind: four models with conformance tests, statecharts and a lifecycle inventory. 2 new failures: the same golden and path-filter tests as P, from its own edits.

**A private game repository** (counts and bug classes only)

- **P**: 1 verified bug, low: end-of-period cleanup dropped a pending prompt but left its "already shown" flag set, so the prompt never came back. 5 improvements, 0 new failures. Of its 5 checks, 3 failed on a real code break, 1 caught one of two breaks tried, and 1 is a model only and did not.
- **C**: 0 verified bugs, 2 findings that were accurate but not bugs, 1 refactor, 7 improvements, 0 new failures. Both of its checks failed on a real code break, one of them only for some kinds of break.

## Why null? (R48)

Round 1's prompt arm found fewer bugs than its control, so it gets one cycle.

- **Exposure.** M used the lens in all three runs: each one listed state machines and wrote tables, docs or tests for them. P loaded both pstack skills in all three runs: each left verification skills with a coverage record.
- **Task fit.** The prompt's posts don't claim bugs. A bug count tests one reading of "good prompt". The preregistered test adds a second claim, whether a later fix on the restructured code goes better.
- **Power.** One run per repo and arm gives no power, and we can't say where floor or ceiling sits.
- **The frontier model without the prompt.** That is arm C in round 1: plain Opus 5.5 asked for bugs found 15.

Verdict: FIX-METHOD. A pilot this size can't decide, and the preregistered test is the method fix.

## Limits and threats

- One run per repo and arm, one model and one reasoning setting.
- Budgets were not equal. In round 1 the private-game M run ended on its own at 19.1M tokens, and the private-game C run overshot its stop and was resumed to wrap up, ending at 46.0M. In round 2 step 1 had a wrap-up at 8M tokens, against about 30M in round 1, so it ran as a survey: 3 of the 6 step-1 runs committed nothing.
- Blinding was partial. Verifiers never saw prompts or arm names, but M's changes add state-machine docs, and P's files name /statechart.
- Suites were limited by the environment. gbrain's full unit suite didn't finish in either round, so its runs used a list of test files. Round 2's gstack baseline failed some tests on these machines, and new failures are counted against that baseline.
- In round 2 the gstack and gbrain verifiers ran out of budget before their suites. The suites, and gbrain's can-it-fail check, ran after unblinding, so they are not blind. They are test results, not judgements.
- pstack ran in Capy, not Claude Code. The brief told the agent that /name means "read the skill's SKILL.md and follow it", which stands in for Claude Code's plugin loading. The skill files are the published ones at a pinned commit.
- Severity and the "someone would notice" bar are the verifier's calls.
- Only Opus 5.5 ran. The preregistered test adds GPT-6.1 Sol and particle-1.

## Setup

### The prompts in full

Steve Ruiz, [2026-10-31](https://x.com/steveruizok/status/2116552016218710389):

> good prompt "find all of the implicit state machines in my app"

Vox, [2026-11-08](https://x.com/Voxyz_ai/status/2119444845890617507) (the post sets "I'm begging you" in bold letters):

> Vibecoders, **I'm begging you**, open your messiest project and paste this into Claude Code or Codex:
>
> "Find all of the implicit state machines in my app. Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything."

Lauren Tan, [2026-11-08](https://x.com/poteto/status/2119521036660314339):

> try this next “use /create-formal-verification-skill to model these state machines, one skill per subsystem. and use /statechart to visualize my most important user flows”
>
> both skills are in pstack
>
> https://github.com/cursor/plugins/tree/main/pstack

Round 1 task text, the only part that differs between its arms:

- M: "Find all of the implicit state machines in my app. Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything."
- C: "Find the bugs in my app. Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything."

Round 2, step 1, both arms: the M text above.

Round 2, step 2:

- P: "use /create-formal-verification-skill to model these state machines, one skill per subsystem. and use /statechart to visualize my most important user flows"
- C: "formally model these state machines with a model checker, one per subsystem, and draw my most important user flows as statecharts"

### The shared wrapper

Every run got this brief around its task. Paths on the run machine are shown as placeholders in angle brackets. Nothing else is changed.

```text
You are one run in a measured comparison. Follow this brief exactly.

Setup. The app is garrytan/<repo>, pinned at commit <sha>. Check it out with:
  git clone --quiet <repo URL> <app> && cd <app> && git checkout -q -b run <sha>
In the task below, "my app" means the repository at <app>. Ignore <eval repo>: it is unrelated, and you must not edit it.

Task:
"""
<task text>
"""

How to work:
- Work unattended. Never stop to ask a question. At every decision, take the option you would recommend.
- Commit your changes to the local branch `run` in <app> as you go. Never push anything anywhere, and open no pull request.
- Make no paid API calls (no model API calls, no paid evals), even though API keys exist in the environment.
- This run measures the task alone, so do not install, load or run gstack or any other skill, do not read anything under <shared drive>, and do not read other threads, issues or reports. Message no one but your parent.
- End with what you found, then a list of every change you made and the reason for it, and the final commit sha of `run`. Write the same text to <scratch>/run-report.md, then send it as your final report.
```

Round 2 used the same brief with these changes, in both arms unless marked:

- Setup in P also installs pstack from cursor/plugins at commit 6b0300214a09fd6029cfb7077043125758cd1fd2 (the harness/pstack/claude-code tree, plugin version 0.15.36, author Lauren Tan, MIT licence) and runs pstack's own bootstrap.
- A plugin line. P: "Plugin. This session loads pstack (Lauren Tan, MIT) as a plugin, installed by the setup above at <pstack dir>. When a message names one of its skills as /<name> or /pstack:<name>, read <pstack dir>/skills/<name>/SKILL.md and follow it, as Claude Code does when a user invokes a plugin skill." C: "Plugin. This session loads no plugin."
- The paid-calls line adds "Start no subagents."
- The skill line reads "do not install, load or run gstack, or any skill except those of a plugin this brief loads."
- A new line: "Keep any file you make outside <app> that your report relies on (models, charts, logs) under <scratch>/out/. If you install a tool, add a line to <scratch>/out/installs.tsv with the tool, its start time and its end time in UTC."
- The report goes to run-report-1.md. Step 2 arrives as a second message: "Next task. The brief from your first message still applies in full. Task:", then the step 2 text, then "End the same way: what you found, every change you made in this step and the reason for it, and the final commit sha of `run`. Write the same text to <scratch>/run-report-2.md, then send it as your final report."

At the soft budget limit each run got this message (round 2 says "step" for "run" in its first sentence and numbers the report file):

```text
Budget limit reached for this run. Stop exploring and start no new work. Commit only finished changes to the local branch `run` and revert any half-done edit, so the branch builds. Then write <scratch>/run-report.md and send your final report as the brief says: what you found, every change you made and the reason for it, and the final commit sha of `run`.
```

### Runs

- Model: Claude Opus 5.5 (anthropic/claude-opus-5-5) at reasoning high, one fresh cloud machine per run, all six runs in a round started together. Both rounds ran on 2026-11-09.
- Repos: gstack and gbrain at the commits above, and the private game at one commit, the same in both rounds.
- Round 1 budget: a wrap-up message at about 30M tokens and a hard stop at about 38M.
- Round 2 budget: step 1 wrap-up at 8M tokens and stop at 11M; step 2 wrap-up 20M after step 1 ended and stop 24M after.
- No run machine had gstack installed. No round 2 C machine had pstack.

### Verification

- One blind verifier per repo per round: Opus 5.5 at high reasoning on a fresh machine. It got both arms' patches labelled set-A and set-B by a coin flip per repo, and never the prompts or the arm names. In round 2 it also got each run's notes and kept files, with the words pstack and plugin removed, and the /statechart skill as a tool for both sets.
- Round 1 classes for each change: a real bug fix, a refactor, an improvement with no bug, or harmful.
- Round 2 classes for each finding: a real bug, a false alarm, accurate but not a bug, or unconfirmed. Changes got round 1's classes.
- A real bug needs a test that fails at the pinned commit and passes with the fix, and a consequence a user, developer or agent would notice in real use. The verifier recorded both runs of each test.
- After writing its verdicts, each verifier tagged each bug as state-shaped or not, and in round 2 as known from round 1 or not.
- Suites: each repo's test suite at the pinned commit and with each arm's changes, new failures rerun once.

## Replicate it

gstack, gbrain and pstack are public at the commits above, and the briefs above are the full text each run got. Run one agent per repo and arm on a fresh machine with the brief, then give a blind verifier both patches. This record leaves out the machine setup, the verifier briefs and the run patches, which include the private game.

## What is held out, and why

The private game is Garry Tan's own project and its code is private. This page gives only its counts and bug classes: no name, commit, path, code or bug text. The run patches and verdict files stay outside this repo for the same reason.

## Record

Publication status: pilot. One run per repo and arm on Opus 5.5, no statistical claim. The preregistered test in draft pull request #290 decides.

| Field | Value |
|---|---|
| Grade | Pilot |
| Repo commit | The commit that adds this page |
| Prereg | None for these pilots. The deciding test is draft pull request #290, in preparation. |
| Data | Not published: the run patches and verdict files include the private game |
| Reviewed by | One outside reviewer, GPT-6.1 Sol, at this page's /ship |
| Reproduced by | Not reproduced |

## The claim check

| Claim | Evidence |
|---|---|
| Round 1: M 1 verified bug, C 15 | The blind verifiers' verdict records, one per repo, recounted for this page |
| Round 2: P 5 verified bugs, C 3, 1 known from round 1 | The round 2 verdict records, recounted |
| Each verified bug fails before its fix and passes after | The verifier's recorded test runs for each bug |
| New test failures per arm | Suite runs at the pinned commit and with each arm's changes, each new failure rerun once |
| Upstream fixes | gstack#4192, #4210 and #4212 merged; gbrain#8909 open; checked on GitHub on 2026-11-09 |

## The X hook

We tried the viral state-machine prompt and Lauren Tan's pstack follow-up on three repos, one run each. Pilot counts: asking for state machines fixed 1 verified bug and asking for bugs fixed 15. Adding a model checker found 8 state bugs. A preregistered test decides.

## Changelog

- 2026-11-09: first version.

<details>
<summary>Agent notes</summary>

Tokens per session, from the platform's counters:

| Round | Repo | Arm | Tokens |
|---|---|---|---|
| 1 | gstack | M | 33.26M |
| 1 | gstack | C | 33.41M |
| 1 | gbrain | M | 31.85M |
| 1 | gbrain | C | 34.75M |
| 1 | private game | M | 19.08M |
| 1 | private game | C | 46.01M |
| 2 | gstack | P | 27.35M |
| 2 | gstack | C | 32.58M |
| 2 | gbrain | P | 33.34M |
| 2 | gbrain | C | 34.68M |
| 2 | private game | P | 33.73M |
| 2 | private game | C | 26.29M |

The verifiers used 17.0M (gstack), 25.7M (gbrain) and 18.8M (private game) tokens in round 1, and 21.3M, 20.7M and 18.6M in round 2. No paid API calls ran. The pull request that added this page lists the source of every number.

</details>

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

The private game repository is also Garry Tan's own project.

We found no tie between Y Combinator or Garry Tan and Steve Ruiz or tldraw in the public YC company directory or Steve Ruiz's public profiles, checked 2026-11-09.

We found no tie between Y Combinator or Garry Tan and Vox (@Voxyz_ai) in the public YC company directory or Vox's public profile, checked 2026-11-09.

We found no tie between Y Combinator or Garry Tan and Lauren Tan in the public YC company directory or Lauren Tan's public profiles, checked 2026-11-09.

We found no tie between Y Combinator or Garry Tan and xAI, where Lauren Tan works, in the public YC company directory or Lauren Tan's public profiles, checked 2026-11-09.

We found no tie between Y Combinator or Garry Tan and Cursor (Anysphere), whose plugins repository hosts pstack, in the public YC company directory or Lauren Tan's public profiles, checked 2026-11-09.
