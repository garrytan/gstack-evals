#!/usr/bin/env python3
# sets.py: B1e's two task sets, from committed files and the task titles. The pool is B1d's held-out pool: B1's screened
# scored tasks (hm-screened.txt in B1's bundle, 200 tasks, each run on this rig in the harness mechanics eval) minus every
# task whose repository (case-folded owner/name, from quick/laneb/tasks/swerebench-r3a4.json) is the repository of one of
# B1's 62 tasks (tasks.txt in B1's bundle). A task is feature-titled when the first non-empty line of its instruction, with
# any leading '#' removed, starts with a feature word (FEAT) and holds no bug word (BUG).
#
#   primary: the pool minus its feature-titled tasks.
#   non-fit: every feature-titled task of swerebench-r3a4 outside B1's 62 tasks, the primary set and the two pilot tasks.
#   extension: the candidates are every task of swerebench-r3a4 that is not feature-titled, passed its oracle preflight (L1's
#     screen.txt and eligible.txt, the 346 kept) and is outside B1's 62 tasks, the two pilot tasks and the primary set. The
#     extension takes every candidate outside B1's repositories, then fills to 81 with candidates inside B1's repositories
#     that B1's screen scored, in the seeded order. reserve: the rest of those scored candidates, in the seeded order.
#   supply: the pilot's supply sample, drawn after the extension from tasks that never ran on this rig (not in hm-screened):
#     8 extension tasks, then 2 non-fit tasks, each dealt to one arm (ARMS below).
#
#   python3 sets.py <harbor export dir> <out dir>
#
# The export dir holds one folder per task with its instruction.md (Harbor's swe-rebench-leaderboard export, the files the
# rig sends). The script writes primary.txt, nonfit.txt and extension.txt (sorted, one task a line, with a final newline),
# reserve.txt (in the seeded order) and supply.txt (task, arm and set, tab-separated, in draw order) to the out dir, and
# prints each list's counts and sha256, and every task whose class the 2026-11-21 bug words ("don't", "do not") change.
import hashlib, json, os, random, re, sys
NL = chr(10)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..', '..')
B1 = os.path.join(ROOT, 'wiki', 'plans', '2026-11-17-geva-547-delivery-route-prereg')
L1 = os.path.join(ROOT, 'wiki', 'plans', '2026-11-03-geva-254-l1-overhaul-prereg-2000')
SEED = 20261121
ARMS = (['own', 'hook', 'long', 'required', 'hook', 'long', 'required', 'hook'], ['long', 'required'])
h = lambda xs: hashlib.sha256((NL.join(xs) + NL).encode()).hexdigest()
def pinned(name, want, d=B1):
    raw = open(os.path.join(d, name), 'rb').read()
    assert hashlib.sha256(raw).hexdigest() == want, name + ' is not the file B1 committed'
    return [l.split() for l in raw.decode().splitlines() if l.strip()]
screened = pinned('hm-screened.txt', 'ef74c5c64f6fe50d0d462af450ef65a082476b3d250df8e576de5e337f0cf886')
b1 = [t for _, t in pinned('tasks.txt', 'b116edf386ad9400db88173e0b3f58144ff4153c1664bca64d01be4aca6227b1')]
kept = {l[0] for f, d in (('screen.txt', '17fcf1e9efc0b28f4fe14a6c169779b3b23ddc996cf30b543c621b59192c1c12'), ('eligible.txt', '5ad97d8f64189819d0893befe644e4b6173919255beee501f59810052ce8d5a5')) for l in pinned(f, d, L1)}
repo = {t['task_id']: t['repo'].lower() for t in json.load(open(os.path.join(ROOT, 'quick', 'laneb', 'tasks', 'swerebench-r3a4.json')))['tasks']}
PILOT = ['aallan__vera-662_interface', 'imperialcollegelondon__pyrealm-593']
OLD_BUG = r"bug|error|errors|fail|fails|failing|failure|crash|crashes|wrong|incorrect|broken|exception|traceback|regression|fix|fixes|doesn't|does not|not working|issue with|unexpected|raises|invalid"
BUG = re.compile(r"\b(" + OLD_BUG.replace("does not", "does not|don't|do not") + r")\b", re.I)
OLD = re.compile(r"\b(" + OLD_BUG + r")\b", re.I)
FEAT = re.compile(r"^(\[?feature( request)?\]?|feat(\(.*\))?:|enhancement|add|adds|adding|support|allow|implement|introduce|provide|expose|new)\b", re.I)
if len(sys.argv) != 3:
    sys.exit('usage: sets.py <harbor export dir> <out dir>')
ex, out = sys.argv[1], sys.argv[2]
def first(t):
    for l in open(os.path.join(ex, t, 'instruction.md'), encoding='utf-8').read().splitlines():
        l = l.strip().lstrip('#').strip()
        if l:
            return l
    return ''
feature = lambda t, bug=BUG: bool(FEAT.search(first(t))) and not bug.search(first(t))
b1_repos = {repo[t] for t in b1}
assert len(b1) == 62 and all(os.path.exists(os.path.join(ex, t, 'instruction.md')) for t in repo), 'the export is not every swerebench-r3a4 task'
pool = sorted(t for k, t in screened if k == 'scored' and repo[t] not in b1_repos)
primary = [t for t in pool if not feature(t)]
nonfit = sorted(t for t in repo if t not in b1 and t not in PILOT and t not in primary and feature(t))
changed = sorted(t for t in repo if feature(t) != feature(t, OLD))
ran = {t for _, t in screened}
scored = {t for k, t in screened if k == 'scored'}
cand = sorted(t for t in repo if t in kept and not feature(t) and t not in b1 and t not in PILOT and t not in primary)
outside = [t for t in cand if repo[t] not in b1_repos]
inside = [t for t in cand if repo[t] in b1_repos and t in scored]
rng = random.Random(SEED)
rng.shuffle(inside)
extension = sorted(outside + inside[:81 - len(outside)])
reserve = inside[81 - len(outside):]
supply = [(t, a, 'primary') for t, a in zip(rng.sample([t for t in extension if t not in ran], 8), ARMS[0])] + [(t, a, 'nonfit') for t, a in zip(rng.sample([t for t in nonfit if t not in ran], 2), ARMS[1])]
assert len(kept) == 346 and len(extension) == 81 and not set(extension) & set(nonfit)
for name, xs in (('primary', primary), ('nonfit', nonfit), ('extension', extension), ('reserve', reserve), ('supply', ['\t'.join(x) for x in supply])):
    open(os.path.join(out, name + '.txt'), 'w').write(NL.join(xs) + NL)
print('pool', len(pool), 'tasks from', len({repo[t] for t in pool}), 'repositories, sorted sha256', h(pool))
print('primary', len(primary), 'tasks from', len({repo[t] for t in primary}), 'repositories, sorted sha256', h(primary), '(pool minus', len(pool) - len(primary), 'feature-titled)')
print('nonfit', len(nonfit), 'tasks from', len({repo[t] for t in nonfit}), 'repositories, sorted sha256', h(nonfit))
print('extension candidates', len(cand), '(not feature-titled, kept by the oracle preflight, outside B1, the pilot and primary):', len(outside), 'outside B1 repositories,', len([t for t in cand if repo[t] in b1_repos]), 'inside, of which', len(inside), 'scored')
print('extension 81 tasks from', len({repo[t] for t in extension}), 'repositories, sorted sha256', h(extension), '(' + str(len(outside)), 'outside B1 repositories,', 81 - len(outside), 'drawn from inside with seed', str(SEED) + ')')
print('reserve', len(reserve), 'tasks in seeded order, sha256', h(reserve))
p = primary + extension
print('never ran on this rig: primary set', len([t for t in p if t not in ran]), 'of', len(p), '(all in the extension); non-fit', len([t for t in nonfit if t not in ran]), 'of', len(nonfit))
print('supply sample, sha256', h(['\t'.join(x) for x in supply]) + ':', ', '.join(t + ' on ' + a for t, a, _ in supply))
for t in changed:
    print('class changed by the added bug words:', t, 'feature' if feature(t, OLD) else 'not feature', '->', 'feature' if feature(t) else 'not feature', '|', first(t)[:100])
