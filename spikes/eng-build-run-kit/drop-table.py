#!/usr/bin/env python3
# eng-build kit: drop table across the unit shards, by set and by first drop. Counts only.
import json, os, glob, collections
root = "/dev/shm/eb525"
specs = {s["spec"]["id"]: s["spec"] for s in json.load(open(root + "/run/specs.json"))}
where = {}
for d in glob.glob(root + "/units-s*/er-*") + glob.glob(root + "/units/er-*"):
    where[os.path.basename(d)] = d
crashed = set()
for f in glob.glob(root + "/crashed-s*.txt"):
    crashed |= set(open(f).read().split())
tab = collections.defaultdict(collections.Counter)
adm = collections.Counter(); eco_adm = collections.Counter(); type_adm = collections.Counter()
for sid, sp in specs.items():
    st = sp["set"]
    tab[st]["specs"] += 1
    d = where.get(sid)
    if d is None: tab[st]["not_reached"] += 1; continue
    a = os.path.join(d, "admission.json")
    if not os.path.exists(a): tab[st]["gate_crashed_then_cache_stale" if sid in crashed else "in_progress"] += 1; continue
    ad = json.load(open(a))
    drops = list(ad.get("drops") or []) + list(ad.get("gate") or [])
    if sid in crashed and not ad.get("qualifies") is False and not drops: pass
    if ad.get("qualifies") and not drops:
        tab[st]["admitted"] += 1; adm[st] += 1
        try:
            eb = json.load(open(os.path.join(d, "eb.json")))
            eco_adm["+".join(sorted({g["eco"] for g in eb["groups"]}))] += 1
        except Exception: pass
        type_adm[sp.get("type")] += 1
        continue
    first = [x for x in drops if not (x["code"] == "E_EB_TRANSPLANT")] or drops
    k = first[0]["code"].replace("E_EB_", "") + ":" + first[0]["cls"] if first else "unknown"
    if sid in crashed: k += " (gate crashed earlier)"
    tab[st][k] += 1
for st in ("comparison", "reserve", "calibration", "pilot"):
    if st in tab: print(st, json.dumps(dict(sorted(tab[st].items(), key=lambda kv: (-kv[1], kv[0])))))
print("admitted by eco", dict(eco_adm), "by type", dict(type_adm))
