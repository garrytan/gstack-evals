#!/usr/bin/env python3
"""Power for the skill-pack head-to-head extension (plan section 13): the MDD by simulation of the exact two-sided McNemar
test, 80% power, design effect 1.2, at the strictest Holm step of each part's family (the base bundle's power.py, same
seed and simulation), then the chance a no-harm criterion passes (point difference no worse than -5 points and 95%
interval not wholly below 0) by normal approximation with design effect 1.2. Keyless and deterministic."""
import math, numpy as np
from functools import lru_cache

@lru_cache(maxsize=None)
def pval(b, c):
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * tail)

def power(n, d, delta, alpha, rng, sims=4000, deff=1.2):
    ne = max(2, int(round(n / deff)))
    pb, pc = (d + delta) / 2, (d - delta) / 2
    if pc < 0:
        return float("nan")
    draws = rng.multinomial(ne, [pb, pc, 1 - pb - pc], size=sims)
    hits = 0
    for b, c, _ in draws:
        if b > c and pval(int(b), int(c)) < alpha:
            hits += 1
    return hits / sims

def mdd(n, d, alpha, seed=20261115):
    rng = np.random.default_rng(seed)
    for step in range(1, 101):
        delta = step / 100
        if delta > d:
            return None
        if power(n, d, delta, alpha, rng) >= 0.8:
            return delta
    return None

def no_harm(n, d, true, deff=1.2, floor=-0.05, z=1.959964):
    se = math.sqrt(deff * d / n)
    cut = max(floor, -z * se)
    return 0.5 * (1 + math.erf((true - cut) / se / math.sqrt(2)))

fmt = lambda x: "none fits" if x is None else str(round(100 * x))
print("part, class, n | strictest Holm step | MDD at discordant 0.2 | 0.3 | 0.4")
for label, n, m in (("S, O, 100", 100, 10), ("S, B, 60", 60, 10), ("P, O, 100", 100, 12), ("P, B, 60", 60, 12), ("L, 100", 100, 3)):
    print(label, "|", "0.05/%d" % m, "|", " | ".join(fmt(mdd(n, d, 0.05 / m)) for d in (0.2, 0.3, 0.4)))
print("no-harm pass probability | n | discordant share | true 0 points | true -5 points | true -10 points")
for n, d in ((100, 0.2), (100, 0.3), (100, 0.5), (60, 0.2)):
    print("no-harm |", n, "|", d, "|", " | ".join("%.2f" % no_harm(n, d, t) for t in (0.0, -0.05, -0.10)))
