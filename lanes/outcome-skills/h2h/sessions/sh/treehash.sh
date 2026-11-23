#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# "treehash.sh <repo>" prints "H2H_TREE <sha256> files=<n>": the sha256 of the sorted list of every file and symlink the
# main checkout holds (tracked, or untracked and not ignored), each as its mode and content sha256 (a symlink as
# link:<target>) and its path. h2h_turns.py runs it before the first turn and after each one, so a continuation after
# which the tree did not change counts as spurious (post section 4). A nested repository's directory, a path holding a tab
# or newline, and a tracked file the session deleted are left out, so a deletion changes the hash. Every git call runs
# with no system or global config, no hooks, no fsmonitor and no excludes file.
set -euo pipefail
cd "$1"
list=$(mktemp)
trap 'rm -f "$list" "$list.out"' EXIT
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c safe.directory='*' -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.excludesFile=/dev/null ls-files -z --cached --others --exclude-standard |
  while IFS= read -r -d '' p; do
    case $p in *$'\n'* | *$'\t'*) continue ;; esac
    if [ -L "$p" ]; then
      printf 'link:%s\t%s\n' "$(readlink -- "$p")" "$p" >> "$list.out"
    elif [ -f "$p" ]; then
      printf './%s\0' "$p" >> "$list"
    fi
  done
touch "$list.out"
if [ -s "$list" ]; then
  paste -d ' ' <(xargs -0 stat -c '%a' -- < "$list") <(xargs -0 sha256sum -- < "$list") | sed -E 's/^([0-7]+) ([0-9a-f]{64})  \.\/(.*)$/\1:\2\t\3/' >> "$list.out"
fi
n=$(sort -u "$list.out" | wc -l | tr -d ' ')
echo "H2H_TREE $(LC_ALL=C sort -u "$list.out" | sha256sum | cut -c1-64) files=$n"
