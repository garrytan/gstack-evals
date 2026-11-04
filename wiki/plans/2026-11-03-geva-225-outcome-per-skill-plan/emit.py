#!/usr/bin/env python3
# Plan v3 (GEVA-225): per-skill dollar lines from cost.py's JSON, in wave 1's order. Keyless.
# Usage: python3 emit.py <cost.json> [base|chosen]. base is none and told only; chosen adds the 2-point rule's rows.
import json, os, sys
D = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(sys.argv[1]))
mode = sys.argv[2] if len(sys.argv) > 2 else "base"
G = json.load(open(os.path.join(D, "mdd-grid.json")))
order = [("plan-eng-review","G",0),("plan-devex-review","X",0),("autoplan","G",1),("devex-review","X",1),("plan-design-review","U",0),("design-review","U",1)]
tot = 0
for s,f,i in order:
    if d[f] is None:
        print("%s | %s | no design fits the plan" % (s, f))
        continue
    c = d[f][mode]; p = c["parts"][i]
    t = c["tot"][i]; tot += t
    conf = p["conf_none"] + p["conf_told"] + p["conf_standin"]
    pa = p.get("p1_adm",0) + p.get("p1_conf",0)
    adm = p["adm_none"] + p["adm_told"]
    line = "%s | %s | n %d x %d | MDD %.1f | planned %d | crew %d, authoring %d, screening %d, %sadmission %d, Opus confirmatory %d (none share %d, told %d%s)%s, reserve %d" % (
        s, f, c["n"][i], c["k"], c["mdd"][i], t, p["crew"], p["author"], p["screen"],
        ("calibration %d, " % p["calib"]) if p["calib"] else "", adm, conf, p["conf_none"], p["conf_told"],
        (", stand-in %d" % p["conf_standin"]) if p["conf_standin"] else "", (", particle-1 %d" % pa) if pa else "", 2000 - t)
    print(line)
print("wave1 planned", tot)
print("grid x1.2:")
for n,k in [(42,2),(48,2),(60,2),(42,4),(54,3),(60,3),(72,3),(78,3),(90,3),(84,4)]:
    a = G["%d,%d,0.05"%(n,k)]; b = G["%d,%d,0.025"%(n,k)]
    print(n,k, round(a*1.2,1), round(b*1.2,1))
