import json,re,collections
S={"CLAUDE.md","CLAUDE.local.md","AGENTS.md",".claude"}
ru=json.load(open('/dev/shm/eb525/run/review-units.json'))
c=collections.Counter(); units=collections.Counter()
def walk(v,path):
    if isinstance(v,str):
        toks=re.split(r"[\s\"'()\[\],:;]+",v.replace(chr(96),' '))
        if any(any(seg in S for seg in t.split('/')) for t in toks): c[path]+=1; return True
        return False
    if isinstance(v,list): return any([walk(x,path+'[]') for x in v])
    if isinstance(v,dict): return any([walk(x,path+'.'+k) for k,x in v.items()])
    return False
for u in ru:
    if walk(u['opening'],'opening'): units['any']+=1
print(len(ru), dict(units), dict(c))
