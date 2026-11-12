# The commit-count preflight's facts, one line. $1 is the tree.
set -u
cd "$1"
all=$(git rev-list --all 2>/dev/null); head=$(git rev-list HEAD 2>/dev/null)
loose=$(git count-objects -v | awk '/^(count|garbage):/{s+=$2} END{print s+0}')
logs=0; if [ -d .git/logs ]; then logs=$(find .git/logs -type f | wc -l); fi
hm=0; if [ -n "$all" ] && [ "$all" = "$head" ]; then hm=1; fi
echo "PREFLIGHT count=$(git rev-list --all --count 2>/dev/null || echo 0) refs=$(git for-each-ref --format='%(refname)' | paste -sd, -) remotes=$(git remote | wc -l) stash=$(git stash list 2>/dev/null | wc -l) loose=$loose logs=$logs headmatch=$hm"
