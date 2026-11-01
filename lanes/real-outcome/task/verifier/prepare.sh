#!/bin/sh
# Copyright (c) 2026 Garry Tan. MIT License.
# gstack-evals real-outcome verifier, prepare phase (lanes/real-outcome/task/SPEC.md). Verifier-owned: it runs as root
# with no network and an empty environment in a container from the task image, and never runs the tree's code.
# It copies the pristine repository with its installed dependencies, applies the tree under test, then makes gold's
# test files and runner config the only ones present: files the tree added at protected paths are deleted, no symlink
# may stand at or above a restored path, and every restored path holds gold's bytes.
set -eu
SRC=${SRC:-/testbed}
V=${V:-/verifier}
PATCH=${PATCH:-/input/tree.patch}
OUT=${OUT:-/work}
STATUS=${STATUS:-/status}
RELEASE_EDITS=${RELEASE_EDITS:-0}

set -f
DEPS=".venv venv node_modules .tox __pypackages__"
: > "$STATUS/unlinked.txt"
: > "$STATUS/skipped.txt"
: > "$STATUS/restored.txt"

# Removes every symlink at or above path $1, and any file standing where $1 needs a directory.
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
    if [ -L "$acc" ] || { [ "$i" -lt "$n" ] && [ -e "$acc" ] && [ ! -d "$acc" ]; }; then
      rm -f -- "$acc"
      echo "$acc" >> "$STATUS/unlinked.txt"
    fi
  done
}

cp -a "$SRC/." "$OUT/"
cd "$OUT"
if [ -s "$PATCH" ]; then
  set --
  for d in $DEPS; do set -- "$@" "--exclude=$d" "--exclude=$d/*" "--exclude=*/$d" "--exclude=*/$d/*"; done
  if ! git -c core.hooksPath=/dev/null -c core.fsmonitor=false apply --verbose --whitespace=nowarn "$@" "$PATCH" 2>"$STATUS/apply.log"; then
    grep -v -e "^Checking patch " -e "^Skipped patch " -e "^Applied patch " "$STATUS/apply.log" > "$STATUS/apply.err" || true
    echo "patch=failed" > "$STATUS/prepare.txt"
    exit 3
  fi
  sed -n "s/^Skipped patch '\(.*\)'\.$/\1/p" "$STATUS/apply.log" > "$STATUS/skipped.txt"
  echo "patch=applied" > "$STATUS/prepare.txt"
else
  echo "patch=none" > "$STATUS/prepare.txt"
fi

# Installed dependencies come only from the image, whatever the patch's format or path quoting: git apply skipped
# their sections above, and every dependency directory the tree still changed, created or replaced is reset to the
# image's copy.
deps() { (cd "$1" && find . -name .git -prune -o \( -name .venv -o -name venv -o -name node_modules -o -name .tox -o -name __pypackages__ \) -prune -print) | sed 's|^\./||'; }
{ deps "$SRC"; deps .; } | LC_ALL=C sort -u > "$STATUS/depdirs.txt"
while IFS= read -r d; do
  clear_path "$d"
  if [ -d "$SRC/$d" ] && [ ! -L "$SRC/$d" ] && [ -d "$d" ] && diff -rq --no-dereference -- "$SRC/$d" "$d" >/dev/null 2>&1; then continue; fi
  rm -rf -- "$d"
  if [ -e "$SRC/$d" ] || [ -L "$SRC/$d" ]; then
    mkdir -p -- "$(dirname -- "$d")"
    cp -a -- "$SRC/$d" "$d"
  fi
  echo "$d" >> "$STATUS/restored.txt"
done < "$STATUS/depdirs.txt"

find . \( -name .git -o -name .venv -o -name venv -o -name node_modules -o -name .tox -o -name __pypackages__ \) -prune -o \( -type f -o -type l \) -print | sed 's|^\./||' | LC_ALL=C sort > "$STATUS/all.txt"
grep -E -f "$V/protect.ere" "$STATUS/all.txt" > "$STATUS/protected.txt" || true
LC_ALL=C sort "$V/restore.list" > "$STATUS/restore.sorted"
LC_ALL=C comm -23 "$STATUS/protected.txt" "$STATUS/restore.sorted" > "$STATUS/deleted.txt"
while IFS= read -r p; do rm -f -- "$p"; done < "$STATUS/deleted.txt"

while IFS= read -r p; do
  clear_path "$p"
  mkdir -p -- "$(dirname -- "$p")"
  rm -rf -- "$p"
  cp -p -- "$V/restore/$p" "$p"
done < "$V/restore.list"

# The pytest entry reads ini options only from gold's config, placed at the tree root so its relative paths resolve.
set +f
if [ -d "$V/config" ]; then
  for f in "$V"/config/*; do
    [ -f "$f" ] || continue
    case "$f" in
      *.toml) ext=toml ;;
      *.cfg) ext=cfg ;;
      *) ext=ini ;;
    esac
    rm -rf -- "./.real-verifier-config.$ext"
    cp -- "$f" "./.real-verifier-config.$ext"
  done
fi

if [ "$RELEASE_EDITS" = "1" ]; then
  echo "9.9.9.9" > VERSION
  printf '## 9.9.9.9\n\n- release edit from the V6 check\n' >> CHANGELOG.md
  printf -- '- [ ] release edit from the V6 check\n' >> TODOS.md
fi

chmod -R a+rX .
echo "done" >> "$STATUS/prepare.txt"
chmod -R a+rw "$STATUS"
