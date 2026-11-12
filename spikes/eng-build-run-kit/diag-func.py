import json,glob,os,collections
rows=[]
for a in glob.glob('/dev/shm/eb525/units-s*/er-*/admission.json'):
    ad=json.load(open(a))
    if not any(d['cls']=='no_functional_pass' for d in ad['drops']): continue
    e=os.path.join(os.path.dirname(a),'eb.json')
    if not os.path.exists(e): rows.append(('no eb.json',)); continue
    eb=json.load(open(e))
    f=eb['sets'][0]
    kinds=sorted({eb['groups'][g['group']]['runner']['kind'] for g in f['groups']}) if f['groups'] else []
    ecos=sorted({g['eco'] for g in eb['groups']})
    mixed=sum(1 for d in ad['drops'] if d['code']=='E_EB_TRANSPLANT' and d['step']=='functional')
    rows.append(('+'.join(ecos), 'groups=%d'%len(f['groups']), 'targets=%d'%sum(len(g['targets']) for g in f['groups']), 'kinds='+','.join(kinds), 'mixedfunc=%d'%mixed, 'trees=%s'%','.join(sorted(eb.get('trees',{}).keys()))))
for r in sorted(rows): print(' '.join(r))
