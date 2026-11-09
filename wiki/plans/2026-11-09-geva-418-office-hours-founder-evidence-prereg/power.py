#!/usr/bin/env python3
# power.py: minimum detectable difference (MDD) and CUT-CANDIDATE operating characteristics for the
# office-hours founder eval's primary contrast, with the two secondaries' MDDs beside it.
# Primary W is binary per session: the session's recommended first move names the real wedge or the real first
# customer (1) or not (0). A unit's arm score is the mean of its passes; the contrast is a paired sign-flip on
# unit-level differences (office-hours minus none), two-sided at alpha 0.05, because each model has one primary
# contrast (no autoplan arm, and the lens contrasts are side comparisons).
# Unit difficulty for none is Beta with mean p0 and concentration set by rho (the share of session variance that
# sits between units); the skill moves each unit by a logit shift plus unit noise tau, with the shift solved so the
# mean lift is delta. Secondary E (share of a unit's 4 to 8 key facts drawn out) adds fact noise S_ITEM on the logit
# scale around each unit. MDD = the smallest delta (0.01 steps) with power >= 0.80.
# CUT-CANDIDATE needs the 95% upper bound of office-hours minus none below the frozen margin +0.05; the simulation
# reads the upper bound as mean + 1.96 * sd / sqrt(n) over unit differences (the prereg uses a cluster bootstrap,
# which this approximates at these sizes) and prints how often that reading would follow at each true delta.
# Run: uv run --with numpy==2.3.4 python power.py > power.txt   (seeded; no key, no network)
import numpy as np

SEED = 20261109
SIMS = 1000
FLIPS = 800
S_ITEM = 0.8
TAU = 0.5
MARGIN = 0.05
STEPS = np.round(np.arange(0.03, 0.51, 0.01), 2)

def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))

def beta_params(p0, rho):
    s = 1 / rho - 1
    return p0 * s, (1 - p0) * s

def unit_logits(p0, rho, shape, rng):
    a, b = beta_params(p0, rho)
    return logit(np.clip(rng.beta(a, b, shape), 1e-4, 1 - 1e-4))

def solve_shift(p0, rho, tau, delta, rng, facts):
    x = unit_logits(p0, rho, (50000, 1), rng)
    if facts:
        x = x + rng.normal(0, S_ITEM, (50000, 8))
    base = expit(x).mean()
    noise = rng.normal(0, tau, (50000, 1))
    lo, hi = -8.0, 8.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lift = expit(x + mid + noise).mean() - base
        lo, hi = (mid, hi) if lift < delta else (lo, mid)
    return (lo + hi) / 2

def unit_diffs(p0, rho, tau, n, passes, delta, rng, facts=False):
    shift = solve_shift(p0, rho, tau, delta, rng, facts) if delta != 0 else 0.0
    u = unit_logits(p0, rho, (SIMS, n, 1), rng)
    if facts:
        m = rng.integers(4, 9, (SIMS, n))
        mask = np.arange(8)[None, None, :] < m[..., None]
        x = u + rng.normal(0, S_ITEM, (SIMS, n, 8))
    else:
        m = np.ones((SIMS, n), dtype=int)
        mask = np.ones((SIMS, n, 1), dtype=bool)
        x = u
    q0 = expit(x)
    q1 = expit(x + shift + rng.normal(0, tau, (SIMS, n, 1)))
    def score(q):
        hits = rng.binomial(passes, q) / passes
        return (hits * mask).sum(axis=2) / m
    return score(q1) - score(q0)

def power(p0, rho, tau, n, passes, delta, alpha, rng, facts=False):
    d = unit_diffs(p0, rho, tau, n, passes, delta, rng, facts)
    obs = np.abs(d.mean(axis=1))
    signs = rng.choice([-1.0, 1.0], size=(FLIPS, n))
    null = np.abs(d @ signs.T / n)
    pv = (1 + (null >= obs[:, None] - 1e-12).sum(axis=1)) / (FLIPS + 1)
    return (pv <= alpha).mean()

def mdd(p0, rho, tau, n, passes, alpha, rng, facts=False):
    for delta in STEPS:
        if p0 + delta >= 0.95: return None
        if power(p0, rho, tau, n, passes, delta, alpha, rng, facts) >= 0.80: return float(delta)
    return None

def cut_rate(p0, rho, tau, n, passes, delta, rng):
    if delta < 0:
        d = -unit_diffs(p0, rho, tau, n, passes, -delta, rng)
    else:
        d = unit_diffs(p0, rho, tau, n, passes, delta, rng)
    ub = d.mean(axis=1) + 1.96 * d.std(axis=1, ddof=1) / np.sqrt(n)
    return (ub < MARGIN).mean(), np.median(ub - d.mean(axis=1))

rng = np.random.default_rng(SEED)
f = lambda v: "none<=0.50" if v is None else "%.2f" % v
print("power.py, seed %d, %d simulated runs a point, %d sign flips a run, fact sd %.1f, tau %.1f; MDD at 80%% power, two-sided, alpha 0.05" % (SEED, SIMS, FLIPS, S_ITEM, TAU))
print("Part A. Primary W (binary per session). columns: control p0, ICC rho, units n, passes, MDD")
for n in (40, 48, 56, 64, 80):
    for passes in (2, 1):
        for p0 in (0.15, 0.25, 0.35, 0.50):
            for rho in (0.5, 0.843):
                print("W  p0 %.2f  rho %.3f  n %2d  passes %d  MDD %s" % (p0, rho, n, passes, f(mdd(p0, rho, TAU, n, passes, 0.05, rng))), flush=True)
print("Part B. CUT-CANDIDATE reading on W (95%% upper bound of office-hours minus none below +%.2f): share of simulated runs at each true difference d, and the median half-width of the interval" % MARGIN)
for n in (48, 56, 64, 80):
    for passes in (2, 1):
        for p0 in (0.25, 0.35):
            row = []
            hw = None
            for delta in (-0.15, -0.10, -0.05, 0.0, 0.05):
                r, h = cut_rate(p0, 0.5, TAU, n, passes, delta, rng)
                hw = h if delta == 0.0 else hw
                row.append("d %+.2f %.3f" % (delta, r))
            print("W  p0 %.2f  rho 0.500  n %2d  passes %d  half-width %.3f  |  %s" % (p0, n, passes, hw, "  ".join(row)), flush=True)
print("Part C. Secondary E (share of 4 to 8 key facts drawn out, mechanical) and N (binary, as W): MDD at alpha 0.05")
for n in (48, 56, 64):
    for passes in (2, 1):
        for p0 in (0.20, 0.35, 0.50):
            print("E  p0 %.2f  rho 0.500  n %2d  passes %d  MDD %s" % (p0, n, passes, f(mdd(p0, 0.5, TAU, n, passes, 0.05, rng, facts=True))), flush=True)
print("Part D. Per-type cells (descriptive): W, Opus 2 passes, alpha 0.05, rho 0.5")
for n in (8, 12, 16):
    for p0 in (0.25, 0.35):
        print("type cell  W  p0 %.2f  n %2d  passes 2  MDD %s" % (p0, n, f(mdd(p0, 0.5, TAU, n, 2, 0.05, rng))), flush=True)
