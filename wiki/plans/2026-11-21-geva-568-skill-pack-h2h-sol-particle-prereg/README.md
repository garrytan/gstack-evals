---
id: 2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg
kind: plan
title: "Preregistration: the skill-pack head-to-head on GPT-6.2 Sol in Codex and on particle-1, and a fresh test of the one smallest-change sentence placed where gstack would ship it"
summary: "Sol in Codex CLI on 5 packs plus none, particle-1 in Claude Code on every arm, and the one sentence in CLAUDE.md or AGENTS.md on fresh units, with tests added as a co-primary."
author: GEVA-568
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-21
status: open
attachments:
  - 87b66634fa027df1fd9c5f66d6eb770e51a77a66260c19193a68d9908f86278c  prereg.json
links:
  - 2026-11-15-geva-538-skill-pack-h2h-prereg
  - 2026-11-19-geva-540-skill-pack-h2h-results
  - 2026-11-20-geva-565-skill-pack-h2h-correction
  - 2026-11-19-geva-562-codex-hooks-prereg
  - garrytan/gstack-evals#349
  - garrytan/gstack-evals#352
  - garrytan/gstack-evals#387
  - lanes/outcome-skills/h2h/
---

# Preregistration: the skill-pack head-to-head on GPT-6.2 Sol in Codex and on particle-1, and a fresh test of the one smallest-change sentence

## Approval

The eval Captain approved this plan at its plan gate on 2026-11-21, taking every recommended change from its review, and approved the program's total at caps (Agent notes A2). No paid call runs until this post merges and the Captain records each item's cap in the approvals record.

## ELI5

Last week we ran six popular skill packs and a no-pack control on Claude Opus 5.5 in Claude Code, on 100 ordinary GitHub bugs and features and 60 security fixes, and scored every fix with the project's own hidden tests. gstack didn't help Opus fix more, and cost more per fix. One plain sentence, "Make the smallest change that fixes the issue, and nothing more.", made Opus write about half as much non-test code, but it did that mostly by not writing tests.

That run only covered one model in one harness. This run asks the same question of the other two models we test: GPT-6.2 Sol in OpenAI's Codex CLI, with each pack installed the way its own Codex instructions say, and particle-1, a low-cost model, in Claude Code. It also tests the sentence again, on new bugs, in the place gstack would actually ship it (CLAUDE.md for Claude Code, AGENTS.md for Codex), and counts whether each session added tests, so a smaller change that skips its tests can't pass as a win.

## Before → after

Before: the head-to-head's verdicts rest on Opus 5.5 in Claude Code alone. gstack's generic-coding claims are a cut candidate on that one model and host. The one sentence was only tested in the task text, beside gstack, on the same units that produced its result, and its test-writing drop was found after the fact.

After: the same frozen units and scoring for Sol in Codex and for particle-1, each against its own no-pack arm in its own harness, and the sentence measured on fresh units in CLAUDE.md, with tests added as a preregistered co-primary. Each way each part lands maps to a named action (section 10).

## Why it matters

People building agents run Codex with GPT models and low-cost models as often as Claude Code with Opus. A pack that helps one model in one harness may do nothing, or harm, in another, so gstack's public claims need each model's own result. The sentence is cheap to ship, and shipping it without knowing that it stops agents writing tests would trade a smaller diff for an untested fix.

## What caused this work

The head-to-head deferred Sol and particle-1 to a costed second stage that the eval Captain approved on 2026-11-19, with Sol moved to Codex CLI after the project owner ruled that Sol runs in Codex. The correction post (#387) then showed the sentence had gone into the task text, not CLAUDE.md, and had mostly stopped Opus writing tests, so the Captain folded a fresh test of the sentence, with test-writing as a co-primary, into this plan.

## Decision

What we do differently for each way the result can land. The full table, with the conditions, is section 10.

- If gstack beats no pack for Sol in Codex on ordinary or security units: the generic-coding cut narrows to Opus in Claude Code, gstack keeps a claim scoped to Codex with its interval, and we look for the part of its Codex install that helps.
- If gstack shows no gain, or a loss, for Sol in Codex: the generic-coding cut covers both frontier models, and the generic-coding claims come out on every host.
- If gstack beats no pack for particle-1: gstack's generic-coding claim is rewritten as a claim for low-cost models, with its interval.
- If gstack shows no gain for particle-1: the cut holds for all three models under test.
- If the sentence in CLAUDE.md cuts non-test code on Opus, and neither verified fixes nor tests added drop by more than 5 points as far as the data can show (section 9; this is not a parity claim): it goes to gstack's maintainers to ship in gstack's CLAUDE.md section, and in its Codex AGENTS.md too if the Sol arm holds the same way.
- If the sentence cuts code only by dropping tests: the results say so in their first lines, and the sentence does not ship.
- If the sentence costs particle-1 fixes in the task text while the CLAUDE.md arm holds on Opus: the shipping issue scopes the sentence to frontier models and says why.
- If gstack plus ponystack beats gstack for particle-1: an issue proposes ponystack's phase discipline as a gstack option for low-cost models.
- If the sentence doesn't cut non-test code in CLAUDE.md: it does not ship, and the results say the task-text effect did not carry over to where gstack would put it.

## Big decisions

1. **Three parts, one plan.** Part S is Sol in Codex on the head-to-head's frozen units. Part P is particle-1 in Claude Code on the same units, every arm at the head-to-head's pins, so its rows pair with the published Opus rows. Part L is the sentence on Opus 5.5 in Claude Code on fresh units. They share the harness and the scorer; Part S, the only part planned above 500 dollars paid, has the one interim look.
2. **Which packs run on Sol.** Every pack with a documented Codex install, at its head-to-head pin: gstack, Superpowers, agent-skills, GSD and tstack. pstack and ponystack have no Codex install, so they are reported as left out on Sol, not as losses.
3. **gstack's pin.** On Sol, the newest stable tag at freeze, v1.102.1.0 (29bff55d), installed with ./setup --host codex as shipped: an older experimental Codex install would be a weak test of today's gstack. On particle-1, the head-to-head's 3805969 (1.99.4.0), so its rows pair with Opus. In Part L, v1.102.1.0, because that is the gstack the sentence would ship into.
4. **Where the sentence goes.** In Part L, gstack's CLAUDE.md section (where gstack would ship it) is the arm that decides; the task-text placement runs as a second arm so the two can be compared on the same units. On Sol, the sentence goes in Codex's global AGENTS.md. On particle-1 it stays in the task text, as in the head-to-head, so it pairs with Opus.
5. **Tests added is a co-primary for every sentence arm.** A session adds tests when its change adds at least one non-blank, non-comment line in a test file, by the scorer's own test-path rule (section 7 has the exact definition). The sentence holds only if it cuts code and shows no drop of more than 5 points in fixes or in tests added.
6. **Fresh units for Part L.** The head-to-head's walk used up the eligible SWE-bench-Live MultiLang rows. Part L draws from three pools nobody has scored a sentence on: the 18 MultiLang units that passed every gate but never ran in the head-to-head (its 14 stage 0 and stage 1 units, which ran the sentence arm, are left out), the 56 MultiLang rows the per-repository cap skipped (walked through the same gates), and the SWE-rebench leaderboard tasks created March to May 2026, converted by the state machines harness. That adds Python, which the head-to-head lacked (section 5).

## Implementation plan

### 1. What this plan reuses and what it changes

Everything in the head-to-head's preregistration (2026-11-15-geva-538-skill-pack-h2h-prereg, called "the base plan" below) holds unless this section or a later one changes it: the rig, the strip, containment, the allowance rules, the turns (task text T, question reply, continuation, DONE rule, cap of 6 continuations), the scorer and its rules, the row states, the cluster-aware McNemar test with Holm, the repository-clustered bootstrap, the Why-null cycle and the publication rules. Changes:

- New hosts and models: Codex CLI for Sol (sections 3 and 4); particle-1 through the run's metering proxy in Claude Code (section 3).
- A new co-primary for the sentence arms, tests added (section 7), built as a shared, tested module under src/.
- Fresh units for Part L (section 5).
- Codex exposure detectors, and a Claude Code detector that still sees gstack load at a pin past 7f9c1bc5 (section 8).
- Fixes before any paid call: the session runner's token counts (every token field read 0 in the head-to-head), and a GPT-6.2 Sol price row (section 12).

### 2. Parts, arms and pins

**Part S: GPT-6.2 Sol in Codex CLI.** Model gpt-6.2-sol, named explicitly in every session's config (never Codex's default). Codex CLI 0.170.0: npm @openai/codex@0.170.0, platform tarball @openai/codex@0.170.0-linux-x64 with sha256 67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32 (checked 2026-11-21; the same digest the office-hours and Codex hooks evals recorded). Its catalog lists gpt-6.2-sol with a 500,000-token context window and default reasoning effort low, so effort is pinned to low in every session, which is what a Codex user gets by default. Each row takes its model and CLI version from the session record (the model the proxy saw answer, and the version Codex wrote in its session metadata), never from this plan.

| Arm | Pin | Codex install, as the pack documents it |
|---|---|---|
| s-none | | Codex as shipped |
| s-gstack | garrytan/gstack v1.102.1.0 (29bff55dd8a14b32ff282d5a37097e3a53e3250a) | git clone, ./setup --host codex |
| s-gstack-line | as s-gstack | as s-gstack, plus a global ~/.codex/AGENTS.md whose bytes are the sentence and one newline (65 bytes, sha256 f62ebe89fbdcc840a1da59b744bdccdffb6453f6622cda86d87f6b7dffbfcd3e) |
| s-superpowers | obra/superpowers 22f0b463e7a5 | the Codex plugin, from a local marketplace at the pin |
| s-agent-skills | addyosmani/agent-skills 39b723ceebf8 | codex plugin marketplace add (local clone at the pin), codex plugin add agent-skills@agent-skills |
| s-gsd | open-gsd/gsd-core 357508df233c, npm @opengsd/gsd-core@1.21.0 | npx @opengsd/gsd-core@1.21.0 --codex --global |
| s-tstack | t3dotgg/tstack 11e37a74d0a6 | cp -R tstack/skills/* ~/.codex/skills/ |

pstack (cursor/plugins harness/pstack holds only a claude-code folder) and ponystack (a Claude Code plugin) have no Codex install. They are reported as left out on Sol, with that reason, never as a loss or a dropped arm.

Two deviations keep the bytes at the pins, recorded with each installed tree's hash, as in the base plan: Superpowers' README installs from the official Codex marketplace, which carries whatever version it lists, so the build adds the pinned clone as a local marketplace and installs from it; agent-skills' marketplace is added from a local clone at the pin. gstack's Codex install runs as shipped: at v1.102.1.0 it lists each skill once and Codex injects the body when the skill is invoked. Its setup writes no global AGENTS.md (stage 0 checks this), so s-gstack has none and s-gstack-line differs from it by exactly the sentence.

**Pin asymmetry on Sol.** gstack runs at its newest stable tag, while Superpowers, agent-skills, GSD and tstack stay at the head-to-head's 2026-11-15 pins, by the Captain's ruling. Their Codex support may have moved since. Every Sol pack row and the risks say so, and a pack-ahead or gstack-ahead result on Sol is read with it.

**Part P: particle-1 in Claude Code.** particle-ai/particle-1 through OpenRouter, routed to the Particle AI provider only, with data collection denied, through the run's metering proxy (Claude Code's Messages route, as the delivery-route eval ran it). Every base-plan arm at its base-plan pin, gstack at 3805969159bc (1.99.4.0), the same Claude Code 2.1.325, the same entries: none, gstack, Superpowers, agent-skills, GSD, pstack, tstack, gstack-pony and gstack-oneline (the sentence in the task text, as in the base plan).

**Part L: the sentence on Opus 5.5 in Claude Code.** claude-opus-5-5, Claude Code 2.1.325, gstack v1.102.1.0, on fresh units (section 5).

| Arm | What it gets |
|---|---|
| l-none | Claude Code as shipped (the no-gstack arm) |
| l-gstack | gstack v1.102.1.0 with the base plan's frozen CLAUDE.md section (v1.102.1.0's README asks for the same browsing rule) |
| l-gstack-md | l-gstack, with the sentence as one more line at the end of that CLAUDE.md section |
| l-gstack-task | l-gstack, with the sentence appended to T after a blank line, the base plan's placement |

The sentence, byte for byte in every arm that carries it: "Make the smallest change that fixes the issue, and nothing more."

### 3. What every session gets

The base plan's section 3 holds in every part. Changes and additions:

- **gstack telemetry off.** Every gstack arm's seeded ~/.gstack config sets telemetry: off, and every session's environment sets GSTACK_TELEMETRY_SOURCE=eval, so if anything were ever sent it would be tagged as eval. Sessions have no egress but the metering proxy in any case.
- **Codex sessions (Part S).** Codex 0.170.0's static binary lives on the read-only runtime volume, beside the runtimes the packs need. It runs as codex exec --json with model, effort, provider (the metering proxy, Responses API) and the trust bypass for installed hooks set in the session's CODEX_HOME config. Approvals and Codex's own sandbox are bypassed inside the session container, which is the sandbox. Bundled system skills, web search, the update check and analytics are off. No --ephemeral, so Codex writes its rollout file, which the exposure detectors read. Each continuation is codex exec resume on the same session.
- **The session kind on Codex.** gstack at v1.102.1.0 reads a session as headless when CODEX_THREAD_ID is set and its nearest ancestor process named codex runs exec, which every Codex session in this harness does. The Claude Code arms run with no session-kind override, so gstack sees them as interactive. To give Codex arms the same treatment, the harness starts Codex through a link to the pinned binary with another name, so the ancestor check finds no process named codex; every Codex variable, CODEX_THREAD_ID included, is kept, because Codex sets it and gstack's own Codex steps read it. A keyless check on 2026-11-21 (Codex 0.170.0 against a stub provider, gpt-6.2-sol, v1.102.1.0's script) showed gstack-session-kind printing headless inside a session started as codex exec and interactive inside one started through a link named sol-agent, with the code-mode host still running and the first request bodies identical apart from ids, timestamps and key order. The link is named sol-agent, which is none of Codex's own arg0 names (codex-linux-sandbox, apply_patch, applypatch). Stage 0 repeats the check in the session container and also shows CI and GITHUB_ACTIONS unset there, since gstack reads either as headless. A change elsewhere in Codex means any of: a request body that differs apart from ids and timestamps, a different tool list, or different session metadata (originator, cli_version) in the rollout. If stage 0 or another crew's check finds one, this plan changes by a dated pre-run change before any Sol session.
- **Question replies on Codex.** On Codex 0.170.0, a keyless capture on 2026-11-21 showed gpt-6.2-sol's first request offering request_user_input_async beside request_user_input (which works only in Plan mode). The async tool returns at once and its reply arrives as a new user message, so the harness answers it with the base plan's question reply, word for word, as the next user message on the same session. Stage 0 reads the tool list from the pinned binary's real first request in the session container and freezes which tool is answered and how. If only the synchronous tool is offered there, the per-arm count of questions Codex answered itself is frozen as a reported secondary, and the continuation is the only reply path on Sol. A question the harness can't answer is counted per arm.
- **Codex host differences, stated in every Sol result.** gstack marks its Codex host experimental, with hooks advisory except the destructive-command guard once its hooks are trusted; /review runs without its specialist reviewers; there is no cross-family second-model review; gstack's Claude Code hooks are not ported. Slash commands from Claude Code packs (/agent-skills:test, /gsd-debug) don't exist in Codex; each pack's Codex entry follows its own Codex docs (section 4).
- **One keyless capture per Sol arm** with codex debug prompt-input, which shows what the model receives: the skill listing, AGENTS.md and the first message. These captures are attached to the results.
- **particle-1 (Part P).** The same Claude Code container and settings as the Opus arms, with the model set to particle-ai/particle-1 and the base URL the metering proxy, which routes it to OpenRouter with the provider pinned. A call served by another provider stops particle-1's items for the Captain.
- **Allowances.** The base plan's rule, one allowance per session, the same for every arm of a part, 5,400 seconds and 300 turns: Opus as the base plan, Sol and particle-1 as in Agent notes A1. If a pilot's 95th-percentile session cost in any arm of a part passes half its allowance, every allowance in that part doubles before its counted run.
- **Containment.** The base plan's containment over every arm's installed home, including the Codex homes and the v1.102.1.0 homes; a confirmed hit drops the unit for every arm of that part. For SWE-rebench units, the object-level history check as well: every ref points at the base or an ancestor, no commit object past the base, no alternates, no nested .git with later objects, and no hidden-test name anywhere on the filesystem outside the repository.

### 4. Entries

T, the question reply and the continuation are the base plan's, word for word. Part P and Part L use the base plan's entry table (Part L's three gstack arms use gstack's entries: T on bugs, "/autoplan " + T on features). Part S's entries follow each pack's Codex docs at its pin:

| Arm | Bug entry | Feature entry | Source |
|---|---|---|---|
| s-none | T | T | |
| s-gstack, s-gstack-line | T | "$autoplan " + T | gstack README (Codex row: first invocation is $office-hours); docs/skills.md |
| s-superpowers | T (its session-start hook routes the task) | T | README, Codex CLI; the hook injects its bootstrap on Codex |
| s-agent-skills | "$test-driven-development " + T | "$spec-driven-development " + T, then "$incremental-implementation Implement every task." | docs/codex-setup.md: on Codex, invoke the skill the slash command names; .claude/commands/test.md, spec.md and build.md name those skills |
| s-gsd | "$gsd-debug " + T | "$gsd-quick " + T | the Codex install writes the same commands as skills under ~/.codex/skills/gsd-*/ |
| s-tstack | "Full send: " + T | same | README, which says the skills work in Codex |

agent-skills' Codex docs say to invoke a skill with @ or by naming it; Codex 0.170.0 treats an @ token as a file mention, so the entry uses Codex's own skill mention, $name, the same form gstack's and GSD's entries use, which makes Codex inject the skill's body. Each pack's loaded rate is reported beside each of its contrasts. Stage 0 shows each entry resolving to its skill (section 11); a failing entry gets one harness-side repair before stage 1, never a change to the pack.

### 5. Units

**Parts S and P** use the head-to-head's frozen units: the same 100 O units and 60 B2 units, with their image digests (units.json in the head-to-head's session data), and its stage 1 units as the pilot units (section 11). No unit is redrawn.

**Part L** uses fresh units: none of them is among the 100 O units the head-to-head counted. Three pools, all through the base plan's gates (exclusion list, permissive licence list with its second read, told-mode screen, feature screen, oracle with 3 base and 3 fixed runs, containment over every Part L home):

1. The 18 MultiLang units that passed every gate in the head-to-head's walk and never ran there: its 10 reserves and the 8 that passed after stage 0 was drawn. Its 12 stage 1 units and 2 stage 0 units are left out: they ran gstack with the sentence on Opus, and the stage 1 results have been opened. Their verdicts and containment are reused read-only; containment over the v1.102.1.0 homes runs fresh.
2. The 56 MultiLang rows the walk skipped only because their repository already had 3 units, walked through the same gates.
3. The SWE-rebench leaderboard tasks in this repository's pinned pool (quick/laneb/tasks/swerebench-r3a4.json) created 2026-03 to 2026-05, 110 tasks, converted by the state machines harness's SWE-rebench part from their Harbor packages, with the object-level check of section 3. The state machines eval already ran 29 of them through its oracle and kept 24; those verdicts are reused read-only.

At most 3 units a repository within Part L. One seeded order over the union (a new draw seed minted from random bytes before any draw and recorded in prereg.json), newest month first, then seeded within a month. Positions count only units that pass every gate. Part L's pilot is stratified so the SWE-rebench path is tried: the first 4 positions from pools 1 and 2 and the first 2 from pool 3 form the pilot and leave the order. Of the rest, positions 1 to 100 are the counted units (n = 100) and 101 to 105 are reserves used only to replace a unit that drops before any model run. If fewer than 111 units pass, the counted units are whatever is left after the pilot and the reserves, the MDDs are restated, and if that is under 60, Part L is reported as underpowered, its readings are descriptive, and nothing ships on it. Strata reported: pool, language (Python is new here), bug or feature, and created July 2026 or later (none of the SWE-rebench pool is).

Planning supply: pool 1 gives 18; the head-to-head's walk kept about 1 in 4.5 resolved rows, so pool 2 gives about 12; the state machines eval kept 24 of 29 SWE-rebench tasks, and after the licence, exclusion and told-mode screens pool 3 may give 60 to 80. About 90 to 110 in all, so n = 100 is possible but not certain; the restated MDDs cover a shortfall.

The halves for the interim look (section 11) and every run order come from a run-order seed (order_seed, minted the same way), never from the draw order, so each half mixes pools.

### 6. Scoring

The base plan's section 7, unchanged, in every part: the main checkout's change against base with nested worktrees left out, the strict reading as primary (edits to existing test files go back to base, new test files are kept), arm files at new hidden-test paths dropped, the hidden tests in a fresh container, verified-correct fix as the primary success, and the gap and retry rules. Python units score with the state machines harness's Python rules (its test-path pattern, parser and skip markers).

### 7. Tests added (new co-primary for every sentence arm)

**The rule.** A session **adds tests** when its extracted change (rule 1 of the base plan's section 7, before the strict reading reverts anything) adds at least one counted line to a test file. A counted line is an added line that is not blank and is not a whole-line comment, meaning its trimmed text does not start with // , /* or * (Rust, Java, C, C++, C#, Go, JavaScript, TypeScript) or with # (Python). A test file is one the scorer itself treats as a test: it matches the unit language's TEST_PATH convention (lanes/outcome-skills/statemachines/langs.ts), or it is a file the unit's hidden test patch touches. For Rust, a counted line inside an in-source test module counts too, found with the scorer's own detector (TEST_MODULES) on the new file, which is rebuilt by applying the patch to the base file. Deleted files add nothing. Lines in pack planning files (.planning/, docs/superpowers/, SPEC.md, tasks/plan.md, tasks/todo.md, .gstack/) never count. It is computed for every session in every part, so every arm's rate is reported, and it is a co-primary only for the sentence contrasts. An edit that adds a test case to an existing test file counts, which is why the rule reads the change before the strict reading.

**The module** is src/grade/regression-test.ts, a shared function over a patch, a language, the unit's hidden test files and a reader for base files, with tests in both directions: a new test file, a case added to an existing test file, a deletion only, blank and comment-only additions in both comment families, a test-like path outside the conventions (Go testdata/), a hidden-test file off the conventions, a planning file, and Rust in-source modules both new and edited.

**Against the correction post.** The module also holds the correction post's recount rule (any change to a TEST_PATH file, deletions included, no hidden test files). On the head-to-head's published session diffs that rule reproduces the post's counts exactly: 79, 79 and 28 of 100 O sessions for none, gstack and the sentence in the task text (and 88 for agent-skills, 83 for Superpowers). The frozen rule, given the same diffs with no hidden test files and no base files, gives 80, 79 and 28 (89 and 84). The one-session gap in each of three arms is the same unit, a Rust one, where the session's new source file carries an in-source test module that the recount's path rule doesn't see. Results report both counts on the published records, and the frozen rule decides.

### 8. Exposure

- **Codex (Part S).** A skill load is the skill's text arriving in what the model reads, read from the session's rollout files (the root thread's and any sub-agent's): a skill item Codex injected for a $name mention, or a tool output that carries text unique to that skill's SKILL.md. Procedure markers are the base plan's, read from the rollout: gstack's /autoplan start step on feature units, seen as an exec_command call that runs gstack-skill-start (on Codex the skill keeps the instruction form), Superpowers' "Using <skill>" announcement followed by a plan, agent-skills' failing test before the source edit on bugs or SPEC.md and tasks/plan.md on features, GSD's gsd-tools calls and .planning files, tstack's sol-loop, file-pr or babysit-pr steps attempted. gstack's bug-unit exposure is the installed pack, as in the base plan: the skill listing, plus the routing hook's line when the hook names a skill. The line arm's exposure is AGENTS.md in the prompt-input capture and in the session's first request at the proxy.
- **Claude Code past 7f9c1bc5 (Part L).** Since 7f9c1bc5, gstack's SKILL.md runs its start step and inlines the preamble as Claude Code loads it, so no gstack-skill-start Bash call appears and the expanded body differs between sessions. The /autoplan procedure marker in Part L is therefore either form of the start step: its printed block inside the expanded command body (its SESSION_KIND line and the skill name it prints), or, when gstack-skill-load's injection falls back (it prints "SHARED_PREAMBLE: not loaded" or a "SKILL_LOAD:" line asking the model to run the start command itself), a later Bash call to gstack-skill-start. Both count, and the share of each is reported per arm. The CLAUDE.md arm's exposure is the sentence inside the session's first request body at the metering proxy, as the Sol line arm's is. The pilot must show both detectors firing (section 11).
- **Part P** uses the base plan's detectors unchanged, since its gstack pin is before 7f9c1bc5.
- The base plan's 80% rule holds per part: a contrast whose other arm's procedure ran in under 80% of its sessions in a class is published as "pack not exercised as designed". Loaded and procedure rates appear in the same row as each contrast.

### 9. Comparisons

**Part S primary family**, Holm over 10: s-gstack minus each of s-none, s-superpowers, s-agent-skills, s-gsd and s-tstack, in O and in B, paired on units, verified-correct rate, cluster-aware McNemar test, repository-clustered bootstrap intervals, the base plan's row states.

**Part P primary family**, Holm over 12: the base plan's family, gstack minus each of the six other arms in O and in B.

**Sentence family**, read for each sentence contrast on its own (l-gstack-md minus l-gstack; l-gstack-task minus l-gstack; s-gstack-line minus s-gstack; particle-1's gstack-oneline minus gstack), three co-primaries, Holm over the three within a contrast:
1. Less code: the paired log ratio of non-test lines on units both arms fixed (the base plan's piece G statistic), below 1.
2. Fixes kept: the verified-correct difference, sentence arm minus gstack.
3. Tests added: the difference in the share of sessions that added tests (section 7), sentence arm minus gstack, paired on units, with the same cluster-aware test and clustered bootstrap.

A sentence placement **holds** when (1) reads less code (Holm-adjusted p below 0.05 with the ratio below 1), (2)'s point difference is no worse than -5 points and its interval is not wholly below 0, and (3)'s point difference is no worse than -5 points and its interval is not wholly below 0. It **holds only by dropping tests** when (1) and (2) hold and (3) fails. It **does not cut code** when (1) fails. l-gstack-md against l-gstack-task is reported as a secondary with its interval, so the two placements can be compared; it decides nothing.

Criteria (2) and (3) are a no-harm screen, not a parity test: they pass when no drop larger than 5 points is shown, and results word a pass that way. At n = 100 with design effect 1.2, the chance a criterion passes is about 0.85, 0.50 and 0.15 at true differences of 0, -5 and -10 points when 20% of units disagree, and about 0.74, 0.50 and 0.26 when half do (section 13). The sentence contrasts on Sol and particle-1 read on O units only, since those arms run on O alone.

**R44.** Every part has its no-gstack arm (s-none, particle-1's none, l-none). l-gstack minus l-none is reported with its interval as Part L's secondary, a fresh-unit read of today's gstack against no pack on Opus.

Secondaries, descriptive with intervals: the base plan's list (no pack against each pack, cost per verified fix, tokens, wall time, continuations, questions, allowance stops) in every part; tests added per arm in every part, with the recount rule's count beside it; p-gstack-pony minus p-gstack on O. Sol against Opus is never compared. particle-1's gap to the frontier model is a descriptive secondary that decides nothing: each particle-1 arm against the published Opus row of the same arm on the same units, verified-correct rate, with the repository-clustered bootstrap interval and the caveat that the runs are days apart. Any result favouring particle-1 states that gap in its headline, as the disclosure rules ask.

Stated before any data: in the head-to-head, gstack and no pack disagreed on about 10% of units, where no MDD fits at the strictest Holm step, so "not ahead" is the likely reading of s-gstack against s-none, and the interval is the reading that matters.

### 10. What we do with each result

Frozen before any spend. Issues go to gstack's maintainers within a week of the results merging; nothing in gstack changes during the eval.

| Result | What we do |
|---|---|
| Sol, O or B: s-gstack ahead of s-none | The generic-coding cut narrows to Opus in Claude Code. gstack keeps a claim scoped to Codex, with its interval and MDD, and an issue asks gstack's maintainers to find the part of the Codex install that helps (routing hook, skill listing, AGENTS.md content). |
| Sol, O and B: s-gstack not ahead of s-none | The CUT-CANDIDATE for gstack's generic-coding claims covers both frontier models, and the issue removing those claims covers every host, after one Why-null cycle on Sol (exposure, task fit, headroom, whether Sol already does it unaided). |
| particle-1, O or B: gstack ahead of none | gstack's generic-coding claim is rewritten as a claim for low-cost models, with its interval. |
| particle-1: gstack not ahead of none | The cut holds for all three models under test. |
| A pack ahead of gstack on Sol or particle-1 (after Holm, exercised as designed) | An issue naming the pack, model, class, the units it fixed and gstack did not, and a proposed port, as in the base plan. |
| A pack not exercised as designed | Published as such with its stop points and rerun command, no claim either way. |
| l-gstack-md holds | Sent to gstack's maintainers to ship in gstack's CLAUDE.md section. If s-gstack-line also holds, the same sentence goes into gstack's Codex AGENTS.md. |
| l-gstack-md holds only by dropping tests | The results say so in their first lines, and the sentence does not ship. |
| l-gstack-md does not cut code | It does not ship. The results say the task-text effect did not carry over to CLAUDE.md, and l-gstack-task's reading shows whether the task-text effect replicated on fresh units and at today's gstack (both the units and the gstack pin changed since the head-to-head, so a difference can't be put on either alone). |
| s-gstack-line holds, l-gstack-md does not | Reported; nothing ships, because the Claude Code placement is the one gstack's main install would carry. |
| particle-1's gstack-oneline loses fixes (criterion 2 fails) while l-gstack-md holds | The shipping issue scopes the sentence to frontier models and cites particle-1's reading. Otherwise particle-1's sentence reading is reported beside the Claude Code decision and changes nothing. |
| p-gstack-pony ahead of p-gstack on O (interval wholly above 0) | An issue proposes ponystack's phase discipline as a gstack option for low-cost models, with the units it fixed and gstack did not. Otherwise nothing. |
| Part L underpowered (under 60 counted units) | Descriptive only; nothing ships, and it comes back to the Captain. |

### 11. Stages

**Stage 0, keyless.** Build every new arm's install layer at its pin and check each installed tree against its pin. Drive a real launch end to end against a fake provider for each host: a Codex session through the renamed link, the proxy's Responses route, a question reply, a resume turn and teardown; a particle-1 Claude Code session through the Messages route. Show gstack-session-kind printing interactive in a Codex session started through the link and headless through the plain name, CI and GITHUB_ACTIONS unset in the container, and the request body, tool list and session metadata unchanged by the link (section 3). Read the question tools in the pinned binary's real first request for gpt-6.2-sol and freeze which is answered (section 3). Show that the pinned Superpowers clone is a valid local Codex marketplace and that its installed plugin tree hashes the same as the official marketplace's listing at that version; if not, the deviation is disclosed with both hashes. Show that gstack's Codex setup writes no global AGENTS.md. Run the planted cases (section 12). One no-model preflight row on a real VM per host, through the real install, egress filter, proxy, containment and the read audit.

**Stage 0, paid smoke.** Two O pilot units (one bug, one feature) and one B2 pilot unit, every Part S arm and every Part P arm (Part P runs 9 arms on O and 7 on B2, 25 sessions); two Part L pilot units, every Part L arm. Smoke sessions are not pilot sessions and nothing reads their outcomes beyond the pass rule. An arm passes when its install verifies, its entry resolves, its pack loads, it reaches a source edit on the feature unit, and the session scores with no infra gap. A failing arm gets one named harness-side repair and a rerun; if it still fails it runs as published with the failure disclosed, or it is left out and reported as left out (R111), or the Captain rules.

**Stage 1, per-arm pilots (R111).** Each arm's pilot spends at most a tenth of its budget (the Pilots section). Parts S and P: 6 O units and 4 B2 units from the head-to-head's stage 1 units, every arm. Part L: its 6 pilot units, every arm. Each pilot shows on that arm's own outputs that the part under test ran (the pack loaded and its procedure ran by section 8's detectors; for gstack on Sol, the session kind read interactive and the skill load was seen; for the sentence arms, the sentence was in loaded memory, AGENTS.md or T), that no judge is involved, and that the units can be supplied at the planned rate (images pull, the session ends scored). An arm that fails is fixed on the harness side and re-piloted, or left out and reported as left out. Each arm's pilot cap is a tenth of its re-priced counted budget (the Pilots section). The driver opens a pilot session only while the arm's settled pilot spend is under its cap, so one session in flight can pass it by at most one allowance; an arm whose settled spend reaches its cap before its pilot sessions have all run is left out under R111 and reported as left out. The pilot also reads each part's no-pack rate on its 6 O pilot units, together with what is already known (Sol fixed 48 of 60 of the delivery-route eval's bugs): no pack fixing 6 of 6 where the known rate is 80% or more is read as a ceiling (one raise attempt under the base plan's rule), and 0 of 6 as a floor. Six units are noisy, so this reading opens the raise attempt and nothing else. Pilot outcomes are sealed per arm as in the base plan; the released figures are the no-pack rates, gap rates, costs, discordant shares without direction and the line-ratio spread.

**Stage 2, counted.** Every part's units in a seeded run order (order_seed) that interleaves arms within each unit. Part S has the one look (R113: its counted run is the only one planned above 500 dollars paid), at half its units in run order (50 O and 30 B2 units, all arms of each). Each deciding contrast is tested at the look against a two-look O'Brien-Fleming bound computed at the alpha of its own Holm step, two-sided (at the strictest step, 0.05/10, |z| 3.972 at the look and 2.809 at the end; at 0.05/1, 2.797 and 1.977; the frozen script computes every step). Part S stops early for efficacy only when every contrast that decides its rows in section 10 crosses: s-gstack minus s-none in O and in B, s-gstack minus each pack in O and in B, and s-gstack-line, whose holds verdict needs its less-code ratio to cross and its two no-harm criteria to already pass at the look; in practice that makes an early stop unlikely. Part S also stops at the look, with no verdict, for a cap stop or a cell past 10% gaps. After a stop, every Part S contrast is reported on the first half with its interval, marked as stopped at half, under the same Holm steps. Parts P and L have no efficacy look: they stop only for a cap stop or gaps, which the ledger and the gap check watch throughout, and nobody reads their arm rates before the end. The frozen script prints only crossed or not crossed per deciding contrast and the stop decision. No other look. Analysis by the frozen scripts. Then the sealed pilot files are opened and their digests checked.

### 12. Build and checks before any paid call

On one branch, merged with this preregistration:
1. **Token counts.** The head-to-head's session records left every token field at 0 because the runner read usage under the ledger's key names, while the driver's close answer carries them under input_tokens, output_tokens, cache_read_input_tokens and cache_creation_input_tokens. Fixed so each session's tokens come from the close answer's usage, with a test that fails on the old code and a check on a real proxy journal.
2. **Price row.** openai:gpt-6.2-sol in src/runner/pricing/prices.ts at OpenAI's published rates (2 dollars input, 0.10 cached input, 2.50 cache write and 10 output per million tokens, doubling input and cache and 1.5 times output above 272,000 input tokens), with its source and date, and a test.
3. **The Codex session path** in the head-to-head's Harbor agent: the pinned binary on the runtime volume, the renamed link, the CODEX_HOME config, rollout and prompt-input capture, question replies, resume turns, and the session record fields (model from the proxy, CLI version from session metadata).
4. **The Codex installs** for the five packs, pinned and hashed, with the two marketplace deviations, and the AGENTS.md text for s-gstack-line.
5. **particle-1** on the Claude Code path, with the provider pin.
6. **Part L's units**: the pool union, the walk of pools 2 and 3 through the gates, the SWE-rebench object-level check, and the draw.
7. **The tests-added module** (section 7, built and tested) and the sentence family's analysis (section 9), keyless and tested on fixtures, including a planted case for every reading (holds, holds only by dropping tests, does not cut code).
8. **The detectors** (section 8), tested on fixtures from real Codex 0.170.0 rollouts captured against a stub, and on Claude Code transcripts at v1.102.1.0 captured against a stub.
9. **The interim look** script for Part S, with a planted fixture for each Holm step's bound.

Every gate that can drop a unit runs on planted known-good and known-bad cases first. The dry run opens and settles one ledger lease per frozen item on a temporary ledger. Runs execute detached on a dedicated runner VM, never on a Capy machine. Every VM is destroyed when its stage ends, after its export manifest is checked.

### 13. Power and MDD

From the base plan's power function (exact McNemar, 80% power, design effect 1.2), in points of the verified-correct rate:

| Part, class, n | Strictest Holm step | Discordant 0.2 | 0.3 | 0.4 |
|---|---|---|---|---|
| S, O, 100 | 0.05/10 | 17 | 21 | 25 |
| S, B, 60 | 0.05/10 | 20 | 26 | 30 |
| P, O, 100 | 0.05/12 | 18 | 22 | 26 |
| P, B, 60 | 0.05/12 | none fits | 28 | 33 |
| L, 100 | 0.05/3 | 17 | 21 | 25 |

In the head-to-head, gstack and no pack disagreed on only about 10% of units, where no MDD fits; then the 95% interval is the reading, and it was about 7 points either side on O. The tests-added co-primary has far more room: the head-to-head's gstack changed a test file in 79 of 100 sessions and the task-text sentence arm in 28, a discordant share near 0.5, so a drop of 20 points or more is detectable at n = 100. The no-harm criteria (2) and (3) pass with probability about 0.85, 0.50 and 0.15 at true differences of 0, -5 and -10 points when 20% of units disagree, 0.80, 0.50 and 0.20 at 30%, and 0.74, 0.50 and 0.26 at 50% (normal approximation, n = 100, design effect 1.2; at n = 60, 0.79, 0.50 and 0.21 at 20%). The line ratio's spread in the head-to-head (log standard deviation 0.74 on 53 units) puts a 30% difference within reach at about 50 units both arms fix.

### 14. Money

Every dollar figure is in Agent notes. The rules are the base plan's section 14: each item gets a ledger item and a cap the Captain records before its first lease; caps are 1.35 times central plus the parallel sessions times the per-session allowance plus the VM share; a cap stop ends that part incomplete and is never retried to change a verdict; the pilots re-price every counted item, and a re-priced program above the approved total goes to the Captain before any counted lease. Results pages carry no cost; cost goes in the crew's private registry row.

### 15. Terms, publication and disclosures

The base plan's sections 12 and 16 hold. Codex CLI is Apache-2.0; GPT-6.2 Sol runs under OpenAI's API terms and particle-1 under OpenRouter's and Particle's. SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0, which asks that changes be stated: the results say its tasks were converted from their Harbor packages by the state machines harness and screened by this plan's gates. Each unit's repository licence and notice ship with its diffs. Sol results carry OpenAI's disclosure line and particle-1 results Particle's, and every result says gstack is Garry Tan's own project and his team ran the eval. No pack author is contacted.

### 16. Risks and limits

- Sol may sit near its ceiling on these units: it fixed 48 of 60 of the delivery-route eval's bugs unprompted. The pilot reads the no-pack rate, and a ceiling gets one raise attempt under the base plan's rule.
- gstack's Codex host is experimental, and Codex has no slash commands from Claude Code packs, so Sol's procedure rates may be low for every pack; the 80% rule keeps those contrasts from reading as wins or losses.
- The renamed Codex link is a harness choice made so gstack treats Sol sessions the way it treats the Claude Code sessions; a gstack user running codex exec would get headless. The results say so.
- Part L mixes MultiLang and SWE-rebench units and adds Python; strata are reported, and nothing compares Part L's rates with the head-to-head's.
- particle-1 found leaked fixes through git history in an earlier eval; the containment and object-level checks are what keep that out.
- Sol's pack rows compare today's gstack with packs pinned on 2026-11-15 (section 2).
- The frozen tests-added rule counts one more session than the correction post's recount in three arms of the published data (section 7); both counts are reported.
- B1 browser units are not run on Sol or particle-1; B means B2 throughout.
- "Not ahead" is the likely Sol reading before any data (section 9).

## Review record

One lean /autoplan run (feature kind, one Opus 5.5 reviewer, every lens) on 2026-11-21 raised 22 findings: 3 high, 11 medium, 7 low and 1 informational. The three high ones (the interim look's bounds against the Holm families, the question path on Codex 0.170.0 for gpt-6.2-sol, and the tests-added rule against the correction post's count) were fixed in the plan as recommended at the gate, and the Captain took every recommendation. The medium and low ones are folded in too: the no-harm wording and pass rates, the 14 Part L units left out, the stratified Part L pilot, the 6-unit ceiling rule, pilot caps re-priced by each pack's measured cost ratio with a frozen meaning for a pilot cap stop, the $name entry for agent-skills, decision rows for the particle-1 pony and sentence arms, particle-1's gap to Opus as a secondary, the Particle and OpenAI disclosure lines, the start step's fallback form in the detectors, the frozen AGENTS.md bytes, smoke on pilot units, the replication confound, the B2 smoke count, SWE-rebench's change statement, the link and marketplace checks in stage 0, and the likely Sol reading stated in advance.

## Judge check

Judge: none

No model judges any outcome. Verified fixes come from hidden tests, and tests added and lines changed come from the scorer's path rules.

## Pilots

One row per arm. Budget is the arm's counted central spend, re-priced by the pack's measured cost ratio to no pack in the head-to-head (Agent notes A1); the pilot cap is a tenth of it, enforced as section 11 says, and an arm that reaches its cap is left out under R111. Parts S and P pilot on 6 O and 4 B2 units, Part L on 6 units.

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| s-none | $96 | $9.60 | no pack: the prompt-input capture holds no pack text | none | 10 pilot sessions scored with no infra gap |
| s-gstack | $102 | $10.20 | session kind interactive; gstack's skill listing in the capture; the /autoplan load and gstack-skill-start call on a feature unit | none | same |
| s-gstack-line | $59 | $5.90 | the frozen AGENTS.md bytes in the capture and in the first request | none | 6 pilot sessions scored |
| s-superpowers | $97 | $9.70 | the bootstrap injected; a skill load seen in the rollout | none | 10 pilot sessions scored |
| s-agent-skills | $140 | $14 | the $name skill's body injected in the rollout | none | same |
| s-gsd | $140 | $14 | the gsd-debug or gsd-quick skill loaded; gsd-tools calls | none | same |
| s-tstack | $136 | $13.60 | full-send loaded | none | same |
| p-none | $29 | $2.90 | no pack text in the session's loaded context | none | 10 pilot sessions scored; every call served by the pinned provider |
| p-gstack | $31 | $3.10 | the base plan's detectors at 3805969 | none | same |
| p-superpowers | $29 | $2.90 | the base plan's detector | none | same |
| p-agent-skills | $42 | $4.20 | the base plan's detector | none | same |
| p-gsd | $42 | $4.20 | the base plan's detector | none | same |
| p-pstack | $42 | $4.20 | the base plan's detector | none | same |
| p-tstack | $41 | $4.10 | the base plan's detector | none | same |
| p-gstack-pony | $18 | $1.80 | ponystack's phase line | none | 6 pilot sessions scored |
| p-gstack-oneline | $13 | $1.30 | the sentence at the end of T | none | same |
| l-none | $40 | $4 | no pack text in the first request | none | 6 pilot units drawn and scored, 2 of them from SWE-rebench |
| l-gstack | $40 | $4 | either form of the start step on a feature unit, or the installed pack on bugs | none | same |
| l-gstack-md | $40 | $4 | the sentence in the CLAUDE.md text of the first request | none | same |
| l-gstack-task | $40 | $4 | the sentence at the end of T | none | same |

## Interim look

Planned paid spend: $770, Part S's counted run, the only one planned above 500 dollars paid.

At: half of Part S's units in run order (order_seed), once: the first 50 O and 30 B2 units, with all of each unit's arms. Parts P and L take no efficacy look.

Stop bounds: two-look O'Brien-Fleming bounds, two-sided, each computed at the alpha of the contrast's own Holm step on the cluster-aware test: at the strictest step (0.05/10) a contrast crosses at the look only at |z| of 3.972 or more and runs at |z| 2.809 at the end; at the loosest (0.05/1), 2.797 and 1.977; the frozen script computes every step between. Part S stops early only when every contrast that decides its rows in section 10 crosses (s-gstack minus s-none in O and in B, s-gstack minus each pack in O and in B, and s-gstack-line's less-code ratio, with its two no-harm criteria already passing). A part also stops, with no verdict, for a cap stop or a cell past 10% gaps. After an early stop every Part S contrast is reported on the first half, marked as stopped at half. The look is computed by the frozen script, which prints only crossed or not crossed per deciding contrast and the stop decision; nobody reads arm rates at the look.

Other looks: none.

## Eval-loop practices

This plan follows the org drive's software-factory/evals/eval-loop-practices.md: item 1, the decision for each outcome (Decision and section 10); item 3, a pilot per arm at most a tenth of its budget (Pilots and section 11); item 5, no model judge (Judge check); item 6, one look at half the units with fixed stop bounds and no other look (Interim look).

## Disclosures

gstack is Garry Tan's own project, and his team runs this eval. Superpowers, agent-skills, GSD, pstack, tstack and ponystack are their authors' work; none was contacted.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in T3 Chat (Ping Labs), the company of tstack's author, Theo Browne.

## Agent notes

<details>
<summary>Money (internal; the figures behind sections 3 and 14)</summary>

**A1. Session prices and allowances.** Opus 5.5: the head-to-head's measured mean, about 0.40 dollars a session on O and 0.24 on B2, allowance 25 dollars. Sol in Codex: about 0.60 a no-pack session (the delivery-route eval measured 0.60 for Sol on Claude Code; the Codex hooks eval plans 0.52 at low effort in Codex), allowance 15. particle-1: about 0.18 a no-pack session (the delivery-route eval measured 0.17 in Claude Code), allowance 5. GPT-6.2 Sol's prices match 6.1's. Each pack is priced at its measured mean cost per session over no pack's in the head-to-head's published session data (Opus): on O, gstack 0.98, the sentence arm 0.73, Superpowers 0.95, agent-skills 1.31, GSD 1.36, pstack 1.26, tstack 1.24, gstack-pony 1.01; on B2, gstack 1.20, Superpowers 1.10, agent-skills 1.70, GSD 1.61, pstack 1.75, tstack 1.71. The Sol line arm is priced as gstack. Part L keeps 0.40 a session in every arm. The pilots replace these.

**A2. Items, central and cap.** Caps are 1.35 times central plus 6 parallel sessions times the allowance.

| Item | What | Central | Cap |
|---|---|---|---|
| s-smoke and s-pilot | 20 smoke and 66 pilot Sol sessions | $63 | $175 |
| s-main | 1,060 Sol sessions (7 O arms on 100, 6 B2 arms on 60) | $770 | $1,130 |
| p-smoke and p-pilot | 25 smoke and 82 pilot particle-1 sessions | $23 | $61 |
| p-main | 1,320 particle-1 sessions (9 O arms on 100, 7 B2 arms on 60) | $287 | $417 |
| l-smoke and l-pilot | 8 smoke and 24 pilot Opus sessions | $13 | $168 |
| l-main | 400 Opus sessions | $160 | $366 |
| **Paid** | | **$1,316** | **$2,317** |
| vms | the runner (standard-60) for about 110 hours, a keyless builder for Part L's walk | $300 | $400 |
| crew | this thread's model use: build, both /ship runs, the run, the results | $400 | $650 |
| **All-in** | | **about $2,020** | **about $3,370** |

The Captain approved 3,450 dollars all-in at caps at the plan gate on 2026-11-21, inside the head-to-head line (8,900 dollars at caps, about 600 paid used). A projection past 3,450, or past 5,000 for the thread, goes back to the Captain before the paid stage.

**A3. Sensitivity.** If Sol in Codex costs 1.00 a no-pack session, Part S's counted run is about 1,280 central; if Part L's Python units cost twice the MultiLang ones, Part L is about 240. Either would come back to the Captain under A2's rule.

</details>
