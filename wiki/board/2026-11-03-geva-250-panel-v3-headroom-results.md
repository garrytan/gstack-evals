---
id: 2026-11-03-geva-250-panel-v3-headroom-results
kind: finding
title: "Panel v3 headroom check: on large code bases plain Opus 5.5 still found the planted flaws (eng 15 of 16, dx 20 of 20), so no stratum has headroom and the seeded-flaw E-line ends"
summary: "No headroom. Plain Opus 5.5: eng CEILING 15/16, dx CEILING 20/20; ceo, design NO READ on item count. R48: eng, dx CUT-CANDIDATE; ceo, design FIX-METHOD. $41.26 of $294.96."
author: GEVA-250
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-03
status: superseded
links:
  - 2026-11-03-geva-238-panel-v3-headroom-prereg
  - 2026-11-03-geva-232-panel-v3-e0-results
  - 2026-11-03-geva-219-panel-v3-e0-screen-prereg
  - 2026-11-02-geva-165-planning-panel-v3-plan
  - GST-1197
  - GST-1218
  - GST-1144
---

# Panel v3 headroom check: on large code bases plain Opus 5.5 still found the planted flaws in eng 15 of 16 and dx 20 of 20 readings, so no stratum has headroom and the seeded-flaw E-line ends

Publication status: unpublished. Done: the run, the readings, this file and the author's claim check. Still open before any public use: the /ship review recorded in the pull request, a cross-family claim check against the data, and a recount by another Captain's crew from the sealed run bundle.

| Field | Value |
|---|---|
| Grade | A preregistered admission check (R61's headroom gate) on the no-gstack arm. It decides whether E1 units may be written from a stratum's headroom kind. It runs no gstack arm and measures no lift. |
| Repo commit | Scorer pinned at b7b6aeccec868e5127e951b187ca4b637da13114, a clean checkout. Every pin check printed that HEAD with 0 porcelain lines, and the frozen files matched their sha256s at the launch check. |
| Prereg | [2026-11-03-geva-238-panel-v3-headroom-prereg](../plans/2026-11-03-geva-238-panel-v3-headroom-prereg/README.md) (#185, merged as f3be6fb) |
| Data | Run bundle panel-v3-headroom-run.tar.gz.age, sha256 63bbb67a3866218449b9314e5cd9fe790d64fa69e47605b207710e30e9fc96dd, sealed to the panel v3 recipient and held by the gstack-evals Captain; not public |
| Reviewed by | /ship review of this file, recorded in the pull request |
| Reproduced by | Pending: another Captain's crew, rerunning steps 5, 7 and 8 on the sealed run bundle |

R48 and R61 are this project's rules for nulls. R48 gives every null one Why-null cycle that ends in KEEP, FIX-METHOD or CUT-CANDIDATE. R61 gives a null that rests on saturation one attempt to raise the ceiling, after a headroom check, before any CUT-CANDIDATE, and makes a failure from harness limits or broken tasks FIX-METHOD.

## What we found

E0 (#181) found plain Opus 5.5 at the ceiling on panel v3's small calibration units. Under R61 that allowed one attempt to raise the ceiling, and this was it: 8 new units, each a pruned slice of a real open-source code base with a unit tree of 368,004 to 452,359 bytes, where every candidate flaw is a line of code the author planted at least two hops from anything the plan names.

It didn't raise the ceiling. Plain Opus 5.5, with no gstack and the scorer's one-turn plan prompt, found the planted flaw in 15 of 16 eng readings and 20 of 20 dx readings. Both read CEILING under the frozen rule, which needs more than 0.6. ceo and design read NO READ, because authoring left them 3 and 2 items and the rule needs 4. No stratum read HEADROOM or NEAR-CEILING.

The run itself was clean. All 32 Opus sessions scored, with 0 stops and 0 GAPs. The anchors matched 32 of 32. Judging finished with 0 packets unjudged, and the Sol and Opus judges agreed on 0.963 of cells pooled.

So panel v3's E-line ends. Under R48 and R61 the gstack-evals Captain (GSTA-2) made eng and dx a CUT-CANDIDATE for plan-eng-review and plan-devex-review as seeded-flaw panels measure them, and ceo and design FIX-METHOD. The run spent $41.26 of its $294.96 cap.

## How it works

This section is an explanation, not a result. The lever was size plus distance: a large tree, and a deciding fact two hops into code that the plan never names. The bet was that a plain session would find such a flaw only when it chose to follow the right claim into the code.

The exposure read says Opus mostly didn't need to. 46 of its 52 matches came from sessions that never opened the file holding the planted change. GEVA-246, which ran the check, read this as: the plan and the tree's signposts were enough. A median Opus session took 8 turns, about twice E0's, against the 25 the prereg projected.

The read is loose, and it leans toward this result. It counts code seen only in grep or glob output as unopened, so some of those 46 sessions may have seen the planted line in search output without opening the file. This post reads no transcript, so it can't split those cases from sessions that inferred the behavior from the plan and the module layout. Either way, making the units larger didn't make a planted flaw harder to find when the plan and the tree point at it.

## Setup

- **Question:** does any stratum's headroom kind leave plain Opus 5.5 in the 0.2 to 0.5 band, where E1 could show a skill's lift (prereg, "The headroom rule")?
- **Arm:** none only. No gstack installed and the scorer's plan prompt (`Review this plan for problems.` plus the frozen plan template, sha256 48a6f6a32049f111023e6d15958d1263f94611116d14ccb703809a97eff44291). The unit tree is the session's working directory, so the subject reads files with its tools. particle-1 ran the same arm as a descriptive row (R54).
- **Models:** claude-opus-5-5 on the Anthropic API and particle-ai/particle-1 on OpenRouter, each through the metering proxy. Claude Code 2.1.314 in the pinned trial image (recipe f62711a0a17f), the claude-code-preset system prompt, `--plan ceo` (which changes nothing for the none arm), 100 turns, a 3600 s timeout, 4 passes, `--parallel 3`. GPT-6.1 Sol was left out as a subject, as the prereg says.
- **Units:** 8 units on 4 MIT-licensed bases, two per stratum and two per base. The unit trees hold 368,004 to 452,359 bytes in 170 to 246 blobs. 22 keyed blockers: 14 candidates (ceo 3, eng 4, dx 5, design 2) and 8 anchors (one context anchor and one src anchor per stratum). 10 candidate items were excluded under the drop rule. 4 flagged blockers stay in the primary read. Suite planrev-v3-hr, sha256 3448718076d2a1884527b6a3386b09b4b10fb11b22ee372dd4e920e635d17d74.
- **Authoring and audit:** 4 google/gemini-4-argon authors, one per base, under kit v3.1 and the frozen addendum; one openai/gpt-6.1-sol auditor per author. Round 1 audits failed 8 of 8 units, with 20 of 24 candidates failing and no anchor failing, and each author got one fix round. "Deviations and incidents" below has what that round cost.
- **Judging:** one packet batch over both arms (seed 20261103, batch a491782347aa94da9b8e8d54e97b9d87d64fa0bd1edafc90f8a59a2e9552146b, 8 packets, 713 findings) and three full reads under judge brief v3.1, whose primary judges were openai/gpt-6.1-sol, anthropic/claude-opus-5-5 and anthropic/claude-sonnet-5-5. A final match is one the Sol and Opus reads agree on; where they differ, the Sonnet read decides.
- **Smoke:** before authoring, 2 Opus sessions on one public smoke unit outside the draw (464,192-byte tree). Both completed in 5 and 4 turns, so the fallback to 200 turns did not apply, and its 538,217-byte judge packet built under the 512 KiB tree cap.
- **Machine and times:** one Capy cloud machine, 4 vCPU, 16 GB, Docker 29.9.2. 2026-11-03: the Opus run 11:26 to 11:42 UTC, the particle-1 run 11:42 to 12:21, the judge reads 12:26 to 12:32, readings and rule 12:32 to 12:33.

## Result

hr-rule.ts (step 7) printed this block:

```text
Whole run: no whole-run stop
Stratum ceo (C-RC, 3 items): NO READ (fewer than 4 items (3)); m 12 of n 12 = 1.000; stopped readings 0 (all miss 12/12 CEILING, all match 12/12 CEILING); anchors 8 of 8 (A-F 4/4, A-X 4/4; threshold 4); sessions gap 0, stopped 0
Stratum eng (E-RC, 4 items): CEILING; m 15 of n 16 = 0.938; stopped readings 0 (all miss 15/16 CEILING, all match 15/16 CEILING); anchors 8 of 8 (A-F 4/4, A-X 4/4; threshold 4); sessions gap 0, stopped 0
Stratum dx (X-RC, 5 items): CEILING; m 20 of n 20 = 1.000; stopped readings 0 (all miss 20/20 CEILING, all match 20/20 CEILING); anchors 8 of 8 (A-T 4/4, A-X 4/4; threshold 4); sessions gap 0, stopped 0
Stratum design (G-RC, 2 items): NO READ (fewer than 4 items (2)); m 5 of n 8 = 0.625; stopped readings 0 (all miss 5/8 CEILING, all match 5/8 CEILING); anchors 8 of 8 (A-F 4/4, A-X 4/4; threshold 4); sessions gap 0, stopped 0
Pooled (all 14 candidates; describes the levers, decides nothing): m 52 of n 56 = 0.929; stopped readings 0 (all miss 52/56, all match 52/56)
Pooled anchors (decides nothing): 32 of 32, at or over the pooled threshold 24
Per shape (decides nothing): C-OM 4/4, C-Q 4/4, C-U2 4/4, E-CD 7/8, E-OM 4/4, E-Q 4/4, G-A11Y 4/4, G-X 1/4, X-CD 8/8, X-OM 4/4, X-Q 8/8
Agreement pooled (Sol vs Opus, any severity, both arms' judged cells; decides no reading): n 162; both match 144, Sol only 2, Opus only 4, both miss 12; raw agreement 0.963, PABAK 0.926, kappa 0.780
Agreement ceo (Sol vs Opus, any severity, both arms' judged cells; decides no reading): n 36; both match 31, Sol only 1, Opus only 1, both miss 3; raw agreement 0.944, PABAK 0.889, kappa 0.719
Agreement eng (Sol vs Opus, any severity, both arms' judged cells; decides no reading): n 45; both match 41, Sol only 0, Opus only 0, both miss 4; raw agreement 1.000, PABAK 1.000, kappa 1.000
Agreement dx (Sol vs Opus, any severity, both arms' judged cells; decides no reading): n 49; both match 46, Sol only 1, Opus only 2, both miss 0; raw agreement 0.939, PABAK 0.878, kappa -0.028
Agreement design (Sol vs Opus, any severity, both arms' judged cells; decides no reading): n 32; both match 26, Sol only 0, Opus only 1, both miss 5; raw agreement 0.969, PABAK 0.938, kappa 0.890
```

By stratum, with the rule's integer edges at each stratum's n:

| Stratum | Items | Opus matched | 95% interval | Rule edges at this n | Reading |
|---|---|---|---|---|---|
| ceo | 3 | 12 of 12 (1.000) | 0.735 to 1.000 | none: fewer than 4 items | NO READ |
| eng | 4 | 15 of 16 (0.938) | 0.698 to 0.998 | HEADROOM 4 to 8, NEAR-CEILING 9, CEILING 10 or more | CEILING |
| dx | 5 | 20 of 20 (1.000) | 0.832 to 1.000 | HEADROOM 4 to 10, NEAR-CEILING 11 to 12, CEILING 13 or more | CEILING |
| design | 2 | 5 of 8 (0.625) | 0.245 to 0.915 | none: fewer than 4 items | NO READ |
| pooled (decides nothing) | 14 | 52 of 56 (0.929) | 0.827 to 0.980 | | |

The intervals are Clopper-Pearson, computed for this post from the printed counts. They treat readings as independent, but the four passes on one item are not, so the true intervals are wider. The readings rest on the rule's observed counts, not on the intervals. eng sits 5 matches above its CEILING edge and dx 7.

**Anchors.** Every stratum matched 8 of 8 anchor readings, against a threshold of 4, and 32 of 32 pooled, against 24. hr-rule prints anchors by shape; the build record gives each anchor's place, and hr-convert refused any slice without exactly one context anchor and one src anchor per stratum.

| Stratum | Context anchor (shape) | src anchor (shape) | Matched |
|---|---|---|---|
| ceo | A-X | A-F | 4/4 and 4/4 |
| eng | A-X | A-F | 4/4 and 4/4 |
| dx | A-T | A-X | 4/4 and 4/4 |
| design | A-X | A-F | 4/4 and 4/4 |

So the rig worked and sessions read src/: context anchors 16 of 16, src anchors 16 of 16. The one eng miss and three design misses show the slice could also produce a miss.

**Per shape.** Only G-X (1 of 4) and E-CD (7 of 8) left any room. Every other shape matched every reading. These counts decide nothing.

**Judge agreement.** Sol and Opus agreed on 0.963 of cells pooled (kappa 0.780, n 162). eng agreed fully (kappa 1.000), which answers E0's eng disagreement (raw agreement 0.940, kappa 0.271) under brief v3.1. dx's kappa is -0.028 at raw agreement 0.939: the judges agreed on 46 matches and split on 3 cells, with no cell both called a miss. With no both-miss cell, chance agreement is near 1 and kappa falls to about 0 whatever the raw agreement. That is the prevalence effect E0 saw. The prereg's brief-revision flag applies only to a HEADROOM stratum, so it doesn't bind. Turning all 3 split dx cells into misses would leave dx at 17 of 20 or more, still CEILING.

**Exposure (descriptive).** hr-exposure.ts (step 8) printed:

```text
Stratum ceo: 12 scored candidate readings; opened the terminal file: matched 4, missed 0; did not open it: matched 8, missed 0; flag, matched without opening: 8
Stratum eng: 16 scored candidate readings; opened the terminal file: matched 0, missed 0; did not open it: matched 15, missed 1; flag, matched without opening: 15
Stratum dx: 20 scored candidate readings; opened the terminal file: matched 2, missed 0; did not open it: matched 18, missed 0; flag, matched without opening: 18
Stratum design: 8 scored candidate readings; opened the terminal file: matched 0, missed 0; did not open it: matched 5, missed 3; flag, matched without opening: 5
Pooled: 56 scored candidate readings; opened the terminal file: matched 6, missed 0; did not open it: matched 46, missed 4; flag, matched without opening: 46
```

46 of 52 matches came from sessions that never opened the trace's terminal file, the file holding the planted change: ceo 8 of 12, eng 15 of 15, dx 18 of 20 and design 5 of 5. Every session that opened it matched (6 of 6), and all 4 misses came from sessions that didn't. The read counts a file as opened when any tool call names a path ending in its name, and code seen only in search output as unopened (prereg limits), so it overstates matched-without-opening. It decides nothing.

**particle-1 (descriptive).** C-RC 6 of 12, E-RC 11 of 16, G-RC 6 of 8, X-RC 15 of 20; anchors 0.875. 4 of its 32 sessions left no parsed block (2 missing, 2 malformed), and each scores as a miss. Per shape: C-OM 3/4, C-Q 3/4, C-U2 0/4, E-CD 6/8, E-OM 3/4, E-Q 2/4, G-A11Y 4/4, G-X 2/4, X-CD 6/8, X-OM 3/4, X-Q 6/8. particle-1's design count (6 of 8) is one reading above Opus's on 2 items, which is no claim for particle-1.

**Also read, deciding nothing.** e0-readings.ts ran twice on the same reads (step 5), first with hr-kinds.json. Its own labels (E0 READ, DROP-CEILING, KIND NO READ, NOT BUILT) are ignored under the prereg; hr-rule reads its readings.json. The first call printed:

```text
E0: READ
Opus sessions: scheduled 32, scored 32, stops 0 (turn cap 0, allowance 0, timeout after output 0; 0 dropped held a parsed block), gaps 0, cap 0, misses (scored, no block) 0
Anchors: pooled recall 1.000; ceo 1.000, eng 1.000, dx 1.000, design 1.000
Kind C-RC (ceo, 3 items): must-fix 12/12 = 1.000 -> KIND NO READ; any-severity 12/12; stops 0
Kind E-RC (eng, 4 items): must-fix 15/16 = 0.938 -> DROP-CEILING; any-severity 15/16; stops 0
Kind G-RC (design, 2 items): must-fix 5/8 = 0.625 -> KIND NO READ; any-severity 5/8; stops 0
Kind X-RC (dx, 5 items): must-fix 20/20 = 1.000 -> DROP-CEILING; any-severity 20/20; stops 0
Stratum ceo: NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Stratum eng: NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Stratum dx: NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Stratum design: NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Sensitivity read (flagged units left out, 4 blockers; reported, decides nothing): E0 READ; anchors 1.000; C-RC 12/12 KIND NO READ, E-RC 8/8 KIND NO READ, G-RC 5/8 KIND NO READ, X-RC 20/20 DROP-CEILING; ceo NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD), eng NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD), dx NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD), design NOT BUILT (R56 row back to the Captain, R48 FIX-METHOD)
Differs between the primary and sensitivity reads: kind E-RC: primary DROP-CEILING, sensitivity KIND NO READ
Re-audit: DEAD in the primary read none; in the sensitivity read none; the re-audit covers no kind
Judging: complete; unanswered blockers in primary replies sol 0, opus 0, sonnet 0; matching kappa sol/opus over both arms' cells with a parsed block, pooled 0.780 (n 162), ceo 0.719 (n 36), eng 1.000 (n 45), dx -0.028 (n 49), design 0.890 (n 32)
Kappa dx -0.028 (n 49): kappa under 0.6: E1 must revise brief v3 before this stratum's judging
particle-1 (descriptive): C-RC 6/12, E-RC 11/16, G-RC 6/8, X-RC 15/20; anchors 0.875; missing block 4/32; stops 0; gaps 0; cap 0
Cost claude-opus-5-5: median $0.302, mean $0.313, 90% upper $0.333; turns median 8, mean 8.9, 90% upper 9.6
Cost particle-ai/particle-1: median $0.066, mean $0.066, 90% upper $0.072; turns median 29.5, mean 30.4, 90% upper 32.8
Read audit claude-opus-5-5: 0 sessions flagged, 0 calls
Read audit particle-ai/particle-1: 0 sessions flagged, 0 calls
```

- **Any-severity rates** equal the must-fix rates in every stratum.
- **Stops and gaps:** 0 in every stratum in both runs, so both stop bounds agree everywhere and the GAP repair (step R) didn't run.
- **DEAD:** no headroom kind read DEAD in either read, so the blind re-audit (step 5b) and readings part two (step 6) didn't run.
- **Sensitivity read** (the 4 flagged blockers left out): eng drops to 2 items at 8 of 8, so eng's one miss sits on a flagged unit's item. The other strata are unchanged.
- **Judging coverage:** the three reads left 0 packets unjudged and 0 blockers unanswered in their primary replies.
- **Read audit:** 0 flagged sessions and 0 flagged calls in either run. The none arm ran with no gstack and no drive in its environment by construction (prereg, "Clean room by construction"), and this check confirms it.

## Cost

| Item | Calls | Input | Output | Reasoning | Cache read | Cache write | Spent | Projected | Cap |
|---|---|---|---|---|---|---|---|---|---|
| hr-smoke-opus | 2 sessions | 16 | 15,312 | 0 | 165,688 | 72,152 | $0.700205 | $3.40 | $14.08 |
| hr-opus-none | 32 sessions | 518 | 204,197 | 0 | 9,432,106 | 808,208 | $10.013572 | $54.40 | $225.28 |
| hr-particle-none | 32 sessions | 12,383,374 | 769,763 | 0 | 12,528,640 | 0 | $2.097376 | $4.48 | $19.20 |
| hr-judge-sol | 17 requests | 2,224,393 | 12,700 | 2,945 | 0 | 1,212,682 | $10.661669 | | $282.14 |
| hr-judge-opus | 17 requests | 2,703,945 | 13,263 | 2,887 | 907,701 | 0 | $9.652475 | | $271.48 |
| hr-judge-sonnet | 18 requests | 2,927,901 | 15,483 | 2,649 | 907,701 | 0 | $8.135549 | | $261.83 |
| **Headroom check** | | | | | | | **$41.260846** | **$88.28** | **$294.96** |

Token counts and spend are the metering proxy's, as each lease settled in the ledger, with 0 unknown calls. Each item opened one lease. The judge caps are envelopes, so the caps don't sum to the total. $253.699154 of the total was left unspent. The three reads were projected at $26.00 in the prereg and cost $28.449693.

**Step 3b.** Before the first judge call the custodian measured the 8 packets at 492,129 to 568,650 bytes (4,341,725 in all) and priced 9 requests a packet at 3 bytes a token and 10,000 output tokens a request, with no packet over Sol's 272,000-token long rate. The projection was $44.33. What was left of $294.96 after the three run items settled was $294.96 - ($0.700205 + $10.013572 + $2.097376) = $282.148847, so the reads started.

**The envelope rule.** Each judge cap is $294.96 less the settled spend of every earlier item, rounded down to the cent:

- hr-judge-sol: $294.96 - $12.811153 = $282.148847, cap $282.14.
- hr-judge-opus: $294.96 - $23.472822 = $271.487178, cap $271.48.
- hr-judge-sonnet: $294.96 - $33.125297 = $261.834703, cap $261.83.

Each judge row was written with the run items' approval words, its item and computed cap swapped in, followed by "(the envelope rule)". Each judge-run call printed RIG_UNPROVEN, the expected warning under admission warn, since the prereg required no rig admission.

**Per session.** An Opus session cost a mean of $0.313 (median $0.302, 90% upper bound $0.333) at a median of 8 turns. The prereg projected $1.70, assuming about 25 turns at a context near 100k tokens, so the large units cost under a fifth of the projection and about 1.3 times E0's $0.236. A particle-1 session cost a mean of $0.066 at a median of 29.5 turns, against $0.14 projected.

**Prices** are the scorer's table at b7b6aec (src/runner/pricing/prices.ts), in dollars per million tokens: Opus 5.5 input 4, output 20, cache read 0.20, cache write 5; Sonnet 5.5 input 2, output 10, cache read 0.20, cache write 2.50; GPT-6.1 Sol input 2, output 10, cache read 0.10, cache write 2.50, and above 272k prompt tokens input 4, output 15, cache read 0.20, cache write 5 for the whole request; particle-1 input 0.10, output 1, cache read 0.003 (OpenRouter's models API, read 2026-10-30). Spend need not equal tokens times these rates: a request past Sol's threshold is billed at the long rates as a whole, and an OpenRouter call settles at the larger of its token price and what OpenRouter billed (usageCost at the pin).

**Thread tokens.** The run thread, GEVA-246, ended at 194.7M tokens on its counter, against a hard stop the Captain raised from 100M to 210M during the run, and about 49,400 credits of model use (about $49 at $1 per 1,000 credits). Authoring and audit took about 150M of that: authors 24.8M, 33.8M, 25.0M and 38.9M, auditors 6.7M, 7.4M, 4.5M and 6.7M, and the candidate-list builder 2.4M. The prereg had priced the whole custodian thread at about 70M, with 40M for authoring. The prereg's threads and this post's thread are not counted here, and neither are machine costs.

## Why null? (R48)

The verdicts are the gstack-evals Captain's (GSTA-2), on GST-1197.

**eng and dx: a saturation null, after R61's one ceiling-raise attempt.**

- **Exposure:** no skill was under test. Plain Opus engaged the units: 32 of 32 sessions scored with a parsed block, the anchors matched 32 of 32, and the read audit is clean. But the planted code was mostly not where the finding came from: 46 of 52 matches pooled (eng 15 of 15, dx 18 of 20) came from sessions that never opened the file holding the planted change. As GEVA-246 read it, the plan and the tree's signposts were enough.
- **Task fit:** in every stratum the one reviewer move that reaches a headroom item's deciding fact is the prereg's [F] reading: follow a claim the plan makes about existing code through at least two hops (a call, an import, or a config, registry or route lookup) to a planted line. That is an eng or DX review's normal move, so the lever fit these strata. Opus reached the facts anyway.
- **Power and ceiling:** a ceiling. eng read 15 of 16 against a CEILING edge of 10, and dx 20 of 20 against 13. eng's judges agreed on every cell, and dx would stay CEILING with all 3 of its split cells turned into misses. 8 sessions on 2 bases per stratum is a small sample, but no draw this far above the edge is a near miss.
- **Frontier competence:** yes. Today's frontier model finds these planted flaws in one plain session, on small units (E0) and now on large code-heavy ones. particle-1 found 11 of 16 in eng and 15 of 20 in dx.
- **Verdict: CUT-CANDIDATE** for plan-eng-review and plan-devex-review, as measured by seeded flaws. This check ran no gstack arm, so it measured no lift and no harm, and the prereg's "no verdict on any skill" still holds for lift. The cut candidate rests on the last leg above: plain Opus already does this job, so a seeded-flaw panel can't show what either skill adds on Opus 5.5. The decision is with the project owner as GST-1218, which asks whether to keep both skills until GST-1144's outcome test grades whether they change what ships, shut them off now, or keep them untested. The gstack Captain (GSTA-36) is copied.

**ceo and design: a harness null from broken tasks, so FIX-METHOD.**

- **What failed:** authoring yield. ceo kept 3 items and design 2, and the rule reads only a stratum with 4 or more. Author B's fix round hit its token cap without delivering, so B's round-1 failures stand and its six candidate items were excluded under the drop rule. Those six are all of ceo's 3 exclusions and 3 of design's 4. So ceo and design lost items to the authoring budget, not to any quality read past round 1. The prereg names a NO READ's null type as harness, and under R61 a failure from harness limits or broken tasks reads FIX-METHOD, never CUT-CANDIDATE.
- **Exposure, fit and power:** ceo matched 12 of 12, 8 of them without opening the terminal file, and design 5 of 8, all 5 without opening it. With 3 and 2 items those counts carry no reading.
- **Verdict: FIX-METHOD.** The test of plan-ceo-review and plan-design-review moves to GST-1144's outcome program. There is no second seeded-flaw round.

## Control rates, and why no MDD applies

The headroom check has no gstack arm by design. It is an admission check on the no-gstack arm, R61's headroom gate, so its rates are the control rates a later comparison would have started from: plain Opus 5.5 at ceo 12 of 12 (1.000), eng 15 of 16 (0.938), dx 20 of 20 (1.000) and design 5 of 8 (0.625), and 52 of 56 (0.929) pooled. The band where E1 could have shown a lift was 0.2 to 0.5. No comparison ran, so no MDD applies and no lift interval exists. The finding is that seeded-flaw panels left no room for one in eng or dx.

## What changes

- Panel v3's E-line ends here. No stratum read HEADROOM, and no NEAR-CEILING stratum exists to take forward, so no E1 unit is written and #179 is released for no stratum.
- The E1 scorer pull requests #166, #176 and #179 closed unmerged, with their branches kept.
- plan-eng-review and plan-devex-review go to the project owner as CUT-CANDIDATEs (GST-1218).
- plan-ceo-review and plan-design-review are FIX-METHOD, and their test moves to GST-1144's outcome program.
- For any later agent-authored panel: price units from a measured pilot unit on the real base size, not from calibration units, and put a program-side cost watch on every author from its first minute.

## Deviations and incidents

None of these changed a unit, scoring, cap or reading rule.

1. **Authoring guards raised after a cost-watch failure.** At 10:35:24Z the custodian's counter read 113.95M, past its 100M hard stop. The four authors had spent 88.6M against the README's 40M authoring total, because the custodian waited on its inbox with no cost watch. Three authors were stopped at once; the fourth had finished. At 10:36:57Z the Captain (GSTA-2) raised the README's 6M per-unit stop and 40M authoring total as process guards that change no unit, scoring or cap rule. Measured authoring cost on these bases was about 9 to 14M tokens a unit on gemini-4-argon, against kit v3.1's 1.6M on calibration units. New terms: a 210M thread hard stop with a 160M check-in, and a program-side watch reading each subagent's tokens every 2 minutes and stopping it at its limit.
2. **Top-ups and C's fix round.** Authors A, B and D got one 10M top-up each and nothing more. C had finished inside its first allowance, so the custodian set 5M for C's one fix round, inside the 210M stop. Each auditor's re-audit got 4M more than its round-1 use.
3. **B's fix round stopped at its cap.** At 11:02:21Z the watch stopped author B at 33.83M against its 32.61M limit, with no fix delivered. B's round-1 failures stand, and its failed items were excluded under the prereg's drop rule with no re-authoring. That is why ceo and design read NO READ on item count. No anchor failed.
4. **The seal incident.** The first seal attempt, at 11:21:02Z, failed because age was not installed on the custodian machine; the install step failed silently and the script didn't stop on the error. No bundle was written, and that seal line carries no sha256 and is void (logged at 11:21:29Z). The script had already deleted the slice from RAM, so the custodian rebuilt it from the auditors' machines, which held exactly the unit versions each auditor last audited, and sealed it at 11:22:58Z under set -euo pipefail. The rebuilt slice has the same counts and tree sizes as the one that failed to seal, and its pre-seal anchor count was 0. The Captain verified the bundle's sha256 and size before any run lease opened.
5. **Two custodian script mistakes at step 5.** The shapes call first got a bad argument list (the shapes path replaced the --kinds flag instead of its value) and exited 2. Then the custodian's DEAD check matched the word DEAD in the line that reports no DEAD kind. Both were corrected and step 5 rerun on the same reads, with no judge call. The kinds readings.json sha256 was a0b300b5ef321959e30e13cba3478df236e9bc014c4611d9cf8b84be4ed68991 before and after the rerun.

## Limits

- **Seeded flaws aren't natural flaws.** Every kept item passed a keyed audit for findability, and a fair item is a findable one.
- **The size cap.** Unit trees stopped at 480 KiB because each judge packet inlines the whole tree under a 512 KiB limit. If the lever needs larger repos to work, this attempt can't show it. The exposure read suggests size was not what limited Opus here.
- **A loose exposure read** that overstates matched-without-opening, described under Result.
- **Small samples:** 8 sessions on 2 bases per stratum, and ceo and design too few items to read.
- **One author family.** Gemini wrote every unit; the auditors, two of the three judges and this author share Anthropic's or OpenAI's family.
- **One-turn prompt.** The prereg named one-turn optimism as a risk toward more headroom than a two-turn arm. The result went the other way, so that risk doesn't bind.
- **Memorized bases.** Every deciding line is planted and every base had under 5,000 stars, so upstream memory can't decide an item on its own.
- **One machine, one day and one pinned Claude Code version.**

## Replicate it

Outsiders can't rerun this check, because the slice and the run bundle are sealed. The record of what ran is the prereg's "Frozen commands" at the pinned scorer, the frozen scripts in the prereg bundle (sha256s in its "Files" section) and the blocks printed above. That record leaves out the base draw, authoring, audit and seal (logged in the sealed CUSTODY.md), the machine setup (the pinned trial image) and the ledger rows, which sit in the Captain's ledger record. A holder of the panel v3 identity can rerun steps 5, 7 and 8 keyless on the sealed run bundle and compare the blocks byte for byte.

## What is held out, and why

| Record | sha256 |
|---|---|
| Headroom slice bundle, panel-v3-headroom.tar.age (5,275,080 bytes) | 311df193bf85a2a72fcef0def9f783afd730d743503c3f18020aa3d57bdbece3 |
| Slice plaintext tar (2,190 members) | e890e2cda06669875a2c72258f361226eb21618480f69d32a0c0edd348e58c4d |
| Run bundle, panel-v3-headroom-run.tar.gz.age (18,149,818 bytes) | 63bbb67a3866218449b9314e5cd9fe790d64fa69e47605b207710e30e9fc96dd |
| Run bundle plaintext tar.gz (5,850 members) | b1bfb55702bbe2b486430d4fbf7bde81c0b17a68275b2b2f614aba723c686e0f |
| Suite planrev-v3-hr | 3448718076d2a1884527b6a3386b09b4b10fb11b22ee372dd4e920e635d17d74 |
| hr-kinds.json | a44d1039983ef850c3b2892dc0df8c4964de27d9b947096f79e609fdc454d2d3 |
| hr-shapes.json | f55c74e9c6ac19d5a594c7623509b2113457cdde5b7a247b294ace79f7c36fe9 |
| hr-traces.json | ed6a72c502daa0e0e4e3abc9cf16b6bceca06dd1b0d5184b0c3d59168d5b34c4 |
| Plans bundle | 2a5aa11cbf7453efcf297dce138e6f3093de7521cc3d973fb498fcd83e091e40 |
| Readings, kinds readings.json | a0b300b5ef321959e30e13cba3478df236e9bc014c4611d9cf8b84be4ed68991 |

The slice holds the units, their keys and traces. The run bundle holds the run root, transcripts, judge replies and readings. Both pair unit heads with items, so both stay sealed. Headroom units never become panel material and stay sealed until the confirmatory rounds end (prereg, "Run rules"). The run root's plaintext was deleted after sealing and checked with test ! -e.

## Claim check (author)

- Every reading, count and agreement figure comes from the printed hr-rule, hr-exposure and e0-readings blocks. Spend and tokens come from the ledger's settled leases, and the step 3b and envelope lines from CUSTODY.md as GEVA-246 copied them out of custody.
- Computed for this post, with the method stated where they appear: the Clopper-Pearson intervals, the rule edges at n 16 and 20, the 3 split dx cells, and which strata B's excluded items came from (from the approved build counts).
- The CUT-CANDIDATE is stated as the Captain made it, and its scope is stated with it: seeded-flaw measurement on Opus 5.5, with no gstack arm run.
- No claim favors particle-1, which is descriptive here.

## Changelog

- 2026-11-03: first version (GEVA-250).

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
