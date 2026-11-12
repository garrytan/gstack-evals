#!/usr/bin/env bash
# eng-build kit: build units in N shards, each its own out dir and labels file, detached.
set -euo pipefail
. ~/eb/env.sh
N=$1; SEED=$(cat /dev/shm/eb525/seed-units.txt)
python3 ~/work/kit/shard.py /dev/shm/eb525/run/specs.json $N
cd ~/work/gstack-evals
for i in $(seq 0 $((N-1))); do
  mkdir -p /dev/shm/eb525/units-s$i /dev/shm/eb525/work-s$i
  setsid -f bash -c "sg docker -c 'bin/gstack-evals eb units --specs /dev/shm/eb525/run/specs-s$i.json --out /dev/shm/eb525/units-s$i --work /dev/shm/eb525/work-s$i --labels /dev/shm/eb525/labels-s$i.json --seed $SEED --repos /dev/shm/eb525/run/trees' > /dev/shm/eb525/units-s$i.log 2>&1; echo exit=\$? >> /dev/shm/eb525/units-s$i.log" < /dev/null > /dev/null 2>&1
  sleep 20
done
echo launched $N
