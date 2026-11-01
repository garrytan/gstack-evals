#!/usr/bin/env bash
# Builds the two rendered gstack arms of the ceremony eval (GEVA-108): gstack-render (control, the interactive render)
# and gstack-render-unattended (variant, --session-kind unattended), from one gstack sha. Each runs gstack's own
# ./setup first, exactly as the gstack arm does, then renders the full loadout to /root/.claude/gstack-render and
# serves it (Dockerfile, GSTACK_RENDER), so the render kind is the only difference between the two.
# Usage: bash quick/laneb/arms/build-render.sh [out dir]   (default ~/.capy/work/laneb-arms)
# Writes <out>/<arm>.tar and .tar.gz, <out>/trees/<arm>, and manifests/<arm>.json with the render lock's fields.
# Check the result with check-render.sh. Needs docker with buildx, bun, git and network at build time.
set -euo pipefail

GSTACK_SHA=142757b107edeffff7c78453490c4d2786996fa7
GSTACK_REPO=${GSTACK_REPO:-https://github.com/garrytan/gstack.git}
CLAUDE_CODE_VERSION=2.1.312

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANEB=$(cd "$HERE/.." && pwd)
OUT=$(mkdir -p "${1:-$HOME/.capy/work/laneb-arms}" && cd "${1:-$HOME/.capy/work/laneb-arms}" && pwd)
BUILDER=$(sed -n 's/^ARG BUILDER_IMAGE=//p' "$HERE/Dockerfile")
(cd "$LANEB/../.." && bun install --frozen-lockfile > /dev/null)

echo "== gstack checkout at $GSTACK_SHA"
rm -rf "$OUT/gstack-render-src"
git init -q "$OUT/gstack-render-src"
git -C "$OUT/gstack-render-src" fetch -q --depth 1 "$GSTACK_REPO" "$GSTACK_SHA"
git -C "$OUT/gstack-render-src" checkout -q FETCH_HEAD
test "$(git -C "$OUT/gstack-render-src" rev-parse HEAD)" = "$GSTACK_SHA"
# A fetched pack's bytes drift with the server (stacks-2's pack did not rebuild byte for byte), so the arm keeps .git
# but repacks it single-threaded, which is byte-stable for the same objects and git version, and drops FETCH_HEAD,
# which names the fetch URL. The Dockerfile already drops the reflog and rebuilds the index without stat data.
git -C "$OUT/gstack-render-src" -c pack.threads=1 repack -a -d -f -q
rm -f "$OUT/gstack-render-src/.git/FETCH_HEAD"
PACK_GIT=$(git --version | cut -d' ' -f3)

for kind in interactive unattended; do
  arm=gstack-render
  [ "$kind" = interactive ] || arm=gstack-render-$kind
  echo "== $arm: ./setup, then render --session-kind $kind, in docker"
  rm -rf "$OUT/$arm-export" "$OUT/trees/$arm"
  docker buildx build --progress=plain --build-context gstack="$OUT/gstack-render-src" --build-arg GSTACK_RENDER="$kind" \
    --target gstack-tar --output type=local,dest="$OUT/$arm-export" "$HERE" > "$OUT/build-$arm.log" 2>&1 \
    || { tail -40 "$OUT/build-$arm.log"; exit 1; }
  mv "$OUT/$arm-export/gstack.tar" "$OUT/$arm.tar"
  rm -rf "$OUT/$arm-export"
  docker run --rm --network none -u "$(id -u):$(id -g)" -v "$OUT:/out" -w /out "$BUILDER" sh -c "gzip -n -6 -c $arm.tar > $arm.tar.gz"
  mkdir -p "$OUT/trees/$arm"
  tar -xpf "$OUT/$arm.tar" -C "$OUT/trees/$arm"
  lock="$OUT/trees/$arm/.claude/gstack-render/loadout.lock.json"
  test "$(jq -r .session_kind "$lock")" = "$kind"
  (cd "$LANEB" && bun arms/tree.ts manifest --arm "$arm" --tree "$OUT/trees/$arm" --tar "$OUT/$arm.tar" --out "$HERE/manifests" \
    --meta claude_code="$CLAUDE_CODE_VERSION" --meta tar_gz_sha256="$(sha256sum "$OUT/$arm.tar.gz" | cut -d' ' -f1)" \
    --meta gstack_sha="$GSTACK_SHA" --meta pack_git="$PACK_GIT" --meta update_check=false --meta render_dir=/root/.claude/gstack-render \
    --meta render_session_kind="$(jq -r .session_kind "$lock")" --meta render_spec="$(jq -r .spec "$lock")" \
    --meta render_spec_sha256="$(jq -r .spec_sha256 "$lock")" --meta render_gstack_version="$(jq -r .gstack_version "$lock")" \
    --meta render_files="$(jq '.files | length' "$lock")" --meta render_total_bytes="$(jq .total_bytes "$lock")" \
    --meta render_lock_sha256="$(sha256sum "$lock" | cut -d' ' -f1)")
done

ls -l "$OUT"/gstack-render*.tar "$OUT"/gstack-render*.tar.gz
