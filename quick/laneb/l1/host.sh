#!/usr/bin/env bash
# L1's controller wrapper on the awake host (quick/laneb/l1/README.md). l1.ts launch starts it detached:
#   setsid -f bash l1/laneb/l1/host.sh run <part> <ledger prefix> <batch cap usd>
# It records its pid and start time in l1/work/<part>.controller.json, runs runner/launch.sh on l1/work/<part> with the
# item's ledger on this host, and writes launch.sh's exit code to l1/work/<part>.launch-exit last, by rename. No exit file
# and no live process in this script's session (setsid -f makes it the leader) is a lost controller (l1.ts attach). Provider and Ubicloud keys come from ~/.l1-secrets (mode 0600),
# never from argv.
set -euo pipefail
[ "${1:-}" = run ] && [ $# -eq 4 ] || { echo "E_USAGE usage: host.sh run <part> <ledger prefix> <batch cap usd>" >&2; exit 2; }
part=$2 prefix=$3 cap=$4
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$root/work
[ -d "$work/$part" ] || { echo "E_USAGE $work/$part is not a synced part" >&2; exit 2; }
[ ! -e "$work/$part.controller.json" ] || { echo "E_USAGE refused: $part was launched already on this host" >&2; exit 3; }
printf '{"pid":%d,"started_at":%d}\n' "$$" "$(date +%s)" > "$work/$part.controller.json.tmp"
mv "$work/$part.controller.json.tmp" "$work/$part.controller.json"
set -a
# shellcheck disable=SC1091
. "$root/host.env"
# shellcheck disable=SC1090
. "$HOME/.l1-secrets"
set +a
export PATH="$HOME/.bun/bin:$PATH" UBI_RUNNER="$root/bin/ubi-runner.sh" UBI_RUNNER_STATE="$root/ubi-state" UBI_RECOVERY_DIR="$root/recovery" UBI_COUNTED=1 ITEM
rc=0
bash "$root/laneb/runner/launch.sh" "$work/$part" "$prefix" "$cap" || rc=$?
echo "$rc" > "$work/$part.launch-exit.tmp"
mv "$work/$part.launch-exit.tmp" "$work/$part.launch-exit"
