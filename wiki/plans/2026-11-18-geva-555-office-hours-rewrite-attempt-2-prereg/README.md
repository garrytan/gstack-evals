---
id: 2026-11-18-geva-555-office-hours-rewrite-attempt-2-prereg
kind: plan
title: "Preregistration, second attempt: does the rewritten office-hours skill make the right call more often than the current one? 56 founder and 24 builder briefs, the first attempt's arms, judges and thresholds, and authoring that a restart cannot waste"
summary: "Reruns the first attempt at 4 skins: 32 founder clusters and 24 builders, pooled MDD 0.14 to 0.15. A true 15-point lift reads MERGE about 0.46 of the time. 19 briefs reused; $2,737 at caps."
author: GEVA-555
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-18
status: open
links:
  - wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-1/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-2/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-3/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-4/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-5/README.md
  - wiki/board/2026-11-18-geva-553-office-hours-rewrite-results/README.md
  - wiki/research/2026-11-17-geva-552-office-hours-intentions-inventory/README.md
  - wiki/research/2026-11-18-geva-553-office-hours-rewrite-intentions-inventory/README.md
  - lanes/office-hours-rewrite/
  - garrytan/gstack#4468
attachments:
  - ab362c855ae210e5e2e7d67ed254b60b7fa4f6f5872372be48c3c38d6d09ee71  sizing.py
  - 469c36d974262cf72b0169beccfbab5bec7b0cde8a635ad954447829efbdd220  sizing.txt
---

# Preregistration, second attempt: does the rewritten office-hours skill make the right call more often than the current one?

## In short

- This eval decides whether gstack's office-hours content change (gstack pull request 4468, pinned at 4afa7f2b3e291758f6a7842dd066cde22606fca1) merges. MERGE lands it. Every other outcome keeps it held and sends the result back to the project owner.
- It is the first attempt's eval at the smallest size that still answers the 15-point question: four skins of founder briefs (56 briefs in 32 opening clusters) and all 24 builder briefs, with the same arms, models, judges, decision table and thresholds. The pooled MDD is 0.14 to 0.15 (0.09 to 0.10 at the founder lane's other correlation).
- At this size a rewrite that truly gains 15 points reads MERGE only about 0.46 of the time on the founder rows (0.46 in the first attempt's sizing, 0.48 here), and about 0.37 once the builder check is counted. A true 20-point gain reads MERGE on the founder rows about 0.82 of the time. So a HOLD below the bar here does not show that the rewrite gains less than 15 points.
- The first attempt stopped during authoring with 19 of 110 briefs placed and lost $155 to restarts. This one reuses those 19 sealed briefs and changes how authoring draws: each slot's drafts no longer depend on concurrency, a run resumes from its own outcome log, a top-up twin gets at most 3 draws per partner, a pilot samples every brief type first, and authoring stops early when even an optimistic projection of its cost cannot fit its cap. The line is $2,737 all-in at caps, with no raise.

## 1. The decision this result changes

| Outcome (section 10 of the first preregistration) | What happens |
|---|---|
| MERGE | gstack pull request 4468 lands at its pinned head, after its own ship checks. |
| HOLD (harm), CUT, HOLD (below bar), INCONCLUSIVE | It stays held. The result, with its one Why-null cycle, goes back to the project owner, who decides what happens next. |
| INCOMPLETE | No verdict. It stays held, and the post reports what stopped the run. A cap stop is never retried to change a verdict, and this eval has no raise. |

The verdict applies to the pinned head 4afa7f2b and no other commit.

## 2. What carries over unchanged

Everything in the first preregistration (wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg) and its five pre-run changes holds here, except the changes in section 3. In particular:

- **Arms and pins.** current runs gstack fc5c285035b58ce0552d25cf7cb71749795b6d30 (pre-run change 1), new runs gstack 4afa7f2b3e291758f6a7842dd066cde22606fca1 (pre-run change 2), and none runs no gstack. Each container checks VERSION and every file in pin-current.tsv or pin-new.tsv after install. A pinned arm never moves.
- **Inventories.** The current skill's inventory, read at da98d0a, holds at fc5c285 (pre-run change 1). The rewrite's inventory reads at 4afa7f2b (pre-run change 2). Section 6 of the first preregistration, its untested list and its consequence (a cut-type result reads FIX-METHOD on task fit, never CUT-CANDIDATE) stand.
- **Models and host.** Opus 5.5 and GPT-6.1 Sol are primary, pooled; particle-1 runs on all three arms as a descriptive secondary and decides nothing. Every session runs in Claude Code in a throwaway container. Sol and particle-1 go through OpenRouter's Anthropic-compatible route, with Sol pinned to OpenAI's endpoint.
- **The session** (section 4), with pre-run change 1's first messages, closing message and simulator rules byte for byte, its builder simulator and its bound on reveal-guard redraws.
- **The primary measure** R (section 5), the blind three-line block, stock and near-miss rows, and the judges: GPT-6.2 Astra labels Opus blocks and Opus 5.5 labels Sol and particle-1 blocks, one label at medium effort, each checked under the judge check in section 12 (kappa of at least 0.6 overall and on real blocks, near-miss accuracy of at least 0.8, no stock row credited, at least 10 gold cells of each class).
- **Builders** (section 7): kept whole, the 15-point non-inferiority margin on Newcombe's method 10 with the design-effect correction, the builder right call and guardrail G1.
- **Analysis and failure scoring** (section 8): the cluster estimate, the paired t interval pinned to Student's sleep data, the failure table and the missing limits.
- **The decision table** (section 10), rows 2 to 6, the three guardrails and the two readings reported beside every outcome. Row 1 (INCOMPLETE) changes only as section 3 says: it gains the projection stop (item 8) and the money check (item 11), it no longer counts an authoring cap stop that comes after calibration and comparison are full (item 9), and it reads cap stops as item 10 says.
- **Stages and admission** (section 12): the simulator audit, stage 1 on 8 calibration briefs with admission A1 to A7 and its one repair, the judge check, stage 2 in a seeded order with a brief's arms adjacent, and the hand check of the scorer on 5 real sessions.
- **Ledger and meter rules**: pre-run change 3's Astra route and per-run ledger items, pre-run change 4's round reservations, pinned-model rule and cap-stop reads, and pre-run change 5's empty-reply rule.
- **Custody**: openings, fact sheets, keys, labels, transcripts and judge replies stay sealed outside this repository, are opened only into memory-backed storage, and every opening is logged. The repository gets counts and digests only.

## 3. What changes, against the first preregistration

| # | First preregistration | This one | Why |
|---|---|---|---|
| 1 | 5 skins: 70 founder briefs in 40 clusters | 4 skins: 56 founder briefs in 32 clusters (24 pairs and 8 unpaired), plus the same 24 builders, 8 calibration and 8 reserve briefs: 96 in all | The smallest whole-skin set whose pooled MDD is at most 0.15; 3 skins give 0.16 to 0.17 (first preregistration, section 9). The first attempt's sizing calls this design 1. |
| 2 | Slots from the seeded schedule of 76 | The same schedule, slot for slot, less 8 founder slots (section 4) | Kept slots keep their industry, voice, opening anti-pattern and twin side, so the reused briefs still match them. |
| 3 | Every brief authored in this eval | The 19 briefs the first attempt placed are reused (section 4) | They passed the same screens under the same prompts, and every check bound their digests. |
| 4 | Draws numbered as made; slots picked first-open from a shuffled list | Each slot's drafts follow a fixed sequence that no concurrency or restart changes (section 5.1) | The first attempt lost $155.42 of $233.59 to restarts at new concurrencies. |
| 5 | Placed briefs held in memory until the end | Every settled draft goes to an outcome log that is sealed after every batch, and a resume starts from it (section 5.2) | A stop no longer loses paid drafts. |
| 6 | No bound on top-up twins | At most 3 second-twin draws per partner; then the partner drops and its slot draws a new pair (section 5.3) | Two partners took 166 draws and never matched. |
| 7 | A pilot of pair slots only, read at 16 and 32 second-twin draws (pre-run change 1, item 4d) | A pilot that samples every pair type, T7, T8 and builders before the rest (section 5.4) | The pair-only pilot could not see unpaired supply, which turned out to be 7 of 82. |
| 8 | A projection past the cap went to the Captain | An optimistic projection of the cost to fill calibration and comparison, at the pilot's end and after every batch; past the room left, authoring stops and the eval reads INCOMPLETE (section 5.5) | There is no raise on this eval, so a projection past the cap can only end in a cap stop. Stopping early spends less. |
| 9 | Reserves drawn in the same order as everything else; any shortfall stopped the eval | Reserves are drawn after calibration and comparison are full. A cap stop on authoring after that ends authoring only, and the eval goes on with the reserves placed (section 5.6) | A short reserve set loses only replacements; a drop with no reserve left counts as missing under section 8's limits. |
| 10 | `ohr read decision` learned of a cap stop only from a flag | The decision read takes every cap stop from each launch's stops.json and each ledger item, and a flag can add a stop but never remove one | The first attempt's one deferred review finding. |
| 11 | $2,360 paid at caps under the first cap rule | Item caps from the first attempt's resize.py, design 1, under the amended cap rule; $2,737 all-in at caps with no raise, and a money check before each item opens (section 7) | The approved line. |
| 12 | Sizing at 40 clusters | Sizing at 32 clusters (section 6, sizing.txt) | Fewer clusters. |
| 13 | Pins set by a dated pre-run change after the plan merged | The pins are named here; one dated pre-run change on the results branch names the build commit and the ledger split before the first paid call | The pins were already fixed by the first attempt's pre-run changes 1 and 2. |

Nothing else changes: no arm, model, judge, measure, threshold, decision row (beyond row 1, as above), admission condition or failure rule.

## 4. Briefs

**Slots.** The first attempt's schedule (lanes/office-hours-rewrite/author/draws.ts, seed 20261117) fixes 76 slots and their seeded order. This eval keeps that schedule and drops 8 comparison founder slots that hold no placed brief:

- skin 1's slots for T1 to T7 (no placed brief sits in skin 1);
- skin 5's T8 slot instead of skin 1's, because the anti-pattern on skin 1's T8 slot (hiring to fix momentum) sits on no other comparison opening except skin 1's T6 slot, which is dropped. Skin 5's T8 anti-pattern (launch anxiety) also sits on skin 3's T7 slot.

The 32 kept founder slots hold 4 of each type, and all 21 anti-patterns still appear on at least one comparison opening. The 24 builder slots, the 6 calibration slots and the 6 reserve slots are unchanged. Slot ids name a set, a skin and a type, and come from the public schedule.

**Reused briefs.** The first attempt placed 19 briefs, in these slots:

| Set | Slots | Briefs |
|---|---|---|
| Calibration | cal0-research | 1 builder |
| Comparison, pairs | com2-T4, com2-T6, com3-T2, com3-T3, com4-T6, com5-T5 | 12 |
| Comparison, T7 | com4-T7, com5-T7 | 2 |
| Comparison, builders | com2-fun, com2-open-source, com3-open-source, com5-fun | 4 |

They enter the new run as placed, with their sealed files, keys, check records, opening-only and full-information answers and digests, read from the first attempt's sealed authoring output (plaintext sha256 971ec21b83e6b6be65c5e54b7f5fd2aec0cca805fea1bbea2c0a908a0e15cfea). The run checks each brief's files against its recorded digest before it places it, and a brief that fails the check is drafted again in its slot. No other first-attempt draft is reused.

**Still to place: 77 briefs.**

| Kind | Calibration | Comparison | Reserve | To place |
|---|---|---|---|---|
| Pairs | 2 pairs (T5, T6) | 18 pairs (T1 4, T2 3, T3 3, T4 3, T5 3, T6 2) | 2 pairs (T1, T4) | 22 pairs, 44 briefs |
| T7 | 1 | 2 | 1 | 4 |
| T8 | 1 | 4 | 1 | 6 |
| Builders | 1 | 20 | 2 | 23 |

## 5. Authoring

Authoring keeps the founder lane's pipeline and every screen of section 3 of the first preregistration: GPT-6.1 Sol and Gemini 4 Argon author, no Claude model authors, authors never see either skill, and each brief passes the vocabulary screen, the unanimous key (Opus 5.5, GPT-6.1 Sol and GPT-6.2 Astra), the give-away screen for unpaired briefs, the blind two-family audit, the recognition probe and the generic screen, with one rewrite in all. Only the drawing changes.

### 5.1 Draws that do not depend on concurrency

- A pair slot draws pair 1, then pair 2 if pair 1 drops, and so on. Within a pair, the slot draws first twins until one passes, then second twins against that partner (section 5.3).
- An unpaired slot draws attempts 1, 2 and so on until one passes.
- Each draft's request depends only on its slot's frozen inputs, its pair and attempt numbers, its author family and, for a second twin, its partner's files. Its brief id comes from the slot and those numbers.
- The k-th first-twin or unpaired draft on the slot at seeded position p comes from GPT-6.1 Sol when p + k is odd and from Gemini 4 Argon when it is even. A second twin comes from its partner's family.
- Each batch gives the first open slots, in the order of section 5.6, their next draft. Concurrency changes how many drafts run at once and when they finish, never which draft a slot makes next.

### 5.2 Outcome log and resume

Every settled draft is appended to an outcome log in memory-backed storage, with its slot, role, numbers, author, status, drop step, digest and the spend its calls took. After every batch the run seals the log and every placed brief with age to the custody store. A resume opens the newest sealed log, checks its digest, rebuilds each slot's state from it and continues. A draft that was in flight at the stop is drawn again as the same request, so it costs at most once more, and the reply cache replays it free when it survives. The dry run restarts a planted run at a different concurrency against a fake provider and asserts that no settled draft is requested again.

### 5.3 Top-up twins

A partner (a first twin that passed) gets at most 3 second-twin draws. When all 3 fail, the partner drops, its first twin is not placed, and its slot starts its next pair with a new first twin. A pair is placed only when both twins pass, and a partner still open when authoring ends drops, so pairs stay whole.

### 5.4 The pilot

After the 19 reused briefs are placed, the pilot draws on open calibration and comparison slots only, in seeded order:

- for each pair type T1 to T6, its first two open slots, each until it has settled one partner (matched, or dropped at the bound) or drafted 3 first twins;
- 8 drafts each of T7, T8 and builders, on that kind's open slots in seeded order, or fewer when the kind runs out of open slots.

Pilot briefs that pass are placed like any other. At the first attempt's cost per draft the pilot costs about $31. It replaces pre-run change 1's pair-only pilot and its 16 and 32 draw reads.

### 5.5 The projection stop

At the pilot's end, and after every later batch until calibration and comparison are full, the run projects the cost to place every open calibration and comparison slot. A slot with a partner waiting is costed as a fresh pair.

- A pair of type t costs (c1 / f + m_t × D × c2 + (1 - m_t) × 3 × c2) / m_t, the first attempt's resize.py formula.
- An unpaired brief of kind u (T7, T8 or builder) costs cu / y_u.
- f is the first-twin pass rate over all pair types, m_t the share of type t's settled partners that matched within 3 draws, and y_u the pass rate of kind u. Each counts the first attempt's final path (resize.py, Part A, and the partners table in section 3 of the first attempt's results) plus this run, and enters at the 0.95 quantile of its Jeffreys posterior, Beta(k + 0.5, n - k + 0.5). So the projection is optimistic, and authoring stops only when even that cannot fit.
- D is the mean number of draws a matched partner took, over both attempts.
- c1, c2 and cu are the first attempt's costs per draft ($0.887 a first twin, $0.093 a second twin and $0.545 an unpaired draft), scaled by this run's spend over what those figures predict for the drafts it has made.

Authoring stops when the projection passes the item's cap less its committed spend less 8 drafts at $3.50. The eval then reads INCOMPLETE, and the post prints the projection, the counts behind it and the briefs placed so far.

**How the rule behaves** (sizing.txt, Part D, 2000 simulated runs a row, with every partner either easy or hard by chance at the first attempt's rates):

| Reading | With the stop | Without it |
|---|---|---|
| Hardness sits with half the partners, as measured | fills 0.992, stops falsely 0.008 | fills 0.999 |
| T1 and T4 are hard by type | stops 0.985, after $270 on average | stops at the cap 0.946, after $406 |

So when T1 and T4 are hard by type, as none of their three partners in the first attempt matched within 3 draws, the rule ends authoring about $136 sooner on average, and it stops about 1 run in 100 that would have filled. These shares come from a model of authoring, not from data, and the first projection at the first attempt's counts alone reads $113.56 against $350 of room.

### 5.6 Order and the end of authoring

- The pilot comes first (section 5.4).
- Then every open calibration and comparison slot draws in seeded order until all are placed.
- Then reserve slots draw in seeded order until they are placed or the cap stops them.
- A cap stop, a projection stop or any other stop before calibration and comparison are full ends the eval INCOMPLETE.
- A cap stop after calibration and comparison are full ends authoring only. Reserves left unplaced are reported, and a comparison brief that drops later with no reserve of its kind counts as missing.
- A stop that is not about money (a provider or model drift, the empty-reply bound, a closed lease) halts the run. A resume after a dated pre-run fix continues from the log and pays nothing twice.

## 6. Sizing

sizing.py (attached) runs the first preregistration's power.py unchanged on 32 clusters: 24 matched pairs and 8 unpaired founder briefs, one session a brief, arm and model, pooled over Opus 5.5 and GPT-6.1 Sol. sizing.txt prints:

| Contrast | Control rate | Pooled MDD, rho 0.5 (0.843) | One model, rho 0.5 (0.843) |
|---|---|---|---|
| new minus current | 0.25 to 0.55 | 0.14 to 0.15 (0.09 to 0.10) | 0.19 to 0.20 (0.12 to 0.13) |
| new minus none, current minus none | none at 0.05 to 0.40 | 0.09 to 0.15 | 0.13 to 0.20 |

**What the literal bar costs.** MERGE needs a pooled estimate of at least 15 points and an interval wholly above zero. At p0 0.40, with rows 1 to 3 assumed to pass, the founder rows read:

| True lift | 0 | 10 points | 15 points | 20 points | 25 points |
|---|---|---|---|---|---|
| Interval above zero, rho 0.5 | 0.029 | 0.490 | 0.826 | 0.973 | 0.998 |
| MERGE, rho 0.5 | 0.001 | 0.150 | 0.478 | 0.819 | 0.973 |
| MERGE, rho 0.843 | 0.000 | 0.079 | 0.486 | 0.837 | 0.973 |

The first attempt's resize.py, on another stream of the same seed, read 0.463 and 0.458 at a 15-point lift. Simulated shares move by about 0.01 to 0.02 between streams, so we state the 15-point share as about 0.46 to 0.49.

**Builders.** The 24 builder briefs are the first preregistration's, so its power.txt, Part E, holds: with builders unchanged, the corrected method 10 interval passes in 0.68, 0.78 and 0.88 of runs when the current skill keeps 85%, 90% and 95% of builder sessions whole (rho 0.5), and in 0.026 to 0.043 of runs at a true 15-point loss. In that model the builder check is independent of the founder rows, so with builders unchanged at 90% kept whole the full rule's chance of MERGE is at most the founder share times 0.777: about 0.37 at a true 15-point lift and 0.64 at 20 points.

After stage 1, power.py reruns at the observed control rates, as the first preregistration's section 9 says.

## 7. Money

**Item caps.** From the first attempt's resize.py, design 1 (resize.txt, Part C), under the amended cap rule: 1.35 times central plus what the item's parallel calls hold at open. Stage 1 and the judge check keep their approved caps. The Captain records each cap after this plan merges, and no paid call runs before that.

| Item | What it pays for | Central | Cap |
|---|---|---|---|
| 1 Authoring | the pilot and every brief still to place, with keys and screens | $281.64 | $409 |
| 2 Simulator audit | the fixed six-question script over 96 sheets, and two auditors on 80 turns | $28.81 | $40 |
| 3 Stage 1 | 48 sessions on Opus and Sol and 24 on particle-1, with simulator and labels; holds one admission repair | $109.68 | $220 |
| 4 Judge check | the gold pass, production labels on it and live probes | $89.80 | $123 |
| 5 Stage 2, Opus and Sol | 480 sessions (80 briefs, three arms, two models), with simulator and labels | $1,011.20 | $1,406 |
| 6 Stage 2, particle-1 | 240 sessions, with simulator and labels | $85.60 | $130 |
| 7 Hosts | runner VMs | $13.18 | $19 |
| **Paid total** | | **$1,619.91** | **$2,347** |

Agent use is planned at $390: the first attempt's planning figure of $350, plus the $40 line item its resize.py carries for harness fixes, which here pays for the changes in section 3. That gives $2,010 all-in at central and $2,737 at caps. Authoring's 95% range at the first attempt's yields is $175 to $762, so all-in at caps could run $2,593 to $3,385 if authoring were allowed past its cap. It is not: a cap stop ends its item. If T1 and T4 are hard by type, authoring alone needs about $395 more at central (resize.txt), which does not fit, and section 5.5 stops it early.

**Agent use** counts every agent thread working on this eval and its subagents at the list-price meter, plus every paid call and every runner VM.

**The money check.** Before each paid item opens, the all-in spent so far, plus that item's cap, plus the caps of every later item, plus $100 kept for the results post and its review, must fit in $2,737. If it does not, the item does not open and the eval reads INCOMPLETE. Each item's cap splits into the ledger items its runs lease under pre-run change 4's rule, recorded in the pre-run change that names the build commit.

**Hosts.** Runner VMs are created for a stage and destroyed when it ends, and the results post lists that none is left.

## 8. Stages and stop rules

0. This plan merges, and the Captain records the item caps.
1. **Build**, on the results branch: sections 5.1 to 5.6, the decision read of section 3, item 10, and the slot set of section 4, each with a test that fails first. Before any paid call, all of these pass: the first preregistration's keyless tests and dry run, which now also drive a restart at a new concurrency on a fake provider, the bound, the pilot and projection stop on planted yields that go and that stop, the reserve order, the reuse check on a planted digest mismatch and the stops.json read; and a no-model preflight on a runner VM. A dated pre-run change then names the build commit and the ledger split, and is pushed before the first paid call.
2. **Authoring** (item 1): the pilot, then the rest (section 5).
3. **Simulator audit** (item 2), as the first preregistration's stage 3.
4. **Stage 1** (item 3) and **the judge check** (item 4), then admission A1 to A7 with its one repair.
5. **Stage 2** (items 5 and 6), then the hand check of the scorer on 5 real sessions.
6. **The results pull request**, carrying the pre-run changes and the build.

**Stops that read INCOMPLETE:** any stop in section 5.6 before calibration and comparison are full; the money check in section 7; a cap stop on any item after authoring; admission that fails twice; a missing limit passed; a judge check that fails or reads NO READ after its repair.

## 9. Reporting

The results post leads with the first preregistration's section 11 table, pooled and per model, with this plan's MDDs: 0.14 to 0.15 for new minus current, and 0.09 to 0.15 for new minus none and current minus none. It reports everything section 11 lists, and these too:

- authoring yields by type and role, with Wilson 95% intervals, in the pilot and overall;
- second-twin draws per partner, and how many partners dropped at the bound;
- each projection-stop read, with the counts behind it;
- spend by item, by model and by authoring role, and any spend on drafts that no slot's sequence used, which should be zero;
- how many of the 19 reused briefs passed the reuse check, and how many reserves were placed;
- all-in spend: paid calls by item, runner VMs and agent use.

## 10. Limits

- Everything in the first preregistration's section 16 holds.
- One model alone has an MDD of 0.19 to 0.20, so per-model rows are descriptive.
- At a true 15-point lift the full rule reads MERGE only about 0.37 of the time. This eval can reliably confirm a lift of about 20 points or more, not one of exactly 15.
- The interval's coverage was simulated at 40 clusters in the first preregistration, not again at 32.
- The 19 reused briefs came from the first attempt's draw path, which restarts changed. No brief was chosen by its outcome, and every one passed every screen.
- T8 supply is unmeasured: the first attempt never drafted a T8 slot.
- The bound of 3 saves money when hardness sits with some partners, and costs money when it sits with a whole type. The first attempt cannot tell which; the pilot and section 5.5 read it as the run goes.
- Section 5.5's shares come from a simple model of authoring: fixed pass rates, partners easy or hard by chance, and sequential batches.
