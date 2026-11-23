#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# B2's two Claude Code gstack arm trees (lanes/test-first/pins.ts GSTACK, PROVE_IT), built the way B1e builds its hook arm
# (lanes/delivery-route/b1e-build.sh on origin/b1e-description-rewrite-prereg, by the B1e lane; copied here because that
# branch is unmerged). gstack at its tag, fetched by sha and repacked on one thread, is installed by its own
# ./setup --host claude --no-browser --loadout full in Lane B's builder (quick/laneb/arms/Dockerfile, target gstack-l1-tar)
# with Lane B's seeded long-time user and telemetry off (GSTACK_KEYS). That tree is the gstack arm. The prove-it arm is the
# same tree with B1's prove-it skill beside it, byte for byte. Both trees are tarred in the pinned builder image.
#
#   lanes/test-first/build-claude.sh [out-dir]     default out-dir: ${B2_ARMS_DIR:-~/.capy/work/b2/arms}
#
# Output, outside git: <out>/gstack.tar and prove-it.tar (and .tar.gz), the trees at <out>/trees/<arm>, <out>/fetch-pin.json,
# <out>/<arm>.gstack-config.tsv (skill_routing, skill_contracts and telemetry as the tree's own gstack-config reads them),
# <out>/loadout.lock.json and <out>/build-claude.log. The manifests come after: bun lanes/test-first/cli.ts arms manifests.
# Needs docker with buildx, bun, git and network access at build time.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DF=$ROOT/quick/laneb/arms
pin() { (cd "$ROOT" && bun -e 'import { GSTACK, PROVE_IT } from "./lanes/test-first/pins.ts"; const v = { ...GSTACK, prove_it: PROVE_IT.claudePath, source: PROVE_IT.source }; process.stdout.write(String(v[process.argv[1]]))' "$1"); }
SHA=$(pin sha) REPO=$(pin repo) LOADOUT=$(pin loadout) DEST=$(pin prove_it) SRC=$ROOT/$(pin source)
DIR=${1:-${B2_ARMS_DIR:-$HOME/.capy/work/b2/arms}}
OUT=$(mkdir -p "$DIR" && cd "$DIR" && pwd)
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
git -C "$OUT/src-pin" -c pack.threads=1 repack -a -d -F -q
printf '{"repo":"%s","sha":"%s","head":"%s","method":"git init; git fetch --depth 1 <repo> <sha>; git checkout FETCH_HEAD; git -c pack.threads=1 repack -a -d -F","git_archive_sha256":"%s"}\n' \
  "$REPO" "$SHA" "$head" "$a1" > "$OUT/fetch-pin.json"

echo "== ./setup --host claude --no-browser --loadout $LOADOUT at $SHA in docker, the seeded user, telemetry off"
rm -rf "$OUT/export"
docker buildx build --progress=plain --no-cache-filter gstack-l1-build --build-context gstack="$OUT/src-pin" \
  --build-arg GSTACK_LOADOUT="$LOADOUT" --build-arg GSTACK_KEYS="telemetry=off" --target gstack-l1-tar --output type=local,dest="$OUT/export" "$DF" > "$OUT/build-claude.log" 2>&1 \
  || { tail -40 "$OUT/build-claude.log"; exit 1; }
mv "$OUT/export/arm.tar" "$OUT/setup.tar"
mv "$OUT/export/loadout.lock.json" "$OUT/loadout.lock.json"
rm -rf "$OUT/export"

echo "== the gstack tree, and the prove-it tree: the same with prove-it beside gstack"
rm -rf "$OUT/trees/gstack" "$OUT/trees/prove-it"
mkdir -p "$OUT/trees/gstack"
tar -xpf "$OUT/setup.tar" -C "$OUT/trees/gstack"
rm -f "$OUT/setup.tar"
test ! -e "$OUT/trees/gstack/$DEST"
cp -a "$OUT/trees/gstack" "$OUT/trees/prove-it"
install -d -m 755 "$(dirname "$OUT/trees/prove-it/$DEST")"
install -m 644 "$SRC" "$OUT/trees/prove-it/$DEST"

echo "== each arm's switches, as the tree's own gstack-config reads them"
for a in gstack prove-it; do
  for k in skill_routing skill_contracts telemetry; do
    printf '%s\t%s\n' "$k" "$(env -i PATH="$PATH" HOME="$OUT/trees/$a" GSTACK_HOME="$OUT/trees/$a/.gstack" "$OUT/trees/$a/.claude/skills/gstack/bin/gstack-config" get $k)"
  done > "$OUT/$a.gstack-config.tsv"
done

echo "== the tars, twice each, in the builder image"
for a in gstack prove-it; do
  in_builder tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -C "trees/$a" -cf "$a.tar" .claude .gstack
  in_builder tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -C "trees/$a" -cf "$a.again.tar" .claude .gstack
  test "$(sha256sum < "$OUT/$a.tar")" = "$(sha256sum < "$OUT/$a.again.tar")"
  rm -f "$OUT/$a.again.tar"
  in_builder sh -c "gzip -n -6 -c $a.tar > $a.tar.gz"
done
sha256sum "$OUT"/gstack.tar "$OUT"/prove-it.tar
