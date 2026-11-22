#!/usr/bin/env python3
"""Rebuild the decision-routing eval's (P3) intervals from the per-task rows, with independent code.

Written by an independent claim-check team on 2026-11-12 from the preregistration's text (section 11 of
wiki/plans/2026-11-09-geva-411-decision-routing-prereg at commit 47d7964):
paired tasks graded in both cells; a bootstrap that resamples repository clusters with replacement;
10,000 draws; seed 20261111; the same clusters and seed for success, bill and time. Nothing here is taken
from the scorer's ratio.ts or paired.ts. Our random stream (numpy PCG64) differs from the scorer's
seededRandom, so bounds can only agree to Monte Carlo precision.

Design choices the prereg text leaves open, stated here:
- Each draw resamples K clusters with replacement, K = the number of clusters among that contrast's paired
  tasks, and pools their tasks. The statistic on a draw is computed exactly as the point estimate:
  success = 100 * mean(treatment - control) over pooled pairs; bill ratio = sum(treatment bill) /
  sum(control bill); time ratio = sum(treatment time) / sum(control time); cut = 1 - bill ratio.
- Percentile interval: the floor(0.025 B)-th and (ceil(0.975 B) - 1)-th sorted draws (0-based), B = 10,000.
- One resample per (contrast, mapping, seed), shared by success, bill and time.

Run from any folder outside this one: uv run --with numpy python3 <this folder>/rebuild.py
INPUTS defaults to this folder and EVALS to the gstack-evals checkout that holds it (full history, so that
commits a2272688 and 47d7964 resolve).
"""
import csv, hashlib, json, math, os, re, statistics, subprocess, sys
from collections import defaultdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
INPUTS = os.environ.get('INPUTS', HERE)
EVALS = os.environ.get('EVALS', os.path.join(HERE, '..', '..', '..'))
RES = 'a2272688a67988188e22c7a36eb097685f0b0862:wiki/research/2026-11-12-geva-501-decision-routing-results/'
PRE = '47d7964:wiki/plans/2026-11-09-geva-411-decision-routing-prereg/'
B = 10000
SEED, SEED2 = 20261111, 20261112
SPREAD_SEEDS = list(range(1, 21))

def show(ref):
    return subprocess.run(['git', '-C', EVALS, 'show', ref], check=True, capture_output=True, text=True).stdout

def h(title):
    print('\n' + '=' * 8 + ' ' + title + ' ' + '=' * 8)

# ---------------------------------------------------------------- 1. checksums
h('1. SHA256SUMS')
ok = True
for line in open(os.path.join(INPUTS, 'SHA256SUMS')):
    want, name = line.split()
    got = hashlib.sha256(open(os.path.join(INPUTS, name), 'rb').read()).hexdigest()
    print(('OK  ' if got == want else 'BAD ') + name + ' ' + got)
    ok &= got == want
print('all checksums match' if ok else 'CHECKSUM MISMATCH')
if not ok:
    sys.exit(1)

# ---------------------------------------------------------------- 2. rows and cluster maps
h('2. rows and cluster mappings')
rows = {}
meta = {}
for f in ('opus', 'sol', 'particle'):
    for r in csv.DictReader(open(os.path.join(INPUTS, f + '.csv'))):
        meta[r['task_id']] = (r['repository'], r['bootstrap_cluster'])
        if r['status'] == 'graded':
            rows[(r['model'], r['cell'], r['task_id'])] = (int(r['success']), float(r['bill_micros']) / 1e6, float(r['wall_time_s']))
print('graded rows', len(rows), 'tasks', len(meta))

pool = {t['task_id']: t['repo'] for t in json.loads(show('47d7964:quick/laneb/tasks/swerebench-r3a4.json'))['tasks']}
scored = show(PRE + 'scored.txt').split()
subset = set(show(PRE + 'subset.txt').split())
print('scored.txt', len(scored), 'subset.txt', len(subset), 'tasks in CSVs not in scored.txt', len(set(meta) - set(scored)))
bad_repo = [t for t in meta if meta[t][0] != pool[t]]
print('CSV repository column differs from the pool file repo field on', len(bad_repo), 'tasks')

def parse_id(t):
    m = re.match(r'^(.+?)__(.+)-(\d+)(_[A-Za-z]+)?$', t)
    return m.group(1) + '/' + m.group(2)
bad_bc = [t for t in meta if parse_id(t) != meta[t][1]]
print('bootstrap_cluster differs from owner/name parsed from task_id (case kept) on', len(bad_bc), 'tasks', bad_bc[:5])

MERGE_184 = {'jmcgeheeiv/pyfakefs': 'pytest-dev/pyfakefs'}
maps = {
    '186': {t: meta[t][1] for t in meta},
    '185': {t: pool[t].lower() for t in meta},
}
maps['184'] = {t: MERGE_184.get(c, c) for t, c in maps['185'].items()}
print('draw rule (case-folded pool repo) over scored.txt:', len({pool[t].lower() for t in scored}), 'repositories; draw.txt says 185')
paired = sorted(t for t in scored if ('opus', 'N', t) in rows and ('opus', 'R', t) in rows)
for k, m in maps.items():
    sizes = defaultdict(int)
    for t in paired:
        sizes[m[t]] += 1
    print('mapping %s: %d clusters over all 280, %d over the %d paired tasks, largest cluster %d tasks' % (
        k, len({m[t] for t in scored}), len(sizes), len(paired), max(sizes.values())))
print('repository column as written (no case-fold):', len({meta[t][0] for t in scored}), 'groups over 280')

h('5. where 186 and 185 differ (claimed: MontePy alone)')
by185 = defaultdict(set)
for t in scored:
    by185[maps['185'][t]].add(maps['186'][t])
for g, cs in sorted(by185.items()):
    if len(cs) > 1:
        ts = sorted(t for t in scored if maps['185'][t] == g)
        print('draw group %s holds %d scorer clusters %s: %s' % (g, len(cs), sorted(cs), ts))
print('pyfakefs tasks:', {t: (pool[t], maps['186'][t]) for t in scored if 'pyfakefs' in t})
splits = sum(len(cs) - 1 for cs in by185.values())
print('scorer clusters minus draw groups:', splits)

# ---------------------------------------------------------------- printed values
CUTS_PRIMARY = {}
def parse_table(text):
    out = []
    pat = re.compile(r'^\| (.+?) \| (\d+) \((\d+) repos\) \| (\d+) vs (\d+) \| (-?[\d.]+) \((-?[\d.]+) to (-?[\d.]+)\); worse (\d+), better (\d+) \| ([\d.]+) \| \$([\d.]+) vs \$([\d.]+) \| ([\d.]+) \(([\d.]+) to ([\d.]+)\); median ([\d.]+) \| ([\d.]+) s vs ([\d.]+) s \| ([\d.]+) \(([\d.]+) to ([\d.]+)\) \|$')
    for line in text.splitlines():
        m = pat.match(line)
        if m:
            g = m.groups()
            out.append(dict(name=g[0], n=int(g[1]), repos=int(g[2]), pt=int(g[3]), pc=int(g[4]), succ=float(g[5]), slo=float(g[6]), shi=float(g[7]),
                            worse=int(g[8]), better=int(g[9]), mdd=float(g[10]), bt=float(g[11]), bc=float(g[12]), ratio=float(g[13]), rlo=float(g[14]), rhi=float(g[15]),
                            med=float(g[16]), tt=float(g[17]), tc=float(g[18]), time=float(g[19]), tlo=float(g[20]), thi=float(g[21])))
    return out

s6 = show(RES + 's6.txt')
cached = s6.split('## the same contrasts at the dated (cached) prices')[1]
printed = [dict(d, src='s6.txt cached') for d in parse_table(cached)]
printed += [dict(d, src='contrasts.txt') for d in parse_table(show(RES + 'contrasts.txt'))]
score = show(RES + 'score.txt')
print('\nparsed printed rows:', len(printed))

def contrast_def(name):
    n = re.sub(r'^(cached|S1|S2|S8) ', '', name)
    sub = 'subset' in n
    n = re.sub(r' \(.*\)$', '', n).replace(' on the subset', '')
    a = n.split()
    if a[0] == 'W':
        return ('particle', 'W'), (a[2], a[3]), True
    return (a[0], a[1]), (a[0], a[3]), sub or a[1] in 'FJ' or a[3] in 'FJ'

def pairs_of(t, c, sub):
    ts = [x for x in scored if (t + (x,)) in rows and (c + (x,)) in rows and (not sub or x in subset)]
    T = np.array([rows[t + (x,)] for x in ts]); C = np.array([rows[c + (x,)] for x in ts])
    return ts, T, C

# ---------------------------------------------------------------- 3. point estimates
h('3. point estimates against the printed rows (every field at printed precision)')
def r1(x, d):
    return round(x + 1e-12, d)
mism = 0
for p in printed:
    t, c, sub = contrast_def(p['name'])
    ts, T, C = pairs_of(t, c, sub)
    n = len(ts)
    d = T[:, 0] - C[:, 0]
    got = dict(n=n, repos=len({maps['186'][x] for x in ts}), pt=int(T[:, 0].sum()), pc=int(C[:, 0].sum()), succ=r1(100 * d.mean(), 1),
               worse=int((d < 0).sum()), better=int((d > 0).sum()), mdd=r1(2.80 * math.sqrt((d != 0).sum() / n / n) * 100, 1),
               bt=r1(T[:, 1].mean(), 3), bc=r1(C[:, 1].mean(), 3), ratio=r1(T[:, 1].sum() / C[:, 1].sum(), 3),
               med=r1(statistics.median([a / b for a, b in zip(T[:, 1], C[:, 1]) if b > 0]), 3),
               tt=r1(T[:, 2].mean(), 1), tc=r1(C[:, 2].mean(), 1), time=r1(T[:, 2].sum() / C[:, 2].sum(), 3))
    diffs = [k for k in got if abs(got[k] - p[k]) > 1e-9]
    mism += len(diffs)
    print('%-58s %-14s n %d, %s' % (p['name'], p['src'], n, 'all fields equal' if not diffs else 'DIFF ' + ', '.join('%s %s vs printed %s' % (k, got[k], p[k]) for k in diffs)))
print('fields that differ:', mism)
cell_means = {}
for m in re.finditer(r'^\| (opus|sol|particle) (\w) \| (\d+) \| \$([\d.]+) \|', s6, re.M):
    vals = [v[1] for k, v in rows.items() if k[0] == m.group(1) and k[1] == m.group(2)]
    print('s6 cell %s %s: graded %d (printed %s), mean bill $%.4f (printed $%s)' % (m.group(1), m.group(2), len(vals), m.group(3), np.mean(vals), m.group(4)))

# ---------------------------------------------------------------- bootstrap
def boot(T, C, cl, seed):
    keys = sorted(set(cl))
    idx = np.array([keys.index(k) for k in cl])
    K = len(keys)
    S = np.zeros((K, 6))
    np.add.at(S, idx, np.column_stack([np.ones(len(cl)), T[:, 0] - C[:, 0], T[:, 1], C[:, 1], T[:, 2], C[:, 2]]))
    rng = np.random.default_rng(seed)
    draw = rng.integers(0, K, size=(B, K))
    W = np.bincount((draw + np.arange(B)[:, None] * K).ravel(), minlength=B * K).reshape(B, K).astype(float)
    A = W @ S
    lo, hi = math.floor(0.025 * B), math.ceil(0.975 * B) - 1
    q = lambda v: (float(np.sort(v)[lo]), float(np.sort(v)[hi]))
    return dict(K=K, succ=q(100 * A[:, 1] / A[:, 0]), ratio=q(A[:, 2] / A[:, 3]), time=q(A[:, 4] / A[:, 5]))

# ---------------------------------------------------------------- expectation, stated before comparing
h('4. what agreement to expect (computed from the printed intervals, before any comparison)')
z = 1.959964
phi = math.exp(-z * z / 2) / math.sqrt(2 * math.pi)
k_mc = math.sqrt(0.025 * 0.975 / B) / phi
print('Monte Carlo SD of a 2.5%% or 97.5%% percentile bound from %d draws, if the bootstrap distribution is near normal with SD s: %.4f x s' % (B, k_mc))
print('Two independent streams then differ by SD %.4f x s; 95%% of differences fall within %.3f x s. Add printed rounding (half a unit in the last place).' % (math.sqrt(2) * k_mc, 1.96 * math.sqrt(2) * k_mc))
EXPECT = {}
for p in printed:
    for f, lo, hi, scale in (('succ', 'slo', 'shi', 1), ('ratio', 'rlo', 'rhi', 1), ('time', 'tlo', 'thi', 1)):
        s = (p[hi] - p[lo]) / (2 * z)
        EXPECT[(p['name'], f)] = 1.96 * math.sqrt(2) * k_mc * s
for p in printed[:6]:
    print('%-24s expect |ours - scorer| within: success %.3f points, bill ratio %.4f, time ratio %.4f (95%%, before rounding)' % (
        p['name'], EXPECT[(p['name'], 'succ')], EXPECT[(p['name'], 'ratio')], EXPECT[(p['name'], 'time')]))
print('Success bounds also move in lumps: one task flipping is 100/279 = 0.36 points, so a percentile can sit on a plateau and jump by a lump.')

# ---------------------------------------------------------------- rebuild
h('6. intervals: scorer (printed) against ours under 186, 185 and 184 clusters, seed 20261111 and a second seed 20261112')
RESULTS = []
for p in printed:
    t, c, sub = contrast_def(p['name'])
    ts, T, C = pairs_of(t, c, sub)
    rec = dict(name=p['name'], src=p['src'], printed=p, ours={})
    for k, m in maps.items():
        cl = [m[x] for x in ts]
        rec['ours'][k] = {s: boot(T, C, cl, s) for s in (SEED, SEED2)}
        rec['ours'][k]['spread'] = [boot(T, C, cl, s) for s in SPREAD_SEEDS] if not sub else None
    RESULTS.append(rec)
    pr = p
    print('\n%s (%s), %d pairs, scorer printed %d repos' % (p['name'], p['src'], len(ts), p['repos']))
    for f, lo, hi, fmt in (('succ', 'slo', 'shi', '%.1f'), ('ratio', 'rlo', 'rhi', '%.3f'), ('time', 'tlo', 'thi', '%.3f')):
        line = '  %-6s scorer (' + fmt + ', ' + fmt + ')'
        line = line % (f, pr[lo], pr[hi])
        for k in maps:
            for s in (SEED, SEED2):
                b = rec['ours'][k][s]
                line += ('   %s/%s K=%d (' + fmt + ', ' + fmt + ')') % (k, 'a' if s == SEED else 'b', b['K'], b[f][0], b[f][1])
        e = EXPECT[(p['name'], f)]
        b = rec['ours']['186'][SEED]
        dl, dh = b[f][0] - pr[lo], b[f][1] - pr[hi]
        line += ('   | 186a minus scorer: ' + fmt + ', ' + fmt + ' (expected within %.4f plus rounding)') % (dl, dh, e)
        print(line)

h('7. our own Monte Carlo spread over 20 further seeds (primary contrasts), SD of each bound')
for rec in RESULTS:
    if rec['ours']['186']['spread'] is None:
        continue
    out = []
    for f in ('succ', 'ratio', 'time'):
        for k in maps:
            v = np.array([b[f] for b in rec['ours'][k]['spread']])
            out.append('%s/%s lo %.4f hi %.4f' % (f, k, v[:, 0].std(ddof=1), v[:, 1].std(ddof=1)))
    print(rec['name'] + ': ' + '; '.join(out))

# ---------------------------------------------------------------- verdict bounds
h('8. verdict-deciding bounds under every mapping and seed')
def verdict_A(cut_lo, s_lo, s_hi):
    if cut_lo <= 0: return 'NO SAVING'
    if s_hi < 0 and s_lo <= -7.5: return 'TRADES SUCCESS FOR COST'
    if s_lo <= -7.5: return 'INCONCLUSIVE ON SUCCESS'
    if cut_lo >= 0.80: return 'HOLDS'
    return 'SAVES LESS'
def verdict_B(s_lo, s_hi, b_lo, b_hi, t_lo, t_hi):
    if s_hi < 0: return 'PARTICLE-1 ALONE IS BETTER'
    if s_lo <= -7.5: return 'INCONCLUSIVE'
    if s_lo > 0: return 'THE ROUTER EARNS ITS PLACE ON SUCCESS'
    if b_hi < 0.90 or t_hi < 0.90: return 'THE ROUTER EARNS ITS PLACE'
    return 'PARTICLE-1 ALONE IS ENOUGH'
for rec in RESULTS[:6]:
    name = rec['name']
    if ' R vs N' in name:
        for k in maps:
            for s in (SEED, SEED2):
                b = rec['ours'][k][s]
                cut_lo = 1 - b['ratio'][1]
                print('%-20s %s seed %d: cut lower bound %.1f%% (zero is the line), success (%.2f, %.2f) -> %s' % (name, k, s, 100 * cut_lo, b['succ'][0], b['succ'][1], verdict_A(cut_lo, *b['succ'])))
            v = np.array([1 - b['ratio'][1] for b in rec['ours'][k]['spread']])
            print('%-20s %s 20 seeds: cut lower bound ranges %.1f%% to %.1f%%' % (name, k, 100 * v.min(), 100 * v.max()))
    if ' R vs P' in name:
        for k in maps:
            for s in (SEED, SEED2):
                b = rec['ours'][k][s]
                print('%-20s %s seed %d: success (%.2f, %.2f), bill upper %.3f, time upper %.3f (0.90 is the line) -> %s' % (
                    name, k, s, b['succ'][0], b['succ'][1], b['ratio'][1], b['time'][1], verdict_B(*b['succ'], *b['ratio'], *b['time'])))
            sp = rec['ours'][k]['spread']
            su = np.array([b['succ'][1] for b in sp]); bu = np.array([b['ratio'][1] for b in sp]); tu = np.array([b['time'][1] for b in sp])
            vs = {verdict_B(*b['succ'], *b['ratio'], *b['time']) for b in sp}
            print('%-20s %s 20 seeds: success upper %.2f to %.2f, bill upper %.3f to %.3f, time upper %.3f to %.3f, verdicts %s' % (
                name, k, su.min(), su.max(), bu.min(), bu.max(), tu.min(), tu.max(), sorted(vs)))

h('9. no-cache repricing')
cols = next(csv.reader(open(os.path.join(INPUTS, 'opus.csv'))))
print('CSV columns:', cols)
print('The rows carry one bill per session at the cached (as billed) prices and no token counts by kind, so the bill with caching priced away cannot be computed from them. Not rebuilt.')

json.dump([dict(name=r['name'], src=r['src'], ours={k: {str(s): r['ours'][k][s] for s in (SEED, SEED2)} for k in maps}) for r in RESULTS],
          open(os.environ.get('JSON_OUT', 'rebuild.json'), 'w'), indent=1)


# ---------------------------------------------------------------- 10. are the gaps only Monte Carlo?
h('10. scorer against our seed-to-seed distribution, 50 seeds, 186 clusters (every printed contrast)')
SEEDS50 = [SEED] + list(range(101, 150))
zs = {'succ': [], 'ratio': [], 'time': []}
outside = []
seen = set()
for p in printed:
    t, c, sub = contrast_def(p['name'])
    if (t, c, sub) in seen:
        continue
    seen.add((t, c, sub))
    ts, T, C = pairs_of(t, c, sub)
    cl = [maps['186'][x] for x in ts]
    bs = [boot(T, C, cl, s) for s in SEEDS50]
    for f, lo, hi, dec in (('succ', 'slo', 'shi', 1), ('ratio', 'rlo', 'rhi', 3), ('time', 'tlo', 'thi', 3)):
        for j, key in ((0, lo), (1, hi)):
            v = np.array([b[f][j] for b in bs])
            sd = math.sqrt(v.var(ddof=1) + (0.5 * 10 ** -dec) ** 2 / 3)
            zval = (p[key] - v.mean()) / sd
            zs[f].append(zval)
            hits = int(sum(1 for x in v if abs(round(x + 1e-12, dec) - p[key]) < 1e-9))
            if abs(zval) > 2.0:
                outside.append('%s %s %s: scorer %s, ours mean %.4f sd %.4f (range %.4f to %.4f), z %.1f, seeds rounding to the scorer value %d of 50' % (
                    p['name'], f, 'lower' if j == 0 else 'upper', p[key], v.mean(), v.std(ddof=1), v.min(), v.max(), zval, hits))
for f, v in zs.items():
    v = np.array(v)
    print('%-5s %d bounds: mean z %.2f, SD of z %.2f, |z| > 2: %d, |z| > 3: %d (pure Monte Carlo predicts mean 0, SD 1, about %.1f above 2 and %.1f above 3)' % (
        f, len(v), v.mean(), v.std(ddof=1), (abs(v) > 2).sum(), (abs(v) > 3).sum(), 0.0455 * len(v), 0.0027 * len(v)))
print('unique contrasts:', len(seen))
print('bounds with |z| > 2:')
for o in outside:
    print('  ' + o)

# ---------------------------------------------------------------- 11. the closest call
h('11. Sol, router against particle-1 alone: how close the success upper bound is to zero')
ts, T, C = pairs_of(('sol', 'R'), ('sol', 'P'), False)
def succ_draws(T, C, cl, seed):
    keys = sorted(set(cl)); idx = np.array([keys.index(k) for k in cl]); K = len(keys)
    S = np.zeros((K, 2)); np.add.at(S, idx, np.column_stack([np.ones(len(cl)), T[:, 0] - C[:, 0]]))
    draw = np.random.default_rng(seed).integers(0, K, size=(B, K))
    W = np.bincount((draw + np.arange(B)[:, None] * K).ravel(), minlength=B * K).reshape(B, K).astype(float)
    A = W @ S
    return 100 * A[:, 1] / A[:, 0]
d = T[:, 0] - C[:, 0]
print('discordant tasks: better (R passed, P failed)', [x for x, v in zip(ts, d) if v > 0], 'worse', int((d < 0).sum()))
for k, m in maps.items():
    cl = [m[x] for x in ts]
    for s in (SEED, SEED2):
        v = succ_draws(T, C, cl, s)
        print('mapping %s seed %d: draws at or above zero %.2f%%, strictly above zero %.2f%% (the upper bound drops below zero only when under 2.5%% are at or above it); the 97.5th-percentile draw is %.3f' % (
            k, s, 100 * (v >= 0).mean(), 100 * (v > 0).mean(), np.sort(v)[math.ceil(0.975 * B) - 1]))
print('Sensitivity, not a claim about the data: if one of the 2 better tasks had been a tie (better 1, worse 8):')
for j in [i for i, v in enumerate(d) if v > 0]:
    T2 = T.copy(); T2[j, 0] = C[j, 0]
    for k, m in maps.items():
        b = boot(T2, C, [m[x] for x in ts], SEED)
        print('  tie on %s, mapping %s: success %.2f (%.2f, %.2f) -> %s' % (ts[j], k, 100 * (T2[:, 0] - C[:, 0]).mean(), b['succ'][0], b['succ'][1],
              'upper below zero: PARTICLE-1 ALONE IS BETTER' if b['succ'][1] < 0 else 'upper at or above zero: verdict unchanged'))



# ---------------------------------------------------------------- 12. how much the mapping itself moves each bound
h('12. mapping effect: mean bound over 22 seeds (20261111, 20261112 and 1 to 20) under each mapping, primary contrasts')
for rec in RESULTS[:6]:
    out = []
    for f, dec in (('succ', 2), ('ratio', 4), ('time', 4)):
        m = {}
        for k in maps:
            bs = [rec['ours'][k][SEED], rec['ours'][k][SEED2]] + rec['ours'][k]['spread']
            m[k] = np.array([b[f] for b in bs]).mean(axis=0)
        fmt = '%.' + str(dec) + 'f'
        out.append(f + ' ' + ', '.join(('%s (' + fmt + ', ' + fmt + ')') % (k, m[k][0], m[k][1]) for k in maps))
    print(rec['name'] + ': ' + ' | '.join(out))

