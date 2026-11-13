# The object-level containment check on a session workspace, run as the session sees it (after the image build, before
# any session). $1 is the repo dir, $2 a dir holding want (the head the image recorded), names (hidden test leaf names)
# and markers (the test side's 30-code-point lines), one a line, qa_pin for A3, and patches (the names of the patches the
# oracle's fixed run applies, in its order, each held in the dir under its name); $3 is the filesystem root ("/" in a
# container, a fixture dir in tests). Every path printed is relative to the root and base64-encoded, and so is every match.
#   (a) refs: HEAD is want, and every ref (peeled), pseudo-ref and packed-refs line names want or one of its ancestors.
#   (b) objects: every commit object in the store is want or one of its ancestors.
#   (c) stores: no alternates (file or variable; each store they reach is listed), no nested .git under the repo, no
#       .gitmodules under the repo but one want tracks unchanged with no submodule store ($gd/modules, or a .git under
#       its dir), and no other git object store anywhere but proc and sys, with or without a HEAD file (a pack or loose
#       objects is a store), except A3's gstack checkout when its HEAD is the /qa pin and, when patches is given, a store
#       outside the repo that holds none of the post-base blob ids (the blobs each patch alone, and all of them in order,
#       make over want's root commit, hashed in $tmp) by a lookup that can be trusted.
#   (d) scan: no file outside the repo, and no file in the repo that want does not hold byte for byte (untracked,
#       ignored, staged but never committed, or tracked with a working copy that differs from want's blob), holds a
#       hidden test name (a whole word) or a marker (anywhere in a line), read raw as scan.sh reads (binary included,
#       devices skipped); base names and markers come from want's blobs, read once as one stream; archives outside the
#       repo are listed, never failed.
# A git listing, find or grep that fails prints an ERR line and fails its check, never reading as an empty, clean
# listing. A file or dir the check can't read is skipped and listed (UNREADABLE), never failed.
set -u -o pipefail
export GIT_NO_REPLACE_OBJECTS=1
in="$2"; r="${3%/}"; top="${r:-/}"
want=$(cat "$in/want")
enc() { printf %s "$1" | base64 -w0; }
rel() { printf %s "${1#"$r"}"; }
g() { grep "$@"; [ $? -le 1 ]; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cd "$1" || { echo "CHECK refs fail"; exit 0; }
repo=$PWD
gd=$(git rev-parse --absolute-git-dir 2>/dev/null)
peel() { git rev-parse --verify -q "$1^{commit}" 2>/dev/null; }
good() { local c; c=$(peel "$1") && git merge-base --is-ancestor "$c" "$want" 2>/dev/null; }
bad=0
err() { printf 'ERR %s %s\n' "$1" "$(enc "$2")"; bad=$((bad + 1)); }
ref() { printf 'REF %s %s\n' "$(enc "$1")" "$(peel "$2" || printf %s "$2")"; bad=$((bad + 1)); }
head=$(git rev-parse --verify -q HEAD 2>/dev/null)
[ "$head" = "$want" ] || ref HEAD "${head:-none}"
[ ! -e "$gd/info/grafts" ] || ref info/grafts none
git for-each-ref --format='%(refname) %(objectname)' > "$tmp/refs" || err refs "git for-each-ref"
while read -r name sha; do good "$sha" || ref "$name" "$sha"; done < "$tmp/refs"
for p in FETCH_HEAD ORIG_HEAD MERGE_HEAD CHERRY_PICK_HEAD; do
  [ -f "$gd/$p" ] || continue
  g -oE '^[0-9a-f]{40,64}' "$gd/$p" > "$tmp/pseudo" || err refs "grep $p"
  while read -r sha; do good "$sha" || ref "$p" "$sha"; done < "$tmp/pseudo"
done
if [ -f "$gd/packed-refs" ]; then
  g -oE '^\^?[0-9a-f]{40,64}' "$gd/packed-refs" > "$tmp/packed" || err refs "grep packed-refs"
  while read -r sha; do good "${sha#^}" || ref packed-refs "${sha#^}"; done < "$tmp/packed"
fi
echo "CHECK refs $([ $bad -eq 0 ] && echo ok || echo fail)"
bad=0
git rev-list "$want" > "$tmp/reach" || err objects "git rev-list"
git cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname)' > "$tmp/all" 2> "$tmp/all.err" && [ ! -s "$tmp/all.err" ] || err objects "git cat-file"
{ awk '$1 == "commit" { print $2 }' "$tmp/all" | sort > "$tmp/commits" && sort -o "$tmp/reach" "$tmp/reach" && comm -23 "$tmp/commits" "$tmp/reach" > "$tmp/foreign"; } || err objects "sort or comm"
sed 's/^/OBJ /' "$tmp/foreign"
[ ! -s "$tmp/foreign" ] || bad=$((bad + 1))
echo "CHECK objects $([ $bad -eq 0 ] && echo ok || echo fail)"
bad=0
store() { printf 'STORE %s %s\n' "$1" "$(enc "$(rel "$2")")"; bad=$((bad + 1)); }
isgit() { [ -f "$1/HEAD" ] && [ ! -L "$1/HEAD" ] && [ -d "$1/objects" ] && { [ -d "$1/refs" ] || [ -f "$1/packed-refs" ]; }; }
gx() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CEILING_DIRECTORIES="$tmp" GIT_NO_LAZY_FETCH=1 "$@"; }
paths() { local e; while IFS= read -r -d '' e; do e=${e#*$'\t'}; printf '%s\0' "${e#*$'\t'}"; done | LC_ALL=C sort -z -u; }
variant() {
  local v="$tmp/v$((nv += 1))" p e
  mkdir "$v" && : > "$v.new" && : > "$v.old" || return 1
  while IFS= read -r p || [ -n "$p" ]; do
    (cd "$v" && gx git apply --numstat -z "$in/$p" >> "$v.new" && gx git apply -R --numstat -z "$in/$p" >> "$v.old") || return 1
  done < "$1"
  cat "$v.new" "$v.old" | paths > "$v.all" && paths < "$v.new" > "$v.post" || return 1
  while IFS= read -r -d '' p; do
    git ls-tree -z "$root" -- ":(literal)$p" > "$v.entry" || return 1
    IFS= read -r -d '' e < "$v.entry" || continue
    [ "${e#*$'\t'}" = "$p" ] && e=${e%%$'\t'*} && mkdir -p -- "$(dirname -- "$v/$p")" || return 1
    case "$e" in
      "100644 blob "*) git cat-file blob "${e##* }" > "$v/$p" || return 1 ;;
      "100755 blob "*) git cat-file blob "${e##* }" > "$v/$p" && chmod 755 -- "$v/$p" || return 1 ;;
      "120000 blob "*) e=$(git cat-file blob "${e##* }" && printf x) && ln -s -- "${e%x}" "$v/$p" || return 1 ;;
      *) return 1 ;;
    esac
  done < "$v.all"
  while IFS= read -r p || [ -n "$p" ]; do (cd "$v" && gx git apply --binary --whitespace=nowarn "$in/$p") || return 1; done < "$1"
  while IFS= read -r -d '' p; do
    if [ -L "$v/$p" ]; then e=$(readlink -- "$v/$p" && printf x) && printf %s "${e%$'\n'x}" | gx git --git-dir="$tmp/probe" hash-object --stdin || return 1
    elif [ -f "$v/$p" ]; then gx git --git-dir="$tmp/probe" hash-object --no-filters -- "$v/$p" || return 1
    fi
  done < "$v.post" >> "$tmp/ids"
}
postbase() {
  local w p
  w=$(git rev-parse --verify -q "$want^{commit}") && root=$(git rev-list --max-parents=0 "$w") && [ -n "$root" ] || return 1
  case "$root" in *$'\n'*) return 1 ;; esac
  case ${#w} in
    40) other='\./([0-9a-f]{2}/[0-9a-f]{62}|pack/pack-[0-9a-f]{64}\.(idx|pack))'; p=sha1 ;;
    64) other='\./([0-9a-f]{2}/[0-9a-f]{38}|pack/pack-[0-9a-f]{40}\.(idx|pack))'; p=sha256 ;;
    *) return 1 ;;
  esac
  { gx git init -q --bare --object-format="$p" "$tmp/probe" 2> /dev/null || { [ "$p" = sha1 ] && gx git init -q --bare "$tmp/probe"; }; } || return 1
  empty=$(gx git --git-dir="$tmp/probe" hash-object --stdin < /dev/null) && [ ${#empty} -eq ${#w} ] && : > "$tmp/ids" || return 1
  while IFS= read -r p || [ -n "$p" ]; do printf '%s\n' "$p" > "$tmp/one" && variant "$tmp/one" < /dev/null || return 1; done < "$in/patches"
  [ ! -s "$in/patches" ] || variant "$in/patches" < /dev/null || return 1
  LC_ALL=C sort -u -o "$tmp/ids" "$tmp/ids"
}
ids=0; nv=0; prepo=$(pwd -P)
outside() { case "$1" in "$repo" | "$repo"/* | "$prepo" | "$prepo"/*) return 1 ;; esac; }
idsok() {
  if [ $ids = 0 ]; then if postbase; then ids=1; else ids=2; err stores "post-base blob ids"; fi; fi
  [ $ids = 1 ]
}
foreign() {
  local o x p
  [ -f "$in/patches" ] && outside "$1" && idsok && o=$(gx "${@:2}" rev-parse --git-path objects) && [ -n "$o" ] && [ "$(gx "${@:2}" hash-object --stdin < /dev/null)" = "$empty" ] || return 1
  x=$(cd "$o" && find . -mindepth 2 -maxdepth 2 -regextype posix-extended -regex "$other" -print -quit) && [ -z "$x" ] || return 1
  for p in "$o"/pack/pack-*.pack; do [ ! -e "$p" ] || [ -f "${p%.pack}.idx" ] || return 1; done
  gx "${@:2}" cat-file --batch-check < "$tmp/ids" > "$tmp/look" 2> "$tmp/look.err" && [ ! -s "$tmp/look.err" ] && [ "$(sed 's/$/ missing/' "$tmp/ids")" = "$(cat "$tmp/look")" ]
}
modok() {
  local p=${1#"$repo"/} e x
  [ -f "$1" ] && [ ! -L "$1" ] && [ ! -e "$gd/modules" ] && [ ! -L "$gd/modules" ] && git ls-tree -z "$want" -- ":(literal)$p" > "$tmp/gitmodules" && IFS= read -r -d '' e < "$tmp/gitmodules" && [ "${e#*$'\t'}" = "$p" ] || return 1
  case "$e" in "100644 blob "* | "100755 blob "*) e=${e%%$'\t'*} ;; *) return 1 ;; esac
  [ "$(git hash-object --no-filters -- "$1")" = "${e##* }" ] || return 1
  x=$(find "$(dirname "$1")" \( -path "$gd" -o -path "$repo/.git" \) -prune -o \( -name .git -o -type d ! \( -readable -executable \) \) -print -quit) && [ -z "$x" ]
}
if [ -e "$gd/objects/info/alternates" ]; then
  store alternates "$gd/objects/info/alternates"
  while IFS= read -r a || [ -n "$a" ]; do
    case "$a" in "" | "#"*) ;; /*) store reached "$a" ;; *) store reached "$gd/objects/$a" ;; esac
  done < "$gd/objects/info/alternates"
fi
if [ -n "${GIT_ALTERNATE_OBJECT_DIRECTORIES+x}" ]; then
  echo "STORE env $(enc GIT_ALTERNATE_OBJECT_DIRECTORIES)"; bad=$((bad + 1))
  rest="$GIT_ALTERNATE_OBJECT_DIRECTORIES:"
  while [ -n "$rest" ]; do a=${rest%%:*}; rest=${rest#*:}; [ -z "$a" ] || store reached "$a"; done
fi
find "$repo" -path "$gd" -prune -o \( -name .gitmodules -o -name .git \) -print0 -prune -o -type d ! \( -readable -executable \) -prune > "$tmp/nested" || err stores "find nested"
while IFS= read -r -d '' f; do
  case "$(basename "$f")" in .gitmodules) modok "$f" || store gitmodules "$f";; *) store nested "$f";; esac
done < "$tmp/nested"
find "$top" -regextype posix-extended \( -path "$r/proc" -o -path "$r/sys" -o -path "$r/sm-in" -o -path "$tmp" -o -path "$gd/objects" \) -prune \
  -o -type d ! \( -readable -executable \) -prune \
  -o -type f -name HEAD -fprint0 "$tmp/heads" \
  -o -type f -regex '.*/([0-9a-f]{2}/([0-9a-f]{38}|[0-9a-f]{62})|pack/pack-([0-9a-f]{40}|[0-9a-f]{64})\.(idx|pack))' -fprintf "$tmp/objdirs" '%h\0' \
  || err stores "find stores"
gs="$r/root/.claude/skills/gstack/.git"
while IFS= read -r -d '' h; do
  d=$(dirname "$h")
  isgit "$d" || continue
  [ "$d" = "$gd" ] && continue
  if [ "$d" = "$gs" ] && [ -s "$in/qa_pin" ] && [ "$(git --git-dir="$d" rev-parse --verify -q HEAD 2>/dev/null)" = "$(cat "$in/qa_pin")" ]; then continue; fi
  foreign "$d" git --git-dir="$d" && continue
  store store "$d"
done < "$tmp/heads"
LC_ALL=C sort -z -u "$tmp/objdirs" > "$tmp/objdirs.u" || err stores "sort"
last=
while IFS= read -r -d '' h; do
  o=${h%/*}
  [ "$o" = "$last" ] && continue
  last=$o
  case "$o" in */objects) isgit "${o%/objects}" && continue ;; esac
  foreign "$o" GIT_OBJECT_DIRECTORY="$o" git --git-dir="$tmp/probe" && continue
  store objects "$o"
done < "$tmp/objdirs.u"
echo "CHECK stores $([ $bad -eq 0 ] && echo ok || echo fail)"
bad=0
find "$top" \( -path "$r/proc" -o -path "$r/sys" -o -path "$r/sm-in" -o -path "$tmp" -o -path "$gd" \) -prune \
  -o -type d ! \( -readable -executable \) -fprint0 "$tmp/unreadable-dirs" -prune \
  -o -type f ! -readable -fprint0 "$tmp/unreadable-files" \
  -o -type f -print0 > "$tmp/found" || err scan "find"
cat "$tmp/unreadable-dirs" "$tmp/unreadable-files" | while IFS= read -r -d '' p; do printf 'UNREADABLE %s\n' "$(enc "$(rel "$p")")"; done
git ls-tree -r -z "$want" > "$tmp/tree" || err scan "git ls-tree"
while IFS= read -r -d '' e; do
  m=${e%%$'\t'*}; p=${e#*$'\t'}
  case "$m" in "100644 blob "* | "100755 blob "*) ;; *) continue ;; esac
  case "$p" in *$'\n'*) continue ;; esac
  [ -f "$p" ] && [ ! -L "$p" ] && [ -r "$p" ] && printf '%s\t%s\n' "${m##* }" "$p"
done < "$tmp/tree" > "$tmp/blobs"
cut -f2- "$tmp/blobs" | git hash-object --no-filters --stdin-paths > "$tmp/now" || err scan "git hash-object"
paste "$tmp/now" "$tmp/blobs" | awk -F'\t' '$1 == $2 { sub(/^[^\t]*\t[^\t]*\t/, ""); print }' | while IFS= read -r p; do printf '%s/%s\0' "$repo" "$p"; done > "$tmp/tracked" || err scan "git hash-object"
{ LC_ALL=C sort -z -o "$tmp/found" "$tmp/found" && LC_ALL=C sort -z -u -o "$tmp/tracked" "$tmp/tracked" && LC_ALL=C comm -z -23 "$tmp/found" "$tmp/tracked" > "$tmp/files"; } || err scan "sort or comm"
inbase() {
  local e m s
  : > "$tmp/name-in-base" && : > "$tmp/mark-lines" || return 1
  [ -s "$in/names" ] || [ -s "$in/markers" ] || return 0
  while IFS= read -r -d '' e; do e=${e%%$'\t'*}; case "$e" in "100644 blob "* | "100755 blob "*) printf '%s\n' "${e##* }" ;; esac; done < "$tmp/tree" | LC_ALL=C sort -u > "$tmp/base-ids" || return 1
  git cat-file --batch-check='%(objecttype)' < "$tmp/base-ids" > "$tmp/base-types" 2> "$tmp/base.err" && [ ! -s "$tmp/base.err" ] || return 1
  [ "$(wc -l < "$tmp/base-types")" -eq "$(wc -l < "$tmp/base-ids")" ] && [ "$(g -c -v -x -F blob "$tmp/base-types")" = 0 ] && mkfifo "$tmp/stream" || return 1
  pat markers -F < "$tmp/stream" > "$tmp/mark-lines" & m=$!
  git cat-file --batch= < "$tmp/base-ids" 2> "$tmp/base.err" | tee "$tmp/stream" | pat names -o -F -w > "$tmp/name-in-base"; s=$?
  [ $s -eq 0 ] || kill "$m" 2> /dev/null
  wait "$m" && [ $s -eq 0 ] && [ ! -s "$tmp/base.err" ]
}
pat() { if [ -s "$in/$1" ]; then LC_ALL=C grep -a "${@:2}" -f "$in/$1"; [ $? -le 1 ]; else cat > /dev/null; fi; }
inbase; ib=$?
[ $ib -eq 0 ] && g -v -x -F -f "$tmp/name-in-base" "$in/names" | g . > "$tmp/names" || err scan "grep base names"
[ $ib -eq 0 ] && g -x -F -f "$in/markers" "$tmp/mark-lines" > "$tmp/mark-in-base" && g -v -x -F -f "$tmp/mark-in-base" "$in/markers" | g . > "$tmp/markers" || err scan "grep base markers"
hit() { while IFS= read -r -d '' p && IFS= read -r m; do printf 'HIT %s %s %s\n' "$1" "$(enc "$(rel "$p")")" "$(enc "$m")"; done; }
scan() {
  [ -s "$tmp/$1s" ] || return 0
  xargs -0 -r sh -c 'grep "$@"; [ $? -le 1 ]' sh -a -D skip -H -Z -o -F "${@:2}" -f "$tmp/$1s" -- < "$tmp/files" > "$tmp/hits" || err scan "grep $1s"
  hit "$1" < "$tmp/hits"
}
scan name -w
scan marker
tr '\0' '\n' < "$tmp/files" | grep -E '\.(zip|whl|jar|gz)$|\.tar\.[^/]*$' | while IFS= read -r p; do
  case "$p" in "$repo"/*) continue ;; esac
  printf 'ARCHIVE %s\n' "$(enc "$(rel "$p")")"
done
echo "CHECK scan $([ $bad -eq 0 ] && echo done || echo fail)"
exit 0
