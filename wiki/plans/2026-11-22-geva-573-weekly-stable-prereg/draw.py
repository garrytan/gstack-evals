# Copyright (c) 2026 Garry Tan. MIT License.
# The weekly stable number's frozen task draw. Reads the harness mechanics eval's screened SWE-rebench list (the copy in
# B2's preregistration bundle, checked by sha256) and the 60 task ids named in gstack's old routing fixtures
# (excluded.txt), drops interface tasks and fixture tasks, and shuffles the rest once with the seed below.
#   python3 draw.py > draw.txt
import hashlib, random, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCREENED = HERE.parent / "2026-11-21-capy-b2-test-first-prereg" / "hm-screened.txt"
SCREENED_SHA256 = "ef74c5c64f6fe50d0d462af450ef65a082476b3d250df8e576de5e337f0cf886"
SEED = 3892364212  # minted from 4 random bytes on 2026-11-22 before any draw
K = 80
PILOT = 3

def digest(lines):
    return hashlib.sha256(("\n".join(lines) + "\n").encode()).hexdigest()

raw = SCREENED.read_bytes()
if hashlib.sha256(raw).hexdigest() != SCREENED_SHA256:
    sys.exit("hm-screened.txt is not the pinned copy")
rows = [l.split() for l in raw.decode().splitlines() if l.strip()]
excluded = set(l.strip() for l in (HERE / "excluded.txt").read_text().splitlines() if l.strip())
scored = sorted(i for k, i in rows if k == "scored")
calibration = sorted(i for k, i in rows if k == "calibration")
if not excluded <= set(scored):
    sys.exit("an excluded id is not in the scored list")

eligible = sorted(i for i in scored if i not in excluded and not i.endswith("_interface"))
order = list(eligible)
random.Random(SEED).shuffle(order)
run = order[:K]
pilot_pool = sorted(i for i in calibration if i not in excluded and not i.endswith("_interface"))
pilot = list(pilot_pool)
random.Random(SEED).shuffle(pilot)
pilot = pilot[:PILOT]

repos = lambda ids: len(set(i.rsplit("-", 1)[0] for i in ids))
print(f"pool scored {len(scored)} excluded {len(excluded)} interface {sum(i.endswith('_interface') for i in scored if i not in excluded)} eligible {len(eligible)} repositories {repos(eligible)} sorted sha256 {digest(eligible)}")
print(f"run {len(run)} repositories {repos(run)} sorted sha256 {digest(sorted(run))} ordered sha256 {digest(run)}")
print("pilot " + " ".join(pilot))
with open(HERE / "tasks.txt", "w") as f:
    for i in run:
        f.write(f"run {i}\n")
    for i in pilot:
        f.write(f"pilot {i}\n")
