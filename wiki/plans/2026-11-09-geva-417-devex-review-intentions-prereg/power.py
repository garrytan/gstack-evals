#!/usr/bin/env python3
# power.py: minimum detectable difference (MDD) and CUT-CANDIDATE operating characteristics for the
# developer-experience plan review eval's primary contrasts.
# The primary reads, per review of a unit, the share of the unit's after-launch key items (getting-started,
# error, docs and upgrade trouble tied to the change) that the review's capped list of plan changes anticipates.
# A unit's arm score is the mean of its passes; each contrast is a paired sign-flip on unit-level differences
# (arm minus none), two-sided. Two contrasts per model decide verdicts (plan-devex-review minus none and
# autoplan minus none), so Holm's first step runs at alpha 0.05/2 = 0.025.
# Unit difficulty is Beta with mean p0 and concentration set by rho (ICC); each item moves around its unit on the
# logit scale with sd S_ITEM; the arm moves each unit by a logit shift plus unit noise tau, with the shift solved so
# the mean lift is delta. Items per unit m: "1" is one item; "1-2" draws m from 1 and 2; "1-3" from 1, 2 and 3;
# "2-4" from 2, 3 and 4 (uniform).
# MDD = the smallest delta (0.01 steps) with power >= 0.80.
# CUT-CANDIDATE needs the 95% upper bound of arm minus none below the frozen margin +0.05; the simulation reads
# the upper bound as mean + 1.96 * sd / sqrt(n) over unit differences (the prereg uses a cluster bootstrap, which
# this approximates at these sizes) and prints how often a CUT-CANDIDATE reading would follow at each true delta.
# Adapted from the engineering-plan-review intentions prereg's power.py (2026-11-08); the model is unchanged.
# Run: uv run --with numpy==2.3.4 python power.py > power.txt   (seeded; no key, no network)
import numpy as np

SEED = 20261109
SIMS = 1000
FLIPS = 800
S_ITEM = 0.8
TAU = 0.5
MARGIN = 0.05
STEPS = np.round(np.arange(0.03, 0.41, 0.01), 2)
MAXM = 4

def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))

def beta_params(p0, rho):
    s = 1 / rho - 1
    return p0 * s, (1 - p0) * s

def draw_items(p0, rho, shape, rng):
    a, b = beta_params(p0, rho)
    pu = np.clip(rng.beta(a, b, shape[:-1]), 1e-4, 1 - 1e-4)
    return logit(pu)[..., None] + rng.normal(0, S_ITEM, shape)

def solve_shift(p0, rho, tau, delta, rng):
    x = draw_items(p0, rho, (50000, MAXM), rng)
    base = expit(x).mean()
    noise = rng.normal(0, tau, (50000, 1))
    lo, hi = -6.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lift = expit(x + mid + noise).mean() - base
        lo, hi = (mid, hi) if lift < delta else (lo, mid)
    return (lo + hi) / 2

def draw_m(mset, shape, rng):
    if mset == "1": return np.ones(shape, dtype=int)
    if mset == "1-2": return rng.integers(1, 3, shape)
    if mset == "1-3": return rng.integers(1, 4, shape)
    return rng.integers(2, 5, shape)

def unit_diffs(p0, rho, tau, n, passes, mset, delta, rng):
    shift = solve_shift(p0, rho, tau, delta, rng) if delta != 0 else 0.0
    x = draw_items(p0, rho, (SIMS, n, MAXM), rng)
    m = draw_m(mset, (SIMS, n), rng)
    mask = np.arange(MAXM)[None, None, :] < m[..., None]
    q0 = expit(x)
    q1 = expit(x + shift + rng.normal(0, tau, (SIMS, n, 1)))
    def score(q):
        hits = rng.binomial(passes, q) / passes
        return (hits * mask).sum(axis=2) / m
    return score(q1) - score(q0)

def power(p0, rho, tau, n, passes, mset, delta, alpha, rng):
    d = unit_diffs(p0, rho, tau, n, passes, mset, delta, rng)
    obs = np.abs(d.mean(axis=1))
    signs = rng.choice([-1.0, 1.0], size=(FLIPS, n))
    null = np.abs(d @ signs.T / n)
    pv = (1 + (null >= obs[:, None] - 1e-12).sum(axis=1)) / (FLIPS + 1)
    return (pv <= alpha).mean()

def cut_rate(p0, rho, tau, n, passes, mset, delta, rng):
    if delta < 0:
        d = -unit_diffs(p0, rho, tau, n, passes, mset, -delta, rng)
    else:
        d = unit_diffs(p0, rho, tau, n, passes, mset, delta, rng)
    ub = d.mean(axis=1) + 1.96 * d.std(axis=1, ddof=1) / np.sqrt(n)
    return (ub < MARGIN).mean(), np.median(ub - d.mean(axis=1))

def mdd(p0, rho, tau, n, passes, mset, alpha, rng):
    for delta in STEPS:
        if p0 + delta >= 0.95: return None
        if power(p0, rho, tau, n, passes, mset, delta, alpha, rng) >= 0.80: return float(delta)
    return None

rng = np.random.default_rng(SEED)
f = lambda v: "none<=0.40" if v is None else "%.2f" % v
print("power.py, seed %d, %d simulated runs a point, %d sign flips a run, item sd %.1f, tau %.1f; MDD at 80%% power, two-sided" % (SEED, SIMS, FLIPS, S_ITEM, TAU))
print("Part A. columns: items per unit m, control p0, ICC rho, units n, passes, MDD at alpha 0.05, MDD at alpha 0.025 (Holm step 1 of 2)")
for mset in ("1-2", "1-3", "2-4"):
    for n in (48, 64, 80):
        for passes in (2, 1):
            for p0 in (0.20, 0.35):
                for rho in (0.5, 0.843):
                    m5 = mdd(p0, rho, TAU, n, passes, mset, 0.05, rng)
                    m25 = mdd(p0, rho, TAU, n, passes, mset, 0.025, rng)
                    print("m %-3s  p0 %.2f  rho %.3f  n %2d  passes %d  MDD05 %s  MDD025 %s" % (mset, p0, rho, n, passes, f(m5), f(m25)), flush=True)
print("Part B. CUT-CANDIDATE reading (95%% upper bound of arm minus none below +%.2f): share of simulated runs, and the median half-width of the interval at d +0.05" % MARGIN)
for mset in ("1-2", "1-3", "2-4"):
    for n in (64, 80):
        for passes in (2, 1):
            for p0 in (0.20, 0.35):
                row = []
                for delta in (-0.05, -0.02, 0.0, 0.02, 0.05):
                    r, hw = cut_rate(p0, 0.5, TAU, n, passes, mset, delta, rng)
                    row.append("d %+.2f %.3f" % (delta, r))
                print("m %-3s  p0 %.2f  rho 0.500  n %2d  passes %d  half-width %.3f  |  %s" % (mset, p0, n, passes, hw, "  ".join(row)), flush=True)
print("Part C. Sizing to the cut bound: Opus at 2 passes, rho 0.5, true difference 0. Share of runs reading CUT-CANDIDATE and the median interval half-width, by units")
for mset in ("1-2", "2-4"):
    for p0 in (0.20, 0.35):
        row = []
        for n in (64, 128, 192, 256, 320):
            r, hw = cut_rate(p0, 0.5, TAU, n, 2, mset, 0.0, rng)
            row.append("n %3d %.3f (hw %.3f)" % (n, r, hw))
        print("m %-3s  p0 %.2f  |  %s" % (mset, p0, "  ".join(row)), flush=True)
print("Part D. Per-class cells (descriptive): Opus 2 passes, alpha 0.05, rho 0.5")
for n in (12, 16):
    for p0 in (0.20, 0.35):
        print("class cell  m 1-2  p0 %.2f  n %2d  passes 2  MDD05 %s" % (p0, n, f(mdd(p0, 0.5, TAU, n, 2, "1-2", 0.05, rng))), flush=True)
