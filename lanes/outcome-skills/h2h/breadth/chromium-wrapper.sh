#!/bin/sh
# Copyright (c) 2026 Garry Tan. MIT License.
# The B1 browser launcher (plan sections 3 and 6). It sits outside the repository at /opt/h2h/chromium, and CHROME_BIN and
# PUPPETEER_EXECUTABLE_PATH name it, so Karma, testem and Puppeteer launch Chromium without any frozen test config being
# edited. It execs the image's Playwright Chromium (the highest revision under PLAYWRIGHT_BROWSERS_PATH, /ms-playwright by
# default) with --no-sandbox and --disable-dev-shm-usage, then the caller's arguments. The hardened container drops every
# capability and sets no-new-privileges, so Chromium's own sandbox cannot start there.
set -eu
root="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
best=""
rev=-1
for c in "$root"/chromium-*/chrome-linux*/chrome; do
  [ -x "$c" ] || continue
  r=${c#"$root"/chromium-}
  r=${r%%/*}
  case $r in "" | *[!0-9]*) continue ;; esac
  if [ "$r" -gt "$rev" ]; then
    rev=$r
    best=$c
  fi
done
if [ -z "$best" ]; then
  echo "h2h chromium wrapper: no Playwright Chromium under $root" >&2
  exit 127
fi
exec "$best" --no-sandbox --disable-dev-shm-usage "$@"
