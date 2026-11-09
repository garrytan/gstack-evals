#!/usr/bin/env bash
# Build the three Lane B arm tars (none, gstack, placebo) and their manifests,
# or with l1 the four L1 arm tars (none, before, after, off).
#
#   quick/laneb/arms/build.sh [out-dir]      default out-dir: ~/.capy/work/laneb-arms
#   quick/laneb/arms/build.sh l1 [out-dir]   default out-dir: ~/.capy/work/laneb-arms-l1
#   quick/laneb/arms/build.sh hm [out-dir]   default out-dir: ~/.capy/work/hm/arms; the harness mechanics arms
#                                            (none, prose, hook), manifests in manifests/hm/
#
# l1 output, outside git: <out>/{none,before,after,off}.tar and .tar.gz, their
# file inventories (<arm>.files.tsv), the pins' checkouts and fetch records, and
# <out>/trees/. Commit-ready output: manifests/l1/*.json next to this script.
# See "The L1 arms" in README.md.
#
# GSTACK_SHA (default 61e201ec, #109's pin), MANIFESTS (default manifests/ next to this script) and ARMS (default
# "none gstack placebo") let another pin reuse the same install: build-r3b.sh builds R3b's told arm this way.
#
# Output, outside git: <out>/{none,gstack,placebo}.tar and .tar.gz, each with
# paths relative to /root (extract with tar -x -C /root), plus <out>/trees/.
# Commit-ready output: manifests/ next to this script.
# Needs docker with buildx, bun, git and network access at build time. Every
# tar and gzip runs in the pinned builder image, so their bytes do not depend
# on the host's tar or gzip.
set -euo pipefail

GSTACK_SHA=${GSTACK_SHA:-61e201ec08bcf59163ef2d3a69a26e334a536c04}
ARMS=${ARMS:-none gstack placebo}
GSTACK_REPO=${GSTACK_REPO:-https://github.com/garrytan/gstack.git}
CLAUDE_CODE_VERSION=2.1.312
SEED=${PLACEBO_SEED:-gstack-evals/laneb/placebo/v1}
# The L1 preregistration's pins (wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000, section 2), fetched by sha.
L1_BEFORE_SHA=82db89ab3ea3c64185538b8af33da2ffd1a18b57
L1_AFTER_SHA=699a41cb6808e01240d02e82247693f9170d401a
L1_LOADOUT=lite
# The harness mechanics pin (lanes/harness-mechanics/pins.ts HM.gstackPin) and its arms; unit 7 adds judge.
HM_SHA=ba2289e1cd9f2387d069b3b6c51b404d56c4a1e9
HM_ARMS="none prose hook judge"

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANEB=$(cd "$HERE/.." && pwd)
DEFAULT_OUT=$HOME/.capy/work/laneb-arms
MODE=default
if [ "${1:-}" = l1 ]; then MODE=l1; DEFAULT_OUT=$HOME/.capy/work/laneb-arms-l1; shift; fi
if [ "${1:-}" = hm ]; then MODE=hm; DEFAULT_OUT=$HOME/.capy/work/hm/arms; shift; fi
OUT=$(mkdir -p "${1:-$DEFAULT_OUT}" && cd "${1:-$DEFAULT_OUT}" && pwd)
BUILDER=$(sed -n 's/^ARG BUILDER_IMAGE=//p' "$HERE/Dockerfile")
in_builder() { docker run --rm --network none -u "$(id -u):$(id -g)" -v "$OUT:/out" -w /out "$BUILDER" "$@"; }
canonical_tar() { in_builder tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu "$@"; }
MANIFESTS=${MANIFESTS:-$HERE/manifests}
mkdir -p "$MANIFESTS"
wants() { [[ " $ARMS " == *" $1 "* ]]; }
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

# The harness mechanics arms (wiki/plans/2026-11-09-geva-448-harness-mechanics-prereg, sections 5 and 6): none, prose
# and hook at the pin, with L1's builder, Claude Code, setup run, seeded user and --loadout. prose is gstack as shipped
# (routing and contracts at their defaults); hook is the pin with lanes/harness-mechanics/verify-hook.patch applied to
# the checkout before setup and skill_contracts set on. The judge tar (hook plus the judgment hooks) is unit 7's: it
# adds its arm to HM_ARMS and its build here. SKIP_BUILD=1 rewrites the manifests from the tars already in <out>.
build_judge() {
  local t=$OUT/trees/judge j=$OUT/trees/judge/.hm/judge root=$LANEB/../.. arm
  echo "== judge tar: the hook tree plus the decision-routing runtime (its own build.sh at /root/.hm/dr) and hm_judge.py"
  rm -rf "$t" "$OUT/dr-out"
  mkdir -p "$t" "$OUT/dr-out"
  tar -xpf "$OUT/hook.tar" -C "$t"
  docker run --rm -v "$(command -v uv)":/usr/local/bin/uv:ro -v "$root":/repo:ro -v "$OUT/dr-out":/out debian:bookworm-slim \
    bash /repo/lanes/decision-routing/agent/runtime/build.sh /out /root/.hm/dr > "$OUT/build-dr.log" 2>&1 || { tail -40 "$OUT/build-dr.log"; exit 1; }
  mkdir -p "$t/.hm/dr" "$j"
  tar -xzf "$OUT/dr-out/dr-runtime.tar.gz" -C "$t/.hm/dr"
  cp "$root/lanes/harness-mechanics/judge/hm_judge.py" "$j/hm_judge.py"
  cp "${HM_BAND:-$root/lanes/harness-mechanics/judge/band.json}" "$j/band.json"
  (cd "$root" && bun build lanes/harness-mechanics/judge.ts --target=bun --outfile "$j/facts.js" > "$OUT/build-facts.log" 2>&1) || { cat "$OUT/build-facts.log"; exit 1; }
  (cd "$root" && bun -e 'import { loadMatcher } from "./lanes/harness-mechanics/match.ts"; process.stdout.write(loadMatcher().match.regex)') > "$j/match.re"
  for arm in stop risky; do
    printf '#!/bin/sh\nexec /root/.hm/dr/venv/bin/python -I -B /root/.hm/judge/hm_judge.py %s\n' "$([ $arm = stop ] && echo stop || echo bash)" > "$j/$arm"
    chmod 755 "$j/$arm"
  done
  for arm in jev p1; do
    printf '{"backend":"%s","band":"/root/.hm/judge/band.json","log":"/root/.hm/log/hooks.jsonl","state_dir":"/root/.hm/state","particle_max_tokens":8000,"contract_hook":"/root/.claude/skills/gstack/hosts/claude/hooks/skill-contract-stop-hook","careful":"/root/.claude/skills/gstack/careful/bin/check-careful.sh","done_facts":["/opt/laneb/bin/bun","/root/.hm/judge/facts.js","facts","{transcript}","--regex","/root/.hm/judge/match.re"]}\n' "$arm" > "$j/judge-$arm.json"
  done
  python3 - "$t/.claude/settings.json" <<'PY'
import json, sys
p = sys.argv[1]
s = json.load(open(p))
for e in s["hooks"]["Stop"]:
    if e.get("_gstack_source") == "gstack-skill-contract":
        e["hooks"] = [{"type": "command", "command": "/root/.hm/judge/stop", "timeout": 60}]
s["hooks"].setdefault("PreToolUse", []).append({"matcher": "Bash", "_gstack_source": "hm-judge-risky", "hooks": [{"type": "command", "command": "/root/.hm/judge/risky", "timeout": 60}]})
json.dump(s, open(p, "w"), indent=2)
PY
  cp "$OUT/hook.gstack-config.tsv" "$OUT/judge.gstack-config.tsv"
  cp "$OUT/hook.loadout.lock.json" "$OUT/judge.loadout.lock.json"
  canonical_tar -C trees/judge -cf judge.tar $(cd "$t" && ls -A)
}
build_hm() {
  local man=$HERE/manifests/hm root=$LANEB/../.. arm head a1 a2 keys src flags b64
  local patch=$root/lanes/harness-mechanics/verify-hook.patch
  mkdir -p "$man"
  if [ "${SKIP_BUILD:-0}" != 1 ]; then
    echo "== gstack at $HM_SHA"
    rm -rf "$OUT/src-pin" "$OUT/src-hook"
    git init -q "$OUT/src-pin"
    git -C "$OUT/src-pin" fetch -q --depth 1 "$GSTACK_REPO" "$HM_SHA"
    git -C "$OUT/src-pin" checkout -q FETCH_HEAD
    head=$(git -C "$OUT/src-pin" rev-parse HEAD)
    test "$head" = "$HM_SHA"
    a1=$(git -C "$OUT/src-pin" archive --format=tar "$HM_SHA" | sha256sum | cut -d' ' -f1)
    a2=$(git -C "$OUT/src-pin" archive --format=tar "$HM_SHA" | sha256sum | cut -d' ' -f1)
    test "$a1" = "$a2"
    git -C "$OUT/src-pin" -c pack.threads=1 repack -a -d -F -q
    printf '{"repo":"%s","sha":"%s","head":"%s","method":"git init; git fetch --depth 1 <repo> <sha>; git checkout FETCH_HEAD","git_archive_sha256":"%s"}\n' \
      "$GSTACK_REPO" "$HM_SHA" "$head" "$a1" > "$OUT/fetch-pin.json"
    git -C "$OUT/src-pin" apply --check "$patch"
    rm -rf "$OUT/trees"
    mkdir -p "$OUT/trees/none/.claude/skills"
    for arm in prose hook ${HM_PLAIN:+plain}; do
      flags=--skill-contracts; keys=""; b64=""
      if [ "$arm" = prose ]; then keys="skill_contracts=off"; fi
      if [ "$arm" = hook ]; then b64=$(base64 -w0 "$patch"); fi
      if [ "$arm" = plain ]; then flags=""; fi
      src=$OUT/src-pin
      echo "== $arm arm: ./setup --host claude --no-browser --loadout $L1_LOADOUT $flags at $HM_SHA in docker (keys: ${keys:-none}; patch: ${b64:+after setup})"
      rm -rf "$OUT/$arm-export"
      docker buildx build --progress=plain --no-cache-filter gstack-l1-build --build-context gstack="$src" \
        --build-arg GSTACK_LOADOUT="$L1_LOADOUT" --build-arg GSTACK_SETUP_FLAGS="$flags" --build-arg GSTACK_KEYS="$keys" --build-arg GSTACK_PATCH_B64="$b64" \
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
    build_judge
    echo "== tars"
    canonical_tar -C trees/none -cf none.tar .claude
    for arm in $HM_ARMS; do in_builder sh -c "gzip -n -6 -c $arm.tar > $arm.tar.gz"; done
  fi
  echo "== manifests"
  cd "$root"
  for arm in $HM_ARMS; do
    meta=(--meta claude_code="$CLAUDE_CODE_VERSION" --meta tar_gz_sha256="$(sha256sum "$OUT/$arm.tar.gz" | cut -d' ' -f1)")
    if [ "$arm" != none ]; then
      meta+=(--meta gstack_sha="$HM_SHA" --meta update_check=false --meta onboarding_markers="$(markers "$OUT/trees/$arm")"
        --fetch "$OUT/fetch-pin.json" --config "$OUT/$arm.gstack-config.tsv" --lock "$OUT/$arm.loadout.lock.json")
    fi
    if [ "$arm" = judge ]; then
      meta+=(--meta dr_runtime_sha256="$(cat "$OUT/dr-out/dr-runtime.tar.gz.sha256")" --meta band_sha256="$(sha256sum "$OUT/trees/judge/.hm/judge/band.json" | cut -d' ' -f1)"
        --meta hm_judge_sha256="$(sha256sum "$OUT/trees/judge/.hm/judge/hm_judge.py" | cut -d' ' -f1)" --meta facts_sha256="$(sha256sum "$OUT/trees/judge/.hm/judge/facts.js" | cut -d' ' -f1)")
    fi
    bun lanes/harness-mechanics/arms.ts manifest --arm "$arm" --tree "$OUT/trees/$arm" --tar "$OUT/$arm.tar" --out "$man" "${meta[@]}"
  done
  ls -l "$OUT"/*.tar "$OUT"/*.tar.gz
}
if [ "$MODE" = hm ]; then build_hm; exit 0; fi

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

if wants placebo; then
  echo "== placebo arm"
  (cd "$LANEB" && bun arms/placebo/generate.ts --seed "$SEED" \
    --in "$OUT/trees/gstack/.claude/skills" --out "$OUT/trees/placebo/.claude/skills" \
    --report "$MANIFESTS/placebo-tokens.tsv") | tee "$OUT/placebo.txt"
  GENERATOR_HASH=$(sed -n 's/^generator_hash //p' "$OUT/placebo.txt")
  chmod 755 "$OUT"/trees/placebo/.claude "$OUT"/trees/placebo/.claude/skills
fi
chmod 755 "$OUT"/trees/none/.claude "$OUT"/trees/none/.claude/skills

echo "== tars"
if wants none; then canonical_tar -C trees/none -cf none.tar .claude; fi
if wants placebo; then canonical_tar -C trees/placebo -cf placebo.tar .claude; fi
for arm in $ARMS; do in_builder sh -c "gzip -n -6 -c $arm.tar > $arm.tar.gz"; done

echo "== manifests"
cd "$LANEB"
for arm in $ARMS; do
  meta=(--meta claude_code="$CLAUDE_CODE_VERSION" --meta tar_gz_sha256="$(sha256sum "$OUT/$arm.tar.gz" | cut -d' ' -f1)")
  [ "$arm" = none ] || meta+=(--meta gstack_sha="$GSTACK_SHA")
  [ "$arm" = gstack ] && meta+=(--meta update_check=false --meta onboarding_markers="$(cd "$OUT/trees/gstack" && ls -A .gstack | grep -E '^\.(feature-prompted-model-overlay|completeness-intro-seen|telemetry-prompted|proactive-prompted|activated|first-loop-tip-shown)$' | sed 's#^#.gstack/#' | paste -sd' ')")
  [ "$arm" = placebo ] && meta+=(--meta placebo_seed="$SEED" --meta placebo_generator_hash="$GENERATOR_HASH")
  bun arms/tree.ts manifest --arm "$arm" --tree "$OUT/trees/$arm" --tar "$OUT/$arm.tar" --out "$MANIFESTS" "${meta[@]}"
done

if wants placebo; then
  echo "== placebo tests on the installed tree"
  LANEB_GSTACK_SKILLS="$OUT/trees/gstack/.claude/skills" bun test tests/placebo.test.ts
fi

ls -l "$OUT"/*.tar "$OUT"/*.tar.gz
