---
id: 2026-11-15-geva-537-eng-review-planted-units-prereg
kind: plan
title: "Preregistration: does a plan reviewed by gstack's engineering review lead to code that avoids, and tests that catch, real bugs? Attempt 3, on units built from real merged fixes, with a judge-free build read"
summary: "Supersedes the 2026-11-11 build-read prereg after its supply stop. Units planted from real fixes; arms plain, autoplan eng phase, restored standalone skill; avoid and catch scored."
author: GEVA-537
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-15
status: open
supersedes:
  - 2026-11-11-geva-522-eng-review-build-read-prereg
links:
  - 2026-11-11-geva-522-eng-review-build-read-prereg
  - 2026-11-12-geva-525-eng-review-build-read-stop
  - 2026-11-11-geva-434-eng-review-intentions-stage-1-results
  - 2026-11-09-geva-412-plan-mode-intentions
  - garrytan/gstack#4375
attachments:
  - c730757f068ec0782153d257d83eeb0f38536fc2347f88c1862cae20c5186be8  review-record.md
---

# Preregistration: does a plan reviewed by gstack's engineering review lead to code that avoids, and tests that catch, real bugs?

## Approval

The Captain approved this plan on 2026-11-15 after one lean gstack /autoplan review (run autoplan-20261115012804, gate revision 1, one Opus 5.5 reviewer, 24 findings: 8 High, 13 Medium, 3 Low; the review record is attached). The Captain took every recommendation: all three review arms kept (A1), the eight High fixes (B1 to I1), approval with those changes (J1), and the money line (K1: about $4,321 projected all-in, $5,280 at caps including a $150 reserve the Captain holds). The 13 Medium and 3 Low findings and two construction fixes from a keyless supply probe are folded into the text below. The Captain set four conditions, in its words:

1. "Training cutoff: before the prereg freezes, every unit's real fix must postdate the published training cutoffs of Opus 5.5 and GPT-6.1 Sol, or the earliest-public-date filter must show it wasn't public before them. Report how many units that drops. A shortfall under 80 qualifiers comes to me, as you planned."
2. "Readings: each arm's decision may use its own alpha 0.05 test, as written, but any public headline uses the Holm-adjusted result. The prereg states both."
3. "Spend: if the running all-in projection for this attempt passes $5,000, it stops for me before spending past that, because Garry gets a heads-up there under R42. Every other cap mechanic stays as you wrote it."
4. "Forced invocation: the results say plainly that the effect is measured given an explicit invocation, with exposure counts beside each arm."

Sections 2, 9 and 12 carry them. The project owner said "do it" on 2026-11-15 to a third measurement this week, inside the crew's weekly share. This post approves no item's spend: no paid call runs until it merges and the Captain records each item's cap and gives the go.

## ELI5

gstack's /plan-eng-review reviews a plan before anyone writes code. It is meant to map the code paths the plan touches, find the ones with no test, think through edge cases and failure modes, and leave a test plan. Two earlier attempts to measure it failed on method. The first asked whether a review could predict a real change's later bugs in words, and plain Opus did that only 9% of the time, so there was no room to compare. The second graded built code against real later fixes, but only 2 of 51 real changes could be graded inside our test sandbox. This attempt builds its test cases from real bug fixes instead. We take a real open-source fix that came with a test, go back to the code just before the fix (where the bug really lived), remove the bodies of the functions the fix touched, and write a plan to implement them that says nothing either way about the case the fix handled. Each of three reviewers improves that plan: plain Opus with no gstack, autoplan's eng phase, and the restored /plan-eng-review. A fixed builder (Opus, no gstack, never told which reviewer it got) then implements the reviewed plan with tests. A machine scores two things with no judge: does the built code pass the real fix's test, and would the builder's own tests have caught the real bug when run against the original buggy code. A small pilot first checks that plain Opus neither aces nor fails these units, and a short smoke checks that each skill actually runs its procedure.

## Before → after

Before: three readings, none of them on the skill's main job. The seeded-flaw panel (2026-11-03) and G admission (2026-11-06) hit ceilings: plain Opus found planted plan flaws 15 of 16 and solved 22 of 22 tasks. Attempt 1 of the intentions eval read FLOOR (#328: plain Opus named 0.087 of where real changes' later bugs landed). Attempt 2, the build read, stopped before any paid call (#334: 2 of 51 real changes gradeable under its frozen sandbox, 16 needed). /plan-eng-review was cut on 2026-11-07 on the ceiling readings, and Garry is restoring it on 2026-11-15 because people rely on it (GStack Minder lane GSTA-546).

After: a frozen, judge-free test of what ships. On 64 planted units from real fixes in permissive repositories, each contrast paired by unit and clustered by repository with a 95% interval and an MDD stated now: does the restored standalone skill, and separately autoplan's eng phase, lead an Opus builder to code that passes more of the real fixes' tests and tests that catch more of the real bugs than a plain Opus review does. A headroom pilot gates the comparison money, an exposure smoke gates each skill arm, and the decision each result drives is written down before any spend.

## Why it matters

Garry restored the skill because people rely on it. If it makes builds ship fewer real bugs, gstack should say so and keep its test-review and failure-mode sections as they are; if it doesn't, GStack Minder needs to know which part to rewrite. Autoplan's eng phase loads the same skill file inside its own wrapper, so the same reading tells us whether that wrapper keeps or loses what the skill adds. The crew rule forbids a cut while a main intention is untested, and gstack's ETHOS asks every part to earn its place with evidence; today neither form has a reading on what ships.

## What caused this work

Garry said "do it" on 2026-11-15 (relayed by Harness Evals) to a third measurement this week, inside the crew's weekly share, as the evidence behind the restore. The Captain (GEVA-2) briefed this thread (GEVA-537, issue GST-2729) with a suggested design (planted projects, three arms) and asked for four adaptations: supply from real history, a deterministic build read as the primary, scoring that works backwards from the intentions inventory, and controls on stock lists, item counts and length.

## Big decisions

1. **Units: planted from real fixes, not real changes.** A unit is one real merged fix commit F with a regression test, in a permissive repository: the repository at F's parent (the real buggy code) with the bodies of the functions F changed removed, committed as a one-commit tree, and a plan to implement them that is silent about the condition F fixed. Why: attempt 2 needed a change and a later fix with runnable tests in the same window (2 of 51 survived), while any well-tested repository has many fixes that ship with a test, so supply stops being the limit and the bug and its test are real. What it costs: the claim narrows from "planning a new change" to "planning the implementation of real functions whose first version shipped a real bug". What would flip it: the keyless supply count in the frozen sandbox coming in under 80 qualifiers.
2. **Only units a review could plausibly help.** Each unit gets a blind foreseeability rating from two raters in two families (could a careful reviewer name the condition from the plan and the code alone?). Units both raters call unforeseeable leave the comparison draw. A hinted build (the builder told the condition) also drops units whose fix test can't be passed by an independent implementation. Why: unwinnable and unforeseeable units dilute every contrast toward zero and would make the content raise worse.
3. **Primary: a judge-free composite of what ships.** Each build scores half a point for code that passes the real fix's failing cases (avoid, ENG-3) and half for its own tests catching the real bug on the real buggy code (catch, ENG-2). Why: both are the skill's named aims (coverage and test plan, edge cases and failure modes), both are deterministic, and averaging two correlated reads gains power over either alone. The pilot reads each component's control level first: both in band keeps the composite, one in band makes it the primary alone, both out of band stops.
4. **Arms.** Reviewers, all Opus 5.5 in Claude Code: plain with no gstack (R44), autoplan's eng phase, and the restored standalone /plan-eng-review, both at the restore's gstack commit with the Stop hook that enforces their procedure. Autoplan's Phase 3 loads the same plan-eng-review/SKILL.md inside its own wrapper, so standalone minus eng phase reads that wrapper. Build-only controls, descriptive: no review, and a fixed stock review (a generic checklist). The builder implements the reviewed plan itself, the way users use the skill, with the review's other files beside it. No lens arm: it would cost about $640 and no decision below needs it.
5. **Each skill arm is its own test.** Standalone minus plain and eng phase minus plain, each at alpha 0.05 two-sided on the primary, with Holm across the two printed beside it; standalone minus eng phase is a secondary that changes autoplan's wrapper only when its interval excludes zero.
6. **Size: 64 comparison units, 3 reviews and builds a cell.** MDD 0.10 to 0.11 composite points per arm at 80% power, with repositories clustered (a 10-point effect has about 75% power; 80 units would bring it to 0.09 to 0.10 for about $860 more). The smallest effect worth acting on is 10 points: a review that costs about 5 times a plain one and lets a builder ship one in ten fewer of these real bugs, or catch them, is worth keeping. With fewer admitted units the comparison runs down to a floor of 40 with its MDD re-printed; under 40 it stops for the Captain.
7. **No CUT-CANDIDATE can come from this eval.** ENG-1 (architecture), ENG-4 (scope), ENG-5 (verified facts), ENG-6 (the user decides) and ENG-7 (performance) stay untested, so a null reads FIX-METHOD with its MDD.
8. **Money.** About $4,321 projected all-in for this attempt, $5,280 at caps including a $150 reserve the Captain holds. The projection sits $321 over the $4,000 eval guideline with an Astra judge (R71) because the size follows the question; the spend order puts only about $800 at risk before the pilot reads. The content raise, if the pilot reads a ceiling, and the conditional Sol and particle-1 reviewer stage (about $3,030) each come back before any spend. The earlier two attempts spent about $1,580 on the old line, whose Garry-approved caps (about $6,706) are not drawn.
9. **Sol and particle-1 (R54).** As reviewers only, built by the same Opus builder, at 2 builds a cell. They run only if an Opus skill arm reads helps or hurts, after the Captain's go, as attempt 2 planned.

## 1. Question, claimed value and the intentions scored

**Question.** On units planted from real fixes made public after Opus 5.5's stated training cutoff, does a plan reviewed by the restored /plan-eng-review, or by autoplan's eng phase, lead a fixed Opus builder to code that passes more of the real fix's failing cases, and to tests that catch more of the real bugs, than a plan reviewed by plain Opus with no gstack?

**Claimed value** (inventory wiki/research/2026-11-09-geva-412-plan-mode-intentions/inventory-plan-eng-review.md, read at b493d4e31, compared with b6155921a): lock in an implementation plan before code is written, so that architecture, data flow, edge cases, test coverage and performance are checked against the real code.

**Scored, with where it is observed:**
- ENG-2 (every changed behavior ships with a test that would catch a real regression): catch, in BUILD. The inventory's own BUILD test is "the gap tests exist, fail when the guarded behavior is reverted, and pass on the change"; here the guarded behavior is reverted for real, because the buggy tree is the real code before the fix.
- ENG-3 (edge cases and failure modes handled): avoid, in BUILD.
- ENG-8 (a build-ready plan the implementer can follow): partly, through the functional share (section 5).
- ENG-2 and ENG-3 in PLAN: the judged secondary (does the reviewed plan name the planted condition).

**Untested:** ENG-1, ENG-4, ENG-5, ENG-6 (arms run unattended) and ENG-7, and every secondary intention. The Captain's intentions line names paths, coverage, tests, CI and evals: paths and coverage are scored through ENG-2, the architecture half of the path map through nothing, and CI and evals through nothing. So this eval can read helps, hurts or no measurable difference, never CUT-CANDIDATE (CREW plan-mode rule).

**Inventory re-check at the pin.** Both skill arms pin gstack at the commit where GSTA-546's restore lands on gstack main. Before the prereg freezes, diff plan-eng-review/ (SKILL.md, the template, sections/*, manifest.json, the shared preamble it loads) and autoplan's Phase 3 text (autoplan/SKILL.md's Phase 3 and Step 3 loader, autoplan/sections/eng-phase.md and unattended.md, bin/gstack-autoplan-snapshot.ts) between b6155921a and the pin. Today, at gstack main 81fb900 (1.99.4.0), plan-eng-review/ is byte-identical to b6155921a (SKILL.md 58d96f; review-sections.md 3d04ce, the outside-voice change the inventory already records), and autoplan changed autoplan/SKILL.md (b39b19 to ced691) and sections/unattended.md (2 lines). If the restore changes any intention-bearing text in plan-eng-review/, a superseding inventory post ships in the prereg PR; if it changes only install, catalog, routing and docs, the prereg records that in one paragraph with the digests.

**Construct fit, stated now.** A review that makes the builder handle the condition where the real bug lived raises avoid; a review that makes the builder write the test that exposes it raises catch. A review that only adds words raises neither, because only the real fix's cases and the real buggy tree score. What the composite cannot show: that the review found the bug rather than the builder, so the judged secondary and the no-review and stock controls print beside it; and anything about architecture, scope, facts or performance.

## 2. Units: planted from real fixes

**Repository frame.** Public GitHub repositories under a permissive licence (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD), read from LICENSE at the fix commit, in the eng-build lane's recipe ecosystems (Go; Node with npm, pnpm, yarn or bun and jest, vitest, mocha or node:test; Python with pip or uv and pytest; Rust with cargo test), with 300 to 50,000 stars, pushed in October 2026, at most 300 MB, and no test that needs a service, browser or network. The list comes from a frozen GitHub search per ecosystem (query text and date recorded), drawn in a seeded order (seed minted from random bytes at the build and recorded before the draw) until the candidate count is reached, and its digest is frozen before screening. Stars print as a popularity stratum, since popular repositories are likelier to be memorized.

**Fix frame.** Fix commits F on the default branch's first-parent history whose earliest public date (the earliest of F's author date, its pull request's open date and any linked issue's open date) falls from 2026-07-01 to 2026-10-31, after the published training cutoffs of both models that see unit content: Opus 5.5, June 2026 (Anthropic's model docs), and GPT-6.1 Sol, 2026-04-30 (OpenAI's model docs). A strict stratum from 2026-10-01 covers the possibility of data to September. The earliest-public-date filter runs on every candidate before the prereg freezes, from the GitHub API, and the count it drops beyond the committer-date window prints (Captain condition 1); a candidate whose pull request or linked issue can't be read drops. Fewer than 80 qualifiers after it comes to the Captain. F looks like a bug fix by message or label, changes at least one runnable test file and at least one product file, changes at most 80 product lines, puts every product hunk inside at most 3 named functions or methods in at most 2 files, adds no product file, and changes no dependency, lock or generated file. At most 3 units a repository. The candidate manifest is frozen by digest before screening, and every candidate's outcome is accounted for.

**Construction** (synthetic commits in a local mirror, so the eng-build lane's unit model applies):
- P = F's first parent, the real buggy tree.
- B (base) = a parentless root commit, with a neutral author, date and message, whose tree is P with the bodies of the functions F's product hunks fall inside replaced by a language stub (TS/JS throw, Go panic with the right return shape, Python NotImplementedError, Rust todo!), keeping signatures and doc comments, and with the test cases removed from every test file F changes (Go Test, Benchmark, Example and Fuzz functions, Python test functions and classes, Rust #[test] functions including inline #[cfg(test)] modules, JS it and test blocks), keeping helpers, fixtures and imports, cleaning imports the removal leaves unused, and deleting a file only when nothing else remains. The probe found whole-file removal broke the remaining tests of 17 of 39 Go packages through shared helpers. A unit drops when the remaining tests don't build or collect at B.
- M (merge) = a commit on B whose tree is exactly P: the change a builder implements is B to M.
- F' = F applied on M (its tree must equal F's).
- The unit is { base B, merge M, fixes [F'] } in eng-build's eb.json schema. Because B has no parent, P's real bodies never reach the unit image's /testbed/.git; a containment check refuses any unit or session image whose /testbed/.git holds more than one commit.

**Four planted-unit rules that override the lane's assumptions** (each with a dry-run case):
1. **Functional set.** The functional cases are the cases in P's test files that exercise the region (they fail on B) and pass 3 of 3 on both M and F', minus any case id that is also a planted case. So a case F rewrote, which expects the bug on M, never sits in the functional set, and a fix that only adds a new test file still has a functional set. The functional share (cases passing over functional cases) is the guard and the FLOOR diagnosis; "solved" (every functional case passes) prints as a descriptive, beside the region size.
2. **Crash bugs count.** Every public name exists on M and F' by construction, so a planted case may fail on M with a runtime error other than a compile, collection or load error (a JS TypeError reading a property of undefined, a Python AttributeError on None, an UnboundLocalError) when its innermost frame is in a product file, it passes 3 of 3 on F' with the same test code, and the same rule holds in 3 of 3 runs. The same rule applies to the build's own tests in catch. Planted cases print by failure class.
3. **Removed bodies are needles wherever they appear.** The lane drops a needle already present in base; for planted units a body check runs instead: the removed body lines (whitespace-normalized, 20 or more characters) are searched in B's tree, the unit and session images and any source map's sourcesContent, and the unit drops when a run of 3 lines, or more than 10% of the lines, appears outside the stubbed region. Repositories that commit build output for the stubbed files drop at mining.
4. **Signatures come from B.** The lane's statement note names what a merge adds, which for planted units is nothing; instead the note lists the region's functions with their signatures, taken keylessly from B, and names no nested definition inside a removed body.

**Qualifies** when, under the frozen grading sandbox: the image builds; at least one functional case exists by rule 1; at least one planted case fails on M by the lane's assert class or rule 2 in 3 of 3 runs and passes on F' in 3 of 3; F's product changes touch lines B removed; the leak check and the body check pass; and the stubbed region is 10 to 300 lines.

**Frozen grading sandbox.** The verifier's sandbox from the eng-build lane (no network, uid 10001, read-only image root, 3 runs a tree) with the two changes attempt 2's exploratory re-screen measured (eb525-explore-sandbox at 510fc5f): the tree is graded in a writable copy, and /tmp is an 8 GiB tmpfs with 12 GiB memory. Dependencies install at B, which equals M and F' on every dependency file by construction, so attempt 2's merged-dependency leak conflict cannot arise. Attempt 2's two harness fixes (kit strip, leak needles through git grep -f; eb525-lane-fixes at 53d7b6b) are ported. Supply is counted in this sandbox, never outside it.

**Hosts.** Mining and screening install packages from unknown authors with the network on, so they run on a host that holds no key, no sealed plaintext, no ledger and no metering proxy, and that host is destroyed after. Paid stages run on a separate host. Long drivers run detached on a named Ubicloud VM with UBI_TTL_HOURS past the longest batch, never on a Capy machine that can sleep.

**Supply read before the prereg freezes.** A keyless probe on 2026-11-15 searched 43 repositories (about 10 an ecosystem, at most 6 candidates mined a repository) and ran the lane's screen containers, one run a tree, not yet any verifier sandbox. Every mined candidate constructed with no apply failure and no tree mismatch: 141 constructed, 133 screened, 50 qualified (Node 23 of 39, Go 12 of 39, Python 11 of 22, Rust 4 of 15 after a one-line fix to the Rust screen recipe, which kept the cargo registry inside the install container so every offline test step failed). Capped at 3 a repository, that is 40 usable units from 20 repositories (7 give 1, 6 give 2, 7 give 3 or more). Qualifiers are small: a median of 1 to 2 planted cases, 19 to 33 stubbed lines and 3 to 5 changed product lines. Most other screen drops were real and trace to two faults fixed below and in section 13: removing whole test files at B broke the remaining tests of 17 of 39 Go packages (shared helpers), and the Go image came from go.mod's minimum version, too old for some test code. Two counts are not in yet: the earliest public date (the probe used the fix's committer date) and the 3-run check in the frozen sandbox, which the probe runs next on up to 15 qualifiers. At about 0.9 usable units a repository searched, 125 to 200 repositories reach the target below; the search frame holds thousands. Before the prereg freezes the size, the full keyless screen and the 3-run recount in the frozen sandbox run on the whole frozen manifest. The comparison needs 64 units, plus 6 calibration units (exposure smoke only) and 6 reserve units, after the paid authoring drops in section 3; at the planning survival of about two thirds, that is about 115 qualifiers. Fewer than 80 qualifiers comes to the Captain before the prereg freezes.

## 3. Authoring (paid, after the prereg merges)

- **Plan.** GPT-6.1 Sol (another family from every reviewer and the builder) writes plan.md from the stubbed signatures and doc comments, M's implementation of the region, the functional test files and the region's callers. It never sees F. The plan is what a team writes before building: the goal, the intent and interface of each function, the files, and one line on testing; 200 to 500 words; no code beyond signatures; and no description of the current implementation's edge behavior. The prompt is frozen in the prereg.
- **Plan audit, both directions.** Opus 5.5 with no tools reads the plan, F's message and F's diff, and fails the plan if it states behavior at the planted condition in either direction: the fixed behavior, any hint of it, or the buggy behavior. The plan must be silent there. One rewrite, then the unit drops. Whether the first draft stated the buggy behavior is recorded and printed.
- **Hint.** Sol writes one sentence naming the condition F fixed and the behavior expected, from F's message and diff; the same Opus audit confirms it holds no code.
- **Foreseeability rating.** Two raters from two families (Gemini 4 Carbon and Opus 5.5, no tools) each see the plan, B's region files and callers, and the hint, never F's diff, and answer yes, maybe or no: could a careful reviewer name this condition from the plan and the code alone? A unit both raters call no leaves the comparison draw (recorded; it can still serve calibration). The primary also prints on yes-only units.
- **Hinted build (winnability).** One Opus build from the plan plus the hint. A unit whose hinted build passes no planted case in 2 of 3 runs drops as unwinnable (the fix's test is coupled to the original implementation, such as an exact message), recorded with its count.
- **No-review build.** One Opus build from the plan alone, for every admitted unit: the descriptive no-review arm and the difficulty flag for the content raise (section 7).
- **Sets.** Calibration (6), comparison (64) and reserve (6) are drawn after authoring in seeded order with the per-repo cap. Batch 1 authors the 6 calibration units and the first 20 comparison units (the pilot); batch 2 runs only after admission. When admitted units fall short, the comparison runs at the achieved number if it is at least 40, with the MDD re-printed; under 40 it stops for the Captain. Reserve units replace a comparison unit lost to infrastructure (an image that no longer builds) in seeded order, recorded.

## 4. Arms and sessions

**Review stage** (eng-build's review stage and attempt 1's container): Claude Code at the review stage's pin with the claude-code-preset system prompt, a 200,000-token window, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, WebSearch and WebFetch denied, the metering proxy as the only egress and no key in the container, $10, 200 turns and 90 minutes a session, CLAUDE.md, AGENTS.md and .claude/ stripped at any depth. The session sees /work/repo at B (one commit, no remote) and /work/plan.md. Common line for every arm: "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it. Leave the improved plan in plan.md."

| Arm | Before the common line | gstack | Stop hook |
|---|---|---|---|
| plain (R44) | nothing | not installed; no drive and no gstack path in the container | no |
| eng phase | autoplan's Phase 3 opening (render.ts, re-pinned), then the forced sentence | the restore pin, default install | yes |
| standalone | "/plan-eng-review plan.md" and the forced sentence | the restore pin, default install | yes |

The forced sentence and GSTACK_SESSION_KIND=unattended are attempt 1's; AskUserQuestion gets the one fixed line "Go with your recommendation."; the Stop hook is attempt 1's stophook.ts (it blocks a stop at most twice while the frozen detector shows missing outputs). Phase 3 loads plan-eng-review/SKILL.md through autoplan's Step 3 loader with autoplan's section skip list, so the two skill arms share the method and differ by autoplan's wrapper.

**What the builder gets.** For a reviewed arm, the review's final plan.md is mounted as /work/plan.md, so the builder implements the reviewed plan, as a user would after the skill edits the plan in place. The review's final reply (review.md) and the skill's other written files go under /work/review/ in a fixed order. The whole bundle is capped at 12,000 words (truncation counted per arm). Edits a review made to repository files are discarded and counted.

**Build-only controls** (no review session, descriptive): no review (the authored plan at /work/plan.md, from authoring) and stock (the authored plan plus a fixed review.md holding a generic 120-word engineering checklist: add unit tests for every function including edge cases and error paths, validate inputs, handle errors visibly, add CI, review the architecture, consider performance), identical for every unit and written before any unit is seen. One build a unit each.

**Build stage:** Opus 5.5 in Claude Code at the pin, no gstack, in the unit's image, reaching only the metering proxy and the sandbox sidecar (base commit only), with the same strip and container rules, and H's no-gstack session limits from the frozen registry ($16, 400 turns, 180 minutes) unchanged, so the build-stage coupling to H's registry stays as it is. Prompt: "Implement the plan in plan.md in /work/repo, with tests. A reviewer's notes on the plan are in /work/review/; use them as you see fit." then the statement note. The no-review build drops the middle sentence. The builder never sees hidden tests, F, the hint, later history or another arm's output, and is never told which arm reviewed. Whether each builder read /work/review/ prints per arm, and so does the limit-stop share, with a sensitivity read that leaves limit stops out.

**Session outcomes:** completed or limit scores its tree as is; an upstream or infra error gets one fresh retry, then a gap. A review that ends in a gap leaves its build unbuilt. A cap stop is an incomplete run, never retried to change a verdict. Every verdict also prints the reading with gaps scored 0.

## 5. Scores

Each build's final tree is graded by the lane's verifier in the unit's pinned image under the frozen sandbox, 3 runs, hidden tests restored.

- **Avoid:** the share of the unit's planted cases that pass in at least 2 of 3 runs. A case with no result, or one failing on a missing name or load error, counts as not passing.
- **Catch:** 1 when one of the build's own new or changed test cases, moved onto M (the real buggy code) and onto F' with product files at their real content (catch.ts, the pfchecks transplant under the test-region rule), fails in all 3 runs on M by the assert class or rule 2 of section 2, and passes in all 3 on F'; else 0. A build whose transplant drops scores 0 in the primary and is left out of a sensitivity read; drops print by reason per arm, with the compile rate.
- **Primary, per build:** composite = (avoid + catch) / 2, or the single component section 7 picks. A unit's arm score is the mean over its builds.
- **Guards and descriptives:** the functional share (section 2, rule 1) and "solved", reach (share of planted and functional cases giving a pass or a scorable failure), changed-line coverage where the tool scores 90% of trees, test lines added, review words, Stop hook blocks, cost per review and build.
- **Judged secondary (plan text, R78).** GPT-6 Astra reads, for one review per unit and arm (the first in the seeded order) and for the stock and no-review controls, everything the builder saw (the mounted plan.md and every file under /work/review/, 12,000-word cap, arm names stripped), in two blind calls: first it quotes, in order, at most 12 concrete conditions the material commits the builder to handle or test (the fixed item cap); then, given the unit's hint, it marks whether one of those quotes names the planted condition specifically (the input or state and the expected behavior; a class such as "edge cases" or "invalid input" never counts). The authored plan alone is judged too, as each unit's baseline. Controls on every unit: the stock review must score 0. When it scores, the authored plan's own reading is checked first: a plan that also scores is flagged as a plan leak, counted and dropped from the judged secondary (it stays in the primary); otherwise the rubric is at fault, and one frozen rubric revision is allowed, which reruns the judge check, and a second failure leaves the secondary unreported. A generic-specific list (30 common edge cases per ecosystem, written blind to units) prints its rate. Word counts print beside every contrast, with a length-adjusted line. Each credited quote maps to the bundle heading it sits under (coverage diagram, failure modes, test plan, architecture, other), printed as a lead for the rewrite brief, never as a finding.

## 6. Exposure gate (before any skill-arm comparison spend)

On the 6 calibration units, one Opus session each per skill arm with the Stop hook: an arm runs its comparison cells only with at least 5 of 6 exposed by attempt 1's frozen detector (exposure.ts), re-pinned to the restore commit's digests. Before the prereg freezes, the detector's strings are checked keylessly: on attempt 1's sealed smoke transcripts where the text is unchanged (plan-eng-review/SKILL.md is still 58d96f), and on keyless fixtures for the changed review-sections.md strings. A detector fault the smoke reveals is fixed once and the smoke transcripts are re-read, never re-run. An arm under 5 of 6 reads untested (FIX-METHOD on the instrument), its cap is released, and the finding goes to the Captain for GStack Minder. In the comparison, an arm under 0.70 exposed after its first 24 non-gap sessions stops, and any arm under 0.80 at the end reads untested. A gap counts as neither exposed nor unexposed in the comparison shares and against the arm in the smoke (the Captain's 2026-11-12 rulings, kept). Each arm prints its share exposed before any block, and every skill-arm contrast also prints split by it. Every user-facing line names the package tested: a forced invocation held by the Stop hook.

## 7. Admission pilot (R61, E1) before any skill-arm money

On the first 20 comparison units in seeded order: plain reviews, each built once, 2 a unit (40 reviews and builds; they count toward the plain cells). Read on the plain arm only, in this order:

1. **INSTRUMENT:** reach under 0.60, or hinted builds passing under 0.60 of batch 1's screened units. FIX-METHOD on the instrument.
2. **Component rule, on the component means:** a component is in band when its plain mean is 0.10 to 0.75 and its 95% lower bound is at most 0.65. Both in band: the composite is the primary. One in band: that component alone is the primary. Neither in band: go to line 3 or 4 by which side each sits on, never reading the composite.
3. **FLOOR:** the chosen primary under 0.10, or both components under 0.10. FIX-METHOD on task fit, with the functional share printed first (under 0.50 means the build setup, not the task).
4. **CEILING:** the chosen primary above 0.75 or its lower bound above 0.65, or both components above. Then the content raise below. A pair with one component at the floor and the other at the ceiling stops as FIX-METHOD on task fit.
5. Otherwise HEADROOM, and the re-projection runs on the pilot's measured costs and variance (section 10).

**Content raise (R61), by content, not session length:** the comparison population becomes the hard stratum, foreseeable units whose no-review build missed on the component at the ceiling (avoid under 1, or catch 0). More candidates come from the frozen manifest's unused qualifiers through the same screen and authoring, at batch 1's measured hard rate; the projection, the size target (64 hard units, down to the floor of 40) and its cap go to the Captain before it spends. The raise reads 16 hard units' plain builds (2 a unit) on the same lines: in band, the comparison runs on hard units only and every claim names that population; still at the ceiling, or the supply can't reach 40 hard units, the attempt stops as FIX-METHOD (saturation), no cut. The selection uses a different build from every compared one, so it shifts every arm's population the same way and biases no contrast.

The pilot reads only control levels, so continuing past it biases no primary. Its plain builds choose the primary and also count in the plain cells, so every contrast also prints on the 44 units outside the pilot, the clean check, and the plain arm prints a pilot-versus-later stratum.

## 8. Judge check (R78)

Before any judged number counts: Astra's two-call reading is checked against gold on at least 48 bundles, balanced by arm: the 12 smoke skill reviews, the first 20 skill-arm comparison reviews (10 a skill arm), 12 pilot plain reviews, and stock and plan-only bundles, enriched toward positives with the first draws whose hint a quick keyword match finds in the bundle, to reach 30% to 50% prevalence. Gold: Opus 5.5 (high) and Gemini 4 Carbon (high), each blind to arm with the same rubric and the unit's hint; a disagreement is settled by the run thread reading F's diff, blind to arm, recorded per case. Pass: Cohen's kappa at least 0.6 against gold, with sensitivity and specificity printed beside it, and the stock control at 0. The first judge call runs alone and sizes its cap (attempt 1 measured Opus at 4 times the planned output). A failed check leaves the secondary unreported as judged; the primary is unaffected.

## 9. Comparison and verdicts

**Size, one frozen parameter:** 64 comparison units (down to the floor of 40), 3 reviews and builds a cell for plain, eng phase and standalone (each review built once), interleaved in a seeded order per unit; stock and no review at 1 build a unit.

**Tests.** Each skill arm is its own family at alpha 0.05 two-sided on the primary: standalone minus plain, and eng phase minus plain. Two families at 0.05 give about a 10% chance of a helps or hurts word somewhere when neither skill does anything, so Holm across the two prints beside them. Each arm's decision row in section 11 uses its own test at 0.05; any public headline uses the Holm-adjusted result, and the results state both (Captain condition 2). Differences pair by unit and cluster by repository, with a 95% two-stage cluster-bootstrap interval (repositories, then units; 10,000 draws, seed minted at the build) and a two-sided cluster sign-flip p, printed with the count of units that got worse and the count of repositories.

**Secondaries** (intervals, no verdict words beyond the rules below): standalone minus eng phase; each skill arm minus stock and minus no review; plain minus no review; avoid and catch separately; the functional share; the judged find rate; the length-adjusted line; strata by ecosystem, region size, foreseeability, hard stratum, strict window, popularity and pilot.

**Verdicts per skill arm.**
- helps or hurts: p at most 0.05 and the interval excludes zero in that direction.
- no measurable difference: the interval includes zero; printed with the MDD.
- not shown: the p and the interval disagree. It maps to FIX-METHOD.
- untested: exposure under 0.80, coverage (scored builds over planned) under 0.90, admission not passed, or the reach guard (the arm's reach minus plain's with a 95% upper bound below -0.05).
- KEEP: helps, and the functional share minus plain has a 95% lower bound above -0.10. The verdict names the package tested: forced invocation, the Stop hook and the reviewed plan handed to the builder.
- Every skill-arm result says plainly that the effect is measured given an explicit invocation, and prints the arm's exposure counts (exposed, unexposed and gap sessions) beside it (Captain condition 4).
- helps without KEEP (the functional guard fails): reported as "helps on the planted bugs at a cost to the rest of the change", with FIX-METHOD.
- FIX-METHOD: any null, not shown or untested reading, with R48's Why null? cycle (exposure, task fit, power and floor or ceiling, whether plain Opus already does it). No CUT-CANDIDATE (section 1).
- Precedence: untested, then KEEP, then helps without KEEP, then the other words.
- standalone minus eng phase reads "standalone better" or "eng phase better" only when its interval excludes zero; otherwise "no measurable difference" with its MDD.
- stock matches a skill arm only when that arm reads helps and its minus-stock upper bound sits below +0.05; otherwise the stock line reads "not distinguished".

## 10. Power and MDD

power.py (attached to the prereg, seeded, keyless) simulates the frozen readout: repositories with 1 to 3 units at the supply read's mix and a repository-level effect SD of 0.3 on the logit scale, a unit baseline with SD 1.5 for avoid and for catch, catch possible only when the build's code handled at least one planted case (else 0.03), each skill arm's per-unit effect with SD 0.5 around its mean on both, a per-build effect with SD 0.5 or 1.0 shared by that build's cases, 1 to 3 planted cases a unit (0.55, 0.30, 0.15), an unforeseeable share p of units no arm can move (0, 0.2), and the cluster sign-flip test at alpha 0.05 two-sided. MDD at 80% power, in composite points (ranges over control levels avoid 0.43 to 0.57 and catch 0.21 to 0.36, a composite control of 0.32 to 0.46, build SD 0.5 and 1.0, and unforeseeable share 0 and 0.2; planning repository mix 0.40, 0.35 and 0.25 for 1, 2 and 3 units, about 35 repositories at 64 units; the probe's mix, 0.35, 0.30 and 0.35, gives the same 64 x 3 range, and it is re-run on the full supply read's mix before the freeze; 2,000 simulated runs with 1,000 sign flips each at the reported point):

| Units x reviews and builds a cell | Composite MDD |
|---|---|
| 40 x 3 (the floor) | 0.13 to 0.15 |
| 64 x 2 | 0.12 to 0.13 |
| **64 x 3 (frozen)** | **0.10 to 0.11** |
| 80 x 3 | 0.09 to 0.10 |
| 96 x 3 | 0.08 to 0.09 |

The unforeseeable share leaves the MDD in mean points unchanged, but the effect each movable unit needs grows by 1 / (1 - p): with a fifth of units unmovable, a 10-point mean needs 12.5 points on the rest. At 64 x 3 a true 10-point effect has about 75% power.

A single component alone (section 7's rule) has an MDD of 0.11 to 0.12 for avoid and 0.12 to 0.14 for catch at 64 x 3. **Smallest effect worth acting on:** 10 composite points per arm. The prior, stated now: attempt 1's 9% naming rate suggests effects may be small; 5 points is plausible and beyond this design, and every null says so. **Start rule:** after the pilot, the MDD is re-printed with the measured control rate, build variance, unforeseeable share and repository mix; past 0.12, the question goes to the Captain before any skill-arm build, with the pre-decided option of moving the eng phase arm's remaining budget into more standalone units.

## 11. Decision mapping (R97), frozen before any spend

| Outcome | What changes |
|---|---|
| Standalone KEEP | GStack Minder keeps the restored skill's test review and failure-modes sections as they are. The component and section prints are leads, not findings, for any later tuning (avoid-led points to failure modes and edge cases; catch-led to the coverage diagram and test plan). Users are told, with the interval and the package named: on real bugs from open-source fixes, builds from plans the forced skill reviewed passed more of the real fixes' tests, or caught more of the bugs, than builds from a plain Opus review. |
| Standalone helps without KEEP | Minder gets a brief: the skill moves the planted bugs but costs the rest of the change; look at scope drift in the reviewed plans. Users are told both halves. |
| Standalone, no measurable difference or not shown | FIX-METHOD, no cut. Minder gets a rewrite brief for the test review and failure-modes sections, steered by the judged secondary: if the skill's plans named the planted condition more often than plain but builds didn't differ, the hand-off is the gap (the plan's task and test output, ENG-8); if they didn't name it more often, the coverage and failure-mode procedure finds nothing plain Opus doesn't. Users are told plainly: no measurable difference on these real bugs at MDD X; the skill's other aims are untested. |
| Standalone hurts | Minder investigates before the next stable cut that carries the skill (length, scope drift, builder distraction, using the stock and length lines), and the skill's docs say what we found. Users are told plainly. |
| Eng phase KEEP, no difference or hurts | The same rows for autoplan's Phase 3 as users get it in Claude Code. |
| Standalone better than eng phase (interval excludes zero) | Autoplan's Phase 3 wrapper (its opening, eng-phase.md, unattended.md and the skip list) loses what the skill adds: Minder gets a brief to fix the wrapper, with the skipped sections named. |
| Eng phase better than standalone | The wrapper adds something: Minder gets a brief to move the wrapper's instructions into the standalone skill. |
| Neither better | No change to autoplan's wrapper. |
| Stock matches a skill arm (section 9's rule) | The measured gain is reachable by a short generic checklist: Minder gets a brief to put that checklist into the build hand-off and trim the procedure the gain doesn't need. "Not distinguished" sends no brief. |
| Exposure gate fails for an arm | A gstack bug for Minder: the skill doesn't run its procedure unattended under a forced invocation and the Stop hook. That arm reads untested. |
| Admission FLOOR, INSTRUMENT, or CEILING after the raise | No skill reading; FIX-METHOD on task fit, instrument or saturation. Nothing in gstack changes. The record steers the next attempt (floor: richer plans or smaller regions; ceiling: users are told plain Opus already avoids these real bugs). |
| Short supply under 40 units | Stop for the Captain; nothing in gstack changes. |
| Sol or particle-1 stage (conditional) | The same rows per model; a skill that helps on Opus and not on Sol gets a brief for its GPT-host profile. |

## 12. Money (internal: a gate input)

Prices at $1 per 1,000 credits, measured where we have them (attempt 1's ledger-settled stage 1: Opus reviews plain $0.54, pre-cut skill $2.19, eng phase $2.81; the Stop hook adds an assumed 25%; Astra at maximum effort $0.59 a call on smaller inputs). Builds have no measured figure on these units; the planning figure is $2.50 (1.33 times H1's measured $1.88 no-gstack Opus build), and the pilot replaces it under the first-session rule.

| Item | Projection | Cap |
|---|---|---|
| Comparison reviews and builds: 64 units x 3 x ($0.54 + $2.74 + $3.51 + 3 x $2.50), the pilot's 40 plain inside | $2,744 | $3,230 |
| Stock control builds: 64 x $2.50 | $160 | $190 |
| Authoring: about 115 qualifiers x ($0.70 for plan, audit, hint and two foreseeability ratings + $2.50 hinted build), plus 76 no-review builds x $2.50 | $560 | $680 |
| Exposure smoke: 12 Opus skill sessions | $37 | $50 |
| Judge: Astra two calls on about 450 bundles at high effort (about $0.25 a call), gold on 48 by two labellers, controls | $280 | $350 |
| Hosts: Ubicloud standard-8 at about $0.25 an hour, about 360 VM-hours (about 11,000 cold grading runs, builds, screening) | $90 | $130 |
| Crew threads on this line (this thread to the prereg merge with a gate-class /ship, the run thread, the results thread) | $450 | $500 |
| Reserve, held by the Captain | | $150 |
| **All-in, attempt 3** | **about $4,321** | **$5,280** |

Reserve mechanics: if the running all-in projection for this attempt (settled spend plus each open item's re-projection, crew included) passes $5,000, the run stops for the Captain before spending past it, because Garry gets a heads-up there under R42 (Captain condition 3). Each run item opens one ledger lease; a review or build session is admitted only when the item's settled spend, plus $16 for each attempt in flight, plus the new attempt's allowance, fits under its cap. The first session of each item runs alone, and if its measured cost re-projects the item past its cap, the item stops and comes to the Captain. Run items halt after 10 sessions if the running mean projects past the cap. A draw on the reserve, a cap raise, or a projection past the recorded line comes to the Captain before spend. The content raise is not in the caps above; its projection and cap come to the Captain before it spends (section 7). Caps sit at about 1.2 times each projection.

**Spend order keeps the risk small:** authoring batch 1, the exposure smoke and the pilot cost about $330 of paid calls; if the pilot stops, the attempt ends near $800 all-in with crew.

**Conditional Sol and particle-1 stage** (R54; reviewers only, the Opus builder, plain, eng phase and standalone, 2 a cell on the 64 units, with its own 3-session exposure smoke per arm): Sol about 64 x 2 x ($1.21 + $4.53 + $2.04 + 3 x $2.50) = $1,956; particle-1 about 64 x 2 x ($0.07 + $0.25 + $0.35 + 3 x $2.50) = $1,046; about $3,030 with smokes. It runs only if an Opus skill arm reads helps or hurts, and only after the Captain's go; it takes the attempt past $5,000, so it also goes to Garry. Sol pins main's metering proxy with GST-2384's token-count reservations; any reservation-only refusal above 1% stops for the Captain.

## 13. Harness: what the prereg PR builds

Reused from main's lanes/eng-build (prereg 2026-11-11-geva-522): recipes, screen, the unit builder and its eb.json schema, leak and containment gates, the sandbox sidecar, the review stage, the build launcher and session image, catch.ts, coverage.ts, recount, ledger items and the analysis. Reused from attempt 1's lane on main: render.ts, exposure.ts and stophook.ts. Changed or new, each with its tests:

- **lanes/eng-build/planted/:** the repository search and seeded draw, the miner (fix commits in the frame, with the earliest public date), the region finder (enclosing function or method per product hunk at P, with ast-grep), the stubber per language with the Rust test-region rule, the root-commit B and the M and F' commits in a local mirror, the unit repo built from that mirror, the /testbed one-commit check, the body check, and construction drops recorded by reason.
- **Lane overrides for planted units:** the functional-set rule, the crash-class rule in the planted and catch graders, the catch null rule, the keyless signature note, the reviewed-plan mount in build-stage.ts (reviewed arms get the review's plan.md at /work/plan.md), and the exposure detector and render.ts re-pinned to the restore commit's digests (render.ts today refuses any gstack but 199931029).
- **Authoring stages:** the plan writer and two-way plan audit prompts, the hint writer and audit, the foreseeability raters, the hinted and no-review build arms, and the stock control arm; each on the product-value meter or the build launcher under its own ledger item.
- **Sandbox:** the frozen grading sandbox of section 2, with attempt 2's kit-strip and git grep -f fixes ported from eb525-lane-fixes.
- **Recipe fixes the probe found:** the Rust screen mounts the cargo registry and git directories as volumes so offline tests see the installed crates; the Go image follows go.mod's toolchain line, else the newest Go release that builds M's tests, instead of go.mod's minimum version.
- **Scoring and analysis:** the composite and the component rule, per-arm families with the Holm line, the standalone minus eng phase secondary, the stock and no-review lines, the verdict precedence above (no CUT-CANDIDATE path), the pilot's lines and the content raise, MDD and re-projection prints.
- **Judged secondary:** the two-call Astra reading, the gold labelling, kappa with sensitivity and specificity, the stock and generic controls, the plan-leak flag, the section map.
- **power.py:** the simulation of section 10, attached with its output.
- **Reason codes** in src/errors/codes.ts under a new E_EP_ prefix, only for refusals that stop a run; unit drops (construction, body check, hinted drop, foreseeability) are records with a reason, not errors. Each code prints what (the measured value and threshold), the fix (a needs-you to the Captain, or none), the recovery (no retry for admission and cap stops; which leases settle and which stay open; the spend committed), the code with its docs/errors.md anchor, and the context (item, unit and build counts): E_EP_SUPPLY_SHORT (under 80 qualifiers before freeze, or under 40 admitted units), E_EP_INSTRUMENT, E_EP_FLOOR, E_EP_CEILING (after the raise), E_EP_COMPONENTS_SPLIT (one at the floor, one at the ceiling), E_EP_TESTBED_HISTORY (a unit or session image with more than one commit), E_EP_JUDGE_CHECK. The lane's E_EB_ codes are reused, never renamed.
- **Keyless dry run that drives every frozen rule:** a fixture fix in each ecosystem through mine, construct, screen and recount; a B with a parent refused by the /testbed check; a Node fixture whose dist/ holds the removed body dropped by the body check; a fix that rewrites an existing assertion (the case leaves the functional set); a fix that only adds a test file (a functional set from P's tests); a Python AttributeError-on-None bug and a JS undefined-property bug that qualify as planted and count in catch; a Rust inline-test unit; a Go fixture whose changed test file holds helpers other tests use (the helpers stay at B); the Rust registry volumes and the Go toolchain pick; the admission cases (avoid 0.15 with catch 0.02, avoid 0.95 with catch 0.60, avoid 0.90 with catch 0.05, both in band) and each line on both sides (reach 0.59 and 0.60, floor 0.09 and 0.10, ceiling 0.75 and 0.76, lower bound 0.65 and 0.66); the content raise; exposure at 4 and 5 of 6 and the interim stop at 0.69 and 0.70; the Stop hook's blocks; the bundle cap; the reviewed-plan mount; catch on a fixture where the build's test catches, one where it doesn't compile (0 in the primary, null in the sensitivity read); KEEP with the functional share at -0.10 and -0.11; each verdict's precedence; stock credit with and without plan-only credit; short supply at 39 and 40 units; one ledger lease per item on a temporary ledger; and a driven launch of a review and a build against a stub upstream through the real launcher, sidecar and teardown (the CREW "pin needs a driven launch" rule), plus a no-model preflight row on a real VM before any paid row.

## 14. Order, start rules and stops

1. The prereg PR merges through /ship at gate class; the Captain records line and item caps and gives the go.
2. Keyless, on the screening host: mine, construct, screen and recount the whole frozen manifest in the frozen sandbox. Under 80 qualifiers stops for the Captain.
3. Authoring batch 1 (6 calibration and 20 pilot units), then the exposure smoke, then the pilot and its admission read, and the first judge call alone. Any stop line goes to the Captain at once, in the same step that proves it.
4. Fewer than one Opus skill arm through the exposure gate ends the comparison; one arm through runs that arm's family alone.
5. Authoring batch 2, then the comparison cells, then the judge check and the judged secondary, then analysis and the results PR.
6. Every stage's records are sealed to the eng-review recipient and copied to org custody as soon as they are written; any host holding non-reproducible images is copied off before a paid stage depends on it, and every VM is destroyed when its work ends.

## 15. Custody, outside terms and public safety

Units come from public permissive repositories, cloned at build time; nothing is redistributed. The candidate manifest, fix ids, plans, hints, notes, ratings, planted case ids and every transcript are held-out material: sealed with age to the eng-review recipient, stored in org custody, never committed. The public repo gets the prereg, the harness, counts and digests. Model terms: Anthropic, OpenAI and Google API use as in earlier evals; GitHub search and API use within rate limits; no outside benchmark or dataset is used. The no-gstack arm runs where no drive and no gstack path exist.

## 16. Risks and limits

- **Ceiling:** Opus may re-implement the functions without the original authors' slip. The pilot and the content raise handle it; a ceiling after the raise is itself the finding.
- **Floor and coupling:** a fix's test may need an exact message or internal call. The hinted build drops those units; the foreseeability rating drops units no review could help.
- **Narrower construct:** reimplementing removed functions from a plan is narrower than planning a new feature; claims say "on planted units from real fixes", never "on real changes".
- **Plan realism:** plans are written by Sol from the real code and audited to be silent at the planted condition; they may read cleaner than team plans. Plan words and the first-draft bug-statement rate print.
- **Contamination:** fixes are public after Opus's stated cutoff by their earliest date, but the buggy pre-fix code may predate it. That pushes every arm toward the original bug equally and biases toward a null, not toward a skill; the popularity and strict-window strata print.
- **Catch compile:** a build that renames or adds helpers can't transplant its tests; the compile rate prints per arm, and the note fixes public names.
- **Forced package:** the skills run under a forced invocation and a Stop hook that production gstack doesn't have; every claim names that package.
- **The eng phase arm** runs autoplan's Phase 3 text alone on a plan, as attempt 1 did, not a whole autoplan run.
- Not in scope: changing gstack (skill findings go to the Captain), the design, HM, SM and PF lanes, and any posting.

## Review record

The lean /autoplan run's record is attached as review-record.md. Its one reviewer read the plan as first written; every finding is folded into this text, and the Captain's answer and conditions are under Approval.
