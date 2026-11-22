# Copyright (c) 2026 Garry Tan. MIT License.
# Smallest detectable differences for the weekly stable number (two-sided 0.05, 80% power).
#   python3 power.py > power.txt
from math import exp, sqrt

Z = 1.960 + 0.842
K = 80
print(f"Weekly passes, this week's stable minus last week's, paired over K = {K} tasks, one session per task per arm.")
print("B1 measured 9 of 60 tasks discordant between a treated arm and no gstack on Opus 5.5 (15%).")
for d in (0.10, 0.15, 0.20, 0.25):
    print(f"  discordant share {d:.2f}: 95% half-width {1.96 * sqrt(d / K) * 100:.1f} points, MDD {Z * sqrt(d / K) * 100:.1f} points")

print()
print(f"Weekly cost, geometric mean ratio of dollars per session, this week's over last week's, K = {K}.")
print("FOUN-404 measured an SD of 0.23 to 0.33 for the per-task log cost difference between arms.")
for sd in (0.23, 0.28, 0.33):
    print(f"  SD {sd:.2f}: MDD a ratio of {exp(Z * sd / sqrt(K)):.3f}")

print()
print(f"Block (4 weeks), stable minus no gstack pooled over 4 x {K} pairs, clustered by task.")
print("rho is the correlation of a task's paired difference across weeks; 0 is pure session noise, 1 is a fixed task effect.")
for d in (0.10, 0.15, 0.20):
    for rho in (0.0, 0.33, 1.0):
        v = d / (4 * K) * (1 + 3 * rho)
        print(f"  discordant share {d:.2f}, rho {rho:.2f}: MDD {Z * sqrt(v) * 100:.1f} points")

print()
print("False alarms: with no true change, a two-sided 95% interval lies wholly below 0 in about 2.5% of weeks,")
print(f"about {52 * 0.025:.1f} weeks a year.")
