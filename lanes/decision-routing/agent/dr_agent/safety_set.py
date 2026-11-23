# Copyright (c) 2026 Garry Tan. MIT License.
"""The constructed safety set answered as one pseudo-session per half: the calibration half (preregistration 6.2,
for the safety bands) or the held half (S4's detection test), 100 commands each labelled by construction. The module
logs one safe decision per command of the half in the session's log dir (session constructed-<half>, mode shadow, the
command in an otherwise empty state, the case id and its construction label beside it), then Jev 1.13.0 and particle-1
with and without Jev's guess answer every state, the same layers the shadow answers give. A rerun rewrites the log.

python -m dr_agent.safety_set --log-dir <dir> --questions <questions.json> --safety-set <safety-set.json>
    --half <calibration|held> [--pin <pin.json>] [--out <file>]
The proxy URL and session token come from DR_PROXY_URL and DR_PROXY_TOKEN.
"""
import json
import os
import sys

from dr_agent.deciders import Jev
from dr_agent.log import DecisionLog
from dr_agent.shadow import finish, parse_args, particle_decider, run as answer_shadow

HALVES = ("calibration", "held")
HALF_SIZE = 100
EMPTY_STATE = {"task": "", "diff": {"stat": "", "text": ""}, "last_command": "", "last_output": "", "last_exit_code": None, "recent_steps": [], "last_test": "unknown"}


def half_cases(path, half):
    """One half of the safety set, in file order: exactly 100 commands, 50 of them unsafe."""
    with open(path) as f:
        cases = [c for c in json.load(f)["commands"] if c["half"] == half]
    unsafe = sum(1 for c in cases if c["unsafe"])
    if len(cases) != HALF_SIZE or unsafe != HALF_SIZE // 2:
        raise ValueError(f"E_USAGE: {path} holds {len(cases)} {half} commands, {unsafe} unsafe; each half is {HALF_SIZE}, half of them unsafe")
    return cases


def log_pseudo_session(cases, half, log_dir):
    path = os.path.join(log_dir, "decisions.jsonl")
    if os.path.exists(path):
        os.remove(path)
    dlog = DecisionLog(log_dir, "constructed-" + half, "constructed", "none", 0)
    for c in cases:
        dlog.write(dlog.begin("safe", "shadow", 0, {**EMPTY_STATE, "command": c["command"]}, command=c["command"], t_ms=0, case_id=c["id"], unsafe=c["unsafe"], kind=c["kind"]))


def run(safety_set, half, log_dir, q, jev, particle, out_path):
    log_pseudo_session(half_cases(safety_set, half), half, log_dir)
    return answer_shadow(log_dir, q, jev, particle, out_path)


def main(argv=None):
    args, proxy, token, q, pin = parse_args("dr_agent.safety_set", argv, ["--safety-set", "--half"])
    try:
        if args.half not in HALVES:
            raise ValueError(f"E_USAGE: --half is calibration or held, not {args.half}")
        n, status = run(args.safety_set, args.half, args.log_dir, q, Jev(proxy + "/typesafe", token), particle_decider(proxy, token, pin), args.out or os.path.join(args.log_dir, f"decisions.safety_{args.half}.jsonl"))
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    return finish("dr_agent.safety_set", n, status)


if __name__ == "__main__":
    sys.exit(main())
