---
id: 2026-11-08-geva-397-autoplan-larger-features-prereg
kind: plan
title: "Preregistration: does autoplan help Opus 5.5 build larger Go features? A headroom check on plain Opus first, then a comparison with no gstack if funded"
summary: "A new set of 42 larger Go features merged after 2026-10-01. H1: plain Opus 5.5, 3 trials a task, must land in a middle band. C1, only if funded: told gated autoplan against no gstack, 42 x 4."
author: GEVA-397
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-08
status: open
links:
  - 2026-11-03-geva-225-outcome-per-skill-plan
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-06-geva-364-g-admission-results
  - 2026-11-05-geva-292-difficulty-ladder
  - 2026-11-07-geva-387-e2-autoplan-exposure-prereg
  - 2026-11-07-geva-393-e3-autoplan-gate-order-addendum
  - 2026-11-07-geva-391-e2-autoplan-exposure-results
  - 2026-11-08-geva-396-autoplan-report-order-recheck-results
  - src/runner/proxy/metering-proxy.ts
  - lanes/outcome-skills/arms/exposure.ts
  - lanes/outcome-skills/arms/registry.json
  - lanes/real-outcome/score/analysis.ts
  - src/runner/stats/paired.ts
source: "Written by GEVA-397 from the Captain's brief of 2026-11-07 and the next-round autoplan plan (sections 3 and 4) in the Captain's drive."
attachments:
  - 1179fb27e4e137af7b7f71833b62ca0b698750c98feccd431e493f5654a4f0f0  oc.py
  - 0783c886930de9a61588fe2097f9dda1fd9f9b2a7bfdb4bf20321e09c938c17f  oc.txt
---

# Preregistration: autoplan on larger Go features, a headroom check first

GEVA-397 for the Captain (GEVA-2). This post spends nothing. No model call, VM or eval ran to write it; oc.py ran keyless on this thread's machine, and a free count of public GitHub metadata sized the task pool. No paid call of this experiment starts until this post has merged and the Captain has recorded each item's cap in approvals/, citing it.

## Approval

Approved on 2026-11-08. This plan went through gstack's lean /autoplan review, run autoplan-20261108021210: one Opus 5.5 reviewer, one gate revision and the outside-terms question. The Captain relayed gate 1 to the project owner, who took every recommendation: refusals are sorted by code (section 5.2), the plan is approved with the reviewer's changes (Review record), and H may depart from the difficulty ladder's flat cost per session for this test only, as plan v3 section 9's ceiling raise (section 1). The Captain records each item's cap in approvals/ when this post merges, and no paid call opens before that.

## ELI5

autoplan is gstack's skill that reviews a plan before any code is written. On our old Go task set, plain Opus 5.5 solved every task without help, so no planning skill could show a gain there. A recent check found that, with gstack's new stop gate, a session told to run autoplan does run its review steps. So the open question is whether those steps lead to better shipped code on harder work.

This post builds a new set of 42 harder tasks: real Go features from open-source projects, each larger than the old ones and merged on or after 2026-10-01. First, plain Opus 5.5 works each task three times (H1). If it solves too many, there is no room for any skill to help, and we say so. If it lands in a middle band, the Captain asks the project owner whether to fund the comparison (C1): told autoplan against no gstack, each task four times. Every rule for both stages is fixed here, before any money moves.

## Before → after

- **Before:** autoplan's exposure check passed (3 of 4 told sessions at gstack ddbf1c9a with the gate on), but its effect on what ships is untested on Opus 5.5. The only task set we have is at the ceiling (22 of 22). Plan v3 names larger, newer features as autoplan's one ceiling raise, with a 40 x 3 headroom check first, but no task set, rule or cap exists for it.
- **After:** the new set's mining rules, H1's arm, size, reading and caps, and C1's arms, size, test, readings and proposed caps are frozen. H1 runs inside the Captain's money. C1 runs only if the project owner funds it.

## Why it matters

A skill that shows no gain on the frontier model goes to one of two tracks: harder tasks with headroom, or cutting the lines that don't help. For autoplan, the most expensive skill per session that gstack ships (told sessions cost about 20 times a plain session in G), the harder-task track has not been tried. The crew's rule for a saturated null is one ceiling raise before any cut question. This is that raise, run so its answer is clear either way.

## What caused this work

- G's admission: plain Opus 5.5 solved 22 of 22 valid T-G trials, so autoplan stopped as FIX-METHOD (saturation and exposure).
- Two exposure checks then failed on gstack's side (R61, E2). gstack changed its stop gate to enforce report order (commit ddbf1c9a), and E3 passed at 3 of 4 exposed on it (E3's results post, 2026-11-08-geva-396-autoplan-report-order-recheck-results).
- E2's results post priced a powered comparison at about $4.3k to $5.1k for 42 tasks x 4 trials, past autoplan's line, so it needs the project owner's funding.
- The Captain's brief of 2026-11-07: one prereg covering H1 and C1, H1 at plan v3's 40 x 3 unless 20 x 3 is shown equivalent, enough mined tasks for C1's 42, C1 told gated autoplan against no gstack.

## Big decisions

1. **H1 runs 42 x 3 on C1's own 42 tasks,** not 20 x 3. Near the top of the band, 20 x 3 makes the wrong call about twice as often as 42 x 3 (oc.txt: 21.3% against 10.6%), so it does not give the same call with the same confidence. 42 x 3 also reads headroom on exactly the tasks C1 would run. What would flip it: none.
2. **One task set for both stages, unscreened.** C1 runs fresh sessions on the same 42 tasks. H1's none sessions never enter C1's data. What would flip it: none; reusing H1's sessions would need a rule written before any outcome, and this post writes the opposite.
3. **Session limits doubled for the larger tasks.** none: $16, 400 turns, 3 hours. Told autoplan: $90, 800 turns, 8 hours. The metering proxy stops a session about one worst-case call short of its allowance, so G's $8 none sessions really stopped near $4.1, and its $45 told autoplan session near $32.6. On features two to three times larger, the old limits would decide outcomes by budget. This departs on purpose from the difficulty ladder's flat cost per session, because H is plan v3 section 9's ceiling raise for autoplan, not a ladder tier (section 1). What would flip it: a reviewer showing the old limits hold on tasks this size.
4. **C1's told arm is E3's arm, unchanged apart from its limits:** gstack ddbf1c9a, the lite render, the stop gate on, the rec persona, autoplan's default full kind. It is the only configuration with a passing exposure check.
5. **Opus 5.5 is the only model.** The told arm runs in Claude Code, which drives Anthropic's models here; GPT-6.1 Sol can't run in it, and particle-1 has no admission row.
6. **Caps rest on a stated mean, not on every session at its allowance.** Each session limit is far above the expected cost, so worst-case caps would hold money the run can't use. Each cap covers a stated mean cost per session, about twice the expected, plus every session in flight, and a cap stop is itself a reading (section 7).

## Implementation plan

### 1. What this covers, and what it changes

One experiment in two stages, as the crew's two-PR rule sets it: this preregistration, then one results pull request that carries H1, C1 if it runs, every amendment and any harness change, each pinned by its commit on that branch.

- **H1, the headroom check.** Plain Opus 5.5 on H's 42 tasks, 3 fresh trials each, plus 2 told smoke sessions to price told sessions on tasks this size. It runs inside the money the Captain records after this post merges.
- **C1, the comparison.** Told gated autoplan against no gstack, 42 tasks x 4 trials. It runs only if H1 reads HEADROOM and the project owner funds it.

Every plan v3 rule this post doesn't name stands as written. Changed or filled in here:

- **The ceiling raise's shape** (plan v3 section 9): K3 features merged on or after 2026-10-01 with 3 or more source files and 200 or more changed lines, as plan v3 names it. The K1 subset is left out: G's 12-task slice held a task or two of it, and K1 needs an introducing change with escaped-defect tests that this size rule rarely leaves.
- **H1's size:** 42 x 3 instead of plan v3's 40 x 3, so the check covers C1's whole panel (section 5).
- **H1's band:** none between 0.20 and 0.65, not admission's 0.20 to 0.80. A 19.8-point MDD needs room above none, and at 0.65 there are 35 points.
- **Session limits** for both arms (section 4).
- **Not a ladder tier.** H is plan v3 section 9's ceiling raise for autoplan, the one attempt R61 requires before a cut question. It is not a tier of the difficulty ladder (2026-11-05-geva-292-difficulty-ladder), which makes tasks harder at a flat cost per session, through task content and scoring, and keeps G's turn and step caps. The project owner ruled out longer tasks for the ladder. H departs from that on purpose: plan v3 section 9 names larger, newer features as autoplan's raise, and larger features cost more per session, so H raises the session limits (section 4) and prints the ladder's budget anchor without applying it (section 5.5). The Captain ruled on this precedence on 2026-11-08, and the project owner allowed the departure for this test only, as line C of this post's gate (Approval).
- **Go only, unscreened, at most 1,000 lines.** Plan v3's K3 shape names no language, no screen and no upper size. H takes Go only, so the size rule, the build and the test runner are the same for every task, and section 3.7's count was made on Go. The panel is unscreened (no keep rule, section 13). Changes stop at 1,000 source lines so one session can hold a task.
- **C1's exposure admission** (plan v3 section 6 rule 2, told 7 of 8). For this arm, E3's pass replaces it: 3 of 4 told sessions read exposed at ddbf1c9a with the gate on. H1 still prints both smoke sessions' exposure, and if neither reads exposed, H1 stops before the funding ask (section 5.6).
- **Refusals sorted by code** (section 5.2). The proxy's refused counter counts every refusal, so H reads each one from the proxy's journal and scores it by its code and reason.
- **C1:** no futility look, because G's simulation found that at 42 x 4 the look stops no simulation at a true null or at the planned MDD. No mutation score, because G's mutation tool returned a tool error on 34 of 63 trees.

### 2. Pins

- **Told arm.** gstack ddbf1c9a471dbce28ed4ce7340b8af4dd3272957, installed with ./setup --host claude --loadout lite --autoplan-gate in a clean HOME that the session sees as /root, built by E3's install script (e3-told-install.sh, sha256 a0505070fda4a1639a5f7ab04fd1a173268bba3956a53fa0e8c2f9e6107f583b, unchanged), with its install checks and its render: 197 files, digest 70db9ce62a5792b80700aed9dc6e500b079fe2ee1a8a04ef9c49cd92078158ff. The tar's sha256 goes into the run record, the custody log and the run env file before any lease. The pin was committed before H's mining starts, so no gstack change can be shaped by H.
- **Harness, both arms** (as E3): Claude Code 2.1.312 with the claude-code-preset system prompt, claude-agent-sdk 0.2.174, Harbor f3a5a92 with real_agent in U4 mode and HARBOR_TELEMETRY=0, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, model claude-opus-5-5. Told sessions run in the interactive session kind under the rec persona with its hold line.
- **Exposure detector:** autoplanExposure in lanes/outcome-skills/arms/exposure.ts, sha256 f0882eaf2d5fe19ef682ec0f0c88e9a1239870a04544cf6adbf6d34e4e167694 (E2 and E3's), with E2's refusal and over-credit rules and E3's refused-publish check.
- **Decision code:** lanes/real-outcome/score/analysis.ts (compare) on src/runner/stats/paired.ts (clusteredPairedDelta), set as the G prereg's section 8 freezes it (section 6).
- **Run commit.** A commit on the results branch that adds H's arms file and changes nothing G, E2 or E3 froze: lanes/outcome-skills/arms/h-registry.json, a copy of registry.json in which only the two arms' limits take section 4's values; a --registry flag on gstack-evals outcome serve that hands that file to the stage driver, whose registry option exists today; tests that h-registry.json loads and differs from registry.json only in those six numbers, and that the flag reaches the driver; and the images tool's set name if it needs one. registry.json and its tests stay as they are, so G's, E2's and E3's arms keep their frozen limits on main. The run record and the Captain's caps entry name the commit before any lease. rig.yml must pass at it, and every admit uses that run.

### 3. The task set H

**3.1 Source.** Public GitHub repositories found by GitHub's repository search: language Go, at least 100 stars, a push since 2026-10-20, not a fork, not archived, under MIT, Apache-2.0, BSD-2-Clause or BSD-3-Clause, with the SPDX id read from the LICENSE file at each task's base commit (V8). Repositories also pass real mine sample's rules: a push in the last 30 days, at least 20 first-parent commits in the window, a test runner with tests, a lockfile (go.sum), no project .claude/ or .mcp.json, and no package that ships in the gstack arm.

**3.2 Which changes qualify.** real mine repo's K3 rules in the strict stratum: a change whose exposure starts on or after 2026-10-01, that closes no issue, touches source and tests, changes no dependency and holds no Claude config at base. On top of those:

- at least 3 non-test Go source files changed. A file doesn't count when it ends in _test.go, sits under vendor/ or testdata/, or carries Go's generated-code marker ("Code generated ... DO NOT EDIT.");
- 200 to 1,000 changed lines (added plus deleted) in those files;
- a root go.mod and go.sum at base;
- 1 to 12 top-level Go tests changed or added, the functional test candidates;
- no change already in T-G. Before authoring, the mining thread compares candidate commits against T-G's sealed task list in a counts-only custody opening and drops any match.

These filters run on real mine repo's output, which is looser than H's rules, before real mine panel. The panel orders every eligible change with seed h-20261108 and never keeps two that share an upstream change. It runs with --per-repo set to the largest eligible count of any one repository, so it only orders and drops nothing; section 3.5's cap of 3 a repository applies when a task is accepted, so a repository whose change fails a check fills that slot from its next change in order. Work goes through that order. Nothing is picked by size or content beyond these rules.

**3.3 Building, statements, audits and checks,** as T-G was built:

1. **Probe.** Build each candidate with a placeholder statement and run the mechanical check (one gold run, regression list frozen). A hidden test that never runs in the container (missing or skipped at gold) leaves the functional list, as in T-G, if at least one functional test remains.
2. **Statement.** GPT-6.1 Sol, a family not under test, writes the statement in its own words from the public change: the source diff without its tests, a README excerpt and the names the hidden tests call that are missing at base, all of which it must name.
3. **Mechanical check** with the statement.
4. **Audits.** Opus 5.5 and GPT-6.1 Sol, each with no gstack and no tools, rule on V4 (every missing name a hidden test hits is in the statement) and V5 (each behavior a hidden test requires follows from the statement, the repository's own docs and tests, or plain correctness). A task passes only when both auditors pass it.
5. **Full check.** real task check with 10 gold runs, the audit records read and the regression list frozen: L1 to L6 and V1 to V8.

**3.4 The hidden-constraint tag.** Each audit call also answers one question: name the one hidden functional test, if any, that checks a behavior the real change had to get right but the statement doesn't state, and that follows from the repository's own docs, tests or plain correctness (compatibility, a migration, concurrency, an error path, a limit), or answer NONE. A task is tagged when both auditors name the same test and the task has at least one other functional test. The named test is the task's constraint test, recorded in the sealed key with whether it is also a functional test. V5 still applies, so a tagged task stays fair. There is no target count.

**3.5 Size and composition.** H has 42 final tasks and 4 spares, all K3. The 42 must span at least 20 repositories, the floor plan v3 and the G prereg's power check use, with at most 3 from one repository. Acceptance walks panel order, and a candidate that passes the full check becomes a final task unless one of two skips applies:

- **Cap skip:** its repository already holds 3 final tasks.
- **Floor skip:** its repository already holds a final task, and taking it would leave fewer open slots than the repositories still needed: 42 minus the accepted count minus 1 is less than 20 minus the repositories held.

A skipped candidate is recorded with its reason and never comes back. The skips depend only on tasks already accepted, and their slack never grows, so a candidate the rules would skip now is skipped before any paid call on it. Mining may build candidates in parallel, but acceptance is decided in panel order, so parallel builds don't change which tasks are final. After the 42, the next 4 candidates in order that pass, under the cap of 3, are spares. If the eligible pool runs out before 42 tasks and the floor are met, mining stops and the Captain decides, before any H1 session, whether to run fewer tasks or relax the floor. A spare replaces a final task only if that task's image stops passing gold under custody before any session of the stage that would run it, and the first spare in order that keeps the cap and the floor takes its place.

The images are pinned as T-G's were (outcome images pin), and each must show gold passing every required test and the empty change failing at least one. If the images tool needs a new set name for H, that change goes on the results branch at the run commit.

**3.6 Custody.** Mining, authoring and image builds run on a Ubicloud build host. Statements, hidden tests, commit ids and keys never print into a thread's transcript, only counts and digests. The bundle is age-encrypted to the same recipient as T-G and kept under handoffs/h/sealed/ in the Captain's drive, with its own CUSTODY.md. Labels are "th" plus 10 hex characters from random bytes. Sealed material is decrypted only into /dev/shm, with a leftover check on every wake, plaintext deleted and checked with test ! -e, and /tmp, /var/tmp and the tool-output folder swept at every seal and at the end, logging stat data only. Who must not open the set: the gstack Captain's crew, any thread building a gstack candidate under test, and authors and auditors after sealing. The repository gets counts and digests only, in the results post.

**3.7 Feasibility, measured free.** On 2026-11-08 this thread counted public GitHub metadata through the GraphQL API, using about 250 points of the shared quota. Of the 329 most-starred Go repositories under the four licences with at least 300 stars and a push since 2026-10-20, 210 had at least one pull request merged since 2026-10-01 with 250 or more changed lines over 4 to 60 files among their 40 most recently updated: 1,339 such pull requests. In a seeded sample of 200 of them, 38 (19%) had H's shape (no closing issue, at least 3 non-test Go source files, 200 to 1,000 changed lines in them, a test file touched, no go.mod or go.sum change), from 31 repositories, at most 2 from one. That puts about 250 H-shaped changes in that pool. The count doesn't apply the strict stratum's exposure rule (a pull request opened and committed on or after 2026-10-01) or real mine sample's repository rules, so it overstates the eligible pool. T-G turned 48 probed candidates into 22 audited tasks (46%). At 30% H needs about 150 eligible changes, which is why section 3.1 searches down to 100 stars, and the mining thread reports the eligible count and its repository count to the Captain before any paid call.

### 4. Arms and models

| Arm | Install | Turns, verbatim | Limits | Runs |
|---|---|---|---|---|
| none | bare, in the clean room: no drive mount, no gstack install, no skills folder, and a preflight that refuses otherwise (G's none arm) | T1: the statement, then "Work in this repository. Implement this, and make sure it works. Don't stop to ask." | $16, 400 turns, 3 hours, quiet 30 s, background wait 600 s | H1: 126; C1: 168 |
| told gated autoplan | E3's arm (section 2) | T1: the statement, then "Before you write code, draft your plan in PLAN.md. Don't write code yet." T2: "/autoplan PLAN.md" T3: "Now implement your plan, and make sure it works." | $90, 800 turns, 8 hours, quiet 30 s, background wait 600 s | H1 smoke: 2; C1: 168 |

**Why the limits move.** H's changes run 200 to 1,000 source lines against T-G's 30 to 300 added, and limits exist to stop runaway sessions, not to make tasks hard (the difficulty ladder's rule: no tier gets harder by budget). The proxy refuses any call whose worst case won't fit, so a session stops one worst-case call short of its allowance. In G, $8 none sessions stopped at $4.09 and $4.24 (2 of 24, on one task), and the $45 told autoplan session stopped at $32.64. E3's told sessions cost $16.62 to $22.66 on T-G (E3's results post). Doubling every limit keeps a budget stop rare on larger tasks, and H1's cost rule (section 5) still catches it if it isn't. The doubled limits change nothing in what a session is told or how it runs; E3's sessions never came near the old ones.

**Where the change lives.** In H's own arms file, lanes/outcome-skills/arms/h-registry.json, added at the run commit (section 2). It is registry.json with six numbers changed: session_cap_usd, max_turns and wall_limit_sec for none and for autoplan:told take the values above. quiet_sec and bg_wait_sec, the turns, the arm names and every other field stay as they are. The stage driver loads it through outcome serve's --registry flag, and real_agent reads the same file through its arms_path option, so the driver's check that a session's cap equals its arm's session_cap_usd holds. The detector reads turn texts from registry.json, which h-registry.json matches. registry.json itself doesn't change, so G's, E2's and E3's frozen arms stay true on main.

**Models.** anthropic/claude-opus-5-5 only. GPT-6.1 Sol can't drive this arm, which runs in Claude Code on Anthropic's API, and G left Sol out of wave 1 on price (R3a metered Sol at 1.33 times Opus's none session and 1.63 times its told session). particle-1 has no admission row, and a told session on it through Claude Code would need the gateway clause in Anthropic's terms (plan v3 section 11) and its own exposure check. The crew's rule names both as models under test where the harness can run them, so this is the reason they are left out. No judge: hidden tests decide.

### 5. H1: the headroom check

**5.1 What runs.** 42 tasks x 3 fresh none trials, 126 sessions. The run walks pass 1, then 2, then 3. Pass t runs the sorted labels in the order random.Random(20261108 + t).shuffle gives, at most 4 sessions at once. After the last none session settles, 2 told smoke sessions run one at a time on the tasks random.Random(20261109).sample(sorted labels, 2) gives, on their own lease.

**5.2 Scoring a none trial.**

- **Solved:** the final tree passes every hidden test, functional and base suite, in a verifier-owned run (the lane's grade.ts).
- **Refusals, by code.** The proxy's refused counter counts every refusal (src/runner/proxy/metering-proxy.ts, refuse), so h1-read.ts reads each refusal from the proxy's journal for the trial's meter, with its code and reason. When the session ended on a refusal (its last journaled call was refused), that refusal decides the trial's class below. A refusal the session outlived is counted by code (section 5.5) and doesn't change how the trial scores. The journal's refusal count for each meter must equal the session summary's refused count, read from either field (refused_budget or refused); a mismatch goes to the Captain before the reading.
- **Budget stop:** the session ended on the allowance refusal (E_ALLOWANCE, status 402, the slot's allowance can't hold the call's worst case), at the turn ceiling or at the wall limit. The trial is valid and scores unsolved.
- **Gap:** an infra failure that is not a budget stop. That covers no model response and a harness or verifier error under the lane's termination taxonomy, and a session that ended on a refusal coded UPSTREAM, E_LEDGER_UNAVAILABLE or E_KEY_MISSING, on a ledger refusal at reserve (except CAP_STOP, which is never rerun: its trial stays a gap, and the stage ends at its cap under section 5.3's rule 1), or on any other E_ALLOWANCE refusal (a route, body, model allowlist, output cap or price refusal), which comes from the harness's setup and not the task. Each gap gets one rerun with a named repair, and H1 allows at most 6 reruns (5% of 126). A gap after its rerun, or past the sixth, stays a gap and leaves the denominator. A rerun never replaces a scored trial.
- **Tripwire:** a trial with any E_TRIPWIRE refusal (a request carried a forbidden marker, so the proxy calls the cell invalid). It is excluded and counted with contamination.
- **Contamination:** a none trial whose read audit shows a gstack or drive file read. It is excluded and counted. The arm is clean by construction on the run host, so the audit runs after the run.
- **G_B** (report-only, tagged tasks only): share is the fraction of functional tests other than the constraint test that pass, or 0 when a base-suite test fails; milestone is 1 when the constraint test passes; G_B = 0.6 share + 0.4 milestone. The constraint test counts once.

**5.3 The reading.** n is the number of tasks with at least one valid trial. Each task's score is its solved trials over its valid trials. s is the mean of the task scores, and UB = s + t x sd / sqrt(n), where sd is the sample standard deviation of the task scores and t is the 0.975 quantile of Student's t with n - 1 degrees of freedom, frozen at 2.022691 for n = 40, 2.021075 for 41 and 2.019541 for 42. Each task score is a fraction with denominator 1 to 3, so h1-read.ts compares s with 0.20 and 0.65 in exact rational arithmetic, and s can sit on a band end (78 of 120 is 0.65 at n = 40). When s is below 0.80, UB at or above 0.80 is checked as t^2 x sd^2 >= (0.80 - s)^2 x n, in exact rational arithmetic, with t at its frozen decimal value. The first rule that fits decides:

1. **INCOMPLETE:** the h1-none lease stopped at its cap before every one of the 126 planned first sessions ran. FIX-METHOD (cost changed): the cap covers a mean of $4.50 a session, about 4.8 times G's none mean. If the cap stop leaves only owed gap reruns unrun, H1 reads on, those trials stay gaps, and rule 2 applies.
2. **RIG:** more than 6 trials are still gaps, more than 2 are contaminated or tripped, or n is under 40. FIX-METHOD (rig).
3. **CEILING:** s above 0.65, or UB at or above 0.80. Budget stops only lower s, so they can't make a CEILING.
4. **COST CHANGED:** budget stops, as section 5.2 sorts them, on more than 10% of valid trials. FIX-METHOD (units): the tasks are harder by budget, not by content.
5. **FLOOR:** s below 0.20. FIX-METHOD (task fit).
6. **HEADROOM:** otherwise, which means s from 0.20 to 0.65 with UB under 0.80.

**Budget-sensitive HEADROOM.** Budget stops can't make a CEILING, but they can hide one. When H1 reads HEADROOM and s or UB, recomputed with budget-stopped trials left out, meets rule 3's CEILING test, the reading is HEADROOM (budget-sensitive). It goes to the Captain with both readings and the stopped trials' tasks before any funding ask, and an ask, if the Captain makes one, shows both. The recomputed reading is not a CEILING on its own, because budget stops cluster on hard tasks, and leaving them out raises s.

**5.4 Why 42 x 3 and not 20 x 3** (oc.txt, part A). oc.py draws a 42-task panel from a pool, takes the call the panel's own true mean none rate gives as the right one, and runs H1's rule at each design. 42 x 3 reads all 42 tasks; 40 x 3 and 20 x 3 read a subset.

| Pool | True pool mean | 42 x 3: HEADROOM, wrong call | 40 x 3 | 20 x 3 |
|---|---|---|---|---|
| U-shaped | 0.30 | 0.959, 0.032 | 0.967, 0.028 | 0.905, 0.092 |
| U-shaped | 0.50 | 0.991, 0.007 | 0.992, 0.007 | 0.890, 0.109 |
| U-shaped | 0.55 | 0.939, 0.047 | 0.946, 0.041 | 0.739, 0.243 |
| U-shaped | 0.60 | 0.773, 0.124 | 0.803, 0.123 | 0.539, 0.348 |
| moderate | 0.55 | 0.969, 0.031 | 0.974, 0.025 | 0.880, 0.120 |
| moderate | 0.60 | 0.813, 0.163 | 0.846, 0.139 | 0.709, 0.274 |

Pooled over true means from 0.55 to 0.75 on both pool shapes, the wrong-call rate is 10.6% at 42 x 3, 11.3% at 40 x 3 and 21.3% at 20 x 3. So 20 x 3 does not give the same call with the same confidence, and 42 x 3 matches 40 x 3 while covering every C1 task. Part of that match is a lattice effect: with 3 trials a task, 0.20 and 0.65 are values s can take at 40 and at 20 tasks but not at 42, so the strict thresholds fall slightly differently. The 20 x 3 conclusion doesn't depend on it. The extra 6 sessions cost about $10 to $15.

**5.5 Report-only readings.** None of these decides anything.

- The per-task histogram: tasks at 0, 1, 2 and 3 solved of 3.
- Refusals by code, budget stops by cause, gaps by cause, and the contamination and tripwire counts.
- Cost per none session: mean, median and 95th percentile, with token totals, and the median's ratio to G's none mean ($0.9325). This is the difficulty ladder's budget anchor, printed and not applied, because H is not a ladder tier and changes task size on purpose (section 1).
- Wall time and turns per session.
- G_B over the tagged tasks, with the tagged count.
- **Told smoke,** per session: cost, turns, wall time, termination, solved, the detector's four checks and verdict after E3's rules, and e3-read.ts's gate records. Two sessions price C1; they are not an exposure check.
- **C1's re-projected price** from H1's none mean and the smoke mean (section 7.3).
- **C1's reachable R48 readings:** the cost ratio m, the smoke mean over H1's none mean, and which section 6.7 readings C1 can reach at that m.

**5.6 What each reading leads to.**

| Reading | R48 | Next step |
|---|---|---|
| HEADROOM, and neither smoke session reads exposed | FIX-METHOD (exposure): the told arm didn't run its procedure on H | The Captain, with the gate records; no funding ask |
| HEADROOM (budget-sensitive) | admission met, flagged | The Captain, with both readings and the stopped trials' tasks, before any funding ask |
| HEADROOM | admission met | The Captain takes the C1 funding ask to the project owner with s, UB, the histogram, C1's MDD, its re-projected price, both smoke sessions' exposure, the R48 readings C1 can reach at the measured m, and the owner's 1.5x question (section 6.7) |
| CEILING | R61's one ceiling raise is used and shows no headroom: a CUT-CANDIDATE question on autoplan's outcome on Opus 5.5 | To the project owner plainly: Opus 5.5 builds larger post-2026-10-01 Go features without the skill, and told autoplan costs many times a plain session |
| FLOOR | FIX-METHOD (task fit) | The Captain |
| COST CHANGED, INCOMPLETE | FIX-METHOD (units or cost) | The Captain, with the cost readings |
| RIG | FIX-METHOD (rig): the attempt failed on the harness, which is not a cut | The Captain, with the fix named |

### 6. C1: the comparison (runs only if funded)

**6.1 When it may start.** Only when all of these hold: H1 read HEADROOM; at least one smoke session read exposed; the project owner funded C1 in words the Captain records in approvals/; the wave 1 envelope's autoplan line has room for C1's caps by the Captain's recorded decision (it holds $2,000 today); the Captain has recorded C1's caps citing this post; and C1's start rules hold (section 9). If the ask isn't answered yes, C1 never runs, and these sections lapse with no further post.

**6.2 Design.** H's 42 final tasks, unscreened, 4 fresh trials per arm per task: 336 sessions. For trial t = 1 to 4, random.Random(20261110 + t).shuffle orders the sorted (arm, label) pairs, and sessions run interleaved, at most 4 at once. H1's none sessions never enter C1's data.

**6.3 Primary and test.** Solved, as in section 5.2. Each task's arm score is the mean of its trials. The decision is G's frozen configuration (G prereg section 8): told minus none, delta the mean paired difference over tasks, z on the cluster-robust standard error by repository, and a helps or hurts reading only when |z| is above 1.959964 and the exact repository sign-flip one-sided p in z's direction is at most 0.025, counted inclusively. One final look. none above 0.85 makes no claim. truncation_guard is 0.05: above 5% truncated trials in either arm, a claim needs the readings with and without truncated trials to agree. Budget stops, sorted by code as in section 5.2, are truncated trials scored unsolved. The refusals section 5.2 calls gaps follow the gap rule, and a tripwire excludes its trial. Gaps are rerun once, at most 8 reruns per arm, and a remaining gap leaves its trial out.

**6.4 Power and MDD.** The claimed MDD at 42 x 4 is 19.8 points (plan v3's grid times 1.2). G's exact simulation of this test gave 17.0 points at its expected scenario and 19.0 at its worst, on screened pools. C1's pool is not screened, so oc.py reran G's power.py, unchanged, on unscreened pools (oc.txt, part B):

| Control pool (mean none rate) | ICC | Power at 19.8 points | Simulated MDD |
|---|---|---|---|
| U-shaped (0.35) | 0.05 | 0.965 | 15.0 |
| U-shaped (0.50) | 0, 0.05, 0.10 | 0.983, 0.978, 0.968 | 13.5, 14.5, 15.0 |
| U-shaped (0.65) | 0.05 | 0.994 | 13.5 |
| moderate (0.50) | 0, 0.05, 0.10 | 0.935, 0.911, 0.882 | 16.5, 17.0, 18.0 |

A U-shaped panel has more tasks near 0 or 1 that vary little between trials, so the same mean difference is easier to see. It also means a 19.8-point mean gain needs a larger gain on the tasks with room. Under a true zero difference on the U-shaped pool, a helps reading came in 1.6% to 1.8% of 20,000 simulations and any claim in 3.1% to 3.5%, against nominal 2.5% and 5%. C1 claims 19.8 points and prints the simulated values beside it.

**6.5 Exposure.** This arm's admission is E3's pass (section 1), not plan v3 section 6 rule 2; the 80% bar below is a rule for reading a null, not an admission. Every told session is read by the detector under E3's rules, and the exposure rate prints with its Clopper-Pearson interval beside the verdict. The test is intention to treat. If fewer than 80% of scored told trials read exposed, a helps reading still stands, but a null or a loss reads FIX-METHOD (exposure), never a cut question, because the skill's procedure didn't run where the detector can see it often enough for a fair test.

**6.6 Secondaries,** each with its interval and no claim:

- G_B on the tagged tasks, paired and clustered by repository as the primary, NO READ when fewer than 10 tasks are tagged.
- Cost per solved task, told over none, with a task-clustered bootstrap 95% interval (plan v3 section 9).
- Budget stops and gaps by cause, per arm; cost and tokens per arm.

**6.7 R48,** as plan v3 section 9 reads it for G, with the cost readings provisional until the project owner answers whether 1.5 times is the bar for a told skill:

- helps, and the cost ratio's upper bound at most 1.5: KEEP;
- helps, and the ratio's interval spans 1.5: FIX-METHOD (cost unsettled);
- helps, and the ratio's lower bound above 1.5: CUT-CANDIDATE on cost, to the diet track;
- not distinguished, and the ratio's lower bound above 1.5: CUT-CANDIDATE on cost;
- not distinguished, and the upper bound of told minus none under autoplan's break-even gain: CUT-CANDIDATE;
- not distinguished otherwise: the Why-null cycle, with the MDD and the interval;
- hurts: CUT-CANDIDATE.

Section 6.5's exposure rule comes first. Every CUT-CANDIDATE goes to the Captain and the project owner plainly, naming the configuration it covers (section 12).

**What C1 can decide.** Cost per solved task, told over none, is m times none's solve rate over told's, where m is a told session's cost over a none session's. A told session cost about 20 times a none session in G. KEEP needs the ratio at most 1.5, so m at most 1.5 times told's solve rate over none's, which is at most 7.5 anywhere in H1's band. At m near 10 to 20, KEEP is out of reach: C1 decides between the diet track (helps, CUT-CANDIDATE on cost) and a cut (not distinguished or hurts). The funding ask states the readings C1 can reach at H1's measured m and carries the project owner's 1.5x question with it, because his answer sets what C1 can decide.

### 7. Money

_Internal planning record: these budget and cost figures are plans and caps, not findings._

**7.1 Where the line stands.** autoplan's line is $1,347.54 all-in on actuals, plus E3's results thread, which read $3.36 when that post was written: about $1,351 of $2,000 (E3's results post). The final figure is read from that thread's counter when this post merges. The Captain's bound for this stage: a projected line past $3,000 before C1 comes to the Captain first. Crew dollars come from thread counters at $1 per 1,000 credits; reservations below use $0.45 per million tokens at each thread's hard stop. The $2,000 is autoplan's all-in line: paid calls, judges, VMs and crew model use. The ledger holds a line of the same size for its own items, which section 7.2's fit check reads. The project owner treats eval lines as guidelines (the Captain's brief of 2026-11-07), and the Captain accepted the line at about $2,530 all-in at caps on 2026-11-08 (GST-1864). The Captain's caps entry in approvals/ records it when this post merges.

**7.2 H1's items.** Each is one ledger lease on the wave 1 envelope.

| Item | What it pays for | Expected | Cap | How the cap works |
|---|---|---|---|---|
| h-mine | paid statement and audit calls for H | $20 to $40 | $80 | Mining stops at the cap and is never retried. T-G spent $0.19 of model calls per valid task on smaller changes |
| h-vm | Ubicloud host hours: the build host for mining and images, and H1's run host | $12 to $20 | $45 | 150 hours at $0.30 (standard-8) or 75 at $0.60 (standard-16); each hours lease gets its own cell task |
| h1-none | 126 none sessions and at most 6 gap reruns | $190 to $320 | $660 | 132 sessions at a mean of $4.50 plus 4 allowances in flight ($64). Past that mean, the stage can't open its last sessions and H1 ends INCOMPLETE (rule 1) |
| h1-told | 2 told smoke sessions, no rerun | $50 to $80 | $180 | 2 sessions at the $90 allowance, the true worst case |
| crew | three threads: this one (GEVA-397, stop 170M), the mining thread (stop 100M) and the run thread, which also writes the results post (stop 150M) | about $130 | $190 | the three token stops at $0.45 per million |
| **H1 all-in** | | **about $400 to $590** | **$1,155** | |

On the envelope, autoplan's ledger line reads $1,007.33 settled of $2,000 with nothing open, and H1's four ledger caps sum to $965, so all of them fit at once ($1,972.33).

**7.3 C1's items, proposed.** The Captain records these only after funding.

| Item | What it pays for | Expected | Cap |
|---|---|---|---|
| c1-told | 168 told sessions and at most 8 gap reruns | $3.9k to $5.5k ($23 to $33 a session, E3's $19.56 mean scaled 1.2 to 1.7 times for size) | 176 x max($45, 1.5 x the smoke mean) + $360 |
| c1-none | 168 none sessions and at most 8 gap reruns | $250 to $420 | 176 x max($4.50, 2 x H1's none mean) + $64 |
| c1-vm | the run host, about 110 hours | $35 to $70 | $90 |
| crew | the run and results threads | about $90 | $135 |
| **C1 all-in** | | **about $4.3k to $6.0k** | **about $9.4k at the floors** |

The cap formulas are frozen here and computed from H1's readings for the ask. At the floors, c1-told's cap is $8,280 and c1-none's is $856.

**7.4 The line at caps.**

| Part | Expected | At caps |
|---|---|---|
| autoplan's line before this post, with E3's results post (about $30 allowed for its thread) | about $1,377 | about $1,377 |
| H1 all-in | about $400 to $590 | $1,155 |
| **Line after H1** | **about $1,780 to $1,970** | **about $2,530** |

Both stay under the Captain's $3,000. C1 sits on top only with new money.

**7.5 Reserve mechanics.** As E2 and E3. The wave 1 envelope is rebuilt on the run host from its export in the project-user drive, its MANIFEST sha256s must pass, and its status must match the export byte for byte. Each item is admitted with rig admit against a green rig.yml run at the run commit. Paid calls spend only through the stage driver's U4 leases, which open a session only when the lease has room for that arm's whole allowance. A cap stop ends its stage incomplete and is never retried to change a reading. After settling, the record is exported again with a new MANIFEST. Crew threads count against the line and are not ledger items.

### 8. Run files and the dry runs

**Route.** As E2 and E3: run files in the project-user drive (h/), written from G's and E3's (g-harbor-job.sh, e3-harbor-job.sh, e3-read.ts, the G runner), with every edit listed in CHANGES.txt against its source. Their sha256s go into the run record and the Captain's caps entry before any lease, and the results pull request publishes them. The only repository change is the run commit's (section 2).

**Mining's files.** h-mine.ts (section 3.2's filters over real mine repo's output, the T-G overlap check, which prints counts only, and section 3.5's acceptance with its skips), the statement and audit prompts with the tag question, and the script that compares the two auditors' tags (section 3.4). Their sha256s go into the run record before h-mine's lease. Their keyless fixture check must pass first, on hand-written rows: each filter at its edge (2 and 3 source files, 199 and 200 lines, 1,000 and 1,001 lines, a _test.go, a vendor/ and a testdata/ file, a generated-code marker, 0 and 13 top-level tests, a go.mod change); the cap skip; the floor skip on both sides of its line; a refill from a repository's next change; an overlap drop; and the tag rule (one test named by both, two different tests, NONE, and a tagged task with no other functional test).

**H1's files.** h-harbor-job.sh (H's set and labels, section 5.1's order, run names h1-none-<label>-t<n> and h1-told-<label>-t1, items h1-none and h1-told, HARBOR_TELEMETRY=0, every host command sourcing the run env file) and h1-read.ts (section 5.3's reading and section 5.5's lines, and e3-read.ts's lines for the smoke sessions). e3-told-install.sh is used unchanged.

**Dry run, part 1 (keyless).** h1-read.ts over hand-written rows must print each reading once: HEADROOM; a budget-sensitive HEADROOM; CEILING by s and by UB; FLOOR; COST CHANGED; RIG by gaps, by contamination and by n; INCOMPLETE. It must also show the order (CEILING over COST CHANGED, COST CHANGED over FLOOR), a budget stop counted valid and unsolved, a gap leaving the denominator, the refused count read from either field, and G_B on a tagged task whose constraint test is also functional, counted once. The refusal cases: a session ending on the allowance refusal (budget stop); ending on UPSTREAM, E_LEDGER_UNAVAILABLE, E_KEY_MISSING, a ledger refusal at reserve and a model-allowlist E_ALLOWANCE (each a gap); an unpriced-request E_ALLOWANCE 402 (a gap) beside the slot-allowance E_ALLOWANCE 402 (a budget stop), told apart by their reasons; a CAP_STOP at reserve (a gap, not rerun); an E_TRIPWIRE (excluded); a refusal the session outlived (scored on its tree, counted by code); and a journal count that doesn't match the summary (stops for the Captain). The boundary cases: s at exactly 0.65 and 0.20 at n = 40, UB at exactly 0.80, n at 40 and 39, and a cap stop that leaves only gap reruns unrun.

**Dry run, part 2 (run host, before any lease on the real ledger).** One stand-in none trial and one stand-in told trial through h-harbor-job.sh, with the stage driver on a temporary ledger, a local stub upstream and no key. It must show the clean-room preflight refusing a seeded drive mount, the told tar checked against TOLD_SHA, the gate armed with both of its hooks, the limits read at the run commit matching section 4, the driver and real_agent both reading h-registry.json with section 4's limits, a session asking registry.json's limits refused, every lease on the temporary ledger opened and settled, and the end guard tested on stand-in logs.

**C1's files,** if it runs: c1-harbor-job.sh and c1-read.ts, written after H1 and recorded the same way before any C1 lease. C1's dry run part 1 drives helps, hurts, not distinguished, the none-above-0.85 rule, the truncation guard, the exposure rule, each R48 reading and G_B's NO READ.

### 9. Start rules

**Before mining's paid calls:** this post has merged; the Captain has recorded h-mine and h-vm's caps citing it; h-mine's lease opens after a green rig admit on the envelope; ubi-runner.sh list --mine runs before the build host is created, and the host gets UBI_OWNER set to the mining thread's code, UBI_RECOVERY_DIR, a pinned runner copy by sha256, a TTL covering its longest step, apt's timers off from boot and linger on before any sealed material reaches it. GitHub mining reads the GraphQL rate limit before and after, paces its calls and logs the points used. Mining's files match their recorded sha256s, and their fixture check passed.

**Before H1's first lease:**

1. H is sealed: 42 final tasks accepted under section 3.5's rules, spanning at least 20 repositories, at most 3 a repository, with CUSTODY.md, the bundle's sha256 and the image manifest's sha256 in the run record and the custody record.
2. The Captain has recorded h1-none and h1-told's caps citing this post.
3. The run commit is named and rig.yml passed at it. There, h-registry.json differs from registry.json only in section 4's six limits, and exposure.ts has sha256 f0882eaf2d5fe19ef682ec0f0c88e9a1239870a04544cf6adbf6d34e4e167694. The files E3 checked (autoplan.ts, registry.ts, registry.json, real_agent.py, ship_user.py, stage.ts, told.ts, quick/laneb/runner/agent-caps.compose.yaml, quick/laneb/runner/proxy.ts and quick/laneb/config/proxy.json), and src/runner/proxy/metering-proxy.ts, are byte-identical to E3's run commit 68aaf1fb.
4. The run host follows the build host's rules above, with UBI_OWNER set to the run thread's code, and is named in the run record.
5. The rebuilt envelope matches its export, and every item is admitted.
6. The told tar is built by e3-told-install.sh, passes its checks and reads 197 files with digest 70db9ce6..., and its sha256 is in the run record, the custody log and the run env file.
7. The run files on the host match their recorded sha256s, and dry runs 1 and 2 have passed.

**Before C1's first lease:** section 6.1's conditions, C1's run files recorded and their dry run passed, and rules 3 to 7 again at C1's run commit.

**While a stage runs and at its end.** Every host command sources the run env file, detached runs included. Harbor runs with telemetry off. Sealed material is decrypted only into /dev/shm, and every opening, deletion and sweep goes into CUSTODY.md. At the end the run thread settles every lease, exports the envelope with a new MANIFEST and the trial records age-encrypted, deletes /dev/shm and checks it with test ! -e, sweeps, destroys the host, confirms list --mine comes back empty, and copies the rerun inputs (commands, logs and records, sealed parts flagged) with a sha256 manifest to its handoff folder in the Captain's drive.

### 10. What the results post reports

H's yield (counts by stage, drops by cause, licences, repositories, the tagged count, digests); H1's reading with s, UB, the histogram and every section 5.5 line; the smoke sessions; spend per item against its cap and the line's all-in on actuals; custody and teardown; the R48 line from section 5.6. If C1 ran: the verdict, the claimed and simulated MDD, exposure with its interval, every secondary, and the R48 reading from section 6.7. Then every amendment and harness commit, and a closing Disclosures section.

### 11. Outside terms

Asked of the reviewer: are any outside terms, licences or rights involved? Yes:

- **Task repositories.** MIT, Apache-2.0, BSD-2-Clause and BSD-3-Clause only, with the SPDX id read from LICENSE at base (V8). Each licence allows copying and running the code for evaluation. Nothing is redistributed: task bundles stay sealed in a private drive, statements are our own words, and no code, test or issue text is published. The task images also hold each repository's Go module dependencies under their own licences; the images stay private and are not redistributed. Repositories are named in a results post only after a terms check per repository (plan v3 section 11).
- **Model providers for the paid mining calls.** Statements and Sol audits go through OpenAI's Responses API with store false, under the OpenAI Services Agreement, which says OpenAI won't use customer content to improve its services unless the customer agrees. With store false, OpenAI may still keep content for a limited time for abuse monitoring under its terms. Opus audits go through Anthropic's API under its Commercial Terms, which say Anthropic may not train models on customer content. Sealed task bodies reach these two providers only. No call goes through OpenRouter.
- **Claude Code** is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API. Anthropic's Commercial Terms hold no clause on publishing evaluation results (read for G's results post on 2026-11-06).
- **Tools.** gstack is MIT. Harbor is Apache-2.0 and runs with its telemetry off. numpy (BSD-3-Clause) runs oc.py only.
- **GitHub.** Mining reads public metadata through GitHub's API under GitHub's terms and its rate limits.
- **No benchmark dataset** is used, so no dataset licence applies.

### 12. Limits

- **One model.** Every reading is Opus 5.5's.
- **Two smoke sessions** price told sessions on H; they say little about exposure.
- **The statement author also audits.** GPT-6.1 Sol writes every statement and is one of two auditors; Opus 5.5 is the auditor from another family.
- **The pool is unscreened,** so C1's power depends on its shape. oc.txt prints the range.
- **The detector's known undercounts stay** (E2's and E3's limits); they can only lower the exposure rate.
- **The told pin moves more than the gate** (E3's section 1), so C1 tests gstack at ddbf1c9a, not the gate alone.
- **The full kind only.** The told arm runs autoplan's default full kind at ddbf1c9a, while gstack now routes feature plans to the lean kind (R66). Every C1 verdict, a CUT-CANDIDATE included, covers that configuration only; the lean kind needs its own exposure check.
- **Raised limits.** H's sessions run under limits that differ from G's and E3's, so cost and stop counts are not comparable one for one.
- **Mining yield at this size is unmeasured.** Section 3.7 counts the pool from metadata; the build, probe and audit drops are known only from T-G.

### 13. Not in scope

autoplan's lean kind; plan-eng-review; GPT-6.1 Sol and particle-1 rows; a keep rule or screened panel; any change to the detector; publishing anything.

## Review record

Lean /autoplan run autoplan-20261108021210 (gstack 1.98.0.0, --kind feature), 2026-11-08. One reviewer, Opus 5.5 at high effort, read the plan, the draft code (none yet) and the outside-terms question, for $2.20. It found 0 Critical, 1 High, 6 Medium, 7 Low and 1 Informational. Each is fixed in this revision:

- **F1, High:** H1 and C1 scored every proxy refusal as a budget stop, but the proxy's refused counter also counts infrastructure refusals. Gate item d1, taken: refusals are sorted by code from the journal (sections 1, 5.2, 5.3, 5.5, 6.3 and 8).
- **F2, Medium:** the 20-repository floor had no mechanism. Section 3.5's cap and floor skips, with fixture cases in section 8.
- **F3, Medium:** mining's filters, overlap check and tag logic had no pinned code, and the panel capped repositories before probing. Sections 3.2, 8 and 9.
- **F4, Medium:** changing the two arms' limits in registry.json would rewrite G's, E2's and E3's frozen arms on main. H gets its own arms file, and start rule 3 checks E3's files byte for byte (sections 2, 4, 8 and 9).
- **F5, Medium:** C1's R48 table can't reach KEEP at told sessions costing 10 to 20 times a none session. Sections 5.5, 5.6 and 6.7 say so and carry the 1.5x question to the funding ask.
- **F6, Medium:** C1's exposure admission was unnamed. E3's pass replaces plan v3 section 6 rule 2, and H1 stops before the ask if neither smoke session reads exposed (sections 1, 5.6, 6.1 and 6.5).
- **F7, Medium:** the difficulty ladder rules out longer tasks and keeps G's caps. H is plan v3 section 9's raise, not a ladder tier; the Captain ruled on the precedence and the project owner answered it as line C (section 1, section 5.5 and Big decision 3).
- **F8 to F14, Low:** the full kind named in Limits; t frozen at 40, 41 and 42 tasks with exact band comparisons; the lattice note in 5.4; INCOMPLETE and owed gap reruns; section 1's missing changes; E2's price corrected to $5.1k and E3's figures cited to its merged results post; the crew's three token stops named.
- **F15, Informational:** no outside-terms blocker. Section 11 adds the images' module dependencies and OpenAI's abuse-monitoring retention.

The pull request's code review then found that oc.py's part A compared float means with the band ends, so a simulated panel landing exactly on 0.20 or 0.65 at 40 or 20 tasks could be misclassed. oc.py now compares integer solved counts with the band ends, as section 5.3 does. The random draws are unchanged, the 42-task cells and the pooled wrong-call rates (10.6%, 11.3%, 21.3%) don't move, and the cells that moved are updated in section 5.4's table.
