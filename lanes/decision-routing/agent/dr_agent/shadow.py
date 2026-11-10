# Copyright (c) 2026 Garry Tan. MIT License.
"""Host-side shadow answering (calibration): after an N session, off the clock and outside the task container,
Jev and particle-1 answer every logged state. particle-1 answers each state twice, with Jev's guess (layer particle,
what R shows it) and without (layer particle_noguess, what P sees). Writes decisions.shadow.jsonl beside the log.

python -m dr_agent.shadow --log-dir <dir> --questions <questions.json> [--pin <pin.json>] [--out <file>]
The proxy URL and session token come from DR_PROXY_URL and DR_PROXY_TOKEN.
"""
import argparse
import json
import os
import sys

from dr_agent.counting import AllowanceStop
from dr_agent.deciders import PARTICLE_MODEL, Generative, Jev, Questions


def answer(rec, state, q, jev, particle):
    """The shadow layers for one logged decision record."""
    typ = rec["type"]
    if typ == "next_step":
        qn = q.choice_next(rec["options"])
        j = jev.ask(state, {"next_step": qn})["next_step"]
        guess = {"answer": j["answer"], "probabilities": j["probs"]} if j["ok"] else None
        return {"jev": j, "particle": particle.ask_choice(state, qn, guess), "particle_noguess": particle.ask_choice(state, qn)}
    if typ == "relevant":
        hits = rec["hits"]
        j = jev.ask_hits(state, hits, q)
        guess = [{"hit": e["hit"], "answer": e["answer"], "p_yes": e["p_yes"]} for e in j["answer"]] if j["answer"] else None
        return {"jev": j, "particle": particle.ask_hits(state, q.relevant_text(), hits, guess), "particle_noguess": particle.ask_hits(state, q.relevant_text(), hits)}
    qn = q.noul(typ)
    j = jev.ask(state, {typ: qn})[typ]
    guess = {"answer": j["answer"], "p_yes": j["p_yes"]} if j["ok"] else None
    return {"jev": j, "particle": particle.ask_noul(state, qn, guess), "particle_noguess": particle.ask_noul(state, qn)}


def run(log_dir, q, jev, particle, out_path):
    with open(os.path.join(log_dir, "decisions.jsonl")) as f:
        recs = [json.loads(line) for line in f if line.strip()]
    done, status = 0, "ok"
    with open(out_path, "w") as out:
        for rec in recs:
            if rec.get("mode") != "shadow":
                continue
            with open(os.path.join(log_dir, rec["state_file"])) as f:
                state = json.load(f)
            try:
                layers = answer(rec, state, q, jev, particle)
            except AllowanceStop:
                status = "allowance_stop"
                break
            out.write(json.dumps({**rec, "layers": {**rec.get("layers", {}), **layers}}, ensure_ascii=False) + "\n")
            done += 1
    return done, status


def main(argv=None):
    ap = argparse.ArgumentParser(prog="dr_agent.shadow")
    ap.add_argument("--log-dir", required=True)
    ap.add_argument("--questions", required=True)
    ap.add_argument("--pin")
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    proxy, token = os.environ.get("DR_PROXY_URL", "").rstrip("/"), os.environ.get("DR_PROXY_TOKEN", "")
    q = Questions.load(args.questions)
    pin = json.load(open(args.pin)) if args.pin else {}
    jev = Jev(proxy + "/typesafe", token)
    particle = Generative("openai", proxy + "/openrouter/v1", token, PARTICLE_MODEL, int(pin.get("particle_max_tokens", 8000)))
    n, status = run(args.log_dir, q, jev, particle, args.out or os.path.join(args.log_dir, "decisions.shadow.jsonl"))
    print(f"dr_agent.shadow answered {n} states, {status}")
    return 3 if status == "allowance_stop" else 0


if __name__ == "__main__":
    sys.exit(main())
