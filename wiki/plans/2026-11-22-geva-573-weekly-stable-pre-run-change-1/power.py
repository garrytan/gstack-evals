# Copyright (c) 2026 Garry Tan. MIT License.
# Pre-run change 1 to the weekly stable number: smallest detectable differences and weekly cost for the two sizes.
#   python3 power.py > power.txt
from math import sqrt

Z = 1.960 + 0.842
print("Weekly primary, candidate minus stable, two-sided 0.05 at 80% power. MDD = 2.802 sqrt(d / N).")
print("d is the share of pairs where the two arms disagree; N is the number of pairs.")
for name, n in (("S80: 80 tasks, one session each", 80), ("S390: 130 tasks, three sessions each", 390)):
    for d in (0.10, 0.15, 0.20):
        print(f"  {name}, d {d:.2f}: MDD {Z * sqrt(d / n) * 100:.1f} points")
print("S390 pairs share a task three at a time, so its interval is cluster-robust by task; under pure session noise")
print("the clustering costs nothing, and a fixed task-by-release effect widens it.")
print()
print("Sessions needed for an MDD of 5 points: N = (2.802 / 0.05)^2 d")
for d in (0.10, 0.15, 0.20):
    print(f"  d {d:.2f}: {Z * Z * d / 0.0025:.0f} pairs")
print()
rates = {"opus": (0.48, 0.31), "sol": (0.55, 0.45)}
for size, (tasks, reps, none_tasks) in {"S80": (80, 1, 80), "S390": (130, 3, 130)}.items():
    for m, (g, n) in rates.items():
        model = tasks * reps * g * 2 + none_tasks * n + 3 * g
        print(f"  {size} {m}: model spend expected ${model:.0f} ({tasks * reps * 2 + none_tasks + 3} sessions)")
