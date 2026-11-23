#!/usr/bin/env python3
"""Power and MDD for the decision-routing eval's success endpoints (paired binary, one trial per task and cell).

Delta = mean over tasks of (cell A pass - cell B pass). With discordance d (share of tasks where the two cells differ) and a
true difference near 0, Var(Delta_hat) ~= (d - Delta^2) / n. MDD (two-sided alpha 0.05, power 0.80) = 2.802 * sqrt(d / n).
The non-inferiority test at margin M (one-sided alpha 0.025) has power Phi((Delta + M) / SE - 1.96), SE = sqrt((d - Delta^2) / n).
Inputs in hand (counts only): GPT-6.1 Sol arms on 80 SWE-rebench tasks differ on 3 to 7 (d 0.04 to 0.09); particle-1 arms on
78 to 80 tasks differ on 7 to 11 (d 0.09 to 0.14); Opus none and Sol none on 199 tasks differ on 28 (d 0.141).
"""
import math

Z = 1.959964 + 0.841621

def mdd(d, n):
    return Z * math.sqrt(d / n)

def n_for(d, m):
    return math.ceil(Z * Z * d / (m * m))

def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def ni_power(d, n, delta, m=0.075):
    se = math.sqrt(max(d - delta * delta, 1e-12) / n)
    return phi((delta + m) / se - 1.959964)

if __name__ == "__main__":
    ds = [0.08, 0.10, 0.12, 0.15, 0.18, 0.20]
    ns = [100, 120, 160, 200, 240, 280, 300, 400]
    print("MDD in points (rows: discordance d; columns: tasks n)")
    print("d     " + "".join(f"{n:>7}" for n in ns))
    for d in ds:
        print(f"{d:<6}" + "".join(f"{100*mdd(d,n):>7.1f}" for n in ns))
    print()
    print("Tasks needed for a non-inferiority margin M at 80% power (one-sided alpha 0.025, true difference 0)")
    ms = [0.05, 0.075, 0.10]
    print("d     " + "".join(f"{100*m:>7.1f}" for m in ms))
    for d in ds:
        print(f"{d:<6}" + "".join(f"{n_for(d,m):>7}" for m in ms))
    print()
    print("Power of the 7.5-point non-inferiority test at 280 tasks, by true difference (points)")
    deltas = [0.0, -0.02, -0.03]
    print("d     " + "".join(f"{100*x:>8.0f}" for x in deltas))
    for d in ds:
        print(f"{d:<6}" + "".join(f"{ni_power(d,280,x):>8.2f}" for x in deltas))
