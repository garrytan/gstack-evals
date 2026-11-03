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
JUDGE_HEAD = 5
REPAIR_PARALLEL = 2
MODELS = ("opus", "sol", "p1")

def ceil10(x):
    return math.ceil(x / 10) * 10

def item(inst, model, with_attrib=True):
    arms = [a for a in COST[inst] if not a.startswith("off")]
    if with_attrib and model == "opus" and inst in ATTRIB:
        arms += ATTRIB[inst]
    exp = sum(COST[inst][a] for a in arms) * SESSIONS[inst] * m(model, KIND[inst])
    allow = ALLOW["hinv" if inst == "hinv" else KIND[inst]][model]
    return arms, exp, allow

def launch(name, kind, model, arms, n, rate_e, allow):
    return {"name": name, "arms": arms, "n": n, "allow": allow, "e": rate_e,
            "c": ceil10(1.5 * rate_e + PARALLEL[kind] * allow), "kind": kind, "model": model, "repair": True}

def rows(inst, model):
    arms, e, a = item(inst, model)
    kind = KIND[inst]
    if kind == "review":
        return [launch(f"{inst}-{model}-p{k}", kind, model, arms, SESSIONS[inst] // 2, e / 2, a) for k in (1, 2)]
    return [launch(f"{inst}-{model}", kind, model, arms, SESSIONS[inst], e, a)]

def smoke(kind, model):
    inst = "hinv" if kind == "laneb" else "hrev"
    arms = [a for a in COST[inst] if a != "none" and (model == "opus" or not a.startswith("off"))]
    e = 3 * sum(COST[inst][a] for a in arms) * m(model, kind)
    allow = ALLOW["hinv" if kind == "laneb" else "review"][model]
    return launch(f"smoke-{kind}-{model}", kind, model, arms, 3, e, allow)

def pilot(name, kind, model, arm, n, rate, allow):
    return launch(name, kind, model, [arm], n, n * rate * m(model, kind), allow)

def judges(prefix, total, passes=(1, 2)):
    out = []
    names = [f"{prefix}-{mo}-p{k}-{step}" for mo in MODELS for k in passes for step in ("match", "adjudicate")]
    for nm in names:
        e = total / len(names)
        out.append({"name": nm, "arms": None, "e": e, "c": ceil10(1.5 * e + JUDGE_HEAD), "repair": False})
    return out

def fixed(name, e, c):
    return {"name": name, "arms": None, "e": e, "c": c, "repair": False}

THREADS = {
    "T-pub": [smoke(k, mo) for k in ("laneb", "review") for mo in MODELS]
             + [r for mo in MODELS for r in rows("tb2", mo)]
             + [r for mo in MODELS for r in rows("rev", mo)]
             + judges("judge-pub", 60) + [fixed("pub-vm", 25, 60)],
    "T-hinv": [pilot("b-pilot-tb2 (before-t, 10 TB2 tasks x 1)", "laneb", "opus", "before-t", 10, COST["tb2"]["before-t"], ALLOW["laneb"]["opus"]),
               pilot("b-pilot-rev (before-t, 6 stacks-r1 units x 1)", "review", "opus", "before-t", 6, COST["rev"]["before-t"], ALLOW["review"]["opus"])]
              + [pilot(f"h-pilot-inv-{mo} (none, 12 tasks x 3)", "laneb", mo, "none", 36, COST["hinv"]["none"], ALLOW["hinv"][mo]) for mo in MODELS]
              + [pilot(f"h-pilot-rev-{mo}-p{k} (none, 8 units)", "review", mo, "none", 8, COST["hrev"]["none"], ALLOW["review"][mo]) for mo in MODELS for k in (1, 2)]
              + judges("judge-hpilot", 5)
              + [r for mo in MODELS for r in rows("hinv", mo)]
              + [fixed("hinv-vm", 40, 100)],
    "T-hrev": [r for mo in MODELS for r in rows("hrev", mo)] + judges("judge-hrev", 120),
}
out = ["price.py: planning spend and caps in dollars. One ledger item per launch (E_ITEM_BOUND: an item funds one run).",
       "Launch cap = ceil10(1.5 x expected + parallel x allowance); judge batch cap = ceil10(1.5 x expected + 5);",
       "each launch has its own repair item for named relaunches: expected 5% of the launch, cap ceil10(1.5 x expected + 2 x allowance).", ""]
ge = gc = 0.0
for t, items in THREADS.items():
    out.append(t)
    te = tc = 0.0
    for it in items:
        desc = f"arms {','.join(it['arms']):<52} sessions {it['n']:>4}/arm  allowance {it['allow']:>5}" if it["arms"] else ""
        out.append(f"  {it['name']:<44} {desc:<86} expected {it['e']:8.2f}  cap {it['c']:6d}")
        te += it["e"]; tc += it["c"]
    rep_items = [(it["name"].split(" ")[0] + "-repair", REPAIR_SHARE * it["e"], ceil10(1.5 * REPAIR_SHARE * it["e"] + REPAIR_PARALLEL * it["allow"])) for it in items if it["repair"]]
    re_ = sum(e for _, e, _ in rep_items); rc = sum(c for _, _, c in rep_items)
    out.append(f"  repair items: {len(rep_items)} (one per launch above), expected {re_:8.2f}, caps {rc:6d}")
    te += re_; tc += rc
    out.append(f"  {t} total: expected {te:8.2f}, item caps {tc:8.0f}; the pause line is $4,900 of settled + reserved + host model use + VMs")
    out.append("")
    ge += te; gc += tc
out.append(f"All threads: expected {ge:.2f}, item caps {gc:.0f}.")
_, a1, _ = item("hinv", "opus"); _, a0, _ = item("hinv", "opus", False)
_, b1, _ = item("hrev", "opus"); _, b0, _ = item("hrev", "opus", False)
out.append(f"Opus attribution arms (off-u, off-t) account for {a1 - a0 + b1 - b0:.2f} of the expected counted-run total.")
print("\n".join(out))
