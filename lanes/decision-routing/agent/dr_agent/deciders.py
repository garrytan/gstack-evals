# Copyright (c) 2026 Garry Tan. MIT License.
"""Decider adapters: Jev through typesafe-sdk, and generative deciders (particle-1, and the main model in its typed
rendering) through the openai and anthropic SDKs. Every call goes to the metering proxy with the session token,
uncached, with the SDK's own retries off. A reply that is missing, truncated or fails its schema gets one retry,
then the layer reports ok false and the decision falls to the next layer.

Each adapter takes an optional call function so tests can stand in for the network; the default builds the SDK
client on first use.
"""
import json
import time

from dr_agent.counting import as_stop
from dr_agent.state import canonical, sha256

JEV_MODEL = "jev-1.13.0"
JEV_QUESTION_LIMIT = 32000
PARTICLE_MODEL = "particle-ai/particle-1"
OPUS_MODEL = "claude-opus-5-5"
SOL_MODEL = "gpt-6.1-sol"
FRONTIER_MAX_TOKENS = 8000
SYSTEM = ("You answer one typed question about the state of a coding agent that is fixing an issue in a repository. "
          "Read the state and the question, then reply only with JSON that matches the schema. confidence is your "
          "probability, from 0 to 1, that your answer is right.")


class Questions:
    """questions.json, frozen by sha256: the same text for every decider."""

    def __init__(self, data, sha):
        self.data, self.sha256 = data, sha

    @classmethod
    def load(cls, path):
        with open(path, "rb") as f:
            raw = f.read()
        return cls(json.loads(raw), sha256(raw))

    def noul(self, typ):
        return {"type": "noul", "instructions": self.data[typ]["instructions"]}

    def option_text(self, opt):
        crit = self.data["next_step"]["criteria"]
        if opt.startswith("show_"):
            return crit["show_k"].replace("candidates[k]", f"candidates[{opt[5:]}]")
        return crit[opt]

    def choice_next(self, options):
        return {"type": "choice", "instructions": self.data["next_step"]["instructions"], "criteria": {o: self.option_text(o) for o in options}}

    def relevant_hit(self, i):
        return {"type": "noul", "instructions": self.data["relevant"]["instructions"].replace("`hit`", f"`hits[{i}]`")}

    def relevant_text(self):
        return self.data["relevant"]["instructions"]


def layer(**kw):
    rec = {"answer": None, "p_yes": None, "conf": None, "probs": None, "ok": False, "error": None, "retries": 0,
           "latency_ms": 0, "usage": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "reasoning": 0}, "guess_shown": False}
    rec.update(kw)
    return rec


def _prob(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x <= 1


def _noul_fields(p):
    return {"p_yes": p, "conf": max(p, 1 - p), "answer": "yes" if p >= 0.5 else "no"}


def _err(e):
    return f"{type(e).__name__}: {str(e)[:200]}"


class Jev:
    def __init__(self, base_url, token, call=None, model=JEV_MODEL):
        self.base_url, self.token, self.call, self._client, self.model = base_url, token, call or self._sdk_call, None, model

    def _sdk_call(self, state, questions):
        from typesafe_sdk import Choice, Noul, RetryPolicy, TypeSafeClient

        if self._client is None:
            self._client = TypeSafeClient(api_key=self.token, base_url=self.base_url, model=self.model, retry=RetryPolicy(max_retries=0), compression=False, timeout=120.0)
        qs = {n: Noul(instructions=q["instructions"]) if q["type"] == "noul" else Choice(instructions=q["instructions"], criteria=q["criteria"]) for n, q in questions.items()}
        resp = self._client.system_one(state=state, questions=qs, model=self.model)
        answers = {}
        for n, a in resp.answers.items():
            if a.type == "noul":
                answers[n] = {"type": "noul", "noul": a.noul}
            elif a.type == "choice":
                answers[n] = {"type": "choice", "choice": a.choice, "confidence": a.confidence, "probabilities": dict(a.probabilities)}
        return answers, {"input": resp.usage.input_tokens or 0, "output": resp.usage.output_tokens or 0}

    def ask(self, state, questions):
        """Ask every question that shares this state in one request. Returns {name: layer record}."""
        size = len(canonical(state))
        recs, send = {}, {}
        for n, q in questions.items():
            if size + len(json.dumps(q, ensure_ascii=False)) > JEV_QUESTION_LIMIT:
                recs[n] = layer(error="state_over_limit")
            else:
                send[n] = q
        if not send:
            return recs
        t, err, retries, answers, usage = time.time(), None, 0, {}, {}
        for attempt in range(2):
            retries = attempt
            try:
                answers, usage = self.call(state, send)
                err = None
                break
            except Exception as e:
                stop = as_stop(e)
                if stop is not None:
                    raise stop from e
                err = _err(e)
        latency = int((time.time() - t) * 1000)
        first = True
        for n, q in send.items():
            rec = layer(retries=retries, latency_ms=latency)
            if first:
                rec["usage"].update({k: v for k, v in usage.items() if k in rec["usage"]})
                first = False
            a = answers.get(n) if err is None else None
            if err is not None:
                rec["error"] = err
            elif q["type"] == "noul" and isinstance(a, dict) and _prob(a.get("noul")):
                rec.update(ok=True, **_noul_fields(a["noul"]))
            elif q["type"] == "choice" and isinstance(a, dict) and a.get("choice") in q["criteria"] and isinstance(a.get("probabilities"), dict):
                probs = {k: float(v) for k, v in a["probabilities"].items()}
                rec.update(ok=True, answer=a["choice"], conf=max(probs.values()) if probs else a.get("confidence"), probs=probs)
            else:
                rec["error"] = "missing or invalid answer"
            recs[n] = rec
        return recs

    def ask_hits(self, state, hits, questions):
        """Every asked hit of one command in one request, folded into one layer record with a per-hit answer list."""
        recs = self.ask(state, {f"relevant_{i}": questions.relevant_hit(i) for i in range(len(hits))})
        rows = [(h, recs[f"relevant_{i}"]) for i, h in enumerate(hits)]
        entries = [{"hit": h, "p_yes": r["p_yes"], "conf": r["conf"], "answer": r["answer"]} for h, r in rows if r["ok"]]
        agg = layer(answer=entries, ok=len(entries) == len(hits), error=next((r["error"] for _, r in rows if r["error"]), None),
                    retries=max(r["retries"] for _, r in rows), latency_ms=max(r["latency_ms"] for _, r in rows))
        for _, r in rows:
            for k in agg["usage"]:
                agg["usage"][k] += r["usage"].get(k, 0)
        return agg


class Generative:
    """A generative decider. kind is openai (particle-1 through OpenRouter, or Sol) or anthropic (Opus)."""

    def __init__(self, kind, base_url, token, model, max_tokens, call=None):
        self.kind, self.base_url, self.token, self.model, self.max_tokens = kind, base_url, token, model, max_tokens
        self.call = call or (self._openai_call if kind == "openai" else self._anthropic_call)
        self._client = None

    def __repr__(self):
        return f"Generative({self.kind}, {self.model})"

    def _openai_call(self, system, user, schema):
        from openai import OpenAI

        if self._client is None:
            self._client = OpenAI(api_key=self.token, base_url=self.base_url, max_retries=0, timeout=600.0)
        tok = {"max_tokens": self.max_tokens} if self.model == PARTICLE_MODEL else {"max_completion_tokens": self.max_tokens}
        r = self._client.chat.completions.create(
            model=self.model, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_schema", "json_schema": {"name": "answer", "strict": True, "schema": schema}}, **tok)
        ch = r.choices[0] if r.choices else None
        u = r.usage
        pd = getattr(u, "prompt_tokens_details", None) if u else None
        cd = getattr(u, "completion_tokens_details", None) if u else None
        usage = {"input": (u.prompt_tokens or 0) if u else 0, "output": (u.completion_tokens or 0) if u else 0,
                 "cache_read": (getattr(pd, "cached_tokens", 0) or 0) if pd else 0, "reasoning": (getattr(cd, "reasoning_tokens", 0) or 0) if cd else 0}
        return {"content": ch.message.content if ch else None, "truncated": bool(ch and ch.finish_reason == "length"), "usage": usage}

    def _anthropic_call(self, system, user, schema):
        from anthropic import Anthropic

        if self._client is None:
            self._client = Anthropic(api_key=self.token, base_url=self.base_url, max_retries=0, timeout=600.0)
        r = self._client.messages.create(
            model=self.model, max_tokens=self.max_tokens, system=system, messages=[{"role": "user", "content": user}],
            tools=[{"name": "answer", "description": "Record the answer to the question.", "input_schema": schema}],
            tool_choice={"type": "tool", "name": "answer"})
        content = next((b.input for b in r.content if getattr(b, "type", "") == "tool_use" and b.name == "answer"), None)
        u = r.usage
        usage = {"input": u.input_tokens or 0, "output": u.output_tokens or 0,
                 "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0, "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0}
        return {"content": content, "truncated": r.stop_reason == "max_tokens", "usage": usage}

    def _run(self, payload, schema, parse, guess):
        user = json.dumps(payload, ensure_ascii=False)
        rec = layer(guess_shown=guess is not None)
        t = time.time()
        for attempt in range(2):
            rec["retries"] = attempt
            try:
                r = self.call(SYSTEM, user, schema)
            except Exception as e:
                stop = as_stop(e)
                if stop is not None:
                    raise stop from e
                rec["error"] = _err(e)
                continue
            for k, v in (r.get("usage") or {}).items():
                if k in rec["usage"]:
                    rec["usage"][k] += v or 0
            content = r.get("content")
            if r.get("truncated"):
                rec["error"] = "truncated"
                continue
            if content in (None, ""):
                rec["error"] = "missing"
                continue
            try:
                obj = json.loads(content) if isinstance(content, str) else content
                rec.update(parse(obj))
                rec.update(ok=True, error=None)
                break
            except (ValueError, TypeError, KeyError, AttributeError) as e:
                rec["error"] = f"schema: {str(e)[:200]}"
        rec["latency_ms"] = int((time.time() - t) * 1000)
        return rec

    @staticmethod
    def _schema(answer_enum):
        return {"type": "object", "properties": {"answer": {"type": "string", "enum": answer_enum}, "confidence": {"type": "number", "description": "0 to 1"}},
                "required": ["answer", "confidence"], "additionalProperties": False}

    def ask_choice(self, state, question, guess=None):
        options = list(question["criteria"])
        payload = {"state": state, "question": question["instructions"], "options": question["criteria"]}
        if guess is not None:
            payload["jev_guess"] = guess

        def parse(obj):
            if obj["answer"] not in options or not _prob(obj["confidence"]):
                raise ValueError("answer or confidence out of schema")
            return {"answer": obj["answer"], "conf": float(obj["confidence"])}

        return self._run(payload, self._schema(options), parse, guess)

    def ask_noul(self, state, question, guess=None):
        payload = {"state": state, "question": question["instructions"], "options": {"yes": "Yes.", "no": "No."}}
        if guess is not None:
            payload["jev_guess"] = guess

        def parse(obj):
            if obj["answer"] not in ("yes", "no") or not _prob(obj["confidence"]):
                raise ValueError("answer or confidence out of schema")
            c = float(obj["confidence"])
            return _noul_fields(c if obj["answer"] == "yes" else 1 - c)

        return self._run(payload, self._schema(["yes", "no"]), parse, guess)

    def ask_hits(self, state, question_text, hits, guess=None):
        """Every asked hit of one command in one request: one answer and confidence per hit, hit set to that entry."""
        payload = {"state": {k: v for k, v in state.items() if k != "hits"}, "hits": hits, "question": question_text, "for_each": "Answer once for each entry of `hits`, with `hit` set to that entry."}
        if guess is not None:
            payload["jev_guess"] = guess
        item = {"type": "object", "properties": {"hit": {"type": "string"}, "answer": {"type": "string", "enum": ["yes", "no"]}, "confidence": {"type": "number", "description": "0 to 1"}},
                "required": ["hit", "answer", "confidence"], "additionalProperties": False}
        schema = {"type": "object", "properties": {"answers": {"type": "array", "items": item}}, "required": ["answers"], "additionalProperties": False}

        def parse(obj):
            got = obj["answers"]
            if len(got) != len(hits) or sorted(a["hit"] for a in got) != sorted(hits):
                raise ValueError("answers do not cover the hits exactly once")
            entries = []
            for a in got:
                if a["answer"] not in ("yes", "no") or not _prob(a["confidence"]):
                    raise ValueError("answer or confidence out of schema")
                c = float(a["confidence"])
                entries.append({"hit": a["hit"], **_noul_fields(c if a["answer"] == "yes" else 1 - c)})
            order = {h: i for i, h in enumerate(hits)}
            return {"answer": sorted(entries, key=lambda e: order[e["hit"]])}

        return self._run(payload, schema, parse, guess)


def make_deciders(cell, model, proxy_url, token, pin):
    """The decider adapters a cell's layers use: (jev, particle, frontier)."""
    jev = Jev(proxy_url + "/typesafe", token) if cell in ("R", "J") else None
    particle = Generative("openai", proxy_url + "/openrouter/v1", token, PARTICLE_MODEL, int(pin.get("particle_max_tokens", 8000))) if cell in ("R", "P") else None
    frontier = None
    if cell in ("R", "P", "F", "J"):
        frontier = (Generative("anthropic", proxy_url + "/anthropic", token, OPUS_MODEL, FRONTIER_MAX_TOKENS) if model == "opus"
                    else Generative("openai", proxy_url + "/openai/v1", token, SOL_MODEL, FRONTIER_MAX_TOKENS))
    return jev, particle, frontier
