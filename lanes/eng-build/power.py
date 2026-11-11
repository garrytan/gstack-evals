#!/usr/bin/env python3
# MDD for the build read's primary and per-arm secondaries (aftermath pass share), paired by unit. Seeded, keyless.
# Model: unit baseline logit b_u ~ N(logit(p0), SD_B); each skill arm j has its own per-unit effect d_uj ~ N(delta, TAU)
# on the logit scale; each build (its own review and its own build) adds e ~ N(0, SD_E) shared by that build's cases;
# each of the unit's m_u aftermath cases (1 to 3, weights 0.55/0.30/0.15) passes ~ Bernoulli(logistic(b_u+d_uj+e)).
# A unit's arm score is the mean over K builds of the build's pass share.
# pooled: D_u = mean over the three skill arms minus the plain review, two-sided alpha 0.05.
# per-arm: D_u = one skill arm minus the plain review, two-sided alpha 0.0167 (Holm's first step over three).
# Test statistic: the paired cluster t (normal approximation of the sign-flip test). MDD: the smallest difference in mean
# pass share, in points, detected in 80% of runs.
import numpy as np
SEED = 20261111
SD_B = 1.5; TAU = 0.5
M_W = np.array([0.55, 0.30, 0.15])
def lg(x): return 1/(1+np.exp(-x))
def sim(kind, n, K, p0, sd_e, delta, rng, R=1500):
    b = rng.normal(np.log(p0/(1-p0)), SD_B, (R, n))
    m = rng.choice([1,2,3], size=(R, n), p=M_W)
    def score(shift):
        tot = np.zeros((R, n))
        for _ in range(K):
            p = lg(b + shift + rng.normal(0, sd_e, (R, n)))
            tot += rng.binomial(m, p) / m
        return tot / K
    s0 = score(0.0)
    if kind == "pooled":
        s1 = np.mean([score(rng.normal(delta, TAU, (R, n))) for _ in range(3)], axis=0); z = 1.960
    else:
        s1 = score(rng.normal(delta, TAU, (R, n))); z = 2.394
    D = s1 - s0
    t = D.mean(1) / (D.std(1, ddof=1) / np.sqrt(n) + 1e-12)
    return (np.abs(t) > z).mean(), (s1.mean() - s0.mean())
def mdd(kind, n, K, p0, sd_e, rng):
    lo, hi = 0.0, 3.0
    for _ in range(13):
        mid = (lo+hi)/2
        if sim(kind, n, K, p0, sd_e, mid, rng)[0] >= 0.8: hi = mid
        else: lo = mid
    return sim(kind, n, K, p0, sd_e, hi, rng, R=4000)[1]
# --- parametric mode (lanes/eng-build, added after the freeze): the re-projection's inputs on the frozen sim and mdd ---
# With no arguments the script runs the frozen grid below and prints power.txt byte for byte. With arguments it prints
# one MDD from the same sim and mdd, at the given n, K, p0, sd_e and kind (SD_B and TAU default to the frozen values),
# or, with --fit pilot.json, refits p0, SD_B, sd_e and the unwinnable share from the pilot's builds and prints the pooled
# MDD for each design the frozen cuts reach (48x3, 40x3, 40x2), scaled by 1/sqrt(1 - unwinnable) as section 9 states.
# pilot.json: {"builds": [{"unit": "u1", "arm": "plain", "share": 0.5}, ...]}, one aftermath pass share per scored
# pilot build (arms none and plain).
import sys
if len(sys.argv) > 1:
    import argparse, json
    ap = argparse.ArgumentParser(description="one MDD on the frozen model, or the pilot refit")
    ap.add_argument("--kind", choices=["pooled", "per-arm"], default="pooled")
    ap.add_argument("--n", type=int, default=48)
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--p0", type=float, default=0.3)
    ap.add_argument("--sd-e", dest="sd_e", type=float, default=0.5)
    ap.add_argument("--sd-b", dest="sd_b", type=float, default=SD_B)
    ap.add_argument("--tau", type=float, default=TAU)
    ap.add_argument("--unwinnable", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--fit")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    SD_B, TAU = a.sd_b, a.tau
    def scaled(kind, n, K, p0, sd_e, unwinnable):
        return mdd(kind, n, K, p0, sd_e, np.random.default_rng(a.seed)) / np.sqrt(1 - unwinnable)
    if a.fit:
        builds = json.load(open(a.fit))["builds"]
        units = {}
        for b in builds:
            units.setdefault(b["unit"], []).append(b)
        dead = [u for u, bs in units.items() if all(b["share"] == 0 for b in bs)]
        unwinnable = len(dead) / len(units)
        plain = {u: [b["share"] for b in bs if b["arm"] == "plain"] for u, bs in units.items() if u not in dead}
        plain = {u: s for u, s in plain.items() if s}
        p0 = float(np.clip(np.mean([x for s in plain.values() for x in s]), 0.02, 0.95))
        means = [np.mean(s) for s in plain.values()]
        within = [np.var(s, ddof=1) for s in plain.values() if len(s) > 1]
        obs_b = float(np.var(means, ddof=1)) if len(means) > 1 else 0.0
        obs_w = float(np.mean(within)) if within else 0.0
        rng = np.random.default_rng(a.seed)
        best = None
        for sd_b in np.arange(0.25, 3.01, 0.25):
            for sd_e in np.arange(0.0, 2.01, 0.25):
                bb = rng.normal(np.log(p0/(1-p0)), sd_b, 4000)
                m = rng.choice([1,2,3], size=4000, p=M_W)
                s = np.stack([rng.binomial(m, lg(bb + rng.normal(0, sd_e, 4000))) / m for _ in range(2)])
                err = (np.var(s.mean(0), ddof=1) - obs_b) ** 2 + (np.mean(np.var(s, axis=0, ddof=1)) - obs_w) ** 2
                if best is None or err < best[0]:
                    best = (err, float(sd_b), float(sd_e))
        SD_B = best[1]
        fitted = {"p0": round(p0, 4), "sd_b": best[1], "sd_e": best[2], "tau": TAU, "unwinnable": round(unwinnable, 4), "units": len(units), "builds": len(builds)}
        out = {"fitted": fitted, "mdd": {"%dx%d" % (n, K): round(float(scaled("pooled", n, K, p0, best[2], unwinnable)), 4) for n, K in ((48, 3), (40, 3), (40, 2))}}
        print(json.dumps(out) if a.json else json.dumps(out, indent=1))
    else:
        v = float(scaled(a.kind, a.n, a.k, a.p0, a.sd_e, a.unwinnable))
        if a.json:
            print(json.dumps({"kind": a.kind, "n": a.n, "k": a.k, "p0": a.p0, "sd_e": a.sd_e, "sd_b": SD_B, "tau": TAU, "unwinnable": a.unwinnable, "seed": a.seed, "mdd": round(v, 4)}))
        else:
            print("kind    n  K  p0   sd_e  MDD")
            print("%-7s %2d %d  %.1f  %.1f   %.3f" % (a.kind, a.n, a.k, a.p0, a.sd_e, v))
    sys.exit(0)
# --- end parametric mode ---
rng = np.random.default_rng(SEED)
print("MDD in points of aftermath pass share at 80%% power, paired by unit; SD_B=%.1f TAU=%.1f; m 1/2/3 at 0.55/0.30/0.15" % (SD_B, TAU))
print("kind    n  K  p0   sd_e  MDD")
for kind in ("pooled", "per-arm"):
    for sd_e in (0.5, 1.0):
        for p0 in (0.3, 0.5):
            for K in (2, 3):
                for n in (24, 32, 40, 48, 64, 80, 96):
                    print("%-7s %2d %d  %.1f  %.1f   %.3f" % (kind, n, K, p0, sd_e, mdd(kind, n, K, p0, sd_e, rng)))
