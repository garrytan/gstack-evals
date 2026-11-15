# Containment needles over one tree: an arm's installed home, or an archive extracted from it (arms/contain.ts). $1 is the
# root, $2 a dir holding names (hidden test names), markers (test-side lines) and lines (fix lines), one a line. Every
# file under the root is read raw as the state machines scans read it (binary included, devices skipped): names as whole
# words, markers anywhere in a line, lines as whole lines. Every git object store under the root is then streamed object
# by object (git cat-file), since a packed or loose object is compressed on disk, and read the same way. Prints
# "HIT <needle> <file|git> <b64 path> <b64 match>" per hit, "STORE <b64 path>" per store, and "ERR <b64 what>" for a tool
# that failed, which the caller reads as a scan that did not finish. Paths are relative to the root; text leaves only in
# the HIT lines' match field, which the caller hashes at once.
set -u -o pipefail
root="${1%/}"; in="$2"
enc() { printf %s "$1" | base64 -w0; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_NO_REPLACE_OBJECTS=1
find "$root" -type f -print0 > "$tmp/files" || echo "ERR $(enc find)"
hits() { while IFS= read -r -d '' p && IFS= read -r m; do printf 'HIT %s %s %s %s\n' "$1" "$2" "$(enc "${3:-${p#"$root"/}}")" "$(enc "$m")"; done; }
grepf() {
  [ -s "$in/$2" ] || return 0
  xargs -0 -r sh -c 'grep "$@"; [ $? -le 1 ]' sh -a -D skip -H -Z -o -F "${@:3}" -f "$in/$2" -- < "$tmp/files" > "$tmp/h" || { echo "ERR $(enc "grep $2")"; return 0; }
  hits "$1" file < "$tmp/h"
}
grepf name names -w
grepf marker markers
grepf line lines -x
find "$root" -type f -name HEAD -print0 > "$tmp/heads" || echo "ERR $(enc "find stores")"
while IFS= read -r -d '' h; do
  d=$(dirname "$h")
  [ -d "$d/objects" ] && { [ -d "$d/refs" ] || [ -f "$d/packed-refs" ]; } || continue
  rel=${d#"$root"/}
  echo "STORE $(enc "$rel")"
  git --git-dir="$d" cat-file --batch-all-objects --batch > "$tmp/objs" 2> "$tmp/cat.err" && [ ! -s "$tmp/cat.err" ] || { echo "ERR $(enc "git cat-file $rel")"; continue; }
  for k in "name names -w" "marker markers" "line lines -x"; do
    set -- $k
    [ -s "$in/$2" ] || continue
    { grep -a -o -F "${@:3}" -f "$in/$2" "$tmp/objs"; [ $? -le 1 ]; } > "$tmp/gh" || { echo "ERR $(enc "grep $2 in $rel")"; continue; }
    while IFS= read -r m; do printf 'HIT %s git %s %s\n' "$1" "$(enc "$rel")" "$(enc "$m")"; done < "$tmp/gh"
  done
done < "$tmp/heads"
exit 0
