# Commit two of a follow-on tree: the first stage's full-tree patch, staged by git apply --index. $2/tree.patch. Then the
# section 4 strip: each path in $2/remove (NUL-separated, from history.ts followOnStrip) that the tree holds is removed
# from the index and the tree and printed as STRIPPED, before the commit. A mount point inside the tree (a VOLUME the
# image declares) cannot be removed, so a strip path that is one is kept and one that holds one loses everything around
# it, as rewrite.sh does on the base tree.
set -euo pipefail
cd "$1"
git update-index -q --refresh || true
if [ -s "$2/tree.patch" ]; then git -c gc.auto=0 apply --index --binary --whitespace=nowarn "$2/tree.patch"; fi
if [ -s "$2/remove" ]; then
  mnts=()
  while read -r _ _ _ _ m _; do case "$m" in "$PWD"/*) mnts+=("$m");; esac; done < /proc/self/mountinfo
  sm_rm() {
    local e m keep=
    for m in ${mnts[@]+"${mnts[@]}"}; do case "$m" in "$PWD/$1") keep=mount;; "$PWD/$1"/*) keep=${keep:-above};; esac; done
    case "$keep" in
      mount) ;;
      above) for e in "$1"/* "$1"/.[!.]* "$1"/..?*; do if [ -e "$e" ] || [ -L "$e" ]; then sm_rm "$e"; fi; done ;;
      *) rm -rf -- "$1" ;;
    esac
  }
  while IFS= read -r -d '' p; do
    if [ -e "$p" ] || [ -L "$p" ]; then
      git --literal-pathspecs rm -r -q --cached --ignore-unmatch -- "$p" >/dev/null
      sm_rm "$p"
      printf 'STRIPPED\t%s\n' "$(printf %s "$p" | base64 -w0)"
    fi
  done < "$2/remove"
fi
GIT_COMMITTER_DATE="2000-01-01T00:00:01Z" git -c user.name=base -c user.email=base@localhost -c commit.gpgsign=false -c gc.auto=0 commit -q --no-verify --allow-empty --date "2000-01-01T00:00:01Z" -m first-stage
git reflog expire --expire=now --all; rm -rf .git/logs; git gc -q --prune=now
