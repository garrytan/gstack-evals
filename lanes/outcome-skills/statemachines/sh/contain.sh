# The object-level containment check on a session workspace, run as the session sees it (after the image build, before
# any session). $1 is the repo dir, $2 a dir holding want (the head the image recorded), names (hidden test leaf names)
# and markers (the test side's 30-code-point lines), one a line, and qa_pin for A3; $3 is the filesystem root ("/" in a
# container, a fixture dir in tests). Every path printed is relative to the root and base64-encoded, and so is every match.
#   (a) refs: HEAD is want, and every ref (peeled), pseudo-ref and packed-refs line names want or one of its ancestors.
#   (b) objects: every commit object in the store is want or one of its ancestors.
#   (c) stores: no alternates (file or variable), no .gitmodules or nested .git under the repo, and no other git object
#       store anywhere but proc and sys, except A3's gstack checkout when its HEAD is the /qa pin.
#   (d) scan: outside the repo, no file holds a hidden test name (a whole word) or a marker (anywhere in a line), read
#       raw as scan.sh reads (binary included, devices skipped); archives are listed, never failed.
set -u
export GIT_NO_REPLACE_OBJECTS=1
repo="$1"; in="$2"; r="${3%/}"; top="${r:-/}"
want=$(cat "$in/want")
enc() { printf %s "$1" | base64 -w0; }
rel() { printf %s "${1#"$r"}"; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cd "$repo" || { echo "CHECK refs fail"; exit 0; }
gd=$(git rev-parse --absolute-git-dir 2>/dev/null)
peel() { git rev-parse --verify -q "$1^{commit}" 2>/dev/null; }
good() { local c; c=$(peel "$1") && git merge-base --is-ancestor "$c" "$want" 2>/dev/null; }
bad=0
ref() { printf 'REF %s %s\n' "$(enc "$1")" "$(peel "$2" || printf %s "$2")"; bad=$((bad + 1)); }
head=$(git rev-parse --verify -q HEAD 2>/dev/null)
[ "$head" = "$want" ] || ref HEAD "${head:-none}"
[ ! -e "$gd/info/grafts" ] || ref info/grafts none
while read -r name sha; do good "$sha" || ref "$name" "$sha"; done < <(git for-each-ref --format='%(refname) %(objectname)')
for p in FETCH_HEAD ORIG_HEAD MERGE_HEAD CHERRY_PICK_HEAD; do
  [ -f "$gd/$p" ] || continue
  while read -r sha; do good "$sha" || ref "$p" "$sha"; done < <(grep -oE '^[0-9a-f]{40,64}' "$gd/$p")
done
if [ -f "$gd/packed-refs" ]; then
  while read -r sha; do good "$sha" || ref packed-refs "$sha"; done < <(grep -v '^#' "$gd/packed-refs" | grep -oE '^\^?[0-9a-f]{40,64}' | tr -d '^')
fi
echo "CHECK refs $([ $bad -eq 0 ] && echo ok || echo fail)"
git rev-list "$want" 2>/dev/null | sort > "$tmp/reach"
git cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname)' 2>/dev/null | awk '$1 == "commit" { print $2 }' | sort > "$tmp/commits"
comm -23 "$tmp/commits" "$tmp/reach" > "$tmp/foreign"
sed 's/^/OBJ /' "$tmp/foreign"
echo "CHECK objects $([ -s "$tmp/foreign" ] && echo fail || echo ok)"
bad=0
store() { printf 'STORE %s %s\n' "$1" "$(enc "$(rel "$2")")"; bad=$((bad + 1)); }
[ ! -e "$gd/objects/info/alternates" ] || store alternates "$gd/objects/info/alternates"
[ -z "${GIT_ALTERNATE_OBJECT_DIRECTORIES+x}" ] || { echo "STORE env $(enc GIT_ALTERNATE_OBJECT_DIRECTORIES)"; bad=$((bad + 1)); }
while IFS= read -r -d '' f; do
  case "$(basename "$f")" in .gitmodules) store gitmodules "$f";; *) store nested "$f";; esac
done < <(find "$repo" -path "$gd" -prune -o \( -name .gitmodules -o -name .git \) -print0)
gs="$r/root/.claude/skills/gstack/.git"
while IFS= read -r -d '' h; do
  d=$(dirname "$h")
  [ -d "$d/objects" ] && { [ -d "$d/refs" ] || [ -f "$d/packed-refs" ]; } || continue
  [ "$d" = "$gd" ] && continue
  if [ "$d" = "$gs" ] && [ -s "$in/qa_pin" ] && [ "$(git --git-dir="$d" rev-parse --verify -q HEAD 2>/dev/null)" = "$(cat "$in/qa_pin")" ]; then continue; fi
  store store "$d"
done < <(find "$top" \( -path "$r/proc" -o -path "$r/sys" -o -path "$r/sm-in" -o -path "$tmp" \) -prune -o -type f -name HEAD -print0)
echo "CHECK stores $([ $bad -eq 0 ] && echo ok || echo fail)"
find "$top" \( -path "$r/proc" -o -path "$r/sys" -o -path "$r/sm-in" -o -path "$tmp" -o -path "$repo" \) -prune -o -type f -print0 > "$tmp/files"
git ls-files -z | xargs -0 -r grep -h -a -o -F -w -f "$in/names" -- 2>/dev/null | sort -u > "$tmp/name-in-base"
grep -v -x -F -f "$tmp/name-in-base" "$in/names" | grep . > "$tmp/names"
git ls-files -z | xargs -0 -r grep -h -a -F -x -f "$in/markers" -- 2>/dev/null | sort -u > "$tmp/mark-in-base"
grep -v -x -F -f "$tmp/mark-in-base" "$in/markers" | grep . > "$tmp/markers"
hit() { while IFS= read -r -d '' p && IFS= read -r m; do printf 'HIT %s %s %s\n' "$1" "$(enc "$(rel "$p")")" "$(enc "$m")"; done; }
[ -s "$tmp/names" ] && xargs -0 -r grep -a -s -D skip -H -Z -o -F -w -f "$tmp/names" -- < "$tmp/files" | hit name
[ -s "$tmp/markers" ] && xargs -0 -r grep -a -s -D skip -H -Z -o -F -f "$tmp/markers" -- < "$tmp/files" | hit marker
tr '\0' '\n' < "$tmp/files" | grep -E '\.(zip|whl|jar|gz)$|\.tar\.[^/]*$' | while IFS= read -r p; do printf 'ARCHIVE %s\n' "$(enc "$(rel "$p")")"; done
echo "CHECK scan done"
exit 0
