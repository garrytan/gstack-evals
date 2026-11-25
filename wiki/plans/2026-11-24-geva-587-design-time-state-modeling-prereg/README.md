---
id: 2026-11-24-geva-587-design-time-state-modeling-prereg
kind: plan
title: "Preregistration: does modeling a feature's states at design time, before code exists, make the built code ship fewer state bugs? Eval 1 on planted real state-bug units"
summary: "Planted real state bugs, fixed Opus 5.5 builder; reviewer arms N, D, C, P, G on Opus, Sol and particle-1; judge-free composite; decides a model-check step and the diagram lines."
author: GEVA-587
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-24
status: open
links:
  - 2026-11-24-geva-586-state-machines-formal-verification-evals
  - 2026-11-15-geva-537-eng-review-planted-units-prereg
  - 2026-11-23-geva-543-eng-review-planted-results
  - 2026-11-09-geva-487-pstack-checks-prereg
  - 2026-11-17-geva-521-pstack-checks-results
  - 2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg
  - lanes/eng-planted/
  - https://github.com/garrytan/gstack/tree/d74ee528b6df9ddb945be2103a24544babe76e65
  - https://github.com/cursor/plugins/tree/ca782ed8b3c2c521cead8e1720d55c3a5dbf2347/pstack
attachments:
  - 6ceeaa09d5f3cef28f8b689bfe8e9be26ea305e0066a5191fe4776e1e027656f  power-rows.txt
---

# Preregistration: does modeling a feature's states while it is still a plan make the built code ship fewer state bugs?

## In short

gstack's plan reviews ask for a state diagram for every new stateful object, and nothing has tested whether that helps. pstack (Lauren Tan's skill pack) goes further with /statechart, a checked TLA+ model drawn as a chart. This eval asks one question with real bugs: when a reviewer models a plan's states before any code exists, does a fixed builder then ship code that passes more of the real fix's tests, and write tests that catch the real bug, than it does after a plain review?

It reuses the planted-unit harness from plan-eng-review attempt 3 (#446): a real merged bug fix, the functions it touched stubbed out, a plan that says nothing about the bug, a reviewer that improves the plan, and a fixed Opus 5.5 builder with no gstack. A machine scores the build, with no judge. Five reviewer arms run on three models, on 64 units whose real bug is about state. The result decides whether plan-eng-review gets a model-check step and whether the state diagram lines in plan-ceo-review and plan-eng-review stay.

## Approval

Garry said "Do it" on 2026-11-24 to the Captain's ask A1 (eval 1, design-time modeling, about $3,300 all-in), recorded in the Captain's approvals/2026-11-24-state-machines-fv-evals.md. The source plan is section 4, eval 1, of wiki/research/2026-11-24-geva-586-state-machines-formal-verification-evals.md (#448). This post approves no spend. No paid call runs until this post merges and the Captain records each item's cap, with its reserve mechanics, in that approvals file, and no paid call runs before 2026-11-28 06:00Z.

What changed from #448's sketch, each for a reason given where it appears:

1. G also runs on particle-1, so the C against G comparison pools over the same three models as C against N (section 4).
2. G runs without attempt 3's Stop hook, because Codex has no equivalent the lane can drive the same way, and G should be the same thing on every host (section 4).
3. The re-costed projection is about $4,000 all-in, above the $3,300 line and below $5,000 (section 11).
4. #448's open Capy Low is answered: the Decision section names what happens when a C or D gain misses its other conditions.

## 1. Question and the decisions it feeds

**Question.** On planted units built from real state-bug fixes made public after the reviewers' stated training cutoffs, does a reviewer that checks a model of the plan's states (C, or pstack's /statechart as P), or one asked to draw a state diagram (D), lead a fixed Opus 5.5 builder to a higher composite score than a plain review (N)? And does the model-check step beat gstack's current /plan-eng-review (G)?

**The gstack lines at stake,** at garrytan/gstack main d74ee528b6df9ddb945be2103a24544babe76e65 (2026-11-24, VERSION 1.103.2.0):

| File | Lines | Text, in short | sha256 |
|---|---|---|---|
| plan-eng-review/sections/review-sections.md.tmpl | 553 to 561 | "Diagrams": diagram non-trivial flows, states and pipelines in ASCII; "Failure modes": for each diagrammed path, a production failure and its test | 4f9c1c51d432b3488429ca45f43e0f9e9a75814b5632c3e61b2be2a9140e07a8 |
| plan-eng-review/SKILL.md.tmpl | 110 to 112 | "Documentation and diagrams": ASCII diagrams for flows, states, dependencies, pipelines and decisions | 92dab0f288047357ab352875ec882d03ae58db9b3ef5f68f72ec61e61f238b1a |
| plan-ceo-review/sections/review-sections.md.tmpl | 124 and 451 | "State machines. ASCII diagram for every new stateful object. Include impossible/invalid transitions and what prevents them." and "3. State machine" in the mandatory Diagrams list | 1e532b5bf5d6613a4ba3f135079aca18e67d300f9ed5ab22f3828f576ea9cf4a |

A model-check step, if one is earned, would go in at review-sections.md.tmpl 553 to 561, which autoplan's eng phase also reaches. D carries plan-ceo-review line 124 in plain words; plan-eng-review asks for the same thing in more general words.

**pstack at its current head.** cursor/plugins ca782ed8b3c2c521cead8e1720d55c3a5dbf2347 (2026-11-24) is still the head #448 read. The last commit to pstack/ is 9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc (2026-11-23, plugin 0.15.48). harness/pstack/claude-code is tree 7f8353b7412793e2dd572244f52355c52ffc2b79 and skills/statechart is tree d3d60f78916e8c17a598c39738e45ab419603f06, with SKILL.md sha256 ca7b3e43b1ddc4fb2425a33960f9390357323a869e1d921b6e2aff4f3004d55e. statechart is byte-identical to #448's read. create-formal-verification-skill and maintain-formal-verification-skill are byte-identical to c742dd61706fbacc1b95f1a20b7b988cf096ce6c, the pin #358 ran; this eval's P arm doesn't use them. statechart's script still pins tla2tools.jar 1.7.4 (sha256 936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88) and reads TLA2TOOLS and JAVA first, so #358's tools volume serves it offline.

**What this eval can't show.** Real bugs don't come with real designs. A planted unit is a few functions in an existing repository, so greenfield design stays untested and every claim names "planted units from real state-bug fixes". Many state bugs are slips a model of the plan can't see; the reach rating in section 2 keeps the units where a model could see them, and the primary also prints on units both raters call reachable. The builder is an agent, not the person /statechart writes for; eval 3 covers a person reading a chart.

## Decision

The terms. For arms X and Y, X minus Y is the mean over units and models of X's composite minus Y's, in points out of 100, pooled over the models where both ran, paired by unit and model, clustered by repository, with a 95% interval (section 7). X gains over Y when X minus Y is +10 or more and its interval's lower bound is above 0. An arm reads untested on a model when its exposure there is under 0.80 or more than 10% of its cells there are gaps (section 6). Rows read untested arms out of their pools first. An arm stopped at the interim look takes only the no-action part of any row: no row reports a gain or a loss for it or sends a brief from it (the Interim look section). The P rows read before the C rows; the D and G rows read independently.

- If an arm reads untested on a model: it leaves every pooled contrast on that model, the rows below read on what remains, and the cause goes to the Captain (an exposure failure in G goes to GStack Minder as a gstack bug).
- If P gains over N and P gains over C, pooled over Opus and particle-1: pstack's text does something plain words don't. GStack Minder gets a brief to port /statechart's idea into plan-eng-review with credit to Lauren Tan in NOTICE.md, and the C rows are not read for that fold-in. A pooled C that looks weaker only because it includes Sol is not evidence for P.
- If P gains over N but not over C: no fold-in from pstack's text, and the C rows decide. Before any later P claim, P is replicated against C on held-out units.
- If P does not gain over N: nothing comes from pstack. P minus N and P minus C are reported as they fall.
- If C gains over N, C minus G's lower bound is above 0, and C minus N's point estimate is at least 0 on Opus and on Sol each: GStack Minder drafts C's step, in C's words, for plan-eng-review's Diagrams and Failure modes (review-sections.md.tmpl 553 to 561), where autoplan's eng phase would carry it too. C against G compares two whole reviews, so a C win may come from leaving out G's other instructions; the draft ships only after a before/after skill eval of plan-eng-review with the step against plan-eng-review as it is, on fresh state units, reads the step as no worse.
- If C gains over N but does not beat G, and G also gains over N: no new step, because gstack's current review already reaches the gain. It is reported as a KEEP lead for plan-eng-review's diagram and failure-mode sections on state bugs.
- If C gains over N but does not beat G, and G does not gain over N: no step yet. The next step is a before/after skill eval of plan-eng-review with C's step added against plan-eng-review as it is, on fresh state units, because only that can show the step adds something inside the skill.
- If C gains over N and beats G, but C minus N's point estimate is below 0 on Opus or on Sol: no step yet. C is replicated against N on that model on fresh state units first, because the step would ship to that host too.
- If C minus N's lower bound is above 0 but its point estimate is under +10, with C not stopped at the interim look: no step. A real gain below the action line doesn't pay for a step that costs about twice a plain review; it is reported as a small gain and kept as a lead.
- If C minus N is +10 or more but its lower bound is 0 or below: not shown. No step, FIX-METHOD, and the MDD is printed beside it.
- If C minus N's upper bound is under +10: no modeling step from C. At 64 units a negative reading is reported as a loss; a C stopped at the interim look reports no loss (the Interim look section).
- If D minus N's lower bound is above 0, at any size: KEEP for the diagram lines in plan-ceo-review (124, 451) and plan-eng-review (SKILL.md.tmpl 110 to 112, review-sections 553 to 555). At +10 or more, users are told it helps, with the interval.
- If D minus N is +10 or more but its lower bound is 0 or below, or its interval holds both 0 and +10: not distinguished. The lines stay with no claim either way, FIX-METHOD, with the MDD printed.
- If D minus N's upper bound is under +10 and its lower bound is 0 or below, with D exposed in at least 0.80 of cells on every model: after one R48 "Why null?" cycle, the lines become CUT-CANDIDATES for the before/after skill eval, which reads them inside each skill. Garry hears it in plain words. If the upper bound is under 0, the brief says the diagram request measurably cost points.
- If G gains over N: the report says plan-eng-review helps on state bugs, beside attempt 3's no measurable difference on mixed bugs. Nothing in gstack changes.
- If G minus N's upper bound is under 0: GStack Minder gets a brief to find out why before the next stable cut, using the length and exposure lines.
- If C and P were both read (an arm is read when its exposure is at least 0.80 on at least one model, over all its counted cells, or over the cells it ran when the futility look stopped it; a stop never stands in for exposure) and neither gains over N: no modeling step goes into gstack's plan skills, any loss in an arm that ran all its counted units is reported as one, the design-time modeling question closes with a registry row, and eval 4 (the blind hunt, gated on this eval) is dropped, whatever D and G read.
- If C is read without a gain and P is untested on every model: no modeling step, eval 4 is dropped, because C carries the model check on all three models, and P is reported as untested (FIX-METHOD on the instrument).
- If P is read without a gain and C is untested on every model: no modeling step, the modeling question stays open as FIX-METHOD on C, and eval 4 waits for a repaired C run, which the Captain decides.
- If C and P both read untested on every model: the modeling question stays open as FIX-METHOD on the instrument, eval 4 is neither started nor dropped, and the Captain decides whether to repair and rerun those arms. The D and G rows still read.
- If C or P gains over N under any row above: eval 4 goes back to Garry for a go, as the approval says. A gain by D or G alone doesn't start eval 4, which tests modeling, not diagrams or gstack's review.

Public headlines use Holm across the four contrasts against N (D, C, P and G); each row above uses its own 95% interval. Per-model readings are descriptive: their MDD is 12 to 14 points (section 8), so no row except the per-model guard in the C rows reads one.

What a true effect looks like through these rows. With the pooled MDD near 7.5 points, the standard error of C minus N is about 2.7 points. A true 10-point gain passes "gains over N" about half the time, and a true 15-point gain about 97% of the time. The rows are written for the 10-point line #448 set; a true gain at that line has an even chance of a step.

## 2. Units: state-shaped planted units from real fixes

**Recipe.** Attempt 3's, unchanged (wiki/plans/2026-11-15-geva-537-eng-review-planted-units-prereg sections 2 and 3, lanes/eng-planted): a real merged fix F with a regression test in a permissive public repository, first public from 2026-07-01 to 2026-10-31; base B is F's parent with the bodies of the functions F changed stubbed and the fix's test cases removed, as a parentless one-commit tree; M is the real buggy code; F' is the fix on M. Avoid and catch grade against the real fix's failing cases and the real buggy tree. The frozen grading sandbox, the four planted-unit rules, the body and leak checks, the containment check and the 3-run recount all hold as written there.

**Training cutoffs.** Every fix was first public on or after 2026-07-01: after Opus 5.5's stated cutoff (June 2026, Anthropic's model docs) and GPT-6.2 Sol's (2026-06-01, OpenAI's model page, read 2026-11-24). particle-1's cutoff is unpublished, as in earlier evals, and its rows say so.

**The pool.** Attempt 3's frozen supply, held in org custody (custody/gstack-evals/ep-geva537, sealed to the eng-review recipient): the 131 units that survived its rebuild and its .mcp.json ruling. Units that passed attempt 3's authoring (plan, two-way audit, hint, foreseeability, hinted build) keep their authored plan and hint unchanged; units it never authored go through the same authoring; units its authoring dropped stay dropped.

**Two new screens, in this order, on every pool unit that passed authoring:**

1. **State-shaped.** Two labellers from two families, GPT-6.2 Astra and Opus 5.5, each read F's message, F's diff and the hint, and answer the state machines eval's two frozen questions with its eight-class state-shaped definition, word for word (wiki/plans/2026-11-09-geva-409-state-machines-prompt-prereg, section 2; the labeller code in lanes/outcome-skills/statemachines): a status or flag not reset; validate after mutate; a transition from a wrong state; a handler that isn't idempotent; stale state; order and lifecycle errors, races included; resumption; a step that handles only one of two crossed state changes. A unit is eligible only when both say defect and both say state-shaped. Unclear units are out. Agreement prints as Cohen's kappa.
2. **Reachable from the plan.** Two raters from two families, Gemini 4 Carbon (streamed, its default effort, attempt 3's change 4) and Opus 5.5, no tools, each see the plan, B's region files and their callers, and the hint, never F's diff, and answer yes, maybe or no to: "Could a small model of the states and transitions this plan describes reach the state the hint names?" A unit stays when neither says no and at least one says yes. The primary also prints on units both call yes. An answer without its frozen answer line is asked once more; a second unreadable answer drops the unit.

Attempt 3's foreseeability rule still applies: a unit both of its raters called unforeseeable stays out.

**Wave 2, if the pool falls short.** We don't know the pool's state-shaped share yet; the first paid step measures it. When fewer than 70 units (64 comparison and 6 calibration) pass both screens, a second mining wave runs: attempt 3's frozen search pools, continued in their seeded order past the 953 repositories already searched, through the same frame, window, sandbox, screen and recount at the harness commit that runs the pilot. It is keyless and runs on Ubicloud VMs that hold no key or sealed plaintext. It stops at the first of: a projection of 70 state units in hand (at the measured state-shaped and screen rates), the pools' end, or $100 of VM time. Its usable units then take the two screens and attempt 3's authoring, with one change: GPT-6.2 Sol writes the plan and hint, because R116 puts the newest generation in every role we choose and attempt 3's GPT-6.1 Sol is older. Every contrast prints a stratum by plan writer. A plan written by the Sol family and reviewed by Sol affects every Sol arm alike, so it biases no paired contrast.

**Sets.** Calibration (6) is drawn first from the passing units, in seeded order, at most 3 units a repository, so the pilot can run while wave 2 does. Comparison (64) and reserve (6) follow when the draw can fill. With fewer comparison units the run goes down to a floor of 48, with the MDD printed again; under 48 it stops for the Captain (SUPPLY SHORT) and nothing in gstack changes. A reserve unit replaces a comparison unit lost to infrastructure, in seeded order, recorded.

## 3. The reviewers and the builder

**Review stage.** Attempt 3's review container and settings for Claude Code (Claude Code 2.1.314, the claude-code-preset system prompt, a 200,000-token window, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, web tools denied, the metering proxy as the only way out, no key in the container, CLAUDE.md, AGENTS.md and .claude/ stripped at any depth). The session sees /work/repo at B (one commit, no remote) and /work/plan.md. Session limits: $10, 200 turns and 90 minutes, the same for every arm.

- **Opus 5.5** in Claude Code, at attempt 3's settings.
- **GPT-6.2 Sol** in Codex CLI 0.170.0, through the skill-pack head-to-head's Codex session layer (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg, Part S): codex exec --json with model, effort and provider set in the session's CODEX_HOME config, the metering proxy's Responses route, bundled system skills, web search, the update check and analytics off, and no .codex, .agents or AGENTS.override.md in the tree.
- **particle-1** (particle-ai/particle-1) in Claude Code through OpenRouter, routed to the Particle AI provider only, data collection denied, through the metering proxy, as that plan's Part P ran it. A call served by another provider stops particle-1's items for the Captain.

**Tools volume.** #358's read-only volume on every review session in every arm: a pinned Temurin JDK 21, tla2tools.jar 1.7.4 at the sha256 above, and a pinned bun, with TLA2TOOLS and JAVA set and bun on PATH. N, D and G get it unused, so the environment is the same everywhere.

**Any question** a reviewer asks gets the one fixed reply "Go with your recommendation." in every arm.

**The builder** is attempt 3's build stage, unchanged: Opus 5.5 in Claude Code at the same pin, no gstack, no tools volume, in the unit's image, reaching only the metering proxy and the sandbox sidecar, $16, 400 turns and 180 minutes. Its prompt: "Implement the plan in plan.md in /work/repo, with tests. A reviewer's notes on the plan are in /work/review/; use them as you see fit." then the statement note. It never sees F, the hint, hidden tests or another arm's output, and is never told which arm reviewed.

**What the builder gets.** The review's final plan.md is mounted as /work/plan.md. The review's final reply and every text file the session wrote outside /work/repo (under /work and /tmp: a TLA+ spec, a config, a chart, a report, gstack's test plan) go under /work/review/ in a fixed order, the whole bundle capped at 12,000 words, with truncation counted per arm. Edits a review made under /work/repo are discarded and counted.

## 4. Arms

Every arm ends with attempt 3's common line: "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it. Leave the improved plan in plan.md." The lines before it:

| Arm | Before the common line | Installed | Models |
|---|---|---|---|
| N, no gstack (R44) | nothing | nothing; no drive and no gstack or pstack path in the container | Opus, Sol, particle-1 |
| D, gstack's diagram line in plain words | "For every new stateful object, add an ASCII state diagram to the plan. Include impossible or invalid transitions and what prevents them." | nothing | Opus, Sol, particle-1 |
| C, pstack's steps in plain words | "Write a small TLA+ model of the states this plan adds, write each rule as an invariant, check it with TLC, change the plan to fix each counterexample, and add to the plan a code test that replays each counterexample. TLC is installed: $TLA2TOOLS names its jar and $JAVA its Java." | nothing | Opus, Sol, particle-1 |
| P, pstack as published | "/statechart model the states this plan adds and the rules they must keep, then improve the plan." | pstack at the pin above, as a Claude Code plugin directory through the stack arms' installer | Opus, particle-1 |
| G, gstack at main | Claude Code: "/plan-eng-review plan.md", then attempt 3's forced sentence. Codex: "$gstack-plan-eng-review plan.md", then the forced sentence | gstack at d74ee528, default install on Claude Code; ./setup --host codex on Sol, with model "gpt-6.2-sol" seeded in CODEX_HOME's config for setup and removed after, as the head-to-head did | Opus, Sol, particle-1 |

**P on Sol is left out.** pstack publishes a Claude Code harness (harness/pstack/claude-code) and no Codex harness at this pin. Running its files as Codex skills would not be pstack as published, and running Sol in Claude Code would break the rule that Sol runs in Codex CLI (R110). C carries pstack's steps on Sol.

**P's command.** statechart sets disable-model-invocation, so it runs only when typed, and the task turn opens with it. If the pinned Claude Code doesn't resolve /statechart, the dry run switches to /pstack:statechart, which loads the same file, and records it (#358's rule).

**G and the Stop hook.** Attempt 3 held its skill arms with a Stop hook. Codex offers no hook the lane drives the same way, so G runs with no hook on every model, with GSTACK_SESSION_KIND=unattended and the forced sentence, and its exposure is gated (section 6). Attempt 3's standalone arm read exposed before any block in 165 of 192 sessions. G at d74ee528 has the same detector strings: attempt 3's precut detector, checked keylessly against d74ee528's files on 2026-11-24, reports no missing string. G on Sol uses the Codex install's own skill mention, the form the head-to-head found injects a gstack skill's body on Codex 0.170.0.

**Clean by construction.** N, D and C have no gstack and no pstack installed and no drive mounted, by attempt 3's plain container. A read audit after the run counts any gstack or pstack path read per arm, reported as a descriptive check.

## 5. Scores

Attempt 3's, unchanged (its section 5). Each build's final tree is graded in the unit's pinned image under the frozen sandbox, 3 runs, hidden tests restored.

- **Avoid:** the share of the unit's planted cases that pass in at least 2 of 3 runs.
- **Catch:** 1 when one of the build's own new or changed test cases, moved onto M and onto F' with product files at their real content, fails in all 3 runs on M (by the assert class or the crash rule) and passes in all 3 on F'; else 0. A build whose transplant drops scores 0, and a sensitivity reading leaves it out.
- **Primary:** composite = (avoid + catch) / 2 per build. A unit's score for an arm and model is the mean of its 2 builds. No component rule: attempt 3's pilot read both components in band, and this pilot re-reads only the composite's level (the Pilots section).
- **Session outcomes.** A review or build that ends with an upstream or infrastructure error (a 5xx, a timeout, a dropped connection, a host fault) gets one fresh retry, then it is a gap. A review that ends in a gap leaves its build unbuilt. A model's refusal and a provider's safety-filter stop are results, never gaps: the build takes plan.md as the review left it, and each is counted per arm and model apart from model failures (R38, R95). A limit stop is scored as it stands. A cap stop is an incomplete run, never retried to change a verdict. Every verdict also prints the reading with gaps scored 0.

No model judge scores anything. #448's judged "the plan named the planted condition" secondary is left out, because attempt 3's version failed its check.

## 6. Exposure: did the part under test run?

Each detector reads only what the session left behind, keyless, and is frozen with keyless fixtures in the dry run.

| Arm | Exposed when |
|---|---|
| N | nothing to expose; the read audit shows no gstack or pstack path |
| D | the final plan.md, which the builder implements, holds a new block of 3 or more consecutive lines with arrow or box characters (->, -->, =>, the Unicode arrows and box-drawing set) that the authored plan lacks, with at least two distinct labels joined by an arrow; a diagram only in the reply doesn't count |
| C | a shell call ran TLC (tlc2.TLC, tla2tools.jar, or a script that runs it, on #358's frozen pattern list) and its output reached a model-checking result: TLC's states-generated line, a completed check, or a violated invariant, property or deadlock with its trace; a run that ended on a parse, config or setup error doesn't count |
| P | statechart's SKILL.md body reached the session (the expanded command or a read by any tool), and TLC or statechart's script ran to a model-checking result as C's row defines it |
| G | attempt 3's precut procedure detector, re-pinned to d74ee528's digests (Scope Challenge, Sections 1 to 4 in order, the coverage diagram and the test-plan file) |

For each arm and model, the pilot needs 5 of 6 sessions exposed. In the counted run an arm and model under 0.80 exposed at the end reads untested. On Codex the detectors read the rollout file's exec calls and messages in place of Claude Code's transcript. Every contrast also prints split by exposure, and every P and G result says it is measured given an explicit invocation.

## Pilots

On the 6 calibration units, one review and build cell per arm and model: 84 cells. Calibration units are never comparison units, so nothing the pilot reads touches a counted contrast. Budgets are each arm's counted cells summed over its models (section 11).

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| N, no gstack | $411 | $41 | the read audit finds no gstack or pstack path in its sessions; N's composite pooled over its 18 builds sits between 0.15 and 0.75 with a lower bound at most 0.65 | none | 6 calibration units pass both state screens, build and grade in the frozen sandbox, and at least 48 state units are in hand or projected when the pilot reads |
| D, diagram in plain words | $463 | $46 | a new state diagram in at least 5 of 6 sessions on each model, and the builder opened /work/review/ in at least 5 of 6 | none | the same 6 units and the same supply count |
| C, model check in plain words | $749 | $74 | TLC ran in at least 5 of 6 sessions on each model, and the builder opened /work/review/ in at least 5 of 6 | none | the same 6 units and the same supply count |
| P, pstack /statechart | $461 | $46 | statechart's body arrived and TLC or its script ran in at least 5 of 6 sessions on Opus and on particle-1 | none | the same 6 units and the same supply count |
| G, gstack /plan-eng-review | $814 | $81 | the procedure detector fires in at least 5 of 6 sessions on each model | none | the same 6 units and the same supply count |

**The pilot also reads:** limit stops, the 95th-percentile review cost, and refusals per arm and model. If more than 1 of 6 sessions of any arm and model hits a limit, or that arm's 95th-percentile review cost passes half its allowance, every review allowance doubles for every arm before the counted run, through a dated change.

**A failing arm** gets one named harness-side repair and its pilot sessions rerun inside its pilot cap. If it still fails, it is left out of the counted run on that model and reported as left out (R111), and the Decision rows read without it. A failure that is the model's own choice (it loaded the skill and chose not to run a checker) is reported and never fixed, because changing an arm's text after the pilot would be tuning. N's level out of band stops the run for the Captain as FLOOR or CEILING (R61), before any counted spend.

**Start rule** (eval-loop practice 4). After the pilot and again once the comparison draw is fixed, power.py's fit re-prints each pooled MDD the Decision rows read (D, C and G minus N, C minus G, P minus N and P minus C) from N's measured level and build variance, at the drawn unit count and on the models each arm is still eligible on after the pilot. If the C minus N or D minus N MDD passes 10 points, the question goes to the Captain before any counted cell. A P contrast whose MDD passes 10 is printed beside its rows, and its report says the design can't detect a 10-point P effect. The pilot reads no contrast, so this rule compares the MDD with the decision line of 10 points.

The pilot sends its readout to the Captain, and the counted run starts on the Captain's go.

## Judge check

Judge: none

## 7. Analysis

- **Pairing and weights.** A pair is a unit and a model, and it counts when both arms have a scored unit score there. For each contrast, X minus Y is the mean over its models, each weighted equally, of that model's mean over its counted pairs of X's unit score minus Y's. Gaps change only how many pairs a model's mean holds, never the models' weights.
- **Interval and test.** A 95% two-stage cluster bootstrap interval (repositories, then units within them, every model's cells of a unit kept together; 10,000 draws; a seed minted from random bytes before the pilot is read and recorded), recomputing the same model-weighted statistic in every draw, and a two-sided cluster sign-flip p on the same statistic: each repository contributes, on each model, its pairs' differences divided by that model's count of pairs, and the flip changes the sign of a repository's whole contribution. Each is printed with the count of pairs that got worse and the count of repositories.
- **Contrasts read by the Decision rows:** D minus N, C minus N, G minus N (pooled over the three models); P minus N and P minus C (pooled over Opus and particle-1); C minus G (pooled over the three models); C minus N per model on Opus and on Sol.
- **Holm** across D, C, P and G minus N for any public headline.
- **Secondaries,** with intervals and no verdict words: every contrast per model; avoid and catch apart; catch with transplant drops left out; exposed sessions only; units both reach raters called yes; strata by state class, language, region size, plan writer and popularity; review words with a length-adjusted line; cost per cell.
- **Why null.** Any null or negative reading gets R48's cycle (did the model use it, do the tasks fit, enough samples and headroom, does the frontier model already do it unaided) before its verdict word.

## 8. Power and MDD

The MDD is the smallest pooled difference the sign-flip test finds at 80% power, alpha 0.05 two-sided, from attempt 3's frozen power.py (lanes/eng-planted/readings/power.py at main 0174cc06, unchanged), run with no other flags than its --rows design. power-rows.txt in this bundle is its output. Its ranges cover control levels of about 0.32 to 0.46 composite, build SD 0.5 and 1.0, and an unmovable share of 0 and 0.2.

| Reading | Design power.py simulates | MDD, composite points |
|---|---|---|
| per model, 64 units x 2 builds | 64x2 | 12 to 14 |
| pooled over 2 models (P minus N, P minus C) | 64x4 | 9 to 10 |
| pooled over 3 models (D, C and G minus N; C minus G) | 64x6 | 7 to 8 |
| floor: per model at 48 units | 48x2 | 14 to 16 |
| floor: pooled over 2 models at 48 units | 48x4 | 10 to 12 |
| floor: pooled over 3 models at 48 units | 48x6 | 9 to 10 |

The pooled rows assume independent builds: they treat each reviewer model's two builds as two more builds of the same unit with the same effect, and power.py has no review-by-unit term that one model's builds on a unit would share. So the direction of their error is unknown, and they may understate the MDD. Before the pilot, power.py's fit is re-printed with a shared review-by-unit term, and the start rule applies to that re-print: a C minus N or D minus N MDD over 10 points goes to the Captain before any counted cell. Attempt 3's realized MDDs came in below its simulated design (7.6 and 8.3 against 10 to 11 at 64x3). The smallest effect worth acting on is 10 points. On these rows, the pooled designs detect it at 64 units, and at the 48-unit floor too, except the two-model P contrasts, whose MDD reaches 12.

## Interim look

Planned paid spend: $2,898
At: half the comparison units drawn, in seeded order, rounded down (32 at 64 units, 24 at the 48-unit floor), with every cell of those units scored
Stop bounds: futility only; C and P stop their remaining cells if the pooled 95% upper bounds of both C minus N and P minus N sit below +5 points, or, when one of the two arms reads untested on every model, if the other's upper bound does; with both untested there is no stop; N, D and G always finish; no stop for a gain, so the final tests keep alpha 0.05
Other looks: none

Cells run interleaved in seeded unit order, so the look has every arm's cells on its units. The look reads only the two upper bounds above and each arm's exposure so far, as the share of its scored cells on each model that are exposed; an arm under 0.80 on every model at the look counts as untested there. If the stop fires, C and P read "stopped for futility": the rows that take no action fire for them (no modeling step from C, nothing from pstack), and each counts as not gaining over N in the no-gain row, so that row can still close the design-time question and drop eval 4. That is the stop's purpose: it ends the C and P cells only when neither can reach +5, half the 10-point line, and their estimates and intervals at the look print as description only. No row that claims a gain or a loss, or sends GStack Minder a brief, reads a stopped arm, because the stop chose those results and their intervals are not adjusted for it. The N, D and G rows read on every drawn unit as planned, and C minus G prints as description only. Cells a stop leaves unrun are not gaps: they leave the exposure and gap denominators, so a stopped arm's exposure and gap shares count only the cells it ran. If the stop does not fire, every row reads on every drawn unit; the futility-only look never rejects, so it adds no false positive to those tests.

## 9. Order and stops

1. This prereg merges; the Captain records each item's cap and reserve mechanics in the approvals file.
2. Harness on the results branch (section 10), its keyless dry run, and a read-only second-family review of the harness diff (GPT-6.2 Astra). Runs then go from commits on that branch, so the results PR keeps a merge commit.
3. From 2026-11-28 06:00Z: rebuild the pool from custody and check each unit against its sealed digests; the two state screens on the pool; the calibration draw; wave 2 if needed, alongside the pilot.
4. The pilot, its readout to the Captain and the start rule.
5. On the Captain's go: the comparison draw and the counted cells, with one ledger lease per arm and model, the first session of each item alone (the first-session rule: a re-projection past the item's cap stops that item for the Captain), and the look at half the drawn units.
6. Analysis, the results PR.

**Spend stops.** If the running all-in projection (settled spend plus each open item's re-projection, crew included) passes $5,000, the run stops for the Captain before spending past it, because Garry gets a heads-up there (R42). A draw on the reserve, a cap raise or a projection past the recorded line comes to the Captain before spend.

**Custody.** The unit list, labels, ratings, plans, hints, case ids and every transcript are held-out material: sealed with age to the eng-review recipient, stored in org custody, never committed. The public repo gets this plan, the harness, counts and digests. Every VM is destroyed when its work ends.

## 10. Harness: what the run branch builds

All in lanes/eng-planted, reusing its stages, ledger, builder, grader and readings. Each part gets keyless tests under tests/ep/, and the dry run drives every frozen rule before any paid call.

- **Arms:** D, C, P and G beside the lane's plain arm (N), with the tools volume on every review session and pstack's plugin mount for P through the stack arms' installer.
- **Reviewers on three models:** the Codex session layer from the skill-pack head-to-head for Sol, and particle-1's Claude Code route, in the review stage. The builder stays Opus.
- **Review bundle:** collecting the session's own files from /work and /tmp into /work/review/.
- **Detectors:** section 6's, with fixtures for each side of each threshold (4 and 5 of 6; 0.79 and 0.80).
- **Supply:** the state-shaped labels (the state machines eval's labeller, reused read-only), the reach rater and its prompt, and wave 2 on the lane's miner and screen.
- **Readings:** the pooled contrasts, the Decision rows in their order, the look and its stop, Holm, and power.py's fit at 64x6.
- **Dry run cases** include: each Decision row on both sides of its lines (+9.9 and +10.0; a lower bound at 0.0 and 0.1; per-model points at -0.1 and 0.0); an untested arm leaving its pools; the look's stop at upper bounds of +4.9 and +5.0; a refusal built as left; an upstream error retried once then a gap; P resolving /statechart and TLC offline in a unit image; G's skill injected on Codex; one ledger lease opened and settled per item on a temporary ledger; and a driven launch of a review and a build on each model against a stub upstream through the real launcher and teardown.

A rule the run needs that this plan leaves out goes in by a dated change before the data it could touch, never after.

## 11. Money

Planning figures, per review and build cell. Opus comes from attempt 3's measured cells (plain $0.93, standalone $2.63; builds $0.45 to $0.77). D, C and P on Opus are estimates from plain's cost and #358's 2.4 to 8 times for pstack's chain. Sol reviews use attempt 3's planning figures for Sol; particle-1's reviews are cheap and the Opus build dominates. The first-session rule replaces each figure with a measured one.

| Model | N | D | C | P | G |
|---|---|---|---|---|---|
| Opus 5.5 | $0.93 | $1.05 | $2.15 | $2.65 | $2.63 |
| GPT-6.2 Sol | $1.72 | $1.95 | $2.85 | not run | $2.71 |
| particle-1 | $0.56 | $0.62 | $0.85 | $0.95 | $1.02 |

Counted cells: 64 units x 2 cells per arm and model, 14 arm and model pairs, 1,792 cells: about $2,898. Opus about $1,204, Sol about $1,181, particle-1 about $512.

| Item | Projection | Cap |
|---|---|---|
| Supply: state labels and reach ratings on the pool and wave 2, wave 2's authoring | $180 | $220 |
| Pilot: 84 cells on 6 calibration units | $136 | $165 |
| Counted cells: one item per arm and model | $2,898 | $3,478 |
| Hosts: wave 2 screen (at most $100) and the run host | $150 | $200 |
| Crew threads: this thread to merge, the run and results thread | $650 | $700 |
| Reserve, held by the Captain | | $150 |
| **All-in** | **about $4,014** | **$4,913** |

This is about $700 over the $3,300 line #448 gave, for three reasons: G on particle-1 (about $131), Sol review figures above #448's guess, and supply and crew lines #448 left rough. Arms, cells and power are sized for the question, so the plan doesn't trim them (R71). If the look stops C and P, about $600 of the counted line goes unspent. The spend order keeps the early risk small: supply and the pilot cost about $316 before any counted cell.

## 12. Risks and limits

- **Supply.** The pool's state-shaped share is unknown. Wave 2 may not reach 64, and under 48 the run stops.
- **Proxy design.** A plan for a few functions in an existing repository is not a new feature's design; claims name planted units from real state-bug fixes.
- **Catch transplant drops.** Attempt 3 lost a quarter to a third of catch to tests that couldn't move onto the buggy code, more in skill arms. The drops-left-out sensitivity prints beside every contrast.
- **Contamination.** Fixes postdate the reviewers' stated cutoffs, but the buggy code may predate them; that pushes every arm toward the original bug alike.
- **Forced invocation.** P and G open with their command; users may not. Every P and G line says so.
- **G without a hook** may run its procedure less fully than attempt 3's standalone arm. Its exposure prints beside it.
- **Reused authoring.** Attempt 3's plans were written by GPT-6.1 Sol and wave 2's by GPT-6.2 Sol; the plan-writer stratum prints.
- Not in scope: changing gstack or pstack, posting, and evals 2 to 4.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project. pstack is Lauren Tan's work (MIT), published in cursor/plugins.
