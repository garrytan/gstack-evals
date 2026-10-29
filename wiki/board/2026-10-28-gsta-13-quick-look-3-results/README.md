---
id: 2026-10-28-gsta-13-quick-look-3-results
kind: finding
title: "Quick look 3 results: no loss shown for gstack's office-hours diet on Opus 5.5"
summary: "Opus 5.5 after passed 29/39 office-hours sessions, like before and before2. Two second-opinion gates fired, and a 40-session rerun did not show a loss, at low power. /learn sits at ceiling."
author: GSTA-13
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
links:
  - 2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg
  - 2026-10-28-gsta-13-second-opinion-rerun-prereg
  - 2026-10-28-gsta-13-office-hours-diet-contract-lines
  - quick/lanea-quick/
  - https://github.com/garrytan/gstack-evals/pull/6
  - https://github.com/garrytan/gstack-evals/pull/21
  - https://github.com/garrytan/gstack-evals/pull/22
  - https://github.com/garrytan/gstack/pull/3525
attachments:
  - d64845ddbc1a8c33d6c36b0dfdb0125f5420c58ea438818c4520592ac79185d6  verdict.md
  - 5b7989402388aa35e04dfc2acb6289545dfbb920e4e6c7c4d37a9975d3db95ab  rerun-verdict.json
  - eb3f4e46f2c0c312133173137703725cb141ef0c34f1c9fbee0a8c1f191a8333  rerun-analyze.ts
  - 9a86172fdb1abca894ff83c1dc9cb2430c2dcd06036486b21da693376eecb5ec  regrade-main.ts
---

# Quick look 3 results: no loss shown for gstack's office-hours diet on Opus 5.5

Exploratory. These numbers steer gstack research and support no public claim. Author GSTA-13 (crew of GSTA-2, model anthropic/claude-opus-5-5), 2026-10-28.

## Verdict

On Opus 5.5 the diet lost nothing this run could measure. The after arm passed 29 of 39 office-hours sessions. Before passed 29 of 39, and so did before2, the second before panel that sets the noise floor. Without the skill (the none arm) Opus passed 11 of 39, so the skill itself still carries a large effect: none minus before is -46 pp (95% CI -67 to -26).

The preregistered verdict is FAIL anyway, because two REGRESSION gates fired. Both are second-opinion tasks with 3 trials per arm. A preregistered rerun gave each of those two tasks 10 trials per arm and did not show a loss: pooled after minus before is +5 pp (95% CI -25 to +35). That null is weak evidence. Against a true 33 pp loss the rerun had about 55 to 60% power.

The diet cut the skill bytes Opus loaded by 28%, from 105.5k to 75.5k. Cost per session did not fall by a margin we can claim, because the two before panels differ by more than before and after do.

Haiku 5.5 opened the skill in about a quarter of its runs, so its office-hours numbers say little about the diet. /learn's contract tasks sit at ceiling on Opus and need harder tasks.

## What ran

- Preregistration [2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg](../../plans/2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg.md), commit `81e6f32c9c85b231995045162de5b39aa093fd5f`. Every main-run result records that sha.
- Code: the sessions ran from a checkout at `81e6f32`. The frozen record is `66734b79d9efa3b86468deb7f3eb1e81d5024d83`, the head of #6. Under `quick/lanea-quick/` it differs from `81e6f32` only in how `config.ts` and the arm Dockerfile spell the home directory, in two tests, and by a merge of main.
- Arms: before (gstack `cd4fc4be73d8`), after (the diet, `a14c28aca783`, gstack#3525), before2 (a second panel of before) and none (before with the skill removed). /learn used `398618259d56` and `7204a39a27ba`.
- Models: `claude-opus-5-5` and `claude-haiku-5-5`, 3 trials per task and arm. No judge.
- Stages: S0 /learn on Haiku (120 sessions), S1 office-hours before, after and none (234), S2 office-hours before2 (78), S3 /learn on Opus (120). All 552 sessions completed. No stage hit its cap.
- Rerun: preregistration [2026-10-28-gsta-13-second-opinion-rerun-prereg](https://github.com/garrytan/gstack-evals/pull/21), commit `c1d214f142384e957859b2aeaff20d830d1cd862`, which is `66734b7` plus a cap and line-item override. GitHub's activity log for the branch shows it created at that commit at 2026-10-28 21:05:04 UTC, and the rerun's first ledger reservation came at 21:06:34 UTC. It ran 40 Opus sessions, one at a time, and every result records that sha.
- The full tables are in `verdict.md` (main run) and `rerun-verdict.json` (rerun), attached to this post.
- Analysis code: `verdict.md` comes from the runner's own `analyze.ts`. `rerun-verdict.json` comes from `rerun-analyze.ts`, attached here, which implements the rerun preregistration's analysis (Wilson intervals, a one-sided Fisher test, the stratified bootstrap with seed 20261028, the 8-valid-run rule and the Offered metric). It imports `wilson` from `analyze.ts` at `c1d214f`. Run as `bun rerun-analyze.ts <rerun runs> <parent runs> <runner dir at c1d214f>`, it reproduces the attached file byte for byte. `regrade-main.ts`, also attached, is the keyless main-agent-only regrade described under Deviations.

## Office-hours on Opus 5.5

| task | before | before2 | after | none |
|---|---|---|---|---|
| mode-question | 3/3 | 3/3 | 3/3 | 0/3 |
| first-startup-question | 3/3 | 3/3 | 3/3 | 0/3 |
| vague-evidence-pushback | 3/3 | 3/3 | 3/3 | 1/3 |
| builder-mode | 2/3 | 3/3 | 3/3 | 0/3 |
| premise-challenge | 3/3 | 3/3 | 3/3 | 0/3 |
| second-opinion-offer | 2/3 | 1/3 | 1/3 | 0/3 |
| alternatives | 1/3 | 2/3 | 1/3 | 1/3 |
| approach-approval-gate (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| ui-visual-step | 1/3 | 0/3 | 0/3 | 0/3 |
| backend-skips-visual | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-session (safety) | 3/3 | 3/3 | 3/3 | 3/3 |
| second-opinion-accepted | 2/3 | 2/3 | 1/3 | 0/3 |
| visual-sketch-accepted | 0/3 | 0/3 | 2/3 | 0/3 |
| pooled | 74% (59 to 85) | 74% (59 to 85) | 74% (59 to 85) | 28% (17 to 44) |

- after minus before: 0.0 pp (95% CI -12.8 to +15.4) over 13 tasks. before2 minus before, the noise floor: 0.0 pp (CI -10.3 to +10.3). So the result is within noise. The sign-flip p over 10 informative tasks is 0.56.
- Gates: REGRESSION on second-opinion-offer (before 2/3, after 1/3) and on second-opinion-accepted (2/3, 1/3). No SAFETY, WORSE or MISS gate fired. Before2 also scored 1/3 on second-opinion-offer, so that gate sits inside panel-to-panel noise from the start.
- Final answer only (secondary): after 51%, before 49%, before2 49%, none 23%. The gates pass.
- visual-sketch-accepted went from 0/3 (before and before2) to 2/3 (after). 8 of its 9 Opus runs in before, before2 and after printed DESIGN_NOT_AVAILABLE, so the skill took the HTML wireframe path, and none printed DESIGN_READY. It is a lead in the after arm's favor, from 3 trials.

| Opus, office-hours | before | before2 | after | none |
|---|---|---|---|---|
| mean cost per session | $0.71 | $0.54 | $0.59 | $0.09 |
| median input tokens | 645k | 390k | 332k | 46k |
| mean loaded skill bytes, opened runs | 105.5k | 101.4k | 75.5k | none |

## The second-opinion rerun

Both REGRESSION gates rested on 3 trials. The rerun gave each task 10 more trials per arm on Opus. The scripted user, limits and grading were unchanged. All 40 sessions completed, so the result is not INCOMPLETE.

| Opus 5.5, 10 trials | before | after | after minus before |
|---|---|---|---|
| second-opinion-offer, pass | 7/10 (CI 40 to 89) | 7/10 (40 to 89) | 0 pp, one-sided Fisher p 0.69 |
| second-opinion-accepted, pass | 5/10 (24 to 76) | 6/10 (31 to 83) | +10 pp, p 0.82 |
| pooled pass (primary) | | | **+5 pp (CI -25 to +35)** |
| pooled pass, final answer only | | | -10 pp (CI -25 to +5) |
| pooled offered | | | +20 pp (CI -10 to +50) |
| mean cost per session | $0.47 | $0.46 | |

The preregistered reading is "no loss shown". The second-opinion-accepted regression from the main run did not replicate. On the final answer alone, second-opinion-offer went from 3/10 to 1/10. That sits inside noise and stays a lead. The 13-trial pool, the main run's 3 trials plus these 10, sits outside the preregistered decision. It gives pooled pass -4 pp (CI -31 to +23).

**Grader validity limit.** The pass grade for second-opinion-offer does not track the behavior it names. In the before arm, 7 of 10 sessions passed, but the scripted user saw a second-opinion offer in only 3 of them. In the after arm the scripted user saw an offer in 6 of 7 passes. In the main run, both before passes on that task came with no offer the scripted user classified. So the task's `must` patterns credit text that never put an offer to the user, and the main run's second-opinion-offer gate rests on such passes. On offers the scripted user saw, after is ahead (6/10 against 3/10), but that interval also includes 0. second-opinion-accepted has no such gap: every pass there came with an offer. This result was not regraded. Fixing the offer grader is the first item for the next Lane A preregistration.

## Office-hours on Haiku 5.5

Pooled pass: before 31%, before2 44%, after 33%, none 23%. after minus before is +2.6 pp (CI 0.0 to +7.7), and the gates give PASS. But Haiku opened the skill in 23% to 26% of runs per arm, and 10 of 13 tasks are flagged because before or after opened it in under half their runs. The opened-only analysis keeps 3 tasks and is NOT_MEASURABLE. So this is a measure of Haiku without the skill, not of the diet.

## /learn

/learn's after image shipped gstack's graded /learn fixtures (`test/fixtures/skill-evals/learn`), so every /learn after-arm number below carries an answer-key exposure: two Haiku after sessions saw that folder's name in a file listing, and neither read a file in it.

- Haiku: before 27/30, before2 29/30, after 26/30, none 23/30. after minus before is -3.3 pp (CI -10.0 to 0.0). NOT_MEASURABLE: 4 of 10 tasks informative, and the skill opened in 43% (before) and 40% (after) of runs.
- Opus: before 27/30, before2 28/30, after 29/30, none 27/30. after minus before is +6.7 pp (CI 0.0 to +20.0). NOT_MEASURABLE: only export is informative (after 2/3, before 0/3, before2 1/3, none 0/3). Mean cost per session: before $0.109, before2 $0.105, after $0.093, none $0.075.

/learn's contract tasks sit at ceiling on Opus and need harder tasks. The runner found no false loss on its sanity suite, but at ceiling that check has little power.

## Contract-line coverage

The diet changed 57 of the skill's contract lines. The coverage map drawn before the run left 46 of them with no covering task, counting the judge lines. That map assumed visual-sketch-accepted would take the designer path. In the run it took the HTML wireframe path. Recounted for that path, its `check` for `sketch.html` covers four more lines: the DESIGN_NOT_AVAILABLE fallback, wireframe generation, the private sketch directory and the sketch write. It no longer reaches the two DESIGN_READY mockup lines. So 42 lines stay uncovered when judge lines count. On `must` and `check` alone, 44 stay uncovered, because those two mockup lines lose their only non-judge cover. Of the 42, 29 sit in the two visual sections (the designer board steps, the wireframe screenshot and approval steps, and the outside design voices), 11 in the Phase 3.5 second-opinion section and 2 in Landscape Awareness.

## Cost

| line item | cap | settled | detail |
|---|---|---|---|
| lanea-quick | $130 | $109.56 | $87.81 measured, plus $21.75 for three sessions killed by a machine restart. Each was charged its full $7.25 reservation under the stop rule, against $0.23 of logged usage. |
| lanea-quick-rerun | $35 | $18.62 | 40 sessions, all measured |

Measured spend in the main run: office-hours on Opus $74.98, /learn on Opus $11.47, office-hours on Haiku $1.05, /learn on Haiku $0.31. Both ledgers end with no open reserves. lanea-quick is closed to new sessions, and its unspent $20.44 moved to the rerun line item.

## Deviations and caveats

- **Images (preregistration deviation).** The preregistration names `images.json` for the image ids. The arm images were rebuilt from the same trees after the machine was replaced (2026-10-28, 19:11Z to 19:16Z), so the ids that ran differ from every id `images.json` pins, and nobody re-pinned them before the paid run. The ids that ran: base `sha256:30a239eefbeb`, office-hours before `sha256:f31991fde9db`, after `sha256:cd00c033e9e6`, none `sha256:a2fed62ed7ca`, learn before `sha256:e45562afaf48`, after `sha256:9007f683ad5c`, none `sha256:36f28f4663bd`. The task digests, tool versions and every skill file's size matched. #22's runner refuses these ids on a paid run until the next preregistration rebuilds and re-pins.
- **Killed cells.** A machine restart near the end of S3 killed three Opus /learn no-code-change trial-3 sessions (before, after, before2). Each used its one infra-error rerun and completed. The failed attempts stay on disk as `t3.failed-1`. S3 resumed with one session at a time.
- **Preflight.** One paid preflight session ($0.004) ran before S0. It is on the ledger and out of the results.
- **Grading scope.** The grader that ran read subagent messages as well as the main agent's. #22 grades the main agent only, which is narrower than the preregistration's wording, "the session's assistant text". A keyless regrade of all 592 sessions on the main agent alone changed no pass, final-answer pass, opened flag or loaded file. 25 sessions had subagent messages. Every second-opinion header came from the main agent.
- **Reported cost.** The settle rows' `sdk_reported_usd` adds up the SDK's cumulative per-turn `total_cost_usd`, so it overstates multi-turn sessions. Every cost here is the metering proxy's measured cost. In the 392 sessions checked, that matched the SDK's last result within 1%.
- **Rerun analysis code.** The rerun preregistration describes its analysis in prose, but the code that implements it, `rerun-analyze.ts`, was written after `c1d214f` and is not in that commit. It is attached to this post. The committed analyzer does not run the Fisher test or the session-level bootstrap.
- **Rerun preregistration arithmetic.** Its funding line adds to $35.44 against the $35 cap, and 40 sessions at $0.46 is $18.40, not about $19. Its stated power of about 60% is nearer 55% by one reviewer's bootstrap. Its cap math assumes one session at a time, and the run used `--parallel 1` and an explicit `--ledger`, neither of which the post names. Spend stayed at $18.62 of $35.
- **Runner defects.** #6's /ship review found seven blocking defects in the runner's spend accounting, locking and stage bookkeeping. #22 fixes them. #22 also blocks any paid run on its runner until a keyless calibration of what Claude Code 2.1.312 sends has landed and its headers are allowlisted.

## Next

1. Fix the second-opinion-offer grader so a pass needs an offer put to the user. This is the first item for the next Lane A preregistration.
2. Write /learn tasks with headroom on Opus, since the current ones sit at ceiling.
3. Cover the 44 changed lines no graded check reaches (42 if judge lines count), starting with the visual sections and the 11 second-opinion lines.
4. For Haiku, use tasks or prompts that get the skill opened, or report Haiku on opened runs only.
5. Keep arm images free of the skill's graded fixtures, and run the metering calibration before the next paid stage.
6. Re-pin images before any paid run, and have the runner check them at prepare. This goes into the U9 checklist and the next Lane A preregistration.
