#!/usr/bin/env python3
"""Power and MDD for the harness mechanics eval (paired binary endpoints, one session per task and arm, per model).

1. Paired differences. Delta = mean over tasks of (arm A - arm B). With discordance d (share of tasks where the two arms
   differ) and a true difference near 0, Var(Delta_hat) ~= (d - Delta^2) / n, so the MDD (two-sided alpha 0.05, power 0.80)
   is 2.802 * sqrt(d / n). The non-inferiority test at margin M (one-sided alpha 0.025) has power
   Phi((Delta + M) / SE - 1.96), SE = sqrt((d - Delta^2) / n).
2. The equal-spend contrast E (idea 4). Per task: mix = (1 - f) * pass(A) + f * pass(bo2), E = mean(mix - pass(gstack)),
   with f = (c_gstack - c_none) / (c_bo2 - c_none) clipped to [0, 1]. A Monte Carlo prints the SD of E_hat and of the raw
   bo2 - gstack difference, so MDD = 2.802 * SD. Tasks draw a latent pass probability p from a Beta whose mean is the base
   rate and whose variance makes two independent sessions of one arm discordant on a share d0 of tasks
   (d0 = 2 * (m(1 - m) - Var p)). Each arm's session is Bernoulli(p); attempt B is an independent draw; the selector picks
   the passing patch with probability q when exactly one passes. gstack is drawn at the none arm's p (the null for gstack
   against none), so E's mean equals f times bo2's gain over one attempt, which also prints. A pooled SD combines the
   per-model SDs of independent model blocks (equal weight per task and model).
3. The equivalence rule for E: the 95% interval lies inside -5 to +5 points. With E_hat ~ Normal(mean E, SD), its power
   is Phi((5 - 1.96 SD - mean E) / SD) - Phi((-5 + 1.96 SD - mean E) / SD), from the pooled rows of part 2.
Inputs in hand (counts only, from merged posts): Claude Code none arms on 80 SWE-rebench tasks passed 65.0% (Opus 5.5),
61.3% (GPT-6.1 Sol) and 75.0% (particle-1); near-identical arms differ on 0.04 to 0.14 of tasks; Opus told sessions ran a
check after the last edit in 55 to 63 of 80 (63 with the contract hook on, 59 with it off). Planning spend ratios to none: gstack told 1.35, bo2 2.10 (two sessions and a
selector call), so f = 0.32.
Tasks are treated as independent; the analysis resamples repositories, and the cap of 4 tasks per repository keeps the
gap small.
"""
import math, random

Z = 1.959964 + 0.841621

def mdd(d, n):
    return Z * math.sqrt(d / n)

def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def ni_power(d, n, delta, m=0.075):
    se = math.sqrt(max(d - delta * delta, 1e-12) / n)
    return phi((delta + m) / se - 1.959964)

def beta_params(m, d0):
    var = m * (1 - m) - d0 / 2
    s = m * (1 - m) / var - 1
    return m * s, (1 - m) * s

def sim_e(m, d0, q, f, n, sims, rng):
    a, b = beta_params(m, d0)
    es, raws, gains = [], [], []
    for _ in range(sims):
        e = raw = gain = 0.0
        for _ in range(n):
            p = rng.betavariate(a, b)
            x1, x2, g = rng.random() < p, rng.random() < p, rng.random() < p
            if x1 == x2:
                bo2 = x1
            else:
                bo2 = rng.random() < q
            e += (1 - f) * x1 + f * bo2 - g
            raw += bo2 - g
            gain += bo2 - x1
        es.append(e / n); raws.append(raw / n); gains.append(gain / n)
    sd = lambda xs: math.sqrt(sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / (len(xs) - 1))
    return sd(es), sd(raws), sum(gains) / len(gains), sum(es) / len(es), sum(raws) / len(raws)

if __name__ == "__main__":
    ds = [0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30]
    ns = [60, 180, 200, 400, 570, 600]
    print("1. MDD in points for a paired binary difference (rows: discordance d; columns: paired units n)")
    print("d     " + "".join(f"{n:>7}" for n in ns))
    for d in ds:
        print(f"{d:<6}" + "".join(f"{100*mdd(d,n):>7.1f}" for n in ns))
    print()
    for n in (200, 180, 600):
        print(f"2. Power of the 7.5-point non-inferiority test at {n} paired units, by true difference (points)")
        deltas = [0.0, -0.02, -0.03]
        print("d     " + "".join(f"{100*x:>8.0f}" for x in deltas))
        for d in ds[:5]:
            print(f"{d:<6}" + "".join(f"{ni_power(d,n,x):>8.2f}" for x in deltas))
        print()
    print("3. Equal-spend contrast E and raw bo2 - gstack (Monte Carlo, 2,000 runs each, seed 20261148, f 0.32)")
    print("units  base         d0    q    SD(E)  MDD(E)  SD(raw) MDD(raw) bo2 gain  mean E  mean raw")
    rng = random.Random(20261148)
    equiv = []
    for d0 in (0.10, 0.15):
        for q in (0.6, 0.8):
            for m in (0.613, 0.65, 0.75):
                sde, sdr, gain, me, mr = sim_e(m, d0, q, 0.32, 200, 2000, rng)
                print(f"{200:<6} {m:<12} {d0:<5} {q:<4} {100*sde:>6.2f} {100*Z*sde:>7.1f} {100*sdr:>7.2f} {100*Z*sdr:>8.1f} {100*gain:>8.1f} {100*me:>7.1f} {100*mr:>9.1f}")
            sds = [sim_e(m, d0, q, 0.32, 200, 2000, rng) for m in (0.613, 0.65, 0.75)]
            pooled = lambda i: math.sqrt(sum(x[i] ** 2 for x in sds)) / 3
            print(f"{600:<6} {'all three':<12} {d0:<5} {q:<4} {100*pooled(0):>6.2f} {100*Z*pooled(0):>7.1f} {100*pooled(1):>7.2f} {100*Z*pooled(1):>8.1f}")
            equiv.append((d0, q, pooled(0), sum(x[3] for x in sds) / 3))
            fr = lambda i: math.sqrt(sds[0][i] ** 2 + sds[1][i] ** 2) / 2
            print(f"{400:<6} {'Opus and Sol':<12} {d0:<5} {q:<4} {100*fr(0):>6.2f} {100*Z*fr(0):>7.1f} {100*fr(1):>7.2f} {100*Z*fr(1):>8.1f}")
    print()
    print("4. Power of the equivalence rule for E (95% interval inside -5 to +5 points), pooled over the three models")
    print("d0    q    SD(E)  mean E  power")
    for d0, q, sd, me in equiv:
        w = 1.959964 * sd
        print(f"{d0:<5} {q:<4} {100*sd:>6.2f} {100*me:>7.1f} {phi((0.05 - w - me) / sd) - phi((-0.05 + w - me) / sd):>6.2f}")
