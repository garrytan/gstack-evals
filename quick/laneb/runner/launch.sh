#!/usr/bin/env bash
# Runs one Lane B batch on a fresh Ubicloud VM.
# The ledger service runs here, on the machine that holds the line item's ledger file,
# and the VM reaches it through an SSH reverse tunnel. Provider keys go to a 0600 file
# on the VM through stdin and are read only by the metering proxy.
# The VM holds the only copy of the trial artifacts and proxy logs, so it is destroyed only
# after they are pulled and counted, or when no batch started on it. An interrupt (INT, TERM
# or HUP) stops Harbor on the VM, waits for vm-run.sh to close every session (settling
# through the tunnel, so the ledger service stays up until then), and then pulls as usual.
# After the pull, open reserves are reconciled from the pulled proxy-sessions.jsonl.
# Usage: UBI_OWNER=<thread code> launch.sh <run dir> <ledger prefix> <batch cap usd>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
S=${UBI_RUNNER:-/home/user/.capy/drive/user-garry-tan/skills/ubicloud/scripts/ubi-runner.sh}
LEDGER=${LEDGER:?set LEDGER to the line item ledger path}
ITEM=${ITEM:-laneb-quick}
run=$(cd "$1" && pwd)
prefix=$2
cap=$3
state_root=${UBI_RUNNER_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/ubi-runner}
lport=${LEDGER_PORT:-9911}

bun "$here/ledger.ts" status --path "$LEDGER" --item "$ITEM"
# setsid keeps a terminal interrupt from reaching the ledger service and the batch's SSH session.
setsid bun "$here/ledger.ts" serve --path "$LEDGER" --item "$ITEM" --port "$lport" > "$run/ledger-service.log" 2>&1 < /dev/null &
lpid=$!
name=""
started=no
pulled=no
stopping=no
finish() {
  if [ -n "$name" ]; then
    if [ "$started" = no ] || [ "$pulled" = yes ]; then
      "$S" down "$name" || echo "WARNING: VM $name may still exist; run: $S down $name" >&2
    else
      echo "WARNING: results not fully pulled; VM $name is kept. Pull with: $S pull $name work/run/out $run/pulled; $S pull $name work/run/jobs $run/pulled; then: $S down $name" >&2
    fi
  fi
  kill "$lpid" 2>/dev/null || true
}
trap finish EXIT
on_signal() {
  stopping=yes
  echo "interrupted: stopping the batch; sessions close and results are pulled before the VM goes" >&2
  if [ "$started" = yes ]; then "$S" ssh "$name" 'pkill -INT -f "/bin/harbor run" || true' || true; fi
}
trap on_signal INT TERM HUP
not_stopping() { [ "$stopping" = no ] || exit 130; }

name=$("$S" up -s "${UBI_SIZE:-standard-16}" -S "${UBI_STORAGE:-600}")
echo "vm: $name"
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
setsid ssh -i "$key" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:9911:127.0.0.1:$lport "ubi@$IP" \
  "bash -lc 'umask 022; bash work/runner/vm-run.sh work/run $prefix $cap'" < /dev/null &
spid=$!
started=yes
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
  if "$S" pull "$name" work/run/out "$run/pulled" && "$S" pull "$name" work/run/jobs "$run/pulled" \
    && [ "$("$S" ssh "$name" 'cd work/run && find out jobs -type f | wc -l')" = "$(cd "$run/pulled" && find out jobs -type f | wc -l)" ]; then
    pulled=yes; break
  fi
  echo "pull attempt $attempt failed" >&2; sleep "${PULL_RETRY_SEC:-20}"
done
[ "$pulled" = yes ] || rc=7
kill "$lpid" 2>/dev/null || true
wait "$lpid" 2>/dev/null || true
if [ "$pulled" = yes ] && [ -f "$run/pulled/out/proxy-sessions.jsonl" ]; then
  bun "$here/ledger.ts" reconcile --path "$LEDGER" --item "$ITEM" --sessions "$run/pulled/out/proxy-sessions.jsonl" --prefix "$prefix"
fi
bun "$here/ledger.ts" status --path "$LEDGER" --item "$ITEM"
[ "$stopping" = no ] || rc=130
exit $rc
