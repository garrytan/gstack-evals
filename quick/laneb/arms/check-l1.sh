#!/usr/bin/env bash
# In-image checks of the L1 arm tars (README.md, "The L1 arms"). Each runs in a
# check container (ubuntu:24.04 plus the runtime, /opt/laneb/bin at the end of
# PATH) with the arm extracted into /root, as root, with --network none, and
# prints one JSON line from arms/l1.ts. Makes no model calls: the hook sessions
# point Claude Code at a fake upstream inside the container.
#
#   quick/laneb/arms/check-l1.sh [out-dir]                          every check on every arm
#   quick/laneb/arms/check-l1.sh <out-dir> run <arm> <l1.ts args>    one l1.ts command in that arm's container
#
# Default out-dir: ~/.capy/work/laneb-arms-l1, where build.sh l1 writes the tars.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANEB=$(cd "$HERE/.." && pwd)
OUT=${1:-$HOME/.capy/work/laneb-arms-l1}
TAG=laneb-check:ubuntu-24.04
docker buildx build -q --target check --build-arg BASE_IMAGE=ubuntu:24.04 -t "$TAG" --load "$HERE" > /dev/null

in_arm() {
  local arm=$1
  shift
  docker run --rm --network none -v "$OUT/$arm.tar:/arm.tar:ro" -v "$LANEB:/laneb:ro" "$TAG" \
    bash -c 'tar -x -C /root -f /arm.tar && exec bun /laneb/arms/l1.ts "$@"' l1 "$@"
}

if [ "${2:-}" = run ]; then
  arm=$3
  shift 3
  in_arm "$arm" "$@"
  exit
fi
for arm in none before after off; do in_arm "$arm" check --arm "$arm"; done
for arm in before after off; do in_arm "$arm" session --arm "$arm"; done
