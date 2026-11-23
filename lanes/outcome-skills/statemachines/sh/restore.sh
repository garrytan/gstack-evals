# Puts every tracked file the image's tree changed back to the base commit's checkout (section 4: the repository at the
# base commit). Unstages, then removes and checks out each path that differs, so a file whose bytes differ only in line
# endings is rewritten too. Prints RESTORED<TAB>base64 path per file. $1 is the tree.
set -euo pipefail
cd "$1"
t=$(mktemp)
{ git diff --name-only -z HEAD --; git diff --name-only -z --cached HEAD --; git ls-files -m -d -z; } | sort -zu > "$t"
git -c gc.auto=0 reset -q
while IFS= read -r -d '' p; do
  if git cat-file -e "HEAD:$p" 2>/dev/null; then rm -f -- "$p"; git -c gc.auto=0 checkout -q HEAD -- "$p"; printf 'RESTORED\t%s\n' "$(printf %s "$p" | base64 -w0)"; fi
done < "$t"
rm -f "$t"
