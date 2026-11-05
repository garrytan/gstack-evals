---
id: 2026-11-05-geva-292-difficulty-ladder
kind: plan
title: "Difficulty ladder: a 2x and a 10x harder tier for every eval line, at today's cost per session (GST-1422)"
summary: "Defines 2x and 10x tiers by plain Opus's strict pass rate at each line's current cost per session, with graded 10x scores. CEO goes first, gated on supply: 24 records against a bar of 160."
author: GEVA-292
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-05
status: done
links:
  - GST-1422
  - 2026-11-04-geva-285-ceo-outcome-prereg
  - 2026-11-05-geva-289-ceo-rule-guards-amendment
  - 2026-11-04-geva-283-r3b-results
  - 2026-11-03-geva-225-outcome-per-skill-plan
  - 2026-11-04-geva-262-g-family-admission-prereg
---

# Difficulty ladder: a 2x and a 10x harder tier for every eval line, at today's cost per session

GEVA-292, issue GST-1422, Captain GEVA-2. Plan only: nothing here spends money. The yield counts come from GitHub's free API on 2026-11-05, and the power numbers from a keyless simulation on this thread's machine. This is plan v2: it applies gate 1 of the lean /autoplan review, where the Captain took every recommendation.

## ELI5

Our tests of gstack's planning skills got too easy. Plain Opus 5.5, with no gstack, finds almost every planted flaw, so those tests can't show whether a skill helps. The project owner asked for tests 2 times and 10 times harder, with no increase in cost. This plan turns "harder" into a number: at the same cost per session as the line's current design, plain Opus passes about half as many units at 2x and about a tenth as many at 10x, on the tier's strict score. The difficulty comes from what the task asks and how strictly we score it, never from longer sessions or tighter turn caps. Very hard tests usually hit a floor, where every arm scores near zero and nothing can be measured, so every 10x tier gets a partial-credit score that keeps plain Opus near the middle of the scale. The CEO review goes first, but real plans with known outcomes are scarce. A free count of formal decision records (Go proposals, Rust RFCs, Kubernetes KEPs, PEPs, Swift Evolution) found 11 usable records under today's rules and 24 under the rules the CEO amendment would bring, against a bar of 160. So the amendment waits on one more free count, and if supply still misses the bar, the CEO line stops on yield. Engineering, devex and design get their harder tiers inside their own funded tests, and /investigate, /review and the coding lines get short notes.

## Before → after

Before: every planning line sits at the ceiling (CEO 12 of 12, E0 137 of 138, eng 15 of 16, dx 20 of 20). /investigate went from a ceiling (86 of 91 on SWE-bench Verified) to a floor (7.6% and 3.3% on screened SWE-rebench). No line says what "harder" means as a number, and the one harder attempt that ran, R3b, collapsed to a floor because it scored pass or fail.

After: one definition of a 2x and a 10x tier, anchored on plain Opus's strict pass rate at the cost per session of the line's current design, with target bands; graded scores that keep a 10x tier off the floor; a selection rule that is simulated before use and admitted on fresh passes; free supply counts that gate any build; a paid headroom check per tier; and an adoption order that starts with the CEO line, gated on supply. Every tier's cost per session is checked at admission against its line's current design.

## Why it matters

gstack-evals exists to steer gstack's research. A test at the ceiling says nothing about a skill, and neither does a test at the floor. The planning skills are the ones the project owner relies on most, and they are the ones whose tests saturated. A measurable ladder lets each line climb until plain Opus has room both above and below it, so a null can say "no lift at this difficulty" instead of "the test couldn't see".

## What caused this work

- 2026-11-05: the project owner asked for 2x and 10x harder evals on every line, then narrowed it the same day: CEO and the saturated planning reviews first, and 10x harder with no increase in cost, so difficulty must come from task content and scoring (GST-1422).
- The panel v3 headroom check (#191) ended the seeded-flaw line: plain Opus at eng 15 of 16 and dx 20 of 20, with 46 of 52 matches from sessions that never opened the planted file.
- R3b (2026-11-04-geva-283-r3b-results) kept tasks each model failed once, and most turned out never solvable: none rates 7.6% and 3.3%.
- GEVA-291's B0, the CEO outcome eval's free yield screen, failed its bar on 2026-11-05: 62 changed candidates against 160.
- Gate 1 of this plan's /autoplan review found that the CEO tiers' cost, the CEO amendment's frozen-rule changes and the /investigate milestone were wrong as first written. This version corrects them.

## Big decisions

1. **What "k times harder" means.** Options: (a) plain Opus's strict pass rate on the tier is today's rate divided by k, at the same session budget; (b) plain Opus's miss share is k times today's; (c) expert human time. Pick (a). Why: today's miss share is about 0.05, so (b) leaves a 2x tier at the ceiling; (c) pushes toward longer tasks, which the owner ruled out. At a flat cost per session, (a) also means k times the spend per strict success, so it is a cost-shaped definition. What would flip it: the owner preferring a definition that keeps 2x near today's tasks.
2. **The 10x primary is graded.** Options: a strict pass or fail; a graded score with the strict pass beside it. Pick graded. Why: a strict rate near 0.10 has no room below it, so a loss can't show, and a graded score keeps room when hit@3 saturates. The graded score is not more powerful in general. In the simulation it reaches power 0.73 against hit@3's 0.40 only when gstack lifts ranking and the named fix as much as it lifts finding; with the lift on finding alone it reaches 0.36, slightly below hit@3. So each prereg freezes power rows under both shift models. What would flip it: judges failing the agreement gate on the graded parts, which then drop by a rule fixed in advance.
3. **CEO's 10x tier and the one CEO amendment.** The 10x tier scores the same units more strictly (the real issue ranked first and its fix named), with decoy and second-order strata, and discards no units, because supply binds. The amendment would also widen the pool and add a CEILING fallback. It replaces about a dozen frozen texts (section 6.1 lists each), so it ships at gate class for about $60 of crew. Options for its scope: (a) fallback plus secondaries; (b) secondaries only, with a later prereg for 10x. Pick (a). Why: a CEILING otherwise ends the design and wastes the calibration authoring, and the switch reads only plain Opus's calibration rates, never a contrast. What would flip it: the Captain preferring the smaller amendment.
4. **Supply gates the CEO build.** The amendment starts only if free counts show the combined changed count, under the amended rules, clears 160. Otherwise the CEO line stops with FIX-METHOD on yield and the amendment's crew is saved. Counts so far: 11 changed records under b0.ts's rules and 24 under the amended rules, beside B0's 62; GEVA-291's widened screen reports the rest. What would flip it: the owner accepting a smaller pool with a larger MDD.
5. **Each line's cost anchor is its current design.** The anchor is the median plain Opus session of the line's current design, not of its oldest panel. For CEO that is GEVA-285's stage 1 median. Moving CEO from seeded panels ($0.126 median) to real-outcome units ($0.25 projected for none) roughly doubled its cost per session. GEVA-285 made that change inside its approved $2,000 line; the ladder adds no cost on top of it.
6. **Selection without a floor.** Keep a unit only when plain Opus passes it in 1 or 2 of 3 screen passes (R3c's rule), never on one failure, and never where units are scarce. Simulate each keep rule from the pool's own per-task data first, and admit the tier on fresh passes only. What would flip it: a screen that keeps too few units, which then reads FIX-METHOD on yield.
7. **eng, devex and design.** Wave 1's build-outcome families (G, X, U) keep their money and get their harder tiers inside their own preregs, with each family's turn and step caps unchanged. Real-outcome review lines for the three skills (R-eng, R-dx, R-design) are pooled at no paid cost and run only as each skill's R61 attempt or fallback, paid by that skill's own line. Alternative: fund the review lines now, which needs new money or displaces G, X or U. What would flip it: the owner adding money, or a G, X or U admission stopping.
8. **Enforced arm.** Optional and priced. Recommend it as the remedy when a told arm fails its exposure smoke, on Opus first, and where a line's money allows after its primary design. Report it apart from told.
9. **R61 under the ladder.** Each tier counts as one ceiling-raise attempt. A CUT-CANDIDATE that rests on saturation needs the 10x tier's headroom check to read CEILING too. What would flip it: the Captain keeping R61's single attempt and treating the ladder as new lines.

## Implementation plan

### 1. Scope and the binding constraint

Lines, in order of depth: CEO (plan-ceo-review, with autoplan's CEO-only arm), eng (plan-eng-review and autoplan), devex (plan-devex-review, devex-review), design (plan-design-review, design-review), then briefly /investigate, /review, and the coding lines G, L1 and TB2.

The constraint: every tier keeps its line's current harness, model settings, turn or step cap, session allowance and unit size class, so its cost per session equals the current design's. Difficulty comes from task content and scoring only. No tier cuts a turn or step cap, because that makes tasks harder by budget. Section 2 makes the cost side a checked number.

### 2. What 2x and 10x mean

Three numbers decide a tier.

- **Reference s0.** Plain Opus 5.5's pass rate on the line's current tasks, under its current scoring, at today's session budget.
- **Strict measure.** The tier's own pass definition: at 2x the line's binary primary (for CEO, hit@3); at 10x a stricter conjunction (for CEO, the real issue ranked first and its fix named).
- **Measured multiple.** k = s0 / s, where s is plain Opus none's strict pass rate on the tier's units at the same session budget. At a flat cost per session, k is also how many times more plain Opus spends per strict success. k mixes harder content with stricter scoring, so every headroom check prints k with an interval and names its measure (k on hit@3, k on strict).

**Reference and cost anchor per line.**

| Line | Today's tasks | s0, plain Opus 5.5 | Cost anchor: median Opus none session of the current design |
|---|---|---|---|
| CEO | seeded-flaw panels v1, v2; headroom ceo stratum | 8 of 8, 12 of 12, 12 of 12 | GEVA-285 stage 1, measured; $0.25 projected (the seeded panels were $0.126) |
| eng | panel v3 headroom eng stratum; E0 pooled | 15 of 16; 137 of 138 | R-eng: the headroom check's $0.313 mean; G: G admission's unscreened none median (about $1.0 at house prices) |
| devex | panel v3 headroom dx stratum | 20 of 20 | R-dx: $0.313; X: X admission's unscreened none median |
| design | E0 pooled; headroom design stratum (2 items, no read) | 137 of 138; 5 of 8 | R-design: $0.313; U: U admission's unscreened none median |
| /investigate | SWE-bench Verified (R3a) | 86 of 91 (0.945) | R3c admission's none median on the same unscreened pool, not R3b's hard subset ($0.43 a trial) |
| /review | stacks-r1 units (R2) | blocking recall 3.6%, any severity 25.0% | $0.73 (R2 none) |

Planning lines use a pooled s0 of 0.95, rounded down from these counts so that tiers err harder. Each anchor is frozen before any keep rule runs on its line.

**Bands for plain Opus none on Opus 5.5.**

| Tier | Strict pass s | k | Primary | Plain Opus band on the primary |
|---|---|---|---|---|
| T0, today | 0.94 to 1.00 | about 1 | the line's binary | at the ceiling |
| 2x | 0.35 to 0.60 | 1.6 to 2.7 | the strict measure (binary) | 0.35 to 0.60 |
| 10x | 0.05 to 0.20 | 4.8 to 19 | graded (section 4) | 0.25 to 0.50 |

Room: at the 2x band's top edge 40 points sit above plain Opus, against binary MDDs of 15 to 21 points (section 10), and at its bottom edge an 18-point loss still shows. The 10x band leaves at least 50 points above and 25 below on the graded score.

CEO's frozen bar, hit@3 from 0.15 to 0.60, spans k from 1.6 to 6.3. When CEO's hit@3 reads below 0.35, results label that tier by its measured k, not as 2x.

**The budget anchor.** A tier's median plain Opus session cost must fall within 0.8 to 1.25 times its line's anchor, under the same harness, turn or step cap, allowance and unit size class. The rule applies within a unit source. A line that changes its unit source re-bases its anchor at that change and prints both numbers, as CEO does above. Every headroom check prints the ratio. A tier that misses it fails admission as "cost changed", and its units are trimmed or replaced.

**A worked check.** R3b kept SWE-rebench tasks each model failed once. Opus none passed 7.6%: k = 0.945 / 0.076, about 12. R3b was a 10x tier scored pass or fail, and it floored. The graded 10x primary exists to prevent exactly that.

**Rejected definitions.** Miss share k times today's: today's miss share is about 0.05, so a 2x tier would sit at 0.90 and still read CEILING. Expert human time: dropped by the owner, and it pulls toward longer tasks. Turns, steps or tokens: held fixed by the budget anchor instead.

### 3. Levers that raise difficulty at a flat cost per session

| Lever | What changes | Effect on session cost | Main risk | Where |
|---|---|---|---|---|
| Real outcome keys | the answer is what really happened, so no author signposts it | none | supply | CEO, R lines, /review sources |
| Decoys from the record | the key marks the most-discussed concern that did not decide the outcome; ranking it first loses rank credit | none | judges must tell decoy from the real issue | review-foresight lines |
| Second-order units | the deciding issue comes from an interaction: two parts of the plan, or the plan and in-flight work the context lists | none | rarer | review-foresight lines; G's hidden-constraint stratum |
| Stricter scoring | rank 1, the fix named, the three-slot cap, forecast calibration | none for the session; judges read up to 120 more words per review | judge noise, met by an agreement gate and a stock fix | every review-foresight line |
| Sometimes-band selection | keep units plain Opus passes 1 or 2 of 3 screen passes | screen sessions at today's price, replacing random headroom passes | regression to the pool mean; units shaped by Opus's blind spots | plentiful pools only (section 5) |
| Harder goals and scenarios | off-path goals, empty, error or first-run states | none | authoring | X, U |

Rejected at a flat cost: bigger repositories (the panel v3 headroom check's 368 to 452 KB trees didn't make planted flaws harder, and 46 of 52 matches came without opening the planted file); more turns or longer tasks; plans longer than the line's size class; tighter turn or step caps, which make tasks harder by budget.

### 4. Scores that survive a floor

**4.1 Review-foresight lines** (CEO, R-eng, R-dx, R-design). Every arm ends with the CEO prereg's closing block: at most three ranked issues, each with issue, evidence and fix, every issue cut to its first 40 words, and a forecast. Per review of a changed unit:

- h3 = 1 when one of the first three issues has final label D (the CEO prereg's hit@3).
- h1 = 1 when the first issue has final label D.
- rem: every judge labels rem on every issue in the packet's top three, reading only the first remedy that issue's fix states, within its first 40 words. rem = 1 when the first issue with final label D also has rem from two of the three judges. So rem is defined on every cell, split D cells included.
- **Graded primary at 10x: G_R = 0.50 h3 + 0.25 h1 + 0.25 rem.** On a unit whose key has no remedy (the auditors left it blank), G_R = 0.67 h3 + 0.33 h1, so every changed unit stays in the read. Readings print the remedy-keyed count, the power at that count, and whether remedy-keyed units differ in h3. A no-block review scores 0.
- Strict measure: h3 at 2x; h1 and rem together at 10x.
- Secondaries: rank-weighted hit, decoy-first rate (the first issue is the keyed decoy), slot precision, and forecast Brier and AUC over changed and held units. The forecast stays out of the primary because held units are what keep a blanket-pessimist forecast from scoring well, and the primary reads changed units only.
- Generic-remedy control: each stock row also carries a stock fix ("cut it to a minimal version, reuse an existing tool, or don't build it"), labelled for rem like any fix. If the stock fix scores rem on more than 1 calibration unit, rem leaves the primary.
- Agreement gate: positive agreement on rem is computed over all stage 1 cells (Opus, Sol and particle-1 sessions), printed with its interval. Under 0.70, rem leaves the primary everywhere, the CEILING fallback included, and G_R becomes 0.67 h3 + 0.33 h1. This is the only rule for low rem agreement, and it is fixed in advance.
- Why these weights: h3 keeps half the score, so the graded scale stays continuous with the 2x primary. G_R always lies between 0.5 h3 and h3, so it keeps room as long as h3 does. Plain Opus on 10x content (h3 about 0.45, and h1 and rem in about 0.45 and 0.40 of its hits) lands at 0.32 in the simulation, with a strict rate of 0.094. G_R's scale is compressed, so a G_R point is not a hit@3 point, and results never compare them.

**4.2 Build-outcome lines** (G, X, U, /investigate, L1).

- Hidden-test share: the share of the change's own hidden tests (FAIL_TO_PASS) that pass, counted only when the base suite (PASS_TO_PASS) stays green, else 0. The lane's verifier contract (#102) already records per-test results.
- One milestone per family: /investigate, localization read from the closing block every arm writes (4.3), rank-weighted 1, 2/3, 1/3; G, the hidden-constraint test passes (section 6.2), counted in the milestone only and left out of the share when it is also a FAIL_TO_PASS test, so it never counts twice; X, goals reached within the cap (6.3); U, scenarios finished within 1.5 times the gold step count (6.4).
- **Graded primary at 10x: G_B = 0.6 share + 0.4 milestone.** Binary solved prints beside it as the strict measure.
- No 10x tier has a single pass or fail primary.

**4.3 The closing-block rule (a ladder rule).** When a score reads an arm's written output, every arm ends with the same closing block, and the score reads only that block. A told arm's skill report (such as /investigate's DEBUG REPORT) never feeds a score, because the none arm never writes one, and reading it biases the score toward told. For /investigate the block is "Root cause: up to three files, ranked", and localization reads the rank of the gold patch's changed file in it. Each adopting prereg's dry run includes a case where the none arm names the right file. R3c is the first line to adopt the rule; the Captain carries it to R3c's owner (GEVA-284), and this plan edits none of R3c's files. Review-foresight lines already follow it through the CEO prereg's closing block.

### 5. Selection without a floor

1. Never select on one failed trial. R3b did, and 55 of Opus's 70 tasks were never solved in six tries.
2. The keep rule, R3c's proposal generalized: three plain Opus none screen passes per candidate, on the tier's strict measure. At 2x keep units with 1 or 2 strict passes. At 10x keep units with 0 or 1 strict passes and a graded score above 0 in at least 2 of 3, so plain Opus engages and still misses. Screen passes never enter the contrast.
3. Only where the pool is plentiful: reverts (4,150 merged revert pull requests with 6 or more comments, 2026-07-15 to 2026-10-31), SWE-rebench, and G's feature pool. Never for CEO or design, where supply binds; there scoring and strata carry the tier.
4. Selection runs on Opus none. Sol and particle-1 read the same units, labelled Opus-selected, and their bands are reported, never targeted.
5. The band is not reached by construction. Choosing units by their screen passes makes fresh passes regress toward the pool's mean, and the direction depends on the pool. On an assumed bimodal pool shaped like SWE-rebench (55% of tasks passed with probability 0.95, 25% with 0.02, 20% uniform), the 2x rule kept 19% of candidates at a screen rate of 0.55, and they read 0.645 on fresh passes, above the band; the 10x rule read 0.11 (the review's simulation, rerun on this machine). So before any prereg adopts a keep rule, it simulates the rule from the pool's own per-task data (R3a4's 200 SWE-rebench tasks, R3b's six-trial grid, G's admission), prints the expected fresh rate and the kept share, and admits the tier on fresh passes only. The paired contrast stays fair because both arms run fresh passes on the same kept units.
6. A tier that selects uses its screen in place of random headroom passes, so the screen is the headroom check's money, not new money.

### 6. Planning lines

#### 6.1 CEO (plan-ceo-review)

**State.** The outcome eval is merged (GEVA-285, #214) with its guard amendment (GEVA-289, #217). B0 failed its yield bar: 62 changed candidates against 160; 887 named-pool records in, 662 dropped on the 500-star floor. A widened free screen is running. B1 (the harness build) and B2 (custody and authoring) have not started. The headroom bar is frozen at hit@3 from 0.15 to 0.60.

**Tier map.**

| Tier | Units | Strict | Primary | Plain Opus target | Opus session cost |
|---|---|---|---|---|---|
| T0 | seeded panels v1, v2 | seeded item found | | 1.00, retired | $0.126 median (v2) |
| 2x | GEVA-285's real post-cutoff plans | hit@3 | hit@3, frozen | 0.15 to 0.60, frozen bar; labelled by measured k below 0.35 | GEVA-285 stage 1 median; projected none $0.25, standalone $0.70, autoplan-ceo $3.00 |
| 10x | the same units | h1 and rem | G_R | strict 0.05 to 0.20, G_R 0.25 to 0.50 | the same |

**Cost per session.** CEO's anchor is GEVA-285 stage 1's measured median. The move from seeded panels ($0.126) to real-outcome units ($0.25 projected for none) roughly doubled CEO's cost per session. That doubling came with GEVA-285's design and its approved $2,000 line, not with the ladder. The 10x tier runs no extra session: its new costs are key fields, judge labels and the amendment's crew.

**Why no selection here.** B0's funnel: the stars rule alone cut 662 of 887 records. Discarding units plain Opus passes would shrink a pool that already misses its bar.

**Supply, counted free on 2026-11-05.** Structured decision records are those where a group decides in writing and gives reasons. One script with no model call read GitHub's GraphQL API (records created 2026-07-01 to 2026-10-31, outcome by 2026-10-31), applied b0.ts's rules (unit-brief.md items 1 to 3: licence, 500 stars, 400 words of the first version, posted date), then applied the amended rules listed below. It printed counts only and kept no record text. PEP and Swift Evolution proposal files were counted from each repository's history at 2026-11-01.

| Source | Records in | Changed, b0.ts rules | Changed, amended rules |
|---|---|---|---|
| Go proposals (golang/go, label Proposal, closed) | 57 | 10 | 10 |
| Rust RFC pull requests closed unmerged | 7 | 0 | 2 |
| Rust compiler-team major changes, closed | 24 | 0 (the repository has 435 stars) | 1 |
| Kubernetes KEP pull requests closed unmerged, 6 or more comments | 10 | 1 | 3 |
| Swift Evolution pull requests closed unmerged | 7 | 0 | 2 |
| PEP pull requests closed unmerged | 8 | 0 | 3 |
| PEP files first posted in the window and withdrawn | 2 of 18 | not read by b0.ts | 2 |
| Swift Evolution proposals added in the window and returned for revision | 1 of 26 | not read by b0.ts | 1 |
| **Total** | | **11** | **24** |
| At most two units per repository (unit-brief item 6) | | 3 | 11 |

The 400-word rule on a record's first version drops most of the rest (25 of 57 Go proposals). Under b0.ts's own window for proposal pools (created by 2026-10-15) the b0.ts count is 10, or 3 at two per repository. Accepted outcomes become held units and don't count toward the bar.

**The bar.** GEVA-285's B0 bar is 160 changed candidates surviving the free screen. It applies to the combined count under the amended rules: B0's 62, these 24, and GEVA-291's widened screen, deduplicated by record, since B0's proposal-label pools may already hold some Go proposals. Today that combined count is at most 86. If GEVA-291's widened screen doesn't bring it to 160, the CEO line stops with FIX-METHOD on yield and the amendment below is never written. The amendment keeps unit-brief item 6, so the structured sources can supply at most 11 audited units.

**What the one CEO amendment would change, if supply clears the bar.** It replaces frozen text in GEVA-285 (README, unit-brief.md, judge-brief.md, power.py and ceo-rule.ts), so it ships at gate class. "Nothing else changes" is dropped. The frozen texts it replaces:

1. **Source** (section 4 and unit-brief item 1: GitHub records only). Adds Swift Evolution and PEP decisions posted on the Swift forums and discuss.python.org.
2. **Licence allow list** (unit-brief item 1: MIT, Apache-2.0 or BSD). Adds CC0-1.0 and a public-domain dedication stated in the proposal document itself. PEP documents carry one; python/peps has no licence GitHub detects.
3. **Stars rule** (unit-brief item 1: 500 stars on the record's repository). The 500 stars are read on the project the decision process governs: rust-lang/compiler-team has 435 stars and rust-lang/rust 121,084.
4. **Outcome class** (section 4). For a structured record, the written decision sets the class, not GitHub's close reason: an issue closed as completed but declined in writing is rejected, and a duplicate drops.
5. **Posted date** (unit-brief item 2). The proposal's first public version (the PEP's first commit, the RFC's first commit, the first discussion post), not the date of a status-change pull request. A proposal first posted before 2026-07-01 drops, so older proposals don't leak past Opus's training cutoff.
6. **Packet rule** (README:179, "issue text only; evidence and fix are left out"). Judges also read each top-three issue's fix, cut to 40 words, to label rem.
7. **Key fields.** The key writer adds D's remedy: what the record shows would have changed the outcome, such as the scope the maintainers asked for, an existing alternative, or "do not build it" when the premise was rejected. A "returned for revision" note usually names that change. The key may also mark a decoy, the record's most-discussed concern that did not decide the outcome, and a second-order flag. Auditors check that the record supports the remedy and leave an unsupported one blank.
8. **Judge brief** (judge-brief.md). Adds the rem and decoy labels, the first-remedy rule and the stock fix (section 4.1); its sha changes.
9. **CEILING stop** (README:212, "CEILING, FLOOR, NO READ or STOCK FAIL ends the design") and **start rule 8** (README:305, "Stage 2 starts only on HEADROOM"). Replaced by the CEILING fallback below.
10. **Primary family.** When the fallback fires, G_R becomes the primary, which changes the Holm family, the verdict text, the R48 ceiling line and the power table.
11. **Readings.** Stage 1 and stage 2 print G_R, strict, h1, the rem rate, the decoy-first rate, the second-order stratum and the remedy-keyed count as secondaries, plus k for both tiers with its measure.
12. **Terms** (section 16, GitHub only). Extended to the two forums (section 12).

**The CEILING fallback.** If stage 1 reads CEILING on hit@3 (Opus none above 0.60) and G_R reads 0.25 to 0.50 with strict at most 0.20, stage 2 runs on the same units, arms and caps with G_R as its primary. G_R's form follows section 4.1's agreement rule, with or without rem; the fallback has no separate rem condition. The switch reads only Opus none on the calibration slice, which is disjoint from the comparison units, so choosing the primary can't inflate the contrast's error rate. Its weak spot is power: at the fallback regime (h3 about 0.70), G_R's power at a logit shift of 0.8 is 0.79 when gstack lifts every part and 0.20 when it lifts finding alone. The amendment freezes both rows, and results say which regime read.

**The amendment's dry run drives:** the fallback on both sides of each condition (h3 at 0.60 and 0.61, G_R at 0.25 and 0.50, strict at 0.20, rem agreement at 0.69 and 0.70); a blank-remedy unit; rem labels on split D cells; a stock fix that matches a remedy; and the budget anchor at 0.79, 0.80, 1.25 and 1.26 times.

**Timing.** After the supply count clears the bar, before B1 merges and before B2 keys any unit. Once keys exist, adding the remedy means re-keying every unit. If GEVA-291's widened screen carries its own amendment post for the new pools, the two fold into one post, so only one post changes section 4.

**Cost.** Sessions unchanged. Judges read up to three 40-word fixes per review instead of none, so judging rises by at most about half: stage 1's projected $6.00 becomes at most about $9, and stage 2's $57.60 at most about $86. Keys add one field, about 5% more authoring tokens. The amendment's crew, re-projected at GEVA-291's measured 511 credits per million tokens and CREW's 120M tokens or more for a /ship on outcome-classification code (ceo-rule.ts), is about $60. At that same rate the CEO line's 860M-token crew estimate is itself about $440, against its $430 crew reserve, before the amendment adds anything. ceo-rule.ts's all-in check holds the line: stage 2 shrinks to keep the CEO line at $2,000, never an overrun.

**Power.** 2x as frozen: 18 points at Holm's first step on 48 changed units at 2 passes. 10x on G_R at 48 units and 2 passes, alpha 0.025: power at a logit shift of 0.8 is 0.73 when gstack lifts finding, ranking and remedy alike, 0.36 when it lifts finding only (hit@3 alone reads 0.40), 0.66 with 15% of rem labels flipped, and 0.56 at 36 units. The G_R MDD under the first model is about 14 points, on G_R's own scale. The simulation reads 16.9 points where the frozen power.py reads 18 at control 0.40, so its MDDs run about a point optimistic. The amendment freezes its rows with power.py's own method, under both shift models, at 36 and 48 units by 2 passes, and at the fallback regime. Passes stay frozen at 2.

#### 6.2 eng (plan-eng-review) and autoplan

**State.** Seeded panels at the ceiling (eng 15 of 16). plan-eng-review is a CUT-CANDIDATE as seeded-flaw panels measure it, kept until wave 1's outcome test reads (GST-1218). The G admission prereg is merged (GEVA-262); its 12-task thin slice T-G is not authored.

**B ladder, build outcome on family G (funded).**

| Tier | Tasks | Strict | Primary | Plain Opus target | Opus session cost (house prices) |
|---|---|---|---|---|---|
| 2x | G's confirmatory panel, screened with the keep rule | solved | solved, as plan v3 freezes | 0.35 to 0.60 on fresh passes | none about $1.0, told plan-eng-review about $2.2, autoplan about $4.8 |
| 10x | the hidden-constraint stratum: tasks whose real change handled a constraint the statement leaves out (compatibility, a migration, concurrency, an error path), each keyed to the hidden test that checks it | solved and constraint test passed | G_B | strict 0.05 to 0.20, G_B 0.25 to 0.50 | the same |

Before T-G authoring, with no prereg change: tag each mined task for the hidden-constraint stratum and name its constraint test in the sealed key, noting when that test is also a FAIL_TO_PASS test. G's admission reads the unscreened pool against its frozen 0.20 to 0.80 band and stays as written; its none median becomes G's cost anchor. The keep rule, its simulation from G's admission data, and G_B belong in stage 4's prereg, which is not written; plan v3 keeps graded hidden-test share as a sensitivity until then.

**R-eng, review foresight on real engineering outcomes (not funded).**

- Units: real post-cutoff changes later reverted or regression-fixed for a technical reason, and RFC pull requests closed unmerged for one. B0 already holds 123 reverted candidates in 57 repositories that pass the CEO free rules and will mostly fail CEO's product-decision category: that is R-eng's starting pool. Wider: 4,150 merged revert pull requests with 6 or more comments, 44 with "regression" in a revert's title (4 or more comments), 20 labelled regression, all 2026-07-15 to 2026-10-31.
- Unit shape at a flat cost: plan.md (the change's first description, in our words), context/project.md, and a pruned tree at the base commit in the headroom check's size class (368 to 452 KB), where an Opus none session cost a mean $0.313.
- Key: D is the technical reason the record gives (a race, data loss, a compatibility break, a performance regression, a missing migration, the wrong layer). The remedy is the approach that landed instead. The decoy is the most-discussed review comment that did not decide it.
- 2x is hit@3 on D. 10x is G_R, and the keep rule applies, since this pool is plentiful.
- Risk: many reverts undo flaky or unrelated breakage that no plan reader could foresee; the foreseeability audit drops them. B0 found revert bodies pass the 400-word rule mostly on templates.

**Money.** plan-eng-review's and autoplan's $2,000 each go to G (the G prereg fits every design inside a $1,700 line with at least $300 in reserve), so R-eng can't run beside G. R-eng's pool sealing is crew work paid by plan-eng-review's line, out of the reserve G's prereg leaves, and only after G's admission reads; the CEO line never pays it. Its headroom check (about $45 in sessions and judges, plus about $40 to $60 of authoring crew for 20 units) runs only as R61's ceiling raise when G's admission reads saturation (none above 0.80), or as plan-eng-review's instrument when G stops on exposure or price, and only when both the line's $2,000 and wave 1's $10,000 leave room.

#### 6.3 devex (plan-devex-review, devex-review)

**State.** Seeded panel at the ceiling (dx 20 of 20); a CUT-CANDIDATE as seeded flaws measure it (GST-1218). Family X in wave 1 grades docs-only first success: one frozen goal, two runs per tree, 20 turns. Its prereg is not written; plan v3's house MDD is 15.6 points.

**B ladder, written into X's prereg from the start, at X's 20-turn cap.**

- 2x: the two docs-only runs per tree take two different goals instead of one goal twice: one on the default path, one off it (an error case, a configuration edge, an upgrade from the old surface). Same measurement cost. Strict: both goals reached.
- 10x: off-path goals kept by the keep rule on plain Opus's trees at admission, after the rule's simulation. Graded: each goal scores 1 when reached within 10 turns, 0.5 when reached within the 20-turn cap, else 0, and the tree's score is the mean over its two goals.
- Cost anchor: X admission's unscreened none median.

**R-dx (not funded).** Real post-cutoff developer-facing changes reversed or re-scoped for developer-experience reasons: a breaking-change backlash, a confusing name or default, migration pain, missing docs. Free counts, 2026-07-15 to 2026-10-31: 132 merged pull requests with "revert" and "breaking" in the title; and 16 closed issues labelled "breaking change" with 8 or more comments, created 2026-07-01 to 10-15. Swift Evolution API reviews returned for naming fit too. Unit: plan, context and the public surface only (README, docs, --help output, type files), the X family's docs-only container, so a session costs no more than the headroom check's dx stratum. It runs only if X leaves room under both plan-devex-review's $2,000 and wave 1's $10,000.

#### 6.4 design (plan-design-review, design-review)

**State.** The seeded design stratum read NO READ on 2 items and is FIX-METHOD, moved to family U: an agent user completes 3 frozen scenarios in the built UI with a 25-step cap. U is last in wave 1, and its prereg is not written.

**B ladder, written into U's prereg, at U's 25-step cap.**

- 2x: scenarios that start from an empty, error or first-run state. Strict: all three scenarios completed.
- 10x: scenarios kept by the keep rule on plain Opus's built UIs, after the rule's simulation, three per task, so supply doesn't bind. Graded: a scenario scores 1 when completed within 1.5 times the gold UI's step count, 0.5 when completed within the 25-step cap, else 0; the tree's score is the mean over its three scenarios.
- Cost anchor: U admission's unscreened none median.

**R-design (not funded, thin supply).** Free counts, 2026-07-15 to 2026-10-31: 57 merged revert pull requests labelled ui and 8 labelled ux; 8 closed issues labelled ux and regression, created 2026-07-01 to 10-15. Text-only units (plan, context and a written description of each affected screen) keep sessions at the headroom check's cost. This pool likely can't fill a tier; a free screen decides before any spend, and it runs only if U leaves room under both caps.

### 7. Other lines, briefly

#### 7.1 /investigate (R3; R3c proposed, Opus only, $750 planned, caps not recorded)

| Tier | Tasks | Strict | Primary | Plain Opus target |
|---|---|---|---|---|
| T0 | SWE-bench Verified | solved | | 0.945 (86 of 91) |
| 2x | R3c: SWE-rebench tasks kept by the 1-or-2-of-3 rule | solved | solved | 0.35 to 0.60, checked on fresh passes |
| 10x | far-symptom and multi-cause bugs | solved | G_B: hidden-test share and localization rank | strict 0.05 to 0.20, G_B 0.25 to 0.50 |

**Flags before R3c's caps freeze** (carried to GEVA-284 by the Captain; this plan edits none of R3c's files). The closing-block rule (4.3): every arm ends with up to three ranked root-cause files, and localization reads only that block. Per-test verifier output in every trial. Two graded secondaries that need no extra session: FAIL_TO_PASS share under the PASS_TO_PASS gate, and localization rank from the closing block. A keep-rule simulation from R3a4's 200 tasks and R3b's six-trial grid. The cost anchor from R3c's admission on the unscreened pool. R3c's admission already gives every candidate three none trials, so with those fields recorded, the 10x keep rule reads from R3c's admission at no extra cost. If R3b's run records hold per-test output, re-reading R3b's 70 tasks per model for graded share is a free first look at the 10x band.

**10x sources at a flat cost.** SWE-rebench tasks whose gold patch changes files the issue text never names, or spans two or more modules (computed free from the statement and the patch; same harness and session cost as R3b). HopLoc, a test-verified bug-localization set stratified by hop distance, mined from public repositories. DDBench: 60 confirmed historical bugs from 13 open-source distributed systems, each with a symptom report, debug context such as a goroutine dump, and a hidden oracle; its builds may cost more, so a two-session pilot measures before adoption. RCAEval: recorded microservice telemetry with a blind task view, scored on root-cause component and reason, so partial credit is built in. OpenRCA (335 failures, over 68 GB of telemetry) is too large for a flat cost.
