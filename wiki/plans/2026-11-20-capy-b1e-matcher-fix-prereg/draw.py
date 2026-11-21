#!/usr/bin/env python3
# draw.py: B1e's fresh 60 tasks. The pool is B1's screened scored tasks (hm-screened.txt in B1's bundle, sha256 ef74c5c6...,
# 200 tasks, each run on this rig in the harness mechanics eval) minus B1's 62 tasks (tasks.txt in B1's bundle, sha256
# b116edf3...) and minus B1d's 60 held-out tasks (heldout-list.txt in B1d's results, sha256 c12ff26d...), so no task any B1
# lane ran or published a route for is in it. None of its task ids appears anywhere in gstack's tree at the pin. The seed is
# 32 random bytes written as 64 lowercase hex characters, minted before the draw; SEED_SHA256 is the sha256 of those 64
# characters, committed and pushed before the draw ran. The draw shuffles the sorted pool with random.Random(int(seed, 16))
# and takes the first 60 tasks with at most two tasks per repository (case-folded owner/name, from
# quick/laneb/tasks/swerebench-r3a4.json).
#
#   python3 draw.py <seed file> <out file>
#
# The out file lists the 60 tasks in draw order, one a line. The script prints the pool's counts and sorted sha256, and the
# run's counts and the sha256 of its sorted list and of its draw-order list (each list one task a line, with a final newline).
import hashlib, json, os, random, sys
NL = chr(10)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..', '..')
B1 = os.path.join(ROOT, 'wiki', 'plans', '2026-11-17-geva-547-delivery-route-prereg')
B1D = os.path.join(ROOT, 'wiki', 'board', '2026-11-19-capy-b1d-hook-default-results')
SEED_SHA256 = '96e384f5350a8ae437c5a5e4288b82869356a0c4c4d0ed7f5e0637083c7051ac'
h = lambda xs: hashlib.sha256((NL.join(xs) + NL).encode()).hexdigest()
def pinned(path, want):
    raw = open(path, 'rb').read()
    assert hashlib.sha256(raw).hexdigest() == want, path + ' is not the committed file'
    return [l.split() for l in raw.decode().splitlines() if l.strip()]
screened = pinned(os.path.join(B1, 'hm-screened.txt'), 'ef74c5c64f6fe50d0d462af450ef65a082476b3d250df8e576de5e337f0cf886')
b1 = {t for _, t in pinned(os.path.join(B1, 'tasks.txt'), 'b116edf386ad9400db88173e0b3f58144ff4153c1664bca64d01be4aca6227b1')}
ho = {t for (t,) in pinned(os.path.join(B1D, 'heldout-list.txt'), 'c12ff26d9fd21cd7c8615e0615cd8d036763462a3808092da5c5882e56868cd5')}
repo = {t['task_id']: t['repo'].lower() for t in json.load(open(os.path.join(ROOT, 'quick', 'laneb', 'tasks', 'swerebench-r3a4.json')))['tasks']}
assert len(b1) == 62 and len(ho) == 60
pool = sorted(t for k, t in screened if k == 'scored' and t not in b1 and t not in ho)
print('pool', len(pool), 'tasks from', len({repo[t] for t in pool}), 'repositories, sorted sha256', h(pool))
if len(sys.argv) != 3:
    sys.exit('usage: draw.py <seed file> <out file>')
seed = open(sys.argv[1]).read().strip()
assert len(seed) == 64 and all(c in '0123456789abcdef' for c in seed), 'the seed is not 64 lowercase hex characters'
assert hashlib.sha256(seed.encode()).hexdigest() == SEED_SHA256, 'the seed is not the one whose sha256 was committed'
order = list(pool)
random.Random(int(seed, 16)).shuffle(order)
run, used = [], {}
for t in order:
    if len(run) < 60 and used.get(repo[t], 0) < 2:
        run.append(t)
        used[repo[t]] = used.get(repo[t], 0) + 1
assert len(run) == 60
open(sys.argv[2], 'w').write(NL.join(run) + NL)
print('run', len(run), 'tasks from', len(used), 'repositories, sorted sha256', h(sorted(run)), 'draw-order sha256', h(run))
