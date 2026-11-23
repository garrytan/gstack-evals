# Copyright (c) 2026 Garry Tan. MIT License.
# Size S390's task list: all 130 eligible tasks in the preregistration's seeded run order. Reuses the preregistration's
# draw (same pool, exclusions and seed) and checks that its first 80 are the preregistration's tasks.txt.
#   python3 s390.py > s390-tasks.txt
import hashlib, random, sys
from pathlib import Path

PRE = Path(__file__).resolve().parent.parent / "2026-11-22-geva-573-weekly-stable-prereg"
SCREENED = PRE.parent / "2026-11-21-capy-b2-test-first-prereg" / "hm-screened.txt"
SCREENED_SHA256 = "ef74c5c64f6fe50d0d462af450ef65a082476b3d250df8e576de5e337f0cf886"
SEED = 3892364212

raw = SCREENED.read_bytes()
if hashlib.sha256(raw).hexdigest() != SCREENED_SHA256:
    sys.exit("hm-screened.txt is not the pinned copy")
rows = [l.split() for l in raw.decode().splitlines() if l.strip()]
excluded = set(l.strip() for l in (PRE / "excluded.txt").read_text().splitlines() if l.strip())
eligible = sorted(i for k, i in rows if k == "scored" and i not in excluded and not i.endswith("_interface"))
order = list(eligible)
random.Random(SEED).shuffle(order)
s80 = [l.split()[1] for l in (PRE / "tasks.txt").read_text().splitlines() if l.startswith("run ")]
if order[:80] != s80:
    sys.exit("the first 80 differ from the preregistration's tasks.txt")
for i in order:
    print(i)
