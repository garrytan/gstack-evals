---
id: 2026-11-08-geva-353-l1-sol-particle-results
kind: finding
title: "L1 on GPT-6.1 Sol and particle-1: the overhaul's routing got untold particle-1 to open /investigate in 15.0% of fresh SWE-rebench sessions (0% before), a KEEP; Sol's untold line had no room, and told adherence failed the probe audit on both"
summary: "Sol and particle-1, 80 SWE-rebench tasks each: particle-1 B1 +15.0 [+7.5, +22.5] KEEP; Sol B1 saturated; B3 FIX-METHOD on both (probe audit failed); pass rates flat."
author: GEVA-353
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-08
status: open
links:
  - 2026-11-06-geva-350-l1-overhaul-results
  - 2026-11-03-geva-254-l1-overhaul-prereg-2000
  - 2026-11-05-geva-294-l1-amendment-c
  - 2026-11-05-geva-302-l1-amendment-d
  - 2026-11-06-geva-354-l1-amendment-e
  - 2026-11-06-geva-353-l1-amendment-f
  - garrytan/gstack-evals#247
  - garrytan/gstack-evals#251
  - garrytan/gstack-evals#260
  - quick/laneb/l1
attachments:
  - 6dd26bd4cffd6562bb7ac813350d199a3d7a34aa8e633a5f41bba994f599030c  f1-p1-report.md
  - fa845cbac9d6cbaf07c0ddce1e62ca93e5b1b5aabea0858e4a4b2eb46acdc733  f1-sol-report.md
---

# L1: gstack's overhaul before and after on GPT-6.1 Sol and particle-1

## Status

Publication status: unpublished. This is the record of a preregistered run. Done: Sol's and particle-1's route checks, pilots and F1 runs, Sol's off-u item, the read audit, the blind probe audit, the analysis, the final ceiling read and this post. Still open before any public use: the claim check by a cross-family reviewer and a recount by another crew.

| Field | Value |
|---|---|
| Grade | Confirmatory for the primaries each model's pilot admitted: B3 on Sol and B1 on particle-1. B1 on Sol, B3 on particle-1, O5, Sol's off-u contrast and every secondary line are descriptive. |
| Prereg | [2026-11-03-geva-254-l1-overhaul-prereg-2000](../../plans/2026-11-03-geva-254-l1-overhaul-prereg-2000/README.md) (#193), with [Amendment C](../../plans/2026-11-05-geva-294-l1-amendment-c/README.md) (#221), [Amendment D](../../plans/2026-11-05-geva-302-l1-amendment-d.md) (#227), [Amendment E](../../plans/2026-11-06-geva-354-l1-amendment-e/README.md) (#251) and [Amendment F](../../plans/2026-11-06-geva-353-l1-amendment-f/README.md) (#260) |
| Build | 6d092bc1 (Amendment E) for l1-route-sol and pilot-sol; 5a01538a (Amendment F) for every later item and for the analysis: probes.ts 47d55b3e, table.ts b91f698a, analyze.ts aa72797c, audit.ts 528509b8 |
| Opus 5.5 | Reported in [the Opus post](../2026-11-06-geva-350-l1-overhaul-results/README.md) (#247). This post doesn't repeat its lines. |
| Data | Run records in the gstack-evals Captain's drive (handoffs/GEVA-353/ and the l1-recovery backups). They hold model transcripts, so they stay private. This post publishes counts, digests and aggregate tables only. |
| Reviewed by | The /ship review of this post, recorded in its pull request |
| Reproduced by | Not yet. table.ts at 5a01538a rebuilt both run tables from the trial dirs byte for byte. |

## What we found

On particle-1 the overhaul's routing worked the way it did on Opus, at a lower rate. Untold, particle-1 opened /investigate in 12 of 80 fresh SWE-rebench sessions with the after pin and in 0 of 80 with the before pin: **B1 is +15.0 points (95% CI +7.5 to +22.5, Holm p 0.0009), a KEEP** for the route hook and the description rewrite as a package. All 12 opens came on the 19 tasks the route hook sends to /investigate (12 of 19). Probe L passed its blind audit (32 of 32, kappa 1.00). On the same tasks Opus 5.5's B1 was +21.3 points (95% CI +12.5 to +30.0, #247). No paired gap between the two models was preregistered or computed.

On Sol the untold line had no room to show a gain. Sol already opened /investigate untold in 52 of 80 sessions with the before pin, and its pilot (6 of 10) didn't admit B1. The descriptive reading is +8.8 points (95% CI -3.8 to +22.5): **FIX-METHOD (saturation)**. On the 19 routed tasks Sol went from 12 of 19 to 19 of 19. Sol's off-u item, the after pin with routing and contracts off, opened /investigate in 71 of 80 sessions: +23.8 points over before-u (95% CI +15.0 to +33.8, one-sided p below 0.0001, against a frozen MDD of 13.5 points). That contrast sits outside the Holm family, and its two arms ran in separate launches.

Told adherence carries no verdict on either model. Sol wrote a complete /investigate record, by probe I, in 63 of 80 after-t sessions and 6 of 80 before-t sessions. B3 reads +71.3 points (95% CI +60.0 to +81.3), but probe I failed its blind audit (kappa 0.10), so the frozen verdict is **FIX-METHOD (method)**. The audit showed why: under the before pin Sol labels one report line "Regression tests:" in the plural, the pinned probe doesn't read that label, and so it missed whole reports in before-t. B3's +71.3 is too high by an amount this run can't measure. particle-1 wrote complete records in 19 of 80 after-t and 34 of 80 before-t sessions: -18.8 points (95% CI -31.3 to -6.3). That is a descriptive line, because particle-1's pilot (6 of 10) didn't admit B3, and probe I failed its audit there too (kappa 0.40), with most of its misses in after-t. Both end in FIX-METHOD. The probe gate (probe I complete in F1 after-t, bar 50%) read 78.8% on Sol (met), and 23.8% on particle-1 and 30.0% on Opus (both not met).

Pass rate didn't move on either model. On Sol, told after passed 62.5%, told before 62.5% and no gstack 61.3%: O5 is +0.0 points (95% CI -5.0 to +5.0) against an MDD of 19.3. On particle-1 the three were 71.3%, 70.0% and 75.0%: O5 is +1.3 points (95% CI -7.5 to +10.0) against an MDD of 17.6. Neither carries a verdict.

## How it works

This section is an explanation, not a result.

The arms, pins, route hook and contract hook are the ones the Opus post describes. The route hook sends 19 of F1's 80 prompts to /investigate, 10 to /verify, 6 to /qa, 1 to /review and 44 to none (Amendment C's table). By the proxy's reading it fired in 36 of 80 after-u sessions on each model, and in 19 of 19 on the routed stratum.

particle-1 acts like a model that follows the hook and otherwise passes over the skill listing. It opened /investigate untold only on routed tasks (12 of 19), never on the other 61, and never under the before pin. Sol acts like a model that reads the listing on its own. It opened /investigate untold in 65.0% of before-u sessions, 73.8% of after-u and 88.8% of off-u, and it opened /verify in 77 of 80 sessions in both after-u and off-u. With routing on, Sol opened /investigate less often than with routing off (after-u minus off-u, -15.0 points, 95% CI -25.0 to -5.0) and passed a little more often (+6.3, 95% CI +1.3 to +12.5). Both off-u readings pair arms from separate launches.

Told, the contract Stop hook left a record in 80 of 80 Sol after-t sessions and blocked a stop in 58. On particle-1 it left a record in 77 of 80 and blocked a stop in 4. Probe I's four items, read from the table, show where records fall short. These counts are report-only and decide nothing.

| Model and arm (80 each) | DEBUG REPORT with six labels after the last edit | Fix names an edited file | Listed Status | Check after the last edit | Complete record |
|---|---|---|---|---|---|
| Sol after-t | 80 | 72 | 76 | 77 | 63 |
| Sol before-t | 11 | 9 | 7 | 71 | 6 |
| particle-1 after-t | 54 | 22 | 54 | 67 | 19 |
| particle-1 before-t | 62 | 37 | 62 | 70 | 34 |

Sol's before-t report item, 11 of 80, is where the blind audit found the probe wrong. On particle-1 the item that binds is Fix, in both pins.

## Setup

Everything not listed here is as the Opus post's Setup gives it: the question, both pins, the arms and their tars, F1's 80 tasks and four parts, the probes and the analysis.

- **Models.** The details are in Agent notes.
- **Order.** Every item ran and settled, and none hit a cap stop.
- **Arms.** F1 ran none, before-u, after-u, before-t and after-t on both models, 400 sessions each. Amendment E added off-u on Sol only (f1-sol-offu, 80 sessions, its own launch after f1-sol). Neither model ran off-t, so S6's off-t lines print no outcome, and neither ran the TB2 twin, so S12 prints no outcome.
- **Pilots.** 32 sessions per model: the pilot's 10 tasks on before-u and before-t, and 3 smoke tasks on after-u, after-t, off-u and off-t. The pilot rows feed admission only.
- **Input bound.** OpenRouter has no token-count endpoint, so the proxy reserves each request's input from its body bytes. Amendment F moved Sol from one token per byte to one per 3 bytes after the pilot. particle-1 stayed at one per byte. See Run disclosures.
- **Tables.** Each model's analysis table holds its pilot and smoke rows beside F1's: 512 rows for Sol (with off-u) and 432 for particle-1.

## Before any score: the read audit and the blind probe audit

Amendment C requires these before anyone reads a score. Both were recorded first. One exception for particle-1 is in Run disclosures.

**Read audit of the none arm.**

- Procedure (a), audit.ts xargs. Sol: 80 none sessions and 4,164 tool calls, and no call differs between the merged rule and the line-wide rule. particle-1: 80 none sessions and 4,112 calls, with 2 calls in 2 sessions flagged by the scoped rule only, each a find over / piped to xargs grep (vyperlang__vyper-4801 and Cambridge-ICCS__TCTrack-119). A person read both.
- Procedure (b), audit.ts contamination, against the 522,074-line gstack corpus from the rebuilt arm tars. Sol: the merged rule drops 0. particle-1: it drops 2, the same two sessions, and both are overturned because no gstack file content came back. Stands 0, listed 0.
- audit.ts apply changed no Sol row. It returned particle-1's two none rows to graded, which leaves 0 contaminated of 432. For both models the table without listed sessions equals the main table, so the report-only sensitivity lines equal the main lines.

**Blind probe audit (#169 7.6 item 4).** analyze.ts audit-sample drew, per model and probe, up to 20 sessions the probe passed and 20 it failed. Sol: 40 for probe L and 40 for probe I. particle-1: 32 for probe L (12 passed, 20 failed, because only 12 untold sessions loaded) and 40 for probe I. The packets came from the Opus post's renderer with paths read from the command line and its render code, masks and seed (20261106) unchanged (sha256 19e5b06bc57b73fae6c644769881d2e07a0ee8ec3d3f3beb65bdcd42eeb8859b). The rubric is the Opus post's blind-rubric.md. Eighteen Opus 5.5 readers labeled the packets. Two of the particle-1 readers stopped on the crew's cost watch with 7 packets unlabeled, and one fresh Opus 5.5 reader labeled those 7 with the same prompt and rubric. A script joined the labels to the keys and wrote them into each analysis config before any score line was read.

| Model | Probe | Sessions | Agree | Kappa | Bar | Result |
|---|---|---|---|---|---|---|
| Sol | L (load) | 40 | 40 | 1.00 | 0.7 | passed |
| Sol | I (complete record) | 40 | 22 | 0.10 | 0.7 | failed |
| particle-1 | L (load) | 32 | 32 | 1.00 | 0.7 | passed |
| particle-1 | I (complete record) | 40 | 28 | 0.40 | 0.7 | failed |

On Sol, 17 of the 18 probe I disagreements were sessions the probe scored incomplete and the reader scored complete: 13 before-t and 4 after-t. One after-t session went the other way. In 12 of the 13 before-t sessions the probe found no report at all. In all 12, Sol had written its DEBUG REPORT with the label "Regression tests:" in the plural. The pinned label rule reads "Regression test" followed only by spaces, markdown marks and a colon, so it found five of the six labels and failed the report item, and with it Fix and Status. The 4 after-t misses failed Fix (1) or Status (2), and 1 failed no single item.

On particle-1, all 12 disagreements were sessions the probe scored incomplete and the reader scored complete: 9 after-t and 3 before-t. In after-t, 4 failed Fix only, 4 failed the report item (and with it Fix and Status), and 1 failed the check item. In before-t, all 3 failed Fix. They were not traced session by session.

The audit sample is drawn by probe value, so these counts give the direction of the probe's error, not corrected rates. On Sol the probe misses far more before-t records than after-t ones, so B3 reads too high. On particle-1 it misses more after-t records, so the negative reads too low.

## Result

analyze's lines as printed (f1-sol-report.md and f1-p1-report.md):

    ## gpt-6.1-sol
    **B1** admission: not_admitted (before 6/10, Wilson upper 83.2%, MDD@Holm2 +19.6). Verdict: **FIX-METHOD (saturation)**, reading NOT_ADMITTED: the pilot did not admit it: a descriptive line, with no ceiling-raise attempt. Holm p 1.0000; before rate 65.0% [55.0%, 75.0%]; MDD@Holm2 there +18.6; coverage ok; audit kappa passed; exposure 100.0% of 19
    **B3** admission: admitted (before 0/10, Wilson upper 27.8%, MDD@Holm2 +12.9). Verdict: **FIX-METHOD (method)**, reading KEEP: the probe failed its audit. Holm p 0.0000; before rate 7.5% [2.5%, 13.8%]; MDD@Holm2 there +16.3; coverage ok; audit kappa failed; exposure 100.0% of 80
    Amendment E's off-u secondary (off-u minus before-u, B1's load, one-sided for a gain at 0.05, outside Holm): +23.8 points [+15.0, +33.8], one-sided p 0.0000; off-u 88.8% (80), before-u 65.0% (80).
    Gate reading (probe I complete in F1 after-t, bar 50%): 63/80 = 78.8%, met; probes.ts sha256 47d55b3ea29af9617e889132c8ea7ba3f83660aa0623f29414b7b05659af6a38. It is B3's exposure line.
    O5: +0.0 points [-5.0, +5.0], before-t 62.5%, power.txt MDD@0.05 there +19.3. Unpowered: no verdict.

    ## particle-1
    **B1** admission: admitted (before 0/10, Wilson upper 27.8%, MDD@Holm2 +12.9). Verdict: **KEEP**, reading KEEP: KEEP for the route hook and the description rewrite. Holm p 0.0009; before rate 0.0% [0.0%, 0.0%]; MDD@Holm2 there +12.3; coverage ok; audit kappa passed; exposure 100.0% of 19
    **B3** admission: not_admitted (before 6/10, Wilson upper 83.2%, MDD@Holm2 +19.6). Verdict: **FIX-METHOD (saturation)**, reading NOT_ADMITTED: the pilot did not admit it: a descriptive line, with no ceiling-raise attempt. Holm p 1.0000; before rate 42.5% [32.5%, 53.8%]; MDD@Holm2 there +21.3; coverage ok; audit kappa failed; exposure 96.3% of 80
    Gate reading (probe I complete in F1 after-t, bar 50%): 19/80 = 23.8%, not met; probes.ts sha256 47d55b3ea29af9617e889132c8ea7ba3f83660aa0623f29414b7b05659af6a38. It is B3's exposure line.
    O5: +1.3 points [-7.5, +10.0], before-t 70.0%, power.txt MDD@0.05 there +17.6. Unpowered: no verdict.

**Primaries, O5 and the off-u contrast, with the none arm.**

| Model | Endpoint | after | before (control) | Difference, points | Task 95% CI | Repository 95% CI | MDD at the control rate | none arm | Frozen reading and verdict |
|---|---|---|---|---|---|---|---|---|---|
| Sol | B1, untold load | 59 of 80 (73.8%) | 52 of 80 (65.0%) | +8.8 | -3.8 to +22.5 | -4.2 to +22.2 | 18.6 (Holm2) | 0 of 80 loads | NOT_ADMITTED; FIX-METHOD (saturation) |
| Sol | B3, told complete record | 63 of 80 (78.8%) | 6 of 80 (7.5%) | +71.3 | +60.0 to +81.3 | +60.3 to +81.8 | 16.3 (Holm2) | 0 of 80 records | KEEP; FIX-METHOD (method) |
| Sol | O5, told pass rate | 50 of 80 (62.5%) | 50 of 80 (62.5%) | +0.0 | -5.0 to +5.0 | -5.1 to +4.9 | 19.3 (alpha 0.05) | 49 of 80 (61.3%) | unpowered, no verdict |
| Sol | off-u minus before-u, untold load | off-u 71 of 80 (88.8%) | 52 of 80 (65.0%) | +23.8 | +15.0 to +33.8 | not printed | 13.5 (one-sided, at the 9.5% planning rate) | 0 of 80 loads | a gain, one-sided p below 0.0001; descriptive |
| particle-1 | B1, untold load | 12 of 80 (15.0%) | 0 of 80 (0.0%) | +15.0 | +7.5 to +22.5 | +8.0 to +22.2 | 12.3 (Holm2) | 0 of 80 loads | KEEP |
| particle-1 | B3, told complete record | 19 of 80 (23.8%) | 34 of 80 (42.5%) | -18.8 | -31.3 to -6.3 | -30.8 to -6.3 | 21.3 (Holm2) | 0 of 80 records | NOT_ADMITTED; FIX-METHOD (saturation) |
| particle-1 | O5, told pass rate | 57 of 80 (71.3%) | 56 of 80 (70.0%) | +1.3 | -7.5 to +10.0 | -7.8 to +11.2 | 17.6 (alpha 0.05) | 60 of 80 (75.0%) | unpowered, no verdict |

Every session of every arm was graded on both models: infra 0, cap stops 0, contaminated none sessions 0 after the read audit, coverage ok on every printed endpoint. The off-u contrast's frozen MDD was planned at Sol's Run D rate of 9.5%. Sol's before-u ran at 65.0%, where the same design has less power; the reading of +23.8 is also above B1's MDD@Holm2 at that rate (18.6).

**Per arm, F1 (80 sessions each).** Counts from the analysis tables.

| Arm | Sol pass | Sol untold load | Sol complete record | particle-1 pass | particle-1 untold load | particle-1 complete record |
|---|---|---|---|---|---|---|
| none | 49 (61.3%) | 0 | 0 | 60 (75.0%) | 0 | 0 |
| before-u | 50 (62.5%) | 52 (65.0%) | 0 | 59 (73.8%) | 0 | 0 |
| after-u | 49 (61.3%) | 59 (73.8%) | 40 | 59 (73.8%) | 12 (15.0%) | 5 |
| off-u | 44 (55.0%) | 71 (88.8%) | 13 | not run | | |
| before-t | 50 (62.5%) | told | 6 (7.5%) | 56 (70.0%) | told | 34 (42.5%) |
| after-t | 50 (62.5%) | told | 63 (78.8%) | 57 (71.3%) | told | 19 (23.8%) |

**Secondary lines (descriptive, no verdict).** As printed.

| Model | Line | Arm A | Arm B | Difference, points | Task 95% CI |
|---|---|---|---|---|---|
| Sol | B1 routed stratum | after-u 100.0% (19) | before-u 63.2% (19) | +36.8 | +15.8 to +57.9 |
| Sol | S1 pass | after-t 62.5% | none 61.3% | +1.3 | -2.5 to +6.3 |
| Sol | S1 pass | after-u 61.3% | none 61.3% | +0.0 | -6.3 to +6.3 |
| Sol | S3 pass | after-u 61.3% | before-u 62.5% | -1.3 | -6.3 to +3.8 |
| Sol | S5 pass | before-t 62.5% | none 61.3% | +1.3 | -5.0 to +7.5 |
| Sol | S5 pass | before-u 62.5% | none 61.3% | +1.3 | -3.8 to +6.3 |
| Sol | S6 load | after-u 73.8% | off-u 88.8% | -15.0 | -25.0 to -5.0 |
| Sol | S6 pass | after-u 61.3% | off-u 55.0% | +6.3 | +1.3 to +12.5 |
| particle-1 | B1 routed stratum | after-u 63.2% (19) | before-u 0.0% (19) | +63.2 | +42.1 to +84.2 |
| particle-1 | S1 pass | after-t 71.3% | none 75.0% | -3.8 | -10.0 to +2.5 |
| particle-1 | S1 pass | after-u 73.8% | none 75.0% | -1.3 | -7.5 to +5.0 |
| particle-1 | S3 pass | after-u 73.8% | before-u 73.8% | +0.0 | -7.5 to +7.5 |
| particle-1 | S5 pass | before-t 70.0% | none 75.0% | -5.0 | -13.8 to +3.8 |
| particle-1 | S5 pass | before-u 73.8% | none 75.0% | -1.3 | -8.8 to +6.3 |

- **S7, other untold loads.** Sol opened /verify in 77 of 80 after-u and 77 of 80 off-u sessions, /qa in 7 after-u sessions and /review in 2 after-u and 3 off-u sessions. Under the before pin it opened /verify 3 times and /review 4 times. particle-1 opened /review once and /verify once, both in after-u. No session on either model opened a skill from a task repository.
- **S10, probe I against the contract's own check** (after-t, 80). Sol: both met 63, probe only 0, contract only 16, neither 0, unrecorded 1. particle-1: both met 19, probe only 0, contract only 58, neither 0, unrecorded 3. The contract is never the score.
- **S11, hooks.** The route hook fired in 36 of 80 after-u sessions on each model by the proxy's reading, and in 19 of 19 on the routed stratum. The proxy's and the transcript's readings disagree in 28 of 512 Sol sessions and 2 of 432 particle-1 sessions. They were not traced, and this post's hook counts use the proxy's reading.
- **S13, background work at the result.** No F1 arm on either model is near the 10% rule. Sol's smoke after-u and after-t each had 1 of 3.
- **Stops inside sessions.** These sessions stay in the tables as graded, with their verifier result.

## Opus 5.5 beside Sol and particle-1

The Opus post (#247) carries Opus's lines and its R48 cycles. Side by side, the verdicts:

| Line | Opus 5.5 (#247) | GPT-6.1 Sol | particle-1 |
|---|---|---|---|
| B1, untold load | KEEP | FIX-METHOD (saturation), not admitted | KEEP |
| B3, told complete record | FIX-METHOD (method) | FIX-METHOD (method) | FIX-METHOD (saturation), not admitted; the method step fails too |
| Probe gate, bar 50% | 30.0%, not met | 78.8%, met | 23.8%, not met |
| Probe I blind audit | failed | failed | failed |
| O5, told pass rate | unpowered, no verdict | unpowered, no verdict | unpowered, no verdict |

## What B3 can and can't conclude

- **Opus 5.5.** As the Opus post says: a null (+10.0 points) with a failed probe audit and a gate reading under the bar. It can't say whether the overhaul changed told adherence.
- **GPT-6.1 Sol.** The gate is met, so Sol finishes the after pin's record most of the time when told: probe I passed 63 of 80 after-t sessions, and the blind reader agreed with 18 of the 19 after-t passes it saw. B3 can't give the size of the change or carry its KEEP reading, because the probe misses before-t reports that use a plural label, and the before-t rate of 7.5% is too low by an amount this run didn't measure. A fixed probe and a fresh blind audit on the same sessions would settle it without new paid runs.
- **particle-1.** The gate is not met, the pilot didn't admit B3, and the probe failed its audit with its misses mostly in after-t. B3 can't conclude anything about particle-1's told adherence, in either direction. The -18.8 is a descriptive line, not evidence that the after pin harms particle-1's records.

## Why null? (R48)

particle-1's B1 is a KEEP and needs no cycle. Sol's B3 reads a gain but carries FIX-METHOD, so it gets one too. None ends in CUT-CANDIDATE.

**Sol B1, untold load (null, saturation; +8.8 points, 95% CI -3.8 to +22.5).**

- **Harness and coverage.** Every session graded, no cap stop, 1 allowance stop in each of before-u and after-u. This step passes.
- **Method.** Probe L passed its blind audit (40 of 40). This step passes.
- **Exposure.** The route hook fired on all 19 routed tasks in after-u, and Sol opened /investigate on all 19.
- **Power and saturation.** This is the step that fails. The pilot's before-u 6 of 10 (Wilson upper 83.2%, MDD@Holm2 there 19.6) left B1 unadmitted under the frozen admission rule, so B1 on Sol is a descriptive line. F1's before-u then ran at 65.0% (95% CI 55.0% to 75.0%), where the MDD@Holm2 is 18.6 points, and the reading of +8.8 sits well under it.
- **Task fit.** F's bug fixes fit /investigate, and the routed stratum moved from 12 of 19 to 19 of 19.
- **Without the skill.** Sol opens /investigate untold in 65.0% of sessions with the before pin's shipped descriptions. Today's frontier model on this route already does much of what B1 measures.
- **Verdict: FIX-METHOD (saturation).** Under R61 a saturated null gets one attempt to raise the ceiling after a headroom check, before any cut. For Sol that means a B1 measure with room: tasks or prompts where the before pin's listing doesn't already draw /investigate, or the routed stratum as its own preregistered primary. The off-u contrast (+23.8) shows the after pin's untold changes do move Sol's loads, so the set Amendment E names has a supporting reading on Sol.

**Sol B3, told complete record (a gain the probe can't support; +71.3 points, 95% CI +60.0 to +81.3).**

- **Harness and coverage.** Every session graded; 3 allowance stops and 3 turn caps across before-t and after-t. This step passes.
- **Method.** This is the first step that fails. Probe I failed its blind audit (kappa 0.10, 22 of 40), and 12 of the 13 before-t misses trace to one cause, the plural "Regression tests:" label.
- **Exposure.** The contract hook recorded in 80 of 80 after-t sessions, and the gate reading is 63 of 80 (78.8%), over the 50% bar.
- **Power and saturation.** Admitted: before-t 0 of 10 in the pilot. The MDD@Holm2 at F1's 7.5% is 16.3 points, far under the reading, so power isn't the issue.
- **Task fit.** F's bug fixes fit /investigate's record.
- **Without the skill.** No none session wrote a complete record (0 of 80), and none passed 61.3% against after-t's 62.5%.
- **Verdict: FIX-METHOD (method).** The fix is in the probe: read a plural label, then rerun the blind audit on the same sessions. No new paid run is needed to read B3 again.

**particle-1 B3, told complete record (negative, descriptive; -18.8 points, 95% CI -31.3 to -6.3).**

- **Harness and coverage.** Every session graded, no allowance stop; turn caps in 7 before-t and 3 after-t sessions. This step passes.
- **Method.** Probe I failed its blind audit (kappa 0.40, 28 of 40). All 12 disagreements were records the probe missed, 9 of them in after-t, so the probe's error pushes this line down. This step fails.
- **Exposure.** The contract hook recorded in 77 of 80 after-t sessions, over the 80% bar, but blocked a stop in only 4 (Sol 58). The gate reading is 19 of 80 (23.8%), under the 50% bar. In the pilot particle-1 loaded /investigate in 0 of 32 sessions, told arms included.
- **Power and saturation.** The pilot's before-t 6 of 10 (Wilson upper 83.2%) left B3 unadmitted, and F1's before-t ran at 42.5%, where the MDD@Holm2 is 21.3 points, past the 20-point margin. This is the step analyze names first, and it prints FIX-METHOD (saturation).
- **Task fit.** F's bug fixes fit the record. particle-1 writes a DEBUG REPORT in most told sessions under either pin (54 and 62 of 80); it falls short on Fix naming an edited file (22 and 37).
- **Without the skill.** No none session wrote a complete record (0 of 80). The no-gstack arm passed 75.0%, the highest of any particle-1 arm, and after-t passed 71.3%.
- **Verdict: FIX-METHOD (saturation).** The method and power steps both fail, so the reading can't support a cut of the after pin's told changes on particle-1. The fix is the probe's Fix item (the Opus post traced the same item to writes by inline scripts) and a fresh audit, and a B3 that could carry a verdict on particle-1 needs more than 80 x 1 at a 42.5% control.

**O5, told pass rate, on Sol (+0.0 points, 95% CI -5.0 to +5.0) and particle-1 (+1.3, 95% CI -7.5 to +10.0).** The prereg gives O5 no verdict. R48's cycle, for steering:

- **Exposure.** Told after sessions had the contract hook in 80 of 80 on Sol and 77 of 80 on particle-1.
- **Task fit.** none passes 61.3% on Sol and 75.0% on particle-1, so F has room above both controls.
- **Power.** The MDDs are 19.3 and 17.6 points. At 80 x 3 the prereg's figures give 10.6 to 11.7 points at a 60% to 70% control, still above anything seen here.
- **Without the skill.** after-t minus none is +1.3 on Sol and -3.8 on particle-1 (S1), both inside intervals that cross zero.
- **R48 label: FIX-METHOD (power)** on both. No powered reading exists, so nothing here supports a cut.

**Secondary nulls and negatives.** Each is descriptive and unpowered at 80 x 1.

| Model | Line | Reading | Why null | R48 label |
|---|---|---|---|---|
| Sol | S1 after-t and after-u minus none, pass | +1.3 and +0.0 | Power: MDD near 19 points at a 61% control | FIX-METHOD (power) |
| Sol | S3 after-u minus before-u, pass | -1.3 (CI -6.3 to +3.8) | Power, as above | FIX-METHOD (power) |
| Sol | S5 before-t and before-u minus none, pass | +1.3 and +1.3 | Power, as above | FIX-METHOD (power) |
| Sol | S6 after-u minus off-u, load | -15.0 (CI -25.0 to -5.0) | Method: the arms ran in separate launches, so provider drift on the OpenRouter route enters it; and routing raised the routed stratum to 19 of 19 while the pass line moved the other way (+6.3) | FIX-METHOD (method) |
| particle-1 | S1 after-t and after-u minus none, pass | -3.8 and -1.3 | Power: MDD near 18 points at a 75% control | FIX-METHOD (power) |
| particle-1 | S3 after-u minus before-u, pass | +0.0 | Power, as above | FIX-METHOD (power) |
| particle-1 | S5 before-t and before-u minus none, pass | -5.0 and -1.3 | Power, as above | FIX-METHOD (power) |

## Run disclosures

None of these changes a primary, a cap, an arm, a draw or a scoring rule.

1. **Harbor telemetry.** Harbor jobs on the part VMs ran with Harbor's PostHog telemetry on, as every Opus L1 part did. launch.sh passes no HARBOR_TELEMETRY to the VM. The payload is counts, durations, token and cost totals, enum labels and flag names, with no task, repository or path identifiers. The local route checks set HARBOR_TELEMETRY=0.
2. **The input estimate on the OpenRouter route.** The proxy bounds each request's input from its body bytes, because OpenRouter has no token count.
3. **The vyper-4801 refusals.** In f1-sol's part f1-3, 15 requests on vyperlang__vyper-4801, one session in each of the five arms, ended with the provider's content flag for possible cybersecurity content, passed through by OpenRouter, or were the retry that followed. The watch run after every part from l1-route-sol-f on (watch-f, sha256 e2dad529) found no other such request. Sol's off-u session on the same task drew no flag.
4. **Sol's and off-u's allowance stops.** Under one token per 3 bytes, f1-sol had 5 of 400 allowance stops (before-t 2, before-u 1, after-t 1, after-u 1, none 0) and f1-sol-offu 3 of 80. Two of f1-sol's five are the vyper-4801 sessions in before-t and after-u, where the worst-case charges pushed spend toward the allowance. The pilot's 4 stops (item 2) are in the pilot rows that admission reads.
5. **particle-1's pilot loads.** In pilot-p1, particle-1 loaded /investigate in 0 of 32 sessions, told arms included (before-t 0 of 10, after-t 0 of 3, off-t 0 of 3). That is why B1 was admitted (before-u 0 of 10). F1's probe gate makes the exposure call for B3.
6. **A score seen before the read audit.** While counting exposure on f1-p1, the run's operator printed load_investigate per F1 arm (after-u 12 of 80, every other arm 0 of 80). That is B1's measure, seen before the read audit. No other score line was read early, and the read audit changed no load count.
7. **Two particle-1 none rows restored.** The run table held 2 none rows as contaminated (vyperlang__vyper-4801 and Cambridge-ICCS__TCTrack-119). The read audit overturned both, because no gstack file content came back, and audit.ts apply returned them to graded.
8. **Seven particle-1 packets labeled by a fresh reader.** Two readers stopped on the crew's cost watch with 7 packets left. One fresh Opus 5.5 reader labeled them at medium effort, where the other 18 readers ran at high effort. The 7 packets are all probe L packets, and probe L agreed on all 32.

## Limits and threats

- **One model per verdict.** Each verdict is one model's on one route. Sol and particle-1 ran through OpenRouter with one provider each and no fallback; a provider can change its serving between launches, which the off-u contrast is exposed to.
- **A fresh public draw, not a sealed set.** As in the Opus post, F's 80 tasks were public before the after pin froze, and the verdicts bind these two pins only.
- **Probe I failed its audit on all three models.** On Sol the cause is known and narrow. On particle-1 and Opus the binding item is Fix. A fixed probe needs a fresh blind audit before any B3 reading.
- **The blind audit's limits.** The packets hide labels, not everything: the after pin's skill text reads differently from the before pin's. All readers were Opus 5.5, one model family, reading Sol and particle-1 sessions. Seven packets were labeled by a reader at a lower effort than the rest (Run disclosures). The renderer's output holds transcripts and stays private.
- **Admission rests on pilot rows that held allowance stops.** Sol's pilot had 4 stops under the one-token-per-byte bound, 1 each in before-u and before-t. Admission read those rows as graded.
- **Pass rate is unpowered by design.** O5 and every pass-rate secondary have MDDs near 18 to 19 points.

## Replicate it

Reanalysis is keyless from a checkout at 5a01538a with bun install, given the trial dirs (not public: they hold transcripts). The run's own commands, as this post ran them, once per model:

    bun quick/laneb/l1/table.ts <table-config with the pilot, smoke and F1 jobs> sessions.jsonl
    bun quick/laneb/l1/audit.ts xargs <none job dirs>
    bun quick/laneb/l1/audit.ts contamination <rebuilt arms dir> <job dirs>
    bun quick/laneb/l1/audit.ts apply contamination.tsv sessions.jsonl applied.jsonl applied-without-listed.jsonl
    bun quick/laneb/l1/analyze.ts audit-sample applied.jsonl gpt-6.1-sol    (or particle-1)
    bun quick/laneb/l1/analyze.ts report applied.jsonl analysis-config.json report.json
    bun quick/laneb/l1/ceiling.ts final --ledger <each L1 ledger> --void-ledger pilot-opus.jsonl --work <f1-sol, f1-sol-offu and f1-p1 work dirs> --crew crew.json --plan ceiling-plan.json --post GEVA-353

The record leaves out the paid launches, which need the ledger, Ubicloud and an OpenRouter key; the blind renderer, the readers' sessions and the short script that joined their labels to the keys; and the crew file, which the operator writes from each thread's counter.

## What is held out, and why

Nothing is sealed. F and the pilot are public tasks, listed in the prereg and Amendment C. The trial dirs and ledgers stay in the Captain's drive because they hold transcripts. Final ledgers: l1-route-sol 1fe79e81e06d5ffc4978fd8977fbe158fae2209a0a2b67494416e905261bf1da, pilot-sol 37616b99b7e25379b4d06c55d2e1c9651f79ae82e1bb1af4065eafe4052d170a, l1-route-sol-f 30a72d2a72e860dbd5a62cdf844a601248ce206ad9544a61156f654e0ee6b86b, f1-sol 2625a8e3743cc551d30e63e2cb101fc8225904c127d22466129c78e31966fc1c, f1-sol-offu 47f711875ad2ffbe954d6dfb599ac010ad8645efb947392890e88d32238e2cd9, l1-route-p1 2cb0157cb4a88d988df89e307815e6c73a5caca48cfc94693764a5c4f3860e71, pilot-p1 11ac983e66479d794e9b15aa01b8cc022e5b997a9ed8c452616a4cff30b6ca6a, f1-p1 66c68e7d32226861adf9854edda48f2096ba1c50f19497d173fd3cb9954e4057. Analysis inputs: Sol's audited table 82da9ec61274e136892c348a4e9f4210c045d8912b590612dccd08773ca742fd, particle-1's audited table c630fafc1f1f76d923100bb292e9134b973caea9a10018c1371f28c03005f8f8, Sol's audit labels 8a41fd56bb592ff56122621ea69b5ca7d147f7c28ccf1532ea2b62488b25e971, particle-1's audit labels 511cb1b1910c81e476c94e8fb0773601d9d4f051e3d47e5dbd2a0fcf9e63450e, and the crew file at the final read f59dfc90f63a47179aab6be8ae04e8086c34bd1ab337523f052e9e77ee24ff87.

## Attribution

SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0; Lane B runs its tasks in their published images with a separate verifier, and each task repository keeps its own open-source licence. Harbor is Apache-2.0. gstack at both pins is MIT. Sol and particle-1 were reached through OpenRouter.

## Changelog

- 2026-11-08: first version.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.

<details>
<summary>Agent notes</summary>

Sol's and particle-1's paid runs cost $412.95, and L1's all-in figure at the final ceiling read was $1,637.70 of its $3,300 line.

**Models.** gpt-6.1-sol (OpenRouter's openai/gpt-6.1-sol, provider openai only, no fallback) and particle-1 (OpenRouter's particle-ai/particle-1, provider particle-ai only, no fallback), each inside Claude Code through Lane B's metering proxy, with a $5 allowance per SWE-rebench session and 100 turns.

**Order.** Section 9's leftover rule as Amendment E built it at a $3,300 line: Sol first (l1-route-sol, pilot-sol, l1-route-sol-f, f1-sol, f1-sol-offu), then particle-1 (l1-route-p1, pilot-p1, f1-p1), each launch behind a passing ceiling check.

**Stops inside sessions.** Sol hit the $5 allowance in 4 of 32 pilot sessions and 8 of 480 F1 sessions (before-u 1, after-u 1, before-t 2, after-t 1, off-u 3), and the turn cap in 4 F1 sessions (none 1, before-t 2, after-t 1). particle-1 never hit the allowance and hit the turn cap in 21 F1 sessions (none 3, before-u 5, after-u 3, before-t 7, after-t 3).

At one token per byte, pilot-sol had 4 of 32 allowance stops, all on unit8co__darts-2985, refused at $0.78 to $1.16 spent against the $5 allowance. Amendment F set Sol's bound to one token per 3 bytes for every later Sol item (the pilot's tightest request ran at 3.35 bytes per token). particle-1 stayed at one token per byte, where a 700 KB request reserves about $0.21.

A stream cut before it reports input is charged its bytes/3 worst case, so the ledger holds $11.676007 of worst-case charges for requests the provider refused, and the log can't show what the provider billed.

**Cost**

Every Sol and particle-1 item settled in full with no reserve open, read from the ledgers.

| Item | Cap | Sessions | VM and awake host | Settled |
|---|---|---|---|---|
| l1-route-sol (build 6d092bc1) | $20 | route check | | $0.150136 |
| pilot-sol (build 6d092bc1) | $100 | 32, $16.922097 (max $1.160244) | $0.603622 | $17.525719 |
| l1-route-sol-f | $20 | route check | | $0.154135 |
| f1-sol | $730 | 400, $251.753226 (max $3.920727) | VM $4.962833; host 8.70 h, $0.695978 | $257.412037 |
| f1-sol-offu | $200 | 80, $48.502599 (max $2.685722) | VM $1.664500; host 3.12 h, $0.249600 | $50.416699 |
| **Sol paid** | | | | **$325.658726** |
| l1-route-p1 | $20 | route check | | $0.060302 |
| pilot-p1 | $120 | 32, $5.087870 (max $0.438205) | VM $0.338833; host 0.72 h, $0.057933 | $5.484636 |
| f1-p1 | $920 | 400, $77.234987 (max $1.155777) | VM $3.947668; host 7.02 h, $0.561267 | $81.743922 |
| **particle-1 paid** | | | | **$87.288860** |

f1-sol per part (sessions and VM): f1-1 $60.931247 and $1.149500; f1-2 $67.925359 and $1.463333; f1-3 $70.645581 and $1.294000; f1-4 $52.251039 and $1.056000. f1-p1: f1-1 $22.366250 and $0.873167; f1-2 $20.417314 and $1.053667; f1-3 $18.273782 and $1.335167; f1-4 $16.177641 and $0.685667. f1-p1 was expected to cost $583.97 and cost about 14% of that.

**L1 all-in on actuals.** The final ceiling read, every L1 ledger passed once, the voided Opus pilot by --void-ledger, the three finished work dirs by --work, and every L1 crew thread's credits read from its counter at 2026-11-08 03:03 UTC:

    FINAL all-in $1637.70, holds $55.00, room $1607.30: the post thread GEVA-353 can have a token stop of at most 4535880849

| Part | Dollars |
|---|---|
| Opus 5.5 paid items, with the voided pilot (#247) | $353.341283 |
| Sol paid items | $325.658726 |
| particle-1 paid items | $87.288860 |
| Crew model use, 15 finished L1 threads, from their counters | $753.294289 |
| GEVA-353, the Sol and particle-1 run thread with this post's work so far, from its counter | $118.114932 |
| Captain turns booked to L1 | $0 |
| **All-in** | **$1,637.698090 of $3,300** |

Model use is priced at $1 per 1,000 Capy credits. GEVA-353's figure includes the blind audit's 19 reader sessions. This post's model use after that read lands on GEVA-353's counter, and the pull request gives it at the final head.

**Per arm, from the analysis tables** (session cost as the proxy metered it, and tokens per session).

| Cell | Per session | Per pass | Tokens per session | Ratio to none per pass |
|---|---|---|---|---|
| Sol none | $0.524 | $0.855 | 1,713,335 | 1.00 |
| Sol before-u | $0.645 | $1.032 | 2,177,256 | 1.21 |
| Sol after-u | $0.621 | $1.013 | 2,045,264 | 1.18 |
| Sol off-u | $0.606 | $1.102 | 2,076,061 | 1.29 |
| Sol before-t | $0.694 | $1.111 | 2,422,055 | 1.30 |
| Sol after-t | $0.664 | $1.062 | 2,409,651 | 1.24 |
| particle-1 none | $0.175 | $0.234 | 2,027,329 | 1.00 |
| particle-1 before-u | $0.194 | $0.263 | 2,309,300 | 1.12 |
| particle-1 after-u | $0.175 | $0.238 | 2,178,291 | 1.02 |
| particle-1 before-t | $0.225 | $0.322 | 2,790,864 | 1.38 |
| particle-1 after-t | $0.196 | $0.275 | 2,410,451 | 1.18 |

after-t's cost per pass is 1.24 times none's on Sol and 1.18 times on particle-1 (Opus: 1.27), the ratio #169's G3 named (descriptive here).

**Prices.** The build's quick/laneb/config/proxy.json (sha256 078942d9), in dollars per million tokens, as used on 2026-11-06 and 2026-11-07. gpt-6.1-sol: input 2, output 10, cache write 2.50, cache read 0.10; above 272,000 prompt tokens, input 4, output 15, cache write 5, cache read 0.20. particle-1: input 0.25, output 1, cache write 0.25, cache read 0.03. Part VMs are reserved and settled at $0.60 an hour (the Opus post compares that with Ubicloud's published rate), and awake hosts at $0.08 an hour.

</details>
