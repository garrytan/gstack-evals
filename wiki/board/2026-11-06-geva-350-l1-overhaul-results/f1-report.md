L1 analysis. power.txt 45585faa827b, probes.ts 47d55b3ea29a. Sessions 592: infra 0, cap stops 0, contaminated none 0.

## claude-opus-5-5

**B1** admission: admitted (before 0/10, Wilson upper 27.8%, MDD@Holm2 +12.9). Verdict: **KEEP**, reading KEEP: KEEP for the route hook and the description rewrite. Holm p 0.0001; before rate 0.0% [0.0%, 0.0%]; MDD@Holm2 there +12.3; coverage ok; audit kappa passed; exposure 100.0% of 19
**B3** admission: admitted (before 1/10, Wilson upper 40.4%, MDD@Holm2 +17.7). Verdict: **FIX-METHOD (method)**, reading NULL: the probe failed its audit. Holm p 0.1152; before rate 20.0% [11.3%, 28.7%]; MDD@Holm2 there +20.3; coverage ok; audit kappa failed; exposure 100.0% of 80

| Endpoint | Arm A | Arm B | Paired tasks | Difference, points | Task 95% CI | Repository 95% CI | p, primaries only |
|---|---|---|---|---|---|---|---|
| B1 | after-u 21.3% (80) | before-u 0.0% (80) | 80 | +21.3 | [+12.5, +30.0] | [+12.9, +30.1] | <0.0001 |
| B3 | after-t 30.0% (80) | before-t 20.0% (80) | 80 | +10.0 | [+0.0, +20.0] | [-1.1, +22.1] | 0.1152 |
| B1 routed stratum | after-u 89.5% (19) | before-u 0.0% (19) | 19 | +89.5 | [+73.7, +100.0] | [+73.7, +100.0] | - |
| O5 (descriptive) | after-t 70.0% (80) | before-t 65.0% (80) | 80 | +5.0 | [+0.0, +11.3] | [+0.0, +11.3] | - |
| S1 pass | after-t 70.0% (80) | none 65.0% (80) | 80 | +5.0 | [+0.0, +11.3] | [+0.0, +11.5] | - |
| S1 pass | after-u 66.3% (80) | none 65.0% (80) | 80 | +1.3 | [-5.0, +7.5] | [-5.1, +8.0] | - |
| S3 pass | after-u 66.3% (80) | before-u 68.8% (80) | 80 | -2.5 | [-7.5, +2.5] | [-7.7, +2.4] | - |
| S5 pass | before-t 65.0% (80) | none 65.0% (80) | 80 | +0.0 | [-6.3, +7.5] | [-6.8, +6.9] | - |
| S5 pass | before-u 68.8% (80) | none 65.0% (80) | 80 | +3.8 | [-1.3, +8.8] | [-1.3, +9.7] | - |
| S6 load | after-u 21.3% (80) | off-u 0.0% (80) | 80 | +21.3 | [+12.5, +30.0] | [+12.9, +30.1] | - |
| S6 complete | after-t 30.0% (80) | off-t 28.7% (80) | 80 | +1.3 | [-10.0, +12.5] | [-11.3, +14.1] | - |
| S6 pass | after-t 70.0% (80) | off-t 66.3% (80) | 80 | +3.8 | [-1.3, +8.8] | [-1.3, +9.3] | - |
| S6 pass | after-u 66.3% (80) | off-u 63.7% (80) | 80 | +2.5 | [+0.0, +6.3] | [+0.0, +6.3] | - |
| S12 TB2 B1 | after-u n/a (0) | before-u n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S12 TB2 B3 | after-t n/a (0) | before-t n/a (0) | 0 | no outcome (coverage) | - | - | - |
| S12 TB2 fit B1 | after-u n/a (0) | before-u n/a (0) | 0 | no outcome (coverage) | - | - | - |

Gate reading (probe I complete in F1 after-t, bar 50%): 24/80 = 30.0%, not met; probes.ts sha256 47d55b3ea29af9617e889132c8ea7ba3f83660aa0623f29414b7b05659af6a38. It is B3's exposure line.
O5: +5.0 points [+0.0, +11.3], before-t 65.0%, power.txt MDD@0.05 there +18.7. Unpowered: no verdict.
S13 background at result: {"pilot":{"before-u":{"sessions":10,"background":0,"over":false},"before-t":{"sessions":10,"background":0,"over":false}},"smoke":{"after-u":{"sessions":3,"background":0,"over":false},"after-t":{"sessions":3,"background":0,"over":false},"off-u":{"sessions":3,"background":0,"over":false},"off-t":{"sessions":3,"background":0,"over":false}},"f1":{"none":{"sessions":80,"background":3,"over":false},"before-u":{"sessions":80,"background":2,"over":false},"after-u":{"sessions":80,"background":2,"over":false},"before-t":{"sessions":80,"background":3,"over":false},"after-t":{"sessions":80,"background":4,"over":false},"off-u":{"sessions":80,"background":4,"over":false},"off-t":{"sessions":80,"background":4,"over":false}},"tb2":{}}
S7, S8, S10, S11: {"S7":{"f1":{"none":{"sessions":80,"gstack":{},"repo":{}},"before-u":{"sessions":80,"gstack":{},"repo":{}},"after-u":{"sessions":80,"gstack":{"verify":4},"repo":{}},"off-u":{"sessions":80,"gstack":{},"repo":{}}},"tb2":{"none":{"sessions":0,"gstack":{},"repo":{}},"before-u":{"sessions":0,"gstack":{},"repo":{}},"after-u":{"sessions":0,"gstack":{},"repo":{}},"off-u":{"sessions":0,"gstack":{},"repo":{}}}},"S8":{"per_arm":{"none":{"sessions":80,"cost_missing":0,"usd_per_session":0.3925759125,"tokens_per_session":636319.2625,"usd_per_pass":0.6039629423076923},"before-u":{"sessions":80,"cost_missing":0,"usd_per_session":0.4215710624999998,"tokens_per_session":703851.7375,"usd_per_pass":0.6131942727272724},"after-u":{"sessions":80,"cost_missing":0,"usd_per_session":0.44474685000000014,"tokens_per_session":802814.35,"usd_per_pass":0.6713160000000001},"before-t":{"sessions":80,"cost_missing":0,"usd_per_session":0.5702261,"tokens_per_session":976830.1875,"usd_per_pass":0.8772709230769231},"after-t":{"sessions":80,"cost_missing":0,"usd_per_session":0.5364812374999999,"tokens_per_session":965682.05,"usd_per_pass":0.7664017678571426},"off-u":{"sessions":80,"cost_missing":0,"usd_per_session":0.39969659999999996,"tokens_per_session":697994.3125,"usd_per_pass":0.6269750588235293},"off-t":{"sessions":80,"cost_missing":0,"usd_per_session":0.5072357500000001,"tokens_per_session":960994.7875,"usd_per_pass":0.7656388679245284}},"ratio_to_none":{"none":{"per_session":1,"per_pass":1},"before-u":{"per_session":1.0738587087917673,"per_pass":1.0152845974031255},"after-u":{"per_session":1.1328938832944828,"per_pass":1.1115185270059076},"before-t":{"per_session":1.4525244209933537,"per_pass":1.4525244209933539},"after-t":{"per_session":1.366566873865446,"per_pass":1.2689549543036285},"off-u":{"per_session":1.0181383708813259,"per_pass":1.0381018683495873},"off-t":{"per_session":1.2920704858579424,"per_pass":1.2676917974455284}},"g3_after_t":1.2689549543036285},"S10":{"both":23,"probe_only":1,"contract_only":49,"neither":7,"unrecorded":0},"S11":{"route_disagree":{"recorded":592,"disagree":10},"route_hook_after_u":{"n":80,"fired":36,"unrecorded":0,"routed_n":19,"routed_fired":19},"contract_after_t":{"n":80,"block":16,"record":80,"unrecorded":0}}}
