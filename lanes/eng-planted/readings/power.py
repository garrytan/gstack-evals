#!/usr/bin/env python3
# Copyright (c) 2026 Garry Tan. MIT License.
# MDD of the planted-unit read's primary (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg, section 10).
# Seeded and keyless; needs numpy only. Run: uv run -q --with numpy python lanes/eng-planted/readings/power.py
#
# Model, per simulated run: repositories hold 1 to 3 units at the mix (planning 0.40, 0.35, 0.25), with a repository
# effect r ~ N(0, 0.3) on the logit scale shared by the repository's units. Each unit has an avoid baseline
# a_u ~ N(logit(p0), 1.5) and a catch baseline c_u ~ N(logit(p0), 1.5), and 1 to 3 planted cases (0.55, 0.30, 0.15).
# A unit no arm can move (the unforeseeable share) gets no effect; every other unit gets the skill arm's effect
# d_u ~ N(delta, 0.5), the same draw on avoid and catch. Each build (its own review and its own build) adds
# e ~ N(0, sd_e), shared by that build's cases and its catch. A case passes with logistic(a_u + r + d + e). Catch is
# possible only when the build's code handled the planted case its test targets (one of the unit's planted cases,
# drawn at random), so a build catches with probability avoid * logistic(c_u + r + d + e) + (1 - avoid) * 0.03. A
# build's composite is (avoid + catch) / 2, a unit's arm score is the mean over its K builds, and D_u is the skill arm's
# score minus plain's. The test is the two-sided repository sign-flip on the repository sums of D_u at alpha 0.05, with
# 1,000 flips. The MDD is the smallest mean difference, in points of the primary, the test detects in 80% of 2,000
# runs, found by bisection on delta with common random numbers. p0 0.4 and 0.6 give control levels of about avoid
# 0.43 and 0.57, catch 0.21 and 0.36, and composite 0.32 and 0.46.
#
# No arguments: the frozen table (every row, then the ranges). --rows 64x3 or --rows 64x3:avoid: one design's rows and
# range (the dry run's case). --n: one MDD for the inputs given. --fit pilot.json: refits the control centers, the build
# SD and the repository mix from the pilot's plain builds and prints the re-projected MDD (the start rule's input).
# pilot.json: {"builds": [{"unit": "u1", "repo": "r1", "avoid": 0.5, "catch": 1}, ...], "unforeseeable": 0.0}.
import argparse, json, sys
import numpy as np

SEED = 20261115
SD_REPO = 0.3; SD_UNIT = 1.5; TAU = 0.5; NO_HANDLE = 0.03; ALPHA = 0.05; POWER = 0.8; WORTH = 0.10
M_W = (0.55, 0.30, 0.15)
PLAN_MIX = (0.40, 0.35, 0.25)
R_RUNS = 2000; FLIPS = 1000; STEPS = 14; HI = 3.0
DESIGNS = ((40, 3, "composite"), (64, 2, "composite"), (64, 3, "composite"), (80, 3, "composite"), (96, 3, "composite"), (64, 3, "avoid"), (64, 3, "catch"))
GRID = [(p0, sd_e, unf) for p0 in (0.4, 0.6) for sd_e in (0.5, 1.0) for unf in (0.0, 0.2)]

def lg(x): return 1 / (1 + np.exp(-x))
def logit(p): return np.log(p / (1 - p))

def repos_of(n, mix):
    """Repository index per unit: the mix's shares of repositories with 1, 2 and 3 units, filled to exactly n units."""
    groups = n / (mix[0] + 2 * mix[1] + 3 * mix[2])
    c3 = int(round(mix[2] * groups)); c2 = int(round(mix[1] * groups))
    c1 = n - 2 * c2 - 3 * c3
    while c1 < 0:
        c3 -= 1; c1 += 3
    sizes = [3] * c3 + [2] * c2 + [1] * c1
    return np.repeat(np.arange(len(sizes)), sizes), len(sizes)

class Design:
    """Every random draw for one configuration, made once from a seed of the configuration, so a design's rows are the
    same alone or in the table, and power rises with delta (common random numbers)."""
    def __init__(self, n, K, p0a, p0c, sd_e, unf, mix, R=R_RUNS):
        rng = np.random.default_rng([SEED, n, K, round(p0a * 1000), round(p0c * 1000), round(sd_e * 100), round(unf * 100), round(mix[0] * 100), round(mix[1] * 100), R])
        repo, G = repos_of(n, mix)
        self.G = G
        self.onehot = (repo[:, None] == np.arange(G)[None, :]).astype(float)
        r = rng.normal(0, SD_REPO, (R, G))[:, repo]
        self.base_a = rng.normal(logit(p0a), SD_UNIT, (R, n)) + r
        self.base_c = rng.normal(logit(p0c), SD_UNIT, (R, n)) + r
        self.m = rng.choice([1, 2, 3], size=(R, n), p=M_W)
        self.cases = np.arange(3)[None, None, None, :] < self.m[:, :, None, None]
        self.move = (rng.random((R, n)) >= unf).astype(float)
        self.z = rng.normal(0, TAU, (R, n))
        self.arms = [(rng.normal(0, sd_e, (R, n, K)), rng.random((R, n, K, 3)), rng.random((R, n, K))) for _ in range(2)]
        self.flips = np.where(rng.random((FLIPS, G)) < 0.5, -1.0, 1.0)

    def builds(self, arm, shift):
        """Per-build avoid and catch, shape (runs, units, K)."""
        e, u_case, u_catch = self.arms[arm]
        s = shift[:, :, None] + e
        avoid = ((u_case < lg(self.base_a[:, :, None] + s)[..., None]) & self.cases).sum(-1) / self.m[:, :, None]
        catch = (u_catch < avoid * lg(self.base_c[:, :, None] + s) + (1 - avoid) * NO_HANDLE).astype(float)
        return {"avoid": avoid, "catch": catch, "composite": (avoid + catch) / 2}

    def run(self, delta, primary):
        s0 = {k: v.mean(-1) for k, v in self.builds(0, np.zeros_like(self.z)).items()}
        s1 = self.builds(1, (delta + self.z) * self.move)[primary].mean(-1)
        D = s1 - s0[primary]
        sums = D @ self.onehot
        stat = np.abs(sums.sum(1))
        hits = (np.abs(sums @ self.flips.T) >= stat[:, None] - 1e-12).sum(1)
        p = (hits + 1) / (FLIPS + 1)
        return float((p <= ALPHA).mean()), float(D.mean()), {k: float(v.mean()) for k, v in s0.items()}

def mdd(n, K, p0a, p0c, sd_e, unf, mix, primary, worth=False):
    """The MDD at 80% power; with worth, also the power at a true 10-point mean difference."""
    d = Design(n, K, p0a, p0c, sd_e, unf, mix)
    lo, hi = 0.0, HI
    for _ in range(STEPS):
        mid = (lo + hi) / 2
        if d.run(mid, primary)[0] >= POWER: hi = mid
        else: lo = mid
    power, diff, levels = d.run(hi, primary)
    out = {"mdd": diff, "power": power, "delta": hi, "levels": levels}
    if worth:
        lo, hi = 0.0, HI
        for _ in range(STEPS):
            mid = (lo + hi) / 2
            if d.run(mid, primary)[1] >= WORTH: hi = mid
            else: lo = mid
        out["power_at_10"] = d.run(hi, primary)[0]
    return out

def rows(n, K, primary, mix=PLAN_MIX):
    out = []
    for p0, sd_e, unf in GRID:
        r = mdd(n, K, p0, p0, sd_e, unf, mix, primary, worth=(primary == "composite"))
        out.append((p0, sd_e, unf, r))
    return out

HEAD = "design  primary    p0   sd_e unf   avoid0 catch0 comp0  MDD    power  power@0.10"
def row_line(n, K, primary, p0, sd_e, unf, r):
    lv = r["levels"]
    w = ("%.3f" % r["power_at_10"]) if "power_at_10" in r else "-"
    return "%-7s %-10s %.1f  %.1f  %.1f   %.3f  %.3f  %.3f  %.3f  %.3f  %s" % ("%dx%d" % (n, K), primary, p0, sd_e, unf, lv["avoid"], lv["catch"], lv["composite"], r["mdd"], r["power"], w)
def range_line(n, K, primary, rs):
    v = [r["mdd"] for *_, r in rs]
    return "%-7s %-10s MDD %.2f to %.2f (%.3f to %.3f)" % ("%dx%d" % (n, K), primary, min(v), max(v), min(v), max(v))
def preamble(mix):
    print("MDD at 80%% power in points of the primary, paired by unit, two-sided repository sign-flip at alpha %.2f; %d runs, %d flips; seed %d" % (ALPHA, R_RUNS, FLIPS, SEED))
    print("repository SD %.1f, unit SD %.1f, effect SD %.1f, catch %.2f when unhandled; cases 1/2/3 at %.2f/%.2f/%.2f; mix %.2f/%.2f/%.2f" % ((SD_REPO, SD_UNIT, TAU, NO_HANDLE) + M_W + tuple(mix)))

def fit(path, unf_flag):
    """Refits the control centers and the build SD on the pilot's plain builds (two a unit) and reads the mix."""
    data = json.load(open(path))
    units = {}
    for b in data["builds"]:
        units.setdefault(b["unit"], {"repo": b["repo"], "builds": []})["builds"].append(b)
    avoid_obs = float(np.mean([np.mean([b["avoid"] for b in u["builds"]]) for u in units.values()]))
    catch_obs = float(np.mean([np.mean([b["catch"] for b in u["builds"]]) for u in units.values()]))
    comp = [[(b["avoid"] + b["catch"]) / 2 for b in u["builds"]] for u in units.values()]
    within = [np.var(c, ddof=1) for c in comp if len(c) > 1]
    within_obs = float(np.mean(within)) if within else 0.0
    per_repo = {}
    for u in units.values():
        per_repo[u["repo"]] = per_repo.get(u["repo"], 0) + 1
    counts = [sum(1 for c in per_repo.values() if min(c, 3) == k) for k in (1, 2, 3)]
    mix = tuple(c / sum(counts) for c in counts)
    unf = unf_flag if unf_flag is not None else float(data.get("unforeseeable", 0.0))
    clip = lambda x: float(np.clip(x, 0.02, 0.98))
    best = None
    for sd_e in np.arange(0.0, 2.01, 0.25):
        def level(pa, pc, key):
            return Design(200, 2, pa, pc, float(sd_e), 0.0, PLAN_MIX, R=40).run(0.0, "composite")[2][key]
        lo, hi = 0.02, 0.98
        for _ in range(12):
            mid = (lo + hi) / 2
            lo, hi = (lo, mid) if level(mid, 0.5, "avoid") >= avoid_obs else (mid, hi)
        pa = clip((lo + hi) / 2)
        lo, hi = 0.02, 0.98
        for _ in range(12):
            mid = (lo + hi) / 2
            lo, hi = (lo, mid) if level(pa, mid, "catch") >= catch_obs else (mid, hi)
        pc = clip((lo + hi) / 2)
        d = Design(200, 2, pa, pc, float(sd_e), 0.0, PLAN_MIX, R=40)
        b = d.builds(0, np.zeros_like(d.z))["composite"]
        err = (float(np.var(b, axis=-1, ddof=1).mean()) - within_obs) ** 2
        if best is None or err < best[0]:
            best = (err, pa, pc, float(sd_e))
    return {"avoid": round(avoid_obs, 4), "catch": round(catch_obs, 4), "within": round(within_obs, 5), "p0_avoid": round(best[1], 4), "p0_catch": round(best[2], 4), "sd_e": best[3], "unforeseeable": unf, "mix": [round(x, 4) for x in mix], "units": len(units), "repos": len(per_repo)}

def main(argv):
    ap = argparse.ArgumentParser(description="the planted-unit read's MDD (prereg section 10)")
    ap.add_argument("--rows", help="one design, as NxK or NxK:primary")
    ap.add_argument("--n", type=int)
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--p0", type=float, default=0.4)
    ap.add_argument("--p0-avoid", dest="p0a", type=float)
    ap.add_argument("--p0-catch", dest="p0c", type=float)
    ap.add_argument("--sd-e", dest="sd_e", type=float, default=0.5)
    ap.add_argument("--unforeseeable", type=float)
    ap.add_argument("--mix", help="shares of repositories with 1, 2 and 3 units, comma-separated")
    ap.add_argument("--primary", choices=["composite", "avoid", "catch"], default="composite")
    ap.add_argument("--fit", help="pilot.json: refit and print the re-projected MDD at --n x --k (default 64x3) and the floor 40x3")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    mix = tuple(float(x) for x in a.mix.split(",")) if a.mix else PLAN_MIX
    if a.fit:
        f = fit(a.fit, a.unforeseeable)
        designs = [(a.n or 64, a.k), (40, 3)]
        out = {"fitted": f, "mdd": {}}
        for n, K in designs:
            out["mdd"]["%dx%d" % (n, K)] = round(mdd(n, K, f["p0_avoid"], f["p0_catch"], f["sd_e"], f["unforeseeable"], tuple(f["mix"]), a.primary)["mdd"], 4)
        print(json.dumps(out) if a.json else json.dumps(out, indent=1))
        return
    if a.n:
        r = mdd(a.n, a.k, a.p0a or a.p0, a.p0c or a.p0, a.sd_e, a.unforeseeable or 0.0, mix, a.primary)
        if a.json:
            print(json.dumps({"n": a.n, "k": a.k, "primary": a.primary, "mdd": round(r["mdd"], 4), "power": r["power"], "levels": {k: round(v, 4) for k, v in r["levels"].items()}}))
        else:
            print(HEAD)
            print(row_line(a.n, a.k, a.primary, a.p0a or a.p0, a.sd_e, a.unforeseeable or 0.0, r))
        return
    if a.rows:
        nk, _, prim = a.rows.partition(":")
        n, K = (int(x) for x in nk.lower().split("x"))
        designs = [(n, K, prim or "composite")]
    else:
        designs = list(DESIGNS)
    preamble(mix)
    print(HEAD)
    done = []
    for n, K, prim in designs:
        rs = rows(n, K, prim, mix)
        for p0, sd_e, unf, r in rs:
            print(row_line(n, K, prim, p0, sd_e, unf, r))
        done.append((n, K, prim, rs))
    print("ranges over p0 0.4 and 0.6, build SD 0.5 and 1.0, unforeseeable share 0 and 0.2:")
    for n, K, prim, rs in done:
        print(range_line(n, K, prim, rs))

if __name__ == "__main__":
    main(sys.argv[1:])
