
import json, csv, random, collections, math, sys
B='wiki/board/'
P='wiki/plans/'
pool={t['task_id']:t['created'] for t in json.load(open('quick/laneb/tasks/swerebench-r3a4.json'))['tasks']}
frame={a['ghsa'].lower():a for a in json.load(open(P+'2026-11-15-geva-538-skill-pack-h2h-prereg/b2-frame.json'))['advisories']}
SEED=20261125; DRAWS=10000
def signp(b,c):
  n=b+c
  if n==0: return 1.0
  k=min(b,c); p=sum(math.comb(n,i) for i in range(k+1))/2**n
  return round(min(1.0,2*p),4)
def boot(pairs):
  # pairs: list of (repo, stratum, plain, skill) with numeric values
  def stats(ps):
    out={}
    for s in set(p[1] for p in ps)|{'all'}:
      q=[p for p in ps if s=='all' or p[1]==s]
      if q: out[s]=(len(q), sum(p[2] for p in q)/len(q), sum(p[3] for p in q)/len(q), sum(p[3]>p[2] for p in q), sum(p[3]<p[2] for p in q))
    return out
  pt=stats(pairs)
  byrepo=collections.defaultdict(list)
  for p in pairs: byrepo[p[0]].append(p)
  repos=list(byrepo); rnd=random.Random(SEED)
  dd=collections.defaultdict(list); inter=[]
  strata=sorted(s for s in pt if s!='all')
  for _ in range(DRAWS):
    ps=[x for r in (rnd.choice(repos) for _ in repos) for x in byrepo[r]]
    st=stats(ps)
    for s,v in st.items(): dd[s].append(v[2]-v[1])
    if len(strata)==2 and all(s in st for s in strata):
      inter.append((st[strata[1]][2]-st[strata[1]][1])-(st[strata[0]][2]-st[strata[0]][1]))
  def ci(x):
    x=sorted(x); return (x[int(0.025*len(x))], x[int(0.975*len(x))-1]) if x else (None,None)
  res={}
  for s,v in pt.items():
    lo,hi=ci(dd[s]); res[s]=dict(better=v[3], worse=v[4], sign_p=signp(v[3],v[4]), n=v[0], plain=round(100*v[1],1), skill=round(100*v[2],1), delta=round(100*(v[2]-v[1]),1), lo=round(100*lo,1), hi=round(100*hi,1), repos=len({p[0] for p in pairs if s=='all' or p[1]==s}))
  if inter:
    lo,hi=ci(inter); d=(pt[strata[1]][2]-pt[strata[1]][1])-(pt[strata[0]][2]-pt[strata[0]][1])
    res['interaction']=dict(order=f'{strata[1]} minus {strata[0]}', delta=round(100*d,1), lo=round(100*lo,1), hi=round(100*hi,1), draws=len(inter))
  return res
OUT={}
# 1. skill-pack h2h stage 2, Opus 5.5, gstack vs none, verified fix
U={u['id']:u for u in json.load(open(B+'2026-11-19-geva-540-skill-pack-h2h-session-data/units.json'))}
S=[json.loads(l) for l in open(B+'2026-11-19-geva-540-skill-pack-h2h-session-data/score-records.jsonl')]
sc={(s['unit'],s['arm']):s for s in S if s['stage']=='stage2'}
for cls in ['O','B']:
  for arm in ['gstack','gstack-oneline']:
    pairs=[];gaps=0
    for (u,a),s in sc.items():
      if a!='none' or U[u]['class']!=cls: continue
      t=sc.get((u,arm))
      if not t: continue
      if s['verified'] is None or t['verified'] is None or s['outcome'] is None or t['outcome'] is None: gaps+=1; continue
      m=U[u]['month']; st='post: 2026-07 on' if m>='2026-07' else 'pre: to 2026-06'
      pairs.append((U[u]['repo'],st,int(bool(s['verified'])),int(bool(t['verified']))))
    if pairs: OUT[f'h2h|opus|{cls}|{arm}-vs-none']=dict(boot(pairs), gaps=gaps, months=dict(collections.Counter(U[u]['month'] for (u,a) in sc if a=='none' and U[u]['class']==cls)))
# 2. B2 test-first
b2=[json.loads(l) for l in open(B+'2026-11-22-capy-b2-test-first-results/sessions.jsonl')]
idx={(x['model'],x['task'],x['arm']):x for x in b2}
for model in ['claude-opus-5-5','gpt-6.2-sol','particle-1']:
  for arm in ['gstack','prove-it','line']:
    pairs=[]
    for (m,t,a),x in idx.items():
      if m!=model or a!='none': continue
      y=idx[(m,t,arm)]
      st='older: 2025-10 to 2025-12' if pool[t]<'2026-01' else 'newer: 2026-01 to 2026-05'
      pairs.append((x['repo'],st,int(bool(x['pass'])),int(bool(y['pass']))))
    OUT[f'b2|{model}|{arm}-vs-none']=boot(pairs)
# 3. delivery route GEVA-548
D=[json.loads(l) for l in open(B+'2026-11-18-geva-548-delivery-route-results/sessions.jsonl')]
di={(x['model'],x['task'],x['arm']):x for x in D}
for model in ['claude-opus-5-5','gpt-6.1-sol','particle-1']:
  for arm in ['gstack-shaped','command','described']:
    pairs=[]
    for (m,t,a),x in di.items():
      if m!=model or a!='none': continue
      y=di[(m,t,arm)]
      st='older: 2025-10 to 2025-12' if pool[t]<'2026-01' else 'newer: 2026-01 to 2026-05'
      pairs.append((t.rsplit('-',1)[0],st,int(bool(x['pass'])),int(bool(y['pass']))))
    OUT[f'548|{model}|{arm}-vs-none']=boot(pairs)
# 4. cso rerun vs reused plain audit
plain={(s['unit'],s['model']):s for s in map(json.loads,open(B+'2026-11-23-geva-561-cso-advisories-results/stage2-scores.jsonl')) if s['arm']=='none'}
new={(s['unit'],s['model']):s for s in map(json.loads,open(B+'2026-11-24-geva-583-cso-rerun-results/rerun-scores.jsonl')) if s['arm']=='cso'}
csodates={}
for model in ['opus','particle']:
  pairs=[];gaps=0
  for (u,m),s in plain.items():
    if m!=model: continue
    t=new.get((u,m))
    if not t: continue
    if s['gap'] or t['gap']: gaps+=1; continue
    g=u[u.index('ghsa-'):].lower(); pub=frame[g]['published']; csodates[u]=pub
    st='Jul-Aug 2026' if pub<'2026-09-01' else 'Sep-Oct 2026'
    pairs.append((s['repo'],st,int(bool(s['named'])),int(bool(t['named']))))
  OUT[f'cso|{model}|cso-a3ecfd53-vs-plain']=dict(boot(pairs),gaps=gaps)
OUT['cso_dates']=dict(min=min(csodates.values()),max=max(csodates.values()),after_2026_10_17=sorted(v for v in csodates.values() if v>'2026-10-17'), by_month=dict(collections.Counter(v[:7] for v in csodates.values())))
# 5. GEVA-520 claim 2: S0 untouched tree vs A1 prompt tree, incremental
a=json.load(open(B+'2026-11-17-geva-520-state-machines-prompt-results/analysis-input.json'))
UM={u['id']:u for u in a['units']}
cut={'claude-opus-5-5':'2026-07','openai/gpt-6.1-sol':'2026-05','particle-ai/particle-1':None}
for model in a['models']:
  vals=collections.defaultdict(list)
  for f in a['followon']:
    if f['model']!=model: continue
    vals[(f['unit'],f['tree'])].append(None if (f['gap'] or f['incremental'] is None) else f['incremental'])
  pairs=[]
  for u in UM:
    for t in ('S0','A1'): vals[(u,t)]=[v for v in vals.get((u,t),[]) if v is not None]
    if all(len(vals[(u,t)])>=2 for t in ('S0','A1')):
      m=UM[u]['month']; c=cut[model]
      st=(('post: '+c+' on') if m>=c else 'pre') if c else ('July 2026' if UM[u]['july'] else 'Mar-Jun 2026')
      s0=sum(vals[(u,'S0')])/len(vals[(u,'S0')]); a1=sum(vals[(u,'A1')])/len(vals[(u,'A1')])
      pairs.append((UM[u]['repo'],st,s0,a1))
  OUT[f'sm520|{model}|A1-vs-S0']=dict(boot(pairs), months=dict(collections.Counter(UM[u]['month'] for u in UM)))
json.dump(OUT,open(sys.argv[1],'w'),indent=1)

