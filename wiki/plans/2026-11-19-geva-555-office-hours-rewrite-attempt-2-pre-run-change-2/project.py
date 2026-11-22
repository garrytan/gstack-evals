#!/usr/bin/env python3
# project.py: stage 1 and stage 2 of the second office-hours rewrite eval with GPT-6.1 Sol's sessions in Codex CLI
# instead of Claude Code. Plain Python 3, no packages, no key, no network. Run from this folder: python3 project.py > project.txt
#
# Every Opus, particle-1, simulator, label and judge figure is the first preregistration's cost.py figure, as the second
# attempt's resize.py (design 1) uses them. Only Sol's per-session figure moves, by what the keyless captures measured:
# the first request of a session. Turn count, reply length, reasoning and tool use are not measured keylessly, so they
# are held at whatever the planning figure already assumes. Both harnesses grew by the same tokens per turn (the reply
# plus the next message, captures.txt), so the first request is the only shape difference.

OPUS = {"skill": 3.50, "none": 0.50}
SOL = {"skill": 2.00, "none": 0.30}
P1 = {"skill": 0.30, "none": 0.05}
SIM, LABEL = 0.08, 0.06
S1_BRIEFS, S2_BRIEFS = 8, 80
S1_CAP, S2_CAP, S2_ROUND = 220, 1406, 40
PAID_CENTRAL, PAID_CAPS, AGENT_USE, ALL_IN = 1619.91, 2347, 390, 2737
S1_CENTRAL, S2_CENTRAL = 109.68, 1011.20

# First request of a session, o200k tokens (tiktoken 0.12.0), from captures.txt. Claude Code's new-pin figure is its
# current-pin capture plus the 24 tokens by which the new pin's office-hours/SKILL.md is longer (10,985 against 10,961).
CODEX = {"none": 11268, "current": 30995, "new": 31025}
CLAUDE = {"none": 13855, "current": 26019, "new": 26019 + 24}
IN, CACHED = 2.00, 0.10  # dollars per million input tokens, src/runner/pricing/prices.ts, openai/gpt-6.1-sol

def extra_reads(requests, hit):
    """First-request equivalents of the extra prefix a session pays: the first request in full, then each later request
    at the cached price on the share that hits the cache and the full price on the rest."""
    return 1 + (requests - 1) * (hit * CACHED / IN + (1 - hit))

def sol_codex(case):
    out = {}
    for arm in ("current", "new"):
        if case == "planning":
            out[arm] = SOL["skill"]
        elif case == "proportional":
            out[arm] = SOL["skill"] * CODEX[arm] / CLAUDE[arm]
        else:
            requests, hit = case
            out[arm] = SOL["skill"] + (CODEX[arm] - CLAUDE[arm]) * IN / 1e6 * extra_reads(requests, hit)
    out["none"] = SOL["none"]  # no credit taken for Codex's smaller none-arm prefix
    return out

def stage(briefs, sol):
    sessions = briefs * (OPUS["skill"] * 2 + OPUS["none"] + sol["current"] + sol["new"] + sol["none"]) + briefs * 6 * (SIM + LABEL)
    particle = briefs * (P1["skill"] * 2 + P1["none"]) + briefs * 3 * (SIM + LABEL)
    return sessions, particle

cases = [("planning figure, Claude Code (as approved)", "planning"),
         ("central: 22 requests a session, 90% of the carried prefix read from cache", (22, 0.9)),
         ("22 requests a session, no cache hits", (22, 0.0)),
         ("bound: the whole planning figure scales with the first request", "proportional")]

print("project.py: Sol in Codex CLI, stage 1 ($%d approved) and stage 2 ($%d approved); everything but Sol held at cost.py's figures" % (S1_CAP, S2_CAP))
print("first request, o200k tokens: Codex none %(none)d, current %(current)d, new %(new)d" % CODEX + "; Claude Code none %(none)d, current %(current)d, new %(new)d" % CLAUDE)
print("extra prefix a skill-arm request carries in Codex: current %d, new %d; none %d" % (CODEX["current"] - CLAUDE["current"], CODEX["new"] - CLAUDE["new"], CODEX["none"] - CLAUDE["none"]))
print()
for name, case in cases:
    sol = sol_codex(case)
    s1, s1p = stage(S1_BRIEFS, sol)
    s2, _ = stage(S2_BRIEFS, sol)
    st1 = s1 + s1p
    d = (st1 - S1_CENTRAL) + (s2 - S2_CENTRAL)
    paid = PAID_CENTRAL + d
    print(name)
    print("  Sol a session: current $%.3f, new $%.3f, none $%.2f" % (sol["current"], sol["new"], sol["none"]))
    print("  stage 1  central $%8.2f   1.35x $%8.2f   cap $%d   %s" % (st1, 1.35 * st1, S1_CAP, "fits" if 1.35 * st1 <= S1_CAP else "DOES NOT FIT"))
    print("  stage 2  central $%8.2f   1.35x $%8.2f   cap $%d   %s; with a round's $%d held at open $%.2f, %s" % (s2, 1.35 * s2, S2_CAP, "fits" if 1.35 * s2 <= S2_CAP else "DOES NOT FIT", S2_ROUND, 1.35 * s2 + S2_ROUND, "fits" if 1.35 * s2 + S2_ROUND <= S2_CAP else "over the cap"))
    print("  paid     central $%8.2f   1.35x $%8.2f" % (paid, 1.35 * paid))
    print("  all-in   central $%8.2f   1.35x $%8.2f   line $%d   %s; at the approved caps $%d, unchanged" % (paid + AGENT_USE, 1.35 * paid + AGENT_USE, ALL_IN, "fits" if 1.35 * paid + AGENT_USE <= ALL_IN else "DOES NOT FIT", PAID_CAPS + AGENT_USE))
print()
s1_room = (S1_CAP / 1.35 - S1_CENTRAL) / (2 * S1_BRIEFS)
s2_room = (S2_CAP / 1.35 - S2_CENTRAL) / (2 * S2_BRIEFS)
s2_round = ((S2_CAP - S2_ROUND) / 1.35 - S2_CENTRAL) / (2 * S2_BRIEFS)
print("room per Sol skill session, none held at $0.30: stage 1 at 1.35x within $%d: $%.3f; stage 2 at 1.35x within $%d: $%.3f; stage 2 with a round's $%d held: $%.4f" % (S1_CAP, s1_room, S2_CAP, s2_room, S2_ROUND, s2_round))
