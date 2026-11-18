#!/usr/bin/env python3
# resize.py: what a rerun of the office-hours rewrite eval would cost at the yields authoring measured, and the MDD
# each design buys. Every rerun here has pre-run change 6's two fixes: a top-up twin gets at most 3 draws a partner,
# after which the partner drops and its slot draws a new pair; and each slot's draw order is seeded, so concurrency
# and restarts no longer change which drafts are drawn.
# Counts are from authoring's final path, read count-only from the sealed outcome log and meter. Session, simulator,
# label, audit and judge costs are the preregistration's planning figures (its cost.py); stage 1 never ran.
# The MDD and decision shares come from the preregistration's own power model: this script runs power.py's functions
# unchanged, from the file itself.
# Run from this folder: uv run --with numpy==2.3.4 --with scipy==1.16.2 python resize.py > resize.txt
# (seeded; no key, no network)
import math, pathlib
import numpy as np
from scipy import stats

POWER = pathlib.Path(__file__).resolve().parent.parent.parent / "plans/2026-11-17-geva-552-office-hours-rewrite-prereg/power.py"
src = POWER.read_text()
exec(src[: src.index("rng = np.random.default_rng(SEED)")])

# Authoring's final path (lease 6): 315 drafts, $78.17.
FIRST_N, FIRST_K, FIRST_USD = 15, 10, 13.30
SECOND_N, SECOND_USD = 218, 20.19
UNPAIRED_N, UNPAIRED_USD = 82, 44.68
T7_K, T7_N = 2, 41
BUILDER_K, BUILDER_N = 5, 41
# Each partner whose first twin passed: (type, second-twin draws, matched on its last draw). Two T5 partners were still
# open when the cap stopped authoring.
PARTNERS = [("T3", 1, True), ("T5", 1, True), ("T6", 2, True), ("T6", 26, True), ("T4", 19, True), ("T2", 1, True),
            ("T4", 120, False), ("T1", 46, False), ("T5", 2, False), ("T5", 0, False)]
BOUND = 3
DRAFT_ALLOWANCE, PARALLEL_DRAFTS = 3.50, 8
AGENT_USE = 350

C1 = FIRST_USD / FIRST_N
C2 = SECOND_USD / SECOND_N
CU = UNPAIRED_USD / UNPAIRED_N
within = [p for p in PARTNERS if p[2] and p[1] <= BOUND]
failed = [p for p in PARTNERS if p[1] >= BOUND and not (p[2] and p[1] <= BOUND)]
M_K, M_N = len(within), len(within) + len(failed)
DRAWS_IF_MATCHED = sum(p[1] for p in within) / len(within)
HARD_K = sum(1 for p in failed if p[2])
HARD_N = sum(p[1] for p in failed)
Z = stats.norm.ppf(0.975)

def wilson(k, n):
    p = k / n
    d = 1 + Z * Z / n
    c = p + Z * Z / (2 * n)
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))
    return max(0.0, (c - h) / d), min(1.0, (c + h) / d)

def pair_cost(f, m, c1=C1, c2=C2):
    return (c1 / f + m * DRAWS_IF_MATCHED * c2 + (1 - m) * BOUND * c2) / m

def unpaired_cost(y):
    return CU / y

print("resize.py; counts from authoring's final path; planning costs from the preregistration's cost.py")
print("Part A. Measured yields, each with its 95% Wilson interval, and cost a draft")
fl, fh = wilson(FIRST_K, FIRST_N)
print("first twin passes every screen   %2d of %3d  %.3f  (%.3f to %.3f)  $%.3f a draft" % (FIRST_K, FIRST_N, FIRST_K / FIRST_N, fl, fh, C1))
sl, sh = wilson(6, SECOND_N)
print("second twin passes, per draw      %2d of %3d  %.3f  (%.3f to %.3f)  $%.3f a draw" % (6, SECOND_N, 6 / SECOND_N, sl, sh, C2))
ml, mh = wilson(M_K, M_N)
print("partner matches within %d draws    %2d of %3d  %.3f  (%.3f to %.3f)  matched partners took %.2f draws on average; %d partners still open are left out" % (BOUND, M_K, M_N, M_K / M_N, ml, mh, DRAWS_IF_MATCHED, len(PARTNERS) - M_N))
hl, hh = wilson(HARD_K, HARD_N)
print("partners past %d draws, per draw   %2d of %3d  %.4f  (%.4f to %.4f)" % (BOUND, HARD_K, HARD_N, HARD_K / HARD_N, hl, hh))
tl, th = wilson(T7_K, T7_N)
print("T7 unpaired founder passes        %2d of %3d  %.3f  (%.3f to %.3f)  $%.3f a draft (all unpaired drafts)" % (T7_K, T7_N, T7_K / T7_N, tl, th, CU))
bl, bh = wilson(BUILDER_K, BUILDER_N)
print("builder passes                    %2d of %3d  %.3f  (%.3f to %.3f)" % (BUILDER_K, BUILDER_N, BUILDER_K / BUILDER_N, bl, bh))
print("T8 returning founder              never drafted; planned here at T7's count, 2 of 41")

print("Part B. Authoring cost to place one brief, at the measured rate and at each interval's ends (low yield, high yield)")
print("pair (both twins)    $%6.2f   ($%6.2f to $%6.2f)" % (pair_cost(FIRST_K / FIRST_N, M_K / M_N), pair_cost(fl, ml), pair_cost(fh, mh)))
print("T7 or T8 founder     $%6.2f   ($%6.2f to $%6.2f)" % (unpaired_cost(T7_K / T7_N), unpaired_cost(tl), unpaired_cost(th)))
print("builder              $%6.2f   ($%6.2f to $%6.2f)" % (unpaired_cost(BUILDER_K / BUILDER_N), unpaired_cost(bl), unpaired_cost(bh)))
m_hard = 1 - (1 - HARD_K / HARD_N) ** BOUND
print("pair of a type whose partners all match at the past-%d rate: %.4f within %d draws, $%.2f a pair; with no bound, $%.2f a pair" % (BOUND, m_hard, BOUND, pair_cost(FIRST_K / FIRST_N, m_hard), C1 / (FIRST_K / FIRST_N) + C2 * HARD_N / HARD_K))

def sessions(briefs):
    return briefs * (2 * 3.50 + 0.50 + 2 * 2.00 + 0.30) + briefs * 6 * (0.08 + 0.06)

def particle(briefs):
    return briefs * (2 * 0.30 + 0.05) + briefs * 3 * (0.08 + 0.06)

def authoring(pairs, unpaired_founders, builders, f, m, yf, yb):
    return pairs * pair_cost(f, m) + unpaired_founders * unpaired_cost(yf) + builders * unpaired_cost(yb)

def draws_jeffreys(rng, n):
    return (rng.beta(FIRST_K + 0.5, FIRST_N - FIRST_K + 0.5, n), rng.beta(M_K + 0.5, M_N - M_K + 0.5, n),
            rng.beta(T7_K + 0.5, T7_N - T7_K + 0.5, n), rng.beta(BUILDER_K + 0.5, BUILDER_N - BUILDER_K + 0.5, n))

def ceil(x): return int(math.ceil(x - 1e-9))

def design(name, cmp, cal, res, reuse, rng):
    # cmp, cal, res, reuse: (pairs, unpaired founders, builders)
    need = [cmp[i] + cal[i] + res[i] - reuse[i] for i in range(3)]
    briefs = 2 * (cmp[0] + cal[0] + res[0]) + cmp[1] + cal[1] + res[1] + cmp[2] + cal[2] + res[2]
    s2 = 2 * cmp[0] + cmp[1] + cmp[2]
    s1 = 2 * cal[0] + cal[1] + cal[2]
    a = authoring(*need, FIRST_K / FIRST_N, M_K / M_N, T7_K / T7_N, BUILDER_K / BUILDER_N)
    sims = authoring(*need, *draws_jeffreys(rng, 200000))
    a_lo, a_hi = np.percentile(sims, [2.5, 97.5])
    audit = briefs * 6 * 0.0064 + 80 * 0.314
    st1 = sessions(s1) + particle(s1)
    st2, p2 = sessions(s2), particle(s2)
    hosts = (s1 * 9 + s2 * 9) * 4 * 0.00416
    rows = [("authoring", a, ceil(1.35 * a + PARALLEL_DRAFTS * DRAFT_ALLOWANCE)),
            ("simulator audit", audit, ceil(1.35 * audit + 1)),
            ("stage 1 (approved cap, holds one repair)", st1, 220),
            ("judge check (approved cap)", 89.80, 123),
            ("stage 2, Opus and Sol", st2, ceil(1.35 * st2 + 33 + 6 + 1)),
            ("stage 2, particle-1", p2, ceil(1.35 * p2 + 7 + 6 + 1)),
            ("hosts", hosts, ceil(1.35 * hosts + 1))]
    c = sum(r[1] for r in rows)
    k = sum(r[2] for r in rows)
    a_cap_hi = ceil(1.35 * a_hi + PARALLEL_DRAFTS * DRAFT_ALLOWANCE)
    print("%s: %d briefs (%d pairs, %d unpaired founders, %d builders), %d in stage 2, %d in stage 1; still to author %d pairs, %d unpaired founders, %d builders" % (name, briefs, cmp[0] + cal[0] + res[0], cmp[1] + cal[1] + res[1], cmp[2] + cal[2] + res[2], s2, s1, *need))
    for r in rows:
        print("  %-42s central $%8.2f  cap $%5d" % r)
    print("  paid total                                 central $%8.2f  cap $%5d" % (c, k))
    print("  all-in with $%d of agent use                central $%8.2f  cap $%5d" % (AGENT_USE, c + AGENT_USE, k + AGENT_USE))
    print("  authoring at Jeffreys draws of every yield: 95%% range $%.0f to $%.0f, so all-in at caps $%d to $%d" % (a_lo, a_hi, k + AGENT_USE - rows[0][2] + ceil(1.35 * a_lo + PARALLEL_DRAFTS * DRAFT_ALLOWANCE), k + AGENT_USE - rows[0][2] + a_cap_hi))
    return need

rng = np.random.default_rng(SEED)
print("Part C. Designs. Caps follow the amended rule: 1.35 times central plus what the item's parallel calls hold at open (8 drafts at $3.50; one Opus round of 2 skill and 1 none session at $15, $15 and $3, with $2 of simulator each and $1 of labels; one particle-1 round at $3, $3 and $1 with the same simulator and labels). Stage 1 and the judge check keep their approved caps. Reuse counts the 19 briefs already placed: 6 pairs, 2 T7 founders and 5 builders.")
design("frozen design, 5 skins (for reference)", (30, 10, 24), (2, 2, 2), (2, 2, 2), (6, 2, 5), rng)
need = design("design 1, 4 skins, builders kept", (24, 8, 24), (2, 2, 2), (2, 2, 2), (6, 2, 5), rng)
hard_pairs = need[0] / 3
extra = hard_pairs * (pair_cost(FIRST_K / FIRST_N, m_hard) - pair_cost(FIRST_K / FIRST_N, M_K / M_N))
print("  if T1 and T4 partners all match at the past-%d rate (none of their 3 partners matched within %d draws), and a third of the %d pairs still to place are T1 or T4: authoring adds $%.0f central and $%d at caps" % (BOUND, BOUND, need[0], extra, ceil(1.35 * extra)))
design("design 1b, pairs-only founders and builders kept; narrows the claim to six types, not counted", (26, 0, 24), (3, 0, 2), (3, 0, 2), (6, 0, 5), rng)
for n in (12, 16, 24):
    design("option 2, founder pairs only, %d pairs" % n, (n, 0, 0), (4, 0, 0), (2, 0, 0), (0, 0, 0), rng)

print("Part D. MDD and decision shares, from power.py's model unchanged: one session a brief, arm and model, pooled over Opus and Sol, paired t over opening clusters")
def shares(ids, nclus, p0, rho, delta):
    lo, hi, m = t_interval(cluster_diffs(p0, rho, delta, ids, nclus, 1, 2, rng))
    return (lo > 0).mean(), ((m >= BAR - 1e-12) & (lo > 0)).mean()
layouts = [("filled set", *layout(1, 6, 2)), ("design 1, 4 skins", *layout(4, 6, 2)), ("design 1b, 26 pairs", *layout(1, 26, 0))] + [("option 2, %d pairs" % n, *layout(1, n, 0)) for n in (12, 16, 24)]
for name, ids, nclus in layouts:
    for rho in (0.5, 0.843):
        print("%-20s clusters %2d  rho %.3f  pooled MDD at p0 0.25 %s, 0.40 %s, 0.55 %s" % (name, nclus, rho, mdd(0.25, rho, ids, nclus, 1, 2, rng), mdd(0.40, rho, ids, nclus, 1, 2, rng), mdd(0.55, rho, ids, nclus, 1, 2, rng)), flush=True)
    for rho in (0.5, 0.843):
        row = []
        for d in (0.0, 0.10, 0.15, 0.20):
            ex, mg = shares(ids, nclus, 0.40, rho, d)
            row.append("d %.2f excludes zero %.3f MERGE %.3f" % (d, ex, mg))
        print("%-20s p0 0.40 rho %.3f | %s" % (name, rho, " | ".join(row)), flush=True)

