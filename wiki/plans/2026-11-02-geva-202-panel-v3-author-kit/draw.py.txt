#!/usr/bin/env python3
"""Panel v3 calibration draw (kit v3).

A public seed spreads the four strata across the four authors: each author
writes two strata and each stratum gets two authors, three units each. OS
randomness (secrets) mints the unit labels and draws each unit's mode, anchor
shape and auditor. The output folder is sealed with the units; the command
prints the pairing and counts only, never a label.

  python3 draw.py calibration <public seed> <out dir>
"""
import json
import os
import random
import secrets
import sys

STRATA = ["ceo", "eng", "dx", "design"]
AUTHORS = ["A", "B", "C", "D"]
UNITS_PER_AUTHOR_STRATUM = 3


def pairing(seed):
    order = STRATA[:]
    random.Random(seed).shuffle(order)
    return {a: [order[i], order[(i + 1) % len(order)]] for i, a in enumerate(AUTHORS)}


def draw(seed):
    pairs = pairing(seed)
    rng = secrets.SystemRandom()
    labels, units = set(), []
    for s in STRATA:
        writers = [a for a in AUTHORS if s in pairs[a]]
        modes = ["added"] * 3 + ["fix"] * 3
        shapes = ["A-X", "A-X", "A-F", "A-F", "A-T", "A-T"]
        rng.shuffle(modes)
        rng.shuffle(shapes)
        first = rng.choice([["O", "O", "S"], ["O", "S", "S"]])
        second = ["O", "S", "S"] if first.count("O") == 2 else ["O", "O", "S"]
        auditors = []
        for split in (first, second):
            rng.shuffle(split)
            auditors += split
        slots = [a for a in writers for _ in range(UNITS_PER_AUTHOR_STRATUM)]
        for k, a in enumerate(slots):
            label = secrets.token_hex(4)
            while label in labels:
                label = secrets.token_hex(4)
            labels.add(label)
            units.append({"unit": label, "author": a, "stratum": s, "mode": modes[k],
                          "anchor_shape": shapes[k], "auditor": auditors[k]})
    rng.shuffle(units)
    return pairs, units


def main(argv):
    if len(argv) != 3 or argv[0] != "calibration":
        print("E_USAGE: python3 draw.py calibration <public seed> <out dir>")
        return 2
    seed, out = argv[1], argv[2]
    if os.path.exists(out):
        print("E_USAGE: out dir exists; the draw runs once")
        return 2
    os.makedirs(out, mode=0o700)
    pairs, units = draw(seed)
    with open(os.path.join(out, "assignment.json"), "w") as f:
        json.dump({"wave": "calibration", "seed": seed, "pairing": pairs, "units": units}, f, indent=1)
    for a in AUTHORS:
        mine = [{k: u[k] for k in ("unit", "stratum", "mode", "anchor_shape")} for u in units if u["author"] == a]
        with open(os.path.join(out, "author-%s.json" % a), "w") as f:
            json.dump({"author": a, "wave": "calibration", "units": mine}, f, indent=1)
    for a in AUTHORS:
        print("author %s strata %s units %d" % (a, ",".join(pairs[a]), 2 * UNITS_PER_AUTHOR_STRATUM))
    for s in STRATA:
        print("stratum %s units %d auditor O %d auditor S %d" % (
            s, sum(u["stratum"] == s for u in units),
            sum(u["stratum"] == s and u["auditor"] == "O" for u in units),
            sum(u["stratum"] == s and u["auditor"] == "S" for u in units)))
    print("units %d" % len(units))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
