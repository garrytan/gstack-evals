# Copyright (c) 2026 Garry Tan. MIT License.
"""Host-side shadow answering (calibration): after an N session, off the clock and outside the task container,
Jev and particle-1 answer every logged state. particle-1 answers each state twice, with Jev's guess (layer particle,
what R shows it) and without (layer particle_noguess, what P sees). Writes decisions.shadow.jsonl beside the log.

The replay modules (jev_newer, safety_held, guess_ablation) reuse the requests, the replay loop and the command line here.

python -m dr_agent.shadow --log-dir <dir> --questions <questions.json> [--pin <pin.json>] [--out <file>]
The proxy URL and session token come from DR_PROXY_URL and DR_PROXY_TOKEN.
"""
import argparse
import json
import os
import sys

from dr_agent.counting import AllowanceStop
from dr_agent.deciders import PARTICLE_MODEL, Generative, Jev, Questions


def ask_jev(rec, state, q, jev):
    """Jev's layer for one logged decision record."""
    typ = rec["type"]
    if typ == "next_step":
        return jev.ask(state, {"next_step": q.choice_next(rec["options"])})["next_step"]
    if typ == "relevant":
        return jev.ask_hits(state, rec["hits"], q)
    return jev.ask(state, {typ: q.noul(typ)})[typ]


def guess_of(typ, j):
    """The guess particle-1 is shown from Jev's layer j, or None when j gave no usable answer."""
    if typ == "next_step":
        return {"answer": j["answer"], "probabilities": j["probs"]} if j["ok"] else None
    if typ == "relevant":
        return [{"hit": e["hit"], "answer": e["answer"], "p_yes": e["p_yes"]} for e in j["answer"]] if j["answer"] else None
    return {"answer": j["answer"], "p_yes": j["p_yes"]} if j["ok"] else None


def ask_particle(rec, state, q, guess, particle):
    """particle-1 on one logged record twice: shown guess (layer particle) and without it (layer particle_noguess)."""
    typ = rec["type"]
    if typ == "next_step":
        qn = q.choice_next(rec["options"])
        return {"particle": particle.ask_choice(state, qn, guess), "particle_noguess": particle.ask_choice(state, qn)}
    if typ == "relevant":
        hits = rec["hits"]
        return {"particle": particle.ask_hits(state, q.relevant_text(), hits, guess), "particle_noguess": particle.ask_hits(state, q.relevant_text(), hits)}
    qn = q.noul(typ)
    return {"particle": particle.ask_noul(state, qn, guess), "particle_noguess": particle.ask_noul(state, qn)}


def answer(rec, state, q, jev, particle):
    """The shadow layers for one logged decision record."""
    j = ask_jev(rec, state, q, jev)
    return {"jev": j, **ask_particle(rec, state, q, guess_of(rec["type"], j), particle)}


def replay(log_dir, out_path, keep, ask):
    """Answer every logged record keep(rec) selects with ask(rec, state), adding its layers beside the logged ones."""
    with open(os.path.join(log_dir, "decisions.jsonl")) as f:
        recs = [json.loads(line) for line in f if line.strip()]
    done, status = 0, "ok"
    with open(out_path, "w") as out:
        for rec in recs:
            if not keep(rec):
                continue
            with open(os.path.join(log_dir, rec["state_file"])) as f:
                state = json.load(f)
            try:
                layers = ask(rec, state)
            except AllowanceStop:
                status = "allowance_stop"
                break
            out.write(json.dumps({**rec, "layers": {**rec.get("layers", {}), **layers}}, ensure_ascii=False) + "\n")
            done += 1
    return done, status


def run(log_dir, q, jev, particle, out_path):
    return replay(log_dir, out_path, lambda rec: rec.get("mode") == "shadow", lambda rec, state: answer(rec, state, q, jev, particle))


def parse_args(prog, argv, extra=()):
    """The answering command line every host mode shares, plus extra required flags. Returns (args, proxy, token, q, pin)."""
    ap = argparse.ArgumentParser(prog=prog)
    ap.add_argument("--log-dir", required=True)
    ap.add_argument("--questions", required=True)
    ap.add_argument("--pin")
    ap.add_argument("--out")
    for flag in extra:
        ap.add_argument(flag, required=True)
    args = ap.parse_args(argv)
    pin = json.load(open(args.pin)) if args.pin else {}
    return args, os.environ.get("DR_PROXY_URL", "").rstrip("/"), os.environ.get("DR_PROXY_TOKEN", ""), Questions.load(args.questions), pin


def particle_decider(proxy, token, pin):
    return Generative("openai", proxy + "/openrouter/v1", token, PARTICLE_MODEL, int(pin.get("particle_max_tokens", 8000)))


def finish(prog, n, status):
    print(f"{prog} answered {n} states, {status}")
    return 3 if status == "allowance_stop" else 0


def main(argv=None):
    args, proxy, token, q, pin = parse_args("dr_agent.shadow", argv)
    n, status = run(args.log_dir, q, Jev(proxy + "/typesafe", token), particle_decider(proxy, token, pin), args.out or os.path.join(args.log_dir, "decisions.shadow.jsonl"))
    return finish("dr_agent.shadow", n, status)


if __name__ == "__main__":
    sys.exit(main())
