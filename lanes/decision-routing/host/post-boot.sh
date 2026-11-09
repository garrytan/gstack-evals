#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Post-boot hygiene for a decision-routing runner VM, run as the run user over ssh (bash -s). apt's timers and services
# are stopped, disabled and masked so no upgrade runs beside a batch; linger keeps the run user's services alive between
# ssh sessions; NODE_DISABLE_COMPILE_CACHE=1 and HARBOR_TELEMETRY=0 are set in the run user's environment for login and
# non-login shells and for user services.
set -euo pipefail

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
