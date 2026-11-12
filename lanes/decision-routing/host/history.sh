#!/bin/sh
# Copyright (c) 2026 Garry Tan. MIT License.
# Decision-routing D7, after the harness mechanics lane's D7: a task's session image keeps only the base commit's git
# history in /testbed, so no ref, pseudo-ref, reflog or commit object reaches the upstream fix or its hidden tests.
#   history.sh strip            a RUN step in each task's environment/Dockerfile (host/history.ts), as root at build:
#                               deletes every ref and pseudo-ref that is not the base commit or an ancestor of it,
#                               expires the reflogs, prunes, trims each submodule store under .git/modules the same way to
#                               the commit the base tree pins for it (deleting a store the base pins nothing for), then
#                               fails the build if part (a), (b) or (c) still fails
#   history.sh check <markers>  the host's history check, in a throwaway container of the built image with no network:
#                               one RESULT line of counts for all four parts
# (a) refs: every ref (tags, branches, remotes, notes, replace refs, stash, packed-refs) and every pseudo-ref
#     (FETCH_HEAD, ORIG_HEAD and the rest) points at the base or an ancestor, and there is no grafts file;
# (b) every commit object (git cat-file --batch-all-objects) is the base or an ancestor;
# (c) no alternates, no submodule store holding a commit past the one the base tree pins for it (or a store the base
#     pins nothing for), no worktree, and no other object store holding this repository's commits past the base;
# (d) none of the task's runner-only markers (host/history.ts) is in a file outside the repository (a file another
#     project's package installed, one a dist-info RECORD under site-packages or dist-packages lists with a top-level
#     name the base tree does not hold at its root, src/ or lib/, is counted apart as d_thirdparty), in a file under it
#     that the base commit's tree (git ls-tree -r) does not hold byte for byte (untracked, ignored, staged-only or
#     modified; the index is never taken as base content), in an object the base commit does not reach, or in git's own
#     files outside objects/ (the index, logs, messages).
# Marker text never reaches stdout; the paths of (d) hits go to stderr. DR_REPO, DR_ROOT and DR_WORK move /testbed, /
# and the scratch dir for tests.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*' GIT_PAGER=cat
REPO=${DR_REPO:-/testbed}
ROOT=${DR_ROOT:-/}
R=${ROOT%/}
W=${DR_WORK:-/dev/shm/.dr-history}
PSEUDO="FETCH_HEAD ORIG_HEAD MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_HEAD AUTO_MERGE"
mkdir -p "$W" || exit 9
cd "$REPO" 2>/dev/null || { echo "RESULT error=no_repo"; exit 9; }
B=$(git rev-parse -q --verify 'HEAD^{commit}') || { echo "RESULT error=no_head"; exit 9; }
git rev-list "$B" | sort -u > "$W/anc"

ancestor() { [ -n "$1" ] && grep -qxF "$1" "$W/anc"; }

modstores() { [ -d .git/modules ] && find .git/modules -name HEAD -type f 2>/dev/null | while IFS= read -r h; do [ -d "${h%/HEAD}/objects" ] && echo "${h%/HEAD}"; done; }

pin() {
  p=$(git config --blob "$B:.gitmodules" --get "submodule.${1#.git/modules/}.path" 2>/dev/null) || return 0
  git ls-tree "$B" -- "$p" | awk '$1=="160000"{print $3}'
}

pastpin() {
  git --git-dir="$1" rev-list "$2" 2>/dev/null | sort -u > "$W/manc"
  git --git-dir="$1" cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname)' 2>/dev/null | awk '$1=="commit"{print $2}' | sort -u | comm -23 - "$W/manc" | wc -l
}

strip() {
  git for-each-ref --format='%(refname) %(objectname)' > "$W/refs0"
  while read -r n o; do
    ancestor "$(git rev-parse -q --verify "$o^{commit}" 2>/dev/null)" || git update-ref --no-deref -d "$n" || exit 1
  done < "$W/refs0"
  for f in $PSEUDO; do rm -f ".git/$f"; done
  rm -f .git/info/grafts
  git reflog expire --expire=now --expire-unreachable=now --all || exit 1
  git -c gc.auto=0 -c gc.cruftPacks=false gc --prune=now --quiet || exit 1
  modstores > "$W/mods0"
  while IFS= read -r d; do
    L=$(pin "$d")
    [ -n "$L" ] || { rm -rf "$d"; continue; }
    git --git-dir="$d" rev-list "$L" 2>/dev/null | sort -u > "$W/manc"
    git --git-dir="$d" for-each-ref --format='%(refname) %(objectname)' > "$W/mrefs0"
    while read -r n o; do
      c=$(git --git-dir="$d" rev-parse -q --verify "$o^{commit}" 2>/dev/null)
      [ -n "$c" ] && grep -qxF "$c" "$W/manc" || git --git-dir="$d" update-ref --no-deref -d "$n" || exit 1
    done < "$W/mrefs0"
    for f in $PSEUDO; do rm -f "$d/$f"; done
    rm -f "$d/info/grafts"
    git --git-dir="$d" reflog expire --expire=now --expire-unreachable=now --all || exit 1
    git --git-dir="$d" -c gc.auto=0 -c gc.cruftPacks=false gc --prune=now --quiet || exit 1
  done < "$W/mods0"
}

measure() {
  git for-each-ref --format='%(refname) %(objectname)' > "$W/refs"
  nref=$(wc -l < "$W/refs"); ar=0; at=0
  while read -r n o; do
    ancestor "$(git rev-parse -q --verify "$o^{commit}" 2>/dev/null)" && continue
    ar=$((ar+1)); case "$n" in refs/tags/*) at=$((at+1));; esac
  done < "$W/refs"
  ap=0; apb=0
  for f in $PSEUDO; do
    [ -e ".git/$f" ] || continue
    ap=$((ap+1)); ok=0
    for s in $(grep -oE '[0-9a-f]{40}' ".git/$f"); do ancestor "$s" || ok=1; done
    apb=$((apb+ok))
  done
  gr=0; [ -s .git/info/grafts ] && gr=1
  git cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname)' > "$W/objs"
  awk '$1=="commit"{print $2}' "$W/objs" | sort -u > "$W/commits"
  comm -23 "$W/commits" "$W/anc" > "$W/later"
  nc=$(wc -l < "$W/commits"); bc=$(wc -l < "$W/later")
  ca=0; for f in .git/objects/info/alternates .git/objects/info/http-alternates; do [ -s "$f" ] && ca=$((ca+1)); done
  [ -n "${GIT_ALTERNATE_OBJECT_DIRECTORIES:-}" ] && ca=$((ca+1))
  cms=0; nms=0
  modstores > "$W/mods"
  while IFS= read -r d; do
    nms=$((nms+1)); L=$(pin "$d")
    [ -n "$L" ] && [ "$(pastpin "$d" "$L")" -eq 0 ] || cms=$((cms+1))
  done < "$W/mods"
  cmd=0; [ -e .gitmodules ] && cmd=1
  cl=$(git ls-files -s | awk '$1=="160000"' | wc -l)
  cw=0; [ -d .git/worktrees ] && cw=1
  find "$ROOT" -xdev \( -path "$R/proc" -o -path "$R/sys" -o -path "$R/dev" -o -path "$REPO/.git" -o -path "$W" \) -prune -o \( -name .git -o -name '*.pack' -o -name packed-refs \) -print 2>/dev/null > "$W/stores"
  cn=$(wc -l < "$W/stores"); cs=0; csl=0
  while read -r p; do
    case "$p" in *.pack) d=${p%/objects/pack/*};; */packed-refs) d=${p%/packed-refs};; *) d=$p;; esac
    [ -f "$d" ] && d=$(sed -n 's/^gitdir: //p' "$d")
    [ -n "$d" ] && git --git-dir="$d" cat-file -e "$B^{commit}" 2>/dev/null || continue
    cs=$((cs+1))
    n=$(git --git-dir="$d" cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname)' 2>/dev/null | awk '$1=="commit"{print $2}' | sort -u | comm -23 - "$W/anc" | wc -l)
    csl=$((csl+n))
  done < "$W/stores"
  fa=$((ar+apb+gr)); fb=$bc; fc=$((ca+cms+cw+csl))
}

counts() {
  echo "head=$(echo "$B" | cut -c1-12) refs=$nref a_bad=$ar a_tags=$at pseudo=$ap pseudo_bad=$apb grafts=$gr commits=$nc b_later=$bc c_alt=$ca c_modstore=$cms modstores=$nms c_gitmodules=$cmd c_gitlinks=$cl c_worktrees=$cw stores=$cn stores_this_repo=$cs stores_later=$csl"
}

case "${1:-}" in
  strip)
    strip
    measure
    [ $((fa+fb+fc)) -eq 0 ] && { echo "dr-history: base $(echo "$B" | cut -c1-12) kept with its $nc ancestors; nothing past it"; exit 0; }
    echo "DR_HISTORY_LEAK: /testbed still reaches past its base commit after the strip: $(counts)" >&2
    exit 1 ;;
  check)
    M=$2; [ -r "$M" ] || { echo "RESULT error=no_markers"; exit 9; }
    measure
    nm=$(grep -c . "$M"); mf=0; dout=0; dthird=0; dunt=0; dwt=0; dobj=0; dmeta=0
    git -c core.quotePath=false ls-tree -r "$B" | awk -F '\t' '{split($1, a, " "); print a[3] "\t" $2}' | LC_ALL=C sort > "$W/base"
    find . -path ./.git -prune -o -type f -print | sed 's|^\./||' | LC_ALL=C sort > "$W/files"
    if git hash-object --no-filters --stdin-paths < "$W/files" > "$W/shas" 2>/dev/null && [ "$(wc -l < "$W/shas")" -eq "$(wc -l < "$W/files")" ]; then
      paste "$W/shas" "$W/files" | LC_ALL=C sort | LC_ALL=C comm -23 - "$W/base" | cut -f2- > "$W/differ"
    else
      cp "$W/files" "$W/differ"
    fi
    ndiff=$(wc -l < "$W/differ")
    git rev-list --objects "$B" | cut -d' ' -f1 | sort -u > "$W/reach"
    awk '{print $2}' "$W/objs" | sort -u | comm -23 - "$W/reach" > "$W/unreached"
    nunr=$(wc -l < "$W/unreached")
    if [ "$nm" -gt 0 ]; then
      [ "$bc" -gt 0 ] && mf=$(git log --no-walk=unsorted --stdin -p --format=%H < "$W/later" 2>/dev/null | grep -aoF -f "$M" | sort -u | wc -l)
      find "$ROOT" -xdev \( -path "$R/proc" -o -path "$R/sys" -o -path "$R/dev" -o -path "$REPO" -o -path "$W" -o -path "$M" \) -prune -o -type f -print0 2>/dev/null | xargs -0 -r grep -laF -f "$M" 2>/dev/null > "$W/dhits"
      { git ls-tree --name-only "$B"; git ls-tree --name-only "$B:src" 2>/dev/null; git ls-tree --name-only "$B:lib" 2>/dev/null; } | sed 's/[.]py$//' | sort -u > "$W/tops"
      : > "$W/dout"; : > "$W/dthird"
      while IFS= read -r p; do
        sp=$(echo "$p" | sed -n 's|^\(.*/[a-z]*-packages\)/.*|\1|p'); rel=${p#"$sp"/}; top=${rel%%/*}
        if [ -n "$sp" ] && ! grep -qxF "${top%.py}" "$W/tops" && awk -F, -v r="$rel" '$1==r{f=1} END{exit !f}' "$sp"/*.dist-info/RECORD 2>/dev/null; then echo "$p" >> "$W/dthird"; else echo "$p" >> "$W/dout"; fi
      done < "$W/dhits"
      git ls-files -o -z 2>/dev/null | xargs -0 -r grep -laF -f "$M" 2>/dev/null | sed "s|^|$REPO/|" > "$W/dunt"
      tr '\n' '\0' < "$W/differ" | xargs -0 -r grep -laF -f "$M" 2>/dev/null | sed "s|^|$REPO/|" > "$W/dwt"
      [ "$nunr" -gt 0 ] && dobj=$(git cat-file --batch < "$W/unreached" 2>/dev/null | grep -aoF -f "$M" | sort -u | wc -l)
      find .git -path .git/objects -prune -o -type f -print0 2>/dev/null | xargs -0 -r grep -laF -f "$M" 2>/dev/null > "$W/dmeta"
      dout=$(wc -l < "$W/dout"); dthird=$(wc -l < "$W/dthird"); dunt=$(wc -l < "$W/dunt"); dwt=$(wc -l < "$W/dwt"); dmeta=$(wc -l < "$W/dmeta")
      cat "$W/dout" "$W/dwt" "$W/dmeta" >&2
      sed 's/^/third-party: /' "$W/dthird" >&2
    fi
    echo "RESULT markers=$nm $(counts) later_with_markers=$mf not_in_base_files=$ndiff unreached_objects=$nunr d_outside=$dout d_thirdparty=$dthird d_untracked=$dunt d_worktree=$dwt d_objects=$dobj d_gitmeta=$dmeta" ;;
  *) echo "usage: history.sh strip | check <markers file>" >&2; exit 2 ;;
esac
