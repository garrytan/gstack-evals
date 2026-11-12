#!/usr/bin/env bash
# eng-build kit: rerun one unit shard through eb units' own resume path until it exits 0 (at most MAX runs).
# A unit whose build finished but whose gate crashed has eb.json and no admission.json; the next run reads it back as
# E_EB_CACHE_STALE (no_admission_record). Its id is appended to crashed-s<i>.txt before each rerun. Counts only on stdout.
set -uo pipefail
. ~/eb/env.sh
i=$1; MAX=${2:-8}; SEED=$(cat /dev/shm/eb525/seed-units.txt)
cd ~/work/gstack-evals
for k in $(seq 1 $MAX); do
  for d in /dev/shm/eb525/units-s$i/*/; do [ -f "$d/eb.json" ] && [ ! -f "$d/admission.json" ] && basename "$d" >> /dev/shm/eb525/crashed-s$i.txt; done
  sort -u -o /dev/shm/eb525/crashed-s$i.txt /dev/shm/eb525/crashed-s$i.txt 2>/dev/null
  L=/dev/shm/eb525/units-s$i.r$k.log
  sg docker -c "bin/gstack-evals eb units --specs /dev/shm/eb525/run/specs-s$i.json --out /dev/shm/eb525/units-s$i --work /dev/shm/eb525/work-s$i --labels /dev/shm/eb525/labels-s$i.json --seed $SEED --repos /dev/shm/eb525/run/trees" > $L 2>&1
  rc=$?; echo "exit=$rc" >> $L
  [ $rc -eq 0 ] && break
done
echo "resume-s$i done runs=$k rc=$rc" >> /dev/shm/eb525/resume.log
