#!/usr/bin/env python3
# eng-build run kit: full public clones for the units in the given sets. Prints counts only.
# usage: clone.py <ckpt units dir> <clones dir> [sets]
import json, os, subprocess, sys, time, glob
units, clones = sys.argv[1], sys.argv[2]
sets = set((sys.argv[3] if len(sys.argv) > 3 else "comparison,reserve,calibration").split(","))
repos = sorted({json.load(open(p))["repo"] for p in glob.glob(os.path.join(units, "*", "unit.json")) if json.load(open(p))["set"] in sets})
os.makedirs(clones, exist_ok=True)
env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
c = {"repos": len(repos), "cloned": 0, "present": 0, "failed": 0}
for r in repos:
    d = os.path.join(clones, r.replace("/", "__"))
    if os.path.isdir(os.path.join(d, ".git")) or os.path.isfile(os.path.join(d, "HEAD")):
        c["present"] += 1
        continue
    ok = False
    for i in range(4):
        p = subprocess.run(["git", "clone", "--quiet", "--no-checkout", "https://github.com/" + r + ".git", d], env=env, capture_output=True)
        if p.returncode == 0:
            ok = True
            break
        subprocess.run(["rm", "-rf", d])
        time.sleep(15 * (i + 1))
    c["cloned" if ok else "failed"] += 1
print(json.dumps(c))
