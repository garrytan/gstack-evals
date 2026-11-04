#!/usr/bin/env python3
# power.py: keyless power simulation for the G family's thin-slice and admission prereg (GEVA-262, GST-1309).
# It drives the decision rule plan v3 freezes for G's confirmatory test (plan v3 section 4) the way
# lanes/real-outcome/score/analysis.ts (compare, crossing) and src/runner/stats/paired.ts (clusteredPairedDelta)
# compute it, with no closed form anywhere:
#   - each task's arm score is the mean of its k trials, and tasks pair across arms;
#   - delta is the mean paired difference; z is delta over the cluster-robust SE by repository,
#     sqrt(g/(g-1) * sum_c (S_c - delta * n_c)^2) / n;
#   - a reading is "helps" or "hurts" only when |z| > 1.959964 AND the exact repository sign-flip one-sided p in z's
#     direction is at most 1 - Phi(1.959964) = 0.025, counted inclusively (null sum >= observed), as paired.ts does;
#   - the ceiling rule: none's trial share above 0.85 makes no claim.
# The futility look (plan v3 section 6) is simulated separately in its B-value form, because O4 has not frozen its
# conditional-power formula yet. Data model: 20 repositories (plan v3's floor) in the most concentrated layout the
# frozen cap allows: as many repositories at the cap as the task count permits, one remainder, the rest at 1 task.
# The main tables use this prereg's cap of 3 tasks per repository; the fallback block uses plan v3's 8;
# per-task none rate p from the control scenario; told rate q = clip(p + d + a_repo + e_task, 0, 1) with e ~ N(0, 0.15)
# and a_repo sized to the stated ICC of the observed task difference; d is solved so the panel's true mean
# difference E[q - p] equals the effect exactly, after clipping. Nulls are null: strict (q = p) or heterogeneous with a
# symmetric, clip-free perturbation (q = p + clip(h, -min(p, 1-p), min(p, 1-p))), whose true mean difference is 0.
# The admission section drives admission items 1 and 2 as frozen: headroom is none's solved share over 12 slice tasks x
# 2 trials, inside [0.20, 0.80] inclusive, on tasks drawn from the unscreened pool; exposure is at least 7 exposed of 8
# sampled told trials, read exactly from the binomial.
# Run: uv run --no-project --with numpy==2.3.4 python3 power.py > power.txt
import math, os, sys
import numpy as np

SEED = 20261104
SIMS = 4000
SIMS_NULL = 20000
G_REPOS = 20
SD_EFF = 0.15
ZC = 1.959963984540054
P_AGREE = 0.025
CEILING = 0.85
STEP = 0.005
D = os.path.dirname(os.path.abspath(__file__))

def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def repo_of(n, cap, g=G_REPOS):
    if n > cap * g: sys.exit("power.py: %d tasks can't fit %d repositories at %d per repository; fix: use at most %d tasks" % (n, g, cap, cap * g))
    a = min((n - g) // (cap - 1), g)
    sizes = [cap] * g if a == g else [cap] * a + [n - cap * a - (g - a - 1)] + [1] * (g - a - 1)
    assert sum(sizes) == n and len(sizes) == g and 1 <= min(sizes) and max(sizes) <= cap, (n, cap, sizes)
    return np.repeat(np.arange(g), sizes), np.array(sizes)

def screen_pass(p):
    # G's frozen screen (plan v3 section 6, stage 4): 2 none trials, a third on 0 of 2; in band is 1 of 2 or 1 of 3.
    return 2 * p * (1 - p) + (1 - p) ** 2 * p

def draw_p(rng, shape, size):
    kind, x = shape
    if kind == "band":
        return rng.beta(2.2, 2.2, size=size) * 0.7 + 0.15
    if kind == "screened":
        out = np.empty(0)
        while out.size < size:
            c = rng.beta(x, x, size=2 * size)
            out = np.concatenate([out, c[rng.random(c.size) < screen_pass(c)]])
        return out[:size]
    m, conc = x
    return rng.beta(m * conc, (1 - m) * conc, size=size)

SCENARIOS = {
    "screened U-pool": ("screened", 0.5),
    "plan v3 band": ("band", None),
    "screened flat pool": ("screened", 1.0),
    "mean 0.30": ("fixed", (0.30, 4.0)),
    "mean 0.70": ("fixed", (0.70, 4.0)),
}

def calib(rng, shape, k, icc, eff):
    p = draw_p(rng, shape, 200000)
    v0 = 2 * np.mean(p * (1 - p)) / k + SD_EFF ** 2
    sa = math.sqrt(icc / (1 - icc) * v0) if icc > 0 else 0.0
    h = rng.normal(0, SD_EFF, p.size) + rng.normal(0, sa, p.size) if sa else rng.normal(0, SD_EFF, p.size)
    lo, hi = -0.5, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if np.mean(np.clip(p + mid + h, 0, 1) - p) < eff:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2, sa, float(p.mean())

M10 = np.array([[1 if (i >> j) & 1 else -1 for j in range(10)] for i in range(1024)], dtype=np.int64)

def p_dir(S, tot):
    # Exact one-sided sign-flip p in the observed direction over all 2^20 repository sign patterns, by meet in the
    # middle: #{patterns: sum_c s_c S_c >= |tot|} / 2^20. Integer sums, so the inclusive count is exact.
    A = S[:, :10] @ M10.T
    B = np.sort(S[:, 10:] @ M10.T, axis=1)
    sims = S.shape[0]
    span = int(np.abs(S).sum(axis=1).max()) * 4 + 8
    off = (np.arange(sims, dtype=np.int64) * span)[:, None]
    flatB = (B + off).ravel()
    T = (np.abs(tot)[:, None] - A) + off
    cnt = (1024 * (np.arange(sims)[:, None] + 1) - np.searchsorted(flatB, T.ravel(), side="left").reshape(sims, 1024)).sum(axis=1)
    return cnt / 2.0 ** 20

def decide(Acnt, Bcnt, repo, sizes, k):
    n = Acnt.shape[1]
    Dt = Bcnt - Acnt
    g = sizes.size
    S = np.zeros((Dt.shape[0], g), dtype=np.int64)
    np.add.at(S.T, repo, Dt.T)
    tot = S.sum(axis=1)
    dmean = tot / n
    se = np.sqrt(g / (g - 1) * ((S - dmean[:, None] * sizes[None, :]) ** 2).sum(axis=1)) / n
    with np.errstate(divide="ignore", invalid="ignore"):
        z = np.where(se > 0, dmean / se, 0.0)
    crossed = np.abs(z) > ZC
    pd = np.ones(Dt.shape[0])
    idx = np.where(crossed)[0]
    if idx.size:
        pd[idx] = p_dir(S[idx], tot[idx])
    ceiling = Acnt.sum(axis=1) / (n * k) > CEILING
    claim = crossed & (pd <= P_AGREE) & ~ceiling
    return claim & (z > 0), claim & (z < 0), ceiling, z, se

class World:
    def __init__(self, n, k, shape, icc, sims, seed, cap=3):
        rng = np.random.default_rng(seed)
        self.n, self.k, self.shape, self.icc = n, k, shape, icc
        self.repo, self.sizes = repo_of(n, cap)
        self.rng_cal = np.random.default_rng(seed + 1)
        self.p = draw_p(rng, shape, sims * n).reshape(sims, n)
        self.e = rng.normal(0, SD_EFF, (sims, n))
        self.az = rng.normal(0, 1, (sims, G_REPOS))
        self.UA = rng.random((sims, n, k))
        self.UB = rng.random((sims, n, k))
        self.sgn = np.where(rng.random((sims, n)) < 0.5, -1.0, 1.0)
        self.half = np.argsort(rng.random((sims, n)), axis=1)[:, : n // 2]
        self.cache = {}

    def outcomes(self, eff, null=None):
        if null is None:
            if eff not in self.cache:
                self.cache[eff] = calib(np.random.default_rng(SEED + int(eff * 1000) + 7), self.shape, self.k, self.icc, eff)
            dd, sa, _ = self.cache[eff]
            h = self.e + sa * self.az[:, self.repo]
            q = np.clip(self.p + dd + h, 0, 1)
        elif null == "strict":
            q = self.p
        else:
            _, sa, _ = calib(np.random.default_rng(SEED + 7), self.shape, self.k, self.icc, 0.0)
            h = self.e + sa * self.az[:, self.repo]
            m = np.minimum(self.p, 1 - self.p)
            q = self.p + np.clip(h, -m, m)
        Acnt = (self.UA < self.p[:, :, None]).sum(axis=2)
        Bcnt = (self.UB < q[:, :, None]).sum(axis=2)
        return Acnt, Bcnt

    def power(self, eff):
        A, B = self.outcomes(eff)
        helps, hurts, ceil, z, se = decide(A, B, self.repo, self.sizes, self.k)
        return float(helps.mean()), float(ceil.mean())

def futility(w, eff_true, mdd_plan):
    # B-value conditional power at a random half of tasks (t = 1/2), for +MDD and -MDD; stop when both < 0.10.
    A, B = w.outcomes(eff_true) if eff_true else w.outcomes(0.0, "strict")
    sims, n = A.shape
    rows = np.arange(sims)[:, None]
    Ah, Bh = A[rows, w.half], B[rows, w.half]
    rh = w.repo[w.half]
    g = G_REPOS
    Dt = Bh - Ah
    S = np.zeros((sims, g), dtype=np.int64)
    np.add.at(S, (np.repeat(np.arange(sims), n // 2), rh.ravel()), Dt.ravel())
    cnt = np.zeros((sims, g))
    np.add.at(cnt, (np.repeat(np.arange(sims), n // 2), rh.ravel()), 1)
    nh = n // 2
    dm = S.sum(axis=1) / nh
    se = np.sqrt(g / (g - 1) * ((S - dm[:, None] * cnt) ** 2).sum(axis=1)) / nh / w.k
    t = 0.5
    with np.errstate(divide="ignore", invalid="ignore"):
        zh = np.where(se > 0, (dm / w.k) / se, 0.0)
        dz = np.where(se > 0, mdd_plan / (se * math.sqrt(t)), np.inf)
    sq = math.sqrt(1 - t)
    cdf = np.vectorize(phi)
    cp_up = 1 - cdf((ZC - zh * math.sqrt(t) - dz * (1 - t)) / sq)
    cp_dn = cdf((-ZC - zh * math.sqrt(t) + dz * (1 - t)) / sq)
    stop = (cp_up < 0.10) & (cp_dn < 0.10)
    full = decide(A, B, w.repo, w.sizes, w.k)[0]
    return float(stop.mean()), float((full & ~stop).mean())

def admission():
    print("admission item 1, headroom: P(pass) for none's solved share over 12 tasks x 2 trials in [0.20, 0.80], by the pool's true mean none rate (20000 sims)")
    rng = np.random.default_rng(SEED + 777)
    for conc, label in ((1.0, "U-shaped pool, Beta(m, 1-m)"), (4.0, "moderate pool, Beta(4m, 4(1-m))")):
        cells = []
        for m in (0.05, 0.10, 0.15, 0.20, 0.30, 0.50, 0.70, 0.80, 0.85, 0.90, 0.95):
            p = rng.beta(m * conc, (1 - m) * conc, size=(SIMS_NULL, 12))
            x = (rng.random((SIMS_NULL, 12, 2)) < p[:, :, None]).sum(axis=(1, 2)) / 24.0
            cells.append("%.2f: %.3f" % (m, float(((x >= 0.2 - 1e-12) & (x <= 0.8 + 1e-12)).mean())))
        print("  %s | %s" % (label, " | ".join(cells)))
    print("admission item 2, exposure: P(at least 7 of 8 sampled told trials exposed), exact binomial, by the told arm's true exposure rate")
    cells = []
    for e in (0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00):
        cells.append("%.2f: %.3f" % (e, e ** 8 + 8 * e ** 7 * (1 - e)))
    print("  " + " | ".join(cells))

def mdd_search(w):
    lo, hi = 20, 60
    if w.power(hi * STEP)[0] < 0.80:
        return None
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if w.power(mid * STEP)[0] >= 0.80:
            hi = mid
        else:
            lo = mid
    return round(hi * STEP * 100, 1)

DESIGNS = [
    ("plan-eng-review, both alive, house", 60, 3, 18.6),
    ("autoplan, both alive, house", 54, 3, 19.2),
    ("plan-eng-review alone under M1, house", 48, 4, 18.6),
    ("both alive at 1.15 times told; plan-eng-review alone under M1 at 1.15 and 1.5", 42, 4, 19.8),
    ("plan-eng-review alone under plan v3's d7 order, house", 60, 2, 21.6),
    ("M1 rung", 54, 4, 17.4),
    ("M1 rung", 36, 4, 21.0),
]

def main():
    print("power.py (GEVA-262): the lane's decision rule, simulated; seed %d, %d sims a point, %d a null point, %d repositories" % (SEED, SIMS, SIMS_NULL, G_REPOS))
    print("columns: design | tasks x trials | ICC | control scenario (its mean none rate) | power at the plan's MDD | simulated MDD (80%%) | ceiling share at that MDD; at most 3 tasks per repository")
    for i, (name, n, k, claim) in enumerate(DESIGNS):
        for icc in (0.0, 0.05, 0.10):
            for sname, shape in SCENARIOS.items():
                if icc > 0 and sname not in ("screened U-pool", "plan v3 band"):
                    continue
                w = World(n, k, shape, icc, SIMS, SEED + 1000 * i + int(icc * 100))
                pw, ce = w.power(claim / 100)
                m = mdd_search(w)
                cm = calib(np.random.default_rng(SEED + 3), shape, k, icc, 0.0)[2]
                print("%s | %dx%d | %.2f | %s (%.2f) | %.3f at %.1f | %s | %.3f" % (name, n, k, icc, sname, cm, pw, claim, m, ce))
                sys.stdout.flush()
    print("null size (rate of a 'helps' reading, and of any claim, when the true mean difference is 0):")
    for i, (name, n, k, claim) in enumerate(DESIGNS[:5]):
        for icc in (0.0, 0.10):
            w = World(n, k, SCENARIOS["screened U-pool"], icc, SIMS_NULL, SEED + 50000 + 100 * i + int(icc * 100))
            for kind in ("strict", "heterogeneous"):
                A, B = w.outcomes(0.0, kind)
                helps, hurts, ceil, z, se = decide(A, B, w.repo, w.sizes, k)
                print("%dx%d | ICC %.2f | %s null | helps %.4f | any claim %.4f" % (n, k, icc, kind, float(helps.mean()), float((helps | hurts).mean())))
                sys.stdout.flush()
    print("fallback layout, plan v3's limit of 8 tasks per repository at its most concentrated (the prereg's fallback if the pool can't fill the cap of 3):")
    for i, (name, n, k, claim) in enumerate(DESIGNS[:4]):
        for sname, icc in (("screened U-pool", 0.0), ("screened U-pool", 0.05), ("plan v3 band", 0.10)):
            w = World(n, k, SCENARIOS[sname], icc, SIMS, SEED + 70000 + 1000 * i + int(icc * 100), cap=8)
            pw, ce = w.power(claim / 100)
            print("%s | %dx%d | sizes %s | ICC %.2f | %s | %.3f at %.1f | %s" % (name, n, k, "-".join(map(str, w.sizes)), icc, sname, pw, claim, mdd_search(w)))
            sys.stdout.flush()
    print("futility look, B-value form at a random half (stop when conditional power for +MDD and for -MDD are both under 10%):")
    for i, (name, n, k, claim) in enumerate(DESIGNS[:4]):
        w = World(n, k, SCENARIOS["screened U-pool"], 0.0, SIMS, SEED + 90000 + i)
        for eff in (0.0, claim / 100):
            stop, pw = futility(w, eff, claim / 100)
            print("%dx%d | true effect %.1f | futility stops %.4f | helps with the look applied %.3f" % (n, k, eff * 100, stop, pw))
    admission()

if __name__ == "__main__":
    main()
