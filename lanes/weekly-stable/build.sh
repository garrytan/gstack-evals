#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# One weekly gstack arm's tar (lanes/weekly-stable/README.md, step 2): gstack at <sha>, fetched at depth 1, installed by its own
# ./setup in Lane B's builder (quick/laneb/arms/Dockerfile, target gstack-l1-tar) with Lane B's seeded long-time user, and
# tarred in the pinned builder image. B1f's steps (lanes/delivery-route/b1f-build.sh) without any added skill.
#
#   lanes/weekly-stable/build.sh <candidate|stable> <sha> [out-dir]     default out-dir: ${WEEKLY_ARMS_DIR:-~/.capy/work/weekly/arms}
#
# Exit 0 built; 3 gstack's own ./setup failed (the week is INCOMPLETE for that arm); 1 anything else. It refuses an out-dir
# that already holds <arm>.tar. Output, outside git: <out>/<arm>.tar and .tar.gz, the tree at <out>/trees/<arm>,
# <out>/<arm>.fetch-pin.json, <out>/<arm>.gstack-config.tsv, <out>/<arm>.loadout.lock.json and <out>/<arm>.build.log.
# Needs docker with buildx, git and network access at build time.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DF=$ROOT/quick/laneb/arms
ARM=${1:-} SHA=${2:-}
case "$ARM" in candidate|stable) ;; *) echo "usage: build.sh <candidate|stable> <sha> [out-dir]" >&2; exit 1 ;; esac
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: <sha> is a full 40-hex commit" >&2; exit 1; }
REPO=$(cd "$ROOT" && bun -e 'import { GSTACK } from "./lanes/weekly-stable/pins.ts"; process.stdout.write(GSTACK.repo + " " + GSTACK.loadout)')
LOADOUT=${REPO#* } REPO=${REPO% *}
DIR=${3:-${WEEKLY_ARMS_DIR:-$HOME/.capy/work/weekly/arms}}
OUT=$(mkdir -p "$DIR" && cd "$DIR" && pwd)
for f in "$OUT/$ARM.tar" "$OUT/$ARM.tar.gz"; do
  if [ -e "$f" ]; then echo "refusing: $f exists; build each week into an empty folder" >&2; exit 1; fi
done
BUILDER=$(sed -n 's/^ARG BUILDER_IMAGE=//p' "$DF/Dockerfile")
in_builder() { docker run --rm --network none -u "$(id -u):$(id -g)" -v "$OUT:/out" -w /out "$@"; }
SRC=$OUT/src-$ARM

echo "== $ARM: gstack at $SHA, depth 1"
rm -rf "$SRC"
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 "$REPO" "$SHA"
git -C "$SRC" checkout -q FETCH_HEAD
rm -f "$SRC/.git/FETCH_HEAD"
head=$(git -C "$SRC" rev-parse HEAD)
test "$head" = "$SHA"
count=$(git -C "$SRC" rev-list --all --count)
remotes=$(git -C "$SRC" remote | wc -l | tr -d ' ')
if [ "$count" != 1 ] || [ "$remotes" != 0 ] || [ -e "$SRC/.git/FETCH_HEAD" ]; then
  echo "refusing: the fetched tree holds $count commits and $remotes remotes; the depth-1 fetch must bring one commit and no remote" >&2; exit 1
fi
a1=$(git -C "$SRC" archive --format=tar "$SHA" | sha256sum | cut -d' ' -f1)
a2=$(git -C "$SRC" archive --format=tar "$SHA" | sha256sum | cut -d' ' -f1)
test "$a1" = "$a2"
version=$(cat "$SRC/VERSION" 2>/dev/null | tr -d '[:space:]' || true)
git -C "$SRC" -c pack.threads=1 repack -a -d -F -q
printf '{"arm":"%s","repo":"%s","sha":"%s","head":"%s","version":"%s","rev_list_all":%s,"remotes":%s,"method":"git init; git fetch --depth 1 <repo> <sha>; git checkout FETCH_HEAD; rm .git/FETCH_HEAD","git_archive_sha256":"%s"}\n' \
  "$ARM" "$REPO" "$SHA" "$head" "$version" "$count" "$remotes" "$a1" > "$OUT/$ARM.fetch-pin.json"

echo "== $ARM: ./setup --host claude --no-browser --loadout $LOADOUT in docker"
rm -rf "$OUT/export-$ARM"
if ! docker buildx build --progress=plain --no-cache-filter gstack-l1-build --build-context gstack="$SRC" \
  --build-arg GSTACK_LOADOUT="$LOADOUT" --target gstack-l1-tar --output type=local,dest="$OUT/export-$ARM" "$DF" > "$OUT/$ARM.build.log" 2>&1; then
  tail -40 "$OUT/$ARM.build.log"
  if grep -qE 'process ".*skills/gstack && \./setup .*" did not complete successfully' "$OUT/$ARM.build.log"; then echo "SETUP_FAILED $ARM $SHA" >&2; exit 3; fi
  exit 1
fi
mkdir -p "$OUT/trees/$ARM"
tar -xpf "$OUT/export-$ARM/arm.tar" -C "$OUT/trees/$ARM"
mv "$OUT/export-$ARM/loadout.lock.json" "$OUT/$ARM.loadout.lock.json"
rm -rf "$OUT/export-$ARM"

echo "== $ARM: switches, as the tree's own gstack-config reads them"
for k in skill_routing skill_contracts telemetry; do
  printf '%s\t%s\n' "$k" "$(env -i PATH="$PATH" HOME="$OUT/trees/$ARM" GSTACK_HOME="$OUT/trees/$ARM/.gstack" "$OUT/trees/$ARM/.claude/skills/gstack/bin/gstack-config" get $k)"
done > "$OUT/$ARM.gstack-config.tsv"

echo "== $ARM: the tar"
in_builder "$BUILDER" tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -C "trees/$ARM" -cf "$ARM.tar" .claude .gstack
in_builder "$BUILDER" sh -c "gzip -n -6 -c $ARM.tar > $ARM.tar.gz"
rm -rf "$SRC"
ls -l "$OUT/$ARM.tar" "$OUT/$ARM.tar.gz"
