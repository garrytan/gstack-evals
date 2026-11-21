#!/usr/bin/env python3
# power.py: B2's stop bounds, power and smallest detectable differences. Standard library only.
# Group-sequential bounds are O'Brien-Fleming shaped for two looks (one interim at information fraction t, then the end):
# reject at the look when |Z1| >= C / sqrt(t), at the end when |Z2| >= C, with corr(Z1, Z2) = sqrt(t), and C chosen so
# the two-sided type I error over both looks is alpha. Worked example check: alpha 0.05 at t = 0.5 must give 2.797 and
# 1.977 (Jennison and Turnbull, Group Sequential Methods, 2000, Table 2.3, K = 2).
import math
NL = chr(10)
Phi = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
phi = lambda x: math.exp(-x * x / 2) / math.sqrt(2 * math.pi)

def p_continue(c1, c2, t, m1=0.0, m2=0.0, n=4000):
    # P(|Z1| < c1 and |Z2| < c2), Z1 ~ N(m1, 1), Z2 ~ N(m2, 1), corr sqrt(t), by Simpson's rule over Z1.
    r = math.sqrt(t); s = math.sqrt(1 - t)
    a, b = -c1, c1
    hh = (b - a) / n
    tot = 0.0
    for i in range(n + 1):
        z = a + i * hh
        w = 1 if i in (0, n) else (4 if i % 2 else 2)
        mu = m2 + r * (z - m1)
        tot += w * phi(z - m1) * (Phi((c2 - mu) / s) - Phi((-c2 - mu) / s))
    return tot * hh / 3

def obf(alpha, t):
    lo, hi = 1.0, 4.0
    for _ in range(60):
        C = (lo + hi) / 2
        if 1 - p_continue(C / math.sqrt(t), C, t) > alpha: lo = C
        else: hi = C
    C = (lo + hi) / 2
    return C / math.sqrt(t), C

def drift80(c1, c2, t, power=0.8):
    lo, hi = 0.0, 6.0
    for _ in range(60):
        th = (lo + hi) / 2
        if 1 - p_continue(c1, c2, t, th * math.sqrt(t), th) < power: lo = th
        else: hi = th
    return (lo + hi) / 2

out = []
c1, c2 = obf(0.05, 0.5)
out.append('worked example, alpha 0.05 at t = 0.5: look %.3f, end %.3f (published 2.797, 1.977)' % (c1, c2))
assert abs(c1 - 2.797) < 0.002 and abs(c2 - 1.977) < 0.002

T, HALF, M, G = 183, 92, 3, 126
t = HALF / T
A_PASS, A_PWT = 0.04, 0.01
b1, b2 = obf(A_PASS, t)
out.append('passes, alpha %.2f two-sided, look at %d of %d tasks (t = %.4f): look |z| >= %.3f, end |z| >= %.3f' % (A_PASS, HALF, T, t, b1, b2))
def z_two_sided(alpha):
    lo, hi = 1.0, 4.0
    for _ in range(60):
        c = (lo + hi) / 2
        if 2 * (1 - Phi(c)) > alpha: lo = c
        else: hi = c
    return (lo + hi) / 2

c_pwt = z_two_sided(A_PWT)
out.append('passes with a regression test, alpha %.2f two-sided, read at the end only: |z| >= %.3f' % (A_PWT, c_pwt))
th = drift80(b1, b2, t)
z80 = 0.8416212335729143
out.append('drift for 80%% power under the passes bounds: %.3f standard errors (one look at the end alone, alpha %.2f two-sided, needs %.3f)' % (th, A_PASS, z_two_sided(A_PASS) + z80))

out.append('')
out.append('Pooled passes contrast over the three models, %d tasks, %d repositories. Var(D) = sum over models of the' % (T, G))
out.append('discordant share, over M^2 T, times a design effect for repository clustering. B1 measured discordance on passes')
out.append('between a treated arm and none of 9/60 (Opus), 3/60 (Sol in Claude Code) and 6/60 (particle-1), and a design')
out.append('effect of 0.78 to 1.01 for task clustering across models.')
scen = [('B1 rates (0.15, 0.05, 0.10)', [0.15, 0.05, 0.10]), ('all at 0.10', [0.10] * 3), ('all at 0.15', [0.15] * 3), ('all at 0.20', [0.20] * 3)]
for name, ds in scen:
    for deff in (1.0, 1.25):
        se = math.sqrt(sum(ds) / (M * M * T) * deff)
        out.append('  %-28s deff %.2f: SE %.2f points, MDD %.1f points' % (name, deff, 100 * se, 100 * th * se))
out.append('')
out.append('Per model, single look, Newcombe-style two-sided 0.05 at 80% power, MDD = (1.960 + 0.842) sqrt(disc / T):')
for disc in (0.05, 0.10, 0.15, 0.20, 0.30):
    out.append('  discordant share %.2f: MDD %.1f points' % (disc, 100 * (1.959964 + z80) * math.sqrt(disc / T)))
out.append('')
out.append('Passes with a regression test, pooled, alpha 0.01 at the end, 80% power:')
for disc in (0.15, 0.20, 0.30, 0.40):
    se = math.sqrt(disc / (M * T) * 1.25)
    out.append('  discordant share %.2f, deff 1.25: MDD %.1f points' % (disc, 100 * (c_pwt + z80) * se))
print(NL.join(out))
