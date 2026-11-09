#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Runs nonroot_probe.py in a real task container, as root, the way dr_harbor launches dr_agent.session: the runtime
# tarball unpacked at /opt/dr, then env -i with only PATH, HOME and a fresh random bearer in DR_PROXY_TOKEN. The bearer
# reaches the container through docker's -e from this script's environment, never through a command line.
# usage: nonroot.sh <image> <runtime tarball> <expected conda env>
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
image=${1:?usage: nonroot.sh <image> <runtime tarball> <expected conda env>}
tarball=$(cd "$(dirname "${2:?}")" && pwd)/$(basename "$2")
want=${3:?}
DR_PROXY_TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
export DR_PROXY_TOKEN
docker run --rm --network none -e DR_PROXY_TOKEN -v "$tarball":/tmp/dr-runtime.tar.gz:ro -v "$here/nonroot_probe.py":/tmp/nonroot_probe.py:ro "$image" \
  bash -c 'mkdir -p /opt/dr && tar -xzf /tmp/dr-runtime.tar.gz -C /opt/dr && mkdir -p /opt/dr/run && exec env -i PATH="$PATH" HOME=/root DR_PROXY_TOKEN="$DR_PROXY_TOKEN" /opt/dr/venv/bin/python -I /tmp/nonroot_probe.py '"$want"
