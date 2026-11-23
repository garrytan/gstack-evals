L1 analysis. power.txt 45585faa827b, probes.ts 47d55b3ea29a. Sessions 512: infra 0, cap stops 0, contaminated none 0.

## gpt-6.1-sol

**B1** admission: not_admitted (before 6/10, Wilson upper 83.2%, MDD@Holm2 +19.6). Verdict: **FIX-METHOD (saturation)**, reading NOT_ADMITTED: the pilot did not admit it: a descriptive line, with no ceiling-raise attempt. Holm p 1.0000; before rate 65.0% [55.0%, 75.0%]; MDD@Holm2 there +18.6; coverage ok; audit kappa passed; exposure 100.0% of 19
**B3** admission: admitted (before 0/10, Wilson upper 27.8%, MDD@Holm2 +12.9). Verdict: **FIX-METHOD (method)**, reading KEEP: the probe failed its audit. Holm p 0.0000; before rate 7.5% [2.5%, 13.8%]; MDD@Holm2 there +16.3; coverage ok; audit kappa failed; exposure 100.0% of 80

| Endpoint | Arm A | Arm B | Paired tasks | Difference, points | Task 95% CI | Repository 95% CI | p, primaries only |
|---|---|---|---|---|---|---|---|
| B1 | after-u 73.8% (80) | before-u 65.0% (80) | 80 | +8.8 | [-3.8, +22.5] | [-4.2, +22.2] | 0.2659 |
| B3 | after-t 78.8% (80) | before-t 7.5% (80) | 80 | +71.3 | [+60.0, +81.3] | [+60.3, +81.8] | <0.0001 |
| B1 routed stratum | after-u 100.0% (19) | before-u 63.2% (19) | 19 | +36.8 | [+15.8, +57.9] | [+16.7, +57.9] | - |
| O5 (descriptive) | after-t 62.5% (80) | before-t 62.5% (80) | 80 | +0.0 | [-5.0, +5.0] | [-5.1, +4.9] | - |
| S1 pass | after-t 62.5% (80) | none 61.3% (80) | 80 | +1.3 | [-2.5, +6.3] | [-2.7, +5.5] | - |
| S1 pass | after-u 61.3% (80) | none 61.3% (80) | 80 | +0.0 | [-6.3, +6.3] | [-6.1, +6.0] | - |
| S3 pass | after-u 61.3% (80) | before-u 62.5% (80) | 80 | -1.3 | [-6.3, +3.8] | [-6.8, +3.9] | - |
| S5 pass | before-t 62.5% (80) | none 61.3% (80) | 80 | +1.3 | [-5.0, +7.5] | [-5.3, +7.4] | - |
| S5 pass | before-u 62.5% (80) | none 61.3% (80) | 80 | +1.3 | [-3.8, +6.3] | [-3.9, +6.8] | - |
| S6 load | after-u 73.8% (80) | off-u 88.8% (80) | 80 | -15.0 | [-25.0, -5.0] | [-25.3, -4.9] | - |
| S6 complete | after-t 78.8% (80) | off-t n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S6 pass | after-t 62.5% (80) | off-t n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S6 pass | after-u 61.3% (80) | off-u 55.0% (80) | 80 | +6.3 | [+1.3, +12.5] | [+1.4, +11.5] | - |
| S12 TB2 B1 | after-u n/a (0) | before-u n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S12 TB2 B3 | after-t n/a (0) | before-t n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S12 TB2 fit B1 | after-u n/a (0) | before-u n/a (0) | 0 | no outcome (coverage) | - | - | - |

Amendment E's off-u secondary (off-u minus before-u, B1's load, one-sided for a gain at 0.05, outside Holm): +23.8 points [+15.0, +33.8], one-sided p 0.0000; off-u 88.8% (80), before-u 65.0% (80).

Gate reading (probe I complete in F1 after-t, bar 50%): 63/80 = 78.8%, met; probes.ts sha256 47d55b3ea29af9617e889132c8ea7ba3f83660aa0623f29414b7b05659af6a38. It is B3's exposure line.
O5: +0.0 points [-5.0, +5.0], before-t 62.5%, power.txt MDD@0.05 there +19.3. Unpowered: no verdict.
S13 background at result: {"pilot":{"before-u":{"sessions":10,"background":1,"over":false},"before-t":{"sessions":10,"background":0,"over":false}},"smoke":{"after-u":{"sessions":3,"background":1,"over":true},"after-t":{"sessions":3,"background":1,"over":true},"off-u":{"sessions":3,"background":0,"over":false},"off-t":{"sessions":3,"background":0,"over":false}},"f1":{"none":{"sessions":80,"background":0,"over":false},"before-u":{"sessions":80,"background":1,"over":false},"after-u":{"sessions":80,"background":1,"over":false},"before-t":{"sessions":80,"background":3,"over":false},"after-t":{"sessions":80,"background":1,"over":false},"off-u":{"sessions":80,"background":3,"over":false}},"tb2":{}}
S7, S8, S10, S11: {"S7":{"f1":{"none":{"sessions":80,"gstack":{},"repo":{}},"before-u":{"sessions":80,"gstack":{"verify":3,"review":4},"repo":{}},"after-u":{"sessions":80,"gstack":{"verify":77,"qa":7,"review":2},"repo":{}},"off-u":{"sessions":80,"gstack":{"verify":77,"review":3},"repo":{}}},"tb2":{"none":{"sessions":0,"gstack":{},"repo":{}},"before-u":{"sessions":0,"gstack":{},"repo":{}},"after-u":{"sessions":0,"gstack":{},"repo":{}},"off-u":{"sessions":0,"gstack":{},"repo":{}}}},"S8":{"per_arm":{"none":{"sessions":80,"cost_missing":0,"usd_per_session":0.5237838499999998,"tokens_per_session":1713335.2,"usd_per_pass":0.8551573061224487},"before-u":{"sessions":80,"cost_missing":0,"usd_per_session":0.6448266500000001,"tokens_per_session":2177256.325,"usd_per_pass":1.0317226400000001},"after-u":{"sessions":80,"cost_missing":0,"usd_per_session":0.6205033625,"tokens_per_session":2045264.35,"usd_per_pass":1.0130667142857144},"before-t":{"sessions":80,"cost_missing":0,"usd_per_session":0.69430065,"tokens_per_session":2422055.0125,"usd_per_pass":1.11088104},"after-t":{"sessions":80,"cost_missing":0,"usd_per_session":0.6635008125,"tokens_per_session":2409650.9375,"usd_per_pass":1.0616013000000002},"off-u":{"sessions":80,"cost_missing":0,"usd_per_session":0.6062824875,"tokens_per_session":2076061.125,"usd_per_pass":1.1023317954545455},"off-t":{"sessions":0,"cost_missing":0,"usd_per_session":null,"tokens_per_session":null,"usd_per_pass":null}},"ratio_to_none":{"none":{"per_session":1,"per_pass":1},"before-u":{"per_session":1.2310930358009324,"per_pass":1.206471175084914},"after-u":{"per_session":1.1846553926777244,"per_pass":1.1846553926777244},"before-t":{"per_session":1.3255480290199864,"per_pass":1.2990370684395867},"after-t":{"per_session":1.2667454571193828,"per_pass":1.2414105479769955},"off-u":{"per_session":1.1575051187622531,"per_pass":1.289039791348873},"off-t":{"per_session":null,"per_pass":null}},"g3_after_t":1.2414105479769955},"S10":{"both":63,"probe_only":0,"contract_only":16,"neither":0,"unrecorded":1},"S11":{"route_disagree":{"recorded":512,"disagree":28},"route_hook_after_u":{"n":80,"fired":36,"unrecorded":0,"routed_n":19,"routed_fired":19},"contract_after_t":{"n":80,"block":58,"record":80,"unrecorded":0}}}
