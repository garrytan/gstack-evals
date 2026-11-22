import json,sys,os,glob,re
R=sys.argv[1]
names=['tui','exec-codex','exec-ohr','exec-codex-sbx','exec-ohr-sbx']
rows={}
def save(n):
    p=os.path.join(R,'work-'+n,'.probe-save')
    if not os.path.exists(p): return None
    return dict(l.rstrip('\n').split('\t',1) for l in open(p) if '\t' in l)
for n in names:
    row={}
    row['exit']=open(os.path.join(R,n+'.exit')).read().strip()
    fl=os.path.join(R,n+'.flags'); row['flags']=open(fl).read().strip() if os.path.exists(fl) else 'tui'
    reqs=[json.loads(l) for l in open(os.path.join(R,n+'.requests.jsonl')) if l.strip()] if os.path.exists(os.path.join(R,n+'.requests.jsonl')) else []
    rs=[r for r in reqs if r['path'].endswith('/responses')]
    row['responses_requests']=len(rs)
    row['request_models']=sorted(set(r['body'].get('model') for r in rs))
    outs=[]
    for r in rs[-1:]:
        for i in r['body'].get('input',[]):
            if str(i.get('type','')).endswith('_output'):
                o=i.get('output'); outs.append(o if isinstance(o,str) else json.dumps(o))
    probe=outs[0] if outs else ''
    for k in re.findall(r'((?:KIND|CODEX_THREAD_ID|CODEX_CI|GSTACK_HEADLESS|CI|GITHUB_ACTIONS|SKILL_END_HOST|NEAREST_CODEX_BASENAME|NEAREST_CODEX_SUBCOMMAND|GSTACK_WALK_MATCHES_CODEX)=[A-Za-z0-9_()-]+|CODEX_NAMES=[A-Z_,]*)', probe):
        a,b=k.split('=',1); row.setdefault(a,b)
    row['apply_patch_file']='present' if os.path.exists(os.path.join(R,'work-'+n,'ohr-patch.txt')) and open(os.path.join(R,'work-'+n,'ohr-patch.txt')).read()=='patched by apply_patch\n' else 'absent'
    row['command_file']='present' if os.path.exists(os.path.join(R,'work-'+n,'ohr-cmd.txt')) else 'absent'
    row['command_saw_patch']='yes' if len(outs)>2 and 'CMD_RAN=yes PATCH_FILE=ok' in outs[2] else 'no'
    metas=[]
    for f in glob.glob(os.path.join(R,'home-'+n,'.codex','sessions','*','*','*','rollout-*.jsonl')):
        for l in open(f):
            d=json.loads(l)
            if d.get('type')=='session_meta': metas.append(d['payload'])
    row['rollout_cli_version']=sorted(set(m.get('cli_version') for m in metas)) or None
    row['rollout_originator']=sorted(set(m.get('originator') for m in metas)) or None
    tid=None
    ev=os.path.join(R,n+'.events.jsonl')
    if os.path.exists(ev):
        for l in open(ev):
            try: d=json.loads(l)
            except Exception: continue
            if d.get('type')=='thread.started': tid=d.get('thread_id')
    if tid is None and metas: tid=metas[0].get('id')
    s=save(n)
    row['thread_id_is_session']=('yes' if s and s.get('CODEX_THREAD_ID')==tid else 'no') if s is not None else 'no save'
    rows[n]=(row,s)
t=rows['tui'][1] or {}
for n in names:
    row,s=rows[n]
    if s is not None and n!='tui':
        row['codex_values_vs_tui']=','.join(k+':'+('same' if t.get(k)==v else 'differs') for k,v in sorted(s.items()) if k!='CODEX_THREAD_ID') or '(none)'
    print('== '+n)
    for k,v in row.items(): print('  %s: %s' % (k,v))
