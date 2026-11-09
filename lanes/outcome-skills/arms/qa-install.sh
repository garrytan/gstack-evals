#!/usr/bin/env bash
# qa-install.sh SRC HOME_DIR SHA INSTALL: A3's gstack install for the state machines family's /qa line (prereg section 17).
# Like told-install.sh (family G, byte identical and pinned there), but the pin comes in as arguments, read from
# registry.json sm.pins.qa, which is recorded at freeze. It clones gstack from SRC into HOME_DIR/.claude/skills/gstack,
# checks out SHA and runs the recorded INSTALL command with no input and a clean environment. HOME_DIR is the session
# container's home (/root), never the repository, so the install lands after the strip and every arm's tree stays the same.
set -euo pipefail
src="$1"; H="$2"; SHA="$3"; INSTALL="$4"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "E_SM_ARM the /qa pin is not a 40-hex sha: $SHA" >&2; exit 2; }
[ -n "$INSTALL" ] || { echo "E_SM_ARM the /qa install command is not recorded" >&2; exit 2; }
[ ! -e "$H/.claude/skills" ] || { echo "E_OUTCOME_TOLD_INSTALL $H/.claude/skills exists; the /qa install needs a clean home" >&2; exit 2; }
mkdir -p "$H/.claude/skills"
git clone --quiet "$src" "$H/.claude/skills/gstack"
cd "$H/.claude/skills/gstack"
git checkout --quiet "$SHA"
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "E_OUTCOME_TOLD_INSTALL $src has no commit $SHA" >&2; exit 2; }
env -i HOME="$H" PATH="${TOLD_PATH:-/usr/local/bin:/usr/bin:/bin}" USER=user LANG=C.UTF-8 TERM=dumb GSTACK_SKIP_PLAYWRIGHT=1 GSTACK_SKIP_FONTS=1 bash -c "$INSTALL" </dev/null
