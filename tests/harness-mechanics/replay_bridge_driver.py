# Copyright (c) 2026 Garry Tan. MIT License.
"""Test driver for lanes/harness-mechanics/judge/hm_replay.py over the real dr_agent.deciders (unchanged): stub calls stand in
for the metering proxy, as tests/harness-mechanics/hooks.test.ts does for hm_judge.py. argv: the dr_agent dir, the judge dir.
stdin: {"cfg", "cases": [{"name", "req", "jev"?, "p1"?, "lab"?, "p1_limit"?}], "serve"?: [requests]}. stdout: the answers and
what each stub saw."""
import io, json, os, sys, time, types

sys.path[:0] = sys.argv[1:3]
try:
    import minisweagent.exceptions
except ImportError:
    m, e = types.ModuleType("minisweagent"), types.ModuleType("minisweagent.exceptions")
    for n in ("InterruptAgentFlow", "LimitsExceeded", "Submitted"):
        setattr(e, n, type(n, (Exception,), {}))
    m.exceptions = e
    sys.modules.update({"minisweagent": m, "minisweagent.exceptions": e})
import hm_replay as R
import hm_judge as H
from dr_agent.deciders import Generative

spec = json.load(sys.stdin)
ctx = R.load(spec["cfg"])
seen = {}


class Resp:
    def __init__(s, m):
        s.model = m


class VErr(Exception):
    def errors(s):
        return [{"loc": (s.args[0],), "type": "missing"}]


class Fake:
    def __init__(s, m):
        s.m = m

    def system_one(s, **kw):
        if str(s.m).startswith("<invalid-"):
            raise RuntimeError("response body does not match") from VErr(s.m[9:-1])
        return object() if s.m == "<missing>" else Resp(s.m)


def stubs(c):
    rec = seen.setdefault(c["name"], {"calls": [], "states": [], "users": [], "urls": []})

    def make_jev(url, token):
        js = c.get("jev") or {}
        jev = H.PinnedJev(url, token)
        jev._client = Fake(js.get("version", H.JEV_MODEL))
        rec["urls"].append(url)

        def jcall(state, qs):
            rec["calls"].append("jev")
            rec["states"].append(state)
            jev._client.system_one(state=state, questions=qs, model=H.JEV_MODEL)
            if js.get("sleep"):
                time.sleep(js["sleep"])
            if "choice" in js:
                return {"q": {"type": "choice", "choice": js["choice"], "confidence": max(js["probs"].values()), "probabilities": js["probs"]}}, {"input": 12, "output": 0}
            return {"q": {"type": "noul", "noul": js["p"]}}, {"input": 10, "output": 0}
        jev.call = jcall
        return jev

    def gen(kind, url, token, model, max_tokens, ps, who):
        rec["urls"].append(url)

        def call(system, user, schema):
            rec["calls"].append(who)
            rec["users"].append(json.loads(user))
            if ps.get("sleep"):
                time.sleep(ps["sleep"])
            content = "not json" if ps.get("fail") else json.dumps({"answer": ps["answer"], "confidence": ps["conf"]})
            return {"content": content, "usage": {"input": 5, "output": 3, "reasoning": 2}}
        return Generative(kind, url, token, model, max_tokens, call=call)

    R.make_jev = make_jev
    R.make_particle = lambda url, token, max_tokens: gen("openai", url, token, H.PARTICLE_MODEL, max_tokens, c.get("p1") or {}, "p1")
    R.make_labeler = lambda kind, url, token, model: gen(kind, url, token, model, 8000, c.get("lab") or {}, model)
    H.LIMIT_S["p1"] = c.get("p1_limit", 30.0)
    return rec


out = {"cases": {}, "seen": seen}
for c in spec["cases"]:
    stubs(c)
    out["cases"][c["name"]] = R.answer({"n": 1, **c["req"]}, ctx)
if spec.get("serve"):
    stubs({"name": "serve", "jev": {"p": 0.3}})
    buf = io.StringIO()
    R.serve(ctx, io.StringIO("".join(json.dumps(r) + "\n" for r in spec["serve"]) + "not json\n"), buf)
    out["serve"] = [json.loads(l) for l in buf.getvalue().splitlines()]
sys.stdout.write(json.dumps(out))
sys.stdout.flush()
os._exit(0)
