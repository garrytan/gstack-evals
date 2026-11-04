#!/usr/bin/env python3
# resize.py: the G family's lone-survivor re-size under M1 (GEVA-262, GST-1309), and the checks that it fits the
# $2,000 per-skill cap, the $1,700 plan line and the $10,000 program envelope. Keyless; needs only Python 3.
# It reuses plan v3's frozen price model (cost.py, survivor.py's alone()) and MDD grid (mdd-grid.json times 1.2)
# from the merged plan bundle, checked by sha256 before use, and changes none of their numbers.
# M1 replaces d7's order (particle-1, then trials, then tasks) for G only. The ladder is fixed, with no search:
#   rung 1: the survivor's plan v3 planned size priced alone (n0 x k0: 60 x 3 for plan-eng-review, 54 x 3 for autoplan);
#   rung 2: n0 x 4, when k0 is under 4 (trials added);
#   rung 3 on: k = 4 trials, tasks n0-6, n0-12, ... down to 24 (tasks traded for trials);
# the design is the first rung inside the $1,700 plan line whose MDD (plan v3's grid times 1.2) is at most the
# 20-point bound. If no rung qualifies, the survivor stops as FIX-METHOD (price). A particle-1 row would be dropped
# first; G's plan has none. Which skill survives: a skill that fails admission items 1 to 4 stops and the other
# re-sizes alone; if the both-alive re-size leaves one skill past the bound, that skill stops and the other re-sizes
# alone; if both are past it, or no both-alive design fits the plan line, plan-eng-review re-sizes alone first, then
# autoplan if plan-eng-review finds no rung, and both stop only if neither finds one (P1's order).
# Env (admission's metered inputs; with none set it prints plan v3's planning cases): MULT (required: Opus none
# session over a Verified session's $0.191), M_PER and M_AP (told session multiples of none for plan-eng-review and
# autoplan), AUTH_PAID (paid author and audit dollars per valid task), AUTH_EXTRA (crew dollars per valid task).
# Metered inputs price G only; U and X stay at plan v3's house central. YIELD_G (G's in-band yield is frozen at
# plan v3's) and TOLD_SCALE (a planning case, not a metered input) are refused.
import hashlib, json, os, sys
D = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(D, "..", "2026-11-03-geva-225-outcome-per-skill-plan")
PINS = {"cost.py": "1ce669d3bc1408b4ac232552030d01756c74e26713c16375317dedd3782785a8",
        "survivor.py": "64b05e7c5652a9f9549004eba218b6c11986e7b485094a4ad2906b40cbfc0624",
        "mdd-grid.json": "c15ea043bdf715ce227b962eeed9f9bf9edcbe87e0103118d9bd16c384878f15"}
for f, h in PINS.items():
    path = os.path.join(P, f)
    if not os.path.isfile(path):
        sys.exit("resize.py: plan v3 input missing: %s not found; fix: run resize.py from its folder in a gstack-evals checkout that holds plan v3 as merged at 5f13212" % path)
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if got != h:
        sys.exit("resize.py: plan v3 input changed: %s sha256 %s, pinned %s; fix: restore it from 5f13212, or change the pin only in a superseding prereg" % (f, got, h))

NUMERIC = ("MULT", "M_PER", "M_AP", "AUTH_PAID", "AUTH_EXTRA")
for k in ("YIELD_G", "TOLD_SCALE"):
    if k in os.environ:
        sys.exit("resize.py: refused input: %s is set; fix: unset it, because %s" % (k, "G's in-band yield is frozen at plan v3's" if k == "YIELD_G" else "it names a planning case, not a metered input"))
for k in NUMERIC:
    if k in os.environ:
        try:
            v = float(os.environ[k])
        except ValueError:
            v = float("nan")
        if not (v > 0 and v < 1000):
            sys.exit("resize.py: bad metered input: %s=%r is not a positive number; fix: pass the metered value from section 6, item 5" % (k, os.environ[k]))

def model(env):
    saved = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    ns = {"__file__": os.path.join(P, "survivor.py")}
    exec(open(os.path.join(P, "survivor.py")).read().split("out = {}")[0], ns)
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    if "M_PER" in env: ns["TOLD"]["plan-eng-review"] = float(env["M_PER"])
    if "M_AP" in env: ns["TOLD"]["autoplan"] = float(env["M_AP"])
    if "AUTH_PAID" in env: ns["AUTH"]["G"] = float(env["AUTH_PAID"]) + float(env.get("AUTH_EXTRA", "1.2"))
    return ns

PLANNED = {"plan-eng-review": (60, 3), "autoplan": (54, 3)}

def ladder(ns, s, n0, k0):
    rungs = [(n0, k0)] + ([(n0, 4)] if k0 < 4 else []) + [(n, 4) for n in range(n0 - 6, 23, -6)]
    tried = []
    for n, k in rungs:
        price, m = ns["alone"]("G", s, n, k), ns["mdd"](n, k, 0.05)
        tried.append((n, k, round(price), m))
        if price <= ns["PLAN"] and m is not None and m <= ns["BOUND"]:
            return dict(n=n, k=k, price=round(price), mdd=m, stops=False, tried=tried)
    return dict(n=None, k=None, price=None, mdd=None, stops=True, tried=tried)

def d7(ns, s, n, k):
    while ns["alone"]("G", s, n, k) > ns["PLAN"] and k > 2: k -= 1
    while ns["alone"]("G", s, n, k) > ns["PLAN"] and n > min(ns["NS"]): n -= 6
    fits = ns["alone"]("G", s, n, k) <= ns["PLAN"]
    m = ns["mdd"](n, k, 0.05) if fits else None
    return dict(n=n, k=k, mdd=m, stops=m is None or m > ns["BOUND"])

def at_admission(ns, s):
    # What a skill that stops at admission has settled by then: its half of the rig third, G's build, its prereg line,
    # the slice's authoring and admission's none arm, plus its own told admission (plan v3 section 8's parts).
    f, me = "G", ns["MEAS"]["G"]
    shared = ns["CREW"][f] + ns["SLICE"] * ns["AUTH"][f] + ns["SLICE"] * 2 * (ns["NONE"] + ns["VM"] + me)
    return shared / 2 + ns["SLICE"] * 2 * (ns["NONE"] * ns["TOLD"][s] + ns["VM"] + me)

CASES = [
    ("house central (plan v3)", {"MULT": "5", "P1RATIO": "0.41", "AUTH_EXTRA": "1.2"}),
    ("forced or exposed told, 1.15 times told", {"MULT": "5", "P1RATIO": "0.41", "AUTH_EXTRA": "1.2", "TOLD_SCALE": "1.15"}),
    ("forced or exposed told, 1.5 times told", {"MULT": "5", "P1RATIO": "0.41", "AUTH_EXTRA": "1.2", "TOLD_SCALE": "1.5"}),
    ("high, 10 times a Verified session", {"MULT": "10", "P1RATIO": "0.41", "AUTH_EXTRA": "1.2"}),
    ("crew line at TS's full rate", {"MULT": "5", "P1RATIO": "0.41", "AUTH_EXTRA": "6.2"}),
]
ENVELOPE, CAP = 10000, 2000

def wave1(ns, ref):
    t = 0
    for f in ns["FAM"]:
        b = (ns if f == "G" else ref)["best"](f, (0, 0), (0, 0))
        t += sum(round(sum(c.values())) for c in b[4]) if b else 0
    return t

def order(alone):
    if not alone["plan-eng-review"]["stops"]:
        return "autoplan stops at admission item 5 and plan-eng-review re-sizes alone"
    if not alone["autoplan"]["stops"]:
        return "plan-eng-review finds no alone design and stops; autoplan re-sizes alone"
    return "neither finds an alone design: both skills stop at admission as FIX-METHOD (price)"

def run(name, env, metered=False):
    ns = model(env)
    w1 = wave1(ns, model(dict(CASES[0][1])) if metered else ns)
    base = ns["best"]("G", (0, 0), (0, 0))
    alone = {s: ladder(ns, s, *PLANNED[s]) for s in PLANNED}
    print("== " + name)
    if base is None:
        print("no both-alive G design fits the $1,700 line: " + order(alone))
        sizes = PLANNED
    else:
        (n1, n2), k = base[1], base[2]
        tot = [round(sum(c.values())) for c in base[4]]
        sizes = {"plan-eng-review": (n1, k), "autoplan": (n2, k)}
        over = [s for s, m in zip(("plan-eng-review", "autoplan"), base[3]) if m > ns["BOUND"]]
        print("both alive: plan-eng-review %dx%d MDD %s $%d; autoplan %dx%d MDD %s $%d; wave 1 plans $%d at these prices" % (n1, k, base[3][0], tot[0], n2, k, base[3][1], tot[1], w1))
        if len(over) == 1:
            keep = "autoplan" if over[0] == "plan-eng-review" else "plan-eng-review"
            print("  past the 20-point bound with both alive: %s; %s stops at admission item 5 and %s re-sizes alone" % (over[0], over[0], keep))
        elif over:
            print("  past the 20-point bound with both alive: %s; %s" % (", ".join(over), order(alone)))
    for s, other in (("plan-eng-review", "autoplan"), ("autoplan", "plan-eng-review")):
        m1, old = alone[s], d7(ns, s, *sizes[s])
        rungs = ", ".join("%dx%d $%d MDD %s" % t for t in m1["tried"])
        verdict = "stops, FIX-METHOD (price)" if m1["stops"] else "runs %dx%d, MDD %s, $%d, reserve $%d of its $%d cap" % (m1["n"], m1["k"], m1["mdd"], m1["price"], CAP - m1["price"], CAP)
        print("%s alone (%s stops at admission): M1 ladder [%s] -> %s; d7 would give %dx%d MDD %s (%s)" % (
            s, other, rungs, verdict, old["n"], old["k"], old["mdd"], "stops" if old["stops"] else "runs"))
        if m1["stops"]:
            continue
        g_total = at_admission(ns, other) + m1["price"]
        if base is None:
            total = w1 + g_total
            print("  envelope: %s settles about $%d at admission; G then plans $%d with no both-alive design; wave 1 plans $%d of the $%d envelope (%s)" % (
                other, round(at_admission(ns, other)), round(g_total), round(total), ENVELOPE, "fits" if total <= ENVELOPE else "OVER"))
        else:
            total = w1 - tot[0] - tot[1] + g_total
            print("  envelope: %s settles about $%d at admission; G then plans $%d against $%d with both alive; wave 1 plans $%d of the $%d envelope (%s)" % (
                other, round(at_admission(ns, other)), round(g_total), tot[0] + tot[1], round(total), ENVELOPE, "fits" if total <= ENVELOPE else "OVER"))

if __name__ == "__main__":
    extra = {k: os.environ[k] for k in NUMERIC if k in os.environ}
    if extra and "MULT" not in extra:
        sys.exit("resize.py: bad metered input: MULT is missing; fix: pass none's metered mean session cost over $0.191 (section 6, item 5)")
    if extra:
        run("metered inputs " + json.dumps(extra, sort_keys=True), dict({"P1RATIO": "0.41", "AUTH_EXTRA": "1.2"}, **extra), metered=True)
    else:
        for name, env in CASES:
            run(name, env)
