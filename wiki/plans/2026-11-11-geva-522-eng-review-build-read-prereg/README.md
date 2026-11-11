---
id: 2026-11-11-geva-522-eng-review-build-read-prereg
kind: plan
title: "Preregistration: does a plan reviewed by gstack's engineering review lead to code that passes the real later fixes' tests? Opus 5.5 builds each change from each arm's reviewed plan, graded by the tests the real team wrote when it fixed the change's bugs"
summary: "Supersedes the 2026-11-08 prereg after stage 1 floored. Judge-free build read on real changes, with a headroom pilot, an exposure gate and a fixed test sequence."
author: GEVA-522
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-11
status: open
supersedes:
  - 2026-11-08-geva-405-eng-review-intentions-prereg
links:
  - 2026-11-08-geva-405-eng-review-intentions-prereg
  - 2026-11-11-geva-434-eng-review-intentions-stage-1-results
  - 2026-11-09-geva-412-plan-mode-intentions
  - garrytan/gstack-evals#276
  - garrytan/gstack-evals#328
attachments:
  - b4f6a1653058e809185eb2a9ecef08842cb1c3cf001b83f11d0afc050853c39b  power.py
  - 47f29cf29c8a2935d3220e4caae058aecf35aa2fe980ea6c026baa68e236244f  power.txt
---

# Preregistration: does a plan reviewed by gstack's engineering review lead to code that passes the real later fixes' tests?

## Approval

Gate 1 approved on 2026-11-11, after one lean gstack /autoplan review (run autoplan-20261111153348, gate revision 1, one Opus 5.5 reviewer) and one GPT-6.1 Sol outside reader the Captain asked for, by the Captain (approval record r-9508324db40f). The Captain took every recommendation: the authoring price kept at about $20 a usable unit (A), the fixed test sequence (B, made a true sequence that stops at the first test that doesn't reject), the five High review fixes (C to G), approval with those changes (H), every finding of the outside reader (I), the conditional Sol and particle-1 stage with its projection going to the Captain and the owner before any spend (K), and the token plan for the build (L). The comparison size (J) went to the project owner: SIZE_RULING. This post approves no item's spend: no paid call runs until it merges and the Captain records each item's cap.

## ELI5

gstack's plan-eng-review is meant to make the code that gets built better: it maps the change's code paths, finds the ones with no test, and adds the tests and edge cases a careful engineering manager would ask for. Our first attempt asked whether a review names, in words, the paths where a change's real later bugs landed. Plain Opus did that for about 9% of them, which is too close to zero to compare anything, because most of a change's later bugs can't be foreseen from its plan. This attempt asks the question that matters more: when a builder implements a plan that each arm reviewed, does the code pass the tests the real team later wrote when it fixed the change's bugs? We take real changes merged in July to September 2026 whose later fix came with a test. That fix's test fails on the real merged code and passes on the fixed code, so it is a ready-made, judge-free check of whether a build has the bug. Opus 5.5 builds each change from the plan, once with no review, once after a plain Opus review, and once after each gstack review, and a machine runs the real fix's test on every build. A small pilot of the no-review and plain-review builds runs first, with floor and ceiling lines written now, and the skills' procedures are enforced and checked before any comparison money is spent.

## Before → after

Before: the first attempt's prereg (#276) asked whether each review's test plan names where the real aftermath landed. Stage 1 read FLOOR on 2026-11-11 (results post #328, code tagged eng-review-intentions-stage-1 at 47acea4): plain Opus 5.5 scored 0.087 (95% CI 0.007 to 0.191) on 16 calibration units, with a judge that passed its check (kappa 0.949). The floor sits near its edge: on real lists the gold held only 6 anticipated cells and the judge credited 4, so if it under-credits that much everywhere, Opus's rate would be near 0.13. Either reading is too low to compare arms. The R48 verdict is FIX-METHOD on task fit. The build read stayed a descriptive section 12 that never ran, and nobody had counted which units can serve it. A keyless container probe now has: 21 of the 52 audited units with a test-changing aftermath qualify, and 18 of them are clean for the comparison.

After: a frozen test whose primary is test-graded and needs no judge: the share of each unit's real later-fix test cases (fail-to-pass on the merged code, tied to a keyed bug) that pass on the code Opus builds from each arm's reviewed plan, paired by unit, with a 95% interval and the MDD stated now. A headroom pilot gates the arms' money, an enforced-procedure exposure gate gates each skill arm, and the harness runs on main's metering proxy.

## Why it matters

The project owner asked on 2026-11-08 for an eval of what plan-eng-review is for: mapping the code paths, raising coverage and thinking through tests, end-to-end tests, CI and evals. The crew's plan-mode rule forbids a cut on a null that leaves the skill's main intentions untested, and stage 1 tested only whether a review can name later bugs in words. ENG-2 (every changed behavior ships with a test that would catch a real regression) and ENG-3 (edge cases and failure modes handled) are main intentions whose strongest observable is the build, so until a build read runs, gstack can't tell whether the cut threw away something that works, whether autoplan's eng phase still carries it, or whether the rebuilt /plan-coverage should ship.

## What caused this work

Stage 1 of the first attempt read FLOOR (GEVA-434, 2026-11-11), which section 10 of #276 named as the trigger to make section 12's build read the next attempt's primary. The Captain asked for this plan, its prereg and its harness on main in one PR, with the supply read, headroom pilot, exposure gate and money settled first.

## Big decisions

1. **Primary.** Options: (a) the aftermath pass share of each build (real later-fix tests that pass on the built code); (b) real-bug catch (the build's own tests, moved onto the real merged and fixed trees, go red then green); (c) changed-line coverage of the build's own tests; (d) functional solved. Pick (a). Why: it is the closest judge-free reading of "does the code avoid the change's real later bugs", it is graded by the real team's own test with no judge, and every build gets a score. (b) asks for a test of a bug nobody named, which stage 1 says almost never happens, so it is likely to floor; (c) has headroom but no tie to real bugs; (d) is a guard, not the claim. What would flip it: the pilot showing that aftermath tests can't run against independently built code (reach under 0.60).
2. **One pooled primary, then the arms in a fixed order.** Pick the mean of the three gstack review arms minus the plain review, on Opus, as the single primary test at alpha 0.05. Then a true fixed sequence: the candidate minus plain, then the pre-cut skill minus plain, then the eng phase minus plain, each at alpha 0.05. Confirmatory testing stops at the first test that doesn't reject, the pooled one included, and every later arm is reported as descriptive with its interval. Holm prints as a sensitivity reading. Why: at 48 units and 3 builds a cell, the pooled contrast reaches the 10-point smallest effect worth acting on (MDD 0.100 to 0.105 at the simulation's settings), a single arm reaches about 0.127 in the fixed order and 0.146 to 0.151 under Holm, and the order puts the ship decision first. What would flip it: money for about 96 units, where per-arm contrasts reach 0.10 on their own.
3. **What the builder gets.** Options: the old normalized eng-plan block, or the review as each arm leaves it. Pick the review bundle: the final plan.md, the final reply and the files the skill wrote, capped at 12,000 words. Why: the skill's claim runs through its own artifacts (the coverage diagram and the test plan), and the block strips them. Word counts print beside every contrast, with a length-adjusted secondary.
4. **Exposure.** Every skill arm runs with the harness Stop hook from the start (it blocks a stop at most twice while the frozen detector shows missing outputs), and is named "with an enforced procedure": every verdict names the whole package tested (forced invocation, the Stop hook and the review bundle), and each arm prints its share of sessions exposed before any block. A 6-session Opus smoke per arm must show at least 5 exposed before that arm's comparison cells run. Why: in stage 1's smoke, 18 of 18 skill sessions ended on their own with no question asked, and 5 of the 7 unexposed ones missed only one to three named outputs, which a stop message can ask for.
5. **Arms.** No review; a plain Opus review with no gstack (R44); the pre-cut /plan-eng-review at b493d4e31; autoplan's eng phase at 199931029; the candidate /plan-coverage at 57295cbc. The lens arm is dropped: it would add a build arm at about $5 a unit for a framing question the primary doesn't need.
6. **Sol and particle-1 (R54).** As reviewers, never builders: the skill runs in the reviewer, and a fixed Opus builder isolates what the review changes. Their exposure smoke runs unconditionally (about $27). Their comparison cells (Opus builds, 2 builds a cell) run only when the Opus pooled primary reads helps, because a null on Opus reviews leaves nothing to transfer and the cells cost about $2,900. Why not always: at 1 build a cell they read nothing (pooled MDD about 0.17) for about $1,450.
7. **Supply.** 18 clean units already qualify (a keyless container probe on the 52 audited units with a test-changing aftermath: 21 qualify, 3 of them calibration). The other 30 of the 48 are new build units from the same mined pool (517 unauthored candidates in 76 repositories), screened by the probe's fail-to-pass check before any model call and keyed with F8. Units lean to developer tools and consumer code in Node, Go and Python, because server, mobile, PHP, Ruby and JVM units rarely qualify; the post states it as a limit. Before the pilot, the 21 qualifiers are recounted in the verifier's own sandbox with 3 runs a tree and a stricter case rule (a later-fix case counts only when it fails on an assertion, never on a missing name or a load error); fewer than 16 clean units comes to the Captain. The pilot and the exposure gate both run before any new unit is paid for.
8. **Verdict words.** KEEP for an arm needs its own contrast, in the fixed order, to read helps with functional solved not worse. Verdicts take a fixed precedence (untested, then the candidate's cut rule, then KEEP), so no arm gets two. No CUT-CANDIDATE comes from this eval for the pre-cut skill or the eng phase, because ENG-1, ENG-4, ENG-5, ENG-6 and ENG-7 stay untested; a null reads FIX-METHOD with its MDD. The candidate reads CUT-CANDIDATE (don't ship it) only when its upper bound sits below +0.05.
9. **Money.** The design that answers the question projects about $5,300 all-in on the line (about $6,710 at caps) with the Sol and particle-1 cells unspent, and about $8,210 if their conditional stage runs. That passes both the $4,000 line and the $5,000 mark, so it goes to the Captain before the gate closes, beside two smaller designs: 40 units with 3 builds a cell (about $4,660, pooled MDD 0.110 to 0.114) and 40 units with 2 (about $3,930, MDD 0.132 to 0.141). If the pilot stops, the line ends near $1,800.

## Implementation plan

### 1. Claim, construct fit and intentions scored

plan-eng-review's claimed value (the inventory at b493d4e31, wiki/research/2026-11-09-geva-412-plan-mode-intentions/inventory-plan-eng-review.md): lock in an implementation plan before code is written, so that architecture, data flow, edge cases, test coverage and performance are checked against the real code. This eval scores what ships, through the real team's own later fix tests:

- **ENG-2** (every changed behavior ships with a test that would catch a real regression): primary through the aftermath pass share, and secondaries through real-bug catch and changed-line coverage.
- **ENG-3** (edge cases and failure modes handled): primary, since the later fix's failing case is usually an edge or failure path the change left unhandled.
- **ENG-8** (a build-ready plan the implementer can follow): partly, through functional solved.
- Untested: ENG-1 (architecture), ENG-4 (scope), ENG-5 (verified facts), ENG-6 (the user decides; arms run unattended), ENG-7 (performance) and every secondary intention. So no CUT-CANDIDATE for the pre-cut skill or the eng phase can come from this eval (CREW plan-mode rule). The candidate's frozen intentions statement (prereg #276, section 15) is the path map, coverage map and test plan "so the shipped change has fewer untested paths and catches its regressions", which this eval covers except for its CI lanes and evals.

Construct-fit check, stated now: a review that makes the builder handle the edge case where the real bug lived raises the primary; a review that only adds words doesn't, because only the real fix's test cases score. What the primary can't show on its own is that a bug was avoided rather than an interface matched, so anchor cases (cases in the same fix test files that pass on both the merged and the fixed tree) and T items print a compatibility measure beside it, and every verdict says "passed more of the real later fixes' tests", never "avoided bugs".

### 2. Supply read (done before the gate, no spend)

From the records alone, the count the Captain asked for is unknown: no record says whether a unit's suite runs in a container, and nobody had checked (stage 1's next-attempt note says the same). So the read was done from the sealed checkpoint (custody opening 1 in this attempt's custody log, counts only) and public clones, in two steps.

**Step 1, keys and commits.** 79 audited units: 16 calibration, 56 comparison (mobile 9, consumer 14, server 14, devtools 19), 6 reserve and 1 in no set. Their keys hold 85 primary B items, 6 primary T and 28 primary C. A fix or follow-up commit changes test files in 57 of the 85 B items (48 of 74 fix-sourced, 9 of 11 user-issue-sourced) and in all 6 T items. That leaves 52 units with at least one candidate aftermath test: comparison 38, calibration 9, reserve 4 and the unassigned 1. By type: devtools 21, server 13, consumer 12, mobile 6. By language: TypeScript 13, Go 11, Python 8, Kotlin 3, Rust 3, PHP 3, Svelte 2, Ruby 2, Java 2 and one each of JavaScript, Vue, Dart, C++ and Swift. 51 of the 52 merges also change test files, the functional hidden tests.

**Step 2, container probe.** A keyless probe (Docker and git only, no model call; its code becomes the harness's recipes) built each of the 52 units' trees from public clones and ran their tests in containers with no network, one run per tree. 21 of 52 qualify: per-case results at base and at the merge, and at least one aftermath case that fails at assertion level on the merged tree with the fix's test files and passes on the fix.

- By set: comparison 16 of 38, reserve 2 of 4, calibration 3 of 9, unassigned 0 of 1.
- By type: developer tools 11 of 21, consumer 6 of 12, server 3 of 13, mobile 1 of 6.
- By ecosystem: Node 9 of 14, Go 4 of 10, Python 4 of 7, Node with Rust 3 of 3, Node with Python 1 of 2. PHP 0 of 3, Ruby 0 of 2, JVM 0 of 6 and Go with Node 0 of 2; Dart, Swift and one unit with no test source have no recipe.
- The qualifiers hold 325 aftermath cases (median 6 a unit, range 1 to 136) from 23 of the 63 aftermath items. All 21 have a functional case that passes on the merge.
- The 31 that fail: no per-case result at the merge 8, no recipe 7, the fix's tests don't compile or load against the merged tree 7, install failed 6, no fail-to-pass case 3.
- On base with the fix's test files, 2 cases pass (the change broke behavior that worked), 273 fail and 50 give no result. A fail on base mostly means the behavior the change added wasn't there yet, which a probe can't tell from a defect the change carried in, so this split stays descriptive and excludes nothing.
- Limits: each tree ran once, so a flaky case could pass as fail-to-pass (the build step's 3-run rule settles it), and 13 qualifiers from the first pass weren't rerun on the final recipes. Median probe time was 1 minute a unit, 3.2 for qualifiers.

Clean supply for the comparison: 18 qualifying units never shown to any arm (comparison 16, reserve 2). Calibration units were shown to stage 1's arms, so their 3 qualifiers serve only the exposure smoke. The comparison needs 30 new build units to reach 48.

### 3. Build units

A build unit is a first-attempt unit (its unit.json, plan.md and key) plus a sealed task directory in the real-outcome lane's format (lanes/real-outcome/task/SPEC.md), extended with an aftermath test group:

- **Image.** The repository at base_sha with its dependencies installed by a frozen recipe for its ecosystem, built on a keyless host, pinned by image id. Recipes cover Go, Node (npm, pnpm, yarn, bun with jest, vitest, mocha or node:test), Python (pip or uv with pytest) and Rust (cargo test), each with a per-case reporter. PHP, Ruby and JVM recipes are dropped, since 0 of their 11 probed units qualified. A unit whose ecosystem has no recipe drops with its reason. Every scored tree builds cold: it is copied without ignored build outputs, then built offline in fresh build and cache directories, so a builder's stale compiled files can't decide a test. Dependency caches are per unit and removed with it.
- **Functional hidden tests.** The merge's own test files, restored from the merge's test tree in their own run. A case counts when it passes in all 3 runs on the real merged tree. Functional solved = every functional case passes. The verifier's V1 gold check applies to this group only.
- **Aftermath hidden tests.** For each primary B item whose fix commit changes tests: the fix's test changes, overlaid on the tree in a second restore set and run apart from the functional tests, reading only their own case ids. Only test code moves: a file that also holds product code (such as a Rust source file with an inline test module) gives up only its test region, an ambiguous mixed file drops its cases, and the product files' hashes are checked before every graded run. A case is an aftermath case when, in all 3 runs, it fails on an assertion (the verifier's assert class, never a missing name, an import or load error, or a compile error) on the real merged tree and on the fix commit's parent with the fix's tests in place, and passes on the fix commit; and the fix's product changes touch lines the merge added or changed, so the case ties to this change. Cases in the same files that pass on both the merged and the fixed tree are anchor cases: they score no bug, but show whether the fix's tests load against a build. T items score no aftermath case; their follow-up tests join the anchors as the compatibility measure. Each aftermath case's outcome on base with the test files copied in is recorded (pass, fail, no result) and printed as a descriptive split: a pass on base means the change broke behavior that worked; a fail or no result mostly means the behavior wasn't there yet, which can't be told apart from a defect carried in.
- **No exclusions.** Every aftermath case of a primary B item scores. Items the key flags mentioned (the plan already names the risk) or generic print as strata: they compress headroom equally in every arm and bias no contrast.
- **Statement note.** One paragraph, identical across arms, naming every public name the merge adds or changes, with its signature or shape, taken from the merge diff alone and never from which names the hidden tests call, so the note carries no hint of where the later tests look. The builder is told these names and signatures are fixed. Written by GPT-6.1 Sol from the merged change and audited by Opus 5.5 with no tools for any behavior or bug hint (H's V4 and V5). Names that exist only at the fix are never named.
- **Leak check.** The L2 leak needles add the fix commit's added product lines, and the check runs on the exact image each builder uses, so a later published copy of the project in a dependency or module cache can't carry the fix in.
- **Unit qualifies** when its image builds, the suite yields per-case results at base and at the merge, at least one functional case passes on the merge, and at least one aftermath case exists. Before the pilot, the 21 probe qualifiers are recounted under these rules in the verifier's own sandbox (read-only root, uid 10001, no network, 3 runs, and the licence rule with copyleft units under custody as #276 section 17 allows). If fewer than 16 clean units remain, the question goes to the Captain before any spend.

**New build units:** 30, the comparison's 48 less the 18 clean qualifying units. The mined pool still holds 517 unauthored candidates in 76 repositories inside the closed wave 1 windows with a fix or revert candidate (counted from the sealed pool index). At the probe's qualifying rate (21 of 52) and the fixed build's key pass rate for such units (11 of 28), it should supply roughly 50 to 75 units; that is an estimate, not a count. If screening and keying can't reach 30, the comparison runs at the units it has, and a pooled MDD past 0.12 comes to the Captain. The candidate manifest (the 517, frozen by digest) is fixed before screening, every candidate's screening and keying outcome is accounted for, new units are capped at 2 per repository, and claims cover only the selected population. Candidates come from the first attempt's mined pool (its index lists 2,261 candidate changes) in a fresh seeded order (seed minted from random bytes at the build, recorded before any draw), inside the same frame (section 4 of #276, wave 1 windows closed), with three changes: (1) a free screen before any model call: a fix or revert candidate whose commit changes tests, a recipe for its ecosystem, and at least one fail-to-pass case by the rule above, run by the probe on the candidate's trees, so only candidates with a live aftermath case are keyed; (2) F8: the key writer sees every blamed hunk first within its 2,500-word candidate budget, then the rest; (3) mine.ts's window_open bug fixed (it compares the close time with the end of the mining day). Every other authoring rule, prompt and audit is the first attempt's. Units keyed under the first attempt's build keep their keys, so the keying regime prints as a stratum beside the primary. The 2 qualifying reserve units sit with the 16 comparison units; the unassigned unit didn't qualify.

### 4. Arms and sessions

**Review stage.** Same container and limits as stage 1: Claude Code with the claude-code-preset system prompt, a 200,000-token window, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, WebSearch and WebFetch denied, the metering proxy as the only egress and no keys in the container, $10, 200 turns and 90 minutes per session, CLAUDE.md, AGENTS.md and .claude/ stripped at any depth before arm setup. Each session sees /work/repo at base (one commit, no remote) and /work/plan.md.

The common line, every review arm: "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it. Leave the improved plan in plan.md." There is no closing template.

| Arm | Before the common line | gstack | Stop hook |
|---|---|---|---|
| none (no review) | no review session | not installed | no |
| plain | nothing | not installed | no |
| pre-cut | "/plan-eng-review plan.md" and the forced sentence | b493d4e31 (1.97.0.0), default install | yes |
| eng phase | autoplan's Phase 3 opening (render.ts), then the forced sentence | 199931029 (1.98.0.0), default install | yes |
| candidate | "/plan-coverage plan.md" and the forced sentence | 57295cbc5, ./setup --host claude | yes |

The forced sentence and GSTACK_SESSION_KIND=unattended are #276's. AskUserQuestion gets the one fixed line "Go with your recommendation." The Stop hook is stage 1's stophook.ts: on a stop it runs the arm's frozen detector (exposure.ts, unchanged) and, while outputs are missing, blocks with one fixed message naming them, at most twice. Blocks print per session, each arm prints its share of sessions exposed before any block, and the skill-arm contrasts also print split by it.

**Review bundle.** What the builder gets from a review: the session's final /work/plan.md, its final reply as review.md, and the skill's own written files (the pre-cut and eng phase test plan artifacts, the candidate's three plan-coverage files), concatenated in a fixed order under /work/review/ with each file's name as a heading, capped at 12,000 words (truncation counted per arm). Edits a review made to repository files are discarded and counted.

**Build stage.** Opus 5.5 in Claude Code at the pinned version, no gstack, in the unit's image with no network but the metering proxy: CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, web tools denied, the strip rule, and H's no-gstack session limits (400 turns, 3 hours, $16). The prompt: "Implement the plan in plan.md in /work/repo, with tests. A reviewer's notes on the plan are in /work/review/; use them as you see fit." then the statement note. The no-review arm drops the middle sentence and has no /work/review/. The builder never sees hidden tests, the key, later history or any other arm's output.

**Session outcomes.** Completed or limit: scored as is (a build that stops at a limit scores its tree). Upstream error: one retry from a fresh container; a second is a gap. Infra: one rerun; a second is a gap. A review that ends in a gap leaves its build unbuilt, and the cell is a gap. Every verdict also prints the reading that scores gaps as 0.

### 5. Scoring (no judge)

Each build's final tree is graded by the verifier (lanes/real-outcome/task/verify.ts, extended for the aftermath group) in the unit's pinned image: no network, non-root, read-only root, hidden tests restored, 3 runs.

- **Primary, aftermath pass share:** for each aftermath item, the share of its cases that pass in at least 2 of the 3 runs, averaged over the unit's items, so an item with 136 cases counts the same as an item with 1. A case with no result, or one that fails on a missing name or a load error, counts as not passing. **Reach** is the share of an item's aftermath and anchor cases that give a pass or an assertion-class result in at least 2 of 3 runs, weighted by item and averaged by unit like the primary; it prints per arm.
- **Compatibility:** the share of anchor and T-item cases that pass, printed beside the primary.
- **Functional solved:** every functional case passes in at least 2 of 3 runs.
- **Real-bug catch:** the build's own new and changed test files are moved onto the real merged tree and the real fixed tree (the pfchecks transplant, with product files at the real content, under the same test-region rule). A build catches a B item when one of its own test cases fails in all 3 merged runs and passes in all 3 fixed runs. The compile rate on the real trees prints.
- **Changed-line coverage:** the share of the build's changed product lines that its own tests execute (go test -coverprofile, pytest-cov, c8, cargo-llvm-cov), reported only if the tool scores at least 90% of trees.
- **Mutation kill rate:** main's mutation runner on the build's changed lines, reported only if it scores at least 90% of trees. It supports TypeScript only through vitest, so it is expected to stay unreported, and no new mutation code is built.
- **Descriptive:** test lines added, review words, Stop hook blocks, cost per build and per review, reach, the base-outcome split.

A unit's arm score is the mean over its builds. Differences pair by unit and cluster on the repository, with units nested in it; each has a 95% cluster-bootstrap interval (10,000 draws, seed minted at the build) and a two-sided cluster sign-flip p, and prints with the count of units that got worse and the count of repositories.

### 6. Headroom pilot (before any skill-arm money)

On the first 16 of the 18 clean qualifying units in seeded order, before any new unit is authored, Opus no-review and plain-review builds, 2 each (64 builds, about 32 plain reviews), scored as above. Its builds count toward those cells in the comparison. Stop lines, frozen now, read in this order:

1. **INSTRUMENT:** reach under 0.60 on the pilot's builds (aftermath tests mostly can't run against independently built code). Ends as FIX-METHOD on the instrument.
2. **FLOOR:** plain-review aftermath pass share under 0.10. It prints functional solved and reach first. With plain functional solved at 0.50 or more it ends as FIX-METHOD on task fit: builds finish the change but almost never pass its later fixes' tests, and a 10-point gain would mean a review more than doubling that rate, which stage 1 gives no reason to expect. With functional solved under 0.50 it ends as FIX-METHOD on the build setup instead. A low control rate leaves room upward, so this line is a task-fit judgment frozen now, not a power argument.
3. **CEILING:** plain-review aftermath pass share above 0.85, or its 95% lower bound above 0.75. Ends as FIX-METHOD (saturation): plain-review builds already avoid nearly all of them.
4. Otherwise HEADROOM, and the money re-projection runs on the pilot's measured costs (section 10).

The pilot reads only control-arm levels, never a skill contrast, so continuing past it biases no primary. The plain-review minus no-review difference prints as descriptive. The pilot's plain builds run before the skill-arm cells rather than interleaved with them, so the plain arm prints a pilot-versus-later stratum, and every contrast also prints on the 32 units outside the pilot, since the pilot's control builds passed a level gate. Any stop goes to the Captain with the reading before anything else spends.

### 7. Exposure gate (before any comparison spend on a skill arm)

On the calibration units, with the Stop hook on: 6 Opus sessions of each skill arm, and 3 each on Sol and particle-1. An Opus arm runs its comparison cells only with at least 5 of 6 exposed; otherwise it reads untested (FIX-METHOD on the instrument) and its cap is released. A Sol or particle-1 arm with fewer than 2 of 3 exposed doesn't run its conditional cells. In the comparison, an arm whose exposure is under 0.70 after its first 24 sessions stops, and any arm under 0.80 at the end reads untested. Pooled membership is frozen at this gate: the Opus arms that pass it make the pooled primary, and if any of them later stops at the interim or ends under 0.80, the pooled primary reads untested while the other arms' own reads go on. The comparison doesn't start with fewer than two Opus arms through the gate. Exposure is read from the detector on the final transcript, never from the hook's own count.

### 8. Comparison

**Size, one frozen parameter:** 48 comparison build units with 3 reviews and builds a cell (no review: 2). The owner's pick between this and 40 units with 2 builds a cell changes only this parameter and the MDD and money lines tied to it.

48 comparison build units. Opus reviewers: the plain, pre-cut, eng phase and candidate arms, 3 reviews a unit each, each review built once by Opus; no review built twice. Cells run interleaved in a seeded order per unit.

- **Primary:** the pooled contrast, mean of the skill arms minus plain, on Opus, alpha 0.05 two-sided, over the arms that passed the exposure gate (section 7); with fewer than two, the primary reads untested.
- **Fixed sequence:** the pooled primary first, then the candidate minus plain, then the pre-cut skill minus plain, then the eng phase minus plain, each at alpha 0.05 two-sided. Confirmatory testing stops at the first test that doesn't reject; every arm after that point is reported as descriptive, with its interval, and carries no verdict of helps or hurts. An arm outside the pooled primary (it failed the exposure gate) is skipped in the sequence and reads untested. Holm across the arms in the pooled primary prints as a sensitivity reading.
- **Secondaries:** plain minus no review; each skill arm minus no review; candidate minus pre-cut; eng phase minus pre-cut; every section 5 measure per arm; the length-adjusted line (each contrast regressed on the review word-count difference); strata by keying regime, type, the base-outcome split, merge month, the strict window (first exposed on or after 2026-08-01) and the key auditor's foreseeability rating (yes or maybe against no).
- **Conditional Sol and particle-1 stage:** only when the Opus pooled primary reads helps, and only after its projection (about $2,908) goes to the Captain and on to the owner before any spend, since it takes the line well past its guideline; the plain, pre-cut, eng phase and candidate arms on Sol and on particle-1, 2 reviews a cell, each built once by Opus, sharing Opus's no-review builds. Each model gets the same pooled and per-arm reads, with their own MDDs.

**Verdicts.**

- **helps** (or **hurts**): two-sided p at most 0.05 (within the fixed sequence for per-arm contrasts) and the 95% interval excludes zero in that direction.
- **no measurable difference:** the interval includes zero; it prints with the MDD.
- **not shown:** a descriptive arm (after the sequence stopped) whose interval excludes zero, or a pooled reading whose interval and p disagree.
- **untested:** exposure under 0.80, coverage (scored builds over planned) under 0.90, or the pilot's reach line failing; and, for one arm, the reach guard: when its reach minus plain's has a 95% upper bound below -0.05, a drop in its score can't be told from an instrument failure, so it reads untested and never hurts on that basis.
- **KEEP** for an arm on a model: its own per-arm contrast reads helps, and its functional solved minus plain has a 95% lower bound above -0.10. The verdict names the package tested: the skill run with forced invocation, the Stop hook and the review bundle.
- **Family finding:** a pooled helps with no per-arm helps is written "gstack's engineering review arms, taken together, led to builds that pass more of the real later-fix tests", and supports no single KEEP.
- **CUT-CANDIDATE:** none for the pre-cut skill or the eng phase (section 1). The candidate reads CUT-CANDIDATE when its per-arm upper bound is below +0.05 with exposure at least 0.80, headroom admitted and coverage at least 0.90. This rule ranks above KEEP, so an interval such as 0.01 to 0.04 reads CUT-CANDIDATE: a gain that small doesn't pay for the skill.
- **Precedence:** untested, then the candidate's cut rule, then KEEP, then the other words, so no arm gets two verdicts.
- Any null gets R48's Why null? cycle with its MDD, and the post says which kind it is.

### 9. Power and MDD

power.py (attached, seeded 20261111, keyless) simulates the aftermath pass share: a unit baseline on the logit scale with SD 1.5, each skill arm's per-unit effect with SD 0.5 around its mean, a per-build effect with SD 0.5 or 1.0 shared by that build's cases, 1 to 3 aftermath cases a unit (0.55, 0.30, 0.15), and the paired cluster test. The probe found more cases a unit than that (median 6), with most units holding one item, so these MDDs are if anything conservative, as long as an item's cases move together the way the per-build effect models them. These settings assume every unit is winnable: if a share p of units can't be passed by any arm, the MDD grows by about 1/sqrt(1-p) (p = 0.2 gives 0.112 to 0.117). In the fixed order, a per-arm test at alpha 0.05 reaches about 0.127 at 48 units and 3 builds. Before the pilot, power.py gains inputs for SD_B, sd_e, the unwinnable share and the probe's case and item counts with the item weighting, and the re-projection refits all of them from the pilot's 64 builds. MDD at 80% power, in points:

| Contrast | Units | Builds a cell | Control 0.3 | Control 0.5 |
|---|---|---|---|---|
| pooled (alpha 0.05) | 40 | 2 | 0.132 to 0.141 | 0.136 |
| pooled | 40 | 3 | 0.110 to 0.114 | 0.113 |
| pooled | 48 | 3 | 0.100 to 0.105 | 0.102 |
| pooled | 64 | 3 | 0.086 to 0.091 | 0.090 |
| per arm (alpha 0.0167) | 48 | 3 | 0.146 to 0.151 | 0.147 |
| per arm | 96 | 3 | 0.103 to 0.106 | 0.103 |
| pooled, Sol or particle-1 stage | 48 | 2 | 0.125 to 0.126 | 0.122 |

**Smallest effect worth acting on:** 10 points of aftermath pass share on Opus, pooled. A review that costs 2.4 to 5.2 times a plain one and lets a builder avoid one more in ten of a change's real later bugs is worth restoring or shipping; less than that is not worth its cost and time. The design reaches it at 48 units and 3 builds with sd_e 0.5 (0.105 at sd_e 1.0). The prior, stated now: stage 1's 9% naming rate suggests gains will be small, and an effect of 5 points is plausible and beyond this design. Every null says so.

**Start rule:** the re-projection after the pilot reprints the pooled MDD with the pilot's measured control rate and build variance. If the frozen cut order (section 10) would take it past 0.12, the question goes to the Captain before any skill-arm build.

### 10. Money

**The line today** (2026-11-11, $1 per 1,000 credits): the eng-review ledger record holds $1,041.86 settled plus $7.94 of unreadable usage at its worst case ($1,049.79); hosts outside the ledger at most $5.17; and the crew threads on this line. The Captain's reading after the stage 1 results post merged is about $1,391 all-in to date, so about $2,609 is left of the $4,000 line. Not counted: H1's h1-none charge ($118.49, autoplan's under the Captain's ruling and not in this record) and GEVA-519's proxy fix ($30.59, crew-wide).

**Measured costs used** (stage 1, ledger-settled, from stage 1's next-attempt note): Opus reviews plain $0.54, pre-cut $2.19, eng phase $2.81, candidate $1.30; Sol none $1.21 (worst case), pre-cut $3.62, eng phase $1.63, candidate $1.74 (2 sessions each); particle-1 $0.065 to $0.28. The Stop hook adds an assumed 25% to the pre-cut and eng phase. Builds have no measured figure on these units: the planning figure is $2.50, 1.33 times H1's measured no-gstack Opus build mean ($1.88 over 126 sessions on larger Go features), for reading a review bundle in multi-language repos. The pilot replaces it.

| Item | Projection | Cap |
|---|---|---|
| Opus comparison reviews: 48 units x 3 x ($0.54 + $2.74 + $3.51 + $1.30), the pilot's 32 plain reviews inside | $1,165 | $1,500 |
| Opus comparison builds: 48 units x 14 builds x $2.50, the pilot's 64 inside | $1,680 | $2,150 |
| Exposure smoke: Opus 18, Sol 9, particle-1 9 sessions | $72 | $95 |
| Build units: statement notes for 51 units ($26) and 30 new units at about $20 a usable unit ($600: $12.98 a passing unit was measured, failures included, plus attrition when the keyed item misses the screened fix) | $626 | $920 |
| Hosts: about 245 VM-hours on Ubicloud standard-8 at about $0.25 (builds 3 to a VM, reviews, verifier runs, images and the candidate screen) | $70 | $100 |
| Crew: this thread through the prereg merge, the run thread and the results thread, from comparable measured lines (stage 1's build-and-run thread cost about $190) | $300 | $400 |
| Reserve | | $150 |
| **Unconditional, new** | **$3,913** | **$5,315** |
| **All-in on the line (about $1,391 spent plus unconditional)** | **about $5,304** | **about $6,706** |
| Conditional Sol stage: 48 x [2 x $9.51 + 8 x $2.50] | $1,873 | $2,400 |
| Conditional particle-1 stage: 48 x [2 x $0.785 + 8 x $2.50] | $1,035 | $1,330 |
| **All-in if the conditional stage runs** | **about $8,212** | **about $10,436** |

The unconditional projection sits past $5,000 all-in, so this goes to the Captain before the gate closes, with two smaller designs: 40 units and 3 builds a cell ($3,265 new, about $4,656 all-in, pooled MDD 0.110 to 0.114) and 40 units and 2 builds ($2,536 new, about $3,927 all-in, MDD 0.132 to 0.141, the only one inside the $4,000 line). R71 says to size an eval for its question, and only the 48-unit, 3-build design reaches the 10-point effect worth acting on. Caps sit at about 1.3 times each projection plus a reserve, as in the first attempt, and the Captain records every item's cap before its first paid call. The order of spend keeps the risk small: the pilot and the exposure gate run on the 18 clean units before any new unit is paid for, so if the pilot stops, the line ends near $1,800, and near $1,900 if the exposure gate is the stop. If the authoring cap stops short of 30 units, the comparison runs at the units it has (section 3).

**Re-projection after the pilot,** on its measured build and review costs. If the unconditional design no longer fits the caps the Captain records, cuts go in this order: no-review builds to 1 a unit (secondary only), then comparison units from 48 to 40, then builds a cell from 3 to 2. A cut that takes the pooled MDD past 0.12 goes to the Captain instead. A projection past the recorded line stops for the Captain.

### 11. Harness on main (what this PR builds)

The lane branch score-eng-plan-reviews-on-later-bugs (frozen at 47acea4) is read, never pushed. Only what the build read needs is ported, onto current main and its metering proxy (#322's token-count reservations):

- **Ported from the lane:** lanes/eng-review units.ts and types.ts (unit and key formats), author/sets.ts (seeded draws with isDrawn and the floor override), render.ts (the eng phase opening, with F10 fixed: an existing opening is compared byte for byte and reused, never re-created exclusively), exposure.ts and stophook.ts unchanged, and src/trial/review eng-review.ts, er-run.ts and er-cli.ts with the run.ts, trial.ts and sandbox.ts changes they need (F11 fixed: a stale cache prints its stop and exits non-zero). For new units: author/mine.ts (window_open fixed), author/run.ts (F8), frame.ts, prompts.ts and classify.ts. Left behind: the A-scoring stack (judge, packets, oracle, score, rules, stock, probe, rows, their prompts, run-checks and the old dry run).
- **New, lanes/eng-build/:** the container probe and recipes (from this plan's probe) and the candidate screen that runs it on mined candidates, the build-unit builder (real-outcome task directories with the aftermath group, the 3-run fail-to-pass rule and the base split), the statement note writer and audit, the review bundle, the build arm prompts on main's outcome-skills session driver and Lane B agent, the verifier's aftermath group in its own restore set with anchors and the test-region rule, runner adapters for jest, vitest, mocha, node:test and cargo (main's verify.ts and record.ts run only pytest and Go today) under the same hardened contract (start line, plugin isolation, read-only root, uid 10001, per-case phases, failure classes), each with a negative fixture, the cold rebuild, per-unit dependency caches, the real-bug catch on main's pfchecks transplant and runner, the coverage runner, the analysis (pooled, the fixed per-arm order, Holm sensitivity, repository-clustered bootstrap and sign-flip, reach and the reach guard, verdict precedence, MDD print), a parametric power.py, and a keyless dry run.
- **Reason codes** in src/errors/codes.ts, each exiting non-zero with its code first on stderr and a section in docs/errors.md:

| Code | Prints | Then |
|---|---|---|
| E_EB_NO_RECIPE, E_EB_IMAGE, E_EB_NO_AFTERMATH, E_EB_TRANSPLANT | unit id, step, failure class | the unit or case drops and is recorded; nothing paid; the build goes on |
| E_EB_FEW_UNITS | clean units against 16 | stop for the Captain; no lease opened |
| E_EB_REACH, E_EB_FLOOR, E_EB_CEILING | measured value, threshold, units and builds read, functional solved | the attempt ends; open leases settled; the run record sealed; stop for the Captain |
| E_EB_EXPOSURE_GATE | arm, exposed of sessions, threshold | that arm's cap released; stop for the Captain when fewer than two Opus arms pass |
| E_EB_EXPOSURE_STOP | arm, exposure after 24 sessions | that arm stops and its leases settle; the pooled primary reads untested; the other arms go on |
| E_EB_GAP, E_EB_CELL_INCOMPLETE | cell, session outcome, retries used | one retry by the session rule, then a recorded gap; resume with the run command |
| E_EB_CACHE_STALE | cache key, expected and found digest | nothing scored; rebuild the cache and resume |
| E_EB_REPROJECT | projection, cap, MDD | stop for the Captain before any further spend |

- **Stage 1's next-eval notes, all carried:** F8 and F10 and F11 as above; GIT_OPTIONAL_LOCKS=0 on every git command near containment, with contain-check.py (73f3404953506184) and its test; custody sealed early: every build unit's task directory and every stage's run record is sealed to the eng-review recipient and copied to the org custody folder as soon as it is written, and /dev/shm is restored from that seal after any reboot; the dry run's run-side check fails unless every case's exact line matches and prints the case name (no "FAIL run side:" wildcard, no "undefined"), and the dry-run test asserts both.
- **The dry run drives every frozen rule, keyless,** on fixture units in Go, Node, Node with Rust and Python: each recipe and runner adapter; a fail-to-pass case, a case that only errors on merged (excluded), a case that fails on a missing name (excluded), a case red on base (kept, scored and printed in the base split, with an assertion that it enters the primary), an anchor case, a T case; a Rust file with an inline test module (only the test region moves) and a product-hash mismatch (refused); a stale compiled artifact in a build tree (the cold rebuild ignores it); the reach, floor and ceiling lines on both sides (reach 0.59 and 0.60, floor 0.09 and 0.10, ceiling 0.85 and 0.86, lower bound 0.75 and 0.76); exposure gate at 4 and 5 of 6 and 1 and 2 of 3; the interim stop at 0.69 and 0.70 after 24 sessions; the Stop hook's two blocks and release; the bundle cap; the transplant catch rule; a build that doesn't compile against the hidden tests; coverage and mutation at 89% and 90% of trees; the fixed per-arm order stopping at each arm and Holm as sensitivity; the pooled primary with one and two arms out at the gate, and untested when a member fails late; the reach guard at upper bounds -0.051 and -0.050; KEEP with functional solved at a lower bound of -0.10 and -0.11; candidate CUT-CANDIDATE at upper bounds 0.049 and 0.050, and an interval of 0.01 to 0.04 reading CUT-CANDIDATE, not KEEP; every E_EB code's print and recovery; the gap rules; the re-projection cuts and the MDD stop at 0.12 and 0.13; the conditional stage's trigger; mounts with no hidden test, key or later history visible; one ledger lease per item on a temporary ledger; and a live probe of every model route at its frozen settings before any paid batch (one real call each, priced from the stage's first item).

### 12. Start rules and stops

1. No paid call before the prereg PR merges and the Captain records each item's cap. Every paid call goes through the ledger and the metering proxy. A cap stop is an incomplete run, never retried to change a verdict.
2. R77: this experiment gets this prereg and one results post. Run fixes land on a pinned branch with the results.
3. Order: the recount and the clean build units with the dry run (no spend except their statement notes), then the live route probe, then the pilot on 16 of them, then the exposure gate, then, only on HEADROOM and with at least two Opus arms through the gate, new-unit screening and authoring, then the comparison, then the conditional stage if triggered. Each step's result goes to the Captain when it lands, before any timer.
4. Long runs: controllers detached on a named Ubicloud VM with UBI_OWNER set, TTL covering the batch, apt stopped at boot, linger on, a registered wait on every watcher, and every VM destroyed at the end.
5. Any finding in review that would move a scored outcome comes to the Captain before a fix.

### 13. Custody, outside terms and public safety

Units, keys, task directories, hidden tests, statement notes, reviews and builds stay sealed with committed digests only. Plaintext lives in /dev/shm under the custody rules, with a sweep of /tmp, /var/tmp, ~/.capy/tool-outputs and Docker volumes at each seal and at the end. Outside terms: GitHub's terms for public clones and API reads; Docker Hub's terms for image pulls; Ubicloud's terms for hosts; repository licences as #276 section 17 (copyleft units under the same custody, nothing redistributed, no network service run from any unit); package registries' terms for dependency installs at image build; Anthropic's commercial terms for Opus; OpenRouter's and OpenAI's terms for Sol, with OpenAI pinned and data collection denied; OpenRouter's and the serving provider's terms for particle-1; Claude Code's terms as the harness; gstack MIT at every pin; Harbor Apache-2.0 with telemetry off; the coverage and mutation tools under their own licences (MIT, Apache-2.0, BSD, and ISC for c8), with every notice and provider data setting kept in the frozen manifests.

### 14. Risks and limits

- A builder that recalls the later fix from training passes the aftermath test in every arm; it compresses headroom but biases no contrast. The strict window and merge-month strata bound it.
- Aftermath tests call the real code's names. The statement note and the reach line guard the instrument; a build with different internal names can still miss a case it handled.
- Mobile and some languages fall out at the container step, so the result covers web, server and developer-tool code in the recipe ecosystems.
- Units lean toward fixes that came with tests, and toward focused fixes (F8 only partly corrects the big-commit drop).
- Every skill arm runs unattended with an enforced procedure; the skills were written for a person at the keyboard.
- The primary reads passed tests, not avoided bugs: a build can pass a later fix's test partly by matching the interface the fix expected. Anchors and T items print that side.
- Recall could differ by arm if a review prompts the builder to recall the project's later history; the strict-window and merge-month strata bound it, and the post doesn't assume recall is the same in every arm.
- Units cluster by repository; the analysis clusters on it, and new units are capped at 2 a repository.
- Not in scope: autoplan's other phases, the full autoplan run, gstack skill edits, posting anything, the stage 1 results post, and any parity claim.

## Review record

One lean gstack /autoplan review (run autoplan-20261111153348, one Opus 5.5 reviewer, one round, about $2.36 of reviewer model use) found 24 findings: 0 Critical, 6 High, 10 Medium, 7 Low and 1 Informational. At the Captain's direction, one GPT-6.1 Sol outside voice read the same snapshot on its own (outside the run, since a lean run has no outside seat) and found 15: 0 Critical, 8 High, 6 Medium and 1 Informational. Five overlap. This revision takes every finding from both readers, with one exception: the Opus reviewer's authoring price (about $33 a unit) misread $12.98 as a per-pass cost when it is per passing unit, failures included, so its attrition point is taken at about $20 a usable unit instead.

## Disclosures

Filled in at the results post from org research/disclosures.md.
