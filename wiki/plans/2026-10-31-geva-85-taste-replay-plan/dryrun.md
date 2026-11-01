# GEVA-85 dry run: taste-replay frozen scoring rules (synthetic, keyless)

Scorer: gstack-evals main ad594d4, src/runner/stats (evaluateFamily, clusteredPairedDelta, toObservation), unmodified. Rebuild: `bash run.sh` in $D (the dry-run folder); it clones the repo at ad594d4 and rewrites out/ and this file. Everything is synthetic. Full output: $D/out/results.txt; lines below keep its numbers and key the reasons: [min] "the point estimate X is below the minimum effect of 0.03, so p_superiority is 1 (the sign-flip p is in stats); this is not evidence of a loss", [lose] "the whole 95% interval is on the losing side of zero", [nv] "every paired difference is zero, so the bootstrap cannot bound the difference and no p-value exists; this is not evidence of equivalence", [cl] "8 clusters is below the family minimum of 10", [skip] "another comparison in the family is blocked". n=pairs/clusters, ex=excluded.

Data (gen.ts, seed 85): 400 items (D 190, N 135, H 40, S 35), 85 captain-date clusters, 48 one-way, 168 derived, k 2 to 4, all D and 114 N with a default. Probit model: shared item (SD 0.8) and cluster (0.4) effects, per-cell item (0.5) and cluster (0.2) effects. One row per item per cell; A rows carry the reference arm under the pair metric (ba_GR_NR, cost_GR_NR, ba_NR_NN, cost_NR_AR, ba_GN_NN), B rows the candidate.

## Summary

| Rule | Result | What the plan must state |
|---|---|---|
| R1 primary | PASS | Claims read each comparison's status, never the family verdict: a clear win makes its mirror "fail" and the verdict "fail" (R2, R3, R6). Metric names carry no dots (rows.ts reads them as paths). |
| R2 secondary | PASS | As R1. |
| R3 bounds | PASS | Nothing; AR BA is exactly 0.5. |
| R4 cost | CHANGE | The grid re-prices the same actions. Oracle per cell is the cheapest action (H at hold 2: send_back, 1.5). Define decide-all (here NR's picks). Report hold-all beside P6: AR 1.37 costs more than hold-all 1.00. |
| R5 no truth option | PASS, wording | BA field absent or null on every H and S row of every cell; never 0 (dilutes BA by 325/400), never exclude_when (family-wide, drops H and S from cost). No error or error_origin field on rows: write a malformed pass as its scored values, or the family blocks (R5e). |
| R6 BROKEN | PASS | Nothing. |
| R7 8 clusters | PASS | Nothing; P6 at Holm p 0.031 stays inconclusive. |
| R8 identical arms | PASS | Nothing. |
| R9 particle-1 missing | CHANGE | The secondary family blocks whole when any particle-1 cell is short (12 items suffice); say what is reported then. Primary is byte-identical. |
| R10 calibration | CHANGE | Hold gap within D and within N, averaged, with a cluster-bootstrap interval (pooled mixes strata: Opus NR +0.55 vs +0.40 balanced); "near zero" means the interval covers 0 (a door-only holder reached +0.11). Say how malformed passes enter AURC and ECE (here confidence 0, wrong). The cite check reads answered_at from the record store. |
| R11 verbatim-only | CHANGE | Recompute weights in the subset (+0.0127; round weights give +0.0145); "same sign" is the point estimate's. Same for Fable and default-hidden. Fable sample: name the draw when N+H+S exceeds 100 (here 100 at random, then 50 D). |
| R12 power | CHANGE | At BA diff 0.08, P1 power is 59.5% at 60 N items, 80.0% at 100, 86.5% at 135. The 60-item floor fails the plan's own 80% rule: raise it to about 100 (135 for margin) or let the power check decide, rerun at labelled counts. |

## Commands and lines

R1 to R11: `cd $D && bun gen.ts && bun score.ts` (out/results.txt; `bun report.ts print` compacts it).

R1 primary, Opus (BA: AR 0.5000, NN 0.4970, NR 0.5916, GN 0.5129, GR 0.6215):
    family verdict=inconclusive
    P1 inconclusive p_holm=1.0000 delta=+0.0299 ci95=[-0.0122, +0.0751] n=325/82cl ex=75 [min]
    P2 inconclusive p_holm=1.0000 delta=+0.0299 ci95=[-0.0122, +0.0751] n=325/82cl ex=75 [min]
    P3 inconclusive p_holm=1.0000 delta=-0.0088 ci95=[-0.0849, +0.0656] n=400/85cl ex=0 [min]
    P4 inconclusive p_holm=1.0000 delta=-0.0088 ci95=[-0.0849, +0.0656] n=400/85cl ex=0 [min]
    P5 pass p_holm=0.0014 delta=+0.0946 ci95=[+0.0517, +0.1393] n=325/82cl ex=75
    P6 pass p_holm=0.0008 delta=-0.6575 ci95=[-0.8303, -0.4891] n=400/85cl ex=0
    P7 inconclusive p_holm=1.0000 delta=+0.0158 ci95=[-0.0238, +0.0556] n=325/82cl ex=75 [min]
    P8 inconclusive p_holm=1.0000 delta=+0.0158 ci95=[-0.0238, +0.0556] n=325/82cl ex=75 [min]

R2 secondary, particle-1 (BA: NN 0.4073, NR 0.4143, GN 0.3810, GR 0.4814):
    family verdict=fail
    P1 pass p_holm=0.0021 delta=+0.0670 ci95=[+0.0300, +0.1040] n=325/82cl ex=75
    P2 fail p_holm=1.0000 delta=+0.0670 ci95=[+0.0300, +0.1040] n=325/82cl ex=75 [lose]

R3 bounds:
    BA AR 0.5000 (bound 0.5); FLAG 0.3556 (bound 0.5); RAND 0.3930 (expected mean 1/k 0.3944)
    acc D/N: AR 1.000/0.000; FLAG 0.000/0.711
    B1 pass p_holm=0.0002 delta=+0.2361 ci95=[+0.1558, +0.3158] n=325/82cl ex=75
    B2 fail p_holm=1.0000 delta=-0.2361 ci95=[-0.3158, -0.1558] n=325/82cl ex=75 [lose]

R4 cost (AR 1.370, NN 1.229, NR 0.712, GN 1.212, GR 0.704) and grid rows:
    mean cost (regret) at one-way 10, hold 1: oracle 0.144; hold-all 1.000; decide-all with opus NR picks 1.503
    one-way 10 hold 0.5: hold-all 0.500 < NR 0.538 < GR 0.548 < GN 1.122 < NN 1.129 < AR 1.310 < decide-all 1.503
    one-way 10 hold 1: GR 0.704 < NR 0.712 < hold-all 1.000 < GN 1.212 < NN 1.229 < AR 1.370 < decide-all 1.503

R5: in R1, BA comparisons pair 325 and exclude 75; cost pairs 400. R5c (null) matches R1. Variants:
    P3 inconclusive p_holm=1.0000 delta=-0.0031 ci95=[-0.0589, +0.0524] n=325/82cl ex=75 [min]
    P1 inconclusive p_holm=1.0000 delta=+0.0243 ci95=[-0.0102, +0.0612] n=400/85cl ex=0 [min]
    family verdict=blocked
    P3 blocked B: 8281ae0e is eligible but has no finite value (a system failure left no cost_GR_NR value and the comparison preregisters no failure_value) (+more)

R6 BROKEN in GR's place:
    BROKEN malformed passes 1200 of 1200; BA 0.0000; cost 1.000
    family verdict=fail
    P1 fail p_holm=1.0000 delta=-0.5916 ci95=[-0.6372, -0.5456] n=325/82cl ex=75 [lose]
    P3 fail p_holm=1.0000 delta=+0.2875 ci95=[+0.2095, +0.3650] n=400/85cl ex=0 [lose]

R7 8 largest clusters (124 items):
    P6 inconclusive p_holm=0.0313 delta=-0.6505 ci95=[-0.8000, -0.4781] n=124/8cl ex=0 [cl]

R8 GR identical to NR:
    P1 inconclusive p_holm=1.0000 delta=+0.0000 ci95=[+0.0000, +0.0000] n=325/82cl ex=75 [nv]

R9 particle-1 cells missing:
    family verdict=blocked
    P6 blocked eligibility differs for 0058499f: A eligible, B ineligible (no cost_NR_AR value) (+more)
    P1 blocked eligibility differs for 07f6b886: A eligible, B ineligible (no ba_GR_NR value) (+more)
    primary with particle-1 cells missing is identical to R1: true

R10 (particle-1 in results.txt):
    opus/NN: hold gap +0.0840 ci95 [-0.0018, +0.1592]; within D +0.0610, within N +0.0143, balanced +0.0376; AURC 0.4408 (error rate 0.4544); ECE 0.1809; one-way error rate 0.2292
    opus/NR: hold gap +0.5526 ci95 [+0.4805, +0.6273]; within D +0.2788, within N +0.5255, balanced +0.4022; AURC 0.1246 (error rate 0.3672); ECE 0.0428; one-way error rate 0.0625
    truth 81.25/8.75/10; Spawn 64.2/19.5/16.4
    opus/NR decide/send_back/hold 52.1/13.0/34.9 (decide ci95 47.8 to 56.2)
    opus/NR: decisions citing 74.6%; cites that exist and predate the item 851 of 918

R11 verbatim (recomputed, then exclude_when), Fable, default hidden:
    V1 report_only delta=+0.0127 ci95=[-0.0365, +0.0630] p_two_sided=0.6322 n=191/63cl ex=41
    V1 report_only delta=+0.0145 ci95=[-0.0361, +0.0663] p_two_sided=0.5905 n=191/63cl ex=209
    F1 report_only delta=-0.0286 ci95=[-0.1060, +0.0570] p_two_sided=0.5109 n=108/52cl ex=42
    H1 report_only delta=-0.1548 ci95=[-0.2242, -0.0846] p_two_sided=0.0001 n=211/74cl ex=48

## R12 power

`bun power.ts 60,100 200; bun power.ts 135,200 200`: 200 rounds per cell, D 190, H 40, S 35, 78 to 88 clusters; GR's N accuracy is 0.35 + 2 x diff. Each round runs the full 8-comparison primary family (draws 2000, seed 85); a cell is the share where P1 passes after Holm, with the mean estimate.

| N items | BA diff 0.04 | BA diff 0.06 | BA diff 0.08 | BA diff 0.10 | MDE at 80% |
|---|---|---|---|---|---|
| 60 | 17.5% (est 0.041) | 36.5% (est 0.062) | 59.5% (est 0.079) | 83.0% (est 0.102) | 0.097 |
| 100 | 23.5% (est 0.040) | 46.0% (est 0.058) | 80.0% (est 0.078) | 92.5% (est 0.099) | 0.080 |
| 135 | 27.5% (est 0.040) | 62.0% (est 0.060) | 86.5% (est 0.080) | 97.0% (est 0.100) | 0.075 |
| 200 | 27.0% (est 0.037) | 71.0% (est 0.058) | 94.5% (est 0.077) | 99.5% (est 0.098) | 0.068 |

MDE is linear between columns; Monte Carlo error is about 3 points near 80%. P5 and P6 usually pass with tiny p and take the first Holm ranks, so P1's adjusted p is about 6 times its raw p. At the briefed GR (diff 0.04) P1 passes 18 to 28%, partly because the estimate must reach 0.03. Power rests on the assumed variance components.
