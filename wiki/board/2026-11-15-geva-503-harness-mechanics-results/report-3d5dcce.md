# Harness mechanics report

## Verdicts

H1 VERDICT: NO MEASURABLE DIFFERENCE -> CUT-CANDIDATE for the hook on this rule, stated with its MDD: A's pooled MDD 3.6 points, P's 3.4
H2 VERDICT: EQUAL AT EQUAL SPEND -> KEEP: /verify as one way to spend, since neither use of the money beats the other by 5 points; gstack against none prints beside it
H3 VERDICT: JEV MATCHES AND IS FASTER -> KEEP: the Jev cascade as a hook backend

## H1: verify-hook against verify-prose, pooled over opus, sol, p1

Pre-data reporting amendment for H1 (before any data). The H1 verdict rules stand as written; rule 1 carries the A4 guard, and when A4 keeps the shipping test out, rules 3 to 5 decide the verdict. Reporting addition, which changes no verdict, arm or money rule: when A4 keeps the shipping test out, the results print P's interval next to the H1 verdict. If P's upper bound is below 0, the results also say in plain words that the hook arm lost passes on that interval, and that the shipping test carries no verdict because discordance passed the planned 0.20. The label NO MEASURABLE DIFFERENCE never stands alone in that case.

H1 pooled A (verify-hook minus verify-prose adherence): 0.0 points, 95% [-2.8, 2.8] (no measurable difference); MDD 3.6 at discordance 0.097; 599 pairs; worse 29, better 29; none passed 358 of 599; missing 0 of 600; left out 1
H1 pooled P (verify-hook minus verify-prose pass): -0.3 points, 95% [-2.9, 2.3] (no measurable difference); MDD 3.4 at discordance 0.090; 600 pairs; worse 28, better 26; none passed 358 of 600; missing 0 of 600
H1 opus: A: 1.5 points, 95% [-2.4, 5.3] (no measurable difference); MDD 5.1 at discordance 0.065; 200 pairs; worse 5, better 8; none passed 121 of 200; missing 0 of 200 | P: 2.0 points, 95% [-2.3, 6.6] (no measurable difference); MDD 6.3 at discordance 0.100; 200 pairs; worse 8, better 12; none passed 121 of 200; missing 0 of 200
H1 sol: A: 1.5 points, 95% [-3.8, 7.0] (no measurable difference); MDD 7.3 at discordance 0.135; 200 pairs; worse 12, better 15; none passed 115 of 200; missing 0 of 200 | P: -2.0 points, 95% [-5.4, 1.4] (no measurable difference); MDD 4.9 at discordance 0.060; 200 pairs; worse 8, better 4; none passed 115 of 200; missing 0 of 200
H1 p1: A: -3.0 points, 95% [-7.3, 1.1] (no measurable difference); MDD 6.0 at discordance 0.090; 199 pairs; worse 12, better 6; none passed 122 of 199; missing 0 of 200; left out 1 | P: -1.0 points, 95% [-5.7, 4.0] (no measurable difference); MDD 6.6 at discordance 0.110; 200 pairs; worse 12, better 10; none passed 122 of 200; missing 0 of 200
H1 secondary false done verify-hook minus verify-prose: 0.3 points, 95% [-2.3, 2.9] (no measurable difference); MDD 3.4 at discordance 0.090; 600 pairs; worse 28, better 26; none passed 358 of 600; missing 0 of 600
H1 secondary verify-prose minus none pass: 1.5 points, 95% [-0.7, 3.6] (no measurable difference); MDD 3.1 at discordance 0.075; 600 pairs; worse 18, better 27; none passed 358 of 600; missing 0 of 600
H1 secondary verify-hook minus none pass: 1.2 points, 95% [-1.0, 3.4] (no measurable difference); MDD 3.1 at discordance 0.072; 600 pairs; worse 18, better 25; none passed 358 of 600; missing 0 of 600
H1 secondary verify-prose minus none false done: -1.5 points, 95% [-3.7, 0.7] (no measurable difference); MDD 3.1 at discordance 0.075; 600 pairs; worse 18, better 27; none passed 358 of 600; missing 0 of 600
H1 secondary verify-hook minus none false done: -1.2 points, 95% [-3.4, 1.0] (no measurable difference); MDD 3.0 at discordance 0.068; 600 pairs; worse 17, better 24; none passed 358 of 600; missing 0 of 600
H1 arm opus verify-prose: waivers 0, BLOCKED exits 0, blocks 0, turn-cap stops 0, more than one /verify load 0, an edit before the last load 0, strict rule ran 42.0%, left out with no edit 0
H1 arm opus verify-hook: waivers 0, BLOCKED exits 0, blocks 4, turn-cap stops 0, more than one /verify load 0, an edit before the last load 0, strict rule ran 44.0%, left out with no edit 0
H1 arm sol verify-prose: waivers 0, BLOCKED exits 0, blocks 0, turn-cap stops 0, more than one /verify load 2, an edit before the last load 2, strict rule ran 64.5%, left out with no edit 0
H1 arm sol verify-hook: waivers 0, BLOCKED exits 0, blocks 13, turn-cap stops 2, more than one /verify load 0, an edit before the last load 0, strict rule ran 70.5%, left out with no edit 0
H1 arm p1 verify-prose: waivers 0, BLOCKED exits 0, blocks 0, turn-cap stops 13, more than one /verify load 0, an edit before the last load 0, strict rule ran 62.3%, left out with no edit 1
H1 arm p1 verify-hook: waivers 0, BLOCKED exits 0, blocks 5, turn-cap stops 15, more than one /verify load 0, an edit before the last load 0, strict rule ran 60.0%, left out with no edit 0
H1 why-null exposure: opus verify-prose /verify loaded 100.0%, contract record n/a, blocks fired 0, hook logs n/a, clean n/a (200 graded); opus verify-hook /verify loaded 100.0%, contract record 99.5%, blocks fired 4, hook logs n/a, clean n/a (200 graded); sol verify-prose /verify loaded 100.0%, contract record n/a, blocks fired 0, hook logs n/a, clean n/a (200 graded); sol verify-hook /verify loaded 100.0%, contract record 100.0%, blocks fired 13, hook logs n/a, clean n/a (200 graded); p1 verify-prose /verify loaded 100.0%, contract record n/a, blocks fired 0, hook logs n/a, clean n/a (200 graded); p1 verify-hook /verify loaded 100.0%, contract record 95.0%, blocks fired 5, hook logs n/a, clean n/a (200 graded)
H1 why-null task_fit: opus verify-prose edited 100.0%, rule ran 91.5%; opus verify-hook edited 100.0%, rule ran 93.0%; sol verify-prose edited 100.0%, rule ran 85.0%; sol verify-hook edited 100.0%, rule ran 86.5%; p1 verify-prose edited 99.5%, rule ran 92.0%; p1 verify-hook edited 100.0%, rule ran 89.0%
H1 why-null power: A's MDD 3.6 points at discordance 0.097 over 599 pairs; P's 3.4 at 0.090 over 600
H1 why-null frontier: none passed 60.5% on opus, 57.5% on sol, 61.0% on p1

## H2: gstack (verify-prose) against best-of-2 at equal spend, pooled over opus, sol, p1

H2 pooled E (equal-spend policy minus gstack pass): -0.7 points, 95% [-2.8, 1.5] (no measurable difference); MDD 2.9; 600 pairs; missing 0 of 600
H2 opus: E 1.3 points, 95% [-2.6, 5.6]; MDD 5.2; f 0.573; spend ratio bo2 over gstack 1.283, 95% [1.191, 1.377]; pass@2 67.0%; picker right on 66.7% of 15 split tasks
H2 sol: E -2.5 points, 95% [-5.6, 0.0]; MDD 3.3; f 0.000; spend ratio bo2 over gstack 2.283, 95% [2.116, 2.449]; pass@2 60.0%; picker right on 66.7% of 6 split tasks
H2 p1: E -0.9 points, 95% [-5.6, 3.7]; MDD 5.9; f 0.132; spend ratio bo2 over gstack 2.154, 95% [2.017, 2.301]; pass@2 65.5%; picker right on 57.9% of 19 split tasks
H2 pooled spend ratio bo2 over gstack 1.817, 95% [1.714, 1.917]
H2 secondary bo2 minus gstack pass: 0.5 points, 95% [-1.6, 2.8] (no measurable difference); MDD 3.1 at discordance 0.072; 600 pairs; worse 20, better 23; none passed 358 of 600; missing 0 of 600
H2 secondary gstack minus none pass: 1.5 points, 95% [-0.7, 3.6] (no measurable difference); MDD 3.1 at discordance 0.075; 600 pairs; worse 18, better 27; none passed 358 of 600; missing 0 of 600
H2 secondary bo2 minus none pass: 2.0 points, 95% [0.5, 3.7]; MDD 2.2 at discordance 0.037; 600 pairs; worse 5, better 17; none passed 358 of 600; missing 0 of 600
H2 secondary bo2 minus verify-hook pass: 0.8 points, 95% [-1.3, 3.0] (no measurable difference); MDD 2.9 at discordance 0.065; 600 pairs; worse 17, better 22; none passed 358 of 600; missing 0 of 600

## H3: judge-jev against judge-p1 on the judge subset, pooled over opus, sol, p1

H3 pooled judge-jev minus judge-p1 pass: -1.7 points, 95% [-6.5, 3.3] (no measurable difference); MDD 6.0 at discordance 0.083; 180 pairs; worse 9, better 6; none passed 113 of 180; missing 0 of 180
H3 pooled hook-time ratio judge-jev over judge-p1 0.163, 95% [0.151, 0.177]
H3 opus: pass: -1.7 points, 95% [-7.0, 3.6] (no measurable difference); MDD 8.1 at discordance 0.050; 60 pairs; worse 2, better 1; none passed 37 of 60; missing 0 of 60 | hook-time ratio 0.170, 95% [0.152, 0.191]
H3 sol: pass: -3.3 points, 95% [-12.9, 5.1] (no measurable difference); MDD 11.4 at discordance 0.100; 60 pairs; worse 4, better 2; none passed 38 of 60; missing 0 of 60 | hook-time ratio 0.157, 95% [0.141, 0.173]
H3 p1: pass: 0.0 points, 95% [-7.7, 8.3] (no measurable difference); MDD 11.4 at discordance 0.100; 60 pairs; worse 3, better 3; none passed 38 of 60; missing 0 of 60 | hook-time ratio 0.162, 95% [0.139, 0.190]
H3 secondary opus judge-jev: hook calls' model cost per session $0.000, fail-open 13, escalations 0, mean hook time 6.5 s
H3 secondary opus judge-p1: hook calls' model cost per session $0.004, fail-open 0, escalations 0, mean hook time 38.2 s
H3 secondary sol judge-jev: hook calls' model cost per session $0.000, fail-open 2, escalations 0, mean hook time 4.6 s
H3 secondary sol judge-p1: hook calls' model cost per session $0.003, fail-open 0, escalations 0, mean hook time 29.6 s
H3 secondary p1 judge-jev: hook calls' model cost per session $0.000, fail-open 1, escalations 0, mean hook time 7.8 s
H3 secondary p1 judge-p1: hook calls' model cost per session $0.005, fail-open 0, escalations 0, mean hook time 48.0 s
H3 secondary judge-jev minus verify-hook pass: -1.7 points, 95% [-6.6, 3.1] (no measurable difference); MDD 5.6 at discordance 0.072; 180 pairs; worse 8, better 5; none passed 113 of 180; missing 420 of 600 INCOMPLETE
H3 secondary judge-jev minus verify-hook false done: 1.1 points, 95% [-3.8, 6.2] (no measurable difference); MDD 5.8 at discordance 0.078; 180 pairs; worse 8, better 6; none passed 113 of 180; missing 420 of 600 INCOMPLETE
H3 secondary judge-jev minus none pass: -0.6 points, 95% [-4.2, 3.4] (no measurable difference); MDD 5.2 at discordance 0.061; 180 pairs; worse 6, better 5; none passed 113 of 180; missing 420 of 600 INCOMPLETE
H3 secondary judge-jev minus none false done: 0.0 points, 95% [-4.2, 3.8] (no measurable difference); MDD 5.4 at discordance 0.067; 180 pairs; worse 6, better 6; none passed 113 of 180; missing 420 of 600 INCOMPLETE
H3 secondary judge-p1 minus verify-hook pass: 0.0 points, 95% [-5.4, 5.9] (no measurable difference); MDD 5.8 at discordance 0.078; 180 pairs; worse 7, better 7; none passed 113 of 180; missing 420 of 600 INCOMPLETE
H3 secondary judge-p1 minus verify-hook false done: 0.0 points, 95% [-5.9, 5.4] (no measurable difference); MDD 5.8 at discordance 0.078; 180 pairs; worse 7, better 7; none passed 113 of 180; missing 420 of 600 INCOMPLETE
H3 secondary judge-p1 minus none pass: 1.1 points, 95% [-2.2, 4.5] (no measurable difference); MDD 4.9 at discordance 0.056; 180 pairs; worse 4, better 6; none passed 113 of 180; missing 420 of 600 INCOMPLETE
H3 secondary judge-p1 minus none false done: -1.1 points, 95% [-4.5, 2.2] (no measurable difference); MDD 4.9 at discordance 0.056; 180 pairs; worse 4, better 6; none passed 113 of 180; missing 420 of 600 INCOMPLETE

## Per model

### Model claude-opus-5-5 (opus)

| arm | graded | missing | pass | edited | rule ran | strict | false done | mean spend |
|---|---|---|---|---|---|---|---|---|
| none | 200 | 0 | 60.5% | 99.5% | 75.4% | 54.3% | 39.5% | $0.28 |
| plain-2 | 200 | 0 | 66.0% | 99.5% | 71.4% | 49.2% | 33.5% | $0.28 |
| verify-prose | 200 | 0 | 61.5% | 100.0% | 91.5% | 42.0% | 38.0% | $0.45 |
| verify-hook | 200 | 0 | 63.5% | 100.0% | 93.0% | 44.0% | 36.0% | $0.45 |
| judge-jev | 60 | 0 | 63.3% | 100.0% | 85.0% | 40.0% | 35.0% | $0.48 |
| judge-p1 | 60 | 0 | 65.0% | 100.0% | 86.7% | 38.3% | 35.0% | $0.51 |

### Model gpt-6.1-sol (sol)

| arm | graded | missing | pass | edited | rule ran | strict | false done | mean spend |
|---|---|---|---|---|---|---|---|---|
| none | 200 | 0 | 57.5% | 100.0% | 81.0% | 75.0% | 42.5% | $0.45 |
| plain-2 | 200 | 0 | 59.5% | 100.0% | 84.5% | 80.5% | 40.5% | $0.45 |
| verify-prose | 200 | 0 | 60.0% | 100.0% | 85.0% | 64.5% | 40.0% | $0.42 |
| verify-hook | 200 | 0 | 58.0% | 100.0% | 86.5% | 70.5% | 42.0% | $0.40 |
| judge-jev | 60 | 0 | 60.0% | 100.0% | 71.7% | 58.3% | 40.0% | $0.40 |
| judge-p1 | 60 | 0 | 63.3% | 100.0% | 78.3% | 65.0% | 36.7% | $0.41 |

### Model particle-1 (p1)

| arm | graded | missing | pass | edited | rule ran | strict | false done | mean spend |
|---|---|---|---|---|---|---|---|---|
| none | 200 | 0 | 61.0% | 100.0% | 85.0% | 68.5% | 38.5% | $0.10 |
| plain-2 | 200 | 0 | 60.5% | 99.5% | 83.4% | 72.4% | 39.5% | $0.10 |
| verify-prose | 200 | 0 | 62.0% | 99.5% | 92.0% | 62.3% | 38.0% | $0.12 |
| verify-hook | 200 | 0 | 61.0% | 100.0% | 89.0% | 60.0% | 39.0% | $0.12 |
| judge-jev | 60 | 0 | 63.3% | 100.0% | 85.0% | 56.7% | 36.7% | $0.11 |
| judge-p1 | 60 | 0 | 63.3% | 100.0% | 81.7% | 61.7% | 36.7% | $0.12 |

## Exposure

EXPOSURE opus none: /verify loaded n/a, contract record n/a, blocks fired 0, hook logs n/a, clean 100.0% (200 graded)
EXPOSURE opus plain-2: /verify loaded n/a, contract record n/a, blocks fired 0, hook logs n/a, clean 100.0% (200 graded)
EXPOSURE opus verify-prose: /verify loaded 100.0%, contract record n/a, blocks fired 0, hook logs n/a, clean n/a (200 graded)
EXPOSURE opus verify-hook: /verify loaded 100.0%, contract record 99.5%, blocks fired 4, hook logs n/a, clean n/a (200 graded)
EXPOSURE opus judge-jev: /verify loaded 100.0%, contract record n/a, blocks fired 4, hook logs 100.0%, clean n/a (60 graded)
EXPOSURE opus judge-p1: /verify loaded 100.0%, contract record n/a, blocks fired 5, hook logs 100.0%, clean n/a (60 graded)
EXPOSURE sol none: /verify loaded n/a, contract record n/a, blocks fired 0, hook logs n/a, clean 100.0% (200 graded)
EXPOSURE sol plain-2: /verify loaded n/a, contract record n/a, blocks fired 0, hook logs n/a, clean 100.0% (200 graded)
EXPOSURE sol verify-prose: /verify loaded 100.0%, contract record n/a, blocks fired 0, hook logs n/a, clean n/a (200 graded)
EXPOSURE sol verify-hook: /verify loaded 100.0%, contract record 100.0%, blocks fired 13, hook logs n/a, clean n/a (200 graded)
EXPOSURE sol judge-jev: /verify loaded 100.0%, contract record n/a, blocks fired 5, hook logs 100.0%, clean n/a (60 graded)
EXPOSURE sol judge-p1: /verify loaded 100.0%, contract record n/a, blocks fired 1, hook logs 100.0%, clean n/a (60 graded)
EXPOSURE p1 none: /verify loaded n/a, contract record n/a, blocks fired 0, hook logs n/a, clean 100.0% (200 graded)
EXPOSURE p1 plain-2: /verify loaded n/a, contract record n/a, blocks fired 0, hook logs n/a, clean 100.0% (200 graded)
EXPOSURE p1 verify-prose: /verify loaded 100.0%, contract record n/a, blocks fired 0, hook logs n/a, clean n/a (200 graded)
EXPOSURE p1 verify-hook: /verify loaded 100.0%, contract record 95.0%, blocks fired 5, hook logs n/a, clean n/a (200 graded)
EXPOSURE p1 judge-jev: /verify loaded 100.0%, contract record n/a, blocks fired 0, hook logs 100.0%, clean n/a (60 graded)
EXPOSURE p1 judge-p1: /verify loaded 100.0%, contract record n/a, blocks fired 3, hook logs 100.0%, clean n/a (60 graded)

## Patterns 1 to 3

PATTERNS none sessions=600 edited=599 redirected_read=2 (0.3%) tox_no_tests=0 (0.0%) combined_flags=0 (0.0%)
PATTERNS plain-2 sessions=600 edited=598 redirected_read=2 (0.3%) tox_no_tests=0 (0.0%) combined_flags=0 (0.0%)
PATTERNS verify-prose sessions=600 edited=599 redirected_read=5 (0.8%) tox_no_tests=0 (0.0%) combined_flags=0 (0.0%)
PATTERNS verify-hook sessions=600 edited=600 redirected_read=6 (1.0%) tox_no_tests=0 (0.0%) combined_flags=0 (0.0%)
PATTERNS judge-jev sessions=180 edited=180 redirected_read=3 (1.7%) tox_no_tests=0 (0.0%) combined_flags=0 (0.0%)
PATTERNS judge-p1 sessions=180 edited=180 redirected_read=1 (0.6%) tox_no_tests=0 (0.0%) combined_flags=0 (0.0%)
PROBES none descriptive, not patterns 1 to 3: collectonly=0 cache_show=0 tox_notest=0 make_check_format=0 skill_contract_waive=0
PROBES plain-2 descriptive, not patterns 1 to 3: collectonly=0 cache_show=0 tox_notest=0 make_check_format=0 skill_contract_waive=0
PROBES verify-prose descriptive, not patterns 1 to 3: collectonly=0 cache_show=0 tox_notest=0 make_check_format=0 skill_contract_waive=0
PROBES verify-hook descriptive, not patterns 1 to 3: collectonly=0 cache_show=0 tox_notest=0 make_check_format=0 skill_contract_waive=0
PROBES judge-jev descriptive, not patterns 1 to 3: collectonly=0 cache_show=0 tox_notest=0 make_check_format=0 skill_contract_waive=0
PROBES judge-p1 descriptive, not patterns 1 to 3: collectonly=0 cache_show=0 tox_notest=0 make_check_format=0 skill_contract_waive=0

## Stage 1 admission

STAGE1 FIT table: fit rows at sha256 7b35427e62031b4c305fa0e4108a672abc5de03572c352fc9fb3731e5074570c (40 tasks); a print only, which no verdict, stop or cap reads
STAGE1 A1 opus: none passed 62.5% of 40 (bar 15% to 90%): ok
STAGE1 A2 opus: verify-prose ran the rule in 87.5% of 40 sessions with an edit (bar at most 90%): ok; /verify loaded in 100.0% of 80 told sessions and the contract record in 100.0% of 40 verify-hook sessions (bar 90%): ok
STAGE1 A3 opus: verify-prose edited a file in 100.0% of 40 (bar 80%): ok
STAGE1 A4 opus: d verify-prose vs verify-hook 0.025, 80% [0.000, 0.056] (40 tasks); d0 none vs plain-2 0.050, 80% [0.000, 0.098] (40); adherence gap verify-hook minus verify-prose 7.5 points, 80% [2.5, 13.2] (40 tasks with an edit in both)
STAGE1 FIT opus S1 (4 tasks, tests PASS on the probe edit): verify-prose ran the rule in 4 of 4 sessions with an edit; verify-hook ran it in 4 of 4, and its hook blocked a /verify run in 0 of 4 sessions (0 blocks)
STAGE1 FIT opus S2 (7 tasks, tests FAIL, already failing at base): verify-prose ran the rule in 4 of 7 sessions with an edit; verify-hook ran it in 5 of 7, and its hook blocked a /verify run in 0 of 7 sessions (0 blocks)
STAGE1 FIT opus S3 (0 tasks, tests FAIL, base passes): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT opus S4 (0 tasks, tests ran no test, lint or typecheck gives PASS/FAIL): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT opus S5 (9 tasks, no check gives PASS/FAIL): verify-prose ran the rule in 8 of 9 sessions with an edit; verify-hook ran it in 9 of 9, and its hook blocked a /verify run in 0 of 9 sessions (0 blocks)
STAGE1 FIT opus U1 (19 tasks, unmeasured: no tracked module a test_<name>.py names): verify-prose ran the rule in 19 of 19 sessions with an edit; verify-hook ran it in 19 of 19, and its hook blocked a /verify run in 1 of 19 sessions (1 blocks)
STAGE1 FIT opus U2 (1 tasks, unmeasured: no pytest in the testbed env): verify-prose ran the rule in 0 of 1 sessions with an edit; verify-hook ran it in 1 of 1, and its hook blocked a /verify run in 0 of 1 sessions (0 blocks)
STAGE1 FIT opus no class (0 tasks, no fit row or none of the seven): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT opus lint or typecheck only: 0 of 73 rule runs rest only on a CHECK lint or CHECK typecheck line (verify-prose 0 of 35, verify-hook 0 of 38)
STAGE1 A1 sol: none passed 57.5% of 40 (bar 15% to 90%): ok
STAGE1 A2 sol: verify-prose ran the rule in 80.0% of 40 sessions with an edit (bar at most 90%): ok; /verify loaded in 100.0% of 80 told sessions and the contract record in 100.0% of 40 verify-hook sessions (bar 90%): ok
STAGE1 A3 sol: verify-prose edited a file in 100.0% of 40 (bar 80%): ok
STAGE1 A4 sol: d verify-prose vs verify-hook 0.025, 80% [0.000, 0.059] (40 tasks); d0 none vs plain-2 0.075, 80% [0.026, 0.125] (40); adherence gap verify-hook minus verify-prose 7.5 points, 80% [0.0, 14.3] (40 tasks with an edit in both)
STAGE1 FIT sol S1 (4 tasks, tests PASS on the probe edit): verify-prose ran the rule in 2 of 4 sessions with an edit; verify-hook ran it in 3 of 4, and its hook blocked a /verify run in 0 of 4 sessions (0 blocks)
STAGE1 FIT sol S2 (7 tasks, tests FAIL, already failing at base): verify-prose ran the rule in 3 of 7 sessions with an edit; verify-hook ran it in 4 of 7, and its hook blocked a /verify run in 0 of 7 sessions (0 blocks)
STAGE1 FIT sol S3 (0 tasks, tests FAIL, base passes): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT sol S4 (0 tasks, tests ran no test, lint or typecheck gives PASS/FAIL): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT sol S5 (9 tasks, no check gives PASS/FAIL): verify-prose ran the rule in 9 of 9 sessions with an edit; verify-hook ran it in 9 of 9, and its hook blocked a /verify run in 0 of 9 sessions (0 blocks)
STAGE1 FIT sol U1 (19 tasks, unmeasured: no tracked module a test_<name>.py names): verify-prose ran the rule in 17 of 19 sessions with an edit; verify-hook ran it in 19 of 19, and its hook blocked a /verify run in 1 of 19 sessions (1 blocks)
STAGE1 FIT sol U2 (1 tasks, unmeasured: no pytest in the testbed env): verify-prose ran the rule in 1 of 1 sessions with an edit; verify-hook ran it in 0 of 1, and its hook blocked a /verify run in 0 of 1 sessions (0 blocks)
STAGE1 FIT sol no class (0 tasks, no fit row or none of the seven): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT sol lint or typecheck only: 0 of 67 rule runs rest only on a CHECK lint or CHECK typecheck line (verify-prose 0 of 32, verify-hook 0 of 35)
STAGE1 A1 p1: none passed 75.0% of 40 (bar 15% to 90%): ok
STAGE1 A2 p1: verify-prose ran the rule in 89.5% of 38 sessions with an edit (bar at most 90%): ok; /verify loaded in 100.0% of 80 told sessions and the contract record in 100.0% of 40 verify-hook sessions (bar 90%): ok
STAGE1 A3 p1: verify-prose edited a file in 95.0% of 40 (bar 80%): ok
STAGE1 A4 p1: d verify-prose vs verify-hook 0.075, 80% [0.026, 0.125] (40 tasks); d0 none vs plain-2 0.154, 80% [0.087, 0.225] (39); adherence gap verify-hook minus verify-prose 2.6 points, 80% [0.0, 6.1] (38 tasks with an edit in both)
STAGE1 FIT p1 S1 (4 tasks, tests PASS on the probe edit): verify-prose ran the rule in 3 of 4 sessions with an edit; verify-hook ran it in 4 of 4, and its hook blocked a /verify run in 0 of 4 sessions (0 blocks)
STAGE1 FIT p1 S2 (7 tasks, tests FAIL, already failing at base): verify-prose ran the rule in 4 of 6 sessions with an edit; verify-hook ran it in 4 of 6, and its hook blocked a /verify run in 0 of 7 sessions (0 blocks)
STAGE1 FIT p1 S3 (0 tasks, tests FAIL, base passes): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT p1 S4 (0 tasks, tests ran no test, lint or typecheck gives PASS/FAIL): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT p1 S5 (9 tasks, no check gives PASS/FAIL): verify-prose ran the rule in 9 of 9 sessions with an edit; verify-hook ran it in 9 of 9, and its hook blocked a /verify run in 0 of 9 sessions (0 blocks)
STAGE1 FIT p1 U1 (19 tasks, unmeasured: no tracked module a test_<name>.py names): verify-prose ran the rule in 18 of 18 sessions with an edit; verify-hook ran it in 19 of 19, and its hook blocked a /verify run in 0 of 19 sessions (0 blocks)
STAGE1 FIT p1 U2 (1 tasks, unmeasured: no pytest in the testbed env): verify-prose ran the rule in 0 of 1 sessions with an edit; verify-hook ran it in 0 of 1, and its hook blocked a /verify run in 0 of 1 sessions (0 blocks)
STAGE1 FIT p1 no class (0 tasks, no fit row or none of the seven): verify-prose ran the rule in 0 of 0 sessions with an edit; verify-hook ran it in 0 of 0, and its hook blocked a /verify run in 0 of 0 sessions (0 blocks)
STAGE1 FIT p1 lint or typecheck only: 0 of 70 rule runs rest only on a CHECK lint or CHECK typecheck line (verify-prose 0 of 34, verify-hook 0 of 36)
STAGE1 A4 pooled: d verify-prose vs verify-hook 0.042, 80% [0.018, 0.068]; shipping test IN: the upper end is at most 0.20; d0 none vs plain-2 0.092, 80% [0.060, 0.126]
STAGE1 A4 H2 MDD at the measured d0 0.092: E's pooled MDD 3.3 points at picker accuracy 0.6, 3.3 points at picker accuracy 0.8 (power.py sim_e at f 0.32, 200 tasks per model and its three base rates)
STAGE1 A4 adherence gap pooled 5.9 points, 80% [3.6, 8.5], beside the pooled H1 adherence MDD 3.6 points at the measured adherence discordance 0.093 (power.py mdd, 570 sessions with an edit)
STAGE1 A5 opus: picker replies parsed 100.0% of 40 (bar 95%): ok
STAGE1 A5 sol: picker replies parsed 100.0% of 40 (bar 95%): ok
STAGE1 A5 p1: picker replies parsed 100.0% of 39 (bar 95%): ok
STAGE1 A6 all-in projection from Stage 1's measured rates: $1581 (Stage 1 spent $167) against the $3000 line: inside
