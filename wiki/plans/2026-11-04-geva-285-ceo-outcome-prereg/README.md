---
id: 2026-11-04-geva-285-ceo-outcome-prereg
kind: plan
title: "Preregistration: plan-ceo-review graded on what really happened to real post-cutoff plans, with a headroom gate first, at $2,000 all-in"
summary: "Real plans first posted after July 2026, keyed to their public outcome. A review scores when its top 3 holds the real reason. Opus none must read 0.15 to 0.60 before any comparison."
author: GEVA-285
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-04
status: open
links:
  - 2026-11-03-geva-250-panel-v3-headroom-results
  - 2026-11-03-geva-232-panel-v3-e0-results
  - 2026-11-02-geva-142-ceo-panel-v2-admission-results
  - 2026-11-03-geva-225-outcome-per-skill-plan
  - GST-1389
  - GST-538
  - GST-1218
attachments:
  - b18c2a3f3b8cb85332fdd2636bf51cc60fd44486b01135cd32de124bdf5bce20  ceo-rule.ts.txt
  - d1b7163164bf2cc1c03c780d4e8cb32bebc519e764500f2d0c3867bf4d293062  dryrun.ts.txt
  - 683d4418ea00bdf47fde735c72b670dd46351891f7406b98333afea3c51b87b1  dryrun.txt
  - 83d5d644b97aa87003ea38a8cb273b64590f1c50129430612af2432072852589  judge-brief.md
  - a39ee813765e24ccf23f76527b780ecb609103a8d01661f6040c883f117b8499  power.py
  - ea7028c492ac58a6a2d3771554ff18696b16eb63a36fe0385ceab1db5b36027f  power.txt
  - dd3a6d40cfbe4832f9a37da0a6c6cc86ce711054354097a475f964a62bb02aff  stock-list.txt
  - b7c4c11020eff83695534cb32f10f019824b8775d92a1b1237ce72aeea05d862  template.txt
  - 13ce9eaee6218e8359c32966f8efe82722dc605feb94b3253e42381ac9153253  unit-brief.md
---

# Preregistration: plan-ceo-review graded on what really happened to real post-cutoff plans

GEVA-285, issue GST-1389, Captain GEVA-2. Plan only: nothing in this post spends money, and no model call, VM or eval ran to write it. The yield counts in section 4 come from GitHub's search API, at no cost.

## Approval

Approved at gate_rev 1 of /autoplan run autoplan-20261105002249 (lean, one Opus 5.5 reviewer). The review returned 31 findings. The Captain took every recommended change and asked for every Medium and Low finding as well; this v2 folds them all in (Review record), and the lean run applied the accepted changes without a second review, as a lean run does. Capy's review of PR #214 then found three issues, fixed here too. The project owner approved this $2,000 all-in line on 2026-11-05, outside the $10,000 program (approvals/2026-11-05-ceo-eval-line.md). This post approves no item's spend. No paid call of any kind, the stage 1 headroom check included, starts before this post merges and the Captain records each item's cap in approvals/ (section 14).

## ELI5

Four times we tested gstack's CEO plan review by hiding a flaw in a plan and checking whether the review found it. Plain Opus 5.5 found almost every flaw on its own, so those tests could not show any help. This test is harder in a way that matters: it uses real plans that real open-source projects proposed after Opus 5.5's stated training cutoff, where the public record shows what happened next. Some plans were rejected, reversed or cut back, and the record says why. A review scores when its top three concerns include that real reason. A review that lists twenty worries can't win, because only three count, and each is cut to 40 words. Before any real spend, a cheap check (about $42) runs plain Opus on 20 plans, and if plain Opus already names the real reason most of the time, we stop and report. If there is room, we compare gstack's CEO review, run inside /autoplan and on its own, against no gstack on 64 more plans, on Opus 5.5, GPT-6.1 Sol and particle-1, for at most $2,000 in all, our own model use included.

## Before → after

Before: three planted-flaw panels and one large-code-base attempt left plain Opus 5.5 at the ceiling (CEO v1 8 of 8, CEO v2 12 of 12, E0 137 of 138, and the panel v3 headroom check's ceo stratum 12 of 12 on too few items to read). plan-ceo-review has no fair test on the frontier model, and planted-flaw detection can't give it one.

After: a frozen test whose answer key is what really happened, not what an author planted. It grades whether a review puts the real deciding issue in its top three, with a headroom gate that must show plain Opus clearly below the top before the comparison spends. Either it measures plan-ceo-review's lift per model with an interval, or it stops cheaply with a dated reason.

## Why it matters

The project owner relies on plan-ceo-review more than on any other plan review, and on 2026-11-04 asked for harder CEO evals after every planning panel saturated. A skill with no measurable effect on Opus is a useful result, but only if the test could have seen an effect. This design aims the test at the thing a CEO review claims to do (pick what matters before building) and proves room exists before paying for the comparison.

## What caused this work

GST-1389, opened by the Captain on 2026-11-04 from the owner's request. The panel v3 headroom results (#191) moved plan-ceo-review to FIX-METHOD and said its test moves to an outcome method. GST-538 fixes the CEO arms (non-interactive /autoplan CEO mode first, standalone /plan-ceo-review beside it, gstack at v1.93.0.0 or later). GST-1218 kept plan-eng-review and plan-devex-review until an outcome test reads; the same logic applies to plan-ceo-review, which wave 1 of GST-1144 runs only inside autoplan.

## Big decisions

1. **Direction.** Options: (a) real plans graded on their public outcome; (b) long authored plans with the deciding issue buried among decoys, scored on ranking; (c) a builder builds from the reviewed plan and the plain plan, graded on what ships. Pick (a), scored with (b)'s ranking rules. Why: four authored panels saturated because a fair authored item is a findable one; a real outcome has no author to signpost it, and real plans already bury the deciding issue among many plausible concerns. (c) is the job of GST-1144's later vague-intent program, a build session costs several times a review session, and a CEO review's effect on hidden tests is indirect and can be negative by design when it widens scope. What would flip it: stage 1 reading CEILING, which leaves (c) as the next attempt.
2. **Primary measure.** Options: hit@3 (the real deciding issue in the review's ranked top three), a rank-weighted hit, or forecast calibration. Pick hit@3. Why: the cap of three is the precision penalty, a binary score per review keeps the judge's task narrow, and panel v3's judges agreed on 0.963 of cells on a task of this kind. Rank-weighted hits, slot precision and forecast Brier and AUC are reported beside it.
3. **Headroom bar.** HEADROOM when plain Opus's hit@3 on the 16 changed calibration units (3 passes, 48 readings) is from 0.15 to 0.60, and the two stock rows of generic concerns together match the key on at most 1 of the 16 units. Why 0.60: at 28 of 48 the upper 95% bound, with the design effect of 2 that ICC 0.5 gives three passes, is 0.78, so the true control very likely leaves at least 0.22 of room, more than the 0.18 MDD. Why 0.15: below it, the units are mostly unforeseeable and any gain must start from almost nothing. What would flip it: the Captain asking for more room, such as a 0.50 bar, at the cost of more stops.
4. **Standalone told line.** Options: the plain invocation, or CEO v2's frozen forced line, which still names the pinned skill's own steps. Pick the forced line. Why: invoked plainly, /plan-ceo-review ran its procedure in 0 of 16 Opus sessions in CEO v2, and the brief needs the procedure to have run. What would flip it: the Captain choosing to measure the invocation a user types, with that exposure risk.
5. **Size.** 48 changed and 16 held comparison units, 2 passes, 10 cells, for an MDD of 18 points at Holm's first step (control 0.40, ICC 0.5; 21 points at ICC 0.3). The alternative is 54 changed units at 17 points with a thinner margin for the unmeasured autoplan arm. Pick 48.
6. **Judges.** GPT-6.1 Sol and Opus 5.5 read every packet. D against not-D is decided by two of the three judges, so Sonnet 5.5 only breaks a split between Sol and Opus and can never make a D that both of them refused. A sensitivity read from the cross-family judge alone prints for each arm. The alternative, a Gemini judge, comes from no family under test but writes the keys.
7. **Stand-in control.** A lens arm on Opus (the harness's one-line CEO framing, no gstack) costs about $40 and tells gstack's procedure apart from the CEO framing. Pick yes, as a secondary.
8. **Blind-built units.** The writers of plan.md and context/ never see the outcome or the key, the auditors whose notes reach a writer never see them either, and no auditor may ask for signposts. Why: earlier authors held the key and wrote findable items.

## Implementation plan

### 1. The question and the claims

For each model under test, on real plans whose outcome came after Opus 5.5's stated training cutoff: does a review by gstack's CEO procedure put the real deciding issue in its top three more often than a review with no gstack?

- Primary arm: non-interactive /autoplan CEO mode (`/autoplan --ceo-only`, GST-538). Second arm: standalone /plan-ceo-review, told with the forced line (Big decision 4). Control: no gstack, the plain line.
- Models under test (R54): anthropic claude-opus-5-5, openai/gpt-6.1-sol (through OpenRouter's Anthropic-compatible route, which review-units already runs) and particle-ai/particle-1 (OpenRouter), all in Claude Code with the claude-code-preset system prompt.
- The headline is Opus's autoplan-CEO arm against none. Every model's contrasts are reported with their intervals, and verdicts use R56's words: helps, hurts, not distinguished (with MDD and interval) or untested (with the condition that failed).
- No parity claim is made for particle-1 or Sol: this post sets no margin.
- **Construct fit.** The units are mostly proposals from outside contributors, decided by maintainers, and D is a product decision, never an engineering defect. plan-ceo-review's forced sections 1 to 10 are mostly engineering review; the parts aimed at D are Step 0 (premise challenge, scope challenge and mode selection) and its scope and strategy sections. So this test measures whether gstack's CEO procedure as a whole surfaces the product reason in its top three, not whether every section helps. Category rates print for every cell, and a maintainer-versus-outside split prints beside them, so a gain or loss can be traced to the kind of decision.

### 2. The three directions, weighed

| | (a) Outcome-graded real plans | (b) Long authored plans, buried issue | (c) Downstream build |
|---|---|---|---|
| Ground truth | what the public record says happened | an author's planted issue | hidden tests on what ships |
| Why plain Opus might miss | the deciding issue is real, unsignposted, and competes with many plausible concerns for three slots | the issue is buried among decoys | the review must change the build |
| Saturation risk | unknown; stage 1 measures it for about $42 | high: four authored panels saturated, and the panel v3 audit found that a fair authored item is a findable one | low, but the effect is indirect |
| Cost per scored unit-pass, all cells | about $7.40 | about the same | several times more: a build session per cell |
| Overlap | none | the retired seeded-flaw line | GST-1144's later vague-intent program owns plan-ceo-review's build test |

Pick (a) as the ground truth, with (b)'s scoring: rank and a cap, so recall can't win, and a forecast for calibration. Real plans bring their own decoys: a long proposal holds many issues a reviewer could raise, and only the one that decided the outcome scores.

### 3. Pins and run settings

- gstack under test: garrytan/gstack 699a41cb6808e01240d02e82247693f9170d401a (VERSION 1.94.39.0), the overhaul's after pin that wave 1 and GST-1218's reading use. It is past GST-538's v1.93.0.0 floor and ships `autoplan/sections/ceo-only.md` and plan-ceo-review's `sections/review-sections.md`.
- Scorer: gstack-evals at a commit the pin post freezes (section 14), after build B1.
- Every arm: CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1; WebSearch and WebFetch disallowed (the Claude Code driver's DISALLOWED_TOOLS); the trial network reaches only the metering proxy; 150 turns; a 3600 s timeout; `--parallel 3`; the rec user of the plan lane (every question gets "Go with your recommendation.", and gstack's question registry is set to never-ask in the throwaway state root).
- Session allowance, in dollars as `--allowance` takes it. Default: 1.6M input and 32k output tokens at the model's price, which is $7.04 on Opus, $3.52 on Sol and $0.19 on particle-1. The autoplan arm: 2.73M input and 54.5k output tokens at the model's price, which is $12.00 on Opus, $6.00 on Sol and $0.33 on particle-1.
- The none and lens arms run in the trial container with no gstack install, no skills folder and no drive mount, so they are clean by construction; the read audit runs after the run as a descriptive check.

### 4. Units

**Source.** Public decision records on GitHub: issues, pull requests and discussions that propose a change to a product, in MIT, Apache-2.0 or BSD repositories with at least 500 stars, first posted on or after 2026-07-01, with a public, dated outcome by 2026-10-31. unit-brief.md sections 1 and 4 give the full rules. Open-source projects are products with users, roadmaps and maintainers who decide; company plans are rarely public with a dated first version, so they are out of scope here.

**Yield, from a free probe on 2026-11-04** (GitHub search, all repositories, before any licence, star or quality filter):

| Query (created 2026-07-01 to 2026-10-15 unless noted) | Count |
|---|---|
| closed issues labelled RFC, proposal or design, 8 or more comments | 737 |
| the same labels, closed as not planned, 6 or more comments | 91 |
| the same labels, closed as completed, 6 or more comments | 1,286 |
| closed issues with RFC in the title, 8 or more comments | 457 |
| closed, unmerged pull requests with RFC in the title, 8 or more comments | 418 |
| closed feature requests (feature request or enhancement label) not planned, 15 or more comments | 385 |
| merged pull requests with Revert in the title, 2026-07-15 to 2026-10-31, 6 or more comments | 4,149 |

The design needs 84 audited units: 64 changed and 20 held. The pools of records that were not carried out (the not-planned, unmerged and feature-request rows, about 900 before overlap and before the revert pool) give about 90 changed units at a guessed 10% pass rate through licence, stars, the 400-word and first-version rules, category and audit. The 10% is a guess, so B0 (section 14) applies the free filters to these pools before any build spends. Held candidates are plentiful. Section 14's yield rule handles a shortfall.

**Outcome classes.** Changed units were rejected (closed with a maintainer's stated reason), reverted, or re-scoped (a major cut or change of approach with a stated reason). Held units were carried out as written, shipped by 2026-09-01 and still in place on 2026-10-31. The deciding issue of a changed unit is a product decision (premise or demand, scope, direction fit, user impact or migration, maintenance or cost, sequencing, ambition), never a code defect or a reason only insiders could know.

**Blind-built packets.** Each unit is a plan-lane repository: plan.md at the root and context/project.md. Three Gemini 4 Argon writers build it in separate sessions (unit-brief.md section 2). The plan writer rewrites the proposal's first version in its own words and never sees a reply or the outcome. The context writer describes the project from its repository and its recent issue and pull request titles, each with its state as of the plan date (closed or merged only when that happened before the plan date, otherwise open), and never sees the proposal, the outcome or any later date. The key writer reads the whole record and writes D, the deciding issue, plus up to three other real issues, in its own words. A packaging script, not an agent, assembles every session's inputs and the per-unit name map, so no agent that has read the outcome hands text to a writer. Two blind auditors, Opus 5.5 and GPT-6.1 Sol with no gstack, check leaks, names and fidelity without seeing the key or the outcome, and only their notes reach a writer's one fix round. Two key auditors, in separate sessions, then check key support, foreseeability and category with the key; a failure there drops the unit with no fix round. Foreseeable means D concerns something present in the unit; an auditor never asks for an edit that would make D easier to see.

**Counts and draw.** The screened pool goes in a seeded random order (a seed from random bytes, logged in CUSTODY.md). The first 16 changed and 4 held units to pass audit are the calibration slice. If stage 1 reads HEADROOM, authoring continues in the same order to 48 changed and 16 held units, the comparison set. Calibration units never join the comparison set. At most two units come from one repository.

**Training cutoffs and strict strata.** Opus 5.5's stated training cutoff is June 2026, with some data possibly collected to September (unverified; GEVA-87's plan records the same source). We have no stated cutoff for GPT-6.1 Sol. particle-1 was released 2026-10-17 or later, so plans before that date may sit inside its data. So the readings carry each unit's first-posted date, and two strict strata are reported apart: units first posted on or after 2026-09-01, and units first posted on or after 2026-10-01 (GEVA-87's strict date). Both decide nothing, and the second will be small, since its outcome must land by 2026-10-31.

### 5. Arms

| Arm | Models | gstack | First line of the prompt |
|---|---|---|---|
| none | Opus, Sol, particle-1 | not installed | "Review this plan for problems." |
| autoplan-ceo (harness arm gstack-auto) | Opus, Sol, particle-1 | 699a41cb | "/autoplan --ceo-only Review this plan for problems." |
| standalone (harness arm gstack-forced) | Opus, Sol, particle-1 | 699a41cb | CEO v2's forced line (wiki/plans/2026-11-01-geva-115-planning-ceo-v2-admission-prereg/forced-line.txt, sha256 d4f56ad49c82e6b8ca9a2ec05b24a641c45e9d158e11c9de65420008b66d4e43), then "Review this plan for problems." |
| lens | Opus only | not installed | "Do a CEO/founder-mode review of this plan. Review this plan for problems." |

Every arm's prompt then holds a blank line and the frozen template (template.txt). The forced line names Step 0 (Nuclear Scope Challenge + Mode Selection) and Review Sections 1 to 10 plus Section 11 of sections/review-sections.md; all of them exist at 699a41cb under those names. The autoplan arm's CEO-only mode asks no questions, runs autoplan's phases 0, 0.5 and 1, writes ceo-review.md and approves nothing. Its open Critical and High findings stay undecided, and that doesn't matter here: the score reads only the closing block.

The autoplan arm runs as the pin ships it in the trial container. The container has no Codex binary, so autoplan's outside voice falls back to its Claude adversarial subagent, which runs on the arm's own model and counts as part of the arm; the pin post confirms both on its smoke unit. ceo-only.md ends on a GSTACK_RESULT line, and the template asks for the ceo-outcome block after it; the parser reads the last block wherever it falls.

### 6. The closing block and session rules

The template asks every arm to end with one `ceo-outcome` block: a JSON object with "top", at most three ranked issues (issue, evidence, fix), each issue at most 40 words, and "forecast", a whole number from 0 to 100 for the chance that the plan, as written, is carried out and still in place 60 days after it ships with no reversal and no major cut.

- The parser reads the last `ceo-outcome` block the main agent wrote in any turn, never a subagent's text or a file.
- More than three items: the first three are scored and a diagnostic counts it. So listing more never helps.
- The packet builder cuts every issue to its first 40 words, in every arm, so a long issue that packs several problems gains nothing; mean issue length prints per cell.
- A block is malformed when it isn't one JSON object, has no "top" array, or has an item with no "issue" string. A malformed or missing block at the end of a completed session gets one follow-up turn, the same for every arm: "End your reply with the ceo-outcome block the first message asked for."
- A forecast outside 0 to 100 or not a whole number makes the forecast missing; the issues still score.
- There are no repair reruns. A rerun needs a second run on its ledger item, and an item binds one run (E_ITEM_BOUND). A gap instead drops that unit-pass from each contrast that holds the gapped arm, and coverage (section 11) limits how many may drop.

**Every end state, frozen.** B1 makes the plan lane follow this table where today's harness differs; today a plan-unit cap stop is a gap that stops the arm.

| End state | Class | What is read |
|---|---|---|
| Completed with a parsable block, after at most the one follow-up turn | scored | that block |
| Completed, block still missing or malformed after the follow-up turn | no-block | no hit and no forecast; it counts against its own arm |
| Turn cap (150 turns) or session allowance reached | scored when a block was written before the stop, else no-block | the last block before the stop |
| 3600 s timeout after a block | scored | the last block before the timeout |
| 3600 s timeout before any block | no-block | a slow procedure is the arm's own cost |
| Claude Code exits on its own error (a CLI failure) before any block | gap | dropped per contrast |
| Provider, proxy or container failure (an infra failure) before any block | gap | dropped per contrast |
| The harness's background deadline (E_BACKGROUND_DEADLINE) before any block | gap | dropped per contrast |
| A CLI failure, infra failure or background deadline after a block | scored | the last block |
| Never started, for a harness or host failure | gap | dropped per contrast |
| Never started because its ledger item reached its cap | incomplete run | recorded as incomplete in the readings; not scored and never rerun; coverage counts it as missing |

no-block sessions are scored as misses and print per cell as a rate. A cap stop leaves an incomplete run, and the stage reads only what ran. Readings carry exactly one row for every planned session, an incomplete one included, and no row outside the plan.

### 7. Exposure: did the CEO procedure run?

A detector reads the session's own text and its own successful tool calls, never the injected skill body, a tool result or a subagent's text, in the style of O1's detectors (lanes/outcome-skills/arms/exposure.ts). B1 builds both from 699a41cb's own files.

- standalone: the session read plan-ceo-review's `sections/review-sections.md` and named at least one of the four modes (SCOPE EXPANSION, SELECTIVE EXPANSION, HOLD SCOPE, SCOPE REDUCTION) in its own text. CEO v2's rule asked for exactly one, which fails a session that weighs several modes before it picks.
- autoplan-ceo: the session ran `gstack-ceo-mode-handoff` with `--ceo-only` successfully and wrote ceo-review.md with a `## Findings` section.

The exposure rate of an arm and model is the share of its sessions on changed units, gaps and incomplete sessions left out, that pass. A gstack arm under 0.80 reads UNTESTED on that model: its contrast is printed, labelled, and gets no verdict. The exposure rate prints beside every verdict, and a per-protocol read (exposed sessions only) is descriptive.

### 8. Judging

- **Packets.** One packet per unit: plan.md, the key, and every review's first three issues, each cut to its first 40 words (issue text only; evidence and fix are left out so length can't sway the judge), under random ids in random order, with arm and model hidden. Each changed unit's packet also holds the two stock rows of stock-list.txt as two more reviews under random ids: row A (demand, migration, scope) and row B (direction fit, upkeep, an existing alternative). Forecasts never enter a packet.
- **Brief.** judge-brief.md, frozen here. An issue matches D only when it names the specific thing D names; a category alone never matches. An issue is judged on its main problem, the first problem it states, so a later problem packed into the same issue never earns D.
- **Judges.** Three full reads: openai gpt-6.1-sol, anthropic claude-opus-5-5 and anthropic claude-sonnet-5-5, at reasoning effort medium.
- **Final label.** First D against not-D: when Sol and Opus agree on whether the issue is D, that stands; when they split, Sonnet decides. So the final label is D only when two of the three judges said D. Then, for an issue that is not D: the R label or none that Sol and Opus agree on, else Sonnet's label when it is not D, else none. R labels feed slot precision only. A review's leak is final when Sol and Opus both say yes.
- **Judge failures.** A reply with a malformed ceo-judge block, a missing review, a label list whose length differs from the review's issue count, an unknown label or a refusal gets one retry of that judge on that packet. If it still fails, that judge's calls for the packet are missing. The final label then comes from the other two judges when they agree on D against not-D; otherwise the issue is unjudged, and its review drops from each contrast it enters, like a gap. Missing calls print per judge.
- **Cross-family sensitivity.** Each arm's hit@3 is also read with the label from its cross-family judge alone (Sol for Opus and particle-1 arms, Opus for Sol arms). It decides nothing and prints beside each contrast.
- **Agreement.** Sol against Opus on D labels over every scored issue cell and stock cell: positive agreement on D (twice the cells both call D, over the cells both call D counted twice plus the cells only one calls D), with raw agreement, PABAK and kappa beside it, printed in each stage. Positive agreement is the gate because most cells are easy not-D cells, which push raw agreement and PABAK near 1. A positive agreement under 0.70 in stage 1 sets one brief revision before stage 2's judging, frozen in the stage 2 addendum; stage 1's reading stands.

### 9. Scoring

- **Primary, hit@3.** Per review of a changed unit: 1 when any of its first three issues has final label D, else 0. A no-block review scores 0.
- **Rank-weighted hit:** 1, 2/3 or 1/3 when the first D label is at rank 1, 2 or 3, else 0.
- **Slot precision:** the share of a review's three slots (an empty slot counts as a miss) labelled D or R.
- **Forecast:** Brier score against truth 0 for changed units and 1 for held units, and the AUC of forecasts between held and changed units, both over all units in the stage with a forecast.
- **Leak drop:** a unit where two or more reviews carry a final leak flag is dropped from every arm before any reading.

### 10. Stage 1: the headroom check

**What runs.** On the 20 calibration units: none on Opus with 3 passes (60 sessions), none on Sol and on particle-1 with 2 passes each (80 sessions), and a smoke of 2 sessions per gstack arm per model on the first two calibration units in draw order (12 sessions, in six invocations). Smoke sessions are read for exposure, the closing block, wall time and cost only, and are never judged. Then three judge reads.

**The rule** (ceo-rule.ts headroom), in order:

1. Leak drops (section 9).
2. NO READ, stop: fewer than 12 changed calibration units left, or gaps, unjudged reviews and incomplete sessions together over 10% of Opus none's planned readings (3 for each changed calibration unit left).
3. STOCK FAIL, stop: either stock row's final labels hit D on more than 1 of the changed calibration units (a unit counts once when both rows hit it). The judges are then crediting categories, and the measure is not grading substance.
4. On Opus none's readings, m hits of n: CEILING if m/n > 0.60; FLOOR if m/n < 0.15; otherwise HEADROOM. At n = 48 that is HEADROOM for 8 to 28 hits.
5. Exposure smoke: a gstack arm is admitted on a model when both of its smoke sessions are exposed, wrote a parsable block and finished within 1800 s, half the timeout. An arm that fails is UNTESTED on that model in stage 2 and isn't run there. If autoplan-ceo fails on Opus, stage 2 doesn't start, and the question goes to the Captain as FIX-METHOD on the harness.
6. Projection check (ceo-rule.ts projection), on stage 2's envelope (section 13):
   - Per-session spend: each model's none from stage 1's median none session on that model; each gstack cell from the larger of its two smoke sessions; lens at 1.2 times Opus none's median, since stage 1 doesn't run it.
   - Each stage 2 run item's projection is its unit-passes times the per-session spend of each cell it runs. Its cap is 1.25 times its own projection plus one full round of sessions at their allowance, rounded up to the dollar. review-units starts a round only when the spend so far plus every session in that round at its allowance fits under the item's cap (src/trial/review/run.ts, the round loop); a round holds max(1, floor(3 / arms)) unit-passes with every arm the invocation runs. So every round admits until an item's spend passes 1.25 times its projection, and the check prints that it does for each item. The Captain records these caps, not the planning caps in section 13.
   - Judges: stage 1's settled judge spend times 64/20 for the units times 3 for the larger packets, with a floor of twice that, at least $70.
   - It fits when the six run caps plus the judge floor are at most the envelope. Otherwise cuts apply in this order until it fits: held units at 1 pass; standalone on particle-1 dropped; standalone on Sol dropped; lens dropped; every Sol and particle-1 cell at 1 pass (their contrasts stay paired, with a wider MDD that the results post states). If it still doesn't fit, stage 2 doesn't start, and the question goes to the Captain.

Sol and particle-1 rates print beside Opus's and decide nothing. The bar and its edges are Big decision 3. HEADROOM, the Opus autoplan admission, a passing projection and the all-in check start stage 2 under section 14. CEILING, FLOOR, NO READ or STOCK FAIL ends the design: the stop report gives the block, the rates, the cost and the R48 reading, and no gstack arm has run beyond the smoke.

### 11. Stage 2: the comparison

**What runs.** On the 64 comparison units, 2 passes: none, autoplan-ceo and standalone on each model, and lens on Opus (10 cells, 1,280 sessions), less any stage 1 cut or UNTESTED arm. Then three judge reads.

**Primary families.** For each model, the family is fixed when stage 2 starts: each gstack arm that starts stage 2 on that model, as a contrast with none on hit@3 over the changed units. An arm that reads untested afterwards stays in its family with p = 1, so one arm's exposure or coverage can't change the other arm's adjusted p. Reviews pair by unit and pass, with the unit as the cluster. src/runner/stats/paired.ts's clusteredPairedDelta gives the difference, a 95% cluster-bootstrap interval and a two-sided cluster sign-flip p (seed 20261104, 10,000 draws, exact enumeration where the unit count allows). Holm adjusts the p values within each model. Each model is its own family; the headline is Opus's autoplan-ceo contrast.

**Pairs and coverage.** A contrast keeps a unit-pass only when both its arm and none have a scored or no-block review that is fully judged. A gap, an unjudged review or an incomplete session drops that unit-pass from the contrasts that hold that arm, not from every arm, so a lens gap never touches a primary contrast. Coverage is the share of none's planned unit-passes on changed units that a contrast keeps. Readings must carry exactly one row for every planned session and none outside the plan, the stage 2 family (all three models, gstack arms only, and every gstack arm that has rows) and each model's planned passes from the projection's PASS line. ceo-rule.ts checks part of this and refuses with E_USAGE: readings with no family, a family that leaves out a model, lists an arm that is not a gstack arm or lists an arm twice, a gstack arm with rows that its model's family leaves out, and missing or invalid passes. It also refuses a session row for an arm and model outside the plan, on a unit the readings do not hold or past the model's planned passes, a duplicated session row, and a missing none or family-arm row on a changed unit. It does not yet check a row's status, duplicate unit records, held-unit rows, lens rows or the fields of an incomplete row; a later unit adds those checks before any paid call.

**Verdicts.** helps: Holm-adjusted p at most 0.05 and a positive difference; hurts: the same with a negative difference; not distinguished: anything else, printed with the difference, the interval and the MDD; untested: the gstack arm's exposure under 0.80, the contrast's coverage under 0.90, or a stage 2 STOCK FAIL. A model whose none arm reads above 0.60 in stage 2 carries a CEILING flag on its contrasts.

**Stage 2 stock check.** The stock rows sit in every changed packet. If they hit D on more than 3 of the changed comparison units, every contrast reads untested (judge), since a brief that credits categories can't grade the comparison.

**MDD and size after drops.** The MDD printed with each verdict is read between power.txt's rows for that contrast's own retained units and the passes its model was planned to run (the readings' passes, from the projection's PASS line): two-pass rows normally, one-pass rows for a model the last cut runs at 1 pass (48 units print 0.18 at 2 passes and 0.26 at 1). The header prints the two-pass MDD for the changed units left after leak drops. Under 36 changed units after leak drops, the comparison stops and reports; that is an analysis rule, beside section 14's authoring rule.

**Secondaries, deciding nothing:** rank-weighted hit, slot precision, forecast Brier and AUC; lens minus none and autoplan-ceo minus lens on Opus; the cross-family sensitivity; both strict strata; rates by category and by maintainer or outside proposer for every cell; the per-protocol read; no-block, gap, unjudged and incomplete counts; mean issue length; cost per review and cost per hit for each cell.

**R48.** Every null gets the Why-null cycle (exposure, task fit, power and ceiling or floor, frontier competence) and names its kind (saturation, exposure, task fit or power). KEEP, FIX-METHOD or CUT-CANDIDATE is the Captain's reading from the printed rows. A null that rests on Opus none above 0.60 in stage 2 is a saturation null; under R61 that is this skill's ceiling-raise attempt, and the post says so.

### 12. Power, MDD and what we expect

power.py simulates the primary test exactly: unit difficulty from a Beta with mean p0 and ICC rho, each gstack arm shifting units on the logit scale with unit noise tau, 2 passes, a two-sided paired sign-flip on unit means. MDD is the smallest gain with 80% power.

| Changed units | Control p0 | ICC | MDD, alpha 0.05 | MDD, alpha 0.025 (Holm's first step) |
|---|---|---|---|---|
| 48 (frozen) | 0.40 | 0.5 | 0.16 | 0.18 |
| 48 | 0.40 | 0.3 | 0.19 | 0.21 |
| 48 | 0.25 | 0.5 | 0.16 | 0.17 |
| 48 | 0.55 | 0.5 | 0.16 | 0.18 |
| 36 (yield floor) | 0.40 | 0.5 | 0.19 | 0.21 |
| 54 (alternative) | 0.40 | 0.5 | 0.15 | 0.17 |
| 48, 1 pass (last cut, Sol and particle-1) | 0.40 | 0.5 | 0.23 | 0.26 |
| 48, 1 pass | 0.40 | 0.3 | 0.26 | 0.29 |
| 36, 1 pass | 0.40 | 0.5 | 0.27 | 0.30 |

Every row runs 2 passes unless it says 1. The stated MDD is 18 points: a gain of that size or more on Opus is found 80% of the time, and a smaller true gain may read not distinguished. The 18 rests on ICC 0.5; at ICC 0.3 it is 21 points, and stage 1 prints the measured ICC and the nearest row. Tau of 0 or 0.5 moves no row by more than 0.01 (power.txt). The bar check in power.txt: at the top of the HEADROOM band, 28 of 48 with a design effect of 2 (ICC 0.5 over 3 passes), the Clopper-Pearson upper 95% bound on 14 of 24 effective readings is 0.779, so the comparison has at least about 0.22 of room against an MDD of 0.18.

**Prior, stated before any data.** We expect a true gain on Opus of 0 to 10 points: the CEO procedure adds premise and scope challenges a frontier model often raises unprompted, and a cap of three slots limits what a longer review can add. So "not distinguished" is the likeliest result, and the post says so now. The test can still find a gain or a loss of 18 points or more, and a null with the control rate, the interval and the MDD still tells gstack's research where the skill's effect is not.

### 13. Money

The whole CEO eval is held to $2,000 all-in. That counts this design thread's model use and any successor's, every crew thread on the CEO line at about $1 per 1,000 credits (R42), runner VMs, the judges, the lens arm and the headroom check. Paid calls go through the ledger, one item per review-units invocation or judge read, each with a cap the Captain records in approvals/ before it opens a lease. Stage 2's envelope is sized net of the crew line and stage 1: $2,000 less $430 less $160 is $1,410.

| Item | Stage | What runs | Sessions | Projected | Cap |
|---|---|---|---|---|---|
| Crew, every thread on the CEO line | all | design, B0, B1, custody and authoring, pin post, runs, results, runner VMs | | about $330 ($18 spent to 2026-11-04) | $430.00 |
| ceo-o-hr-opus-none | 1 | none on Opus, 20 units, 3 passes | 60 | $15.00 | $52.00 |
| ceo-o-hr-sol-none | 1 | none on Sol, 2 passes | 40 | $6.00 | $23.00 |
| ceo-o-hr-particle-none | 1 | none on particle-1, 2 passes | 40 | $2.40 | $6.00 |
| ceo-o-hr-smoke-opus-a, -opus-p | 1 | autoplan-ceo, then standalone, 2 sessions each on Opus | 4 | $6.00, $1.40 | $25.00, $15.00 |
| ceo-o-hr-smoke-sol-a, -sol-p | 1 | the same on Sol | 4 | $3.60, $0.84 | $13.00, $8.00 |
| ceo-o-hr-smoke-particle-a, -particle-p | 1 | the same on particle-1 | 4 | $0.66, $0.30 | $1.00, $1.00 |
| ceo-o-hr-judge-sol, -opus, -sonnet | 1 | three reads of 20 packets | about 60 requests | $6.00 | each: $160 less every earlier item's settled spend |
| **Stage 1** | | | 152 | **$42.20** | **$160.00** |
| ceo-o-cmp-opus-p | 2 | none, standalone and lens on Opus | 384 | $160.00 | $222.00 |
| ceo-o-cmp-opus-a | 2 | autoplan-ceo on Opus | 128 | $384.00 | $516.00 |
| ceo-o-cmp-sol-p | 2 | none and standalone on Sol | 256 | $72.96 | $99.00 |
| ceo-o-cmp-sol-a | 2 | autoplan-ceo on Sol | 128 | $230.40 | $306.00 |
| ceo-o-cmp-particle-p | 2 | none and standalone on particle-1 | 256 | $26.88 | $34.00 |
| ceo-o-cmp-particle-a | 2 | autoplan-ceo on particle-1 | 128 | $42.24 | $54.00 |
| ceo-o-cmp-judge-sol, -opus, -sonnet | 2 | three reads of 64 packets | about 200 requests | $57.60 | each: $1,410 less stage 2's settled spend; floor $116 in all |
| **Stage 2** | | | 1,280 | **$974.08** | **$1,410.00** |
| **All-in** | | | | **about $1,346** | **$2,000.00** |

Stage 2's caps in this table are planning caps under section 10's rule (1.25 times each item's planned projection plus one full round at allowance); with the $116 judge floor they use $1,347 of $1,410. The caps the Captain records come from section 10's projection check on measured costs. Stage 1's caps cover review-units' round admission: each none item's cap is twice its projection plus one full round of three sessions at their allowance, so every round admits even at twice the projected spend, and each smoke item's cap covers its one round of two sessions at full allowance ($24.00, $14.08, $12.00, $7.04, $0.66 and $0.38). Stage 1's run caps sum to $144 of $160, so the judges keep a $16 floor. Smoke runs one invocation per arm and model, so each is its own item; the six smoke caps sum to $63. Review-units invocations run arms that share a told skill, so in stage 2 standalone, none and lens share an invocation and the autoplan arm has its own. The pin post freezes each item's exact command.

**Per-session projections**, before any measurement of these units:

| Arm | Opus | Sol | particle-1 | Basis |
|---|---|---|---|---|
| none | $0.25 | $0.15 | $0.06 | CEO v2's none median was $0.126 on small units and the panel v3 headroom check's mean $0.313 on 400 KiB trees; these units hold a plan and one context file. Sol at 0.6 of Opus (half the token price, more tokens), particle-1 at 0.21 (the headroom check's ratio) |
| standalone | $0.70 | $0.42 | $0.15 | CEO v2's forced median of $0.569 |
| autoplan-ceo | $3.00 | $1.80 | $0.33 | never measured: about five times the forced arm; the smoke measures it and the projection check acts on it. On particle-1 five times would be $0.75, past the arm's $0.33 allowance, so the plan uses the allowance |
| lens | $0.30 | | | none plus one line |

Prices are the scorer's table (src/runner/pricing/prices.ts at b7b6aec, as the panel v3 headroom results quote it), in dollars per million tokens: Opus 5.5 input 4, output 20, cache read 0.20, cache write 5; Sonnet 5.5 input 2, output 10, cache read 0.20, cache write 2.50; GPT-6.1 Sol input 2, output 10, cache read 0.10, cache write 2.50, and above 272k prompt tokens 4, 15, 0.20 and 5 for the whole request; particle-1 input 0.10, output 1, cache read 0.003. The pin post re-reads the table at its pin.

**Crew.** This thread read 17,034 credits at 44.2M tokens (about 385 per million) and the panel v3 headroom run thread 49,400 credits at 194.7M (about 254 per million). The crew estimate is about 860M tokens: this design thread to READY about 130M (the Captain's stop for it), B0 about 10M, B1's build and /ship about 180M (outcome-classification code), custody and authoring about 400M (84 units, each with three writers, two blind auditors and two key auditors, plus dropped units), the pin post about 40M, the runs about 40M and the results post with its /ship about 60M. At 254 to 385 credits per million that is about $220 to $330, plus about $15 of runner VMs; the reserve is $430.

**All-in check** (ceo-rule.ts allin). Before stage 2 opens a lease: crew spent so far, plus the rest of the crew estimate, plus stage 1's settled spend, plus stage 2's envelope must be at most $2,000. When it isn't, stage 2's envelope drops to fit and section 10's projection check runs again on the smaller envelope, cuts and stop included.

### 14. Start rules, build units and stops

Nothing here spends until every rule before it holds.

1. This post is merged.
2. The project owner approved this $2,000 all-in line on 2026-11-05 (approvals/2026-11-05-ceo-eval-line.md), and the Captain has recorded each stage 1 item's cap in approvals/. No paid call of any kind runs before that, the stage 1 headroom check included.
3. **B0, the free yield screen**, runs before B1 spends: a script with no model call applies the licence, star, 400-word and first-version rules (unit-brief.md section 1, items 1 to 3) to section 4's probe pools through GitHub's API and posts the counts. Fewer than 160 changed candidates surviving goes to the Captain before B1 starts, with the yield rule's 36-unit floor and its MDD.
4. **B1, the harness build**, is merged through /ship: a `ceo-outcome` plan lens in src/trial/review with template.txt's text and its sha256 pinned in a test, the parser and section 6's end-state table (the follow-up turn and the 40-word cut included), gstack-auto released at min_version 1.93.0.0 (GST-538), the standalone arm's forced line, section 7's two detectors at 699a41cb, section 8's blind packet builder with both stock rows and the judge-failure handling, judge-brief.md wired into judge-run, and a readings script that writes the readings.json ceo-rule.ts reads.
5. **The pin post** is merged: the scorer pin, every item's exact command (one item per invocation), the sha256s of the template, brief and stock list as the scorer holds them (equal to this post's), review-units --dry-run with the frozen flags on one public smoke unit (the autoplan arm's outside voice confirmed as section 5 says), one ledger lease opened and settled per item on a temporary ledger, and the data-use check of section 16.
6. **B2, custody**: the calibration slice is mined, built and audited under unit-brief.md, sealed, and its digests posted in a custody addendum. The addendum re-projects the crew line from the slice's measured tokens per passing unit; if crew spent plus the re-projected rest passes the $430 reserve, the comparison set is not authored and the question goes to the Captain.
7. Stage 1 runs detached on a runner host that stays awake for the whole run, named and counted in the crew line, with every lease through the ledger.
8. Stage 2 starts only on HEADROOM, the Opus autoplan admission, a passing projection check whose caps the Captain has recorded, and the all-in check, after the comparison set is sealed and its digests are posted.

**Yield rule.** Fewer than 16 changed calibration units passing audit means stage 1 can't run: FIX-METHOD on yield, reported. If the comparison set falls short of 48 changed units, stage 2 runs on every changed unit that passed, at least 36 (MDD 21 points at Holm's first step), keeping one held unit for every three changed; under 36, it stops and reports.

**Stops.** A cap stop is an incomplete run and is never retried to change a verdict. A change to any frozen rule needs a new post before the stage it touches runs.

### 15. Custody and public safety

The mining record, units, keys, name maps, every session's inputs and both stages' run bundles (transcripts, packets, judge replies, readings) are sealed with age to the panel recipient and logged in CUSTODY.md in the Captain drive. Decryption happens in /dev/shm, and every wake starts with a test ! -e check for leftover plaintext. The packaging script is the only path from the mining record into a session's inputs, and it writes nothing outside the sealed store and /dev/shm. The repo gets counts, categories and sha256s, never a unit, a key, a source link or a project name. Held-out material stays sealed until the Captain retires the set.

### 16. Outside terms, licences and rights

- **GitHub content.** Records are read through GitHub's API under its terms and rate limits. GitHub's Acceptable Use Policies let researchers use public, non-personal information from GitHub for research when the resulting publications are open access; this repo and its posts are public. Repository licences cover repository files, not issue, pull request or discussion text, so no record text is committed. Writers restate records in their own words, but a close paraphrase can still count as a derivative of the original, so the rewrites stay sealed, are used only for this evaluation and are never published. A later post that wants to publish a unit needs the project's licence or permission first.
- **People.** Names become roles, and no personal data is stored beyond public links in the sealed mining record.
- **Model providers and data use.** Sealed units and keys go to Anthropic's API (Opus and Sonnet), OpenAI's API (Sol as a judge and an auditor), OpenRouter and its upstream providers (Sol and particle-1 as arms) and Google's Gemini API through Capy's route (the writers). The pin post records each route's data-use terms and checks that OpenRouter requests carry provider routing that excludes providers that may store or train on prompts (data_collection deny), with at least one serving endpoint for each model under it. If any route would train on or keep the sealed text beyond its stated retention, that route stops and the question goes to the Captain. Outputs are analyzed and published only as counts.
- **Projects reviewed.** The results post names no source project, so no project is featured. If a later post wants to name one, the disclosures file's new-company rule applies first.
- **gstack** is our own project at a public pinned commit.

### 17. What the results post reports

A finding file in the insight plan's template: the stage 1 block, or the stop report; for each model, none's rate and each arm's rate, the difference with its interval, the Holm-adjusted p, the verdict, the exposure and coverage rates and the MDD; the CEILING or FLOOR flags; every secondary; the stated prior beside the result; cost in dollars and tokens with the dated price table, crew included; R48 for every null; limits; replication from the scripts that ran; the held-out disclosure; and a closing Disclosures section.

### 18. Risks and limits

- **Luck in outcomes.** Some deciding issues were not knowable. The foreseeability check drops units whose D has no basis in the unit, and the rest affects every arm alike.
- **Stated reasons.** A maintainer's stated reason may not be the whole reason. The key follows the record, and R items catch the rest.
- **Construct fit.** Most units are outside proposals judged by maintainers, and D is a product reason. A null can mean the CEO procedure's engineering sections crowd the product reason out of three slots; the category and proposer splits and the lens contrast help read which.
- **Coverage.** Open-source developer products only, over a four-month window that favors fast decisions.
- **Contamination.** Every plan and outcome is from July 2026 or later, names are replaced, the reviews run offline, leak flags drop units, and two strict strata report plans from September and from October on. Opus's cutoff is stated but its late data is unverified; Sol has no stated cutoff here; particle-1 came out after most units were posted.
- **Judges share families with arms.** The cross-family sensitivity prints beside each contrast.
- **Offline reviews.** plan-ceo-review's landscape check wants web research, which no arm can do here. Every arm is equally offline.
- **The autoplan arm's cost is unmeasured.** The smoke measures it before stage 2, and the projection's per-item caps and cut order protect the Opus contrasts.
- **Allowances bind on particle-1.** The same token allowance costs particle-1 $0.19 a session ($0.33 in the autoplan arm), and particle-1 used about five times Opus's tokens in the panel v3 headroom check. Some particle-1 sessions may stop at their allowance; section 6 scores the last block before the stop, and the no-block rate prints per cell.
- **Another ceiling.** Stage 1 finds it for about $42 and stops.

### 19. Not in scope

The downstream build test (GST-1144's vague-intent program), plan-eng-review, plan-devex-review and plan-design-review, interactive /plan-ceo-review with a person, any parity claim, Haiku or Sonnet as arms, and publishing units.

### 20. Files and the keyless dry run

| File | What it is |
|---|---|
| template.txt | the closing-block template every arm gets, frozen |
| judge-brief.md | the judge brief, frozen |
| stock-list.txt | the two stock rows of three generic concerns each, frozen |
| unit-brief.md | mining, blind-built packets and audit, frozen |
| power.py, power.txt | the power simulation and its output (seeded) |
| ceo-rule.ts.txt | the headroom rule, projection check, all-in check and stage 2 analysis, reading readings.json |
| dryrun.ts.txt, dryrun.txt | the keyless dry run and its output |

The dry run drives every frozen rule on synthetic readings, with no key in its environment: each headroom outcome (HEADROOM, CEILING, FLOOR, NO READ on gaps and on incomplete sessions, STOCK FAIL on either row, a leak drop and the band edges at n = 48), the final-label splits (an R against none split that Sonnet calls D stays not D), judge failures, the positive-agreement gate, the smoke admissions (exposure, a missing block and wall time), the projection check's per-item caps and their round admission, every step of its cut order and its stop, round admission at stage 1's fixed caps (and v1's smoke caps refused), the all-in check, stage 2's verdicts (helps, hurts, not distinguished, untested on exposure, coverage and the stock check) with fixed Holm families, per-contrast gap drops, an Opus item stopped halfway by its cap (coverage 0.500 on both contrasts), a contrast with no usable pairs, the E_USAGE refusals for a missing, duplicated or out-of-plan row (for a smoke row, only a row outside the plan), a missing, malformed or short stage 2 family, a family arm with no rows and missing passes, one readings file that passes every guard, the MDD read between rows for each contrast's passes and the under-36 stop, the secondaries, and one ledger lease opened and settled per frozen item and invocation on a temporary ledger, with a second run on a settled item refused. Rerun it from a directory holding the bundle's files, with the two scripts renamed to drop .txt: `env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OPENROUTER_API_KEY bun dryrun.ts <scorer checkout> <scratch dir>`.

## Review record

Gate 1 of /autoplan run autoplan-20261105002249 (`--kind feature`, one lean Opus 5.5 reviewer) read v1 and returned 31 findings: 1 Critical, 6 High, 13 Medium, 10 Low and 1 Informational. The Captain took the recommended reply and asked for every Medium and Low as well, and added two items: the crew line in the money table with stage 2's envelope sized net of it, and no paid call, the headroom check included, before caps are in approvals/. Where v2 answers each:

| Finding | v2 |
|---|---|
| Critical: the projection checked only stage 2's total, so one item could pass its own cap | section 10 rule 6: per-item caps from each item's own projection, the larger smoke session, a fifth cut |
| High: Sonnet could make a D neither Sol nor Opus gave | section 8, final label |
| High: Holm ran only over tested contrasts | section 11, families fixed at stage 2's start |
| High: failure classes unsettled | section 6, end-state table; no repair reruns |
| High: packing several problems into one issue | template, section 6's 40-word cut, judge-brief.md's first-problem rule |
| High: context states leaked the outcome | section 4, unit-brief.md section 2 and check 1 |
| High: one smoke item for several invocations | section 13, six smoke items; the dry run leases each |
| Medium: gaps in any arm dropped the unit-pass everywhere | section 11, pairs and coverage |
| Medium: exposure counted gaps and held units | section 7 |
| Medium: PABAK could not fire | section 8, positive agreement on D |
| Medium: no stage 2 stock check | section 11 |
| Medium: no direction-fit stock row | stock-list.txt row B, section 8 |
| Medium: no stated cutoffs; one strict date | section 4, section 18 |
| Medium: blind-build channels | section 4, unit-brief.md sections 2 and 5 |
| Medium: judge failures unspecified | section 8 |
| Medium: construct fit | section 1, section 18 |
| Medium: no stated prior | section 12 |
| Medium: the 10% yield is a guess | section 14, B0 |
| Medium: the custody estimate is not re-checked | section 14, rule 6 |
| Medium: outside data-use terms | section 16, section 14 rule 5 |
| Low: the autoplan arm's outside voice | section 5 |
| Low: allowances on Sol and particle-1 | section 3 |
| Low: a bad forecast voided the block | section 6 |
| Low: packets carry only three issues | section 8 |
| Low: MDD read by a step after leak drops | section 11 |
| Low: power.py named n 54 | power.py |
| Low: the cut order could not reach Sol and particle-1 | section 10 rule 6 |
| Low: "the rewrites are our text" | section 16, unit-brief.md section 2 |
| Low: the exposure rule's "exactly one mode" | section 7 |
| Low: the repair rerun's mechanism | section 6: removed |
| Informational: cite GitHub's research terms | section 16 |
| Captain: crew line and net envelope; no paid call before caps | section 13, section 14 rule 2 |

Capy's review of PR #214 then found three issues, all fixed in this version:

| Finding | v2 |
|---|---|
| High: smoke caps sat below review-units' round admission, so the Opus autoplan smoke could never start | section 10 rule 6 and section 13: every cap covers one full round at allowance; stage 1's envelope rises to $160 and stage 2's falls to $1,410; ceo-rule.ts admission and the dry run check it |
| Medium: a contrast with no usable pairs crashed the comparison | ceo-rule.ts compare: untested (coverage) at p = 1, with an all-gap fixture in the dry run |
| Medium: one-pass cuts kept the two-pass MDD | power.py's one-pass rows; each contrast reads its MDD for its passes and retained units (section 11) |

/ship pass 1 (red team) then found four more issues, all fixed in this version:

| Finding | v2 |
|---|---|
| Critical: stage 2 coverage counted only the none rows present, so a capped item shared by none kept coverage near 1.0 | sections 6 and 11: readings carry one row per planned session, an incomplete row for a cap stop; coverage is over none's planned unit-passes; ceo-rule.ts refuses a missing none row in the headroom check and a missing none or family-arm row on a changed unit in the comparison; a dry-run case stops the Opus -p item halfway |
| Critical: stage 1's NO READ could not see sessions that never started | section 10 rule 2: gaps, unjudged reviews and incomplete sessions count against Opus none's planned readings; a dry-run case with 6 incomplete |
| Informational: a stage 2 readings file with no family fell back to every gstack arm, which could enlarge a Holm family | section 11: ceo-rule.ts refuses stage 2 readings with no family; every dry-run fixture carries one |
| Informational: stage 1's MDD line read power.txt's tau 0.0 column | ceo-rule.ts reads the tau 0.5 rows, matching section 12 |

/ship pass 2 then found four more in the new guards, all fixed in this version:

| Finding | v2 |
|---|---|
| Informational: a duplicated row was accepted, so a verdict could depend on row order | sections 6 and 11: ceo-rule.ts refuses a duplicated session row and any row outside the planned passes or units; it does not yet refuse a duplicated smoke row or duplicate unit records; dry-run refusals in both stages |
| Informational: the stage 2 family's contents were never checked | section 11: the family must name all three models, list only gstack arms and include every gstack arm that has rows; a dry-run refusal for each |
| Informational: a family arm with no rows read "not run" instead of being refused | section 11: every family arm must carry its rows, and the "not run" branch is gone |
| Informational: planned passes were inferred from the rows | section 11: readings carry each model's passes from the projection's PASS line, and the row guard and the MDD read it |

The last fix-check and the final review voices then found gaps in these checks. ceo-rule.ts does not yet refuse a row whose status is not scored, no-block, gap or incomplete (it counts as a session that ran and missed), duplicate unit records, a smoke row copied in place of another or a missing smoke row, comparison readings with no held-unit rows, readings with no lens rows, or an incomplete row that lacks a field such as leak or words (the script crashes instead). A later unit adds those checks before any paid call, the headroom check included.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
