# Plan v3 (GEVA-225): one skill of a family passes admission alone and pays every unspent shared cost.
# Re-size rule (gate_rev 2, d7), a fixed order with no search: drop the particle-1 row first, then trials,
# then tasks, one step at a time, until the survivor fits its plan. Wave 1's planned designs carry no
# particle-1 row, so the first step changes nothing. A re-size past the 20-point bound stops the survivor.
import json, os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "cost.py")).read().split("res = {}")[0])
BOUND = 20.0
def alone(f, s, n, k):
    me = MEAS[f]; cand = n / YIELD[f]
    t = CREW[f] / 2 + CALIB[f] / 2 + (cand + SLICE) * AUTH[f] + cand * SCR_T[f] * (NONE + VM + SCR_MEAS[f])
    t += SLICE * 2 * (NONE + VM + me) + SLICE * 2 * (NONE * TOLD[s] + VM + me)
    t += n * k * (NONE + VM + me) + n * k * (NONE * TOLD[s] + VM + me)
    return t
out = {}
for f, sk in FAM.items():
    base = best(f, (0, 0), (0, 0))
    if base is None:
        print(f, "no both-pass design fits")
        continue
    for i, s in enumerate(sk):
        n, k = base[1][i], base[2]
        at_size = alone(f, s, n, k)
        while alone(f, s, n, k) > PLAN and k > 2:
            k -= 1
        while alone(f, s, n, k) > PLAN and n > min(NS):
            n -= 6
        fits = alone(f, s, n, k) <= PLAN
        m = mdd(n, k, 0.05) if fits else None
        out[s] = dict(both=dict(n=base[1][i], k=base[2], mdd=base[3][i], planned=round(sum(base[4][i].values()))),
                      alone_at_planned_size=round(at_size),
                      survivor=dict(n=n, k=k, mdd=m, planned=round(alone(f, s, n, k)) if fits else None,
                                    stops=(m is None or m > BOUND)))
for s, v in out.items(): print(s, v)
print("wave1 both-pass planned", sum(v["both"]["planned"] for v in out.values()))
