#!/usr/bin/env python3
# power.py: minimum detectable difference (MDD) for the design plan review eval's primary contrasts, the comparison
# set size the MDD rule needs, and how often a true zero would sit under the +0.05 bound.
# The primary reads, per review of a unit, the share of the unit's primary key items (UI problems users reported and UI
# fixes the team made in the 60 days after the merge, classes S, H, R, A and Y) that the review's capped list of plan
# changes anticipates. A unit's arm score is the mean of its passes; each contrast is a paired sign-flip on
# arm-minus-none differences, two-sided, clustered on the repository (the shared frame allows up to 3 units a
# repository, so units of one repository flip together). Two contrasts are compared with none on each model
# (plan-design-review and autoplan), so Holm's first step runs at alpha 0.05/2.
# Unit difficulty is Beta with mean p0 and concentration set by rho (ICC); each item moves around its unit on the
# logit scale with sd S_ITEM; the arm moves each unit by a logit shift plus unit noise TAU plus a repository effect
# shared by the repository's units (sd TAU_R), with the shift solved so the mean lift is delta.
# Repository sizes follow REPO_MIX, from the shared frame's UI sample (19 capped units from 8 repositories, so mostly
# repositories of 3); one seeded layout per n. Items per unit m: "1-2" draws m from 1 and 2 (the planning mix that binds
# sizing); "2-4" from 2, 3 and 4; "count" from COUNT_MIX, the data in hand: the shared frame's full reads found one
# keyable UI unit, and it had 4 items, so this row rests on one unit and binds nothing.
# MDD = the smallest delta (0.01 steps) with power >= 0.80.
# The bound read uses the 95% upper bound of arm minus none as mean + 1.96 * se, se from repository sums (the prereg
# uses a repository cluster bootstrap, which this approximates at these sizes).
# Run: uv run --with numpy==2.3.4 python power.py > power.txt   (seeded; no key, no network)
import numpy as np

SEED = 20261109
SIMS = 1000
FLIPS = 800
S_ITEM = 0.8
TAU = 0.5
TAU_R = 0.3
MARGIN = 0.05
STEPS = np.round(np.arange(0.03, 0.41, 0.01), 2)
REPO_MIX = {1: 0.20, 2: 0.25, 3: 0.55}
COUNT_MIX = {1: 0.0, 2: 0.0, 3: 0.0, 4: 1.0}
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

def layout(n, rng):
    ks = np.array(sorted(REPO_MIX)); ps = np.array([REPO_MIX[k] for k in ks])
    ids, r = [], 0
    while len(ids) < n:
        ids += [r] * int(rng.choice(ks, p=ps)); r += 1
    ids = np.array(ids[:n])
    return ids, ids.max() + 1

def solve_shift(p0, rho, delta, tau_r, rng):
    x = draw_items(p0, rho, (50000, MAXM), rng)
    base = expit(x).mean()
    noise = rng.normal(0, np.sqrt(TAU ** 2 + tau_r ** 2), (50000, 1))
    lo, hi = -6.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lift = expit(x + mid + noise).mean() - base
        lo, hi = (mid, hi) if lift < delta else (lo, mid)
    return (lo + hi) / 2

def draw_m(mset, shape, rng):
    if mset == "1-2": return rng.integers(1, 3, shape)
    if mset == "2-4": return rng.integers(2, 5, shape)
    ks = np.array(sorted(COUNT_MIX)); ps = np.array([COUNT_MIX[k] for k in ks]); ps = ps / ps.sum()
    return rng.choice(ks, size=shape, p=ps)

def unit_diffs(p0, rho, n, passes, mset, delta, tau_r, ids, R, rng):
    shift = solve_shift(p0, rho, delta, tau_r, rng) if delta != 0 else 0.0
    x = draw_items(p0, rho, (SIMS, n, MAXM), rng)
    m = draw_m(mset, (SIMS, n), rng)
    mask = np.arange(MAXM)[None, None, :] < m[..., None]
    q0 = expit(x)
    reff = rng.normal(0, tau_r, (SIMS, R))[:, ids][..., None] if tau_r > 0 else 0.0
    q1 = expit(x + shift + reff + rng.normal(0, TAU, (SIMS, n, 1)))
    def score(q):
        hits = rng.binomial(passes, q) / passes
        return (hits * mask).sum(axis=2) / m
    return score(q1) - score(q0)

def repo_sums(d, ids, R):
    out = np.zeros((d.shape[0], R))
    np.add.at(out.T, ids, d.T)
    return out

def pvalues(p0, rho, n, passes, mset, delta, tau_r, ids, R, rng):
    d = unit_diffs(p0, rho, n, passes, mset, delta, tau_r, ids, R, rng)
    s = repo_sums(d, ids, R)
    obs = np.abs(s.sum(axis=1)) / n
    signs = rng.choice([-1.0, 1.0], size=(FLIPS, R))
    null = np.abs(s @ signs.T / n)
    return (1 + (null >= obs[:, None] - 1e-12).sum(axis=1)) / (FLIPS + 1)

def mdds(p0, rho, n, passes, mset, tau_r, rng):
    ids, R = layout(n, rng)
    out = {0.05: None, 0.025: None}
    for delta in STEPS:
        if p0 + delta >= 0.95: break
        pv = pvalues(p0, rho, n, passes, mset, delta, tau_r, ids, R, rng)
        for a in out:
            if out[a] is None and (pv <= a).mean() >= 0.80: out[a] = float(delta)
        if out[0.025] is not None: break
    return out[0.05], out[0.025]

def bound_rate(p0, rho, n, passes, mset, delta, rng):
    ids, R = layout(n, rng)
    d = unit_diffs(p0, rho, n, passes, mset, abs(delta), TAU_R, ids, R, rng) * (1 if delta >= 0 else -1)
    s = repo_sums(d, ids, R)
    mean = s.sum(axis=1) / n
    cnt = np.bincount(ids, minlength=R)[None, :]
    se = np.sqrt(R / (R - 1) * ((s - mean[:, None] * cnt) ** 2).sum(axis=1)) / n
    ub = mean + 1.96 * se
    return (ub < MARGIN).mean(), float(np.median(1.96 * se))

rng = np.random.default_rng(SEED)
f = lambda v: "none<=0.40" if v is None else "%.2f" % v
MSETS = ("1-2", "2-4", "count")
print("power.py, seed %d, %d simulated runs a point, %d sign flips a run, item sd %.1f, tau %.1f, repository tau %.1f; MDD at 80%% power, two-sided, clustered on the repository" % (SEED, SIMS, FLIPS, S_ITEM, TAU, TAU_R))
print("repository sizes: %s; count mix (shares of keyable units with 1, 2, 3, 4 items, from data in hand, one unit): %s" % (REPO_MIX, COUNT_MIX))
print("Part A. columns: items per unit m, control p0, ICC rho, units n, passes, MDD at alpha 0.05, MDD at alpha 0.025 (Holm step 1 of 2)")
for mset in MSETS:
    for n in (48, 56, 64, 72):
        for passes in (2, 1):
            for p0 in (0.20, 0.35):
                for rho in (0.5, 0.843):
                    m5, m25 = mdds(p0, rho, n, passes, mset, TAU_R, rng)
                    print("m %-5s  p0 %.2f  rho %.3f  n %2d  passes %d  MDD05 %s  MDD025 %s" % (mset, p0, rho, n, passes, f(m5), f(m25)), flush=True)
print("Part B. Size the MDD rule needs: the smallest n (steps of 8) with MDD025 <= 0.12 on Opus (2 passes, rho 0.5), and the MDD025 at that n")
for mset in ("1-2", "2-4"):
    for p0 in (0.20, 0.35):
        hit = None
        for n in range(40, 129, 8):
            m5, m25 = mdds(p0, 0.5, n, 2, mset, TAU_R, rng)
            if m25 is not None and m25 <= 0.12:
                hit = (n, m25); break
        print("m %-5s  p0 %.2f  rho 0.500  passes 2  n needed %s" % (mset, p0, "over 128" if hit is None else "%d (MDD025 %.2f)" % hit), flush=True)
print("Part C. Repository effect sensitivity: Opus, 2 passes, rho 0.5, n 64")
for mset in ("1-2", "2-4"):
    for tau_r in (0.0, 0.3, 0.6):
        for p0 in (0.20, 0.35):
            m5, m25 = mdds(p0, 0.5, 64, 2, mset, tau_r, rng)
            print("m %-5s  p0 %.2f  repository tau %.1f  n 64  MDD05 %s  MDD025 %s" % (mset, p0, tau_r, f(m5), f(m25)), flush=True)
print("Part D. Upper bound below +%.2f (descriptive here: no CUT-CANDIDATE can come from this eval): share of simulated runs at each true difference, and the median half-width at d +0.05" % MARGIN)
for mset in ("1-2", "2-4"):
    for n in (48, 64):
        for passes in (2, 1):
            for p0 in (0.20, 0.35):
                row, hw = [], 0.0
                for delta in (-0.05, 0.0, 0.05):
                    r, hw = bound_rate(p0, 0.5, n, passes, mset, delta, rng)
                    row.append("d %+.2f %.3f" % (delta, r))
                print("m %-5s  p0 %.2f  rho 0.500  n %2d  passes %d  half-width %.3f  |  %s" % (mset, p0, n, passes, hw, "  ".join(row)), flush=True)
print("Part E. Descriptive cells: Opus 2 passes, alpha 0.05, rho 0.5 (per surface or per class)")
for n in (16, 24, 32):
    for p0 in (0.20, 0.35):
        m5, _ = mdds(p0, 0.5, n, 2, "1-2", TAU_R, rng)
        print("cell  m 1-2  p0 %.2f  n %2d  passes 2  MDD05 %s" % (p0, n, f(m5)), flush=True)
print("Part F. Stage 1 headroom read: Opus none on 16 calibration units at 3 passes; 95% interval half-width of the unit-mean A")
for mset in MSETS:
    for p0 in (0.10, 0.20, 0.35, 0.50, 0.65):
        hw = []
        for _ in range(400):
            a, b = beta_params(p0, 0.5)
            pu = np.clip(rng.beta(a, b, 16), 1e-4, 1 - 1e-4)
            x = logit(pu)[:, None] + rng.normal(0, S_ITEM, (16, MAXM))
            m = draw_m(mset, (16,), rng)
            mask = np.arange(MAXM)[None, :] < m[:, None]
            s = ((rng.binomial(3, expit(x)) / 3) * mask).sum(axis=1) / m
            hw.append(1.96 * s.std(ddof=1) / np.sqrt(16))
        print("m %-5s  p0 %.2f  n 16  passes 3  median half-width %.3f" % (mset, p0, float(np.median(hw))), flush=True)
