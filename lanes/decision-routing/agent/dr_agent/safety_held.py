# Copyright (c) 2026 Garry Tan. MIT License.
"""Decision-level replay, part 2 (preregistration S4's detection test): the constructed safety set's held half, 100
commands labelled by construction, answered as one pseudo-session. The module logs one safe decision per held command
in the session's log dir (session constructed-held, mode shadow, the command in an otherwise empty state, the case id
and its construction label beside it), then Jev 1.13.0 and particle-1 with and without Jev's guess answer every state,
the same layers the shadow answers give. A rerun rewrites the pseudo-session's log.

python -m dr_agent.safety_held --log-dir <dir> --questions <questions.json> --safety-set <safety-set.json>
    [--pin <pin.json>] [--out <file>]
The proxy URL and session token come from DR_PROXY_URL and DR_PROXY_TOKEN.
"""
import json
import os
import sys

from dr_agent.deciders import Jev
from dr_agent.log import DecisionLog
from dr_agent.shadow import finish, parse_args, particle_decider, run as answer_shadow

SESSION = "constructed-held"
HELD = 100
EMPTY_STATE = {"task": "", "diff": {"stat": "", "text": ""}, "last_command": "", "last_output": "", "last_exit_code": None, "recent_steps": [], "last_test": "unknown"}


def held_cases(path):
    """The held half of the safety set, in file order: exactly 100 commands, 50 of them unsafe."""
    with open(path) as f:
        cases = [c for c in json.load(f)["commands"] if c["half"] == "held"]
    if len(cases) != HELD or sum(1 for c in cases if c["unsafe"]) != HELD // 2:
        raise ValueError(f"E_USAGE: {path} holds {len(cases)} held commands, {sum(1 for c in cases if c['unsafe'])} unsafe; the held half is {HELD}, half of them unsafe")
    return cases


def log_pseudo_session(cases, log_dir):
    path = os.path.join(log_dir, "decisions.jsonl")
    if os.path.exists(path):
        os.remove(path)
    dlog = DecisionLog(log_dir, SESSION, "constructed", "none", 0)
    for c in cases:
        dlog.write(dlog.begin("safe", "shadow", 0, {**EMPTY_STATE, "command": c["command"]}, command=c["command"], t_ms=0, case_id=c["id"], unsafe=c["unsafe"], kind=c["kind"]))


def run(safety_set, log_dir, q, jev, particle, out_path):
    log_pseudo_session(held_cases(safety_set), log_dir)
    return answer_shadow(log_dir, q, jev, particle, out_path)


def main(argv=None):
    args, proxy, token, q, pin = parse_args("dr_agent.safety_held", argv, ["--safety-set"])
    try:
        n, status = run(args.safety_set, args.log_dir, q, Jev(proxy + "/typesafe", token), particle_decider(proxy, token, pin), args.out or os.path.join(args.log_dir, "decisions.safety_held.jsonl"))
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    return finish("dr_agent.safety_held", n, status)


if __name__ == "__main__":
    sys.exit(main())
