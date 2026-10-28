---
id: 2026-10-28-gsta-3-v1-plan-amendment-a2
kind: plan
title: Amendment A2 to plan v3.2, sealed releases, parity alpha and the factory keep rule
summary: Unreviewed. Prices the d1 release budget against d6 parity sizing for the pilot report, makes sealed releases one bit for one frozen champion, and sets the v1.1 factory keep rule.
author: GSTA-3
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
source: Captain drive handoffs/GSTA-3/plan-v3.2-amendment-A2.md (sha256 de17b602685e7baa01472a979a9ec7f8df5f48b881bd7d9e010f97e87ad5bbb3), from GSTA-7 research in Captain drive handoffs/GSTA-7/autoresearch-practices.md. GSTA-6 added the attribution line after the gbrain-evals rule 6 quote.
links:
  - 2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2
  - 2026-10-28-gsta-7-autoresearch-eval-practices
  - https://github.com/garrytan/gbrain-evals/blob/566c16f8257dda9b6d772e30ee692b2e75bfae5a/docs/benchmarks/2026-09-29-sealed-confirmation-protocol.md
---
# gstack-evals v1 plan, Amendment A2: sealed releases, parity alpha and the factory keep rule

Dated 2026-10-28. Unreviewed: autoplan run 2 (autoplan-20261028004737) is complete and Garry approved plan v3.2 at gate_rev 4, so this amendment sits beside v3.2 and changes nothing in the approved run. It applies GSTA-7's research on how eval sets steer autoresearch loops (Captain drive handoffs/GSTA-7/autoresearch-practices.md, section 7's gap table against v3 and v3.1). A later plan review decides whether it joins the plan.

## 1. The d1 release budget and the d6 parity sizing interact

**The basis d6 uses.** Plan v3.2 sizes parity with n = ((z_alpha + z_power) x SD / 0.07)^2: a one-sided test at alpha 0.05/3 (Holm's worst case over three cheap models), 90% power, and a true difference of minus 3 points inside the 10-point margin. That gives about 95, 214 and 343 build-fix tasks at a per-task SD of 0.2, 0.3 and 0.38 (380 at 0.4). It spends the set's whole alpha on parity at one release. v3.2's reuse paragraph says the parity test runs "at its first counted release, with that release's full alpha, so the sizing under decision 9 holds", and that releases 2 to 4 "spend the rest under the schedule". If "full alpha" means the whole 0.05, nothing is left for releases 2 to 4; if it means release 1's share of a spending schedule, the decision 9 sizing no longer holds. This amendment replaces the sentence with an explicit choice.

**What the release budget costs.** d1 allows about 4 aggregate-only counted releases per sealed task. If four frozen releases split the set's alpha equally (0.0125 each, family-wise), parity at release 1 gets 0.0125, and with Holm over three cheap models each test runs at 0.0125/3. If each release steers the next candidate, there are 15 possible decision nodes and each gets 0.05/15.

GSTA-7 computed the factor against GSTA-4's basis of alpha 0.05 and 80% power: about 1.54x for four frozen releases (95, 213 and 380 become about 146, 328 and 585) and about 2x if releases steer. v3.2's counts do not follow from that basis (it gives 114 tasks at SD 0.30, the last column of the table below), so this amendment uses the basis v3.2 states (alpha 0.05/3, 90% power). There the factors are smaller but still real: about 1.32x for four frozen releases (about 125, 282 and 453 at SD 0.2, 0.3 and 0.38) and about 1.62x if releases steer (about 154, 346 and 555). The factors scale with (z_alpha + z_power)^2 and hold whatever the SD and margin. Either way, the 213-task ceiling covers less SD than v3.2's table says.

**Decision for Garry at the pilot report**, beside the SD estimate and the one-primary-model lever (decision 9). Build-fix tasks needed, 90% power unless marked:

| Option | Three cheap models, Holm: SD 0.30 / 0.38 | One primary cheap model: SD 0.30 / 0.38 | One primary model, 80% power: SD 0.30 / 0.38 |
|---|---|---|---|
| v3.2 as written (parity takes the whole alpha at one release) | 214 / 343 | 157 / 252 | 114 / 182 |
| A. Parity gets a bigger preregistered share (example: 0.03 to parity, 0.02 split across the other releases) | 239 / 384 | 184 / 295 | 136 / 218 |
| B. Parity runs on its own sealed tranche, used once at the full 0.05 | 214 / 343 for the tranche, plus the build-fix tasks the other releases use | 157 / 252, plus the same | 114 / 182, plus the same |
| C. Mint more: four frozen releases at 0.0125 each | 282 / 453 | 228 / 366 | 175 / 280 |
| C, if each release steers the next candidate (0.05/15 per node) | 346 / 555 | 293 / 470 | 232 / 372 |

The SD that 213 tasks cover: under option C, 0.26 for three models, 0.29 for one primary model and 0.33 for one primary model at 80% power. Recommendation to bring to the pilot report: freeze the candidates before release 1 (never the steering variant), take the one-primary-model lever, and choose between A and B from the SD estimate; C is the fallback when Garry wants all three cheap models confirmatory. The keyless sizing test (build unit U2) reproduces every number here.

## 2. Release rules for sealed sets

- **Payload.** Each counted release gives the factory one pass bit for its one champion. The full analysis (intervals, per-family results, reason codes) goes to the ledger and the receipts only. Anyone who reads more than the bit and then shapes later proposals counts as part of the release channel, and the counted preregistration names who that is. A published report of a counted run counts as a release.
- **Frozen candidates.** A sealed result accepts or rejects one preregistered champion and never chooses between candidates. gbrain-evals' sealed-confirmation protocol states the rule this way, and gstack-evals adopts it as written (gbrain-evals at commit 566c16f8, docs/benchmarks/2026-09-29-sealed-confirmation-protocol.md, Access policy, rule 6):

  > 6. **No tuning.** Results from this set may accept or reject a release. They may not be used to choose between candidate settings. A rejected candidate is fixed on development data, then re-preregistered.

  Quoted from [gbrain-evals](https://github.com/garrytan/gbrain-evals/blob/566c16f8257dda9b6d772e30ee692b2e75bfae5a/docs/benchmarks/2026-09-29-sealed-confirmation-protocol.md) at commit 566c16f8, MIT License, Copyright (c) 2026 Garry Tan.

- **Counter.** Each sealed manifest carries gbrain-evals-style opening counts beside v3.2's per-task exposure counts: every counted opening is listed, and the runner refuses a run past the budget. Exploratory runs on a sealed set count as releases if anything leaves custody. A rotated-in task starts with its own fresh budget; a retained task keeps its count (as v3.2 already says).

## 3. The v1.1 factory keep rule

This replaces v3.2's keep rule for the factory `compare` loop, which stays in v1.1.

- **Noise floor.** Before each factory epoch, re-run the champion against itself on val to measure per-cluster flip rates. Keep a candidate only when its paired gain exceeds the larger of 5 points and the measured floor, by at least one standard error; ties are rejected. The preregistration says that repeated use of this rule on one val set is a heuristic screen, not a test; promotion rests on the sealed set.
- **Clusters lost against clusters gained.** Every compare reports both counts, and a candidate that loses as many clusters as it gains is rejected whatever its mean.
- **Candidate hashes.** Each candidate is hashed on its normalized diff, so a rejected edit proposed again in different words does not get a fresh draw. The count of candidates tried per epoch goes into the report.
- **Bit-only channel.** The proposer receives keep or revert bits only: no scores, no reasons, no per-task outcomes from val or sealed.
- **Re-confirm the top 3.** Before nominating a champion for a sealed release, re-score the epoch's top 3 candidates with fresh trials on val plus rotated-in tasks, and nominate the best of that re-score.
- **Diff review.** A reviewer from another model family reads every kept diff for hard-coded task details, grader or harness tampering and widened writable paths, and the factory runs cheat-rate tasks that reward tampering if it is tried.
- **One-shot baseline.** Every factory campaign reports a one-shot rewrite arm on the same val and sealed payload beside the loop.
- **Loop preregistration.** Before a campaign starts: writable paths (hashed into protected/MANIFEST.json, so a run cannot widen its own surface), proposer model, candidate and spend budgets, val epoch size and rotation, stopping rule, keep rule, release schedule and the one-shot arm. Val deltas of kept candidates are never reported as lift.

## What changes where, if a review accepts A2

- Decision 9 and the Statistics section: the alpha basis and the table above; the reuse paragraph's "full alpha" sentence goes.
- Sealed custody: the payload, frozen-candidate and counter rules.
- The factory loop: the keep rule above.
- Build breakdown: U2's sizing test covers the A2 rows; U15 prints the A2 table at the estimated SD; U17 brings the option choice to Garry.
