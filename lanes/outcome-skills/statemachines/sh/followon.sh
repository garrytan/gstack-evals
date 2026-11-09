# Commit two of a follow-on tree: the first stage's full-tree patch, staged by git apply --index. $2/tree.patch.
set -euo pipefail
cd "$1"
if [ -s "$2/tree.patch" ]; then git apply --index --binary --whitespace=nowarn "$2/tree.patch"; fi
GIT_COMMITTER_DATE="2000-01-01T00:00:01Z" git -c user.name=base -c user.email=base@localhost -c commit.gpgsign=false commit -q --no-verify --allow-empty --date "2000-01-01T00:00:01Z" -m first-stage
git reflog expire --expire=now --all; rm -rf .git/logs; git gc -q --prune=now
