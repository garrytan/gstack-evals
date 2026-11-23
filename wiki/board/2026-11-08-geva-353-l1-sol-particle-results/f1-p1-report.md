L1 analysis. power.txt 45585faa827b, probes.ts 47d55b3ea29a. Sessions 432: infra 0, cap stops 0, contaminated none 0.

## particle-1

**B1** admission: admitted (before 0/10, Wilson upper 27.8%, MDD@Holm2 +12.9). Verdict: **KEEP**, reading KEEP: KEEP for the route hook and the description rewrite. Holm p 0.0009; before rate 0.0% [0.0%, 0.0%]; MDD@Holm2 there +12.3; coverage ok; audit kappa passed; exposure 100.0% of 19
**B3** admission: not_admitted (before 6/10, Wilson upper 83.2%, MDD@Holm2 +19.6). Verdict: **FIX-METHOD (saturation)**, reading NOT_ADMITTED: the pilot did not admit it: a descriptive line, with no ceiling-raise attempt. Holm p 1.0000; before rate 42.5% [32.5%, 53.8%]; MDD@Holm2 there +21.3; coverage ok; audit kappa failed; exposure 96.3% of 80

| Endpoint | Arm A | Arm B | Paired tasks | Difference, points | Task 95% CI | Repository 95% CI | p, primaries only |
|---|---|---|---|---|---|---|---|
| B1 | after-u 15.0% (80) | before-u 0.0% (80) | 80 | +15.0 | [+7.5, +22.5] | [+8.0, +22.2] | 0.0005 |
| B3 | after-t 23.8% (80) | before-t 42.5% (80) | 80 | -18.8 | [-31.3, -6.3] | [-30.8, -6.3] | 0.0060 |
| B1 routed stratum | after-u 63.2% (19) | before-u 0.0% (19) | 19 | +63.2 | [+42.1, +84.2] | [+42.1, +83.3] | - |
| O5 (descriptive) | after-t 71.3% (80) | before-t 70.0% (80) | 80 | +1.3 | [-7.5, +10.0] | [-7.8, +11.2] | - |
| S1 pass | after-t 71.3% (80) | none 75.0% (80) | 80 | -3.8 | [-10.0, +2.5] | [-10.5, +2.5] | - |
| S1 pass | after-u 73.8% (80) | none 75.0% (80) | 80 | -1.3 | [-7.5, +5.0] | [-7.8, +5.1] | - |
| S3 pass | after-u 73.8% (80) | before-u 73.8% (80) | 80 | +0.0 | [-7.5, +7.5] | [-6.9, +6.6] | - |
| S5 pass | before-t 70.0% (80) | none 75.0% (80) | 80 | -5.0 | [-13.8, +3.8] | [-14.7, +3.8] | - |
| S5 pass | before-u 73.8% (80) | none 75.0% (80) | 80 | -1.3 | [-8.8, +6.3] | [-8.4, +6.3] | - |
| S6 load | after-u 15.0% (80) | off-u n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S6 complete | after-t 23.8% (80) | off-t n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S6 pass | after-t 71.3% (80) | off-t n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S6 pass | after-u 73.8% (80) | off-u n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S12 TB2 B1 | after-u n/a (0) | before-u n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S12 TB2 B3 | after-t n/a (0) | before-t n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S12 TB2 fit B1 | after-u n/a (0) | before-u n/a (0) | 0 | no outcome (coverage) | - | - | - |

Gate reading (probe I complete in F1 after-t, bar 50%): 19/80 = 23.8%, not met; probes.ts sha256 47d55b3ea29af9617e889132c8ea7ba3f83660aa0623f29414b7b05659af6a38. It is B3's exposure line.
O5: +1.3 points [-7.5, +10.0], before-t 70.0%, power.txt MDD@0.05 there +17.6. Unpowered: no verdict.
S13 background at result: {"pilot":{"before-u":{"sessions":10,"background":0,"over":false},"before-t":{"sessions":10,"background":0,"over":false}},"smoke":{"after-u":{"sessions":3,"background":0,"over":false},"after-t":{"sessions":3,"background":0,"over":false},"off-u":{"sessions":3,"background":0,"over":false},"off-t":{"sessions":3,"background":0,"over":false}},"f1":{"none":{"sessions":80,"background":0,"over":false},"before-u":{"sessions":80,"background":1,"over":false},"after-u":{"sessions":80,"background":1,"over":false},"before-t":{"sessions":80,"background":2,"over":false},"after-t":{"sessions":80,"background":0,"over":false}},"tb2":{}}
S7, S8, S10, S11: {"S7":{"f1":{"none":{"sessions":80,"gstack":{},"repo":{}},"before-u":{"sessions":80,"gstack":{},"repo":{}},"after-u":{"sessions":80,"gstack":{"review":1,"verify":1},"repo":{}},"off-u":{"sessions":0,"gstack":{},"repo":{}}},"tb2":{"none":{"sessions":0,"gstack":{},"repo":{}},"before-u":{"sessions":0,"gstack":{},"repo":{}},"after-u":{"sessions":0,"gstack":{},"repo":{}},"off-u":{"sessions":0,"gstack":{},"repo":{}}}},"S8":{"per_arm":{"none":{"sessions":80,"cost_missing":0,"usd_per_session":0.17514788749999993,"tokens_per_session":2027329.4125,"usd_per_pass":0.2335305166666666},"before-u":{"sessions":80,"cost_missing":0,"usd_per_session":0.1937240625000001,"tokens_per_session":2309299.65,"usd_per_pass":0.26267669491525436},"after-u":{"sessions":80,"cost_missing":0,"usd_per_session":0.1753944625,"tokens_per_session":2178291.1625,"usd_per_pass":0.23782299999999998},"before-t":{"sessions":80,"cost_missing":0,"usd_per_session":0.22532967499999995,"tokens_per_session":2790864.275,"usd_per_pass":0.32189953571428565},"after-t":{"sessions":80,"cost_missing":0,"usd_per_session":0.19584125000000002,"tokens_per_session":2410450.8875,"usd_per_pass":0.27486491228070176},"off-u":{"sessions":0,"cost_missing":0,"usd_per_session":null,"tokens_per_session":null,"usd_per_pass":null},"off-t":{"sessions":0,"cost_missing":0,"usd_per_session":null,"tokens_per_session":null,"usd_per_pass":null}},"ratio_to_none":{"none":{"per_session":1,"per_pass":1},"before-u":{"per_session":1.1060599432008575,"per_pass":1.1248067218991769},"after-u":{"per_session":1.0014078102997392,"per_pass":1.018380824033633},"before-t":{"per_session":1.2865109492114202,"per_pass":1.3784045884408072},"after-t":{"per_session":1.1181479422639344,"per_pass":1.1769978339620362},"off-u":{"per_session":null,"per_pass":null},"off-t":{"per_session":null,"per_pass":null}},"g3_after_t":1.1769978339620362},"S10":{"both":19,"probe_only":0,"contract_only":58,"neither":0,"unrecorded":3},"S11":{"route_disagree":{"recorded":432,"disagree":2},"route_hook_after_u":{"n":80,"fired":36,"unrecorded":0,"routed_n":19,"routed_fired":19},"contract_after_t":{"n":80,"block":4,"record":77,"unrecorded":0}}}
