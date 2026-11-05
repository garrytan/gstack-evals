#!/usr/bin/env python3
# split.py: the L1 TB2 twin's two parts (GEVA-294, L1 Amendment C). tb2-tasks.txt is the twin: the 40 tasks of Lane B's
# quick look 3 (quick/laneb/tasks/final.json at tag laneb-discovery-3-runner, the list #125 cites) less the three drops #125
# section 2 names (crack-7z-hash, adaptive-rejection-sampler, largest-eigenval), sorted. The order is shuffled with seed
# 20261107, the next date seed after draw.py's 20261106, and cut into part 1 (19 tasks) and part 2 (18).
import hashlib, os, random
NL = chr(10)
HERE = os.path.dirname(os.path.abspath(__file__))
h = lambda xs: hashlib.sha256((NL.join(xs) + NL).encode()).hexdigest()
twin = open(os.path.join(HERE, 'tb2-tasks.txt')).read().split()
assert len(twin) == 37 and twin == sorted(set(twin))
assert h(twin) == '582ba69f50ff8eb121fb87d622f3e3bc6a39310910d29f8ea3afdaa6eb9e53eb'
order = list(twin)
random.Random(20261107).shuffle(order)
parts = [sorted(order[:19]), sorted(order[19:])]
print('TB2 twin', len(twin), h(twin))
for i, part in enumerate(parts, 1): print('TB2 part', i, len(part), h(part))
open(os.path.join(HERE, 'tb2-parts.txt'), 'w').write(''.join('%d %s%s' % (i, t, NL) for i, part in enumerate(parts, 1) for t in part))
