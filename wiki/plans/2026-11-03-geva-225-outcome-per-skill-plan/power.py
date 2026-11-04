#!/usr/bin/env python3
# Keyless power simulation for the GEVA-225 outcome-per-skill plan. No I/O beyond stdout.
# Paired-by-task binary outcome (hidden tests pass). Task plain rates in band, task-varying effect,
# k trials per arm per task, paired t-test on per-task mean differences, two-sided.
import numpy as np
from math import erf, sqrt
SEED = 20261102
SIMS = 4000

def tcrit(df, alpha):
    from scipy.stats import t
    return t.ppf(1 - alpha / 2, df)

def power(n, k, delta, sd_eff, alpha, rng):
    p = rng.beta(2.2, 2.2, size=(SIMS, n)) * 0.7 + 0.15   # in-band plain rates, mean 0.5, range 0.15-0.85
    q = np.clip(p + delta + rng.normal(0, sd_eff, size=(SIMS, n)), 0, 1)
    a = rng.binomial(k, p) / k
    b = rng.binomial(k, q) / k
    d = b - a
    m = d.mean(1); s = d.std(1, ddof=1)
    s[s == 0] = 1e-9
    tstat = m / (s / np.sqrt(n))
    return (np.abs(tstat) > tcrit(n - 1, alpha)).mean()

def mdd(n, k, sd_eff, alpha):
    rng = np.random.default_rng(SEED)
    for step in range(1, 81):
        delta = step * 0.005
        if power(n, k, delta, sd_eff, alpha, rng) >= 0.80:
            return round(delta * 100, 1)
    return None

designs = [(12, 2), (24, 2), (30, 2), (40, 3), (60, 4), (90, 4), (120, 4), (120, 6), (150, 6), (150, 8), (200, 6)]
print("MDD in points at 80%% power, two-sided paired t over tasks; SIMS=%d seed=%d" % (SIMS, SEED))
print("n_tasks k_trials trials_per_arm | a=0.05 sd.10 sd.15 sd.20 | a=0.025 sd.15 | a=0.0167 sd.15")
for n, k in designs:
    r = [mdd(n, k, s, 0.05) for s in (0.10, 0.15, 0.20)]
    r2 = mdd(n, k, 0.15, 0.025)
    r3 = mdd(n, k, 0.15, 0.0167)
    print("%3d %d %5d | %s %s %s | %s | %s" % (n, k, n * k, r[0], r[1], r[2], r2, r3))
