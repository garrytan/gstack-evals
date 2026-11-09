#!/usr/bin/env python3
# power.py: precision and verdict operating characteristics for the autoplan run-record audit.
# The audit is observational: it reads the records autoplan already left and estimates rates, so nothing here is a
# head-to-head power figure. Each part simulates one frozen reading at the frame's real sizes (section 4):
#   A. accepted changes that land in the built plan (AP-GATE-2), lean primary estimand (runs whose gate-time plan
#      carries wiki front matter): the panel labels every unit (a census); the observed LANDED share is corrected for
#      the panel's sensitivity and specificity measured on gold (Rogan-Gladen), with Jeffreys posterior draws for both
#      inside a run-level bootstrap, widened for few runs (unclipped draws scaled about the unclipped point estimate
#      by sqrt(G/(G-1)) x t(0.975, G-1)/1.96 for G runs, then clipped to [0, 1]); the panel's errors are simulated;
#   B. the lean (every unit with a built text) minus full (40 sampled units) difference on the same rate (descriptive; MDD);
#      one panel measures both strata, so each bootstrap draw uses the same sensitivity and specificity for both;
#   C. the share of required outputs present per run (AP-X-2), lean and full, and their MDD;
#   D. the one-pass reading per run (AP-X-1), a Wilson interval on k of n;
#   E. the gate's zero-violation reading (AP-GATE-1): the exact upper bound when no violation is seen;
#   F. interval widths for the full-kind outside-voice readings (AP-X-3, descriptive).
# Intervals are 95% run-level (cluster) percentile bootstraps unless named otherwise. A reading is MET when the lower
# bound is at or above the bar, NOT MET when the upper bound is below it, and UNCLEAR otherwise.
# Run: uv run --with numpy==2.3.4 python power.py > power.txt   (seeded; no key, no network)
import numpy as np

SEED = 20261109
SIMS = 1000
BOOT = 400
LEAN_PRIMARY = [3, 7, 6, 2, 1, 11, 6, 3, 2, 2]
LEAN_ALL = LEAN_PRIMARY + [7, 1, 3, 3]
FULL_RUNS = [41, 15, 17, 1, 5, 4, 11, 9]
FULL_SAMPLE = 40
GOLD_PER_CLASS = 40
BAR_LAND = 0.90
BAR_SHARE = 0.80
LEAN_CELLS = [16] * 6 + [21] * 16
FULL_CELLS = [18] * 9 + [24] * 3 + [27]

T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131}

rng = np.random.default_rng(SEED)

def beta_draw(mean, rho, size):
    if rho <= 0: return np.full(size, mean)
    s = 1 / rho - 1
    a, b = max(mean * s, 1e-6), max((1 - mean) * s, 1e-6)
    return rng.beta(a, b, size)

def labelled(sizes, land, rho, sens, spec, miss=0.0):
    p = beta_draw(land, rho, len(sizes))
    out = []
    for i, n in enumerate(sizes):
        truth = rng.random(n) < p[i]
        lab = np.where(truth, rng.random(n) < sens, rng.random(n) >= spec)
        keep = rng.random(n) >= miss
        out.append(lab[keep])
    return out

def gold(sens, spec):
    return rng.binomial(GOLD_PER_CLASS, sens), rng.binomial(GOLD_PER_CLASS, spec)

def corrected(o, se, sp):
    return (o + sp - 1) / np.maximum(se + sp - 1, 1e-6)

def calib(gk, boot=BOOT):
    return rng.beta(gk[0] + 0.5, GOLD_PER_CLASS - gk[0] + 0.5, boot), rng.beta(gk[1] + 0.5, GOLD_PER_CLASS - gk[1] + 0.5, boot)

def census(runs, gk, draws=None, boot=BOOT):
    k = np.array([r.sum() for r in runs]); n = np.array([len(r) for r in runs])
    se, sp = draws if draws is not None else calib(gk, boot)
    i = rng.integers(0, len(n), (boot, len(n)))
    o = k[i].sum(1) / np.maximum(n[i].sum(1), 1)
    point = corrected(k.sum() / max(n.sum(), 1), gk[0] / GOLD_PER_CLASS, gk[1] / GOLD_PER_CLASS)
    g = len(n); f = np.sqrt(g / (g - 1)) * T975[g - 1] / 1.959964
    return float(np.clip(point, 0, 1)), np.clip(point + (corrected(o, se, sp) - point) * f, 0, 1)

def sample_full(runs):
    owner = np.concatenate([np.full(len(r), j) for j, r in enumerate(runs)])
    labs = np.concatenate(runs)
    pick = rng.choice(len(labs), min(FULL_SAMPLE, len(labs)), replace=False)
    return [labs[pick][owner[pick] == j] for j in range(len(runs)) if (owner[pick] == j).any()]

def verdict(lo, hi, bar):
    return "MET" if lo >= bar else ("NOT" if hi < bar else "UNC")

print(f"power.py, seed {SEED}, {SIMS} simulated audits a point, {BOOT} bootstrap draws an audit")
print(f"lean primary units: {sum(LEAN_PRIMARY)} over {len(LEAN_PRIMARY)} runs; lean with a built text: {sum(LEAN_ALL)} over {len(LEAN_ALL)} runs; full: {sum(FULL_RUNS)} over {len(FULL_RUNS)} runs, {FULL_SAMPLE} sampled")
print(f"gold: {GOLD_PER_CLASS} items a binary class; panel sensitivity and specificity drawn from Jeffreys posteriors on gold in every bootstrap draw")
print()
print("Part A. AP-GATE-2 lean primary landed share, bar 0.90. columns: true share, ICC rho, panel sensitivity, specificity, missing labels, P(MET), P(NOT MET), P(UNCLEAR), coverage of the 95% interval, median half-width")
for rho, se, sp, miss in ((0.05, 0.95, 0.95, 0.0), (0.30, 0.95, 0.95, 0.0), (0.30, 0.90, 0.85, 0.0), (0.30, 0.90, 0.85, 0.10)):
    for land in (0.75, 0.80, 0.85, 0.90, 0.95, 1.00):
        v = []; hw = []; cov = 0
        for _ in range(SIMS):
            _, b = census(labelled(LEAN_PRIMARY, land, rho, se, sp, miss), gold(se, sp))
            lo, hi = np.percentile(b, [2.5, 97.5])
            v.append(verdict(lo, hi, BAR_LAND)); hw.append((hi - lo) / 2); cov += lo <= land <= hi
        v = np.array(v)
        print(f"L {land:.2f}  rho {rho:.2f}  sens {se:.2f}  spec {sp:.2f}  miss {miss:.2f}  MET {np.mean(v=='MET'):.3f}  NOT {np.mean(v=='NOT'):.3f}  UNC {np.mean(v=='UNC'):.3f}  coverage {cov / SIMS:.3f}  halfwidth {np.median(hw):.3f}")
print()
print("Part B. lean (every unit with a built text) minus full (40 sampled units) landed share, descriptive. columns: ICC rho, sensitivity, specificity, MDD (smallest full deficit with 80% of intervals excluding 0), lean held at 0.95")
for rho, se, sp in ((0.05, 0.95, 0.95), (0.30, 0.95, 0.95), (0.30, 0.90, 0.85)):
    mdd = None
    for d in np.round(np.arange(0.04, 0.62, 0.04), 2):
        ex = 0
        for _ in range(SIMS // 2):
            gk = gold(se, sp)
            cd = calib(gk)
            _, bl = census(labelled(LEAN_ALL, 0.95, rho, se, sp), gk, cd)
            _, bf = census(sample_full(labelled(FULL_RUNS, 0.95 - d, rho, se, sp)), gk, cd)
            ex += np.percentile(bl - bf, 2.5) > 0
        if ex / (SIMS // 2) >= 0.80: mdd = d; break
    print(f"rho {rho:.2f}  sens {se:.2f}  spec {sp:.2f}  MDD {mdd if mdd is not None else '>0.60'}")
print()

def shares(cells, mean, rho):
    p = beta_draw(mean, rho, len(cells))
    return rng.binomial(np.array(cells), p) / np.array(cells)

def boot_mean(x):
    i = rng.integers(0, len(x), (BOOT, len(x)))
    return np.percentile(x[i].mean(1), [2.5, 97.5])

print("Part C. AP-X-2 share of required outputs present, bar 0.80. columns: stratum, runs, applicable cells a run (observed, lean consensus excluded), true mean, ICC rho, P(MET), P(NOT MET), P(UNCLEAR), median half-width")
for name, cells, label in (("lean", LEAN_CELLS, "[16]*6+[21]*16"), ("full", FULL_CELLS, "[18]*9+[24]*3+[27]")):
    n = len(cells)
    for rho in (0.10, 0.30):
        for mean in (0.50, 0.70, 0.80, 0.90, 0.95):
            v = []; hw = []
            for _ in range(SIMS):
                ci = boot_mean(shares(cells, mean, rho))
                v.append(verdict(ci[0], ci[1], BAR_SHARE)); hw.append((ci[1] - ci[0]) / 2)
            v = np.array(v)
            print(f"{name}  n {n}  cells {label}  mean {mean:.2f}  rho {rho:.2f}  MET {np.mean(v=='MET'):.3f}  NOT {np.mean(v=='NOT'):.3f}  UNC {np.mean(v=='UNC'):.3f}  halfwidth {np.median(hw):.3f}")
print("lean minus full MDD (80% of 95% bootstrap intervals exclude 0), full held at 0.50:")
for rho in (0.10, 0.30):
    mdd = None
    for d in np.round(np.arange(0.04, 0.52, 0.02), 2):
        ex = 0
        for _ in range(SIMS // 2):
            a = shares(LEAN_CELLS, 0.50 + d, rho); b = shares(FULL_CELLS, 0.50, rho)
            ia = rng.integers(0, len(LEAN_CELLS), (BOOT, len(LEAN_CELLS))); ib = rng.integers(0, len(FULL_CELLS), (BOOT, len(FULL_CELLS)))
            lo = np.percentile(a[ia].mean(1) - b[ib].mean(1), 2.5)
            ex += lo > 0
        if ex / (SIMS // 2) >= 0.80: mdd = d; break
    print(f"rho {rho:.2f}  MDD {mdd}")
print()

def wilson(k, n, z=1.959964):
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h

print("Part D. AP-X-1 one-pass reading per run, Wilson 95%, bar 0.80. smallest k of n that reads MET, and P(MET) at true rates")
for n in (22, 35):
    kmin = next(k for k in range(n + 1) if wilson(k, n)[0] >= BAR_SHARE)
    kmax_not = max([k for k in range(n + 1) if wilson(k, n)[1] < BAR_SHARE], default=None)
    line = f"n {n}  MET needs k >= {kmin}  NOT MET when k <= {kmax_not}"
    for p in (0.80, 0.90, 0.95, 0.98, 1.00):
        k = rng.binomial(n, p, 20000)
        line += f"  P(MET|p={p:.2f}) {np.mean(k >= kmin):.3f}"
    print(line)
print()
print("Part E. AP-GATE-1 zero-violation reading: exact one-sided 95% upper bound on the violation rate when 0 of n gates violate")
for n in (22, 35):
    print(f"n {n}  upper bound {1 - 0.05 ** (1 / n):.3f}")
print()
print("Part F. AP-X-3 full-kind readings (descriptive), Wilson 95% half-widths")
for n, label in ((31, "phases, outside ran"), (22, "completed phases, cross-family"), (118, "outside findings, outside only (no clustering)")):
    for p in (0.50, 0.80, 0.95):
        lo, hi = wilson(round(p * n), n)
        print(f"n {n} {label}  p {p:.2f}  halfwidth {(hi - lo) / 2:.3f}")
