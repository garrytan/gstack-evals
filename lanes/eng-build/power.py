#!/usr/bin/env python3
# Copyright (c) 2026 Garry Tan. MIT License.
# power.py: the eng-review build read's MDD for the aftermath pass share (prereg 2026-11-11-geva-522, section 9), with
# every setting an input. Seeded and keyless; standard library only.
#
# Model: each unit has a baseline on the logit scale, normal around logit(p0) with SD_B. A share of units is unwinnable:
# no arm passes any of their cases. Each skill arm moves each unit by a logit shift plus unit noise TAU; the shift is
# solved so the mean lift in points is delta. Each build adds an effect with SD sd_e shared by all of that build's cases.
# A unit holds 1 or more aftermath items and each item 1 or more cases, drawn from the distributions given. A build's
# score is the item-weighted share of passing cases (or case-weighted with --weight case); a unit's arm score is the
# mean over its K builds. The pooled contrast is the mean of the three skill arms minus plain; a per-arm contrast is one
# arm minus plain. The paired test on unit differences is read as a two-sided t test (Cornish-Fisher t quantile), or as
# a sign-flip test with --flips N. MDD = the smallest delta (0.01 steps) with power at least 0.80.
#
# Run: python3 power.py --grid                       the table in power.txt's format
#      python3 power.py --units 48 --k 3 --p0 0.3    one row
#      python3 power.py --fit pilot.json --json      refit SD_B, sd_e, p0 and the unwinnable share from the pilot's
#                                                    builds, then print the pooled MDD for each design the cuts reach
# pilot.json: {"builds": [{"unit": "u1", "arm": "plain", "items": [[1, 0, 1], [0]]}, ...]}, one list of case outcomes
# (1 pass, 0 not) per aftermath item, for each scored pilot build (arms none and plain).
import argparse
import json
import math
import random
import statistics

SEED = 20261111
Z = statistics.NormalDist()


def expit(x):
    if x >= 0:
        return 1 / (1 + math.exp(-x))
    e = math.exp(x)
    return e / (1 + e)


def logit(p):
    return math.log(p / (1 - p))


def parse_dist(text):
    pairs = [(int(v), float(p)) for v, p in (part.split(":") for part in text.split(","))]
    total = sum(p for _, p in pairs)
    return [(v, p / total) for v, p in pairs]


def draw(dist, rng):
    r = rng.random()
    acc = 0.0
    for v, p in dist:
        acc += p
        if r < acc:
            return v
    return dist[-1][0]


def t_quantile(q, df):
    z = Z.inv_cdf(q)
    return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)


class Model:
    def __init__(self, a):
        self.p0, self.sd_b, self.tau, self.sd_e = a.p0, a.sd_b, a.tau, a.sd_e
        self.unwinnable, self.weight = a.unwinnable, a.weight
        self.items, self.cases = parse_dist(a.items), parse_dist(a.cases)

    def build_score(self, x, layout, rng):
        p = expit(x)
        shares, passed, total = [], 0, 0
        for c in layout:
            k = sum(1 for _ in range(c) if rng.random() < p)
            shares.append(k / c)
            passed += k
            total += c
        return sum(shares) / len(shares) if self.weight == "item" else passed / total

    def shift_for(self, delta, rng):
        xs = [(logit(self.p0) + rng.gauss(0, self.sd_b), rng.gauss(0, self.tau)) for _ in range(20000)]
        base = sum(expit(b) for b, _ in xs) / len(xs)
        win = 1 - self.unwinnable
        lo, hi = -8.0, 8.0
        for _ in range(50):
            mid = (lo + hi) / 2
            lift = win * (sum(expit(b + mid + u) for b, u in xs) / len(xs) - base)
            lo, hi = (mid, hi) if lift < delta else (lo, mid)
        return (lo + hi) / 2

    def diffs(self, n, k, arms, shift, rng):
        out = []
        for _ in range(n):
            if rng.random() < self.unwinnable:
                out.append(0.0)
                continue
            b = logit(self.p0) + rng.gauss(0, self.sd_b)
            layout = [draw(self.cases, rng) for _ in range(draw(self.items, rng))]
            plain = sum(self.build_score(b + rng.gauss(0, self.sd_e), layout, rng) for _ in range(k)) / k
            tops = []
            for _ in range(arms):
                u = shift + rng.gauss(0, self.tau)
                tops.append(sum(self.build_score(b + u + rng.gauss(0, self.sd_e), layout, rng) for _ in range(k)) / k)
            out.append(sum(tops) / arms - plain)
        return out


def rejects(d, alpha, flips, rng):
    n = len(d)
    m = sum(d) / n
    if flips:
        t = abs(sum(d)) - 1e-12
        hits = sum(1 for _ in range(flips) if abs(sum(x if rng.random() < 0.5 else -x for x in d)) >= t)
        return (1 + hits) / (1 + flips) <= alpha
    sd = statistics.stdev(d) if n > 1 else 0.0
    if sd == 0:
        return False
    return abs(m) / (sd / math.sqrt(n)) > t_quantile(1 - alpha / 2, n - 1)


def mdd(model, n, k, kind, alpha, sims, flips, seed):
    arms = 3 if kind == "pooled" else 1
    for step in range(3, 41):
        delta = step / 100
        if model.p0 + delta >= 0.95:
            return None
        rng = random.Random(seed * 1000 + step)
        shift = model.shift_for(delta, rng)
        hit = sum(1 for _ in range(sims) if rejects(model.diffs(n, k, arms, shift, rng), alpha, flips, rng))
        if hit / sims >= 0.80:
            return delta
    return None


def fit(path, a):
    builds = json.load(open(path))["builds"]
    by_unit = {}
    for b in builds:
        by_unit.setdefault(b["unit"], []).append(b)
    plain = [b for b in builds if b["arm"] == "plain"]
    score = lambda b: sum(sum(i) / len(i) for i in b["items"]) / len(b["items"])
    unwinnable = sum(1 for bs in by_unit.values() if all(sum(map(sum, b["items"])) == 0 for b in bs)) / len(by_unit)
    p_all = sum(score(b) for b in plain) / max(len(plain), 1)
    win = max(1 - unwinnable, 1e-9)
    p0 = min(max(p_all / win, 0.02), 0.95)
    unit_means = []
    within = []
    for bs in by_unit.values():
        s = [score(b) for b in bs if b["arm"] == "plain"]
        if len(s) >= 2:
            unit_means.append(sum(s) / len(s))
            within.append(statistics.variance(s))
    obs_between = statistics.variance(unit_means) if len(unit_means) > 1 else 0.0
    obs_within = sum(within) / len(within) if within else 0.0
    items = {}
    cases = {}
    for b in plain:
        items[len(b["items"])] = items.get(len(b["items"]), 0) + 1
        for i in b["items"]:
            cases[len(i)] = cases.get(len(i), 0) + 1
    a.items = ",".join(str(v) + ":" + str(c) for v, c in sorted(items.items()))
    a.cases = ",".join(str(v) + ":" + str(c) for v, c in sorted(cases.items()))
    a.p0, a.unwinnable = round(p0, 3), round(unwinnable, 3)
    best = None
    rng = random.Random(a.seed)
    for sd_b in [x / 4 for x in range(1, 13)]:
        for sd_e in [x / 4 for x in range(0, 9)]:
            a.sd_b, a.sd_e = sd_b, sd_e
            m = Model(a)
            means, var_w = [], []
            for _ in range(400):
                b = logit(m.p0) + rng.gauss(0, sd_b)
                layout = [draw(m.cases, rng) for _ in range(draw(m.items, rng))]
                s = [m.build_score(b + rng.gauss(0, sd_e), layout, rng) for _ in range(2)]
                means.append(sum(s) / 2)
                var_w.append(statistics.variance(s))
            err = (statistics.variance(means) - obs_between) ** 2 + (sum(var_w) / len(var_w) - obs_within) ** 2
            if best is None or err < best[0]:
                best = (err, sd_b, sd_e)
    a.sd_b, a.sd_e = best[1], best[2]
    return {"p0": a.p0, "sd_b": a.sd_b, "sd_e": a.sd_e, "unwinnable": a.unwinnable, "items": a.items, "cases": a.cases, "units": len(by_unit), "builds": len(builds)}


def main():
    p = argparse.ArgumentParser(description="MDD of the build read's aftermath pass share")
    p.add_argument("--units", type=int, default=48)
    p.add_argument("--k", type=int, default=3)
    p.add_argument("--kind", choices=["pooled", "per-arm"], default="pooled")
    p.add_argument("--alpha", type=float, default=0.05)
    p.add_argument("--p0", type=float, default=0.3)
    p.add_argument("--sd-b", dest="sd_b", type=float, default=1.5)
    p.add_argument("--tau", type=float, default=0.5)
    p.add_argument("--sd-e", dest="sd_e", type=float, default=0.5)
    p.add_argument("--unwinnable", type=float, default=0.0)
    p.add_argument("--items", default="1:1", help="items a unit, value:weight pairs")
    p.add_argument("--cases", default="1:0.55,2:0.30,3:0.15", help="cases an item, value:weight pairs")
    p.add_argument("--weight", choices=["item", "case"], default="item")
    p.add_argument("--sims", type=int, default=600)
    p.add_argument("--flips", type=int, default=0)
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--grid", action="store_true")
    p.add_argument("--fit")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    fitted = fit(a.fit, a) if a.fit else None
    head = "MDD in points of aftermath pass share at 80%% power, paired by unit; SD_B=%s TAU=%s unwinnable=%s items %s cases %s weight %s seed %d" % (a.sd_b, a.tau, a.unwinnable, a.items, a.cases, a.weight, a.seed)
    if a.fit:
        designs = [(48, 3), (40, 3), (40, 2)]
        out = {"fitted": fitted, "mdd": {}}
        for n, k in designs:
            out["mdd"]["%dx%d" % (n, k)] = mdd(Model(a), n, k, "pooled", a.alpha, a.sims, a.flips, a.seed)
        print(json.dumps(out) if a.json else head + "\n" + json.dumps(out, indent=1))
        return
    if a.grid:
        print(head)
        print("kind    n  K  p0   sd_e  MDD")
        for kind, alpha in (("pooled", a.alpha), ("per-arm", a.alpha)):
            for sd_e in (0.5, 1.0):
                for p0 in (0.3, 0.5):
                    for k in (2, 3):
                        for n in (40, 48, 64, 96):
                            a.p0, a.sd_e = p0, sd_e
                            v = mdd(Model(a), n, k, kind, alpha, a.sims, a.flips, a.seed)
                            print("%-7s %-2d %d  %.1f  %.1f   %s" % (kind, n, k, p0, sd_e, "n/a" if v is None else "%.3f" % v))
        return
    v = mdd(Model(a), a.units, a.k, a.kind, a.alpha, a.sims, a.flips, a.seed)
    if a.json:
        print(json.dumps({"kind": a.kind, "units": a.units, "k": a.k, "p0": a.p0, "sd_e": a.sd_e, "mdd": v}))
    else:
        print(head)
        print("kind    n  K  p0   sd_e  MDD")
        print("%-7s %-2d %d  %.1f  %.1f   %s" % (a.kind, a.units, a.k, a.p0, a.sd_e, "n/a" if v is None else "%.3f" % v))


if __name__ == "__main__":
    main()
