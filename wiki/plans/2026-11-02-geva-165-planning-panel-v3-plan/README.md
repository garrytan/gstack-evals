---
id: 2026-11-02-geva-165-planning-panel-v3-plan
kind: plan
title: "Planning panel v3: CEO, eng, DX and design strata built off the Opus 5.5 ceiling, a kind screen and an admission pilot"
summary: "Approved plan for planning panel v3: harder kinds screened on plain Opus 5.5 (E0), an admission pilot per stratum (E1), two-turn arms, and capped rounds for five R56 rows."
author: GEVA-165
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: done
links:
  - 2026-11-01-geva-115-planning-ceo-v2-admission-prereg
  - 2026-10-31-geva-79-planning-lane-plan
  - src/trial/review/plan.ts
  - src/trial/review/run.ts
  - src/trial/review/cli.ts
source: "Plan written by GEVA-157 (round 1, gate 1) and revised by GEVA-165 (round 2, gates 2 and 4) through gstack /autoplan run ap-20261102033957; approved at gate_rev 4. Issues GST-916, GST-925 and GST-539; PRs #127 and #131. The Implementation plan section is the approved text."
attachments:
  - f4b0387937a390b5addec4021066bceecb91eaf1845c6ebcb66c74563562ab82  power.txt
  - cd969779cc0930fb23c9f6df5df57ae6575ad170aa26332612c71ec5f22f3cef  price3.py
  - dd81a85c6de5d7cd0514fbf1fadd18f4e549ef885b3c14ead3816e2cd1385ce7  price3.txt
  - 68ca8527b87738594bf1730587b46bb9342f271f9342626de6d36edcd9d8f664  review-record.md
---

# Planning panel v3: CEO, eng, DX and design strata built off the Opus 5.5 ceiling, a kind screen and an admission pilot

Threads GEVA-157 (round 1, gate 1) and GEVA-165 (round 2, gate 2), issue GST-916, Captain GEVA-2. Serves R56-2 (plan-eng-review), R56-3 (autoplan), R56-5 (plan-ceo-review), R56-6 (plan-devex-review) and R56-7 (plan-design-review). Plan only: no panel item is written, no paid call runs and no code changes in this thread.

## Approval

- **Gate 1** (round 1, GEVA-157): Garry took the recommendations on 2026-11-02 (rec_hash 3ebf09624cfc), relayed by the Captain (GEVA-2). It took every gate-1 recommendation, A1 to V1.
- **Gate 2** (round 2, GEVA-165): Garry approved on 2026-11-02T18:00:20Z in FOUN-32, which took gstack-evals' option 1 on that list: reply rec to gate 2 and approve the plan (rec_hash 62a043aa392c). Round 2 ended at its round cap with 21 Highs open. Gate 2 wrote 20 of them into the plan as fixes and kept the plan's direction on the one user challenge (A1: no natural-plan slice yet).
- **Captain rulings folded into the same revise** (GSTA-2): the two-turn protocol for every arm, the recAnswer fix and the gstack arm's exposure bar, from the gstack Captain's GST-925 result (GSTA-36); the CEO-only autoplan pin note from GST-539 (GSTA-215).
- **Gate 4** (the delta written after the round cap, which the crew rules give to the Captain): GEVA-2, "Gate 4: rec." It accepted the fixes, the rulings and the cap record, and two corrections that a cross-family carry check (GPT-6.1 Sol) asked for: a timeout before any model output stays a coverage gap, and E_ROUTE_INFRA exits 2.
- **Spend.** Garry approved the program's spend, saying that spending the money is fine because this is AI research (recorded in the Captain drive at approvals/2026-11-02-panel-v3-program.md). Section 7 records the cap changes at gate 2 with their reasons. Each paid item still needs its own merged prereg, a ledger approval row and a start rule that passes. This post spends nothing.

Letter tags in the text name gate decisions. Text added at gate 2 uses gate 2's letters: B1 judge kappa, C1 timeout row, D1 scorer PR split, E1 cost-matched ladder, F1 one item per stratum, G1 route-check codes, H1 route-check size, I1 clean-room preflight, J1 timeout as its own termination, K1 bridge failures, L1 Informational rows, M1 autoplan readiness by surviving strata, N1 untested arms, O1 the stop table as the only rule, P1 scoring source, Q1 one row per reconciled finding, R1 harvest before cleanup, S1 pricing from the mean, T1 pre-cleanup hook, U1 one skill item per stratum. Older text uses gate 1's letters, listed in review-record.md.

## Open at approval: what the build and the preregs must settle

Round 2 also left Medium and Low findings that no gate item carried. Some are closed by the gate-2 text; the rest go to the thread that owns the step.

| Finding (round 2) | Severity | Where it lands |
|---|---|---|
| ceo-native-5: the cost ladder never reached matched spend | Medium | closed by E1 (k matched from E1's means) |
| ceo-native-6: the confirmatory ceiling stop reads the same data the test uses, one way only | Medium | each confirmatory prereg |
| ceo-native-7: a model that joins at a later prereg skips the route check, band and procedure gate | Medium | each confirmatory prereg |
| ceo-native-8, ceo-outside-2: E0 at main runs every stratum under the ceo lens, before the clean-room checks exist | Medium | the E0 prereg: show the none arm clean by construction in the trial image and run the read audit after the run as a descriptive check (crew rule), and name the lens it passes |
| ceo-outside-3: a stratum with only KEEP-FLOOR kinds can't meet the unit recipe | Medium | the author kit and the E0 prereg |
| dx-native-7: letter tags collide across gates | Medium | the key above |
| dx-native-8: ledger item names and word order | Medium | the E1 prereg |
| dx-native-9: the scorer PR's budget and date didn't move | Medium | closed by D1 |
| dx-native-10: the read audit's consequences | Medium | closed by N1 |
| dx-native-11: the per-stratum confirmatory row counts four times in the total | Low | each confirmatory prereg prices one stratum's row |
| dx-native-12: E0's commands and its termination-read interface | Low | the E0 prereg |
| eng-native-5: a stub-CLI test can't prove the converter reads a real run directory | Medium | C2, then E1's autoplan gate on real sessions |
| eng-native-7: stop limits and the skill arms' turn cap for v3-size units | Medium | the E1 prereg |
| eng-native-8: readings join runs with no pin check | Medium | the E1 prereg |
| eng-native-9: E0's termination read is untested on real stops | Medium | the E0 prereg's dry run |
| eng-native-10: a gstack-auto timeout after output skipped the bridge | Medium | closed by C1 and J1 (scored like a turn cap, from the run directory) |
| eng-native-11: route-check metering needs generation ids and a bounded wait | Low | C1 |
| eng-native-12: the AGENTS.md naming check fires at run time | Low | closed by I1 (check_units.py carries the list) |
| eng-outside-3: session keys don't bind the bridge and cap-stop scoring | Medium | C1 and C2 |

## ELI5

We test whether gstack's plan-review skills help an AI find real problems in a plan. To test that, the AI without gstack has to miss some problems; if it already finds every one, gstack has nothing to add and the test says nothing. Twice now, plain Opus 5.5 found every planted problem (8 of 8, then 12 of 12). Each of those problems took one step of reasoning: read two places, notice they disagree. This plan makes problems that take more work: a small calculation across three files, a step the plan forgot, or code that does not do what the plan assumes. First we write 24 test units and check, for about $29, which kinds plain Opus actually misses. Then we write 32 pilot units from only those kinds, in four groups (CEO, engineering, developer experience, design), and admit each group only if plain Opus finds between 20% and 60% of its problems. Only an admitted group gets its full test units written and a full test of its own gstack skill; autoplan gets a test across the admitted groups.


## Before → after

- **Before.** CEO panels v1 and v2 sit at the ceiling for plain Opus 5.5 (R = 1.00). plan-eng-review, plan-devex-review and plan-design-review have no panel at all, and autoplan has never been measured. Five R56 rows wait on one missing instrument.
- **After.** One sealed panel v3 with four strata, built from item kinds that a cheap screen showed plain Opus misses, an admission pilot that reads headroom per stratum and per model, and frozen designs for five confirmatory rounds. Each R56 row gets a fair test or a stated reason it can't have one.

## Why it matters

R56 (Garry, 2026-11-02) says every gstack part earns its place. The five planning parts load on every /autoplan run (factory rule 1), about 120k tokens of skill text between them (GEVA-156's table: plan-eng-review 34,897, plan-devex-review 28,163, plan-design-review 26,614, autoplan 25,890, plan-ceo-review 15,037). None has fair evidence either way. A third panel at the ceiling would cost another round and still say nothing.

## What caused this work

#131 (GEVA-142, merged at 916215d) put CEO panel v2 at a ceiling: plain Opus 5.5 found 12 of 12 seeded must-fix items in both passes, so the panel was not admitted, and its R48 cycle read FIX-METHOD: harder items. Unforced /plan-ceo-review never opened its procedure (0 of 16); the forced line ran it 16 of 16. GEVA-156's evidence table then ranked plan-eng-review, autoplan, plan-ceo-review, plan-devex-review and plan-design-review among the ten largest untested parts, and all five need a planning panel the no-gstack arm doesn't already ace.

## Big decisions

1. **Screen item kinds before building the panel (E0).** Options: (a) author 24 calibration units, run plain Opus on them for about $29, and author pilot units only from kinds it misses; (b) author the panel and drop saturated kinds at admission. Pick (a). Two panels hit the ceiling on a guess; (a) turns the guess into a reading first. What would flip it: a measured miss rate below 0.6 for these kinds from some other run.
2. **Stage authoring behind each read (gate 1, A1 and B1).** Options: (a) author the 32 admission units after E0, and a stratum's 26 confirmatory units only after E1 admits it; (b) author all 136 units before E1. Pick (a): a stratum that fails costs 8 units, not 34. The price is a weaker exchangeability argument, which the frozen kit and the confirmatory ceiling stop cover (section 3).
3. **Add a lens arm to every confirmatory round.** The lens arm is the model with no gstack, told the skill's own one-line description. Options: (a) add it; (b) keep three arms. Pick (a). The new kinds overlap passes these skills name (missing states, migration paths), so a gain over none could come from the one-line framing alone; only a lens arm separates "the lens" from "the skill's procedure", which is the R56 question. Cost: about 11% more per stratum.
4. **Authors from a model family not under test.** Options: (a) google/gemini-4-argon authors, with Opus 5.5 and GPT-6.1 Sol auditors; (b) GPT-6.1 Sol authors, as in v2. Pick (a). Sol is now a model under test (R54), and an author family's own arm may read its style best. What would flip it: Gemini units failing audit at a high rate in the calibration slice.
5. **Sol and particle-1 enter admission only on strata Opus admits.** Options: (a) batch 1 runs Opus on all four strata, batch 2 runs Sol and particle-1 on admitted strata; (b) every model on every stratum at once. Pick (a): the panel is built for Opus's ceiling, and (a) saves up to $217 when strata fail. What would flip it: a need to read Sol's headroom where Opus saturates (#131 left that untested).
6. **Confirmatory size: 20 keyed plans of 3 items at 2 passes per stratum.** Options: (a) 20 x 3 at 2 passes; (b) 16 x 3 at 3 passes. Both give at least 80% power for a 20-point gain at alpha 0.025 (section 6). Pick (a): 28% fewer paid sessions for the same power, and more plans, which is the unit of inference.

## Implementation plan

The whole design is the implementation: sections 1 to 9 settle what the brief asks, and section 10 is the build sequence.

### 1. What made v1 and v2 easy

This rests on #131's published aggregates and R48 section and on R1a's stop post (#114), never on sealed packets.

- **One inference step.** v2's spec asked each item to need "a step that reading alone does not give". Authors met it with one step: two places that disagree (H-X), a stated fact a context file contradicts (H-F), an in-scope item the context shows is larger (H-T), a decision the context shows is wrong (P, U). Plain Opus found every kind in the draw at must-fix in every pass: H-X 4, H-F 3, H-T 1, P-alt 2, U 2.
- **Small units.** v2 plans ran 5.4 to 6.6 KB with 5 to 14 KB of context. Plain Opus read the whole unit and answered in a median of 3 turns at $0.126 a session. Nothing had to be searched for.
- **Few items, all statements.** One or two keyed items per plan, each a claim the plan makes that can be checked. No item was something the plan left out.
- **Severity was not the bottleneck.** Any-severity recall was also 1.00 (flag F1), so a harder panel can't come from asking for stricter severities.
- **Unforced skills don't run their procedure.** On Opus 5.5, "/plan-ceo-review Review this plan for problems." loaded the skill (48k first-request tokens against 22k) and skipped review-sections.md in 16 of 16 sessions (0 of 4 in R1a). A forced line ran it 16 of 16 at 4.5 times none's median cost. The gstack Captain traced the skip to the panel, not the skill (GST-925, GSTA-36): the prompt's format request made Opus drop the skill's interactive steps (0 of 3 sessions read the sections or named a mode), two template levers missed the bar (1 of 8 and 4 of 8 reads), and a realistic `/plan-ceo-review plan.md` ran the audit and Step 0 in 3 of 3. v3 moves every arm to the two-turn protocol in section 4.
- **gstack arms raised more unkeyed must-fix findings** that adjudication ruled real (1.44 and 1.63 per plan per pass against none's 0.44), at kappa 0.38. That hints at room the key did not cover. It decides nothing, but it argues for denser keys.

### 2. Item kinds expected below 0.6 recall for plain Opus 5.5

Every v3 item combines at least two of four levers that no v1 or v2 item used:

- **Two hops (H2).** The deciding conclusion needs an intermediate fact, derived from two places, then checked against a third. The intermediate fact is written nowhere.
- **Omission (OM).** The plan never mentions the needed step. Facts in the context make it required.
- **Code (CD).** The deciding fact is what code in src/ does, not a comment, README or doc about it.
- **Quantity (QT).** Deciding needs a computation over three or more numbers from different files, often with a unit or rate conversion.

Units also get larger and denser: context 20 to 45 KB in 10 to 20 files (up to 12 small src/ files where code matters), plans 7 to 11 KB, three keyed items per plan in different sections, and two to four true but minor issues per plan that a careful reviewer may flag at Medium.

Candidate kinds, three per stratum. Each is a standard professional review concern, defined here from public practice (WCAG 2.2, semantic versioning and deprecation practice, ordinary migration and capacity practice), not from gstack's skill text:

| Stratum (skill, row) | Kind | Levers | Shape |
|---|---|---|---|
| CEO (plan-ceo-review, R56-5) | C-Q, premise by numbers | H2, QT | The problem is real in the headline, but segment size times share times trend, from three files, shows fixing it can't move the plan's own goal. |
| | C-U2, computed ceiling | H2, QT | The plan tunes the current approach. Its best case, computed from a profile and a goal table, falls short of the plan's own target; a replacement path sits in the context without being flagged as one. |
| | C-OM, missing dated dependency | OM, H2 | Two context documents together make an external date binding (a contract renewal, a platform deprecation, a regulatory start) before the plan's launch, and the plan's sequence never mentions it. |
| Eng (plan-eng-review, R56-2) | E-CD, code contradicts design | CD, H2 | The design relies on a property the code lacks: a retry path that assumes an idempotent handler that writes before it checks, or a cache key that drops the tenant. |
| | E-OM, missing data step | OM, QT | An irreversible schema or data change with no backfill, dual write or rollback, where row counts and write rates in the context make a one-shot change unsafe. |
| | E-Q, capacity | QT, H2 | Traffic from a metrics table, fan-out from code and a limit from a vendor or database document combine to break the plan at one of its own rollout stages. |
| DX (plan-devex-review, R56-6) | X-OM, breaking change with no path | OM, H2 | The plan changes a public contract (a field, default, error code or auth step) with no version, deprecation or migration path, while a usage export and support tickets show integrators depend on it. |
| | X-CD, promise against code | CD, QT | The plan's onboarding promise conflicts with the SDK code: a required setting the quickstart never mentions, or a default timeout below the p95 latency in a metrics file. |
| | X-Q, unreachable time to first success | QT, H2 | The plan's time-to-first-success goal, summed from setup steps, an approval SLA and a provisioning time in three files, can't be met. |
| Design (plan-design-review, R56-7) | G-OM, missing state | OM, QT | The plan designs only the happy path of a screen where context data puts a large share of users in a state the plan never designs: empty, error, partial, offline or permission denied. |
| | G-A11Y, accessibility by computation | H2, QT | The plan's chosen tokens, read from the design-system file, fail a contrast ratio or target size that a customer contract or legal note makes binding. Finding it means computing the ratio from hex values. |
| | G-X, flow conflict | H2, QT | Two screens in the plan conflict with a journey fact in research or analytics: the plan removes a path that a computed share of users takes to reach a goal the plan keeps. |

**Why these should sit below 0.6.** Each kind needs work that v1 and v2 never asked for: deciding to compute something nobody asked to compute, opening and reading code, or noticing an absence where there is no claim to check, and then one more step. That is a hypothesis, not a measurement. We have no reading of plain Opus 5.5 on any of these kinds, and two panels already proved our guesses wrong. So the plan does not trust the table: E0 (section 6) measures each kind on plain Opus before any full authoring, and E1 measures each stratum before any confirmatory prereg.

**Home field.** These kinds overlap passes the skills name (plan-design-review's interaction-state pass, plan-devex-review's upgrade and migration pass). That favours gstack by construction, which is why every confirmatory round carries a lens arm (decision 2) and reports recall per kind, and why no home-field kind is pooled into a general claim.

### 3. Strata, counts and staged authoring

| Material | CEO | Eng | DX | Design | Total | Written |
|---|---|---|---|---|---|---|
| Calibration slice (E0 only) | 6 units | 6 | 6 | 6 | 24 units: 72 candidate items, 24 anchors | first |
| Admission units (E1 only) | 8 | 8 | 8 | 8 | 32 units, 96 items | after E0, only for strata E0 lets through |
| Confirmatory keyed units | 20 | 20 | 20 | 20 | up to 80 units, 240 items | after E1, only for admitted strata |
| Confirmatory decoys | 6 | 6 | 6 | 6 | up to 24 decoys | with the keyed units |

- **Calibration units** carry one item of each of their stratum's three candidate kinds plus one **anchor**: a v2-style one-step item of the same lens. Anchors check the instrument: if plain Opus misses anchors, the judging or the rig is off, not the kinds.
- **Panel units** carry three keyed items from the kinds E0 kept, of at least two kinds where E0 kept two or more, and at most one item of a floor kind (section 6). Decoys hold one bait that looks like a kept kind and that the context justifies, including omission decoys: a step that looks missing and that the context shows is handled elsewhere.
- **Modes and scope.** Units mix greenfield, added capability and fix, as v2 did. DX units are developer-facing products (an API, SDK, CLI or platform), so plan-devex-review's applicability gate passes. Design units plan screens and name UI files, so plan-design-review's scope check and autoplan's UI detection pass. CEO and eng units name no UI file.
- **Exchangeability.** Admission and confirmatory units are not drawn from one pool, because they are written at different times (gate 1, A1 and B1). They share one frozen author kit (spec, kinds, sizes, checker), the same authors and the same audit brief, and the kit's digest is checked before each authoring wave. The confirmatory round keeps its own ceiling stop: a stratum whose none recall reads above 0.6 there makes no claim and is reported as drift.
- **Draws.** Within each wave a script with a public seed spreads units across authors. From the confirmatory units it draws the autoplan subset: 12 keyed units and 4 decoys per admitted stratum. An OS-random permutation numbers the units and stays sealed. Admission units never enter a confirmatory suite.
- **Panel v2's 36 headline units** retire with v1 under GST-618's decision: their kinds saturate plain Opus, so they never serve as held-out material for Opus again.

### 4. Arms and models

All arms run Claude Code with --system-prompt claude-code-preset and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, on the same unit trees, tools and unprivileged user, through review-units on plan units. Every arm runs the same two-turn protocol below (GSTA-2's ruling on GST-925). Every session gets a fresh unit tree, a fresh home and a fresh gstack state root, and the scorer PR adds a test that no gstack learnings, review log or plan state survives from one unit-pass to the next. Arm names below are the scorer's own and carry into ledger item names.

| Arm | Install | Turn 1, verbatim | In |
|---|---|---|---|
| none | none | `Review plan.md for problems.` (E0 at main keeps today's one-turn prompt, section 6) | E0, E1, confirmatory |
| lens | none | `<lens line> Review plan.md for problems.`, where the lens line is the skill's own one-line description, frozen at the prereg; for plan-ceo-review it is `Do a CEO/founder-mode review of this plan.` (the scorer's existing lens arm) | confirmatory |
| gstack | gstack at the pin | `/plan-ceo-review plan.md`, `/plan-eng-review plan.md`, `/plan-devex-review plan.md` or `/plan-design-review plan.md` (installed, invoked by name, no procedure demanded) | E1, confirmatory |
| gstack-forced | the same tree | the gstack arm's line, then the skill's forced sentence naming its Step 0 and its review sections, as #127's forced-line.txt did, with no format words. For plan-ceo-review: `/plan-ceo-review plan.md Run this skill's full procedure: complete Step 0 (Nuclear Scope Challenge + Mode Selection) and state the mode you choose, then Read sections/review-sections.md and write its Review Sections 1 to 10 in order, plus Section 11 or its skip note.` The other three follow the same pattern from their own Step 0 and section names at the pin, frozen verbatim at the E1 prereg | E1, confirmatory |
| gstack-auto | the same tree | `/autoplan plan.md` in an unattended session, phases by autoplan's own scope detection | E1, confirmatory (R56-3) |

**Two-turn protocol** (GSTA-2's ruling on GST-925, 2026-11-02; evidence: GSTA-36 and the gstack Captain's handoffs/GST-925/). Turn 1 is the arm's line above with no format words, so a skill runs its own procedure unconstrained. Once turn 1 ends completed, every arm gets the same fixed turn 2 in the same session:

> List every problem you found in plan.md.
>
> End your reply with one fenced block whose info string is plan-findings. It holds a JSON array with one object per finding, or [] when you have none. Each object has these fields:
> - "severity": Critical, High, Medium or Low
> - "section": the heading in plan.md the finding is about, as written there
> - "line": the line number in plan.md, or null
> - "claim": what is wrong with the plan, in one or two sentences
> - "evidence": what in plan.md or its context shows it
> - "fix": what the plan should change

Its sha256 replaces TOLD_PLAN_SHA256 in every session key. A turn-1 stop is scored by section 5's stop table and gets no turn 2. Turn 2 runs inside the session's allowance with its own limit of 5 turns and 300 seconds. The arms still differ only in install and turn 1, and every arm is scored by the one rule in section 5. The none arm's turn 1 is a plain prompt on the same model, tasks and harness with no gstack, which is Garry's no-gstack rule. Nothing asks for no commits: each unit tree is fresh with no remote, and the rec user declines commit and promote offers.

**Clean room for no-gstack arms (Captain, from another crew's run via FOUN-32).** Garry's user-scope AGENTS.md tells every Capy session to load the user-drive gstack skill, and that run found every run agent tried to read it. So the none and lens arms run only where their agent can see no Capy drive and no gstack install: inside the scorer's docker trial image, as its unprivileged user, with no ~/.capy/drive mount, no ~/.local/share/gstack, no ~/.claude/skills and no .claude/skills in the unit tree, and no AGENTS.md or CLAUDE.md that names gstack. The driving Capy thread never runs a subject session on its own machine. Two checks enforce it. A preflight runs once per none and lens run, in the trial image, before the ledger lease opens (I1). It asserts every one of those paths is absent and otherwise refuses as a usage-class error: exit 2, E_CLEAN_ROOM, the path found and the image digest, a fix line, and no side effects. Nothing was spent, so the rerun after the fix uses the same unopened item and is not a retry to change a verdict. The same assert runs in each container as a backstop; a backstop refusal is a coverage gap that stops the arm, which resumes with review-units --resume --repair on the same item and reuses its scored sessions. check_units.py carries the same path list, so a unit tree that holds one fails at authoring. A frozen read audit then scans every session's transcript, in every arm, for a tool call that touches a gstack skill file (any SKILL.md or sections file under a gstack or .claude/skills path), ~/.local/share/gstack, ~/.capy, or a gstack-* command. A none or lens session that read a gstack skill file makes its arm contaminated for that run: the arm's result reads untested, never "no effect", and the run prints which sessions and paths. In any arm, a read under ~/.capy counts as contamination, because the drive holds sealed material. If a subject session ever has to run on a Capy machine instead of the trial image, an empty directory is bind-mounted over the user and org drives before it starts, and the prereg names that.

"gstack installed with a plain prompt" is read here as the gstack arm above: installed and invoked by name on plan.md, with no format words in turn 1. An untold arm (gstack installed, none's exact words) asks whether gstack routes itself, which is Run D's question, and is not in this plan.

**gstack-auto runs as its own review-units invocation and ledger item** (gate 1, K1), with the same scorer, gstack, Claude Code and image pins as the other arms' run and its own --session-kind unattended, --max-turns 200, --timeout 3600 and allowance (E1's settings; the confirmatory prereg sets the turn cap and timeout from E1's measured p95 x 1.5, C1). Its outside voice is pinned (H1): the arm's environment carries no OpenAI or other non-ledger key and no codex binary, so autoplan's outside voice falls back to a Claude subagent on the same model, metered by the proxy. E1's autoplan gate checks the outside-voice mode from autoplan's own run record, and every autoplan result states it.

**CEO-only autoplan pin** (GST-539, from GSTA-215). An arm that runs /autoplan with --ceo-only pins gstack at v1.93.0.0 or newer (shadow mode, 9d9d4c31bb87): /autoplan --ceo-only landed in v1.92.50.0, and the driver's gstack-autoplan next --ceo-only in v1.92.58.0. Under that pin, open Critical and High findings stay undecided for the owner. The prereg that freezes such an arm, and the E1 prereg for gstack-auto, must say how an undecided Critical or High finding is read when scoring. This plan's reading for the bridge: an undecided finding is an open finding, so it maps to one row at the severity autoplan recorded and counts as must-fix.

**The autoplan findings bridge** (gate 1 J1 and N1; gate 2 K1, L1, P1, Q1, R1 and T1). In an unattended session /autoplan ends at gate_pending and prints GSTACK_RESULT. Its findings live in its run directory, and the main session holds only part of them. One rule, frozen before E1, holds for every arm: **a session is scored from a review record its skill writes when a pinned converter for that record exists and the record validates, and otherwise from its turn-2 block.** Today only autoplan's run directory has a schema (gstack-artifact validate on its run.json) and a converter. So gstack-auto is scored from its run directory first, and every other arm, and any gstack-auto session without a valid run directory, from its turn-2 block. The scorer records which path each session took and prints path rates per model; gstack-auto's turn-2 block is still parsed, and its agreement with the run directory prints as a description.

- **Harvest before cleanup** (R1, T1). A pre-cleanup hook copies the session's autoplan run directory out of GSTACK_STATE_ROOT into the session's record directory under the run root (mode 0700, sealed and deleted with the run), records its sha256 in the session entry and validates it with the pinned gstack's gstack-artifact from the arm tree, all before runTrial deletes the fresh home and state root. The no-carryover test asserts harvest, then wipe. Tests drive gate_pending and cap-stop sessions through the full runReviewUnits and runTrial cleanup.
- **Conversion** (Q1, K1, L1). The pinned converter (its sha256 in the arm record) maps the run's findings, against the original plan, to one plan-findings row per reconciled finding: CONFIRMED and SAME LOCATION pairs and cross-phase restatements collapse to one row at the higher severity. Severity is as autoplan recorded it, with Informational mapped to Low; section from the finding's plan heading or "general"; claim from its title; evidence from its body; fix from its fix. gate_pending counts as a completed review without approval. The same near-duplicate rule applies to every arm's findings before false alarms and unkeyed defects are counted, and false alarms print per autoplan phase. A test passes a mixed Critical, High and Informational export through parsePlanBlock and loses no must-fix finding.
- **Failures** (K1). A missing run directory, or a run.json autoplan wrote that fails the pinned schema, falls back to the turn-2 block, and with no block the session is a miss. A converter crash, a run-directory sha that does not match the arm record, or a validator other than the pinned one is a coverage gap with its own code (E_BRIDGE_CONVERT), and the harvested run directory is kept so the pinned converter can rerun at no spend.
- The gstack-auto PR proves one session end to end with the real pinned SDK and a stub CLI before /ship, and E1 proves it on real sessions.

**Models.** claude-opus-5-5 is primary and decides admission. GPT-6.1 Sol runs inside Claude Code through OpenRouter's Anthropic-compatible endpoint, as Run D routes it, under the subject id openai/gpt-6.1-sol (the judge keeps the id gpt-6.1-sol on the OpenAI route; both name one model, and every post says so). particle-ai/particle-1 on OpenRouter is the low-cost primary. Each model gets its own row and verdict; no model stands in for another. Sol rows answer "gstack in Claude Code on Sol", not gstack as a Codex user runs it; a Codex-host row waits for the HARN-13 adapters.

**Route check** (M1, P1, S1), E1's first paid step, for Sol and for particle-1. Three parts per model: a session whose tool call gets its result back; a session that ends with a parsed plan-findings block; and metering, where every call in both sessions has a known outcome with its spend and reasoning tokens recorded and the session's metered spend is within 10% of OpenRouter's billed generation cost. The script exits 0 on pass, 1 on a route failure and 2 on a usage error or an infrastructure stop. Failures carry stable codes added to src/errors/codes.ts with doc anchors (E_ROUTE_TOOL_ROUNDTRIP, E_ROUTE_NO_BLOCK, E_ROUTE_METERING, and E_ROUTE_INFRA for an endpoint, credential or proxy failure, which is not a compatibility refusal). stderr names the endpoint, model id, Claude Code version and the proxy's error body with secrets stripped. Spend lands on the model's e1-route item. At most two tries per part; between them only a named repair from a frozen list (an OpenRouter provider pin, a raised output allowance). A model that fails twice leaves E1, and the results name the code. That failure, not an assumption, is the only accepted reason to leave Sol out.

Per code (G1):

| Code | Exit | Uses a try | Fix line, printed last on stderr | Side effects |
|---|---|---|---|---|
| E_ROUTE_TOOL_ROUNDTRIP | 1 | yes | apply a named repair from the frozen list (an OpenRouter provider pin), then rerun the part | spend on e1-route-<model> |
| E_ROUTE_NO_BLOCK | 1 | yes | raise the output allowance (frozen list), then rerun the part | spend on e1-route-<model> |
| E_ROUTE_METERING | 1 | yes | reconcile e1-route-<model> against OpenRouter's billed generation cost, then rerun | spend, and a ledger reconcile row written before any retry |
| E_ROUTE_INFRA | 2 | no | check the endpoint, credential or proxy named above, then rerun | spend if a call went out; two infra failures stop the check for the Captain, and the model stays in |

E_ROUTE_INFRA exits 2, as E_COVERAGE_GAP does in review-units, and never 1, because it is not a compatibility failure; the code on stderr's first line tells it from a usage error, which also exits 2. **Size** (H1). The check is `bin/gstack-evals route-check --model <id> --unit <fixture> --item e1-route-<model> --out <dir>` on a public fixture plan unit from tests/, never a sealed one: two sessions per try (the tool round trip and the block; metering reads both) and at most two tries. Its cap covers every allowed session at full allowance: Sol 4 x $3.84 = $15.36, particle-1 4 x $0.19 = $0.77. A cap stop leaves the check incomplete: the model is neither passed nor failed, does not enter batch 2, and comes back to the Captain.

**Models freeze at each prereg.** A frontier model released mid-program enters at the next prereg, never mid-run, as the OpenRouter ranking rule already works.

### 5. The scoring rule, written before code

**Base rule, from #127.** Each session's findings come from its turn-2 plan-findings block, or from a validated review record under the one rule in section 4 (today, gstack-auto's run directory), parsed by the pinned parser. Critical and High are must-fix. An item's value for an arm is the share of the arm's passes in which some must-fix finding matched it; must-fix recall R is the mean over items, per stratum. Any-severity recall prints beside it.

**Stops, per arm** (L1, O1). Frozen before the scorer PR is coded, and tested on fixtures in its keyless tests:

| Termination | none | lens, gstack, gstack-forced | gstack-auto |
|---|---|---|---|
| Model output, then the arm's own failure, or turn 2 ends with no block | a miss (as run.ts:211 does today; particle-1's missing-block rule is the one exception) | a miss | run directory, else turn-2 block, else a miss |
| Turn cap or allowance stop, in either turn | E0 and E1: that session's reading drops, and the stratum reads NO READ when stops pass 5% of its none sessions. Confirmatory: a miss, counted; above 5% of the arm's sessions the comparison reads NO READ | a miss; for gstack-forced it also counts as not running the procedure | run directory on what it holds, else a miss; counts as not running autoplan |
| Wall-clock timeout after model output, in either turn (C1, J1) | as a turn cap | as a turn cap | as a turn cap; more than 2 of 16 Opus timeouts or turn caps in E1 read FIX-METHOD on the rig, not an autoplan miss |
| Infrastructure failure, or nothing before the end, including a timeout before any model output (C1) | coverage gap: the arm stops with E_COVERAGE_GAP | the same | the same |
| Read audit finds contamination (section 4), or the gstack arm's exposure is below its bar (section 6) | the arm's result is untested | the same | the same |
| Run-item cap stop (ledger) | incomplete run: NO READ for every reading that item feeds; never retried to change a verdict | the same | the same |

A block written before a stop counts. A plan-session timeout is recorded as its own termination (J1). After model output it scores as a turn cap; before any model output it stays a coverage gap, as main does today (run.ts:40-43, 211 and 484) and as C1 accepted. For gstack-auto, a harvested run directory with at least one bound voice counts as model output, so a long autoplan session that did work is scored from its run directory, not stopped as a gap. Every reading prints stops per arm and per kind.

**Untested arms** (N1, and GSTA-2's ruling on GST-925). A contaminated arm, or a gstack arm below its exposure bar, ends with a stable code (E_ARM_CONTAMINATED from review-units' read audit, E_ARM_UNEXPOSED from the readings script, both added to src/errors/codes.ts with doc anchors), exit 4, and an arm record marked untested with the reason, which admission-v3.ts, judge-join and the secondaries refuse to score. The run prints the observed reads with home and unit paths replaced, and the arm's paid spend. Every reading that depends on the arm is invalidated. A new run needs a named repair and a separately approved item; it is never a retry to change a verdict. Lifting the --plan refusal at cli.ts:227 changes CAPPED_PARSER_SHA256, so plan sessions cached before the scorer PR are not reused.

**Judge brief v3** keeps #127's three paragraphs (H-X, H-F and H-T; decision items) and adds three:

1. **Omission (OM).** A finding matches when it names the specific missing step for the specific object (the table, endpoint, screen state or date) and either the context fact that makes the step required or the concrete consequence of leaving it out. "Add a rollback plan", "consider accessibility" or "think about migration" does not match.
2. **Two hops and quantities (H2, QT).** A finding matches when it states the conclusion and the deciding fact or number it rests on (for example "the 12k requests a minute at stage 3 exceeds the vendor's 10k limit"). A right conclusion with a wrong reason does not match. Arithmetic need not be exact; the deciding comparison must be right.
3. **Code (CD).** A finding matches when it names the code behavior (file, function or the behavior itself) that breaks the plan's assumption. "Verify the handler is idempotent" without saying it isn't does not match.

**Judges** (Q1). Judges see only the parsed findings, blind to arm and model and shuffled, never the procedure text around them. The first judge is chosen by the subject's family, as policy/models.json already does: Opus 5.5 first on Sol rows, GPT-6.1 Sol first on Opus and particle-1 rows. In E0 and every confirmatory round the second judge reads every must-fix match and every blocker; in E1 it reads every arm disagreement plus a seeded 20% sample, as #127 did. Sonnet 5.5 is third where the first two differ. Adjudication packets for unkeyed findings carry plan.md and the context files the finding cites, so a judge can rule a finding real or not.

**Judge reliability** (I1). Matching kappa between the first two judges is read pooled per stratum (36 or more blockers), not per kind, where 12 readings make kappa unstable. E0's matching kappa may revise the brief on burned calibration material; its adjudication kappa is descriptive only, because none raises about 0.44 unkeyed findings per plan per pass, about 5 per stratum in E0 (B1). E1's reading, on fresh units, binds: a stratum whose E1 matching kappa, or adjudication kappa on unkeyed findings from all arms (gstack-auto included; about 30 per stratum on Opus), is under 0.6 does not enter a confirmatory prereg until the brief is revised on E1's burned units and re-read. If adjudication kappa on unkeyed findings is under 0.6 in a confirmatory round, the precision guard reads NO READ, recall alone can't earn KEEP, and the comparison's verdict is FIX-METHOD on judging.

**Precision guard (confirmatory).** Recall can be bought by flagging everything. A recall win counts only when the arm's must-fix findings that blind adjudication rules not a defect, per plan per pass, exceed none's by no more than 0.5 (the margin the Captain ruled for R1a's false-alarm gate) at a one-sided 95% upper bound. Decoy baits flagged must-fix print per arm. A gain that fails the guard reads "recall bought with false alarms" and earns no KEEP.

**Preregistered secondaries** (E1, F1), each with its interval and no test: (a) cost ladder: recall of one gstack-forced pass against the union of none's two passes, and of gstack-auto against unions of 1 to k none passes on the autoplan subset, where k none passes cost what one gstack-auto session costs for that model by E1's measured means (E1 of gate 2). The matching rule and k freeze in the confirmatory prereg before any confirmatory outcome, and its session counts, judging projections and caps are regenerated from k; section 7's c-ladder rows are placeholders at k = 6. The precision guard applies to each union, so a skill that only matches plain resampling at the same spend is visible; (b) recall per dollar per arm; (c) adjudicated unkeyed must-fix defects per plan per pass, arm minus none, the one lift-shaped signal #131 saw (1.44 and 1.63 against 0.44), read only when adjudication kappa is at least 0.6.

**The attack, and what changed.** Each line is an attack on the rule above and the answer now in it.

| Attack | Answer |
|---|---|
| A verbose arm (forced or autoplan) flags everything and matches by volume. | Must-fix only, the specificity rules, the precision guard and decoys. Findings per session print per arm. No cap on findings, which would punish thorough review. |
| Checklist text matches omission items generically. | OM matching needs the specific object and the requiring fact or consequence. The judge brief carries paired examples written on calibration material, never on panel items. |
| A judge credits a right conclusion reached by luck. | H2 and QT need the deciding fact. A wrong reason does not match. |
| Judges disagree on the new kinds (v2's adjudication kappa was 0.38). | Two judges on every match in E0 and confirmatory rounds; kappa pooled per stratum; E1's kappa gates entry to a confirmatory prereg; a guard under 0.6 fails closed. |
| One judge family decides most matches, including its own model's rows. | First judge by subject family; a second judge on every match where it decides a claim. |
| Kinds chosen where Opus fails are unfair, not hard. | Every item passes a keyed audit. A kind no session finds goes to a blind re-audit before it can stay (section 6). |
| Selecting kinds on the control model biases the comparison. | E0 runs the none arm only, so the screen never sees a gstack reading. Items are fresh after the screen. The posts state that headroom was engineered and the result does not generalise to average plans. |
| A turn cap or timeout ends a long session and scores a silent miss. | The stop table above, with its own timeout row; E0 reads terminations from the session record because it runs before the scorer change (section 6). |
| The panel's format request stops a skill's procedure (GST-925). | The two-turn protocol: no arm's turn 1 carries format words, and one fixed turn 2 asks every arm for the block. The gstack arm's exposure is read, and an arm below its bar is untested. |
| A short turn-2 sign-off drops findings autoplan's run directory holds. | The one scoring rule in section 4 scores the validated run directory first. |
| particle-1 leaves no findings block (5 of 12 R1a sessions). | A none session with output and no block is a miss, as the stop table says. A model whose none arm misses the block in more than 10% of sessions gets NO READ for that stratum, reported with the rate. |
| A no-gstack arm reads gstack anyway (another crew's run: agents told by a user-scope AGENTS.md to load the drive skill). | none and lens run in the trial image with no drive, no gstack install and no skills directory, behind a preflight; a read audit marks any no-gstack arm that read a gstack skill file contaminated, so its result reads untested, never "no effect". |
| Home-field kinds inflate the skill. | The lens arm, per-kind recall, and no pooling of home-field kinds into a general claim. |
| An unpowered lens comparison is read as "the skill adds nothing". | forced minus lens is a secondary. Its R48 reading says "the lens does the work" only when the 95% interval's upper bound is under 10 points; otherwise it reads inconclusive. |

### 6. Experiments

**E0, the kind screen (Opus 5.5, none only).** 24 calibration units, 2 passes, plain prompt, on the scorer at main (the none arm needs no new code). E0 keeps today's one-turn none prompt (`Review this plan for problems.` and the frozen template), because E0 is only a screen that routes kinds, and admission is read on E1's none arm under the two-turn protocol (GSTA-2's ruling on GST-925); particle-1's none arm runs beside it, descriptive only. Because main scores plan-unit turn-cap and allowance stops as silent misses (R1), E0's readings script reads each session's termination from its session record (transcript result subtype and the allowance stop), counts a stopped session as NO READ for its readings, prints stops per kind, and reads E0 NO READ when stops pass 5% of sessions. Rules, frozen in E0's prereg with an operating-characteristic table for them:

- **Validity.** Anchor recall at least 0.85, or E0 reads NO READ (the rig or judging is off).
- **Per kind** (6 items x 2 passes = 12 readings; D1): KEEP at 1 to 7 of 12; DROP-CEILING at 8 or more; DEAD at 0.
- **DEAD kinds** (C1). A none score of 0 says nothing about lift. A fresh auditor from another family, holding the key but not E0's readings, re-audits the kind's items for findability, must-fix and signposting. A kind that passes stays as KEEP-FLOOR: flagged, at most one floor item per panel unit. One that fails is dropped as unfair.
- **Per stratum.** Two or three kept kinds: author the stratum's admission units from them. One: author from it alone, flagged. None: the stratum is not built; its R56 row goes back to the Captain with R48 FIX-METHOD.
- **Also read:** none's median session cost and turns on v3-size units (this prices E1), particle-1's missing-block rate, and matching kappa per stratum.
- Calibration units never become panel material, and stay sealed until the confirmatory rounds end.

**E1, the admission pilot.** 8 admission units per stratum, three items each. Each model's arms run as separate items (T1): a none run at 2 passes and a gstack plus gstack-forced run at 1 pass, so no run mixes pass counts, and the readings join them by unit. Each stratum is its own run and item as well (F1, U1), because --plan sets one lens per review-units invocation (cli.ts:136) and a line item funds one run (E_ITEM_BOUND). Items are named by stage, model, arm group and stratum, for example e1-opus-none-eng, and so are e1-auto-*, c-auto-* and c-ladder-*. Batch 1: Opus on every stratum E0 let through, gstack-auto on 4 units per such stratum (1 pass), and the route checks. Batch 2 starts only after batch 1 is judged: Sol and particle-1, same layout, on the strata Opus admitted, and gstack-auto on 8 units each, spread evenly over those strata by the public seed. The dry run tests the exact schedule and its judging join, and opens and settles one lease per run.

- **Panel, per stratum, read on Opus's none arm.** ADMIT when 0.2 <= R <= 0.6 and power >= 0.80 for a 20-point gain in the confirmatory design (20 plans x 3 items, 2 passes, alpha 0.025, dependence 0.3; the noloss simulator gives 87% to 92% across the band, so power never binds inside it). NOT ADMITTED (ceiling) above 0.6, (floor) below 0.2. NO READ on a none coverage gap, on none stops (turn cap, allowance or timeout) above 5% of its sessions, on incomplete judging, a failed system-prompt check or an item cap stop, each as section 5's stop table says; that table is the only rule (O1), and admission-v3.ts gets a keyless fixture per row. A none session with output and no block is a miss; particle-1's missing-block rule is the one exception. Flags F1 (any-severity recall above 0.6), F2 (4 or more of 24 items matched by no session) and F3 per kind (a kind at 0 or 1, or above 0.85) print with every verdict and trigger a Why-null cycle.
- **Other models.** Sol and particle-1 read the same band on their own none arms. Above 0.6, that model's row in that stratum is dropped from the confirmatory round (no room for lift). Below 0.2, the row stays with a floor flag, because lift from a floor is measurable.
- **Procedure, per skill and model.** READY when gstack-forced ran the procedure in at least 7 of 8 sessions; FIX-METHOD otherwise. "Ran" follows #127's exposure rule per skill: a successful read of the skill's review-sections.md or of its checklist.md runner profile (each skill at the pin ships both, and unattended or light runs read the checklist), its Step 0 marker, and the numbered sections or passes of whichever file it read as heading-like lines whose first appearances form an increasing run covering at least 90% of them (plan-ceo-review 10 sections, plan-eng-review 4, plan-devex-review 8 passes, plan-design-review 7 passes, all re-read at the gstack pin). The gstack arm's exposure (GSTA-2's ruling on GST-925) uses the same reads: the skill's review sections or checklist and its Step 0 marker, and for plan-ceo-review a named mode. It is the share of sessions that show them. An arm below the bar the E1 prereg freezes (GST-925 used 6 of 8) is untested (section 5), never a "no effect" reading, in E1 and in every confirmatory round.
- **The plain-invocation defect** (G1, closed by GST-925). Plain /plan-ceo-review skipped its own procedure in 16 of 16 sessions (#131). The gstack Captain found the cause in the panel, not the skill (GSTA-36): the one-turn template's format request. GST-925 changed no template and shipped no gstack version, so there is no fix to wait for. Every gstack arm runs the gstack release the E1 prereg pins (at or above the ship policy's floor), the two-turn protocol removes the cause, and the gstack arm's exposure shows whether it worked.
- **Autoplan.** E1 runs 4 Opus gstack-auto sessions per stratum E0 let through, so n is 16, 12, 8 or 4 for four, three, two or one strata (M1). READY needs seven-eighths of n, rounded up (14 of 16, 11 of 12, 7 of 8 or 4 of 4), sessions in which autoplan loaded the review skill of every phase its own scope detection chose (read from its run record), wrote each phase's findings in order with Eng last, and the session produced scorable findings from its run directory or its turn-2 block. Its scope choices print against the unit's stratum, since autoplan's detector may add DX to eng units. The dry run drives every case and reconciles its caps. E1 reports gstack-auto's wall clock and turns per session, which set the confirmatory turn cap and timeout (C1), and its mean cost, at an upper bound, prices the confirmatory round (S1).

**How often the band admits** (8 plans x 3 items, 2 passes, beta-spread item rates, dependence 0.3, 20,000 simulated pilots per row, #127's admit-oc.py with v3's clusters):

| True plain recall | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 |
|---|---|---|---|---|---|---|---|---|
| Admitted | 4% | 49% | 91% | 98% | 86% | 47% | 8% | 0.3% |

This is sharper than v2's band (19% at 0.7). The confirmatory round keeps its own ceiling stop.

**Confirmatory rounds** (one prereg each, or one prereg with separate families, decided then). Per admitted stratum: none, lens, gstack and gstack-forced on 20 keyed units and 6 decoys, 2 passes, on each admitted model.

- **Primary, per model:** gstack-forced minus none and gstack minus none on must-fix recall, Holm across the two at family alpha 0.05 (strictest step 0.025), plan-clustered sign-flip test with its interval. Power at 20 points: 87% to 92%; MDD at 80% about 18 points. Recall prints per kind.
- **Secondary:** forced minus lens, and the secondaries in section 5.
- **Autoplan (R56-3):** gstack-auto minus none on the autoplan subset (12 keyed units and 4 decoys per admitted stratum, 1 pass per model), pooled over strata, alpha 0.05 per model. Over four strata (48 plans) power is 83% to 92% at 15 points, so the MDD is about 14 points; over two strata (24 plans) it is about 20. Per-stratum rows and gstack-auto minus gstack-forced are descriptive.
- Every verdict prints exposure rates, stops, the precision guard and per-kind recall, and every null gets one R48 Why-null cycle ending in KEEP, FIX-METHOD or CUT-CANDIDATE.

Power runs used the pinned noloss simulator (bin/gstack-evals noloss power, dependence 0.3, 2,000 sims, seed 1). Per stratum at alpha 0.025: 20 plans x 3 items at 2 passes gives 0.918, 0.866 and 0.914 at R = 0.2, 0.4 and 0.6 for 20 points; 16 x 3 at 3 passes gives 0.948, 0.911 and 0.948. Autoplan at alpha 0.05, 1 pass: 48 x 3 gives 0.922, 0.831 and 0.872 at 15 points; 24 x 3 gives 0.768, 0.699 and 0.765 at 18 points.

### 7. Price and caps

_Internal planning record: these budget and cost figures are plans and caps, not findings._

**Per-session projections (USD).** Opus: #131's per-arm means scaled by 2.5 for v3's larger units, so none $0.33, lens $0.33, gstack $0.82, gstack-forced $1.43; gstack-auto $6.00 (never metered; about three forced-review phases plus subagent voices). Sol: the same as Opus per session (Run D's working assumption: half the token price, more output). particle-1: a quarter of Opus; gstack-auto $1.50. Judging: $0.10 a session in E0, $0.15 in E1 and the confirmatory skill rounds (a second judge on every match, and adjudication packets that carry context); c-auto-judge is re-priced from E1's measured findings per gstack-auto session (Q1).

**Turn 2** (section 4) adds one request over the session's context plus the block, priced by the same per-session rule:

| Turn 2, per session | Tokens (input, output) | Opus | Sol | particle-1 |
|---|---|---|---|---|
| none, lens, gstack, gstack-forced | about 18k and 4k | $0.15 | $0.15 | $0.04 |
| gstack-auto | about 55k and 4k | $0.30 | $0.30 | $0.08 |

E0 runs at main with one turn and carries none of it; every later row below includes it. These are guesses scaled from one measured run. E0 measures none on v3 units and E1 measures every arm, turn 2 included, and each later prereg re-prices from them before it spends (G and K of gate 1): an item's projection is the bootstrap 90% upper bound of the mean session cost per arm and model, before the 1.4 slack and the reserve, and the median prints beside it as a description (S1).

**Cap rule** (U1). An item's cap is 1.4 x its projection plus its reserve, and the reserve is the largest batch the scheduler admits at once (the larger of --parallel and the arms a unit runs together) times the worst-case allowance per session. review-units admits a batch only while spend so far plus the batch's worst case fits the cap, so this starts the last batch whenever real spend stays within 1.4 times the projection. Allowances: Opus $7.04 (1.6M input, 32k output), Sol $3.84 (output raised to 64k for reasoning), particle-1 $0.19. gstack-auto items raise theirs to 5M input and 200k output (Opus $24.00, Sol $12.00, particle-1 $0.70) at --parallel 2. Because gstack-auto's cost is unmeasured, E1's gstack-auto items are capped at every session's full allowance, so every planned session is admitted even at its worst case. Judge items are capped at 1.4 x projection. A cap stop is an incomplete run and is never retried to change a verdict.

| Experiment | Items (one per run) | Paid sessions | Projected | Caps |
|---|---|---|---|---|
| E0 kind screen | e0-opus-none, e0-particle-none, e0-judge | 96 | $29.40 | $62.86 |
| E1 batch 1 (Opus, gstack-auto, route checks) | e1-opus-none-<stratum>, e1-opus-skill-<stratum>, e1-auto-opus-<stratum>, e1-route-sol, e1-route-particle, e1-judge-b1 | 152 | $237.12 | $756.57 |
| E1 batch 2 (Sol, particle-1; worst case, every stratum admitted) | e1-{sol,particle}-none-<stratum>, e1-{sol,particle}-skill-<stratum>, e1-auto-{sol,particle}-<stratum>, e1-judge-b2 | 272 | $244.20 | $452.04 |
| **E1 pilot total** | | **424** | **$481.32** | **$1,208.61** |
| Confirmatory, per stratum (Opus, Sol, particle-1; 4 arms) | c-opus, c-sol, c-particle, c-judge | 624 | $504.27 | $750.27 |
| Confirmatory, autoplan (3 models, plus the cost ladder at the k = 6 placeholder) | c-auto-{opus,sol,particle}-<stratum>, c-ladder-{opus,sol,particle}-<stratum>, c-auto-judge | 960 | $1,279.68 | $2,218.04 |
| **Whole program, every stratum admitted** | | | **$3,807.48** | **$6,490.59** |

The binding batch per run, for example: e1-opus-none-eng (16 sessions at --parallel 3) has $10.08 spent before its last batch at 1.4 x projection, plus $21.12 reserved, = $31.20 under a $31.87 cap; c-opus (4 arms a unit) has $250.61 plus $28.16 = $278.77 under $283.69; each e1-auto-opus-<stratum> is capped at 4 x $24.00 = $96.00. The full table is price3.py and its output, attached to this post. The E1 prereg's dry run opens and settles one ledger lease per run on a temporary ledger at these real caps and tests that the last four-arm batch at --parallel 3 is admitted when prior spend is 1.4 times projection, the lesson R2 and Run D both paid for.

**No one thread passes $5,000.** E0, E1 and each confirmatory round run in their own threads under their own Captain caps (R42). The whole program at caps is $6,491, so the Captain gives Garry a heads-up before the confirmatory preregs, and again if a re-price moves any one thread near $5,000.

**Cap changes at gate 2**, recorded with their reasons under Garry's program approval (approvals/2026-11-02-panel-v3-program.md). One run and item per stratum (F1, U1) adds a reserve per run, which raised E1 from $939.28 to $1,148.14 and the autoplan round from $1,716.72 to $2,036.57; the route checks sized at every try (H1) are inside the E1 figure. Turn 2 (GSTA-2's ruling on GST-925) then raises E1 to $1,208.61, each stratum's confirmatory round from $651.99 to $750.27 and the autoplan round to $2,218.04. Projections rise only by turn 2. The program at caps moves from $5,326.82 to $6,490.59.

**Build cost.** Authoring and audit run on Capy subagents at about 1.2M tokens a unit to author and 0.4M to audit (v2 ran about 0.75M and 0.25M on smaller units): about 40M tokens for the calibration slice, 50M for the admission units and up to 170M for confirmatory units. The scorer PR (C1) is code class, about 40M to build and 120M or more for its /ship, because it carries stop and contamination scoring (the crew's lesson from #101, #106 and #107); the gstack-auto PR (C2) is about 20M to build and 60M for its /ship (D1). Each prereg's light /ship is 20M to 35M. At this thread's measured rate (about $0.39 per million tokens, 1 credit = $0.001) that is roughly $225 to $255, with Gemini authors possibly priced differently; the build threads report their own meters.

### 8. Custody and held-out rules

- **Nothing sealed reaches the repo.** Commits carry counts by stratum and kind, panel-wide size ranges, and bundle, suite and kit digests. Never a per-unit row: no unit head, tree digest, byte count, file count or key digest beside any stratum, kind, decoy or admission label, on any commit on any branch. GST-618's lesson is that a fix-forward can't help: GitHub keeps every pushed commit at refs/pull/N, and a per-unit row once pushed costs a re-mint or a support purge (#99's 4bf9761 named strata through unique plan sizes; #127's dry-run transcript named admission unit numbers through packet file names).
- **Leak checks.** Every published transcript replaces packet file names before printing (#127's fix). A leak check over every unit id, head, base, permuted number and blocker line runs on every attachment before commit, and gstack-pregate sealed runs on every push range under set -o pipefail.
- **Plaintext.** Authors and auditors work on fresh machines under ~/.capy/work, blind to gstack, the repo and earlier panels, and report ids, kinds and counts only. Files move between machines by file transfer, never by message. Plaintext is deleted after sealing and checked with test ! -e.
- **Seal.** age to a new v3 recipient, with its identity beside the v1 and v2 key in the gstack-evals x Garry project-user drive, so a later release of one panel never touches another. Each wave (calibration, admission, each stratum's confirmatory units) is its own bundle, in the Captain drive under the build thread's handoffs/<code>/sealed/ with CUSTODY.md.
- **Openings.** Decrypt only into RAM-backed /dev/shm, under a live program for dry runs, and log every opening and closing in CUSTODY.md. The scorer refuses an --out under /dev/shm (E_RECEIPTS_VOLATILE), so a paid run's root and the retained unit trees sit in mode-0700 directories on disk and are sealed and deleted right after the last read (#131's lesson). Paid runs run detached on the waiting agent's own machine and are attached on a timer (the 6-hour operation limit). On every wake, check /dev/shm and ~/.capy/work for leftovers before anything else.
- **Backups** exclude the public trial image and gstack install trees (the drive refuses files over 100 MB). exposure.py's --tsv is an output path and never points at a run file.
- **Who may open:** the build thread, the runner the Captain names and a custodian. **Who must not:** the gstack Captain, any thread that builds a gstack candidate under test, and the panel's authors and auditors after sealing.

### 9. Which R56 rows it serves

| Row | Part | Served by |
|---|---|---|
| R56-2 | plan-eng-review | the eng stratum: E0 kinds, E1 admission and procedure gate, its confirmatory round |
| R56-3 | autoplan | the autoplan arm: E1 run gate and cost, the pooled confirmatory round over admitted strata |
| R56-5 | plan-ceo-review | the CEO stratum, rebuilt with harder kinds (#131's FIX-METHOD) |
| R56-6 | plan-devex-review | the DX stratum |
| R56-7 | plan-design-review | the design stratum |

A stratum E0 or E1 refuses returns its row to the Captain with an R48 FIX-METHOD and the reading, rather than a test on a panel with no room.

### 10. Build sequence and reuse

Each step is its own thread unless noted, with rough target dates that move with the reads. Nothing here runs in this thread.

1. **This plan** merges as a docs-class wiki post (wiki/plans/, one reviewer, one round). Target 2026-11-03.
2. **Author kit v3 and the calibration slice** (thread A). Reuse #127's author-spec.md, check_units.py and echo-terms.txt. Add the four levers, the twelve kinds, anchors, larger unit sizes, omission decoys, and echo terms from the heading words of plan-eng-review, plan-devex-review, plan-design-review and autoplan's phases at the pin. Freeze the kit and record its digest. Author the 24 calibration units on four google/gemini-4-argon subagents (R38: a family not under test, decision 4), each writing for two strata; audit with one anthropic/claude-opus-5-5 and one openai/gpt-6.1-sol auditor holding the key; seal. About 40M tokens. Target 2026-11-04.
3. **E0 prereg and run** (thread B). A docs-class prereg with judge brief v3, the kind rules and their operating-characteristic table, the termination read, the leak check and a dry run on the real sealed calibration suites; Captain cap $62.86; then the run, judging and a results post with R48 and a registry line. Target 2026-11-05.
4. **Scorer PRs** (thread C, starting now beside A and B, D1; code class, full /ship). Lens rows are one entry each, so C adds all four strata's lenses, or lands them as the last commit before review binds. C1, the scorer PR, carries (a), (b), (d), (e), (f), (g) and (h) and budgets 120M or more for /ship. C2, the gstack-auto PR, carries (c), so a review loop there can't hold R56-2, -5, -6 and -7. In src/trial/review: (a) PLAN_LENSES gains the four strata's lenses (skill, command, lens line); (b) the rec user's decline rule (OTHER_SKILL) becomes lens-aware, because today it declines any question naming "eng review", "design review", "devex review" or "autoplan", which would fail the new lenses' own questions; this changes REC_USER_SHA256 and so every plan session key, CEO included, and the PR lists it under Behavior changes (v2's sessions reproduce only at a5633c6), and (GSTA-2's ruling on GST-925) recAnswer answers a mode or Step 0 question with the recommendation before OTHER_SKILL runs, so a mode question that mentions /ship is no longer declined, with a keyless test on the gstack Captain's question text from GST-925 and the same change in src/trial/review/README.md, the only other copy in the code; (c) GST-537's gstack-auto placeholder becomes the full /autoplan arm, GSTACK_AUTO.min_version set to the pinned release, with the findings bridge, its converter, the pre-cleanup harvest hook and E_BRIDGE_CONVERT (section 4); (d) plan-unit stops follow section 5's table, ported from #124's code-unit fix; (e) policy/models.json gains openai/gpt-6.1-sol on the openrouter route as a subject, and the route-check script with its error codes. (f) the clean-room preflight before the lease with its container backstop, and the frozen read audit with E_ARM_CONTAMINATED (sections 4 and 5), with fixtures for a clean session, a drive read and a skill read; (g) the two-turn protocol (section 4): a follow-up turn after turn 1 completes, its own turn and time limits, the turn-2 text's sha256 in every session key, and a fixture per stop before and during turn 2; (h) plan-session timeouts as their own termination (section 5). Each change is tested against the real pinned Claude Code SDK with a stub CLI before /ship (the #101 and #106 lesson), including one gstack-auto session end to end, the scope gates of plan-eng-review and plan-design-review (which pass because turn 1 names plan.md) and the no-carryover check. Targets: C1 2026-11-08, C2 2026-11-09.
5. **Admission units** (thread A again or a successor, parallel with 4). 8 units per stratum E0 let through, same kit, authors and audit; sealed as their own bundle. About 50M tokens.
6. **E1 prereg** (thread D, after 4 and 5). Freezes the gstack pin (GST-925 shipped no gstack fix, GSTA-36), the turn-1 lines and the turn-2 text with its sha256, forced lines per skill, the gstack arm's exposure bar, exposure rules per skill and for gstack-auto, the bridge converter's digest, admission-v3.ts (per stratum, per model, per kind), every cap in section 7, and exact copy-paste review-units commands for every item. Its dry run drives each frozen rule, the 2/1/1 schedule and its judging join, and opens and settles one lease per run on a temporary ledger at the real caps. It has JSON attachments, so budget about 35M for /ship and get the frozen numbers reviewed adversarially before the sealed dry run.
7. **E1 run** (thread E): route checks, batch 1, judging, batch 2, readings, results post with R48 per stratum and model, a registry line per stratum. Target 2026-11-11.
8. **Confirmatory units** for admitted strata (thread A or successor), then **confirmatory preregs**, one per admitted R56 row (or one with separate families), priced from E1's means at an upper bound (S1).

**Reused as is:** review-units plan units (#101, #106, #123, #126) with --told-prefix forced arms, the lens arm, claude-code-preset and --session-kind; noloss judge-packet, judge-run, judge-join, ingest, secondary and power; #127's admission.ts, exposure.py, admit-oc.py, power-grid.sh, seal.py, build-v2.sh, convert-v2.py, gen-synth.py and dryrun.ts as the starting point of each v3 script; the ledger record shape of ledger/planning-v2 (one item per run and per judge stage, recorded --admission warn while the rig has no green admit); GEVA-115's CUSTODY.md layout and round-trip check.

### 11. Not in scope

- Writing any panel item, any paid call, and any code change.
- An untold gstack arm (Run D's question) and a placebo arm (Run T measured the text tax on particle-1).
- A Codex-host Sol row (HARN-13's adapters).
- An external-validity slice of natural plans with known later defects. A later plan can add one; until then every post states that v3's headroom is engineered.
- Publishing panel v1 or v2 (GST-618's go-public checklist).
- Haiku 5.5 and Sonnet 5.5 as models under test (R54). Sonnet stays the third judge.

### 12. Risks

- **A third ceiling.** E0 catches it for about $29 before any panel unit is written. If every kind saturates, the next move is new levers (code-heavy units, larger repos), not more of the same.
- **A floor.** Kinds that are unfair rather than hard: the keyed audit, the DEAD-kind re-audit and F2 guard it.
- **Autoplan inside the harness.** /autoplan has never run under review-units. The bridge, the scorer PR's end-to-end test and E1's autoplan gate test that; a FIX-METHOD there leaves R56-3 open without blocking the four skill rows.
- **Sol's route.** Unmeasured until E1's route check (Run D's check had not run at this writing).
- **Cost guesses.** The 2.5x scaling, gstack-auto's $6 and turn 2's cost are guesses. E0 and E1 replace them with measured means, priced at an upper bound, before any later cap.
- **The two-turn protocol is new.** It moves every arm alike, but its mechanics are untested: the scorer PR tests it on the real pinned SDK, and E1 prints turn-2 failures and costs per arm.
- **Drift between waves.** Admission and confirmatory units are written days apart. The frozen kit, its digest check and the confirmatory ceiling stop catch drift; a stratum that drifts makes no claim.

## Review record

The run's export is attached as review-record.md, with em dashes replaced by hyphens. /autoplan run ap-20261102033957 reviewed the Implementation plan section in two rounds of three phases (CEO, DX, Eng), each with an Opus 5.5 native voice and a GPT-6.1 Sol outside voice, all as Capy subagents. Round 1 ran in GEVA-157 on gstack 1.92.53.0 and round 2 in GEVA-165 on gstack 1.92.56.0, one voice at a time (about 14M tokens for round 2's six voices). Round 2 ended at the round cap with 21 Highs open, so gstack printed ESCALATE and the decision went to Garry at gate 2. One cross-family carry check read the delta written after the cap. The run status is complete, and gstack-artifact validate prints ARTIFACT_VALID.

Reviewed snapshots: round 2 read 043de7067ce17621d6d7d8c94f600fac0b078b266a0729d4de6ff86af0fa717b. The approved Implementation plan above is bb0c3bdbef9e7ac1cc882a6c04036e8b554bb9b729290e7be8647a2d76aadc19.

price3.py prints price3.txt, the full cap table behind section 7 (run it with python3; it needs no key). power.txt holds the noloss power runs behind section 6.
