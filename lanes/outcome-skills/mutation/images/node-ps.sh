#!/bin/sh
# Copyright (c) 2026 Garry Tan. MIT License.
# A minimal ps for images without procps. Stryker stops its test-runner workers through tree-kill, which runs
# "ps -o pid --no-headers --ppid <pid>" on Linux; this answers that one form from /proc and, like procps, exits 1 when
# no process matches.
ppid=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ppid) ppid="$2"; shift 2 ;;
    *) shift ;;
  esac
done
found=1
for d in /proc/[0-9]*; do
  s=$(cat "$d/stat" 2>/dev/null) || continue
  rest=${s##*) }
  set -- $rest
  if [ "$2" = "$ppid" ]; then
    echo "   ${d#/proc/}"
    found=0
  fi
done
exit $found
