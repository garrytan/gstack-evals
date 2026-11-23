#!/usr/bin/env python3
# power.py: minimum detectable difference (MDD) for the product-value CEO eval's primary contrast.
# The primary reads, per review of a unit, the share of the unit's specific post-launch items (user signal and
# follow-on features) that the review's capped change list anticipates. A unit's score is the mean of its passes;
# the test is a paired sign-flip on unit-level differences (arm minus control), two-sided.
# Unit difficulty is Beta with mean p0 and concentration set by rho (the unit-level ICC of power.py of the
# 2026-11-04 CEO prereg); each item moves around its unit on the logit scale with sd S_ITEM; the arm moves each
# unit by a logit shift beta plus unit noise tau, with beta solved so the mean lift is delta.
# Items per unit m: "1" is the binary bound (one item a unit, the 2026-11-04 model); "2-4" draws m uniformly from 2, 3, 4;
# "1-2" draws m from 1 and 2 (the supply count's full window reads found a median of 1.5 real items a unit).
# MDD = the smallest delta (0.01 steps) with power >= 0.80. alpha 0.025 is Holm's first step over two contrasts.
# Run: uv run --with numpy==2.3.4 python power.py > power.txt   (seeded; no key, no network)
import numpy as np

SEED = 20261108
SIMS = 1000
FLIPS = 800
S_ITEM = 0.8
STEPS = np.round(np.arange(0.03, 0.41, 0.01), 2)

def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))

def beta_params(p0, rho):
    s = 1 / rho - 1
    return p0 * s, (1 - p0) * s

def draw_items(p0, rho, shape, rng):
    a, b = beta_params(p0, rho)
    pu = np.clip(rng.beta(a, b, shape[:-1]), 1e-4, 1 - 1e-4)
    return logit(pu)[..., None] + rng.normal(0, S_ITEM, shape)

def solve_beta(p0, rho, tau, delta, rng):
    x = draw_items(p0, rho, (50000, 4), rng)
    base = expit(x).mean()
    noise = rng.normal(0, tau, (50000, 1))
    lo, hi = -6.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lift = expit(x + mid + noise).mean() - base
        lo, hi = (mid, hi) if lift < delta else (lo, mid)
    return (lo + hi) / 2, base

def power(p0, rho, tau, n, passes, mset, delta, alpha, rng):
    shift, _ = solve_beta(p0, rho, tau, delta, rng)
    x = draw_items(p0, rho, (SIMS, n, 4), rng)
    m = np.ones((SIMS, n), int) if mset == "1" else rng.integers(1, 3, (SIMS, n)) if mset == "1-2" else rng.integers(2, 5, (SIMS, n))
    mask = np.arange(4)[None, None, :] < m[..., None]
    q0 = expit(x)
    q1 = expit(x + shift + rng.normal(0, tau, (SIMS, n, 1)))
    def score(q):
        hits = rng.binomial(passes, q) / passes
        return (hits * mask).sum(axis=2) / m
    d = score(q1) - score(q0)
    obs = np.abs(d.mean(axis=1))
    signs = rng.choice([-1.0, 1.0], size=(FLIPS, n))
    null = np.abs(d @ signs.T / n)
    pv = (1 + (null >= obs[:, None] - 1e-12).sum(axis=1)) / (FLIPS + 1)
    return (pv <= alpha).mean()

def mdd(p0, rho, tau, n, passes, mset, alpha, rng):
    for delta in STEPS:
        if p0 + delta >= 0.95: return None
        if power(p0, rho, tau, n, passes, mset, delta, alpha, rng) >= 0.80: return float(delta)
    return None

rng = np.random.default_rng(SEED)
f = lambda v: "none<=0.40" if v is None else "%.2f" % v
print("power.py, seed %d, %d simulated runs a point, %d sign flips a run, item sd %.1f, tau 0.5; MDD at 80%% power, two-sided" % (SEED, SIMS, FLIPS, S_ITEM))
print("columns: items per unit m, control p0, ICC rho, units n, passes, MDD at alpha 0.05, MDD at alpha 0.025 (Holm step 1)")
for mset in ("2-4", "1"):
    for n in (48, 64, 80):
        for passes in (2, 1):
            for p0 in (0.20, 0.35):
                for rho in (0.5, 0.843):
                    m5 = mdd(p0, rho, 0.5, n, passes, mset, 0.05, rng)
                    m25 = mdd(p0, rho, 0.5, n, passes, mset, 0.025, rng)
                    print("m %-3s  p0 %.2f  rho %.3f  n %2d  passes %d  MDD05 %s  MDD025 %s" % (mset, p0, rho, n, passes, f(m5), f(m25)), flush=True)
# Added rows (they follow the rows above, so every row above keeps its random stream).
# Higher controls, at the design size.
for p0 in (0.50, 0.60):
    for rho in (0.5, 0.843):
        for passes in (2, 1):
            m5 = mdd(p0, rho, 0.5, 64, passes, "2-4", 0.05, rng)
            m25 = mdd(p0, rho, 0.5, 64, passes, "2-4", 0.025, rng)
            print("m 2-4  p0 %.2f  rho %.3f  n 64  passes %d  MDD05 %s  MDD025 %s" % (p0, rho, passes, f(m5), f(m25)), flush=True)
# Effect-noise sensitivity (tau 0 and 1.0) at the design point.
for tau in (0.0, 1.0):
    for p0 in (0.20, 0.35):
        m5 = mdd(p0, 0.5, tau, 64, 2, "2-4", 0.05, rng)
        m25 = mdd(p0, 0.5, tau, 64, 2, "2-4", 0.025, rng)
        print("tau %.1f  m 2-4  p0 %.2f  rho 0.500  n 64  passes 2  MDD05 %s  MDD025 %s" % (tau, p0, f(m5), f(m25)), flush=True)
# Per-type cells (descriptive): small n, Opus 2 passes, alpha 0.05.
for n in (8, 12, 16, 24):
    for p0 in (0.20, 0.35):
        m5 = mdd(p0, 0.5, 0.5, n, 2, "2-4", 0.05, rng)
        print("type cell  m 2-4  p0 %.2f  rho 0.500  n %2d  passes 2  MDD05 %s" % (p0, n, f(m5)), flush=True)
# One or two items a unit, the item mix the supply count's full window reads found.
for n in (48, 64, 80):
    for passes in (2, 1):
        for p0 in (0.20, 0.35):
            for rho in (0.5, 0.843):
                m5 = mdd(p0, rho, 0.5, n, passes, "1-2", 0.05, rng)
                m25 = mdd(p0, rho, 0.5, n, passes, "1-2", 0.025, rng)
                print("m 1-2  p0 %.2f  rho %.3f  n %2d  passes %d  MDD05 %s  MDD025 %s" % (p0, rho, n, passes, f(m5), f(m25)), flush=True)
