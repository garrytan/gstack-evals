# The review eval's session tree (lanes/outcome-skills/smreview): the prepared tree as the change under review on top of
# its base. $1 is the tree, $2/pr.patch the change. Commit one is the tree with the change reversed, commit two the tree,
# and main is commit two. origin is a bare repository outside the tree whose main is commit one, so origin/main and
# origin/HEAD name the base, and a fetch from origin works with no network. Ignored and untracked files stay.
set -euo pipefail
cd "$1"
g() { git -c user.name=base -c user.email=base@localhost -c commit.gpgsign=false -c gc.auto=0 "$@"; }
t1=$(git write-tree)
test "$t1" = "$(git rev-parse 'HEAD^{tree}')"
g apply -R --cached --whitespace=nowarn "$2/pr.patch"
t0=$(git write-tree)
c0=$(GIT_AUTHOR_DATE=2000-01-01T00:00:00Z GIT_COMMITTER_DATE=2000-01-01T00:00:00Z g commit-tree "$t0" -m base)
c1=$(GIT_AUTHOR_DATE=2000-01-01T00:00:01Z GIT_COMMITTER_DATE=2000-01-01T00:00:01Z g commit-tree "$t1" -p "$c0" -m "Change under review")
g update-ref refs/heads/main "$c1"
g reset -q --hard "$c1"
o=/opt/sr-origin.git
rm -rf "$o"
mkdir -p /opt
git init -q --bare "$o"
git -C "$o" symbolic-ref HEAD refs/heads/main
g push -q "$o" "$c0:refs/heads/main"
git remote add origin "$o"
g fetch -q origin
git remote set-head origin main >/dev/null
git reflog expire --expire=now --all
rm -rf .git/logs
g gc -q --prune=now
test "$(git rev-parse refs/remotes/origin/main)" = "$c0"
