# Manipulation check

## Pilot (laneb3-pilot, 20 trials)

| Model | Arm | Sessions | Body loads | Body-load rate | Median first-req prompt tokens | Passes 90% |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | gstack | 5 | 5 | 100% | 34157 | yes |
| claude-sonnet-5-5 | placebo | 5 | 5 | 100% | 34415 | yes |
| particle-1 | gstack | 5 | 5 | 100% | 93283 | yes |
| particle-1 | placebo | 5 | 5 | 100% | 105288 | yes |

Per model, pooled over invoked (gstack and placebo) trials, gate at 90%:
| Model | Invoked sessions | Body loads | Body-load rate | Passes |
|---|---|---|---|---|
| claude-sonnet-5-5 | 10 | 10 | 100% | yes |
| particle-1 | 10 | 10 | 100% | yes |

Gate (grid runs unless every pilot model is under 90%): pass, grid runs.

## Grid (all grid jobs)

| Model | Arm | Sessions | Body loads | Body-load rate | Median first-req prompt tokens | Passes 90% |
|---|---|---|---|---|---|---|
| claude-haiku-5-5 | gstack | 117 | 117 | 100% | 34256 | yes |
| claude-haiku-5-5 | none | 117 | 0 | n/a | 20565 | n/a |
| claude-haiku-5-5 | placebo | 117 | 117 | 100% | 34514 | yes |
| claude-opus-5-5 | none | 117 | 0 | n/a | 20562 | n/a |
| claude-sonnet-5-5 | gstack | 117 | 117 | 100% | 34259 | yes |
| claude-sonnet-5-5 | none | 117 | 0 | n/a | 20568 | n/a |
| claude-sonnet-5-5 | placebo | 117 | 117 | 100% | 34517 | yes |
| deepseek-v4.1-flash-1017 | gstack | 117 | 117 | 100% | 93545 | yes |
| deepseek-v4.1-flash-1017 | none | 117 | 0 | n/a | 57959 | n/a |
| deepseek-v4.1-flash-1017 | placebo | 117 | 117 | 100% | 105550 | yes |
| particle-1 | gstack | 116 | 116 | 100% | 93523 | yes |
| particle-1 | none | 117 | 0 | n/a | 57937 | n/a |
| particle-1 | placebo | 117 | 117 | 100% | 105528 | yes |

Per model, pooled over invoked (gstack and placebo) trials, gate at 90%:
| Model | Invoked sessions | Body loads | Body-load rate | Passes |
|---|---|---|---|---|
| claude-haiku-5-5 | 234 | 234 | 100% | yes |
| claude-opus-5-5 | 0 | 0 | n/a | no |
| claude-sonnet-5-5 | 234 | 234 | 100% | yes |
| deepseek-v4.1-flash-1017 | 234 | 234 | 100% | yes |
| particle-1 | 233 | 233 | 100% | yes |

Gate (grid runs unless every pilot model is under 90%): pass, grid runs. Models not measuring skill bodies (grid cells labeled): claude-opus-5-5.
