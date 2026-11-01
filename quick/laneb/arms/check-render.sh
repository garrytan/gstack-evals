#!/usr/bin/env bash
# Offline checks of the two rendered gstack arms that build-render.sh wrote (GEVA-108's install-time evidence).
# Usage: bash quick/laneb/arms/check-render.sh [out dir]   (default ~/.capy/work/laneb-arms)
# On each arm's extracted tree: the lock carries the arm's session kind and no machine path, every served SKILL.md
# and sections file has the bytes the render's lock records, the root router is not served, and every
# "Read \`/root/.claude/gstack-render/...\`" pointer in a served skill resolves in the tree. Then, in the check image
# with --network none and the tar extracted into /root, it runs served /investigate's start line and shows its
# RENDER_KIND line, which only the unattended arm may print. Exits nonzero on any failed check.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT=${1:-$HOME/.capy/work/laneb-arms}
tag=laneb-check:ubuntu-24.04
docker buildx build -q --target check --build-arg BASE_IMAGE=ubuntu:24.04 -t "$tag" --load "$HERE" > /dev/null

for arm in gstack-render gstack-render-unattended; do
  kind=interactive
  [ "$arm" = gstack-render ] || kind=unattended
  echo "== $arm"
  python3 - "$OUT/trees/$arm/.claude" "$kind" <<'PY'
import hashlib, json, re, sys
from pathlib import Path
claude, kind = Path(sys.argv[1]), sys.argv[2]
render = claude / "gstack-render"
lock = json.loads((render / "loadout.lock.json").read_text())
assert lock["session_kind"] == kind and lock["install_root"] is None, (lock["session_kind"], lock["install_root"])
assert "/home/" not in json.dumps(lock) and "/tmp/" not in json.dumps(lock), "the lock names a machine path"
locked = {f["path"]: f["sha256"] for f in lock["files"]}
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
skills = sorted(p.parent.name for p in render.glob("*/SKILL.md"))
served = 0
for s in skills:
    folder = claude / "skills" / s
    assert sha(folder / "SKILL.md") == locked[f"{s}/SKILL.md"], f"{s}/SKILL.md is not the rendered file"
    for f in sorted((folder / "sections").rglob("*")) if (render / s / "sections").exists() else []:
        if f.is_file():
            assert sha(f) == locked[f"{s}/{f.relative_to(folder)}"], f"{f} is not the rendered file"
            served += 1
assert sha(claude / "skills" / "gstack" / "SKILL.md") != sha(render / "SKILL.md"), "the root router is served"
pointers = set()
for s in skills:
    pointers.update(re.findall(r"/root/\.claude/gstack-render/[\w./-]+", (claude / "skills" / s / "SKILL.md").read_text()))
missing = sorted(p for p in pointers if not (claude.parent / p[len("/root/"):]).exists())
assert not missing, f"pointers that do not resolve: {missing[:5]}"
inv = (claude / "skills" / "investigate" / "SKILL.md").read_text()
start = [l for l in inv.splitlines() if "bin/gstack-skill-start" in l]
assert start and all(("--render unattended" in l) == (kind == "unattended") for l in start), start
print(f"render {lock['spec']} {lock['gstack_version']}: {len(skills)} served skills match the lock, {served} section files, {len(pointers)} section pointers resolve")
print(f"investigate SKILL.md sha256 {sha(claude / 'skills' / 'investigate' / 'SKILL.md')}")
print(f"start line: {start[0].strip()}")
PY
  line=$(grep -m1 'bin/gstack-skill-start' "$OUT/trees/$arm/.claude/skills/investigate/SKILL.md")
  printf '%s\n' "$line" > "$OUT/$arm.start-line"
  out=$(docker run --rm --network none -e HOME=/root -v "$OUT/$arm.tar:/arm.tar:ro" -v "$OUT/$arm.start-line:/start-line:ro" "$tag" \
    bash -c 'tar -x -C /root -f /arm.tar && cd /root && bash /start-line' 2>&1 || true)
  printf '%s\n' "$out" | grep -E '^RENDER_KIND' || echo "(no RENDER_KIND line)"
  if [ "$kind" = unattended ]; then
    printf '%s\n' "$out" | grep -qx 'RENDER_KIND: unattended'
  else
    ! printf '%s\n' "$out" | grep -q '^RENDER_KIND'
  fi
done
echo "check-render: ok"
