---
id: 2026-11-15-geva-538-skill-pack-h2h-prereg
kind: plan
title: "Preregistration: does any popular agent skill pack, gstack included, help Claude Opus 5.5 fix real bugs? A head-to-head of seven arms on hidden tests, built so gstack can lose"
summary: "Seven arms (no skills, gstack, Superpowers, agent-skills, GSD, pstack, tstack) on the same real fixes, scored by each project's hidden tests: ordinary fixes, browser-only bugs and security fixes."
author: GEVA-538
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-15
status: open
links:
  - 2026-11-09-geva-409-state-machines-prompt-prereg
  - 2026-11-09-geva-487-pstack-checks-prereg
  - 2026-11-01-geva-105-gstack-null-review-and-tb2
  - 2026-11-07-geva-380-r3c-results
attachments:
  - 748b5b0ee55bb3501dad111b2d90307380e9721e38b8f903815a9027408cb0e1  arms-pins.json
  - 0edb8a2ecd63d4f69b1033963cc1866255abb58d09450a0a36123c7d69713f9a  power.py
  - 4fd261b2a742437d18c9f51558b88ee68ca168dd940c9521f59d311187f1b803  power.txt
  - ce3c34e81da0f93c5d41750aee37dc4eea873d3f53fd6e2b56109180917b39c7  prereg.json
  - 68ae9c78d65e1081ed4e12ea98a181a658f83f8e5609145448d9f1045dd4629c  terms.md
---

# Preregistration: does any popular agent skill pack, gstack included, help Claude Opus 5.5 fix real bugs?

## Approval

The project owner answered this plan's review gate on 2026-11-15 and took every recommendation: the core size (100 ordinary units and 60 breadth units) and all seven review changes, which sections 3 to 14 now carry (section 18 lists them). The full size is not approved; it comes back to the owner only if the pilot raises the full-size flag of section 11. This post approves no item's spend. No paid call runs until it merges, the Captain records each item's cap in the approvals record, and the Captain gives the go. If the pilot re-prices the program above the approved total at caps, the Captain takes it to the owner before any stage 2 lease.

## ELI5

Skill packs are folders of instructions you install into a coding agent like Claude Code so it works "the right way". Six are popular: gstack, Superpowers, agent-skills, GSD, pstack and tstack. Each claims to make the agent better, and none publishes a controlled outcome test against the same agent with no pack. We run all six, plus the same agent with no pack, on the same real bugs that open-source projects fixed this year, in Rust, Java, C, C++, C#, Go, JavaScript and TypeScript. Each project's own hidden tests decide whether a fix is right, so no model grades another. Every arm gets the same model (Claude Opus 5.5), the same task text, the same machine and the same budget; only the installed pack and the command its own docs say to start with differ. There are two kinds of tasks: ordinary bug fixes and small features, and the kinds gstack says it is good at (bugs you can only see in a real browser, and real security fixes). gstack is the project of the person who runs this crew, so the test is built so gstack can lose, and we publish the result either way, with the harness and configs so any pack author can rerun it. Our earlier tests found no gain from gstack over plain Opus on generic coding, so the honest expectation is that most comparisons show no difference; the test says how large a difference it could have missed, and names what a pack does better where one wins.

## Before → after

Before: no pack has a controlled outcome benchmark. Pack comparisons online are anecdotes, and the one numeric claim (ponystack: 62 to 82% less code than gstack and more correct) came from 7 single-shot toy tasks with an older gstack ethos file pasted as a system prompt, not gstack's skills. Our own data covers gstack alone: no detectable gain over plain Opus 5.5 on Terminal-Bench 2 (+3 points, 95% interval -3 to +9) or code review (+2.4, -6.4 to +11.1), and gstack's /investigate was cut after a +2.8-point null on 18 real bug fixes.

After: a frozen, rerunnable head-to-head of seven arms on Opus 5.5, scored by hidden tests on real fixes, with paired differences, 95% intervals, Holm-corrected tests and the smallest detectable difference (MDD) stated up front for every gstack comparison. Exposure (did the pack load, did its procedure run) is reported in the same row as every verdict. A separate piece tests ponystack's claim on the same tasks. Each way the result can land maps to a named action for gstack (section 10).

## Why it matters

People building agents pick a skill pack on stars and vibes. A fair, public test tells them whether any pack makes a frontier model fix more real bugs, at what cost, and on which kind of work. For gstack, it settles what the public story can claim: if gstack shows no gain over plain Opus on ordinary fixes, the generic-coding gain claims come out of gstack's README and docs; if another pack wins on a kind of task, gstack studies and adopts what that pack does; if gstack wins on browser or security work, that is the claim it can make, with numbers.

## What caused this work

The project owner asked how our evals could show where gstack stands against the other popular packs. The eval Captain ruled that the only result worth having is one gstack can lose: a preregistered head-to-head, published whichever way it lands, with the harness open so pack authors can rerun it and send corrections.

## Big decisions

1. **Arms.** All seven: no skills (required by the no-gstack rule), gstack, Superpowers, agent-skills, GSD, pstack, tstack. Each gstack comparison is paired on the same units, so dropping an arm would save about 9% of model spend per arm and shrink each MDD by about 1 point. tstack is a pull-request lifecycle pack whose main steps need a GitHub remote our offline tasks lack, so its arm mostly measures the pack as installed; we keep it and say so.
2. **How each arm is driven.** Each pack is installed the way its README says and started with the command its own docs name for fixing a bug or building a small feature. No pack gets a pack-specific unattended setting. Every arm meets the same two fixed texts: the answer to any question tool call, and one continuation turn, both worded as approval of the agent's own recommended option (section 4), with up to 6 continuations. Stage 0 shows every pack reaching a source edit on a feature unit under this protocol.
3. **Size.** Core: 100 ordinary units and 60 breadth units, one session per unit and arm. The full size (150 and 80) is not approved and returns only through the pilot's full-size flag.
4. **Breadth tasks.** No published benchmark has fresh browser-only bugs or permissively licensed security fixes we can run, so both come from mining: security fixes from reviewed GitHub advisories and browser bugs from merged pull requests that change a real-browser test. Each task's image is built with a frozen per-ecosystem recipe, and an image that does not build drops by rule. If browser bugs end under 20 usable units, the breadth class is security fixes only and browser bugs are reported as infeasible at this scale. Every arm enters breadth units with its ordinary bug entry; gstack's /qa runs as a separate secondary arm on browser units.
5. **Comparison family.** Holm over all 12 primary contrasts (gstack against each of six arms, in each of two classes). The owner kept this stricter reading after review, knowing the MDDs are large (section 13).
6. **Budget per session.** The same allowance for every arm (Agent notes, A1), 5,400 seconds and 300 turns. A pack that spends more hits the stop and is scored as is. Per-arm budgets would hide the cost of heavier packs.
7. **ponystack (piece G).** ponystack is a plugin that sits beside gstack. It runs as its own piece on the ordinary units: gstack plus ponystack against gstack (shared sessions), gstack plus one plain "smallest change" line (the control that isolates ponystack's text), and no skills. Piece G is published with the same template whichever way it lands.
8. **Models.** Opus 5.5 only in this run. GPT-6.1 Sol and particle-1 are a conditional stage that comes back to the Captain with the Opus results (section 11 gives the reason).

## Implementation plan

### 1. Claims under test and what the primary measures

Each pack claims, in its own words, to make a coding agent work better: Superpowers through test-first discipline and systematic debugging, agent-skills through process ("prove it" tests, specs), GSD through spec and context engineering, pstack through verification-first playbooks, tstack through pull-request lifecycle skills, and gstack through a virtual engineering team with real-browser QA, security review and shipping. The shared, checkable promise is that the agent ships more correct changes. The primary outcome measures exactly that: the share of sessions whose change makes the project's hidden fail-to-pass tests pass without breaking any test that passed before (a verified-correct fix, section 7). It is deterministic: no model judges it.

What the primary does not cover: planning quality, review findings, pull-request hygiene, and work spread over many sessions. Those are other claims; the results name them as untested, and no pack gets a cut verdict here on a claim this design does not score.

### 2. Arms and pins

The pins below are frozen. On the freeze date the build re-reads every pack's default branch and records any newer version in arms-pins.json, but the pins do not move; nothing in a pinned pack changes during the eval, and gstack's pin never moves for the crew's own gstack updates. arms-pins.json also records every installed tree's sha256, and stage 0 checks each installed tree against its pin's git tree.

| Arm | Author | Pin | Licence | Install, as its README says |
|---|---|---|---|---|
| none | | | | nothing; Claude Code as shipped |
| gstack | Garry Tan | garrytan/gstack 3805969159bc (v1.99.4.0) | MIT | git clone into ~/.claude/skills/gstack, ./setup, and the CLAUDE.md section the README asks for, with frozen text (below) |
| Superpowers | Jesse Vincent | obra/superpowers 22f0b463e7a5 (v7.0.2) | MIT | Claude Code plugin from the official Anthropic marketplace, which pins this sha |
| agent-skills | Addy Osmani | addyosmani/agent-skills 39b723ceebf8 (v0.6.16) | MIT | Claude Code plugin from its own marketplace |
| GSD | Open GSD | open-gsd/gsd-core v1.21.0 (357508df233c), npm's latest | MIT | npx @opengsd/gsd-core@1.21.0 --claude --global (the README's non-interactive form) |
| pstack | Lauren Tan | cursor/plugins 3dbd22ff1274 (plugin 0.15.36, path harness/pstack/claude-code) | MIT (pstack/LICENSE) | Claude Code plugin from the cursor/plugins marketplace |
| tstack | Theo Browne | t3dotgg/tstack 11e37a74d0a6 | MIT | copy skills/ into ~/.claude/skills |
| gstack + ponystack (piece G) | Aianback | AyanbekDos/ponystack bc1b71b0ad0b | MIT (licence file; GitHub's field is unset) | Claude Code plugin from its marketplace, beside gstack |
| gstack + one line (piece G control) | | | | gstack as above |

Facts checked at these pins (2026-11-15): gsd-build/get-shit-done is archived and the project continues as open-gsd/gsd-core with /gsd-<name> commands; pstack's README installs a generated copy from harness/pstack/claude-code, byte-identical (git tree cdbbd4ca5dd2) to the copy the pstack-checks eval pins (cursor/plugins c742dd61), so that eval's pstack is this pstack; the two other "pstack" repositories with a few thousand stars each are third-party ports and are not used.

Installs run at image-build time in a throwaway container with network, writing only the session home; sessions then run offline. Two deviations from the READMEs' commands keep the bytes at the pins, and both are recorded with the installed tree hashes. First, plugin marketplaces (the official Anthropic one, cursor/plugins, agent-skills' and ponystack's) are added from a local clone at the pinned sha instead of GitHub's moving head. Second, agent-skills' marketplace entry names its plugin source as GitHub with no ref (.claude-plugin/marketplace.json), which would install GitHub's head whichever clone holds the manifest, so the build rewrites that one source field to the local clone's path. gstack's CLAUDE.md section, which the README leaves to an agent to write, is frozen as this text, appended to ~/.claude/CLAUDE.md:

> ## gstack
>
> Use the /browse skill from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.

### 3. What every session gets (identical across arms)

- The outcome-skills rig from the state machines eval (its section 4), unchanged except where this section says: a fresh container from the unit's image digest; the repository at the base commit with history replaced by one commit; the strip of CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/ folders from the repository; no egress but the metering proxy; WebSearch and WebFetch disallowed and server-side web tools refused at the proxy.
- Containment over the whole session filesystem. The containment checks (git objects, build and test caches, package caches, archives at two levels, hidden-test-name needles) scan the unit image plus each arm's installed home, since a pack can install a unit's repository as a dependency (gstack's node_modules and Playwright, GSD's runtime). A confirmed hit in any arm drops the unit for every arm, so pairing holds, and hits are reported per arm. Needle hits that are common idioms are classified by a frozen rule (the hit is a test name of 12 characters or fewer, or appears in at least 3 unrelated repositories of the same frame), never by hand.
- Claude Code at one pinned version through the Agent SDK (the build records it; 2.1.325 was the version tested in planning), with the rig's settingSources, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 (one built-in skill, plugin-authoring, still loads in every arm) and CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4 in every arm. Four subagents plus the main loop put 5 calls in flight, whose reservations at the proxy's byte fallback still fit inside the session allowance; the default of 20 would not, and would stop fan-out packs before they had spent it.
- The SDK's tool callback allows every tool, Skill calls included, because gstack's and GSD's skills declare allowed-tools and would otherwise stop at a permission prompt. AskUserQuestion gets one fixed reply in every arm (section 4).
- No pack-specific unattended setting in any arm. gstack's GSTACK_SESSION_KIND=unattended is not set: gstack's own docs say it is for a parent process that drives its plan runs, and no other pack would get a matching bypass. Every arm meets the same question reply and continuation instead.
- A call the proxy refuses only because in-flight reservations fill the allowance is a retryable refusal, counted per arm, and never an allowance stop.
- Every arm runs in containers on Ubicloud VMs that hold no gstack install and no Capy drive path, so the no-skills arm and every pack arm see only their own pack. A read audit after the run reports any file read from another pack.
- Browser units (B1) get Playwright's Chromium and its OS libraries baked into the image for every arm, since the hidden tests need them. On B1, session containers get the scoring container's browser conditions: --shm-size 2g, and one launcher wrapper outside the repository (/opt/h2h/chromium) that adds --no-sandbox and --disable-dev-shm-usage, reached through each runner's own environment (CHROME_BIN for Karma and testem, PUPPETEER_EXECUTABLE_PATH for Puppeteer; Playwright passes the flag itself), so no frozen test config is edited. Every pack's documented browser runtime is provisioned at install time with network: gstack's browse binary, which its ./setup builds; agent-skills' chrome-devtools-mcp, fetched at a pinned npm version and registered the way its browser-testing skill expects; GSD's UI verification agents use the same Playwright Chromium. Stage 0 records each pack's browser path. Ordinary and security units get no browser in any arm.
- The same allowance in every arm: a dollar allowance per session (Agent notes, A1), 5,400 seconds wall and 300 turns across all turns. If stage 1's 95th-percentile session cost for any arm is above half the allowance, the allowance doubles for every arm before stage 2, and the re-priced program follows section 11's COST rule.

### 4. The turns

The task text T is identical in every arm of a class:

> {problem statement}
>
> Fix this issue in this repository. Don't stop to ask. When the fix is finished, end your last message with DONE on its own line.

The first turn is the arm's entry prefix (from its own docs, below) followed by T. A unit is a "feature" when the state machines eval's frozen feature-request screen flags its problem statement, else a "bug". Security and browser units use the bug entry in every arm.

| Arm | Bug entry | Feature entry | Source in the pack's docs |
|---|---|---|---|
| none | T | T | |
| gstack | T (fix directly; /verify while building) | "/autoplan " + T | docs/skills.md:611; README.md:28 |
| Superpowers | T (its session-start hook routes "fix this bug" to systematic-debugging and "build X" to brainstorming) | T | skills/using-superpowers/SKILL.md:30-31 |
| agent-skills | "/agent-skills:test " + T | "/agent-skills:spec " + T, then "/agent-skills:build auto" | .claude/commands/test.md:13-18; README.md:17,40 |
| GSD | "/gsd-debug " + T | "/gsd-quick " + T, after "/gsd-onboard" | docs/USER-GUIDE.md:697-702,1111-1114 |
| pstack | "/pstack:poteto-mode " + T | same | pstack/README.md:47,127 |
| tstack | "Full send: " + T | same | README.md:12-13; full-send/SKILL.md:13-14 |
| gstack + ponystack | as gstack | as gstack | ponystack README: it reads the phase from the gstack command |
| gstack + one line | as gstack, with "Make the smallest change that fixes the issue, and nothing more." after T | same | |
| gstack /qa (secondary, B1 only) | "/qa " + T | | docs/skills.md:611 (/qa tests a running site and fixes what it finds) |

Scripted turns from a pack's docs (agent-skills' "/agent-skills:build auto" after its spec turn, GSD's "/gsd-onboard" first) are part of that arm's entry and count against the session's limits, not its continuations. If stage 0 shows /gsd-debug needs /gsd-onboard first, the onboarding turn runs first in every GSD session, and its cost is reported on its own line.

**Question reply.** Every AskUserQuestion call in every arm gets: "No one is available. Treat this question as answered with your recommended option, except pushing, deploying or deleting data, and keep going."

**Continuation.** When a turn ends without DONE, the harness sends, in every arm alike: "No one is available. Treat every question or approval you are waiting on as approved with your recommended option, except pushing, deploying or deleting data, and keep going until the fix is finished. End your last message with DONE on its own line." At most 6 continuation turns per session, inside the session's limits. A turn has DONE when any of the last 3 non-empty lines of its final message, with markdown markers and punctuation stripped and case ignored, is the word DONE. So "DONE.", "**DONE**", DONE inside a code fence and DONE followed by a trailer line such as gstack's GSTACK_RESULT all count. Continuation counts are reported per arm, and so are spurious continuations: a continuation after which the tree's diff did not change. Whatever the main checkout holds when the session ends is scored.

### 5. Units: the ordinary class (O)

- Source: SWE-bench-Live MultiLang at the Hugging Face revision on the freeze date (re-read; the state machines eval pinned eb09c2e5 on 2026-11-08), converted by the state machines harness, which already builds, oracles and contains these rows. That harness converts Rust, Java, C, C++, C#, Go, JavaScript and TypeScript rows; there are no Python units, and public text says so.
- Exclusion list, frozen in prereg.json and applied before any draw: every repository of a pack under test or its organization, and every repository tied to the project owner: garrytan/*, obra/*, addyosmani/agent-skills, open-gsd/*, gsd-build/*, cursor/plugins, t3dotgg/*, AyanbekDos/*, DietrichGebert/ponytail, yc-software/* and openclaw/*. The excluded counts are reported per class. (The MultiLang window holds 12 GSD-family rows whose fixes the GSD arm installs.)
- Eligible: created 2026-03-01 or later (the walk extends back to 2025-01-01 only if supply runs short, in the order below); the repository's licence on the freeze date is on a frozen permissive list (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, BSL-1.0, Unlicense; MPL-2.0 is weak copyleft and is out), read once by GraphQL and frozen as a file; the fix changes 1 to 6 non-test source files; at least one fail-to-pass and one pass-to-pass test; image by digest; the pstack-checks eval's told-mode screen (problem statement at least 200 characters, no diff block, no two lines of 30 characters or more that the fix adds).
- Oracle: the state machines eval's oracle unchanged (3 base and 3 fixed runs with the fix's tests applied; a unit stays only when every fail-to-pass test fails 3 of 3 on base and passes 3 of 3 on the fix; stable set from all six; stale-report, rebuild, report-directory and ambiguous-test rules). Its verdicts and containment records are reused read-only where that eval or the pstack-checks eval already ran a unit; the rest run fresh.
- Draw: one seeded order over every eligible unit (draw_seed minted once from random bytes before any draw and recorded in prereg.json), at most 3 units a repository across every stage, newest first: July 2026 onward, then June back to March 2026, each month in seeded order. The gates run in that order, and positions count only units that pass every gate. Stage 1 takes positions 10, 20, ..., 120, so its month mix matches stage 2's; stage 2 takes the other positions in order up to n, then 10 reserve units used only to replace units that drop before any model run; stage 0 takes the first bug unit and the first feature unit after the reserves. Overlap with the state machines and pstack-checks evals' units is allowed and reported, since arms and scores differ and nothing here is tuned on their results.
- Strata reported on their own: July 2026 onward (after Opus 5.5's published cutoff), bug versus feature, language.

### 6. Units: the breadth class (B)

Every arm gets the same breadth tasks, whether or not its pack has a tool for them, and enters them with its ordinary bug entry. The exclusion list and the permissive list of section 5 apply to both frames before any draw.

**B2, security fixes.**
- Source: github/advisory-database at a pinned commit; reviewed, not withdrawn advisories published 2026-03-01 to 2026-10-31 in npm, Go, Maven, crates.io and NuGet; exactly one GitHub repository among the fix references, on the permissive list and not archived; the fix commit or pull request changes at least 1 test file and 1 to 6 non-test source files. Free count on 2026-11-15, before the exclusion list: 2,963 advisories in 775 repositories, 1,376 at 3 a repository; in a 300-advisory sample, 55% of fixes touch a test and 1 to 6 source files.
- Problem statement: the advisory's summary and details, with fix URLs and commit ids stripped, attributed under the database's CC-BY-4.0 licence, then the told-mode screen. The reviewed advisory is the security label; no judge.

**B1, bugs you can only see in a real browser.**
- Source: merged pull requests from 2026-03-01 to 2026-10-31 in permissive repositories that run a real-browser test runner at the root (Playwright, Vitest browser mode, Web Test Runner, Cypress, Karma, Puppeteer), from a repository list searched once on the freeze date and frozen as a file; "fix" in the title; closing a linked issue, whose text is the problem statement; changing at least one browser-test file by a frozen path rule and 1 to 6 non-test source files. Free count on 2026-11-15, before the exclusion list: 170 candidates in 83 repositories at 3 a repository, before images, the oracle and the label.
- The fail-to-pass tests must run in a real browser engine, shown by the runner's own report (a Playwright project or browserName, the Karma or Web Test Runner browser string) or, for Vitest, by the browser provider in its config together with the report's project name; and they must not also be collected under jsdom or node (a keyless check).
- Browser-only label: GPT-6 Astra and Opus 5.5 each answer one frozen question about the issue, the fix and its tests, never an arm's output: "Is the wrong behaviour visible only in a real browser engine, through rendering, layout, focus, DOM events, browser APIs or hydration, and not in Node or jsdom?" A unit is in only when both say yes. Agreement is reported. This labels eligibility; it scores nothing.

**Building B images (new).** Each candidate's image is built at the fix's parent with a frozen recipe per ecosystem (pinned toolchain image; dependencies installed from the lockfile; npm, pnpm and yarn, Go modules, Cargo, Maven and .NET restore), browsers baked in for B1, test retries switched off, and the test command and report parser chosen by frozen rules: JUnit XML where the runner writes it, TRX for .NET, else go test -json, cargo test, and Jest and Vitest JSON. A runner whose JUnit or JSON reporter is not already in the lockfile drops by rule; no reporter package is added. No model writes these recipes. A candidate whose image does not build, or whose tests cannot be found by those rules, drops with its reason code, and drops are counted per ecosystem, so supply is whatever the recipes can build, the same for every arm. Builds run untrusted install scripts with network, so they run on a throwaway VM that holds no API key, Ubicloud token or ledger, destroyed afterwards. Every built image is pushed by digest to an image store the eval controls before its oracle run; sessions and scoring run only from that digest, an image is never rebuilt, and the digests are recorded in the unit list.

**Oracle and containment for B.** The state machines oracle with two changes: browser units run 5 base and 5 fixed times (browser tests flake more), and the hardened test container gets section 3's browser conditions (a 2 GB /dev/shm and the launcher wrapper; it already drops every capability and sets no-new-privileges, which is why Chromium's own sandbox cannot run). The same conditions apply in sessions, the oracle and scoring. The containment checks of section 3 apply unchanged.

**Draw and fallbacks.** The same seeded draw rule as O, run separately over the B1 and B2 frames. In each frame, stage 1 takes positions 6, 12, ..., 36 (6 units, so 12 in all), 5 reserves follow stage 2's units, and stage 0 takes the first unit after the reserves. B1 fills up to half of B's n; B2 fills the rest. If B1 ends under 20 usable units: widen B1 to 2025-06-01, then add the 8 or so pinned MultiLang rows that pass the browser checks; if still under 20, B1 is reported as infeasible at this scale, never loosened, and B is B2 alone. If B2 ends short of its share: widen to 2025-06-01 (1,893 at 3 a repository before the exclusion list).

### 7. Scoring (both classes)

The state machines eval's section 7 scorer, with three rules made explicit:
1. Extract the arm's change against base from the main checkout's working tree, untracked files included. A nested worktree directory (any directory holding a .git file or folder below the root) is left out of the extracted change. Whether a linked worktree or a branch beyond base holds a change that passes is recorded as a secondary per arm (Superpowers defaults to .worktrees/ at the project root once it has consent).
2. Strict reading (primary): the arm's edits to existing test files and frozen test or build configuration go back to base; its new test files are kept. Adapted reading (reported beside): its own test edits kept when every stable test still exists and no skip marker was added.
3. Before the fix's tests are applied, any file the arm wrote at a path where the fix adds a new test file is dropped and logged per arm, so a test-first arm's own test at that path never turns into an add/add conflict. Then the fix's tests apply with a frozen three-way merge; a conflict is a scoring gap, never a miss.
4. Run the project's own test commands and report parser in a fresh container from the same digest.
5. **Verified-correct fix** (the primary success): every fail-to-pass test passes, every stable test passes, and no new test file the arm added fails in all three scoring runs (the reused scorer's new-test rule). The reading without the new-test rule is reported per arm beside it. Other outcomes: fix that broke, no fix, no fix that broke. An outcome resting on 2 tests or fewer gets two more runs and each such test takes its majority result.
6. Session ends: completed, or at a limit (wall, turns, allowance), are scored as is; an upstream end (a provider or proxy error) gets one retry of the whole session from a fresh container, and a second is a gap; an infra failure gets one rerun, and a second is a gap; a provider safety-filter stop is its own outcome, scored as no fix and counted per arm; a reservation-bound refusal (section 3) is counted apart and is not an end. A unit with a gap in either arm of a contrast leaves that contrast; a cell with gaps on more than 10% of its units is incomplete and gets no verdict; a worst-case reading that scores every gap as a failure is reported beside.

### 8. Exposure (did the pack load, and did its procedure run?)

Detectors are frozen per pack from the pinned code, tested on fixtures in the build, and checked on stage 0's transcripts before stage 1:
- Loaded: the entry command expanded (a <command-name> block or a "Base directory for this skill" marker for that pack's skill), a pack skill launched by the Skill tool, or, for Superpowers, its session-start block present.
- Procedure ran: gstack, a gstack-skill-start call or its timeline event for the entry's skill (/autoplan on feature units; browse calls for the /qa secondary arm); Superpowers, the "Using <skill>" announcement with a todo per checklist item; agent-skills, a failing test written before the source edit on bug units, or SPEC.md and tasks/plan.md on feature units; GSD, gsd-tools calls and .planning/debug or .planning/quick files; pstack, a todo list that starts with the chosen playbook's steps; tstack, its sol-loop, file-pr or babysit-pr steps attempted; ponystack, its hook's phase line.
- On bug units (O bug, B1 and B2), gstack's documented entry is to fix directly with no skill, so its exposure there is the installed pack (skill listing, the CLAUDE.md section, and Claude Code's /verify nudge, which only gstack's verify skill triggers), counted as loaded and as procedure ran in 100% of those sessions. An O or B null for gstack can therefore reach a CUT-CANDIDATE verdict for the generic-coding claim.
- One rule for every arm: a contrast where the other arm's pack procedure ran in under 80% of its sessions in that class is published as "pack not exercised as designed", never as gstack ahead or the pack behind. A gstack procedure rate under 80% in a class reads FIX-METHOD for gstack on exposure, never a cut. The results table shows each pack's loaded and procedure rates in the same row as its contrast.
- Reported per arm and class: loaded rate, procedure rate, the read audit, continuations, spurious continuations and questions asked.

### 9. Comparisons, analysis and verdicts

- Primary family, 12 contrasts: gstack minus each of none, Superpowers, agent-skills, GSD, pstack and tstack, in O and in B, each paired on units, on the verified-correct rate.
- The verdict test is cluster-aware: a McNemar test with the clustered variance of Obuchowski (1998), clusters being repositories, two-sided, Holm-adjusted over the 12. Exact McNemar is reported beside it. Each contrast also reports the paired difference with a 95% interval from a repository-clustered bootstrap (10,000 resamples, bootstrap_seed in prereg.json).
- Row states, frozen with their wording. "Ahead": Holm-adjusted p below 0.05 in gstack's favour and a 95% interval that excludes 0 on the same side. "Behind": the same against gstack. "No difference shown": neither, printed with its interval and the MDD at the measured discordant share. "Incomplete": gaps above 10% in either cell; it stays in the Holm count with p = 1. "Pack not exercised as designed": section 8's rule. "Infeasible": B1 under 20 units. "Run as published, failure disclosed": a stage 0 ruling. Public text never says "tie" or "the same"; it says "no difference larger than about X points shown".
- "Half the MDD" (section 10) is half of section 13's MDD at the measured discordant share and at the alpha of that contrast's Holm step.
- Secondaries, descriptive with intervals and no Holm: no skills against each pack (beside every pack result); every pack pair; the /qa secondary arm against gstack's bug entry and against no skills on B1; non-test source lines changed (added plus deleted in the strict diff, lockfiles and generated files out; a pack's own planning files such as .planning/ or docs/superpowers/plans counted apart); dollars per verified fix (an arm's metered spend over its verified fixes); wall time; input, output and cached tokens; continuation turns and spurious continuations; reservation-bound refusals; allowance stops; questions asked; the worktree secondary; the reading without the new-test rule; dropped arm test files; adapted-reading results; the strata of sections 5 and 6.
- No model judge scores anything in this design. If a judged secondary is ever added, it follows the judge rule (GPT-6 Astra for Claude runs, kappa of at least 0.6 on 40 or more labels) and lands as a disclosed amendment before any data.
- Why null: every gstack null and every gstack loss gets one cycle (exposure, task fit, power and headroom, whether Opus already does it unaided) and a verdict of KEEP, FIX-METHOD or CUT-CANDIDATE for the gstack claim in that class, under section 8's exposure rules.

### 10. What we do with each result

Frozen before any spend. "Within a week" counts from the results merging. Issues to gstack go to its maintainers; nothing in gstack changes during the eval, and any port ships only as a gstack change that a later eval wave measures, with no claim about it before then.

| Result (Opus 5.5) | What we do |
|---|---|
| gstack ties plain Opus on ordinary bugs (O: gstack minus no skills reads "no difference shown") | The generic-coding gain claims come out of gstack's README and docs. Within a week, an issue to gstack's maintainers lists every line that implies better results on generic coding, to be removed or reworded, and the public story moves to breadth and verified work per dollar. gstack's exposure on O is the installed pack, so the Why-null cycle can end in CUT-CANDIDATE for the generic-coding claim, said plainly to the owner. |
| gstack behind plain Opus on O | The same issue, plus a Why-null cycle on what in the installed pack costs fixes (continuations, allowance stops, files touched), ending in a named verdict. |
| gstack ahead of plain Opus on O | Published with its interval and MDD; gstack's README may claim it with those numbers. |
| gstack ahead of plain Opus on B | Published, with the interval, the B1 and B2 strata, exposure, the /qa secondary, and every pack comparison in B, whichever way they went. |
| gstack ties or trails plain Opus on B | No breadth-outcome claim in public; gstack may say what tools it has, never that they fix more bugs. A Why-null cycle on /qa's fix claim, reading the /qa secondary arm. |
| A pack ahead of gstack on a class (after Holm, exercised as designed) | Within a week, an issue to gstack's maintainers naming the pack, the class, the units the pack fixed and gstack did not, and the pack skills that ran on those units (section 8's records), with a proposed port. |
| A pack ahead of gstack by at least half the MDD, not after Holm | Listed in the results' "ideas to study", with no adoption work. |
| A pack not exercised as designed | Published as such, with the stop points it met and its rerun command; no claim either way; a harness note for the next wave. |
| gstack's dollars per verified fix above plain Opus's, with no correctness gain on a class | Said in the results' first lines. |
| Piece G | Below. |

**Piece G (ponystack).** Its family of two, Holm-adjusted: (1) the lines-changed ratio, gstack plus ponystack over gstack, on units both arms fixed (paired log-ratio, repository-clustered bootstrap); (2) the verified-correct difference, gstack plus ponystack minus gstack (section 9's test). "Less code" holds when (1)'s adjusted p is below 0.05 with the ratio below 1. "More correct" holds when (2) reads ahead. If less code holds and (2)'s point difference is no worse than -5 points with an interval not wholly below 0: an issue to gstack's maintainers proposes the less-code discipline, as the one line when the one-line control's paired ratio against gstack has an upper bound at or below ponystack's point ratio, else as ponystack's text, measured in the next wave. No parity claim is made: at n = 100 no margin inside the MDD is reachable. Piece G is published with the same template whichever way it lands, and it says that ponystack's own benchmark measured gstack's older ETHOS rule ("+70 LOC"), while gstack's ETHOS.md now says "Complete coverage, minimal code", so this eval tests today's gstack. Stage 1 measures the log-ratio spread before section 13's figure is relied on.

### 11. Stages

**Stage 0: install and exposure smoke.** Keyless first: build every arm's install layer at its pin and check each installed tree against its pin; a driven launch end to end against a fake provider that loads every pack under the Agent SDK with the rig's settingSources and tool callback, through several rows and teardown; and a no-model preflight row on a real VM that runs the real install, egress filter, proxy, image store, browser wrapper, one O unit and one B unit through image build, containment and the read audit. The planted cases of section 15 run there too. Then paid, on Opus: 4 units taken after the reserves (1 O bug, 1 O feature, 1 B1, 1 B2); every primary arm runs all 4, piece G's two arms run the 2 O units and the /qa arm runs the B1 unit (33 sessions). An arm passes when its install verifies, its entry command resolves, its pack loads, it reaches a source edit on the feature unit, and the session ends scored with no infra gap. A no-skills session must run the B1 unit's own browser tests inside the session container. A failing arm gets one named repair on the harness side, never to the pack, and a rerun; if it still fails, it runs as published with the failure disclosed, or the Captain rules. Stage 0 freezes the exposure detectors, records each pack's browser path and decides the GSD onboarding question. Its outcomes are sealed with stage 1's.

**Stage 1: headroom pilot.** 12 O and 12 B units (stage 1 units never enter stage 2), every primary arm, piece G's two arms on O and the /qa arm on B1, one session each. The pilot's per-arm outcomes are sealed from the Captain and the crew until stage 2 is scored: the readout script writes them only into a file encrypted to a key minted for this purpose and kept in the sealed store, and the file's sha256 goes into the stage 1 run record and the results. A merged prereg.json cannot take a later digest, so it freezes the procedure and the release list instead. The script releases only:
- the no-skills rate per class and the pooled rate across arms per class;
- gap rates per cell;
- per-arm session costs (mean, median and 95th percentile);
- the discordant share per contrast, with no direction;
- piece G's log-ratio spread, with no direction;
- the full-size flag: one bit, true when any B contrast's absolute stage 1 difference is at least the full-size B MDD at the measured discordant share, with no arm or direction named.

Each reading has a frozen response:
- FLOOR (no skills fixes fewer than 2 of 12 in a class): that class stops, reported as a floor.
- CEILING (no skills fixes 11 or 12): one ceiling-raise attempt that restricts that class to units whose fix changes 2 to 6 non-test source files, re-piloted on 12 new units; if it still reads CEILING, the class stops.
- INFRA (any cell with gaps on more than 10% of units): only named harness repairs, then a re-pilot of the failed cells.
- COST: measured per-arm costs re-price every stage 2 item. If the re-priced program at caps is above the approved total, it goes to the Captain, and through the Captain to the owner, before any stage 2 lease. The only options are a raised line, the frozen n cut (both classes' n scaled by one factor that fits the approved total, rounded down to whole units, every arm and class kept, MDDs restated), or stopping.
- Discordance restates the MDDs; it changes nothing else.
- A true full-size flag sends the full-size option (O 150, B 80) to the Captain, who takes it to the owner; otherwise stage 2 runs at core size.
Stage 1 results are never pooled into the confirmatory analysis.

**Stage 2: confirmatory run.** The section 5 and 6 draws to the approved n, every arm, one session per unit and arm, in a seeded order (order_seed) that interleaves arms within each unit so time-of-day and provider drift hit every arm alike. Analysis by section 9 with the frozen script. Then the sealed stage 1 file is opened and its digest checked.

**Conditional stage: Sol and particle-1 (comes back to the Captain).** They are deferred, not dropped: the approved program is Opus only, every pack targets Claude Code first, and running Opus first prices the other two on measured pack costs instead of guesses. After the Opus results, a costed proposal: GPT-6.1 Sol through each pack's own Codex install for the packs whose README supports Codex (gstack, Superpowers, agent-skills, GSD, tstack; pstack's README has no Codex install), and particle-1 through the rig's existing Claude Code route on every arm, on the O units, priced with the crew's measured cost ratios (Sol 0.6 and particle-1 0.4 of Opus). It runs only on the Captain's go and its own approved caps.

### 12. Fairness and publication

- Published: the harness; the arms file with every pin, install recipe, frozen CLAUDE.md text and entry prefix; the unit lists with image digests; the frozen scripts; and for every session its diff, score record, cost, exposure markers and a tool-event summary (tools called, skills launched, continuations), with each repository's licence and notice beside its diffs. Full transcripts are not published: they quote issue text, repository code and pack skill bodies under mixed terms. B1 problem statements are published by issue URL and digest, not as text. Everything published passes a secret scan and a personal-data scan (emails, names in stack traces). The pstack-checks eval published no repository code; this one publishes diffs of permissively licensed code with their notices, because pack authors need to see what each arm changed.
- Images are not published (Claude Code is proprietary and the images' dependency licences are unreviewed); the rerun path rebuilds them from the frozen recipes and runs the oracle on its rebuild.
- The rerun command, `bin/gstack-evals h2h rerun --arm <arm> --units <file> --spend-cap <usd> [--dry-run]`, runs any arm on any unit list. Prerequisites: an Anthropic key, Docker, network for installs and image builds, and room under Docker Hub's limit of 100 pulls an hour. --dry-run prints the projected cost and runs nothing paid. Exit codes: 0 done, 2 usage, 3 a refused precondition, 10 a cap stop, 12 a containment halt. Every new drop, gap and stop has a reason code in src/errors/codes.ts whose line says what failed, the fix, whether a retry is safe, and its docs anchor.
- Before anything is posted, another Captain's crew reruns the numbers: it recomputes every primary and secondary figure from the published records with the published script and re-scores a seeded 10% of session trees in fresh containers. A mismatch blocks posting until it is explained.
- Every finding states that gstack is Garry Tan's own project and that his team ran this eval, in its setup and in its closing Disclosures, and names every pack and author plainly. No pack author is contacted at any point.
- gstack is frozen at its pin for the whole eval; changes the data suggests wait for a later wave.
- The results page leads with two or three plain takeaways, then the 12-contrast table with one row per pack (difference, interval, MDD at the measured discordance, the pack's procedure rate, the row state), then what didn't work, then the mechanics. Each pack gets a short section with its pin, entry, the stop points it met, its continuations and its rerun command.

### 13. Power and MDD

From the attached power.py: exact two-sided McNemar test, 80% power, design effect 1.2 for up to 3 units a repository (the cluster-aware test of section 9 carries the same correction), at the strictest Holm step (alpha 0.05/12) and at alpha 0.05 (the last step). Discordant share is the fraction of units where the two arms disagree; stage 1 measures it. MDDs are in percentage points of the verified-correct rate.

| Class, n | Discordant 0.2 | 0.3 | 0.4 |
|---|---|---|---|
| O, 100 (core, approved) | 18 (14 at 0.05) | 22 (18) | 26 (21) |
| O, 150 (full, not approved) | 15 (12) | 18 (15) | 22 (17) |
| B, 60 (core, approved) | none fits (18) | 28 (22) | 33 (26) |
| B, 80 (full, not approved) | 19 (16) | 25 (19) | 28 (23) |

These are large. Prior evidence (gstack's +3 and +2.4 nulls, /investigate's +2.8) puts most true differences well under them, so the likely result is "no difference shown" for most contrasts, each with an interval that rules out gains larger than about the MDD. That still answers the public question (no pack makes a large difference on these tasks), and any pack that does win stands out. The owner kept this direction after review. The B1 and B2 strata alone are descriptive.

Piece G: with about 50 units both arms fix, a 30% difference in lines changed is detectable if the log-ratio standard deviation is 0.9; stage 1 measures it. ponystack claims 62 to 82%.

### 14. Money

Every dollar figure is in Agent notes (A2 to A5). The rules: planning prices are replaced by stage 1's measured costs. Each item gets a ledger item and a cap the Captain records in the approvals record before its first lease. Model items are capped at 1.35 times central, which carries a full retry for about a third of sessions, not one for every session. Stage 1 re-prices every stage 2 item under section 11's COST rule. A cap stop ends that part incomplete and is never retried to change a verdict. The reserve moves only on the Captain's word for a named repair. Crew model use (planning, build, this post's review, runs, results and their review) is its own ledger item with a stop that comes to the Captain, counted from the thread counters and reported in every report, overruns included.

### 15. Build, pins, dry run and stops

What gets built, on one branch, merged with this preregistration (two merged pull requests: this one and the results):
1. Arms: the 9 install recipes run in throwaway containers, pinned and hashed, with the two marketplace deviations and the frozen CLAUDE.md text; every pack's browser runtime; the entry, question-reply and continuation turns and the DONE rule in the rig driver; CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4; the frozen exposure detectors.
2. O: the exclusion list and the licence filter, then the draw with the bug or feature tag, on the existing state machines conversion.
3. B: the advisory and pull-request miners (one frozen run on the freeze date, outputs frozen as files), the per-ecosystem image recipes, the test-command and report-parser rules (TRX included), the image store by digest, the 5+5 browser oracle, the browser launcher wrapper and the hardened runner's browser conditions, and the label step.
4. Scoring additions: the main-checkout rule, nested-worktree exclusion and worktree secondary, the drop of arm files at new hidden-test paths, and the new-test reading.
5. Analysis: the 12-contrast family with the cluster-aware test and Holm, the clustered bootstrap, row states, the secondaries, piece G's family, the sealed stage 1 readout and the full-size flag, all keyless and tested on fixtures.
6. The rerun command and its reason codes; prereg.json with the seeds, the exclusion list, the licence list and the release list; terms.md.

Before any paid call, each of these runs and passes:
- Every gate that can drop a unit (licence, exclusion list, told-mode screen, image build, test discovery and report parsers, oracle, browser-engine check, label agreement, containment) on planted known-good and known-bad cases, and a keyless check that a unit obeying every rule passes every gate.
- Planted session cases: the DONE variants ("DONE.", "**DONE**", DONE in a code fence, DONE followed by a GSTACK_RESULT line, no DONE) and the cap of 6; work left in a linked worktree or on another branch; a nested worktree directory; an arm test file at a new hidden-test path; an arm's new test that fails, scored both ways; per-arm containment with a planted leak in a pack's node_modules; 5 and 21 concurrent calls at the byte fallback, with refusals counted apart from allowance stops; each installed tree against its pin; the exclusion list applied before the draw.
- Analysis cases: a clustered fixture where exact McNemar and the cluster-aware test disagree; every row state; a sealed readout that releases only the listed figures.
- The dry run opens and settles one ledger lease per frozen item on a temporary ledger; stage 0's driven launch and no-model preflight pass.

Runs execute detached on a dedicated runner VM that stays awake for the run, never on a Capy machine. Every VM is destroyed when its stage ends, after the export manifest is checked.

### 16. Outside terms, licences and public safety

terms.md, attached, records the terms each part runs under. Every pack is MIT (pstack's licence is in pstack/; ponystack's licence file is MIT though GitHub's field is unset). Claude Code and the Agent SDK are used under Anthropic's terms for evaluation and are proprietary, so no published image or bundle contains them. GPT-6 Astra's labels run under OpenAI's terms. GitHub's terms cover the API mining, and issue text, which has no licence of its own, is published by link and digest only. SWE-bench-Live is MIT as a dataset; units come only from repositories on the permissive list, and each repository's licence and notice ship with its diffs. Advisory texts are CC-BY-4.0, attributed per unit. Ubicloud hosts the runs. No sealed material: every unit is a public row or a public commit, nothing is tuned on them, and the drawn ids are committed with the results. Provider safety-filter stops on security units are reported as their own outcome. Disclosures: gstack is Garry Tan's own project, in every finding. The disclosure check for Cursor and Lauren Tan on 2026-11-09 found no tie; the same check (the YC directory and public profiles) runs for Theo Browne, Jesse Vincent, Addy Osmani, Open GSD and Aianback before any post, and what was checked is recorded. A post that features the Astra labels carries OpenAI's line, and the conditional stage carries OpenAI's and Particle's lines. openclaw repositories are excluded, so no OpenClaw line is needed.

### 17. Risks, limits and not in scope

- Power: section 13. Most contrasts will likely read "no difference shown".
- Construct: single-session fixes on someone else's repository. Packs built for long projects (GSD), planning (Superpowers' brainstorming, gstack's /autoplan) or pull-request lifecycles (tstack) are measured only on what they do inside one fix; their other claims are untested here and no cut verdict rests on this design for them.
- Documented steps that cannot run offline here: tstack's sol-loop (its skill says to report the blocker when no route runs Sol), file-pr and babysit-pr; pstack's cursor-team-kit skills (/deslop, control-cli, control-ui), which poteto-mode calls and the Claude marketplace lacks; gstack's update check and GitHub steps; Superpowers' brainstorming route, which T's "Fix this issue" wording may never trigger on feature units. Each runs as published and degrades as it would offline, and section 8's 80% rule decides how its contrasts are read.
- Languages: no Python units (section 5).
- Contamination: March to June 2026 units may sit inside Opus 5.5's training data; the July-onward stratum is reported on its own, and contamination should lift every arm alike.
- The sealed pilot means COST and the full-size flag are decided without per-arm outcomes. That is the point.
- B supply may fall short, and the per-ecosystem image recipes' success rate is unmeasured; the fallbacks in section 6 say what happens, and B1 can end infeasible.
- Not in scope: changing gstack, contacting pack authors, posting, pull requests to other repositories, multi-session claims, judged secondaries.

### 18. Changes after review

The review's seven High findings, taken at the gate: gstack's unattended setting dropped and one approval-worded question reply and continuation for every arm, capped at 6 (sections 3 and 4); class-blind breadth entries with /qa as a secondary arm and every pack's browser runtime provisioned (sections 3, 4 and 6); the exclusion list (section 5); one exposure rule for every arm and gstack's bug-unit exposure frozen as the installed pack (section 8); frozen stage 1 responses with sealed per-arm outcomes (section 11); identical browser conditions in sessions and scoring (sections 3 and 6); crew use as a capped ledger item priced at three times plan, with the source of the no-skills price named and a sensitivity row (section 14, Agent notes). Mediums and Lows folded in: the cluster-aware verdict test and the defined row states and thresholds (sections 9 and 10); the scoring rules for worktrees, arm test files at hidden-test paths and new tests (section 7); the DONE rule (section 4); one subagent concurrency for every arm and reservation-bound refusals counted apart (section 3); tighter pins (section 2); images kept by digest (section 6); publication rights, terms.md and MPL-2.0 out (sections 5, 12 and 16); a 4-unit stage 0 (section 11); the reason for deferring Sol and particle-1 (section 11); containment over every arm's home (section 3); piece G's framing (section 10); the rerun command and reason codes (section 12); the stage 1 month mix (section 5); report parsers and keyless image builds (section 6); the disclosure checks (section 16); the languages (section 5); the pack names as their authors write them. The direction, 12 contrasts under one Holm family at the stated MDDs, was the owner's call to keep. One change from the gate's wording: the sealed stage 1 file's digest goes in the stage 1 run record and the results, since a merged prereg.json cannot take a later value; prereg.json freezes the procedure and the release list.

## Review record

One lean /autoplan run (autoplan-20261115024303, kind feature) with one Claude Opus 5.5 reviewer reading the plan and the planning evidence: 28 findings (7 High, 14 Medium, 6 Low, 1 Informational), with one challenge to the direction. The gate (revision 1, nine items) went to the project owner, who took every recommendation on 2026-11-15: keep the direction, apply all seven High fixes, approve with those changes. Section 18 lists what was folded in.

## Disclosures

gstack is Garry Tan's own project, and his team runs this eval.

## Agent notes

<details>
<summary>Money and allowances (internal; the figures behind sections 3, 11 and 14)</summary>

**A1. Session allowance.** $25 a session on Opus 5.5, for every arm, inside 5,400 seconds and 300 turns. At the proxy's byte fallback one Opus call at a 200k-token context reserves about $4.15, so 5 calls in flight reserve about $20.75; 21 would need about $87.

**A2. Items at planning prices (core, approved).** No skills on Opus: $0.80 a session, the state machines eval's told-fix follow-on sessions (mean $0.80, 95th percentile $4.82, n = 45). Those ran under a $6 allowance with no continuation turns, so this price may be low (A3). Pack multipliers until stage 1 measures them: gstack 1.7 (the stacks eval measured 1.5 to 1.9), Superpowers 2.5, agent-skills 2.0, GSD 3.5, pstack 2.0, tstack 1.3, gstack plus ponystack 1.9, gstack plus one line 1.7, gstack /qa 1.7. B sessions cost 1.5 times O. So one O unit across the 7 primary arms is $11.20, piece G's two arms $2.88, one B unit $16.80 and one /qa session $2.04. Prices from src/runner/pricing/prices.ts. Session VMs about $0.10 each.

| Item | What | Central | Cap |
|---|---|---|---|
| h2h-smoke | stage 0: 33 Opus sessions on 4 units, plus up to 11 repair reruns | $85 | $115 |
| h2h-pilot | stage 1: 12 O and 12 B units, 7 arms; piece G on O; /qa on 6 B1 units | $383 | $517 |
| h2h-opus | stage 2: 100 O and 60 B units, 7 arms | $2,128 | $2,873 |
| h2h-qa | stage 2: gstack /qa on about 30 B1 units | $61 | $83 |
| h2h-pony | stage 2: piece G's two arms on 100 O units | $288 | $389 |
| h2h-labels | B1 browser-only labels, Astra and Opus, about 100 units | $40 | $54 |
| h2h-vms | image builds and the image store, oracle, session VMs, the runner host | $480 | $650 |
| h2h-reserve | released only by the Captain, for a named repair | | $200 |
| h2h-crew | Capy model use: planning, build, this post's review, runs, results and their review | $1,300 | ledger stop at $2,000, which comes to the Captain; $3,900 (3 times plan, the pstack-checks precedent) in the total at caps |
| h2h-rerun | another crew recomputes the numbers and re-scores 10% | $70 | $100 |
| **Total** | | **$4,835** | **$8,881** |

The approved line is about $4,800 central and $8,900 at caps.

**A3. Sensitivity.** At $1.50 a no-skills session (every model item scaled by 1.875), the program is about $7,400 central and about $12,400 at caps. Stage 1's measured costs replace these guesses before stage 2, and a re-priced program above $8,900 at caps goes to the Captain and the owner before any stage 2 lease.

**A4. Crew use and the weekly ceiling.** Crew use falls on Capy's meter and counts against gstack-evals' weekly share under the factory's spend ceiling; the Captain schedules the build and the runs inside it. Every report carries the thread's own counter.

**A5. Conditional stage (not in the total).** Sol on 6 arms and particle-1 on 7 arms, O n = 100, at the crew's measured ratios (Sol 0.6, particle-1 0.4 of Opus): about $576 and $448, so about $1,020 in model use, plus about $80 of VMs and $300 of crew use: about $1,400 central.

</details>
