#!/usr/bin/env python3
# price.py: planning spend, item caps and the all-in ceiling for the L1 superseding preregistration (GEVA-254, GST-1155).
# Keyless. Every figure is in dollars. All-in = paid model calls + VMs + crew model use (Capy credits / 1000).
import json, math, sys

CEILING = 2000.00
def ceil10(x): return int(math.ceil(x / 10.0) * 10)
def usd(x): return "$%.2f" % x

# Per-session planning rates (Opus 5.5, Lane B, measured):
#  SWE-rebench none  0.37  R3 amendment 4 screen, 200 none trials (record/trials.jsonl: mean 0.3702, p95 1.07, max 2.43)
#  SWE-rebench told  0.74  R3 amendment 4 pilot, 10 told /investigate trials with the procedure line (mean 0.7363, max 1.29)
#  Every gstack arm, told or untold, is planned at the told rate: an upper bound for the untold arms.
#  TB2               0.232 the merged L1 price.txt tb2-opus row (128.76 over 555 sessions)
# VM hours per session (R3 amendment 4): 0.0317 over its 210 sessions (6.65 h); its 10 told pilot sessions took 0.0537 each
# (0.537 h). Every gstack arm is planned at twice the 0.0317 figure, 0.0633.
RATE = {"swe-none": 0.37, "swe-gstack": 0.74, "tb2": 0.232}
ALLOW = {"swe": 5.00, "tb2": 2.50}
PARALLEL = 6
VM_H = {"none": 6.65 / 210, "gstack": 2 * 6.65 / 210}
VM_USD_PER_HOUR = 0.60
RETRY = 1.05
VM_BLOCK = 4 * VM_USD_PER_HOUR
# Other models, as multiples of the Opus rates: GPT-6.1 Sol on Lane B 3c (SWE-bench Verified) none 0.254 against
# Opus 0.191 and told 0.691 against 0.424; particle-1 from R3 amendment 4's projection (473 against 232 for 70 tasks).
MULT = {"opus": {"none": 1.0, "gstack": 1.0}, "sol": {"none": 0.254 / 0.191, "gstack": 0.691 / 0.424},
        "particle-1": {"none": 473 / 232, "gstack": 473 / 232}}
GSTACK_ARMS_ALL = ["before-u", "after-u", "before-t", "after-t", "off-u", "off-t"]
FIVE = ["none", "before-u", "after-u", "before-t", "after-t"]

# Re-cost (section 9): python3 price.py --measured <file>, where the file holds {"model": "opus", "sol" or "particle-1",
# "rates": {arm: mean dollars per session in that model's pilot}}. Each arm's SWE-rebench rate becomes the higher of its
# planning rate and its measured rate, and its TB2 rate scales by the same ratio; an arm with no measured rate keeps its
# planning rate.
ARMS = ["none"] + GSTACK_ARMS_ALL
RAISE = {}
def usage(msg):
    sys.stderr.write("E_USAGE price.py: " + msg + "\n")
    sys.exit(2)

def raise_rates(measured, model_id):
    for arm, v in measured.items():
        if arm not in ARMS or not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
            usage("--measured rates must map arm names in %s to positive numbers" % ARMS)
        kind = "none" if arm == "none" else "gstack"
        RAISE.setdefault(model_id, {})[arm] = max(1.0, v / (RATE["swe-" + kind] * MULT[model_id][kind]))

def item(name, per_arm, arms, inst, parts=1, model_id="opus"):
    n = 0; model = 0.0; vm_h = 0.0
    for arm in arms:
        k = per_arm[arm] if isinstance(per_arm, dict) else per_arm
        kind = "none" if arm == "none" else "gstack"
        rate = (RATE["tb2"] if inst == "tb2" else RATE["swe-" + kind]) * RAISE.get(model_id, {}).get(arm, 1.0)
        n += k; model += k * rate * MULT[model_id][kind]; vm_h += k * VM_H[kind]
    allow = ALLOW["tb2" if inst == "tb2" else "swe"]
    vm = vm_h * VM_USD_PER_HOUR
    exp = RETRY * model + vm
    return {"name": name, "sessions": n, "parts": parts, "vm_h": vm_h, "model": RETRY * model, "vm": vm, "expected": exp,
            "cap": ceil10(1.5 * exp + PARALLEL * allow + parts * VM_BLOCK)}

PILOT = {"before-u": 10, "before-t": 10, "after-u": 3, "after-t": 3, "off-u": 3, "off-t": 3}
pilot = item("pilot-opus", PILOT, list(PILOT), "swe")
measured = None
if len(sys.argv) > 1:
    if len(sys.argv) != 3 or sys.argv[1] != "--measured":
        usage("run with no arguments, or with --measured <file>")
    measured = json.load(open(sys.argv[2]))
    if not isinstance(measured, dict) or measured.get("model") not in MULT or not isinstance(measured.get("rates"), dict):
        usage("the --measured file needs model (opus, sol or particle-1) and rates")
    raise_rates(measured["rates"], measured["model"])
f1 = item("f1-opus", 80, ["none"] + GSTACK_ARMS_ALL, "swe", parts=4)
tb2 = item("tb2-opus", 74, FIVE, "tb2", parts=2)
opus = [pilot, f1, tb2]

CREW_RATE = 0.45
crew = [("GEVA-254: this preregistration through READY", 120), ("a successor for this PR's /ship, if needed", 50),
        ("U1: Lane B arms at both pins (lite, off config, seeded user), build and /ship", 90),
        ("U2: probes I and L, the analysis entry and the ceiling check, build and gate-class /ship", 160),
        ("amendment C: build pins, keyless dry run, routing table", 60),
        ("run thread: pilot, re-cost, F1, gate reading, TB2 twin, analysis", 60),
        ("blind probe audit reader", 10), ("results post, claim check and light /ship", 90)]
crew_tokens = sum(t for _, t in crew)
CREW_CAP = 400.0
# Lines with their own caps: the Captain's L1 turns, and the run work for each leftover model (route check, pilot,
# F1, analysis), counted at caps whether or not that model runs.
lines = [("Captain GEVA-2: L1 turns, booked per turn", 80, 40.0), ("Sol run work, if Sol runs", 30, 15.0),
         ("particle-1 run work, if particle-1 runs", 30, 15.0)]

L = []
p = L.append
p("price.py: L1 superseding preregistration at 2,000 dollars all-in. One ledger item per launch. Expected = 1.05 x model spend")
p("(Harbor's in-launch retries of sessions that got no model response) + VM hours. Cap = ceil10(1.5 x expected + 6 parallel")
p("sessions x allowance + one 4-hour VM block at 0.60 per hour for each part). VM spend is reserved and settled on each launch's")
p("own item (VM_USD_PER_HOUR=0.60). Rates per Opus session: SWE-rebench none 0.37 and told 0.74 (R3 amendment 4, measured);")
p("every gstack arm at the told rate; TB2 0.232 (merged L1 price.txt). Allowance 5.00 (SWE-rebench), 2.50 (TB2). VM hours")
p("0.0317 per none session and 0.0633 per gstack session (R3 amendment 4: 0.0317 over 210 sessions, told 0.0537).")
p("")
p("Planned path (Opus 5.5):")
p("%-12s%9s%6s%8s%10s%8s%11s%8s" % ("item", "sessions", "parts", "vm h", "model", "vm", "expected", "cap"))
for x in opus:
    p("%-12s%9d%6d%8.1f%10.2f%8.2f%11.2f%8d" % (x["name"], x["sessions"], x["parts"], x["vm_h"], x["model"], x["vm"], x["expected"], x["cap"]))
p("")
p("Crew model use (planned token stops, millions of tokens):")
for name, t in crew: p("  %4dM  %s" % (t, name))
p("  %4dM  crew line, expected %s at %.2f per million; cap %s" % (crew_tokens, usd(crew_tokens * CREW_RATE), CREW_RATE, usd(CREW_CAP)))
for name, t, cap in lines: p("  %4dM  %s: expected %s, cap %s" % (t, name, usd(t * CREW_RATE), usd(cap)))
p("  The tally reads each thread's credits / 1000, not tokens.")
p("")
paid_exp = sum(x["expected"] for x in opus)
paid_cap = sum(x["cap"] for x in opus)
crew_exp = crew_tokens * CREW_RATE + sum(t * CREW_RATE for _, t, _ in lines)
crew_cap = CREW_CAP + sum(cap for _, _, cap in lines)
at_caps = paid_cap + crew_cap
p("All-in expected: paid %s + crew %s = %s" % (usd(paid_exp), usd(crew_exp), usd(paid_exp + crew_exp)))
p("All-in at caps:  paid %s + crew %s = %s (ceiling %s, headroom %s)" % (usd(paid_cap), usd(crew_cap), usd(at_caps), usd(CEILING), usd(CEILING - at_caps)))
if measured is None:
    assert at_caps <= CEILING
p("")
p("Leftover rule (section 9). Each leftover model launches only when the ceiling check passes at its launch; planning caps:")
sol = [item("pilot-sol", PILOT, list(PILOT), "swe", model_id="sol"), item("f1-sol", 80, FIVE, "swe", parts=3, model_id="sol")]
par = [item("pilot-p1", PILOT, list(PILOT), "swe", model_id="particle-1"), item("f1-p1", 80, FIVE, "swe", parts=3, model_id="particle-1")]
for x in sol + par:
    p("  %-12s%9d sessions, expected %9s, cap %5d" % (x["name"], x["sessions"], usd(x["expected"]), x["cap"]))
sol_cap = sum(x["cap"] for x in sol); sol_exp = sum(x["expected"] for x in sol)
par_cap = sum(x["cap"] for x in par)
for label, settled in [("every planned item settles at its cap", paid_cap), ("every planned item settles at its expected spend", paid_exp)]:
    base = settled + crew_cap
    p("  If %s: Sol needs %s against %s left: %s." % (label, usd(sol_cap), usd(CEILING - base), "fits" if base + sol_cap <= CEILING else "does not fit"))
    p("    particle-1 after Sol at its expected spend needs %s against %s left: %s; with no Sol run, %s left: %s." % (
        usd(par_cap), usd(CEILING - base - sol_exp), "fits" if base + sol_exp + par_cap <= CEILING else "does not fit",
        usd(CEILING - base), "fits" if base + par_cap <= CEILING else "does not fit"))
p("")
if measured is not None:
    m = measured["model"]
    p("Re-cost from %s's pilot (planning rate floors; TB2 scaled by the same ratio): %s" % (m, json.dumps(RAISE.get(m, {}), sort_keys=True)))
    if m == "opus":
        f1_five = item("f1-opus", 80, FIVE, "swe", parts=4)
        steps = [("as planned", [pilot, f1, tb2]), ("without the TB2 twin", [pilot, f1]),
                 ("without the TB2 twin and F1's off arms", [pilot, f1_five])]
        verdict = "RECOST: STOP before F1; L1 reports the pilot as a stop"
        for label, items in steps:
            total = sum(x["cap"] for x in items) + crew_cap
            p("  %-42s all-in at caps %s" % (label, usd(total)))
            if total <= CEILING:
                verdict = "RECOST: run " + label + "; caps " + ", ".join("%s %d" % (x["name"], x["cap"]) for x in items[1:])
                break
        p(verdict)
    else:
        x = item("f1-" + m, 80, FIVE, "swe", parts=3, model_id=m)
        p("RECOST: f1-%s cap %d (expected %s); it launches only if the ceiling check passes with this cap" % (m, x["cap"], usd(x["expected"])))
    p("")
p("Not planned:")
p("  F2 (two more F replicates on none, before-t and after-t, 480 sessions): not bought. O5 is descriptive (power.txt).")
p("  Sealed held-out bug fixes (the merged plan's T-hinv): 92 tasks to author, audit and hold in custody; dropped.")
p("  Held-out and public review (T-hrev, P4, P5): moved to the R2 line (GST-1163).")
print("\n".join(L))
