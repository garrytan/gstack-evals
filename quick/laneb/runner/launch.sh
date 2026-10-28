#!/usr/bin/env bash
# Runs one Lane B batch on a fresh Ubicloud VM and always destroys the VM.
# The ledger service runs here, on the machine that holds the line item's ledger file,
# and the VM reaches it through an SSH reverse tunnel. Provider keys go to a 0600 file
# on the VM through stdin and are read only by the metering proxy.
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

bun "$here/ledger.ts" status --path "$LEDGER" --item "$ITEM"
bun "$here/ledger.ts" serve --path "$LEDGER" --item "$ITEM" --port 9911 > "$run/ledger-service.log" 2>&1 &
lpid=$!
name=""
cleanup() {
  kill "$lpid" 2>/dev/null || true
  if [ -n "$name" ]; then "$S" down "$name" || echo "WARNING: VM $name may still exist; run: $S down $name" >&2; fi
}
trap cleanup EXIT INT TERM HUP

name=$("$S" up -s "${UBI_SIZE:-standard-16}" -S "${UBI_STORAGE:-400}")
echo "vm: $name"
"$S" sync "$name" "$here" work/runner
"$S" sync "$name" "$run" work/run
"$S" ssh "$name" 'bash work/runner/vm-bootstrap.sh'
{
  printf 'ANTHROPIC_API_KEY=%s\n' "${ANTHROPIC_API_KEY:-}"
  printf 'OPENROUTER_API_KEY=%s\n' "${OPENROUTER_API_KEY:-}"
} | "$S" ssh "$name" 'umask 077; cat > ~/.laneb-keys'
# shellcheck disable=SC1090
. "$state_root/$name/env"
key="$state_root/$name/key"
set +e
ssh -i "$key" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:9911:127.0.0.1:9911 "ubi@$IP" \
  "bash -lc 'umask 022; bash work/runner/vm-run.sh work/run $prefix $cap'"
rc=$?
set -e
"$S" ssh "$name" 'rm -f ~/.laneb-keys' || true
# The VM holds the only copy of the trial artifacts and proxy logs: pull with retries, check them, and keep the VM if that fails.
mkdir -p "$run/pulled"
pulled=no
for attempt in 1 2 3; do
  if "$S" pull "$name" work/run/out "$run/pulled" && "$S" pull "$name" work/run/jobs "$run/pulled" \
    && [ "$("$S" ssh "$name" 'cd work/run && find out jobs -type f | wc -l')" = "$(cd "$run/pulled" && find out jobs -type f | wc -l)" ]; then
    pulled=yes; break
  fi
  echo "pull attempt $attempt failed" >&2; sleep 20
done
if [ "$pulled" != yes ]; then
  echo "WARNING: results not fully pulled; VM $name is kept. Pull with: $S pull $name work/run/out $run/pulled; $S pull $name work/run/jobs $run/pulled; then: $S down $name" >&2
  name=""
  rc=7
fi
bun "$here/ledger.ts" status --path "$LEDGER" --item "$ITEM"
exit $rc
