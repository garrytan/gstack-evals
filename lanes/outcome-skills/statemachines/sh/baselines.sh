# The leak scan's candidate lines that are a whole line of some file of the base commit's tree, binary files included.
# The tree is the stripped one-commit tree, checked clean against its commit, so its tracked files are the commit's files.
set -u
cd "$1"
[ -s "$2/cand" ] || exit 0
git ls-files -z | xargs -0 -r grep -h -a -F -x -f "$2/cand" -- 2>/dev/null
exit 0
