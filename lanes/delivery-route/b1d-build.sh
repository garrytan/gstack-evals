#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# B1d's gstack-main arm tar (lanes/delivery-route/b1d-pins.ts GSTACK_ARM, PROVE_IT). gstack main at the pin, fetched by sha,
# is installed by its own ./setup in Lane B's builder (quick/laneb/arms/Dockerfile, target gstack-l1-tar, the same steps the
# L1 and harness mechanics arms ran) with Lane B's seeded long-time user. B1's prove-it skill then goes beside it byte for
# byte, and the tree is tarred again in the pinned builder image.
#
#   lanes/delivery-route/b1d-build.sh [out-dir]     default out-dir: ~/.capy/work/<pins name>/arms (~/.capy/work/b1d/arms)
#
# B1_PINS names the pins file beside this script (default b1d-pins.ts); B1e builds its arm with B1_PINS=b1e-pins.ts, and
# the default out-dir follows it (~/.capy/work/b1e/arms).
#
# Output, outside git: <out>/gstack-main.tar and .tar.gz, the tree at <out>/trees/gstack-main, <out>/fetch-pin.json,
# <out>/gstack-main.gstack-config.tsv, <out>/gstack-main.loadout.lock.json and <out>/build.log. The manifest comes after:
#   bun lanes/delivery-route/cli.ts b1d arms manifest [--out <dir>]
# Needs docker with buildx, bun, git and network access at build time.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DF=$ROOT/quick/laneb/arms
PINS=${B1_PINS:-b1d-pins.ts}
pin() { (cd "$ROOT" && bun -e 'const { GSTACK_ARM, PROVE_IT } = await import("./lanes/delivery-route/" + process.argv[2]); const v = { ...GSTACK_ARM, prove_it: PROVE_IT.path, source: PROVE_IT.source }; process.stdout.write(String(v[process.argv[1]]))' "$1" "$PINS"); }
SHA=$(pin sha) REPO=$(pin repo) LOADOUT=$(pin loadout) DEST=$(pin prove_it) SRC=$ROOT/lanes/delivery-route/arms/$(pin source)
DEFAULT_OUT=$HOME/.capy/work/${PINS%-pins.ts}/arms
OUT=$(mkdir -p "${1:-$DEFAULT_OUT}" && cd "${1:-$DEFAULT_OUT}" && pwd)
BUILDER=$(sed -n 's/^ARG BUILDER_IMAGE=//p' "$DF/Dockerfile")
in_builder() { docker run --rm --network none -u "$(id -u):$(id -g)" -v "$OUT:/out" -w /out "$BUILDER" "$@"; }

echo "== gstack at $SHA"
rm -rf "$OUT/src-pin"
git init -q "$OUT/src-pin"
git -C "$OUT/src-pin" fetch -q --depth 1 "$REPO" "$SHA"
git -C "$OUT/src-pin" checkout -q FETCH_HEAD
head=$(git -C "$OUT/src-pin" rev-parse HEAD)
test "$head" = "$SHA"
a1=$(git -C "$OUT/src-pin" archive --format=tar "$SHA" | sha256sum | cut -d' ' -f1)
a2=$(git -C "$OUT/src-pin" archive --format=tar "$SHA" | sha256sum | cut -d' ' -f1)
test "$a1" = "$a2"
git -C "$OUT/src-pin" -c pack.threads=1 repack -a -d -F -q
printf '{"repo":"%s","sha":"%s","head":"%s","method":"git init; git fetch --depth 1 <repo> <sha>; git checkout FETCH_HEAD","git_archive_sha256":"%s"}\n' \
  "$REPO" "$SHA" "$head" "$a1" > "$OUT/fetch-pin.json"

echo "== ./setup --host claude --no-browser --loadout $LOADOUT at $SHA in docker"
rm -rf "$OUT/export"
docker buildx build --progress=plain --no-cache-filter gstack-l1-build --build-context gstack="$OUT/src-pin" \
  --build-arg GSTACK_LOADOUT="$LOADOUT" --target gstack-l1-tar --output type=local,dest="$OUT/export" "$DF" > "$OUT/build.log" 2>&1 \
  || { tail -40 "$OUT/build.log"; exit 1; }
mv "$OUT/export/arm.tar" "$OUT/setup.tar"
mv "$OUT/export/gstack-config.tsv" "$OUT/gstack-main.gstack-config.tsv"
mv "$OUT/export/loadout.lock.json" "$OUT/gstack-main.loadout.lock.json"
rm -rf "$OUT/export"

echo "== prove-it beside it, and the tars"
rm -rf "$OUT/trees/gstack-main"
mkdir -p "$OUT/trees/gstack-main"
tar -xpf "$OUT/setup.tar" -C "$OUT/trees/gstack-main"
test ! -e "$OUT/trees/gstack-main/$DEST"
install -d -m 755 "$(dirname "$OUT/trees/gstack-main/$DEST")"
install -m 644 "$SRC" "$OUT/trees/gstack-main/$DEST"
in_builder tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -C trees/gstack-main -cf gstack-main.tar .claude .gstack
in_builder sh -c "gzip -n -6 -c gstack-main.tar > gstack-main.tar.gz"
rm -f "$OUT/setup.tar"
ls -l "$OUT"/gstack-main.tar "$OUT"/gstack-main.tar.gz
