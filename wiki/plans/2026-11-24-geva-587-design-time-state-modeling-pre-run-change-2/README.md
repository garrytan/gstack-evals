---
id: 2026-11-24-geva-587-design-time-state-modeling-pre-run-change-2
kind: plan
title: "Pre-run change 2 to the design-time state modeling eval: the review's deferred notes, the power re-print, the draw's walk and the harness as built"
summary: "Settles the prereg review's deferred notes, names the one power fit the start rule uses, fixes how wave 2 joins the draw, and records harness choices, before any pilot data."
author: GEVA-587
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-24
status: open
links:
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-prereg/README.md
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-pre-run-change-1/README.md
  - lanes/eng-planted/e1/
---

# Pre-run change 2 to the design-time state modeling eval

## In short

- The prereg's final review left seven notes that the Captain ruled not blocking and deferred to a dated change before the pilot: "Ruled by the gstack-evals Captain (GSTA-2), 2026-11-24: not blocking under R12; none changes a frozen number or a decision row; deferred to the dated change before the pilot." This is that change. Section 1 settles each note.
- The start rule now names one fit: eval 1's power.py, fitted on the pilot's N builds, with a review-by-unit term, printed at two ends. The larger MDD governs (section 2).
- Units authored in this run join the draw's walk after attempt 3's, so later authoring never moves a unit already drawn (section 3).
- G's gstack pin moves from d74ee528 (1.103.2.0) to 9a550bca (1.103.3.0), so every model role gstack names is the newest generation (section 7).
- Sections 4 to 6 record how the harness was built where the prereg left a choice: the Sol path, the tools volume, the review bundle, the ledger items and the stage order.
- No paid call has run and no pilot data exists. This change moves no frozen number, threshold, arm text, model, cap or Decision row.

This change governs where it and the plan differ.

## 1. The deferred notes

1. **"Scored" in the look means finished** (outside voice, line 223). A gap cell is terminal and has no score, so a look that waited for every cell to be scored could stall. The look runs once every cell of its units has a review record and a build record, gaps included. Gap cells leave the pairs as section 7 says.
2. **No Sol estimate means no fold-in** (outside voice, line 70). If C minus N has no estimate on Opus or on Sol (the arm reads untested there, or Sol leaves the run after the pilot), the row that drafts C's step does not fire. The report prints "no step yet; the draft waits for a valid reading on that host".
3. **C gets a "not distinguished" row** (red team). D's rows have one; C's did not. When C minus N is +10 or more with a lower bound at 0 or below, or its interval holds both 0 and +10, the row reads "not distinguished: no step, FIX-METHOD, MDD printed". It sends no brief and claims nothing, so it changes no decision.
4. **"Read" is the complement of untested** (red team and Capy medium 13F). An arm is read on a model exactly when it is not untested there: exposure at least 0.80 and gaps at most 10%. The Decision rows use that one rule. The interim look keeps the prereg's own test (line 227: under 0.80 exposed on every model is untested), because that line fixes a stop bound. The report prints each arm's gap share at the look beside its exposure.
5. **The one-arm-untested rows stay as written** (Capy medium 13G). The reviewer asked that "C read, P untested" wait for a repaired P run like its mirror row. That changes a Decision row, which this change cannot do. The row keeps "eval 4 is dropped". When it fires, the report names the models C was read on, so a one-model reading is visible.
6. **The re-print gate** (Capy medium J3). See section 2.
7. **D's cut row when a model leaves the pool.** The cut row needs D exposed on every model still in its pool, not on all three. A model where D reads untested has already left the pool.

## 2. Power: one fit for the start rule

- The prereg's pooled MDD rows treat a model's two builds as independent. lanes/eng-planted/e1/power.py adds what they share. It imports attempt 3's power.py unchanged (section 8's frozen simulator) and adds two terms per unit and model: a baseline b ~ N(0, sd_mu) on both arms' builds of that model, and a variation in the modeling arm's effect z ~ N(0, tau_mu), shared by that model's two builds.
- The pilot runs one cell per unit and model, so it can't separate a model's shared part from build noise. So each design prints at two ends: (sd_mu, tau_mu) = (0, 0), and (the fitted sd_e, power.py's effect SD of 0.5). The larger MDD governs.
- The fit reads N's pilot builds as power.py --fit reads plain's: a unit's builds across models count as its K builds. Model level differences then inflate sd_e, which errs toward a larger MDD.
- The start rule runs this fit after the pilot and again once the comparison draw is fixed, at the drawn unit count. Designs printed: 64 and 48 units, on three and two models. A C minus N or D minus N MDD over 10 points at the governing end goes to the Captain before any counted cell. The prereg's "before the pilot" (line 218) reads as "before the counted cells", which is when the measured values exist.
- The pilot's N band check reads the composite's 2.5% lower bound from a repository bootstrap over N's pilot builds, seeded by the run's bootstrap seed.

## 3. Supply and the draw

- **The walk.** The draw walks attempt 3's authored units first, in seeded order, then the units authored in this run (pool units attempt 3 never finished, and wave 2's), in seeded order. Attempt 3's set is frozen the first time the draw reads the run (e1/segments.json). A unit owed its authoring or its screens stops the walk there. Each set only grows: a draw that would change an earlier pick is refused.
- **The sets.** As in attempt 3: calibration takes any foreseeability rating; comparison and reserve leave out units both foreseeability raters called no; at most 3 units a repository.
- **Screens in walk order.** e1-screen screens authored units in the walk's order and only as far as the draw needs, rerun until it has nothing left. Kappa prints over every unit screened.
- **Wave 2 timing.** Wave 2's keyless mining began on the Captain's go after the prereg merged, before the first paid step measured the pool's shortfall. Its units enter the screens only if fewer than 70 pool units pass both, and its stop at a projection of 70 state units applies once the screens give the rates. Mining is limited by GitHub's unauthenticated rate of 60 calls an hour per VM, and runs with no key.
- **Labellers and raters** run at each model's default effort. The supply calls go through the meter on run id geva-587-e1.

## 4. Reviewers on each model

- **Sol** runs Codex CLI 0.170.0 on the lane's container rig and Codex driver, the path Part S of the skill-pack head-to-head used: effort low, hooks trusted, through a link to the pinned binary. It does not use Harbor's h2h_codex.py. Codex has no turn counter, so on Sol only the $10 and 90-minute limits bind; 200 turns binds on Claude Code only.
- **G on Codex** installs with gstack's ./setup --host codex. setup asks for a model, so the session's config gets the model line first and loses it after.
- **The tools volume** (TLA+ tools and Java) mounts read-only at /opt/pf-tools in every review session of every arm, N included, with its bin on PATH.
- **Codex instruction files.** A unit whose stripped B still tracks a .codex or .agents path or an AGENTS.override.md is left out of the draw, rather than edited, because section 3 needs none in the tree.

## 5. The review bundle

- The session's /tmp is marked at start. Afterwards every file newer than the mark is copied to the work dir.
- The bundle's order: the final plan.md, then the review's reply as review.md, then G's test plan files, then other files under /work, then /tmp files.
- A file counts as text when it has no NUL byte and is valid UTF-8. Files over 4 MB are left out and counted. The 12,000-word cap counts the plan too. Truncation is counted per arm.

## 6. Money, items and stages

- **Items.** One ledger item per arm and model (14), the pilot, and supply, each at its section 11 projection and cap. Item names are lower case (e1-c-opus), as the ledger requires.
- **Supply is a ledger item** (e1-supply, projection $180, cap $220): 500 call cells (a unit's screens, or its authoring calls) and 60 hinted builds at $0.61. So the all-in projection counts it from the ledger, and only hosts and crew pass as running figures.
- **A cell's figure** splits into the build's $0.61 (attempt 3's builds ran $0.45 to $0.77) and the rest for the review. Where that leaves the review under a quarter of the cell (particle-1's N and D), the review keeps a quarter and the build the rest. The first-session rule then replaces both with measured costs. If particle-1's measured builds run near $0.61, its N and D items will re-project past their caps; that stop goes to the Captain, as the rule says.
- **Stages.** Each item runs per half: reviews, then builds. C and P's second half needs e1/look.json with stop false. The look is written once.
- **A loss** is reported only when an upper bound is below 0 with 64 or more comparison units.

## 7. G's gstack pin

- The prereg pins G to gstack d74ee528 (1.103.2.0). At that commit, gstack's model policy sends the plan-review role, which /plan-eng-review's outside voice uses, to claude-fable-5-1 and gpt-6-astra, both older generations (docs/model-policy.md and scripts/resolvers/constants.ts at the pin). The Captain's standing rule, from Garry, is that every eval arm that runs gstack uses gstack's newest-generation models.
- gstack 9a550bca (#4811, 1.103.3.0) resolves every role to claude-opus-5-5, claude-fable-5-2, gpt-6.2-sol or gpt-6.2-astra. No counted unit and no paid call has run, so G moves to it.
- The move is 15 commits. plan-eng-review's skill tree is byte-identical at both commits (tree 49f7d69c), so G's prompt, its command and the procedure detector are unchanged. setup changes one label line.
- Cost and caps do not move. In the review container the outside voice either finds no Codex CLI (Claude Code) or stops on the harness check (Codex), and takes gstack's native fallback on the session's own model. The metering proxy serves only the three models under test in either case.

## What this does not change

Arms, arm text, models, prompts, limits, the composite, the 10-point line, the +5 futility bound, every Decision row, the item caps and the $4,913 cap total.
