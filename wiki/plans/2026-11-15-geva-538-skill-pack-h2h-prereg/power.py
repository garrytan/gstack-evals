#!/usr/bin/env python3
"""Power for the skill-pack head-to-head: MDD by simulation of the exact two-sided McNemar test,
80% power, design effect 1.2 (at most 3 units a repository). Keyless and deterministic.
alpha 0.05/12 is the strictest Holm step of the 12 primary contrasts (gstack against each of 6 arms,
in each of 2 classes); alpha 0.05/6 is the strictest step if each class were its own family; 0.05 is the last step."""
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

fmt = lambda x: "none" if x is None else str(round(100 * x))
print("n units | discordant share | MDD a=0.05/12 | MDD a=0.05/6 | MDD a=0.05")
for n in (20, 30, 40, 50, 60, 80, 100, 120, 150, 200):
    for d in (0.2, 0.3, 0.4):
        print(n, "|", d, "|", fmt(mdd(n, d, 0.05/12)), "|", fmt(mdd(n, d, 0.05/6)), "|", fmt(mdd(n, d, 0.05)))
