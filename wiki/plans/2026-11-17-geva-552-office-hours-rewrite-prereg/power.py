#!/usr/bin/env python3
# power.py: sizing for the office-hours rewrite eval (current skill vs new skill vs no gstack).
# Primary R is binary per session: the session made the right call (1) or not (0).
# Primary contrast: new minus current, pooled over Opus 5.5 and GPT-6.1 Sol with equal weight, paired by brief.
# Resampling unit: the opening family. The two twins of a matched pair share an opening and form one cluster; an
# unpaired brief is its own cluster. A cluster's difference is the mean over its briefs of the mean over the models of
# (new sessions' mean minus current sessions' mean). Interval: paired t over cluster differences, C - 1 degrees of
# freedom, two-sided 95%.
# Brief difficulty follows the founder lane's power model: Beta with mean p0 and concentration set by rho (the share of
# session variance that sits between briefs), on the logit scale, plus a model-by-brief term ETA. The new skill moves
# each brief by a logit shift plus brief noise TAU and model-by-brief noise TAU_M, with the shift solved so the mean
# lift is delta. Twins' brief noise correlates at twin corr.
# MDD = the smallest delta (0.01 steps) at which the 95% lower bound is above zero in at least 80% of simulated runs.
# Frozen design: 5 skins of 14 founder briefs (6 matched pairs and 2 unpaired a skin: 70 briefs, 40 clusters) and 24
# unpaired builder briefs, one session a model an arm. Part D reads the frozen MERGE row: pooled estimate at least 0.15
# and pooled lower bound above zero. Part E reads the builder check: Newcombe's method 10 on brief and model pairs,
# lower bound of new minus current above -0.15. Parts F and the Altman line check the two intervals against
# published worked examples.
# Run: uv run --with numpy==2.3.4 --with scipy==1.16.2 python power.py > power.txt   (seeded; no key, no network)
import numpy as np
from scipy import stats

SEED = 20261117
SIMS = 4000
TAU = 0.5
TAU_M = 0.3
ETA = 0.5
BAR = 0.15
MARGIN = 0.15
STEPS = np.round(np.arange(0.05, 0.46, 0.01), 2)

def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))

def brief_logits(p0, rho, shape, rng):
    s = 1 / rho - 1
    return logit(np.clip(rng.beta(p0 * s, (1 - p0) * s, shape), 1e-4, 1 - 1e-4))

def layout(skins, pairs, singles):
    ids, c = [], 0
    for _ in range(skins):
        for _ in range(pairs):
            ids += [c, c]
            c += 1
        for _ in range(singles):
            ids.append(c)
            c += 1
    return np.array(ids), c

def solve_shift(p0, rho, delta, rng):
    x = brief_logits(p0, rho, (40000, 1), rng) + rng.normal(0, ETA, (40000, 2))
    base = expit(x).mean()
    noise = rng.normal(0, TAU, (40000, 1)) + rng.normal(0, TAU_M, (40000, 2))
    lo, hi = -8.0, 8.0
    for _ in range(50):
        mid = (lo + hi) / 2
        lift = expit(x + mid + noise).mean() - base
        lo, hi = (mid, hi) if lift < delta else (lo, mid)
    return (lo + hi) / 2

def cluster_diffs(p0, rho, delta, ids, nclus, k, models, rng, twin=0.0):
    n = len(ids)
    shift = solve_shift(p0, rho, delta, rng)
    x = brief_logits(p0, rho, (SIMS, n, 1), rng) + rng.normal(0, ETA, (SIMS, n, models))
    shared = rng.normal(0, 1, (SIMS, nclus))[:, ids]
    own = rng.normal(0, 1, (SIMS, n))
    e = TAU * (np.sqrt(twin) * shared + np.sqrt(1 - twin) * own)
    q0 = expit(x)
    q1 = expit(x + shift + e[..., None] + rng.normal(0, TAU_M, (SIMS, n, models)))
    d = (rng.binomial(k, q1) - rng.binomial(k, q0)) / k
    db = d.mean(axis=2)
    out = np.zeros((SIMS, nclus))
    for j in range(n):
        out[:, ids[j]] += db[:, j]
    return out / np.bincount(ids, minlength=nclus)

def t_interval(dc):
    c = dc.shape[-1]
    m = dc.mean(axis=-1)
    se = dc.std(axis=-1, ddof=1) / np.sqrt(c)
    t = stats.t.ppf(0.975, c - 1)
    return m - t * se, m + t * se, m

def mdd(p0, rho, ids, nclus, k, models, rng, twin=0.0):
    for delta in STEPS:
        if p0 + delta >= 0.95: return None
        lo, hi, m = t_interval(cluster_diffs(p0, rho, delta, ids, nclus, k, models, rng, twin))
        if (lo > 0).mean() >= 0.80: return float(delta)
    return None

rng = np.random.default_rng(SEED)
f = lambda v: "over 0.45" if v is None else "%.2f" % v
print("power.py, seed %d, %d simulated runs a point, tau %.1f, tau_m %.1f, eta %.1f; MDD at 80%% power, two-sided 95%% paired t interval over opening clusters" % (SEED, SIMS, TAU, TAU_M, ETA))

print("Part A. The plan as written: 14 founder briefs (5 matched pairs and 4 unpaired, 9 clusters), 3 trials a model an arm")
ids, nclus = layout(1, 5, 4)
for p0 in (0.25, 0.40, 0.55):
    for rho in (0.5, 0.843):
        print("plan  p0 %.2f  rho %.3f  one model MDD %s  pooled over two models MDD %s" % (p0, rho, f(mdd(p0, rho, ids, nclus, 3, 1, rng)), f(mdd(p0, rho, ids, nclus, 3, 2, rng))), flush=True)

print("Part B. Pooled primary on the frozen layout and its neighbours: skins of 14 founder briefs (6 matched pairs and 2 unpaired, 8 clusters a skin)")
for skins, k in ((3, 1), (4, 1), (5, 1), (3, 2)):
    ids, nclus = layout(skins, 6, 2)
    for p0 in (0.25, 0.40, 0.55):
        for rho in (0.5, 0.843):
            line = "skins %d  briefs %2d  clusters %2d  trials %d  p0 %.2f  rho %.3f  pooled MDD %s" % (skins, len(ids), nclus, k, p0, rho, f(mdd(p0, rho, ids, nclus, k, 2, rng)))
            if skins == 5 and k == 1:
                line += "  twin corr 0.5 %s  one model %s" % (f(mdd(p0, rho, ids, nclus, k, 2, rng, 0.5)), f(mdd(p0, rho, ids, nclus, k, 1, rng)))
            print(line, flush=True)

print("Part C. Frozen layout (5 skins, 70 founder briefs, 40 clusters, 1 trial): contrasts against no gstack as the control arm")
ids, nclus = layout(5, 6, 2)
for p0 in (0.05, 0.10, 0.20, 0.40):
    print("against none  p0 %.2f  rho 0.500  pooled MDD %s  one model MDD %s" % (p0, f(mdd(p0, 0.5, ids, nclus, 1, 2, rng)), f(mdd(p0, 0.5, ids, nclus, 1, 1, rng))), flush=True)

print("Part D. Frozen layout, ordered rows 4 to 6 on the pooled primary (guard rows off). MERGE: estimate >= %.2f and lower bound > 0. HOLD below bar: not MERGE, estimate < %.2f, and lower bound > 0 or upper bound < %.2f. INCONCLUSIVE: the rest. Share of simulated runs reading each, by true lift d" % (BAR, BAR, BAR))
for p0 in (0.25, 0.40, 0.55):
    for rho in (0.5, 0.843):
        row = []
        for delta in (-0.05, 0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30):
            if p0 + delta >= 0.95: continue
            lo, hi, m = t_interval(cluster_diffs(p0, rho, delta, ids, nclus, 1, 2, rng))
            merge = (m >= BAR - 1e-12) & (lo > 0)
            below = ~merge & (m < BAR - 1e-12) & ((lo > 0) | (hi < BAR))
            row.append("d %+.2f M %.3f H %.3f I %.3f" % (delta, merge.mean(), below.mean(), (~merge & ~below).mean()))
        print("p0 %.2f rho %.3f | %s" % (p0, rho, " | ".join(row)), flush=True)
for p0, delta in ((0.05, 0.0), (0.05, 0.10), (0.10, 0.0), (0.40, 0.0), (0.40, 0.15)):
    for models in (2, 1):
        lo, hi, m = t_interval(cluster_diffs(p0, 0.5, delta, ids, nclus, 1, models, rng))
        print("coverage of the 95%% interval, %s, p0 %.2f, true delta %.2f: %.3f" % ("pooled" if models == 2 else "one model", p0, delta, ((lo <= delta) & (hi >= delta)).mean()), flush=True)

Z = stats.norm.ppf(0.975)
def wilson(k, n):
    p = k / n
    d = 1 + Z * Z / n
    c = p + Z * Z / (2 * n)
    h = Z * np.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))
    return np.maximum(0, (c - h) / d), np.minimum(1, (c + h) / d)

def newcombe(a, b, c, d):
    # method 10 for paired proportions, first minus second, as lanes/delivery-route/analyze.ts computes it
    n = a + b + c + d
    p1, p2 = (a + b) / n, (a + c) / n
    l1, u1 = wilson(a + b, n)
    l2, u2 = wilson(a + c, n)
    den = np.sqrt((a + b) * (c + d) * (a + c) * (b + d))
    cross = a * d - b * c
    num = np.where(cross > n / 2, cross - n / 2, np.where(cross < 0, cross, 0.0))
    phi = np.where(den > 0, num / np.where(den > 0, den, 1), 0.0)
    diff = p1 - p2
    lo = diff - np.sqrt(np.maximum(0, (p1 - l1) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2) + (u2 - p2) ** 2))
    hi = diff + np.sqrt(np.maximum(0, (u1 - p1) ** 2 - 2 * phi * (u1 - p1) * (p2 - l2) + (p2 - l2) ** 2))
    return diff, lo, hi

def builder_pairs(p0, rho, delta, nb, rng):
    shift = solve_shift(p0, rho, delta, rng)
    x = brief_logits(p0, rho, (SIMS, nb, 1), rng) + rng.normal(0, ETA, (SIMS, nb, 2))
    q0 = expit(x)
    q1 = expit(x + shift + rng.normal(0, TAU, (SIMS, nb, 1)) + rng.normal(0, TAU_M, (SIMS, nb, 2)))
    y1 = rng.random(q1.shape) < q1
    y0 = rng.random(q0.shape) < q0
    count = lambda m: m.reshape(SIMS, -1).sum(axis=1).astype(float)
    return count(y1 & y0), count(y1 & ~y0), count(~y1 & y0), count(~y1 & ~y0)

print("Part E. Builder non-inferiority on the kept-whole rate: share of runs whose 95%% lower bound of new minus current is above -margin, at true differences d. Brief and model pairs, one session a model an arm, read by Newcombe's method 10. Frozen: 24 briefs, margin %.2f. The 0.10 margin, and the cluster t interval, are printed for comparison" % MARGIN)
for nb, margin in ((24, 0.15), (24, 0.10), (16, 0.10)):
    bids, bclus = layout(1, 0, nb)
    for p0 in (0.85, 0.90, 0.95):
        for rho in (0.5, 0.843):
            row = []
            for delta in (0.0, -0.05, -0.10, -0.15):
                d, lo, hi = newcombe(*builder_pairs(p0, rho, delta, nb, rng))
                tlo, thi, tm = t_interval(cluster_diffs(p0, rho, delta, bids, bclus, 1, 2, rng))
                row.append("d %+.2f newcombe %.3f t %.3f" % (delta, (lo > -margin).mean(), (tlo > -margin).mean()))
            print("builder briefs %d  margin %.2f  p0 %.2f  rho %.3f  | %s" % (nb, margin, p0, rho, " | ".join(row)), flush=True)
print("Altman's worked example for method 10 (a 14, b 5, c 0, d 22): diff %.4f, %.4f to %.4f (published 0.1220, 0.0115 to 0.2265)" % tuple(float(v) for v in newcombe(np.array(14.0), np.array(5.0), np.array(0.0), np.array(22.0))))
print("Part F. Worked example the interval code must reproduce: Student's sleep data (R datasets::sleep), paired, group 2 minus group 1")
g1 = np.array([0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0])
g2 = np.array([1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4])
lo, hi, m = t_interval((g2 - g1)[None, :])
print("mean %.7f  95%% interval %.7f to %.7f  (published: 1.58, 0.7001142 to 2.4598858)" % (m[0], lo[0], hi[0]))
assert abs(lo[0] - 0.7001142) < 1e-6 and abs(hi[0] - 2.4598858) < 1e-6
