---
id: 2026-11-08-geva-405-eng-review-intentions-prereg
kind: plan
title: "Preregistration: does gstack's engineering plan review get a change's risky paths tested? Each review is graded on where real post-merge bugs and later tests landed, with a headroom check and a judge check first"
summary: "Real changes merged July to September 2026, keyed to the bugs, reverts, tests and CI that followed within 60 days. Arms: none, lens, pre-cut skill, autoplan's eng phase, a rebuilt candidate."
author: GEVA-405
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-08
status: open
links:
  - 2026-11-03-geva-250-panel-v3-headroom-results
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-06-geva-364-g-admission-results
  - 2026-11-08-geva-397-autoplan-larger-features-prereg
  - garrytan/gstack#4108
  - garrytan/gstack-evals#191
  - garrytan/gstack-evals#253
attachments:
  - b6363cd9457125e71300977f322e56fcf6fb51ed5b660cca7760b66f18166510  power.py
  - b157d572138336f4daa2414ba6bf3451c62ab4fce1f9eaff3b42b4f2b43c3430  power.txt
---

# Preregistration: does gstack's engineering plan review get a change's risky paths tested?

## Approval

Gate 1 approved on 2026-11-08, after one lean gstack /autoplan review (run autoplan-20261108214645, gate revision 1, one Opus 5.5 reviewer), by the project owner through the Captain (approval record a-b9995e1ed024). The owner took every recommendation: the six review changes (A to F, applied in sections 5, 6, 7, 10, 11, 13 and 16), the 16 smaller review fixes (H), a wider unit frame (I), copyleft repositories under sealed custody (J), the candidate request (K, section 15), the narrowed verdict (L, section 2) and the eval's own line (M): a $4,000 all-in guideline, because it judges with GPT-6 Astra, with any projection past $5,000 going back to the owner. This post approves no item's spend: no paid call runs until it merges and the Captain records each item's cap.

## ELI5

gstack had a skill, plan-eng-review, that reviews a plan the way a careful engineering manager would before anyone writes code. Its main job is not to find bugs in the plan. It is to draw every code path the change will touch, check which of those paths already have tests, decide where a unit test, an end-to-end test, a CI job or an eval is the right tool, and so pick the tests that would catch the change's regressions. Our earlier tests only asked whether a review found flaws we had planted in a plan, and whether the built feature passed its tests. Plain Opus aced both, so the skill was cut. Neither test looked at the skill's main job. This test does, using what really happened. We take real changes that open-source teams merged after the models' training cutoff, in consumer apps, server-side and enterprise software, mobile apps and developer tools. For each change we already know its later history: the bugs that were later traced back to it, any revert, and the tests and CI jobs the team added in the next two months because the change had left a path unguarded. Each reviewer gets the team's plan and the code as it stood before the change, and writes a short list of the checks the change should ship with. A list scores when it names the exact path and condition where a real bug or a later test landed. A long list can't win, because only eight short checks count and generic test lists must score near zero. We compare five setups on Opus 5.5, GPT-6.1 Sol and particle-1: no gstack, a one-line engineering-manager prompt, the skill as it was just before the cut, autoplan's engineering phase on its own, and a rebuilt skill that keeps paths, coverage, tests, CI and evals and drops the bug-hunting. Judges come from a different model family than the model judged, and they are checked against known answers before any number counts. On a smaller set, a plain agent then builds each change from each reviewed plan, and we check whether the shipped code avoids the real bugs and whether its tests would have caught them.

## Before → after

Before: plan-eng-review carries a CUT-CANDIDATE that rested on two tests of other things. Panel v3 (#191) asked whether a review found planted flaws (plain Opus 5.5 found 15 of 16, and no gstack arm ran). The G admission (#253) asked whether the built feature passed hidden tests (plain Opus solved 22 of 22, and told sessions showed the procedure in 0 of 18, which R56 counts as untested). gstack cut the standalone skill on that record (garrytan/gstack#4108); autoplan keeps its eng phase. Nothing has measured path maps, coverage, test choice, CI or evals.

After: a frozen test whose answer key is what really happened after real changes merged. It reports, per model with paired intervals, whether the pre-cut skill, autoplan's eng phase and a rebuilt candidate each name more of the paths where real bugs and later tests landed than the same model with no gstack, and than a one-line engineering-manager prompt. A headroom check runs first, a judge check gates every verdict, and a build-level secondary checks what ships. The earlier verdict is narrowed now, in section 2.

## Why it matters

The project owner asked the crew to test what plan-eng-review is for, not only its easiest reading, and said that mapping code paths, improving coverage and thinking through tests, end-to-end tests, CI and evals is the useful part. The crew's construct-fit rule of 2026-11-08 forbids a cut on a null that didn't cover a skill's main claim. Without this test, the cut stands on evidence about a secondary job, and nobody knows whether the cut threw away the part that worked, whether autoplan's eng phase still carries it, or whether a smaller skill would do better.

## What caused this work

gstack#4108 cut the standalone skill after the panel v3 and G admission results. The registry's correction line of 2026-11-08 narrowed the verdict, and the Captain asked for a plan that scores the skill's intentions, with the no-gstack arm, the pre-cut skill, autoplan's eng phase and a rebuilt candidate from GStack Minder.

## Big decisions

1. **Primary construct and score.** Options: (a) aftermath anticipation: the share of a change's real aftermath (post-merge bugs traced to it, defect reverts, follow-up tests and CI changes) that the review's capped list of checks names, path and condition both; (b) a judged quality score of the review's path map and test plan; (c) building from each reviewed plan and grading what ships. Pick (a) as the primary, (b) as a length-controlled pairwise secondary and (c) as a descriptive stage 3 on 24 units. Why: (a) is grounded in what happened after the plan and dated after it, so no reviewer can copy it and no judge's taste sets it; (c) answers the "fewer untested paths, regressions caught" half of the claim directly but costs several times a review per cell. What would flip it: stage 1 reading FLOOR (the aftermath is mostly unforeseeable from a plan), which makes (c) the primary of the next attempt.
2. **The scored artifact.** Options: a neutral "changes to the plan" list, or an eng-plan block of at most 15 paths and 8 checks that every arm writes. Pick the eng-plan block. Why: the claim is that the procedure makes a better path map and test plan, so the fair test asks every arm, none included, for the same artifact; the lens arm then measures what one line of framing adds. What would flip it: the stock rows scoring above their limit in stage 1, which would show the format itself carries the score.
3. **The pre-cut pin.** Pick gstack b493d4e31, the v1.97.0.0 release commit, the last release that installs the standalone skill. The cut (3742ee95) merged after that release's changelog fold and first shipped in 1.98.0.0. plan-eng-review/ is byte-identical from the 1.96.0.0 release through the cut's parent, so every candidate pin carries the same skill text.
4. **autoplan's eng phase alone.** Options: (a) the orchestrator's Phase 3: the session holds what an autoplan session holds when it enters Phase 3 at gstack 199931029 (1.98.0.0), that is autoplan's decision principles and auto-decide rules, the eng phase's override rules and checklist, and plan-eng-review's method by autoplan's own read ranges, with the earlier phases marked skipped and the outside voice unavailable; (b) only the generic five-question prompt autoplan sends its native eng voice, rendered by gstack's snapshot tool; (c) a full /autoplan run scored on its Phase 3 output; (d) the lean driver (--kind feature), which merges the CEO and Eng lenses. Pick (a), as the gate answered (A1). Why: Phase 3 is where autoplan actually runs plan-eng-review's method, while (b) is one voice inside it and never asks for the coverage diagram; (c) costs about 20 times a none session and showed its procedure in 0 of 23 G sessions; (d) is not the eng phase alone. Exposure is not guaranteed by construction: the arm passes the same detector and smoke gate as every skill arm.
5. **Forcing the procedure.** Pick a forced invocation for every skill arm (the skill named, plus one fixed sentence: run the whole procedure unattended and take the recommended option at every decision), a procedure detector frozen per arm, a smoke gate of 5 of 6 Opus sessions, and a harness Stop hook (gstack-evals code, not gstack) as the frozen fallback. Why: G's told arm showed the procedure in 0 of 18 sessions, and R61 needs exposure proven before any comparison counts.
6. **Models and size.** Pick 16 calibration and 56 comparison units; Opus 5.5 at 2 passes, and GPT-6.1 Sol and particle-1 at 1 pass, each on all five arms. Design MDD on Opus about 10 to 13 points at a control near 0.20 (section 13). 12 points on Opus is the smallest effect worth acting on, and the projection before stage 2 must reach it or the set is re-sized (start rule 5).
7. **Cut margin.** A CUT-CANDIDATE needs skill minus none's 95% upper bound below a frozen +0.05. The trim-to-lens reading (the procedure adds nothing over one line) uses the same margin on skill minus lens. The margin sits below the MDD on purpose, a stricter bound than the crew's admission rule asks for: a skill truly worth 5 points reads CUT-CANDIDATE in only 2% to 5% of simulated runs (section 13). The gate answer (F1) and the Captain's approval record accept that departure.
8. **Project types.** Four named types with quotas: consumer, server-side data or enterprise, mobile, and developer tools. The free supply count found mobile and consumer short under the first frame, so the frame widens for every type (section 4, gate answer I1) and admits copyleft repositories (J1). Transposed units stay the last fallback, used only if a named type still falls short.
9. **The rebuilt candidate.** GStack Minder writes it from a frozen intentions statement and the pre-cut skill's public text, never seeing units, keys, scoring rules or any arm output, before stage 1 starts. The Captain sent the request on 2026-11-08, right after the gate answer (K1), and the candidate, /plan-coverage, arrived the same day. Its commit and digests are frozen in section 15 and land with the results.

## Implementation plan

### 1. The question, the claimed value and construct fit

**Question.** For each model under test, on real changes merged after Opus 5.5's stated training cutoff: does a review by the pre-cut plan-eng-review, by autoplan's eng phase on its own, or by a rebuilt candidate name more of the paths where the change's real post-merge bugs, reverts, follow-up tests and CI changes landed than the same model with no gstack, and than the same model with a one-line engineering-manager prompt?

**The public lesson this eval is after (R79), for someone building agents:** whether a written procedure for mapping a change's code paths and planning its tests makes a frontier model's test plan land where real bugs later landed, beyond what the same model writes when simply asked for a test plan or given one line of engineering framing; and so whether builders should ship such a procedure, a single line, or nothing.

**Claimed value, in one sentence.** Before code is written, plan-eng-review maps every code path and user flow a change touches, puts the existing tests on each path, chooses deliberately where a unit test, an end-to-end test, a CI job or an eval belongs, and plans what to add, so the shipped change has fewer untested paths and catches its regressions.

**Construct fit.** Each part of the skill that carries the claim, at the pre-cut pin, and the key items it can reach (section 3 defines B, T and C):

| Skill part (plan-eng-review at b493d4e31) | What it should add to the review's checks | Key items it can reach |
|---|---|---|
| Test review steps 1 to 4: trace data flow from each entry point; diagram every function, branch, error path and edge (null, empty, invalid) | checks on the exact branch and condition where a defect hides | B, T |
| Test review step 2: user flows, interaction edge cases, error states users see, empty and boundary states | checks on flows and edge interactions | B, T |
| Test review step 3: branch-by-branch match against existing tests, quality stars, the test value bar (each test names the regression it would catch) | checks that fill real gaps instead of repeating covered paths | T, B |
| E2E decision matrix and LLM/eval scope | unit, end-to-end, CI or eval chosen per path | T, C |
| Regression rule | coverage for existing behavior the change puts at risk | B |
| Architecture review: distribution architecture (build, publish, CI/CD) | CI lanes, platforms and jobs | C |
| Required outputs: failure modes, one realistic production failure per new path and its test | the path where it fails in production | B |
| Architecture (other items), code quality, performance, outside voice | engineering critique and bug-hunting | only through B; they compete for the eight slots |

The primary covers the claim's outcome: whether the plan's checks land where untested paths later failed or needed tests. Its parts each get a printed reading: the path map (mechanical recall of the paths the real diff touched, and of the files and functions where real bugs landed), the choice of test type (each arm's mix of unit, end-to-end, CI and eval checks, and the C items), and regressions caught in shipped code (stage 3). Bug-hunting in the plan counts only where a check names a real later defect, and the share of credited checks that propose a code change instead of a check prints separately, so the secondary job can't pass as the main one.

What the score does not cover, said plainly: the live back-and-forth with a person (every skill arm runs unattended), web research (every arm runs without web tools), architecture quality for its own sake, and whether a team would agree to the plan.

**Models under test (R54).** anthropic/claude-opus-5-5 first; openai/gpt-6.1-sol and particle-ai/particle-1 through OpenRouter, as in #273. All run in Claude Code with the claude-code-preset system prompt, and every model runs all five arms. Haiku and Sonnet are not models under test. Error control is per model (Holm over the three skill-minus-none contrasts), and the Opus contrasts are the preregistered headline.

### 2. Correcting the earlier verdict

The CUT-CANDIDATE on plan-eng-review rested on two results. Panel v3's eng stratum (#191) planted engineering flaws in plans and asked whether a plain review found them: plain Opus 5.5 found 15 of 16 and no gstack arm ran, so it measured a ceiling and no lift. The G admission (#253) asked whether a feature built after a told review passed its hidden tests: plain Opus solved 22 of 22, and the told plan-eng-review arm showed the procedure in 0 of 18 scored sessions, which R56 counts as untested. Neither scored a path map, coverage, the choice of test type, CI or evals.

Under R48 and the crew's construct-fit rule of 2026-11-08, the verdict on plan-eng-review narrows to: **no effect on finding extra flaws in a plan (plain Opus 5.5 already finds them); its engineering-planning intentions untested; R48 FIX-METHOD on task fit for the main claim, not CUT-CANDIDATE**, on Opus 5.5. Both posts' numbers stand as published. The registry line of 2026-11-08 already records this, the owner's gate 1 answer adopted it (L1), and this post makes it part of the preregistered record. gstack's cut is gstack's decision and this eval doesn't change gstack's code; its result goes to the Captain and through it to GStack Minder.

### 3. Ground truth: what happened after each change merged

Every unit is a real change its maintainers merged. Its key lists what happened in the 60 days after the merge, in three kinds:

- **B, post-merge defect.** A commit merged within 60 days that repairs a defect in code the unit introduced or changed. Candidates come from SZZ and from reverts. SZZ: a fix (its message, labels or linked issue name a defect) has its edited and deleted non-blank, non-comment source lines blamed with git blame -w -M at the fix's parent; it is a candidate when any blamed line belongs to the unit. Revert: a later revert of the unit, whole or in part, that names a defect. The key writer reads the fix's diff, message and linked issue beside the unit's diff, and keeps the item only when the defect was in the unit's own code path: not a refactor, formatting or unrelated line, not a defect already present at base that the unit only moved, and not one caused by a later change or a later dependency release.
- **T, follow-up test.** A commit merged within 60 days, not itself a fix of the unit, that adds or extends a test checking a behavior of the unit's code that the unit's own tests didn't check. A test for a later feature built on top of the unit doesn't count.
- **C, CI or eval follow-up.** A commit merged within 60 days that adds or changes a CI job, a matrix entry, a platform, a test lane or an eval for the unit's code, or wires the unit's tests into CI.

Excluded: product reverts (the team changed its mind), performance tuning with no defect, docs, typos and dependency bumps.

**Statements.** Each item is a statement of at most 30 words written as an observed fact naming the component or flow, and the file where it helps, and the condition: "The export endpoint returned a 500 when the tag list was empty (api/export.go)"; "Later the project added a test that the importer skips rows with no date"; "Later the project added Windows to the CI matrix for the path-handling module". Never advice, so the key doesn't read like any arm's style.

**Primary key.** B, T and C together, at most 6 items a unit: B first (defect reverts, then fixes linked to an issue a user opened, then other fixes), then C, then T, then a seeded tie-break. Units weigh equally whatever their item count.

**Own-test items (secondary).** The key writer also lists up to 4 behaviors the unit's own tests checked. Lists are labelled against them as a secondary, A_own: how often a review plans the tests the real team wrote. They never enter the primary, because a review that proposes what the team already did adds nothing the change lacked.

**Mentioned items.** A key item whose path and condition plan.md already names as something to test or handle is flagged mentioned. Mentioned items leave the primary and print as their own stratum, so echoing the plan earns no credit.

**Generic screen.** After the audit, Astra and Opus each label every key item against stock rows 1 and 2 (section 8) as if they were reviews. An item either marks as anticipated becomes generic: it leaves the primary and prints as its own stratum. This screen reads no arm output. Stock row 3 never screens.

**Foreseeable rating.** Each auditor rates each primary item yes, maybe or no: could a careful reviewer with plan.md and the base code have named this path and condition? The yes-and-maybe stratum prints beside the primary.

A unit keeps its place only with at least 1 primary item left after the mentioned flag and the generic screen. Drops are counted and reported.

### 4. Units

**Source frame (widened at the gate, I1 and J1).** Public GitHub repositories with at least 500 stars, not forks or archived, pushed since 2026-10-01, with an MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0, GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0 or AGPL-3.0 licence, read from both GitHub's licence API and LICENSE at base, which must agree. Copyleft repositories sit under the same sealed custody as the rest: nothing from them is redistributed or published, and no network service runs from them (section 17). A unit is one first-parent change on the default branch (a merge commit counts as its pull request's net change; a squash commit is one change):

- merged 2026-07-01 to 2026-09-30, with its earliest exposure (its pull request opening, its closing issues opening, its commits' author and committer dates) on or after 2026-07-01. Changes merged by 2026-09-15 form the first wave, whose 60-day windows close by 2026-11-14; the second wave's close by 2026-11-29. No key is written before its window closes;
- a feature or behavior change, not a fix, revert, docs, chore, dependency, release or CI-only change;
- at least 2 non-test source files or at least 40 added non-test source lines;
- a plan text: the pull request's description and its closing issues hold at least 120 words in their earliest recoverable versions, dated before the merge;
- a base checkout of at most 150 MB without .git, and no project .claude/ or .mcp.json at base;
- at least 1 primary key item after section 3's flags;
- at most 4 units a repository for mobile and consumer and 3 for the other types, and no two units where one's aftermath holds the other.

Before authoring, the mining thread compares candidates against the sealed T-G and H task lists in a counts-only custody opening and drops any match, so no sealed unit of another test is reused.

**Project types (strata).** Each unit gets one type by a rule frozen here, applied to the repository's description, README and topics as they stood at base, blind to the key: **mobile** (an iOS or Android app, not a library or SDK); **consumer** (end users run it: desktop, web or browser apps, games, media, notes, chat, personal productivity, home apps); **server-side data or enterprise** (an organization operates it: databases, data pipelines, self-hosted business software, analytics, observability, identity, queues, search engines); **developer tools** (libraries, frameworks, command-line tools, build tools and the rest). The first match in that order wins. Two classifiers, Opus 5.5 and GPT-6.1 Sol, label each unit independently, and Gemini 4 Argon settles a split. The comparison set aims for 14 units of each type and holds at least 10 of each; the calibration slice holds 4 of each. Per-type results are descriptive, each with its own MDD.

**Supply count (free, 2026-11-08).** A free count ran before the gate on the first frame (permissive licences, merges to 2026-09-15, a 200-word plan floor, 3 units a repository), with no model calls: a GitHub search union of the frame per type, a seeded sample of about 10 usable repositories a type, local clones, and the miner's SZZ and revert reads over every candidate change in the window, plus a spot check of precision. Its funnel:

| Type | Frame repositories | Sample repositories usable / tried | Strict candidate changes | Keyable B or R at 100 / 150 / 200 words (repositories at 200) |
|---|---|---|---|---|
| mobile | 115 | 12 / 27 | 373 | 16 / 10 / 6 (3) |
| consumer | 215 | 10 / 32 | 695 | 10 / 8 / 6 (4) |
| server-side data or enterprise | 620 | 10 / 22 | 273 | 23 / 16 / 15 (8) |
| developer tools | 676 | 10 / 24 | 324 | 30 / 29 / 25 (4) |

Keyable means a strict B candidate (at least 2 blamed lines) or a defect revert, with a matched pull request record. Only 16% (consumer) to 55% (developer tools) of strict candidates matched a pull request record in the per-repository search, so the keyable columns are floors. The spot check (12 B pairs and 8 T pairs, seed 20261108) found B precision about 33% to 58%, with merge commits carrying most false ones, and the shared-identifier heuristic for T true in 0 to 1 of 8, so T items come only from key writers' full reads. At the 200-word floor and about 45% B precision, the first frame projected roughly 13 mobile and 20 consumer keyable units before audit, short of the 16 to 20 a type the design needs; server-side and developer-tool supply is ample. The gate widened the frame for every type: the 120-word floor, merges to 2026-09-30, 4 units a repository for mobile and consumer, and copyleft licences. The widened frame has not been recounted. The sample's 100 and 150 word columns suggest about 1.5 times (consumer) to 2.3 times (mobile) the 200-word count at 120 words, before the extra fortnight and the copyleft repositories, which the count left out. The mining thread recounts the widened frame per type, with and without copyleft, before authoring, and section 16's supply stop applies to that recount. The 20 spot-checked changes are excluded from the unit draw.

**Transposed units (fallback).** Used only when a named type has fewer than 10 eligible comparison units from the frame. A transposed unit invents the product, never the outcome: the source change's relevant modules are rewritten into a small fresh repository of the target type with new names and domain, the plan rewritten to match, and every key item maps one to one to a real aftermath event re-created at the same path shape. The guards are the product-value eval's: frozen authoring prompts written before any arm output, an Astra check that each item follows from its event and nothing signposts it, a recognition probe, and results printed by source. Transposed units never exceed a quarter of the comparison set. If any are used, every verdict comes from real units alone, the mixed set prints as a secondary, and a mixed-set difference whose direction disagrees with the real-only one reads not shown.

**Unit files.** Each unit has two inputs and a sealed key:

- repo/: the repository at the unit's parent commit, as a fresh git repository with one commit and no remote, so tools that call git work and no later history exists in the container;
- plan.md: the team's plan, from the frozen rewrite below;
- key.json (sealed, never mounted): the items of section 3 with kind, statement, evidence pointers, dates and flags; for each B item the files and functions its blamed lines sit in; the own-test items; the real diff's touched files and functions (for the path-map secondary); and the auditors' ratings.

**Plan rewrite (frozen prompt).** The authoring model (Opus 5.5) sees only the earliest recoverable pull request description and its closing issues, never the diff, review comments, or anything dated after the merge:

> Below is the description of a change a software team made, and the request that led to it if there was one. Rewrite it as the plan the team would have written before building: future tense, the same goals, scope, commitments, constraints, test intentions and open questions, at about the same length. Keep every decision the description states, including any testing or rollout it promises. Add nothing it doesn't say: no new features, risks, tests, rollout steps or follow-ups, and no implementation detail beyond what it names. Leave out people's handles, names and email addresses. Output only the plan.

Project names are not replaced, because the mounted code names the project anyway; section 11's leak rule covers what a model may recall. Auditors check each rewrite against its source for additions and for anything dated after the merge.

**Blind authoring.** Writers of plan.md never see the key, the diff or anything after the merge. Key writers (Opus 5.5) read the whole window. Every authoring call runs through the ledger at high reasoning effort. Two auditors, Opus 5.5 in a fresh session and GPT-6.1 Sol for a second family, check each unit and give the foreseeable ratings: the inputs carry nothing dated after the merge and nothing that signposts a key item; each key item is supported by its commits, falls inside its window and passes section 3's rules. A unit that fails an audit twice drops.

**Sets and timing.** 16 calibration units, then 56 comparison units, then 6 sealed reserve units, drawn in seeded order (seed 20261108) from units that passed the audit, quotas first. Authoring's first step is a 4-unit pilot end to end, one of each type; its measured cost per passing unit, failures included, sets the authoring cap, and the set is re-sized before more units are authored if the cap and section 14's line don't fit. The comparison set's size, composition and units digest are fixed before the first stage 2 lease. Second-wave keys are written only after their windows close (by 2026-11-29), so the calibration set draws from units whose keys exist when it is cut.

### 5. Arms

Every arm runs in the trial container under the same harness limits: Claude Code with the claude-code-preset system prompt, a 200,000-token context window (CLAUDE_CODE_DISABLE_1M_CONTEXT=1), CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, HARBOR_TELEMETRY=0 wherever Harbor runs, and **WebSearch and WebFetch denied** (Claude Code's web search runs on the provider's side, so a container with no network doesn't stop it). Every review session in stages 1 and 2 has the same limits, whatever the arm (gate answer C1): $10, 200 turns and 90 minutes. The container has no network except the metering proxy, and holds no keys: the proxy keeps them outside the container. A session with any successful web tool result is contaminated: excluded, counted against coverage and reported per arm. Each session sees /work/repo and /work/plan.md only, plus, in the eng phase arm, its rendered phase input (below); key.json is never mounted, and the dry run asserts both. The none and lens arms have no gstack install, no skills folder and no drive mount, so they are clean by construction; the read audit runs after the run as a descriptive check.

Every prompt ends with the common line, a blank line and the frozen template (section 6). The common line: "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it."

| Arm | Prompt before the common line | gstack |
|---|---|---|
| none | (nothing) | not installed |
| lens | "Do an engineering-manager review of this plan." | not installed |
| pre-cut | "/plan-eng-review plan.md" then the forced sentence | garrytan/gstack b493d4e31 (VERSION 1.97.0.0), default Claude Code install |
| eng phase | autoplan's Phase 3 state for this unit (below), then the forced sentence | garrytan/gstack 199931029 (VERSION 1.98.0.0), default install |
| candidate | "/plan-coverage plan.md" then the forced sentence | garrytan/gstack 57295cbc5 (branch eng-review-intentions-candidate), default install with ./setup --host claude (section 15) |

**The forced sentence**, the same for every skill arm: "Run its whole procedure unattended, taking your recommended option at every decision." Every skill arm runs with GSTACK_SESSION_KIND=unattended. The sentence names no step, so it adds no lens of its own and treats the three skills alike.

**The eng phase arm (gate answer A1).** The session holds what an autoplan session holds when it enters Phase 3 at gstack 199931029, with no earlier phase run. Its opening, rendered per unit by the build and recorded by digest, carries:

- from autoplan/SKILL.md, the parts that govern every phase: the 6 Decision Principles with the eng phase's tiebreakers, Decision Classification, What "Auto-Decide" Means, and Step 3's section skip list;
- autoplan/sections/eng-phase.md in full: its override rules, the Eng execution checklist (Step 0, the dual-voice consensus table, Sections 1 to 4) and Phase 3's mandatory outputs, including the test diagram and the written test plan artifact;
- plan-eng-review's method as autoplan selects it: the build runs gstack's snapshot tool (bin/gstack-autoplan-snapshot.ts, methodology eng) on the pinned plan-eng-review/SKILL.md and mounts methodology.md read-only, and the opening tells the session to Read it at every readRanges offset, as the orchestrator does;
- the native eng voice's input: the build runs the tool's create eng step on plan.md wrapped under "## Implementation plan" and "## Review record" headings, so the tool accepts it, and mounts the snapshot read-only; the session dispatches its nativeDispatchPrompt through Claude Code's Agent tool, as eng-phase.md says, and the subagent's cost counts toward the session's limits;
- the CEO, Design and DX phases marked skipped (no earlier phase ran) and the outside voice marked unavailable (no Codex in the container).

Run-directory steps that need a live autoplan run are left out, and the opening says so: phase-close, amend-input, review logs, the plan-reality check and the Phase 4 gate. Every review step, decision rule and required output of Phase 3 stays. Between 1.97.0.0 and this pin, plan-eng-review's review sections changed only in the outside voice's closing lines. This is autoplan's eng phase without its other phases or its gate, named that way in every headline.

**Mode and decisions.** The build records, per skill session, every decision the skill took on its own, any it left pending, and whether the session wrote the skill's test plan artifact.

**Exposure (did the procedure run?).** Detectors are frozen per arm before any smoke output exists and tested on keyless fixtures of exposed and unexposed transcripts:

- pre-cut: the transcript shows the Scope Challenge, Sections 1 to 4 in order, a Section 3 coverage diagram (a block of at least 3 path lines carrying the skill's markers: star ratings, GAP, [→E2E] or [→EVAL]), and a written test plan artifact (a file matching *-eng-review-test-plan-*.md under the state root, which every launch copies into its sink). Reading plan-eng-review/sections/review-sections.md is the load check, printed as a secondary.
- eng phase: Step 0 (Scope Challenge) findings, a native eng voice dispatched with a terminal result, the eng consensus table, Sections 1 to 4 in order with the coverage diagram as above, a failure modes registry, and a written test plan artifact as above. Reading methodology.md through its last readRanges chunk is the load check, printed as a secondary.
- candidate: the session ends with the candidate's three files in /work/repo/.gstack/plan-coverage/, each opening with its own header line (<!-- gstack:plan-coverage path-map v1 -->, <!-- gstack:plan-coverage coverage-map v1 --> and <!-- gstack:plan-coverage test-plan v1 -->); path-map.md holds at least 3 paths numbered P1 or F1 onward, each tagged NEW, CHANGED or AT-RISK; coverage-map.md gives a star rating or GAP for at least 3 paths and ends with its COVERAGE: line; test-plan.md holds at least one test numbered T1 onward with a Kind (extend, unit, e2e, ci-job or eval) and a Catches line; and the reply carries the PLAN_COVERAGE: line. A run whose files say Status: no-plan is unexposed. The build copies the folder into the sink when the session ends, and reading plan-coverage/SKILL.md is the load check, printed as a secondary.

Exposure is read from the detector on the final transcript, never from a gate's own report.

### 6. The closing block, normalization and failures

The template, frozen:

> End your reply with one fenced block labelled eng-plan that holds a JSON object {"paths": [...], "checks": [...]}. "paths": at most 15 code paths this change touches, most important first, each one string of at most 25 words naming the file and the function, component or user flow. "checks": at most 8 checks this change should ship with, most important first, each one string of at most 40 words naming what it exercises, the failure it would catch, and whether it is a unit test, an end-to-end test, a CI job or an eval.

The scorer reads the last eng-plan block in the reply, wherever it sits, so a skill's own closing line after it (such as the candidate's PLAN_COVERAGE: line) doesn't make the reply no-block. A skill arm's own files (the pre-cut and eng phase test plan artifacts, the candidate's three files) are exposure evidence only and never scored: every arm is scored on the same block. Normalization, the same for every arm, stock row and oracle list before any judge reads anything: keep the first 15 paths and the first 8 checks; strip markdown (emphasis, code ticks, links, headings) and leading numbering; collapse whitespace; cut each path at its 25th word and each check at its 40th; render as numbered plain lines. The run reports, per cell, the mean words and items per block and the share of items the cut shortened.

**Failures, fixed now.**

- A completed reply with no eng-plan block scores 0 on every block score and counts as no-block.
- An unparsable block gets one frozen lenient parse (a fence labelled otherwise, trailing commas, a JSON object with only one of the two keys, or two bare arrays under paths and checks headings); if that fails, it is no-block.
- A stop the arm causes itself (context overflow, harness timeout, or the turn, minute or dollar limit) gets one retry under its named reason; if the retry stops too, the session scores 0 on every block score as no-block (E_ER_ARM_STOP). These stops grow with the procedure's length, which is part of what this eval tests (section 9, item 12).
- A failure outside the agent (a provider or API error, or a crash of the harness or container) gets one retry under its named reason; if the retry fails too, the session is missing: it counts against coverage and never scores 0.
- A web-contaminated session is missing too.

No-block, arm-stop and missing rates print per cell. A sensitivity read treats arm stops as missing instead of 0 and prints beside every primary; it decides nothing.

### 7. Judging (R78)

**Who judges which lists.** GPT-6 Astra (openai/gpt-6-astra) labels every list a Claude model wrote (Opus arms). Opus 5.5 labels every list a GPT model wrote (Sol arms). particle-1 lists go to a cross-family panel of Astra and Opus; where they split, Gemini 4 Argon (google/gemini-4-argon, through OpenRouter with data collection denied) casts a third vote, and the label is the median of the three, which for binary labels is the majority. Stock rows, oracle lists and shuffled-key packets go to the same judge as the lists beside them. Production label and pairwise calls run at medium reasoning effort, the judge-check pass at maximum. Every result records the judge model, version and effort, and judge calls are cached by model, version, prompt digest and packet digest.

**Labels (primary).** Each packet holds one unit's key items (statements only, plus the files and functions for B items) and that model's normalized check lists for the unit across arms, plus the three stock rows, shuffled with a seed and labelled only by a random id. For each list and each key item the judge gives two labels and names every check index behind each yes, one or more:

- *anticipated*: one check names, in substance, both the specific code path or user flow the item records and the specific condition, input, environment or behavior that failed or was later tested, so that running that check as written would have caught the defect or checked that behavior. A category alone doesn't match ("test error handling" doesn't match "returns 500 on an empty tag list"); the right condition on another path doesn't match; a check that names the path and condition in other words does.
- *path hit*: one check names the item's path or flow, whatever its condition (secondary).

The judge also marks, for each anticipated item, whether the credited check proposes a check (a test, CI job or eval) or a code change. The brief gives three generic match and no-match examples written for this post, from no unit.

**Shuffled-key control.** Each list is also labelled against a seeded derangement of keys over all audited units: another unit's key from the same repository where one exists, otherwise from the same type and, where possible, the same language. A list's shuffled A measures how far its checks match a nearby change's aftermath rather than this one's.

**Missing labels.** Every (list, item) cell needs a label. A packet with a missing or unparsable cell is resent once, whole. A cell still missing stays unlabelled and counts against coverage, never as not anticipated. A failed Gemini tie-break is retried once, then the cell takes no label and counts against coverage.

**The judge check, before any judge number counts.** It must not be circular. The check set is labelled in a separate pass with its own audit prompt, which asks for the quoted check behind each anticipated label, at maximum reasoning effort, by both Astra and Opus. Each production judge's check set comes from the stage 1 lists it labels in production, plus known anchors: stock rows 1 and 2 as known-bad lists (the generic screen removed what they match), while stock row 3 is labelled like any list and never counts as an anchor, and one oracle list per calibration unit as known-good, written by a script that turns each primary item into a check naming its path and condition. Stage 1 gives Astra 68 Opus lists, and gives Opus and the particle-1 panel 54 lists each (gate answer B1). Gold labels are the cells where Astra and Opus agree in that pass. Each production judge needs at least 40 gold cells of each class (anticipated and not), with oracle cells counting toward the anticipated class, from at least 40 distinct lists across both classes together. Anchor cells count toward those floors, but in the gate's numbers they are weighted down to carry at most a quarter of the total weight, so easy cases can't pass the gate; the unweighted numbers and the numbers on real lists alone print beside them. Each production judge (Astra on Opus lists, Opus on Sol lists, the panel on particle-1 lists) is then scored on its gold cells from its own production labels: its catch rate on bad outputs, its false-fail rate on good ones and Cohen's kappa. Kappa of at least 0.6 is needed before that judge's contrasts can return any verdict. A judge under 0.6, or short of gold cells, makes only its model's contrasts read untested (judge); only the Opus judge's failure ends the eval (section 10). Gold cells print by arm and by item kind (B, T, C), and each judge's kappa also prints against every audit cell, with the cells where Astra and Opus disagree settled by Gemini 4 Argon. In stage 2, 40 gold cells per production judge, drawn stratified by arm and item kind, reach the judge in separate gold packets, one per batch of 8 unit-pass packets, formatted like any packet and labelled only by random ids; the same three numbers print beside every stage 2 result, with the same gate. A seeded subset of 40 gold cells per family is kept in a plain rendering, so the owner could label it if this eval heads to a public post; nothing asks him to now.

**Pairwise map quality (secondary, decides nothing).** For pass 1 of each unit, the judge sees plan.md, the real merged diff's file list with its line counts (a fact about the change, not about its aftermath), and two normalized eng-plan blocks in random order: each skill arm's against none's, each skill arm's against the lens's, and a stock block (stock paths plus stock rows 1 and 2) against none's. It answers which plan would leave the shipped change with fewer untested paths and more regressions caught before merge, weighing the paths mapped, the choice of unit or end-to-end tests and the CI and eval plan, or tie, with one sentence why. No key is shown. The same family rule applies. Pairwise runs on Opus and Sol blocks only; particle-1 pairwise is dropped for cost, since it decides nothing. The stock block must win at most 20% of its pairs against none on Opus; above that, the pairwise read is flagged untested (stock).

### 8. Scoring and volume controls

**Primary, per review: A = credited primary items divided by the unit's primary items.** Credit takes a maximum one-to-one matching between the 8 checks and the key items over every check index the judge named, so one check earns at most one item. A unit-pass's A is that share; units weigh equally.

**Secondaries, all from the same labels or mechanical reads:**

- A_B, on B items only: where real defects landed, the strictest grounding;
- A_T and A_C;
- the path-hit share (judged);
- bug-site path recall (mechanical): the share of B items whose blamed files and functions the paths list names, and the same for the checks list;
- path-map recall (mechanical): the share of the real diff's touched source files, and of its touched functions where the language's diff headers give them, that the paths list names, beside a grep baseline (the 15 functions whose names share the most words with plan.md);
- A_own: plans the tests the real team wrote;
- per-check precision (the share of checks credited with any item) and the specificity score (A minus shuffled A), per arm and as the difference in differences against none (section 11);
- the check-type mix per arm (unit, end-to-end, CI, eval) by a frozen keyword rule on each check's own words, and the share of credited items carried by a code change instead of a check;
- A on mentioned and generic items, and the foreseeable stratum;
- the length-adjusted difference and pairwise map quality, raw and length-controlled.

**Volume can't win.** Eight checks of 40 words, normalized before judging; one-to-one credit; the specific-match rule; the generic screen; the shuffled-key control; and three stock rows judged in every packet as if they were reviews. The stock rows, frozen:

- **Row 1, generic tests:** (1) Unit tests for every new function, covering valid, invalid and empty input. (2) An integration test for the main happy path, end to end. (3) Tests for error handling when a dependency or network call fails. (4) Tests for null, empty and maximum-size inputs. (5) Run the full existing test suite in CI before merging to catch regressions. (6) A test for concurrent access to shared state. (7) Tests that existing callers still behave the same after the change. (8) A performance test with large inputs.
- **Row 2, generic CI and environments:** (1) Run the test suite on Linux, macOS and Windows in CI. (2) Test with the oldest and newest supported runtime versions. (3) Add lint and type-check jobs to CI. (4) Add end-to-end tests in CI for the main user flow. (5) Add code coverage reporting with a minimum threshold. (6) Test configuration parsing with missing and malformed config. (7) Test upgrading from the previous version with existing data. (8) Add an eval or golden-output test for any model or prompt output.
- **Row 3, the skill's own checklist (never used to screen):** (1) Diagram every branch and error path of each new function and test both sides of each branch. (2) An end-to-end test for any user flow spanning three or more components. (3) A regression test for every existing behavior the change puts at risk. (4) Test double submit, navigating away mid-operation and stale data. (5) Test what the user sees on a network failure or a 500 response. (6) Test zero, one and 10,000 results. (7) An eval for every prompt or model call the change touches. (8) For each new path, name a production failure and test its error handling.
- **Stock paths (pairwise only):** the main entry point; the new public function; the configuration loader; the database layer; the API handler; the user interface component; the error handler; the test suite.

**Consistency and stock checks.** Rows 1 and 2 should anticipate no primary item after the screen, so their count is a consistency check on the judges. Row 3 guards against the skill's own generic moves. Stock fail reads per production judge and model: a model's stage reads STOCK FAIL when any one row is credited with a primary item on more than 2 of the 16 calibration units (stage 1) or on more than 7 of the 56 comparison units (stage 2), the same rate of one unit in eight. In stage 1 a stock fail on Opus lists ends the eval, and one on Sol or particle-1 lists makes that model's contrasts read untested (stock); in stage 2 a stock fail makes only that model's contrasts read untested (stock). Row 3's credits print per arm and model either way.

**Length.** Beside each primary, a length-adjusted difference: the unit-pass difference in A regressed on the difference in the two lists' word counts, with the intercept and its cluster-bootstrap interval. It is a sensitivity read, never the verdict.

### 9. Attacks on the scores, answered before code

1. *Volume and verbosity.* The 8-by-40 cap, normalization, one-to-one credit, the stock rows, per-check precision and the length-adjusted read.
2. *Generic hits.* The specific-match rule (path and condition both), the generic screen, the shuffled-key control and the stock checks, including a row built from the skill's own checklist.
3. *Self-preference.* No model judges its own family's lists; particle-1 gets a three-family median.
4. *A judge that labels badly.* The non-circular judge check with known-bad and known-good anchors, kappa of at least 0.6 to gate, and a blind stage 2 re-check.
5. *Style revealing the arm.* The skill's markers (star ratings, [→E2E]) could tip a judge. Normalization strips formatting, and labels are factual matches against a key. A descriptive probe asks Astra to guess the arm of 30 random lists; above 70% correct, the post flags it.
6. *SZZ noise.* Key writers confirm every B item by reading the fix and the unit side by side, auditors recheck it, and the supply count's spot check measures the raw rate (section 4).
7. *Hindsight.* Many real defects are hard to foresee. The headroom band's floor catches a mostly unforeseeable key, and the foreseeable stratum prints.
8. *Echoing the plan.* Mentioned items leave the primary.
9. *Leaks.* Inputs come only from material dated before the merge; the container holds no later history; the window starts at Opus 5.5's stated cutoff; web tools are denied; each model's own cutoff is checked, and Opus's possibly later data gets a strict stratum, a by-month print and a recognition probe (section 11).
10. *Big changes dominate.* Units weigh equally with at most 6 primary items each; A prints by change-size tercile.
11. *The format is the lift.* Every arm writes the same block, so no arm wins by being the only one asked for tests; the lens arm and the stock rows test how much the framing alone carries.
12. *Effort, not procedure.* Skill sessions read more code and take longer. That is the procedure's mechanism, so it counts, and cost per credited item prints beside each contrast.
13. *Failures scored as misses, or dropped in an arm's favour.* Failures outside the agent are missing, never 0; stops the arm causes itself score 0 after one retry, and a sensitivity read treats them as missing.
14. *A candidate fitted to the test.* The candidate is written blind (section 15), and its digest is fixed before any arm output exists.

### 10. Stage 1: headroom, judges and exposure

On the 16 calibration units:

- Opus none, Sol none and particle-1 none, 3 passes each (48 reviews a model), and a descriptive recognition probe of Opus none on each unit (section 11).
- Smoke: 6 Opus sessions of each skill arm (the pre-cut skill, the eng phase and the candidate), 2 each on Sol (three arms) and particle-1, and 2 lens sessions on Opus, read for exposure, block parse and cost.
- The production judges label every list, stock row and oracle list; the separate judge-check pass labels the check set.

**Admission.** HEADROOM when Opus none's A on the calibration units is from 0.10 to 0.75 with its 95% lower bound at most 0.65, the stock checks pass on Opus lists, the Opus judge (Astra) passes the judge check (kappa at least 0.6), and at least 95% of Opus none replies parse. HEADROOM depends only on the judge of Opus lists; a Sol or particle-1 judge that fails its check makes only that model's contrasts untested (gate answer B1). FLOOR (under 0.10) is FIX-METHOD on task fit: the aftermath is mostly unforeseeable from a plan, and stage 3's build read becomes the next attempt's primary. CEILING (above 0.75, or a 95% lower bound above 0.65) ends the eval as R48 FIX-METHOD (saturation): plain Opus already plans most of these tests. It is R61's one ceiling-raise attempt for this construct, and no CUT-CANDIDATE comes from stage 1 (gate answer E1); stage 2's margin rule is the only road to a cut. STOCK FAIL on Opus lists and NO READ (the Opus judge check or the parse rate failing) end it as FIX-METHOD on the instrument. When the Opus judge falls short of anticipated gold cells, the eval ends as NO READ whatever A is; the post may name a low A as a likely floor but never claims FLOOR. An Opus judge kappa under 0.6 also reads NO READ whatever A is. Why these edges: with 1 to 2 items a unit, 0.10 is about one item in seven units; at 0.75 the room left is 0.25, about twice the 12-point smallest effect worth acting on.

**Smoke rules, fixed now.**

1. *Parse.* Each skill arm must return a parsable block in at least 5 of its 6 Opus smoke sessions, or it reads FIX-METHOD on the instrument and its stage 2 cells don't run.
2. *Exposure.* Each skill arm must be exposed (section 5) in at least 5 of its 6 Opus smoke sessions. If one isn't, it runs with the harness's Stop hook: gstack-evals code that runs that arm's detector on the transcript when the session tries to stop and, while the procedure hasn't shown, blocks the stop with one fixed message naming the missing outputs, at most twice. Its own 6-session smoke must then pass, and it is named "with an enforced procedure" in every headline. If that fails too, the arm reads FIX-METHOD on the instrument. Blocks print per session.
3. *Sol and particle-1.* A skill arm exposed in 0 of 2 smoke sessions on Sol or particle-1 still runs, but that model's contrast for it becomes descriptive.

### 11. Stage 2: the comparison

56 comparison units. Opus 5.5: all five arms at 2 passes. Sol and particle-1: all five arms at 1 pass. Each unit's cells run interleaved in a seeded order.

**Primaries, per model:** each skill arm minus none on A, three contrasts on every model, Holm across them. The Holm family is frozen at those three: an arm that doesn't run or stops (an interim exposure stop, a smoke FIX-METHOD) enters with p = 1. A unit's arm score is the mean over its passes; differences pair by unit, clustered on the unit (taken from each review's unit field, checked so the cluster count equals the unit count); each difference has a 95% cluster-bootstrap interval (10,000 draws, seed 20261108) and a two-sided cluster sign-flip p. Every comparison prints paired, with its interval and the count of units whose A got worse.

**Secondary contrasts (decide nothing on their own):** each skill arm minus the lens (the trim reading); lens minus none; the candidate minus the pre-cut skill; the eng phase minus the pre-cut skill; and every section 8 secondary per arm.

**Verdicts (R56 and R78 words), per skill arm and model.**

- **helps** (or **hurts**): Holm p at most 0.05, the interval excludes zero, and the specificity contrast has an interval that excludes zero in the same direction. The specificity contrast is the paired difference in differences per unit, (A_skill minus shuffled A_skill) minus (A_none minus shuffled A_none), with the same cluster bootstrap (gate answer D1).
- **no measurable difference**: the interval includes zero. The MDD and the interval print with it.
- **not shown**: any other result none of the untested conditions touches: an interval that excludes zero but fails Holm, or a failed specificity contrast. It prints with the requirement it failed and supports no KEEP; CUT-CANDIDATE still reads from its upper bound (below).
- **untested**: exposure under 0.80, coverage (scored reviews over planned) under 0.90, a stock fail on that model's lists, that model's judge under kappa 0.6 or short of gold cells, or leak exposure.
- **Interim exposure stop:** after the first 24 Opus sessions of a skill arm in stage 2, an arm with exposure under 0.70 stops; its cells read untested and its remaining cap is released.
- **Leak exposure:** before stage 1, the build records each model's stated training cutoff from its provider's documentation: Opus 5.5's stated June 2026, with the repository's earlier records noting data possibly collected to September 2026 (unverified), which covers the whole merge window; GPT-6.1 Sol's reported 2026-04-30; and particle-1's release date where no cutoff is published. A unit whose earliest exposure falls before a model's stated cutoff is leak-exposed for that model: descriptive, out of that model's primaries. If more than a quarter of a model's units are leak-exposed, its primaries read untested (leak). A model with no published cutoff runs with that limit stated beside its results. For Opus's possible late data, A prints by merge month, a strict stratum of units first exposed on or after 2026-08-01 prints beside every Opus primary, and a descriptive recognition probe asks Opus none, on each calibration unit, what changed in the project in the 60 days after the merge; units it recognizes print as their own stratum.

**Reading rule, fixed now.**

- **KEEP** for a skill arm on a model needs skill minus none to read helps. It is worded "its test plan names more of the paths where real bugs and later tests landed". It is flagged when the pairwise secondary shows the skill losing (a length-controlled win rate below 0.5 with an interval that excludes 0.5), or when stage 3 shows that arm's block leading to builds that pass fewer aftermath tests than none's, with an interval that excludes zero.
- **The one-line framing carries it** is written only when skill minus none helps and skill minus lens has an upper bound below +0.05, the bound trim-to-lens uses. That reading is an R48 lead to cut the lines that don't help. When lens minus none helps but skill minus lens doesn't meet that bound, the post writes that the framing carries part of the gain, and that is no lead to cut.
- **CUT-CANDIDATE** for a skill arm on a model needs skill minus none's 95% upper bound below the frozen margin of +0.05, with exposure at least 0.80, admitted headroom, passing stock and judge checks and coverage at least 0.90, and no untested condition holds, leak included, whenever the contrast doesn't read helps: it reads from the upper bound whether the contrast reads no measurable difference, hurts or not shown, and helps always wins over CUT-CANDIDATE. **Trim-to-lens** reads the same way on skill minus lens: an upper bound below +0.05 says the procedure adds nothing measurable over one line, even when both beat none.
- A null whose upper bound reaches +0.05 is "no measurable difference" and FIX-METHOD on power. power.txt part D prints how often a true zero reaches CUT-CANDIDATE at this size: 26% to 34% of runs with 1 or 2 items a unit and 41% to 53% with 2 to 4, so a null here usually reads FIX-METHOD on power, and the post says so.
- Any null covers naming where real defects, follow-up tests and CI changes landed. It does not cover architecture review, the interactive skill, or what ships (stage 3 reads that descriptively).

**What each result means for gstack's cut, written now.** A KEEP for the pre-cut skill on Opus says the cut removed something that worked, and the post recommends restoring it or carrying its working part into autoplan. A KEEP for the eng phase says autoplan still carries it. A KEEP for the candidate with the pre-cut skill not shown or null says the rebuilt skill should ship. CUT-CANDIDATE on every skill arm says plain Opus already plans these tests as well as any of them, and the cut stands on the main claim. The trim-to-lens reading names the lines to cut. Each goes to the Captain plainly, losses included.

### 12. Stage 3: the build-level secondary

Stage 3 asks the claim's second half directly: does a plan reviewed by each arm lead to code that avoids the real bugs, with tests that would have caught them? It is descriptive and decides nothing except the KEEP flag above.

**Build units.** 24 comparison units (6 a type where supply allows), drawn in seeded order among units whose test suite runs in a container at base and at the merge, and which carry at least one aftermath hidden test: for a B item, the fix commit's test change, red on the real merged tree and green on the real fixed tree; for a T item, the follow-up test, green on the real merged tree. The unit's own pull request tests are its functional hidden tests, as in the G and H lanes. A statement note, written by GPT-6.1 Sol from the merged change and audited by Opus with no tools (V4 and V5 as in H), names the public names the hidden tests call that are missing at base. The H harness is shared (Harbor at its pin, real_agent, verifier-owned grading); its sealed units are not.

**Build arms.** Six per unit, 1 trial each, all by Opus 5.5 in Claude Code with no gstack: plan.md alone (no review), and plan.md plus each arm's normalized eng-plan block from its stage 2 Opus pass 1 (none, lens, pre-cut, eng phase, candidate). The prompt: "Implement the plan in plan.md in /work/repo, with tests. A reviewer's notes on the plan follow; use them as you see fit." then the block, then the statement note. Session limits are frozen at the H harness's none limits. Build containers reach only the metering proxy, which keeps the keys outside the container; verifier containers have no network at all, and neither holds a key.

**Measures, per build.** (1) The aftermath pass share: the share of the unit's aftermath hidden tests that pass on the final tree. (2) Functional solved: every pull request hidden test passes. (3) Real-bug catch: the build's added tests run on the real merged tree and on the real fixed tree; a test red on merged and green on fixed catches that B item; a test that doesn't compile against the real tree counts as not catching, and the compile rate prints. (4) Mutation kill rate of the build's tests on its own changed lines, reported only if the mutation tool scores at least 90% of trees without a tool error (G's tool failed on 34 of 63).

**Readout.** Paired by unit against the none block and against no review, each with a 95% cluster-bootstrap interval and the worse count. It runs after stage 2's Opus pass 1 exists, whatever stage 2's verdict, because a null on naming paths doesn't settle what ships.

### 13. Power and MDD

power.py (attached, seeded, no key) simulates the share score over units of 1 to 2 or 2 to 4 items, with item noise (sd 0.8 on the logit scale) around each unit, effect noise tau 0.5, and the paired sign-flip test at Holm's first step over three contrasts (alpha 0.0167). From power.txt, at 80% power:

| Cells | Units | 1 or 2 items, control 0.20 | 1 or 2 items, control 0.35 | 2 to 4 items, control 0.20 | 2 to 4 items, control 0.35 |
|---|---|---|---|---|---|
| Opus, 2 passes | 56 | 0.10 to 0.13 | 0.10 to 0.15 | 0.07 to 0.09 | 0.07 to 0.10 |
| Sol, particle-1, 1 pass | 56 | 0.14 to 0.18 | 0.15 to 0.20 | 0.10 to 0.12 | 0.10 to 0.14 |
| Opus, 2 passes | 64 | 0.09 to 0.12 | 0.09 to 0.14 | 0.06 to 0.09 | 0.06 to 0.09 |
| Opus, 2 passes | 48 | 0.12 to 0.14 | 0.12 to 0.16 | 0.08 to 0.10 | 0.08 to 0.11 |

Each range spans ICC 0.843 (#273's measured value) to 0.5. The free supply count (section 4) could not measure the audited item mix, because T items come only from full reads and B precision is about half, so the design MDD stays at the conservative 1 to 2 item rows: 10 to 13 points on Opus and 14 to 18 on Sol and particle-1 at a control near 0.20 (10 to 15 and 15 to 20 near 0.35). The projection rerun before stage 2 re-estimates the variance components and the item mix from stage 1 and the audited units, reprints every MDD at the final size, and that figure is the MDD every verdict prints. The MDD covers the A contrast only; the specificity half of helps has no power figure of its own. **Smallest effect worth acting on (gate answer F1):** 12 points on Opus. The rerun's Opus MDD at the final size must be at most 0.12; otherwise the comparison set grows within the line (64 units gives 0.09 to 0.14 with 1 or 2 items) or the question goes to the Captain (start rule 5). Per-type cells (descriptive, Opus at 2 passes, alpha 0.05) sit at about 0.26 to 0.27 at 16 units and 0.36 to 0.38 at 12, so per-type reads are leads only.

**CUT-CANDIDATE's operating characteristics** (power.txt parts B and D). At 56 units on Opus with 1 or 2 items, a true difference of exactly +0.05 reads CUT-CANDIDATE in 2.2% to 5.0% of simulated runs, so the margin rule rarely cuts a skill that is truly worth 5 points. A true zero reads CUT-CANDIDATE in 26% to 34% of runs, and a true -0.05 in 71% to 84%; the rest read "no measurable difference" and FIX-METHOD on power. With 2 to 4 items, a true zero reaches CUT-CANDIDATE in 41% to 53% of runs. On Sol and particle-1 at 1 pass, a true zero reaches it in 18% to 33% of runs. The post states which of these applies.

The prior, stated before data: a gain of 5 to 15 points on Opus is plausible, because the test review's branch-by-branch tracing and failure-mode output ask for exactly what B and T record, while plain Opus asked for a test plan leans toward generic categories; the lens may carry part of it. At a 10 to 13 point MDD this design can miss a real gain in the lower half of that range, and it says so in every null.

### 14. Money

**Sessions.** Planning figures, before stage 1's smoke replaces them with measured ones: on Opus, none $0.40, lens $0.45, the pre-cut skill $2.50, the eng phase $2.20 and the candidate $2.00 a review (a review reads the repository, so these sit well above #273's plan-only $0.127 none and $0.674 standalone; G's told sessions, which also built the feature, averaged $6.67); Sol at about 0.9 times Opus; particle-1 at about a tenth. Stage 3 builds at $1.50 a session (G's none sessions, plan and build, averaged $0.94).

**Judges.** List prices in the repository's price table (src/runner/pricing/prices.ts, per million tokens): GPT-6 Astra $10 input and $50 output, Opus 5.5 $4 and $20, Gemini 4 Argon $2 and $10 (it votes on split particle-1 cells and settles audit disagreements). Per call, reasoning billed as output: a label packet of one unit-pass (up to five lists and three stock rows) at medium effort about 6,000 input and 6,000 output tokens (Astra about $0.36, Opus about $0.14), sent twice with the shuffled key; a pairwise call about 3,000 and 1,000 (Astra about $0.08, Opus about $0.035); a judge-check packet at maximum effort about 5,000 and 8,000 (Astra about $0.45, Opus about $0.18). The first stage 1 label packet runs alone, and its measured cost re-projects the judge line before the rest are sent; a projection past the judge cap stops for the Captain.

| Item | Projection | Cap |
|---|---|---|
| Stage 1 runs: 144 none reviews (48 a model), 32 smoke sessions, a 16-call recognition probe and an 18-session Opus fallback re-smoke reserve | $135 | $200 |
| Stage 2 runs: Opus 112 unit-passes at $7.55, Sol 56 at $6.80, particle-1 56 at $0.76 | $1,270 | $1,500 |
| Stage 3 builds: 24 units x 6 build arms | $216 | $280 |
| Judges: stage 1 labels $121, judge check $65, stage 2 labels $165, pairwise on Opus and Sol $45, arm-guess probe $3 | $399 | $520 |
| Authoring and mining: 78 units at about $5.50 a passing unit, failures included; 24 stage 3 build units at about $8; generic-screen labels $22 | $643 | $800 |
| Runner hosts (mining, run and verifier hosts on Ubicloud) | $55 | $70 |
| Crew (this plan and its review, the build, run threads, stage 3, results and its review), re-costed from comparable measured lines | $480 | $520 |
| Reserve | | $110 |
| **All-in** | **about $3,200** | **$4,000** |

The whole line sits at its $4,000 guideline at caps and under the $5,000 stop. Expected spend is about four fifths of the caps. The judge check costs about $65 of projection, and R78's cross-family judging with Astra is most of the judge line. Crew is re-costed from comparable lines measured from thread counters at about $1 per 1,000 credits ($753.29 over 15 L1 threads, $469.61 over 18 threads, so $26 to $50 a thread); this eval plans about ten threads.

**Net-envelope rules.** Crew, authoring or judge-label overrun comes out of stage 2, never out of stage 1 or the judge check. Before stage 2, the run thread reruns the projection on stage 1's measured costs and crew actuals. If it doesn't fit, the cuts go in this order: stage 3 down to 16 units; Sol's lens cells; comparison units down to 48; Opus's second pass on the skill arms. particle-1 stays, since its cells cost little. A cut that would take the Opus MDD past 0.12 goes to the Captain instead (start rule 5). The MDD at the smaller design is reported before spending, and the line is never padded. A projection past $5,000 at any point stops for the Captain.

### 15. The rebuilt candidate

The candidate's skill text belongs to GStack Minder. The crew requests it through the Captain with this intentions statement, frozen here, and the pre-cut skill's public text (plan-eng-review/ at b493d4e31) as a starting point:

> Before code is written, map every code path and user flow a planned change touches, each branch, error path and edge, as a diagram; put the existing tests on each path; for each gap, choose a unit test, an end-to-end test, a CI job or an eval, and justify each by the regression it would catch; plan the CI lanes and evals the change needs; and write the result as a path map, a coverage map and a test plan, so the shipped change has fewer untested paths and catches its regressions. Drop bug-hunting in the plan's design beyond what the path map surfaces. The skill must run unattended, taking its recommended option at every decision, and finish in one session.

The Captain sent the request (handoffs/GEVA-405/candidate-request.md in its drive) to GStack Minder on 2026-11-08, right after the gate answer (K1). GStack Minder never sees units, keys, the closing template, this post's sections 3 to 14, or any arm output; the request says so, and its answer attests it. Whether gstack restores or folds the shipped skill stays GStack Minder's call. **The candidate as frozen.** GStack Minder delivered it through the Captain on 2026-11-08, with an attestation that it was built from the intentions statement and the pre-cut text at b493d4e31 only. The Captain checked the commit and both digests from a fresh fetch, and so did this post's author:

- skill /plan-coverage (folder plan-coverage/), garrytan/gstack branch eng-review-intentions-candidate, cut from main b6155921a;
- commit 57295cbc510fcafc4d404d4ba70afc463b01e341, on which the arm is frozen;
- sha256 of plan-coverage/SKILL.md 4778462dbff92da7b5df3088c7b96b6dc1a16e35d063cbb2322a34457dcd9882, and of plan-coverage/SKILL.md.tmpl 079b2966e9b6695abe3f86a0585f5a515a72175dc70cb9bfeba503c035e86135;
- install: a default Claude Code install of gstack at that commit (./setup --host claude), which puts the skill at ~/.claude/skills/plan-coverage/SKILL.md. It has no preamble, calls no gstack bin, sends no telemetry and asks no questions; its tools are Bash, Read, Write, Grep and Glob, and it runs no project tests;
- required outputs: path-map.md, coverage-map.md and test-plan.md in <repo root>/.gstack/plan-coverage/, overwritten on each run, and a last reply line PLAN_COVERAGE: paths=<n> gaps=<g> tests=<t> out=<dir>. It takes a plan named in the invocation first, so the arm's invocation names plan.md.

Its exposure detector (section 5) is frozen here from these outputs before any session runs. The arm's text never moves: a later commit counts only if it reaches this post through the Captain before the post merges. The pin and digests land with the results under R77.

### 16. Start rules, build and stops

1. No paid call before this post merges and the Captain records each item's cap. Every paid call goes through the ledger and the metering proxy; a cap stop is an incomplete run, never retried to change a verdict.
2. **R77.** This experiment gets this post and one results post. The build (the eng-plan parser, normalizer and lenient parse; the arms with web tools denied and the mounts; the eng phase prompt renderer; the three procedure detectors and their fixtures; the Stop hook fallback; packets with shuffled keys and gold cells; the judge brief and audit prompt; the Astra, Opus and Gemini clients with caching; the oracle-list script; the scorer for A with one-to-one credit and every secondary, including the mechanical path reads; the stock rows; the type classifier records; stage 3's build units, harness wiring and real-bug runner; and the miner's blame fix for large files, which merges consecutive lines into ranges) is built on a branch, every paid run is pinned to that exact commit, and the commit lands with the results.
3. **Reason codes** the build adds to src/errors/codes.ts with doc anchors: E_ER_NO_BLOCK, E_ER_ARM_STOP, E_ER_INFRA_MISSING, E_ER_WEB_CONTAMINATED, E_ER_LABEL_MISSING, E_ER_JUDGE_KAPPA, E_ER_STOCK_FAIL, E_ER_NO_READ, E_ER_EXPOSURE_FALLBACK, E_ER_EXPOSURE_STOP, E_ER_LEAK_EXPOSED, E_ER_PROVIDER_DRIFT, E_ER_SUPPLY_SHORT and E_ER_BUILD_INSTRUMENT. **Recovery for the codes that stop work:** E_ER_JUDGE_KAPPA and E_ER_STOCK_FAIL stop only the affected model's contrasts, unless they fall on Opus lists in stage 1, where they end the eval as E_ER_NO_READ does; E_ER_EXPOSURE_STOP stops only that arm; E_ER_PROVIDER_DRIFT stops that model's items; E_ER_SUPPLY_SHORT stops authoring. None is retried. Each stops for the Captain, settles its open ledger lease at the spend recorded so far and releases the rest of the lease, and leaves partial outputs sealed as an incomplete run.
4. **A keyless dry run drives every frozen rule** before stage 1: normalization and the lenient parse; both sides of each band edge (A at 0.09, 0.10, 0.75 and 0.76, the lower bound at 0.65 and 0.66; an Opus judge kappa at 0.59, which reads NO READ, and 0.60, which doesn't; stock credits on 2 and 3 calibration units and on 7 and 8 comparison units, on Opus lists and on another model's; the pairwise stock at 20% and 21%; coverage at 0.89 and 0.90; exposure at 0.79 and 0.80; the interim stop at 0.69 and 0.70 after 24 sessions; smoke parse and exposure at 4 and 5 of 6; leak-exposed units at a quarter and just over; the projection's Opus MDD at 0.12 and 0.13); an interval that excludes zero but fails Holm; an upper bound at 0.049 and 0.050 for CUT-CANDIDATE and trim-to-lens; the framing reading on none 0.20, lens 0.35 and skill 0.60, which reads framing carries part, and on a skill-minus-lens upper bound of 0.049, which reads framing carries it; an interval of [0.01, 0.04] that passes Holm and specificity, which reads helps and never CUT-CANDIDATE; a negative interval that fails Holm with its upper bound under +0.05, which reads CUT-CANDIDATE when the other conditions hold, and a null whose interval includes zero at upper bound 0.049, which reads CUT-CANDIDATE when the other conditions hold, and at 0.050, which reads FIX-METHOD on power; a check credited only through the judge's second index for an item; an Opus judge short of anticipated gold cells with A under 0.10, which reads NO READ and never FLOOR; stock row 3 labelled as a list and never counted as an anchor; a leak-untested contrast with its upper bound under +0.05, which doesn't read CUT-CANDIDATE; one check matching two items beside a second check matching one of them; a no-block reply, an arm stop scored 0 after its retry beside a provider error left missing, the missing-instead-of-0 sensitivity read, each session limit, and a web-contaminated session; a specificity difference in differences that excludes zero and one that doesn't; Holm with a dropped arm entered at p = 1; a gold-cell shortfall and a failed Sol judge that leaves Opus running; the anchor weighting; the provider-drift and supply stops; a particle-1 split settled by the third vote; the generic screen and the mentioned flag; the shuffled-key derangement; refusal of WebSearch and WebFetch; the mounts with key.json absent and no later git history in the container; each detector on its exposed and unexposed fixtures, including a candidate run that ends Status: no-plan; the eng phase renderer on a plan.md without its headings; the Stop hook's two blocks and its release; the interim exposure stop; the leak rule; the candidate's install at its pinned commit with both digests checked; and one ledger lease per item on a temporary ledger.
5. Stage 1 runs only after the dry run passes and authoring is complete or has a fixed schedule. Stage 2 runs only on HEADROOM and passing smoke rules, after the projection rerun fits the line and its Opus MDD at the final size is at most 0.12, the smallest effect worth acting on (gate answer F1); otherwise the set is re-sized within the line or the question goes to the Captain. The +0.05 cut margin stays frozen below that MDD, a departure from the admission rule's MDD-inside-margin test that the gate answer and the Captain's approval record accept, and the cap record repeats it. Stage 3 runs after stage 2's Opus pass 1.
6. Sol runs through OpenRouter pinned to OpenAI's provider with fallbacks off and data collection denied. particle-1 runs through OpenRouter pinned to its serving provider with data collection denied; its provider and that provider's data terms are read from OpenRouter's endpoints API (a free read) before the cap request, and its first call records them again. Any provider change stops that model's items for the Captain.
7. Every launch uses a sink directory that doesn't exist before it, checked and recorded. The miner runs git only on untrusted clones: hooks off (core.hooksPath=/dev/null), no filters, no LFS smudge, and no repository code run.
8. Any finding in review that would move a scored outcome comes to the Captain before a fix.
9. Supply stops: if any named type has fewer than 6 eligible units from the frame and transposition can't fill it to 10, or the pooled count of passing comparison units falls below 48, authoring stops and the question goes to the Captain.

### 17. Custody, outside terms and public safety

Units, keys, judge labels, statement notes, build-stage hidden tests and every review stay sealed in the Captain's drive with committed digests only. Everything is decrypted in /dev/shm under the custody rules, and every machine that touched sealed material gets the plaintext sweep at each seal and at the end. A published key would let later models train on the answers.

**Outside terms, licences or rights.** GitHub's terms of service and API limits for mining (public data, paced GraphQL, no scraping past limits), and its acceptable-use rules on personal data: plan rewrites leave out people's handles, names and emails, and key statements name no person. Repository licences: the permissive ones (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0) allow copying and running the code for evaluation; the copyleft ones (GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0, AGPL-3.0) attach their conditions to distribution, and for AGPL-3.0 also to letting users interact with a modified copy over a network, and neither happens here (gate answer J1). Nothing is redistributed or published, no network service runs from any unit, bundles stay sealed, plans are rewrites, and key statements are our own words. Issue and commit text is summarized into sealed statements under GitHub's terms for research use and never published. Model terms: OpenAI's API terms for Astra and the statement notes (abuse-monitoring retention, no training on API data); OpenRouter's terms, with OpenAI as the pinned provider, for every Sol call (arms, the second auditor, a classifier); Anthropic's commercial terms for every Opus call (arms, judges, plan rewrites, keys, the first auditor, a classifier); OpenRouter's and each serving provider's terms for particle-1 and Gemini, with data collection denied; and Claude Code's own terms, which cover it as the harness when it drives Sol and particle-1. gstack is MIT at every pin, and the candidate is written into gstack under the same licence. Harbor is Apache-2.0 and runs with telemetry off. The mutation tools are MIT, Apache-2.0 or BSD as in G.

### 18. What the results post reports

The post opens with 2 or 3 takeaway bullets for builders, what works first and the null right after (R79). Then, per model and skill arm: every primary with its interval, p, Holm p, the worse count, exposure, coverage, MDD and verdict, and beside it the judge model and version, its catch rate, false-fail rate and kappa, the specificity contrast and the length-adjusted line; stage 1's rates and judge check; the arm-stop, no-block and missing rates with the missing-instead-of-0 sensitivity read; the leak strata; the stock, generic and mentioned counts; every secondary of sections 8 and 11; stage 3's readout; the type distribution and per-type reads with their MDDs; the candidate's pin and digest; R48's Why null? cycle where a primary is null; held-out disclosure; the closing disclosures. Cost appears only as a lesson (cost per credited item, a cost ratio between arms); all-in spend and caps go in the Agent notes section. Every pilot, stop and null goes on the research registry.

### 19. Risks, limits and not in scope

- SZZ finds defects only where a fix touched the change's lines; defects fixed by rewriting nearby code, or never fixed, are invisible, so the key undercounts. That is the same for every arm.
- A follow-up test reflects what a team chose to test, not every path that needed one.
- Plans are rewrites of what a team wrote while building, not before; the frozen rewrite and its audit guard additions, and the plan's own test intentions stay in.
- Every skill arm runs unattended and without web tools; the skills were written for a person at the keyboard.
- Judges are single models per arm under R78; the judge check and its stage 2 re-check are the guard.
- Opus 5.5 may hold data collected to September 2026, which covers the merge window; the strict stratum, the by-month print and the recognition probe bound that but can't rule it out.
- Not in scope: autoplan's other phases, the full autoplan run, editing gstack's code, posting anything, the S1 write-up, and any parity claim.

## Review record

One lean /autoplan review (run autoplan-20261108214645, one Opus 5.5 reviewer, one round, $3.09 of reviewer model use) found 22 findings: 0 Critical, 6 High, 12 Medium and 4 Low. Gate 1 took every recommendation, and this revision applies all 22: the six High as gate answers A to F, and the 16 others as H.

## Disclosures

Filled in at the results post from org research/disclosures.md.
