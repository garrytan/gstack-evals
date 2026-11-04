#!/usr/bin/env bash
# Build the three Lane B arm tars (none, gstack, placebo) and their manifests,
# or with l1 the four L1 arm tars (none, before, after, off).
#
#   quick/laneb/arms/build.sh [out-dir]      default out-dir: ~/.capy/work/laneb-arms
#   quick/laneb/arms/build.sh l1 [out-dir]   default out-dir: ~/.capy/work/laneb-arms-l1
#
# l1 output, outside git: <out>/{none,before,after,off}.tar and .tar.gz, the
# pins' checkouts and fetch records, and <out>/trees/. Commit-ready output:
# manifests/l1/ next to this script. See "The L1 arms" in README.md.
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
# The L1 preregistration's pins (wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000, section 2), fetched by sha.
L1_BEFORE_SHA=82db89ab3ea3c64185538b8af33da2ffd1a18b57
L1_AFTER_SHA=699a41cb6808e01240d02e82247693f9170d401a
L1_LOADOUT=lite

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANEB=$(cd "$HERE/.." && pwd)
DEFAULT_OUT=$HOME/.capy/work/laneb-arms
MODE=default
if [ "${1:-}" = l1 ]; then MODE=l1; DEFAULT_OUT=$HOME/.capy/work/laneb-arms-l1; shift; fi
OUT=$(mkdir -p "${1:-$DEFAULT_OUT}" && cd "${1:-$DEFAULT_OUT}" && pwd)
BUILDER=$(sed -n 's/^ARG BUILDER_IMAGE=//p' "$HERE/Dockerfile")
in_builder() { docker run --rm --network none -u "$(id -u):$(id -g)" -v "$OUT:/out" -w /out "$BUILDER" "$@"; }
canonical_tar() { in_builder tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu "$@"; }
mkdir -p "$HERE/manifests"
(cd "$LANEB/../.." && bun install --frozen-lockfile > /dev/null)

markers() {
  (cd "$1" && ls -A .gstack | grep -E '^\.(feature-prompted-model-overlay|completeness-intro-seen|telemetry-prompted|proactive-prompted|activated|first-loop-tip-shown)$' | sed 's#^#.gstack/#' | paste -sd' ')
}

build_l1() {
  local man=$HERE/manifests/l1 pin sha head a1 a2 arm off
  mkdir -p "$man"
  for pin in before after; do
    if [ "$pin" = before ]; then sha=$L1_BEFORE_SHA; else sha=$L1_AFTER_SHA; fi
    echo "== gstack $pin at $sha"
    rm -rf "$OUT/src-$pin"
    git init -q "$OUT/src-$pin"
    git -C "$OUT/src-$pin" fetch -q --depth 1 "$GSTACK_REPO" "$sha"
    git -C "$OUT/src-$pin" checkout -q FETCH_HEAD
    # GitHub's pack for the same shallow fetch differs from fetch to fetch; a
    # single-threaded repack that recompresses every object gives the same pack.
    head=$(git -C "$OUT/src-$pin" rev-parse HEAD)
    test "$head" = "$sha"
    a1=$(git -C "$OUT/src-$pin" archive --format=tar "$sha" | sha256sum | cut -d' ' -f1)
    a2=$(git -C "$OUT/src-$pin" archive --format=tar "$sha" | sha256sum | cut -d' ' -f1)
    test "$a1" = "$a2"
    git -C "$OUT/src-$pin" -c pack.threads=1 repack -a -d -F -q
    printf '{"repo":"%s","sha":"%s","head":"%s","method":"git init; git fetch --depth 1 <repo> <sha>; git checkout FETCH_HEAD","git_archive_sha256":"%s"}\n' \
      "$GSTACK_REPO" "$sha" "$head" "$a1" > "$OUT/fetch-$pin.json"
  done
  rm -rf "$OUT/trees"
  mkdir -p "$OUT/trees/none/.claude/skills"
  for arm in before after off; do
    if [ "$arm" = before ]; then pin=before; else pin=after; fi
    if [ "$arm" = off ]; then off=true; else off=false; fi
    echo "== $arm arm: ./setup --host claude --no-browser --loadout $L1_LOADOUT at $pin in docker"
    rm -rf "$OUT/$arm-export"
    docker buildx build --progress=plain --no-cache-filter gstack-l1-build --build-context gstack="$OUT/src-$pin" \
      --build-arg GSTACK_LOADOUT="$L1_LOADOUT" --build-arg GSTACK_OFF_KEYS="$off" \
      --target gstack-l1-tar --output type=local,dest="$OUT/$arm-export" "$HERE" > "$OUT/build-$arm.log" 2>&1 \
      || { tail -40 "$OUT/build-$arm.log"; exit 1; }
    mv "$OUT/$arm-export/arm.tar" "$OUT/$arm.tar"
    mv "$OUT/$arm-export/gstack-config.tsv" "$OUT/$arm.gstack-config.tsv"
    mv "$OUT/$arm-export/loadout.lock.json" "$OUT/$arm.loadout.lock.json"
    rm -rf "$OUT/$arm-export"
    mkdir -p "$OUT/trees/$arm"
    tar -xpf "$OUT/$arm.tar" -C "$OUT/trees/$arm"
  done
  chmod 755 "$OUT/trees/none/.claude" "$OUT/trees/none/.claude/skills"

  echo "== tars"
  canonical_tar -C trees/none -cf none.tar .claude
  for arm in none before after off; do in_builder sh -c "gzip -n -6 -c $arm.tar > $arm.tar.gz"; done

  echo "== manifests"
  cd "$LANEB"
  for arm in none before after off; do
    meta=(--meta claude_code="$CLAUDE_CODE_VERSION" --meta tar_gz_sha256="$(sha256sum "$OUT/$arm.tar.gz" | cut -d' ' -f1)")
    if [ "$arm" != none ]; then
      if [ "$arm" = before ]; then pin=before; sha=$L1_BEFORE_SHA; else pin=after; sha=$L1_AFTER_SHA; fi
      meta+=(--meta gstack_sha="$sha" --meta update_check=false --meta onboarding_markers="$(markers "$OUT/trees/$arm")"
        --fetch "$OUT/fetch-$pin.json" --config "$OUT/$arm.gstack-config.tsv" --lock "$OUT/$arm.loadout.lock.json")
    fi
    bun arms/l1.ts manifest --arm "$arm" --tree "$OUT/trees/$arm" --tar "$OUT/$arm.tar" --out "$man" "${meta[@]}"
  done
  ls -l "$OUT"/*.tar "$OUT"/*.tar.gz
}
if [ "$MODE" = l1 ]; then build_l1; exit 0; fi

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
