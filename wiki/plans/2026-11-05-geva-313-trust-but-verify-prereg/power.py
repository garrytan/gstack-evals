#!/usr/bin/env python3
# power.py: the power simulation for the trust-but-verify eval (GEVA-313). Seeded; no model call, no key.
# It simulates the frozen primary test: lineage clusters of one or two tasks, 3 to 8 key facts per task, each fact's
# disclosure on the logit scale from a cluster effect, a task effect, a fact effect and a reading effect, an arm shift
# with cluster-level noise, 3% gaps per reading (matched rows only), task means over matched passes, cluster means over
# tasks, and the two-sided cluster sign-flip test at Holm's first step (alpha 0.05/3). The baseline logit is calibrated
# so the marginal control recall (the mean over facts and readings) equals the row's value. MDD is the smallest
# recall gain with 80% power, found by bisection on the shift, and Monte Carlo error is printed beside each point.
# Usage: uv run --with numpy python power.py > power.txt
import numpy as np

SD_CLUSTER, SD_TASK, SD_FACT, SD_READING, TAU = 0.7, 0.7, 1.5, 0.7, 0.5
P_DOUBLE, GAP, ALPHA, FLIPS, SIMS, SEED = 0.3, 0.03, 0.05 / 3, 1000, 2000, 20261105
KMIN, KMAX = 3, 8

def layout(n_tasks, rng):
    clusters, tasks = [], 0
    while tasks < n_tasks:
        size = 2 if (rng.random() < P_DOUBLE and n_tasks - tasks >= 2) else 1
        clusters.append(size); tasks += size
    return clusters

def sim(n_tasks, passes, base, shift, sims, seed):
    rng = np.random.default_rng(seed)
    cl = layout(n_tasks, rng)
    g = len(cl)
    task_cluster = np.repeat(np.arange(g), cl)
    T = len(task_cluster)
    k = rng.integers(KMIN, KMAX + 1, size=T)
    mask = np.arange(KMAX)[None, :] < k[:, None]                    # T x KMAX
    ce = rng.normal(0, SD_CLUSTER, (sims, g))
    te = rng.normal(0, SD_TASK, (sims, T)) + ce[:, task_cluster]
    fe = rng.normal(0, SD_FACT, (sims, T, KMAX))
    sh = shift + rng.normal(0, TAU, (sims, g))[:, task_cluster]
    def arm(s):
        lg = base + te[:, :, None, None] + fe[:, :, None, :] + s[:, :, None, None] + rng.normal(0, SD_READING, (sims, T, passes, 1))
        hit = rng.random((sims, T, passes, KMAX)) < 1 / (1 + np.exp(-lg))
        return (hit * mask[None, :, None, :]).sum(-1) / k[None, :, None]  # sims x T x passes
    a, b = arm(np.zeros_like(sh)), arm(sh)
    keep = (rng.random((sims, T, passes)) > GAP) & (rng.random((sims, T, passes)) > GAP)
    cnt = keep.sum(-1)
    ta = np.where(cnt > 0, (a * keep).sum(-1) / np.maximum(cnt, 1), np.nan)
    tb = np.where(cnt > 0, (b * keep).sum(-1) / np.maximum(cnt, 1), np.nan)
    onehot = np.zeros((T, g)); onehot[np.arange(T), task_cluster] = 1
    def cmean(x):
        ok = ~np.isnan(x)
        return np.where(ok, x, 0) @ onehot / np.maximum(ok @ onehot, 1), (ok @ onehot) > 0
    ca, oka = cmean(ta); cb, _ = cmean(tb)
    d = np.where(oka, cb - ca, 0.0)
    ng = oka.sum(1)
    obs = d.sum(1) / ng
    signs = rng.choice([-1.0, 1.0], size=(g, FLIPS))
    null = (d @ signs) / ng[:, None]
    p = ((np.abs(null) >= np.abs(obs)[:, None] - 1e-12).sum(1) + 1) / (FLIPS + 1)
    return (p <= ALPHA).mean(), np.nanmean(tb) - np.nanmean(ta), np.nanmean(ta)

def calibrate(p0, seed):
    lo, hi = -4.0, 4.0
    for _ in range(30):
        mid = (lo + hi) / 2
        _, _, m = sim(60, 1, mid, 0.0, 300, seed)
        lo, hi = (mid, hi) if m < p0 else (lo, mid)
    return (lo + hi) / 2

def mdd(n_tasks, passes, p0):
    base = calibrate(p0, SEED + 1)
    lo, hi = 0.0, 2.0
    for _ in range(11):
        mid = (lo + hi) / 2
        pw, _, _ = sim(n_tasks, passes, base, mid, SIMS, SEED)
        lo, hi = (mid, hi) if pw < 0.8 else (lo, mid)
    pw, gain, ctrl = sim(n_tasks, passes, base, hi, SIMS, SEED)
    se = (pw * (1 - pw) / SIMS) ** 0.5
    size, _, _ = sim(n_tasks, passes, base, 0.0, 4 * SIMS // 2, SEED + 7)
    return gain, pw, se, ctrl, size, base

print("power.py: seed %d, %d simulated grids per point, %d sign flips, alpha %.4f, gaps %.0f%% per reading" % (SEED, SIMS, FLIPS, ALPHA, 100 * GAP))
print("components (logit SD): cluster %.1f, task %.1f, fact %.1f, reading %.1f, arm-shift noise %.1f; clusters of 2 tasks with p %.1f; facts %d to %d" % (SD_CLUSTER, SD_TASK, SD_FACT, SD_READING, TAU, P_DOUBLE, KMIN, KMAX))
print("tasks\tpasses\tcontrol\tMDD_points\tpower_at_MDD\tmc_se\tnull_size\tcalibrated_control\tbase_logit")
for n, P, p0 in [(100, 2, 0.50), (100, 2, 0.65), (100, 3, 0.50), (70, 2, 0.50), (70, 3, 0.50), (50, 2, 0.50), (50, 3, 0.50), (40, 2, 0.50), (40, 3, 0.50)]:
    gain, pw, se, ctrl, size, base = mdd(n, P, p0)
    print("%d\t%d\t%.2f\t%.1f\t%.3f\t%.3f\t%.3f\t%.3f\t%.3f" % (n, P, p0, 100 * gain, pw, se, size, ctrl, base))
