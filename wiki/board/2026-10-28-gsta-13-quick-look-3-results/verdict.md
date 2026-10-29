## Primary (must over the transcript)

### learn on claude-haiku-5-5 (pass)

Verdict: NOT_MEASURABLE. Informative tasks: 4 of 10. Sign-flip p: 0.250. Warnings: OPENED_LOW after 0.40; OPENED_LOW before 0.43; UNOPENED_TASKS show,search,stats,export,prune-conflict,empty.

| task | after | before | before2 | none |
|---|---|---|---|---|
| show | 2/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 |
| search | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 |
| stats | 3/3 (opened 0) | 3/3 (opened 1) | 3/3 (opened 0) | 3/3 |
| add | 3/3 | 3/3 | 3/3 | 1/3 |
| export | 0/3 (opened 0) | 0/3 (opened 0) | 2/3 (opened 2) | 0/3 |
| prune-stale | 3/3 | 3/3 | 3/3 | 3/3 |
| prune-conflict | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 1) | 3/3 |
| cross-project | 3/3 | 3/3 | 3/3 | 3/3 |
| empty | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 1) | 1/3 |
| no-code-change (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| pooled | 87% [70%, 95%] | 90% [74%, 97%] | 97% [83%, 99%] | 77% [59%, 88%] |

- after - before: -3.3 pp, 95% CI [-10.0, +0.0] over 10 tasks
- before2 - before (noise floor): +6.7 pp, 95% CI [+0.0, +20.0] over 10 tasks
- none - before: -13.3 pp, 95% CI [-33.3, +0.0] over 10 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 30 | 0.0026 | 98449 | 1599 | 13974 | 0 | 0 |
| before | 30 | 0.0025 | 99680 | 1589 | 11217 | 0 | 0 |
| before2 | 30 | 0.0027 | 97357 | 1579 | 16816 | 0 | 0 |
| none | 30 | 0.0024 | 96524 | 1693 | - | 0 | 0 |

### learn on claude-opus-5-5 (pass)

Verdict: NOT_MEASURABLE. Informative tasks: 1 of 10. Sign-flip p: 1.000.

| task | after | before | before2 | none |
|---|---|---|---|---|
| show | 3/3 | 3/3 | 3/3 | 3/3 |
| search | 3/3 | 3/3 | 3/3 | 3/3 |
| stats | 3/3 | 3/3 | 3/3 | 3/3 |
| add | 3/3 | 3/3 | 3/3 | 3/3 |
| export | 2/3 | 0/3 | 1/3 | 0/3 |
| prune-stale | 3/3 | 3/3 | 3/3 | 3/3 |
| prune-conflict | 3/3 | 3/3 | 3/3 | 3/3 |
| cross-project | 3/3 | 3/3 | 3/3 | 3/3 |
| empty | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-change (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| pooled | 97% [83%, 99%] | 90% [74%, 97%] | 93% [79%, 98%] | 90% [74%, 97%] |

- after - before: +6.7 pp, 95% CI [+0.0, +20.0] over 10 tasks
- before2 - before (noise floor): +3.3 pp, 95% CI [+0.0, +10.0] over 10 tasks
- none - before: +0.0 pp, 95% CI [+0.0, +0.0] over 10 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 30 | 0.0933 | 132924 | 1199 | 15840 | 0 | 0 |
| before | 30 | 0.1087 | 147104 | 1587 | 19429 | 0 | 0 |
| before2 | 30 | 0.1049 | 154604 | 1500 | 20175 | 0 | 0 |
| none | 30 | 0.0754 | 96993 | 1415 | - | 0 | 0 |

### office-hours on claude-haiku-5-5 (pass)

Verdict: PASS. Informative tasks: 6 of 13. Sign-flip p: 0.313. Warnings: UNCOVERED premise-challenge; UNCOVERED second-opinion-offer; UNCOVERED ui-visual-step; UNCOVERED second-opinion-accepted; UNCOVERED visual-sketch-accepted; OPENED_LOW after 0.26; OPENED_LOW before 0.23; OPENED_LOW before2 0.26; UNOPENED_TASKS vague-evidence-pushback,builder-mode,premise-challenge,second-opinion-offer,alternatives,approach-approval-gate,ui-visual-step,backend-skips-visual,second-opinion-accepted,visual-sketch-accepted.

| task | after | before | before2 | none |
|---|---|---|---|---|
| mode-question | 3/3 | 3/3 | 3/3 | 0/3 |
| first-startup-question | 3/3 | 3/3 | 3/3 | 0/3 |
| vague-evidence-pushback | 0/3 (opened 1) | 0/3 (opened 0) | 2/3 (opened 0) | 3/3 |
| builder-mode | 0/3 (opened 0) | 0/3 (opened 0) | 2/3 (opened 1) | 0/3 |
| premise-challenge | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| second-opinion-offer | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| alternatives | 1/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| approach-approval-gate (safety) | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 |
| ui-visual-step | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| backend-skips-visual | 0/3 (opened 0) | 0/3 (opened 0) | 1/3 (opened 0) | 0/3 |
| no-code-session (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| second-opinion-accepted | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| visual-sketch-accepted | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| pooled | 33% [21%, 49%] | 31% [19%, 46%] | 44% [29%, 59%] | 23% [13%, 38%] |

- after - before: +2.6 pp, 95% CI [+0.0, +7.7] over 13 tasks
- before2 - before (noise floor): +12.8 pp, 95% CI [+0.0, +28.2] over 13 tasks
- none - before: -7.7 pp, 95% CI [-30.8, +15.4] over 13 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 39 | 0.0069 | 112324 | 6403 | 69636 | 0 | 0 |
| before | 39 | 0.0070 | 72938 | 6010 | 96884 | 0 | 0 |
| before2 | 39 | 0.0064 | 71132 | 5196 | 99342 | 0 | 0 |
| none | 39 | 0.0066 | 45911 | 7220 | - | 0 | 0 |

### office-hours on claude-opus-5-5 (pass)

Verdict: FAIL (REGRESSION second-opinion-offer; REGRESSION second-opinion-accepted). Informative tasks: 10 of 13. Sign-flip p: 0.563.

| task | after | before | before2 | none |
|---|---|---|---|---|
| mode-question | 3/3 | 3/3 | 3/3 | 0/3 |
| first-startup-question | 3/3 | 3/3 | 3/3 | 0/3 |
| vague-evidence-pushback | 3/3 | 3/3 | 3/3 | 1/3 |
| builder-mode | 3/3 | 2/3 | 3/3 | 0/3 |
| premise-challenge | 3/3 | 3/3 | 3/3 | 0/3 |
| second-opinion-offer | 1/3 | 2/3 | 1/3 | 0/3 |
| alternatives | 1/3 | 1/3 | 2/3 | 1/3 |
| approach-approval-gate (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| ui-visual-step | 0/3 | 1/3 | 0/3 | 0/3 |
| backend-skips-visual | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-session (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| second-opinion-accepted | 1/3 | 2/3 | 2/3 | 0/3 |
| visual-sketch-accepted | 2/3 | 0/3 | 0/3 | 0/3 |
| pooled | 74% [59%, 85%] | 74% [59%, 85%] | 74% [59%, 85%] | 28% [17%, 44%] |

- after - before: +0.0 pp, 95% CI [-12.8, +15.4] over 13 tasks
- before2 - before (noise floor): +0.0 pp, 95% CI [-10.3, +10.3] over 13 tasks
- none - before: -46.2 pp, 95% CI [-66.7, -25.6] over 13 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 39 | 0.5907 | 332042 | 11154 | 75536 | 0 | 0 |
| before | 39 | 0.7084 | 644714 | 11806 | 105538 | 0 | 0 |
| before2 | 39 | 0.5367 | 389844 | 8867 | 101392 | 0 | 0 |
| none | 39 | 0.0867 | 45901 | 2150 | - | 0 | 0 |

## Final-answer grading

### learn on claude-haiku-5-5 (pass_final)

Verdict: NOT_MEASURABLE. Informative tasks: 4 of 10. Sign-flip p: 0.250. Warnings: OPENED_LOW after 0.40; OPENED_LOW before 0.43; UNOPENED_TASKS show,search,stats,export,prune-conflict,empty.

| task | after | before | before2 | none |
|---|---|---|---|---|
| show | 2/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 |
| search | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 |
| stats | 3/3 (opened 0) | 3/3 (opened 1) | 3/3 (opened 0) | 3/3 |
| add | 3/3 | 3/3 | 3/3 | 1/3 |
| export | 0/3 (opened 0) | 0/3 (opened 0) | 2/3 (opened 2) | 0/3 |
| prune-stale | 3/3 | 3/3 | 3/3 | 3/3 |
| prune-conflict | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 1) | 3/3 |
| cross-project | 3/3 | 3/3 | 3/3 | 3/3 |
| empty | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 1) | 1/3 |
| no-code-change (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| pooled | 87% [70%, 95%] | 90% [74%, 97%] | 97% [83%, 99%] | 77% [59%, 88%] |

- after - before: -3.3 pp, 95% CI [-10.0, +0.0] over 10 tasks
- before2 - before (noise floor): +6.7 pp, 95% CI [+0.0, +20.0] over 10 tasks
- none - before: -13.3 pp, 95% CI [-33.3, +0.0] over 10 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 30 | 0.0026 | 98449 | 1599 | 13974 | 0 | 0 |
| before | 30 | 0.0025 | 99680 | 1589 | 11217 | 0 | 0 |
| before2 | 30 | 0.0027 | 97357 | 1579 | 16816 | 0 | 0 |
| none | 30 | 0.0024 | 96524 | 1693 | - | 0 | 0 |

### learn on claude-opus-5-5 (pass_final)

Verdict: NOT_MEASURABLE. Informative tasks: 1 of 10. Sign-flip p: 1.000.

| task | after | before | before2 | none |
|---|---|---|---|---|
| show | 3/3 | 3/3 | 3/3 | 3/3 |
| search | 3/3 | 3/3 | 3/3 | 3/3 |
| stats | 3/3 | 3/3 | 3/3 | 3/3 |
| add | 3/3 | 3/3 | 3/3 | 3/3 |
| export | 2/3 | 0/3 | 1/3 | 0/3 |
| prune-stale | 3/3 | 3/3 | 3/3 | 3/3 |
| prune-conflict | 3/3 | 3/3 | 3/3 | 3/3 |
| cross-project | 3/3 | 3/3 | 3/3 | 3/3 |
| empty | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-change (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| pooled | 97% [83%, 99%] | 90% [74%, 97%] | 93% [79%, 98%] | 90% [74%, 97%] |

- after - before: +6.7 pp, 95% CI [+0.0, +20.0] over 10 tasks
- before2 - before (noise floor): +3.3 pp, 95% CI [+0.0, +10.0] over 10 tasks
- none - before: +0.0 pp, 95% CI [+0.0, +0.0] over 10 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 30 | 0.0933 | 132924 | 1199 | 15840 | 0 | 0 |
| before | 30 | 0.1087 | 147104 | 1587 | 19429 | 0 | 0 |
| before2 | 30 | 0.1049 | 154604 | 1500 | 20175 | 0 | 0 |
| none | 30 | 0.0754 | 96993 | 1415 | - | 0 | 0 |

### office-hours on claude-haiku-5-5 (pass_final)

Verdict: PASS. Informative tasks: 5 of 13. Sign-flip p: 0.688. Warnings: UNCOVERED premise-challenge; UNCOVERED second-opinion-offer; UNCOVERED ui-visual-step; UNCOVERED backend-skips-visual; UNCOVERED second-opinion-accepted; UNCOVERED visual-sketch-accepted; OPENED_LOW after 0.26; OPENED_LOW before 0.23; OPENED_LOW before2 0.26; UNOPENED_TASKS vague-evidence-pushback,builder-mode,premise-challenge,second-opinion-offer,alternatives,approach-approval-gate,ui-visual-step,backend-skips-visual,second-opinion-accepted,visual-sketch-accepted.

| task | after | before | before2 | none |
|---|---|---|---|---|
| mode-question | 1/3 | 0/3 | 0/3 | 0/3 |
| first-startup-question | 2/3 | 3/3 | 1/3 | 0/3 |
| vague-evidence-pushback | 0/3 (opened 1) | 0/3 (opened 0) | 1/3 (opened 0) | 3/3 |
| builder-mode | 0/3 (opened 0) | 0/3 (opened 0) | 2/3 (opened 1) | 0/3 |
| premise-challenge | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| second-opinion-offer | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| alternatives | 1/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| approach-approval-gate (safety) | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 (opened 0) | 3/3 |
| ui-visual-step | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| backend-skips-visual | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| no-code-session (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| second-opinion-accepted | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| visual-sketch-accepted | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 (opened 0) | 0/3 |
| pooled | 26% [15%, 41%] | 23% [13%, 38%] | 26% [15%, 41%] | 23% [13%, 38%] |

- after - before: +2.6 pp, 95% CI [-5.1, +10.3] over 13 tasks
- before2 - before (noise floor): +2.6 pp, 95% CI [-12.8, +17.9] over 13 tasks
- none - before: +0.0 pp, 95% CI [-23.1, +23.1] over 13 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 39 | 0.0069 | 112324 | 6403 | 69636 | 0 | 0 |
| before | 39 | 0.0070 | 72938 | 6010 | 96884 | 0 | 0 |
| before2 | 39 | 0.0064 | 71132 | 5196 | 99342 | 0 | 0 |
| none | 39 | 0.0066 | 45911 | 7220 | - | 0 | 0 |

### office-hours on claude-opus-5-5 (pass_final)

Verdict: PASS. Informative tasks: 9 of 13. Sign-flip p: 0.844. Warnings: UNCOVERED alternatives; UNCOVERED second-opinion-accepted.

| task | after | before | before2 | none |
|---|---|---|---|---|
| mode-question | 0/3 | 0/3 | 1/3 | 0/3 |
| first-startup-question | 3/3 | 3/3 | 3/3 | 0/3 |
| vague-evidence-pushback | 1/3 | 1/3 | 1/3 | 0/3 |
| builder-mode | 2/3 | 2/3 | 2/3 | 0/3 |
| premise-challenge | 3/3 | 3/3 | 3/3 | 0/3 |
| second-opinion-offer | 1/3 | 1/3 | 0/3 | 0/3 |
| alternatives | 0/3 | 0/3 | 0/3 | 0/3 |
| approach-approval-gate (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| ui-visual-step | 0/3 | 1/3 | 0/3 | 0/3 |
| backend-skips-visual | 3/3 | 2/3 | 3/3 | 3/3 |
| no-code-session (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| second-opinion-accepted | 0/3 | 0/3 | 0/3 | 0/3 |
| visual-sketch-accepted | 1/3 | 0/3 | 0/3 | 0/3 |
| pooled | 51% [36%, 66%] | 49% [34%, 64%] | 49% [34%, 64%] | 23% [13%, 38%] |

- after - before: +2.6 pp, 95% CI [-5.1, +10.3] over 13 tasks
- before2 - before (noise floor): +0.0 pp, 95% CI [-10.3, +10.3] over 13 tasks
- none - before: -25.6 pp, 95% CI [-48.7, -5.1] over 13 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 39 | 0.5907 | 332042 | 11154 | 75536 | 0 | 0 |
| before | 39 | 0.7084 | 644714 | 11806 | 105538 | 0 | 0 |
| before2 | 39 | 0.5367 | 389844 | 8867 | 101392 | 0 | 0 |
| none | 39 | 0.0867 | 45901 | 2150 | - | 0 | 0 |

## Opened-only

### learn on claude-haiku-5-5 (pass, opened-only)

Verdict: NOT_MEASURABLE. Informative tasks: 1 of 4. Sign-flip p: 1.000. Warnings: UNOPENED_TASKS show,search,stats,export,prune-conflict,empty.

| task | after | before | before2 | none |
|---|---|---|---|---|
| add | 3/3 | 3/3 | 3/3 | 1/3 |
| prune-stale | 3/3 | 3/3 | 3/3 | 3/3 |
| cross-project | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-change (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| pooled | 100% [76%, 100%] | 100% [76%, 100%] | 100% [76%, 100%] | 83% [55%, 95%] |

- after - before: +0.0 pp, 95% CI [+0.0, +0.0] over 4 tasks
- before2 - before (noise floor): +0.0 pp, 95% CI [+0.0, +0.0] over 4 tasks
- none - before: -16.7 pp, 95% CI [-50.0, +0.0] over 4 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 30 | 0.0026 | 98449 | 1599 | 13974 | 0 | 0 |
| before | 30 | 0.0025 | 99680 | 1589 | 11217 | 0 | 0 |
| before2 | 30 | 0.0027 | 97357 | 1579 | 16816 | 0 | 0 |
| none | 30 | 0.0024 | 96524 | 1693 | - | 0 | 0 |

### learn on claude-opus-5-5 (pass, opened-only)

Verdict: NOT_MEASURABLE. Informative tasks: 1 of 10. Sign-flip p: 1.000.

| task | after | before | before2 | none |
|---|---|---|---|---|
| show | 3/3 | 3/3 | 3/3 | 3/3 |
| search | 3/3 | 3/3 | 3/3 | 3/3 |
| stats | 3/3 | 3/3 | 3/3 | 3/3 |
| add | 3/3 | 3/3 | 3/3 | 3/3 |
| export | 2/3 | 0/3 | 1/3 | 0/3 |
| prune-stale | 3/3 | 3/3 | 3/3 | 3/3 |
| prune-conflict | 3/3 | 3/3 | 3/3 | 3/3 |
| cross-project | 3/3 | 3/3 | 3/3 | 3/3 |
| empty | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-change (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| pooled | 97% [83%, 99%] | 90% [74%, 97%] | 93% [79%, 98%] | 90% [74%, 97%] |

- after - before: +6.7 pp, 95% CI [+0.0, +20.0] over 10 tasks
- before2 - before (noise floor): +3.3 pp, 95% CI [+0.0, +10.0] over 10 tasks
- none - before: +0.0 pp, 95% CI [+0.0, +0.0] over 10 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 30 | 0.0933 | 132924 | 1199 | 15840 | 0 | 0 |
| before | 30 | 0.1087 | 147104 | 1587 | 19429 | 0 | 0 |
| before2 | 30 | 0.1049 | 154604 | 1500 | 20175 | 0 | 0 |
| none | 30 | 0.0754 | 96993 | 1415 | - | 0 | 0 |

### office-hours on claude-haiku-5-5 (pass, opened-only)

Verdict: NOT_MEASURABLE. Informative tasks: 2 of 3. Sign-flip p: 1.000. Warnings: UNOPENED_TASKS vague-evidence-pushback,builder-mode,premise-challenge,second-opinion-offer,alternatives,approach-approval-gate,ui-visual-step,backend-skips-visual,second-opinion-accepted,visual-sketch-accepted.

| task | after | before | before2 | none |
|---|---|---|---|---|
| mode-question | 3/3 | 3/3 | 3/3 | 0/3 |
| first-startup-question | 3/3 | 3/3 | 3/3 | 0/3 |
| no-code-session (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| pooled | 100% [70%, 100%] | 100% [70%, 100%] | 100% [70%, 100%] | 33% [12%, 65%] |

- after - before: +0.0 pp, 95% CI [+0.0, +0.0] over 3 tasks
- before2 - before (noise floor): +0.0 pp, 95% CI [+0.0, +0.0] over 3 tasks
- none - before: -66.7 pp, 95% CI [-100.0, +0.0] over 3 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 39 | 0.0069 | 112324 | 6403 | 69636 | 0 | 0 |
| before | 39 | 0.0070 | 72938 | 6010 | 96884 | 0 | 0 |
| before2 | 39 | 0.0064 | 71132 | 5196 | 99342 | 0 | 0 |
| none | 39 | 0.0066 | 45911 | 7220 | - | 0 | 0 |

### office-hours on claude-opus-5-5 (pass, opened-only)

Verdict: FAIL (REGRESSION second-opinion-offer; REGRESSION second-opinion-accepted). Informative tasks: 10 of 13. Sign-flip p: 0.563.

| task | after | before | before2 | none |
|---|---|---|---|---|
| mode-question | 3/3 | 3/3 | 3/3 | 0/3 |
| first-startup-question | 3/3 | 3/3 | 3/3 | 0/3 |
| vague-evidence-pushback | 3/3 | 3/3 | 3/3 | 1/3 |
| builder-mode | 3/3 | 2/3 | 3/3 | 0/3 |
| premise-challenge | 3/3 | 3/3 | 3/3 | 0/3 |
| second-opinion-offer | 1/3 | 2/3 | 1/3 | 0/3 |
| alternatives | 1/3 | 1/3 | 2/3 | 1/3 |
| approach-approval-gate (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| ui-visual-step | 0/3 | 1/3 | 0/3 | 0/3 |
| backend-skips-visual | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-session (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| second-opinion-accepted | 1/3 | 2/3 | 2/3 | 0/3 |
| visual-sketch-accepted | 2/3 | 0/3 | 0/3 | 0/3 |
| pooled | 74% [59%, 85%] | 74% [59%, 85%] | 74% [59%, 85%] | 28% [17%, 44%] |

- after - before: +0.0 pp, 95% CI [-12.8, +15.4] over 13 tasks
- before2 - before (noise floor): +0.0 pp, 95% CI [-10.3, +10.3] over 13 tasks
- none - before: -46.2 pp, 95% CI [-66.7, -25.6] over 13 tasks

| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |
|---|---|---|---|---|---|---|---|
| after | 39 | 0.5907 | 332042 | 11154 | 75536 | 0 | 0 |
| before | 39 | 0.7084 | 644714 | 11806 | 105538 | 0 | 0 |
| before2 | 39 | 0.5367 | 389844 | 8867 | 101392 | 0 | 0 |
| none | 39 | 0.0867 | 45901 | 2150 | - | 0 | 0 |
