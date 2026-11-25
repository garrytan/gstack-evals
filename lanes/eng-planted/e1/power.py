#!/usr/bin/env python3
# Copyright (c) 2026 Garry Tan. MIT License.
# Eval 1's start-rule re-print (prereg 2026-11-24-geva-587-design-time-state-modeling sections 8 and Pilots, with pre-run
# change 2's review-by-unit spec). Seeded and keyless; needs numpy. It imports attempt 3's frozen power.py unchanged and
# adds one thing its pooled rows lack: what a reviewer model's two builds of a unit share.
#
# Model: power.py's, with the K builds of a unit split into M models x 2 builds. Each unit and model adds a baseline term
# b ~ N(0, sd_mu) to both arms' builds of that model, and the modeling arm's effect varies by model within a unit,
# z ~ N(0, tau_mu), shared by that model's two builds (and, like the unit's effect, absent on a unit no arm can move).
# The pilot runs one cell per unit and model, so it cannot split a model's share from build noise: --fit reads N's
# builds as power.py --fit reads plain's (a unit's builds across models as its K builds), and each design prints at two
# ends, (sd_mu, tau_mu) = (0, 0) and (the fitted sd_e, power.py's effect SD 0.5). The larger MDD, the shared end,
# governs the start rule.
#
# Run: uv run -q --with numpy python lanes/eng-planted/e1/power.py --fit pilot.json [--design <units>:<models> ...] [--json]
# --design re-prints at the drawn unit count and the number of models a contrast still pools after the pilot (for
# example 52:3 for D, C and G minus N, 52:2 for P's rows); with none it prints the frozen 64 and 48 by 3 and 2.
# pilot.json: {"builds": [{"unit": "u1", "repo": "r1", "model": "opus", "avoid": 0.5, "catch": 1}, ...], "unforeseeable": 0.0}
import argparse, json, os, sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "readings"))
import power as P  # noqa: E402

REPS = 2
DESIGNS = ((64, 3), (64, 2), (48, 3), (48, 2))


class E1Design(P.Design):
    def __init__(self, n, models, p0a, p0c, sd_e, unf, mix, sd_mu, tau_mu, R=P.R_RUNS):
        super().__init__(n, models * REPS, p0a, p0c, sd_e, unf, mix, R)
        rng = np.random.default_rng([P.SEED, 587, n, models, round(p0a * 1000), round(p0c * 1000), round(sd_e * 100), round(unf * 100), round(sd_mu * 100), round(tau_mu * 100), R])
        self.b_mu = np.repeat(rng.normal(0, sd_mu, (R, n, models)), REPS, axis=2)
        self.z_mu = np.repeat(rng.normal(0, tau_mu, (R, n, models)), REPS, axis=2)

    def builds(self, arm, shift):
        e, u_case, u_catch = self.arms[arm]
        s = shift[:, :, None] + e + self.b_mu + (self.z_mu * self.move[:, :, None] if arm == 1 else 0.0)
        avoid = ((u_case < P.lg(self.base_a[:, :, None] + s)[..., None]) & self.cases).sum(-1) / self.m[:, :, None]
        catch = (u_catch < avoid * P.lg(self.base_c[:, :, None] + s) + (1 - avoid) * P.NO_HANDLE).astype(float)
        return {"avoid": avoid, "catch": catch, "composite": (avoid + catch) / 2}


def mdd(n, models, p0a, p0c, sd_e, unf, mix, sd_mu, tau_mu):
    d = E1Design(n, models, p0a, p0c, sd_e, unf, mix, sd_mu, tau_mu)
    lo, hi = 0.0, P.HI
    for _ in range(P.STEPS):
        mid = (lo + hi) / 2
        if d.run(mid, "composite")[0] >= P.POWER: hi = mid
        else: lo = mid
    power, diff, levels = d.run(hi, "composite")
    return {"mdd": diff, "power": power, "delta": hi, "levels": levels}


def reprint(f, designs=DESIGNS):
    mix = tuple(f["mix"]) if sum(f["mix"]) > 0 else P.PLAN_MIX
    out = []
    for n, models in designs:
        ends = []
        for sd_mu, tau_mu in ((0.0, 0.0), (f["sd_e"], P.TAU)):
            r = mdd(n, models, f["p0_avoid"], f["p0_catch"], f["sd_e"], f["unforeseeable"], mix, sd_mu, tau_mu)
            ends.append({"sd_mu": sd_mu, "tau_mu": tau_mu, "mdd": round(r["mdd"], 4), "power": round(r["power"], 3)})
        out.append({"design": "%dx%dx%d" % (n, models, REPS), "ends": ends, "governs": max(e["mdd"] for e in ends)})
    return out


def main(argv):
    ap = argparse.ArgumentParser(description="eval 1's start-rule MDD re-print with a review-by-unit term")
    ap.add_argument("--fit", required=True, help="pilot.json: N's pilot builds")
    ap.add_argument("--unforeseeable", type=float)
    ap.add_argument("--design", action="append", default=[], help="<units>:<models>, the drawn unit count and the models a contrast pools")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    designs = []
    for d in a.design:
        try:
            n, m = (int(x) for x in d.split(":"))
        except ValueError:
            ap.error("--design takes <units>:<models>, not " + d)
        if not (1 <= n and 1 <= m <= 3):
            ap.error("--design needs at least 1 unit and 1 to 3 models, not " + d)
        designs.append((n, m))
    f = P.fit(a.fit, a.unforeseeable)
    rows = reprint(f, tuple(designs) or DESIGNS)
    if a.json:
        print(json.dumps({"fit": f, "rows": rows}))
        return 0
    print("fit from N's pilot builds: " + json.dumps(f))
    for r in rows:
        print("%-8s MDD %.3f at (0, 0), %.3f at (sd_e, 0.5); governs %.3f" % (r["design"], r["ends"][0]["mdd"], r["ends"][1]["mdd"], r["governs"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
