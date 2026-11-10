#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# The containment check (containment.ts). $1 is the repository, $2 a dir holding lines (whole-line candidates), names
# (fixed-string candidates), upstream (the dataset's base commit), after (the upstream commit ids after the base that the
# unit's image holds) and fix.patch and test.patch, $3 the scan root ("/" in a container). Prints PF_CONTAIN lines and
# ends with "PF_CONTAIN done". Hits name a needle by the first 16 hex of its sha256, never its text.
set -u
repo="$1"; in="$2"; root="${3%/}"
say() { printf 'PF_CONTAIN %s\n' "$*"; }
g() { git -c safe.directory='*' -C "$repo" "$@"; }
base=$(g rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) || { say "error no HEAD commit in $repo"; exit 0; }
gd=$(g rev-parse --absolute-git-dir 2>/dev/null)
anc() { g merge-base --is-ancestor "$1" "$base" 2>/dev/null; }
t=$(mktemp -d)
bad=0; refs=0
while read -r sha ref; do
  refs=$((refs + 1))
  c=$(g rev-parse -q --verify "$sha^{commit}" 2>/dev/null) && anc "$c" || { bad=$((bad + 1)); say "bad_ref $ref"; }
done < <(g for-each-ref --format='%(objectname) %(refname)')
special=0
for f in FETCH_HEAD ORIG_HEAD MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_HEAD AUTO_MERGE; do
  [ -e "$gd/$f" ] || continue
  special=$((special + 1))
  for s in $(grep -aoE '[0-9a-f]{40}' "$gd/$f" | sort -u); do anc "$s" || { bad=$((bad + 1)); say "bad_ref $f $s"; }; done
done
reflog=0
if [ -d "$gd/logs" ]; then
  for s in $(find "$gd/logs" -type f -exec grep -aohE '\b[0-9a-f]{40}\b' {} + | sort -u); do
    reflog=$((reflog + 1))
    case "$s" in *[!0]*) anc "$s" || { bad=$((bad + 1)); say "bad_ref reflog $s"; } ;; esac
  done
fi
commits=0; badc=0
while read -r sha type; do
  [ "$type" = commit ] || continue
  commits=$((commits + 1))
  anc "$sha" || { badc=$((badc + 1)); [ "$badc" -le 20 ] && say "bad_commit $sha"; }
done < <(g cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype)')
alt=0
for f in objects/info/alternates objects/info/http-alternates; do [ -e "$gd/$f" ] && { alt=1; say "alternates $gd/$f"; }; done
[ -n "${GIT_ALTERNATE_OBJECT_DIRECTORIES:-}${GIT_OBJECT_DIRECTORY:-}${GIT_DIR:-}" ] && { alt=1; say "alternates in the environment"; }
gitfile=0; [ -f "$repo/.git" ] && gitfile=1
modules=0; [ -e "$gd/modules" ] && modules=1
nested=0
while IFS= read -r -d '' p; do nested=$((nested + 1)); [ "$nested" -le 20 ] && say "nested $p"; done < <(find "$repo" -mindepth 2 -name .git -print0 2>/dev/null)
gitmodules=0; [ -e "$repo/.gitmodules" ] && gitmodules=1
tracked=0
g diff --quiet HEAD -- 2>/dev/null && g diff --cached --quiet HEAD -- 2>/dev/null || { tracked=1; say "tracked files differ from the base commit"; }
: > "$t/blobs"; mkdir -p "$t/obj"
ob() { GIT_INDEX_FILE="$t/idx" GIT_OBJECT_DIRECTORY="$t/obj" GIT_ALTERNATE_OBJECT_DIRECTORIES="$gd/objects" g "$@"; }
if ob read-tree HEAD 2>/dev/null && { [ ! -s "$in/fix.patch" ] || ob apply --cached "$in/fix.patch" 2>/dev/null; } &&
  { [ ! -s "$in/test.patch" ] || ob apply --cached "$in/test.patch" 2>/dev/null; }; then
  ob diff-index --cached --no-renames HEAD 2>/dev/null | awk '$4 !~ /^0+$/ { print $4 }' | sort -u > "$t/blobs"
  [ -s "$t/blobs" ] || say "error the fix and test patches give no blob"
else
  say "error the fix and test patches do not apply to the base commit"
fi
fixb=$(wc -l < "$t/blobs")
rfb=0
while read -r id rest; do [ "$rest" = missing ] || { rfb=$((rfb + 1)); say "fix_blob_in_repo $id"; }; done < <([ -s "$t/blobs" ] && g cat-file --batch-check < "$t/blobs")
up=$(cat "$in/upstream" 2>/dev/null)
{ grep -aoE '^[0-9a-f]{40}$' "$in/after" 2>/dev/null || true; } | sort -u > "$t/after"
na=$(wc -l < "$t/after")
other=0; clones=0; lafter=0; lfix=0
while IFS= read -r -d '' h; do
  d=${h%/HEAD}
  [ -d "$d/objects" ] && [ -d "$d/refs" ] || continue
  case "$d" in "$gd") continue ;; esac
  other=$((other + 1))
  og() { git -c safe.directory='*' --git-dir="$d" "$@"; }
  n=$(og cat-file --batch-all-objects --unordered --batch-check='%(objecttype)' 2>/dev/null | grep -c '^commit$')
  [ "$other" -le 500 ] && say "gitdir commits=$n $d"
  if [ -n "$up" ] && og cat-file -e "$up^{commit}" 2>/dev/null; then clones=$((clones + 1)); say "clone $d"; fi
  while read -r id rest; do [ "$rest" = missing ] || { lafter=$((lafter + 1)); say "leak after $id $d"; }; done < <([ -s "$t/after" ] && og cat-file --batch-check < "$t/after")
  while read -r id rest; do [ "$rest" = missing ] || { lfix=$((lfix + 1)); say "leak fix $id $d"; }; done < <([ -s "$t/blobs" ] && og cat-file --batch-check < "$t/blobs")
done < <(find "$root/" \( -path "$root/proc" -o -path "$root/sys" -o -path "$root/dev" -o -path "$in" -o -path "$t" \) -prune -o -name HEAD -type f -print0 2>/dev/null)
g ls-files -z | (cd "$repo" && xargs -0 -r grep -h -a -F -x -f "$in/lines" -- 2>/dev/null) | sort -u > "$t/lines.base"
grep -a -v -x -F -f "$t/lines.base" "$in/lines" > "$t/lines" 2>/dev/null || true
[ -s "$t/lines.base" ] || cp "$in/lines" "$t/lines"
g ls-files -z | (cd "$repo" && xargs -0 -r grep -h -o -a -F -f "$in/names" -- 2>/dev/null) | sort -u > "$t/names.base"
grep -a -v -x -F -f "$t/names.base" "$in/names" > "$t/names" 2>/dev/null || true
[ -s "$t/names.base" ] || cp "$in/names" "$t/names"
: > "$t/names.keep"
while IFS= read -r n; do [ -n "$n" ] || continue; g grep -q -a -F -e "$n" 2>/dev/null || printf '%s\n' "$n" >> "$t/names.keep"; done < "$t/names"
mv "$t/names.keep" "$t/names"
sed -i '/^$/d' "$t/lines" "$t/names"
nl=$(wc -l < "$t/lines"); nn=$(wc -l < "$t/names")
{ find "$root/" \( -path "$root/proc" -o -path "$root/sys" -o -path "$root/dev" -o -path "$in" -o -path "$t" -o -path "$repo" \) -prune -o -type f -print0 2>/dev/null
  g ls-files -z --others | while IFS= read -r -d '' f; do printf '%s\0' "$repo/$f"; done; } > "$t/files"
files=$(tr -cd '\0' < "$t/files" | wc -c)
hits=0
scan() {
  local kind="$1" list="$2" x="$3" p n
  [ -s "$list" ] || return 0
  while IFS= read -r -d '' p; do
    while IFS= read -r n; do
      hits=$((hits + 1))
      [ "$hits" -le 50 ] && say "hit $kind $(printf %s "$n" | sha256sum | cut -c1-16) $p"
    done < <(grep -a -o $x -F -f "$list" -- "$p" 2>/dev/null | sort -u)
  done < <(xargs -0 -r grep -a -l -s $x -F -f "$list" -- < "$t/files" | tr '\n' '\0')
}
scan line "$t/lines" -x
scan name "$t/names" ""
rm -rf "$t"
say "summary base=$base refs=$refs bad_refs=$bad special=$special reflog=$reflog commits=$commits bad_commits=$badc alternates=$alt gitfile=$gitfile modules=$modules nested=$nested gitmodules=$gitmodules tracked_changed=$tracked fix_blobs=$fixb repo_fix_blobs=$rfb after=$na other_gitdirs=$other clones=$clones leaked_after=$lafter leaked_fix=$lfix lines=$nl names=$nn files=$files hits=$hits"
say done
