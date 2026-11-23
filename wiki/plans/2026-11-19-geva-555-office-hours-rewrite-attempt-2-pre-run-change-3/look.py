#!/usr/bin/env python3
# look.py: the interim look of pre-run change 3 (rule R113) on the plan's own power model.
# It loads the plan's sizing.py and the first plan's power.py unchanged: it checks both files' sha256, runs sizing.py's
# opening lines (which run power.py's model code, as sizing.py does) and uses sizing.py's layout of 32 founder clusters.
# Part A derives the two-look O'Brien-Fleming bounds at the plan's alpha. Part B compares the error rate under no effect.
# Part C compares the plan's fixed read with the read that takes one look at half the clusters. Part D gives the MDD.
# Run from this folder: uv run --with numpy==2.3.4 --with scipy==1.16.2 python look.py > look.txt (seeded; no key, no network)
import hashlib
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
SIZING = HERE.parent / "2026-11-18-geva-555-office-hours-rewrite-attempt-2-prereg/sizing.py"
POWER = HERE.parent / "2026-11-17-geva-552-office-hours-rewrite-prereg/power.py"
PINNED = {SIZING: "cbed977cd397138539a3df6c98e09c3eb1fb5b111b6205c8cc80a97811bfa1b6", POWER: "8ea44fae503752e3b64e99fd18962a44eadee9d0be8490619f748674b532dec9"}
for path, want in PINNED.items():
    got = hashlib.sha256(path.read_bytes()).hexdigest()
    assert got == want, "%s has sha256 %s, not %s" % (path.name, got, want)
sizing = SIZING.read_text()
__file__ = str(SIZING)
exec(sizing[: sizing.index("\nrng = np.random.default_rng(SEED)")])
from scipy import optimize

N = stats.norm
ALPHA = 0.05
FRACTION = 0.5
CORR = np.sqrt(FRACTION)
MVN = stats.multivariate_normal(mean=[0, 0], cov=[[1, CORR], [CORR, 1]])

def inside(a, b):
    return MVN.cdf([a, b]) - MVN.cdf([-a, b]) - MVN.cdf([a, -b]) + MVN.cdf([-a, -b])

print("look.py, seed %d, %d simulated runs a point; sizing.py %s and power.py %s unchanged" % (SEED, SIMS, PINNED[SIZING][:12], PINNED[POWER][:12]))
print("Part A. Two-look bounds for the plan's two-sided 95%% interval (alpha %.2f, 0.025 a side, no multiplicity correction), looks at information %.1f and 1.0, correlation sqrt(%.1f)" % (ALPHA, FRACTION, FRACTION))
c = optimize.brentq(lambda x: 1 - inside(x / np.sqrt(FRACTION), x) - ALPHA, 1.5, 3.0)
c1, c2 = c / np.sqrt(FRACTION), c
print("O'Brien-Fleming (bounds C/sqrt(t)): interim %.4f, final %.4f, spending %.5f then %.5f" % (c1, c2, 2 * N.sf(c1), ALPHA - 2 * N.sf(c1)))
s = 2 - 2 * N.cdf(N.isf(ALPHA / 2) / np.sqrt(FRACTION))
l1 = N.isf(s / 2)
l2 = optimize.brentq(lambda x: 1 - inside(l1, x) - ALPHA, 1.5, 3.0)
print("Lan-DeMets O'Brien-Fleming spending on the two-sided alpha, 2 - 2 Phi(z(0.025) / sqrt(t)): %.5f at 0.5, %.2f at 1.0; interim %.4f, final %.4f" % (s, ALPHA, l1, l2))
s1 = 2 - 2 * N.cdf(N.isf(ALPHA / 4) / np.sqrt(FRACTION))
g1 = N.isf(s1)
g2 = optimize.brentq(lambda x: 1 - inside(g1, x) - ALPHA, 1.5, 3.0)
print("Lan-DeMets O'Brien-Fleming spending on each side's 0.025, 2 - 2 Phi(z(0.0125) / sqrt(t)) (gsDesign sfLDOF): %.6f a side at 0.5; interim %.4f, final %.4f" % (s1, g1, g2))
Z1, Z2 = 2.80, 1.98
P1, P2 = 2 * N.sf(Z1), 2 * N.sf(Z2)
print("R113's bounds %.2f and %.2f: two-sided alpha %.5f; nominal two-sided levels %.6f and %.6f" % (Z1, Z2, 1 - inside(Z1, Z2), P1, P2))
C1, C = 16, 32
T1, T2 = stats.t.isf(P1 / 2, C1 - 1), stats.t.isf(P2 / 2, C - 1)
print("the same levels on the plan's t statistic, %d and %d degrees of freedom: interim %.4f, final %.4f (the plan's fixed read: %.4f)" % (C1 - 1, C - 1, T1, T2, stats.t.ppf(0.975, C - 1)))

ids, nclus = layout(4, 6, 2)
half_rng = np.random.default_rng(SEED + 3)
HALF = np.sort(np.concatenate([np.array([8 * k + j for k in half_rng.permutation(4)[:2]]) for j in range(8)]))
REST = np.setdiff1d(np.arange(nclus), HALF)
assert len(HALF) == C1 and nclus == C
PLAN_EFFECT, FUTILITY = BAR, 0.10
BRIEF_USD = 1011.20 / 80
rng = np.random.default_rng(SEED)

def read(dc, z1, z2):
    m1 = dc[:, HALF].mean(axis=1)
    sd1 = dc[:, HALF].std(axis=1, ddof=1)
    se1 = sd1 / np.sqrt(C1)
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = np.where(se1 > 0, m1 / np.where(se1 > 0, se1, 1), np.sign(m1) * np.inf)
        cp = np.where(sd1 > 0, N.cdf(((C1 * m1 + (C - C1) * PLAN_EFFECT) / (C - C1) - z2 * sd1 * np.sqrt(C) / (C - C1)) / np.where(sd1 > 0, sd1, 1) * np.sqrt(C - C1)), (m1 + PLAN_EFFECT > 0).astype(float))
    stop_new, stop_cur = t1 >= z1, t1 <= -z1
    futile = ~stop_new & ~stop_cur & (cp < FUTILITY)
    go = ~stop_new & ~stop_cur & ~futile
    m = dc.mean(axis=1)
    se = dc.std(axis=1, ddof=1) / np.sqrt(C)
    lo = np.where(go, m - z2 * se, m1 - z1 * se1)
    est = np.where(go, m, m1)
    merge = (est >= BAR - 1e-12) & (lo > 0)
    briefs = 40 + 12 * stop_new + 40 * go
    return dict(merge=merge, lo=lo > 0, new=stop_new, cur=stop_cur, fut=futile, go=go, usd=(briefs * BRIEF_USD).mean())

def fixed(dc):
    lo, hi, m = t_interval(dc)
    return dict(merge=(m >= BAR - 1e-12) & (lo > 0), lo=lo > 0)

print("Part B. Error rate under no effect: share of runs whose lower bound is above zero (one side), and that read MERGE, by read")
for p0 in (0.25, 0.40, 0.55):
    for rho in (0.5, 0.843):
        dc = cluster_diffs(p0, rho, 0.0, ids, nclus, 1, 2, rng)
        f, z, t = fixed(dc), read(dc, Z1, Z2), read(dc, T1, T2)
        print("p0 %.2f rho %.3f | fixed t %.4f: %.4f MERGE %.4f | bounds %.2f and %.2f on the t statistic: %.4f MERGE %.4f | t bounds %.4f and %.4f: %.4f MERGE %.4f" % (p0, rho, stats.t.ppf(0.975, C - 1), f["lo"].mean(), f["merge"].mean(), Z1, Z2, z["lo"].mean(), z["merge"].mean(), T1, T2, t["lo"].mean(), t["merge"].mean()), flush=True)

print("Part C. p0 0.40, founder rows (rows 1 to 3 assumed to pass), the plan's fixed read against the look at the t bounds %.4f and %.4f; futility when conditional power at a %.2f lift is under %.2f; spend at $%.2f a brief on Opus and Sol (stage 2 central $1,011.20)" % (T1, T2, PLAN_EFFECT, FUTILITY, BRIEF_USD))
for rho in (0.5, 0.843):
    for d in (0.0, 0.09, 0.10, 0.15, 0.20, 0.25):
        dc = cluster_diffs(0.40, rho, d, ids, nclus, 1, 2, rng)
        f, n = fixed(dc), read(dc, T1, T2)
        print("rho %.3f d %.2f | fixed: lower bound > 0 %.3f MERGE %.3f spend $1011 | look: lower bound > 0 %.3f MERGE %.3f, stops for new %.3f, for current %.3f, futility %.3f, continues %.3f, mean spend $%.0f" % (rho, d, f["lo"].mean(), f["merge"].mean(), n["lo"].mean(), n["merge"].mean(), n["new"].mean(), n["cur"].mean(), n["fut"].mean(), n["go"].mean(), n["usd"]), flush=True)

print("Part D. MDD at 80% power (the deciding look's lower bound above zero), fixed read against the look")
def mdd_look(p0, rho):
    last = None
    for d in STEPS:
        if p0 + d >= 0.95: break
        last = d
        if read(cluster_diffs(p0, rho, d, ids, nclus, 1, 2, rng), T1, T2)["lo"].mean() >= 0.80: return "%.2f" % d
    return "not reached by %.2f" % last
for p0 in (0.25, 0.40, 0.55):
    for rho in (0.5, 0.843):
        print("p0 %.2f rho %.3f  fixed %s  look %s" % (p0, rho, mdd(p0, rho, ids, nclus, 1, 2, rng), mdd_look(p0, rho)), flush=True)
