#!/usr/bin/env python3
# power-gr.py: minimum detectable difference (MDD) and power for G_R, the CEO outcome eval's 10x graded score
# (amendment 2026-11-05-geva-295-ceo-ladder-amendment), by power.py's method (preregistration 2026-11-04-geva-285).
# Per review of a changed unit: h3 = the deciding issue in the top 3; h1 = it ranks first; rem = its fix names the keyed
# remedy. h1 and rem happen only on a hit. G_R = 0.50 h3 + 0.25 h1 + 0.25 rem ("rem" form), or 2/3 h3 + 1/3 h1 when rem
# leaves the score ("norem" form). A unit's score is the mean of its passes; the test is power.py's paired sign-flip on
# unit-level differences (arm minus none), two-sided.
# Units: hit@3 difficulty p from a Beta with mean p0 and ICC rho, as power.py draws it. Given a hit, h1 and rem draw from
# conditional rates that share the unit's ability: each conditional logit moves with the unit's hit@3 logit, from an
# intercept solved so the rate among hits is the regime's c1 or cr (at that rho), so the printed regime rates are true means.
# Keyed share k: on a share k of units the key names a remedy and G_R takes the rem form; the rest score 2/3 h3 + 1/3 h1.
# The first round(k n) units of each run are keyed (difficulty is drawn independently of keying). The norem form has no k.
# Judge noise on rem ("flip f"): on a hit, the final rem label is flipped with probability f, in both arms alike.
# Shift models: "all" moves the logits of hit@3, h1 given a hit and rem given a hit by the same shift plus unit noise tau;
# "hit" moves hit@3 alone. The shift is solved so the mean G_R lift is delta. MDD = the smallest delta (0.01 steps) with
# power >= 0.80; "none<=0.40" when no delta up to 0.40 reaches it. pow0.8 is the power at a logit shift of 0.8, alpha 0.025.
# Run: uv run --with numpy==2.3.4 python power-gr.py > power-gr.txt   (seeded; no key, no network)
import numpy as np

SEED = 20261104
SIMS = 1200
FLIPS = 800
STEPS = np.round(np.arange(0.02, 0.41, 0.01), 2)
REGIMES = {"headroom": (0.45, 0.45, 0.40), "fallback": (0.70, 0.30, 0.25)}

def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))

def beta_params(p0, rho):
    s = 1 / rho - 1
    return p0 * s, (1 - p0) * s

def expected(p, c1, cr, form, k=1.0):
    return k * p * (0.5 + 0.25 * c1 + 0.25 * cr) + (1 - k) * p * (2 / 3 + c1 / 3) if form == "rem" else p * (2 / 3 + c1 / 3)

CAL = {}
def intercept(p0, rho, c):
    key = (p0, rho, c)
    if key not in CAL:
        a, b = beta_params(p0, rho)
        p = np.clip(np.random.default_rng(SEED + 1).beta(a, b, 400000), 1e-4, 1 - 1e-4)
        u = logit(p) - logit(p0)
        lo, hi = -12.0, 12.0
        for _ in range(80):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if (p * expit(mid + u)).sum() / p.sum() < c else (lo, mid)
        CAL[key] = (lo + hi) / 2
    return CAL[key]

def unit_rates(p, p0, c1, cr, rho):
    u = logit(p) - logit(p0)
    return expit(intercept(p0, rho, c1) + u), expit(intercept(p0, rho, cr) + u)

def arm_rates(p, c1u, cru, shift, noise, model):
    pa = expit(logit(p) + shift + noise)
    if model == "all":
        return pa, expit(logit(c1u) + shift + noise), expit(logit(cru) + shift + noise)
    return pa, c1u, cru

def solve_shift(p0, c1, cr, rho, tau, delta, model, form, k, rng):
    a, b = beta_params(p0, rho)
    p = np.clip(rng.beta(a, b, 200000), 1e-4, 1 - 1e-4)
    c1u, cru = unit_rates(p, p0, c1, cr, rho)
    noise = rng.normal(0, tau, p.size)
    base = expected(p, c1u, cru, form, k).mean()
    lo, hi = -6.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lift = expected(*arm_rates(p, c1u, cru, mid, noise, model), form, k).mean() - base
        lo, hi = (mid, hi) if lift < delta else (lo, mid)
    return (lo + hi) / 2

def keyed_mask(shape, k):
    m = np.zeros(shape, dtype=bool)
    m[..., : int(round(k * shape[-1]))] = True
    return m

def scores(p, c1u, cru, passes, form, k, flip, rng):
    shape = p.shape + (passes,)
    h3 = rng.random(shape) < p[..., None]
    h1 = h3 & (rng.random(shape) < c1u[..., None])
    rm = h3 & (rng.random(shape) < cru[..., None])
    if flip:
        rm = rm ^ (h3 & (rng.random(shape) < flip))
    norem = (2 * h3 + h1) / 3
    if form == "norem":
        return norem.mean(axis=2)
    g = np.where(keyed_mask(p.shape, k)[..., None], 0.5 * h3 + 0.25 * h1 + 0.25 * rm, norem)
    return g.mean(axis=2)

def pvalues(p0, c1, cr, rho, tau, n, passes, shift, model, form, k, flip, rng):
    a, b = beta_params(p0, rho)
    p = np.clip(rng.beta(a, b, (SIMS, n)), 1e-4, 1 - 1e-4)
    c1u, cru = unit_rates(p, p0, c1, cr, rho)
    noise = rng.normal(0, tau, (SIMS, n))
    none = scores(p, c1u, cru, passes, form, k, flip, rng)
    arm = scores(*arm_rates(p, c1u, cru, shift, noise, model), passes, form, k, flip, rng)
    d = arm - none
    obs = np.abs(d.mean(axis=1))
    signs = rng.choice([-1.0, 1.0], size=(FLIPS, n))
    null = np.abs(d @ signs.T / n)
    return (1 + (null >= obs[:, None] - 1e-12).sum(axis=1)) / (FLIPS + 1)

def mdd(p0, c1, cr, rho, tau, n, passes, model, form, k, flip, rng):
    found = {0.05: None, 0.025: None}
    top = expected(np.array(p0), np.array(c1), np.array(cr), form, k)
    for delta in STEPS:
        if top + delta >= 0.99: break
        pv = pvalues(p0, c1, cr, rho, tau, n, passes, solve_shift(p0, c1, cr, rho, tau, delta, model, form, k, rng), model, form, k, flip, rng)
        for al in found:
            if found[al] is None and (pv <= al).mean() >= 0.80: found[al] = float(delta)
        if found[0.025] is not None: break
    return found

rng = np.random.default_rng(SEED)
f = lambda m: "none<=0.40" if m is None else "%.2f" % m
print("power-gr.py, seed %d, %d simulated runs a point, %d sign flips a run; MDD on G_R's own scale at 80%% power, two-sided" % (SEED, SIMS, FLIPS))
print("columns: regime (hit@3, h1 given a hit, rem given a hit), plain G_R and strict at that regime, form, keyed share (rem form), rem flip rate, shift model, ICC rho, tau, changed units n, passes, MDD at alpha 0.05, MDD at alpha 0.025 (Holm step 1), power at a logit shift of 0.8 (alpha 0.025)")
SIZES = ((36, 2), (48, 2), (54, 2), (64, 2), (36, 1), (48, 1), (54, 1), (64, 1))
def row(regime, p0, c1, cr, form, k, flip, model, rho, sizes):
    a, b = beta_params(p0, rho)
    pp = np.clip(np.random.default_rng(SEED + 2).beta(a, b, 400000), 1e-4, 1 - 1e-4)
    c1u, cru = unit_rates(pp, p0, c1, cr, rho)
    g0 = expected(pp, c1u, cru, form, k).mean()
    st = k * (pp * c1u * cru).mean() + (1 - k) * (pp * c1u).mean() if form == "rem" else (pp * c1u).mean()
    for n, passes in sizes:
        m = mdd(p0, c1, cr, rho, 0.5, n, passes, model, form, k, flip, rng)
        pw = (pvalues(p0, c1, cr, rho, 0.5, n, passes, 0.8, model, form, k, flip, rng) <= 0.025).mean()
        print("%-8s (%.2f, %.2f, %.2f)  G_R %.3f  strict %.3f  form %-5s  keyed %s  flip %.2f  shift %-3s  rho %.1f  tau 0.5  n %2d  passes %d  MDD05 %s  MDD025 %s  pow0.8 %.2f" % (regime, p0, c1, cr, g0, st, form, "%.2f" % k if form == "rem" else " -  ", flip, model, rho, n, passes, f(m[0.05]), f(m[0.025]), pw))
for regime, (p0, c1, cr) in REGIMES.items():
    for form, k in (("rem", 1.0), ("rem", 0.75), ("rem", 0.5), ("norem", 1.0)):
        for model in ("all", "hit"):
            for rho in (0.3, 0.5):
                row(regime, p0, c1, cr, form, k, 0.0, model, rho, SIZES)
for model in ("all", "hit"):
    row("fallback", 0.70, 0.30, 0.25, "rem", 0.75, 0.15, model, 0.5, SIZES[:4])
# ceo-rule.ts reads the rows of stage 1's regime (headroom or fallback), the form stage 1 set, the keyed share at or below the
# measured share (0.50 when it is under 0.50), no flip, shift "all", rho 0.5, alpha 0.025, for a G_R contrast's MDD, and
# prints the shift "hit" row beside it. The flip rows are read in the post only.
