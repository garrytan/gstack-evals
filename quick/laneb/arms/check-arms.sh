#!/usr/bin/env bash
# Offline checks for the Lane B arm tars, in containers that mirror the trial
# runtime: BASE_IMAGE plus /usr/local/bin/claude, /opt/laneb/bin/node and
# /opt/laneb/bin/bun, with /opt/laneb/bin at the end of PATH, run as root in
# /app with --network none.
#
#   quick/laneb/arms/check-arms.sh [out-dir] [base-image ...]
#
# Defaults: out-dir ~/.capy/work/laneb-arms; bases ubuntu:24.04,
# debian:bookworm-slim and debian:bullseye-slim. Makes no model calls: the
# skill-listing check points Claude Code at a local stub server.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT=${1:-$HOME/.capy/work/laneb-arms}
shift || true
BASES=("$@")
[ ${#BASES[@]} -gt 0 ] || BASES=(ubuntu:24.04 debian:bookworm-slim debian:bullseye-slim)

for base in "${BASES[@]}"; do
  tag="laneb-check:$(echo "$base" | tr ':/@' '---')"
  docker buildx build -q --target check --build-arg BASE_IMAGE="$base" -t "$tag" --load "$HERE" > /dev/null
  for arm in none gstack placebo; do
    echo "== $base $arm"
    docker run --rm --network none -v "$OUT/$arm.tar:/arm.tar:ro" -v "$HERE/check-inside.sh:/check-inside.sh:ro" \
      "$tag" bash /check-inside.sh "$arm"
  done
done
