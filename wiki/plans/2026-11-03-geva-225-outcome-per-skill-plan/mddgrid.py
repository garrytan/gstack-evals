#!/usr/bin/env python3
# Keyless MDD grid for plans v2 and v3 (GEVA-225). Reuses power.py's model unchanged; writes mdd-grid.json beside it.
import json, os
D = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(D, "power.py")).read().split("designs = ")[0]
ns = {}
exec(src, ns)
ns["SIMS"] = 3000
grid = {}
for k in (2, 3, 4):
    for n in range(24, 127, 6):
        for a in (0.05, 0.025):
            grid["%d,%d,%s" % (n, k, a)] = ns["mdd"](n, k, 0.15, a)
json.dump(grid, open(os.path.join(D, "mdd-grid.json"), "w"), indent=0)
print(len(grid), "points")
