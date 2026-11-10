---
id: 2026-11-09-geva-487-pstack-checks-prereg
kind: plan
title: "Preregistration: do the checks pstack's formal-verification chain leaves behind catch real bugs? Scored by rerunning each check on the code before and after a real fix"
summary: "Given a real state bug's report, does the check each arm leaves fail before the real fix, pass after it and survive a harmless edit? pstack against its steps in plain words and a plain test request."
author: GEVA-487
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: open
links:
  - 2026-11-09-geva-409-state-machines-prompt-prereg
  - 2026-11-01-geva-89-stacks-round-1-amendment
  - https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/harness/pstack/claude-code
attachments:
  - 034966df5e34d17c51b2d0816e6556fe34fa9782b05e8edb95149e2d8be68bd7  power.py
  - 479b40471e78bf7bae69afb82e3cbfe803d1d9afd032a286257984b58fc917ff  power.txt
  - 28dc58efec55ef0b252473a0be169051a6cf19b21f9770c25ebfc227ba02b4ab  prereg.json
  - 8a41d64c2234a033635cd120e2d17e2343d9b14ac417a284c0a8ea7cb358a93e  supply-count.md
  - e34c88608ff13a5ed586a1de914cd286149848e6761f25777e3f6bfb6bcb9504  supply-count.py
  - 0ca93a27785b6ab915b34a60b301979a7d421f9442e1c32c29fae02bb62ae87d  terms.md
---

# Preregistration: do the checks pstack's formal-verification chain leaves behind catch real bugs?

## Approval

Gate 1 of this plan's /autoplan run approved it on 2026-11-09 with every recommendation taken, and this revision applies them (Review record). No paid call runs until this preregistration merges and the Captain records each item's cap. The draw, bootstrap and order seeds in the attached prereg.json were minted once on 2026-11-09, before any draw or label call.


## ELI5

pstack is Lauren Tan's skill pack. Two of its skills work as a chain: one writes a formal model of how some code moves between states and leaves a reusable "verify" skill with one command to rerun it, and the other draws the model as a chart and tells the agent to replay each bug the model finds against the real code. Our try-out on three repositories found that the chain does find real bugs, but so does the same request written in plain words: the bugs come from the instruction to use a model checker, not from pstack's skill text. What pstack's text changed was the process: it replayed every bug on the real code and left a check behind. So this test asks the question that matters for that process: when the chain leaves a check behind, does that check actually catch a real bug in the code? We take real lifecycle and state bugs that open-source projects fixed from 2025 to July 2026. For each one, the agent gets the code from just before the fix and the original bug report, never the fix. Three agents work on it: one with pstack loaded, one with the same steps in plain words and no skills, and one with a plain "write a test that catches this bug". Then a machine reruns every check the agent left, on the code before the fix and on the code with the real fix applied. A check counts only if it fails before the fix, passes after it, and still fails when we make a harmless edit to the same files. No judge decides anything.

## Before → after

Before: one try-out, one run per repository and arm, on three repositories we own. It found that the chain's bugs come from the model-checker instruction, that most of its checks could not see a break in the code because a hand-written model has no link to the code, and that the only checks that caught code breaks were the ones tied to the code (a conformance pass, mutants that run real tests, a table generated from the code). Nothing has measured whether those checks catch a real bug that someone else found and fixed.

After: a frozen test on about 25 to 30 real, held-out lifecycle and state bug fixes from public projects, on Opus 5.5, GPT-6.1 Sol and particle-1. It reports, for each arm and model, how often the agent's left-behind check catches the real bug and tracks the real fix, with 95% intervals, and three paired contrasts: pstack against the plain test request, pstack against its own steps in plain words, and the plain-words model checker against the plain test request. A small admission run comes first and can stop the test cheaply. It ends in a finding file and a clear input for which pstack idea, if any, gstack should adopt.

## Why it matters

Formal verification skills are spreading, and their promise is a check that the next agent can rerun. If the check sits in a model that cannot see the code, it passes or fails the same way after the bug is fixed, and a builder trusts a signal that tracks nothing. If pstack's replay step is what turns a model's finding into a check that tracks the code, that is a cheap idea gstack can adopt. If a plain "write a test that catches this bug" leaves a better check, builders should know that too. The public lesson this experiment is after: when an agent model-checks a real bug, does the check it leaves catch the bug in the code, or only in the model?

## What caused this work

The owner approved its own eval line for pstack's chain on 2026-11-09, scored by whether the generated check fails on the commit just before a real merged lifecycle-bug fix and passes on the fix, with a no-gstack arm. The Captain asked for a preregistration that reuses the state machines eval's unit frame and its base-versus-fix oracle, guards against degenerate checks, tests the three models under test where the harness allows, and states plainly if the line cannot power all of them.

## Big decisions

1. **What the agent is told (A).** Options: (1) the real bug report, the code before the fix and nothing else; (2) no bug report, only a folder to look in, which is the try-out's setting; (3) both, one per stage. Recommendation (1). With no report, a session has to find the one bug the project later fixed among everything in the folder, then leave a check tied to the code. From the try-out's numbers (about 1.3 verified bugs a session on whole repositories, about half of checks tied to code) that is likely a floor near a few percent, which no affordable sample can measure. Told, the test measures exactly the step pstack's text changes (turning a finding into a code-tied check), with room in every arm. What would flip it: the owner wanting the discovery claim measured even at a likely floor.
2. **A blind probe (B).** Options: (1) pstack only, blind, on the 8 admission units, reported as a rate with its interval and deciding nothing; (2) pstack and the plain arm blind; (3) none. Recommendation (1), run last and only if its cap still fits inside the line after admission re-prices every item.
3. **Models and sample (C).** All three models, with the pooled-over-models contrasts as the confirmatory verdicts and per-model contrasts reported with their intervals. At planning prices the caps fit n = 29 on all three models, and the supply the state machines harness converts gives about 25 to 30 units, so n = 28 is the planning point. By exact McNemar simulation the MDD is 16 to 25 points pooled and 37 to 43 points per model there. If admission finds fewer than 30 usable units at real prices, the Captain sees the count, the prices and the MDD before any test session.
4. **Money (D).** One line with crew use included and every reserve inside it, priced from the try-out's measured tokens (section 13, internal). Admission re-prices every model item before the test run.

## Implementation plan

### 1. Claim and construct fit

**Claim under test.** pstack's /create-formal-verification-skill and /statechart chain, given a real lifecycle or state bug, leaves behind a check that catches the bug in the real code and tracks the real fix: it fails on the code before the fix and passes once the fix is applied.

**Why this claim.** The try-out (one run per repository and arm, three of the owner's repositories, Opus 5.5, blind verification) found:

- The chain found 5 verified bugs with pstack loaded and 3 with the same two steps in plain words. With one run per cell that difference is noise, and the model checker found 4 of the 8 new bugs.
- pstack's text changed the process: every counterexample was replayed on the real code, no product code changed, and each run left a project-local verify skill with a coverage record and a sync commit.
- Most generated checks could not fail on a real code break, because a hand-written model has no path from the code. Only checks tied to the code passed that test: an existing mutant runner that runs code tests, conformance passes on a real engine, and a generated table with a bot test.

pstack's own skill text supports this score. create-formal-verification-skill asks for checks that are "Able to fail" on a broken variant of the code, says "Findings stay findings" (when the current code breaks the property, report it and do not weaken the model or change product code), and asks the agent to confirm the check is "passing, or failing only on the findings you will report". statechart's hand-off says to replay each bug path against the real code as a test or a live repro. So a pstack check that found the real bug should be red on the code before the fix. Whether it turns green on the fixed code is the open question: a model-only check stays red after the fix because the model cannot see the code, and a replay test tied to the code should turn green. That is the construct this test measures.

**What the score covers.**

- "Catches the bug": the check fails on the parent of the real fix in all three runs.
- "In the real code, tracking the fix": the same check passes on the parent plus the real fix in all three runs.
- "Not a change detector": the same check still fails in all three runs on the parent plus a harmless edit to the files the fix changed.
- "Leaves a check you can rerun": the check is a command listed by the agent that runs from the repository root, offline, in a fresh container.

**What the score cannot see.** Bugs other than the one the project fixed; whether a model-only finding names the right bug; checks that need a person to update a model after each change, which pstack's skill expects ("Kept in step with the code") but which a mechanical rerun cannot do. Each has a keyless secondary (section 9).

### 2. Units

**Pool.** The state machines eval's pinned sources and frame (its preregistration, section 3), as its harness converts them at this build's pin: SWE-bench-Live MultiLang at the Hugging Face revision that eval pins (eb09c2e5). That harness does not convert the SWE-rebench part or SWE-bench-Live's Python set, so neither is in this pool and Python is not a scored language. Tasks created 2025-01-01 to 2026-07-31; bug-like; the fix changes 1 to 6 non-test source files; at least one fail-to-pass and one pass-to-pass test; a container image pinned by digest.

**State-shaped only.** A unit is eligible only when both of that eval's cross-family labellers (GPT-6 Astra and Opus 5.5) say defect and both say state-shaped under its frozen eight-class definition (status or flag not reset; validate after mutate; a transition from a wrong state; a handler that is not idempotent; stale state; order and lifecycle errors, races included; resumption; a step that handles only one of two crossed state changes). Unclear units are out. Its label records are reused read-only where they cover a candidate. Candidates it never labelled are labelled with its labeller code under this line's item pf-labels, with the same two models and questions, and agreement is reported. That eval has labelled nothing yet, so at freeze every candidate needs labels; if its labels exist when this line labels, they are read first and only the rest are bought.

**Told-mode screen (keyless).** The issue text exists and is at least 200 characters. It holds no diff block (no line starting with "@@", "+++ " or "--- ") and no two lines of 30 characters or more that the fix adds, verbatim. A unit that fails drops with its reason.

**Oracle.** That eval's oracle runs unchanged, its records reused where it already ran a candidate: three base runs and three fixed runs with the fix's tests applied, the fail-to-pass set (tests that fail on all three base runs and pass on all three fixed runs), the stable set, the stale-report and rebuild rules, the one-commit history and the leak scan. Its drop rules apply as written. Each unit's longest fixed-run wall time from the oracle record sets its entry timeout (section 6.5).

**Neutral tree (new).** For each unit, the neutral edit inserts one comment line at the top of each non-test source file the fix changes (after a shebang, encoding line or PHP opening tag, if any) and one at its end, in that language's line-comment syntax from a frozen table. It changes every changed file's bytes, hash, size and line numbers and nothing else. It is validated before any model run: on the neutral tree with the fix's tests applied, every fail-to-pass test must fail in all three runs, no run may stop, and every stable test must pass in each run that reports it and in at least one run. If not, the end-of-file line alone is tried and validated the same way; if that also fails, the unit drops with its reason.

**Draw.** At most 3 units a repository across admission, its raise and the test set. A draw seed (draw_seed in the attached prereg.json) was minted once from random bytes on 2026-11-09, before any draw or label call, and is never re-minted; bootstrap_seed and order_seed were minted with it. Order: one seededRandom(draw_seed) stream shuffles each month once (ids sorted first), months in the order the draw first walks them: March to June 2026, then July 2026, then February 2026 back to January 2025. Admission takes 8 units first, walking March, April, May and June 2026; a raise takes the next 8 in that order. The test set then walks newest first: July 2026 (after both frontier models' cutoffs), June, May, April, March, February and January 2026, then December 2025 back to January 2025, each month in its seeded order, until n units are kept; the next 10 in that order are the reserve, used only to replace units that drop before any model run. Each candidate is asked once; a unit that drops at labels, the oracle, the told screen or the neutral validation does not use its repository's slot. Admission and raise units never enter the test set. Overlap with the state machines eval's own draw is allowed and reported, since the arms and scores differ and neither eval tunes anything on the other's results.

**Strata, reported on their own.** July 2026 (after both frontier models' cutoffs), January to June 2026, and the pre-2026 units (May to August 2025 in practice), each with its rates and contrasts beside the full set. Descriptive.

**Sample.** A free count of the published files on 2026-11-09 (attached supply-count.md and supply-count.py, no model calls) finds 95 state-keyword candidates at 3 a repository in this pool from January 2025 (66 from March 2026, 29 in July 2026), before the labels, the oracle and the told screen. The state machines eval's own figures put keyword hits above true state-shaped labels, so about 25 to 35 units are likely to survive, less the 8 admission units. The final n is the largest n up to 60 that both the supply and the re-priced caps allow (section 13); at planning prices the caps fit n = 29 on all three models, and the money table is drawn at n = 28. If fewer than 30 usable units remain at real prices, the Captain sees the count, the measured prices and the restated MDD before any test session.

**Held out.** The units are public dataset rows. Nothing is tuned on them: the arm texts are frozen in this plan before any unit is drawn, the draw seed is frozen before the draw, and admission units stay out of the test set. So nothing here is sealed, and no plaintext custody applies. The drawn ids are committed with the results, with the dataset attributions.

### 3. What a session gets

Everything in the state machines eval's section 4 applies unchanged: a fresh container from the unit's image digest; the repository at the base commit with its history replaced by one commit; the leak scan; the fix's tests never present; no egress but the metering proxy, with Claude Code's WebSearch and WebFetch disallowed and the proxy refusing server-side web tools; Claude Code's own system prompt at the pinned version (the claude_code preset) with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1; Sol and particle-1 through that eval's proxy routes, provider pinned, no fallbacks; the strip of CLAUDE.md, CLAUDE.local.md and their imports, AGENTS.md and .claude/AGENTS.md at any depth and every .claude/ folder at any depth before arm setup, with the units that had them recorded; AskUserQuestion answered once with "No one is available to answer. Use your own judgment." in every arm.

Model settings, frozen here: every model runs at the pinned Claude Code's default effort. No effort flag, thinking budget or reasoning setting is passed by the harness or added by the proxy routes, the same in every arm. The driver's metering proxy records the effort and thinking fields of each session's first main request (its first request whose body carries a tools list). The dry run records them per model, and a session whose recorded fields differ from that record, or that has no recorded fields, is an infra gap. So no paid session reads its effort as unknown.

Added for this eval, identical in every arm:

- A read-only tools volume: a pinned Temurin JDK 21, tla2tools.jar 1.7.4 (the version and sha256 that pstack's statechart script pins), and a pinned bun, with TLA2TOOLS and JAVA set and bun on PATH. pstack's statechart script reads TLA2TOOLS and JAVA first, so it runs offline without mise. The plain-words arm needs a model checker too, and the plain arm gets the same volume unused, so the environment is the same everywhere.
- The pstack arm alone mounts pstack at the pin the try-out ran and this repository's stack arms pin (cursor/plugins c742dd61706fbacc1b95f1a20b7b988cf096ce6c, harness/pstack/claude-code tree cdbbd4ca5dd2f4ca0eef3294e7b981c0c610d4bb, plugin 0.15.36; cursor/plugins main was still this tree on 2026-11-09) as a Claude Code plugin directory, through the stack arms' installer (its own bootstrap runs in the image builder). Nothing from pstack is vendored.
- Every arm runs with no gstack, in containers on Ubicloud VMs that hold no gstack install and no drive path, so the plain arm is clean by construction; the read audit runs after the run and is reported.

### 4. Arms

Each session has two user turns: the task turn and the wrap-up turn. The task turn is the arm's text, then the bug report, then a suffix identical in every arm:

> Here is the bug report:
>
> {issue text}
>
> My app is the repository in this directory. Don't stop to ask.

- **P, pstack loaded:** "/create-formal-verification-skill model the state machine behind this bug report, and use /statechart to visualize the flow it breaks." This is the owner-shared line from the try-out, pointed at one bug instead of every subsystem. The task turn starts with the skill command so Claude Code expands the skill. pstack's own Claude Code adapter maps the later "/statechart" to reading that skill's file. If the pinned Claude Code does not resolve the short command name, the dry run switches both to the "/pstack:" names, which load the same files, and records it.
- **C, the same steps in plain words, no skills:** "Formally model the state machine behind this bug report with a model checker, and draw the flow it breaks as a statechart. When the model describes code, replay each bug path against the real code, as a test or a live repro, one step for each action." The last sentence is statechart's own hand-off step (its SKILL.md), so C carries every step of the chain, replay included, without pstack's skill text.
- **N, no gstack and no skills, a plain prompt:** "Write a test that catches the bug in this bug report."
- **Blind probe (admission only), pstack:** "/create-formal-verification-skill model the state machines in {scope}, one skill per subsystem, and use /statechart to visualize the most important flows." plus the suffix without the bug report. {scope} is the state machines eval's folder rule (the deepest directory holding every non-test source file the fix changed, widened until it holds at least 10 source files of the unit's language).

The wrap-up turn, identical in every arm, follows the task turn in the same session however the task turn ended:

> Last step. Write CHECKS.json at the repository root: a JSON array with one object for each check you left in this repository that someone can rerun. Each object has "name", "command" and "what_it_checks". "command" must run from the repository root with no network and run only that one check, so list a check that covers several properties or tests once per property or test. List only checks that are already in the repository. Don't write or change any other file.

Only CHECKS.json is kept from the wrap-up turn. Every other change made in it is discarded and counted.

Contrasts: P minus N is the head-to-head (pstack against a plain request with no skills). P minus C is the process contrast: with the replay step in both, it isolates pstack's skill text, which is the adoption question for gstack (adopt one line, or the whole skill). C minus N is the words contrast (asking for a model checker and a replay against asking for a test). P minus N alone cannot answer the adoption question, because N asks for exactly the scored artifact and P does not; it reads as the head-to-head only.

### 5. Session limits and how sessions end

- Task turn: wall 5,400 seconds and 250 turns for P and C, 3,600 seconds and 150 turns for N, and 5,400 seconds for the blind probe. Each session has a spend allowance per arm and model, frozen in section 13. If admission's 95th-percentile Opus session cost for an arm is above half its allowance, that arm's allowance doubles on every model before the test run, and the Captain sees the new projection first.
- Wrap-up turn: 300 seconds, 20 turns and its own allowance (section 13). If it reaches its time or turn limit with no valid CHECKS.json, the session scores 0, counted as "no manifest (wrap-up limit)". If an upstream error ends it, only the wrap-up turn reruns once, resuming the same session on the saved tree S; a second upstream end is a gap. If its slot is refused for the allowance (the proxy stops its requests at the wrap-up allowance, or the driver refuses its open for lack of room), the session is gap E_PF_WRAPUP_ALLOWANCE, with no rerun of the wrap-up turn and no retry of the session.
- A turn ends when the agent ends it and its background tasks are quiet (the rig's rule), or at a limit. Whatever the tree holds then is scored.
- **Completed** or **limit**: scored as is. A limit on the task turn still runs the wrap-up turn. An arm's own overruns count against it.
- **Upstream** (a provider or proxy error ended the task turn): one retry of the whole session from a fresh container; a second upstream end is a gap.
- **Infra** (the harness failed outside the model): one rerun; a second failure is a gap.
- **Tree-check refusal:** when the harness's check of the session tree and home refuses before the task turn (a file the strip rule removes, a gstack or drive path, or a history other than the one-commit base), the session is gap E_PF_ARM, with no retry. That refusal can depend on the arm, so it is counted per arm and model (section 6.8).
- A wrap-up turn that completes with no CHECKS.json, or one that is not a JSON array of objects each with a string "command", scores as no checks (0), counted per arm as "no manifest". That is the arm's own output, not a gap.

### 6. Scoring rules

**6.1 The session's tree.** Before the task turn the harness records every file under the repository root with its hash, ignored files included, leaving out a frozen list of build-output directories at any depth (target/, build/, out/, dist/, bin/, obj/, node_modules/, .venv/, venv/, __pycache__/, .gradle/, .pytest_cache/, .tox/, .mypy_cache/, .cache/, CMakeFiles/ and cmake-build-*/). At the end of the task turn it adds every new or changed path outside that list, ignored ones included (git add --force), and commits the tree as a "session end" commit with a fixed identity and date, so every state is a commit and any sync commit the agent recorded exists. Paths captured only because of the force are counted per arm. Call this tree S.

**6.2 The transplant.** T is S with every existing non-test source file restored to its base content, using the state machines eval's per-language test patterns and protected configuration list to tell test from source. Where unit tests live inside source files (Rust's #[cfg(test)] modules, and the other in-source test modules that eval's frozen per-language detector finds), the transplant works hunk by hunk in that file: the agent's hunks wholly inside a test module are kept as checks, and every other hunk goes back to base. A hunk the detector can't place wholly inside or outside a test module goes back to base, and such hunks are counted per arm. Everything else in S is kept: new files of any kind (models, specs, tests, scripts, project skills), edits to existing test files, and edits to build and test configuration. Deleted product files are restored. So a check runs against the real code, never against the agent's own product edits, and a check that only works on the agent's changed product code fails on every tree. Product edits are counted per arm (section 9).

**6.3 Three scoring trees, each committed on top of S's history with a fixed identity, date and message:**

- **Parent:** T.
- **Fix:** T plus the real fix's non-test hunks (the fix patch less its in-source test-module hunks, by that eval's detector), applied with git apply --3way. A conflict is a scoring gap for that session, counted per arm. A conflict can come from the arm's own in-source test hunks, so every verdict also prints the reading that scores these conflicts as misses.
- **Neutral:** T plus the unit's validated neutral edit.

**6.4 The manifest.** The entries of CHECKS.json, in listed order. An entry whose command is empty or not a string is skipped and counted. An entry counts only when both rules below hold; otherwise it scores as a non-catch and is counted per arm with its reason.

- **No inline program.** The command holds no -c or -e argument to an interpreter (bash, sh, zsh, python, python3, node, bun, deno, ruby, perl, php), no heredoc (<<), no here-string (<<<) and no process substitution (<( or >( ). A check written in the wrap-up turn could hide there, and only CHECKS.json is kept from that turn.
- **Names something in T.** A token of the command (split on whitespace, quotes, =, :, comma, # and /) is the path or basename of a file that is new or edited in T against base, or a test name in T: the basename or stem of a test file in T by the per-language patterns, or an identifier of 4 characters or more that is a whole word in a new or edited test file of T.

Counted entries run in two groups, each in listed order: first every entry that names no model file, then the entries that name a model file (extensions on a frozen list: .tla, .cfg, .pcal, .als, .pml, .smv, .qnt). At most the first 25 counted entries run; the rest are counted as beyond the cap and score as non-catches.

**6.5 Runs.** Each run is one fresh container from the unit's image digest with the same tools volume (and, for P, the same pstack plugin directory) as the session, no egress and the frozen environment. It runs the unit's frozen rebuild command first (the state machines eval's, as its oracle runs it) with the files the agent added moved out of the tree, moves them back byte for byte, then runs the entry's command with bash -c from the repository root. An agent edit to one of the unit's existing test files stays in place, so the rebuild sees it. The entry's timeout is 3 times the unit's longest fixed oracle run, at least 300 and at most 1,800 seconds; the rebuild has the oracle's own limit. **Pass** is exit status 0 within the timeout. **Fail** is anything else: a non-zero exit, a timeout, or a kill. A hang counts as a fail, so a check that hangs on a deadlock before the fix and passes after it counts. A rebuild that exits non-zero on the fix tree is a scoring gap for that entry (rebuild failed on fix), counted per arm, and every verdict also prints the reading that scores it as a miss. On the parent and neutral trees a failed rebuild is recorded and the entry's own result counts, since there a failure can only help an entry that must fail. For a unit the oracle marked rebuild-exempt under that eval's rule, the rebuild's exit status is recorded and ignored on every tree.

**6.6 The catch rule.** An entry catches when it fails in all three parent runs, passes in all three fix runs, and fails in all three neutral runs. A unit scores 1 for an arm when at least one of that session's entries catches, and 0 otherwise.

**6.7 Order, parallel runs and early stops.** Parent run 1 for every counted entry, then parent runs 2 and 3 for every entry that failed run 1 (so the red-on-parent secondary is exact), then fix runs 1 to 3 and neutral runs 1 to 3 for entries still able to catch; an entry leaves at its first result that rules it out. Up to 4 runs go at once, each in its own container. A session's scoring has a ceiling of 3 hours of wall time. Entries and runs the ceiling leaves unreached score as non-catches, because the arm chose how many checks to list and how slow they are, and they are counted per arm. Each run records when it started, its whole call time (the tree copy included) and its rebuild time, and each entry records its wait for a slot and its waits at the phase barriers, so the ceiling's effect can be read per session. No score depends on them. Each entry runs its steps in a phase one after another, so one entry that times out on the parent and neutral trees starts its last neutral run no earlier than 5T + 8R, where T is the unit's entry timeout and R its run overhead (the tree copy, the container's start and the rebuild). The analysis flags a unit when 5T + 8R >= 10,800 s, with R the median over the unit's sessions of each session's median run overhead: such a unit can't score a hang check inside the ceiling even with no other entry, and section 12 reads the result without it.

**6.8 Gaps.** Gaps are for harness causes: upstream, infra, fix-merge conflict and rebuild failed on fix, each counted per arm and cell. Two more can depend on the arm: a tree-check refusal (E_PF_ARM) and a wrap-up turn refused for its allowance (E_PF_WRAPUP_ALLOWANCE), both from section 5, and every verdict prints both counts per arm and model. A unit with a gap in either arm of a contrast leaves that contrast. A cell with gaps on more than 10% of its units is incomplete and gets no verdict. Every verdict also prints the worst-case reading that scores each arm's gaps as 0, the reading that scores fix-merge conflicts and fix-tree rebuild failures as misses, and the reading that scores tree-check refusals as misses for the arm that produced them.

### 7. Attacks on the scoring, answered before code

| Attack | Answer |
|---|---|
| A check that always fails | It must pass in all three fix runs |
| A check that always passes | It must fail in all three parent runs |
| A check that pins the current behavior (a golden, a snapshot, a characterization test) | It passes on the parent, so it can't catch; a strict snapshot also fails on the fix |
| A change detector (file hash, size, line count, "file changed since base") | It passes on the neutral tree, which must fail |
| A check that reads git state (a sync commit, a diff since base) | Every scoring tree has the same history shape on top of S, so only content differs; a "changed since" gate passes on the neutral tree and is ruled out |
| A flaky check | Three runs on each tree, every one consistent |
| One check covers several properties, and the real fix clears only one | The wrap-up turn asks for one entry per property or test, each with its own command; a combined entry that stays red counts against the arm |
| pstack's model cannot see the fix, so its model check stays red | Scored as it runs: a model-only entry can't catch. Its replay test, listed as its own entry, can. Model-only red entries are reported (section 9) |
| The check depends on the agent's own product edits | Product edits are restored before scoring, so it fails on every tree |
| The check is a Rust test written inside the product file | Hunks wholly inside an in-source test module are kept; only the product hunks go back to base; mixed hunks are counted |
| The check lives outside the repository or needs tools installed during the session | Scoring runs in a fresh container with the same tools volume; such a check fails and is counted as not runnable |
| The check needs the network | Scoring is offline, as the session was |
| The wrap-up turn writes new checks | Only CHECKS.json is kept from it; a command holding an inline program (-c, -e, a heredoc, process substitution) or naming nothing new in T is a non-catch, counted |
| A manifest with dozens of entries | At most 25 counted entries run, entries naming no model file first; entries beyond the cap or left unreached by the ceiling are non-catches, counted per arm |
| The agent sees the fix | One-commit history, leak scan, no egress, web tools off |
| The bug report contains the fix | The told-mode screen drops reports with a diff block or two verbatim lines the fix adds |
| The real fix renames something the check uses | The check fails on the fix and scores 0; compiler and import errors naming such an identifier are counted as drift |
| The fix conflicts with the check's files | Three-way merge; a conflict is a gap, and the reading that scores it as a miss prints beside every verdict |
| A check greps the buggy line's exact text | It passes the guards and counts as a catch: it names the bug without seeing the fix. Entries whose command reads source text with grep, rg, sed or awk, and new test files that open a product source path as text, are counted as static-text entries, and a sensitivity reading leaves them out |
| A check that asserts only "the output is not what it is now" | It would pass on a wrong fix too. No generic control catches it; it is listed as a limit, and the plain arm and pstack face it alike |
| Output from one run leaks into the next | Every run is a fresh container |
| Prebuilt artifacts from the base tree (a CMake build directory, an installed package, a compiled target) | The unit's rebuild command runs before every entry run on every tree; a fix-tree rebuild failure is a gap with a miss reading beside it |
| The agent's files sit in a gitignored directory | The session-end commit adds ignored paths outside the frozen build-output list; force-captured paths are counted |
| A test calls an identifier the real fix happens to add (an API guess) | It can catch, red on the parent only from the missing identifier. Such catches are classified, and the catch rate prints with and without them |
| One broken agent test fails every entry in its compile unit | A compile failure in an agent-added file the entry doesn't name is recorded as compile-blocked, and the entry reruns once without the other agent-added files of that unit, as a separate reading |
| pstack's sync gate wraps a replay test and fails on the changed fix tree | Scored as it runs; such entries are detected and reported as a P secondary and in the R48 cycle |
| A race test that fails only some of the time | Three for three on each tree, so a probabilistic race test misses; stated as a limit |
| Provider drift over the run | Every arm of a unit runs in the same part, in an order seeded by order_seed |

### 8. Exposure (R48's procedure gate)

- **P loaded:** the task turn's transcript holds create-formal-verification-skill's body (its "# Create a formal verification skill" heading), and a Read of statechart's SKILL.md appears. Keyless.
- **P and C ran a model checker:** a Bash call that runs TLC (tlc2.TLC, tla2tools.jar, or statechart's script) or another checker on a frozen pattern list.
- **P's own procedure:** T holds a new SKILL.md with frontmatter under .claude/skills/.
- **Any arm left a code test:** T holds a new or edited test file by the per-language patterns.

Exposure rates print beside every verdict. The process contrast (P minus C) reads as a fair test of pstack's text when P loaded the skill and ran a checker in at least 75% of its sessions (6 of 8 in admission); otherwise it reads "pstack as the model ran it", with the rate.

### 9. Secondaries (keyless, descriptive)

- **Red on parent:** at least one entry failed all three parent runs.
- **Model-only red:** an entry whose command runs a model checker failed all three parent runs and its first fix run.
- **Aimed:** a new or edited file in T names the path or basename of a file the fix changed.
- **Breaks:** the unit's stable set run on T (the check files added, product code unchanged); a stable test is a break when two of three runs stop or report it failed, or when no run reports it passed, counted per arm. A test a run's parser loses counts neither way. The try-out saw pstack's project skills trip an installer's prune tests.
- **Product edits:** S changed an existing non-test source file. pstack's text forbids it.
- **Entries:** listed, counted, inline (non-catch), naming nothing in T (non-catch), beyond the cap, unreached by the ceiling, run, not runnable (exit 126 or 127), timeouts, static-text entries, and the share of entries that catch.
- **Static-text sensitivity:** the catch rate with static-text entries left out (commands that read source with grep, rg, sed or awk, and new test files that open a product source path as text).
- **API guess:** catching entries whose parent failures name an identifier absent on the parent and present on the fix (the drift detector reversed); the catch rate prints with and without them.
- **Compile-blocked:** an entry whose fix-run failure is a compile error located in an agent-added file it does not name reruns once (three fix runs, then three neutral runs) on a tree without the other agent-added files of that compile unit (the same Go package, Rust crate, or Maven or Gradle module). The catch rate with these reruns prints as a separate reading; the primary is unchanged.
- **Sync gate (P):** entries whose fix-run failure comes from a stale-sync message or a git diff check, as P's verify skill may record. Reported as a P secondary and in the R48 cycle.
- **Capture and rebuild:** force-captured paths per arm (section 6.1), and rebuild failures per tree.
- **Drift:** an entry failed on the fix with a compiler or import error naming an identifier present on the parent and absent on the fix (the state machines eval's detector).
- **Cost, turns and wall time** per session, and cost per catch.
- **Questions asked** per arm.

### 10. Admission (E1), before the test run

Data in hand cannot place the rates: the try-out had no held-out bug, and the state machines eval has not run. So admission is a small pilot on the 8 admission units, Opus 5.5:

- P, C and N told, once each (24 sessions).
- A price probe: P, C and N told on 2 of the 8 units on Sol and on particle-1 (12 sessions), for cost only.

Readings, frozen:

- **FLOOR:** no told arm catches on 2 or more of the 8 units. One raise (R61): every arm's bug report gains a line naming the files the fix changed, checked on 8 fresh admission units drawn by the same rule. If that also reads FLOOR, the test stops and is reported as a finding: none of the three leaves a check that catches a reported real bug at a rate we can measure.
- **Contrast floor:** when both arms of a verdict contrast catch on at most 1 of the 8, that contrast is declared floor-bound before the test run. It still runs and is reported, and a null on it reads FIX-METHOD under R48.
- **CEILING for the plain arm:** N catches on 7 or more of the 8. One raise: the bug report is cut to its title and first paragraph, and P, C and N run on the same 8 units with the cut report (24 sessions). The cut report is used for every arm and model in the test run if N then catches on 6 or fewer and neither P nor C catches on 1 or fewer with it. Otherwise the test runs with the full report, and the Opus head-to-head can only read HURTS or NO MEASURABLE DIFFERENCE, stated as ceiling-bound.
- **EXPOSURE:** a harness defect kept pstack from reaching P in any admission session: the skill body did not arrive, the plugin mount or the tools volume failed, or the command names did not resolve. Harness defects are fixed with the Captain before the test run. If P loaded the skill but ran a checker in fewer than 6 of 8 sessions, that is the model's choice: it is reported, never fixed, because changing an arm's text after admission would be tuning, and the process contrast then reads "pstack as the model ran it".
- **INFRA:** gaps on more than 10% of any admission cell, or a scoring path that cannot run entries (the tools volume, the plugin mount, the capture, the transplant, the rebuild). The harness is fixed with the Captain before the test run; nothing is rerun to change an outcome.
- **Cost:** each arm's 95th percentile against section 5, and every model item re-priced (section 13).

Admission decides nothing about the contrasts, and its units never enter the test set.

### 11. The test run

On the n test units and all three models: P, C and N told, once each (9 sessions a unit). All sessions of a unit run in the same part, interleaved in an order seeded by order_seed (prereg.json). Sol and particle-1 are re-priced again after their first 10 test units (section 13). There is no second stage in this line.

**Blind probe, last.** After the test run, and only if the line can still hold its cap (section 13): P blind on the 8 admission units on Opus (8 sessions), with the blind text in section 4, scored by the same rules and reported as a rate with its Wilson interval. It decides nothing.

### 12. Analysis and verdicts

- **Rates:** each arm's catch rate per model, with its Wilson 95% interval. This is the headline: how often each arm's check catches the real bug.
- **Confirmatory verdicts, pooled over the three models:** P minus N and P minus C, each the paired difference in catch rate over every unit and model pair, with a 95% interval from a bootstrap over repositories stratified by model (10,000 resamples, bootstrap_seed in prereg.json) and a two-sided bootstrap p (twice the smaller share of resampled differences at or beyond 0 on either side), with Holm's correction over the two contrasts. HELPS when the interval's lower bound is above 0 and the Holm-adjusted p is below 0.05; HURTS when the upper bound is below 0 and the adjusted p is below 0.05; otherwise NO MEASURABLE DIFFERENCE, stated with the MDD. The exact McNemar p on the pooled pairs and the counts of pairs worse and better print beside it.
- **Per model:** P minus N, P minus C and C minus N per model, each with its bootstrap interval over repositories, the exact two-sided McNemar p, Holm over P minus N and P minus C within the model, and the counts of units worse and better. They carry the same verdict words labelled as per-model readings with their MDD; at n near 28 a per-model reading can see only differences of about 40 points. C minus N is descriptive everywhere.
- **Beside every verdict:** the gap worst case, the reading that scores fix-merge conflicts and fix-tree rebuild failures as misses, the reading that scores tree-check refusals as misses for the arm that produced them, the E_PF_ARM and E_PF_WRAPUP_ALLOWANCE gap counts per arm and model, the static-text sensitivity, the reading without API-guess catches, the compile-blocked rerun reading, the two ceiling readings (a session with no catching entry and at least one entry the ceiling left unreached counts as missing; and the units section 6.7's limit flags are dropped), per arm and model the entries scored, the share the ceiling left unreached, the share of timeout-only entries (every parent run timed out) and the sessions that hit the ceiling, and the exposure rates.
- **Strata:** every rate and contrast on the July 2026, January to June 2026 and pre-2026 units alone, beside the full set. Descriptive.
- **R48:** every null on a verdict contrast gets one Why-null cycle: exposure (section 8), task fit (the model-only red, aimed and sync-gate secondaries), power (section 14) and whether plain Opus already does it (N). pstack is not a gstack skill, so KEEP reads "adopt this pstack idea in gstack for this job" (behind the gstack Captain's own before-and-after test), CUT-CANDIDATE reads "don't adopt it", and FIX-METHOD covers floor, ceiling, contrast-floor and exposure nulls.

### 13. Agent notes: money (internal; a gate input, left out of the public export)

Session allowances, frozen: for P and C, Opus $12, Sol $12, particle-1 $5; for N, $6, $6 and $3; the blind probe $15 on Opus; the wrap-up turn $6 on Opus, $5 on Sol and $0.50 on particle-1.

The wrap-up allowances are sized for the metering proxy's worst case. The proxy refuses a call when the slot's committed spend plus the call's worst case would pass the allowance, and it counts that worst case as one input token per byte of the request at the cache-write price, plus the full 32,000 output tokens Claude Code asks for. At a 200k-token context (about 700 KB of request, at about 3.5 bytes a token), one wrap-up request's worst case is about $4.14 on Opus and $3.99 on Sol. Sol's price row has long-context rates past 272,000 prompt tokens ($5 a million for a cache write and $15 for output), and because the proxy counts every byte as a token, any Sol request over about 272 KB is reserved at those rates. A wrap-up whose first request writes the cache cold has already committed about $1.00 on Opus and $0.50 on Sol before its next request, so the turn needs about $5.14 and $4.49. At a 160k-token context (about 560 KB) Sol's cold first request alone needs $3.29, and the turn $3.69. Sol's $5 holds a cold first request and the next one up to about 790 KB, and Opus's $6 up to about 830 KB. The worst case is reserved at the 5-minute cache-write rate, because the pinned Claude Code on an API key, with no cache TTL setting, marks its cache breakpoints without a one-hour TTL. particle-1's worst case is about $0.11. The $1 first frozen here refused every Opus wrap-up on its first request, even on the dry run's near-empty context of about 70 KB.

Planning prices, from the try-out's measured tokens (26M to 35M tokens for a two-step Opus session, mostly cache reads), replaced by admission's measured costs. Per session, told, on Opus: P $7, C $7, N $2. Sol at 0.6 of Opus and particle-1 at 0.4 of Opus (the stacks round's measured ratio on TB2 trials, not the ratio its token prices suggest). Blind P on Opus $12. VMs $0.40 a session, covering session wall time and scoring container time. Model prices from src/runner/pricing/prices.ts (per million tokens): Opus 5.5 $4 input, $20 output, $0.20 cache read, $5 cache write; GPT-6.1 Sol $2, $10, $0.10, $2.50; particle-1 $0.10, $1, $0.003. Caps on model items are 1.2 times central, rounded up to $10.

| Item | What | Central | Cap |
|---|---|---|---|
| pf-labels | Astra and Opus labels with the state machines eval's labeller, for candidates it never labelled | $60 | $100 |
| pf-oracle | VMs: the oracle on candidates that eval never ran, and the neutral-tree validation on every drawn unit | $50 | $80 |
| pf-admit | 8 units on Opus: P, C and N told (24 sessions), and the Sol and particle-1 price probe (12 sessions); the cap covers either raise (24 more Opus sessions) | $174 | $330 |
| pf-opus | n = 28: P, C and N told | $482 | $580 |
| pf-sol | the same on Sol | $302 | $370 |
| pf-particle | the same on particle-1 | $213 | $260 |
| Crew model use | this planning thread, the build, /ship, run control and results, read from the thread counters at about $1 per 1,000 credits | $200 | $250 |
| **Total** | | **$1,481** | **$1,970** |
| pf-blind | the blind probe, run last only if the line still holds its cap | $99 | $120 |

**Reserve mechanics.** Every cap is a hard stop held by the ledger; the caps of the first seven items sum to the $1,970 line, so nothing passes it without a stop first. A session's task open also reserves its wrap-up allowance, held until the wrap-up opens, a new task attempt replaces it, or 120 seconds (the deadline grace) after the task slot closes, so a wrap-up opened in time always finds its room. pf-labels is spent only as needed. After admission, Opus is re-priced at 1.2 times its measured central cost from its 24 told sessions. Sol and particle-1 are re-priced at the larger of their planning price and 1.5 times their measured cost from 6 sessions each, and again after their first 10 test units; if that second projection passes the item's cap, the part stops before its next unit and the Captain decides. n is the largest n up to 60 for which the re-priced caps fit inside what is left of the line, never above the supply; every model keeps the same n. If fewer than 30 usable units remain at real prices, the Captain decides with the measured figures before the test run: run smaller with its MDD, or drop a model. pf-blind runs after the test run only if the spend recorded so far plus its $120 cap stays inside $1,970; at planning prices it does not fit. A projection past $5,000 all-in goes to the owner. A cap stop ends that part incomplete, and it is never retried to change a verdict. Crew use is read from the counters at each milestone; passing $200 comes to the Captain before the next paid item.

**The wrap-up reserve against the caps, at planning prices.** A task open needs the item's spend so far (VMs at $0.40 a session counted as spent) plus its task and wrap-up allowances: $18 for P or C on Opus, $17 on Sol and $5.50 on particle-1; $12, $11 and $3.50 for N; and $21 for the blind probe. The last open of an item is its tightest point: the item's central cost, less the last session's own central cost, plus that open's reserve.

| Item | Central | Last open (P or C, or blind) | Needed | Cap | Sessions an item can hold open at once, before the reserve rule and now |
|---|---|---|---|---|---|
| pf-opus, n = 28 | $481.60 | less $7.40, plus $18 | $492.20 | $580 | 21, now 9 |
| pf-sol, n = 28 | $302.40 | less $4.60, plus $17 | $314.80 | $370 | 9, now 5 |
| pf-particle, n = 28 | $212.80 | less $3.20, plus $5.50 | $215.10 | $260 | 26, now 20 |
| pf-admit, with either raise | $312.00 | less $7.40, plus $18 | $322.60 | $330 | 1, still 1 |
| pf-blind | $99.20 | less $12.40, plus $21 | $107.80 | $120 | 8, now 2 |

Every item fits its planned sessions, and n = 28 is unchanged. n = 29 still fits on all three models: pf-opus then needs $509.40 of $580, pf-sol $325.60 of $370 and pf-particle $222.70 of $260. pf-admit's cap rises from $320 to $330, because $320 could not hold the last open of a raise with the larger wrap-up allowance, and that moves the line at caps from $1,960 to $1,970. Central costs do not change, because an allowance is a ceiling, not a price. The reserve lowers only how many sessions an item can hold open at once before a cap stop: each P or C session in flight needs its reserve less its central cost out of the cap's headroom ($10.60 on Opus, $12.40 on Sol, $2.30 on particle-1 and $8.60 for the blind probe). Admission after a raise had room for one session at a time before the reserve rule, and still does.

### 14. Power and MDD

From the attached power.py: the MDD by simulation of the exact two-sided McNemar test at 80% power, with a design effect of 1.2 for up to 3 units a repository, at alpha 0.05 and at 0.025 (Holm's stricter step). Per model at n = 28, no difference fits at discordant shares of 0.2 or 0.3, and the MDD is 37 to 39 points at 0.4 and 41 to 43 at 0.5. At n = 36 it is 28 to 39 points from 0.3 to 0.5, and at n = 44, 25 to 36. Pooled over the three models at n = 28 (84 pairs) it is 16 to 27 points from 0.2 to 0.5, and 13 to 22 at n = 44.

Plainly: per model this test sees only differences of about 40 points, so per-model readings are reported but the confirmatory verdicts are pooled, where it sees about 16 to 27 points. That is the size of the effect the try-out suggests for the process contrast (pstack's replay tests can turn green on a fix, and plain-words models mostly can't). A 10-point difference is beyond it. Each arm's own catch rate has a Wilson interval about 35 points wide at mid rates at n = 28, and under 15 points wide near zero. Supply and money both put n near 28.

### 15. Build, pins, dry run and stops

The build reuses the state machines eval's harness read-only (its unit frame, converter, oracle, history cut, leak scan, strip, proxy routes and test runner) and adds a small family in lanes/outcome-skills:

- The three arms and the blind probe, with the tools volume and the pstack plugin mount through the stack arms' installer.
- Two-turn sessions: the task turn and the wrap-up turn in one Claude Code session, with the wrap-up turn's non-manifest changes discarded.
- The transplant, the three scoring trees, the neutral-tree builder and its validation, the entry runner and the catch rule.
- The secondaries, the exposure detectors and the analysis.
- Reason codes in src/errors/codes.ts for every drop, gap and exclusion: neutral edit invalid, told-mode screen, fix-merge conflict, rebuild failed on fix, no manifest, upstream gap, infra gap, tree-check refusal, wrap-up allowance gap and cell incomplete.

Keyless tests cover each rule. A dry run with a stub model drives every frozen rule before any spend, on three real units: a real regression test (catches); an always-fail and an always-pass entry (no catch); a golden of current output (no catch); a hash change detector and a "changed since base" gate (ruled out by the neutral tree); a TLC model with a violated invariant (model-only red); a check that imports an agent's product edit (no catch); a check stored outside the repository (not runnable); a manifest with one catching entry among several (the unit catches); a random check (no catch); a check that hangs on the parent and passes on the fix (catches, or N/A when the ceiling left it unreached with every run so far matching a catch and the scheduler replayed from the session's run times, with no setup time, would still start its next run after the ceiling); a wrap-up turn that adds a test file (discarded); a catch that exists only after the rebuild; a verify skill and its model under a gitignored directory (captured and counted); an inline python -c entry and an entry naming nothing new in T (non-catches); an entry beyond the cap and entries the ceiling leaves unreached (non-catches); a second agent test that breaks compilation on the fix tree (compile-blocked, rerun); an API-guess test (classified); a test file that reads a product source path as text (static-text); a sync-gated replay test (sync gate); a wrap-up turn that ends at its limit with no manifest (0) and one that ends upstream (wrap-up rerun); the first main request's effort and thinking fields per model, recorded at the driver's proxy, with a session whose fields match the record and one with no record (the check fails); a tree-check refusal (gap E_PF_ARM, no retry); a wrap-up turn refused for its allowance (gap E_PF_WRAPUP_ALLOWANCE, no rerun); a cold first wrap-up request at a 160k-token stub context, admitted inside the wrap-up allowance on Opus and on Sol; a real TLC run from the tools volume, offline, in a unit image; bun and pstack's statechart script resolving through a live Claude Code session's Bash tool in every arm, as root and in a shell as uid 1000 that keeps the session's environment, with /opt/pf-tools/bin first and the same PATH in every arm; the pstack plugin's skill body in the transcript; a hostile CLAUDE.md fixture reaching no arm; a containment check on the session image before any session (every ref and commit at the base commit or before it; no alternates or nested repository; no git directory holding the dataset's base commit, a file the fix or the test patch changes as it reads after the patch, or a commit after the base that the unit's image holds; and no hidden test name or added fix or test line in any file outside the repository or untracked inside it); and one ledger lease opened and settled per frozen item on a temporary ledger.

The same containment check runs on each unit's session image before that unit's first paid session. A failure halts the unit before any session with E_PF_CONTAINMENT, without dropping it, and goes to the Captain. Every other git directory in the image is recorded with its path and commit count.

Pins: dataset revisions, image digests, the Claude Code version, the pstack commit and tree, the JDK, TLC and bun digests, and the harness commit. Long runs follow the crew rules: controllers detached on a named runner VM, a registered wait on every watcher, UBI_OWNER set, TTLs covering the longest part, apt stopped at boot and linger on, and every VM deleted at the end.

### 16. Outside terms, licences and public safety

- SWE-bench-Live MultiLang is MIT-licensed and the SWE-rebench leaderboard is CC-BY-4.0; both are rechecked at freeze, and the results carry their attribution. Task ids, digests and aggregates are published, never repository code or dataset rows.
- pstack is MIT-licensed and is credited to Lauren Tan by name. It runs as published at its pin. Nobody contacts its author.
- TLA+ tools are MIT-licensed; Temurin is GPLv2 with the Classpath Exception; bun is MIT. All are used in containers and not redistributed.
- The attached terms.md records, with URLs and the date read, what OpenAI's terms for GPT-6.1 Sol, Particle's and OpenRouter's terms for particle-1, Anthropic's terms and Claude Code's terms say on benchmarking and on publishing results. None bars this eval. OpenAI's pages could be read only in part without a browser, so the run reads them in full before the first Sol call, and a clause that bars this use stops the Sol part before it spends. No model judges anything here, so no judge terms apply.
- Each repository's code runs only inside its container. The try-out's repositories appear only as generic findings; the private one is never named.

### 17. How the rules map

- **E1:** section 10 comes before any test session.
- **No-gstack arm:** N, same model, units and harness, a plain prompt and no skills.
- **R48:** sections 8 and 12.
- **R51:** this plan gets one lean reviewer and one gate revision. The preregistration PR carries scorer code, a gate class in this repository, so /ship runs the depth gstack's planner prints for it, with at most two rounds.
- **R54:** Opus 5.5, GPT-6.1 Sol and particle-1, every arm on every model.
- **R61:** the floor raise and the ceiling raise in section 10.
- **R77:** two merged PRs: this preregistration with its build, and the results.
- **R78:** no model judge scores anything. The eligibility labels come from the state machines eval's two cross-family labellers, whose agreement it reports.
- **R79:** the public lesson is in "Why it matters"; the finding file opens with what we learned.

### 18. Risks, limits and not in scope

- Told mode measures turning a known bug into a check, not discovery. The blind probe gives one small held-out reading on discovery.
- A model-only check that does name the right bug scores 0, because a mechanical rerun can't update a model the way pstack expects a person or agent to. The model-only red and aimed secondaries describe it.
- The scored languages (Rust, Java, C, C++, C#, Go, JS, some Python and TypeScript) differ from the try-out's TypeScript and game code.
- One session per cell.
- Three for three on each tree means a probabilistic race test misses, though races are a labelled state class.
- The rebuild runs without the files the agent added, but it still sees the agent's edits to the unit's existing test files. So on a unit whose rebuild compiles or runs tests, a broken or failing edit to an existing test file still fails the rebuild, and on the fix tree that is gap E_PF_REBUILD_FIX, counted per arm with its miss reading.
- On Maven units an entry rarely names nothing (section 6). The goal word test and option values such as true in -Dspotless.check.skip=true are command tokens of four or more letters, and each one names something whenever a new or edited test file uses the same word as a whole word. On agentscope-java-2257 the edited upstream test file holds both words. Such an entry runs instead, scores as a non-catch, and takes one of the 25 counted slots.
- Python units are out, because the state machines harness converts only MultiLang at this pin.
- The wrap-up turn's one-entry-per-property request is a harness instruction, the same in every arm. pstack's text asks for one command per verify skill, so the request shapes how P reports its checks, not what it builds.
- The state machines eval's harness must be merged first. If it is not merged when the build starts, the build stacks on its branch at a pinned commit with no change to that branch.
- Not in scope: other pstack skills, gstack's own skills, other stacks, discovery at scale, and synthetic bugs.

## Review record

One lean /autoplan review (R65): one Opus 5.5 reviewer read the plan once and found 0 Critical, 7 High, 9 Medium and 4 Low findings. Three were scope, cost and direction choices for the project owner (supply, prices, and the plain-words arm's replay step), and four were High scoring holes (no rebuild, ignored files lost, inline checks in the manifest, and the arm's own slow checks turning into gaps). Gate 1 took every recommendation on 2026-11-09, and this revision applies them and the 13 smaller findings.

### What changed at the gate

- Pool and draw: back to January 2025, newest first, with July 2026, January to June 2026 and pre-2026 strata reported on their own; supply restated from a free count of the sources the harness converts (A1).
- Money: re-priced from the try-out's tokens; Sol and particle-1 re-priced at the larger of planning and 1.5 times measured, and again after 10 test units; the blind probe runs last only if its cap fits; n = 28 at planning prices (B1).
- C carries statechart's replay step; P minus N is stated as unable to answer the adoption question alone (C1).
- Rebuild before every entry run (D1); ignored files captured at session end (E1); inline-program and name-nothing entries are non-catches (F1); unreached and beyond-cap entries are non-catches, gaps are harness causes only, and conflicts and fix-tree rebuild failures print a miss reading (G1).
- Pooled verdicts are confirmatory and per-model readings carry their MDD (H1, with the reviewer's power note).
- From the review's smaller findings: static-text sensitivity and a wider detector; API-guess classification; compile-blocked reruns; a 25-entry cap with model entries last; MDDs from exact simulation with Holm; a per-contrast floor and an exposure rule limited to harness defects, with aligned thresholds; a sync-gate secondary; VM price from wall and scoring time; effort frozen at Claude Code's default; per-unit entry timeouts; the ceiling raise checked on all three arms; the wrap-up turn's limit and upstream ends defined; outside terms recorded at freeze; a race-test limit.

### Changed at build, before merge

The Captain ruled on four readings the build chose, and this revision applies them.

- A task open also reserves the session's wrap-up allowance, the cap-safe choice. Section 13 shows every item still fits its planned sessions at planning prices.
- A tree-check refusal is gap E_PF_ARM with no retry. Because it can depend on the arm, every verdict prints these gaps per arm and model and a reading that scores them as misses for the arm that produced them (sections 5, 6.8 and 12).
- The driver's proxy records each session's first main request's effort and thinking fields, so the section 3 check runs on paid runs as written, and a session with no record fails it (sections 3 and 15).
- A wrap-up turn refused for its allowance is gap E_PF_WRAPUP_ALLOWANCE, with no rerun, counted per arm and model like the tree-check refusals (sections 5, 6.8 and 12). Before this ruling an allowance stop in the wrap-up turn scored as a limit.
- The wrap-up allowance rises from $1 to $6 on Opus and $3 on Sol, and stays $0.50 on particle-1, because the metering proxy's byte-based worst case refused every Opus wrap-up at $1. pf-admit's cap rises from $320 to $330, so the line at caps is $1,970 (section 13). A smaller raise that fit the old cap was turned down, because its gaps would have fallen mostly on P, whose sessions run longest.
- Sol's wrap-up allowance rises again, from $3 to $5. Sol's price row has long-context rates past 272,000 prompt tokens, and the proxy counts one token per request byte, so a cold first wrap-up request at a 160k-token context (about 560 KB) has a worst case of $3.29, over $3; the earlier figure priced Sol at its base rates. At $5 a cold first request and the next one fit up to about 790 KB. Caps, n and the line at caps do not change; Sol's reserve per P or C open rises from $15 to $17, and Sol sessions held open at once drop from 6 to 5 (section 13).
- Report directories, a pre-data build change taken from the state machines harness: unit preparation runs git clean, which also removed the untracked report directory an image's own runs had left, so a unit whose test command writes its report into a relative directory it never creates read no fresh report on any run and dropped at the oracle. Each run now creates, after stale reports are deleted, only the empty parent directories of report paths named by both the print command and a test command's tee or redirection, owned by the run user. This affects 63 of the 804 rows in the draw's pool (Go 28, TypeScript 15, JavaScript 10, Rust 8, C++ 2). No unit had been drawn when this changed.
- Scoring trees, a pre-data build change: each scoring tree (parent, fix, neutral, and the breaks secondary's) now starts as a copy of the prepared tree the oracle and the neutral gate run on, the image's repo dir with its build state and ignored files, and the tree commit is checked out over it (section 6.5). The trees used to come from a git clone, which holds no ignored file, so with no network a frozen rebuild started without node_modules/, target/, build/ or bin/ and obj/, and either failed or rebuilt cold in every arm alike; only Go, whose caches sit in the home directory each run copies, was untouched. The pool's 804 units by language: Go 100, C 78, C++ 110, C# 97, Java 131, JavaScript 70, TypeScript 92 and Rust 126. After the checkout, HEAD, the working tree and the index must equal the tree commit, and an untracked file that isn't ignored stops scoring (E_PF_TREE_STATE) instead of being overwritten, because the oracle never ran with it. Each tree and each running entry holds a full copy of the repo dir, as the oracle's runs do, so scoring hosts are sized for one copy per tree plus one per running entry.
- Two secondary readings now work on Go, a pre-data build change: an entry that runs a static-text test file through its package directory (go test ./pkg/, or a ./pkg/... pattern above it) counts as a static-text entry, and Go's compiler lines (file.go:line:col:) and [build failed] lines count as compile errors for the compile-blocked rerun. Before this change neither reading could fire on a Go unit as section 9 describes them. The primary score is unchanged.
- A failed rebuild on the fix tree stays gap E_PF_REBUILD_FIX however long the entry's output runs, a pre-data build change: the runner keeps only the last 80,000 characters of a run's output, the rebuild exits were printed only before the entry, and a long output pushed them out, which scored a failed rebuild as a miss. Each run now prints its rebuild exits again after the entry.
- The compile-blocked rerun on Go keeps the entry's own test file, a pre-data build change: a Go entry names its test file only through its package directory (go test ./pkg/), so the rerun dropped the entry's own file along with the broken one, and the rerun could not catch. Files in a package directory the entry names outright now stay, except the blocking file. The primary score is unchanged.
- A stable test the parser loses from one or two runs no longer fails the neutral gate, a pre-data build change (section 2). 74 of the 126 Rust units in the pool run their tests with cargo test's --nocapture, so other tests' output can land inside a result line. On gitoxide-2476 the unit's parser lost about 12 of 2,441 stable tests in each run, different ones each time, and the gate dropped the unit in both modes. A stable test now fails the gate when a run stops, when a run reports it with any status but pass, or when no run reports it at all, so a broken build and a real regression still fail it. The primary score is unchanged: it reads each entry's exit code, not the parser.
- Each result marker in the run script now starts its own line, a pre-data build change (section 6.5). The runner reads a run's exit status from a marker line printed after the entry. A check whose output ended with no newline put the marker in the middle of a line, the runner found no marker, and the run scored as a fail. In a Docker repro, a real catch whose fix-tree output ended in printf scored as a miss, and a check that exits 0 on every tree scored as a catch. The rule is unchanged: pass is exit 0 within the timeout.
- A stable test the parser loses from one or two breaks runs is no longer a break, a pre-data build change (section 9), for the same reason as the neutral gate's change above. A stable test is a break when two of three runs stop or report it failed, or when no run reports it passed, so a broken build and a real regression still count.
- The files the agent added move out of the tree while the unit's rebuild runs and move back byte for byte before the entry, on every tree, a pre-data build change (section 6.5). 94 of the 131 Java units in the pool rebuild with Maven's -DskipTests, which skips running tests but still compiles them. On agentscope-java-2257 one broken test file the agent added failed the rebuild in 12 seconds, and a failed rebuild on the fix tree is gap E_PF_REBUILD_FIX, so that one file made the whole unit a gap. On Go and Rust the same session scores the entry and runs the compile-blocked rerun. The moved files are the ones the compile-blocked rerun draws from: every file the agent added. A move that fails stops scoring with E_PF_INFRA_GAP, a harness fault, before the entry runs. Edits to the unit's existing test files stay in place (section 18).
- The fix tree now holds the upstream fix byte for byte, a pre-data build change (section 6.5). Scoring read the fix patch as UTF-8 but passed it to git apply as Latin-1, the encoding the rest of the tree code uses, so every byte outside ASCII changed: an em dash became one control byte. 111 of the 804 units in the pool have such bytes in the source fix. In 73 they sit in context or removed lines, so the patch would not apply and every session on the unit would be gap E_PF_FIX_CONFLICT; in 67 they sit in added lines, so the fix tree held the wrong bytes (some units have both). On agentscope-java-2257 an em dash in a comment failed the rebuild's format check on every fix tree, so every entry was gap E_PF_REBUILD_FIX. The patch is now read as Latin-1, so its bytes reach git unchanged. The oracle and the neutral gate build their trees another way and were not affected.
- The dry run also checks the tools PATH through a live session's Bash tool in every arm (section 15). On the Debian 12 session image a bare login shell (bash -lc) resets PATH and loses /opt/pf-tools/bin, but the Bash tool keeps the image PATH, so statechart reaches bun with no change to the environment, and the dry run records the login-shell result without scoring it.
- Only the proxy's allowance stop makes an allowance end, a pre-data build change (sections 5 and 6.8) taken from the state machines eval's driver. The proxy also answers E_ALLOWANCE when it refuses a request for another reason: a route or model off the allowlist, a body that is not JSON, max_tokens over its cap, or a request it cannot price. Those used to read as an allowance end. Now the driver counts allowance stops apart from the other refusals, and only that count makes a task turn a limit or a wrap-up turn gap E_PF_WRAPUP_ALLOWANCE; any other refusal leaves the turn's own end, so a wrap-up that ends upstream that way still gets its one rerun.
- A fix test patch that does not apply on the breaks secondary's tree is skipped and named, a pre-data build change (section 9). The breaks runs apply the unit's test patches on T, and T keeps the agent's edits to existing test files, so an agent edit that touched a test patch's lines failed the patch step. A failed step counted as a stopped run, all three runs failed the same way, and every stable test read as a break: on blocky-2016's dry-run tree, which holds the unit's test patch, 1,306 breaks out of 1,306 stable tests. Now a patch that git apply --check rejects is skipped, and once a patch is skipped a stable test no run reports counts neither way, because the skipped patch may be what adds it or what a later patch's tests need to compile. A session's breaks are not measured, and counted per arm and model as not measured, when a run stops at a patch step that passed the check, or stops, builds nothing or reports no stable test after a skip. With every patch applied, a stopped run or a broken build still counts against every stable test.
- A turn whose proxy finalize failed is an infra end, a pre-data build change (sections 5 and 6.8) taken from the state machines eval's driver. When the metering proxy's finalize fails at a slot's close, the driver cannot read that slot's counts, and its close answer now says so: finalized false and null counts, where it used to report zeros. A PF turn read those zeros as no refusals and no allowance stop, and ended by its own termination. Now such a turn is infra. The allowance stop still reads first, so a turn that also counts one keeps its allowance end and is never retried.
- A slot whose proxy finalize failed halts its session and its stage, a pre-data build change (sections 5 and 6.8). With today's in-process proxy a finalize should never fail, so a failure is a harness fault to read before anything more is spent. The session gets no fresh-container retry and no wrap-up rerun and writes no session record, the driver opens nothing more on the item and names the session and the lease's journal (E_PF_FINALIZE_HALT), and the Captain rules on a retry after reading the journal. A slot that also counts an allowance stop does not halt.
- The dry run checks containment before any session, a pre-data build change (section 15). Another eval found that SWE-rebench task images can carry git tags that reach commits after the base, some holding the upstream fix and its hidden tests, and that one model found them with git log --all. A generated check written against the fix itself would score as a catch here. The check runs as root in a container of the session image, which is the session's whole filesystem apart from the read-only tool mounts: every ref, tag, remote, note, replace ref, stash, packed ref, FETCH_HEAD, ORIG_HEAD and reflog entry must point at the base commit or an ancestor, every commit object must be the base or an ancestor, there must be no alternates file, gitfile, submodule store, nested .git or other git directory holding the dataset's base commit, tracked files must equal the base commit, and no file outside the repository, or untracked inside it, may hold a line of 30 characters or more that the fix or the test patch adds and no base file holds, or a hidden test's name that no tracked base file holds. The check also fails when any other git directory in the image holds the dataset's base commit, a file the fix or the test patch changes as it reads after the patch (by its git blob id), or a commit after the base that the unit's own image holds, or when the session repository holds such a blob; it records every other git directory with its path and commit count. It runs in the dry run and again before each unit's first paid session, where a failure halts the unit, without dropping it, for the Captain. Unit preparation already replaces the history with one new commit, and the check found one commit, one ref and no hit on each of the three dry-run units.
- The ceiling's effect is now recorded and read, a pre-data build change (sections 6.7 and 12). In agentscope-java-2257's dry run, a check that hangs on the parent needed 10,265 s for its own runs, inside the 3-hour ceiling, but waited 1,486 s for slots and phase barriers behind the session's 13 other entries and was left unreached before its last neutral run. Waiting depends on how many checks a session lists and how slow they are, so it can differ by arm. The runner now records each run's start, call time and rebuild time and each entry's slot and barrier waits; section 6.7 states the limit; and two ceiling readings and the per-arm ceiling counts sit beside every verdict. The primary score is unchanged: an unreached entry is still a non-catch.
- The dry run's hang line reads N/A, not FAIL, when the ceiling left the hang check unreached, every run it had matches a catch, and the scheduler replayed from the session's recorded run times with no setup time would still start its next run after the ceiling (section 15). On agentscope-java-2257 the replay starts its last neutral run at 11,751 s against 10,800 s, so the ceiling, not the rule under test, decided it.
- The phase barriers stay. Replaying agentscope-java-2257's session with each entry running its own parent, fix and neutral runs back to back on the same 4 slots, with no barriers, cut the waiting summed over all entries from 67,951 s to 15,396 s, but most of that was quick entries idling at a barrier, which changed no outcome. The hang check's own wait rose from 1,486 s to 1,688 s, its last neutral run would start at 11,953 s instead of 11,751 s, and so would the session's end. Each run's tree, build and inputs do not depend on other entries' phases either way, but the change would not remove the waiting that left the check unreached.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.
