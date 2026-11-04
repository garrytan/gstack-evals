#!/usr/bin/env bash
# R3b's told arm (R3 amendment 5 section 2): build.sh's install, unchanged, at gstack 699a41cb, for the gstack arm only,
# with its manifest in manifests/r3b. The none arm is not rebuilt: manifests/r3b/none.json is manifests/r3/none.json,
# the same tar. The build fails when the arm's settings.json lacks the skill route hook (UserPromptSubmit) or the skill
# contract Stop hook, since ./setup leaves either out when its switch resolves off.
#
#   quick/laneb/arms/build-r3b.sh [out-dir]      default out-dir: ~/.capy/work/laneb-arms-r3b
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT=${1:-$HOME/.capy/work/laneb-arms-r3b}
GSTACK_SHA=699a41cb6808e01240d02e82247693f9170d401a MANIFESTS="$HERE/manifests/r3b" ARMS=gstack bash "$HERE/build.sh" "$OUT"
cp "$HERE/manifests/r3/none.json" "$HERE/manifests/r3b/none.json"
bun "$HERE/../r3/r3b.ts" arm-check "$HERE/manifests/r3b"
