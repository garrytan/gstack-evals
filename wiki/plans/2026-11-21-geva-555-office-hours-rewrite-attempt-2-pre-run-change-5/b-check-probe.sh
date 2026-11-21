#!/usr/bin/env bash
# The b-check probe, run in each tool shell. Prints names, set/unset and kinds only, never values. OHR_GSTACK_BIN is gstack's bin/ at 8fcca8a5. Values of CODEX_* names go to $OHR_SAVE (never printed) so the runner can compare them.
echo "KIND=$(bash $OHR_GSTACK_BIN/gstack-session-kind 2>&1)"
for v in CODEX_THREAD_ID CODEX_CI GSTACK_HEADLESS CI GITHUB_ACTIONS; do if [ -n "${!v+x}" ]; then echo "$v=set"; else echo "$v=unset"; fi; done
echo "CODEX_NAMES=$(compgen -e | grep -E '^CODEX' | sort | tr '\n' ',')"
: > "$OHR_SAVE"; for v in $(compgen -e | grep -E '^CODEX' | sort); do printf '%s\t%s\n' "$v" "${!v}" >> "$OHR_SAVE"; done
eval "$(sed -n '/case "${GSTACK_ACTIVE_HOST:-}" in/,/^  esac/p' $OHR_GSTACK_BIN/gstack-skill-end)"
echo "SKILL_END_HOST=$_HOST"
python3 - <<'PY'
import os
real=os.path.realpath(os.environ['OHR_REAL'])
skip={'-c','--config','-m','--model','-p','--profile','-s','--sandbox','-a','--ask-for-approval','-C','--cd','-i','--image','--add-dir','--enable','--disable','--local-provider','--remote','--remote-auth-token-env'}
def argv(p):
    return [a.decode('utf8','replace') for a in open('/proc/%d/cmdline'%p,'rb').read().split(b'\0') if a]
def ppid(p):
    return int([l.split()[1] for l in open('/proc/%d/status'%p).read().splitlines() if l.startswith('PPid:')][0])
pid=os.getppid(); depth=0; nearest=None; walk='no'
while depth<12 and pid>1:
    try: a=argv(pid)
    except Exception: break
    if walk=='no' and any(os.path.basename(x) in ('codex','codex.js','codex.exe') for x in a[:2]): walk='yes'
    try: exe=os.path.realpath('/proc/%d/exe'%pid)
    except Exception: exe=''
    if nearest is None and exe==real:
        sub='(none)'; s=False
        for t in a[1:]:
            if s: s=False; continue
            if t in skip: s=True; continue
            if t.startswith('-'): continue
            sub=t; break
        nearest=(os.path.basename(a[0]), sub if sub in ('exec','e','review','app-server','resume','(none)') else 'other')
    pid=ppid(pid); depth+=1
print('NEAREST_CODEX_BASENAME=%s' % (nearest[0] if nearest else 'none'))
print('NEAREST_CODEX_SUBCOMMAND=%s' % (nearest[1] if nearest else 'none'))
print('GSTACK_WALK_MATCHES_CODEX=%s' % walk)
PY
