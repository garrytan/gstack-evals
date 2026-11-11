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
rng = np.random.default_rng(SEED)
print("MDD in points of aftermath pass share at 80%% power, paired by unit; SD_B=%.1f TAU=%.1f; m 1/2/3 at 0.55/0.30/0.15" % (SD_B, TAU))
print("kind    n  K  p0   sd_e  MDD")
for kind in ("pooled", "per-arm"):
    for sd_e in (0.5, 1.0):
        for p0 in (0.3, 0.5):
            for K in (2, 3):
                for n in (24, 32, 40, 48, 64, 80, 96):
                    print("%-7s %2d %d  %.1f  %.1f   %.3f" % (kind, n, K, p0, sd_e, mdd(kind, n, K, p0, sd_e, rng)))
