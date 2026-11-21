#!/usr/bin/env python3
# draw.py: B2's tasks. The pool is B1's copy of the harness mechanics eval's screened lists (hm-screened.txt beside this
# file, byte for byte B1's, sha256 ef74c5c6...): 200 scored SWE-rebench tasks and 40 calibration tasks, each run on this rig
# in that eval. B2 drops the scored tasks whose ids end in _interface (they ask for new code, not a fix), keeps the rest,
# and orders them by one seeded shuffle of the sorted list (seed 771515331, minted from 4 random bytes on 2026-11-21 before
# any draw). The first half (ceil(n/2) tasks) in that order is the interim look's half. The pilot takes the first 3
# calibration tasks, also without _interface, in the same seeded shuffle of the sorted calibration tasks.
# Writes tasks.txt beside this file (run lines in order, then pilot lines) and prints the counts and each list's sha256.
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
SEED = 771515331
run = sorted(t for t in scored if not t.endswith('_interface'))
random.Random(SEED).shuffle(run)
half = (len(run) + 1) // 2
cal = sorted(t for t in calibration if not t.endswith('_interface'))
random.Random(SEED).shuffle(cal)
pilot = cal[:3]
open(os.path.join(HERE, 'tasks.txt'), 'w').write(NL.join(['run ' + t for t in run] + ['pilot ' + t for t in pilot]) + NL)
print('pool scored', len(scored), 'interface dropped', len(scored) - len(run), 'sorted sha256', h(sorted(scored)))
print('run', len(run), 'repositories', len({repo[t] for t in run}), 'sorted sha256', h(sorted(run)), 'ordered sha256', h(run))
print('interim half: the first', half, 'tasks in run order, ordered sha256', h(run[:half]))
print('pilot', len(pilot), ' '.join(pilot))
