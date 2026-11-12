#!/usr/bin/env bash
# eng-build run host boot: apt off first, linger on, then tools. Holds and reads no provider key.
set -euo pipefail
sudo systemctl stop apt-daily.timer apt-daily-upgrade.timer || true
sudo systemctl disable apt-daily.timer apt-daily-upgrade.timer || true
sudo systemctl stop apt-daily.service apt-daily-upgrade.service unattended-upgrades.service || true
sudo systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service
while pgrep -x apt-get >/dev/null || pgrep -x dpkg >/dev/null || pgrep -f unattended-upgrade >/dev/null; do sleep 5; done
echo "apt timers: $(systemctl list-timers --all | grep -c apt || true) listed; apt procs: $(pgrep -a apt | wc -l)"
sudo loginctl enable-linger "$USER"
echo "linger: $(loginctl show-user "$USER" -p Linger)"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq jq unzip zstd python3 python3-venv git curl >/dev/null
cd /tmp && for i in 1 2 3 4; do curl -fsSL --connect-timeout 10 --max-time 60 -o age.tar.gz https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz && break; sleep 15; done
echo 'cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10  age.tar.gz' | sha256sum -c --strict - >/dev/null
tar -xzf age.tar.gz && sudo install -m 0755 age/age age/age-keygen /usr/local/bin/ && rm -rf age age.tar.gz
echo "age $(age --version)"
