#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Plan section 4's wrap-up rule, run in the session container. "save <repo> <dir>" runs right after the session-end commit
# (capture.sh commit): it records S's head and inventory. "keep <repo> <dir>" runs after the wrap-up turn: it copies
# CHECKS.json from the repository root (a regular file only) to <dir>/CHECKS.json, prints PF_DISCARD <path> for every
# other path the wrap-up turn added, changed or deleted, puts the tree back to S, and prints one PF_WRAPUP line.
# "reset <repo> <dir>" puts the tree back to S only, before a wrap-up rerun. A mount point under the repository root (an
# image's VOLUME inside the repo dir) stays out of git clean, which cannot remove it; files the wrap-up turn left inside
# one are still removed by the inventory pass.
set -euo pipefail
cmd=$1
repo=$2
dir=$3
here=$(cd "$(dirname "$0")" && pwd)
g() { git -C "$repo" -c safe.directory='*' -c core.quotepath=off "$@"; }
reset() {
  local ex=() m
  if [ -r /proc/self/mountinfo ]; then
    while read -r _ _ _ _ m _; do case "$m" in "$repo"/*) ex+=(-e "/${m#"$repo"/}/");; esac; done < /proc/self/mountinfo
  fi
  g reset -q --hard "$(cat "$dir/s.head")"
  g clean -fdq ${ex[@]+"${ex[@]}"}
  bash "$here/capture.sh" inventory "$repo" > "$dir/now.inv"
  awk -F'\t' 'NR==FNR { a[$2] = 1; next } !($2 in a) { print $2 }' "$dir/s.inv" "$dir/now.inv" | while IFS= read -r f; do rm -f -- "$repo/$f"; done
}
case $cmd in
  save)
    mkdir -p "$dir"
    g rev-parse HEAD > "$dir/s.head"
    bash "$here/capture.sh" inventory "$repo" > "$dir/s.inv"
    ;;
  keep)
    rm -f "$dir/CHECKS.json"
    checks=0
    if [ -f "$repo/CHECKS.json" ] && [ ! -L "$repo/CHECKS.json" ]; then cp "$repo/CHECKS.json" "$dir/CHECKS.json"; checks=1; fi
    bash "$here/capture.sh" inventory "$repo" > "$dir/after.inv"
    { awk -F'\t' 'NR==FNR { a[$2] = $1; next } !($2 in a) || a[$2] != $1 { print $2 }' "$dir/s.inv" "$dir/after.inv"
      awk -F'\t' 'NR==FNR { a[$2] = 1; next } !($2 in a) { print $2 }' "$dir/after.inv" "$dir/s.inv"; } | grep -vx 'CHECKS.json' | LC_ALL=C sort -u > "$dir/discarded" || true
    reset
    while IFS= read -r f; do printf 'PF_DISCARD %s\n' "$f"; done < "$dir/discarded"
    printf 'PF_WRAPUP checks=%s discarded=%s\n' "$checks" "$(wc -l < "$dir/discarded" | tr -d ' ')"
    ;;
  reset) reset ;;
  *) echo "usage: wrapup.sh save|keep|reset <repo> <dir>" >&2; exit 2 ;;
esac
