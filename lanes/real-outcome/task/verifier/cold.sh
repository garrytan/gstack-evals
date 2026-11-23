#!/bin/sh
# Copyright (c) 2026 Garry Tan. MIT License.
# gstack-evals verifier, cold rebuild (lanes/real-outcome/task/SPEC.md, eng-review build read). Verifier-owned: it runs
# as root with no network in a container from the task image, after prepare.sh, and never runs the tree's code.
# MODE=clean removes ignored files the tree brought that the image's own tree lacks (stale build outputs) and hashes
# the files that remain. With BUILD=1 it hands the tree, installed dependencies aside, to the run user, so the rebuild
# can write its outputs. MODE=seal, after the rebuild, deletes protected files gold lacks, restores every hidden test
# file and every installed-dependency dir from the image again, hands the tree back to root and hashes it.
set -eu
SRC=${SRC:-/testbed}
V=${V:-/verifier}
OUT=${OUT:-/work}
STATUS=${STATUS:-/status}
MODE=${MODE:-clean}
BUILD=${BUILD:-0}
set -f
cd "$OUT"
G() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c safe.directory='*' "$@"; }
DEPRE='(^|/)(\.git|node_modules|\.venv|venv|\.tox|__pypackages__)(/|$)'
listing() { G ls-files -z "$@" | tr '\0' '\n' | grep -v -E "$DEPRE" || true; }
hashes() {
  listing -c -o --exclude-standard | LC_ALL=C sort -u | while IFS= read -r p; do
    if [ -L "$p" ]; then
      printf '%s  %s\n' "$(printf 'link:%s' "$(readlink -- "$p")" | sha256sum | cut -c1-64)" "$p"
    elif [ -f "$p" ]; then
      sha256sum -- "$p"
    fi
  done > "$1"
}

clear_path() {
  acc=""
  oldifs=$IFS
  IFS=/
  set -- $1
  IFS=$oldifs
  n=$#
  i=0
  for c in "$@"; do
    i=$((i + 1))
    acc=${acc:+$acc/}$c
    if [ -L "$acc" ] || { [ "$i" -lt "$n" ] && [ -e "$acc" ] && [ ! -d "$acc" ]; }; then rm -f -- "$acc"; fi
  done
}

if [ "$MODE" = clean ]; then
  : > "$STATUS/cold-removed.txt"
  listing -o -i --exclude-standard | while IFS= read -r p; do
    if [ -f "$SRC/$p" ] && [ ! -L "$p" ] && [ ! -L "$SRC/$p" ] && cmp -s -- "$SRC/$p" "$p"; then continue; fi
    rm -rf -- "$p"
    echo "$p" >> "$STATUS/cold-removed.txt"
  done
  hashes "$STATUS/hash-a.txt"
  if [ "$BUILD" = 1 ]; then
    find . \( -name .git -o -name .venv -o -name venv -o -name node_modules -o -name .tox -o -name __pypackages__ \) -prune -o -exec chown -h 10001:10001 {} +
  fi
  echo "clean=done" > "$STATUS/cold.txt"
  exit 0
fi

if [ "$BUILD" = 1 ]; then
  find . \( -name .git -o -name .venv -o -name venv -o -name node_modules -o -name .tox -o -name __pypackages__ \) -prune -o \( -type f -o -type l \) -print | sed 's|^\./||' | LC_ALL=C sort > "$STATUS/seal-all.txt"
  grep -E -f "$V/protect.ere" "$STATUS/seal-all.txt" > "$STATUS/seal-protected.txt" || true
  LC_ALL=C sort "$V/restore.list" > "$STATUS/seal-restore.sorted"
  LC_ALL=C comm -23 "$STATUS/seal-protected.txt" "$STATUS/seal-restore.sorted" | while IFS= read -r p; do rm -f -- "$p"; done
  while IFS= read -r p; do
    clear_path "$p"
    mkdir -p -- "$(dirname -- "$p")"
    rm -rf -- "$p"
    cp -p -- "$V/restore/$p" "$p"
  done < "$V/restore.list"
  deps() { (cd "$1" && find . -name .git -prune -o \( -name .venv -o -name venv -o -name node_modules -o -name .tox -o -name __pypackages__ \) -prune -print) | sed 's|^\./||'; }
  { deps "$SRC"; deps .; } | LC_ALL=C sort -u | while IFS= read -r d; do
    clear_path "$d"
    if [ -d "$SRC/$d" ] && [ ! -L "$SRC/$d" ] && [ -d "$d" ] && diff -rq --no-dereference -- "$SRC/$d" "$d" >/dev/null 2>&1; then continue; fi
    rm -rf -- "$d"
    if [ -e "$SRC/$d" ] || [ -L "$SRC/$d" ]; then
      mkdir -p -- "$(dirname -- "$d")"
      cp -a -- "$SRC/$d" "$d"
    fi
  done
  chown -R -h 0:0 .
fi
chmod -R a+rX .
hashes "$STATUS/hash-b.txt"
echo "seal=done" >> "$STATUS/cold.txt"
