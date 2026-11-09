#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Decision-routing runner VMs through a pinned copy of the Ubicloud runner (ubi-runner.sh). Every command checks the
# runner's sha256 first and needs UBI_OWNER (the thread code) and UBI_TTL_HOURS (covering the longest batch), since the
# runner's up reaps expired VMs and its default TTL is short.
#
# usage: vm.sh <runner path> <runner sha256> up [size] [storage gib: 320 or 640, default 640]   list --mine, create, post-boot hygiene, list --mine
#        vm.sh <runner path> <runner sha256> hygiene <name>            run post-boot.sh again on a VM
#        vm.sh <runner path> <runner sha256> keys <name>               write the provider keys to ~/.dr-keys (mode 600)
#        vm.sh <runner path> <runner sha256> down <name>               destroy the VM and check list --mine is empty
#        vm.sh <runner path> <runner sha256> record-in <name> <record> <run id>   copy the ledger record to dr-record in the VM user's home
#        vm.sh <runner path> <runner sha256> record-out <name> <record> [--confirm <out dir on the VM>]  copy back only the record's new files
#        vm.sh <runner path> <runner sha256> pull-out <name> <out dir> <run id>  pull a batch's out dir to $DR_RUNS_DIR/<run id>
#
# Segments. Runner VMs are deleted after each segment of 6 hours or less, and the real ledger record lives in the Captain
# drive (ledger/decision-routing/record), which the VM can't see. Before a segment: record-in, which refuses while an
# earlier segment of the run id, pulled under DR_RUNS_DIR/<run id>, holds a STOP file the controller wrote (it starts
# with a reason code) or a DR_CUSTODY_HIT refusal, since those start again only on the Captain's word. Then run the
# batch or the answering step with --record ~/dr-record and a local sqlite ledger on the VM. It opens its lease and
# launches nothing until lease-confirmed.json in its out dir lists that lease: run record-out --confirm <out dir> once
# the lease is open, which writes the file only when the drive copy reads back with every lease open on the VM open, so
# a VM that dies mid-segment leaves its lease open in the drive. The sqlite ledger stays on the VM for the segment, and
# the controller settles every lease into the record before it exits. After the segment, before down: record-out (a file
# that already exists in the drive and differs is an error, and then nothing is copied), then pull-out (journals,
# sessions, Harbor trial dirs, batch.json or answer.json; the runner-only markers stay on the VM: the VM packs the out
# dir without any markers dir, markers.json or canary.txt, a pull that brings one back keeps nothing, and a pull never
# lands over an earlier segment's: give each segment's out dir its own name). If a VM dies
# mid-segment, its sqlite ledger and journals are gone, so its open lease is recovered from the provider usage with
# gstack-evals ledger reconcile --lease <id> --spent <usd> --words <text> --by <who> --source <provider usage export>.
# DR_RUNS_DIR defaults to ~/.capy/work/geva491/runs.
#
# Keys reach the VM only as a file written with umask 077 from ssh's stdin, as quick/laneb/runner/launch.sh does; printf
# is a shell builtin, so no key appears on any command line.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
die() {
  printf '%s\n' "$1" >&2
  exit 2
}

[ $# -ge 3 ] || die "E_USAGE: usage: vm.sh <runner path> <runner sha256> up [size] [storage gib] | hygiene <name> | keys <name> | down <name>"
runner=$1
want=$2
cmd=$3
shift 3
[ -n "${UBI_OWNER:-}" ] || die "E_DR_RUNNER: UBI_OWNER is not set; set it to the thread code. Nothing was called."
[[ ${UBI_TTL_HOURS:-} =~ ^[1-9][0-9]*$ ]] || die "E_DR_RUNNER: UBI_TTL_HOURS is not a whole number of hours; set it to cover the longest batch. Nothing was called."
[ -f "$runner" ] || die "E_DR_RUNNER: no runner at $runner. Nothing was called."
got=$(sha256sum "$runner" | cut -d' ' -f1)
[ "$got" = "$want" ] || die "E_DR_RUNNER: the runner $runner has sha256 $got, not the pinned $want. Nothing was called."
export UBI_OWNER UBI_TTL_HOURS

mine() {
  "$runner" list --mine || die "E_DR_RUNNER: list --mine failed, so this owner's VMs could not be read"
}

case $cmd in
  up)
    echo "vms before (owner $UBI_OWNER):"
    mine
    name=$("$runner" up -s "${1:-standard-16}" -S "${2:-640}")
    echo "vm: $name"
    "$runner" ssh "$name" 'bash -s' < "$here/post-boot.sh"
    echo "vms after (owner $UBI_OWNER):"
    mine
    ;;
  hygiene)
    [ $# -eq 1 ] || die "E_USAGE: vm.sh ... hygiene <name>"
    "$runner" ssh "$1" 'bash -s' < "$here/post-boot.sh"
    ;;
  keys)
    [ $# -eq 1 ] || die "E_USAGE: vm.sh ... keys <name>"
    {
      printf 'ANTHROPIC_API_KEY=%s\n' "${ANTHROPIC_API_KEY:-}"
      printf 'OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY:-}"
      printf 'OPENROUTER_API_KEY=%s\n' "${OPENROUTER_API_KEY:-}"
      printf 'TYPESAFE_API_KEY=%s\n' "${TYPESAFE_API_KEY:-}"
    } | "$runner" ssh "$1" 'umask 077; cat > ~/.dr-keys'
    echo "keys: written to ~/.dr-keys on $1"
    ;;
  down)
    [ $# -eq 1 ] || die "E_USAGE: vm.sh ... down <name>"
    "$runner" down "$1"
    left=$(mine)
    if [ -n "$left" ]; then
      die "E_DR_RUNNER: owner $UBI_OWNER still has VMs after down $1: $(printf '%s' "$left" | tr '\n' ' '); destroy them with $runner down <name>"
    fi
    echo "vms after down (owner $UBI_OWNER): none"
    ;;
  record-in)
    [ $# -eq 3 ] && [ -d "$2" ] || die "E_USAGE: vm.sh ... record-in <name> <record dir> <run id>"
    runs="${DR_RUNS_DIR:-$HOME/.capy/work/geva491/runs}/$3"
    if [ -d "$runs" ]; then
      while IFS= read -r -d '' stop; do
        line=$(head -1 "$stop")
        [[ $line =~ ^[A-Z][A-Z0-9_]*:\  ]] && die "E_DR_RUNNER: an earlier segment of $3 stopped ($stop: ${line:0:300}); the next segment starts only on the Captain's word, and nothing was copied"
      done < <(find "$runs" -mindepth 2 -maxdepth 2 -name STOP -type f -print0)
      hit=$(grep -rl --include='*.ndjson' '"code":"DR_CUSTODY_HIT"' "$runs" 2> /dev/null | head -1 || true)
      [ -z "$hit" ] || die "E_DR_RUNNER: an earlier segment of $3 has a DR_CUSTODY_HIT refusal ($hit); the next segment starts only on the Captain's word, and nothing was copied"
    fi
    tar -C "$2" -cf - . | "$runner" ssh "$1" 'cd && rm -rf dr-record && mkdir -p dr-record && tar -C dr-record -xf -'
    echo "record: copied $2 to ~/dr-record on $1"
    ;;
  record-out)
    confirm=""
    [ $# -eq 4 ] && [ "$3" = --confirm ] && confirm=$4 && set -- "$1" "$2"
    [ $# -eq 2 ] && [ -d "$2" ] || die "E_USAGE: vm.sh ... record-out <name> <record dir> [--confirm <out dir on the VM>]"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    "$runner" pull "$1" dr-record "$tmp"
    [ -d "$tmp/dr-record" ] || die "E_DR_RUNNER: no dr-record came back from $1; nothing was copied"
    new=() differ=()
    while IFS= read -r -d '' f; do
      rel=${f#"$tmp/dr-record/"}
      if [ ! -e "$2/$rel" ]; then new+=("$rel"); elif ! cmp -s "$f" "$2/$rel"; then differ+=("$rel"); fi
    done < <(find "$tmp/dr-record" -type f -print0)
    [ ${#differ[@]} -eq 0 ] || die "E_DR_RUNNER: these record files exist in $2 and differ on $1: ${differ[*]}; nothing was copied"
    for rel in "${new[@]}"; do
      mkdir -p "$(dirname "$2/$rel")"
      cp -p "$tmp/dr-record/$rel" "$2/$rel"
    done
    echo "record: ${#new[@]} new files copied back from $1 to $2"
    if [ -n "$confirm" ]; then
      open_leases() {
        DR_RECORD=$1 bun -e 'import { readdirSync } from "node:fs"; import { readItem } from "'"$here"'/../../../src/runner/ledger/record.ts"; const r = process.env.DR_RECORD!; for (const item of readdirSync(r + "/items").sort()) { const o = readItem(r, item).open; if (o) console.log(o.lease_id); }'
      }
      vm_open=$(open_leases "$tmp/dr-record") || die "E_DR_RUNNER: could not read the VM's copy of the record; no lease was confirmed"
      drive_open=$(open_leases "$2") || die "E_DR_RUNNER: could not read the drive copy $2; no lease was confirmed"
      for id in $vm_open; do
        grep -qxF "$id" <<< "$drive_open" || die "E_DR_RUNNER: lease $id is open on $1 but the drive copy $2 does not read it open; no lease was confirmed"
      done
      json=$(printf '%s\n' $vm_open | python3 -c 'import json, sys; print(json.dumps({"leases": [l.strip() for l in sys.stdin if l.strip()]}))')
      printf '%s\n' "$json" | "$runner" ssh "$1" "cat > $(printf %q "$confirm")/lease-confirmed.json.tmp && mv $(printf %q "$confirm")/lease-confirmed.json.tmp $(printf %q "$confirm")/lease-confirmed.json"
      echo "record: confirmed to $1 that the drive copy reads open: ${vm_open:-no lease}"
    fi
    ;;
  pull-out)
    [ $# -eq 3 ] || die "E_USAGE: vm.sh ... pull-out <name> <out dir on the VM> <run id>"
    base=$(basename "$2")
    dest="${DR_RUNS_DIR:-$HOME/.capy/work/geva491/runs}/$3"
    [ ! -e "$dest/$base" ] || die "E_DR_RUNNER: $dest/$base already holds an earlier pull; give each segment's out dir its own name. Nothing was pulled"
    mkdir -p "$dest"
    tmp=$(mktemp -d "$dest/.pull-XXXXXX")
    trap 'rm -rf "$tmp"' EXIT
    stage=.dr-pull-$(basename "$tmp").tgz
    "$runner" ssh "$1" "tar -C $(printf %q "$(dirname "$2")") -czf ~/$stage --exclude=markers --exclude=markers.json --exclude=canary.txt $(printf %q "$base")"
    "$runner" pull "$1" "$stage" "$tmp"
    "$runner" ssh "$1" "rm -f ~/$stage"
    [ -f "$tmp/$stage" ] || die "E_DR_RUNNER: no $stage came back from $1; nothing was kept"
    tar -C "$tmp" -xzf "$tmp/$stage"
    [ -f "$tmp/$base/batch.json" ] || [ -f "$tmp/$base/answer.json" ] || die "E_DR_RUNNER: $2 on $1 has no batch.json or answer.json; nothing was kept"
    [ -z "$(find "$tmp/$base" \( -name markers -o -name markers.json -o -name canary.txt \) -print -quit)" ] || die "E_DR_RUNNER: runner-only markers came back from $1; nothing was kept"
    mv "$tmp/$base" "$dest/$base"
    echo "out: $2 from $1 is at $dest/$base"
    ;;
  *)
    die "E_USAGE: unknown command $cmd; use up, hygiene, keys, down, record-in, record-out or pull-out"
    ;;
esac
