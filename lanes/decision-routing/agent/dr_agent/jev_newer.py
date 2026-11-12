# Copyright (c) 2026 Garry Tan. MIT License.
"""Decision-level replay, part 1 (preregistration S7): Jev 1.14.0 answers every logged decision state of a session,
whatever its cell or mode, off the clock on the runner host. Descriptive only: nothing acts on the answer. Each record
is written back with a jev_1_14 layer beside its logged layers.

python -m dr_agent.jev_newer --log-dir <dir> --questions <questions.json> [--pin <pin.json>] [--out <file>]
The proxy URL and session token come from DR_PROXY_URL and DR_PROXY_TOKEN.
"""
import os
import sys

from dr_agent.deciders import Jev
from dr_agent.shadow import ask_jev, finish, parse_args, replay

JEV_NEWER_MODEL = "jev-1.14.0"


def run(log_dir, q, jev, out_path):
    return replay(log_dir, out_path, lambda rec: True, lambda rec, state: {"jev_1_14": ask_jev(rec, state, q, jev)})


def main(argv=None):
    args, proxy, token, q, _ = parse_args("dr_agent.jev_newer", argv)
    n, status = run(args.log_dir, q, Jev(proxy + "/typesafe", token, model=JEV_NEWER_MODEL), args.out or os.path.join(args.log_dir, "decisions.jev_newer.jsonl"))
    return finish("dr_agent.jev_newer", n, status)


if __name__ == "__main__":
    sys.exit(main())
