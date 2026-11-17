#!/usr/bin/env python3
# power.py: minimum detectable difference (MDD) for the constructed design eval's primary contrasts, the admission read
# on a planned or measured design, and stage 1's headroom half-width.
# It keeps the simulation of the 2026-11-09 design prereg's power.py (attached there, sha256 ab79cd19...) unchanged and
# changes three things. Units sit on base apps of a fixed size (4 units an app at the planned size) instead of the
# shared frame's repository mix, and the base app takes the repository's place as the cluster. Each unit's key holds 3
# to 5 primary items ("3-5" draws m from 3, 4 and 5), with "3" as the floor every unit must meet. Design mode also
# prints the MDD at Holm's first step on the design it reads.
# The primary reads, per review of a unit, the share of the unit's primary key items (the design decisions the
# product's own evidence supports, classes S, H, R, A and Y) that the review's capped list of plan changes names, screen
# and condition both. A unit's arm score is the mean of its passes; each contrast is a paired sign-flip on arm-minus-none
# differences, two-sided, clustered on the base app, so units of one app flip together. Two contrasts are compared
# with none on each model (plan-design-review and autoplan), so Holm's first step runs at alpha 0.05/2.
# Unit difficulty is Beta with mean p0 and concentration set by rho (ICC); each item moves around its unit on the logit
# scale with sd S_ITEM, and a fixed logit offset calibrates the control so its mean item rate is p0. The arm moves each
# unit by a logit shift plus unit noise TAU plus a base-app effect shared by the app's units (sd TAU_R); the shift is
# solved so the mean lift is delta, at delta 0 too, so a true zero has no lift. The arm and none can run different pass
# counts. The 10x tier's graded score takes values 0, 0.5 and 1 an item; at a given mean its variance is at most that of
# a 0-or-1 item, so reading it with this binary model overstates its noise and its MDD.
# MDD = the smallest delta (0.01 steps) with power >= 0.80, from SIMS runs a point; near 0.80 a power estimate from 1000
# runs has a Monte Carlo standard error of about 0.013, so neighbouring rows can differ by 0.01.
# Design mode (--design <file>) reads JSON holding only digests and counts:
#   {"p0": <stage 1 Opus none rate>, "rho": 0.5, "passes_arm": 2, "passes_none": 2,
#    "units": [{"repo": "<base app digest>", "items": <1 to 6>}, ...]}
# and prints the admission read (power at a lift of ADMIT_DELTA at Holm's first step, from ADMIT_SIMS runs with fixed
# seeds, with its Monte Carlo standard error; it passes at 0.80 or more) and the MDD at Holm's first step.
# Run: uv run --with numpy==2.3.4 python power.py > power.txt   (seeded; no key, no network)
#      uv run --with numpy==2.3.4 python power.py --design design.json
import json
import sys
import numpy as np

SEED = 20261109
SIMS = 1000
ADMIT_SIMS = 4000
FLIPS = 800
S_ITEM = 0.8
TAU = 0.5
TAU_R = 0.3
ADMIT_DELTA = 0.12
ADMIT_ALPHA = 0.025
STEPS = np.round(np.arange(0.03, 0.41, 0.01), 2)
MAXM = 6
_CAL = {}

def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))
def fixed_rng(*tags): return np.random.default_rng([SEED] + [int(round(t * 1000)) for t in tags])

def beta_params(p0, rho):
    s = 1 / rho - 1
    return p0 * s, (1 - p0) * s

def raw_items(p0, rho, shape, rng):
    a, b = beta_params(p0, rho)
    pu = np.clip(rng.beta(a, b, shape[:-1]), 1e-4, 1 - 1e-4)
    return logit(pu)[..., None] + rng.normal(0, S_ITEM, shape)

def offset(p0, rho):
    key = (p0, rho)
    if key not in _CAL:
        x = raw_items(p0, rho, (100000, 1), fixed_rng(p0, rho, 1))
        lo, hi = -4.0, 4.0
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if expit(x + mid).mean() < p0 else (lo, mid)
        _CAL[key] = (lo + hi) / 2
    return _CAL[key]

def draw_items(p0, rho, shape, rng):
    return raw_items(p0, rho, shape, rng) + offset(p0, rho)

def solve_shift(p0, rho, delta, tau_r):
    rng = fixed_rng(p0, rho, delta, tau_r, 2)
    x = draw_items(p0, rho, (100000, 1), rng)
    base = expit(x).mean()
    noise = rng.normal(0, np.sqrt(TAU ** 2 + tau_r ** 2), (100000, 1))
    lo, hi = -6.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if expit(x + mid + noise).mean() - base < delta else (lo, mid)
    return (lo + hi) / 2

def layout(n, apps):
    ids = np.array([i * apps // n for i in range(n)])
    return ids, apps

def draw_m(mset, shape, rng):
    if mset == "3-5": return rng.integers(3, 6, shape)
    if mset == "3": return np.full(shape, 3)
    raise ValueError(mset)

def unit_diffs(p0, rho, m, ids, R, pa, pn, delta, tau_r, sims, rng):
    n = len(ids)
    shift = solve_shift(p0, rho, delta, tau_r)
    x = draw_items(p0, rho, (sims, n, MAXM), rng)
    m = np.broadcast_to(m, (sims, n))
    mask = np.arange(MAXM)[None, None, :] < m[..., None]
    reff = rng.normal(0, tau_r, (sims, R))[:, ids][..., None] if tau_r > 0 else 0.0
    q0 = expit(x)
    q1 = expit(x + shift + reff + rng.normal(0, TAU, (sims, n, 1)))
    def score(q, passes):
        return ((rng.binomial(passes, q) / passes) * mask).sum(axis=2) / m
    return score(q1, pa) - score(q0, pn)

def repo_sums(d, ids, R):
    out = np.zeros((d.shape[0], R))
    np.add.at(out.T, ids, d.T)
    return out

def pvalues(d, ids, R, rng):
    n = len(ids)
    s = repo_sums(d, ids, R)
    obs = np.abs(s.sum(axis=1)) / n
    signs = rng.choice([-1.0, 1.0], size=(FLIPS, R))
    null = np.abs(s @ signs.T / n)
    return (1 + (null >= obs[:, None] - 1e-12).sum(axis=1)) / (FLIPS + 1)

def mdds(p0, rho, n, apps, pa, pn, mset, tau_r, rng):
    ids, R = layout(n, apps)
    out = {0.05: None, 0.025: None}
    for delta in STEPS:
        if p0 + delta >= 0.95: break
        d = unit_diffs(p0, rho, draw_m(mset, (SIMS, n), rng), ids, R, pa, pn, delta, tau_r, SIMS, rng)
        pv = pvalues(d, ids, R, rng)
        for a in out:
            if out[a] is None and (pv <= a).mean() >= 0.80: out[a] = float(delta)
        if out[0.025] is not None: break
    return out[0.05], out[0.025]

def admit(p0, rho, m, ids, R, pa, pn):
    rng = fixed_rng(p0, rho, pa, pn, len(ids), 3)
    d = unit_diffs(p0, rho, m, ids, R, pa, pn, ADMIT_DELTA, TAU_R, ADMIT_SIMS, rng)
    assert np.isfinite(d).all(), "unit differences must be finite"
    pw = float((pvalues(d, ids, R, rng) <= ADMIT_ALPHA).mean())
    return pw, float(np.sqrt(pw * (1 - pw) / ADMIT_SIMS))

def usage(msg):
    print("E_USAGE " + msg, file=sys.stderr)
    sys.exit(2)

def design_mode(path):
    spec = json.load(open(path))
    units = spec["units"]
    p0, rho, pa, pn = float(spec["p0"]), float(spec.get("rho", 0.5)), int(spec["passes_arm"]), int(spec["passes_none"])
    if not units or pa < 1 or pn < 1 or not 0 < p0 < 1 or not 0 < rho < 1:
        usage("design needs units, passes_arm and passes_none of at least 1, and p0 and rho strictly between 0 and 1")
    repos = sorted({u["repo"] for u in units})
    ids = np.array([repos.index(u["repo"]) for u in units])
    m = np.array([int(u["items"]) for u in units])
    if m.min() < 1 or m.max() > MAXM: usage("items must be 1 to %d" % MAXM)
    pw, se = admit(p0, rho, m, ids, len(repos), pa, pn)
    print("ADMIT units %d repositories %d p0 %.3f passes_arm %d passes_none %d delta %.2f alpha %.3f sims %d power %.3f se %.3f -> %s"
          % (len(units), len(repos), p0, pa, pn, ADMIT_DELTA, ADMIT_ALPHA, ADMIT_SIMS, pw, se, "pass" if pw >= 0.80 else "fail"))
    rng = fixed_rng(p0, rho, pa, pn, len(units), 4)
    mdd = None
    for delta in STEPS:
        if p0 + delta >= 0.95: break
        d = unit_diffs(p0, rho, m, ids, len(repos), pa, pn, float(delta), TAU_R, SIMS, rng)
        if (pvalues(d, ids, len(repos), rng) <= ADMIT_ALPHA).mean() >= 0.80:
            mdd = float(delta); break
    print("MDD units %d repositories %d p0 %.3f passes_arm %d passes_none %d alpha %.3f sims %d MDD %s"
          % (len(units), len(repos), p0, pa, pn, ADMIT_ALPHA, SIMS, "over 0.40" if mdd is None else "%.2f" % mdd))

if len(sys.argv) == 3 and sys.argv[1] == "--design":
    design_mode(sys.argv[2]); sys.exit(0)

rng = np.random.default_rng(SEED)
f = lambda v: "none<=0.40" if v is None else "%.2f" % v
print("power.py, seed %d, %d simulated runs a point, %d sign flips a run, item sd %.1f, tau %.1f, base-app tau %.1f; MDD at 80%% power, two-sided, clustered on the base app; control calibrated to p0; true zero solved exactly" % (SEED, SIMS, FLIPS, S_ITEM, TAU, TAU_R))
print("Part A. MDD at alpha 0.05 and at alpha 0.025 (Holm step 1 of 2). columns: units n, base apps, items per unit m, control p0, passes (both arms), rho 0.5. Opus runs 2 passes; Sol and particle-1 run 1")
for n, apps in ((64, 16), (64, 20), (56, 14), (48, 12)):
    for passes in (2, 1):
        for p0 in (0.20, 0.35, 0.50):
            m5, m25 = mdds(p0, 0.5, n, apps, passes, passes, "3-5", TAU_R, rng)
            print("n %2d  apps %2d  m 3-5  p0 %.2f  passes %d  MDD05 %s  MDD025 %s" % (n, apps, p0, passes, f(m5), f(m25)), flush=True)
for p0 in (0.20, 0.35, 0.50):
    m5, m25 = mdds(p0, 0.5, 64, 16, 2, 2, "3", TAU_R, rng)
    print("n 64  apps 16  m 3    p0 %.2f  passes 2  MDD05 %s  MDD025 %s" % (p0, f(m5), f(m25)), flush=True)
print("Part B. Base-app effect sensitivity: Opus, 2 passes, rho 0.5, 64 units on 16 apps, m 3-5")
for tau_r in (0.0, 0.3, 0.6):
    for p0 in (0.20, 0.35, 0.50):
        m5, m25 = mdds(p0, 0.5, 64, 16, 2, 2, "3-5", tau_r, rng)
        print("base-app tau %.1f  p0 %.2f  MDD05 %s  MDD025 %s" % (tau_r, p0, f(m5), f(m25)), flush=True)
print("Part C. Admission read: power at a lift of %.2f at Holm's first step (alpha %.3f), %d runs with fixed seeds, m cycling 3, 4, 5 in draw order, Opus 2 passes in both arms" % (ADMIT_DELTA, ADMIT_ALPHA, ADMIT_SIMS))
for n, apps in ((64, 16), (64, 20), (64, 32), (64, 8), (56, 14), (48, 12)):
    ids, R = layout(n, apps)
    m = np.array([3 + i % 3 for i in range(n)])
    for p0 in (0.20, 0.35, 0.50):
        pw, se = admit(p0, 0.5, m, ids, R, 2, 2)
        print("n %2d  apps %2d  p0 %.2f  power %.3f  se %.3f  %s" % (n, apps, p0, pw, se, "pass" if pw >= 0.80 else "fail"), flush=True)
print("Part D. Stage 1 headroom read: Opus none on 16 calibration units at 3 passes, m 3-5; 95% interval half-width of the unit-mean rate")
for p0 in (0.10, 0.20, 0.35, 0.50, 0.65):
    hw = []
    for _ in range(400):
        x = draw_items(p0, 0.5, (16, MAXM), rng)
        m = draw_m("3-5", (16,), rng)
        mask = np.arange(MAXM)[None, :] < m[:, None]
        s = ((rng.binomial(3, expit(x)) / 3) * mask).sum(axis=1) / m
        hw.append(1.96 * s.std(ddof=1) / np.sqrt(16))
    print("p0 %.2f  n 16  passes 3  median half-width %.3f" % (p0, float(np.median(hw))), flush=True)
