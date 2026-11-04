#!/usr/bin/env python3
# power.py: keyless MDD sizing for the L1 superseding preregistration at $2,000 all-in (GEVA-254, GST-1155).
# Pure Python, seeded. Power is measured through the plan's own test under a true null: per task, before and after
# rates are p and q = min(1, p + delta) with p ~ Beta(mean = before rate, a+b = conc); the test is the exact two-sided
# sign-flip on task differences (at 1 replicate, the exact sign test on discordant pairs; at 2 or 3 replicates, the
# exact sign-flip null of the task-mean differences, computed by convolution over tasks). A row's MDD is the realized
# mean difference in rate, after clipping at 1, at the smallest shift the test detects with 80% power.
# This replaces the merged L1 prereg's power.py (11c51e0), which #169 also used: it added N(0, 0.10) drift clipped at
# 0 and 1 under "no effect", so its null was not null, and it read MDD as (z_crit + z_0.80) x SE, which overstated
# power by about 2x against the sign-flip test (44% power at its own 8.6-point MDD at a 2% before rate).
import math, random
from functools import lru_cache

SEED = 20261103
SIMS = 2000
POWER = 0.80
STEPS = 14
A05, AHOLM2, AHOLM4 = 0.05, 0.025, 0.0125
MARGIN = 0.20

def beta(rng, mean, conc):
    return rng.betavariate(mean * conc, (1 - mean) * conc)

def world(rng, n_tasks, reps, control, conc):
    w = []
    for _ in range(SIMS):
        tasks = []
        for _ in range(n_tasks):
            p = beta(rng, control, conc)
            x = sum(rng.random() < p for _ in range(reps))
            tasks.append((p, x, [rng.random() for _ in range(reps)]))
        w.append(tasks)
    return w

@lru_cache(maxsize=None)
def null_dist(counts):
    dist = {0: 1.0}
    for a, c in enumerate(counts, start=1):
        if not c:
            continue
        pm = [math.comb(c, k) / 2.0 ** c for k in range(c + 1)]
        new = {}
        for s, ps in dist.items():
            for k, pk in enumerate(pm):
                v = s + a * (2 * k - c)
                new[v] = new.get(v, 0.0) + ps * pk
        dist = new
    return dist

@lru_cache(maxsize=None)
def pvalue(counts, abs_s):
    return sum(pr for v, pr in null_dist(counts).items() if abs(v) >= abs_s)

def rejection(w, reps, delta, alpha):
    rej = 0
    for tasks in w:
        counts = [0] * reps
        s = 0
        for p, x, uy in tasks:
            q = min(1.0, p + delta)
            d = sum(u < q for u in uy) - x
            if d:
                counts[abs(d) - 1] += 1
                s += d
        if s and pvalue(tuple(counts), abs(s)) <= alpha:
            rej += 1
    return rej / len(w)

def mdd(w, reps, alpha):
    if rejection(w, reps, 1.0, alpha) < POWER:
        return None
    lo, hi = 0.0, 1.0
    for _ in range(STEPS):
        mid = (lo + hi) / 2
        if rejection(w, reps, mid, alpha) >= POWER:
            hi = mid
        else:
            lo = mid
    n = sum(len(t) for t in w)
    return sum(min(1.0, p + hi) - p for t in w for p, _, _ in t) / n

def fmt(v):
    return "  n/r " if v is None else f"{100*v:5.1f}"

def row(label, n, reps, control, conc, alphas, flag=False):
    w = world(rng, n, reps, control, conc)
    cells, sizes, over = [], [], False
    for name, a in alphas:
        m = mdd(w, reps, a)
        cells.append(f"MDD@{name} {fmt(m)}")
        sizes.append(f"{rejection(w, reps, 0.0, a):.3f}")
        if m is None or m > MARGIN:
            over = True
    s = f"{label:<46} " + "  ".join(cells) + f"  null size {'/'.join(sizes)}"
    return s + ("  NOT POWERED: over the 20-point margin" if flag and over else "")

rng = random.Random(SEED)
B = [("0.05", A05), ("Holm2", AHOLM2)]
out = [f"power.py seed {SEED}, {SIMS} simulations per row, {STEPS} bisection steps, power {POWER:.2f}. Points are percentage points.",
       "Model: task rates p ~ Beta(mean = before rate, a+b = conc), conc 2 very spread, conc 6 moderate; after rate q = min(1, p + shift);",
       "replicates are independent draws. Test: exact two-sided sign-flip on task differences. MDD = realized mean difference in rate",
       "(after clipping at 1) at the smallest shift with 80% power; n/r = 80% power not reached even at q = 1. Null size = rejection",
       "rate under q = p, per alpha.", ""]

out.append("FROZEN BEHAVIOR TABLE (B1 discovery, B3 adherence), F1, 80 tasks x 1, conc 2, rate at the before arm; planning rate 2%.")
out.append("The only behavior table: admission, saturation and the MDDs the plan quotes all read it, by linear interpolation")
out.append("between rows; a rate outside the rows reads the nearest end row. A row marked NOT POWERED carries no verdict.")
for c in [0.01, 0.02, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90]:
    out.append(row(f"  behavior before {round(c*100):>2}%", 80, 1, c, 2, B, flag=True))
out.append("")
out.append("O5, DESCRIPTIVE (after-t minus before-t pass rate), F1, 80 tasks x 1, conc 6, one member (alpha 0.05); no verdict:")
for c in [0.5, 0.6, 0.7, 0.8, 0.9]:
    out.append(row(f"  O5 control {int(c*100):>2}%", 80, 1, c, 6, B[:1]))
out.append("")
out.append("WHY O5 IS NOT A PRIMARY: its MDD with two more replicates (80 x 3), and with every eligible task (145 x 3), conc 6:")
for n in [80, 145]:
    for c in [0.60, 0.65, 0.70]:
        out.append(row(f"  O5 {n} tasks x 3, control {round(c*100)}%", n, 3, c, 6, B[:1]))
out.append("")
out.append("TB2 TWIN (descriptive, tunable), 37 tasks x 2, conc 2, behavior rate at the before arm:")
for c in [0.02, 0.10, 0.50]:
    out.append(row(f"  tasks 37 x 2, before {int(c*100)}%", 37, 2, c, 2, B[:1]))
out.append("")
out.append("#169'S DESIGN, RECOMPUTED (O1 and O2, H-inv, 80 tasks x 3, Holm over four members):")
for conc in [2, 6]:
    for c in [0.3, 0.5, 0.7]:
        out.append(row(f"  H-inv 80 x 3, control {int(c*100)}%, conc {conc}", 80, 3, c, conc, [("Holm4", AHOLM4)]))
print("\n".join(out))
