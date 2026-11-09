# Copyright (c) 2026 Garry Tan. MIT License.
"""Decision-level replay, part 3 (preregistration S11, the guess): on every logged R state that holds a usable Jev
answer, particle-1 answers twice, shown the guess built from R's logged Jev layer (layer ablation_guess) and without it
(layer ablation_noguess). No Jev call is made. States of other cells, and R states where Jev gave no usable answer (so
R showed no guess), are not asked. The caller passes only the 100-task subset's R sessions.

python -m dr_agent.guess_ablation --log-dir <dir> --questions <questions.json> [--pin <pin.json>] [--out <file>]
The proxy URL and session token come from DR_PROXY_URL and DR_PROXY_TOKEN.
"""
import os
import sys

from dr_agent.shadow import ask_particle, finish, guess_of, parse_args, particle_decider, replay


def logged_guess(rec):
    j = rec.get("layers", {}).get("jev")
    return guess_of(rec["type"], j) if rec.get("cell") == "R" and rec.get("mode") == "live" and j else None


def run(log_dir, q, particle, out_path):
    def ask(rec, state):
        got = ask_particle(rec, state, q, logged_guess(rec), particle)
        return {"ablation_guess": got["particle"], "ablation_noguess": got["particle_noguess"]}

    return replay(log_dir, out_path, lambda rec: logged_guess(rec) is not None, ask)


def main(argv=None):
    args, proxy, token, q, pin = parse_args("dr_agent.guess_ablation", argv)
    n, status = run(args.log_dir, q, particle_decider(proxy, token, pin), args.out or os.path.join(args.log_dir, "decisions.guess_ablation.jsonl"))
    return finish("dr_agent.guess_ablation", n, status)


if __name__ == "__main__":
    sys.exit(main())
