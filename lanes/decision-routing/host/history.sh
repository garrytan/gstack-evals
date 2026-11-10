#!/bin/sh
# Copyright (c) 2026 Garry Tan. MIT License.
# Decision-routing D7, after the harness mechanics lane's D7: a task's session image keeps only the base commit's git
# history in /testbed, so no ref, pseudo-ref, reflog or commit object reaches the upstream fix or its hidden tests.
#   history.sh strip            a RUN step in each task's environment/Dockerfile (host/history.ts), as root at build:
#                               deletes every ref and pseudo-ref that is not the base commit or an ancestor of it,
#                               expires the reflogs, prunes, then fails the build if part (a), (b) or (c) still fails
#   history.sh check <markers>  the host's history check, in a throwaway container of the built image with no network:
#                               one RESULT line of counts for all four parts
# (a) refs: every ref (tags, branches, remotes, notes, replace refs, stash, packed-refs) and every pseudo-ref
#     (FETCH_HEAD, ORIG_HEAD and the rest) points at the base or an ancestor, and there is no grafts file;
# (b) every commit object (git cat-file --batch-all-objects) is the base or an ancestor;
# (c) no alternates, no submodule object store, no worktree, and no other object store holding this repository's
#     commits past the base;
# (d) none of the task's runner-only markers (host/history.ts) is in a file outside the repository or untracked in it.
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

strip() {
  git for-each-ref --format='%(refname) %(objectname)' > "$W/refs0"
  while read -r n o; do
    ancestor "$(git rev-parse -q --verify "$o^{commit}" 2>/dev/null)" || git update-ref --no-deref -d "$n" || exit 1
  done < "$W/refs0"
  for f in $PSEUDO; do rm -f ".git/$f"; done
  rm -f .git/info/grafts
  git reflog expire --expire=now --expire-unreachable=now --all || exit 1
  git -c gc.auto=0 -c gc.cruftPacks=false gc --prune=now --quiet || exit 1
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
  cms=0; [ -d .git/modules ] && cms=1
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
  echo "head=$(echo "$B" | cut -c1-12) refs=$nref a_bad=$ar a_tags=$at pseudo=$ap pseudo_bad=$apb grafts=$gr commits=$nc b_later=$bc c_alt=$ca c_modstore=$cms c_gitmodules=$cmd c_gitlinks=$cl c_worktrees=$cw stores=$cn stores_this_repo=$cs stores_later=$csl"
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
    nm=$(grep -c . "$M"); mf=0; dout=0; dunt=0
    if [ "$nm" -gt 0 ]; then
      [ "$bc" -gt 0 ] && mf=$(git log --no-walk=unsorted --stdin -p --format=%H < "$W/later" 2>/dev/null | grep -aoF -f "$M" | sort -u | wc -l)
      find "$ROOT" -xdev \( -path "$R/proc" -o -path "$R/sys" -o -path "$R/dev" -o -path "$REPO" -o -path "$W" -o -path "$M" \) -prune -o -type f -print0 2>/dev/null | xargs -0 -r grep -laF -f "$M" 2>/dev/null > "$W/dout"
      git ls-files -o -z 2>/dev/null | xargs -0 -r grep -laF -f "$M" 2>/dev/null | sed "s|^|$REPO/|" > "$W/dunt"
      dout=$(wc -l < "$W/dout"); dunt=$(wc -l < "$W/dunt")
      cat "$W/dout" "$W/dunt" >&2
    fi
    echo "RESULT markers=$nm $(counts) later_with_markers=$mf d_outside=$dout d_untracked=$dunt" ;;
  *) echo "usage: history.sh strip | check <markers file>" >&2; exit 2 ;;
esac
