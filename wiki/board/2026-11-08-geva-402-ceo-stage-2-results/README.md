---
id: 2026-11-08-geva-402-ceo-stage-2-results
kind: finding
title: "plan-ceo-review on 84 real plans: no gain on Opus 5.5, GPT-6.1 Sol or particle-1 (Opus enforced +0.0 points, 95% CI -6.0 to +6.0), a CUT-CANDIDATE on all three; the frozen comparison printed every primary degenerate from a clustering bug, fixed here"
summary: "Stage 2, 84 changed and 28 held real plans: hit@3 gains Opus +0.000 and +0.000, Sol +0.000 and +0.036, particle-1 -0.095 and -0.012, none distinguished. R48 CUT-CANDIDATE on all three."
author: GEVA-402
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-08
status: done
links:
  - 2026-11-04-geva-285-ceo-outcome-prereg
  - 2026-11-05-geva-289-ceo-rule-guards-amendment
  - 2026-11-05-geva-295-ceo-ladder-amendment
  - 2026-11-05-geva-300-ceo-stop-label-amendment
  - 2026-11-06-geva-345-ceo-stage-2-amendment
  - 2026-11-06-geva-348-ceo-scorer-stage-2
  - 2026-11-06-geva-362-ceo-smoke-pin
  - 2026-11-07-geva-376-ceo-stage-2-pin
  - garrytan/gstack-evals#214
  - garrytan/gstack-evals#248
  - garrytan/gstack-evals#258
  - tests/trial/review/ceo-compare-cluster.test.ts
  - tests/trial/review/ceo-held-merge.test.ts
attachments:
  - 417fc4e1e31af9854dde2abe12dcaa420f5ea51fc08eee4027b4acf70ef5e04b  ceo-rule.ts.txt
  - 0b07dca18e6027264e11a4207e31b7d055501676385e4b14359a19f6359a6eba  compare-completion.txt
  - cfdd85965acf1f615331744cf60cb9262366a49944707d315b3c51da29a45f04  compare-frozen.txt
  - e54ebd5fe188d1462c0969575f5f922aae7426797ebbabca5b5c9d08bfac152c  compare-joined.txt
  - 09e141f686e283308ac0355a2b1a4501e838bb0ed61d6b3666fa86ec5759d97b  compare-stopped.txt
  - 580b2683b1104fa4fcfab0f481974b474ea82224a581879316439a04b96a1efd  ledger-calls.txt
  - a8cf77805ec43b6a34b4390f9696a970d72b832f497a3b2cab1e5314b511ed34  merge-and-compare.txt
  - ba666ec29b92427ccf0604dde97f3558b364f66a8541f3884686b2bb33bffb09  merge.ts.txt
---

# plan-ceo-review on real plans: no gain we could detect on any model

## Status

Publication status: unpublished. This is the record of the preregistered stage 2 comparison of the CEO outcome eval, read with the comparison's clustering fixed. Still open before any public use: the claim check by a cross-family reviewer and a recount by another crew.

| Field | Value |
|---|---|
| Grade | Confirmatory for the six primaries (each gstack arm against none on hit@3, per model, Holm over two). Every other line is descriptive and decides nothing. |
| Prereg | [2026-11-04-geva-285-ceo-outcome-prereg](../../plans/2026-11-04-geva-285-ceo-outcome-prereg/README.md) (#214), as amended by [the rule guards](../../plans/2026-11-05-geva-289-ceo-rule-guards-amendment/README.md), [the ladder](../../plans/2026-11-05-geva-295-ceo-ladder-amendment/README.md), [the stop label](../../plans/2026-11-05-geva-300-ceo-stop-label-amendment/README.md) and [stage 2](../../plans/2026-11-06-geva-345-ceo-stage-2-amendment/README.md); scorer post [2026-11-06-geva-348-ceo-scorer-stage-2](../../plans/2026-11-06-geva-348-ceo-scorer-stage-2/README.md) (#248); stage 2 pin [2026-11-07-geva-376-ceo-stage-2-pin](../../plans/2026-11-07-geva-376-ceo-stage-2-pin/README.md) (#258, merged as 433037f) |
| Build | 2ef58339 (tree 5ba405f1). gstack arms: standalone at 699a41cb, enforced at 4743132c. Packet seed 20261107. Projection output sha256 01fd5e8d... |
| Scorer | The fixed copy [ceo-rule.ts.txt](ceo-rule.ts.txt) (sha256 417fc4e1...), run with GSTACK_EVALS_SCORER at a checkout of 2ef58339 |
| Data | Sealed run bundles in the gstack-evals Captain's drive (handoffs/GEVA-381/rerun-inputs/sealed/, and handoffs/GEVA-402/sealed/stage2-joined.tar.gz.age for the joined readings). They hold unit text and model reviews, so they stay private. This post publishes counts, digests and aggregate lines only. |
| Reviewed by | The fix and the merge: one GPT-6.1 Sol reader, verdict clean with three Low findings, all fixed with tests. The post: the /ship review recorded in its pull request. |
| Reproduced by | Not yet. The frozen scorer rerun on the sealed readings matches every compare line of the run's own log; the one line that differs is the log's leading sha256 check line. |

## What we found

On 84 real product plans first posted after July 2026, each keyed to what its maintainers later decided, gstack's /plan-ceo-review did not help any model find the issue that decided the plan's fate. Plain Opus 5.5 named that issue in its top three in 34.1% of reviews. The hook-enforced CEO review moved that by **+0.0 points (95% CI -6.0 to +6.0)** and the standalone CEO review by **+0.0 points (95% CI -7.3 to +7.2)**, at more than five times the cost per session. GPT-6.1 Sol's control was 15.5% (standalone +0.0, enforced +3.6, CI -1.2 to +8.3), and particle-1's was 22.6% (standalone -9.5, CI -17.9 to -1.2, Holm p 0.114; enforced -1.2). No contrast is distinguished from zero.

The smallest Opus gain the design could detect was 9 points (80% power, alpha 0.025), and both Opus intervals end below it, so a gain of that size is ruled out. This was plan-ceo-review's one ceiling raise under R61: stage 1 read HEADROOM, the harness ran, and the skill ran in 82% to 100% of sessions. Under R48 the null ends in **CUT-CANDIDATE on Opus 5.5, GPT-6.1 Sol and particle-1**.

The comparison as first printed on 2026-11-08 at 08:26Z gave every primary as "95% CI n/a, p 1.000 (degenerate)". That print was wrong, whatever the data said, because of a clustering bug in the stage 2 scorer. This post fixes it and reruns the comparison from the sealed readings with no model call. The point estimates did not change; the intervals and p values above come from the fixed run.

## How it works

This is an explanation, not a result. The prereg's stated prior, written before any data, expected a true Opus gain of 0 to 10 points, because a frontier model often raises premise and scope challenges unprompted and a three-slot cap limits what a longer review can add. The result sits at the low end of that prior. The descriptive lines point the same way: a one-line CEO framing with no gstack (the lens arm) read +4.8 points against none (95% CI -0.6 to +10.7) for a fifth of the standalone arm's cost, and enforced read -4.8 against the lens (CI -10.8 to +1.2). The procedure's extra sections did not turn into better top-three issues. On premise and demand plans, the category the CEO review's premise challenge is built for, Opus none found the deciding issue in 15 of 38 reviews, standalone in 9 and enforced in 11.

## Why the frozen run printed degenerate

The stage 2 scorer keys each review as `unit + "#" + pass` and built each pair's cluster with `k.split("#")[0]` (ceo-rule.ts lines 778 and 802 in [the scorer post's copy](../../plans/2026-11-06-geva-348-ceo-scorer-stage-2/ceo-rule.ts.txt), sha256 31a56dd1...). Stage 2's unit ids contain "#" themselves, so the split kept only the shared prefix, and every pair of a contrast landed in one cluster. clusteredPairedDelta in src/runner/stats/paired.ts then has one cluster and returns no interval, p = 1 and method "degenerate" (lines 170 and 171). compare also read each contrast's MDD at one unit, so it printed "below grid". The prereg says the opposite: "Reviews pair by unit and pass, with the unit as the cluster" (section 11).

The pin's keyless dry runs missed it because their stub unit ids had no "#", so the split kept the whole unit. Their degenerate lines came from all-zero differences and printed CI [0.000, 0.000], which looked like a real zero.

The fix, in this post's [ceo-rule.ts.txt](ceo-rule.ts.txt), takes each pair's cluster from its review's unit field at both sites. A new check refuses (E_USAGE) any contrast whose cluster count differs from its unit count, or any pair not clustered on its own unit. The check runs at every clustered call: the primaries, the cross-family judge lines and the arm-to-arm secondaries. Nothing else in the scorer changed. [tests/trial/review/ceo-compare-cluster.test.ts](../../../tests/trial/review/ceo-compare-cluster.test.ts) shows it both ways on synthetic readings: with "#" in the ids, the frozen scorer prints all six primaries degenerate and the fixed one prints six intervals and sign-flip p values; with plain ids, both print the same lines; the fixed scorer prints the same thing for "#" ids as for plain ids; and the fixed scorer with the old cluster key put back, or with a wrong partition that has as many clusters as units, is refused. The tests failed on the frozen copy first (logs kept in the Captain's drive, handoffs/GEVA-402/).

The arm-to-arm secondaries clustered on the review's unit already, so their printed intervals were right in the frozen run and match the fixed run exactly.

## Setup

- **Question.** Does gstack's /plan-ceo-review, run as a standalone skill or behind gstack's hook-enforced gate, help a model name the issue that really decided a plan, compared with the same model and no gstack?
- **Units.** 84 changed units (plans rejected with a maintainer's stated reason, reverted, or re-scoped by a major cut or change of approach) and 28 held units (plans carried out as written, shipped by 2026-09-01 and still in place on 2026-10-31), drawn in seeded order from the comparison set (cset-1, units digest 14aafcb0...). The 2 further held units and the 6 held units in sealed reserve did not run. Every plan and outcome dates from July 2026 or later, and names are replaced.
- **Arms.** none (the same model, a plain prompt, no gstack installed and no drive); standalone (/plan-ceo-review told to run, gstack at 699a41cb); enforced (the same told line with gstack's plan-ceo-review gate on, gstack at 4743132c); and on Opus only, lens (the harness's one-line CEO framing, no gstack). Both gstack arms ran as unattended sessions. Every session ran offline with a 200,000-token context window.
- **Models.** claude-opus-5-5 at 2 passes on changed units; openai/gpt-6.1-sol and particle-ai/particle-1 at 1 pass; held units at 1 pass everywhere.
- **Score.** Each review ends with at most three ranked issues and a forecast (0 to 100) that the plan is carried out and still in place 60 days after it ships. hit@3 is 1 when the issue that decided the unit is in the top three. Three judges (GPT-6.1 Sol, Opus 5.5, Sonnet 5.5) label each issue blind to arm and model; the final label is Sol's and Opus's when they agree, else Sonnet's.
- **Test.** Pairs by unit and pass, clustered on the unit; the difference with a 95% cluster-bootstrap interval and a two-sided cluster sign-flip p (seed 20261104, 10,000 draws); Holm over each model's two gstack arms. Verdict "helps" or "hurts" needs Holm p at most 0.05; "untested" if exposure is under 0.80 or coverage under 0.90.
- **Run.** Stage 2 ran from 2026-11-07T04:10Z to 2026-11-08T10:37Z on one runner host; rows, packets, the three judges, readings and compare ran from 08:03Z to 08:26Z on 2026-11-08. Opus's held completion ran 2026-11-08 10:52Z to 11:39Z on a second host (section "Opus's held cell, three ways"). Both hosts are destroyed.

## Result

### The primaries

hit@3, arm minus none, from the fixed compare ([compare-joined.txt](compare-joined.txt); the stopped-part and completion views print the same primary lines). MDD is compare's grid read at its 80-unit row, the row compare reads for 84 units, and its control rate 0.50, alpha 0.025.

| Model | Arm | none | arm | Difference | 95% CI | p | Holm p | Exposure | Coverage | MDD | Verdict | As first printed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | standalone | 0.343 | 0.343 | +0.000 | [-0.073, 0.072] | 1.000 | 1.000 | 0.825 | 0.988 | 0.09 | not distinguished | CI n/a, p 1.000 (degenerate) |
| Opus 5.5 | enforced | 0.341 | 0.341 | +0.000 | [-0.060, 0.060] | 1.000 | 1.000 | 0.857 | 0.994 | 0.09 | not distinguished | CI n/a, p 1.000 (degenerate) |
| GPT-6.1 Sol | standalone | 0.155 | 0.155 | +0.000 | [-0.060, 0.060] | 1.000 | 1.000 | 1.000 | 1.000 | 0.13 | not distinguished | CI n/a, p 1.000 (degenerate) |
| GPT-6.1 Sol | enforced | 0.155 | 0.190 | +0.036 | [-0.012, 0.083] | 0.369 | 0.739 | 1.000 | 1.000 | 0.13 | not distinguished | CI n/a, p 1.000 (degenerate) |
| particle-1 | standalone | 0.226 | 0.131 | -0.095 | [-0.179, -0.012] | 0.057 | 0.114 | 0.964 | 1.000 | 0.13 | not distinguished | CI n/a, p 1.000 (degenerate) |
| particle-1 | enforced | 0.226 | 0.214 | -0.012 | [-0.107, 0.083] | 1.000 | 1.000 | 0.976 | 1.000 | 0.13 | not distinguished | CI n/a, p 1.000 (degenerate) |

Each row's none and arm rates are over the unit-passes the contrast keeps. Opus none overall is 0.341 on 167 unit-passes, Sol none 0.155 and particle-1 none 0.226 on 84. No model carries a CEILING flag (none above 0.60). The first print also read every MDD as below the grid (at least 0.18 on Opus and 0.25 on Sol and particle-1), because it counted one unit; the fixed run reads the grid's 80-unit row.

The design's MDD at 84 units, ICC 0.843 and 80% power, as the Captain recorded it with the caps: Opus 0.09 and Sol and particle-1 0.12 at alpha 0.025. compare's own grid reads 0.13 for 1 pass at its 80-unit row and its 0.50 control, which is conservative for Sol's and particle-1's lower control rates.

Beside each primary (decides nothing):

| Model | Arm | Cross-family judge alone | G_R (10x tier), 95% CI |
|---|---|---|---|
| Opus 5.5 | standalone | Sol judge: -0.006 | -0.002 [-0.061, 0.056] |
| Opus 5.5 | enforced | Sol judge: -0.012 | +0.008 [-0.040, 0.057] |
| GPT-6.1 Sol | standalone | Opus judge: +0.012 | -0.016 [-0.071, 0.032] |
| GPT-6.1 Sol | enforced | Opus judge: +0.048 | +0.032 [-0.008, 0.075] |
| particle-1 | standalone | Sol judge: -0.048 | -0.075 [-0.147, -0.000] |
| particle-1 | enforced | Sol judge: +0.012 | -0.020 [-0.095, 0.052] |

G_R reads in its norem form (the stock fix scored rem on 0 of 84 keyed units). No model has an unjudged rem on its changed units, so compare prints no G_R bounds.

### Arm-to-arm secondaries (decide nothing)

| Contrast | Difference | 95% CI |
|---|---|---|
| Opus enforced - standalone | +0.000 | [-0.061, 0.061] |
| Sol enforced - standalone | +0.036 | [-0.036, 0.107] |
| particle-1 enforced - standalone | +0.083 | [0.012, 0.167] |
| Opus lens - none | +0.048 | [-0.006, 0.107] |
| Opus enforced - lens | -0.048 | [-0.108, 0.012] |

Enforced and standalone differ in the gate and in 94 commits of other gstack changes between the two pins, so the particle-1 line can't say which mattered.

### Exposure and checks per cell

Exposure is the share of a gstack arm's sessions that ran the procedure by the frozen checks; an enforced session whose gate report isn't a clean exit reads unexposed. Stage 2's all-runs `ceo rows --checks` exited 1: 1456 sessions, 1303 pass, 153 fail (75 incomplete from the Opus cap stop below, 65 with first failed check review_sections_read, 13 with block).

| Cell | Sessions | Checks pass | Scored | No-block | Gap | Incomplete | Exposed true / false |
|---|---|---|---|---|---|---|---|
| none:opus | 196 | 170 | 170 | 0 | 1 | 25 | n/a |
| standalone:opus | 196 | 139 | 168 | 1 | 2 | 25 | 139 / 32 |
| lens:opus | 196 | 170 | 170 | 0 | 1 | 25 | n/a |
| enforced:opus | 196 | 166 | 196 | 0 | 0 | 0 | 166 / 30 |
| none:sol | 112 | 112 | 112 | 0 | 0 | 0 | n/a |
| standalone:sol | 112 | 112 | 112 | 0 | 0 | 0 | 112 / 0 |
| enforced:sol | 112 | 112 | 112 | 0 | 0 | 0 | 112 / 0 |
| none:particle | 112 | 107 | 107 | 5 | 0 | 0 | n/a |
| standalone:particle | 112 | 108 | 112 | 0 | 0 | 0 | 108 / 4 |
| enforced:particle | 112 | 107 | 109 | 3 | 0 | 0 | 110 / 2 |

The 25 incomplete sessions in each of three Opus cells are the held sessions the completion later ran. The completion's own checks exited 1: 75 sessions, 71 pass, 4 fail, all 4 standalone sessions that read unexposed (review_sections_read). One standalone:opus session of 196 ended on an allowance stop; no other cell had one, so no cell is harness-limited. The stage 2 amendment asked for gate reports per cell by exit code. This post gives the exposure counts they feed; the per-session reports stay in the sealed run bundles.

Per-protocol hit@3, exposed sessions only (descriptive): Opus standalone 0.372 and enforced 0.326 against none 0.341.

### Judge agreement

Sol against Opus on D, stage 2 as run: n 4577, both D 270, Sol only 29, Opus only 102, neither 4176; positive agreement 0.805, raw 0.971, PABAK 0.943, kappa 0.790. With the completion joined: n 4802, positive agreement 0.805, raw 0.973, PABAK 0.945, kappa 0.790. Stage 1 read 0.942 positive agreement. On rem, positive agreement is 0.693 on n 3982 (rem decides nothing in stage 2). Missing D calls: 0 for every judge. Missing rem calls: Sonnet 47, Sol 0, Opus 0. Stock rows hit D on 0 of 84 changed units (limit 3), so no contrast reads untested on the stock check.

### Opus's held cell, three ways

Held units feed the forecast secondaries: Brier and AUC score each review's forecast with held units as truth 1 and changed units as truth 0. Opus's p item (run id review-units-20261107T041347Z-8a76) cap-stopped in its held launch after 9 sessions on 3 of 28 held units. The completion item (run id review-units-20261108T105250Z-2447) ran exactly the 75 unstarted sessions from the same build. [merge.ts.txt](merge.ts.txt) builds a joined readings file and a completion-only view from the two runs, checks every row against its source, and refuses tampered copies ([merge-and-compare.txt](merge-and-compare.txt); tests in [tests/trial/review/ceo-held-merge.test.ts](../../../tests/trial/review/ceo-held-merge.test.ts)). The joined file takes the completion's 75 scored rows and none of its 1381 gap rows. The completion view takes all 84 held-cell rows from the completion, so the stopped part's 9 sessions read there as gap rows, which is why the completion view's Opus none, standalone and lens cells each show 3 more gaps than the joined view does. merge.ts's header comment ("its gap rows never enter") and its "1381 gap rows left out" count describe the joined file only.

| Cell | Stopped part only (8a76, 3 held units) | Completion only (2447, 25 held units) | Joined (28 held units) |
|---|---|---|---|
| none:opus | Brier 0.099, AUC 0.769 | Brier 0.133, AUC 0.705 | Brier 0.136, AUC 0.712 |
| standalone:opus | Brier 0.110, AUC 0.836 | Brier 0.146, AUC 0.677 | Brier 0.148, AUC 0.694 |
| lens:opus | Brier 0.097, AUC 0.885 | Brier 0.137, AUC 0.663 | Brier 0.138, AUC 0.687 |
| enforced:opus (opus-e, run review-units-20261107T093951Z-8e3e, all 28) | Brier 0.141, AUC 0.685 | the same | the same |

The stopped part's figures rest on 3 positives per cell and are not comparable with enforced. On the full held set the four Opus arms forecast alike, and neither gstack arm forecasts better than none. Sol and particle-1 ran every held session, so their lines don't move: Brier and AUC none:sol 0.256 and 0.627, standalone:sol 0.232 and 0.598, enforced:sol 0.234 and 0.605; none:particle 0.172 and 0.668, standalone:particle 0.189 and 0.589, enforced:particle 0.199 and 0.578. Every other compare line is identical across the three views, apart from the agreement counts and these three Opus cells.

Every per-cell secondary (rank-weighted, slot precision, per-protocol, the strict date strata, maintainer and outside proposals, the 10x tier, category counts, cost per review and per hit, E_ALLOWANCE stops) is in the three fixed compare outputs beside this post, with unit ids masked.

## Why null? (R48)

This eval was plan-ceo-review's one ceiling raise (R61): two earlier seeded-flaw panels had no headroom because plain Opus found every planted flaw, so this design moved to real plans keyed to real outcomes, and stage 1 read HEADROOM (Opus none 0.500 on 48 reviews). The null below is not a saturation null.

**Opus 5.5.**
- Exposure: the skill ran in 82.5% of standalone sessions and 85.7% of enforced ones, above the 0.80 bar. The exposed sessions alone read 0.372 and 0.326 against none's 0.341, so the sessions that ran the procedure don't show a hidden gain.
- Task fit: real post-cutoff plans in the categories a CEO review targets (direction, premise and demand, scope). The stock rows hit D on 0 of 84 units, so the grading isn't crediting generic categories.
- Power and ceiling: none read 0.341, with no ceiling or floor flag. The MDD is 9 points, and both intervals end below it (+7.2 and +6.0).
- Frontier competence: plain Opus raises the deciding issue as often as either gstack arm, and the one-line lens does at least as well for a fifth of the cost.
- Method: the clustering bug is fixed, and the comparison reran from the sealed readings. Judge agreement fell from 0.942 to 0.805, but the cross-family judge alone reads -0.006 and -0.012, so judge noise doesn't hide a gain. Coverage is 0.988 and 0.994, and no cell is harness-limited.
- **Verdict: CUT-CANDIDATE.** Neither exposure nor method explains the null. Next step for the Captain to decide: a before-and-after cut eval of plan-ceo-review's sections on Opus 5.5, with the lens framing as the comparison to beat.

**GPT-6.1 Sol.**
- Exposure: 1.000 on both arms.
- Power: none read 0.155. The enforced interval ends at +8.3 points, under the printed MDD of 13 and the design's 12. The point estimate is positive (+3.6, and +4.8 with the Opus judge alone) but not distinguished.
- Method: nothing explains the null. Sol's provider checks passed, with no allowance stops and full coverage.
- **Verdict: CUT-CANDIDATE.** A gain smaller than about 8 points on enforced isn't ruled out, and this test can't see it.

**particle-1.**
- Exposure: 0.964 standalone and 0.976 enforced.
- Result: standalone's estimate is a loss of 9.5 points (unadjusted interval below zero, Holm p 0.114, so not a distinguished "hurts"). Enforced is -1.2, and enforced minus standalone is +8.3 [+1.2, +16.7], so the gate or the newer pin recovered most of standalone's loss.
- Method: nothing explains the null.
- **Verdict: CUT-CANDIDATE.** The standalone skill may cost a cheap model hits; the enforced arm gives no gain.

## Run disclosures

- **The frozen print.** The comparison first printed every primary as degenerate, for the reason above. This post's numbers come from the fixed scorer on the same sealed readings; the frozen copy, rerun on them, matches every compare line of the run's compare log; the one line that differs is the log's leading sha256 check line.
- **Opus's held completion is a deviation.** It ran about 26 hours after the stopped launch, from the same build, pins and flags (--parallel 3, --timeout 3600, --max-turns 150, gstack-forced unattended), with its own ledger item, run id, out dir, sink, packets and judges. Its held D packets held 3 reviews each, against about 13 per held packet in stage 2, so the judges saw less context. Its judges also labelled the stock rows again; the joined file keeps stage 2's stock labels. Model drift between the two runs is possible. Opus's primaries read changed units only and don't move.
- **Why opus-p stopped.** The details are in Agent notes.
- **A $14.19 ledger gap.** The gap is most likely the ledger's charge for the 9 calls the proxy couldn't price. It was not traced further.
- **A second driver lane.** The run thread, not the Captain, then ran particle-1's two items in a second driver lane beside Sol's. Each lane had its own proxy and trial network, installs ran under a file lock, and the ledger used immediate transactions with a busy timeout. The driver script was unchanged, and the trail log records it.
- **RIG_UNPROVEN.** Each of the six stage 2 judge items logged one RIG_UNPROVEN warning, because no item had a rig admission record and the pin opens items with admission set to warn. The run items logged no codes.
- **Sonnet.** Two refused replies left one remedy packet unanswered, so 47 rem calls are missing. rem decides nothing in stage 2.
- **The all-in tool** The details are in Agent notes.
- **Host boots.** Both hosts' boot script exited 2 at its doctor step after every check line passed. The completion host's first boot hit a transient Bun download failure and was rerun.
- **Sol's route.** Sol ran through OpenRouter pinned to OpenAI's provider with fallbacks off and data collection denied, forwarded on an OpenAI key, so OpenAI's API terms apply; OpenAI keeps API traffic up to 30 days for abuse monitoring and doesn't train on it. Every one of sol-p's 3,024 and sol-e's 2,696 generation ids was served by OpenAI on the default tier.
- **Named build deviations.** Every arm on every model ran with a 200,000-token context window (Claude Code's default for Opus 5.5 is 1,000,000), a limit on what any arm could read. The CEO review shims got a 30-second hook timeout so the frozen 20-second deadline governs. Opus's items ran as two launches under one run id (changed units at 2 passes, then held units at 1). Stage 1's projection input was built by a pinned merge rather than by re-judging.
- **Authoring deviations.** From rank 1,400 on, mining read held-pool rows only, still in seeded order among them, and the set missed its cross-range cap; both are in the custody addendum.
- **A custody read wider than its grant.** The build thread read the other gstack-auto smoke sessions in the two stage 1 smoke bundles it opened, through a redacting script that printed no unit, plan or review text. The Captain accepted it after the fact on 2026-11-06.
- **This rerun's custody.** The two sealed bundles were opened on the results thread's own machine in RAM-backed /dev/shm only, logged in the custody record. The seal script stopped at its sweep step before the wipe, so the plaintext stayed in /dev/shm about 8 seconds longer than planned; nothing left /dev/shm, and the wipe was rerun at once.
- **The cross-family read** of the fix and the merge found three Low items (the count check alone couldn't prove the partition; JSON's Infinity could slip past the merge's equality check; a malformed output could echo text in an error). All three are fixed, with tests written first.

## Limits and threats

- Open-source developer products only, over a four-month window that favors fast decisions. A maintainer's stated reason may not be the whole reason.
- Every arm ran offline. plan-ceo-review's landscape check wants web research, which no arm could do.
- Judges share families with the arms. The cross-family judge line prints beside each primary.
- The MDD on Sol and particle-1 is 12 to 13 points; smaller effects there are not ruled out.
- Opus's forecast secondaries join two runs a day apart.
- Gate reports per cell by exit code are not broken out here.

## Replicate it

1. **Reanalysis (keyless; needs the sealed bundles, so another Captain's crew with custody can run it, outsiders can't yet).** Check out 2ef58339 as the scorer checkout. Open stage2-j and stage2-opus-ph from handoffs/GEVA-381/rerun-inputs/sealed/ as the custody record says. Then run `bun merge.ts build <stage2-j readings.json> <completion readings.json> joined.json view.json` and `GSTACK_EVALS_SCORER=<that checkout> bun ceo-rule.ts compare <readings> projection.txt 01fd5e8dc4b4b56c3b317afce0f4d9f92727097149fa877394d96669ceff9f57` on each of stage2-j's readings, joined.json and view.json, with projection.txt from the stage 2 pin post. merge.ts doesn't check that its four paths differ, so pass it four distinct paths: an output that names an input overwrites that input and still prints OK. Run the frozen scorer copy from stage2-j the same way on stage2-j's readings for compare-frozen.txt. Masking unit ids as <unit> gives the four compare files beside this post byte for byte; their unmasked sha256s are in [merge-and-compare.txt](merge-and-compare.txt).
2. **Rerun a cell (paid).** The pin post freezes every item's command. This record leaves out host setup and the paid launches themselves; the run thread's scripts as uploaded are in handoffs/GEVA-381/rerun-inputs/runner/.

## What is held out, and why

All 112 units that ran, the 2 unrun held units and the 6 reserve units are sealed: the comparison suite as stage2-suite.tar.gz.age (ciphertext sha256 6e91f9786dfe3504899e7334cf40a35ecddd7795697f249bcb40e75eb8c5a20d), the run bundles under handoffs/GEVA-381/rerun-inputs/sealed/ (digests in its SUMS.txt), and this post's joined readings as stage2-joined.tar.gz.age (ciphertext 464c1c2886bcf0b3c9278099f494a906d92f1c4feece52e1e376ac407071fb0e). The units are plans from open-source projects with their decisions, and a public copy would let a later model train on the answers. Outsiders can verify digests only. Release is the Captain's call once the set retires.

## Changelog

- 2026-11-08: first version, with the fixed comparison and the joined held cell.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

<details>
<summary>Agent notes</summary>

The completion's scored rows sum to $20.831767, the ledger's settled spend for its item to the micro-dollar.

**Cost**

Settled against each item's cap in the ledger (ceo-o-cmp.sqlite, final copy with 13 items):

| Item | Cap | Settled |
|---|---|---|
| ceo-o-cmp-opus-p (none, standalone, lens on Opus; 2 launches, the second cap-stopped) | $179.00 | $158.630591 |
| ceo-o-cmp-opus-e (enforced on Opus; 2 launches) | $187.00 | $140.463287 |
| ceo-o-cmp-sol-p (none, standalone on Sol) | $126.00 | $81.484158 |
| ceo-o-cmp-sol-e | $136.00 | $72.400567 |
| ceo-o-cmp-particle-p | $12.00 | $7.865000 |
| ceo-o-cmp-particle-e | $23.00 | $7.262876 |
| ceo-o-cmp-judge-sol, -opus, -sonnet (one $70 line) | $70.00 | $22.845175 |
| ceo-o-cmp-opus-p-held (the completion) | $51.00 | $20.831767 |
| its three judges (one $10 line) | $10.00 | $7.932327 |
| **Model spend** | | **$519.72** |

Measured cost per session: Opus none $0.127, standalone $0.674, lens $0.127, enforced $0.717 (the completion: none $0.126, standalone $0.581, lens $0.127); Sol none $0.074, standalone $0.653, enforced $0.646; particle-1 none $0.008, standalone $0.062, enforced $0.065.

Tokens, summed over 14,938 settled calls in the ledger ([ledger-calls.txt](ledger-calls.txt) breaks them out by item, arm and model): 82.3M input, 710.9M cache read, 57.6M cache write, 18.8M output. The 9 calls whose cost the proxy couldn't read carry no usage there.

Price table in force at build 2ef58339, committed 2026-11-06 (src/runner/pricing/prices.ts, list prices per million tokens): Opus 5.5 $4 input, $20 output, $0.20 cache read, $5 cache write; GPT-6.1 Sol $2, $10, $0.10, $2.50 (above 272k input tokens $4, $15, $0.20, $5); particle-1 $0.10, $1, $0.003 cache read; Sonnet 5.5 $2, $10, $0.20, $2.50. Runner hosts at the standard-8 list rate of $0.00416 a minute: $7.60 for the stage 2 host (30.45 h) and $0.31 for the completion host (about 74 minutes). Crew model use at about $1 per 1,000 credits.

**The line's all-in on actuals** at 2026-11-08T12:23Z: crew $716.49 (the 29 earlier CEO crew threads at $709.02, read from their counters at 12:21Z, plus this thread's $7.47), stage 1 $17.60, the smoke rerun $5.10, authoring and mining $392.65, runner hosts $8.84 (stage 1 $0.93, stage 2 $7.60, completion host $0.31), stage 2 model spend $490.95 and the completion $28.76: **$1,660.39 of the $2,000 line**. This thread's /ship review comes after this reading and is in its completion report. The run thread's figure of $1,727.97 also carried the unspent crew rest and reserve lines ($79.84).

**Why opus-p stopped.** The cap-stop rule admits a round only when 3 parallel sessions at the $7.04 Opus allowance ($21.12) fit under what is left. Launch 2 started with $23.04, ran 9 held sessions for $2.67, and with $20.37 left the rule refused the next round.

**A $14.19 ledger gap.** opus-p's first lease printed $141.77 settled with 9 calls of unknown cost, and the ledger booked $155.96 for it. The rows' per-session dollars for opus-p's three cells sum to the ledger's $158.630591 exactly, so the ledger figure stands.

**A second driver lane.** At 2026-11-07T16:26Z, Sol's pace (64 of 224 sessions in 4 hours) would have run the sequential plan past the host's time limit and its $12 line.

**The all-in tool** takes only the six stage 2 run items, so the completion's cap rode on opus-p's row in the check before its lease ($1,764.29, a pass).

</details>
