---
id: 2026-11-08-geva-403-product-value-prereg
kind: plan
title: "Preregistration: do plan-ceo-review and office-hours make a product better for its real users? Each review is graded on what users asked for and what the product became after launch, with a headroom check and a judge check first"
summary: "Plans shipped after July 2026, plus invented products re-skinned from real histories, keyed to what users raised and what got built in the next 42 days. Arms: none, a one-line lens, the skill."
author: GEVA-403
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-08
status: open
links:
  - 2026-11-08-geva-402-ceo-stage-2-results
  - 2026-11-04-geva-285-ceo-outcome-prereg
  - 2026-11-06-geva-345-ceo-stage-2-amendment
  - 2026-11-05-geva-292-difficulty-ladder
  - garrytan/gstack-evals#273
  - garrytan/gstack-evals#214
attachments:
  - 7c381ea439acb30958a0d0eae5d350e63a0575b6fabe8bed83de00217d0143b8  power.py
  - 24b80fe50a701aa9c5a545d98e0fd47629277a2eb04e8cd1551d3ef1182eaafa  power.txt
---

# Preregistration: do plan-ceo-review and office-hours make a product better for its real users?

GEVA-403, Captain GEVA-2. Plan only: nothing in this post spends money, and no model call, VM or eval ran to write it. The supply counts in section 4 come from GitHub's API at no cost.

## Approval

Approved at gate_rev 1 of /autoplan run autoplan-20261108172030 (lean, one Opus 5.5 reviewer), rec_hash 2d7ef7621616. The project owner took every recommendation on 2026-11-08, including both families (plan-ceo-review and office-hours) and every Medium and Low finding, and asked for the optional blind taste check (section 15). The lean run applied the accepted changes without a second review. Additions after the approval, each a Captain ruling inside the approved plan, are folded in here: project-type strata (section 4), org rule R78 on judges (section 7), a widened public frame after the first supply count fell short (section 4), transposed units that re-skin real histories as invented products (section 4), and org rule R79's public lesson (section 1). The eval has its own line, outside the CEO line: a $4,000 all-in guideline, doubled from $2,000 because it judges with GPT-6 Astra, with any projection past $5,000 going to the owner. This post approves no item's spend.

## ELI5

Our last test of gstack's CEO plan review asked one narrow question: does the review spot the reason a plan later failed? It didn't help on any model. But that isn't what the skill mainly claims to do. It claims to make a plan better: think about who the users are and how they will really use the product, and see what the product could become. This test grades exactly that, using what really happened. We take real plans that open-source projects wrote and shipped after Opus 5.5's training cutoff, across consumer apps, server-side and enterprise software, mobile apps and developer tools. For each one we write down what users asked for, struggled with or needed in the six weeks after release, and what the project built next. Some units are invented products: we take a real history whose aftermath we know, give it a new product, domain and names, and keep every real event in its answer key, so the test can cover mobile apps and other kinds of software the public record barely shows. A review scores when its short list of changes saw those things coming. A review that lists everything can't win, because only five short changes count and generic lists of user ideas must score close to zero. The judges come from a different model family than the model being judged, and they are checked against known answers before any number counts. The same test then runs one level up on gstack's office-hours skill, using the idea behind each plan instead of the plan.

## Before → after

Before: plan-ceo-review has one real-outcome result (#273), a null on spotting the reason a plan was rejected, reverted or cut. It reads as a CUT-CANDIDATE, but it never measured scope expansion, thinking about users, real-life use or rollout, which is most of what the skill claims. office-hours has no product-value test at all.

After: a frozen test whose answer key is what real users and real projects did after launch. It reports, per model with intervals, whether plan-ceo-review (as a user runs it) anticipates more of that than the same model with no gstack and than a one-line CEO prompt, and the same for office-hours on the idea behind each plan. A cheap headroom check and a judge check run first, and the record of #273 is corrected to FIX-METHOD on task fit.

## Why it matters

The project owner said on 2026-11-08 that the most valuable part of these skills is what expands what a product can be and thinks about the user and how the product works in real life. A crew rule now requires every product-skill eval to score that claim and forbids a cut on a null that didn't cover it. Without this test, plan-ceo-review's only evidence is a test of its secondary job, and office-hours has none.

## What caused this work

#273 (the stage 2 CEO results, merged 2026-11-08) found no gain on hit@3 and called plan-ceo-review a CUT-CANDIDATE. The project owner challenged that on construct grounds, and the Captain agreed: the judges never saw the review's proposed fixes, nothing scored expansion or rollout, and most units were outside proposals where more scope may count against the skill. The Captain asked for a plan-improvement eval with three arms and a headroom check, then passed on the owner's steer that the core construct is product value: expansion, the user and real-life use.

## Big decisions

1. **Primary construct and score.** Options: (a) anticipation of the real post-launch record (what users raised and what the project built next), read from a capped list of changes; (b) a judged quality score of the whole reviewed plan; (c) build from the reviewed plan and grade what ships. Pick (a), with (b) as a length-controlled secondary that decides nothing. Why: (a) is grounded in what happened and dated after the plan, so no reviewer can copy it and no judge's taste sets it. What would flip it: stage 1 reading FLOOR, which makes (b) with the owner's calibration the next attempt.
2. **Ground truth.** Pick post-launch user signal and product evolution together as the primary key, and the actual rollout and first version as a secondary stratum. Why: the first two are the owner's construct; rollout choices often follow a project's own conventions, and a generic "ship it behind a flag" would match them. What would flip it: too few primary items, which would move rollout items into the primary with their own stock row.
3. **The skill arm.** Pick the plain invocation a user types (/plan-ceo-review), gstack as installed by default, unattended, its mode chosen by its own rule. Why: the brief asks for the skill as a user runs it. What would flip it: the stage 1 smoke, under the frozen fallbacks of section 10.
4. **Volume controls.** Pick: at most five changes of at most 40 words each, normalized the same way for every arm; one-to-one credit between changes and key items; a specific-match rule; three frozen stock rows; a shuffled-key control. Why: the owner's rule that volume can't win, and #273's stock-row guard.
5. **Office-hours.** Pick now, in this preregistration, on a brief layer authored with the same units, with its stage 2 after plan-ceo-review's. Why: the brief layer adds about a tenth to authoring, judges and scorer are shared, and one results post keeps R77's two-PR limit.
6. **Size and models.** Pick up to 80 comparison units (at least 48), 24 calibration units; Opus 5.5 at 2 passes, GPT-6.1 Sol and particle-1 at 1 pass, every arm on every model. MDD on Opus 11 points at 80 units at the item mix the supply count's full reads found (1 or 2 items a unit), 8 if units carry 2 to 4, up to 13 if every unit carries one. What would flip it: supply under 48 units, which stops for the Captain.
7. **Judges (R78).** Pick GPT-6 Astra for Claude-run arms, Opus 5.5 for GPT-run arms, and a three-family median for particle-1, with a non-circular judge check of at least 40 labelled outputs per judge and kappa of at least 0.6 to gate any verdict.
8. **Taste check.** The owner blind-picks 10 pairs after stage 1 (about 40 minutes of his time). It checks the judges and never enters a score.
9. **Unit sources.** Pick real public units (at least 48 of the 80 comparison units) plus transposed units that re-skin real histories as invented products, with a twin check that the two measure the same thing. Why: the widened public frame supplies plenty of consumer, server-side and developer-tool units but almost no mobile apps, and transposed units fill the gaps without inventing an answer key. What would flip it: the twin check failing, which makes the transposed stratum descriptive and the primary real units only.

## Implementation plan

### 1. The question, the claimed value and construct fit

**Question.** For each model under test, on real plans that shipped after Opus 5.5's stated training cutoff: does a review by plan-ceo-review, run as a user runs it, anticipate more of what real users raised and what the project built after launch than the same model with no gstack, and than the same model with a one-line CEO prompt? The same question one level up for office-hours, on the idea behind each plan.

**The public lesson this eval is after (R79), for someone building agents:** whether a structured product-review procedure makes a frontier model foresee what real users will need and what the product will become, beyond what the model does when simply asked to improve a plan or given a one-line founder framing, and so whether builders should ship such procedures or a single line.

**Claimed value, in one sentence (crew rule of 2026-11-08).** plan-ceo-review claims to make a plan extraordinary: expand what the product can be, think through who the users are and how the product meets real life, and choose the right first version and rollout before anyone builds. office-hours claims the same one level up, on an idea: understand the user and the demand before a plan exists.

**Construct fit.** Each part of the skill that carries the claim, and the key items it can reach:

| Skill part (at the pin) | What it should add to the review's changes | Key items it can reach |
|---|---|---|
| Step 0A premise challenge, 0C dream state | who the user is, the real problem | user signal (U) |
| 0F to 0G expansion: 10x check, platonic ideal, delight scan | capabilities the plan left out | follow-on features (E), user requests (U) |
| Section 4, interaction edge cases (slow links, stale state, real usage) | real-life environments and workflows | U |
| Section 9, rollout: flags, order, rollback | how it reaches users | rollout and first version (R, secondary) |
| Section 10, phase 2 and 3, platform potential | what comes next | E |
| Sections 1 to 3 and 5 to 8 (architecture, errors, security, quality, tests, performance, observability) | engineering critique | not keyed; they compete for the five slots |

office-hours: demand reality, status quo, the narrowest wedge, observation of real use and future fit map to U, R and E the same way. What the score does not cover, said plainly: web research (every arm runs without web tools), the live back-and-forth with a person (the skill runs unattended), and engineering critique (#273 measured the nearest thing). First version and rollout are covered only if the R stratum reaches its floor (section 11).

**Models under test (R54).** anthropic claude-opus-5-5 first; openai/gpt-6.1-sol and particle-ai/particle-1 through OpenRouter as in #273. All run in Claude Code with the claude-code-preset system prompt. Error control is per model and family by design (Holm over two contrasts in each), and the Opus plan family is the preregistered headline.

### 2. Correcting the #273 verdict

#273 found no effect of plan-ceo-review on spotting the issue that decided a plan's fate (hit@3: Opus +0.0 points on both gstack arms, Sol +0.0 and +3.6, particle-1 -9.5 and -1.2, none distinguished). Its judges read only each issue's first 40 words, never the proposed fix, and nothing scored expansion, users, real-life use or rollout. Most units were outside contributors' proposals decided by maintainers, where proposing more scope is not what the decision rewarded. Under R48 and the crew rule of 2026-11-08 (no CUT-CANDIDATE on a skill whose main claimed value the score didn't cover), #273's verdict is narrowed to: **no effect on spotting what kills a plan; plan improvement untested; R48 FIX-METHOD on task fit, not CUT-CANDIDATE**, on Opus 5.5, GPT-6.1 Sol and particle-1. This post records the correction; #273's numbers stand as published, and its status is unchanged.

### 3. Ground truth: what real users and the project did after launch

Every unit is a plan its maintainers wrote and then shipped. Its key lists what happened after the release, in three kinds:

- **U, user signal.** A need, use case, workflow, environment or misunderstanding that people outside the maintainer team raised about the shipped feature within 42 days of its release (issues, discussions, pull request comments), that the first plan did not address. It needs at least two distinct outside users, or one plus a maintainer's acknowledgement (a label, an accepting reply or a fix). Excluded: a code defect with no new use or environment behind it, typos, performance regressions, and anything only an insider could know.
- **E, product evolution.** A capability the project shipped within 42 days of the release that extends the feature (a merged pull request or a release note), that the first plan did not include. Excluded: bug fixes and refactors.
- **R, rollout and first version (secondary).** How the change actually reached users when that differs from the first plan: what the first release left out, or how it was gated (a flag, an experimental or preview label, opt-in first, a staged default).

**How keys are built.** The free count's miss study (section 4) showed that keyword and cross-reference search finds about 4 in 10 real items and that almost all of its hits are false. So the key writer reads each unit's whole 42-day window: the title of every issue, discussion and pull request created in it, and the body of every one that touches the feature. The writer looks hardest at what found real items in the study: the plan's series names ("part N"), the feature's API, identifier, flag or setting names, area and component labels, issues tagged with the release's version, and cross-references. E is read strictly: a follow-on counts only when it extends the feature's user-facing capability, so routine syncs of lists, demo-only layers and internal plumbing don't count.

U and E items form the **primary key**; R items are a secondary stratum. Each item is a statement of at most 30 words written as an observed fact about users or the product ("People running it in CI needed a non-interactive mode"; "Six weeks after launch the project added export to CSV"), never as advice, so the key doesn't read like any arm's style. A unit keeps at most 6 primary items: U items ranked by their count of distinct outside users, E items by the outside users on issues linked to their pull request (else zero), then a seeded tie-break.

**Mentioned items.** A key item that any input (plan.md, brief.md or context/) already names, such as a deferred plan item or a request users made before the plan, is flagged **mentioned**. Auditors remove only material dated after the plan, never a pre-plan mention. Mentioned items leave the primary and print as their own stratum, so echoing the plan's own deferrals earns no credit for foresight.

**Generic screen.** After the audit, Astra and Opus each label every key item against stock rows 1 and 2 (section 8) as if they were reviews. An item either judge marks as anticipated by a stock row becomes **generic**: it leaves the primary key and prints as its own stratum. This screen reads no arm output, so it can't favor an arm. Stock row 3 never screens anything.

A unit keeps its place only with at least 1 primary item left after the mentioned flag and the generic screen; drops are counted and reported. Units weigh equally whatever their item count, so a single-item unit scores 0 or 1 and a five-item unit in fifths.

**Brief-family extra items.** For each unit the key writer also lists the plan's 3 central commitments (what the maintainers decided to build). Brief-family lists are labelled against them as a secondary, A_plan, because the brief family's primary is the narrower construct: it credits only what reality added after the plan, never reaching the maintainers' own design from the brief.

### 4. Units

**Source.** Public GitHub records of a user-facing product change that shipped, in three source kinds, recorded per unit: a **plan** by the project's maintainers (author association OWNER, MEMBER or COLLABORATOR); an **accepted outside plan**, written by anyone else and accepted and shipped by the maintainers; and **PR-as-plan**, a merged feature pull request whose description reads as a plan, rewritten as one (below). Plans are issues, discussions or design documents of at least 300 words in their first version, first posted 2026-07-01 to 2026-09-30; a PR-as-plan has a description of at least 300 words, was opened on or after 2026-07-01 and merged by 2026-09-30. Repository with at least 500 stars and an MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0 or CC0-1.0 licence; at most 2 units per repository. Shipped in a release or tag published by 2026-10-09, so every 42-day key window closes by 2026-11-20, and no key is written before its window closes. A unit needs at least 1 primary item. Bug fixes, chores, docs, dependency bumps and pure refactors are not plans. plan.md comes from the earliest recoverable version of the record's body (GitHub's edit history), with its timestamp and digest recorded; a record edited after release with no recoverable earlier version drops. In-repository design documents are preferred where a record links one.

**Project types (strata).** Each unit gets one type by a rule frozen here, applied to the project as it stood at plan time from its repository description, README and context/ only, blind to the key and to the post-launch record:

- **consumer:** end users run it (desktop, web or browser apps, games, media, notes, chat, personal productivity, home apps);
- **server-side data or enterprise:** an organization operates it (databases, data pipelines, self-hosted business software, analytics, observability, identity, queues, search engines);
- **mobile:** an iOS or Android app;
- **other:** developer tools, libraries, frameworks, command-line tools and the rest.

When more than one fits, the first in the order mobile, consumer, server-side data or enterprise, other wins. Two classifiers label each unit independently; a disagreement goes to a third, whose label stands. Every label is recorded before any arm runs. The full set holds at least 8 units of each named type (consumer, server-side data or enterprise, mobile), at least 2 of them in the calibration slice; the comparison set aims for 16 of each named type where supply allows; every other slot fills from any type in seeded order. The primary stays pooled. Per-type results are descriptive, each printed with its own MDD (section 12), and never read as a finding.

**Per-type relaxation, fixed now.** Mobile and consumer units may take 3 units per repository. No other filter relaxes for any type; the 2026-07-01 start and the 42-day key window never relax, because earlier plans may sit inside Opus 5.5's training data.

**Supply count (free, GitHub API, 2026-11-08).** Two free counts ran, with about 2,700 GitHub API calls in all. The first, on maintainers' plans alone at 1,000 stars with plans posted in July and August, found about 79 keyable units (90% interval 1 to 211) before any audit, none of them server-side, which tripped this plan's supply stop. The Captain then widened the frame to the rule above. The recount, a census of the 300 most-starred repositories plus seeded samples of 500 repositories at 1,000 stars or more and 300 at 500 to 999, checked 102 records:

| Type | Frame repos | Funnel records | Shipped | Keyable (closed windows) | Keyable units, 90% |
|---|---|---|---|---|---|
| Consumer | 3,431 | about 1,590 | 0.83 | 0.33 | about 520 (220 to 940) |
| Server-side data or enterprise | 2,812 | about 1,460 | 0.56 | 0.34 | about 500 (200 to 830) |
| Mobile | 490 | about 260 | 0.67 | 0.33 | about 90 (0 to 250) |
| Other | 25,987 | about 9,010 | 0.49 | 0.25 | about 2,290 (930 to 3,730) |
| **Pooled** | 32,720 | about 12,320 | 0.55 | 0.28 | **about 3,390 (1,850 to 4,980)** |

By source kind, PR-as-plan supplies most keyable units (about 2,790), maintainers' plans about 340 and accepted outside plans about 260. About 1,150 more funnel records shipped into windows still open on 2026-11-08. A full read of 12 windows (3 per type) found a median of 1.5 real items per keyable unit, 5 user-signal to 11 follow-on; it confirmed the record-level verdict in all 12 but showed the item search missed 62% of real items and that 94% of its hits were false, which is why keys come from full reads. Two limits matter: every "mobile" window read in full belonged to a library or SDK, which this post's rule counts as other, so real mobile-app supply is close to zero; and consumer is overstated for the same reason. Transposed units (below) fill mobile.

**Transposed units.** A transposed unit invents the product, never the outcome. Each one re-skins one real history whose aftermath is known (a plan, then what users did and asked for, the follow-on features and the rollout) as a new product of a target type, with a new domain, names and surface details and plan text written fresh. Every key item maps one to one to a real event in the source history. Nothing in the aftermath is invented, because an invented aftermath would only score agreement with whichever model wrote it.

- *Inspiration pool.* Threads in the project owner's own Capy projects, read with Capy's thread tools, where a planning document or review is followed by what actually happened (user and owner feedback, bug reports, corrections, follow-on features, staged rollouts), and public-record cases the frame rejected for thin keys or dates. Pre-cutoff public cases are fine once transposed. No other person's threads are used.
- *Two frozen prompts, written here before any arm output exists, keep authoring blind.* T1, the product prompt, sees only the source plan and the project as it stood before it:

> Invent a new product of type TYPE in a different domain from the source below, with new names, users and surface details, so that no reader could recognize the source. Then write, in your own words and at the source plan's length and level of detail, three files for the new product: plan.md, the team's plan for the change, keeping the same kinds of decisions, commitments and omissions as the source plan; brief.md, the problem before the plan, with no part of the design; and context/, the product as it stood before the plan. Copy no sentence, name or number from the source. Add no decision the source plan doesn't make, and leave out nothing it does make.

  T2, the key prompt, sees the source's aftermath events and T1's output:

> For each aftermath event below, write one key item for the new product that re-skins that event: the same kind of need, use, environment or capability, translated into the new product's domain, as an observed fact in at most 30 words. One item per event, no more and no fewer. If the new plan, brief or context already names an item's need, mark it mentioned. Copy no sentence, name or number from the source.

- *Guards, per unit.* An Astra check (cross-family to the Claude authors) confirms that each key item follows from its source event, that no unmentioned key item is already named in the inputs, and that the unit can't be traced to its source. A recognition probe asks Astra and Opus to name the real project or product behind the unit, and any correct name drops it. Every transposed unit is sealed held-out material; the repository gets counts and digests only, and never private text, project names or quotes, even paraphrased.
- *Home field.* gstack's skills were shaped on the owner's own projects, so results print by inspiration source (Capy and public) as well as pooled.
- *Twin check.* 8 real public calibration units also get transposed twins through T1 and T2. In stage 1, Opus none's A on each original is compared with its twin's. The twins track when the mean absolute difference is at most 0.10 and the Spearman correlation across the 8 pairs is at least 0.4. If they track, transposed units enter the pooled primary. If they don't, the transposed stratum is descriptive only, and the primary reads real public units alone, at their count's MDD.

**Composition.** The comparison set holds at least 48 real public units and at most 32 transposed units, so a failed twin check still leaves a primary at the 48-unit floor. The type quotas count both sources, and transposed units fill mobile and top up any named type that public supply leaves short.

**Stops on supply.** If any named type has fewer than 4 eligible units across both sources, or the pooled count of passing comparison units falls below 48, authoring stops and the question goes to the Captain.

**Unit files.** Each unit has three inputs and a sealed key:

- plan.md: the first version of the plan, rewritten with project, product and people names replaced, keeping its length, structure and every commitment. For a PR-as-plan unit, plan.md comes from the frozen rewrite below.
- brief.md: the problem as it stood before the plan (the request or pain that led to it, who raised it, what existed), with no part of the proposed design.
- context/: the project as it stood when the plan was posted (what it does, who uses it, related features, stated constraints), from material dated before the plan only.
- key.json (sealed, never mounted in any session): the items of section 3, each with its kind, statement, evidence pointers, dates and flags, plus the 3 plan commitments and the auditors' foreseeable rating (yes, maybe, no) per item.

**PR-as-plan rewrite (frozen prompt).** One prompt, frozen here before any key exists, run by an authoring model that sees only the earliest recoverable PR description and the issue it links (if any), never the diff, review comments, or anything dated after the merge:

> Below is the description of a change a software team made, and the request that led to it if there was one. Rewrite it as the plan the team would have written before building: future tense, the same goals, scope, commitments, constraints and open questions, at about the same length. Keep every user-facing decision the description states. Add nothing it doesn't say: no new features, risks, rollout steps or follow-ups, and no implementation detail beyond what it names. Replace project, product and people names with neutral ones. Output only the plan.

The auditors check each rewrite against its source for additions. The primary also prints on units that started as real plans (plan and accepted outside plan), descriptively, so a reader can see whether the rewrite drove the result.

**Blind authoring, as in #273.** Writers of plan.md, brief.md and context/ never see anything dated after the plan, the key or the key writer's notes. Key writers read the whole record. Two auditors check each unit: the inputs carry nothing dated after the plan and nothing that signposts a key item; each key item is supported by its records, falls inside its window, and is absent from the first plan unless flagged mentioned; names are replaced. Auditors whose notes reach a writer never see the key. A unit that fails an audit twice drops.

**Timing and the pilot.** Transposed units need no 42-day window, so they go first. This post aims to merge, and its caps to be recorded, before 2026-11-20. Authoring's first step is 4 pilot units end to end: a consumer and a server-side public unit from closed windows, a transposed mobile unit, and one more transposed unit. The calibration slice for stage 1 follows: 8 closed-window public units, their 8 transposed twins, and 8 more transposed units spread over the named types. Stage 1, the judge check and the owner's taste packet run as soon as that slice passes audit. Comparison authoring starts at once on transposed units and closed-window public units (wave A); public units whose windows close by 2026-11-20 follow (wave B). Their measured cost per passing unit, failures included, sets the authoring cap, and the set is re-sized before more units are authored if that cap and section 13's line don't fit.

**Sets.** 24 calibration units (as above), then up to 80 comparison units, then 6 sealed reserve units (4 public, 2 transposed), drawn in seeded order (seed 20261108) from units that passed the audit, quotas first. The comparison set's size, its composition by source and its units digest are fixed before the first stage 2 lease.

### 5. Arms

Every arm runs in the trial container, with the same harness limits as #273: a 200,000-token context window (CLAUDE_CODE_DISABLE_1M_CONTEXT=1) and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. **Every arm runs with WebSearch and WebFetch denied** (Claude Code's web search runs on the provider's side, so a container without network doesn't stop it), and the container has no network except the metering proxy. A session with any successful web tool result is contaminated: excluded, counted against coverage and reported per arm. The no-gstack arms have no gstack install, no skills folder and no drive mount, so they are clean by construction; the read audit runs after the run as a descriptive check.

**Mounted files.** The plan family's sessions see plan.md and context/ only; the brief family's see brief.md and context/ only. key.json is never mounted. The dry run asserts both.

**Plan family:**

| Arm | First line of the prompt | gstack |
|---|---|---|
| none | "Review the plan in plan.md and make it better." | not installed |
| lens | "Do a CEO/founder-mode review of this plan. Review the plan in plan.md and make it better." | not installed |
| plan-ceo-review | "/plan-ceo-review Review the plan in plan.md and make it better." | garrytan/gstack 23f9d07ce9e802ac148a8a353228f201655fc5b8 (VERSION 1.98.0.0), default install, no gate |

**Brief family:**

| Arm | First line of the prompt | gstack |
|---|---|---|
| none | "Here is what a team wants to build, in brief.md. Help them make it better." | not installed |
| lens | "Do a YC office-hours review of this idea. Here is what a team wants to build, in brief.md. Help them make it better." | not installed |
| office-hours | "/office-hours Here is what a team wants to build, in brief.md. Help them make it better." | the same pin |

Every prompt then holds a blank line and the frozen template (section 6). No pin moves once this post merges.

**How the pinned skill behaves unattended.** Both gstack arms run with GSTACK_SESSION_KIND=unattended, as #273's did. At the pin, an unattended session auto-chooses the recommended option at each decision but writes any consent, approval or unrecommended item as a pending gate item (plan-ceo-review's sections/preamble.md:33). Scope additions need approval (SKILL.md:218), so expansion proposals from 0F and 0G may stay pending rather than accepted. plan-ceo-review picks its mode by its own rule (SKILL.md:750-756): more than 15 planned changed files recommends SCOPE REDUCTION; unclear categories recommend HOLD SCOPE; otherwise greenfield recommends SCOPE EXPANSION, added capability SELECTIVE EXPANSION, and a fix or refactor HOLD SCOPE. The template asks for the changes the reviewer would make, so a pending proposal can still reach the block. The run records each session's mode, its 0F proposals, which were accepted or left pending, and whether any reached the block; the mode mix and pending count print beside each primary.

**Exposure (did the procedure run?).** plan-ceo-review is exposed when its transcript shows the gstack-ceo-mode-handoff line; in SCOPE EXPANSION or SELECTIVE EXPANSION, at least one 0F proposal with its effort and impact; and Section 9 and Section 10 content (each section's name, or at least two of its named checks: feature flags, rollout order, rollback plan; phase 2, platform potential, reversibility). The load checks (the handoff ran and sections/review-sections.md was read) print as a secondary. office-hours is exposed when the session wrote the skill's design doc, the doc holds its "Premises" and "Approaches Considered" sections, and the Premises section shares at least three distinct three-word sequences with brief.md. The design doc lives under the gstack state root, which every launch copies into its sink. The build tests both detectors on recorded sessions, including one where expansions stayed pending, before any paid run.

### 6. The closing block, normalization and failures

The template, frozen:

> End your reply with one fenced block labelled plan-changes that holds a JSON object {"changes": [...]}: at most five changes you would make to what this team plans to build, most important first, each one string of at most 40 words. Only this block is scored.

The template names no users, expansion, rollout or scope, so the none arm gets no lens from it. The scorer reads the last plan-changes block in the reply. Normalization, applied the same way to every arm, every stock row and every oracle list before any judge reads anything: keep the first five strings; strip markdown (emphasis, code ticks, links, headings) and leading numbering; collapse whitespace; cut each string at its 40th word; render as "1." to "5." plain lines. The run reports, per cell, the mean words and items per block and the share of items the 40-word cut shortened.

**Failures, fixed now.**

- A completed reply with no plan-changes block scores 0 and counts as **no-block**.
- An unparsable block gets one frozen lenient parse (a fence labelled otherwise, trailing commas, a bare JSON array of strings); if that fails, it is no-block.
- An infrastructure failure (API error, crash, harness timeout, allowance stop, context overflow before a reply) gets one retry under its named reason; if the retry fails too, the session is **missing**: it counts against coverage and never scores 0.
- A web-contaminated session is missing too (section 5).

No-block and missing rates print per cell.

### 7. Judging (R78)

**Who judges which lists.** GPT-6 Astra (openai/gpt-6-astra) labels every list a Claude model wrote (Opus arms). Opus 5.5 labels every list a GPT model wrote (Sol arms). particle-1 lists go to a panel of Astra and Opus; where they split, Gemini 4 Argon (google/gemini-4-argon, through OpenRouter with data collection denied) casts a third vote, and the label is the median of the three, which for binary votes is the majority. Why a third family: two binary votes have no median, and Gemini belongs to neither the arm's family nor either judge's. The stock rows, the oracle lists (below) and the shuffled-key packets go to the same judge as the lists they sit beside. Every result records the judge model and version, and judge calls are cached by model, version, prompt digest and packet digest.

**Anticipation labels (primary).** Each packet holds one unit's key items (statements only) and that model's normalized change lists for the unit across arms, plus the three stock rows, shuffled with a seed and labelled only by a random id. For each list and each key item the judge answers anticipated or not, and for an anticipated item names the index of every change that anticipates it, one or more. The rule: *anticipated* when that change names the specific need, use, environment or capability the item records, in substance, so that a team acting on it would have served the need. A category alone doesn't match a specific item ("support more platforms" doesn't match "ARM64 Linux containers"); a change that names the item's need without the project's exact remedy does match. The brief gives three generic match and no-match examples written for this post, from no unit.

**Shuffled-key control.** Each list is also labelled against a seeded derangement of keys: another unit's key from the same project type where possible. The share of that other key a list "anticipates" is its shuffled A, a measure of how far its changes match any plan's aftermath rather than this one's.

**Missing labels.** Every (list, item) cell needs a label. A packet with a missing or unparsable cell is resent once, whole. A cell still missing stays unlabelled and counts against coverage, never as not anticipated. A Gemini tie-break that fails is retried once; if it fails again, the cell takes no label and counts against coverage.

**The judge check, before any judge number counts.** It must not be circular: if the gold labels came from the judges' own production calls, agreement would be guaranteed. So the check set is labelled in a separate pass, with its own audit prompt that asks for the quoted change behind each anticipated label, at maximum reasoning effort, by both Astra and Opus. The check set is drawn from stage 1: at least 48 change lists per family across the three models, each against its unit's key items, plus known anchors: the stock rows as known-bad lists (the generic screen removed what they match), and one **oracle list** per calibration unit as known-good, written by a script that turns the unit's primary items into five changes naming each need. Gold labels are the cells where Astra and Opus agree in that pass; there must be at least 40 gold cells of each class (anticipated and not) per production judge, from at least 40 distinct lists. Each production judge (Astra on Opus lists, Opus on Sol lists, the panel on particle-1 lists) is then scored on the gold cells from its own production labels: its catch rate on bad outputs (gold not anticipated, judged not anticipated), its false-fail rate on good ones (gold anticipated, judged not anticipated) and Cohen's kappa. Kappa of at least 0.6 is needed before that judge's contrasts can return any verdict; below it, they read untested (judge). Stage 2 packets carry 40 gold cells per production judge, inserted blind, and the same three numbers print beside every stage 2 result, with the same 0.6 gate. A fixed, seeded subset of 40 gold cells per family is kept in a plain rendering, so the owner could label it later if this eval heads to a public post; nothing asks him to now.

**Pairwise quality (secondary, decides nothing).** For pass 1 of each unit, the judge sees plan.md (or brief.md) with context/, and two normalized lists in random order: the skill's and none's, and the skill's and the lens's. It answers which list would make the product more valuable to its real users, or tie, with one sentence why. No key is shown. The judge follows the same family rule; for particle-1 pairs, Astra and Opus each answer and both print.

### 8. Scoring and volume controls

**Primary, per review: A = credited primary items divided by the unit's primary items.** Credit takes a maximum one-to-one matching between the five changes and the key items over every change index the judge named for each item, so one change can earn at most one item and the credit never depends on which of several matching changes the judge cited first. A unit-pass's A is that share; units weigh equally. The share of changes that name more than one distinct item prints per cell. Secondaries use the same labels: A on R items, on generic items and on mentioned items; the U and E split; A_plan for the brief family; per-item precision (the share of a list's changes credited with any key item); and the specificity score, A minus shuffled A.

**Volume can't win.** Five changes, 40 words each, normalized before judging; one-to-one credit; the specific-match rule; the generic screen; the shuffled-key control; and three stock rows judged in every packet as if they were reviews. The stock rows, frozen:

- **Row 1, users and real life:** (1) Add clear documentation, examples and a quick-start guide for the most common use cases. (2) Support configuration through a config file and environment variables, not only flags. (3) Make it work well on Windows, in containers and in CI environments. (4) Improve error messages so users can tell what went wrong and how to fix it. (5) Provide a migration path and deprecation warnings so existing users are not broken.
- **Row 2, expansion and rollout:** (1) Ship a minimal first version behind an opt-in flag, gather feedback, then expand. (2) Expose an API or plugin hook so other tools can build on this. (3) Add integrations with the most popular tools in this ecosystem. (4) Add a dry-run or preview mode so users can see the effect before applying it. (5) Collect usage data or feedback to learn how people actually use it.
- **Row 3, the skill's own checklist (never used to screen):** (1) Describe the 12-month ideal and build toward the best version of this feature, not the minimal one. (2) Add five small delight features next to the core flow. (3) Put the new behavior behind a feature flag, with a rollback plan and a post-deploy checklist. (4) Add logs, metrics and alerts for every new code path. (5) Plan phases 2 and 3 so this becomes a platform other features build on.

**Consistency and stock checks.** Rows 1 and 2 should anticipate no primary item after the screen, so their count is a consistency check on the judges. Row 3 is the guard on the skill's own generic moves. A stage reads STOCK FAIL when any one row is credited with a primary item on more than 3 of the 24 calibration units (stage 1) or on more than 4 of the comparison units (stage 2). In stage 1 that stops the family; in stage 2 every contrast of the family reads untested (stock).

**Length.** Beside each primary, a length-adjusted difference: the unit-pass difference in A regressed on the difference in the two lists' word counts, with the intercept and its cluster-bootstrap interval. Words can carry real content, so this is a sensitivity read, never the verdict. The pairwise secondary reports the raw win rate and a length-controlled win rate (a logistic model of the preference on the arm and the word-count difference, read at equal length).

### 9. Attacks on the scores, answered before code

1. *Volume and verbosity.* The five-by-40 cap, mechanical normalization, one-to-one credit, the stock rows and per-item precision; length-adjusted reads print beside every judged number.
2. *Generic hits.* The specific-match rule, the generic screen, the shuffled-key control and the stock checks, including a row built from the skill's own checklist.
3. *Self-preference.* Under R78 no model judges its own family's lists; particle-1 gets a three-family median.
4. *A judge that labels badly.* The non-circular judge check with known-bad and known-good anchors, kappa of at least 0.6 to gate, and a blind stage 2 re-check.
5. *Style revealing the arm.* gstack's words ("10x", "platonic ideal") could tip a judge. Normalization strips formatting, labels are factual matches against a key, and the style-sensitive pairwise read decides nothing. A descriptive probe asks Astra to guess the arm of 30 random lists; above 70% correct, the post flags it.
6. *Position.* Pairwise order is random per pair; the first-position win rate prints.
7. *A key written in a reviewer's voice.* Key items are observed facts, not advice, and auditors check that wording.
8. *Hindsight.* The band's floor (section 10) catches a key that is mostly unforeseeable; the auditors' foreseeable rating gives a printed yes-and-maybe stratum.
9. *Echoing the plan.* Mentioned items leave the primary.
10. *Leaks.* Inputs come only from material dated before the plan, with names replaced; the window starts at Opus 5.5's stated cutoff; web tools are denied; and each model's own cutoff is checked (section 11).
11. *Item-count weighting.* Units weigh equally, with at most 6 primary items each.
12. *Truncation.* The 40-word cut can drop a long change's tail; the cut share prints per cell.
13. *Failures scored as misses.* Infrastructure failures are missing, never 0, and count against coverage.

### 10. Stage 1: headroom, judges and exposure

Both families, on the 24 calibration units:

- Opus none, 3 passes per family (72 reviews each); Sol none and particle-1 none, 2 passes each.
- Smoke: 6 Opus sessions of each gstack arm, 2 each on Sol and particle-1, and 2 lens sessions on Opus per family, read for exposure, block parse and cost.
- The production judges label every list, stock row and oracle list; the separate judge-check pass labels the check set.

**Which units admission reads.** The twin check (section 4) reads first, from the plan family's Opus none passes, because it decides which units the primary holds. If the twins track, admission reads all 24 calibration units, with the public and transposed rates printed apart. If they don't, the primary is real public units only, so admission reads public units only: 8 more closed-window public units join the calibration slice before admission is read (16 public units, 48 Opus none reviews per family, the 2026-11-04 design's size), they get the same arms, passes and labels as the first 8, and the transposed calibration units print as descriptive. The extra 8 units cost about $15 and come out of the reserve.

**Admission per family:** HEADROOM when Opus none's A on the admitted calibration units is from 0.10 to 0.60, the stock checks pass, every production judge passes the judge check (kappa at least 0.6), and at least 95% of none replies parse. FLOOR (under 0.10) is FIX-METHOD on task fit and ends that family; CEILING (above 0.60) ends it with the reading that plain Opus already does this; STOCK FAIL and NO READ (a judge check or parse failing) end it. Why these edges: with about 3 items a unit, 0.10 is one item in ten, below which the record is mostly unforeseeable from the plan; at 0.60 on 72 reviews with a design effect of about 2, the upper 95% bound is about 0.76, which still leaves about 0.24 of room, more than twice the design MDD; on the public-only fallback's 48 reviews the bound is about 0.78, still about 0.22 of room.

**Smoke rules, fixed now.**

1. *Parse.* Each gstack arm must return a parsable block in at least 5 of its 6 Opus smoke sessions, or that family reads FIX-METHOD on the instrument.
2. *Expansion reaches the block.* If fewer than 4 of plan-ceo-review's 6 Opus smoke blocks carry a 0F or 0G expansion proposal, the arm adds one sentence after its first line, the owner's standing preference: "Take your recommended option at every decision, scope additions included." It reruns 6 Opus smoke sessions. If that also fails, the plan family reads FIX-METHOD on the instrument.
3. *Exposure.* plan-ceo-review must be exposed (section 5) in at least 5 of its 6 Opus smoke sessions. If it isn't, its stage 2 arm runs with gstack's opt-in gate (gstack-skill-gates settings --ceo-review at the same pin), named "plan-ceo-review with gstack's opt-in gate" in every headline, and its own 6-session smoke must pass. Exposure under the gate still reads from section 5's detector, never from the gate's own report, so it can't be true by construction. office-hours has no gate: under 5 of 6 Opus sessions exposed, its stage 2 doesn't start, and the reading is FIX-METHOD on the instrument (it needs a simulated founder).
4. *Sol and particle-1.* A gstack arm exposed in 0 of 2 smoke sessions on Sol or particle-1 still runs, but that model's skill contrasts become descriptive.

**Taste check.** After stage 1, the crew builds the owner's packet (section 15).

### 11. Stage 2: the comparison

Up to 80 comparison units, run in two waves when late public units would otherwise hold the run: wave A on transposed and closed-window public units, wave B on public units whose windows close by 2026-11-20, each unit's cells all inside one wave, with the primary read once after both. Plan family first: none, lens and plan-ceo-review on Opus at 2 passes, and on Sol and particle-1 at 1 pass. Brief family second, the same cells with office-hours, only after the plan family's stage 2 ends without an instrument failure, and only if the brief family read HEADROOM.

**Primaries, per model and family:** skill minus none, and skill minus lens, on A. Reviews pair by unit and pass, clustered on the unit (the cluster taken from each review's unit field, with #273's check that the cluster count equals the unit count); the difference with a 95% cluster-bootstrap interval (10,000 draws, seed 20261108) and a two-sided cluster sign-flip p; Holm over the two contrasts. Every comparison prints paired, with its interval and the count of units whose A got worse.

**Verdicts (R56 and R78 words).**

- **helps** (or **hurts**): Holm p at most 0.05, the interval excludes zero, the specificity contrast (A minus shuffled A) has an interval that excludes zero in the same direction, and, when transposed units are in the primary, the point estimate has the same sign on real public units and on transposed units. A sign split reads "not consistent across sources", and its pooled numbers stay descriptive.
- **no measurable difference**: the interval includes zero. The MDD and the interval print with it.
- **not shown**: any other comparison that none of the untested conditions below touches but that meets neither rule above: an interval that excludes zero but fails Holm, a failed specificity contrast, or a sign split between sources ("not consistent across sources"). It prints as "not shown" with the requirement it failed, its interval and the MDD, and it supports neither KEEP nor CUT-CANDIDATE.
- **untested**: exposure under 0.80, coverage (scored reviews over planned) under 0.90, a stock fail, a judge check under kappa 0.6, or leak exposure (below).
- **Interim exposure stop:** after the first 32 Opus skill sessions of stage 2, a skill arm with exposure under 0.70 stops; its cells read untested and its remaining caps are released.
- **Leak exposure:** before stage 1, the build records each model's stated training cutoff from its provider's published documentation. A model whose stated cutoff falls after a unit's plan date has that unit's cells marked leak-exposed: descriptive, and out of that model's primaries. If more than a quarter of a model's units are leak-exposed, its primaries read untested (leak). A model with no published cutoff runs, with that limit stated beside its results.

**Reading rule, fixed now.**

- **KEEP** on a model needs skill minus none to read helps. It is worded "anticipates more of real users' post-launch needs", and it is flagged when the pairwise secondary shows the skill losing (a length-controlled win rate below 0.5 with an interval that excludes 0.5).
- **The one-line framing carries the gain** is written only when skill minus none helps and either lens minus none helps, or skill minus lens has an upper bound below the design MDD. That reading is an R48 lead to cut the lines that don't help.
- **CUT-CANDIDATE** on a model needs skill minus none's 95% upper bound below the design MDD at the run's final size and item mix (section 12), with exposure at least 0.80, admitted headroom, passing stock and judge checks, and coverage at least 0.90. A null whose upper bound reaches the MDD is "no measurable difference" and FIX-METHOD on power.
- Any null covers anticipating users' needs and the product's evolution. It covers first version and rollout only if the comparison units hold at least 30 R items; otherwise those read untested.

**Secondaries (decide nothing):** A on R, generic and mentioned items; the U and E split; A_plan; per-item precision; the specificity score; the length-adjusted difference; pairwise quality, raw and length-controlled; lens minus none; plan-ceo-review's mode per session, pending proposals, and A by mode; per-protocol A on exposed sessions; the foreseeable stratum; per-type A for consumer, server-side data or enterprise, mobile and other, each with its MDD; A by source kind, with the primary on units that started as real plans; A by source (real public and transposed) and by inspiration source (Capy and public); the twin check's pairs; the arm-guess probe; cost per review and per credited item; the brief family against the plan family, descriptive only, since their inputs differ.

### 12. Power and MDD

power.py (attached, seeded, no key) extends the 2026-11-04 prereg's simulation to a share over 2 to 4 items a unit, with item noise (sd 0.8 on the logit scale) around each unit and effect noise tau 0.5; "m 1" rows are the one-item binary bound and reproduce #273's design MDD, and "m 1-2" rows draw one or two items a unit, the mix the supply count's full window reads found (median 1.5). From power.txt, at alpha 0.025 (Holm's first step) and 80% power:

| Cells | Units | 2 to 4 items, control 0.20 | 2 to 4 items, control 0.35 | 2 to 4 items, control 0.50 to 0.60 | 1 or 2 items, control 0.20 | 1 or 2 items, control 0.35 | Binary bound |
|---|---|---|---|---|---|---|---|
| Opus, 2 passes | 80 | 0.05 to 0.07 | 0.05 to 0.08 | | 0.07 to 0.10 | 0.07 to 0.11 | 0.08 to 0.13 |
| Sol, particle-1, 1 pass | 80 | 0.07 to 0.10 | 0.07 to 0.11 | | 0.10 to 0.14 | 0.11 to 0.16 | 0.12 to 0.19 |
| Opus, 2 passes | 64 | 0.06 to 0.08 | 0.06 to 0.09 | 0.06 to 0.09 | 0.08 to 0.12 | 0.08 to 0.13 | 0.10 to 0.15 |
| Sol, particle-1, 1 pass | 64 | 0.08 to 0.11 | 0.08 to 0.12 | 0.08 to 0.13 | 0.12 to 0.16 | 0.12 to 0.18 | 0.15 to 0.22 |
| Opus, 2 passes | 48 | 0.08 to 0.10 | 0.07 to 0.10 | | 0.11 to 0.14 | 0.11 to 0.15 | 0.13 to 0.18 |

Each range spans ICC 0.843 (#273's measured value) to 0.5. Effect noise from tau 0 to 1.0 moves the 64-unit Opus rows by at most a point. The design MDD is the conservative end at the item mix the full reads found: **11 points on Opus and 16 on Sol and particle-1 at 80 units** when units carry 1 or 2 items; 13 and 18 at 64; 15 and 21 at 48. Units with 2 to 4 items would bring it down to 8 and 11 at 80 units, and all single-item units would push it to the binary bound (13 and 19 at 80 units). The projection rerun reads the MDD at the actual count and item mix, taking the rows nearest the audited units' mean items a unit, and that figure is the design MDD every verdict uses. The Sol and particle-1 MDD is wide at one pass; a gain smaller than about 16 points on those models will read "no measurable difference", which this plan accepts for its cost. Per-type cells (descriptive, Opus at 2 passes, alpha 0.05): about 13 to 14 points at 24 units, 18 to 19 at 16, 22 to 26 at 12, and above 40 at 8. The projection rerun before stage 2 re-estimates the variance components from stage 1 and reprints every MDD at the final size.

The prior, stated before data: a gain of 5 to 15 points on Opus is plausible, because the skill's expansion steps and rollout section ask for exactly what the key holds, while plain Opus told to "make it better" leans toward critique; the lens may take part of it. At an 11-point design MDD, this design can miss a real gain in the lower half of that range.

### 13. Money

**Sessions.** Planning figures start from #273's measured costs (Opus none $0.127, standalone $0.674, enforced $0.717; Sol none $0.074, standalone $0.653; particle-1 none $0.008, standalone $0.062), raised for this task: none and lens $0.15 on Opus, $0.09 on Sol, $0.010 on particle-1; plan-ceo-review in its expansion modes $0.90, $0.85 and $0.08; office-hours $1.00, $0.90 and $0.09. Stage 1's smoke replaces these with measured figures before any stage 2 cap is set.

**Judges.** List prices in the repository's price table at build 2ef58339 (src/runner/pricing/prices.ts, per million tokens): GPT-6 Astra $10 input and $50 output, Opus 5.5 $4 and $20. Gemini 4 Argon is added to that table at the build commit at OpenRouter's list price on the build date; it votes only on split particle-1 cells. Per call, with reasoning billed as output: a label packet about 4,000 input and 3,000 output tokens (Astra about $0.19, Opus about $0.08); a pairwise call about 3,800 and 1,000 (Astra about $0.09, Opus about $0.035); a judge-check packet at maximum effort about 4,000 and 8,000 (Astra about $0.44, Opus about $0.18).

| Judge item, per family | Calls | Projection |
|---|---|---|
| Stage 1 production labels on 24 units, with shuffled keys | about 192 packets | $26 |
| Stage 1 judge check, separate pass, Astra and Opus at maximum effort | about 144 packets | $45 |
| Stage 2 labels at 80 units, with shuffled keys and blind gold cells | about 640 packets | $89 |
| Stage 2 pairwise, pass 1 only | about 640 calls | $40 |
| Arm-guess probe and Gemini tie-breaks | about 60 calls | $4 |
| **Per family** | | **$204** |

**The line, at caps.** Run caps are 1.6 times projection in stage 2 and about twice projection in stage 1; judge caps are 1.6 times projection.

| Line | Plan family | Brief family | Both |
|---|---|---|---|
| Stage 1 runs (24 units, smoke fallbacks included) | $60 | $60 | $120 |
| Stage 2 runs (80 units; projections $282 and $303) | $452 | $485 | $937 |
| Judges (projections $204 a family) | $327 | $326 | $653 |
| Authoring and mining: 64 public units with full window reads at about $5.50; 46 transposed units at about $6.00 plus their Astra checks and recognition probes (a $25 ledger item); inspiration mining about $40; type classification about $20; brief layer about $50 | $730 | $50 | $780 |
| Crew (this plan and its review, the build, run threads, results and its review) | $280 | $40 | $320 |
| Runner hosts | $13 | $7 | $20 |
| Owner's taste check (render only) | $3 | | $3 |
| Reserve | $50 | $20 | $70 |
| **All-in at caps** | **$1,915** | **$988** | **$2,903** |

Expected spend is about three quarters of the caps (about $2,180 for both). Crew is priced at about $1 per 1,000 credits and $0.43 per million tokens. The whole line sits inside its $4,000 guideline at caps, under the $5,000 stop. The judge check costs about $90 of projection for both families ($144 at caps), and the transposed units' Astra checks and recognition probes about $14 ($25 at caps). Astra costs five times Sol per token, so R78's cross-family judging is most of the judge line. The owner's taste check costs about 40 minutes of his time.

**Net-envelope rules.** Crew or authoring overrun comes out of stage 2, never out of stage 1 or the judge check. Before stage 2, the run thread reruns the projection on stage 1's measured costs and crew actuals. If it doesn't fit, the brief family's stage 2 is cut first, then the Sol cells (with R54's reason written in the post), then comparison units down to 48; particle-1 stays, since its cells cost almost nothing. The MDD at the smaller design is reported before spending, and the line is never padded.

### 14. Office-hours: the same instrument one level up, and the order

The key (what users raised and what the project built after launch) doesn't depend on the input, so the same units, judges, stock rows and scorer serve both families. Only the input changes: brief.md (the problem before any plan) for office-hours, plan.md for plan-ceo-review. The brief family's none and lens arms are its own controls, so its primaries never compare across families. Brief-family A is the narrower construct (section 3): it credits only what reality added after the plan, and A_plan prints beside it.

**Order:** both layers are authored now, and both families' stage 1 runs together. The plan family's stage 2 runs first, and the brief family's second, only after the plan family ends without an instrument failure. Why: plan-ceo-review's verdict is the open record to correct; maintainers' plans are the native input of these units, so the instrument's first read is on home ground; and if the instrument fails there, it would fail for office-hours too, which saves the brief family's stage 2 caps. Both families report in one results post.

### 15. The owner's taste check

After stage 1, the crew renders 10 blind pairs from calibration units only: 7 from the plan family and 3 from the brief family, each pairing Opus's skill list with Opus's none or lens list (seeded draw), arms hidden and order randomized. Each pair shows a summary of at most 150 words of the plan (or brief) and context, then the two normalized lists. It never counts toward any score, and no comparison unit or key is shown. The Captain hands the owner this text:

> Ten pairs follow. Each starts with a short summary of a real product plan, or the idea behind one, and what the team knew. Then come two lists, A and B, each with up to five changes someone proposed. For each pair, pick the list that would make the product better for its real users, or say tie, and add one line on why. Reply with one line per pair, like "3: B, it sees how people will actually use the export." It takes about 40 minutes. Your picks never change any score; they check our judges.

The post reports, descriptively, how many of the 10 pairs each pairwise judge agreed with the owner on, with a Wilson interval, and how often the list with the higher A was his pick. His reasons are logged for the next judge brief, never edited into this one. The render costs about $3.

### 16. Option (c), weighed

Option (c) from the 2026-11-04 prereg builds from the reviewed plan and the plain plan, then grades what ships. Rejected for this test:

- **Construct.** Hidden tests grade the spec a unit's author wrote. They can't see a user's real-life need, a follow-on feature, a staged rollout or a better first version, and a review that widens scope can only lose on them. The owner's construct lives after launch, which a sandbox build never reaches.
- **Cost and noise.** A build session per arm per unit costs several times a review session, and builder variance would swamp the plan's effect at any size this line can buy.
- **Overlap.** #271's Go feature eval already builds from autoplan's reviewed plans, and autoplan runs a CEO phase.

What would flip it: a distinguished gain here on Opus, which makes (c) the natural next test of whether the gain survives into code, keyed to the follow-on pull requests these units already record.

### 17. Start rules, build and stops

1. No paid call before this post merges and the Captain records each item's cap. Every paid call goes through the ledger and the metering proxy; a cap stop is an incomplete run, never retried to change a verdict.
2. **R77.** This experiment gets this post and one results post. The build (the plan-changes parser, normalizer and lenient parse, the arms with web tools denied and mounts per family, both procedure detectors, packets with shuffled keys and gold cells, the judge brief and audit prompt, the Astra, Opus and Gemini judge clients with caching, the oracle-list script, the scorer for A with one-to-one credit and every secondary, the stock rows, the type classifier records, and the four-paths alias guard owed from #273's merge script) is built on a branch, every paid run is pinned to that exact commit, and the commit lands with the results.
3. **Reason codes** the build adds to src/errors/codes.ts with doc anchors: E_PV_NO_BLOCK, E_PV_INFRA_MISSING, E_PV_WEB_CONTAMINATED, E_PV_LABEL_MISSING, E_PV_JUDGE_KAPPA, E_PV_STOCK_FAIL, E_PV_NO_READ, E_PV_EXPOSURE_FALLBACK, E_PV_EXPOSURE_STOP, E_PV_LEAK_EXPOSED, E_PV_PROVIDER_DRIFT and E_PV_SUPPLY_SHORT.
4. **A keyless dry run drives every frozen rule** before stage 1: the normalization and lenient parse; both sides of each band edge (A at 0.09, 0.10, 0.60 and 0.61; kappa at 0.59 and 0.60; stock credits on 3 and 4 calibration units; the twin check at a mean difference of 0.10 and 0.11 and a Spearman correlation of 0.39 and 0.40, with admission then read on all 24 units or on the public-only slice; a sign split between sources; an interval that excludes zero but fails Holm; one change matching two items beside a second change matching one of them); a no-block reply, an infrastructure failure with its retry, and a web-contaminated session; one-to-one credit where one change names two items; a particle-1 split settled by the third vote; the generic screen and the mentioned flag; the shuffled-key derangement; refusal of WebSearch and WebFetch; the per-family mounts with key.json absent; the expansion and exposure fallbacks; the interim exposure stop; and one ledger lease per item on a temporary ledger.
5. Stage 1 runs only after the dry run passes and authoring is complete or has a fixed schedule. Stage 2 runs only on HEADROOM and passing smoke rules, after the projection rerun fits.
6. Sol runs through OpenRouter pinned to OpenAI's provider with fallbacks off and data collection denied. particle-1 runs through OpenRouter pinned to its serving provider with data collection denied, and its first call records the provider and its terms. Any provider change stops that model's items for the Captain.
7. Every launch uses a sink directory that doesn't exist before it, checked and recorded (the #248 ruling).
8. Any finding in review that would move a scored outcome comes to the Captain before a fix.

### 18. Custody, outside terms and public safety

Units, keys, transposition sources, judge labels and every review stay sealed in the Captain's drive with committed digests only. Material from the owner's Capy threads never leaves custody, and committed text carries no project name, quote or paraphrase from it. Everything is decrypted in /dev/shm under the custody rules. The public record is open-source, but a published copy of the keys would let later models train on the answers.

Outside terms: GitHub's terms of service and API rate limits for mining (public data, no scraping past limits). The basis for using issue, discussion and comment text is research use under GitHub's terms: it is summarized into key statements with names replaced, sealed and never published, and repository licences (section 4's list) cover in-repository design documents, which are preferred. Model terms: OpenAI's API terms for Sol and Astra (30-day abuse-monitoring retention, no training on API data, disclosed as in #273); Anthropic's for Opus; OpenRouter's and the serving provider's for particle-1 and Gemini, with data collection denied. gstack's own licence covers the skills. The owner's taste check uses his time only.

### 19. What the results post reports

The post opens with 2 or 3 takeaway bullets for builders, what works first and the null right after (R79). Then, per family and model: every primary with its interval, p, Holm p, the count of units that got worse, exposure, coverage, MDD and verdict, and beside it the judge model and version, its catch rate, false-fail rate and kappa, the specificity contrast and the length-adjusted line; stage 1's rates and judge check; the stock, generic and mentioned counts; every secondary of section 11; the type distribution and per-type reads with their MDDs; cost per review, per credited item, and the line's all-in on actuals with a dated price table; R48's Why null? cycle where a primary is null; the taste check; held-out disclosure; the closing disclosures. Every pilot, stop and null goes on the research registry.

### 20. Risks, limits and not in scope

- Supply is the binding risk. The first free count, on maintainers' plans alone, found too few units, most of all for server-side software; the widened frame (section 4) answers it. Six weeks of post-launch record suits fast-moving projects; slower ones drop out.
- PR-as-plan units are rewrites of what a team wrote while building, not before; the frozen rewrite and the real-plan read guard that.
- A post-launch record is what a few vocal users and a project's maintainers produced, not the whole truth about what users needed.
- Every arm runs without web tools and unattended. Both skills want web research and a person to talk to.
- Judges are single models per arm under R78; the judge check and its stage 2 re-check are the guard.
- Transposed units carry home-field risk (gstack was shaped on the owner's projects) and translation risk (a re-skinned event may be easier or harder to foresee). The twin check, the source split and the sign rule are the guard. With 8 pairs the twin check catches only a gross mismatch; passing it does not show the two kinds of unit are equivalent, which is why the sign rule and the source split stay in force when it passes.
- Not in scope: building from reviewed plans (section 16), autoplan's CEO phase, the design and devex reviews (the same instrument can serve them later), engineering critique, and any parity claim.

## Review record

Lean /autoplan run autoplan-20261108172030: one Opus 5.5 reviewer read the plan with DRAFT: none and returned 24 findings (2 Critical, 9 High, 8 Medium, 4 Low, 1 Informational) and no user challenges. The owner's approval took every recommendation; the Medium, Low and Informational findings were folded in the same revision.

| Finding | Where it landed |
|---|---|
| Critical: unattended mode can leave expansion proposals pending | section 5 (the pin's behavior and mode rule), section 10 smoke rule 2 |
| Critical: server-side web search escapes an offline container | section 5 (web tools denied, contamination rule), section 17 dry run |
| High: exposure was a load gate | section 5 (procedure detectors), section 10 smoke rule 3 |
| High: the stock check re-asked the screen | sections 7 and 8 (shuffled-key control, row 3, consistency check), section 11 (helps needs the specificity contrast) |
| High: one change could match several items | sections 7 and 8 (change indices, one-to-one credit) |
| High: the reading rule overreached | section 11 (CUT-CANDIDATE margin, framing rule, R coverage floor, KEEP wording) |
| High: failures were not separated | section 6 (failure rules), section 10 smoke rule 1 |
| High: supply was a placeholder | section 4 (count, pilot first, stops) |
| High: echoes of the plan scored as foresight | section 3 (mentioned items) |
| High: other models' cutoffs | section 11 (leak exposure) |
| High: judge recovery | section 7 (missing labels), section 17 (reason codes) |
| Medium: exposure smoke power and Sol and particle-1 smoke | sections 10 and 11 (interim stop, descriptive rule, gated naming) |
| Medium: stage 2 agreement | section 7 (blind gold cells in stage 2) |
| Medium: band arithmetic and power rows | sections 10 and 12 |
| Medium: judge line not itemized | section 13 |
| Medium: mounted files and the design doc's location | section 5 |
| Medium: first version of edited records | section 4 |
| Medium: outside terms and particle-1's provider | sections 17 and 18 |
| Medium: the brief family's narrower key | sections 3 and 14 (A_plan) |
| Low: cut order | section 13 |
| Low: taste check routing and its flag | section 15 |
| Low: E-item ranking | section 3 |
| Low: reason codes | section 17 |
| Informational: error control per model and family | section 1 |

After the gate, five Captain rulings inside the approved plan changed it without a second gate: project-type strata with a frozen rule and quotas; R78's cross-family judges and non-circular judge check; the widened public frame (any accepted author, PR-as-plan with a frozen rewrite, a 500-star floor, plans to 2026-09-30, at least 1 primary item) after the first free count tripped the supply stop; transposed units with a twin check and a source split; and R79's public lesson.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
