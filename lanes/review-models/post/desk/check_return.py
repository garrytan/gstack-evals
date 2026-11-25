#!/usr/bin/env python3
# Copyright (c) 2026 Garry Tan. MIT License.
"""Checks one returned labels file against this package's items.json.
  python3 check_return.py <returned-file> [items.json]
The returned file may end in .json or .txt (labellers rename it so RentAHuman's upload form takes it).
Prints VERDICT: PASS | REDO | REJECT | ASK with reasons written for the labeller (REDO, REJECT) or for the package owner
(ASK), then a summary. Exit 0 on PASS, 1 otherwise. Thresholds live in items.json "checks"."""
import json, sys, os, collections, re
here = os.path.dirname(os.path.abspath(__file__))
path = sys.argv[1]
items = json.load(open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, 'items.json')))
C = items['checks']
def out(verdict, reasons, extra=None):
    print('VERDICT:', verdict); [print(' -', r) for r in reasons]
    if extra: print(json.dumps(extra, indent=1))
    sys.exit(0 if verdict == 'PASS' else 1)
raw = open(path, encoding='utf-8', errors='replace').read()
if raw.lstrip()[:15].lower().startswith(('<!doctype', '<html')):
    out('REDO', ['you sent the labelling page itself, not your answers. On the page, press "Download my labels", rename the downloaded file so it ends in .txt, and upload that file (or attach it in the chat)'])
try:
    S = json.loads(raw)
except Exception as e:
    out('REDO', [f'the file could not be read ({e.__class__.__name__}). Please press "Download my labels" again and send that file, renamed to end in .txt'])
if not isinstance(S, dict) or S.get('format') != items['format'] or S.get('package') != items['package'] or S.get('version') not in items['orders']:
    out('REDO', ['this is not a labels file from the page we sent you. Please press "Download my labels" on that page and send the file it saves, renamed to end in .txt'])
order = items['orders'][S['version']]
qs = [q for s in order for q in items['screens'][s]['questions']]
fixed = {c[0] for c in items['choices']}
def valid(q, c):
    if not isinstance(c, str): return False
    if 'findings' not in q: return c in fixed
    if c in fixed: return True
    if not re.fullmatch(r'[0-9]+(,[0-9]+)*', c): return False
    ns = [int(x) for x in c.split(',')]
    return len(set(ns)) == len(ns) and all(1 <= n <= q['findings'] for n in ns)
L = S.get('labels') or {}
need_note = items.get('note_required', False)
def ok(q):
    e = L.get(q['id']) or {}
    return valid(q, e.get('choice')) and (not need_note or str(e.get('note') or '').strip())
missing = [i + 1 for i, s in enumerate(order) if not all(ok(q) for q in items['screens'][s]['questions'])]
if missing:
    out('REDO', [f'{len(missing)} screens are not finished (screen numbers {missing[:25]}{" ..." if len(missing) > 25 else ""}). Every screen needs an answer and a one-line reason. Use "Next unanswered" on the page to find them'])
choices = [L[q['id']]['choice'] for q in qs]
kind = lambda c: c if c in fixed else 'names'
cnt = collections.Counter(kind(c) for c in choices)
mins = (S.get('activeSeconds') or 0) / 60
n = len(order)
rep_pairs = []
for rs, os_ in items.get('repeats', {}).items():
    if rs in order:
        for qr, qo in zip(items['screens'][rs]['questions'], items['screens'][os_]['questions']):
            rep_pairs.append((L[qr['id']]['choice'], L[qo['id']]['choice']))
rep_diff = sum(a != b for a, b in rep_pairs)
att = {q: e for q, e in items.get('attention', {}).items() if q in L}
att_miss = sum(L[q]['choice'] != e for q, e in att.items())
screening = [q for q in items.get('screening', []) if q in att]
screen_miss = sum(L[q]['choice'] != att[q] for q in screening)
notes = [str(L[q['id']].get('note') or '').strip() for q in qs]
notes = [t for t in notes if t]
copied = len(notes) - len(set(notes))
foreign = sum(1 for t in notes if re.search(r'[^\x00-\x7f\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00a0\u00e9]', t) and len(re.findall(r'[a-zA-Z]', t)) < 0.6 * len(t))
summary = dict(labeller=S.get('labeller'), version=S['version'], screens=n, questions=len(qs), activeMinutes=round(mins), choices=dict(cnt),
               repeatsDisagreeing=f'{rep_diff} of {len(rep_pairs)}', attentionMissed=f'{att_miss} of {len(att)}', screeningMissed=f'{screen_miss} of {len(screening)}', copiedReasons=copied, notesNotEnglish=foreign)
reject, ask = [], []
if mins < C['reject_minutes']: reject.append(f'the page recorded {mins:.0f} minutes of work for {n} screens; careful reading takes at least about {C["ask_minutes"]} minutes')
if cnt.most_common(1)[0][1] >= 0.95 * len(qs): reject.append('almost every screen got the same answer')
if att and att_miss >= max(2, (len(att) + 1) // 2): reject.append(f'{att_miss} of the {len(att)} screens with one plain answer were marked another way')
if C['reject_minutes'] <= mins < C['ask_minutes']: ask.append(f'only {mins:.0f} active minutes recorded for {n} screens')
if rep_pairs and rep_diff > C.get('max_repeat_diff', 1): ask.append(f'{rep_diff} of {len(rep_pairs)} repeated screens got a different answer the second time')
if att and 1 <= att_miss < max(2, (len(att) + 1) // 2): ask.append(f'{att_miss} of {len(att)} attention screens marked another way' + (' (including the code-reading screen)' if screen_miss else ''))
cant = sum(cnt.get(c, 0) for c in C.get('unsure_choices', []))
if cant > C.get('max_unsure_share', 0.15) * len(qs): ask.append(f'{cant} of {len(qs)} answers were "can\'t tell"')
if notes and copied > C.get('max_copied_reasons', 0.3) * len(notes): ask.append(f'{copied} reasons repeat another reason word for word')
if notes and foreign >= max(3, 0.3 * len(notes)): ask.append('many reasons are not in English, which suggests the page was machine-translated')
if reject: out('REJECT', reject, summary)
if ask: out('ASK', ask, summary)
out('PASS', ['complete, and no quality flag'], summary)
