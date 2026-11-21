#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# B1f's four gstack arm tars (lanes/delivery-route/b1f-pins.ts GSTACK_STABLE, B1F_ARMS). gstack at its stable tag, fetched by
# sha, is installed by its own ./setup in Lane B's builder (quick/laneb/arms/Dockerfile, target gstack-l1-tar, the steps B1d's
# arm ran) with Lane B's seeded long-time user, and B1's prove-it skill goes beside it byte for byte: that tree is the hook
# arm. own is the same tree after gstack's own `gstack-config set skill_routing off`; long and required are own with prove-it's
# SKILL.md replaced by the arm's file. Every tree is tarred in the pinned builder image.
#
#   lanes/delivery-route/b1f-build.sh [out-dir]     default out-dir: ${B1F_ARMS_DIR:-~/.capy/work/b1f/arms}
#
# It refuses an out-dir that already holds hook.tar: gstack's setup is not byte for byte, so a rebuild would replace the hook tar
# the committed manifests pin.
#
# Output, outside git: <out>/<arm>.tar and .tar.gz for hook, own, long and required, the trees at <out>/trees/<arm>,
# <out>/fetch-pin.json, <out>/<arm>.gstack-config.tsv, <out>/hook.loadout.lock.json and <out>/build.log. The manifests come
# after: bun lanes/delivery-route/cli.ts b1f arms manifest [--out <dir>]
# Needs docker with buildx, bun, git and network access at build time.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DF=$ROOT/quick/laneb/arms
pin() { (cd "$ROOT" && bun -e 'import { GSTACK_STABLE, B1F_ARMS } from "./lanes/delivery-route/b1f-pins.ts"; import { PROVE_IT } from "./lanes/delivery-route/b1d-pins.ts"; const v = { ...GSTACK_STABLE, prove_it: PROVE_IT.path, own: B1F_ARMS.own.skill, long: B1F_ARMS.long.skill, required: B1F_ARMS.required.skill }; process.stdout.write(String(v[process.argv[1]]))' "$1"); }
SHA=$(pin sha) REPO=$(pin repo) LOADOUT=$(pin loadout) DEST=$(pin prove_it)
DIR=${1:-${B1F_ARMS_DIR:-$HOME/.capy/work/b1f/arms}}
OUT=$(mkdir -p "$DIR" && cd "$DIR" && pwd)
for f in "$OUT"/{hook,own,long,required}.tar{,.gz}; do
  if [ -e "$f" ]; then
    echo "refusing: $f exists. gstack's setup is not byte for byte, so a rebuild would replace the tars the committed manifests pin. Build into an empty folder: lanes/delivery-route/b1f-build.sh <new-dir>" >&2
    exit 1
  fi
done
BUILDER=$(sed -n 's/^ARG BUILDER_IMAGE=//p' "$DF/Dockerfile")
in_builder() { docker run --rm --network none -u "$(id -u):$(id -g)" -v "$OUT:/out" -w /out "$@"; }

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
mv "$OUT/export/gstack-config.tsv" "$OUT/setup.gstack-config.tsv"
mv "$OUT/export/loadout.lock.json" "$OUT/hook.loadout.lock.json"
rm -rf "$OUT/export"

echo "== the hook tree: prove-it beside gstack"
rm -rf "$OUT/trees"
mkdir -p "$OUT/trees/hook"
tar -xpf "$OUT/setup.tar" -C "$OUT/trees/hook"
rm -f "$OUT/setup.tar"
test ! -e "$OUT/trees/hook/$DEST"
install -d -m 755 "$(dirname "$OUT/trees/hook/$DEST")"
install -m 644 "$ROOT/lanes/delivery-route/arms/$(pin own)" "$OUT/trees/hook/$DEST"

echo "== own: gstack-config set skill_routing off; long and required: prove-it's file swapped"
cp -a "$OUT/trees/hook" "$OUT/trees/own"
in_builder -e HOME=/out/trees/own -e GSTACK_HOME=/out/trees/own/.gstack "$BUILDER" /out/trees/own/.claude/skills/gstack/bin/gstack-config set skill_routing off
for a in long required; do
  cp -a "$OUT/trees/own" "$OUT/trees/$a"
  install -m 644 "$ROOT/lanes/delivery-route/arms/$(pin $a)" "$OUT/trees/$a/$DEST"
done

echo "== each arm's switches, as the tree's own gstack-config reads them (on this machine, which has bun)"
for a in hook own long required; do
  for k in skill_routing skill_contracts telemetry; do
    printf '%s\t%s\n' "$k" "$(env -i PATH="$PATH" HOME="$OUT/trees/$a" GSTACK_HOME="$OUT/trees/$a/.gstack" "$OUT/trees/$a/.claude/skills/gstack/bin/gstack-config" get $k)"
  done > "$OUT/$a.gstack-config.tsv"
done

echo "== the tars"
for a in hook own long required; do
  in_builder "$BUILDER" tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -C "trees/$a" -cf "$a.tar" .claude .gstack
  in_builder "$BUILDER" sh -c "gzip -n -6 -c $a.tar > $a.tar.gz"
done
ls -l "$OUT"/*.tar "$OUT"/*.tar.gz
