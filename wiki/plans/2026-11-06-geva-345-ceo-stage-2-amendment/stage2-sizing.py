#!/usr/bin/env python3
# stage2-sizing.py: sizing for the CEO outcome eval's stage 2 at the measured ICC, and the all-in check at measured costs.
# Part 1 is the money: the all-in sum for each design shape, and the largest number of changed units that keeps it at
# or under $2,000. Part 2 is the power: the MDD of the paired sign-flip test under two effect models, at each design's
# size. Inputs are the stage 1 results, the custody addendum's authoring rates and the CEO crew threads' meters, as
# the amendment's section 7 lists them. No key, no network, no model call.
# Run: uv run --with numpy==2.3.4 python stage2-sizing.py > stage2-sizing.txt   (seeded)
import math
import numpy as np

# ---------------------------------------------------------------- inputs (dollars; sources in the amendment, section 7)
CAP = 2000.00
CREW_SPENT = 469.61          # 18 CEO crew threads to this post's start, 469,608 credits at $1 per 1,000
STAGE1_PAID = 17.60          # stage 1 settled spend, 12 ledger items, every lease closed
STAGE1_HOST = 0.93           # the stage 1 runner host, 3.11 hours at $0.30
PER_M = 0.40                 # dollars per million crew tokens, the top of the CEO threads' measured range
CREW_REST_M = {              # the rest of the crew line, in millions of tokens (estimates)
    "this amendment to READY (its stop)": 70,
    "build PR and its gate-class /ship": 250,
    "smoke pin post and its /ship": 60,
    "smoke rerun thread": 40,
    "authoring thread overhead (restore, sealing, suite)": 25,
    "stage 2 pin post and its /ship": 80,
    "stage 2 run thread": 80,
    "results post and its /ship": 100,
}
VM = 12.00                   # runner hosts for the smoke rerun and stage 2, about 40 hours at $0.30
RESERVE = 30.00              # crew reserve for the lines still to come after authoring (amendment section 7.2)
AUTHOR = 1.76                # authoring per passing unit (1,760 credits)
MINE = 97 / 62               # mining per passing unit, the top of the addendum's range ($34 to $97 over 62 units)
HELD_PER_CHANGED = 1 / 3     # the yield rule: one held unit for every three changed
JUDGE_S1 = 0.455524 + 1.590300 + 0.742050   # stage 1's three judge items, settled
S1_UNITS, S1_REVIEWS = 20, 9  # stage 1 packets: 20 units, 7 reviews and 2 stock rows per changed packet
MODELS = ["opus", "sol", "particle"]
ALLOW = {"opus": 7.04, "sol": 10.00, "particle": 0.50}   # stage 2 and smoke allowances (amendment section 5)
# per-session spend for planning: none and lens measured or set by rule; standalone from the stage 1 smoke; the
# enforced arm and Sol standalone are planning figures that the smoke rerun replaces
SESSION = {
    "opus": {"none": 0.0943, "standalone": 0.77, "enforced": 1.00, "lens": 0.113},
    "sol": {"none": 0.0703, "standalone": 1.20, "enforced": 1.50},
    "particle": {"none": 0.0075, "standalone": 0.07, "enforced": 0.10},
}
ITEMS = [("ceo-o-cmp-opus-p", "opus", ["none", "standalone", "lens"]), ("ceo-o-cmp-opus-e", "opus", ["enforced"]),
         ("ceo-o-cmp-sol-p", "sol", ["none", "standalone"]), ("ceo-o-cmp-sol-e", "sol", ["enforced"]),
         ("ceo-o-cmp-particle-p", "particle", ["none", "standalone"]), ("ceo-o-cmp-particle-e", "particle", ["enforced"])]
SMOKE = [("ceo-o-sm2-opus-e", "opus"), ("ceo-o-sm2-opus-p", "opus"), ("ceo-o-sm2-sol-e", "sol"),
         ("ceo-o-sm2-sol-p", "sol"), ("ceo-o-sm2-particle-e", "particle"), ("ceo-o-sm2-particle-p", "particle")]
# The allowance trip rule (amendment section 5): one call's worst case at P_MAX prompt tokens, on top of twice a cell's
# largest session spend, must fit the allowance. Rows are prices.ts at 715c659; bytes per token are the most the stage 1
# smoke journals saw; every call asks for 32,000 output tokens; the proxy adds 64 request and 1,000 tool tokens.
P_MAX = 200_000
BPT = {"opus": 2.83, "sol": 5.67, "particle": 5.09}
ROW = {"opus": (4, 20, 5, None), "sol": (2, 10, 2.5, (272_000, 4, 15, 5)), "particle": (0.1, 1, 0, None)}
def worst(m, p):
    tok = BPT[m] * p + 64 + 1000
    i, o, w, lng = ROW[m]
    if lng and tok > lng[0]: i, o, w = lng[1], lng[2], lng[3]
    return (tok * max(i, w) + 32_000 * o) / 1e6
def trip(m, allowance, committed):
    lo, hi = 0.0, 2_000_000.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if committed + worst(m, mid) <= allowance else (lo, mid)
    return lo

def ceil_usd(x): return math.ceil(x - 1e-9)

def smoke_caps():
    return {item: ceil_usd(2 * ALLOW[m]) for item, m in SMOKE}

def fixed():
    crew = sum(CREW_REST_M.values()) * PER_M
    return CREW_SPENT + STAGE1_PAID + STAGE1_HOST + crew + VM + RESERVE + sum(smoke_caps().values())

def stage2(n, passes):
    """passes: per model; held units run 1 pass. Returns (authoring, per-item caps, judge floor)."""
    h = math.ceil(n * HELD_PER_CHANGED)
    authoring = (n + h) * (AUTHOR + MINE)
    caps = {}
    for item, m, arms in ITEMS:
        up = n * passes[m] + h
        proj = up * sum(SESSION[m][a] for a in arms)
        rnd = max(1, 3 // len(arms)) * len(arms) * ALLOW[m]
        caps[item] = ceil_usd(1.25 * proj + rnd)
    reviews = sum(passes[m] * (4 if m == "opus" else 3) for m in MODELS) + 2
    judge = max(70.0, 2 * JUDGE_S1 * (n + h) / S1_UNITS * reviews / S1_REVIEWS)
    return h, authoring, caps, judge

def allin(n, passes):
    h, a, caps, j = stage2(n, passes)
    return fixed() + a + sum(caps.values()) + j

def nmax(passes):
    n = 36
    while allin(n + 1, passes) <= CAP: n += 1
    return n if allin(n, passes) <= CAP else None

SHAPES = [("A: 1 pass on every model", {"opus": 1, "sol": 1, "particle": 1}),
          ("B: 2 passes on Opus, 1 on Sol and particle-1", {"opus": 2, "sol": 1, "particle": 1}),
          ("C: 2 passes on every model (the frozen shape)", {"opus": 2, "sol": 2, "particle": 2}),
          ("D: 2 passes on Opus and Sol, 1 on particle-1", {"opus": 2, "sol": 2, "particle": 1}),
          ("E: 3 passes on Opus, 1 on Sol and particle-1", {"opus": 3, "sol": 1, "particle": 1})]

print("stage2-sizing.py: CEO outcome eval, stage 2 sizing at the measured ICC, and the all-in check")
print()
print("Part 0. Allowances: the trip rule at P_MAX %d prompt tokens" % P_MAX)
for m in MODELS:
    s = 2 * max(SESSION[m].values())
    need = s + worst(m, P_MAX)
    print("  %-8s worst case at P_MAX %.3f; twice the largest planning session %.2f; needs at least %.3f; set %.2f; %s; trips at %dk prompt tokens with %.2f committed" % (m, worst(m, P_MAX), s, need, ALLOW[m], "passes" if ALLOW[m] >= need else "FAILS", trip(m, ALLOW[m], s) / 1000, s))
print("  stage 1's Sol flag --allowance 3.52 with 0.60 committed trips at %dk prompt tokens: the smoke's stops came after calls at 86,350 and 86,391" % (trip("sol", 3.52, 0.60) / 1000))
print()
print("Part 1. Money (dollars; caps under #214's section 10 rule: 1.25 times the projection plus one full round at allowance)")
print("  crew spent %.2f; stage 1 paid %.2f; stage 1 host %.2f" % (CREW_SPENT, STAGE1_PAID, STAGE1_HOST))
for k, v in CREW_REST_M.items(): print("  crew rest: %-52s %4dM tokens  %7.2f" % (k, v, v * PER_M))
print("  runner hosts, smoke rerun and stage 2: %.2f" % VM)
print("  crew reserve: %.2f" % RESERVE)
for k, v in smoke_caps().items(): print("  smoke rerun cap %-28s %6.2f" % (k, v))
print("  fixed part of the line: %.2f" % fixed())
print()
for label, passes in SHAPES:
    n = nmax(passes)
    h, a, caps, j = stage2(n, passes)
    print("  shape %s: largest n that fits $%.0f is %d changed and %d held units" % (label, CAP, n, h))
    print("    authoring and mining %.2f; stage 2 run caps %s; judges %.2f" % (a, ", ".join("%s %d" % (k.replace("ceo-o-cmp-", ""), v) for k, v in caps.items()), j))
    proj = sum((n * passes[m] + h) * sum(SESSION[m][a] for a in arms) for _, m, arms in ITEMS)
    print("    stage 2 caps with judges %.2f; all-in %.2f; stage 2 run projection (not caps) %.2f" % (sum(caps.values()) + j, allin(n, passes), proj))
    print("    stage 2 envelope, the judge caps' base ($2,000 less every line but the stage 2 run items and judges) %.2f" % (CAP - fixed() - a))
print()
n36 = stage2(36, SHAPES[1][1])
print("  yield floor, shape B at 36 changed and %d held units: all-in %.2f" % (n36[0], allin(36, SHAPES[1][1])))

# ---------------------------------------------------------------- power
SEED = 20261106
SIMS, FLIPS = 1200, 800
STEPS = np.round(np.arange(0.02, 0.46, 0.01), 2)
def logit(p): return np.log(p / (1 - p))
def expit(x): return 1 / (1 + np.exp(-x))
def ab(p0, rho): s = 1 / rho - 1; return p0 * s, (1 - p0) * s

def test(none, arm, n, alpha, rng):
    d = arm - none
    obs = np.abs(d.mean(axis=1))
    null = np.abs(d @ rng.choice([-1.0, 1.0], size=(FLIPS, n)).T / n)
    pv = (1 + (null >= obs[:, None] - 1e-12).sum(axis=1)) / (FLIPS + 1)
    return (pv <= alpha).mean()

def power_logit(p0, rho, n, passes, delta, alpha, rng, tau=0.5):
    # power.py's model: the arm moves each unit by one logit shift plus unit noise tau.
    a, b = ab(p0, rho)
    big = np.clip(rng.beta(a, b, 200000), 1e-4, 1 - 1e-4); nz = rng.normal(0, tau, big.size)
    lo, hi = -12.0, 12.0
    for _ in range(70):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if expit(logit(big) + mid + nz).mean() - big.mean() < delta else (lo, mid)
    s = (lo + hi) / 2
    if expit(logit(big) + s + nz).mean() - big.mean() < delta - 0.005: return None
    p = np.clip(rng.beta(a, b, (SIMS, n)), 1e-4, 1 - 1e-4)
    q = expit(logit(p) + s + rng.normal(0, tau, (SIMS, n)))
    return test(rng.binomial(passes, p) / passes, rng.binomial(passes, q) / passes, n, alpha, rng)

def power_rank(p0, rho, n, passes, delta, alpha, rng):
    # Rank-preserving model: the arm's unit rates keep the measured ICC with mean p0 + delta, and each unit keeps its
    # rank (the same quantile of each Beta), so the gain lands as whole units moving from rarely hit to mostly hit.
    if p0 + delta >= 0.99: return None
    a0, b0 = ab(p0, rho); a1, b1 = ab(p0 + delta, rho)
    q0 = np.sort(np.clip(rng.beta(a0, b0, 400000), 1e-4, 1 - 1e-4))
    q1 = np.sort(np.clip(rng.beta(a1, b1, 400000), 1e-4, 1 - 1e-4))
    idx = rng.integers(0, 400000, (SIMS, n))
    p, q = q0[idx], q1[idx]
    return test(rng.binomial(passes, p) / passes, rng.binomial(passes, q) / passes, n, alpha, rng)

def mdd(fn, p0, rho, n, passes, alpha, rng):
    for d in STEPS:
        pw = fn(p0, rho, n, passes, d, alpha, rng)
        if pw is None: return "none<=%.2f" % (d - 0.01)
        if pw >= 0.80: return "%.2f" % d
    return "none<=0.45"

rng = np.random.default_rng(SEED)
print()
print("Part 2. Power (seed %d, %d simulated runs a point, %d sign flips a run; MDD at 80%% power, two-sided)" % (SEED, SIMS, FLIPS))
print("  logit: power.py's model (one logit shift, unit noise tau 0.5); rank: the arm keeps the ICC and each unit's rank")
print("  alpha 0.025 is Holm's first step over a model's two gstack arms; alpha 0.05 its second")
print("  columns: control p0, ICC, changed units n, passes, MDD logit 0.05, logit 0.025, rank 0.05, rank 0.025")
print("  2a. Each shape at its largest n (ICC 0.843; Sol and particle-1 at their measured none rate 0.344, ICC assumed equal)")
for label, passes in SHAPES:
    n = nmax(passes)
    for who, p0, ps in (("Opus", 0.50, passes["opus"]), ("Sol", 0.344, passes["sol"]), ("particle-1", 0.344, passes["particle"])):
        r = [mdd(power_logit, p0, 0.843, n, ps, al, rng) for al in (0.05, 0.025)] + [mdd(power_rank, p0, 0.843, n, ps, al, rng) for al in (0.05, 0.025)]
        print("  shape %s  %-10s n %3d  passes %d  logit %s %s  rank %s %s" % (label[0], who, n, ps, *r), flush=True)
print("  2b. Shape B at the yield floor (36 changed units) and at ICC 0.5")
for who, p0, ps, n, rho in (("Opus", 0.50, 2, 36, 0.843), ("Sol", 0.344, 1, 36, 0.843), ("Opus", 0.50, 2, nmax(SHAPES[1][1]), 0.5), ("Sol", 0.344, 1, nmax(SHAPES[1][1]), 0.5)):
    r = [mdd(power_logit, p0, rho, n, ps, al, rng) for al in (0.05, 0.025)] + [mdd(power_rank, p0, rho, n, ps, al, rng) for al in (0.05, 0.025)]
    print("  %-10s ICC %.3f  n %3d  passes %d  logit %s %s  rank %s %s" % (who, rho, n, ps, *r), flush=True)
print("  2c. Reference grid, Opus control 0.50")
for rho in (0.843, 0.5):
    for passes in (1, 2):
        for n in (36, 48, 64, 80, 96):
            r = [mdd(power_logit, 0.50, rho, n, passes, al, rng) for al in (0.05, 0.025)] + [mdd(power_rank, 0.50, rho, n, passes, al, rng) for al in (0.05, 0.025)]
            print("  ICC %.3f  n %3d  passes %d  logit %s %s  rank %s %s" % (rho, n, passes, *r), flush=True)
print("  2d. Opus at alpha 0.05 and 0.025, logit model with a wider spread of unit-level effects (tau 1.5 and 2.5)")
for label, passes in SHAPES[:2]:
    n = nmax(passes)
    for tau in (1.5, 2.5):
        r = [mdd(lambda *a, **k: power_logit(*a, **k, tau=tau), 0.50, 0.843, n, passes["opus"], al, rng) for al in (0.05, 0.025)]
        print("  shape %s  Opus  tau %.1f  n %3d  passes %d  logit %s %s" % (label[0], tau, n, passes["opus"], *r), flush=True)
