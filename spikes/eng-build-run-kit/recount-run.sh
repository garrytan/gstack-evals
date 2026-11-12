#!/usr/bin/env bash
# eng-build kit: merge the shards (skipped when already merged), then the frozen recount on comparison plus reserve. Writes recount.log.
set -uo pipefail
. ~/eb/env.sh
[ -f /dev/shm/eb525/units/units.json ] || python3 ~/work/kit/merge-units.py > /dev/shm/eb525/merge.log 2>&1
cat /dev/shm/eb525/ids-comparison.txt /dev/shm/eb525/ids-reserve.txt | grep . > /dev/shm/eb525/ids-cr.txt
mkdir -p /dev/shm/eb525/recount-work
C=$(cat /dev/shm/eb525/custody-ids.txt); CARG=""; [ -n "$C" ] && CARG="--custody $C"
cd ~/work/kit
sg docker -c "bun recount-par.ts --units /dev/shm/eb525/units --work /dev/shm/eb525/recount-work --jobs 2 $CARG --ids /dev/shm/eb525/ids-cr.txt" > /dev/shm/eb525/recount.log 2>&1
echo "exit=$?" >> /dev/shm/eb525/recount.log
