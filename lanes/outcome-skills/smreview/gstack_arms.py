# Copyright (c) 2026 Garry Tan. MIT License.
# SR's two gstack arms (plan section 4), made as one commit each on gstack d74ee528 with fixed dates. G+ makes /review's
# State Machines specialist run on every review; G0 removes it. The patch touches three files and nothing else. Commit
# shas carry the committer's name, so the prereg pins each arm's tree sha as well; another machine reproduces the trees.
# Usage: python3 gstack_arms.py SRC DST   (SRC: a gstack checkout or URL with d74ee528; DST: a new clone path)
import os, subprocess, sys
BASE = 'd74ee528b6df9ddb945be2103a24544babe76e65'
FILES = ['scripts/resolvers/review-army.ts', 'review/sections/review-army.md', 'ship/sections/review-army.md']
OLD9 = '9. **State Machines** \u2014 if SCOPE_STATE_MACHINE is true or unknown: read '
SMALL_OLD = 'Skip all specialists except State Machines (item 9 decides it).'
LIST_OLD = 'an empty or State Machines-only specialist list'
src, dst = sys.argv[1], sys.argv[2]
def sh(*a): return subprocess.run(a, cwd=dst, check=True, capture_output=True, text=True).stdout.strip()
if not os.path.isdir(dst): subprocess.run(['git', 'clone', '-q', '--no-local', src, dst], check=True)
def gplus(t):
    assert t.count(OLD9) == 1
    return t.replace(OLD9, '9. **State Machines** \u2014 always, whatever SCOPE_STATE_MACHINE says: read ')
def g0(t):
    assert t.count(SMALL_OLD) == 1 and t.count(LIST_OLD) == 1
    lines = t.split('\n'); i = [k for k, l in enumerate(lines) if l.startswith(OLD9)]; assert len(i) == 1
    del lines[i[0]]
    return '\n'.join(lines).replace(SMALL_OLD, 'Skip all specialists.').replace(LIST_OLD, 'an empty specialist list')
def arm(branch, msg, edit):
    sh('git', 'checkout', '-q', '-f', '--detach', BASE)
    for f in FILES:
        p = os.path.join(dst, f); t = open(p, encoding='utf-8').read(); n = edit(t)
        assert n != t, (branch, f)
        open(p, 'w', encoding='utf-8').write(n)
    env = dict(os.environ, GIT_AUTHOR_DATE='2026-11-24T00:00:00Z', GIT_COMMITTER_DATE='2026-11-24T00:00:00Z')
    subprocess.run(['git', 'commit', '-q', '-am', msg], cwd=dst, check=True, env=env)
    sh('git', 'branch', '-f', branch, 'HEAD')
    return sh('git', 'rev-parse', 'HEAD'), sh('git', 'rev-parse', 'HEAD^{tree}')
for name, branch, msg, edit in [('G+', 'sr-gplus', 'SR arm G+: the State Machines specialist dispatched on every review', gplus),
                                ('G0', 'sr-g0', 'SR arm G0: the State Machines specialist removed', g0)]:
    c, t = arm(branch, msg, edit)
    print(name, 'commit', c, 'tree', t)
