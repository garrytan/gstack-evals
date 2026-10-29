#!/usr/bin/env bash
# Builds one image per arm tree: <suite>-before, <suite>-after and <suite>-none (before minus the skill).
# Usage: build-arms.sh <gstack clone> <base image>
set -euo pipefail
GSTACK=${1:?gstack clone}
BASE=${2:?base image}
HERE=$(cd "$(dirname "$0")" && pwd)
CTX_ROOT=${LANEA_WORK:-$HOME/.capy/work/lanea-quick}/docker-ctx
# Each context is the tree at its sha without test/, which holds graded task files. It is extracted into a temp dir
# and renamed into place only when the extraction succeeds, so a failed git archive leaves nothing to reuse.
build() { # suite arm sha drop
  local suite=$1 arm=$2 sha=$3 drop=${4:-}
  local ctx="$CTX_ROOT/$sha-no-test"
  if [ ! -d "$ctx/gstack" ]; then
    mkdir -p "$CTX_ROOT"
    local tmp
    tmp=$(mktemp -d "$CTX_ROOT/.extract-XXXXXX")
    mkdir "$tmp/gstack"
    git -C "$GSTACK" archive "$sha" | tar -x -C "$tmp/gstack" || { rm -rf "$tmp"; exit 1; }
    rm -rf "$tmp/gstack/test"
    mkdir -p "$ctx"
    mv "$tmp/gstack" "$ctx/gstack"
    rmdir "$tmp"
  fi
  docker build -q -f "$HERE/arm.Dockerfile" --build-arg BASE_IMAGE="$BASE" --build-arg DROP_SKILL="$drop" \
    --label lanea.sha="$sha" --label lanea.drop="$drop" -t "lanea-quick/$suite-$arm:latest" "$ctx"
  echo "built lanea-quick/$suite-$arm sha=$sha drop=$drop"
}
build office-hours before cd4fc4be73d86a5b14be9a91026d3e4b16cd8520
build office-hours after a14c28aca7839cd0182fa130bff9874714672c24
build office-hours none cd4fc4be73d86a5b14be9a91026d3e4b16cd8520 office-hours
build learn before 398618259d56df55e66793f168d0bd8c25cb9085
build learn after 7204a39a27ba90755db2e71e5bb869262a937402
build learn none 398618259d56df55e66793f168d0bd8c25cb9085 learn
