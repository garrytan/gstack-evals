#!/usr/bin/env bash
# qa-install.sh SRC HOME_DIR SHA INSTALL: A3's gstack install for the state machines family's /qa line (prereg section 17),
# done the way a user installs gstack: in a throwaway container whose home, /root, is HOME_DIR, gstack is cloned from SRC
# into ~/.claude/skills/gstack, checked out at SHA, and the recorded INSTALL command runs there with no input. Every link,
# text file and compiled binary the install writes then names /root, the home the session sees, so the image build copies
# the home as written (statemachines/image.ts qaHomeCopy). The pin comes in as arguments, read from registry.json
# sm.pins.qa. The container gets no API key, no drive and no host environment: it mounts only HOME_DIR (and SRC, read-only,
# when it is a local dir), sets only the variables below, and is removed after the install whatever its outcome. The home
# is handed back to the caller's user. The image is buildpack-deps (git and a C compiler) with Bun 1.4.4, both by digest.
set -euo pipefail
src="$1"; H="$2"; SHA="$3"; INSTALL="$4"
BASE="buildpack-deps:trixie@sha256:5214476af627916270063c9f99a969381f32cd961c861ea95e740ba71abc125f"
BUN="oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "E_SM_ARM the /qa pin is not a 40-hex sha: $SHA" >&2; exit 2; }
[ -n "$INSTALL" ] || { echo "E_SM_ARM the /qa install command is not recorded" >&2; exit 2; }
[ ! -e "$H/.claude/skills" ] || { echo "E_OUTCOME_TOLD_INSTALL $H/.claude/skills exists; the /qa install needs a clean home" >&2; exit 2; }
mkdir -p "$H"
H="$(cd "$H" && pwd -P)"
mounts=(-v "$H:/root")
from="$src"
if [ -d "$src" ]; then
  mounts+=(-v "$(cd "$src" && pwd -P):/qa-src:ro")
  from=/qa-src
fi
image="$(printf 'FROM %s\nCOPY --from=%s /usr/local/bin/bun /usr/local/bin/bun\n' "$BASE" "$BUN" | docker build -q -)"
name="sm-qa-install-$$-$RANDOM"
trap 'docker rm -f -v "$name" >/dev/null 2>&1 || true' EXIT
docker run --name "$name" --user 0:0 "${mounts[@]}" -w /root \
  -e HOME=/root -e PATH=/usr/local/bin:/usr/bin:/bin -e USER=root -e LANG=C.UTF-8 -e TERM=dumb -e GSTACK_SKIP_PLAYWRIGHT=1 -e GSTACK_SKIP_FONTS=1 \
  --entrypoint bash "$image" -c '
set -euo pipefail
trap "chown -R \"\$4\" /root" EXIT
git config --system --add safe.directory "*"
mkdir -p /root/.claude/skills
git clone --quiet "$1" /root/.claude/skills/gstack
cd /root/.claude/skills/gstack
git checkout --quiet "$2"
[ "$(git rev-parse HEAD)" = "$2" ] || { echo "E_OUTCOME_TOLD_INSTALL $1 has no commit $2" >&2; exit 2; }
bash -c "$3" </dev/null' bash "$from" "$SHA" "$INSTALL" "$(id -u):$(id -g)"
