#!/usr/bin/env python3
# Writes tests/stats/fixtures/g-power-parity.json: count matrices from the G admission prereg's power.py data model, with
# power.py's own decide() readings and its futility formula's interim z and conditional powers, for parity with
# src/runner/stats/outcome-decision.ts. Run from the repository root:
#   uv run --no-project --with numpy==2.3.4 python3 tests/stats/fixtures/g-power-parity.py
import hashlib, json, math, os
import numpy as np
SRC = "wiki/plans/2026-11-04-geva-262-g-family-admission-prereg/power.py"
ns = {"__name__": "power_parity", "__file__": os.path.abspath(SRC)}
exec(open(SRC).read(), ns)
out = {"source": SRC, "sha256": hashlib.sha256(open(SRC, "rb").read()).hexdigest(), "cases": []}
for n, k, eff, seed, sims in ((60, 3, 0.186, 11, 60), (48, 4, 0.10, 12, 60), (42, 4, 0.0, 13, 60), (24, 2, 0.30, 14, 40)):
    w = ns["World"](n, k, ns["SCENARIOS"]["screened U-pool"], 0.05, sims, seed)
    A, B = w.outcomes(eff) if eff else w.outcomes(0.0, "strict")
    for swap in (False, True):
        a, b = (B, A) if swap else (A, B)
        helps, hurts, ceil, z, se = ns["decide"](a, b, w.repo, w.sizes, k)
        S = np.zeros((a.shape[0], w.sizes.size), dtype=np.int64)
        np.add.at(S.T, w.repo, (b - a).T)
        pg = ns["p_dir"](S, np.abs(S.sum(axis=1)))
        rows = np.arange(sims)[:, None]
        ah, bh = a[rows, w.half], b[rows, w.half]
        mdd = 0.186 if n == 60 else 0.02
        # power.py's futility() formula on this half, unrolled per simulation
        fut = []
        for i in range(sims):
            g = ns["G_REPOS"]; nh = n // 2
            Sh = np.zeros(g); cnt = np.zeros(g)
            for j, t in enumerate(w.half[i]):
                Sh[w.repo[t]] += bh[i, j] - ah[i, j]; cnt[w.repo[t]] += 1
            dm = Sh.sum() / nh
            se_h = math.sqrt(g / (g - 1) * ((Sh - dm * cnt) ** 2).sum()) / nh / k
            t = 0.5
            zh = (dm / k) / se_h if se_h > 0 else 0.0
            dz = mdd / (se_h * math.sqrt(t)) if se_h > 0 else math.inf
            sq = math.sqrt(1 - t)
            cp_up = 1 - ns["phi"]((ns["ZC"] - zh * math.sqrt(t) - dz * (1 - t)) / sq)
            cp_dn = ns["phi"]((-ns["ZC"] - zh * math.sqrt(t) + dz * (1 - t)) / sq)
            fut.append({"half": [int(x) for x in w.half[i]], "z": zh, "cp_up": cp_up, "cp_dn": cp_dn, "stop": bool(cp_up < 0.10 and cp_dn < 0.10)})
        out["cases"].append({"n": n, "k": k, "eff": eff, "seed": seed, "swap": swap, "mdd": mdd, "repo": [int(x) for x in w.repo], "A": a.tolist(), "B": b.tolist(),
                             "helps": helps.tolist(), "hurts": hurts.tolist(), "ceiling": ceil.tolist(), "z": [float(x) for x in z], "se": [float(x) for x in se],
                             "p_dir": [float(x) for x in pg], "futility": fut})
json.dump(out, open("tests/stats/fixtures/g-power-parity.json", "w"), separators=(",", ":"))
print(sum(len(c["helps"]) for c in out["cases"]), "simulations;", sum(sum(c["helps"]) for c in out["cases"]), "helps;", sum(sum(c["hurts"]) for c in out["cases"]), "hurts;", sum(f["stop"] for c in out["cases"] for f in c["futility"]), "futility stops")
