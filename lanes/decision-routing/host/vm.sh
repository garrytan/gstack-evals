#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Decision-routing runner VMs through a pinned copy of the Ubicloud runner (ubi-runner.sh). Every command checks the
# runner's sha256 first and needs UBI_OWNER (the thread code) and UBI_TTL_HOURS (covering the longest batch), since the
# runner's up reaps expired VMs and its default TTL is short.
#
# usage: vm.sh <runner path> <runner sha256> up [size] [storage gib]   list --mine, create, post-boot hygiene, list --mine
#        vm.sh <runner path> <runner sha256> hygiene <name>            run post-boot.sh again on a VM
#        vm.sh <runner path> <runner sha256> keys <name>               write the provider keys to ~/.dr-keys (mode 600)
#        vm.sh <runner path> <runner sha256> down <name>               destroy the VM and check list --mine is empty
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
    name=$("$runner" up -s "${1:-standard-16}" -S "${2:-600}")
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
  *)
    die "E_USAGE: unknown command $cmd; use up, hygiene, keys or down"
    ;;
esac
