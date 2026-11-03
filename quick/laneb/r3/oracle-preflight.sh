#!/usr/bin/env bash
# R3 amendment 4 oracle preflight driver, one shard (plan section 4 item 5), adapted from amendment 3's
# oracle-preflight.sh.txt. Runs on the Opus run thread's own machine. It checks that the ledger is item r3a4-oracle's,
# approved at $20, reserves a VM block, brings up one fresh VM with the pinned ubi-runner.sh copy, syncs the export's
# quick/laneb/runner (work/runner), the shard's run dir (work/run) and oracle-pass.sh (work/preflight), runs the pin's
# vm-bootstrap.sh, records the VM's IPv6 /64, then runs pass 1 and pass 2 of oracle-pass.sh in turn, each detached and
# polled for its pass.exit. It pulls work/pass1 and work/pass2, destroys the VM and settles its hours. The second pass
# reuses the first pass's images, so each VM pulls each of its about 89 images once. No provider key goes to the VM. Each
# next 4-hour block is reserved 30 minutes before the current one runs out; a refusal stops the shard (void).
# Prepare a shard's run dir with:
#   TASK_SET=swerebench-r3a4 SWEREBENCH=<export> ORACLE=1 TASKS=$(python3 r3/drop-list.py shard tasks/swerebench-r3a4.json <N>) \
#     bun runner/prepare-run.ts <run dir> r3a4-oracle-s<N> claude-opus-5-5 none <arm tar dir> 1 6
# Usage: UBI_OWNER=<thread code> LEDGER=<r3a4-oracle.jsonl> bash oracle-preflight.sh <runner copy> <export root> <shard run dir> <shard> <out dir>
# RUNNER_SHA256 replaces the pinned runner's sha256 only for the keyless tests' stub runner.
# Exit codes: 0 both passes pulled, 1 a check failed, 3 VM or bootstrap failure (void), 7 results not pulled (void), 9 cap stop.
set -u
R=$1 E=$2 W=$3 S=$4 O=$5
D=$(cd "$(dirname "$0")" && pwd)
L=$E/quick/laneb/runner/ledger.ts
ITEM=r3a4-oracle CAP=20 RATE=0.60 HOURS=4 BLOCK=2.40
unset ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY
: "${UBI_OWNER:?set UBI_OWNER}" "${LEDGER:?set LEDGER}"
echo "${RUNNER_SHA256:-e53f11384dd6faa14bab96aff14ea42577787df285470e8a192ef24de62753a8}  $R" | sha256sum -c --quiet - \
  || { echo "preflight: $R is not the pinned runner"; exit 1; }
cap=$(bun "$L" status --path "$LEDGER" --item "$ITEM" | jq -r .cap_usd) || { echo "preflight: $LEDGER has no approval row"; exit 1; }
[ "$cap" = "$CAP" ] || { echo "preflight: $ITEM's cap is \$$cap, not amendment 4's \$$CAP"; exit 1; }
owner=$(jq -rs '[.[] | select(.kind == "approval")][0].item // ""' "$LEDGER") || owner=""
[ "$owner" = "$ITEM" ] || { echo "preflight: $LEDGER's approval row is for item ${owner:-none}, not $ITEM"; exit 1; }
[ -f "$W/oracle.json" ] || { echo "preflight: $W has no oracle.json; prepare it with ORACLE=1"; exit 1; }
mkdir -p "$O" "$O/script"
cp "$D/oracle-pass.sh" "$O/script/oracle-pass.sh"
vm_id="shard$S-$(date +%s)-vm"
bun "$L" reserve --path "$LEDGER" --item "$ITEM" --id "$vm_id" --usd "$BLOCK" --detail "VM hours, block 1 of $HOURS h" \
  || { echo "preflight: the ledger refused block 1; no VM started (cap stop)"; exit 9; }
blocks=1 name="" t0=$(date +%s)
settle() {
  local hours usd i id share
  hours=$(awk -v s="$t0" -v e="$(date +%s)" 'BEGIN { printf "%.6f", (e - s) / 3600 }')
  usd=$(awk -v r="$RATE" -v h="$hours" 'BEGIN { printf "%.6f", r * h }')
  for i in $(seq 1 "$blocks"); do
    id=$vm_id; [ "$i" = 1 ] || id="$vm_id-$i"
    share=$(awk -v u="$usd" -v b="$BLOCK" -v i="$i" -v n="$blocks" 'BEGIN { s = u - (i - 1) * b; if (s < 0) s = 0; if (i < n && s > b) s = b; printf "%.6f", s }')
    bun "$L" settle --path "$LEDGER" --item "$ITEM" --id "$id" --usd "$share" --detail "VM hours: $hours h at \$$RATE/h, block $i of $blocks"
  done
}
finish() {
  if [ -n "$name" ]; then
    "$R" down "$name" || { echo "WARNING: VM $name may still exist; run: $R down $name"; return; }
  fi
  settle
  bun "$L" status --path "$LEDGER" --item "$ITEM"
}
trap finish EXIT
trap 'exit 130' INT TERM HUP
name=$(UBI_TTL_HOURS=12 "$R" up -s standard-16 -S 640) || { echo "preflight: VM did not come up (void shard)"; name=""; exit 3; }
echo "vm: $name"
"$R" sync "$name" "$E/quick/laneb/runner" work/runner || exit 3
"$R" sync "$name" "$W" work/run || exit 3
"$R" sync "$name" "$O/script" work/preflight || exit 3
"$R" ssh "$name" 'bash work/runner/vm-bootstrap.sh' > "$O/bootstrap.log" 2>&1 || { echo "preflight: bootstrap failed (void shard)"; exit 3; }
tail -1 "$O/bootstrap.log"
"$R" ssh "$name" "ip -6 -o addr show scope global | awk '{ print \$4 }'" < /dev/null > "$O/vm-ipv6.txt" 2>&1
echo "vm ipv6: $(tr '\n' ' ' < "$O/vm-ipv6.txt")(the /64 Docker Hub counts pulls against)"
for P in 1 2; do
  "$R" ssh "$name" "setsid nohup bash work/preflight/oracle-pass.sh $P > work/pass$P.log 2>&1 < /dev/null &" < /dev/null
  while :; do
    sleep "${POLL_SEC:-60}"
    now=$(date +%s)
    if [ "$now" -ge $((t0 + blocks * HOURS * 3600 - 1800)) ]; then
      bun "$L" reserve --path "$LEDGER" --item "$ITEM" --id "$vm_id-$((blocks + 1))" --usd "$BLOCK" --detail "VM hours, block $((blocks + 1)) of $HOURS h" \
        || { echo "preflight: the ledger refused block $((blocks + 1)); shard stopped (void)"; exit 9; }
      blocks=$((blocks + 1))
    fi
    "$R" ssh "$name" "test -f work/pass$P/pass.exit" < /dev/null > /dev/null 2>&1 && break
  done
  "$R" ssh "$name" "cat work/pass$P.log" < /dev/null > "$O/pass$P.log" 2>&1
  for try in 1 2 3; do
    "$R" pull "$name" "work/pass$P" "$O" && [ "$("$R" ssh "$name" "find work/pass$P -type f | wc -l" < /dev/null)" = "$(find "$O/pass$P" -type f | wc -l)" ] && break
    echo "pull try $try failed"; sleep 20
    [ "$try" = 3 ] && { echo "preflight: pass $P results not pulled (void shard)"; exit 7; }
  done
  echo "shard $S pass $P: harbor exit $(cat "$O/pass$P/harbor.exit"), pass exit $(cat "$O/pass$P/pass.exit"), $(grep -q '^finished_at ' "$O/pass$P/finished" 2>/dev/null && echo finished || echo NOT finished), $(wc -l < "$O/pass$P/oracle-fails.txt") oracle fails"
done
