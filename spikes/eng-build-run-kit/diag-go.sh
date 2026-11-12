#!/bin/bash
. ~/eb/env.sh; cd ~/work/kit
ECO=${1:-go}; NTH=${2:-1}
i=0
for a in /dev/shm/eb525/units-s*/er-*/admission.json; do
  grep -q no_functional_pass $a || continue
  d=$(dirname $a)
  [ "$(jq -r '[.groups[].eco]|unique|join("+")' $d/eb.json)" = "$ECO" ] || continue
  i=$((i+1)); [ $i -eq $NTH ] || continue
  G=$d; break
done
[ -n "$G" ] || { echo "no unit $ECO $NTH"; exit 1; }
echo "unit digest $(printf %s "$(basename $G)" | sha256sum | cut -c1-8) set=$(jq -r '.set // empty' $G/eb.json 2>/dev/null)"
W=/dev/shm/eb525/diag-$ECO-$NTH; rm -rf "$W"; mkdir -p "$W"
sg docker -c "bun diag-grade.ts $G $W" 2>&1 | sed 's/er-[0-9a-f]\{10\}/er-ID/g' | cut -c1-600 | tail -40
rm -rf "$W"
