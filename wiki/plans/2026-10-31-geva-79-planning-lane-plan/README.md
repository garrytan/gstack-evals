---
id: 2026-10-31-geva-79-planning-lane-plan
kind: plan
title: "Planning lane: do gstack's plan reviews catch more plan flaws, and lead to better builds, than no gstack?"
summary: "Plan for a planning eval lane: each gstack plan review against a no-gstack arm on its own lens, CEO review first, by known-flaw replay on sealed panels, then downstream builds judged by hidden tests."
author: GEVA-79
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-31
status: done
links:
  - 2026-10-30-gsta-40-review-noloss-plan
  - 2026-10-30-geva-59-stacks-round-1-plan
  - 2026-10-31-geva-76-stacks-round-1-prereg
  - 2026-10-31-geva-65-lanea-shakedown-rerun-results
  - 2026-10-30-gsta-30-laneb-quick-3-results
  - 2026-10-27-gsta-4-public-task-sourcing
  - lanes/review-noloss/README.md
  - src/trial/review/told.ts
source: "Plan reviewed by gstack /autoplan run autoplan-20261031164739 (plan snapshot sha256 0456ae414549101a2b29089ab4efc5107155e1de40ebac1c3768b2f154942549), approved at gate_rev 1 with Garry's reply 'Do it', relayed by the Captain (GEVA-2). The Implementation plan section is the reviewed text. review-record.md is the run's public export with em dashes replaced by hyphens; dryrun.md is the keyless dry-run report with machine paths shortened to $D."
attachments:
  - 4d0a8efaa2fd844e1abfa77d896e314c7670e562ecf3ef796203c3fb848792f7  dryrun.md
  - d0492a1e7aa4c497b94f669b792169936c31d36b304b29bf7cf7f7e94a34f213  review-record.md
---
# Planning lane: gstack's plan reviews against no gstack

Plan v1, 2026-10-31. Author GEVA-79 for the gstack-evals Captain (GEVA-2), working for Garry Tan, issue GST-515.

Garry, 2026-10-31, after the review no-loss lane showed gstack's full review finding 33 of 41 known bugs against 13 for plain Opus: "Ok great. At least we are better at that. Can we show we are better at planning too?" Then, the same day: "I think that the plan and review is extremely important. Plan CEO review, I use very, very frequently and rely on it. Plan design review is great for UX and design, and plan DevEx review is really important for API companies. So, these things are really important and you shouldn't forget about them."

Inputs read: the GSTA-167 no-loss results and prereg (org drive handoffs/GSTA-167/noloss7-results.md, noloss-prereg.md), the review-noloss plan and lane code, the stacks round 1 plan, prereg and review record, the Lane A shakedown prereg, addenda and rerun results, the Lane A grader audit, Lane B quick look 3, the public task sourcing brief, the U14 mining rules, gstack's planning skills at v1.91.373.0, and every plan in wiki/plans/ with its review record. Nothing here builds the lane or spends money.

## Approval

Approved at autoplan gate_rev 1 (run autoplan-20261031164739, rec_hash 5a84ff4b90cf) on 2026-10-31. Garry's reply, relayed by the Captain (GEVA-2, GST-515): "Do it". That takes every recommendation: A1 keeps standalone /plan-ceo-review as the gstack arm, with the harness fixes in item 3 below; B1 keeps a single reading, with the panel and harness reusable by the before/after skill eval later; C1 keeps the plan's direction, with power gates as rules (item 9); D1 adds no Sonnet cell until a lens shows a gain; E1 approves. The review ran one round per phase (CEO and Eng, two voices each: Opus 5.5 native, gpt-6.1-sol outside; UI and DX scope off), so findings left open at the cap are listed in the next section.

## Open at approval: what the build and the prereg must settle

This section was written after the gate and was not reviewed. The review left 1 Critical and 14 High findings that no gate item covered (one round, at the round cap; escalate line "evidence sufficient, decision needed"). Each one is listed here with the step or rule that settles it. Where an item conflicts with the reviewed text below, the item wins. Finding ids are the run's (ceo-native, ceo-outside, eng-native, eng-outside).

**Critical**

1. **Sealed keys must not enter the public repo (eng-native F1).** The pinned scorer reads suites and catalogs only from inside the repo, so registering the panel there, as section 11's B1 says, would commit its answer keys. B1 instead adds a sealed-root option read by suite --check, judge-packet, judge-join, score and export; the repo holds only a stub suite (id, sealed flag, counts, digest); a test refuses an in-repo sealed catalog; and the results PR commits the export table and digests only.

**High**

2. **A failed pass must score as a miss, not stop the arm (eng-native F2, eng-outside F2).** review-units marks a whole arm stopped after one malformed or timed-out pass (run.ts:317), and a stopped arm gets no verdict. B2 adds a frozen plan-mode option: malformed, incomplete and timed-out passes are written as M with coverage complete and a diagnostic note; stopped is kept for cells not run and cap stops; the findings fence gets its own info word; the prereg sets the timeout from the pilot; and B7 runs fake sessions through run.ts to the scorer.
3. **The plan reviews are interactive, and the harness must let them finish (eng-native F3; the harness half of ceo-native F1).** B4 runs every arm under the interactive driver with the rec user. The user declines chaining to another skill and declines promoting or committing docs. Writes are allowed in the unit tree, a throwaway home and a throwaway GSTACK_STATE_ROOT per trial. The user simulator is calibrated per model, and a pilot check confirms each gstack session reached its review output.
4. **No hidden second model in the gstack arm (eng-native F4).** R1a cells run no outside voice; B7 asserts that each arm's models list holds only the driver model. Any /autoplan claim in R4 names both model families.
5. **The CEO taxonomy echoes the skill's own checklist (ceo-native F2).** Section 4's taxonomy overlaps /plan-ceo-review's own steps (proxy measures, existing code, one-way doors), so it is home-field in part. The cross-family author also writes a second taxonomy blind to this plan and to gstack. Half the seeded flaws come from each, every flaw is tagged by source, recall is reported per source, and any claim names the source it rests on.
6. **Scope-expansion mode (ceo-native F3).** Auto-decided mode selection can put greenfield plans into expansion mode, which collides with the over-scope flaw. Each gstack session's mode is recorded, the panel is balanced across greenfield, added-capability and fix plans, and recall is reported by mode. Any value of scope expansion is added to "not claimed". R1b reports revised-plan size and builder cost per arm.
7. **False alarms gate the claim instead of only rewording it (ceo-native F4, ceo-outside F1, eng-outside F5).** The false-alarm reading is decoy-only, with an explicit denominator. A CEO "better" claim is made only when gstack's excess must-fix false alarms per decoy stay within a preregistered margin (1 per plan). Must-fix findings ruled not-defect across all scored plans are also reported. Volume-matched recall (each arm's first k must-fix findings, k frozen) is a sensitivity reading that must agree in sign. B7 proves that a synthetic "flag everything" arm fails the gate. Decoys rise to 12 if the cap allows.
8. **The downstream handoff must carry only the plan (ceo-outside F2, eng-outside F4).** Every builder input is built from the pinned base code plus one validated regular file, plan.md: no git history, no reviewer state, no other edits, no symlinks. Digests are recorded, and tests cover reviewer source edits, extra notes, symlinked plans and history-only leaks.
9. **Power admission for every claim (ceo-outside F3, the substance of gate item C; ceo-native F5).** Each round's prereg states a smallest worthwhile effect and a power simulation for its real families and clustered outcomes. Minimum eligible counts hold after exclusions and panel cuts: 20 seeded plans per lens for replay. R1b is labelled exploratory unless its prereg shows 80% power at the stated effect.
10. **A plan finding contract the parser keeps (eng-outside F1, eng-native F11).** The finding shape has file plan.md, a stable section identity and a fix. The parser keeps those fields, native severity labels stay and map through arm.json severity_map, an end-to-end test covers the exact prompt output, and code-review behavior is unchanged.
11. **Judges need evidence and context (eng-outside F3, eng-native F9).** The plan judge packet carries redacted evidence, the section identity and equal access to a digest-bound sealed copy of the plan and context. It renders claim, evidence and fix only, strips a frozen list of gstack skill heading words, and the round reports a judge identifiability probe on a sample.
12. **Correlated flaws in one plan (eng-outside F6, eng-native F10).** Section 12's power assumed independent flaws and plain recall of 0.35. The eng outside reviewer's rerun with plan-shared dependence dropped power at 24 seeded plans from 94.1% to 63.9%. So B1's power option adds within-plan dependence, the prereg reruns power at the pilot's measured recall over a range of dependence, and 24 seeded plans is a floor: the panel size freezes after the pilot.

**Medium and Low, settled the same way**

- Per-arm model lists, so lens runs only on Opus and placebo only on particle-1 (eng-native F5): B3.
- R1b's reviewer, builder and hidden-test pipeline gets its own build steps and a keyless dry run before its prereg (eng-native F6).
- Plan cases become a kind in the one catalog loader, not a second schema (eng-native F7).
- Matching is on the cause, with the section as evidence, and judging uses the plan as it was before the session (eng-native F8).
- The prereg splits the Holm family: opus none against gstack in both directions as the primary family, and particle-1, lens and placebo as a secondary family (ceo-native F6).
- Cost re-anchors at gstack's own $5 reservation per CEO session, and the prereg shows the panel the $600 cap buys at that rate or asks for more (ceo-native F8).
- If the build slips, the lens and placebo arms move to an R1a-2 on the same panel, and the none and gstack pair stays on the critical path (ceo-native F9).
- The real-flaw search widens to Captain drive reports, superseded posts and other garrytan repos before B5 freezes (ceo-native F10). The real-neutral stratum is reported alone, and the headline is seeded-only (ceo-native F11).
- Claims say "against bare Claude Code with bundled skills off" (ceo-native F12).
- Sealed runs set OpenRouter data collection to deny, and the prereg records provider retention terms (eng-native F12).
- Any pilot-driven change to the panel, primary outcome or size merges as an amended prereg before full-run sessions (ceo-outside F5).
- Main's #96, merged after the dry run, adds `noloss derive` (a derived suite, comparisons file and arms with units dropped, plus a severity map). B7 uses it for the missing-cell sensitivity reading and the dropped-rung file instead of writing a new derive script, so section 12's "no derive tool exists" no longer holds.

Gate items A to D kept the plan's direction (ceo-native F1 and F7, ceo-outside F3 and F4); items 3 and 9 above carry their substance.

## Implementation plan

### ELI5

gstack has tools that read a plan before anyone builds it and say what is wrong with it. Garry uses the CEO one most: it asks whether the plan builds the wrong thing, or the right thing badly. We want to know if these tools catch more real problems than the same AI asked plainly, "review this plan for problems", with no gstack at all. So we write plans with known problems hidden in them, sealed so no one can peek, and give each plan to both. We count how many hidden problems each one flags as must-fix, and we also count false alarms on plans that have no hidden problem. We do the CEO review first, then the developer-experience review, then the design review, then the engineering review and the full /autoplan chain. After the CEO count, a second test hands each reviewed plan to the same fixed builder and lets hidden tests decide whether the thing it built is the thing users needed. If gstack's review loses or ties, we say so.

### Before → after

Before: the only gstack planning number is Lane A's office-hours run on Opus 5.5 (0.67 to 0.76 with the skill, 0.36 without it, 11 tasks). Those tasks score office-hours' own behaviors (does it challenge premises, offer alternatives), not whether a plan got better, and its "none" arm still had the rest of gstack installed. No lane measures /plan-ceo-review, /plan-devex-review, /plan-design-review, /plan-eng-review or /autoplan against no gstack, and nothing measures whether a reviewed plan leads to a better build.

After: one lane, four lenses, each with its own sealed flaw panel and its own no-gstack comparison, scored by the review-noloss lane's pinned scorer (paired by flaw, clustered by plan, Holm across the family, two-sided so gstack can lose). The first number is CEO review against plain, on Opus 5.5 and particle-1, targeted for 2026-11-05. A downstream reading for the CEO lens follows, where a fixed builder executes each reviewed plan and hidden acceptance tests decide. Devex, design, eng and /autoplan follow in that order, each with its own preregistration and cap.

### Why it matters

Garry relies on these reviews every day, and gstack is about to keep tuning and cutting them. Without a measurement, a review that adds nothing over a plain prompt costs tokens and time on every plan, and a cut that removes the part that works goes unnoticed. The code review result showed gstack can be far ahead of a plain prompt; it says nothing about plans. A plan flaw is also the most expensive kind: a plan that builds the wrong thing wastes the whole build. If the reviews win, we know which lens wins and by how much. If they don't, the null goes to the harder-task track or the cut track, as the crew rules say.

### What caused this work

The review no-loss lane landed its first clear result on 2026-10-31: gstack's full review found 33 of 41 known blockers, plain Opus with a one-line prompt and the diff found 13 (21 losses, 1 gain, two-sided p 0.000015, descriptive). Garry asked whether planning shows the same, and then named the plan reviews as the part he relies on. Garry's rule of the same day requires a no-gstack arm in every head-to-head.

### Big decisions

1. **Round 1 tests /plan-ceo-review alone, by known-flaw replay.** Garry uses it most, and replay is the direct analog of the review lane that just worked: cheap, paired, and scored by a scorer that already exists. Devex, design, eng, /autoplan and /office-hours follow in later rounds (section 1). Flip: if the Captain wants one broad number first, run /autoplan on a mixed panel instead, at several times the cost per session and with no per-lens answer.
2. **The headline panel is seeded by a non-gstack author, with real flaws beside it, and gstack's own fixtures kept apart.** Real plan flaws found after approval exist, but this repo has only 2 for the CEO lens, 2 for devex, 0 for design and 7 for eng. So each lens gets about 24 sealed plans, each carrying two flaws written by a cross-family author who never sees gstack's skill text, plus clean decoy plans. The real flaws join the headline as a labelled stratum. gstack's own planted-flaw fixtures are home-field and reported alone, never in the headline (section 4). Flip: a source of 20 or more real, neutral flaws per lens.
3. **Arms: none, gstack told, a lens-named plain prompt on Opus, and a placebo on particle-1.** none is Garry's required arm: same model and harness, nothing installed, "Review this plan for problems." gstack opens the same prompt with the skill's command. The lens arm (Opus only) adds one line naming the lens from the skill's own description, which tells us whether the skill's body adds anything beyond its name. The placebo (particle-1 only) is Lane B's length-matched tree, since Lane B saw placebo effects on cheap rungs (section 2). Flip: drop the lens arm to save about $40 per round.
4. **Primary outcome: must-fix recall, guarded by false alarms.** A flaw counts as caught when the arm flags it Critical or High. Unmatched must-fix findings are adjudicated blind as real new defects or not, and clean decoy plans measure false alarms, so an arm cannot win by flagging everything (section 5). Flip: if both arms rarely rate anything Critical or High in the pilot, score any-severity recall as primary.
5. **The simulated user takes every recommendation.** The plan reviews are interactive. Every arm gets the same user, who answers each question with "Go with your recommendation", the way Garry answers gates (section 3). Flip: a lens whose skill cannot finish without real answers gets per-task scripted replies, as Lane A does.
6. **A downstream reading follows each replay where a fixed builder can run.** For the CEO lens: authored tasks with hidden acceptance tests, where the draft plan builds the wrong thing. The reviewer revises the plan, and a fixed builder (Opus 5.5, no skills) builds from the revised plan without seeing the context the reviewer saw, so only the plan differs (section 6). Flip: mined feature PRs, which suit the eng lens but carry no CEO-lens flaw and are mostly home-field.
7. **Models: Opus 5.5 in every cell, particle-1 as the fixed rung.** Sonnet, Haiku, DeepSeek and the open-weight slots join only after a lens shows lift, for cost. Haiku 5.5 appears once, as the devex round's fixed "developer" instrument, because a weaker developer feels friction a strong one routes around (section 7).
8. **Caps and order.** Each round is its own preregistration and cap: R1a CEO replay $600, R1b CEO downstream $800, R2 devex $1,300, R3 design $550, R4 eng, /autoplan and office-hours $2,000, about $3,200 projected in total. The first plain-vs-gstack CEO number is targeted for 2026-11-05 (sections 9 and 11).

### 1. What planning covers, and what each round tests

gstack's planning skills at v1.91.373.0, with exact names: /office-hours (the conversation before a plan), /plan-ceo-review (premise, scope, the user, strategy), /plan-devex-review (API and developer experience), /plan-design-review (UX and design), /plan-eng-review (architecture, failure modes, tests) and /autoplan (runs them in order with two model families). Each review lens catches a different kind of flaw, so each gets its own flaw panel and taxonomy. A CEO flaw is not an eng flaw.

| Round | Skill under test | Reading | Why this order |
|---|---|---|---|
| R1a | /plan-ceo-review | Known-flaw replay, CEO panel | Garry's most used; cheapest convincing reading; scorer exists |
| R1b | /plan-ceo-review | Downstream: fixed builder, hidden tests | Answers "does it help get tasks done" for the lens Garry relies on |
| R2 | /plan-devex-review | Replay, then downstream with a fixed developer agent | Garry: "really important for API companies"; downstream fits devex best |
| R3 | /plan-design-review | Replay, design panel | UI plans need a UI panel; downstream design needs DOM tests, deferred |
| R4 | /plan-eng-review, /autoplan, /office-hours | Eng replay; /autoplan on a mixed panel; office-hours corrected | Eng has the most real flaws; /autoplan costs most per session |

Each round reuses the previous round's build; only the panel, the told command and the lens line change. A round starts only after the previous round's results PR merges or the Captain says otherwise.

### 2. Arms

Every arm runs in the same Docker rig and Claude Code version through review-units (src/trial/review/cli.ts), on the same unit tree, with the same tools and file access, with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. The prompt is the arm's line, then a blank line, then one shared output block (section 3).

| Arm | Install | Arm line | Models |
|---|---|---|---|
| none (required) | bare: no gstack, no skills | "Review this plan for problems." | Opus 5.5, particle-1 |
| gstack | whole gstack tree at the pinned sha, v1.91.373.0 or newer | "/plan-ceo-review" then "Review this plan for problems." | Opus 5.5, particle-1 |
| lens | bare | "Do a CEO/founder-mode review of this plan." (the skill's own description line) | Opus 5.5 |
| placebo | Lane B placebo tree generated from the same gstack sha (o200k length-matched bodies, front matter and router kept) | same as gstack | particle-1 |

Later rounds swap the command and lens line: /plan-devex-review with "Do a developer experience review of this plan."; /plan-design-review with "Do a designer's eye review of this plan."; /plan-eng-review with "Do an eng manager-mode review of this plan."; /autoplan has no lens arm. Each lens line is taken from that skill's own description at the pinned sha and frozen in the prereg.

Why the none arm has full access: GSTA-167's NG7 saw only the diff while gstack's readers could open files, and its authors called that comparison incomplete. Here every arm sees the same tree.

Why the placebo only on particle-1: Lane B quick look 3 measured placebo minus none at +6 points [-2, +15] on particle-1 and +0 [-6, +6] on Sonnet; the lens arm is the cheaper mechanism control on Opus.

Other stacks: no published planning skill joins round 1. pstack has plan-adjacent skills (architect, figure-it-out) and Superpowers has brainstorming and writing-plans; a later stacks planning cell may run them as published at a pinned commit, invoked the way their own docs describe, beside the none arm, and credit the authors by name. We never contact their authors.

### 3. The unit, the prompt and the simulated user

A unit is a small git repo whose head commit adds plan.md, so the review-noloss suite's diff-shaped unit holds (repo, integer pr, head, base). The tree also holds context/ (goals, user research notes, tickets, metrics, an existing-code summary) and, where a flaw depends on it, existing src/. Every flaw must be detectable from that tree alone. Units are sealed: their bodies live in the sealed store outside the repo, and the repo holds counts and sha256 digests only.

The shared output block, frozen and sha-pinned in a test like TOLD_TEMPLATE (told.ts), asks for the review in the arm's own words and ends with a fenced JSON findings list: severity (Critical, High, Medium, Low), plan section, line, claim, evidence and fix. Findings mapping: Critical and High count as must-fix (the scorer's CRITICAL), Medium and Low as noted only (INFORMATIONAL). A session that ends with no parseable block is scored as finding nothing for that pass, and the count of such sessions per arm is reported.

The plan reviews ask questions. Every arm gets the same "rec" user: the arm's gstack home sets every question preference to auto-decide, and any AskUserQuestion that still arrives goes to the user simulator (src/usersim), whose persona answers "Go with your recommendation." to every question. Writes are allowed only inside the unit tree; commit, push and any network effect are refused. The plain arm rarely asks, which is fine: the user is the same for both.

### 4. Panels

Each lens panel holds three strata. The headline pools the first two, with each stratum also read alone.

**Seeded (headline).** About 24 plans per lens, each carrying two flaws, plus 6 decoy plans with no flaw in that lens, plus 4 pilot units that are never scored. Each decoy carries one bait: a deliberate choice the context justifies that a careless reviewer might flag (the suite needs one case per unit, and the bait is scored as over-blocking). Decoys count in the false-alarm reading, not in recall or power. The plans are fresh fictional products of the size and shape of a real plan (2 to 6 KB), so no model has seen them. A cross-family author (a Capy subagent on gpt-6.1-sol) writes them from the taxonomy below and never sees gstack's skill text. An auditor (Opus 5.5, no gstack) checks each flaw: it is detectable from the unit tree alone, it changes what gets built rather than how it is worded, its key states the cause and the plan section, and the plan text does not use words that echo a gstack skill's headings. A flaw that fails the audit is rewritten or dropped before the prereg freezes.

**Real neutral.** Flaws found in this repo's approved plans after approval, by something other than a gstack review, restated in our own words, with the plan at its approval commit and every later post and commit removed from the unit tree. Counted now: CEO 2 (the v1 plan had no rule for what a sealed release may reveal; the stacks plan missed a diff-scoped-tests stratum), devex 2 (the Lane A prereg's rig re-checked out main per item, and allowed a second lease after a cap stop), eng 7 (among them: the factory keep rule had no noise floor, the stacks unit gate dropped units whose full suites could not run in the rig, its drop order's steps 2 and 3 could not run, and its judge packets omitted each finding's evidence). These plans already passed /autoplan, so their flaws are ones gstack missed; the stratum leans against gstack, and we say so.

**Home field (reported alone).** gstack's own planted-flaw fixtures (test/skill-e2e-plan-ceo-finding-floor.test.ts, the design finding floor, three CEO fixtures under test/fixtures/autoplan/, the eng arch-finding E2E) and flaws gstack's reviews found first. They were tuned to gstack, so they never enter the headline. For this stratum the installed gstack tree must not carry the fixtures; the stacks contamination audit runs on every install root.

Taxonomies, written here from general product, API, design and engineering practice, not from gstack's skill text:

| Lens | "Wrong thing" or core flaws | "Right thing badly" or secondary flaws |
|---|---|---|
| CEO | the plan solves a problem the context says users do not have, or misses the one they do; the target user contradicts the context; the success measure is a proxy that can rise while the goal falls, or is missing; an unstated premise the context contradicts | scope far larger than the goal needs; existing code or an existing product already does most of it; the risky unknown comes last; a one-way door with no cost of doing nothing or way back |
| Devex | inconsistent names or shapes across endpoints or commands; errors with no code or fix hint; a mutating call with no idempotency or retry rule; many setup steps before a first success | a breaking change with no version or migration path; lists with no pagination or limit; no example for the main path; a surprising destructive default |
| Design | no empty, loading or error state; the main action is not obvious; accessibility gaps (contrast, keyboard, labels) | mobile ignored; breaks the stated design system; destructive action with no confirm or undo; flow forces backtracking |
| Eng | a race or concurrency hole; a migration that can lose data; no failure handling for an external call; a security boundary crossed | the test plan misses the risky path; unbounded work or N+1 reads; an interface that does not match existing code; no rollout or rollback |

Each seeded CEO plan carries one "wrong thing" flaw and one "right thing badly" flaw, which is Garry's framing of what the CEO review should catch.

### 5. Outcomes, ranked by how directly they show a better plan

1. **Downstream task outcome (most direct; R1b, R2b).** The reviewed plan goes to a fixed builder and hidden acceptance tests decide. Only the plan differs between arms. It is the reading closest to "gstack helps get tasks done", but it is noisy and costs more per task, so it follows the replay.
2. **Known-flaw replay (primary in every round).** Must-fix recall on the sealed panel: per flaw, the share of the arm's 3 passes that flagged it Critical or High, scored by noloss score. Secondaries, all reported: any-severity recall; real new defects per plan (unmatched must-fix findings ruled defect by blind adjudication, judge-packet --adjudicate), which also answers the home-field worry; false alarms per decoy plan (must-fix findings on decoys ruled not-defect); cost per flaw caught.
3. **Blinded pairwise judging (secondary only).** In the downstream rounds, a cross-family judge compares the revised plans pairwise, blind and position-swapped, and we report its preference beside the test outcome. It never decides a claim.

Judging: the primary judge is gpt-6.1-sol (cross-family to Opus and to particle-1's DeepSeek base), blind through judge.ts packets (arm, model and reader names refused, severity words masked); Opus 5.5 is the second judge on every arm disagreement and a seeded 20% sample, with a third read on judge disagreement, as judge-join already does. The plan judging rule replaces "same path and cause" with "same defect: the same cause in the same plan section; the line may move". Severity is applied mechanically from the finding, never by the judge.

### 6. The downstream reading (R1b CEO; R2b devex)

**CEO tasks.** 12 sealed tasks, authored like the seeded panel. Each is a small Bun/TypeScript repo with existing code, a context/ folder, a README that fixes the public entry points every solution must keep, a draft plan carrying one "wrong thing" and one "right thing badly" flaw, and hidden acceptance tests that call only those entry points and encode the need the context states.

**Pipeline per trial.** (1) The reviewer arm runs on the full tree with its arm line and "Then revise plan.md so it fixes what you found." (2) The fixed builder (Opus 5.5, bare, prompt "Implement the plan in plan.md.") gets the repo with the revised plan and the code, without context/ and without the tests, so the plan is the only carrier of what the review learned. (3) The hidden tests run keyless after the session. Cells: none and gstack on Opus and on particle-1 (reviewer model varies; builder fixed), plus two controls: the draft plan unreviewed (3 trials, the floor) and an author-written correct plan (1 trial, the ceiling).

**Scoring.** Primary: task success, all hidden acceptance tests pass, as the share of 3 trials, paired by task, clustered by task, the same exact sign-flip and bootstrap. A task whose draft-plan control already passes, or whose correct-plan control fails, is dropped by a frozen validity rule that reads only the control cells, before any arm is compared. Secondary: share of hidden tests passing; pairwise judge preference; builder cost.

**Devex (R2b).** 12 sealed API or CLI tasks. After the builder builds the planned surface, a fixed developer agent (Haiku 5.5, bare) gets only the built package, its docs and --help, and completes 5 integration tasks per surface, each scored by hidden tests. Primary: integration tasks passed. Secondary friction: developer turns to first success and error count.

Design downstream (DOM tests plus a blind screenshot rubric) and an office-hours downstream (the simulated user holds the hidden need; the arm writes the plan; the fixed builder builds it) are R5 candidates, not committed here.

### 7. Models

Opus 5.5 runs in every cell. particle-1 (particle-ai/particle-1 on OpenRouter, $0.10 in and $1 out per million tokens, policy/models.json) is the fixed cheap rung, as Garry asked. Sonnet 5.5, Haiku 5.5, DeepSeek V4.1 Flash and the open-weight slots are dropped from R1 to R4 for cost and sequence: they join a ladder round once a lens shows lift on Opus or particle-1, with the OpenRouter programming ranking re-read at that prereg. Haiku 5.5 appears only as the devex round's developer instrument, fixed across arms, with the reason stated in Big decision 7. If particle-1 cannot complete Claude Code tool use on more than 20% of pilot cells, the prereg's frozen fallback drops its cells through a derived comparisons file and says so.

The ladder reading for particle-1 is descriptive: gap closed = (p1-gstack minus p1-none) divided by (opus-gstack minus p1-none), with cost per flaw caught. No parity claim is made; that needs its own margin and non-inferiority test under the crew rules.

### 8. Statistics and the claims allowed

Per round, one comparisons file in the review-noloss format with a declared LOSS family (null 0), Holm step-down, in this order: opus-none vs opus-gstack (LOSS here means gstack is better), opus-gstack vs opus-none (gstack is worse), p1-none vs p1-gstack, p1-gstack vs p1-none, p1-placebo vs p1-gstack, p1-gstack vs p1-placebo, opus-lens vs opus-gstack, opus-gstack vs opus-lens. Both directions sit in the family so gstack can lose (stacks finding T2). The comparisons file writes the family's null as the string "zero". Each comparison carries the 10-point margin the scorer requires, but no non-inferiority claim is made: at this size an arm as good as its reference reaches NO_LOSS in only 30% to 62% of simulations (section 12), so those lines print NOLOSS_UNDERPOWERED and are not read. Delta comes with its plan-clustered bootstrap interval (10,000 draws, seed fixed in the prereg).

Claims:
- **"gstack's CEO review catches more of these flaws than plain Opus"** only when opus-none vs opus-gstack is LOSS on the Holm-adjusted p, with delta and its interval, the panel named, and the false-alarm reading beside it. If gstack's false alarms per decoy exceed plain's by more than 1 with the interval above 1, the claim must say "at a false-alarm cost of".
- **"gstack's review is worse"** under the mirror condition. Reported plainly.
- **Not distinguished** otherwise, with the minimum detectable difference from the power table.
- **Ceiling:** if opus-none's must-fix recall is above 0.85 on the panel, the round reports a ceiling and makes no claim; the lens goes to the harder-panel track.
- **Not claimed from replay:** that gstack writes better plans in general, that it helps finish tasks (that is R1b), or anything about flaws outside the panel's taxonomy. Seeded flaws are not natural flaws; the real-neutral stratum is the check on that, and it is small.
- **Downstream claims** follow the same rule on task success, and name the 12 tasks.

### 9. Cost, with sources

Unit prices and per-session anchors:

| Item | Figure | Source |
|---|---|---|
| Opus 5.5 list price | $4 in, $20 out per million tokens | GSTA-167 arm-NG7 cost.tsv (usage fields) |
| Plain Opus review, one call on a diff | $0.42 per unit-pass, about 60k tokens | noloss7-results.md, NG7 |
| Opus Claude Code session, office-hours told | $0.61 to $0.70; bare-ish none $0.20 | geva-65 rerun results, row 7 |
| Opus session allowance in the rig | $7.04 | gsta-42 prereg allowance table |
| particle-1 session | about $0.003 (Lane A), $0.08 to $0.11 (Lane B TB2) | geva-54 results; gsta-30 quick look 3 |
| particle-1 session allowance | $0.192 | gsta-42 prereg |
| Judge call | $0.02 to $0.05 | geva-65 rerun results; gsta-30 |
| User simulator answer | under $0.001 | geva-65 rerun results |

No session of /plan-ceo-review has been metered. The estimate below uses $1.50 per Opus session (twice office-hours, since the skill reads a plan and its context and walks ten sections); the R1a pilot measures it, and the prereg's projection is redone from the pilot before the full run.

R1a CEO replay, 34 scored units (24 seeded, 3 real, 6 decoys, plus the real flaws' units counted once) at 3 passes, about 100 sessions per cell:

| Cell | Sessions | Estimate | Worst case at allowance |
|---|---|---|---|
| opus-gstack | 100 | $150 | $704 |
| opus-none | 100 | $40 | |
| opus-lens | 100 | $40 | |
| p1-gstack, p1-none, p1-placebo | 300 | $27 | $58 |
| Judges, second reads, adjudication | about 900 calls | $60 | |
| Pilot (4 units, 6 cells, 1 pass) | 24 | $12 | |
| **Total** | | **about $330** | cap **$600** binds before the worst case |

Later rounds, estimated the same way: R1b CEO downstream about $470 (192 builder sessions at an estimated $2, reviews $74; cap $800). R2 devex about $830 (replay $300, downstream $530 including the Haiku developer agent at about $0.10 per integration task; cap $1,300). R3 design replay about $300 (cap $550). R4 about $1,250: eng replay $300, /autoplan told on a mixed panel of 30 units at 2 passes and an estimated $15 per Opus session $900, office-hours corrected $12, judges $40 (cap $2,000). Every number here is an estimate to be replaced by the round's pilot; spend runs only through the ledger.

### 10. Cap, stops and start rule

- Each round runs only after its prereg PR merges and the Captain records the cap (org R42: the Captain approves up to $5,000 per thread). Preregistration and results never share a PR.
- Ledger cap stop: the run ends incomplete and is never retried to change a verdict. A rerun needs a named repair.
- Per-session allowances from the rig ($7.04 Opus, $0.192 particle-1) stop runaway sessions.
- Pilot stops, read before the full run on pilot units only, which are never scored: (a) opus-none's pilot must-fix recall above 0.85 or below 0.10 means the panel is off and goes back to the author before the prereg's panel digest is final; (b) user-simulator fallback above 10% of replies means the persona needs repair; (c) particle-1 tool-use failure on more than 20% of cells triggers the frozen rung drop; (d) the measured Opus gstack session cost re-projects the run, and a projection above the cap means a smaller panel, not a raised cap, unless the Captain raises it.
- A cell that ends missing (no findings block, a timeout, E_USER_TURNS_MISSING) scores as not found for that pass, as section 3 says, with a sensitivity reading on a derived suite without those units.

### 11. Build order, keyless first, and dates

Every step before the pilot is keyless. Each code step is a small PR through the Captain's queue with a /ship receipt.

1. **B1 plan units in review-units.** A plan case schema beside lanes/review-replay/catalog/schema.json (plan digest, lens, stratum, flaw cause, plan section, deserved severity, answer-key audit), suite support for plan units registered under lanes/review-noloss/suites/ so export reads them, unit.ts skipping bun install and bun test for plan units, and an alpha option on `noloss power` tested against the dry run's mirror.
2. **B2 the plan told template.** TOLD_PLAN_TEMPLATE with the shared output block, sha-pinned in a test; per-arm lines for none, gstack (/plan-ceo-review, later the other commands), lens and placebo; findings parser mapping Critical/High to CRITICAL.
3. **B3 placebo and lens arms in review-units.** placebo built by Lane B's generator from the gstack arm's sha; lens as a bare arm with its own line.
4. **B4 the "rec" user in review-units.** Question preferences set to auto-decide in the gstack home; src/usersim wired for AskUserQuestion with the rec persona; writes outside the unit tree refused.
5. **B5 the sealed CEO panel (a separate thread, in parallel with B1 to B4).** Taxonomy to 24 seeded plans, 6 decoys and 4 pilot units, author on gpt-6.1-sol, auditor on Opus 5.5 without gstack; the 2 real-neutral CEO units built leak-free; counts and digests committed, bodies sealed.
6. **B6 the plan judging rule** in judge.ts packets and the severity map.
7. **B7 dry run.** Commit a keyless derive script (a derived suite id, its comparisons file and re-ingested arms), then rerun section 12's dry run on the real suite shape with fake arms, every frozen fallback included, using score --expect, before the prereg goes to review.
8. **B8 R1a prereg PR,** then the cap. Then the pilot, the stop checks, the full run, judging, and the results PR.
9. R1b: author 12 CEO tasks (sealed) while R1a runs; add the builder step, the hidden-test runner and the control cells to review-units; R1b prereg; run.
10. R2, R3, R4 in order, each reusing B1 to B4 with a new panel, command and lens line.

Target dates: plan merged 2026-11-01; B1 to B6 by 2026-11-03; R1a prereg 2026-11-03; first CEO plain-vs-gstack number 2026-11-05. Then R1b by 2026-11-08, R2 devex by 2026-11-11, R3 design by 2026-11-13, R4 eng, /autoplan and office-hours by 2026-11-17. Dates slip with panel audit failures, not with spend.

### 12. Dry run of the frozen rules (done before review)

A subagent built a synthetic plan suite shaped like the R1a panel (24 seeded units with 2 flaws each, 3 real units with 1, 6 decoys; six fake arms at 3 passes with seeded findings and judgments) in a copy of the repo at af60b9e and ran every frozen rule through the pinned scorer, keyless. The report is attached as dryrun.md, with each command and its verbatim verdict lines. All synthetic; no paid calls.

| Rule | Result | What this plan therefore fixes |
|---|---|---|
| Primary family, both directions, Holm | Runs with one change | The comparisons file writes `loss_family.null` as the string "zero"; a literal 0 is refused (E_NOLOSS_SUITE). Holm-adjusted LOSS p and the step print ("Holm 0.000079, step 1 of 8"). |
| Power and the minimum detectable difference | Runs with one change | `noloss power` reports LOSS power at an unadjusted 0.05 only. A mirror script reproducing its 0.05 column exactly gives, at Holm's strictest 0.05/8, power for a 20-point difference of 74.8% at 16 seeded units, 86.3% at 20, 94.1% at 24 and 98.6% at 32. So 24 seeded plans per lens hold the minimum detectable difference between 15 and 20 points. B1 adds an alpha option to `noloss power`, tested against that mirror. |
| Missing cells | Runs with the rule as written | Scored M with coverage complete and a note gives a verdict; recorded as coverage incomplete gives `verdict: none`. So section 10's rule is M plus a note. No derive tool exists: a derived suite scores only under its own suite id, its own comparisons file and re-ingested arms, so B7 commits a keyless derive script. |
| Dropped particle-1 rung | Passes | The full file refuses (E_NOLOSS_ARM, "arm p1-none is not ingested"); the derived opus-only file scores with Holm over 4. The prereg commits both files. |
| Stopped arm | Passes | Its comparisons give `verdict: none`; the rest score unchanged and the family stays at 8. |
| Blind judging and adjudication | Runs with one change | Packets render and the blinding check passes on plan-shaped findings. A second judge's reply must answer exactly the set judge-join names (extras refused, E_NOLOSS_BLIND), and a join over arms that already hold judgments needs `--replace`. |
| False alarms on decoys | Passes | "false blockers per PR: opus-gstack 0.06, opus-none 0.08, difference -0.02 [95% CI -0.07, +0.03] on 33 PRs". |
| Suite id in --prereg | Passes | The comparisons file's `suite` must equal the suite id, not a path. |

Three more facts the dry run settled: the suite refuses a unit with no blocker, so each decoy carries one over-blocking bait (section 4); `noloss export` reads only suites registered under lanes/review-noloss/suites/, so B1 registers each panel suite there; and no NO_LOSS reading can pass at this size, because an equal arm reaches NO_LOSS in only 30% to 62% of 2,000 simulations at 0.05/8, so section 8 drops the non-inferiority reading from the claims.

### 13. What the Lane A office-hours result can and cannot claim

It can claim, as an exploratory reading: with gstack's office-hours present and named in the prompt, Opus 5.5 performed office-hours' own contract behaviors (premise challenge, alternatives, forcing questions, staying out of code) on 0.67 to 0.76 of 33 sessions over 11 tasks, against 0.36 for a gstack base with office-hours removed. That shows the skill is read and changes behavior, which any planning win needs first.

It cannot claim: a no-gstack comparison (its none arm kept every other gstack skill; the arm with no gstack is bare); better plans or better builds (the tasks grade answer patterns and a judge rubric, not plan quality or outcomes); or independence from gstack (the tasks are gstack's own contract fixtures, a home-field panel). Its own authors called it exploratory with no public claim, and the same tree scored 0.67 and 0.55 in two runs, a 12-point panel noise. R4 corrects the none arm by rerunning row 7's tasks with bare (about $12) and labels the result a behavior reading.

### 14. Reuse

| Piece | From | Use here |
|---|---|---|
| review-units runner: bare none arm, told prefixes, --models, findings parser, cost.tsv | GST-381 (#93) | the trial runner for every arm |
| noloss score, power, judge-packet (--adjudicate), judge-join, export, LOSS family, Holm | review-noloss lane (GSTA-40, #93) | all scoring, unchanged except the plan judging rule |
| placebo generator | Lane B (quick/laneb/arms/placebo/placebo.ts) | the particle-1 placebo arm |
| user simulator and classifier | src/usersim | the rec user |
| contamination audit of install roots | stacks round 1 prereg | home-field stratum and every gstack install |
| ledger, metering proxy, rig allowances | U3, U4, U20 | every paid call |
| Lane A rig and tasks | GSTA-42, GEVA-65 | the office-hours correction in R4 |
| sealed store and digests | AGENTS.md, gsta-9 | panels, keys and hidden tests |

### 15. Risks

- Seeded flaws may be easier or harder than natural ones. The real-neutral stratum and the pilot's recall band check this; both are small, and the results say so.
- The lens line may carry most of the effect. That is a finding, not a failure: it sends the skill to the cut track.
- gstack's review writes to plan.md and may stop on questions. The rec user and auto-decide handle questions; a missing findings block scores as nothing found, so a broken run counts against the arm that broke.
- Opus may sit at ceiling on seeded CEO flaws. The pilot band catches it before money goes to the full run.
- A long CEO review may cost far more than $1.50. The pilot re-projects, and the cap binds.
- particle-1 may not complete tool use. The frozen rung drop handles it.

### 16. Verification

The lane is ready for its first paid run when: B1 to B6 are merged with keyless tests; the B7 dry run shows every frozen rule and fallback running through the pinned scorer with --expect; the sealed panel's digests and audit counts are committed; the prereg names the comparisons file, panel digest, judge models, cap, pilot stops and the claims of section 8; and the Captain has recorded the cap.

### 17. Needs

- The Captain's word at this plan's gate.
- For R1a: a cap of $600 after the prereg merges.
- No new credentials: OpenRouter and Anthropic keys are already on the rig; gpt-6.1-sol runs through the existing OpenAI key.

## Review record

The run's public export is review-record.md in this bundle: both phases, both voices, every finding and the gate. The keyless dry run of the frozen rules is dryrun.md.
