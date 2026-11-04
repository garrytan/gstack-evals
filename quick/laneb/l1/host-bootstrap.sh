#!/usr/bin/env bash
# Prepares a stock Ubuntu 24.04 Ubicloud VM as L1's awake host: jq, openssl and curl for ubi-runner and launch.sh, and
# Bun 1.4.4 at ~/.bun/bin, checked against the same sha256 the arm builder pins (arms/Dockerfile, linux-x64-baseline).
# The host runs no Docker and no trial; it holds the ledger and runs each part's controller.
set -euo pipefail
BUN_VERSION=1.4.4
BUN_TARGET=linux-x64-baseline
BUN_SHA256=e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76
{ command -v jq && command -v unzip && command -v openssl && command -v curl && command -v python3 && command -v ssh-keygen; } >/dev/null \
  || { sudo apt-get update -qq && sudo apt-get install -y -qq jq unzip openssl curl python3 openssh-client >/dev/null; }
if [ "$("$HOME/.bun/bin/bun" --version 2>/dev/null)" != "$BUN_VERSION" ]; then
  tmp=$(mktemp -d)
  curl -fsSLo "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-$BUN_TARGET.zip"
  echo "$BUN_SHA256  $tmp/bun.zip" | sha256sum -c - >/dev/null
  unzip -q "$tmp/bun.zip" -d "$tmp"
  mkdir -p "$HOME/.bun/bin"
  install -m 0755 "$tmp/bun-$BUN_TARGET/bun" "$HOME/.bun/bin/bun"
  rm -rf "$tmp"
fi
test "$("$HOME/.bun/bin/bun" --version)" = "$BUN_VERSION"
echo "host ready: bun $BUN_VERSION, $(jq --version), $(openssl version | cut -d' ' -f1-2)"
