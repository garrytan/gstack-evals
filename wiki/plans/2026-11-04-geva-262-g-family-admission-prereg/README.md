---
id: 2026-11-04-geva-262-g-family-admission-prereg
kind: plan
title: "Preregistration: family G thin slice and admission for plan-eng-review and autoplan (outcome test per skill, wave 1), with M1's lone-survivor re-size"
summary: "Freezes G's thin slice and admission before any spend: Opus 5.5 none and told at gstack 699a41cb, the admission rule, the lane's test simulated exactly, caps, start rules and M1's re-size."
author: GEVA-262
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-04
status: open
links:
  - 2026-11-03-geva-225-outcome-per-skill-plan
  - lanes/real-outcome/score/analysis.ts
  - src/runner/stats/paired.ts
  - garrytan/gstack-evals#193
source: "Written by GEVA-262 for issue GST-1309 (parent GST-1307) from the Captain's brief of 2026-11-04, under plan v3 (2026-11-03-geva-225-outcome-per-skill-plan, merged as 5f13212). Reviewed through gstack /autoplan run autoplan-geva262-20261104004035 (lean: one Opus 5.5 reviewer, one round, gstack 1.95.2.0); gate_rev 1 answered rec, A and C by the Captain (GSTA-2). The Implementation plan section is the approved text."
attachments:
  - 0c9dc8bac4b57fe911317301ca9fee0f3751691416ed653d33c0750cf6002617  power.py
  - 102d84516e8a49023d50cbeef55f46ebb018b1a5fe00ccfab1688c95db471978  power.txt
  - 1265268921e92667a85529bfe8eec8a5ecb20bc2f12b567a3c3ec3f44913ec34  resize.py
  - b7f9d53dc363c428bccc78b13720158d9e721bd0ac91b7388be10a85c52af53a  resize.txt
  - 56fbdde6978bfee1ee1b9775f5246180f663adc3a2989b76fe013abe69606cea  resize_test.py
---

# Preregistration: family G thin slice and admission for plan-eng-review and autoplan

GEVA-262, issue GST-1309 (parent GST-1307), Captain GEVA-2. Plan only: nothing in this post spends money, and no model call, VM or eval ran to write it.

## Approval

The Captain scoped this post on 2026-11-04 and directed its six points, M1 among them. Review followed R65 for a paid-eval prereg: one strong reviewer, one gate revision and the outside-terms question, then a light /ship. Gate_rev 1 of /autoplan run autoplan-geva262-20261104004035 (rec_hash f20b03f40946) was answered by the Captain (GSTA-2) on 2026-11-04: rec (d1a, d2a, d3a and p1b), A (G's confirmatory panel holds at most 3 tasks per repository, with plan v3's 8 as the written-in fallback) and C (when both G skills are past the 20-point bound, autoplan stops first and plan-eng-review re-sizes alone). This post approves no spend. A paid stage starts only under the start rules in section 10: O6 merged, the stage's cap recorded in the Captain's approvals/ after this post merges, and O6's envelope check passing for that stage.

## ELI5

Plan v3 tests six gstack skills on what ships. Family G holds two of them: plan-eng-review (review a plan like an engineering manager) and autoplan (four reviews of a plan). Before any money goes into a big test, each skill gets a small, cheap check on 12 real tasks: does plain Opus solve some but not all of them, does Opus really run the skill's steps when told to, do our instruments work, and what does a session really cost.

This post fixes every rule of that check before it runs. It names the gstack version (the overhaul's after pin), the arms (no gstack, and gstack with the skill told by name), the model (Opus 5.5), the scorer (the project's hidden tests), the pass marks, the money caps and when work may start. It also fixes what happens if one of the two skills fails its check: the other trades tasks for trials so that it can still run, which keeps the project owner's keep-or-cut reading on plan-eng-review alive.

## Before → after

- **Before:** plan v3 leaves G's pin, told install, autoplan's told kind, slice rules, caps and start rules to this prereg. Under plan v3's survivor order, if autoplan fails admission, plan-eng-review re-sizes to 60 tasks x 2 trials, passes the 20-point bound and stops, so the GST-1218 reading is lost. Plan v3's power grid is a t-test times 1.2, not the test that decides.
- **After:** every admission rule is frozen, with the pin 699a41cb, the told lines, the caps, the reservation mechanics and the start rules. A lone G survivor re-sizes on a fixed tasks-for-trials ladder, so plan-eng-review alone runs at 48 x 4 for $1,650 with an 18.6-point MDD at house prices. The lane's own decision rule is simulated exactly: power at every MDD this post claims is 0.817 or more across the control rates and clustering we expect, with at most 3 tasks per repository, and its false-claim rate under a true null is under the nominal level.

## Why it matters

GST-1218 holds plan-eng-review and plan-devex-review as cut candidates. The project owner chose to keep both until wave 1's outcome test reads, and to cut them if it shows no gain of the size the test can see (P1). That reading has value only if it happens, on the gstack users will run, with a test whose power is what we say it is. This post makes each of those true before a dollar moves.

## What caused this work

- Plan v3 merged on 2026-11-03 (#192, 5f13212) and names G's thin slice and admission as wave 1's first paid step.
- The overhaul's after pin arrived the same day: 699a41cb on gstack's measurement-only branch capy/gst-1088-after-pin.
- #193's review found that a power script inherited from #169 overstated power about 2x at low rates, so this post simulates the deciding test itself.
- The Captain asked for M1: a preregistered tasks-for-trials re-size so that plan-eng-review's P1 reading survives if autoplan fails admission.

## Big decisions

1. **The after pin for every told session.** 699a41cb is named, so admission runs told there and freezes it (plan v3 decision 3). No forced line and no before-pin arm run. What would flip it: none; a different pin needs a new admission paid from reserve.
2. **No untold arm.** Run D saw Opus 5.5 open no gstack skill in 252 eligible untold runs, and the after pin's new route hook can't reach either G skill (section 4). No measurement shows untold opens at the after pin. What would flip it: a measured untold opening rate for plan-eng-review or autoplan at a pin, which would come back as an amendment.
3. **Opus 5.5 is the only model under test.** Plan v3 leaves GPT-6.1 Sol out of wave 1 on price, and particle-1 is left to admission's 2-point recheck. This post runs no particle-1 session; a particle-1 row that the recheck admits comes back as an amendment (section 4).
4. **autoplan is tested in its default kind at the pin, which is full.** In a Claude Code session outside Capy, the after pin runs the full panel unless told --kind feature (section 4). That is what a gstack user gets, and plan v3's 5.0 price multiple assumes it.
5. **M1 replaces d7's survivor order for G.** A lone survivor starts at its plan v3 planned size priced alone (60 x 3 for plan-eng-review, 54 x 3 for autoplan), then tries 4 trials at the same tasks, then 4 trials at 6 fewer tasks each step, and takes the first design inside the $1,700 line and under the 20-point bound (section 7).
6. **G's confirmatory panel holds at most 3 tasks per repository.** Plan v3 allows 8, and at 8 the worst-case power at the claimed MDDs falls to about 0.70 (section 8). The Captain chose the cap of 3, with plan v3's 8 written in as the fallback if screening can't fill it.
7. **Sizing stays on plan v3's grid; power is checked by exact simulation.** The exact simulation shows the grid is conservative by 1 to 4 points. This post keeps plan v3's numbers and reports the check, because changing the sizing scale is a plan v3 change that belongs to the Captain (section 8).

## Implementation plan

### 1. What this changes in plan v3, and what it keeps

Every plan v3 rule this post doesn't name stands as written, and "plan v3 N" points to its section N.

- **Changed, for family G only (the Captain's M1, with pick C):** the one-survivor re-size order (plan v3 6 and 8, d7), and the survivor order when both pass the bound at admission item 5 or no both-alive design fits (plan v3 6). Section 7 freezes the ladder and the order of stops. Families X and U keep d7.
- **Filled in, where plan v3 leaves the detail to this prereg:** the pin and its install (section 2), the slice's composition (section 3), the told lines and autoplan's kind (section 4), the untold, stand-in and particle-1 rows (section 4), session limits, caps and reserve mechanics (sections 5 and 9), admission's exact rule and the inputs its re-size reads (section 6), G's decision configuration and the confirmatory panel's cap of 3 tasks per repository (section 8, the Captain's pick A) and start rules (section 10).
- **Unchanged and restated only for reading:** the measures and scoring rules (plan v3 3), the arms' turn scripts (plan v3 4), the decision test (plan v3 4), the R48 and R61 routes (plan v3 9), custody (plan v3 12) and outside terms (plan v3 11).

### 2. Pins

**gstack.** 699a41cb6808e01240d02e82247693f9170d401a (v1.94.39.0), committed 2026-11-03T20:26:24Z on capy/gst-1088-after-pin, measurement only; it never merges. The run fetches it by sha, never by branch, and records each fetch and the pin's git archive sha256. Raw skill sources at the pin: plan-eng-review/SKILL.md sha256 58d96f6f3e296ccc2942e2e1a5732810b18f9f8bcd6ed9338115c99c91a88524, autoplan/SKILL.md sha256 a1f4036492f6b27c1f9b96b256408207bfc97e804bebb478a2f04a5d538a46ca (read by GEVA-262 at the pin on 2026-11-04).

**Install.** `./setup --host claude --loadout lite` in a clean HOME per session. lite is Opus 5.5's default loadout at the pin (modules/loadouts.json maps claude-opus-5-5 to lite). It is the same install #193 (L1) renders for its after arm, so both lines grade the same gstack. O5's dry run renders the pin's lock and requires every file of the installed render to match it byte for byte, and records the tree digest; once #193 has merged, the digest must equal its after-pin lite tree digest.

**Hooks at the pin.** setup registers a UserPromptSubmit route hook and a Stop skill-contract hook. The route hook routes only investigate, review, qa and verify (lib/skill-route.ts, ROUTED_SKILLS), so it never sends a session to plan-eng-review or autoplan. Every hook runs bun from PATH and exits 0 on failure (#193's manifest), so O1's preflight checks that the arm's bun resolves.

**Harness and decision code.** The real-outcome lane's rig as plan v3 2 reuses it, at the commit O5's dry run pins. Claude Code at the rig's pinned version, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and the claude-code-preset system prompt on every arm. The decision test is lanes/real-outcome/score/analysis.ts (compare, crossing) on src/runner/stats/paired.ts (clusteredPairedDelta), as at 5f13212.

**Not pinned here.** plan-devex-review sits in family X (plan v3 2 and 5). X's thin-slice and admission prereg (plan v3 13, step 7) pins its told arm, and for GST-1218 it must use this same after pin.

### 3. Tasks: the thin slice T-G

- **Size and kind.** 12 valid tasks, built, audited, validity-checked and sealed as plan v3 2 and 6 (stage 2) describe: real changes merged on or after 2026-07-01 to public repositories under MIT, Apache-2.0 or BSD, K3 features and K2 issue fixes, multi-file, statements in our own words by an author from a family not under test, audits by Opus 5.5 and GPT-6.1 Sol with no gstack, hidden tests from the change and the base suite.
- **Composition.** At most 2 tasks from any one repository, and at least 8 of the 12 are K3 features, because G's skills claim their gain on features. The slice is not screened into the band: admission reads the pool's none rate, and screening comes later (stage 4).
- **What the slice measures besides admission.** Valid tasks over candidates, paid author and audit dollars per valid task, and the slice thread's crew dollars per valid task over the second six valid tasks in build order, after its tooling exists. Section 6 says how the re-size uses them.
- **Escaped defect.** The K1 subset of a 12-task slice is a task or two, so the escaped-defect read is NO READ at admission. Plan v3 3's 10% rule applies at the confirmatory stage.
- **Custody.** Plan v3 12: age-encrypted bundles in the Captain's drive, CUSTODY.md, decryption only into /dev/shm, a leftover check on every wake. The repo gets counts by kind and digests only.

### 4. Arms and models

| Arm | Install | Turns (verbatim) | Sessions at admission |
|---|---|---|---|
| none | bare, in panel v3's C1 clean room: no drive mount, no gstack install, no skills folder, and a preflight that refuses otherwise | T1: the statement, then "Work in this repository. Implement this, and make sure it works. Don't stop to ask." | 12 tasks x 2, shared by both skills |
| told plan-eng-review | the after pin, lite (section 2) | T1: the statement, then "Before you write code, draft your plan in PLAN.md. Don't write code yet." T2: "/plan-eng-review PLAN.md" T3: "Now implement your plan, and make sure it works." | 12 x 2 |
| told autoplan | the after pin, lite | T1 and T3 as above; T2: "/autoplan PLAN.md" | 12 x 2 |

Every told session runs under the lane's rec persona, which answers gstack's questions with "Go with your recommendation." plan-eng-review's scope gate takes PLAN.md as the user-named target, so it asks no selector question. The no-gstack arm is in every comparison (the crew's no-gstack rule), and it is clean by construction, so its read audit runs after the run as a descriptive check.

**autoplan's told configuration.** At the pin, autoplan runs the lean feature kind only when told --kind feature or in an unattended Capy session (lib/autoplan-lean.ts); the arm sets neither, so the default is the full run, with the phases its scope chooses. Its outside voice is pinned to the cell's model, Opus 5.5, with no other key or codex binary in the image, and the rec persona gives the gate's recommended reply. O1 freezes this with a keyless check that the arm's environment selects the full kind. If that check finds another kind, autoplan's admission does not start and the question goes to the Captain. Every autoplan reading names this configuration.

**Untold arms: dropped.** Run D (#140) saw no skill opened in 252 eligible untold Opus 5.5 runs. At the after pin the route hook can't route to either G skill, and the only after-pin discovery measure (#193) covers /investigate. So nothing shows untold opens at the after pin for plan-eng-review or autoplan, and plan v3 4's condition for an untold arm is not met.

**Stand-in and particle-1 rows.** Admission runs neither. At admission's metered prices the re-size rechecks plan v3 8's 2-point rule for plan-eng-review, stand-in first, under the bound and inside the envelope. A row that passes is added by the confirmatory prereg, which freezes its line by sha256. A particle-1 row also needs its own admission sessions, the clause in Anthropic's terms that lets Claude Code drive a non-Anthropic model, and OpenRouter's data-collection deny (plan v3 11), so it comes back as an amendment paid from plan-eng-review's reserve.

**Models.** anthropic/claude-opus-5-5 is the only model under test and decides admission. GPT-6.1 Sol is out of wave 1, as plan v3 4 says: R3a metered Sol at 1.33 times Opus's none session and 1.63 times its told session, so a Sol row can't fit the $2,000 ceiling with Opus powered. Haiku and Sonnet are not models under test. G uses no judges: hidden tests decide, and the mutation tool and verifier involve no model.

### 5. Measures and scoring

Plan v3 3's rules hold as written: solved (the final tree passes every hidden test in a verifier-owned run), mutation score on the agent's own changed lines, arm stops scored unsolved at the stop with their cause, gaps rerun once with a named repair and never to change a verdict, contamination counted and excluded, exposure read by a detector frozen from the pinned files and scored intention to treat, and cost per solved task with a task-clustered bootstrap interval.

**Exposure detectors** (O1 builds them from the pin's files, with keyless fixtures for exposed and unexposed transcripts):

- plan-eng-review: its review sections file (plan-eng-review/sections/review-sections.md) read, the Step 0 Scope Challenge marker, Sections 1 to 4 in order, and a test plan written.
- autoplan: the run record validates under the configuration O1 froze, and every phase autoplan's scope chose loaded its review skill and wrote findings in order, Eng last (panel v3's rule).

**Session limits at admission.** Plan v3 freezes confirmatory limits at a multiple of admission's p95, so admission needs its own: none $8 of model calls, 200 agent turns and 90 minutes; told plan-eng-review $20, 200 turns and 120 minutes; told autoplan $45, 400 turns and 240 minutes. Each dollar limit is about 8 to 10 times plan v3's house price for the arm, so a limit binds only on a session far past the plan. A session that hits a limit is an arm stop, counted in item 4 and charged at its metered cost in item 5.

**Order and draws.** Tasks are identified by their sealed labels, sorted. Every arm's sessions run interleaved: for trial 1, then trial 2, Python's random.Random(20261104 + trial).shuffle orders the sorted list of (arm, label) pairs. The exposure sample (section 6, item 2) is random.Random(20261105).sample(labels, 8); for the i-th drawn task, random.Random(20261105 + i).randrange(2) picks trial 1 or 2. A picked trial that is still a gap after its rerun is replaced by the same task's other trial; if both are gaps, by the first task in random.Random(20261106).sample(labels, 12) not already drawn.

### 6. Admission rule

Per skill, on the slice, Opus 5.5 only. Each item is read from the frozen data, and the first that fails decides the route.

1. **Headroom.** none's solved share over its valid trials is between 0.20 and 0.80, both ends included. With 24 valid trials that is 5 to 19 solved. The none arm is shared, so a headroom failure stops both skills: below 0.20 as FIX-METHOD (floor), above 0.80 as FIX-METHOD (saturation), with R61's one ceiling raise as a proposal that needs its own price and approval (plan v3 9).
2. **Exposure.** 8 told trials per skill, drawn as section 5 says (one trial on each of 8 tasks), are read by the skill's detector. Pass at 7 or more exposed. The exposure of all 24 told trials prints as a description. A failure stops that skill as FIX-METHOD (exposure).
3. **Instruments.** The mutation tool scores at least 90% of the trees in the skill's comparison (its 24 told trees and the 24 none trees) without a tool error, and the verifier returns a run for every tree. A failure stops the skill as FIX-METHOD (instrument), with the fix named.
4. **Rig.** At most 1 gap per arm after reruns (5% of 24, rounded down), and every arm stop explained by the lane's frozen termination taxonomy.
5. **Price and power.** resize.py runs with the metered inputs. MULT is none's mean session cost over $0.191. M_PER and M_AP are each told arm's mean session cost over none's, across all its told sessions, because the confirmatory told arm is scored intention to treat; exposed and unexposed told means print apart. AUTH_PAID is the slice's paid author and audit dollars per valid task, and AUTH_EXTRA its crew dollars per valid task over the second six valid tasks. The in-band yield stays at plan v3's 30%, which the projection check after screening re-reads (plan v3 6). A metered run needs MULT, refuses YIELD_G and TOLD_SCALE, and prices only G with the metered inputs; U and X stay at plan v3's house central in its envelope line. The both-alive re-size is cost.py's frozen sizing. A skill whose re-sized MDD passes the 20-point bound stops as FIX-METHOD (price). Section 7 says what the other skill does.

A skill that passes all five goes to stage 4 at the design item 5 printed, through O6's envelope. Every stop prints its readings and returns to the Captain under plan v3 6 and 9. None of these stops is a verdict on the skill.

### 7. One survivor in G: the M1 ladder

M1 replaces plan v3's d7 order for G. It applies whenever exactly one G skill is left before the confirmatory run starts: after a stop at admission items 1 to 5, or at the projection check after screening. It also governs a lone survivor after a sibling's futility stop; the confirmatory prereg says how it applies to a panel already built, and at these sizes the look can't fire (section 8).

**Which skill survives.** A skill that fails items 1 to 4 stops, and the other re-sizes alone. If item 5's both-alive re-size leaves one skill past the bound, that skill stops and the other re-sizes alone. If both are past it, or no both-alive design fits the $1,700 line, plan-eng-review re-sizes alone first. If no rung fits it, autoplan re-sizes alone, and both stop only if neither finds a rung. This is the Captain's pick C, which keeps P1's plan-eng-review read, the reason M1 exists. The Captain widened it on 2026-11-04 after /ship pass 1, so the $2,000 lines buy the most reads they can, in P1's order.

**The ladder,** a fixed order with no search (resize.py): drop a particle-1 row if there is one (G's plan has none); then try, in order, the survivor's plan v3 planned size priced alone, n0 x k0 (60 x 3 for plan-eng-review, 54 x 3 for autoplan), then n0 x 4 if k0 is under 4, then 4 trials at n0 - 6, n0 - 12 and so on down to 24 tasks. The design is the first rung whose alone price, by survivor.py's frozen model, is inside the $1,700 plan line and whose MDD, by plan v3's grid times 1.2, is at most 20 points. If no rung qualifies, the survivor stops as FIX-METHOD (price). survivor.py's alone price charges the survivor half of G's crew and calibration lines, the whole slice authoring and admission none arm, its own told admission and every bulk cost still to come, so it counts about $28 of already-spent shared cost twice, on the safe side.

**What it gives** (resize.txt):

| Price case | plan-eng-review alone | autoplan alone | d7 would have given plan-eng-review |
|---|---|---|---|
| house central (plan v3) | 48 x 4, MDD 18.6, $1,650, reserve $350 | stops | 60 x 2, MDD 21.6, stops |
| told at 1.15 times (forced or exposed) | 42 x 4, MDD 19.8, $1,538 | stops | 42 x 4, MDD 19.8 |
| told at 1.5 times | 42 x 4, MDD 19.8, $1,679 | stops | 42 x 3, MDD 22.2, stops |
| none at 10 times a Verified session | stops | stops | stops |
| crew line at TS's full rate | stops | stops | stops |

So P1's plan-eng-review reading survives an autoplan stop at house prices and at both forced-price cases. At 1.5 times told, plan v3 stopped both G skills at the projection check; under M1, plan-eng-review runs alone at 42 x 4. autoplan alone stops in every case, as it did under d7. A survivor still meets every other rule, and a later stage's projection check can still stop it.

**Caps and envelope.** Every M1 design sits inside the $1,700 line, so each survivor keeps at least $300 of its $2,000 cap as reserve. At house prices, autoplan settles about $304 by admission, G plans $1,954 in all against $2,865 with both alive, and wave 1 plans $8,482 of the $10,000 envelope. At the two forced cases wave 1 plans $8,461 and $8,720. M1 lowers wave 1's planned total whenever it applies, because the stopped skill releases more than the survivor's re-size adds.

### 8. Power and null size, simulated on the deciding test

power.py drives the decision rule as analysis.ts and paired.ts compute it, with no closed form. Each task's arm score is the mean of its trials, delta is the mean paired difference, z uses the cluster-robust standard error over repositories, and a reading counts as helps or hurts only when |z| > 1.96 and the exact repository sign-flip one-sided p in z's direction is at most 0.025, counted inclusively as paired.ts does; none above 85% makes no claim. Panels use 20 repositories, plan v3's floor, the fewest clusters the rules allow, in the most concentrated layout that keeps at most 3 tasks per repository (decision 6). The told rate is the none rate plus a shift, a task effect (sd 0.15) and a repository effect sized to the stated intraclass correlation of the task difference, clipped to [0, 1]; the shift is solved so the true mean difference equals the effect exactly after clipping. Nulls are null: the strict null sets told equal to none, and the heterogeneous null adds a symmetric perturbation that needs no clipping. 4,000 simulations a point, 20,000 a null point, seed 20261104 (power.txt).

**G's decision configuration, frozen (the Captain's d1a).** G's confirmatory test reads once, at the final look, with analysis.ts's boundaries.final set to 1.959964 and the sign-flip agreement at 0.025, one-sided and counted inclusively. There is no efficacy interim. truncation_guard is 0.05: above 5% truncated trials in either arm, a claim needs both readings, with and without truncated trials, to agree. The lane's two-look defaults (2.797 at the interim, 1.977 at the final, agreement 0.0240) do not apply to G.

The control rates we expect come from G's frozen screen (2 none trials, a third on 0 of 2, kept at 1 of 2 or 1 of 3) applied to a U-shaped pool: mean none rate 0.48. "plan v3 band" is plan v3's own model (rates from 0.15 to 0.85 around 0.5), the hardest case here.

| Design | Claimed MDD | Power at the claimed MDD: expected (ICC 0.05) / worst (plan v3 band, ICC 0.10) | Simulated MDD: expected / worst |
|---|---|---|---|
| plan-eng-review, both alive, 60 x 3 | 18.6 | 0.926 / 0.841 | 15.5 / 18.0 |
| autoplan, both alive, 54 x 3 | 19.2 | 0.910 / 0.817 | 17.0 / 19.0 |
| plan-eng-review alone under M1, 48 x 4 | 18.6 | 0.913 / 0.843 | 16.0 / 18.0 |
| 42 x 4 (forced price, both alive or alone) | 19.8 | 0.925 / 0.851 | 17.0 / 19.0 |
| plan-eng-review alone under d7, 60 x 2 (for comparison) | 21.6 | 0.906 / 0.806 | 19.0 / 21.5 |

For the four designs this post can run, power at the claimed MDD is 0.817 or more in every scenario, including control means of 0.30 and 0.70 and a screened flat pool. The lowest is autoplan at 54 x 3 in the plan v3 band at ICC 0.10. The claims hold.

**The repository cap and its fallback.** G's confirmatory panel takes at most 3 tasks from any one repository (decision 6). The Captain's rule: unless the screened pool fills the design's task count at no more than 3 per repository across at least 20 repositories, the panel falls back to plan v3's limit of 8 per repository, with no new decision. The fallback's worst case is printed here before any spend. At plan v3's 8, in the most concentrated layout that limit allows, power at the claimed MDD in the plan v3 band at ICC 0.10 is 0.707 for plan-eng-review at 60 x 3, 0.698 for autoplan at 54 x 3, 0.730 for plan-eng-review alone at 48 x 4 and 0.732 at 42 x 4. The simulated MDD in that case is 20.5 to 21.5 points, so a 20-point effect would be missed more than 20% of the time. On the screened pool it is 0.831 to 0.854 at ICC 0.05 and 0.883 to 0.906 at ICC 0 (power.txt, fallback block). A results post that ran under the fallback says so beside every verdict.

**Null size.** Under both nulls, at ICC 0 and 0.10, a helps reading came in 1.6% to 2.0% of simulations and any claim in 3.4% to 4.0%, against nominal 2.5% and 5%. Requiring both the z crossing and the inclusive sign-flip p makes the rule conservative.

**What follows, and what this post doesn't change.** Plan v3's grid (a task-level t-test times 1.2) is conservative by 1 to 4 points against the deciding test at the rates we expect. This post keeps plan v3's MDDs as its claims and keeps the grid as the sizing scale, because a new scale would change which designs pass the 20-point bound. Two consequences go to the Captain instead: under the exact test, d7's 60 x 2 survivor clears the bound at the rates we expect (19.0) but not in the worst case (21.5); and the stand-in and particle-1 rows' 2-point fits would read differently.

**The futility look.** In its B-value form (conditional power at a random half for plus and for minus the planned MDD, stop when both are under 10%), it stopped no simulation, at a true null or at the planned MDD, in any design. At 80% power the two conditions can't hold together, so the look neither costs power nor saves money at these sizes. O4 freezes its exact conditional-power formula, and the confirmatory prereg re-simulates it.

**Admission's own operating characteristics** (power.txt). The exposure gate passes a told arm whose true exposure is 0.80 about half the time (0.503), 0.90 about 81% of the time and 0.95 about 94%, so it works as a check that exposure is near 0.85 or above, in line with the 80% bar for a fair verdict. The headroom gate passes 99% of the time at a pool mean none rate of 0.50, 84% to 87% at 0.30 or 0.70, about half the time at 0.20 or 0.80, and under a third at 0.15 or 0.85.

### 9. Caps, reserve and the envelope

Each skill's evaluation is capped at $2,000 all-in and the program at $10,000 (plan v3 8): paid model calls, VMs, and crew threads' own model use at about $1 per 1,000 credits. This post asks the Captain to record these stage caps in approvals/ after it merges:

| Stage | Expected at house prices | Cap, reserved by O6 before the stage starts | Charged to |
|---|---|---|---|
| T-G paid author and audit calls, and VM | about $20 (TS's $1.39 per valid task, plus VM) | $60 | split evenly |
| Admission none arm, model calls (24 sessions and 2 reruns) | $25 | $229 (26 x $8 x 1.1) | split evenly |
| Admission told plan-eng-review, model calls (24 sessions and 2 reruns) | $52 | $572 (26 x $20 x 1.1) | plan-eng-review |
| Admission told autoplan, model calls (24 sessions and 2 reruns) | $116 | $1,287 (26 x $45 x 1.1) | autoplan |
| Admission VM and host time, 40 hours at $0.60 | about $10 | $24 | split evenly |

Each model-call cap covers every session and 2 gap reruns per arm at their session limits, plus 10% for the call in flight when a session reaches its limit: O1's harness enforces each limit at the metering proxy, so a session can pass it by at most that call. If O5's dry run shows a larger overshoot, the stage does not start. A third gap in an arm gets no rerun and stays a gap for item 4. A host-hour cap stop ends the batch incomplete: sessions not run count as gaps, and the batch is never rerun to change a verdict. At these caps plan-eng-review reserves $729 and autoplan $1,444 for the slice and admission, and both stay inside $2,000 with their crew shares.

**Crew threads.** Crew model use (the T-G thread, the admission run thread and its results post, under token caps in their own briefs sized to plan v3's crew lines) is not a ledger call, so O6 can't meter it. Each crew thread's token cap, at about $1 per 1,000 credits, counts as an open reservation against its skills from the thread's start, and its credits move to settled spend at each stage boundary. This thread counts in G's $70 prereg-and-run line.

**Reserve mechanics.** A skill's reserve is its $2,000 cap less its plan: $787 for plan-eng-review and $348 for autoplan at house prices. It pays overruns on crew lines (the slice thread is likely to pass plan v3's $14 slice crew line, as TS's thread did), gap reruns, and a new admission if a pin changes. It never pays a retry to change a verdict. Admission's re-size puts every design inside the $1,700 line, so at least $300 stays in reserve.

**Envelope.** O6 admits and reserves each stage in one atomic step: settled program spend plus every open reservation plus the stage's cap must stay at or under $10,000, and the skill's settled spend plus its open reservations plus the cap must stay at or under $2,000. When a stage settles, its metered spend moves to settled and the rest is released. A cap stop ends that skill incomplete, and it is never retried to change a verdict.

### 10. Start rules

No paid stage of this prereg starts until all of these hold:

1. This post has merged.
2. O6, the atomic envelope (GST-1308, built by GEVA-261), has merged, with its keyless concurrency test passing, and the program's one envelope host is initialized, awake and named in the approvals entry.
3. The Captain has recorded this post's stage caps in approvals/, citing this post, after it merged.
4. O6's envelope check admits and reserves the stage (section 9). Every paid stage spends through a U4 ledger lease, the only kind O6's envelope gates; Lane B's standalone JSONL ledger is not envelope-aware and is not used.
5. O1, O2 and O4 (plan v3 13) have merged: the arm registry with both exposure detectors and autoplan's told-configuration check, the mutation scorer, and the scorer extension with resize.py's rules.
6. O5, G's keyless dry run, has passed: one ledger lease opened and settled per frozen item on a temporary ledger, both futility cases driven, the lite render reproduced byte for byte at the pin, and the clean-room preflight refusing a seeded drive mount.
7. The run names and pins an awake host for its controller and its single U4 ledger file, with host hours reserved on a ledger item, as #193's start rule does.
8. For admission only: T-G is sealed, with CUSTODY.md and the slice's counts and digests recorded.

### 11. What the results post reports

An admission results post, in its own PR, reports per skill: none's solved share with its interval, told exposure on the 8 sampled and on all 24 trials, the instrument and rig readings, metered means with exposed and unexposed told apart, resize.py's output at the metered inputs, and the design for stage 4 or the stop with its R48 route. Told solved rates print as descriptions with no verdict. plan-eng-review's GST-1218 reading comes only from its confirmatory told arm at 699a41cb, at the MDD that prereg prints; admission does not read it.

### 12. Outside terms

Asked of every reviewer (R65): are any outside terms, licences or rights involved? Yes:

- **Task repositories.** MIT, Apache-2.0, BSD-2-Clause or BSD-3-Clause only, with the SPDX id read from the base commit's LICENSE file and recorded. Statements are rewritten in our words, and no issue text, code or test is published. Repositories are named in a results post only after a terms check per repository (plan v3 11).
- **Tools.** gstack (MIT) at the pin. The mutation tools of plan v3 10: cargo-mutants (MIT), StrykerJS (Apache-2.0), mutmut (BSD-3-Clause) and go-mutesting (MIT). numpy (BSD-3-Clause) for power.py only.
- **Model and harness.** Claude Code is proprietary software under Anthropic's terms, here driving Anthropic's own Opus 5.5 through Anthropic's API, so the gateway question in plan v3 11 does not arise for any admission session. Not verified: Anthropic's terms on publishing comparative results; the results post checks them before it names numbers.
- **T-G's paid calls.** The author model, from a family other than Anthropic, is named in the T-G brief before any call, with its provider's terms. The audits run on Opus 5.5 (Anthropic's commercial terms) and GPT-6.1 Sol (OpenAI's services agreement and usage policies). Sealed task bodies go to these providers, so the T-G brief cites each provider's clause on training with API inputs before any body is sent, and any call through OpenRouter carries the data-collection deny (plan v3 11).
- **No benchmark dataset.** Tasks are mined from public repositories, so no benchmark licence applies.

### 13. Not in scope

Building O1 to O6, running anything, the X and U families' preregs, the confirmatory prereg, and any change to plan v3's sizing scale, futility look or survivor rule outside family G.

## Review record

gstack /autoplan run autoplan-geva262-20261104004035 on gstack 1.95.2.0, lean kind (R65): one Opus 5.5 reviewer at high effort read the Implementation plan with the draft bundle, reran power.py and resize.py (both reproduced their attached outputs byte for byte) and answered the outside-terms question. It raised 11 findings: 3 High, 4 Medium and 4 Low. The gate (gate_rev 1, rec_hash f20b03f40946) carried the three Highs; the Captain (GSTA-2) answered rec, A and C on 2026-11-04, and the revision applied them without re-review, as the lean kind does.

- d1 (High): G's decision rule is now frozen as one final look at alpha 0.05 (section 8). The reviewer measured that the lane's default two-look boundary of 1.977 cut the worst-case power of 54 x 3 from 0.820 to 0.814 on the earlier even layout.
- d2 (High): power.py now uses the most concentrated layout the panel rule allows and prints plan v3's 8-per-repository case. At 8 the worst case fell under 0.80, so the Captain capped G's panel at 3 tasks per repository (pick A), with 8 as the written-in fallback.
- d3 (High): resize.py's input checks exit with a nonzero code, the error and its fix.
- Medium and Low, fixed in the same revision: crew threads and gap reruns now hold reservations, and caps carry headroom for the call in flight (section 9); T-G's paid calls are in the outside terms; the futility finding went to the Captain, and the confirmatory prereg owns it; the stop order joined M1 as a listed change; the alone price is described as survivor.py computes it; the flat-pool scenario is named as screened; and the session order and exposure sample have frozen draws.
- PR review on #196, 2 findings, both fixed: resize.py named autoplan as the skill to stop whenever either skill passed the bound, and now stops the one that passed it, autoplan only when both do (section 7); its error lines dropped reason codes that src/errors/codes.ts doesn't hold. Its default output is unchanged.
- /ship pass 1 on #196 (full depth, five readers, the Captain's decision C), 2 CRITICAL findings, both fixed with the Captain's approval: M1's ladder only stepped down from the both-alive size, so a bound failure could never climb back, and no rule covered a case where no both-alive design fits (section 7). resize_test.py checks both repros, the autoplan-second and neither-fits cases, the metered-input rules and the house-price block of resize.txt by sha256. That block is byte-identical. The other cases' rung lists and the routing text for the 10-times and crew-line cases changed, with no verdict changing. Also fixed: d1a written into section 8, the fallback trigger wording, metered-input checks, U and X kept at house prices in a metered run, a 60-task guard in power.py, and the start rules naming U4 leases and the envelope host. Open notes: section 5's seed indexing, the stand-in row the envelope check leaves out (O6 counts it at run time), and power simulated only for the house and forced designs.
