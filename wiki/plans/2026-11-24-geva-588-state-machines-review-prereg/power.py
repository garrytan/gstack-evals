# SR power (plan section 11): the smallest true difference in catch rate, G+ minus G0, that the counted run detects with
# 80% power at a two-sided 5% level, by simulation. Each unit and model gets its own G0 catch probability from a beta with
# the stated mean and concentration (units differ a lot in difficulty); G+ shifts it on the logit scale; each session is a
# Bernoulli draw; a unit's paired difference is its G+ mean minus its G0 mean over sessions and models; the test is the
# 95% interval of the mean paired difference over units (normal approximation of the unit bootstrap). Seeded; numpy only.
import sys, json
import numpy as np
def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))
def power(n, reps, means, kappa, shift, sims, rng):
    hits = 0; diffs = []
    for _ in range(sims):
        d = np.zeros(n)
        for m in means:
            p0 = rng.beta(m * kappa, (1 - m) * kappa, n).clip(1e-4, 1 - 1e-4)
            p1 = expit(logit(p0) + shift)
            d += rng.binomial(reps, p1) / reps - rng.binomial(reps, p0) / reps
            diffs.append(float((p1 - p0).mean()))
        d /= len(means)
        se = d.std(ddof=1) / np.sqrt(n)
        hits += abs(d.mean()) > 1.96 * se
    return hits / sims, float(np.mean(diffs))
def mdd(n, reps, means, kappa, sims, seed):
    rng = np.random.default_rng(seed)
    for shift in np.arange(0.05, 4.0, 0.05):
        pw, true = power(n, reps, means, kappa, shift, sims, rng)
        if pw >= 0.8: return round(true * 100, 1), round(float(shift), 2)
    return None, None
if __name__ == "__main__":
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    out = []
    for means, label in [((0.2, 0.1), "G0 at 20% on Opus, 10% on particle-1"), ((0.35, 0.15), "G0 at 35% on Opus, 15% on particle-1")]:
        for kappa in (2.0, 5.0):
            for n in (15, 20, 25, 30, 40):
                for reps in (2,):
                    m, s = mdd(n, reps, means, kappa, 400, seed)
                    out.append({"scenario": label, "kappa": kappa, "n": n, "sessions_per_cell": reps, "mdd_points": m, "logit_shift": s})
                    print(json.dumps(out[-1]), flush=True)
