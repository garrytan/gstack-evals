#!/usr/bin/env python3
# draw.py: B1d's held-out tasks. The pool is B1's screened scored tasks (hm-screened.txt in B1's bundle, sha256 ef74c5c6...,
# 200 tasks, each run on this rig in the harness mechanics eval) minus every task whose repository (case-folded owner/name,
# from quick/laneb/tasks/swerebench-r3a4.json) is the repository of one of B1's 62 tasks (tasks.txt in B1's bundle, sha256
# b116edf3...). The seed is 32 random bytes written as 64 lowercase hex characters, minted before the draw and kept outside
# this repository until both held-out arms finish; SEED_SHA256 is the sha256 of those 64 characters, committed before the
# draw ran. The draw shuffles the sorted pool with random.Random(int(seed, 16)) and takes the first 60 tasks with at most one
# task per repository.
#
#   python3 draw.py <seed file> <out file>
#
# The out file lists the 60 tasks in draw order, one a line, and stays outside this repository until both held-out arms
# finish. The script prints the pool's counts and sorted sha256, and the run's counts and the sha256 of its sorted list and of
# its draw-order list (each list one task a line, with a final newline). Only those printed lines are committed.
import hashlib, json, os, random, sys
NL = chr(10)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..', '..')
B1 = os.path.join(ROOT, 'wiki', 'plans', '2026-11-17-geva-547-delivery-route-prereg')
SEED_SHA256 = '47efaf1f6d41d69991d0b36a1f05f835a04a24467a8b69265618879a485d7255'
h = lambda xs: hashlib.sha256((NL.join(xs) + NL).encode()).hexdigest()
def pinned(name, want):
    raw = open(os.path.join(B1, name), 'rb').read()
    assert hashlib.sha256(raw).hexdigest() == want, name + ' is not the file B1 committed'
    return [l.split() for l in raw.decode().splitlines() if l.strip()]
screened = pinned('hm-screened.txt', 'ef74c5c64f6fe50d0d462af450ef65a082476b3d250df8e576de5e337f0cf886')
b1 = pinned('tasks.txt', 'b116edf386ad9400db88173e0b3f58144ff4153c1664bca64d01be4aca6227b1')
repo = {t['task_id']: t['repo'].lower() for t in json.load(open(os.path.join(ROOT, 'quick', 'laneb', 'tasks', 'swerebench-r3a4.json')))['tasks']}
b1_repos = {repo[t] for _, t in b1}
assert len(b1) == 62 and len(b1_repos) == 62
pool = sorted(t for k, t in screened if k == 'scored' and repo[t] not in b1_repos)
print('pool', len(pool), 'tasks from', len({repo[t] for t in pool}), 'repositories, sorted sha256', h(pool))
if len(sys.argv) != 3:
    sys.exit('usage: draw.py <seed file> <out file>')
seed = open(sys.argv[1]).read().strip()
assert len(seed) == 64 and all(c in '0123456789abcdef' for c in seed), 'the seed is not 64 lowercase hex characters'
assert hashlib.sha256(seed.encode()).hexdigest() == SEED_SHA256, 'the seed is not the one whose sha256 was committed'
order = list(pool)
random.Random(int(seed, 16)).shuffle(order)
run, used = [], set()
for t in order:
    if len(run) < 60 and repo[t] not in used:
        run.append(t)
        used.add(repo[t])
assert len(run) == 60
open(sys.argv[2], 'w').write(NL.join(run) + NL)
print('run', len(run), 'tasks from', len(used), 'repositories, sorted sha256', h(sorted(run)), 'draw-order sha256', h(run))
