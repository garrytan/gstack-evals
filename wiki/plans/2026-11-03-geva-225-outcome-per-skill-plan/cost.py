#!/usr/bin/env python3
# Plan v3 (GEVA-225) per-skill sizing under a $2,000 all-in ceiling. Keyless; reads mdd-grid.json beside it.
# Env: MULT (none session as a multiple of a Verified session), P1RATIO (particle-1 over Opus), AUTH_EXTRA
# (crew dollars per valid task), AGENT_USER (dollars per U tree), TOLD_SCALE (told multiples scaled, for forced).
import json, itertools, os
D = os.path.dirname(os.path.abspath(__file__))
G = json.load(open(os.path.join(D, "mdd-grid.json")))
DE = 1.2
def mdd(n, k, a):
    v = G.get("%d,%d,%s" % (n, k, a))
    return None if v is None else round(v * DE, 1)

V_NONE, V_TOLD, E0 = 0.191, 0.424, 0.236
M = float(os.environ.get("MULT", "2.5"))
P1 = float(os.environ.get("P1RATIO", str(0.019 / 0.236)))
NONE = V_NONE * M
VM = 0.02
STAND = 1.25
TSCALE = float(os.environ.get("TOLD_SCALE", "1"))
TOLD = {s: m * TSCALE for s, m in {"plan-eng-review": 2.2, "autoplan": 5.0, "plan-design-review": 2.4,
        "design-review": 3.0, "plan-devex-review": 2.4, "devex-review": 2.5}.items()}
MEAS = {"G": 0.05, "U": float(os.environ.get("AGENT_USER", "1.20")), "X": 0.40}
AX = float(os.environ.get("AUTH_EXTRA", "0"))
AUTH = {"G": 1.39 + AX, "U": 2.78 + AX, "X": 2.78 + AX}
SCR_T = {"G": 2.27, "U": 1.0, "X": 1.0}
SCR_MEAS = {"G": 0.0, "U": MEAS["U"], "X": 0.40}
YIELD = {"G": 0.30, "U": 0.40, "X": 0.40}
CREW = {"G": 100 + 150 + 70, "U": 100 + 200 + 70, "X": 100 + 150 + 70}
CALIB = {"G": 0.0, "U": 12 * 2 * 2 * MEAS["U"], "X": 12 * 2 * 2 * 0.40}
FAM = {"G": ["plan-eng-review", "autoplan"], "U": ["plan-design-review", "design-review"],
       "X": ["plan-devex-review", "devex-review"]}
CEIL, PLAN, SLICE = 2000.0, 1700.0, 12
NS = list(range(24, 121, 6))

def costs(f, n, k, st, p1):
    s = FAM[f]; me = MEAS[f]
    N = max(n)
    shared = {}
    shared["crew"] = CREW[f]
    cand = N / YIELD[f]
    shared["author"] = (cand + SLICE) * AUTH[f]
    shared["screen"] = cand * SCR_T[f] * (NONE + VM + SCR_MEAS[f])
    shared["calib"] = CALIB[f]
    shared["adm_none"] = SLICE * 2 * (NONE + VM + me)
    out = []
    lo = min(n)
    for i in range(2):
        c = {kk: v / 2 for kk, v in shared.items()}
        c["adm_told"] = SLICE * 2 * (NONE * TOLD[s[i]] + VM + me)
        none_tasks = lo / 2 + (n[i] - lo)
        c["conf_none"] = none_tasks * k * (NONE + VM + me)
        c["conf_told"] = n[i] * k * (NONE * TOLD[s[i]] + VM + me)
        c["conf_standin"] = n[i] * k * (NONE * STAND + VM + me) if st[i] else 0.0
        if p1[i]:
            both = p1[0] and p1[1]
            pl = min(n) if both else 0
            p_none_tasks = (pl / 2 + (n[i] - pl)) if both else n[i]
            c["p1_adm"] = SLICE * 2 * (NONE * P1 * (1 + TOLD[s[i]]) + 2 * (VM + me))
            c["p1_conf"] = p_none_tasks * k * (NONE * P1 + VM + me) + n[i] * k * (NONE * P1 * TOLD[s[i]] + VM + me)
        out.append(c)
    return out

def tm_mdd(n, k, st):
    return mdd(n, k, 0.025 if st else 0.05)

def best(f, st, p1):
    top = None
    for k in (2, 3, 4):
        for n1 in NS:
            for n2 in NS:
                n = (n1, n2)
                cs = costs(f, n, k, st, p1)
                if any(sum(c.values()) > PLAN for c in cs):
                    continue
                m = [tm_mdd(n[i], k, st[i]) for i in range(2)]
                if None in m:
                    continue
                key = (max(m), sum(m), -sum(n))
                if top is None or key < top[0]:
                    top = (key, n, k, m, cs)
    return top

res = {}
for f in FAM:
    base = best(f, (0, 0), (0, 0))
    if base is None:
        res[f] = None
        continue
    choice = ((0, 0), (0, 0), base)
    for st in itertools.product((0, 1), repeat=2):
        for p1 in itertools.product((0, 1), repeat=2):
            if st == (0, 0) and p1 == (0, 0):
                continue
            b = best(f, st, p1)
            if b is None:
                continue
            if all(b[3][i] <= base[3][i] + 2.0 for i in range(2)):
                adds = sum(st) + sum(p1)
                cur = sum(choice[0]) + sum(choice[1])
                if adds > cur or (adds == cur and b[0] < choice[2][0]):
                    choice = (st, p1, b)
    st, p1, b = choice
    res[f] = dict(base=dict(n=base[1], k=base[2], mdd=base[3], tot=[round(sum(c.values())) for c in base[4]],
                            parts=[{kk: round(v) for kk, v in c.items()} for c in base[4]]),
                  chosen=dict(standin=st, p1=p1, n=b[1], k=b[2], mdd=b[3],
                              tot=[round(sum(c.values())) for c in b[4]],
                              parts=[{kk: round(v) for kk, v in c.items()} for c in b[4]]))
print(json.dumps(res, indent=1))
