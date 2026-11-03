#!/usr/bin/env python3
# power.py: keyless MDD sizing for the L1 superseding preregistration at $2,000 all-in (GEVA-254, GST-1155).
# Pure Python, seeded. The simulation is the merged L1 prereg's power.py (11c51e0) unchanged: binary trials per task with
# task-level heterogeneity, paired by task, SE simulated under no effect, MDD = (z_crit + z_0.80) x SE.
# Critical values: alpha 0.05 two-sided (z 1.960) and the first Holm step of a 2-member family (alpha 0.025, z 2.241).
import math, random

SEED = 20261103
Z05, ZHOLM2, Z80 = 1.960, 2.241, 0.842
SIMS = 4000

def beta(rng, mean, conc):
    a, b = mean * conc, (1 - mean) * conc
    return rng.betavariate(a, b)

def se_binary(rng, n_tasks, reps, control, conc, effect_sd=0.10):
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

def row(label, se, holm=True):
    s = f"{label:<52} SE {100*se:5.1f}  MDD@0.05 {100*(Z05+Z80)*se:5.1f}"
    return s + (f"  MDD@Holm2 {100*(ZHOLM2+Z80)*se:5.1f}" if holm else "")

rng = random.Random(SEED)
out = [f"power.py seed {SEED}, {SIMS} simulations per row, effect_sd 0.10. Points are percentage points.",
       "Assumptions (as the merged L1 power.py): cluster rates ~ Beta(mean = control, a+b = conc), conc 2 very spread, conc 6 moderate;",
       "each task drifts between arms by N(0, effect_sd) under no effect; replicates are independent draws.", ""]

out.append("FROZEN BEHAVIOR TABLE (B1 discovery, B3 adherence), F1, 80 tasks x 1, conc 2, rate at the before arm; planning rate 2%.")
out.append("The only behavior table: admission, saturation and the MDDs the plan quotes all read it, by linear interpolation")
out.append("between rows; a rate outside the rows reads the nearest end row.")
for c in [0.01, 0.02, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90]:
    out.append(row(f"  behavior before {round(c*100):>2}%", se_binary(rng, 80, 1, c, 2)))
out.append("")
out.append("O5, DESCRIPTIVE (after-t minus before-t pass rate), F1, 80 tasks x 1, conc 6, one member (alpha 0.05); no verdict:")
for c in [0.5, 0.6, 0.7, 0.8, 0.9]:
    out.append(row(f"  O5 control {int(c*100):>2}%", se_binary(rng, 80, 1, c, 6), holm=False))
out.append("")
out.append("WHY O5 IS NOT A PRIMARY: its MDD with two more replicates (80 x 3), and with every eligible task (145 x 3), conc 6:")
for n in [80, 145]:
    for c in [0.60, 0.65, 0.70]:
        out.append(row(f"  O5 {n} tasks x 3, control {round(c*100)}%", se_binary(rng, n, 3, c, 6), holm=False))
out.append("")
out.append("TB2 TWIN (descriptive, tunable), 37 tasks x 2, conc 2, behavior rate at the before arm:")
for c in [0.02, 0.10, 0.50]:
    out.append(row(f"  tasks 37 x 2, before {int(c*100)}%", se_binary(rng, 37, 2, c, 2), holm=False))
print("\n".join(out))
