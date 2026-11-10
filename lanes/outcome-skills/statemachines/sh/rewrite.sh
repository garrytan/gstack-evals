# Removes the strip plan's paths and the untracked files the image's own runs left (test output; ignored files stay),
# then replaces the history with one commit of the tracked base files that remain. $1 is the tree, $2/remove the
# NUL-separated paths. Mount points inside the tree (a VOLUME the image declares) stay: they cannot be removed, so a
# strip path that is one is kept and one that holds one loses everything around it.
set -euo pipefail
cd "$1"
mnts=(); ex=()
while read -r _ _ _ _ m _; do case "$m" in "$PWD"/*) mnts+=("$m"); ex+=(-e "/${m#"$PWD"/}/");; esac; done < /proc/self/mountinfo
sm_rm() {
  local e m keep=
  for m in ${mnts[@]+"${mnts[@]}"}; do case "$m" in "$PWD/$1") keep=mount;; "$PWD/$1"/*) keep=${keep:-above};; esac; done
  case "$keep" in
    mount) ;;
    above) for e in "$1"/* "$1"/.[!.]* "$1"/..?*; do if [ -e "$e" ] || [ -L "$e" ]; then sm_rm "$e"; fi; done ;;
    *) rm -rf -- "$1" ;;
  esac
}
while IFS= read -r -d '' p; do if [ -e "$p" ] || [ -L "$p" ]; then sm_rm "$p"; printf 'REMOVED\t%s\n' "$(printf %s "$p" | base64 -w0)"; fi; done < "$2/remove"
git clean -fdq "${ex[@]}"
t=$(mktemp); k=$(mktemp)
git ls-files -z > "$t"
while IFS= read -r -d '' f; do if [ -e "$f" ] || [ -L "$f" ]; then printf '%s\0' "$f"; fi; done < "$t" > "$k"
find . -mindepth 2 -name .git -prune -exec rm -rf {} +
rm -rf .git
git init -q
git symbolic-ref HEAD refs/heads/main
xargs -0 -r -n 2000 git -c gc.auto=0 add -f -- < "$k"
GIT_COMMITTER_DATE="2000-01-01T00:00:00Z" git -c user.name=base -c user.email=base@localhost -c commit.gpgsign=false -c gc.auto=0 commit -q --no-verify --allow-empty --date "2000-01-01T00:00:00Z" -m base
git reflog expire --expire=now --all; rm -rf .git/logs; git gc -q --prune=now
rm -f "$t" "$k"
