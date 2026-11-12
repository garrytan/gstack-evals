#!/bin/bash
# usage: diag-all.sh eco:nth ...   runs each diagnostic in parallel, prints outputs in order
D=/dev/shm/eb525/diag-out; rm -rf $D; mkdir -p $D
for spec in "$@"; do e=${spec%%:*}; n=${spec##*:}; bash ~/work/kit/diag-go.sh "$e" "$n" > $D/$e-$n.txt 2>&1 & done
wait
for spec in "$@"; do e=${spec%%:*}; n=${spec##*:}; echo "=== $e #$n"; cat $D/$e-$n.txt; done
