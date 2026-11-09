---
id: 2026-11-03-geva-232-panel-v3-e0-results
kind: finding
title: "Panel v3 E0: plain Opus 5.5 found 137 of 138 candidate readings, so all twelve candidate kinds read DROP-CEILING and no stratum is built"
summary: "E0 READ. Opus 5.5 none matched 137 of 138 candidate readings and every anchor; all 12 kinds DROP-CEILING, all 4 strata NOT BUILT. Saturated null, R48 FIX-METHOD. $25.08 of $62.86."
author: GEVA-232
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-03
status: superseded
links:
  - 2026-11-03-geva-219-panel-v3-e0-screen-prereg
  - 2026-11-02-geva-165-planning-panel-v3-plan
  - 2026-11-02-geva-202-panel-v3-author-kit
  - GST-1174
  - GST-1107
---

# Panel v3 E0: plain Opus 5.5 found 137 of 138 candidate readings (0.993, 95% interval 0.960 to 1.000), so every candidate kind reads DROP-CEILING and no stratum is built

Publication status: unpublished. Done: the run, both readings parts, this file and the author's claim check. Still blocking publication: the /ship review recorded in the pull request, a cross-family claim check against the data, and a reanalysis by another Captain's crew from a clean machine (steps 5 and 6 on the sealed run bundle).

| Field | Value |
|---|---|
| Grade | A preregistered screen (#172, main b037fcf). Its rule decides which item kinds the E1 admission units are written from. It makes no claim about any gstack skill: E0 runs no gstack arm. |
| Repo commit | Scorer pinned at b7b6aeccec868e5127e951b187ca4b637da13114, a clean checkout. The frozen scripts matched the prereg's section 14 sha256s before launch. |
| Prereg | [2026-11-03-geva-219-panel-v3-e0-screen-prereg](../plans/2026-11-03-geva-219-panel-v3-e0-screen-prereg/README.md) (#172, b037fcf) |
| Data | Run bundle panel-v3-e0-run.tar.gz.age, sha256 7feee0198a375e3ed56768872ff80ac759b0a908c8442d01e5e2688a75a3b627, sealed to the panel v3 recipient and held by the gstack-evals Captain; not public |
| Reviewed by | /ship review of this file, recorded in the pull request |
| Reproduced by | Pending: another Captain's crew, rerunning steps 5 and 6 on the sealed run bundle from a clean machine. |

## What we found

Plain Opus 5.5, given the scorer's one-turn plan prompt and no gstack, found the seeded flaw in 137 of 138 candidate readings on the 24-unit panel v3 calibration slice, and in all 48 anchor readings. Every one of the twelve candidate kinds landed at 11 of 12 or better, far above the KEEP band's ceiling of 0.6. So all twelve kinds read DROP-CEILING, no kind is kept, and all four strata read NOT BUILT.

E0 itself reads READ. All 48 Opus sessions scored, with no stop, gap or cap, and judging completed in all three reads. This is the third planning panel that plain Opus has saturated, after CEO panels v1 and v2. E0 spent $25.08 of its $62.86 cap.

## How it works

This is an explanation, not a result. The twelve kinds were chosen because they look hard: each needs a deciding fact, a computation, a missing step, code behavior or an unstated decision, not just a careful read of the plan. But every kept item had also passed a keyed audit for findability and signposting, so a fair item is a findable one. In one session of a median four turns, Opus read the plan and the context it pointed to and wrote one findings block that named almost every seeded item at Critical or High. On units of this size, the levers did not make the items hard for plain Opus.

## Setup

- **Question:** which of the twelve candidate kinds does plain Opus 5.5 miss often enough to keep (prereg section 7)?
- **Arm:** none only. No gstack installed; the scorer's plan prompt (`Review this plan for problems.` plus the frozen plan template, sha256 48a6f6a32049f111023e6d15958d1263f94611116d14ccb703809a97eff44291). particle-1 ran the same arm as a descriptive row.
- **Models:** claude-opus-5-5 on the Anthropic API and particle-ai/particle-1 on OpenRouter, each through the metering proxy. Claude Code 2.1.314 in the pinned trial image (recipe f62711a0a17f), the claude-code-preset system prompt, the 60-turn cap, a 3600 s timeout, `--plan ceo`, 2 passes, `--parallel 3`.
- **Tasks:** 24 units, 6 each in ceo, design, dx and eng; 93 keyed blockers: 69 candidate items in 12 kinds (C-U2, G-A11Y and E-OM have 5 items, the rest 6) and 24 anchors. 3 items were excluded under the drop rule. 3 flagged units (11 blockers) stay in the primary read. Suite planrev-v3-e0, sha256 e2f10e5e68e54c196e855ec46cf21d8a8f46ac66eca1375f63e31a0b30d0d3f0.
- **Judging:** one packet batch (seed 20261103, batch 4fdfebad402e906afbf395927a2f308e882a1c01064c5b8e0c1323109e0674c9) and three full reads with judge brief v3 (sha256 79d73194f09c65d457c9ada56143f4b3776a8839c777846a91fb9869a660a936), whose primary judges were openai/gpt-6.1-sol, anthropic/claude-opus-5-5 and anthropic/claude-sonnet-5-5. A final match is one the Sol and Opus reads agree on; where they differ, the Sonnet read decides.
- **Machine and dates:** one Capy cloud machine, 4 vCPU, 16 GB, Docker 29.9.2; 2026-11-03, 04:28 to 05:31 UTC.

## Result

Readings part two (e0-readings.ts, step 6) printed this verdict block:

```text
E0: READ
Opus sessions: scheduled 48, scored 48, stops 0 (turn cap 0, allowance 0, timeout after output 0; 0 dropped held a parsed block), gaps 0, cap 0, misses (scored, no block) 0
Anchors: pooled recall 1.000; ceo 1.000, eng 1.000, dx 1.000, design 1.000
Kind C-OM (ceo, 6 items): must-fix 12/12 = 1.000 -> DROP-CEILING; any-severity 12/12; stops 0
Kind C-Q (ceo, 6 items): must-fix 11/12 = 0.917 -> DROP-CEILING; any-severity 11/12; stops 0
Kind C-U2 (ceo, 5 items): must-fix 10/10 = 1.000 -> DROP-CEILING; any-severity 10/10; stops 0
Kind E-CD (eng, 6 items): must-fix 12/12 = 1.000 -> DROP-CEILING; any-severity 12/12; stops 0
Kind E-OM (eng, 5 items): must-fix 10/10 = 1.000 -> DROP-CEILING; any-severity 10/10; stops 0
Kind E-Q (eng, 6 items): must-fix 12/12 = 1.000 -> DROP-CEILING; any-severity 12/12; stops 0
Kind G-A11Y (design, 5 items): must-fix 10/10 = 1.000 -> DROP-CEILING; any-severity 10/10; stops 0
Kind G-OM (design, 6 items): must-fix 12/12 = 1.000 -> DROP-CEILING; any-severity 12/12; stops 0
Kind G-X (design, 6 items): must-fix 12/12 = 1.000 -> DROP-CEILING; any-severity 12/12; stops 0
Kind X-CD (dx, 6 items): must-fix 12/12 = 1.000 -> DROP-CEILING; any-severity 12/12; stops 0
Kind X-OM (dx, 6 items): must-fix 12/12 = 1.000 -> DROP-CEILING; any-severity 12/12; stops 0
Kind X-Q (dx, 6 items): must-fix 12/12 = 1.000 -> DROP-CEILING; any-severity 12/12; stops 0
Stratum ceo: NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Stratum eng: NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Stratum dx: NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Stratum design: NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Sensitivity read (flagged units left out, 11 blockers; reported, decides nothing): E0 READ; anchors 1.000; C-OM 8/8 DROP-CEILING, C-Q 7/8 DROP-CEILING, C-U2 8/8 DROP-CEILING, E-CD 10/10 DROP-CEILING, E-OM 8/8 DROP-CEILING, E-Q 10/10 DROP-CEILING, G-A11Y 10/10 DROP-CEILING, G-OM 12/12 DROP-CEILING, G-X 12/12 DROP-CEILING, X-CD 12/12 DROP-CEILING, X-OM 12/12 DROP-CEILING, X-Q 12/12 DROP-CEILING; ceo NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD), eng NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD), dx NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD), design NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Re-audit: DEAD in the primary read none; in the sensitivity read none; the re-audit covers no kind
Judging: complete; unanswered blockers in primary replies sol 0, opus 0, sonnet 0; matching kappa sol/opus over both arms' cells with a parsed block, pooled 0.385 (n 350), ceo 0.739 (n 89), eng 0.271 (n 84), dx 0.000 (n 92), design 0.000 (n 85)
Kappa eng 0.271 (n 84): kappa under 0.6: E1 must revise brief v3 before this stratum's judging
Kappa dx 0.000 (n 92): kappa under 0.6: E1 must revise brief v3 before this stratum's judging
Kappa design 0.000 (n 85): kappa under 0.6: E1 must revise brief v3 before this stratum's judging
particle-1 (descriptive): C-OM 11/12, C-Q 11/12, C-U2 8/10, E-CD 10/12, E-OM 8/10, E-Q 9/12, G-A11Y 9/10, G-OM 10/12, G-X 10/12, X-CD 11/12, X-OM 11/12, X-Q 11/12; anchors 0.875; missing block 6/48; stops 0; gaps 0; cap 0
Cost claude-opus-5-5: median $0.230, mean $0.236, 90% upper $0.242; turns median 4, mean 4.1, 90% upper 4.3
Cost particle-ai/particle-1: median $0.018, mean $0.019, 90% upper $0.020; turns median 11, mean 12.5, 90% upper 13.5
Read audit claude-opus-5-5: 0 sessions flagged, 0 calls
Read audit particle-ai/particle-1: 0 sessions flagged, 0 calls
```

By stratum:

| Stratum | Opus must-fix matches per kind | Kept kinds | Disposition |
|---|---|---|---|
| ceo | C-OM 12/12, C-Q 11/12, C-U2 10/10 | none | NOT BUILT |
| eng | E-CD 12/12, E-OM 10/10, E-Q 12/12 | none | NOT BUILT |
| dx | X-CD 12/12, X-OM 12/12, X-Q 12/12 | none | NOT BUILT |
| design | G-A11Y 10/10, G-OM 12/12, G-X 12/12 | none | NOT BUILT |

No kind is DEAD in the primary or the sensitivity read, so the blind re-audit (step 5b) had no kind to cover, and the sealed slice was not opened again. Part two ran with part one's flags and no `--reaudit` file, since no kind needed one, and printed the same block as part one, byte for byte.

Pooled over all twelve kinds, Opus matched 137 of 138 readings (0.993, Clopper-Pearson 95% interval 0.960 to 1.000) and particle-1 matched 119 of 138 (0.862, 0.793 to 0.915). These intervals treat readings as independent; the two passes on one item are not, so the true intervals are somewhat wider.

**Also read, deciding nothing:**

- **Any-severity rates** equal the must-fix rates for every kind.
- **Stops:** 0 in every kind and stratum, in both runs.
- **Sensitivity read** (the 3 flagged units' 11 blockers left out): the same disposition for every kind and stratum.
- **particle-1:** per-kind rates from 8/10 to 11/12, anchor recall 0.875, and a missing block in 6 of 48 sessions (review-units counted 5 missing and 1 malformed; each scores as a miss), with no stops, gaps or cap.
- **particle-1 unjudged cells: 0.** No frozen script prints this count, so it was computed by hand from the three primary replies. Each read's primary reply lists all 24 packets of the batch, and every one of the 93 packet and blocker pairs carries an answer. A particle-1 cell can be unjudged only when its packet has no primary answer, so the count is 0 in all three reads, and particle-1's recall is not a lower bound on that account.
- **Per-session cost and turns** (bootstrap 90% upper bound of the mean, seed 1, 10,000 draws):

| Model | Median | Mean | 90% upper | Turns median | Turns mean | Turns 90% upper |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | $0.230 | $0.236 | $0.242 | 4 | 4.1 | 4.3 |
| particle-ai/particle-1 | $0.018 | $0.019 | $0.020 | 11 | 12.5 | 13.5 |

- **Kappa** (Cohen's, Sol read against Opus read, any-severity match, both models' cells with a parsed block): pooled 0.385 (n 350); ceo 0.739 (n 89), eng 0.271 (n 84), dx 0.000 (n 92), design 0.000 (n 85). Eng, dx and design are flagged under 0.6: E1 must revise brief v3 before judging any of them.
- **Read audit:** 0 flagged sessions and 0 flagged calls in either run.

## Cost

| Item | Calls | Input | Output | Reasoning | Cache read | Cache write | Spent | Projected | Cap |
|---|---|---|---|---|---|---|---|---|---|
| e0-opus-none | 48 sessions | 350 | 284,441 | 0 | 4,234,281 | 958,286 | $11.33 | $15.84 | $43.30 |
| e0-particle-none | 48 sessions | 2,059,822 | 677,430 | 0 | 3,951,360 | 0 | $0.90 | $3.96 | $6.12 |
| e0-judge-sol | 47 requests | 843,051 | 30,957 | 8,036 | 0 | 559,901 | $5.01 | | $50.63 |
| e0-judge-opus | 48 requests | 1,093,473 | 38,154 | 7,259 | 420,506 | 0 | $4.73 | | $45.62 |
| e0-judge-sonnet | 48 requests | 1,099,688 | 28,524 | 5,813 | 415,356 | 0 | $3.11 | | $40.89 |
| **E0** | | | | | | | **$25.08** | **$42.48** | **$62.86** |

Token counts and spend are the metering proxy's, as each lease settled in the ledger (0 unknown calls). The three judge reads together were projected at $22.68 and cost $12.85. Each judge cap is the prereg's envelope: $62.86 less the settled spend of every earlier E0 item, rounded down to the cent ($62.86 - $12.223983 = $50.636017, so $50.63; then $45.624822, so $45.62; then $40.891511, so $40.89).

Prices are the scorer's table at b7b6aec (src/runner/pricing/prices.ts), in dollars per million tokens: Opus 5.5 input 4, output 20, cache read 0.20, cache write 5; Sonnet 5.5 input 2, output 10, cache read 0.20, cache write 2.50; GPT-6.1 Sol input 2, output 10, cache read 0.10, cache write 2.50, with higher rates above 272k input tokens; particle-1 input 0.10, output 1, cache read 0.003 (OpenRouter's models API, read 2026-10-30). Cache reads and writes are billed at their own rates as each provider reports them.

A plain Opus session cost $0.236 on average, under the plan's $0.33 projection, and a particle-1 session cost $0.019 against $0.083. These are one-turn sessions; E1's two-turn protocol will cost more.

## Why null? (R48)

This is a saturation null (R61), not an exposure or task-fit null.

- **Exposure:** no skill is under test here. The question is whether plain Opus engaged the units, and it did: 48 of 48 sessions wrote a parsed findings block, with no stops, and the read audit is clean.
- **Task fit:** the kinds were chosen to need more than a careful read of the plan. Opus found them anyway, so on these units the levers did not create difficulty.
- **Power and ceiling:** the control rate is 0.993 (0.960 to 1.000). KEEP needs a kind at 0.6 or below, and the lowest kind read 0.917 (C-Q, 11 of 12). Under the prereg's operating table, a kind whose true recall is 0.6 reads KEEP about 55% of the time, so twelve kinds at 0.917 or above are a ceiling, not noise from the draw. No lift test ran, so no MDD applies; E1's admission rule needs plain recall well below these rates.
- **Frontier competence:** yes. Today's frontier model finds these seeded flaws in one plain session, with no gstack. particle-1 finds 86% of them.
- **Verdict: FIX-METHOD.** Under R61 a saturated null gets one ceiling-raise attempt, after a headroom check, before any CUT-CANDIDATE. The plan names that attempt: new levers, code-heavy units and larger repos, before anything else. Nothing here is a verdict on any gstack skill.

## What changes

- No E1 admission units are written from these twelve kinds. The `--kept` and `--floor` lists are empty in all four strata.
- Each stratum's R56 row returns to the gstack-evals Captain with R48 FIX-METHOD and this reading.
- If any stratum is rebuilt, the brief v3 revision that the kappa flags require (eng, dx, design) comes first.
- The measured session costs replace the plan's projections when the next round is priced, and particle-1's allowances and caps are repriced from them.

## Limits and threats

- Seeded items are not natural flaws. Every kept item passed a keyed audit for findability and signposting, which may be part of why plain Opus finds them.
- One model family (Gemini) wrote the units. The auditors, two of the three judges and this author share Anthropic's or OpenAI's family.
- Judge agreement is low in three strata (kappa 0 to 0.27). When nearly every cell is a match, chance agreement is near 1 too, so a few disagreements can push kappa to 0; the readings print kappa, not raw agreement. For any kind to reach KEEP, at least four of its final matches would have to become misses (C-Q from 11 of 12 to 7, a 10-reading kind from 10 to 6), and five for the 12 of 12 kinds.
- Two passes and five or six items make each kind's reading coarse (prereg section 11), but every kind sits at the top of its range.
- The ceo lens labels all four strata; for the none arm it changes nothing the model sees.
- One machine, one day and one pinned Claude Code version.

## Replicate it

Outsiders can't rerun E0, because the slice and the run bundle are sealed. The record of what ran is the prereg's section 4 commands at the pinned scorer, the frozen scripts in the prereg bundle (sha256s in its section 14) and the verdict block above. That record leaves out the machine setup (`gstack-evals doctor --host claude` built the pinned trial image) and the ledger rows, which sit in the Captain's ledger record. A holder of the panel v3 identity can rerun steps 5 and 6 keyless on the sealed run bundle and compare the block byte for byte.

## What is held out, and why

| Record | sha256 |
|---|---|
| Calibration slice, panel-v3-calibration.tar.age | ea69c111bc5d781d507ee296d84202702eb628375c7310bfb26eb93523644934 |
| Run bundle, panel-v3-e0-run.tar.gz.age | 7feee0198a375e3ed56768872ff80ac759b0a908c8442d01e5e2688a75a3b627 |
| Run bundle plaintext (tar.gz) | 5a585c216bd874b8fa39bc5a244255e85c772cc8f87c685741381c18cd97891c |
| Suite planrev-v3-e0 | e2f10e5e68e54c196e855ec46cf21d8a8f46ac66eca1375f63e31a0b30d0d3f0 |
| e0-kinds.json | 23cdd09450d47becb94ebedc993d02eb65324276e0221f1ba3939fdc3c2c2e2e |
| Plans bundle | 2f123e0057a728078b24a49409a2b8da22f6f88018dbfde782b820889e7bed98 |

The run bundle holds the run root, its transcripts, the judge replies and the retained session trees. It pairs unit heads with kinds, so it stays sealed with the slice. Calibration units never become panel material and stay sealed until the confirmatory rounds end (prereg section 9).

## Claim check (author)

- The headline's 137 of 138 is the printed count. The DROP-CEILING verdicts rest on the prereg's observed-count rule, and the lowest kind read 11 of 12; the pooled interval is descriptive and does not bound any single kind.
- The post makes no claim about gstack, and none that favours particle-1, which is descriptive here.
- Every number in Result and Cost comes from the printed verdict block, the judge-run summaries or the ledger's settled leases, except the particle-1 unjudged count and the pooled intervals, whose methods are stated where they appear.

## Changelog

- 2026-11-03: first version.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
