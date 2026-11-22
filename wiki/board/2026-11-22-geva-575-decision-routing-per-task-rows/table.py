import json, os, re, subprocess
R = json.load(open('rebuild.json'))
desk = ['cached opus R vs N','cached sol R vs N','cached opus R vs P','cached sol R vs P','cached opus P vs N','cached sol P vs N']
lab = {'R vs N':'Router against plain','R vs P':'Router against particle-1 alone','P vs N':'particle-1 alone against plain'}
HERE = os.path.dirname(os.path.abspath(__file__))
EVALS = os.environ.get('EVALS', os.path.join(HERE, '..', '..', '..'))
src = subprocess.run(['git', '-C', EVALS, 'show', 'a2272688a67988188e22c7a36eb097685f0b0862:wiki/research/2026-11-12-geva-501-decision-routing-results/s6.txt'], check=True, capture_output=True, text=True).stdout.split('## the same contrasts at the dated (cached) prices')[1]
pat = re.compile(r'^\| (cached \w+ \w vs \w) \| .*? \| .*? \| (-?[\d.]+) \((-?[\d.]+) to (-?[\d.]+)\);.*?\| ([\d.]+) \(([\d.]+) to ([\d.]+)\); median [\d.]+ \| .*? \| ([\d.]+) \(([\d.]+) to ([\d.]+)\) \|$', re.M)
pr = {m.group(1): m.groups()[1:] for m in pat.finditer(src)}
maxd = {}
out = ['| Comparison | Model | Measure | Scorer (186 groups) | Ours, 186 | Ours, 185 | Ours, 184 | Ours, 186, second seed | Verdict changes? |', '|---|---|---|---|---|---|---|---|---|']
def fmt(f, b):
    lo, hi = b
    if f == 'succ': return '%+.1f to %+.1f' % (lo, hi)
    if f == 'cut': return '%+.1f%% to %+.1f%%' % (100 * (lo - 1), 100 * (hi - 1))
    return '%.3f to %.3f' % (lo, hi)
for name in desk:
    rec = next(x for x in R if x['name'] == name)
    model = 'Opus 5.5' if ' opus ' in name else 'GPT-6.1 Sol'
    kind = name.split(' ', 2)[2]
    p = [float(x) for x in pr[name]]
    for f, sc in (('succ', (p[1], p[2])), ('ratio', (p[4], p[5])), ('time', (p[7], p[8]))):
        ff = 'cut' if (f == 'ratio' and kind != 'R vs P') else f
        mlabel = {'succ': 'Success, points', 'cut': 'Bill, change against control', 'ratio': 'Bill ratio', 'time': 'Time ratio'}[ff]
        cells = []
        for k, s in (('186', '20261111'), ('185', '20261111'), ('184', '20261111'), ('186', '20261112')):
            b = rec['ours'][k][s][f]
            cells.append(fmt(ff, b))
            for j in (0, 1):
                key = ('desk' if kind != 'P vs N' else 'pn', f)
                maxd[key] = max(maxd.get(key, 0), abs(b[j] - sc[j]))
        if kind == 'R vs N' and f == 'ratio':
            v = "No: the bill's lower end stays near +%s, far from the 0 line, so NO SAVING holds" % ('20%' if 'opus' in name else '9%')
        elif kind == 'R vs N' and f == 'succ':
            v = 'No: spans 0 under every mapping'
        elif kind == 'R vs N':
            v = 'No verdict reads it'
        elif kind == 'R vs P' and f == 'succ':
            v = 'No: lower end far above -7.5, upper end above 0 under every mapping' if 'opus' in name else 'No, but the closest call: upper end +0.34 to +0.36 in all 66 runs (3 mappings x 22 seeds), never below 0; prints +0.3 under 185 on the first seed'
        elif kind == 'R vs P':
            v = 'No: upper end stays above 0.90, so the router is not "%s"' % ('cheaper' if f == 'ratio' else 'faster')
        else:
            v = 'No verdict (context line)'
        out.append('| %s | %s | %s | %s | %s | %s |' % (lab[kind], model, mlabel, fmt(ff, sc), ' | '.join(cells), v))
print('\n'.join(out))
print()
print({str(k): round(v, 4) for k, v in maxd.items()})
