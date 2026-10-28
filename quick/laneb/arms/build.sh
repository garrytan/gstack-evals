#!/usr/bin/env bash
# Build the three Lane B arm tars (none, gstack, placebo) and their manifests.
#
#   quick/laneb/arms/build.sh [out-dir]      default out-dir: ~/.capy/work/laneb-arms
#
# Output, outside git: <out>/{none,gstack,placebo}.tar and .tar.gz, each with
# paths relative to /root (extract with tar -x -C /root), plus <out>/trees/.
# Commit-ready output: manifests/ next to this script.
# Needs docker with buildx, bun, git and network access at build time. Every
# tar and gzip runs in the pinned builder image, so their bytes do not depend
# on the host's tar or gzip.
set -euo pipefail

GSTACK_SHA=61e201ec08bcf59163ef2d3a69a26e334a536c04
GSTACK_REPO=${GSTACK_REPO:-https://github.com/garrytan/gstack.git}
CLAUDE_CODE_VERSION=2.1.312
SEED=${PLACEBO_SEED:-gstack-evals/laneb/placebo/v1}

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANEB=$(cd "$HERE/.." && pwd)
OUT=$(mkdir -p "${1:-$HOME/.capy/work/laneb-arms}" && cd "${1:-$HOME/.capy/work/laneb-arms}" && pwd)
BUILDER=$(sed -n 's/^ARG BUILDER_IMAGE=//p' "$HERE/Dockerfile")
in_builder() { docker run --rm --network none -u "$(id -u):$(id -g)" -v "$OUT:/out" -w /out "$BUILDER" "$@"; }
canonical_tar() { in_builder tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu "$@"; }
mkdir -p "$HERE/manifests"
(cd "$LANEB" && bun install --frozen-lockfile > /dev/null)

echo "== gstack checkout at $GSTACK_SHA"
rm -rf "$OUT/gstack-src"
git init -q "$OUT/gstack-src"
git -C "$OUT/gstack-src" fetch -q --depth 1 "$GSTACK_REPO" "$GSTACK_SHA"
git -C "$OUT/gstack-src" checkout -q FETCH_HEAD
test "$(git -C "$OUT/gstack-src" rev-parse HEAD)" = "$GSTACK_SHA"

echo "== gstack arm: ./setup --host claude --no-browser in docker"
rm -rf "$OUT/gstack-export"
docker buildx build --progress=plain --build-context gstack="$OUT/gstack-src" \
  --target gstack-tar --output type=local,dest="$OUT/gstack-export" "$HERE" > "$OUT/build-gstack.log" 2>&1 \
  || { tail -40 "$OUT/build-gstack.log"; exit 1; }
mv "$OUT/gstack-export/gstack.tar" "$OUT/gstack.tar"
rm -rf "$OUT/gstack-export" "$OUT/trees"
mkdir -p "$OUT/trees/gstack" "$OUT/trees/none/.claude/skills"
tar -xpf "$OUT/gstack.tar" -C "$OUT/trees/gstack"

echo "== placebo arm"
(cd "$LANEB" && bun arms/placebo/generate.ts --seed "$SEED" \
  --in "$OUT/trees/gstack/.claude/skills" --out "$OUT/trees/placebo/.claude/skills" \
  --report "$HERE/manifests/placebo-tokens.tsv") | tee "$OUT/placebo.txt"
GENERATOR_HASH=$(sed -n 's/^generator_hash //p' "$OUT/placebo.txt")
chmod 755 "$OUT"/trees/{none,placebo}/.claude "$OUT"/trees/{none,placebo}/.claude/skills

echo "== tars"
canonical_tar -C trees/none -cf none.tar .claude
canonical_tar -C trees/placebo -cf placebo.tar .claude
for arm in none gstack placebo; do in_builder sh -c "gzip -n -6 -c $arm.tar > $arm.tar.gz"; done

echo "== manifests"
cd "$LANEB"
for arm in none gstack placebo; do
  meta=(--meta claude_code="$CLAUDE_CODE_VERSION" --meta tar_gz_sha256="$(sha256sum "$OUT/$arm.tar.gz" | cut -d' ' -f1)")
  [ "$arm" = none ] || meta+=(--meta gstack_sha="$GSTACK_SHA")
  [ "$arm" = gstack ] && meta+=(--meta update_check=false --meta onboarding_markers="$(cd "$OUT/trees/gstack" && ls -A .gstack | grep -E '^\.(feature-prompted-model-overlay|completeness-intro-seen|telemetry-prompted|proactive-prompted|activated|first-loop-tip-shown)$' | sed 's#^#.gstack/#' | paste -sd' ')")
  [ "$arm" = placebo ] && meta+=(--meta placebo_seed="$SEED" --meta placebo_generator_hash="$GENERATOR_HASH")
  bun arms/tree.ts manifest --arm "$arm" --tree "$OUT/trees/$arm" --tar "$OUT/$arm.tar" --out "$HERE/manifests" "${meta[@]}"
done

echo "== placebo tests on the installed tree"
LANEB_GSTACK_SKILLS="$OUT/trees/gstack/.claude/skills" bun test tests/placebo.test.ts

ls -l "$OUT"/*.tar "$OUT"/*.tar.gz
