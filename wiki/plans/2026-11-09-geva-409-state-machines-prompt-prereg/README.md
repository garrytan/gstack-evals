---
id: 2026-11-09-geva-409-state-machines-prompt-prereg
kind: plan
title: "Preregistration: does the viral implicit state machines prompt fix real bugs, and does its restructuring make the next real change go better without breaking anything? Graded by each project's own tests on held-out 2026 bug fixes"
summary: "Two claims on 60 held-out 2026 bug fixes, scored by each project's tests: does the prompt fix bugs it isn't told about, and does its restructuring help the next real fix? Opus 5.5, Sol, particle-1."
author: GEVA-409
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: open
links:
  - 2026-11-07-geva-380-r3c-results
  - 2026-11-03-geva-247-r3-amendment-4
  - 2026-11-01-geva-87-real-outcome-lane-plan
attachments:
  - 4990e150ecda2c8b02c43cacea4aa16a5051d5ffd6245f14a9f2a7c92aca596d  power.py
  - ff5c2f62bd5aa91e1f3220aef74c7835452112fc387f7e2e0842fc7ebdb3cb65  power.txt
  - 99202cca9a8636a144c1eff0c1293eb1f0950711feb997629f4b2487b5835289  prereg.json
  - 8bf5633369824e79387dec1b80d5600c59c8ef253d891128287d9aa1ce99a11f  supply-count.md
  - 182e0bc9a19a8125c7a83164b767e87f9e3321a3b4e387982984f35f380ac264  supply-count.py
---

# Preregistration: does the viral implicit state machines prompt fix real bugs, and does its restructuring make the next change go better?

GEVA-409, Captain GEVA-2. Plan only: nothing in this post spends money, and no model call, VM or eval ran to write it. The supply counts in section 3 come from the datasets' published files at no cost.

## Approval

Approved at gate_rev 1 of /autoplan run autoplan-20261109051613 (lean, one Opus 5.5 reviewer), rec_hash e035caa0962a. The project owner took every recommendation on 2026-11-09, relayed by the Captain: the three High fixes (two breakage readings, hunk-level test application, and an incremental follow-on score), all 13 Medium, Low and informational findings, the $4,000 line for this eval, a separate $1,100 line for gstack's /qa, the structure claim in this line, the newest-first draw, and no owner labels for the judged ratings. This revision writes those picks in.

On 2026-11-09, before the build, the Captain added the seed file prereg.json and settled three readings the build follows, written into sections 4, 6 and 14: the proxy's web-tool refusal, the no-answer rule and the exact sign-flip test. After the first build package it settled two more: tests that live inside the fix patch (sections 3, 7 and 18) and how leak drops are reported (section 4). It also had the crew's snapshot strip rule written into section 4. After the first-stage scorer it settled three scoring readings in sections 3 and 7: the fix's in-source test hunks go everywhere the test patch goes, the 2-of-3 rerun works in both directions, and three fallbacks are counted. After the follow-on scorer it settled how a follow-on's own change is scored (section 8, item 3) and kept two literal choices about follow-on gaps, each counted (sections 6 and 8).

## ELI5

A short prompt is going around online: find all of the implicit state machines in my app, and make the best decision for users, developers and AI agents without breaking anything. People say it fixes a lot of bugs. We tried it first on three of the owner's projects beside the same prompt with "implicit state machines" swapped for "bugs". The swapped prompt fixed 15 real bugs and the original fixed 1. The original spent its effort tidying instead: tables of allowed steps, clearer error messages, docs and guard tests. That was clean in two projects and broke 5 tests in the third. So this test checks two claims separately, on real bugs that public open-source projects fixed in 2026, using each project's own tests as the answer key. Claim 1: does the prompt fix bugs? Each AI gets the code from just before a real fix and the folder to look in, but no bug report. It runs a plain "find and fix the bugs", the prompt word for word, or the swapped prompt. A small pilot is the whole test unless the prompt beats the swapped one there. Claim 2: does the prompt's tidying make the next real change easier? A fresh AI is given the real bug report and fixes it on the untouched code, on the code the prompt tidied, and on code tidied by a prompt that asks for refactoring instead of state machines. The project's tests decide both claims, and anything broken counts against the prompt. A judge from another AI family, checked against known answers first, also rates each change for users, developers and agents.

## Before → after

Before: the prompt's evidence is social posts, plus one exploration this week on three of the owner's repositories, one run per repository and prompt, with every fix verified blind to which prompt made it. It found the prompt is a refactoring prompt, not a bug-finding one, on those repositories. Nothing has tested either reading on code the prompt never saw, on more than one model, or checked whether the refactoring pays off later.

After: a frozen test on 60 real bug fixes from 2026 that the exploration never saw, July 2026 first. For each of Opus 5.5, GPT-6.1 Sol and particle-1 it reports, with 95% intervals: whether the prompt fixes more real bugs than plain find-and-fix and than the swapped prompt, how often it breaks working tests, and whether a later real fix goes through more often on code the prompt restructured than on untouched code or on code a refactor prompt restructured. A separate, smaller line asks whether gstack's own /qa skill beats plain find-and-fix on the same bugs. It ends in a finding file for a blog post and a clear input for whether gstack folds the prompt in, and for which job.

## Why it matters

Prompts like this spread because they sound right, and builders paste them into their agent setups. If the lens finds bugs, gstack should use it where bug hunting happens. If it doesn't, but its restructuring makes later changes safer, it belongs in a different place, as a structure pass, and builders should use it for that and not for bug hunting. If neither holds, the post says so with numbers. The public lesson this experiment is after: what does asking an agent to find implicit state machines actually do to a codebase (fix bugs, restructure it, or break it), and does that restructuring make the next real change go better?

## What caused this work

On 2026-11-08 the project owner asked for an eval of the prompt, fixes in his projects, gstack folding it in if it helps, and a blog post. The Captain split the work. An exploration thread ran the prompt and the swapped prompt on three of the owner's repositories, verified every change blind and reported generic bug classes (section 2). This thread plans the eval. The Captain then set four constraints: the money must fit the line at caps with reserve, so the bug-fix test stops after its pilot unless the prompt beats the swapped prompt there; the prompt's real claim (behaviour-preserving structure) is tested as its own claim with follow-on tasks; gstack's /qa is shown as its own line or its own split; and the no-gstack plain arm, the R54 models and held-out units stay. The scored units are real bug fixes from public projects the prompt never saw, because tuning on the explored repositories would fit the test to them, and one of them is private.

## Big decisions

1. **Two claims, one set of sessions.** Claim 1 (bug fixing) and claim 2 (structure) share the prompt's first-stage sessions, so claim 2 costs only its follow-ons and one control. Options: (a) both claims in this line; (b) claim 1 only, with claim 2 offered later. Pick (a). Why: the exploration says claim 2 is what the prompt really does, and the follow-ons are cheap. What would flip it: the owner caring only about the viral "fixes bugs" claim, which saves about $1,300 at planning prices.
2. **Claim 1 stops after its pilot unless the prompt beats the swap.** The 60-unit run is the whole bug-fix test, with its MDD stated (about 15 to 18 points per model, about 9 to 10 pooled). A second stage of 120 more units runs on a model only if the prompt clean-fixes more units than the swapped prompt there, and it is priced from the pilot and comes to the Captain as a raise. Why: the exploration found 1 fix against 15, so a large stage 2 would most likely buy precision on a known direction.
3. **Units.** Real bug fixes from SWE-bench-Live MultiLang (MIT) and the SWE-rebench pool this repository already pins (CC-BY-4.0), March to July 2026, drawn newest first so July 2026, after both frontier models' cutoffs, fills first. 15 admission units plus 60 test units, at most 3 per repository. Options: July only (too few after filters to also balance bug kinds), or our own mined TypeScript and Python fixes from August to October (weeks of work). What would flip it: the owner requiring a post-cutoff-only primary.
4. **Claim 1 arms.** Plain "Find and fix the bugs in my app." with no gstack (R44's no-gstack arm), the prompt verbatim, and the lens swap (only "implicit state machines" changed to "bugs"). The agent gets the pre-fix code, the folder that holds the real fix, no bug report, no fix tests and no web.
5. **Claim 2 design.** A fresh agent on the same model gets the real bug report and fixes it, three times per tree, on the untouched tree, the verbatim prompt's tree and a refactor-lens control's tree (the prompt with "implicit state machines" changed to "code that most needs restructuring"). The primary is incremental: the next fix passes the real fix's tests and breaks nothing that worked on the tree it started from, which isolates whether the structure helped. End to end (every test that passed before the first stage still passes) is reported beside it as the net value a user gets, and the first stage's own breakage is its own flag.
6. **Primary scores are test-graded.** No judge decides a primary. UX, DX and AX ratings are R78-checked secondaries: GPT-6 Astra judges Opus sessions and Opus 5.5 judges Sol and particle-1 sessions.
7. **gstack /qa gets its own small line.** /qa against plain find-and-fix is a gstack skill question with its own value, but it doesn't fit this line with reserve. Pick a separate $1,100 line that reuses this eval's units, harness and plain-arm sessions. Options: ride inside this line by dropping the refactor control, or skip /qa.
8. **Packaging.** The preregistration PR carries the harness, scorer and analysis, reviewed at gate class before any money moves (R77 allows two PRs: this one and the results). A successor build thread does the build and /ship.
9. **Money.** A new $4,000 line under R71's Astra-judged guideline: central about $3,230 all-in at planning prices, $4,000 at caps with crew use included (the admission cap is $270 so it covers its retry branches). Stage 2 on a signal, and any projection past $5,000, come back first.

## Implementation plan

### 1. Two claims, and construct fit

**Claim 1, bug fixing.** The prompt as posted: asked to find the implicit state machines in an app and make the best decision for UX, DX and AX without breaking anything, an agent fixes more real bugs, and breaks less, than when asked to find and fix the bugs. The question: on real bugs nobody has described to it, does the prompt make an agent clean-fix more of them than plain "find and fix the bugs" (primary) and than the same prompt with its lens swapped for bugs (the lens contrast)?

**Claim 2, structure.** What the exploration says the prompt really does: it makes implicit state explicit and documented without changing behaviour, which should make the code easier and safer for the next developer or agent. The question: does a later real fix, made by a fresh agent on the prompt's restructured code, end up correct and unbroken more often than the same fix on the untouched code (primary), and than on code restructured by a refactor prompt with the same framing (the lens contrast)?

Construct fit, part by part:

- "Fixes a lot of bugs": claim 1's clean-fix rate on real, tested bug fixes.
- "Without breaking anything": inside claim 1's primary (a broken stable test fails the unit, under the strict reading of section 7), in each first stage's break rate on its own (the flag on every verdict), and in claim 2's end-to-end score.
- "Implicit state machines": each claim's lens contrast, and claim 1's state-shaped stratum.
- "Elevate DX and AX": claim 2's incremental follow-on score (a later developer or agent's change going through on the restructured code), its cost and turns, and whether the follow-on agent read the prompt's new docs and tables.
- "Elevate UX, DX and AX" as judged: the R78 secondaries, which decide nothing alone.

What the scores can't see: bugs no test recorded, payoff beyond one later change, and UX in apps with screens. The units are mostly libraries and tools (section 22).

### 2. What the exploration found and how it shapes the test

The exploration ran the prompt (M) and the lens swap (C) once each per repository on Opus 5.5, on three of the owner's repositories: gstack, gbrain and a private project. A blind verifier classed every change, and every bug fix was proven by a test that fails before and passes after. Generic findings only:

- Verified bug fixes: M 1, C 15, with no overlap between arms. Of the 16 bugs, 6 were state-shaped: M found 1 and C found 5.
- M inventoried 61 implicit state machines (24, 23 and 14 per repository) and made 15 explicit: transition tables, refusal messages naming the current state and the next valid action, docs and drift tests. In two repositories that work was clean (no new failures; in one, 32 of 32 replays were identical). In gstack it made a reusable state final, which broke an existing flow, and left a generated file stale: 5 new test failures.
- C broke tests too: 3 stale goldens in one repository and a new test that tripped a timeout policy test in another. Neither arm met "without breaking anything" on its own.

How this shapes the plan:

1. Claim 1 expects the prompt below the lens swap, so its pilot is the whole test unless the prompt wins there (section 13).
2. Claim 2 exists because restructuring, not bug finding, is what the prompt did. It is tested with follow-on changes, as the exploration recommends.
3. The exploration's generic bug classes extend the state-shaped definition below.
4. The breakages were stale generated files, goldens, size ratchets and policy tests. Each project's stable passing tests (section 7) include whatever such checks it has, so they score automatically, and a keyless flag records changes to generated files (section 10).

**State-shaped, as frozen for labelling.** A bug is state-shaped when the wrong behaviour depends on the order or history of events rather than on one input. Classes:

1. A status, mode or flag not set, reset or cleared on some path, including a per-session flag that carries over between runs.
2. Validate after mutate: a rejected action changes state before it is checked, or an error path returns after side effects.
3. A transition allowed from a wrong state: double submit, use after close, re-entry, re-initialization, or a status guard that omits one terminal state.
4. A handler that isn't idempotent, so two events apply an effect twice.
5. Stale or cached state not invalidated or refreshed after a change.
6. Order and lifecycle errors: use before initialization, teardown before work ends, events out of order, races, a lifecycle value captured at the wrong time.
7. Resumption: retry, reconnect, resume or restart not restoring state.
8. A step that handles only one of two state changes crossed in one update.

Every other bug is "other": single-input logic, parsing, formatting, arithmetic, operator precedence, unchecked indices, wrong API use, types, platform, paths and configuration.

### 3. Units

**Sources, pinned at freeze.** SWE-bench-Live MultiLang at its Hugging Face revision on the freeze date (eb09c2e5 on 2026-11-08), and the SWE-rebench leaderboard pool this repository already pins (quick/laneb/tasks/swerebench-r3a4.json, sha256 7d2b2735...), restricted to tasks created from 2026-03-01. Each task has the base commit, the issue text, the fix, the fix's tests, its fail-to-pass and pass-to-pass tests, its test commands and log parser, and a container image, pinned by digest.

**Free supply count (2026-11-08, no model calls).** Created on or after 2026-07-01: 231 tasks, all SWE-bench-Live MultiLang from July 2026; 219 usable; 157 bug-like with 1 to 6 changed files, in 49 repositories, 98 at 3 per repository; Rust 47, Java 43, C 27, C++ 15, C# 14, JS 11. No other published containerized source has a task after 2026-05-31. From 2026-03-01: 484 bug-like with 1 to 6 changed files in 229 repositories, 350 at 3 per repository. State words appear in 17 to 22% by keyword. Attached as supply-count.md, with the script that made it (supply-count.py).

**Contamination.** Opus 5.5's published cutoff is June 2026 and GPT-6.1 Sol's reported cutoff is 2026-04-30; particle-1 came out on or after 2026-10-17 with no published cutoff. Units from March to June may sit inside a model's training data. We assume contamination raises every arm alike, because no arm in claim 1 is told the bug, and claim 2 compares trees under the same follow-on. That is a hypothesis, so July units form a frozen stratum reported on its own.

**Keyless eligibility.** The image resolves by digest; at least one fail-to-pass and one pass-to-pass test; the fix changes 1 to 6 non-test source files, counting only the fix's non-test hunks; the issue text is not a feature request by a frozen keyword screen. The judged labels below run next, so the oracle runs only on units that can be drawn. Then the oracle preflight (VMs only, no model) runs lazily in seeded draw order until both strata are full plus a reserve of 10 units, spread across VMs so none passes about 60 image pulls an hour (Docker Hub's limit). It starts with a runtime smoke: Claude Code starts in the image and the egress probe passes, or the unit drops with its reason code. Then the base tree runs three times and the fixed tree three times, each with the fix's tests applied (the test patch and the fix patch's in-source test hunks, section 7). A test counts as fail-to-pass only when it fails on base with the fix's tests applied and passes with the real fix. A dataset fail-to-pass test that passes on a base run is not one: it leaves the unit's fail-to-pass set, and the oracle records how many left and which. A unit stays only when every test left in that set fails in all three base runs and passes in all three fixed runs. A unit left with no fail-to-pass test drops, counted under its own reason. Its stable set is the tests that pass in all six runs. A unit with no stable test, or whose test command takes over 15 minutes, drops.

**Stale reports and the rebuild rule.** Before each oracle and scoring run, every untracked report file the print command reads is deleted, and after the tests a report not written by that run is refused, so a run that leaves no fresh report built nothing and parses nothing. A rebuild command that exits non-zero means the run built nothing, and this rule (c) applies only where the rebuild exits 0 on every fixed oracle run; the flag is frozen on the unit's oracle record before any model run. An exempt unit stays in only if its fixed runs pass the f2p set while the rebuild fails, and no prebuilt test binary in the image comes from the fixed tree. A unit that fails either check is dropped and counted.

**Report directories (a pre-data build change, 2026-11-09).** Unit preparation runs git clean, which also removes the untracked report directory the image's own runs left behind. In 89 of the 1,077 rows the test command writes the file its print command reads into a relative directory by tee or redirection and never makes that directory, so tee cannot open the file, the run writes no report, and under the freshness rule every run built nothing. For example, casey__just-2785 runs `cargo test ... | tee reports/test-output.log` and prints `cat reports/test-output.log`. It kept 24 fail-to-pass ids and 1,370 stable tests before the freshness rule and dropped after it, with no fresh report on any run. Each run now creates the parent directory of each such report path when it is missing, after the stale reports are deleted and before the rebuild and test commands. The run user creates it, so it is empty and owned by uid 10001 in hardened runs. Only directories named by both the print command and a test command's tee or redirection are created, never one the test command makes itself, never an absolute path, and never a path that resolves outside the tree. The same code serves the oracle and scoring, and each oracle run records the directories it created.

**Commands read no stdin (a pre-data build change, 2026-11-09).** The run script reaches bash -s on stdin, so a rebuild, test or print command that reads stdin swallows the rest of the script, and every command after it never runs. Ant, Maven, Gradle and npx can read stdin. In 219 of the 1,077 rows a command starts one of them, including all 160 Java rows (131 of the 219 are in the window, none of them in-source, since every in-window in-source row is Rust). For example, on gwtproject__gwt-10054 the rebuild runs ant and ant test never runs. Each rebuild, test and print command now reads its stdin from /dev/null. Nothing else in the script changes: the stale deletion, the report directories, the start mark and the commands' order stay as they were.

**Absolute report paths inside the tree (a pre-data build change, 2026-11-09).** The report directory change above skipped every absolute print path, so a row that runs `cd /testbed && ... > reports/x.json` and prints `cat /testbed/reports/x.json` still wrote no report and dropped. For example, oauth2-proxy__oauth2-proxy-2524 runs `cd /testbed && go test -v -json ./... > reports/results.json` and prints `cat /testbed/reports/results.json`. A print path that is absolute, or absolute through the print command's cd, and lies under the unit's repo dir is now read as its path relative to the repo dir, and matched against what the test commands write after their own cd's. The same conditions hold: only a directory a test command names by tee or redirection, never one it makes itself or cd's into, no .. step and no glob in the directory, nothing outside the tree, created empty by the run user before the mark. This selects 9 more of the 1,077 rows (reading the repo dir as /testbed): 3 Go, 4 JavaScript and 2 Rust. One is in the window (coze-dev__coze-loop-462) and none is in-window and in-source.

**A /tmp the run user can write (a pre-data build change, 2026-11-09).** Hardened runs mount a tmpfs on /tmp with no mode, and a tmpfs mounted that way copies the mode of the image's own /tmp. In some images that is 0755 and owned by root, so uid 10001 cannot write there: the run script cannot make its mark dir, the start mark and the report lists go nowhere, and every run counts fresh=0. Both vercel__turborepo units dropped this way (vercel__turborepo-12516 and -12599). The tmpfs now mounts with mode=1777; its other options (rw, exec, size=4g), the network and the privileges stay as they were. A run that still cannot make its mark dir stops before any command runs and records an infra error (E_SM_INFRA_GAP) on the run and the unit. It counts as neither a keep nor a drop: the oracle count shows infra errors on their own line per language, the draw's walk fills such a unit's slot from the next candidate for that pass only and the oracle then exits with E_SM_INFRA_GAP, so a pass with an infra error is never the final fill, a rerun resumes those units, and a scoring run with an infra error is a gap, never a score. A run that writes no report still reads no_fresh_report.

**Bare Go test names defined in more than one package (a pre-data build change, 2026-11-09).** Some Go rows' parsers key a test by its bare name (TestHandler, or TestHandler/sub for a subtest) with no package path. Where two packages define a top-level test func of that name, one package's result can overwrite the other's in the parsed log, so a pass can hide a fail. For example, caddyserver__caddy-7567 defines TestHandler in modules/caddyhttp/headers and in modules/caddyhttp/map. For a Go unit the oracle now reads which package dirs define each top-level Test, Benchmark, Example or Fuzz func, from the tree's *_test.go files plus the funcs the base patches add, leaving out the dirs the go tool skips (vendor, testdata, and names starting with . or _). A bare id whose top-level name more than one dir defines leaves both the fail-to-pass set and the stable set, and the unit record lists the fail-to-pass ids and counts the stable ones. A unit whose every fail-to-pass id goes this way drops with its own code, E_SM_AMBIGUOUS_TEST, and so does a Go unit whose scan does not finish. An id with a package path before the test name is never touched, and the rule only ever removes ids. Of the 66 in-window Go rows, 10 have bare ids the rule drops. Only github__gh-aw-26074 loses fail-to-pass ids (4 of 2,217: TestExtractBaseRepo and its subtests, defined in pkg/cli, pkg/gitutil and pkg/workflow), no unit drops whole, and the pass-to-pass ids dropped per row run from 2 to 751. No in-window in-source row is a Go row. On the 56 in-window rows with package-qualified ids (232,585 ids), no two ids in a row resolve to the same package dir and test name, and all but 53 resolve to a dir that defines the test.

**Judged eligibility and labels.** GPT-6 Astra and Opus 5.5 each read the issue text, the fix and the fix's tests (never an arm's output) and answer two frozen questions. Is this a defect a reviewer could see in the code before the fix (the code contradicts its documentation, types, tests or plain intent, crashes on valid input, or leaves state inconsistent), rather than a new feature, option or changed spec? Is it state-shaped by section 2? A unit is eligible only when both say defect. It is state-shaped or other when both agree, and unclear otherwise (kept in every total, left out of the stratum split). Agreement (Cohen's kappa) on both questions is reported.

**Draw.** At most 3 units per repository across admission, any file-scope retry units and test. A seeded draw (draw_seed in the attached prereg.json, minted once from random bytes on 2026-11-09 before any draw and never re-minted) takes 15 admission units from March to June first. It then takes 60 test units, 30 state-shaped and 30 other where supply allows, filling each stratum newest first: every eligible July unit in the stratum in seeded order, then June, May, April and March. If a stratum runs short, the other fills the gap. Admission units never enter the test set.

**Scope.** Each unit's scope is the deepest directory holding every non-test source file the fix changed, widened one parent at a time until it holds at least 10 source files of the unit's language. Its file and line counts are recorded as a covariate.

### 4. What a session gets

- A fresh container from the unit's image digest, with the repository at the base commit and its git history replaced by one commit of the base tree: no remotes, tags, reflog or other objects. A preflight checks the commit count (one on a base tree, two on a follow-on tree built on a first stage), then scans the filesystem (outside /proc and /sys) for any line of 30 characters or more that the fix adds and that appears in no file of the base commit's tree. A hit drops the unit as leaked, before any model call, and drops are reported by reason. The rule stays literal and fails closed: a hit inside a dependency cache counts too, and those hits are reported split into the project's own published packages and other packages.
- The fix's tests are never present before scoring.
- Egress: only the metering proxy, through the existing nftables allowlist. Claude Code's WebSearch and WebFetch are disallowed in every arm, and the proxy refuses any request carrying a server-side web tool. That refusal is an option of the metering proxy, off by default so other lanes' requests pass through unchanged, and on for every session in this family.
- The harness: the outcome-skills rig's agent on Claude Code's own system prompt at the pinned Claude Code version, with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and the frozen environment in every arm. Sol and particle-1 run through the proxy routes earlier runs used, provider pinned, no fallbacks.
- Every arm in this line runs with no gstack, in containers on Ubicloud VMs that hold no gstack install and no drive path, so they are clean by construction. A read audit after the run checks file reads per arm and is reported as a descriptive check. Before arm setup, every arm's snapshot drops CLAUDE.md, CLAUDE.local.md and the files they import from inside the repository, AGENTS.md and .claude/AGENTS.md at any depth, and every .claude/ folder at any depth, because Claude Code loads them as project instructions. The units that had them are recorded. In the /qa arm, gstack's install writes after this strip. The dry run checks from each session's loaded instructions that none of these files reaches any arm and that gstack's instructions reach the /qa arm. With CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 the pinned Claude Code still loads two built-in plugin skills (doctor and plugin-authoring), the same in every arm.

### 5. Arms

Every first-stage arm sends one user turn: its sentence, then this suffix, identical across arms:

> My app is the repository in this directory. Focus on `{scope}`. Don't stop to ask.

- **A0, plain:** "Find and fix the bugs in my app."
- **A1, verbatim:** "Find all of the implicit state machines in my app. Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything."
- **A2, lens swap:** "Find all of the bugs in my app. Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything."
- **S2, refactor lens:** "Find all of the code in my app that most needs restructuring. Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything."
- **S0, untouched:** no first-stage session.

The follow-on (claim 2) is one user turn on the tree a first stage left, by a fresh agent on the same model with no gstack and no transcript of the first stage:

> {issue text}
>
> Fix this issue in this repository. Don't stop to ask.

Claim 1 uses A0, A1 and A2. Claim 2 uses S0, A1 and S2. A1's first-stage sessions serve both claims.

Contrasts. Claim 1: primary A1 minus A0; lens A1 minus A2; framing A2 minus A0. Claim 2: primary A1 minus S0; lens A1 minus S2; S2 minus S0.

### 6. Session limits and how sessions end

First stage: wall limit 5,400 seconds and 200 turns; allowance per session Opus $15, Sol $15, particle-1 $3. Follow-on: 3,600 seconds and 150 turns; Opus $6, Sol $6, particle-1 $1. If admission's 95th-percentile Opus session cost is above half its allowance, the allowance doubles for every model before the test run, and the Captain sees the new projection first.

A session ends when its turn ends and its background tasks are quiet (the rig's rule), or at a limit. Whatever the tree holds then is scored. Nobody answers the agent: a question asked in prose ends its turn and the session is scored as is, and Claude Code's AskUserQuestion tool gets one fixed reply in every arm, the no-gstack arm included: "No one is available to answer. Use your own judgment." Question counts are reported per arm.

- **Completed** or **limit** (wall, turns, allowance): scored as is. An arm's own overruns count against it.
- **Upstream:** a provider or proxy error ended the session. One retry from a fresh container; a second upstream end is a gap.
- **Infra:** the harness failed outside the model (container, pull, scorer crash). One rerun; a second failure is a gap.

- **Test-patch conflict:** the fix's tests won't merge onto the arm's tree (section 7, step 3). A scoring gap, not a miss.

A unit with a gap in any arm of a contrast leaves that contrast. For claim 2, a gap in a first stage removes that tree's follow-ons, and that includes a first stage whose fix's tests conflict on its strict tree (section 7, step 3), counted on its own. A start-set merge conflict (section 8, item 2) is a gap for all three replicates on that tree, also counted on its own. A follow-on gap removes that replicate, and a unit keeps a tree only with at least 2 of 3 replicates. Gap counts are reported per arm and cell, with a worst-case reading that scores each arm's gaps as failures, because the longest sessions (likely A1's) may meet more upstream errors. A cell with gaps on more than 10% of its units is incomplete and gets no verdict.

### 7. Scoring the first stage (claim 1)

1. Extract the arm's change: the working tree's diff against base, untracked files included, binary files listed and left out.
2. In a fresh container from the same digest, apply the change in two frozen readings.
   - **Strict** (claim 1's primary): existing test files (the dataset's test patterns plus each language's conventions) and test and build configuration on a frozen per-language list go back to base. For languages whose unit tests live in source files (Rust's #[cfg(test)] modules and a frozen per-language detector for others), the arm's hunks inside test modules are dropped and its other hunks kept.
   - **Adapted** (reported beside every strict number): the arm's own edits to existing test files are kept, provided every stable-set test id still exists and the arm added no skip marker (a frozen per-language list). A session that fails either condition scores its strict outcome here too.
   - In both, new test files the arm wrote are applied unless they match the protected configuration list. Every exclusion is logged.
3. Apply the fix's tests hunk by hunk with a frozen three-way merge (git apply --3way) over that tree, so a fix's tests that share a source file with the arm's fix don't discard it. A test patch that still conflicts is a scoring gap (section 6), counted per arm, never a miss. Some fixes add their tests inside source files (Rust's #[cfg(test)] modules and the in-source test modules step 2's detector finds). The fix patch's hunks inside such test modules count as the fix's tests: they are never in the base tree or any arm's tree, and they go everywhere the test patch goes: every oracle run, base runs included (so in-source units' stable sets are computed with them), the follow-on start sets, and scoring, under the same conflict rule. The detector is not changed for this. A unit whose fix has a hunk the detector can't place wholly inside or wholly outside a test module drops with reason "mixed test hunk", and those drops are counted per language. The results report how many units scored through in-source tests, per language, with a sensitivity reading that leaves them out. That reading is reported only and never sets a verdict.
4. Run the dataset's own test commands and log parser.
5. **Fixed:** every fail-to-pass test passed. **Broke:** any test in the stable set did not pass (failed, errored, skipped or missing; a build failure misses them all), or a new test the arm wrote failed in three scoring runs.
6. When an outcome rests on 2 tests or fewer, scoring runs twice more and each of those tests takes its majority result. This works in both directions: a fix resting on 1 or 2 fail-to-pass tests, a no fix resting on 1 or 2 failing fail-to-pass tests, and a break resting on 1 or 2 failing stable tests all get the two extra runs. Rerun counts are reported per arm and by direction.
7. Outcomes: **clean fix** (fixed and not broke) is the primary success; fix that broke; no fix; no fix that broke. A session with no change is no fix and not broke.
8. A change that won't apply in the scoring container is extracted once more; if it still fails, the session scores no fix and is listed.
9. Fallbacks, each counted with its own reason: a skip marker added anywhere in the arm's change sends the adapted reading back to the strict outcome; a test-patch conflict on the adapted tree is a gap for that reading only, and the strict reading keeps its own result; a rebuild command that fails misses every test.

Claim 2's follow-on starts from the arm's **full tree**: every edit the arm made, its test edits included, as a real next developer would find it. The fix's tests are never in it.

### 8. The follow-on (claim 2)

1. For each unit, start three follow-on sessions on each of three trees: the base tree (S0), A1's full tree and S2's full tree, each in a fresh container from the unit's digest with the one-commit history (a first stage's change is committed on top as a second commit).
2. Each tree's **start set** is the tests that pass in all of three runs of the dataset's test commands on that tree before any follow-on, each run with the fix's tests applied as in section 7, step 3. On S0 it is the base stable set. If the fix's tests won't merge onto an A1 or S2 tree for these runs, every follow-on replicate on that tree is a gap (section 6).
3. Each follow-on's own change, its tree against the start tree, is scored under section 7's strict reading: existing test files and protected test and build configuration go back to the start tree, its hunks inside in-source test modules are dropped, and its new test files are applied unless protected. The fix's tests are then applied as in section 7, step 3, and the dataset's tests run, with two scores:
   - **Incremental** (claim 2's primary, the structure measure): every fail-to-pass test passes and no test in the tree's start set fails. It asks whether the next fix went through cleanly on the code it was given.
   - **End to end** (the key secondary, net value to a user): every fail-to-pass test passes and every test in the base stable set passes. Whatever the first stage broke and the follow-on didn't repair fails here.
   - The same two scores on the follow-on's whole change, with nothing restored, are reported beside them and never set a verdict.
4. A unit's score on a tree is its mean over the replicates. Each contrast is the paired difference of those means between trees.
5. **Inherited fixes.** If the first stage already fixed the target bug, the follow-on usually passes on both scores. That is part of what a user of the prompt gets, so it counts. The count of first stages that already clean-fixed the target is reported per arm, with a sensitivity reading that leaves those units out (labelled as conditioned on the outcome).
6. **Drift.** A follow-on is a drift case when the fix's tests fail only because they name an identifier present in the base tree and absent from the start tree. A frozen per-language detector decides: for compiled languages, a compiler error naming such an identifier; for JS, TypeScript and Python, an import, attribute, reference or not-a-function error naming one. A drift case fails both scores, because a later contributor's tests broke. The drift count is reported with a sensitivity reading that leaves drift units out.
7. Keyless follow-on secondaries: cost, turns and wall time per follow-on; whether the follow-on read any file the first stage created (docs, tables); files changed.

### 9. Attacks on the scoring, answered before code

| Attack | Answer |
|---|---|
| The agent looks up the real fix online | No egress but the proxy; web tools off in every arm; history cut; leak scan |
| Future commits sit in the image | One-commit history; leak scan for lines the fix adds that appear nowhere in the base tree |
| The agent edits or deletes tests to pass | Existing test files and test configs are restored, in first stages and follow-ons alike; the fix's tests are applied over them |
| A new test file games the runner | New files matching the protected config list (conftest, build scripts, runner configs) are not applied; others are, and a new test that fails in three scoring runs counts as a break |
| A refactor renames code and updates its own tests | Strict and adapted readings (section 7); follow-ons start from the arm's full tree |
| The fix's tests share a source file with the arm's fix (Rust and others) | Hunk-level three-way merge of the fix's tests; a conflict is a counted gap, never a miss |
| The agent skips tests | Only a pass counts; skipped counts as broken |
| Flaky tests decide outcomes | Three base and three fixed runs pick units and the stable set; outcomes on 2 tests or fewer get a 2-of-3 rerun; follow-ons run three times |
| A fix that needs a new dependency installed in the session | Scoring runs in a fresh container; only source carries over, as in a real pull request; dependency file changes are logged |
| A huge refactor that happens to fix the bug | Counts if nothing broke; diff size is reported, and the DX judge sees it |
| Edits outside the folder | Allowed and scored |
| The folder line points at the bug | Identical for every arm and compared within unit; scope size is a covariate |
| Claim 2 credits a first stage's breaks or fixes to the structure | The incremental score measures against the start tree; end to end is reported as net value; inherited fixes are counted with a sensitivity reading |
| Claim 2 punishes a refactor for renaming internals the fix's tests use | Counted as drift by a per-language detector, a real cost to the next contributor; drift count and sensitivity reported |
| Gaps fall more on the longest sessions | Gap counts per arm and a worst-case reading that scores gaps as failures |
| The follow-on agent reads the first stage's transcript | It gets only the tree; the first stage's session files are not in the container |
| A model asks a question or does nothing | No fix; reported per arm |
| Arm identity leaks to the judge through comments | Partial blinding only; stated as a limit |
| Training-data contamination | July stratum reported alone |
| One repository dominates | 3 units per repository at most; intervals bootstrap over repositories |
| Provider drift over the run | All arms and follow-ons of a unit run in the same part, interleaved in an order seeded by order_seed in prereg.json |

### 10. Secondaries

- **Found it (keyless):** the first stage's change touches a line within 20 lines of a hunk the real fix changed, in the same file. Found but not fixed is reported.
- **What it changed (keyless, descriptive):** files and lines changed, files outside the folder, test files written, build files touched, generated files changed (a .gitattributes linguist-generated mark or a "generated" or "do not edit" header in the first 5 lines), and new state constructs (a frozen per-language pattern list: enums, sealed types, state unions, transition tables).
- **Later-fix overlap (keyless, exploratory):** for each changed hunk outside the real fix's lines, whether an upstream commit within 120 days after the base commit, titled as a fix (a frozen word list), changed lines within 3 lines of it. The target fix's commit is excluded. It counts other real bugs an arm may have fixed, without a judge.
- **UX, DX and AX (judged, R78):** each judge sees the folder's file list and a first-stage diff (cut at 1,500 lines, with a flag), never the issue, the fix, the arm or the session. It rates UX, DX and AX each from -2 to +2 with a reason, and says for at most 8 hunks (largest first) whether each changes a real defect. GPT-6 Astra judges Opus sessions; Opus 5.5 judges Sol and particle-1 sessions. Every 50 diffs, each judge also gets three stock diffs (comments and whitespace only, a rename-only refactor, logging added everywhere); a judge that scores a stock diff above 0 on more than 10% of them has its secondaries flagged. Scores are reported within diff-size thirds as the volume control.
- **R78 check:** a labelled set of 48 items, built before any judge call from units' base trees only, never from an arm's output or a session file. Units are taken in draw order. Each gives six items from the same base-tree file its stock diffs come from: three known-bad plants and its three stock diffs, which count as known-neutral. Each plant aims at one axis. UX: the first if condition in the file is negated, a behavior change users see. DX: every full-line comment in the file is deleted (the file needs at least 3). AX: every string literal on a line that raises or builds an error becomes "failed", the text an agent reads to find a fault. A unit that can't give all six is skipped and the next one taken, until 8 units give 24 known-bad items (8 per axis) and 24 neutral ones (8 per stock kind). They go out as ordinary judge packets, blind like every other, and both Astra and Opus grade all 48. A catch is the judge's score on the plant's axis below 0. A false fail is a score below 0 on any axis of a neutral item. A malformed answer is a miss on a known-bad item and a false fail on a neutral one. Neutral items scored above 0 are counted as for the stock flag above. Each judge's catch rate and false-fail rate print with their counts, and beside every result prints Cohen's kappa per axis between Astra and Opus over the first 60 real first-stage diffs in seeded order, which both judges grade. A judged difference on an axis counts as a finding only at kappa 0.6 or more (R78), and otherwise reads "judge failed its check". The share of those 60 diffs where both judges give the same sign on every axis prints as one descriptive line and decides nothing: with Astra and Opus as the judges it can't give a catch or false-fail rate.
- **No owner labels.** The finding file's claims rest on the test-graded scores. The judged ratings appear in it as model-checked, not owner-checked, and lead nothing.

### 11. Exposure (R48's procedure gate)

- **A1:** the assistant's text after its first tool call says "state machine" or "transition" (keyless). Reported beside every A1 verdict.
- **S2:** the assistant's text after its first tool call says "refactor" or "restructur" (keyless). Reported.
- **No-gstack read audit:** section 4.

### 12. Admission (E1)

Before the test run, on the 15 admission units, Opus 5.5 only: A0 and A1 once each (30 sessions), and the follow-on three times on the untouched tree (45 sessions). It also exercises the whole rig: the leak scan, the history cut, both scorers and the ledger.

Readings:

- **Claim 1 FLOOR:** fewer than 3 clean fixes across the 30 admission sessions (A0 and A1 together). The scope rule switches to the fix's changed files for every arm and model, and 15 fresh admission units rerun the same check at file scope. If that also reads FLOOR, claim 1 stops and is reported as a finding (neither prompt fixes these real bugs blind at a rate we can measure on Opus), and A0 and A2 are not run. Claim 2 continues at folder scope.
- **Claim 2 headroom:** the untouched-tree follow-on's mean (incremental score) on Opus must sit between 0.15 and 0.90. Above 0.90 is CEILING for Opus: one raise attempt (R61) cuts the follow-on's issue text to its title and first paragraph, checked on the same 15 units. Still above 0.90 means claim 2 reads CEILING on Opus and runs on Sol and particle-1 only. Below 0.15 is FLOOR for claim 2, and it stops.
- **Cost:** the Opus 95th-percentile session cost is checked against section 6.
- **INFRA:** gaps on more than 10% of either admission cell. The harness is fixed with the Captain before the test run; nothing is rerun to change an outcome.

Admission decides nothing about either claim, and its units never enter the test set.

### 13. The test run, and the stage 2 rule

On the 60 test units and all three models: A0, A1, A2 and S2 once each (720 first-stage sessions), then the follow-on three times on each of S0, A1 and S2's trees (1,620 follow-ons). All sessions of a unit run in the same part, in an order seeded by order_seed (prereg.json).

**Claim 1's stage 2 rule (frozen).** The 60-unit run is the whole claim 1 test. On a model where A1 clean-fixes more test units than A2, claim 1 gets a stage 2 on that model: 120 fresh units drawn by the same rule, A0, A1 and A2 once each, priced from the test run's measured cost (about $1,110 for Opus or Sol and $140 for particle-1 at planning prices). It needs a cap the Captain records first, and a projection past $5,000 all-in goes to the owner. Stage 2 is analysed on its own units with its own verdict and never pooled with the 60. Its units come from what remains after the test draw, most likely March to June because July fills first, and the results say so. On a model where A1 does not beat A2, claim 1's result on that model is final at n = 60.

Claim 2 has no stage 2 in this line.

### 14. Analysis and verdicts

- **Claim 1 per model:** A1 minus A0 (primary) and A1 minus A2 (lens), each the paired difference in clean-fix rate with a 95% interval from a bootstrap over repositories (10,000 resamples, bootstrap_seed in prereg.json), the exact McNemar p and the counts of units that got worse and better. The break-rate difference is reported beside each.
- **Claim 2 per model:** A1 minus S0 (primary) and A1 minus S2 (lens), each the paired difference in per-unit mean incremental follow-on score, with a 95% interval from a bootstrap over repositories, an exact two-sided paired sign-flip permutation p (each unit's difference flips sign, and p is computed exactly by convolution, not by sampling), and the counts of units that got worse and better. The same contrasts on the end-to-end score are reported beside them as net value.
- **Verdicts per claim and model:** HELPS when the primary's bootstrap interval lower bound is above 0 and its exact p (McNemar for claim 1, the sign-flip permutation for claim 2) is below 0.05; HURTS when the upper bound is below 0 and the exact p is below 0.05; otherwise NO MEASURABLE DIFFERENCE, stated with the MDD. "Breaks more" is added when the first stage's strict break-rate difference against the comparison arm (S0's is zero) has its interval above 0. Each verdict also prints the gap worst-case reading.
- **Lens readings:** the lens contrast reads "the lens helps" or "the lens hurts" on the same interval rule, and otherwise "no measurable lens effect" with its MDD. When claim 1 stops at n = 60, the lens upper bound states the largest lens gain the data leaves open.
- **Pooled:** each contrast pooled across the three models with a bootstrap stratified by model. Descriptive.
- **Strata:** claim 1 within state-shaped and within other units, with the difference of differences and its interval. Descriptive.
- **July stratum:** every primary on July units alone, reported beside the full one.
- Every comparison is paired, with its interval and the count of units that got worse (R78 item 3). Claim 2's follow-ons report pass^3 per tree beside the mean.

### 15. Power and MDD

From the attached power.py (80% power, two-sided alpha 0.05).

Claim 1, paired binary, n = 60 per model: MDD 11.4, 14.0, 16.2 and 19.8 points at discordant shares of 0.10, 0.15, 0.20 and 0.30 (12.5 to 21.7 with a design effect of 1.2). Pooled over three models (180 unit-model pairs, design effect 1.2): 7.2 to 12.5. If the prompt is truly 10 points below the swap at a discordant share of 0.20, the expected 95% upper bound on A1 minus A2 is +1.0 points; at no true difference and 0.15, +9.8. So a claim 1 run that stops at n = 60 is expected to rule out a lens gain of about 10 points or more on a model, which is the smallest gain worth folding in; whether it does is read from the actual bound.

Claim 2's incremental score, per-unit means of 3 follow-ons, n = 60, with unit success rates drawn from a mixture typical of SWE-style tasks: MDD 9.9 to 11.0 points, 10.8 to 12.0 with a design effect of 1.2. One follow-on per tree would give 16.8 to 19.6; that is why each tree gets three. The incremental score is measured against each tree's start set, so first-stage breakage does not enter it. The end-to-end score does: if the first stage leaves a stable test broken on 5, 10 or 20% of trees, its MDD is 13.1, 14.0 or 15.8 points.

The July stratum alone (likely 30 to 45 of the 60) reads as a check, not a verdict.

### 16. Money (internal)

Planning prices, replaced by admission's measured costs. Per session: blind first stage, Opus $3.00, Sol $3.00, particle-1 $0.30; follow-on, Opus $0.70, Sol $0.80, particle-1 $0.10; VMs $0.08. Model prices from src/runner/pricing/prices.ts (per million tokens, input and output): Opus 5.5 $4 and $20, GPT-6.1 Sol $2 and $10, particle-1 $0.10 and $1, GPT-6 Astra $10 and $50. R3's measured SWE-rebench sessions with the issue given cost $0.37 to $0.62 on Opus, and blind sessions and compiled languages are priced at several times that.

| Item | What | Central | Cap |
|---|---|---|---|
| sm-labels | Astra and Opus eligibility labels, about 450 candidates | $100 | $150 |
| sm-oracle | VMs only, three base and three fixed runs per candidate | $40 | $60 |
| sm-admit | 15 units, Opus: A0 and A1, and 3 untouched-tree follow-ons; the cap covers the file-scope retry and the ceiling-raise attempt | $128 | $270 |
| sm-opus | 60 units: A0, A1, A2, S2; 3 follow-ons on S0, A1, S2 | $1,160 | $1,400 |
| sm-sol | the same on Sol | $1,214 | $1,460 |
| sm-particle | the same on particle-1 | $188 | $230 |
| sm-judges | R78 check, UX/DX/AX on 720 diffs, stock diffs | $145 | $180 |
| Crew model use | exploration, planning, build, /ship, runs, results, from the counters | $250 | counted, not capped |
| **Total** | | **$3,226** | **$4,000** |

The sm-judges calls, priced by `sm packets r78-price` with prices.ts prices at a bound of 20,000 input and 1,500 output tokens a call (Astra $0.275, Opus $0.11): 720 real diffs (240 by Astra, 480 by Opus), 39 stock diffs, the second grade on the R78 check's 60 real diffs (at Astra's rate) and 96 grades of the 48 labelled items. That is $160.05 in all, inside the $180 cap; the labelled items add $18.48 of it.

Caps are 1.2 times central on model items, and the admission cap covers its two retry branches (worst case about $255), so central plus reserve sits inside the $4,000 line. The admission readings re-price sm-opus, sm-sol and sm-particle before the test run; a re-priced cap that would take the line past $4,000 comes to the Captain with the measured figures, and past $5,000 projected goes to the owner. A cap stop ends that part incomplete and is never retried to change a verdict. Claim 1's stage 2 is outside this line (section 13).

### 17. The separate /qa line

gstack's router sends "find bugs" to /qa. /investigate was cut on 2026-11-08, /health is a quality dashboard that fixes nothing, and /review reads a diff that doesn't exist here, so /qa is the nearest gstack skill that claims this job.

- **A3, gstack /qa told:** "/qa Find and fix the bugs in my app." plus the shared suffix, with gstack installed at the pin (garrytan/gstack main on the freeze date, recorded by sha and version) and run unattended, on the same 60 test units and three models. Scored by section 7.
- **Contrast:** A3 minus A0 (R44's gstack against no gstack), reusing this line's A0 sessions, with A3 minus A1 reported beside it.
- **Exposure:** gstack's skill start ran for qa, and the session read /qa's SKILL.md and at least one of its section files. The verdict reads as fair at 80% exposure or more, and otherwise as "told /qa as the model ran it", with the rate. 5 admission sessions on Opus check exposure first.
- **R48:** a null is FIX-METHOD on task fit, never a CUT-CANDIDATE from this family alone, because /qa's main claim is testing a running site, API or CLI.
- **Money:** Opus $440, Sol $440, particle-1 $50 and admission $50 at caps, central about $860 with crew use. A separate $1,100 line, because it doesn't fit inside the $4,000 with reserve.

### 18. Build, pins, dry run and stops

The build lives in lanes/outcome-skills as a new family with its own converter, arms, scorer and analysis:

- A SWE-bench-Live MultiLang converter to the rig's task format, reusing the SWE-rebench converter in quick/laneb/runner/materialize.ts as its source, with images pinned by digest and the dataset's own test commands and parsers.
- Unit preparation: the one-commit history, the leak scan, the scope rule and the oracle preflight.
- The arms in the registry, with web tools off, the shared suffix and the follow-on turn.
- The first-stage scorer (section 7), the follow-on runner and scorer (section 8) and the keyless secondaries.
- The labeller and judge packets, with R78's check.
- analysis and power for sections 14 and 15.
- Reason codes in src/errors/codes.ts for each drop, gap and exclusion path: leaked, oracle unstable, slow test command, runtime smoke failed, apply failed, test-patch conflict, upstream gap, infra gap and cell incomplete. Each drop logs its code and the values that tripped it.

Keyless tests cover each rule. A dry run with a stub model drives every frozen rule before any spend: one ledger lease opened and settled per item on a temporary ledger, the leak scan, the history cut, and the scorers on three real units with the real fix (clean fix), the base tree (no fix), a planted breaking change (broke), a test-editing change (restored under strict, kept under adapted only when every stable test id survives), a skip-inserting change (broke), a refactor that renames a function and updates its tests (strict broke, adapted clean), a Rust unit whose fix and tests share a file (merged, clean fix), a Rust unit whose tests live in the fix patch (a correct arm fix scores fixed, a wrong one scores not fixed, and no test hunk text reaches the arm's tree), a renamed symbol the fix's tests use in a compiled language and in an interpreted one (drift), and a follow-on on each with both scores.

Pins: dataset revisions, image digests, Claude Code version, gstack sha and version (the /qa line), harness commit. Long runs follow the crew rules: controllers detached on a named runner VM, a registered wait on every watcher, UBI_OWNER set, TTLs covering the longest part, apt disabled at boot, and every VM deleted at the end.

### 19. Custody, outside terms and public safety

The units are public datasets and public repositories. SWE-bench-Live MultiLang is MIT-licensed and the SWE-rebench leaderboard is CC-BY-4.0. Licences are rechecked at freeze, and a source whose licence bars evaluation use is dropped. The finding file and any committed task-id list carry an attribution line for SWE-rebench, and no dataset rows are redistributed. We publish task ids, digests and aggregate results, never repository code. At freeze we record that Claude Code's terms allow driving non-Anthropic models through our proxy, as earlier lanes did, and that the providers' terms allow GPT-6 Astra and Opus 5.5 as judges. Each repository's code runs only inside its container. Model use is ordinary API use. Nothing here is sealed: the units are public and the arms are fixed text, so nothing can be tuned on them, and the draw seed is frozen before anyone sees which units it picks. The exploration's repositories appear only as generic findings and bug classes. The private project is never named, and no owner's words are quoted.

### 20. How the rules map

- **E1:** section 12's admission readings come before any test session.
- **R44:** A0 is the no-gstack plain arm; the /qa line reports A3 minus A0.
- **R48:** every null on a primary gets one Why-null cycle: exposure (section 11), task fit (strata, and claim 2 for what the prompt actually does), power (section 15), and whether plain Opus already does it (A0, S0). For a prompt that isn't in gstack, KEEP reads "fold it in for this job" and CUT-CANDIDATE reads "don't fold it in for this job".
- **R51:** this plan gets one lean reviewer and one round. The preregistration PR carries scorer code, a gate-class risk in this repository, so /ship runs the depth gstack's planner prints for it, with at most 2 rounds.
- **R54:** Opus 5.5, GPT-6.1 Sol and particle-1, every arm on every model.
- **R61:** claim 2's ceiling check has its one raise attempt in section 12; claim 1's likelier limit is the floor, with its one file-scope attempt.
- **R71:** a $4,000 line because Astra judges; the /qa line is separate at $1,100; past $5,000 projected goes to the owner.
- **R77:** two merged PRs, this preregistration (with the build) and the results.
- **R78:** sections 10, 14 and 15.
- **R79:** the public lesson is in "Why it matters"; the finding file opens with what we learned.
- **Construct fit:** section 1.

### 21. What happens with the result

The results PR carries a finding file in the insight plan's template, opening with two or three takeaways as R79 asks. The workflow Captain uses it for the blog post. The gstack Captain decides whether gstack folds anything in; this post only recommends:

- Claim 1 HELPS and the lens helps: try the lens in /qa and in gstack's failure guidance, behind the gstack Captain's own before-and-after test.
- Claim 1 null or HURTS, claim 2 HELPS on the incremental score: the prompt is a structure pass, not a bug finder. Offer it as an opt-in structure step and say in the post to ask for bugs when you want bugs.
- Both null: the post says what plain prompts already do, with the numbers, and nothing is folded in.
- Any "breaks more": the post says so plainly, whatever else holds.

### 22. Risks, limits and not in scope

- Floor: blind bug finding may be rare enough that claim 1 sits near zero; admission finds this for about $130.
- The scored languages (Rust, Java, C, C++, C#, Go, JS, some Python and TypeScript) differ from the owner's TypeScript and game code. The bug classes carry over; idioms may not.
- Libraries and tools dominate, so UX has less to act on than in a product with screens.
- The folder line tells every arm roughly where to look; claim 1 is about finding a bug within a folder.
- Claim 2's follow-on is one later change, a bug fix with its report given. It doesn't see longer payoffs or feature work. It also always lands in the folder the structure pass was pointed at, so it measures a best case for the restructuring.
- One first-stage session per cell: per-unit noise stays in the intervals; pass^k applies only to the follow-ons.
- The judge is only partly blind, because A1's comments may name state machines.
- Not in scope: gstack running the verbatim prompt, other stacks, and seeded or synthetic bugs.

## Review record

One lean reviewer (Opus 5.5, CEO, Eng and DX lenses) read the implementation plan once and raised 16 findings: 3 High, 8 Medium, 4 Low and 1 informational. The project owner accepted every recommendation, and this revision applies all 16.

- High: protected-path restore would score every refactor that updates its own tests as a break (section 7's strict and adapted readings, and full-tree follow-ons); in-file unit tests would make file-level protection discard the arm's real fix (hunk-level three-way merge, conflicts as gaps); claim 2's end-to-end primary mixed inherited breaks and fixes with the structure effect (the incremental primary, section 8).
- Medium: one rule for failing new tests (section 7, step 5); the leak scan ignores lines already in the base tree (section 4); exact tests beside the bootstrap, "expected to rule out", and stage 2 analysed alone (sections 13 to 15); a floor tied to room (section 12); the admission cap covers its branches (section 16); runtime smoke, labels first and a lazy oracle under the pull limit (section 3); a per-language drift detector (section 8); reason codes (section 18).
- Low and informational: the converter's reuse source (section 18); commit counts per tree type and the best-case limit (sections 4 and 22); gap counts per arm with a worst-case reading (section 6); SWE-rebench attribution and a terms check at freeze (section 19).

## Disclosures

Filled at the results post. Particle's disclosure line applies, because particle-1 is a model under test.
