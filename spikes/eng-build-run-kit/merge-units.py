#!/usr/bin/env python3
# eng-build kit: merge the unit build shards. Admitted units move to <dst>/<id>; drops stay in their shard dirs.
# Labels files merge (disjoint repositories by construction). Prints counts only.
import json, os, sys, glob, shutil, collections
root, dst = "/dev/shm/eb525", "/dev/shm/eb525/units"
os.makedirs(dst, exist_ok=True)
admitted, labels, sets = [], {}, collections.Counter()
specs = {s["spec"]["id"]: s["spec"] for s in json.load(open(root + "/run/specs.json"))}
for sh in sorted(glob.glob(root + "/units-s*/units.json")):
    d = os.path.dirname(sh)
    for u in json.load(open(sh)):
        src = os.path.join(d, u["id"])
        if os.path.isdir(src): shutil.move(src, os.path.join(dst, u["id"]))
        admitted.append(u); sets[u["set"]] += 1
for lf in sorted(glob.glob(root + "/labels-s*.json")):
    for k, v in json.load(open(lf)).items():
        assert k not in labels or labels[k] == v
        labels[k] = v
json.dump(admitted, open(dst + "/units.json", "w"), indent=1)
json.dump(labels, open(root + "/labels.json", "w"), indent=2)
os.chmod(root + "/labels.json", 0o600)
cust = sorted(u["id"] for u in admitted if specs[u["id"]].get("custody"))
open(root + "/custody-ids.txt", "w").write(",".join(cust))
for s in ("comparison", "reserve", "calibration"):
    open(root + "/ids-" + s + ".txt", "w").write("\n".join(u["id"] for u in admitted if u["set"] == s) + "\n")
print(json.dumps({"admitted": len(admitted), "by_set": dict(sets), "copyleft_under_custody": len(cust), "repo_labels": len(labels)}))
