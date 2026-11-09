# Removes the strip plan's paths, then replaces the history with one commit of the tracked base files that remain.
# $1 is the tree, $2/remove the NUL-separated paths.
set -euo pipefail
cd "$1"
while IFS= read -r -d '' p; do if [ -e "$p" ] || [ -L "$p" ]; then rm -rf -- "$p"; printf 'REMOVED\t%s\n' "$(printf %s "$p" | base64 -w0)"; fi; done < "$2/remove"
t=$(mktemp); k=$(mktemp)
git ls-files -z > "$t"
while IFS= read -r -d '' f; do if [ -e "$f" ] || [ -L "$f" ]; then printf '%s\0' "$f"; fi; done < "$t" > "$k"
find . -mindepth 2 -name .git -prune -exec rm -rf {} +
rm -rf .git
git init -q
git symbolic-ref HEAD refs/heads/main
xargs -0 -r -n 2000 git add -f -- < "$k"
GIT_COMMITTER_DATE="2000-01-01T00:00:00Z" git -c user.name=base -c user.email=base@localhost -c commit.gpgsign=false commit -q --no-verify --allow-empty --date "2000-01-01T00:00:00Z" -m base
git reflog expire --expire=now --all; rm -rf .git/logs; git gc -q --prune=now
rm -f "$t" "$k"
