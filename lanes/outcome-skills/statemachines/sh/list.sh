# The strip rule's listing: HEAD, dirty tracked count, then every CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude at
# any depth (paths base64), with each CLAUDE file's text for its @imports. $1 is the tree.
set -eu
cd "$1"
echo "HEAD $(git rev-parse HEAD 2>/dev/null || echo none)"
echo "DIRTY $(git status --porcelain --untracked-files=no 2>/dev/null | wc -l)"
find . -name .git -prune -o \( -name CLAUDE.md -o -name CLAUDE.local.md -o -name AGENTS.md -o -name .claude \) -print0 | while IFS= read -r -d '' p; do
  p=${p#./}
  n=${p##*/}
  if [ -d "$p" ] && [ ! -L "$p" ]; then printf 'D\t%s\n' "$(printf %s "$p" | base64 -w0)"
  elif [ -f "$p" ] && [ ! -L "$p" ] && { [ "$n" = CLAUDE.md ] || [ "$n" = CLAUDE.local.md ]; }; then printf 'F\t%s\t%s\n' "$(printf %s "$p" | base64 -w0)" "$(head -c 1048576 "$p" | base64 -w0)"
  else printf 'P\t%s\n' "$(printf %s "$p" | base64 -w0)"; fi
done
