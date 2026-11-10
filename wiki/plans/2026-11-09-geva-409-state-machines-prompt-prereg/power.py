#!/usr/bin/env python3
"""Power and money for the implicit state machines prompt preregistration (GEVA-409).

Keyless, deterministic. Prints the MDD tables and the money table the plan quotes.
Run: python3 power.py
"""
import math, random

Z = 1.96 + 0.8416  # two-sided alpha 0.05, 80% power

def mdd_paired_binary(d, n, deff=1.0):
    return Z * math.sqrt(d / n) * math.sqrt(deff)

print("== Claim 1, bug fixing: paired binary, one session per unit, arm and model")
print("d (discordant share) | MDD n=60 | MDD n=60, deff 1.2 | MDD pooled 3 models n=180, deff 1.2")
for d in (0.10, 0.15, 0.20, 0.30):
    print(f"{d:.2f} | {100*mdd_paired_binary(d,60):.1f} | {100*mdd_paired_binary(d,60,1.2):.1f} | {100*mdd_paired_binary(d,180,1.2):.1f}")

print()
print("== Claim 1, expected 95% upper bound on A1 - A2 at n = 60 when the true difference is negative")
for true_diff, d in ((-0.10, 0.20), (-0.15, 0.25), (-0.05, 0.15), (0.0, 0.15)):
    se = math.sqrt(max(d - true_diff**2, 1e-9) / 60)
    print(f"true {100*true_diff:+.0f} pts, d {d:.2f}: expected upper bound {100*(true_diff + 1.96*se):+.1f} pts")

print()
print("== Claim 2, structure: per-unit difference of mean follow-on success over k replicates per tree")
print("Unit success rates drawn from a mixture: 40% near 0.95, 25% near 0.05, 35% uniform 0.2 to 0.8 (SWE-style tasks).")
rng = random.Random(20261109)
def draw_p():
    u = rng.random()
    if u < 0.40: return min(0.99, max(0.80, rng.gauss(0.95, 0.04)))
    if u < 0.65: return min(0.20, max(0.01, rng.gauss(0.05, 0.04)))
    return rng.uniform(0.2, 0.8)
def sd_diff(k, interaction_sd, sims=20000, carry=0.0):
    vals = []
    for _ in range(sims):
        p = draw_p()
        pa = min(0.99, max(0.01, p + rng.gauss(0, interaction_sd)))
        pb = min(0.99, max(0.01, p + rng.gauss(0, interaction_sd)))
        if rng.random() < carry:
            pa = 0.0
        a = sum(rng.random() < pa for _ in range(k)) / k
        b = sum(rng.random() < pb for _ in range(k)) / k
        vals.append(a - b)
    m = sum(vals) / len(vals)
    return math.sqrt(sum((v - m) ** 2 for v in vals) / (len(vals) - 1))
print("k | unit-by-tree sd | SD of unit difference | MDD n=60 | MDD n=60, deff 1.2")
for k in (1, 2, 3):
    for isd in (0.0, 0.10):
        s = sd_diff(k, isd)
        print(f"{k} | {isd:.2f} | {s:.3f} | {100*Z*s/math.sqrt(60):.1f} | {100*Z*s*math.sqrt(1.2)/math.sqrt(60):.1f}")

print()
print("== Claim 2 end to end, k = 3, when the first stage leaves a stable test broken on a share of trees (the unit then fails on that tree)")
print("carry-over share | SD of unit difference | MDD n=60, deff 1.2")
for carry in (0.05, 0.10, 0.20):
    s = sd_diff(3, 0.10, carry=carry)
    print(f"{carry:.2f} | {s:.3f} | {100*Z*s*math.sqrt(1.2)/math.sqrt(60):.1f}")
print("The incremental score (claim 2 primary) is measured against the start tree, so carry-over does not enter it; its MDD is the k = 3 row above.")

print()
print("== Money at planning prices (USD); caps are central x 1.2 on model items, rounded up to $10")
PRICE = {  # per session
    "blind": {"opus": 3.00, "sol": 3.00, "particle": 0.30},
    "qa": {"opus": 6.00, "sol": 6.00, "particle": 0.60},
    "follow": {"opus": 0.70, "sol": 0.80, "particle": 0.10},
}
N_ADMIT, N, K = 15, 60, 3
VM_PER_SESSION = 0.08
rows = []
def item(name, what, central, cap_mult=1.2, cap=None):
    c = round(central, 2)
    cp = cap if cap is not None else int(math.ceil(c * cap_mult / 10.0) * 10)
    rows.append((name, what, c, cp))
item("sm-labels", "Astra and Opus eligibility labels, about 450 candidates", 100, cap=150)
item("sm-oracle", "VMs only: three base and three fixed runs per candidate", 40, cap=60)
admit = N_ADMIT * 2 * PRICE["blind"]["opus"] + N_ADMIT * K * PRICE["follow"]["opus"] + N_ADMIT * (2 + K) * VM_PER_SESSION
item("sm-admit", "15 admission units, Opus: plain and verbatim, and 3 follow-ons on the untouched tree; the cap covers the file-scope and ceiling-raise branches", admit, cap=270)
for m in ("opus", "sol", "particle"):
    bug = N * 3 * PRICE["blind"][m]
    follow = N * 2 * K * PRICE["follow"][m]
    s2 = N * PRICE["blind"][m] + N * K * PRICE["follow"][m]
    vm = (N * 4 + N * 3 * K) * VM_PER_SESSION
    item(f"sm-{m}", f"{m}: plain, verbatim, lens swap and refactor control on 60 units; 3 follow-ons on untouched, verbatim and refactor trees", bug + follow + s2 + vm)
judge = 60 * (0.35 + 0.15) + 60 * 0.35 + 180 * 0.15 * 2 + 40
item("sm-judges", "R78 label check, UX/DX/AX on 720 first-stage diffs, stock diffs", judge)
central = sum(r[2] for r in rows)
caps = sum(r[3] for r in rows)
crew = 250
for r in rows:
    print(f"{r[0]} | {r[1]} | {r[2]:.0f} | {r[3]}")
print(f"crew model use (counted from the counters, not capped) | {crew}")
print(f"TOTAL central {central + crew:.0f}; caps {caps} + crew {crew} = {caps + crew}")

print()
print("== Separate /qa line")
qrows = []
for m in ("opus", "sol", "particle"):
    q = N * PRICE["qa"][m] + N * VM_PER_SESSION
    qrows.append((m, q, int(math.ceil(q * 1.2 / 10) * 10)))
qadmit = 5 * PRICE["qa"]["opus"] + 5 * VM_PER_SESSION
qrows.append(("admit exposure, 5 Opus /qa sessions", qadmit, 50))
for m, c, cp in qrows:
    print(f"qa {m} | {c:.0f} | {cp}")
qcentral = sum(c for _, c, _ in qrows) + 60
qcaps = sum(cp for _, _, cp in qrows) + 60
print(f"QA TOTAL central {qcentral:.0f} (with $60 crew); caps {qcaps}")

print()
print("== Stage 2 on a claim 1 signal, per model, 120 more units, three arms")
for m in ("opus", "sol", "particle"):
    print(f"{m}: about {120*3*PRICE['blind'][m] + 120*3*VM_PER_SESSION:.0f}")
