---
id: 2026-11-09-geva-412-plan-mode-intentions
kind: research
title: "What gstack's plan-mode skills are meant to do, and which of those aims our evals actually score"
summary: "An intentions inventory of six plan-mode skills at a pinned gstack, mapped to every eval run or planned. Of 48 main intentions, 1 is scored, 18 partly, 29 untested."
author: GEVA-412
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: done
links:
  - https://github.com/garrytan/gstack/tree/b6155921a564ba9ec2470fd2cb3894c05e2c2d13
  - https://github.com/garrytan/gstack/tree/b493d4e31ac9619ef7e52e176d590ad4f454cd66/plan-eng-review
  - 2026-11-08-geva-403-product-value-prereg
  - 2026-11-04-geva-285-ceo-outcome-prereg
  - 2026-11-08-geva-402-ceo-stage-2-results
  - 2026-11-03-geva-238-panel-v3-headroom-prereg
  - 2026-11-03-geva-250-panel-v3-headroom-results
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-06-geva-364-g-admission-results
  - 2026-11-08-geva-397-autoplan-larger-features-prereg
  - 2026-11-08-geva-396-autoplan-report-order-recheck-results
  - 2026-10-28-gsta-13-quick-look-3-results
  - garrytan/gstack-evals#276
attachments:
  - 877e2c0fcef9d00a584dcce15d508cdd1470d68c3acfaff405c4186884fd11cd  inventory-autoplan.md
  - 7b2a565add2cff8291204d1d85699366a8b3dfffe85f1d2407fba2cef9680960  inventory-office-hours.md
  - 5c2558ce06802f1fff1c544b753823b0fda28706e75abf82cc76a2576e251f74  inventory-plan-ceo-review.md
  - 3365df8ef04c70c258b7b42728e89a76391ce60ee6842abd89f3784a1705f587  inventory-plan-design-review.md
  - 94d722ca10851438a243aaa3fea3de3af3703647501cad02a6a0876f66e70e71  inventory-plan-devex-review.md
  - b8655f57af8b18bd00b7d0b8f860739c080d45a06d75e7f077f7640687ab97b4  inventory-plan-eng-review.md
  - 4129878bac00cfd0dd1a4203292a1b3f470b073f097e6a5cc4918741c5515e97  inventory-plan-tune-eval-plan-preamble.md
---

# What gstack's plan-mode skills are meant to do, and which of those aims our evals actually score

## Takeaways

- We learned that most of what gstack's plan-mode skills set out to do has never been scored. Across six skills we found 48 main intentions. One is scored, by an eval that hasn't run yet; 18 are partly scored, most of them by evals still being planned; 29 are untested. You should read the nulls so far as "we tested a different job", not "the skill doesn't help".
- We learned that the past tests mostly asked one question: does the review name a flaw, planted or real? The skills mainly aim to change what gets built and what users meet: every state of a screen, a developer's first success, the first thing a founder sells, how the product fails in real life. You should grade a plan review against what happened after launch, the way the product-value and engineering-intentions preregistrations start to.
- We learned that on Capy's default autoplan run, the CEO, design and DX reviews reach the model as checklists of 28 to 37 lines inside one engineering reviewer, not as the full skills. You should test the form people actually run beside the full skill.

## What we did

We read every plan-mode skill in full at gstack main b6155921a564ba9ec2470fd2cb3894c05e2c2d13 (2026-11-08): plan-ceo-review, plan-design-review, plan-devex-review, office-hours and autoplan with each of its phases, plus the shared preamble every one of them loads. We read plan-eng-review at b493d4e31, the text from before its standalone cut, because autoplan's engineering phase still runs it. Each reading covered the generated SKILL.md, its .tmpl source, every section and reference file the skill loads, and the runner code that decides what an unattended run sees. Each attachment lists the files read, with line counts and sha256, and marks the few code ranges left unread.

For each skill we wrote down every stated and implied intention with file:line citations, marked it main or secondary with a reason, said what "met" looks like to someone who did not watch the session, and said where it shows: in the plan (PLAN), in what gets built (BUILD), or after launch (AFTER). Each inventory ends with the places where the steps and the intention disagree.

Then we mapped every main intention to every eval gstack-evals has run or planned for these skills: the experiment registry, the wiki's plans and results on main (including the approved outcome-per-skill plan, whose X and U families are not yet preregistered), and the open plan-eng-review intentions preregistration (#276). A score covers an intention only if it can see the intention's "met" evidence.

## Two skills are out of scope

plan-tune and eval-plan were read in full and inventoried (see the preamble attachment), but neither is meant to run before code. plan-tune configures which questions gstack asks and keeps a developer profile; it shapes no plan (plan-tune/SKILL.md:104-117, 733-735). eval-plan plans a paid eval run, writes outside the plan file and spends money in its pilot step (eval-plan/SKILL.md:103-110, 253-263, 292-298). One consequence for every plan-mode eval: a plan-tune "never ask" preference auto-decides questions inside the plan-mode skills, so each arm must pin plan-tune's state.

## What each skill is for, in one sentence

- **plan-ceo-review**: make a plan worth building before any code, by challenging whether it solves the right problem, pushing it toward the best product for its user at a scope the user approves, and making it say how it fails in production and where it leaves the product in 6 to 12 months.
- **plan-design-review**: make a UI plan say exactly what users will see and do (hierarchy, every state, the journey, responsive and accessible behaviour, a specific look that fits the design system), so the shipped UI is intentional instead of left to the implementer.
- **plan-devex-review**: make a developer-facing product easy to adopt, by naming the target developer, setting a time-to-first-success target, tracing the journey from install to upgrade, and making errors recoverable by an agent or a person.
- **office-hours**: understand the problem before any solution, with hard demand questions for founders and a generous design partner for builders, and leave the user with an approved design doc and one concrete next action instead of code.
- **plan-eng-review** (at b493d4e31): lock in a build-ready implementation plan, checked against the real code for architecture, data flow, edge cases, test coverage and performance.
- **autoplan**: run the CEO, design, DX and engineering reviews in one pass, answer routine questions itself by six stated principles, check each phase with two reviewers from different model families, and stop once at a gate where the owner decides only taste calls and changes to their stated direction.

## Main intentions and what scores them

Status: **scored** means a score sees the intention's "met" evidence; **partly** means a score sees part of it, or sees it only through a proxy or in an eval with no lift reading; **untested** means no score sees it. Each eval is named by its wiki post; scores are named as their posts name them.

### plan-ceo-review (6 main)

| ID | Intention | Status | What scores it |
|---|---|---|---|
| CEO-1 | Challenge the premise: the real problem, the cost of doing nothing, pain or proxy, willing to scrap the plan | partly | The CEO outcome eval's hit@3 (do the review's top three concerns name the maintainers' real reason for rejecting or cutting a proposal), null on all three models; the earlier panels' must-fix recall on planted wrong premises, which plain Opus already maxed. Neither scores a premise challenge on a plan that went ahead. |
| CEO-2 | Make the product extraordinary for its user: the 10x version, the user's felt experience, delights, a 12-month ideal | partly | The product-value eval's A on user-signal (U) and product-evolution (E) items, 42 days after launch; running. It can't see delight beyond what users asked for, or a 12-month ideal. |
| CEO-3 | Calibrate scope through one of four modes and hold that posture | untested | Product-value reads rollout and first-version items (R) only as a secondary, and only with at least 30 of them; its mode-handoff check is exposure, not outcome. |
| CEO-4 | The user decides every plan change; nothing changes silently | untested | Every eval runs unattended and takes the recommended option. |
| CEO-5 | Make the plan honest about real life: no silent failures, every error with its handler and what the user sees, observability, rollout | untested | Nothing for this skill. The engineering-intentions prereg (#276) keys post-merge defects, but only for engineering arms. |
| CEO-6 | Optimise for 6 to 12 months: reversibility, debt, later phases | partly | Product-value E (follow-on capabilities shipped within 42 days). Nothing scores reversibility, debt or later rework. |

### plan-design-review (8 main)

| ID | Intention | Status | What scores it |
|---|---|---|---|
| DES-1 | The plan itself holds the missing design decisions | untested | |
| DES-2 | Hierarchy, one obvious next step, wayfinding, the journey across screens | partly (planned) | The outcome-per-skill plan's family U: an agent user completing frozen tasks in the built UI (steps, errors, dead ends), with blind judges second. Approved, not preregistered. |
| DES-3 | Loading, empty, error, success and partial states specified as what the user sees | untested | |
| DES-4 | A specific, intentional look, not generic AI output | untested | |
| DES-5 | Responsive behaviour per viewport and accessibility in the plan | untested | |
| DES-6 | Fit the design system and existing UI | untested | |
| DES-7 | Approved mockups settle the visual direction | untested | |
| DES-8 | The user decides every design change | untested | |

The only eval that ran on this skill was panel v3's design stratum, which planted flaws in UI plans, ran no skill arm, and read NO READ on broken items. The outcome-per-skill plan's family U would look at the built UI, but only at task completion; no score keys states, accessibility, responsive layout, the design system or what users met after launch, and that plan defers U's comparison until a cheaper agent user passes calibration, since a U null at its planned power could not move a design skill to a cut.

### plan-devex-review (7 main)

| ID | Intention | Status | What scores it |
|---|---|---|---|
| DX-1 | Name one concrete target developer and judge everything through their eyes | untested | |
| DX-2 | Set a benchmarked time-to-first-success target and shape getting started to meet it | partly (planned) | The outcome-per-skill plan's family X: a fresh agent reaching a first success from the built feature's docs alone, with time and failed commands. Approved, not preregistered. |
| DX-3 | Pick the first visible success and deliver it first | partly (planned) | Family X's docs-only first success, on one frozen goal per task. |
| DX-4 | Trace the journey from discovery to upgrade and fix each friction point in the plan | partly (planned) | Family X covers install to first success; nothing covers real usage, debugging or upgrade. |
| DX-5 | Every error path meets the agent-ready error contract | untested | Family X counts failed commands on the way, not whether an error tells the developer how to recover. |
| DX-6 | Score the eight DX dimensions honestly from evidence | untested | |
| DX-7 | Turn findings into user-approved plan changes | untested | |

Panel v3's DX stratum planted flaws in developer-facing plans and found plain Opus at the ceiling, with no skill arm. That is the only DX data. The approved family X would grade the built feature's docs-only first success, which covers part of three intentions, and nothing after launch.

### office-hours (9 main plus one implied)

| ID | Intention | Status | What scores it |
|---|---|---|---|
| OH-1 | Understand the problem before any solution; no code | partly | Lane A's office-hours contract graders (no code or design doc before approval), file-presence proxies an agent can game. |
| OH-2 | Replace interest with demand evidence (startup mode) | partly | Lane A's vague-evidence pushback task, a conformance check that passes at most 1 of 3 sessions in every arm. No outcome score. |
| OH-3 | Name the actual person who needs it most (startup mode) | untested | |
| OH-4 | Find the narrowest wedge someone would pay for this week (startup mode) | untested | Product-value's R secondary touches first-version choices only if 30 R items exist. |
| OH-5 | Find the most exciting version and adjacent unlocks (builder mode) | partly | Product-value's brief family, A on U and E items; running. |
| OH-6 | Challenge premises and get the user's explicit agreement | partly | Lane A's premise-challenge task, conformance only, at most 1 of 3 in every arm. |
| OH-7 | Force real alternatives and get approval before writing | partly | Lane A's contract graders (alternatives offered, approval before the doc). |
| OH-8 | Leave an approved design doc later skills can use | partly | Lane A's doc-presence check; product-value's exposure detector (a doc with Premises and Approaches Considered) is exposure, not outcome. |
| OH-9 | End with one concrete real-world next action | untested | |
| OH-37 | Change the founder's next decision so it follows the evidence (implied) | untested | |

Lane A showed that the skill makes Opus act like office-hours (contract pass rate far above no gstack). That is a manipulation check: it shows the procedure ran, not that the founder's plan or product got better.

### plan-eng-review at b493d4e31 (8 main)

| ID | Intention | Status | What scores it |
|---|---|---|---|
| ENG-1 | Sound architecture before code: boundaries, data flow, no unhandled single point of failure | partly | Panel v3's eng stratum (planted code-level flaws; plain Opus 15 of 16, no skill arm); G admission's solved rate on hidden tests, where the told review ran in 0 of 18 sessions. |
| ENG-2 | Every changed behaviour ships with a test that would catch a real regression: path map, coverage, test choice, CI and evals | scored (not run) | #276's primary A over post-merge bugs (B), follow-up tests (T) and CI or eval changes (C), with path-map and bug-site recall secondaries. |
| ENG-3 | Edge cases and failure modes handled, not hoped away | partly | #276's B items credit a check that names the failing path and condition, not the handling; panel v3's planted failure modes (ceiling). |
| ENG-4 | The smallest complete change: reuse what exists, defer what doesn't block the goal | untested | |
| ENG-5 | Findings rest on verified facts from the code | untested | |
| ENG-6 | The user decides each engineering change | untested | |
| ENG-7 | No obvious performance traps | untested | A performance defect can enter #276's key as a B item, but nothing scores the class. |
| ENG-8 | A build-ready saved plan the implementer can follow | partly | #276's stage 3 builds from each arm's block (descriptive); solved rates after a told review in G admission and the autoplan larger-features prereg. |

### autoplan (9 main)

| ID | Intention | Status | What scores it |
|---|---|---|---|
| AP-X-1 | Every applicable review in one pass; the owner speaks once | partly | The E3 exposure check: phases loaded and reported in order, early publishes refused. Process only. |
| AP-X-2 | Auto-deciding replaces the owner's answer, never the analysis: every phase at full depth | untested | |
| AP-X-3 | Two independent reviewers from different model families per phase | untested | #276's engineering-phase arm runs with the outside voice unavailable. |
| AP-CEO-1 | The CEO phase challenges premises and expands scope where the blast radius is small | untested | The CEO outcome eval's autoplan arm was unexposed in its smoke and dropped; product-value has no autoplan arm. |
| AP-DES-1 | The design phase makes states, hierarchy, responsiveness and accessibility specific | untested | |
| AP-DX-1 | The DX phase cuts time to first success and makes errors agent-ready | untested | |
| AP-ENG-1 | The engineering phase reviews the final plan: architecture, edge cases, a test plan tied to code paths | partly | #276's engineering-phase arm on A (open); G admission's told-autoplan solved rate with exposure 0 of 23; the larger-features prereg's solved rate (frozen, not run). |
| AP-GATE-1 | One final gate where the owner decides taste calls and challenges to their direction | untested | |
| AP-GATE-2 | Accepted changes land in the plan text that gets built | untested | |

### The shared preamble

Its six main intentions (plan mode respected, decision briefs, the user keeps control, complete coverage with the smallest code, evidence and honest status, plain builder voice) are cross-cutting. Lane A's no-code check touches the first, and #276's A touches complete test coverage. The rest are untested in plan-mode evals.

## Where a past verdict missed a main intention

- **plan-devex-review.** Panel v3's DX stratum produced a CUT-CANDIDATE "as seeded-flaw panels measure it". It rested on plain Opus finding planted flaws, with no skill arm, and saw none of DX-1 to DX-7. Under the plan-mode rule this reads **FIX-METHOD on task fit**, not CUT-CANDIDATE. The outcome-per-skill plan already holds that cut until family X reads; family X alone would still leave DX-1, DX-5, DX-6 and DX-7 untested.
- **plan-eng-review.** Its CUT-CANDIDATE rested on planted flaws and on G admission, where the told review ran in 0 of 18 sessions. It has already been narrowed to FIX-METHOD on task fit and exposure; this inventory agrees, and adds that #276 scores ENG-2 and parts of ENG-3 and ENG-8 but not ENG-1, ENG-4, ENG-5, ENG-6 or ENG-7.
- **plan-ceo-review.** The CEO outcome eval's hit@3 null has already been narrowed to FIX-METHOD on task fit. This inventory agrees: hit@3 sees part of CEO-1 and none of CEO-2 to CEO-6.
- **plan-design-review, office-hours and autoplan** carry no CUT-CANDIDATE today. Their nulls (panel v3 design: NO READ; Lane A: no loss shown; G admission and the exposure line: FIX-METHOD) all missed most main intentions.
- **Evals now open.** The product-value eval scores CEO-2 and OH-5 and parts of CEO-6; #276 scores ENG-2 and parts of ENG-3, ENG-8 and AP-ENG-1; the autoplan larger-features prereg scores build correctness only. By the plan-mode rule, a null from any one of them alone reads FIX-METHOD on task fit for the skill as a whole, because other main intentions stay untested.

## Where the steps and the intention disagree

Each attachment lists these in full. The ones that matter most for evals:

- **The default Capy autoplan doesn't run the reviews it names.** With no kind given, a Capy-driven autoplan is the lean feature kind: the engineering phase alone, one native reviewer, no outside voice, one round. CEO, design and DX reach that reviewer as their 37-, 28- and 34-line checklists (lib/autoplan-lean.ts:41-45, 121-125; lib/autoplan-run.ts:117-130). Even the full kind gives each phase's reviewer a five-question brief and the checklist, never the skill's methodology file (lib/autoplan-prompts.ts:197-203; bin/gstack-autoplan-snapshot.ts:37-70). So "full depth" (AP-X-2) and "two voices" (AP-X-3) are not what a default run does.
- **Unattended runs drop the CEO ambition.** autoplan fixes the CEO mode at selective expansion and auto-approves only small expansions (autoplan/sections/ceo-phase.md:10-18), so the 12-month ideal and the mode choice never run in autoplan.
- **"The user decides every change" switches off without a person.** Unattended sessions take the recommended option (the preamble's ask format) and autoplan auto-decides every design and engineering issue. No eval run unattended can see CEO-4, DES-8, DX-7 or ENG-6 as written.
- **Self-rated scores decide "clean".** Design pass scores, the DX scorecard and its time-to-first-success figure, office-hours' founder-signal count and plan-eng-review's clean status all come from the model's own ratings. plan-eng-review is clean only when it found nothing, so a thorough review that fixes issues reads NOT CLEARED while an empty one reads CLEARED (plan-eng-review/sections/review-sections.md:1376, 1435-1437 at b493d4e31).
- **Tests and UI are planned, never checked against the build.** plan-eng-review may not write tests and leaves coverage numbers to /ship; plan-design-review can only judge plan text when nothing is rendered. The intention shows in the build, which no review step looks at.

## Limits

The inventories are our reading of the skills' text. "Implied" intentions are inferences, each tied to the lines that imply it; another reader could draw the main/secondary line differently. A few long code files were read only where they decide what loads, and each attachment marks those ranges. The coverage map reads each eval's own posts; it does not rescore any run.

## Attachments

- inventory-plan-ceo-review.md, inventory-plan-design-review.md, inventory-plan-devex-review.md, inventory-office-hours.md, inventory-plan-eng-review.md, inventory-autoplan.md: one per skill, with every main and secondary intention, citations, the steps-versus-intention list and the notes on conditional loading.
- inventory-plan-tune-eval-plan-preamble.md: plan-tune and eval-plan (out of scope, with the reasons) and the shared preamble.
