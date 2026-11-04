#!/usr/bin/env python3
# resize.py: the G family's lone-survivor re-size under M1 (GEVA-262, GST-1309), and the checks that it fits the
# $2,000 per-skill cap, the $1,700 plan line and the $10,000 program envelope. Keyless; needs only Python 3.
# It reuses plan v3's frozen price model (cost.py, survivor.py's alone()) and MDD grid (mdd-grid.json times 1.2)
# from the merged plan bundle, checked by sha256 before use, and changes none of their numbers.
# M1 replaces d7's order (particle-1, then trials, then tasks) for G only. The ladder is fixed, with no search:
#   rung 1: the survivor's both-alive size at the same prices (n0 x k0, from cost.py's frozen sizing);
#   rung 2: n0 x 4, when k0 is under 4 (trials added);
#   rung 3 on: k = 4 trials, tasks n0-6, n0-12, ... down to 24 (tasks traded for trials);
# the design is the first rung inside the $1,700 plan line whose MDD (plan v3's grid times 1.2) is at most the
# 20-point bound. If no rung qualifies, the survivor stops as FIX-METHOD (price). A particle-1 row would be dropped
# first; G's plan has none. Which skill survives: a skill that fails admission items 1 to 4 stops and the other
# re-sizes alone; if the both-alive re-size leaves a skill past the bound, that skill stops, and if both are past it,
# autoplan stops (plan v3's envelope trims it before plan-eng-review) and plan-eng-review re-sizes alone.
# Env (admission's metered inputs; defaults are plan v3's house central): MULT (Opus none session over a Verified
# session's $0.191), M_PER and M_AP (told session multiples of none for plan-eng-review and autoplan), AUTH_PAID
# (paid author and audit dollars per valid task), AUTH_EXTRA (crew dollars per valid task), YIELD_G (in-band yield).
import hashlib, json, os, sys
D = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(D, "..", "2026-11-03-geva-225-outcome-per-skill-plan")
PINS = {"cost.py": "1ce669d3bc1408b4ac232552030d01756c74e26713c16375317dedd3782785a8",
        "survivor.py": "64b05e7c5652a9f9549004eba218b6c11986e7b485094a4ad2906b40cbfc0624",
        "mdd-grid.json": "c15ea043bdf715ce227b962eeed9f9bf9edcbe87e0103118d9bd16c384878f15"}
for f, h in PINS.items():
    got = hashlib.sha256(open(os.path.join(P, f), "rb").read()).hexdigest()
    if got != h:
        sys.exit("plan v3 input %s changed: %s" % (f, got))

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
    if "YIELD_G" in env: ns["YIELD"]["G"] = float(env["YIELD_G"])
    return ns

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

def wave1(ns):
    t = 0
    for f in ns["FAM"]:
        b = ns["best"](f, (0, 0), (0, 0))
        t += sum(round(sum(c.values())) for c in b[4]) if b else 0
    return t

def run(name, env):
    ns = model(env)
    base = ns["best"]("G", (0, 0), (0, 0))
    print("== " + name)
    if base is None:
        print("no both-alive G design fits the $1,700 line: both skills stop at admission as FIX-METHOD (price)")
        return
    (n1, n2), k = base[1], base[2]
    tot = [round(sum(c.values())) for c in base[4]]
    w1 = wave1(ns)
    over = [s for s, m in zip(("plan-eng-review", "autoplan"), base[3]) if m > ns["BOUND"]]
    print("both alive: plan-eng-review %dx%d MDD %s $%d; autoplan %dx%d MDD %s $%d; wave 1 plans $%d at these prices" % (n1, k, base[3][0], tot[0], n2, k, base[3][1], tot[1], w1))
    if over:
        print("  past the 20-point bound with both alive: %s; %s stops at admission item 5 and plan-eng-review re-sizes alone" % (", ".join(over), "autoplan"))
    for s, other, n0 in (("plan-eng-review", "autoplan", n1), ("autoplan", "plan-eng-review", n2)):
        m1, old = ladder(ns, s, n0, k), d7(ns, s, n0, k)
        rungs = ", ".join("%dx%d $%d MDD %s" % t for t in m1["tried"])
        verdict = "stops, FIX-METHOD (price)" if m1["stops"] else "runs %dx%d, MDD %s, $%d, reserve $%d of its $%d cap" % (m1["n"], m1["k"], m1["mdd"], m1["price"], CAP - m1["price"], CAP)
        print("%s alone (%s stops at admission): M1 ladder [%s] -> %s; d7 would give %dx%d MDD %s (%s)" % (
            s, other, rungs, verdict, old["n"], old["k"], old["mdd"], "stops" if old["stops"] else "runs"))
        if not m1["stops"]:
            g_total = at_admission(ns, other) + m1["price"]
            total = w1 - tot[0] - tot[1] + g_total
            print("  envelope: %s settles about $%d at admission; G then plans $%d against $%d with both alive; wave 1 plans $%d of the $%d envelope (%s)" % (
                other, round(at_admission(ns, other)), round(g_total), tot[0] + tot[1], round(total), ENVELOPE, "fits" if total <= ENVELOPE else "OVER"))

if __name__ == "__main__":
    extra = {k: os.environ[k] for k in ("MULT", "M_PER", "M_AP", "AUTH_PAID", "AUTH_EXTRA", "YIELD_G", "TOLD_SCALE") if k in os.environ}
    if extra:
        run("metered inputs " + json.dumps(extra, sort_keys=True), dict({"P1RATIO": "0.41", "AUTH_EXTRA": "1.2"}, **extra))
    else:
        for name, env in CASES:
            run(name, env)
