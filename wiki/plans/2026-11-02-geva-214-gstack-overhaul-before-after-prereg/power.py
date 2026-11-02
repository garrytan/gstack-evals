#!/usr/bin/env python3
# power.py: keyless MDD sizing for the GST-1089 before/after preregistration (GEVA-214).
# Pure Python, seeded. Binary trials per task with task-level heterogeneity; paired by task.
# MDD = (z_crit + z_0.80) x SE of the paired, cluster-mean difference, SE from simulation
# under no effect. Two critical values: alpha 0.05 two-sided (z 1.960) and the first Holm
# step of a 4-member family (alpha 0.0125, z 2.498). z_0.80 = 0.842.
import math, random

SEED = 20261102
Z05, ZHOLM4, Z80 = 1.960, 2.498, 0.842
SIMS = 4000

def beta(rng, mean, conc):
    a, b = mean * conc, (1 - mean) * conc
    return rng.betavariate(a, b)

def se_binary(rng, n_tasks, reps, control, conc, effect_sd=0.10):
    # Each task has its own control rate p_i ~ Beta(mean=control, a+b=conc) and its own
    # arm-to-arm drift (a task-level effect spread, effect_sd on the probability scale, mean 0).
    diffs_means = []
    for _ in range(SIMS):
        d = []
        for _ in range(n_tasks):
            p = beta(rng, control, conc)
            q = min(1.0, max(0.0, p + rng.gauss(0.0, effect_sd)))
            x = sum(rng.random() < p for _ in range(reps)) / reps
            y = sum(rng.random() < q for _ in range(reps)) / reps
            d.append(y - x)
        diffs_means.append(sum(d) / n_tasks)
    m = sum(diffs_means) / SIMS
    return math.sqrt(sum((v - m) ** 2 for v in diffs_means) / (SIMS - 1))

def se_recall(rng, n_units, passes, control, conc, decoy_share=0.2, effect_sd=0.15):
    # Review units: decoy units carry no blocker; keyed units carry 1 to 3 blockers
    # (stacks-r1's 42 blockers on 33 units gives about 1.3 on keyed units). Recall is pooled
    # over blockers, paired by unit (ratio of sums, as the review rig's PR-clustered rule).
    keyed = [u for u in range(n_units) if u >= int(round(decoy_share * n_units))]
    ests = []
    for _ in range(SIMS):
        num_a = num_b = den = 0.0
        for _u in keyed:
            k = rng.choice([1, 1, 1, 2, 2, 3])
            for _ in range(k):
                p = beta(rng, control, conc)
                q = min(1.0, max(0.0, p + rng.gauss(0.0, effect_sd)))
                for _ in range(passes):
                    num_a += rng.random() < p
                    num_b += rng.random() < q
                    den += 1
        ests.append((num_b - num_a) / den)
    m = sum(ests) / SIMS
    return math.sqrt(sum((v - m) ** 2 for v in ests) / (SIMS - 1)), len(keyed)

def row(label, se):
    return f"{label:<58} SE {100*se:5.1f}  MDD@0.05 {100*(Z05+Z80)*se:5.1f}  MDD@Holm4 {100*(ZHOLM4+Z80)*se:5.1f}"

rng = random.Random(SEED)
out = []
out.append(f"power.py seed {SEED}, {SIMS} simulations per row, effect_sd 0.10 unless a row says otherwise. Points are percentage points.")
out.append("Assumptions: task (or blocker) rates ~ Beta(mean = control, a+b = conc); conc 2 = very spread (TB2: Opus none passed 3 of 3 on 28 of 37 tasks), conc 6 = moderate;")
out.append("each cluster also drifts between arms by N(0, effect_sd) under no effect; replicates and passes are independent draws; H-rev: 20% decoy units, keyed units carry 1, 1, 1, 2, 2 or 3 blockers.")
out.append("")
out.append("Binary outcome endpoints (H-inv pass), paired by task:")
for n in [60, 72, 80]:
    for c in [0.3, 0.5, 0.7]:
        for conc in [2, 6]:
            out.append(row(f"tasks {n} x reps 3, control {int(c*100)}%, conc {conc}", se_binary(rng, n, 3, c, conc)))
out.append("")
out.append("Behavior endpoints (load or complete rate at the before pin), conc 2:")
for (n, r) in [(80, 3), (36, 2)]:
    for c in [0.02, 0.05, 0.3, 0.5]:
        out.append(row(f"clusters {n} x {r}, before {int(c*100)}%", se_binary(rng, n, r, c, 2)))
out.append("")
out.append("Review blocking recall, paired by unit, conc 2:")
for n, p_, c in [(36, 2, 0.071), (36, 2, 0.15), (36, 2, 0.3), (33, 2, 0.071)]:
    se, k = se_recall(rng, n, p_, c, 2)
    out.append(row(f"units {n} ({k} keyed) x passes {p_}, control {round(c*100,1)}%", se))
out.append("")
out.append("FROZEN ADMISSION TABLES (section 8.3). MDD@Holm4 at the confirmatory n; admission uses the larger of the row at the slice's rate and the row at the planning rate.")
out.append("H-inv: 80 tasks x 3, conc 6, effect_sd 0.10; planning rate 40%.")
for c in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
    se = se_binary(rng, 80, 3, c, 6)
    out.append(f"  H-inv control {int(c*100):>2}%  MDD@Holm4 {100*(ZHOLM4+Z80)*se:5.1f}")
out.append("H-rev: 36 units x 2 passes, conc 2, effect_sd 0.15; planning rate 7.1%.")
for c in [0.02, 0.071, 0.15, 0.3, 0.5]:
    se, _ = se_recall(rng, 36, 2, c, 2)
    out.append(f"  H-rev control {round(c*100,1):>4}%  MDD@Holm4 {100*(ZHOLM4+Z80)*se:5.1f}")
print("\n".join(out))
