#!/usr/bin/env python3
"""Planning price for the decision-routing eval (GEVA-411). Planning rates only; the pilot re-costs every rate.

Cells: N (mini as shipped), R (Jev, then particle-1, then the frontier), P (particle-1, then the frontier), F (typed frontier),
J (Jev alone), W (the whole agent on particle-1). Kimi K3 is out by the owner's choice (2026-11-09). No gstack cell.
Session rates are dollars of model calls per SWE-rebench session. Anchors in hand (Claude Code on this pool): Opus 5.5 none
$0.370 a session (200 sessions), GPT-6.1 Sol none $0.425 (199), particle-1 none $0.170 (78). Decider calls: Jev $0.042 per
million input tokens, output free; particle-1 $0.05 in and $0.50 out per million (OpenRouter, 2026-11-08), about 25 decision
points a session at about 5,000 input and up to 1,500 reasoning and output tokens each. Calibration shadow answers are
offline: Jev once and particle-1 twice (with and without Jev's guess) on every logged state, plus one re-answer after a
question rewrite, about $0.06 a session. F's typed frontier calls are uncached
structured requests on every command and query, so F is priced at 2x N (review note F9).
VM hours (review note F18): R3 amendment 4 measured 0.0317 VM hours a session for none and 0.0537 for told sessions; this plan
uses 0.05 for every session, plus 0.005 VM hours per grounded-label verifier run (at most 2 done states a session in
calibration N and scored R, P, J and F sessions), plus 10 VM hours of image pulls and waits. $0.60 a VM hour.
Crew (review note F19): from counters of comparable threads (this planning thread about 40M tokens, about $13 at gate 1; a
gate-class build and /ship about 150M to 250M; a run thread about 100M to 150M; a results post and /ship about 100M), at about
$0.30 per million tokens: about $220 expected, capped at $350.
Item cap = ceil10(m x expected + 6 parallel sessions x $5 allowance), m 1.5 for calibration and pilot, 1.35 for scored items
(re-set after the pilot re-cost).
"""
import math

RATE = {
    ("N", "opus"): 0.40, ("N", "sol"): 0.45,
    ("F", "opus"): 0.80,
    ("R", "opus"): 0.32, ("R", "sol"): 0.35,
    ("P", "opus"): 0.30, ("P", "sol"): 0.33,
    ("J", "opus"): 0.35, ("J", "sol"): 0.38,
    ("W", "-"): 0.20,
}
SHADOW_PER_SESSION = 0.06
LABEL_RUNS_PER_SESSION = 2

def ceil10(x):
    return int(math.ceil(x / 10.0) * 10)

def plan(S=280, S2=100, CAL=40, PILOT=20, PILOT_SMALL=12, mult=1.35):
    items, label_runs = [], 0
    def add(name, cells, n, extra=0.0, m=None, labelled=()):
        nonlocal label_runs
        exp = sum(RATE[c] for c in cells) * n + extra
        items.append((name, len(cells) * n, exp, ceil10((m or mult) * exp + 30)))
        label_runs += sum(1 for c in cells if c[0] in labelled) * n * LABEL_RUNS_PER_SESSION
    add("calibration: N on both models, deciders in shadow", [("N","opus"),("N","sol")], CAL, extra=SHADOW_PER_SESSION * 2 * CAL, m=1.5, labelled=("N",))
    add("pilot: R and P on both models, 20 tasks", [("R","opus"),("R","sol"),("P","opus"),("P","sol")], PILOT, m=1.5)
    add("pilot: J on both models, F on Opus and W, 12 tasks", [("J","opus"),("J","sol"),("F","opus"),("W","-")], PILOT_SMALL, m=1.5)
    add("scored, Opus: N, R and P", [("N","opus"),("R","opus"),("P","opus")], S, labelled=("R", "P"))
    add("scored, Sol: N, R and P", [("N","sol"),("R","sol"),("P","sol")], S, labelled=("R", "P"))
    add("scored subset: F on Opus, J on both models", [("F","opus"),("J","opus"),("J","sol")], S2, labelled=("F", "J"))
    add("reference: the whole agent on particle-1", [("W","-")], S2)
    items.append(("decision-level replay: Jev 1.14.0, safety set, guess ablation", 0, 15.0, 40))
    sessions = sum(i[1] for i in items)
    vm_h = sessions * 0.05 + label_runs * 0.005 + 10
    vm_exp = vm_h * 0.60
    return items, sessions, label_runs, vm_h, vm_exp, ceil10(1.35 * vm_exp + 20)

def show(label, crew=(220, 350), **kw):
    items, sessions, label_runs, vm_h, vm_exp, vm_cap = plan(**kw)
    print(f"== {label}: {kw}")
    for name, s, e, c in items:
        print(f"  {name:<60} sessions {s:>5}  expected ${e:>8.2f}  cap ${c:>5}")
    me = sum(i[2] for i in items); mc = sum(i[3] for i in items)
    print(f"  {'model calls':<60} sessions {sessions:>5}  expected ${me:>8.2f}  cap ${mc:>5}")
    print(f"  {'runner VMs (' + f'{vm_h:.0f} h, {label_runs} label runs' + ')':<60} {'':>14}  expected ${vm_exp:>8.2f}  cap ${vm_cap:>5}")
    print(f"  {'crew (threads, read from counters)':<60} {'':>14}  expected ${crew[0]:>8.2f}  cap ${crew[1]:>5}")
    print(f"  {'ALL-IN':<60} {'':>14}  expected ${me+vm_exp+crew[0]:>8.2f}  cap ${mc+vm_cap+crew[1]:>5}")
    print()

if __name__ == "__main__":
    show("A as approved", S=280, S2=100)
