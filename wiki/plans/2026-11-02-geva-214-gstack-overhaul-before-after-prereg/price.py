#!/usr/bin/env python3
# price.py: planning spend and ledger caps for the GST-1089 before/after preregistration (GEVA-214).
# Keyless. Per-session planning costs come from metered runs on main (sources below); Amendment B
# re-costs every item from its exposure smokes before any counted launch.
#
# Metered sources (dollars per session):
#   TB2 Lane B, Opus 5.5: none 0.138, full gstack told 0.255 (ceremony-cut results L241-L243);
#     untold none 0.143, gstack 0.156 (Run D results L117-L131).
#   TB2 Lane B, GPT-6.1 Sol via OpenRouter: untold none 0.144, gstack 0.178 (Run D results).
#   TB2 Lane B, particle-1: none 0.062, full 0.080 (ceremony-cut L244-L246), at Lane B's proxy.json
#     rate of $0.25 input, an upper bound (Run D results L180-L183).
#   Review units, Opus 5.5: none 0.83, gstack-full told 3.36 mean and 3.80 to 9.19 when the full
#     procedure returned (R2 results L207-L208; #154 section 8).
#   Hard bug fixes (SWE-bench Verified, harness-evals): none 0.22, gstack 0.46 (follow report L10).
# GUESSES (no metered source): every after-* and off-* rate; before-u on review units; the hinv rates
#   (TB2 rates times about 1.7, harness-evals' hard-task ratio); Sol on review units (1.0 x Opus);
#   particle-1 on review units (0.30 x Opus). Sol on Lane B is 1.0 x Opus (Run D: 0.144 against 0.143).
# Prices: src/runner/pricing/prices.ts (Opus 4/20/0.20/5; Sol 2/10/0.10/2.50; particle-1 0.10/1/0.003).
import math

MULT = {"opus": 1.0, "sol": 1.0, "p1": {"laneb": 0.45, "review": 0.30}}

def m(model, kind):
    v = MULT[model]
    return v[kind] if isinstance(v, dict) else v

COST = {
    "tb2":  {"none": 0.14, "before-u": 0.16, "after-u": 0.25, "before-t": 0.26, "after-t": 0.35},
    "hinv": {"none": 0.25, "before-u": 0.30, "after-u": 0.45, "before-t": 0.45, "after-t": 0.60,
             "off-u": 0.35, "off-t": 0.50},
    "rev":  {"none": 0.83, "before-t": 3.40, "after-t": 8.00},
    "hrev": {"none": 0.83, "before-u": 1.00, "after-u": 5.00, "before-t": 3.40, "after-t": 8.00,
             "off-u": 1.20, "off-t": 6.00},
}
KIND = {"tb2": "laneb", "hinv": "laneb", "rev": "review", "hrev": "review"}
SESSIONS = {"tb2": 37 * 3, "hinv": 80 * 3, "rev": 33 * 2, "hrev": 36 * 2}
ALLOW = {"laneb": {"opus": 2.5, "sol": 2.5, "p1": 0.8}, "hinv": {"opus": 5, "sol": 5, "p1": 1.5},
         "review": {"opus": 40, "sol": 40, "p1": 10}}
PARALLEL = {"laneb": 16, "review": 4}
ATTRIB = {"hinv": ["off-u", "off-t"], "hrev": ["off-u", "off-t"]}
REPAIR_SHARE = 0.05

def ceil10(x):
    return math.ceil(x / 10) * 10

def item(inst, model, with_attrib=True):
    arms = [a for a in COST[inst] if not a.startswith("off")]
    if with_attrib and model == "opus" and inst in ATTRIB:
        arms += ATTRIB[inst]
    exp = sum(COST[inst][a] for a in arms) * SESSIONS[inst] * m(model, KIND[inst])
    allow = ALLOW["hinv" if inst == "hinv" else KIND[inst]][model]
    return arms, exp, allow

def rows(inst, model):
    arms, e, a = item(inst, model)
    head = PARALLEL[KIND[inst]] * a
    if KIND[inst] == "review":
        return [(f"{inst}-{model}-p{k}", arms, SESSIONS[inst] // 2, a, e / 2, ceil10(1.5 * e / 2 + head)) for k in (1, 2)]
    return [(f"{inst}-{model}", arms, SESSIONS[inst], a, e, ceil10(1.5 * e + head))]

def fixed(name, e, head):
    return (name, None, None, None, e, ceil10(1.5 * e + head))

PILOT_E = 36 * (0.25 + 0.25 + 0.25 * 0.45) + 16 * (0.83 + 0.83 + 0.83 * 0.30)
BPILOT_E = 10 * 0.26 + 6 * 3.40
SMOKE_LB = 3 * (0.26 + 0.35 + 0.25) * (1 + 1 + 0.45)
SMOKE_RV = 3 * (3.40 + 8.00) * (1 + 1 + 0.30)
THREADS = {
    "T-pub": [r for i in ("tb2", "rev") for mo in ("opus", "sol", "p1") for r in rows(i, mo)]
             + [fixed("pub-smoke-laneb (3 sessions x 3 gstack arms x 3 models)", SMOKE_LB, 16 * 2.5),
                fixed("pub-smoke-rev (3 sessions x 2 gstack arms x 3 models)", SMOKE_RV, 4 * 40),
                ("pub-judge", None, None, None, 60, 150), ("pub-vm", None, None, None, 25, 60)],
    "T-hinv": [fixed("h-pilot (none, 3 models, 12 tasks x 3 and 8 units x 2)", PILOT_E, 16 * 2.5 + 4 * 40),
               fixed("b-pilot (before-t, Opus, 10 TB2 tasks x 1 and 6 stacks-r1 units x 1)", BPILOT_E, 4 * 40),
               ("h-pilot-judge", None, None, None, 5, 30)]
              + [r for mo in ("opus", "sol", "p1") for r in rows("hinv", mo)]
              + [("hinv-vm", None, None, None, 40, 100)],
    "T-hrev": [r for mo in ("opus", "sol", "p1") for r in rows("hrev", mo)] + [("hrev-judge", None, None, None, 120, 300)],
}
out = ["price.py: planning spend and caps in dollars. cap = ceil10(1.5 x expected + parallel x allowance); review items are one per pass.", ""]
ge = gc = 0.0
for t, items in THREADS.items():
    out.append(t)
    te = tc = 0.0
    for name, arms, n, a, e, c in items:
        desc = f"arms {','.join(arms):<52} sessions {n:>4}/arm  allowance {a:>5}" if arms else ""
        out.append(f"  {name:<34} {desc:<86} expected {e:8.2f}  cap {c:6d}")
        te += e; tc += c
    rep = REPAIR_SHARE * te
    rc = ceil10(1.5 * rep)
    out.append(f"  {t.lower()}-repair (named relaunches, 5% of the thread){'':<76} expected {rep:8.2f}  cap {rc:6d}")
    te += rep; tc += rc
    out.append(f"  {t} total: expected {te:8.2f}, item caps {tc:8.0f}; the pause line is $4,900 of settled + reserved + host model use + VMs")
    out.append("")
    ge += te; gc += tc
out.append(f"All threads: expected {ge:.2f}, item caps {gc:.0f}.")
_, a1, _ = item("hinv", "opus"); _, a0, _ = item("hinv", "opus", False)
_, b1, _ = item("hrev", "opus"); _, b0, _ = item("hrev", "opus", False)
out.append(f"Opus attribution arms (off-u, off-t) account for {a1 - a0 + b1 - b0:.2f} of the expected total.")
print("\n".join(out))
