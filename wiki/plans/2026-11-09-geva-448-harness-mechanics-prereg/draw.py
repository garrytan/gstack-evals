#!/usr/bin/env python3
# draw.py: the harness mechanics eval's task splits. The kept SWE-rebench pool is L1's two files (screen.txt plus
# eligible.txt in wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000, 346 ids, sha256 f0632159...). Twin rule (L1's):
# a task whose repository name and number (the id after its owner) match another task's is the same upstream change under
# a moved owner; only the first id in sorted order stays. Splits: one seeded shuffle (seed 20261148), then each task goes
# to scored (200), else calibration (40), else spare, with at most 4 tasks per repository (case-folded owner/name) in each
# split. A task that fits no split is stranded. The judge subset is the first 60 scored tasks in shuffled order and the
# judge pilot the first 12 calibration tasks.
# Writes the five lists beside this file and prints every count and each list's sorted sha256.
import collections, hashlib, json, os, random
NL = chr(10)
HERE = os.path.dirname(os.path.abspath(__file__))
L1 = os.path.join(HERE, '..', '2026-11-03-geva-254-l1-overhaul-prereg-2000')
POOL = os.path.join(HERE, '..', '..', '..', 'quick', 'laneb', 'tasks', 'swerebench-r3a4.json')
read = lambda f: open(f).read().split()
h = lambda xs: hashlib.sha256((NL.join(xs) + NL).encode()).hexdigest()
kept = sorted(set(read(os.path.join(L1, 'screen.txt'))) | set(read(os.path.join(L1, 'eligible.txt'))))
assert len(kept) == 346 and h(kept) == 'f06321599465c9be76dcb847a92ee41490be51c28ae3a4db8171b5fcdfd9c1d8'
repo = {t['task_id']: t['repo'].lower() for t in json.load(open(POOL))['tasks']}
key = lambda t: t.split('__', 1)[1]
seen, pool, twins = set(), [], []
for t in kept:
    (twins if key(t) in seen else pool).append(t)
    seen.add(key(t))
order = list(pool)
random.Random(20261148).shuffle(order)
CAP = 4
splits = {'scored': [], 'calibration': [], 'spare': []}
size = {'scored': 200, 'calibration': 40, 'spare': None}
per = {s: collections.Counter() for s in splits}
stranded = []
for t in order:
    for s in ('scored', 'calibration', 'spare'):
        if (size[s] is None or len(splits[s]) < size[s]) and per[s][repo[t]] < CAP:
            splits[s].append(t)
            per[s][repo[t]] += 1
            break
    else:
        stranded.append(t)
assert len(splits['scored']) == 200 and len(splits['calibration']) == 40
judge_subset, judge_pilot = splits['scored'][:60], splits['calibration'][:12]
out = {'scored.txt': splits['scored'], 'calibration.txt': splits['calibration'], 'spare.txt': splits['spare'],
       'judge-subset.txt': judge_subset, 'judge-pilot.txt': judge_pilot}
for f, xs in out.items():
    open(os.path.join(HERE, f), 'w').write(NL.join(xs) + NL)
print('kept', len(kept), h(kept))
print('twins dropped', len(twins), ' '.join(twins))
print('pool', len(pool), 'repositories', len(set(repo[t] for t in pool)))
for f, xs in out.items():
    print(f, len(xs), 'sorted sha256', h(sorted(xs)), 'repositories', len(set(repo[t] for t in xs)))
print('stranded', len(stranded), ' '.join(sorted(stranded)))
