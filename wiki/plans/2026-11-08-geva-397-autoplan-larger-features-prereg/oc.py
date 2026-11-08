#!/usr/bin/env python3
# oc.py: keyless operating characteristics for the autoplan harder-task experiment's preregistration.
# Part A drives H1's frozen headroom call (section 5 of the post) at 42 x 3, 40 x 3 and 20 x 3 on simulated panels,
# so the post can show whether 20 x 3 gives the same call with the same confidence as 42 x 3.
# Part B drives C1's decision rule at 42 x 4 on unscreened pools, using the G prereg's power.py unchanged
# (imported from its wiki folder after a sha256 check), because C1's tasks are not screened into a band.
# It decides nothing: H1's reading and C1's verdict come from the run's data under the post's rules.
# Run from this folder: uv run --no-project --with numpy==2.3.4 python3 oc.py > oc.txt
import hashlib, importlib.util, math, os, sys
import numpy as np

D = os.path.dirname(os.path.abspath(__file__))
GP = os.path.join(D, "..", "2026-11-04-geva-262-g-family-admission-prereg", "power.py")
G_SHA = "0c9dc8bac4b57fe911317301ca9fee0f3751691416ed653d33c0750cf6002617"
if hashlib.sha256(open(GP, "rb").read()).hexdigest() != G_SHA:
    sys.exit("oc.py: the G prereg's power.py does not match sha256 %s; fix: run from a checkout where wiki/plans/2026-11-04-geva-262-g-family-admission-prereg/power.py is unchanged" % G_SHA)
spec = importlib.util.spec_from_file_location("gpower", GP)
gp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gp)

SEED = 20261108
SIMS_A = 20000
TQ = {19: 2.093024, 39: 2.022691, 41: 2.019541}  # 0.975 quantile of Student's t at n - 1 degrees of freedom

def call(s, ub):
    # H1's headroom call on the frozen band, in the post's order once the rig and cost rules have passed:
    # CEILING when s > 0.65 or the upper bound is at least 0.80; FLOOR when s < 0.20; HEADROOM otherwise.
    return np.where((s > 0.65) | (ub >= 0.80), "C", np.where(s < 0.20, "F", "H"))

def part_a():
    print("Part A. H1's headroom call: P(HEADROOM) / P(CEILING) / P(FLOOR), and the wrong-call rate, by design, on a 42-task panel drawn from the pool.")
    print("The right call is the one the panel's own true mean none rate gives on the same thresholds (above 0.65 CEILING, below 0.20 FLOOR).")
    print("s is the mean over tasks of each task's solved share; ub = s + t(n-1) * sd(task shares) / sqrt(n). %d sims a cell, seed %d." % (SIMS_A, SEED))
    rng = np.random.default_rng(SEED)
    designs = ((42, 3), (40, 3), (20, 3))
    for conc, label in ((1.0, "U-shaped pool, Beta(m, 1-m)"), (4.0, "moderate pool, Beta(4m, 4(1-m))")):
        print("pool: " + label)
        print("  m | " + " | ".join("%dx%d: H / C / F, wrong" % d for d in designs))
        for m in (0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.90):
            p = rng.beta(m * conc, (1 - m) * conc, size=(SIMS_A, 42))
            truth = call(p.mean(axis=1), np.zeros(SIMS_A))
            cells = []
            for n, k in designs:
                x = (rng.random((SIMS_A, n, k)) < p[:, :n, None]).sum(axis=2) / k
                s = x.mean(axis=1)
                ub = s + TQ[n - 1] * x.std(axis=1, ddof=1) / math.sqrt(n)
                c = call(s, ub)
                cells.append("%.3f / %.3f / %.3f, %.3f" % ((c == "H").mean(), (c == "C").mean(), (c == "F").mean(), (c != truth).mean()))
            print("  %.2f | %s" % (m, " | ".join(cells)))
            sys.stdout.flush()
    print("Near the top edge, the wrong-call rate pooled over pool means 0.55 to 0.75 (U-shaped and moderate pools):")
    for n, k in designs:
        wrong = []
        for conc in (1.0, 4.0):
            for m in (0.55, 0.60, 0.65, 0.70, 0.75):
                r2 = np.random.default_rng(SEED + int(m * 1000) + int(conc * 10))
                p = r2.beta(m * conc, (1 - m) * conc, size=(SIMS_A, 42))
                truth = call(p.mean(axis=1), np.zeros(SIMS_A))
                x = (r2.random((SIMS_A, n, k)) < p[:, :n, None]).sum(axis=2) / k
                s = x.mean(axis=1)
                c = call(s, s + TQ[n - 1] * x.std(axis=1, ddof=1) / math.sqrt(n))
                wrong.append((c != truth).mean())
        print("  %dx%d: %.3f" % (n, k, float(np.mean(wrong))))

def part_b():
    print("Part B. C1 at 42 x 4 under the G prereg's decision rule (power.py, sha256 %s), on unscreened pools." % G_SHA[:12])
    print("columns: control scenario (its mean none rate) | ICC | power at C1's claimed MDD of 19.8 points | simulated MDD (80%%) | ceiling share at 19.8; %d sims a point, %d repositories, at most 3 tasks per repository" % (gp.SIMS, gp.G_REPOS))
    scen = [("unscreened U-pool 0.35", ("fixed", (0.35, 1.0)), (0.05,)),
            ("unscreened U-pool 0.50", ("fixed", (0.50, 1.0)), (0.0, 0.05, 0.10)),
            ("unscreened U-pool 0.65", ("fixed", (0.65, 1.0)), (0.05,)),
            ("unscreened moderate pool 0.50", ("fixed", (0.50, 4.0)), (0.0, 0.05, 0.10))]
    for i, (name, shape, iccs) in enumerate(scen):
        for icc in iccs:
            w = gp.World(42, 4, shape, icc, gp.SIMS, SEED + 1000 * i + int(icc * 100))
            pw, ce = w.power(0.198)
            cm = gp.calib(np.random.default_rng(SEED + 3), shape, 4, icc, 0.0)[2]
            print("%s (%.2f) | %.2f | %.3f | %s | %.3f" % (name, cm, icc, pw, gp.mdd_search(w), ce))
            sys.stdout.flush()
    print("null size at 42 x 4 on the unscreened U-pool at 0.50 (rate of a 'helps' reading, and of any claim, when the true mean difference is 0):")
    for icc in (0.0, 0.10):
        w = gp.World(42, 4, ("fixed", (0.50, 1.0)), icc, gp.SIMS_NULL, SEED + 50000 + int(icc * 100))
        for kind in ("strict", "heterogeneous"):
            A, B = w.outcomes(0.0, kind)
            helps, hurts, ceil, z, se = gp.decide(A, B, w.repo, w.sizes, 4)
            print("ICC %.2f | %s null | helps %.4f | any claim %.4f" % (icc, kind, float(helps.mean()), float((helps | hurts).mean())))
            sys.stdout.flush()

if __name__ == "__main__":
    print("oc.py: operating characteristics for H1's headroom call and C1's test; numpy %s" % np.__version__)
    part_a()
    part_b()
