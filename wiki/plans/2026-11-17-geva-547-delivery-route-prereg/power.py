#!/usr/bin/env python3
# power.py: the delivery route eval's power numbers, from closed forms and exact binomials (no simulation, no seed).
# 1. The smallest paired difference in followed rate between two arms of one model that a two-sided 0.05 test finds 80% of
#    the time on n paired tasks, for a share q of discordant pairs: (z_0.975 + z_0.8) x sqrt(q / n).
# 2. The 80% bar: the followed count an arm needs on n graded sessions (ceil(0.8 n)), and the chance an arm whose true rate
#    is p reaches it, P(X >= ceil(0.8 n)) for X ~ Binomial(n, p), at n = 60 and at 54 (the most gaps the gap rule allows).
# 3. Wilson 95% intervals at a few counts out of 60, as the report prints them.
# Writes nothing; power.txt beside this file is its output.
import math

Z975, Z80 = 1.959963984540054, 0.8416212335729143

def comb_tail(n, k, p):
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))

def wilson(k, n, z=Z975):
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (c - h) / d, (c + h) / d

n = 60
print('paired MDD at n=%d, two-sided alpha 0.05, power 0.8: (z_0.975 + z_0.8) = %.4f' % (n, Z975 + Z80))
for q in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7):
    print('  discordant share %.1f: %.1f points' % (q, 100 * (Z975 + Z80) * math.sqrt(q / n)))
for m in (60, 54):
    k = math.ceil(0.8 * m)
    print('bar at n=%d graded: %d followed (%.1f%%)' % (m, k, 100 * k / m))
    for p in (0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95):
        print('  true rate %.2f reaches it with probability %.3f' % (p, comb_tail(m, k, p)))
for k in (0, 1, 30, 46, 48, 54, 60):
    lo, hi = wilson(k, n)
    print('wilson %d/%d: %.1f%% [%.1f%%, %.1f%%]' % (k, n, 100 * k / n, 100 * lo, 100 * hi))
