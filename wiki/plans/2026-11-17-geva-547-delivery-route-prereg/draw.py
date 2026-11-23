#!/usr/bin/env python3
# draw.py: B1's tasks. The pool is the harness mechanics eval's screened lists (hm-screened.txt beside this file, sha256
# ef74c5c6..., the file every Stage 4 part of that eval named as its screened input): 200 scored tasks, each run on this rig
# in that eval's Stage 4 in every arm and on all three models, and 40 calibration tasks. One seeded shuffle (seed
# 2104467713, minted from 4 random bytes on 2026-11-17 before any draw) of the sorted scored tasks, then the first 60 with at
# most one task per repository (case-folded owner/name) form the run. The smoke takes the first 2 calibration tasks, in the
# same seeded shuffle of the sorted calibration tasks, whose repositories are not in the run.
# Writes tasks.txt beside this file (run lines, then smoke lines) and prints the counts and each list's sorted sha256.
import hashlib, json, os, random
NL = chr(10)
HERE = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(HERE, '..', '..', '..', 'quick', 'laneb', 'tasks', 'swerebench-r3a4.json')
h = lambda xs: hashlib.sha256((NL.join(xs) + NL).encode()).hexdigest()
raw = open(os.path.join(HERE, 'hm-screened.txt'), 'rb').read()
assert hashlib.sha256(raw).hexdigest() == 'ef74c5c64f6fe50d0d462af450ef65a082476b3d250df8e576de5e337f0cf886'
lines = [l.split() for l in raw.decode().splitlines() if l.strip()]
scored = [t for k, t in lines if k == 'scored']
calibration = [t for k, t in lines if k == 'calibration']
assert len(scored) == 200 and len(calibration) == 40
repo = {t['task_id']: t['repo'].lower() for t in json.load(open(POOL))['tasks']}
SEED = 2104467713
order = sorted(scored)
random.Random(SEED).shuffle(order)
run, used = [], set()
for t in order:
    if len(run) < 60 and repo[t] not in used:
        run.append(t)
        used.add(repo[t])
assert len(run) == 60
cal = sorted(calibration)
random.Random(SEED).shuffle(cal)
smoke = [t for t in cal if repo[t] not in used][:2]
assert len(smoke) == 2 and len({repo[t] for t in smoke}) == 2
open(os.path.join(HERE, 'tasks.txt'), 'w').write(NL.join(['run ' + t for t in run] + ['smoke ' + t for t in smoke]) + NL)
print('pool scored', len(scored), 'repositories', len({repo[t] for t in scored}), 'sorted sha256', h(sorted(scored)))
print('pool calibration', len(calibration), 'sorted sha256', h(sorted(calibration)))
print('run', len(run), 'repositories', len({repo[t] for t in run}), 'sorted sha256', h(sorted(run)))
print('smoke', len(smoke), ' '.join(smoke))
