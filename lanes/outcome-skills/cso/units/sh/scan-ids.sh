# Advisory-id needles over one tree (lanes/outcome-skills/cso/units/ids.ts): a session tree, an arm's installed gstack
# tree (deviation (a)), or an archive extracted from one. $1 is the root, $2 a file of needle patterns, one a line, lowercase
# extended regexes: GHSA ids, CVE ids with a no-digit right edge, and fix-commit prefixes. Every file under the root is read raw (binary included, devices skipped)
# and matched case-insensitively anywhere in a line; every git object store under the root is then streamed object by
# object (git cat-file), since a packed or loose object is compressed on disk, and read the same way. Prints
# "HIT <file|git> <b64 path> <b64 match>" per hit, "STORE <b64 path>" per store and "ERR <b64 what>" for a tool that
# failed, which the caller reads as a scan that did not finish. Paths are relative to the root.
set -u -o pipefail
root="${1%/}"; nf="$2"
enc() { printf %s "$1" | base64 -w0; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_NO_REPLACE_OBJECTS=1
[ -s "$nf" ] || exit 0
find "$root" -type f -print0 > "$tmp/files" || echo "ERR $(enc find)"
xargs -0 -r sh -c 'grep "$@"; [ $? -le 1 ]' sh -a -i -E -D skip -H -Z -o -f "$nf" -- < "$tmp/files" > "$tmp/h" || echo "ERR $(enc grep)"
while IFS= read -r -d '' p && IFS= read -r m; do printf 'HIT file %s %s\n' "$(enc "${p#"$root"/}")" "$(enc "$m")"; done < "$tmp/h"
find "$root" -type f -name HEAD -print0 > "$tmp/heads" || echo "ERR $(enc "find stores")"
while IFS= read -r -d '' h; do
  d=$(dirname "$h")
  [ -d "$d/objects" ] && { [ -d "$d/refs" ] || [ -f "$d/packed-refs" ]; } || continue
  rel=${d#"$root"/}
  echo "STORE $(enc "$rel")"
  git --git-dir="$d" cat-file --batch-all-objects --batch > "$tmp/objs" 2> "$tmp/cat.err" && [ ! -s "$tmp/cat.err" ] || { echo "ERR $(enc "git cat-file $rel")"; continue; }
  { grep -a -i -o -E -f "$nf" "$tmp/objs"; [ $? -le 1 ]; } > "$tmp/gh" || { echo "ERR $(enc "grep in $rel")"; continue; }
  while IFS= read -r m; do printf 'HIT git %s %s\n' "$(enc "$rel")" "$(enc "$m")"; done < "$tmp/gh"
done < "$tmp/heads"
exit 0
