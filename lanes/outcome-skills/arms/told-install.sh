#!/usr/bin/env bash
# told-install.sh SRC HOME_DIR: the G told install (G prereg section 2; O1). It clones gstack from SRC into HOME_DIR, which
# must not exist yet, checks out the pin by sha and runs the pin's own ./setup --host claude --loadout lite with no input
# and a clean environment, exactly as #193's install-pin.sh does (TOLD_PATH sets PATH; the default is #193's). Any failed
# step stops the script. Check the result with told.ts's checkToldHome (OUTCOME_TOLD_HOME=HOME_DIR bun test tests/outcome-skills).
set -euo pipefail
SHA=699a41cb6808e01240d02e82247693f9170d401a
src="$1"; H="$2"
[ ! -e "$H" ] || { echo "E_OUTCOME_TOLD_INSTALL $H exists; the told install needs a clean HOME" >&2; exit 2; }
mkdir -p "$H/.claude/skills"
git clone --quiet "$src" "$H/.claude/skills/gstack"
cd "$H/.claude/skills/gstack"
git checkout --quiet "$SHA"
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "E_OUTCOME_TOLD_INSTALL $src has no commit $SHA" >&2; exit 2; }
env -i HOME="$H" PATH="${TOLD_PATH:-/usr/local/bin:/usr/bin:/bin}" USER=user LANG=C.UTF-8 TERM=dumb GSTACK_SKIP_PLAYWRIGHT=1 GSTACK_SKIP_FONTS=1 bash -c './setup --host claude --loadout lite' </dev/null
