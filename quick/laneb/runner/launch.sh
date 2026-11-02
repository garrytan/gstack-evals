#!/usr/bin/env bash
# Runs one Lane B batch on a fresh Ubicloud VM.
# The ledger service runs here, on the machine that holds the line item's ledger file,
# and the VM reaches it through an SSH reverse tunnel. Provider keys go to a 0600 file
# on the VM through stdin and are read only by the metering proxy.
# The VM holds the only copy of the trial artifacts and proxy logs, so it is destroyed only
# after vm-run.sh has finished (its out/vm-run.exit exists) and the results are pulled and
# counted, or when no batch started on it. A dropped SSH connection therefore keeps the VM.
# An interrupt (INT, TERM or HUP) writes work/run/STOP on the VM, which keeps the paid run
# from starting or stops Harbor, waits for vm-run.sh to close every session (settling
# through the tunnel, so the ledger service stays up until then), and then pulls as usual.
# After the pull, open reserves are reconciled from the pulled proxy-sessions.jsonl.
# With VM_USD_PER_HOUR and VM_RESERVE_HOURS set, the VM's hours go to the same item in blocks of VM_RESERVE_HOURS: the
# first block is reserved before the VM starts (a refusal is a cap stop: exit 9, no VM), and each next block through the
# ledger service before the current one runs out (VM_EXTEND_LEAD_SEC ahead, default 1800, at most half a block). Only
# the service's refusal (HTTP 409) is a cap stop: the batch is told to stop and $run/vm-cap-stop records it. Any other
# failure (the service unreachable) is retried until the current block runs out, and then stops the batch the same way,
# since no hours past a reserve may run. Extension ends before the ledger service stops. Once the VM is
# destroyed, the hours from just before it started settle at rate x hours across every open block the ledger holds, in
# order; only the last block can settle over its reserve, by the teardown that ran past it. A kept VM leaves its blocks
# open at their full amounts.
# Usage: UBI_OWNER=<thread code> launch.sh <run dir> <ledger prefix> <batch cap usd>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
S=${UBI_RUNNER:-/home/user/.capy/drive/user-garry-tan/skills/ubicloud/scripts/ubi-runner.sh}
LEDGER=${LEDGER:?set LEDGER to the line item ledger path}
ITEM=${ITEM:-laneb-quick}
run=$(cd "$1" && pwd)
[ ! -e "$run/pulled" ] || { echo "launch.sh: $run/pulled exists from an earlier launch; start from a fresh run dir" >&2; exit 2; }
prefix=$2
cap=$3
state_root=${UBI_RUNNER_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/ubi-runner}
lport=${LEDGER_PORT:-9911}

bun "$here/ledger.ts" status --path "$LEDGER" --item "$ITEM"
vm_rate=${VM_USD_PER_HOUR:-}
vm_id="${prefix}vm"
vm_up_at=""
xpid=""
if [ -n "$vm_rate" ]; then
  vm_hours=${VM_RESERVE_HOURS:?set VM_RESERVE_HOURS with VM_USD_PER_HOUR}
  num='^[0-9]+(\.[0-9]+)?$'
  [[ $vm_rate =~ $num && $vm_hours =~ $num ]] && awk -v r="$vm_rate" -v h="$vm_hours" 'BEGIN { exit !(r > 0 && h > 0) }' \
    || { echo "launch.sh: VM_USD_PER_HOUR and VM_RESERVE_HOURS must be positive numbers (got $vm_rate and $vm_hours)" >&2; exit 2; }
  vm_block=$(awk -v r="$vm_rate" -v h="$vm_hours" 'BEGIN { printf "%.6f", r * h }')
  vm_block_micros=$(awk -v b="$vm_block" 'BEGIN { printf "%d", b * 1000000 + 0.5 }')
  vm_block_sec=$(awk -v h="$vm_hours" 'BEGIN { printf "%d", h * 3600 }')
  [ "$vm_block_sec" -ge 2 ] || { echo "launch.sh: VM_RESERVE_HOURS $vm_hours is under 2 seconds" >&2; exit 2; }
  [ "$vm_block_micros" -gt 0 ] || { echo "launch.sh: the VM block ($vm_rate \$/h for $vm_hours h) rounds to \$0" >&2; exit 2; }
  bun "$here/ledger.ts" reserve --path "$LEDGER" --item "$ITEM" --id "$vm_id" --usd "$vm_block" --detail "VM hours, block 1 of $vm_hours h" \
    || { echo "launch.sh: the ledger refused the VM reserve of \$$vm_block for $ITEM; no VM started (cap stop)" >&2; exit 9; }
fi
# setsid keeps a terminal interrupt from reaching the ledger service and the batch's SSH session.
setsid bun "$here/ledger.ts" serve --path "$LEDGER" --item "$ITEM" --port "$lport" > "$run/ledger-service.log" 2>&1 < /dev/null &
lpid=$!
name=""
started=no
pulled=no
stopping=no
say() { (echo "$*" >&2) || true; }
vm_extend() {
  local n=1 lead=${VM_EXTEND_LEAD_SEC:-1800}
  [ "$lead" -le $((vm_block_sec / 2)) ] || lead=$((vm_block_sec / 2))
  while kill -0 $$ 2>/dev/null; do
    if [ "$(date +%s)" -lt $((vm_up_at + n * vm_block_sec - lead)) ]; then
      sleep "${VM_EXTEND_POLL_SEC:-30}" < /dev/null > /dev/null 2>&1
      continue
    fi
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "127.0.0.1:$lport/reserve" -H 'content-type: application/json' \
      -d "{\"id\":\"$vm_id-$((n + 1))\",\"usd_micros\":$vm_block_micros,\"meta\":{\"kind_detail\":\"VM hours, block $((n + 1)) of $vm_hours h\"}}" 2> /dev/null) || true
    case "$code" in
      200) n=$((n + 1)) ;;
      409)
        echo "the ledger refused VM block $((n + 1)) ($vm_id-$((n + 1)), \$$vm_block) for $ITEM" > "$run/vm-cap-stop"
        say "launch.sh: the ledger refused VM block $((n + 1)) for $ITEM; stopping the batch (cap stop)"
        "$S" ssh "$name" 'touch work/run/STOP' < /dev/null > /dev/null 2>&1 || true
        return 0
        ;;
      *)
        if [ "$(date +%s)" -ge $((vm_up_at + n * vm_block_sec)) ]; then
          echo "the ledger service gave no answer (HTTP ${code:-000}) before VM block $n ran out, so block $((n + 1)) is unreserved for $ITEM" > "$run/vm-cap-stop"
          say "launch.sh: VM block $n ran out with no reserve for block $((n + 1)) (HTTP ${code:-000}); stopping the batch"
          "$S" ssh "$name" 'touch work/run/STOP' < /dev/null > /dev/null 2>&1 || true
          return 0
        fi
        say "launch.sh: VM block $((n + 1)) reserve got HTTP ${code:-000} from the ledger service; retrying"
        sleep "${VM_EXTEND_POLL_SEC:-30}" < /dev/null > /dev/null 2>&1
        ;;
    esac
  done
}
stop_extend() {
  if [ -n "$xpid" ]; then kill "$xpid" 2>/dev/null || true; wait "$xpid" 2>/dev/null || true; xpid=""; fi
}
vm_settle() {
  [ -n "$vm_rate" ] || return 0
  local hours usd open ids blocks i id share
  hours=$(awk -v s="${vm_up_at:-$(date +%s)}" -v e="$(date +%s)" 'BEGIN { printf "%.6f", (e - s) / 3600 }')
  usd=$(awk -v r="$vm_rate" -v h="$hours" 'BEGIN { printf "%.6f", r * h }')
  if ! open=$(bun "$here/ledger.ts" open --path "$LEDGER" --item "$ITEM"); then
    say "WARNING: the open VM blocks could not be listed, so none was settled; list them with: bun $here/ledger.ts open --path $LEDGER --item $ITEM, then settle $vm_id and each $vm_id-N in order at \$$vm_block a block, \$$usd in all, with ledger.ts settle"
    return 0
  fi
  ids=$(printf '%s\n' "$open" | while read -r id; do
    if [ "$id" = "$vm_id" ]; then echo "1 $id"; elif [[ "$id" == "$vm_id"-* && "${id#"$vm_id"-}" =~ ^[0-9]+$ ]]; then echo "${id#"$vm_id"-} $id"; fi
  done | sort -n | cut -d' ' -f2)
  blocks=1
  for id in $ids; do i=${id#"$vm_id"}; i=${i#-}; [ "${i:-1}" -le "$blocks" ] || blocks=$i; done
  for id in $ids; do
    i=${id#"$vm_id"}; i=${i#-}; i=${i:-1}
    share=$(awk -v u="$usd" -v b="$vm_block" -v i="$i" -v n="$blocks" 'BEGIN { s = u - (i - 1) * b; if (s < 0) s = 0; if (i < n && s > b) s = b; printf "%.6f", s }')
    bun "$here/ledger.ts" settle --path "$LEDGER" --item "$ITEM" --id "$id" --usd "$share" --detail "VM hours: $hours h at \$$vm_rate/h, block $i of $blocks" \
      || say "WARNING: the VM settle failed; settle $id at \$$share with: bun $here/ledger.ts settle --path $LEDGER --item $ITEM --id $id --usd $share"
  done
}
finish() {
  stop_extend
  kill "$lpid" 2>/dev/null || true
  wait "$lpid" 2>/dev/null || true
  if [ -z "$name" ]; then
    vm_settle
  elif [ "$started" = no ] || [ "$pulled" = yes ]; then
    if "$S" down "$name"; then vm_settle; else say "WARNING: VM $name may still exist; run: $S down $name"; fi
  else
    {
      say "WARNING: results not fully pulled; VM $name is kept. Once work/run/out/vm-run.exit exists on it, pull with: $S pull $name work/run/out $run/pulled; $S pull $name work/run/jobs $run/pulled; reconcile with: bun $here/ledger.ts reconcile --path $LEDGER --item $ITEM --sessions $run/pulled/out/proxy-sessions.jsonl --prefix $prefix; then: $S down $name"
      [ -z "$vm_rate" ] || say "The VM reserve $vm_id stays open, with any later blocks ($vm_id-2 and on; ledger.ts open lists them); once the VM is down, settle them at VM_USD_PER_HOUR x its hours with ledger.ts settle"
    }
  fi
}
trap finish EXIT
on_signal() {
  stopping=yes
  if [ "$started" = yes ]; then
    "$S" ssh "$name" 'touch work/run/STOP' || true
    say "interrupted: stopping the batch; sessions close and results are pulled before the VM goes"
  else
    say "interrupted before the batch started: nothing to pull; the VM is destroyed"
  fi
}
trap on_signal INT TERM HUP
not_stopping() { [ "$stopping" = no ] || exit 130; }

vm_up_at=$(date +%s)
name=$("$S" up -s "${UBI_SIZE:-standard-16}" -S "${UBI_STORAGE:-600}")
echo "vm: $name"
if [ -n "$vm_rate" ]; then
  vm_extend &
  xpid=$!
fi
not_stopping
"$S" sync "$name" "$here" work/runner
"$S" sync "$name" "$run" work/run
"$S" ssh "$name" 'bash work/runner/vm-bootstrap.sh'
not_stopping
{
  printf 'ANTHROPIC_API_KEY=%s\n' "${ANTHROPIC_API_KEY:-}"
  printf 'OPENROUTER_API_KEY=%s\n' "${OPENROUTER_API_KEY:-}"
} | "$S" ssh "$name" 'umask 077; cat > ~/.laneb-keys'
# shellcheck disable=SC1090
. "$state_root/$name/env"
key="$state_root/$name/key"
not_stopping
started=yes
setsid ssh -i "$key" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:9911:127.0.0.1:$lport "ubi@$IP" \
  "bash -lc 'umask 022; bash work/runner/vm-run.sh work/run $prefix $cap'" < /dev/null &
spid=$!
set +e
while :; do
  wait "$spid"
  rc=$?
  kill -0 "$spid" 2>/dev/null || break
done
set -e
"$S" ssh "$name" 'rm -f ~/.laneb-keys' || true
mkdir -p "$run/pulled"
for attempt in 1 2 3; do
  if ! "$S" ssh "$name" 'test -f work/run/out/vm-run.exit'; then
    say "pull attempt $attempt: vm-run.sh has not finished (no work/run/out/vm-run.exit)"
  elif "$S" pull "$name" work/run/out "$run/pulled" && "$S" pull "$name" work/run/jobs "$run/pulled" \
    && [ "$("$S" ssh "$name" 'cd work/run && find out jobs -type f | wc -l')" = "$(cd "$run/pulled" && find out jobs -type f | wc -l)" ]; then
    pulled=yes; break
  else
    say "pull attempt $attempt failed"
  fi
  sleep "${PULL_RETRY_SEC:-20}"
done
[ "$pulled" = yes ] || rc=7
stop_extend
kill "$lpid" 2>/dev/null || true
wait "$lpid" 2>/dev/null || true
if [ "$pulled" = yes ] && [ -f "$run/pulled/out/proxy-sessions.jsonl" ]; then
  bun "$here/ledger.ts" reconcile --path "$LEDGER" --item "$ITEM" --sessions "$run/pulled/out/proxy-sessions.jsonl" --prefix "$prefix"
fi
bun "$here/ledger.ts" status --path "$LEDGER" --item "$ITEM"
[ "$stopping" = no ] || rc=130
exit $rc
