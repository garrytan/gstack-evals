#!/usr/bin/env python3
# Plan v3 (GEVA-225): checks cost.py's optional-row rule both ways, then its house-central pick. Keyless.
# A design past the 20-point bound is rejected even inside 2 points; one under it is accepted; stand-in goes first.
import json, os, subprocess, sys
D = os.path.dirname(os.path.abspath(__file__))
ns = {"__file__": os.path.join(D, "cost.py")}
exec(open(os.path.join(D, "cost.py")).read().split("res = {}")[0], ns)
base = (None, (60, 54), 3, [18.6, 19.2], None)
env = dict(os.environ, MULT="5", P1RATIO="0.41", AUTH_EXTRA="1.2")
g = json.loads(subprocess.run([sys.executable, os.path.join(D, "cost.py")], env=env, capture_output=True, text=True, check=True).stdout)["G"]["chosen"]
checks = [
    ("MDD 20.4 within 2 points of 18.6 is rejected", ns["fits"]((None, (48, 42), 4, [20.4, 19.8], None), base) is False),
    ("MDD 19.2 within 2 points of 18.6 is accepted", ns["fits"]((None, (54, 42), 4, [19.2, 19.8], None), base) is True),
    ("house central G picks the stand-in alone on plan-eng-review", g["standin"] == [1, 0] and g["p1"] == [0, 0] and g["mdd"] == [19.2, 19.8]),
]
for name, ok in checks:
    print(("PASS " if ok else "FAIL ") + name)
sys.exit(0 if all(ok for _, ok in checks) else 1)
