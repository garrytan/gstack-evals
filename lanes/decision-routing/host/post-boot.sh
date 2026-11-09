#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Post-boot hygiene for a decision-routing runner VM, run as the run user over ssh (bash -s). apt's timers and services
# are stopped, disabled and masked so no upgrade runs beside a batch; linger keeps the run user's services alive between
# ssh sessions; NODE_DISABLE_COMPILE_CACHE=1 and HARBOR_TELEMETRY=0 are set in the run user's environment for login and
# non-login shells and for user services.
# First it refuses a runner whose kernel lacks CONFIG_NFT_FIB_INET, which Harbor's egress sidecar needs for the
# allowlist: the kernel config (/boot/config-<release> or /proc/config.gz) must set it, and an inet table with a fib
# rule must load and delete. post-boot.sh --kernel-config <file> checks only a config file's text and changes nothing.
set -euo pipefail

nft_fib_set() { grep -Eq '^CONFIG_NFT_FIB_INET=(y|m)$'; }
if [ "${1:-}" = "--kernel-config" ]; then
  if nft_fib_set < "${2:?usage: post-boot.sh --kernel-config <file>}"; then
    echo "kernel config $2: CONFIG_NFT_FIB_INET is set"
    exit 0
  fi
  echo "E_DR_RUNNER: kernel config $2 does not set CONFIG_NFT_FIB_INET, so Harbor's allowlist cannot run on it" >&2
  exit 2
fi

release=$(uname -r)
if [ -r "/boot/config-$release" ]; then
  config=$(cat "/boot/config-$release")
elif [ -r /proc/config.gz ]; then
  config=$(zcat /proc/config.gz)
else
  echo "E_DR_RUNNER: kernel $release has no readable /boot/config-$release or /proc/config.gz, so CONFIG_NFT_FIB_INET cannot be checked; use another runner" >&2
  exit 2
fi
if ! nft_fib_set <<< "$config"; then
  echo "E_DR_RUNNER: kernel $release does not set CONFIG_NFT_FIB_INET, so Harbor's allowlist cannot run on it; use another runner" >&2
  exit 2
fi
command -v nft > /dev/null || { echo "E_DR_RUNNER: no nft binary on this runner, so the fib probe cannot run" >&2; exit 2; }
sudo nft delete table inet dr_fib_probe 2> /dev/null || true
if ! sudo nft -f - <<'NFT'
table inet dr_fib_probe {
  chain probe {
    type filter hook prerouting priority 0; policy accept;
    fib daddr type local accept
  }
}
NFT
then
  echo "E_DR_RUNNER: kernel $release refused an inet table with a fib rule; use another runner" >&2
  exit 2
fi
sudo nft delete table inet dr_fib_probe
echo "kernel $release: CONFIG_NFT_FIB_INET set, inet fib rule loaded and deleted"

sudo systemctl stop apt-daily.timer apt-daily-upgrade.timer
sudo systemctl disable apt-daily.timer apt-daily-upgrade.timer
sudo systemctl stop apt-daily.service apt-daily-upgrade.service unattended-upgrades.service || true
sudo systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service

if systemctl list-timers --all --no-pager | grep -E 'apt-daily'; then
  echo "E_DR_RUNNER: apt timers are still listed after disabling them" >&2
  exit 2
fi
for _ in $(seq 1 60); do
  pgrep -a apt > /dev/null || break
  sleep 10
done
if pgrep -a apt; then
  echo "E_DR_RUNNER: apt processes are still running ten minutes after boot hygiene" >&2
  exit 2
fi

sudo loginctl enable-linger "$(id -un)"

block='# decision-routing runner environment
export NODE_DISABLE_COMPILE_CACHE=1
export HARBOR_TELEMETRY=0'
for f in "$HOME/.bashrc" "$HOME/.profile"; do
  touch "$f"
  if ! grep -q '^# decision-routing runner environment$' "$f"; then
    printf '%s\n%s\n' "$block" "$(cat "$f")" > "$f.dr-new"
    mv "$f.dr-new" "$f"
  fi
done
mkdir -p "$HOME/.config/environment.d"
printf 'NODE_DISABLE_COMPILE_CACHE=1\nHARBOR_TELEMETRY=0\n' > "$HOME/.config/environment.d/90-decision-routing.conf"

[ "$(bash -c '. "$HOME/.bashrc" > /dev/null 2>&1; echo "$NODE_DISABLE_COMPILE_CACHE:$HARBOR_TELEMETRY"')" = "1:0" ] || {
  echo "E_DR_RUNNER: the run user's shell does not see NODE_DISABLE_COMPILE_CACHE=1 and HARBOR_TELEMETRY=0" >&2
  exit 2
}
echo "post-boot hygiene: apt timers and services masked, linger on, NODE_DISABLE_COMPILE_CACHE=1, HARBOR_TELEMETRY=0"
