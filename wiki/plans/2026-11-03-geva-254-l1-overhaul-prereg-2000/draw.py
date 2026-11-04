#!/usr/bin/env python3
# draw.py: the L1 task draws (GEVA-254). screen.txt is R3 amendment 4's 200 screen tasks (sorted ids sha256 17fcf1e9...,
# as its run record prints). eligible.txt is R3 amendment 4's kept SWE-rebench pool less those 200; together the two files
# are the kept pool (346 ids, sha256 f06321599465c9be76dcb847a92ee41490be51c28ae3a4db8171b5fcdfd9c1d8).
# Twin rule: an eligible task whose repository name and number (the id after its owner) match a screen task's is the same
# upstream change under a moved owner, and it leaves the pool before any draw.
import hashlib, os, random
NL = chr(10)
HERE = os.path.dirname(os.path.abspath(__file__))
read = lambda f: open(os.path.join(HERE, f)).read().split()
h = lambda xs: hashlib.sha256((NL.join(xs) + NL).encode()).hexdigest()
key = lambda t: t.split('__', 1)[1]
screen, raw = read('screen.txt'), read('eligible.txt')
assert len(screen) == 200 and len(raw) == 146 and not set(screen) & set(raw)
assert h(sorted(set(screen) | set(raw))) == 'f06321599465c9be76dcb847a92ee41490be51c28ae3a4db8171b5fcdfd9c1d8'
twins = sorted(t for t in raw if key(t) in {key(s) for s in screen})
elig = sorted(t for t in raw if t not in twins)
assert len({key(t) for t in elig}) == len(elig)
f = sorted(random.Random(20261103).sample(elig, 80))
rest = sorted(set(elig) - set(f))
pilot = sorted(random.Random(20261104).sample(rest, 10))
smoke = sorted(random.Random(20261105).sample(pilot, 3))
order = list(f)
random.Random(20261106).shuffle(order)
parts = [sorted(order[i:i + 20]) for i in range(0, 80, 20)]
print('screen', len(screen), h(sorted(screen)))
print('twins dropped', len(twins), ' '.join(twins))
print('eligible', len(elig), h(elig))
print('F', len(f), h(f))
print('pilot pool (eligible less F)', len(rest), h(rest))
print('pilot', len(pilot), h(pilot))
print('smoke', len(smoke), h(smoke), ' '.join(smoke))
for i, part in enumerate(parts, 1): print('F1 part', i, len(part), h(part))
open(os.path.join(HERE, 'f-tasks.txt'), 'w').write(NL.join(f) + NL)
open(os.path.join(HERE, 'pilot-tasks.txt'), 'w').write(NL.join(pilot) + NL)
open(os.path.join(HERE, 'f-parts.txt'), 'w').write(''.join('%d %s%s' % (i, t, NL) for i, part in enumerate(parts, 1) for t in part))
