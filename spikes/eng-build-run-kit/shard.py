#!/usr/bin/env python3
# eng-build kit: split specs.json into N shards by repository (no repository in two shards). Counts only.
import json, sys, collections
src, n = sys.argv[1], int(sys.argv[2])
specs = json.load(open(src))
by = collections.defaultdict(list)
for s in specs: by[s["spec"]["repo"]].append(s)
shards = [[] for _ in range(n)]
for repo, ss in sorted(by.items(), key=lambda kv: -len(kv[1])):
    min(shards, key=len).extend(ss)
for i, sh in enumerate(shards):
    json.dump(sh, open(src.replace(".json", "-s%d.json" % i), "w"), indent=1)
print(json.dumps([len(s) for s in shards]))
