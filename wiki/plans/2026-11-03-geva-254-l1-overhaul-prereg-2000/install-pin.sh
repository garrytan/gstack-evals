#!/usr/bin/env bash
# install-pin.sh <before|after> <sha>: install one gstack pin with its own ./setup --loadout lite into a clean HOME,
# then render its lite lock twice with gstack-modules: at a neutral folder (render-<p>) and at setup's own render path
# (setup's render is moved aside for that render and put back after), saving that lock as lock-<p>-inplace.json.
# Run with <p> checked out as a clone at $W/<p>. manifest.py reads the results.
set -uo pipefail
p="$1"; sha="$2"
W="${L1_PINS_DIR:-$PWD/pins}"
H=$W/home-$p
rm -rf "$H" "$W/render-$p"; mkdir -p "$H/.claude/skills"
git clone --quiet "$W/$p" "$H/.claude/skills/gstack"
cd "$H/.claude/skills/gstack" && git checkout --quiet "$sha" || exit 9
echo "HEAD $(git rev-parse HEAD)"
run() { env -i HOME="$H" PATH=/usr/local/bin:/usr/bin:/bin USER=user LANG=C.UTF-8 TERM=dumb GSTACK_SKIP_PLAYWRIGHT=1 GSTACK_SKIP_FONTS=1 "$@"; }
run bash -c './setup --host claude --loadout lite' </dev/null > "$W/setup-$p.log" 2>&1
echo "SETUP_EXIT $?"
run bin/gstack-modules render --host claude --loadout lite --out-dir "$W/render-$p" > "$W/render-$p.log" 2>&1
echo "RENDER_EXIT $?"
R=$H/.gstack/render/claude
rm -rf "$W/setup-render-$p"; mv "$R" "$W/setup-render-$p"
run bin/gstack-modules render --host claude --loadout lite --out-dir "$R" > "$W/render-$p-inplace.log" 2>&1
echo "INPLACE_RENDER_EXIT $?"
cp "$R/loadout.lock.json" "$W/lock-$p-inplace.json"
rm -rf "$W/modules-render-$p-inplace"; mv "$R" "$W/modules-render-$p-inplace"; mv "$W/setup-render-$p" "$R"
