#!/usr/bin/env python3
"""Power for the pstack generated-checks preregistration: the MDD by simulation of the exact McNemar test. Keyless, deterministic.
Run: python3 power.py
"""
import math, random

def binom_two_sided_p(b, c):
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return min(1.0, 2 * tail)

def power_exact(n, d, delta, alpha, rng, sims=4000, deff=1.0):
    ne = max(2, int(round(n / deff)))
    pb = (d + delta) / 2
    pc = (d - delta) / 2
    if pc < 0:
        return float("nan")
    hits = 0
    for _ in range(sims):
        b = c = 0
        for _ in range(ne):
            u = rng.random()
            if u < pb:
                b += 1
            elif u < pb + pc:
                c += 1
        if b > c and binom_two_sided_p(b, c) < alpha:
            hits += 1
    return hits / sims

def mdd_exact(n, d, alpha, deff=1.2, seed=20261109):
    rng = random.Random(seed)
    for step in range(1, 101):
        delta = step / 100
        if delta > d:
            return None
        if power_exact(n, d, delta, alpha, rng, deff=deff) >= 0.8:
            return delta
    return None

print("== MDD by simulation of the exact two-sided McNemar test, 80% power, design effect 1.2 (up to 3 units a repository)")
print("alpha 0.025 is the stricter Holm step of the two verdict contrasts; none means no difference that size fits under that discordant share")
print("n pairs | d | MDD alpha 0.05 | MDD alpha 0.025")
fmt = lambda x: "none" if x is None else str(round(100 * x))
for n, label in ((28, "per model, n=28"), (36, "per model, n=36"), (44, "per model, n=44"), (84, "pooled 3 models, n=28"), (132, "pooled 3 models, n=44")):
    for d in (0.2, 0.3, 0.4, 0.5):
        print(label, "|", d, "|", fmt(mdd_exact(n, d, 0.05)), "|", fmt(mdd_exact(n, d, 0.025)))

