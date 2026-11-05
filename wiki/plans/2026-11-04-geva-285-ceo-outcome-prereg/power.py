#!/usr/bin/env python3
# power.py: minimum detectable difference (MDD) for the CEO outcome eval's primary contrast (GEVA-285).
# The primary reads hit@3 on changed units: each unit-pass scores 1 when the review's ranked top 3 holds the unit's
# decisive issue. A unit's score is the mean of its passes; the test is a paired sign-flip on unit-level differences
# (arm minus none), two-sided. Unit difficulty is Beta with mean p0 and intra-class correlation rho; the arm moves
# each unit on the logit scale by beta plus unit noise tau, with beta solved so the mean lift is delta.
# MDD = the smallest delta (0.01 steps) with power >= 0.80. alpha 0.025 is Holm's first step over the two gstack arms.
# Run: uv run --with numpy==2.3.4 python power.py > power.txt   (seeded; no key, no network)
import numpy as np

SEED = 20261104
SIMS = 1200
FLIPS = 800
STEPS = np.round(np.arange(0.06, 0.41, 0.01), 2)

def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))

def beta_params(p0, rho):
    s = 1 / rho - 1
    return p0 * s, (1 - p0) * s

def solve_beta(p0, rho, tau, delta, rng):
    a, b = beta_params(p0, rho)
    p = np.clip(rng.beta(a, b, 200000), 1e-4, 1 - 1e-4)
    noise = rng.normal(0, tau, p.size)
    lo, hi = -6.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lift = expit(logit(p) + mid + noise).mean() - p.mean()
        lo, hi = (mid, hi) if lift < delta else (lo, mid)
    return (lo + hi) / 2

def power(p0, rho, tau, n, passes, delta, alpha, rng):
    a, b = beta_params(p0, rho)
    shift = solve_beta(p0, rho, tau, delta, rng)
    p = np.clip(rng.beta(a, b, (SIMS, n)), 1e-4, 1 - 1e-4)
    q = expit(logit(p) + shift + rng.normal(0, tau, (SIMS, n)))
    none = rng.binomial(passes, p) / passes
    arm = rng.binomial(passes, q) / passes
    d = arm - none
    obs = np.abs(d.mean(axis=1))
    signs = rng.choice([-1.0, 1.0], size=(FLIPS, n))
    null = np.abs(d @ signs.T / n)
    pv = (1 + (null >= obs[:, None] - 1e-12).sum(axis=1)) / (FLIPS + 1)
    return (pv <= alpha).mean()

def mdd(p0, rho, tau, n, passes, alpha, rng):
    for delta in STEPS:
        if p0 + delta >= 0.99: return None
        if power(p0, rho, tau, n, passes, delta, alpha, rng) >= 0.80: return float(delta)
    return None

rng = np.random.default_rng(SEED)
print("power.py, seed %d, %d simulated runs a point, %d sign flips a run; MDD at 80%% power, two-sided" % (SEED, SIMS, FLIPS))
print("columns: control p0, ICC rho, effect noise tau, changed units n, passes, MDD at alpha 0.05, MDD at alpha 0.025 (Holm step 1)")
for n in (36, 48, 54, 64):
    for p0 in (0.25, 0.40, 0.55):
        for rho in (0.3, 0.5):
            for tau in (0.0, 0.5):
                m5 = mdd(p0, rho, tau, n, 2, 0.05, rng)
                m25 = mdd(p0, rho, tau, n, 2, 0.025, rng)
                f = lambda m: "none<=0.40" if m is None else "%.2f" % m
                print("p0 %.2f  rho %.1f  tau %.1f  n %2d  passes 2  MDD05 %s  MDD025 %s" % (p0, rho, tau, n, f(m5), f(m25)))
# The frozen design point: n 48 changed units, 2 passes, control 0.40, rho 0.5, tau 0.5.

# The bar check: the top and bottom of the HEADROOM band at n 48 (16 changed units, 3 passes), with ICC 0.5.
# Design effect 1 + (passes - 1) * ICC = 2, so 48 readings carry about 24 effective ones.
from math import comb

def binom_cdf(k, n, p):
    return sum(comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(0, k + 1))

def cp_upper(k, n, a=0.025):
    lo, hi = k / n, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if binom_cdf(k, n, mid) > a else (lo, mid)
    return (lo + hi) / 2

def cp_lower(k, n, a=0.025):
    if k == 0: return 0.0
    lo, hi = 0.0, k / n
    for _ in range(80):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if 1 - binom_cdf(k - 1, n, mid) < a else (lo, mid)
    return (lo + hi) / 2

n, passes, icc = 48, 3, 0.5
deff = 1 + (passes - 1) * icc
neff = round(n / deff)
hi_m, lo_m = int(0.60 * n), -(-15 * n // 100)
print("bar check: n %d, design effect %.1f, effective n %d" % (n, deff, neff))
print("top edge %d of %d = %.3f: effective %d of %d, Clopper-Pearson upper 95%% bound %.3f, room to 1.0 %.3f" % (hi_m, n, hi_m / n, round(hi_m / deff), neff, cp_upper(round(hi_m / deff), neff), 1 - cp_upper(round(hi_m / deff), neff)))
print("bottom edge %d of %d = %.3f: effective %d of %d, Clopper-Pearson lower 95%% bound %.3f" % (lo_m, n, lo_m / n, round(lo_m / deff), neff, cp_lower(round(lo_m / deff), neff)))
