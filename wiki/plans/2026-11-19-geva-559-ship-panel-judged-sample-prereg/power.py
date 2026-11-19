#!/usr/bin/env python3
# Estimator and power for the /ship review panel judged sample (GEVA-559).
# estimate() and interval() are the frozen primary; main() simulates outcomes on the drawn sample's PR clusters.
# Usage: power.py <draw.txt>
import collections, random, sys

FRAME = {"RT": 326, "AD": 170, "SM": 208, "FR": 225}
EXTRA = ("RT", "AD", "SM")


def estimate(items, unknown="impute"):
    # items: dicts with stratum, pr, floor (bool), k (section 6, default 1) and, for extra strata, cf in {"only", "also-fixed", "also-noted", "unknown"}
    by = collections.defaultdict(list)
    for i in items:
        by[i["stratum"]].append(i)
    if any(not by[s] for s in FRAME):
        return None
    E = A = 0.0
    pooled = [i for s in EXTRA for i in by[s] if i["floor"] and i["cf"] != "unknown"]
    w = lambda i: 1 / i.get("k", 1)
    pooled_w = sum(w(i) for i in pooled)
    pooled_only = sum(w(i) for i in pooled if i["cf"] == "only") / pooled_w if pooled else 0.0
    pooled_noted = sum(w(i) for i in pooled if i["cf"] == "also-noted") / pooled_w if pooled else 0.0
    for s in EXTRA:
        n = len(by[s])
        f = [i for i in by[s] if i["floor"]]
        only = sum(w(i) for i in f if i["cf"] == "only")
        noted = sum(w(i) for i in f if i["cf"] == "also-noted")
        fixed = sum(w(i) for i in f if i["cf"] == "also-fixed")
        unk = sum(w(i) for i in f if i["cf"] == "unknown")
        known = only + noted + fixed
        share = only / known if known else pooled_only
        u_only = {"impute": unk * share, "low": 0, "high": unk}[unknown]
        u_noted = {"impute": unk * (noted / known if known else pooled_noted), "low": unk, "high": 0}[unknown]
        E += FRAME[s] * (only + u_only) / n
        A += FRAME[s] * (noted + u_noted) / n
    D = FRAME["FR"] * sum(w(i) for i in by["FR"] if i["floor"]) / len(by["FR"])
    return E / (E + D + A) if E + D + A else None


def interval(items, unknown="impute", reps=10000, seed=559):
    prs = sorted({i["pr"] for i in items})
    of = collections.defaultdict(list)
    for i in items:
        of[i["pr"]].append(i)
    rng = random.Random(seed)
    vals = []
    for _ in range(reps):
        boot = [i for p in rng.choices(prs, k=len(prs)) for i in of[p]]
        u = estimate(boot, unknown)
        if u is not None:
            vals.append(u)
    vals.sort()
    skipped = reps - len(vals)
    if not vals:
        return None, None, skipped
    return vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1], skipped


def trail_known(items):
    blockers = [i for i in items if i["stratum"] in EXTRA and i["floor"]]
    if not blockers:
        return None
    return sum(i["cf"] != "unknown" for i in blockers) / len(blockers)


def reading(u, lo, hi):
    if u is None:
        return "no-reading"
    if u >= 0.30 and lo >= 0.15:
        return "keep"
    if hi < 0.15:
        return "backs-486"
    return "inconclusive"


def sample_clusters(path):
    out = []
    for line in open(path):
        f = line.rstrip("\n").split("\t")
        if len(f) == 9 and f[0] in FRAME and int(f[1]) <= 40:
            out.append((f[0], f"{f[3]}#{f[4]}"))
    return out


def main(path, sims=200, reps=1000):
    clusters = sample_clusters(path)
    print(f"# {len(clusters)} sampled findings in {len({p for _, p in clusters})} PRs; frame weights {FRAME}")
    print("# scenario: floor share in every stratum, share of extra-voice floor findings only an extra voice raised, share of those with a known first-pass trail; k = 1 for every item")
    print("# floor\tonly\tknown\ttrue_U\tmean_U\tmean_ci_width\tP(keep)\tP(backs-486)\tP(inconclusive)\tP(trail-thin)\tP(no-reading)\tskipped_replicates")
    rng = random.Random(7)
    for floor in (0.4, 0.6):
        for only in (0.02, 0.05, 0.15, 0.35, 0.6):
            for known in (0.5, 0.65, 0.8):
                E = sum(FRAME[s] * floor * only for s in EXTRA)
                A = sum(FRAME[s] * floor * (1 - only) * 0.5 for s in EXTRA)
                true_u = E / (E + FRAME["FR"] * floor + A)
                res, us, widths, skipped = collections.Counter(), [], [], 0
                for _ in range(sims):
                    items = []
                    for s, p in clusters:
                        fl = rng.random() < floor
                        cf = "unknown" if rng.random() > known else "only" if rng.random() < only else rng.choice(["also-fixed", "also-noted"])
                        items.append({"stratum": s, "pr": p, "floor": fl, "cf": cf})
                    u = estimate(items)
                    lo, hi, sk = interval(items, reps=reps, seed=rng.randrange(10**9))
                    skipped += sk
                    tk = trail_known(items)
                    res["trail-thin" if tk is not None and tk < 0.5 else reading(u, lo, hi)] += 1
                    if u is not None and lo is not None:
                        us.append(u)
                        widths.append(hi - lo)
                print(f"{floor}\t{only}\t{known}\t{true_u:.3f}\t{sum(us) / len(us):.3f}\t{sum(widths) / len(widths):.3f}\t"
                      f"{res['keep'] / sims:.2f}\t{res['backs-486'] / sims:.2f}\t{res['inconclusive'] / sims:.2f}\t{res['trail-thin'] / sims:.2f}\t"
                      f"{res['no-reading'] / sims:.2f}\t{skipped}")


if __name__ == "__main__":
    main(sys.argv[1])
