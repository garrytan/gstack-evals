#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Builds the arm-neutral runtime layer for every decision-routing cell and packs it as one tarball:
#   <prefix>/python  uv-managed standalone CPython (PYTHON_VERSION below)
#   <prefix>/venv    uv venv installed from requirements.lock with --require-hashes
#   <prefix>/src     the dr_agent package, on the venv's sys.path through a .pth file
# The venv records absolute paths, so build at the prefix the tarball unpacks to (default /opt/dr). To keep a host's
# /opt/dr untouched, run this inside a throwaway container, for example:
#   docker run --rm -v "$(command -v uv)":/usr/local/bin/uv:ro -v "$PWD":/repo:ro -v "$OUT":/out \
#     debian:bookworm-slim bash /repo/lanes/decision-routing/agent/runtime/build.sh /out
# The tarball is reproducible for one uv version and one tar and gzip: names sorted, mtime 0, owner and group 0, no
# gzip timestamp, bytecode compiled in checked-hash mode with a fixed hash seed (PYTHONHASHSEED=0, so a frozenset
# constant marshals in one order). It prints "sha256 <hex>  <tarball>" last.
# Usage: build.sh <out-dir> [prefix]
set -euo pipefail
umask 022

PYTHON_VERSION=3.12.15
UV_VERSION=0.13.4
OUT=${1:?usage: build.sh <out-dir> [prefix]}
PREFIX=${2:-/opt/dr}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
AGENT_SRC=$HERE/../dr_agent

fail() { echo "E_DR_RUNTIME: build.sh: $1" >&2; exit 2; }

[[ $PREFIX = /* ]] || fail "the prefix must be an absolute path, got $PREFIX"
[[ -d $AGENT_SRC ]] || fail "no dr_agent package at $AGENT_SRC"
have_uv=$(uv --version | awk '{print $2}')
[[ $have_uv = "$UV_VERSION" ]] || fail "uv $UV_VERSION is pinned for a reproducible venv, found uv $have_uv"
if [[ -e $PREFIX ]] && [[ -n $(ls -A "$PREFIX") ]]; then fail "$PREFIX is not empty; build into a fresh prefix"; fi
mkdir -p "$PREFIX" "$OUT"
OUT=$(cd "$OUT" && pwd)

export UV_NO_CONFIG=1 UV_PYTHON_INSTALL_DIR=$PREFIX/python UV_LINK_MODE=copy SOURCE_DATE_EPOCH=0 PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0
uv python install --no-bin "$PYTHON_VERSION"
PY=$(echo "$PREFIX"/python/cpython-"$PYTHON_VERSION"-linux-*/bin/python3.12)
[[ -x $PY ]] || fail "uv did not install CPython $PYTHON_VERSION under $PREFIX/python"
rm -rf "$PREFIX"/python/.lock "$PREFIX"/python/.cache "$PREFIX"/python/.temp
"$PY" -I -m compileall -f -q -j1 --invalidation-mode checked-hash "$(dirname "$PY")/../lib/python3.12" >/dev/null \
  || fail "could not compile the standard library"

uv venv --python "$PY" "$PREFIX/venv"
uv pip install --python "$PREFIX/venv/bin/python" --require-hashes --no-deps -r "$HERE/requirements.lock"

mkdir -p "$PREFIX/src"
tar -C "$AGENT_SRC/.." --exclude=__pycache__ --exclude='*.pyc' -cf - dr_agent | tar -C "$PREFIX/src" -xf -
SITE=$("$PREFIX/venv/bin/python" -I -c 'import sysconfig; print(sysconfig.get_path("purelib"))')
echo "$PREFIX/src" > "$SITE/_dr_src.pth"
"$PY" -I -m compileall -f -q -j1 --invalidation-mode checked-hash "$SITE" >/dev/null || fail "could not compile the venv's packages"
"$PREFIX/venv/bin/python" -I -B -c 'import minisweagent, litellm, anthropic, openai, typesafe_sdk, dr_agent' \
  || fail "the built venv cannot import its packages"

TARBALL=$OUT/dr-runtime.tar.gz
tar -C "$PREFIX" --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -cf - python venv src \
  | gzip -n -6 > "$TARBALL"
sha=$(sha256sum "$TARBALL" | awk '{print $1}')
echo "$sha" > "$TARBALL.sha256"
echo "sha256 $sha  $TARBALL"
