# Money projection for the office-hours rewrite preregistration.
# Plain Python 3, no packages. Every input is a planning figure stated in the post's section 13.
import math

OPUS_SKILL, OPUS_NONE = 3.50, 0.50
SOL_SKILL, SOL_NONE = 2.00, 0.30
P1_SKILL, P1_NONE = 0.30, 0.05
SIM, LABEL = 0.08, 0.06

ALLOW = {"opus_skill": 15.0, "particle_skill": 3.0, "brief": 3.50, "other": 1.0}

DRAW_USD = 129.19 / 124
PASS = 96 / 124
PAIRS, UNPAIRED = 34, 42
TWIN_PASS = 7 / 16

SCRIPT_TURNS, SIM_TURN = 660, 0.0064
AUDIT_TURNS, AUDIT_TURN = 80, 0.314

GOLD_ROWS, GOLD_ROW, PROD_ROW, PROBES = 1000, 0.078, 0.0098, 2.0

VM_MIN, VM_MIN_USD = 4, 0.00416

FOUNDER, BUILDER, CALIBRATION = 70, 24, 8
AGENT_USE = 350


def sessions(briefs):
    opus = briefs * (2 * OPUS_SKILL + OPUS_NONE)
    sol = briefs * (2 * SOL_SKILL + SOL_NONE)
    n = briefs * 3 * 2
    return opus + sol + n * (SIM + LABEL), n


def particle(briefs):
    n = briefs * 3
    return briefs * (2 * P1_SKILL + P1_NONE) + n * (SIM + LABEL), n


draws = PAIRS / PASS + PAIRS / TWIN_PASS + UNPAIRED / PASS
authoring = draws * DRAW_USD
audit = SCRIPT_TURNS * SIM_TURN + AUDIT_TURNS * AUDIT_TURN
s1_main, s1_n = sessions(CALIBRATION)
s1_p1, s1_pn = particle(CALIBRATION)
judge = GOLD_ROWS * (GOLD_ROW + PROD_ROW) + PROBES
s2_main, s2_n = sessions(FOUNDER + BUILDER)
s2_p1, s2_pn = particle(FOUNDER + BUILDER)
hosts = (s1_n + s1_pn + s2_n + s2_pn) * VM_MIN * VM_MIN_USD

items = [
    ("1 Authoring", authoring, ALLOW["brief"]),
    ("2 Simulator audit", audit, ALLOW["other"]),
    ("3 Stage 1", s1_main + s1_p1, ALLOW["opus_skill"]),
    ("4 Judge check", judge, ALLOW["other"]),
    ("5 Stage 2, Opus and Sol", s2_main, ALLOW["opus_skill"]),
    ("6 Stage 2, particle-1", s2_p1, ALLOW["particle_skill"]),
    ("7 Hosts", hosts, ALLOW["other"]),
]

print(f"draws to place 110 briefs: {draws:.1f}")
print(f"stage 1 sessions: {s1_n} on Opus and Sol, {s1_pn} on particle-1; stage 2: {s2_n} and {s2_pn}")
total_c = total_cap = 0
for name, central, allow in items:
    cap = math.ceil(1.35 * central + allow)
    total_c += central
    total_cap += cap
    print(f"{name:28s} central {central:9.2f}  cap {cap:5d}")
print(f"{'Paid total':28s} central {total_c:9.2f}  cap {total_cap:5d}")
print(f"agent model use {AGENT_USE}; all-in central {total_c + AGENT_USE:.2f}, at caps {total_cap + AGENT_USE}")
p1_c = s1_p1 + s2_p1
p1_cap = 1.35 * s1_p1 + math.ceil(1.35 * s2_p1 + ALLOW["particle_skill"])
print(f"particle-1 across both stages: central {p1_c:.2f}, at caps {p1_cap:.2f}")
