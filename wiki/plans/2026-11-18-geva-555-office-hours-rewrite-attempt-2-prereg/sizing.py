#!/usr/bin/env python3
# sizing.py: the MDDs and decision shares for attempt 2's design (4 skins of founder slots: 24 matched pairs and 8
# unpaired founders in 32 opening clusters, one session a brief, arm and model, pooled over Opus 5.5 and GPT-6.1 Sol),
# and how section 5.5's projection stop behaves on simulated authoring runs (Part D).
# It runs the first attempt's power model (power.py) unchanged, from the file itself, as resize.py does.
# Run from this folder: uv run --with numpy==2.3.4 --with scipy==1.16.2 python sizing.py > sizing.txt
# (seeded; no key, no network)
import pathlib
import numpy as np

POWER = pathlib.Path(__file__).resolve().parent.parent / "2026-11-17-geva-552-office-hours-rewrite-prereg/power.py"
src = POWER.read_text()
exec(src[: src.index("rng = np.random.default_rng(SEED)")])

rng = np.random.default_rng(SEED)
ids, nclus = layout(4, 6, 2)
print("sizing.py, seed %d, %d simulated runs a point; power.py's model unchanged; layout: %d founder briefs in %d clusters" % (SEED, SIMS, len(ids), nclus))
print("Part A. new minus current: MDD at 80% power, two-sided 95% paired t interval over opening clusters")
for p0 in (0.25, 0.40, 0.55):
    for rho in (0.5, 0.843):
        print("p0 %.2f  rho %.3f  pooled MDD %s  one model MDD %s" % (p0, rho, mdd(p0, rho, ids, nclus, 1, 2, rng), mdd(p0, rho, ids, nclus, 1, 1, rng)), flush=True)
print("Part B. contrasts against no gstack as the control arm, rho 0.500")
for p0 in (0.05, 0.10, 0.20, 0.40):
    print("against none  p0 %.2f  pooled MDD %s  one model MDD %s" % (p0, mdd(p0, 0.5, ids, nclus, 1, 2, rng), mdd(p0, 0.5, ids, nclus, 1, 1, rng)), flush=True)
print("Part C. founder rows at p0 0.40: share of runs whose interval excludes zero, and whose rows read MERGE (estimate >= %.2f and lower bound > 0), rows 1 to 3 assumed to pass" % BAR)
for rho in (0.5, 0.843):
    row = []
    for d in (0.0, 0.10, 0.15, 0.20, 0.25):
        lo, hi, m = t_interval(cluster_diffs(0.40, rho, d, ids, nclus, 1, 2, rng))
        row.append("d %.2f excludes zero %.3f MERGE %.3f" % (d, (lo > 0).mean(), ((m >= BAR - 1e-12) & (lo > 0)).mean()))
    print("rho %.3f | %s" % (rho, " | ".join(row)), flush=True)

print("Part D. The projection stop (section 5.5): rates at the 0.95 quantile of their Jeffreys posterior; 2000 simulated authoring runs a row, sequential batches of 16, item cap $409, at most 30 second-twin draws a partner")
# Still to place in calibration and comparison (section 4): pairs by type, then unpaired kinds.
OPEN_PAIRS = {"T1": 4, "T2": 3, "T3": 3, "T4": 3, "T5": 4, "T6": 3}
OPEN_UNPAIRED = {"T7": 3, "T8": 5, "builder": 21}
# First attempt's final-path counts: first twins, settled partners matched within 30 draws by type (the two open T5
# partners left out), draws when matched (1, 1, 1, 2, 19 and 26), unpaired.
A1_FIRST = (10, 15)
A1_PARTNERS = {"T1": (0, 1), "T2": (1, 1), "T3": (1, 1), "T4": (1, 2), "T5": (1, 1), "T6": (2, 2)}
A1_D = (50, 6)
A1_UNPAIRED = {"T7": (2, 41), "T8": (0, 0), "builder": (5, 41)}
C1, C2, CU = 0.887, 0.093, 0.545
CAP, PAR, ALLOW, BATCH = 409.0, 8, 3.50, 16
BOUND, HARD = 30, 0.0095
from scipy import stats as S
jm = lambda k, n: S.beta.ppf(0.95, k + 0.5, n - k + 0.5)

def projection(first, partners, dsum, unpaired, open_pairs, open_unpaired, scale):
    f = jm(*first)
    d = dsum[0] / dsum[1]
    cost = 0.0
    for t, n in open_pairs.items():
        m = jm(*partners[t])
        cost += n * (C1 / f + m * d * C2 + (1 - m) * BOUND * C2) / m
    for u, n in open_unpaired.items():
        cost += n * CU / jm(*unpaired[u])
    return cost * scale

f0, m0, d0 = A1_FIRST[0] / A1_FIRST[1], sum(k for k, n in A1_PARTNERS.values()) / sum(n for k, n in A1_PARTNERS.values()), A1_D[0] / A1_D[1]
print("pair at the first attempt's counts with plain shares (first twins %d of %d, partners matched within %d draws %d of %d, %.2f draws when matched): $%.2f a pair" % (A1_FIRST[0], A1_FIRST[1], BOUND, sum(k for k, n in A1_PARTNERS.values()), sum(n for k, n in A1_PARTNERS.values()), d0, (C1 / f0 + m0 * d0 * C2 + (1 - m0) * BOUND * C2) / m0))
hard_cost = lambda b: (C1 / f0 + C2 * (1 - (1 - HARD) ** b) / HARD) / (1 - (1 - HARD) ** b)
print("pair of a type whose every partner matches at %.4f a draw: %.4f within %d draws, $%.2f a pair; the same formula gives $%.2f at 3 draws and $%.2f with no bound" % (HARD, 1 - (1 - HARD) ** BOUND, BOUND, hard_cost(BOUND), hard_cost(3), C1 / f0 + C2 / HARD))
a1_t8 = dict(A1_UNPAIRED, T8=A1_UNPAIRED["T7"])

def simulate(hard_types, sims, rng, stop=True):
    out = {"filled": 0, "projection": 0, "cap": 0}
    spend_end = []
    pilot = []
    for _ in range(sims):
        slots = [("pair", t) for t, n in OPEN_PAIRS.items() for _ in range(n)] + [("unpaired", u) for u, n in OPEN_UNPAIRED.items() for _ in range(n)]
        order = list(rng.permutation(len(slots)))
        st = [{"placed": False, "partner": None, "seconds": 0, "firsts": 0} for _ in slots]
        first = list(A1_FIRST); partners = {t: list(v) for t, v in A1_PARTNERS.items()}; dsum = list(A1_D)
        unpaired = {u: list(v) for u, v in A1_UNPAIRED.items()}
        spent = [0.0]; predicted = [0.0]
        def draft(i):
            kind, t = slots[i]; s = st[i]
            if kind == "unpaired":
                y = 0.122 if t == "builder" else 0.049
                spent[0] += CU; predicted[0] += CU
                ok = rng.random() < y
                unpaired[t][1] += 1; unpaired[t][0] += ok
                s["placed"] = ok
                return
            if s["partner"] is None:
                spent[0] += C1; predicted[0] += C1; s["firsts"] += 1
                ok = rng.random() < 0.667
                first[1] += 1; first[0] += ok
                if ok:
                    s["partner"] = HARD if (t in hard_types or rng.random() < 0.5) else 0.8
                    s["seconds"] = 0
                return
            spent[0] += C2; predicted[0] += C2; s["seconds"] += 1
            if rng.random() < s["partner"]:
                partners[t][0] += 1; partners[t][1] += 1; dsum[0] += s["seconds"]; dsum[1] += 1
                s["placed"] = True; s["partner"] = None
            elif s["seconds"] == BOUND:
                partners[t][1] += 1; s["partner"] = None
        def open_counts():
            op = {t: 0 for t in OPEN_PAIRS}; ou = {u: 0 for u in OPEN_UNPAIRED}
            for i, (kind, t) in enumerate(slots):
                if not st[i]["placed"]:
                    (op if kind == "pair" else ou)[t] += 1
            return op, ou
        # Pilot: the first two open slots of each pair type settle one partner each (at most 3 first twins a slot);
        # 8 drafts of each unpaired kind over its open slots.
        for t in OPEN_PAIRS:
            for i in [j for j in order if slots[j] == ("pair", t)][:2]:
                while not st[i]["placed"] and (st[i]["partner"] is not None or st[i]["firsts"] < 3):
                    before = st[i]["partner"]
                    draft(i)
                    if before is not None and st[i]["partner"] is None:
                        break
        for u in OPEN_UNPAIRED:
            made = 0
            while made < 8:
                cands = [j for j in order if slots[j] == ("unpaired", u) and not st[j]["placed"]]
                if not cands: break
                for j in cands:
                    if made >= 8: break
                    draft(j); made += 1
        pilot.append(spent[0])
        end = None
        while end is None:
            op, ou = open_counts()
            if not sum(op.values()) + sum(ou.values()):
                end = "filled"; break
            scale = spent[0] / predicted[0]
            if stop and projection(first, partners, dsum, unpaired, op, ou, scale) > CAP - spent[0] - PAR * ALLOW:
                end = "projection"; break
            size = min(BATCH, int((CAP - spent[0]) // ALLOW))
            if size <= 0:
                end = "cap"; break
            for j in [j for j in order if not st[j]["placed"]][:size]:
                draft(j)
        out[end] += 1
        spend_end.append((end, spent[0]))
    return out, spend_end, sum(pilot) / sims

pilots = []
for name, hard, stop in (("first attempt's rates, with the stop", (), True), ("first attempt's rates, no stop", (), False), ("T1 and T4 hard by type, with the stop", ("T1", "T4"), True), ("T1 and T4 hard by type, no stop", ("T1", "T4"), False)):
    out, se, pm = simulate(hard, 2000, rng, stop)
    pilots.append(pm)
    def mean(end): xs = [s for e, s in se if e == end]; return ("$%.0f" % (sum(xs) / len(xs))) if xs else "none"
    print("%-40s pilot $%.0f  filled %.3f (mean spend %s)  projection stop %.3f (%s)  cap stop before full %.3f (%s)" % (name, pm, out["filled"] / 2000, mean("filled"), out["projection"] / 2000, mean("projection"), out["cap"] / 2000, mean("cap")), flush=True)
print("projection at the first attempt's counts alone, T8 planned at T7's counts: $%.2f, against room after a $%.2f pilot (its mean at the first attempt's rates) of $%.2f" % (projection(A1_FIRST, A1_PARTNERS, A1_D, a1_t8, OPEN_PAIRS, OPEN_UNPAIRED, 1.0), pilots[0], CAP - pilots[0] - PAR * ALLOW))
