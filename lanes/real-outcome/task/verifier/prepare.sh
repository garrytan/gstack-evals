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

cp -a "$SRC/." "$OUT/"
cd "$OUT"
if [ -s "$PATCH" ]; then
  if ! git -c core.hooksPath=/dev/null -c core.fsmonitor=false apply --whitespace=nowarn "$PATCH" 2>"$STATUS/apply.err"; then
    echo "patch=failed" > "$STATUS/prepare.txt"
    exit 3
  fi
  echo "patch=applied" > "$STATUS/prepare.txt"
else
  echo "patch=none" > "$STATUS/prepare.txt"
fi

set -f
find . \( -name .git -o -name .venv -o -name venv -o -name node_modules -o -name .tox -o -name __pypackages__ \) -prune -o \( -type f -o -type l \) -print | sed 's|^\./||' | LC_ALL=C sort > "$STATUS/all.txt"
grep -E -f "$V/protect.ere" "$STATUS/all.txt" > "$STATUS/protected.txt" || true
LC_ALL=C sort "$V/restore.list" > "$STATUS/restore.sorted"
LC_ALL=C comm -23 "$STATUS/protected.txt" "$STATUS/restore.sorted" > "$STATUS/deleted.txt"
while IFS= read -r p; do rm -f -- "$p"; done < "$STATUS/deleted.txt"

: > "$STATUS/unlinked.txt"
while IFS= read -r p; do
  acc=""
  oldifs=$IFS
  IFS=/
  set -- $p
  IFS=$oldifs
  n=$#
  i=0
  for c in "$@"; do
    i=$((i + 1))
    acc=${acc:+$acc/}$c
    if [ -L "$acc" ]; then
      rm -f -- "$acc"
      echo "$acc" >> "$STATUS/unlinked.txt"
    elif [ "$i" -lt "$n" ] && [ -e "$acc" ] && [ ! -d "$acc" ]; then
      rm -f -- "$acc"
      echo "$acc" >> "$STATUS/unlinked.txt"
    fi
  done
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
