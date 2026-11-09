# Copyright (c) 2026 Garry Tan. MIT License.
"""Unit tests for the in-container decision-routing agent (dr_agent).

Runs with any python3. When mini-swe-agent is not importable, a small stand-in for its agent loop, exceptions and
local environment is written to a temp dir first, so the routing logic still runs; run it with the dev venv's python
(DR_TEST_TIER=real) to use the real mini 2.4.6 source, litellm and the real SDKs against a local fake proxy.
Prints one PASS or FAIL line per test.
"""
import copy
import hashlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import types

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "lanes", "decision-routing", "agent"))
TMP = tempfile.mkdtemp(prefix="dr-agent-test-")
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
os.environ.setdefault("MSWEA_COST_TRACKING", "ignore_errors")
os.environ.setdefault("MSWEA_SILENT_STARTUP", "1")

STUB = {
    "minisweagent/__init__.py": "__version__ = 'stub'\nEnvironment = object\nModel = object\n",
    "minisweagent/exceptions.py": (
        "class InterruptAgentFlow(Exception):\n"
        "    def __init__(self, *messages):\n        self.messages = messages\n        super().__init__()\n"
        "class Submitted(InterruptAgentFlow): pass\n"
        "class LimitsExceeded(InterruptAgentFlow): pass\n"
        "class TimeExceeded(LimitsExceeded): pass\n"
        "class UserInterruption(InterruptAgentFlow): pass\n"
        "class FormatError(InterruptAgentFlow): pass\n"
    ),
    "minisweagent/agents/__init__.py": "",
    "minisweagent/agents/default.py": '''
import time
from minisweagent.exceptions import FormatError, InterruptAgentFlow, LimitsExceeded, TimeExceeded
class AgentConfig:
    def __init__(self, system_template="", instance_template="", step_limit=0, cost_limit=3.0,
                 wall_time_limit_seconds=0, max_consecutive_format_errors=3, output_path=None, **_):
        self.system_template, self.instance_template = system_template, instance_template
        self.step_limit, self.cost_limit, self.wall_time_limit_seconds = step_limit, cost_limit, wall_time_limit_seconds
        self.max_consecutive_format_errors, self.output_path = max_consecutive_format_errors, output_path
    def model_dump(self, mode=None):
        return dict(self.__dict__, output_path=str(self.output_path))
class DefaultAgent:
    def __init__(self, model, env, *, config_class=AgentConfig, **kwargs):
        self.config = config_class(**kwargs)
        self.messages, self.model, self.env = [], model, env
        self.extra_template_vars, self.cost, self.n_calls, self.n_consecutive_format_errors = {}, 0.0, 0, 0
        self._start_time = time.time()
    def get_template_vars(self, **kwargs):
        return {}
    def add_messages(self, *messages):
        self.messages.extend(messages)
        return list(messages)
    def handle_uncaught_exception(self, e):
        return self.add_messages(self.model.format_message(role="exit", content=str(e), extra={"exit_status": type(e).__name__, "submission": ""}))
    def run(self, task="", **kwargs):
        self.messages = []
        self.add_messages(self.model.format_message(role="system", content=self.config.system_template),
                          self.model.format_message(role="user", content=self.config.instance_template.replace("{{task}}", task)))
        while True:
            try:
                self.step()
            except InterruptAgentFlow as e:
                self.add_messages(*e.messages)
            except Exception as e:
                self.handle_uncaught_exception(e)
                raise
            if self.messages[-1].get("role") == "exit":
                break
        return self.messages[-1].get("extra", {})
    def step(self):
        return self.execute_actions(self.query())
    def query(self):
        if 0 < self.config.step_limit <= self.n_calls or 0 < self.config.cost_limit <= self.cost:
            raise LimitsExceeded({"role": "exit", "content": "LimitsExceeded", "extra": {"exit_status": "LimitsExceeded", "submission": ""}})
        if 0 < self.config.wall_time_limit_seconds <= int(time.time() - self._start_time):
            raise TimeExceeded({"role": "exit", "content": "TimeExceeded", "extra": {"exit_status": "TimeExceeded", "submission": ""}})
        self.n_calls += 1
        message = self.model.query(self.messages)
        self.add_messages(message)
        return message
    def execute_actions(self, message):
        outputs = [self.env.execute(action) for action in message.get("extra", {}).get("actions", [])]
        return self.add_messages(*self.model.format_observation_messages(message, outputs, self.get_template_vars()))
''',
    "minisweagent/environments/__init__.py": "",
    "minisweagent/environments/local.py": '''
import subprocess
from minisweagent.exceptions import Submitted
class LocalEnvironment:
    def __init__(self, cwd="", timeout=30, **_):
        self.cwd, self.timeout = cwd, timeout
    def execute(self, action, cwd="", *, timeout=None):
        p = subprocess.run(action.get("command", ""), shell=True, text=True, cwd=cwd or self.cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout or self.timeout)
        output = {"output": p.stdout, "returncode": p.returncode, "exception_info": ""}
        lines = output["output"].lstrip().splitlines(keepends=True)
        if lines and lines[0].strip() == "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" and output["returncode"] == 0:
            sub = "".join(lines[1:])
            raise Submitted({"role": "exit", "content": sub, "extra": {"exit_status": "Submitted", "submission": sub}})
        return output
''',
    "minisweagent/models/__init__.py": "",
    "minisweagent/models/utils/__init__.py": "",
    "minisweagent/models/utils/actions_toolcall.py": '''
def format_toolcall_observation_messages(*, actions, outputs, observation_template, template_vars=None, multimodal_regex=""):
    nx = {"output": "", "returncode": -1, "exception_info": "action was not executed"}
    outs = outputs + [nx] * (len(actions) - len(outputs))
    res = []
    for a, o in zip(actions, outs):
        m = {"content": "<returncode>%s</returncode>\\n<output>\\n%s</output>" % (o.get("returncode"), o.get("output", "")),
             "extra": {"raw_output": o.get("output", ""), "returncode": o.get("returncode")}}
        if "tool_call_id" in a:
            m["tool_call_id"], m["role"] = a["tool_call_id"], "tool"
        else:
            m["role"] = "user"
        res.append(m)
    return res
''',
}

try:
    import minisweagent  # noqa: F401

    TIER = "real"
except ImportError:
    TIER = "stub"
    for rel, body in STUB.items():
        path = os.path.join(TMP, "stub", rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(body)
    sys.path.insert(0, os.path.join(TMP, "stub"))
sys.path.insert(0, AGENT_DIR)

from minisweagent.environments.local import LocalEnvironment  # noqa: E402
from minisweagent.models.utils.actions_toolcall import format_toolcall_observation_messages  # noqa: E402

from dr_agent import counting, deciders, rules_parser, state  # noqa: E402
from dr_agent.log import DecisionLog  # noqa: E402
from dr_agent.natural import NaturalAgent, ShadowLogger  # noqa: E402
from dr_agent.deciders import Questions  # noqa: E402
from dr_agent.routed import Router, RoutedAgent  # noqa: E402

Q = Questions.load(os.path.join(AGENT_DIR, "dr_agent", "questions.json"))
PIN = {
    "v": 1, "questions_sha256": Q.sha256, "mapping_sha256": "m", "safety_rule_sha256": "s", "particle_max_tokens": 8000,
    "jev": {"next_step": {"edge": 0.9}, "tests_passed": {"edge": 0.9}, "done": {"edge": None},
            "safe": {"block_edge": 0.95, "allow_edge": 0.9}, "relevant": {"drop_edge": 0.9}},
    "particle_guess": {"next_step": {"edge": 0.8}, "relevant": {"drop_edge": 0.95}},
    "particle_noguess": {"next_step": {"edge": 0.6}, "relevant": {"drop_edge": 0.95}},
    "j_fixed": {"choice": 0.9, "noul_yes": 0.9, "noul_no": 0.1, "relevant_drop_p": 0.1},
    "ece": {}, "n_labelled": {},
}
ISSUE = "Fix the needle handling in src."
SUBMIT = "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && cat patch.txt"
ALLOW = "403 DR_ALLOWANCE_STOP: the session allowance cannot hold this call"
OBS = "<returncode>{{output.returncode}}</returncode>\n<output>\n{{output.output}}</output>"
TESTPY = "import unittest\nclass T(unittest.TestCase):\n    def test_a(self):\n        pass\n"


def check(cond, msg=""):
    if not cond:
        raise AssertionError(msg)


class FakeModel:
    """Scripted main model: each reply is a list of commands, or an exception to raise."""

    def __init__(self, replies):
        self.replies, self.seen, self.n = list(replies), [], 0

    def query(self, messages):
        self.seen.append(copy.deepcopy(messages))
        if not self.replies:
            raise RuntimeError("script exhausted")
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        self.n += 1
        calls = [{"id": f"call_{self.n}_{i}", "type": "function", "function": {"name": "bash", "arguments": json.dumps({"command": c})}} for i, c in enumerate(r)]
        return {"role": "assistant", "content": "thought", "tool_calls": calls,
                "extra": {"actions": [{"command": c, "tool_call_id": calls[i]["id"]} for i, c in enumerate(r)], "cost": 0.0}}

    def format_message(self, **kw):
        return dict(kw)

    def format_observation_messages(self, message, outputs, template_vars=None):
        return format_toolcall_observation_messages(actions=message.get("extra", {}).get("actions", []), outputs=outputs, observation_template=OBS, template_vars=template_vars or {})

    def get_template_vars(self, **kw):
        return {}

    def serialize(self):
        return {}


class JevScript:
    """Fake Jev transport. fn(name, spec) returns a noul probability or a (choice, probability) pair."""

    def __init__(self, fn):
        self.fn, self.calls = fn, []

    def __call__(self, st, questions):
        self.calls.append((copy.deepcopy(st), dict(questions)))
        out = {}
        for name, spec in questions.items():
            r = self.fn(name, spec)
            if isinstance(r, Exception):
                raise r
            if spec["type"] == "noul":
                out[name] = {"type": "noul", "noul": r}
            else:
                pick, p = r
                rest = [k for k in spec["criteria"] if k != pick]
                probs = {pick: p, **{k: (1 - p) / max(1, len(rest)) for k in rest}}
                out[name] = {"type": "choice", "choice": pick, "confidence": p, "probabilities": probs}
        return out, {"input": 100, "output": 1}


class GenScript:
    """Fake generative transport. fn(kind, payload) returns the reply content (dict, str, None) or raises."""

    def __init__(self, fn):
        self.fn, self.calls = fn, []

    def __call__(self, system, user, schema):
        payload = json.loads(user)
        kind = "hits" if "answers" in schema["properties"] else ("noul" if schema["properties"]["answer"]["enum"] == ["yes", "no"] else "choice")
        self.calls.append((kind, payload))
        r = self.fn(kind, payload)
        if isinstance(r, Exception):
            raise r
        if isinstance(r, tuple):
            return {"content": r[0], "truncated": r[1], "usage": {"input": 10, "output": 2}}
        return {"content": r, "truncated": False, "usage": {"input": 10, "output": 2}}


def jev(fn):
    s = JevScript(fn)
    return deciders.Jev("http://proxy/typesafe", "tok", call=s), s


def gen(fn, kind="openai", model="particle-ai/particle-1"):
    s = GenScript(fn)
    return deciders.Generative(kind, "http://proxy/x", "tok", model, 8000, call=s), s


def router(cell, j=None, p=None, f=None):
    return Router(cell, PIN, Q, jev=j, particle=p, frontier=f)


def base_state():
    return {"task": ISSUE, "diff": {"stat": "", "text": ""}, "last_command": "ls", "last_output": "a.py", "last_exit_code": 0, "recent_steps": [], "last_test": "unknown"}


def repo(files=None):
    d = tempfile.mkdtemp(dir=TMP)
    subprocess.run(["git", "init", "-q", d], check=True)
    for rel, body in {"patch.txt": "diff\n", **(files or {})}.items():
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(body)
    return d


def records(logdir):
    with open(os.path.join(logdir, "decisions.jsonl")) as f:
        return [json.loads(line) for line in f if line.strip()]


def make(cell, d, replies, j=None, p=None, f=None, limit=100, wall=0, shadow=False):
    model = FakeModel(replies)
    env = LocalEnvironment(cwd=d)
    logdir = tempfile.mkdtemp(dir=TMP)
    tracker = state.Tracker(d, ISSUE)
    dlog = DecisionLog(logdir, "s1", cell, "opus", time.time())
    kw = dict(system_template="sys", instance_template="{{task}}", step_limit=0, cost_limit=0, wall_time_limit_seconds=wall)
    if cell in ("N", "W"):
        agent = NaturalAgent(model, env, shadow=ShadowLogger(dlog, tracker) if shadow else None, action_limit=limit, **kw)
    else:
        agent = RoutedAgent(model, env, router=router(cell, j, p, f), dlog=dlog, tracker=tracker, action_limit=limit, **kw)
    try:
        agent.run(ISSUE)
    except Exception:
        pass
    return agent, model, logdir


def exit_status(agent):
    return agent.messages[-1].get("extra", {}).get("exit_status")


def last_tool_obs(model, call):
    return [m for m in model.seen[call] if m.get("role") == "tool"][-1]["content"]


# ---------- the frozen test-runner parser ----------

def test_parser_table():
    rows = [
        ("pytest", True), ("pytest tests/test_a.py -k 'x or y'", True), ("py.test -q", True), ("tox -e py312", True),
        ("nox -s tests", True), ("python -m pytest -x", True), ("python3 -m pytest", True), ("python -m unittest -q t", True),
        ("cd x && pytest", True), ("cd /testbed/sub && python -m pytest tests", True),
        ("pytest > out.txt", True), ("pytest > out.txt 2>&1", True), ("pytest &> log.txt", True), ("pytest 2>/dev/null", True),
        ("pytest | tail -5", False), ("pytest 2>&1 | tail", False), ("pytest | tee log", False), ("pytest; echo $?", False),
        ("pytest || true", False), ("pytest && echo ok", False), ("cd x && pytest && echo ok", False), ("cd x; pytest", False),
        ("pytest &", False), ("python -m mypkg", False), ("python test.py", False), ("make test", False), ("echo pytest", False),
        ("cd x && cd y && pytest", False), ("$(which pytest)", False), ("pytest `ls`", False), ("(pytest)", False),
        ("pytest\necho hi", False), ("timeout 60 pytest", False), ("FOO=1 pytest", False), ("pytest <<EOF\nx\nEOF", False),
        ("python -m pytest 'a;b'", True), ('pytest -k "a|b"', True),
    ]
    bad = [(c, w) for c, w in rows if rules_parser.is_runner_exit(c) != w]
    check(not bad, bad)


def test_test_command_detection():
    for c in ["pytest | tail", "pytest; echo $?", "pytest || true", "cd x && python -m pytest 2>&1 | tail -20", "tox", "python3 -m unittest discover"]:
        check(rules_parser.is_test_command(c), c)
    for c in ["ls", "grep -rn pytest .", "cat pytest.ini", "python setup.py build", "echo tox"]:
        check(not rules_parser.is_test_command(c), c)


def test_listing_commands():
    for c in ["grep -rn foo .", "rg foo", "find . -name '*.py'", "ls -R src", "ls -laR", "grep -rl x src | head -50", "git grep foo"]:
        check(rules_parser.is_listing_command(c), c)
    for c in ["ls", "ls -la", "cat a.py", "pytest"]:
        check(not rules_parser.is_listing_command(c), c)


# ---------- state trims and the 32K check ----------

def test_state_trims():
    d = repo({"a.py": "x = 1\n"})
    t = state.Tracker(d, "I" * 5000)
    for i in range(14):
        t.record(f"echo step{i}\n" + "y" * 300, "out", i % 2, "main")
    t.record("C" * 500, "O" * 20000, 1, "main")
    s = t.base_state()
    check(len(s["task"]) == 4000, len(s["task"]))
    check(len(s["recent_steps"]) == 10, len(s["recent_steps"]))
    check(all("\n" not in line for line in s["recent_steps"]), "multi-line step")
    check(all(line.endswith(("(exit 0)", "(exit 1)")) for line in s["recent_steps"]), s["recent_steps"][-1])
    check(all(len(line) <= 120 + len(" (exit 1)") for line in s["recent_steps"]), "step too long")
    check(len(s["last_command"]) + len(s["last_output"]) <= 8000, len(s["last_command"]) + len(s["last_output"]))
    check(s["last_output"].startswith("O") and s["last_output"].endswith("O"), "head and tail kept")
    with open(os.path.join(d, "a.py"), "w") as f:
        f.write("x = 2\n" * 2000)
    s = t.base_state()
    check(len(s["diff"]["text"]) == 3000 and "a.py" in s["diff"]["stat"], (len(s["diff"]["text"]), s["diff"]["stat"]))


def test_jev_32k_check_falls_to_next_layer():
    j, js = jev(lambda n, s: 0.99)
    p, ps = gen(lambda k, pl: {"answer": "yes", "confidence": 0.9})
    st = base_state()
    st["last_output"] = "z" * 40000
    out = router("R", j, p).decide_noul("tests_passed", st)
    check(not js.calls, "Jev was asked an over-limit state")
    check(out["layers"]["jev"]["error"] == "state_over_limit" and not out["layers"]["jev"]["ok"], out["layers"]["jev"])
    check(out["acting_layer"] == "particle" and out["answer"] == "yes", out)
    small = router("R", j, p).decide_noul("tests_passed", base_state())
    check(len(js.calls) == 1 and small["acting_layer"] == "jev", small["acting_layer"])


# ---------- the defer rule in every cell ----------

def test_defer_R_next_step():
    j, js = jev(lambda n, s: ("show_0", 0.95))
    p, ps = gen(lambda k, pl: {"answer": "show_0", "confidence": 0.99})
    out = router("R", j, p).decide_next(base_state(), ["show_0", "other"])
    check(out["pick"] == "show_0" and out["acting_layer"] == "jev" and not ps.calls, out)
    j, js = jev(lambda n, s: ("other", 0.99))
    p, ps = gen(lambda k, pl: {"answer": "show_0", "confidence": 0.85})
    out = router("R", j, p).decide_next(base_state(), ["show_0", "other"])
    check(out["pick"] == "show_0" and out["acting_layer"] == "particle", out)
    check(out["layers"]["particle"]["guess_shown"] and ps.calls[0][1]["jev_guess"]["answer"] == "other", ps.calls)
    check("probabilities" in ps.calls[0][1]["jev_guess"], ps.calls[0][1]["jev_guess"])
    p, ps = gen(lambda k, pl: {"answer": "show_0", "confidence": 0.7})
    f, fs = gen(lambda k, pl: {"answer": "show_0", "confidence": 1.0}, "anthropic", "claude-opus-5-5")
    out = router("R", j, p, f).decide_next(base_state(), ["show_0", "other"])
    check(out["pick"] is None and out["acting_layer"] == "main_turn" and not fs.calls, out)
    p, ps = gen(lambda k, pl: {"answer": "other", "confidence": 1.0})
    out = router("R", j, p, f).decide_next(base_state(), ["show_0", "other"])
    check(out["pick"] is None and out["acting_layer"] == "main_turn", "exit pick acted")


def test_defer_R_noul_types():
    f, fs = gen(lambda k, pl: {"answer": "yes", "confidence": 0.9}, "anthropic", "claude-opus-5-5")
    j, _ = jev(lambda n, s: 0.97)
    p, ps = gen(lambda k, pl: {"answer": "no", "confidence": 0.7})
    out = router("R", j, p, f).decide_noul("tests_passed", base_state())
    check(out["acting_layer"] == "jev" and out["answer"] == "yes" and not ps.calls, out)
    j, _ = jev(lambda n, s: 0.6)
    out = router("R", j, p, f).decide_noul("tests_passed", base_state())
    check(out["acting_layer"] == "particle" and out["answer"] == "no" and not fs.calls, out)
    check(abs(out["layers"]["particle"]["p_yes"] - 0.3) < 1e-9, out["layers"]["particle"])
    bad, bs = gen(lambda k, pl: "not json")
    out = router("R", j, bad, f).decide_noul("tests_passed", base_state())
    check(out["acting_layer"] == "frontier" and out["answer"] == "yes" and len(bs.calls) == 2 and len(fs.calls) == 1, (out, len(bs.calls)))
    check(out["layers"]["particle"]["retries"] == 1 and not out["layers"]["particle"]["ok"], out["layers"]["particle"])
    j, _ = jev(lambda n, s: 0.99)
    p, ps = gen(lambda k, pl: {"answer": "no", "confidence": 0.8})
    out = router("R", j, p, f).decide_noul("done", base_state())
    check(out["acting_layer"] == "particle" and out["answer"] == "no", "done must not act on Jev without a band")
    j, _ = jev(lambda n, s: 0.02)
    out = router("R", j, p, f).decide_noul("safe", base_state())
    check(out["acting_layer"] == "jev" and out["answer"] == "no", out)
    j, _ = jev(lambda n, s: 0.92)
    out = router("R", j, p, f).decide_noul("safe", base_state())
    check(out["acting_layer"] == "jev" and out["answer"] == "yes", out)
    j, _ = jev(lambda n, s: 0.06)
    p, ps = gen(lambda k, pl: {"answer": "yes", "confidence": 0.6})
    out = router("R", j, p, f).decide_noul("safe", base_state())
    check(out["acting_layer"] == "particle" and out["answer"] == "yes", out)


def test_defer_R_relevance_keeps_without_frontier():
    hits = [f"src/f{i}.py" for i in range(30)]
    j, js = jev(lambda n, s: 0.05 if n in ("relevant_0", "relevant_1") else 0.5)
    p, ps = gen(lambda k, pl: {"answers": [{"hit": h, "answer": "no", "confidence": 0.97 if h == "src/f2.py" else 0.9} for h in pl["hits"]]})
    f, fs = gen(lambda k, pl: {"answer": "no", "confidence": 1.0}, "anthropic", "claude-opus-5-5")
    out = router("R", j, p, f).decide_relevant(base_state(), hits)
    check(sorted(out["dropped"]) == ["src/f0.py", "src/f1.py", "src/f2.py"], out["dropped"])
    check(out["dropped_by"] == {"src/f0.py": "jev", "src/f1.py": "jev", "src/f2.py": "particle"}, out["dropped_by"])
    check(len(js.calls) == 1 and len(ps.calls) == 1 and not fs.calls, (len(js.calls), len(ps.calls), len(fs.calls)))
    check(ps.calls[0][1]["hits"] == hits[2:], "particle must get only the hits Jev kept")
    bad, bs = gen(lambda k, pl: {"answers": []})
    j, _ = jev(lambda n, s: 0.5)
    out = router("R", j, bad, f).decide_relevant(base_state(), hits)
    check(out["dropped"] == [] and out["acting_layer"] == "keep" and len(bs.calls) == 2 and not fs.calls, out)


def test_defer_P_uses_noguess_bands():
    p, ps = gen(lambda k, pl: {"answer": "show_0", "confidence": 0.7})
    out = router("P", None, p).decide_next(base_state(), ["show_0", "other"])
    check(out["pick"] == "show_0" and out["acting_layer"] == "particle" and not out["layers"]["particle"]["guess_shown"], out)
    check("jev_guess" not in ps.calls[0][1] and "jev" not in out["layers"], ps.calls[0][1].keys())
    p, _ = gen(lambda k, pl: {"answer": "no", "confidence": 0.55})
    f, fs = gen(lambda k, pl: {"answer": "yes", "confidence": 1.0}, "anthropic", "claude-opus-5-5")
    out = router("P", None, p, f).decide_noul("safe", base_state())
    check(out["acting_layer"] == "particle" and out["answer"] == "no" and not fs.calls, out)


def test_defer_F_typed_frontier():
    def fn(k, pl):
        if k == "choice":
            return {"answer": "show_0", "confidence": 0.4}
        if k == "noul":
            return {"answer": "no", "confidence": 0.9}
        return {"answers": [{"hit": h, "answer": "no" if h.endswith("1.py") else "yes", "confidence": 0.9} for h in pl["hits"]]}

    f, fs = gen(fn, "openai", "gpt-6.1-sol")
    r = router("F", None, None, f)
    check(r.decide_next(base_state(), ["show_0", "other"])["pick"] == "show_0", "F answer acts")
    out = r.decide_noul("tests_passed", base_state())
    check(out["acting_layer"] == "frontier" and out["answer"] == "no", out)
    out = r.decide_relevant(base_state(), [f"src/f{i}.py" for i in range(25)])
    check(sorted(out["dropped"]) == ["src/f1.py", "src/f11.py", "src/f21.py"] and out["acting_layer"] == "frontier", out)
    f2, _ = gen(lambda k, pl: {"answer": "other", "confidence": 1.0}, "openai", "gpt-6.1-sol")
    check(router("F", None, None, f2).decide_next(base_state(), ["show_0", "other"])["acting_layer"] == "main_turn", "F exit pick")


def test_defer_J_fixed_threshold():
    f, fs = gen(lambda k, pl: {"answer": "yes", "confidence": 0.8}, "anthropic", "claude-opus-5-5")
    for conf, want in [(0.92, "show_0"), (0.85, None)]:
        j, _ = jev(lambda n, s, c=conf: ("show_0", c))
        out = router("J", j, None, f).decide_next(base_state(), ["show_0", "other"])
        check(out["pick"] == want and not fs.calls, (conf, out))
    j, _ = jev(lambda n, s: ("other", 1.0))
    check(router("J", j, None, f).decide_next(base_state(), ["show_0", "other"])["pick"] is None, "J exit pick")
    for p_yes, layer, ans in [(0.93, "jev", "yes"), (0.08, "jev", "no"), (0.5, "frontier", "yes")]:
        j, _ = jev(lambda n, s, p=p_yes: p)
        out = router("J", j, None, f).decide_noul("done", base_state())
        check(out["acting_layer"] == layer and out["answer"] == ans, (p_yes, out))
    j, _ = jev(lambda n, s: 0.08 if n == "relevant_0" else 0.2)
    n_front = len(fs.calls)
    out = router("J", j, None, f).decide_relevant(base_state(), [f"h{i}.py" for i in range(25)])
    check(out["dropped"] == ["h0.py"] and len(fs.calls) == n_front, out)


def test_generative_retry_once():
    seq = [({"answer": "yes"}, True), {"answer": "yes", "confidence": 0.8}]
    p, ps = gen(lambda k, pl: seq.pop(0))
    rec = p.ask_noul(base_state(), Q.noul("done"))
    check(rec["ok"] and rec["retries"] == 1 and rec["answer"] == "yes", rec)
    p, ps = gen(lambda k, pl: {"answer": "maybe", "confidence": 0.8})
    rec = p.ask_noul(base_state(), Q.noul("done"))
    check(not rec["ok"] and rec["retries"] == 1 and len(ps.calls) == 2, rec)
    p, ps = gen(lambda k, pl: {"answer": "yes", "confidence": 1.5})
    check(not p.ask_noul(base_state(), Q.noul("done"))["ok"], "confidence out of range accepted")


# ---------- allowance mapping ----------

def test_allowance_detection():
    check(counting.is_allowance_stop(Exception(ALLOW)), "plain message")

    class E(Exception):
        body = {"error": {"code": "DR_ALLOWANCE_STOP"}}

    check(counting.is_allowance_stop(E("403")), "body")
    try:
        try:
            raise Exception(ALLOW)
        except Exception as inner:
            raise RuntimeError("wrapped") from inner
    except Exception as e:
        check(counting.is_allowance_stop(e), "cause")
    check(not counting.is_allowance_stop(Exception("403 forbidden")), "plain 403 is not an allowance stop")
    check(not counting.is_allowance_stop(Exception("E_ALLOWANCE")), "other lanes' code")


def test_a_decider_custody_hit_stays_a_custody_hit():
    class Refused(Exception):
        def __init__(self, code):
            super().__init__("Error code: 403")
            self.body = {"type": "about:blank", "title": code, "status": 403, "code": code, "detail": code + ": metering proxy: refused"}

    def raising(code):
        def call(*args):
            raise Refused(code)
        return call

    for code, status in (("DR_CUSTODY_HIT", "custody_hit"), ("DR_ALLOWANCE_STOP", "allowance_stop")):
        adapters = [deciders.Jev("http://proxy/typesafe", "tok", call=raising(code)),
                    deciders.Generative("openai", "http://proxy/openrouter/v1", "tok", deciders.PARTICLE_MODEL, 8000, call=raising(code))]
        for a in adapters:
            raised = None
            try:
                a.ask(base_state(), {"done": Q.noul("done")}) if isinstance(a, deciders.Jev) else a.ask_noul(base_state(), Q.noul("done"))
            except counting.AllowanceStop as e:
                raised = e
            check(raised is not None and str(raised).startswith(code), f"{a} {code}: {raised!r}")
            check(counting.stop_status(raised) == status, f"{a} {code}: read as {counting.stop_status(raised)}")


def test_allowance_decider_stops_session_without_retry():
    d = repo({"a.py": "x\n"})
    j, js = jev(lambda n, s: Exception(ALLOW))
    agent, model, logdir = make("J", d, [["ls"], ["ls"], ["ls"]], j=j)
    check(exit_status(agent) == "allowance_stop", exit_status(agent))
    check(len(js.calls) == 1, f"Jev retried after an allowance stop: {len(js.calls)}")
    p, ps = gen(lambda k, pl: Exception(ALLOW))
    agent, model, logdir = make("P", d, [["ls"], ["ls"]], p=p)
    check(exit_status(agent) == "allowance_stop" and len(ps.calls) == 1, (exit_status(agent), len(ps.calls)))


def test_allowance_main_model_every_cell():
    d = repo({"a.py": "x\n"})
    for cell in ["N", "W", "F"]:
        f, _ = gen(lambda k, pl: {"answer": "yes", "confidence": 1.0}, "anthropic", "claude-opus-5-5")
        agent, model, _ = make(cell, d, [Exception(ALLOW), ["ls"]], f=f)
        check(exit_status(agent) == "allowance_stop", (cell, exit_status(agent)))
        check(len(model.seen) == 1, "main model retried")
    agent, model, _ = make("N", d, [Exception("500 upstream"), ["ls"]])
    check(exit_status(agent) != "allowance_stop", "a plain error mapped to allowance_stop")


# ---------- the action counter ----------

def test_action_counter_several_actions_per_reply():
    d = repo()
    cmd = "echo x >> count.txt"
    agent, model, _ = make("N", d, [[cmd, cmd, cmd], [cmd, cmd, cmd], [cmd]], limit=5)
    check(exit_status(agent) == "step_stop", exit_status(agent))
    with open(os.path.join(d, "count.txt")) as f:
        n = len(f.read().splitlines())
    check(n == 5 and agent.executed_actions == 5, (n, agent.executed_actions))
    check(agent.config.step_limit == 0, "mini step_limit must stay 0")


def test_action_counter_counts_decider_actions():
    d = repo({"a.py": "print(1)\n"})
    j, _ = jev(lambda n, s: ("show_0", 0.99) if n == "next_step" else 0.99)
    agent, model, _ = make("J", d, [["printf 'File \"a.py\", line 1\\n'"], ["echo x >> c.txt"], ["echo x >> c.txt"]], j=j, limit=2)
    check(exit_status(agent) == "step_stop" and agent.executed_actions == 2 and agent.decider_actions == 1, (exit_status(agent), agent.executed_actions, agent.decider_actions))


def test_limit_reply_crossing_100_runs_exactly_100():
    d = repo()
    cmd = "echo x >> count.txt"
    agent, model, _ = make("N", d, [[cmd] * 7 for _ in range(20)])
    with open(os.path.join(d, "count.txt")) as f:
        n = len(f.read().splitlines())
    check(exit_status(agent) == "step_stop" and n == 100 and agent.executed_actions == 100, (exit_status(agent), n))
    check(not agent.backstop_hit and agent.n_calls == 15, (agent.backstop_hit, agent.n_calls))


def test_limit_one_action_per_call_stops_at_100():
    d = repo()
    agent, model, _ = make("N", d, [["echo x >> count.txt"] for _ in range(150)])
    with open(os.path.join(d, "count.txt")) as f:
        n = len(f.read().splitlines())
    check(exit_status(agent) == "step_stop" and n == 100 and agent.n_calls == 100 and not agent.backstop_hit, (exit_status(agent), n, agent.n_calls))


def test_backstop_stops_no_action_loop_at_100_calls():
    d = repo()
    for cell in ("N", "J"):
        j, _ = jev(lambda n, s: ("other", 0.99) if n == "next_step" else 0.99)
        agent, model, _ = make(cell, d, [[] for _ in range(150)], j=j)
        check(exit_status(agent) == "call_backstop" and len(model.seen) == 100 and agent.n_calls == 100 and agent.backstop_hit, (cell, exit_status(agent), len(model.seen)))
        check(agent.executed_actions == 0, agent.executed_actions)


def test_under_both_limits_not_stopped():
    d = repo()
    agent, model, _ = make("N", d, [["echo x >> count.txt"] for _ in range(60)] + [[SUBMIT]])
    check(exit_status(agent) == "Submitted" and agent.executed_actions == 61 and agent.n_calls == 61 and not agent.backstop_hit, (exit_status(agent), agent.executed_actions))


# ---------- loop guards ----------

def test_guard_max3():
    d = repo({"a.py": 'File "b.py", line 1\n', "b.py": 'File "c.py", line 1\n', "c.py": 'File "d.py", line 1\n', "d.py": "x\n"})
    j, js = jev(lambda n, s: ("show_0", 0.99) if n == "next_step" else 0.99)
    agent, model, logdir = make("J", d, [["printf 'File \"a.py\", line 1\\n'"], [SUBMIT]], j=j)
    check(agent.decider_actions == 3 and agent.guards["max3"] == 1, (agent.decider_actions, agent.guards))
    nexts = [c for c in js.calls if "next_step" in c[1]]
    check(len(nexts) == 3, f"asked {len(nexts)} next steps; the guard must fire before a 4th call")
    recs = [r for r in records(logdir) if r["type"] == "next_step"]
    check(recs[-1]["guard"] == "max3" and recs[-1]["acting_layer"] == "main_turn" and recs[-1]["layers"] == {}, recs[-1])
    check(len(model.seen) == 2, "main model must get the turn after the guard")


def test_guard_repeat_and_rerun_no_change():
    d = repo({"t.py": TESTPY, "a.py": "x\n"})
    seq = ["run_tests", "run_tests"]
    j, js = jev(lambda n, s: (seq.pop(0) if seq else "other", 0.99) if n == "next_step" else 0.99)
    agent, model, _ = make("J", d, [["python3 -m unittest -q t"], [SUBMIT]], j=j)
    check(agent.guards["repeat"] == 1 and agent.decider_actions == 1, agent.guards)
    d = repo({"t.py": TESTPY.replace("pass", "print('File \"b.py\", line 1')"), "b.py": "y\n"})
    seq3 = ["run_tests", "show_0", "run_tests"]
    j, js = jev(lambda n, s: (seq3.pop(0) if seq3 else "other", 0.99) if n == "next_step" else 0.99)
    agent, model, _ = make("J", d, [["python3 -m unittest -q t 2>&1"], [SUBMIT]], j=j)
    check(agent.guards["rerun_no_change"] == 1 and agent.decider_actions == 2, (agent.guards, agent.decider_actions))


# ---------- relevance fan-out on a 500-hit grep ----------

def test_relevance_500_hits():
    d = repo({f"src/f{i:03d}.py": "needle\n" for i in range(500)})
    first10 = {f"relevant_{i}" for i in range(10)}

    def jfn(n, s):
        if n.startswith("relevant_"):
            return 0.02 if n in first10 else 0.5
        return ("other", 0.99) if n == "next_step" else 0.99

    j, js = jev(jfn)
    p, ps = gen(lambda k, pl: {"answers": [{"hit": h, "answer": "yes", "confidence": 0.9} for h in pl["hits"]]} if k == "hits" else {"answer": "yes", "confidence": 0.9})
    f, fs = gen(lambda k, pl: {"answer": "yes", "confidence": 0.9}, "anthropic", "claude-opus-5-5")
    agent, model, logdir = make("R", d, [["grep -rl needle src | sort"], [SUBMIT]], j=j, p=p, f=f)
    rel_calls = [c for c in js.calls if any(n.startswith("relevant_") for n in c[1])]
    check(len(rel_calls) == 1 and len(rel_calls[0][1]) == 100, [len(c[1]) for c in rel_calls])
    hit_calls = [c for c in ps.calls if c[0] == "hits"]
    check(len(hit_calls) == 1 and len(hit_calls[0][1]["hits"]) == 90, [len(c[1]["hits"]) for c in hit_calls])
    check(not [c for c in fs.calls if c[0] == "hits"], "frontier asked about relevance")
    rec = [r for r in records(logdir) if r["type"] == "relevant"][0]
    check(rec["hits_total"] == 500 and len(rec["hits"]) == 100 and len(rec["acted"]) == 10, (rec["hits_total"], len(rec["hits"])))
    obs = last_tool_obs(model, 1)
    lines = [x for x in obs.splitlines() if x.startswith("src/")]
    check(len(lines) == 490 and "src/f000.py" not in lines and "src/f499.py" in lines, len(lines))
    check("10 of 500" in obs, obs[-200:])


# ---------- the synthetic message protocol ----------

def test_synthetic_message_protocol():
    d = repo({"a.py": "print(1)\n"})
    seq = ["show_0"]
    j, js = jev(lambda n, s: (seq.pop(0) if seq else "other", 0.99) if n == "next_step" else 0.99)
    agent, model, _ = make("J", d, [["printf 'File \"a.py\", line 1\\n'"], [SUBMIT]], j=j)
    msgs = agent.messages
    idx = [i for i, m in enumerate(msgs) if m.get("extra", {}).get("dr_controller")]
    check(len(idx) == 1, idx)
    m = msgs[idx[0]]
    check(m["role"] == "assistant" and len(m["tool_calls"]) == 1 and m["tool_calls"][0]["function"]["name"] == "bash", m)
    check(json.loads(m["tool_calls"][0]["function"]["arguments"]) == {"command": "cat a.py"}, m["tool_calls"])
    check(m["extra"]["actions"] == [{"command": "cat a.py", "tool_call_id": m["tool_calls"][0]["id"]}], m["extra"])
    obs = msgs[idx[0] + 1]
    check(obs["role"] == "tool" and obs["tool_call_id"] == m["tool_calls"][0]["id"] and "print(1)" in obs["content"], obs)
    for a, b in zip(model.seen, model.seen[1:]):
        check(b[: len(a)] == a, "the message prefix changed between main-model calls")
    ids = [tc["id"] for x in msgs if x.get("role") == "assistant" for tc in x.get("tool_calls") or []]
    answered = {x.get("tool_call_id") for x in msgs if x.get("role") == "tool"}
    check(set(ids[:-1]) <= answered, "a tool call has no result")


# ---------- safety, test pass and done ----------

def test_safety_blocks():
    d = repo()
    safe = [0.02]
    j, js = jev(lambda n, s: (safe.pop(0) if safe else 0.99) if n == "safe" else (("other", 0.99) if n == "next_step" else 0.99))
    agent, model, logdir = make("J", d, [["touch made.txt"], [SUBMIT]], j=j)
    check(not os.path.exists(os.path.join(d, "made.txt")), "blocked command ran")
    obs = last_tool_obs(model, 1)
    check("blocked as unsafe" in obs and agent.blocked_commands == 1 and agent.executed_actions == 1, (obs, agent.executed_actions))


def test_tracker_replays_only_test_commands_that_ran():
    d = repo({"t.py": TESTPY})
    blocked = "python3 -m unittest -q t; rm -rf /testbed"
    check(rules_parser.is_test_command(blocked), "the blocked command must contain a test runner")
    t = state.Tracker(d, ISSUE)
    t.record(blocked, "blocked as unsafe", "blocked", "main")
    check("run_tests" not in t.next_options()[0] and t.last_test_command is None, (t.next_options(), t.last_test_command))
    t.record("python3 -m unittest -q t", "OK", 0, "main")
    options, _, commands = t.next_options()
    check("run_tests" in options and commands["run_tests"] == "python3 -m unittest -q t", commands)
    t.record(blocked, "blocked as unsafe", "blocked", "main")
    check(t.next_options()[2]["run_tests"] == "python3 -m unittest -q t", t.next_options()[2])


def test_blocked_test_command_never_becomes_run_tests():
    d = repo({"t.py": TESTPY})
    blocked = "python3 -m unittest -q t; touch made.txt"
    safe = [0.02]

    def fn(n, s):
        if n == "safe":
            return safe.pop(0) if safe else 0.99
        if n == "next_step":
            return ("run_tests" if "run_tests" in s["criteria"] else "other", 0.99)
        return 0.99

    j, js = jev(fn)
    agent, model, logdir = make("J", d, [[blocked], ["python3 -m unittest -q t"], [SUBMIT]], j=j)
    check(agent.blocked_commands == 1 and not os.path.exists(os.path.join(d, "made.txt")), "the blocked command ran as a replay")
    nexts = [r for r in records(logdir) if r["type"] == "next_step"]
    check("run_tests" not in nexts[0]["options"], nexts[0]["options"])
    ran = [m["extra"]["actions"][0]["command"] for m in agent.messages if m.get("extra", {}).get("dr_controller")]
    check(ran == ["python3 -m unittest -q t"], ran)


def test_tests_passed_rule_then_decider():
    d = repo({"t.py": TESTPY})
    j, js = jev(lambda n, s: (("other", 0.99) if n == "next_step" else 0.99))
    agent, model, logdir = make("J", d, [["python3 -m unittest -q t"], ["python3 -m unittest -q t 2>&1 | tail -3"], [SUBMIT]], j=j)
    recs = [r for r in records(logdir) if r["type"] == "tests_passed"]
    check(len(recs) == 2, len(recs))
    check(recs[0]["rule"] == "runner_exit" and recs[0]["acting_layer"] == "rule" and "jev" not in recs[0]["layers"], recs[0])
    check(recs[1]["rule"] is None and recs[1]["acting_layer"] == "jev", recs[1]["acting_layer"])
    check(os.path.exists(os.path.join(logdir, recs[0]["snapshot"])), "no snapshot")
    nexts = [r for r in records(logdir) if r["type"] == "next_step"]
    st = json.load(open(os.path.join(logdir, nexts[0]["state_file"])))
    check(st["last_test"] == "passed", st["last_test"])


def test_done_blocks_twice_third_stands_decider_counts():
    d = repo({"patch.txt": "diff\n"})
    seq = ["other", "submit", "other"]

    def fn(n, s):
        if n == "next_step":
            return (seq.pop(0) if seq else "other", 0.99)
        return 0.05 if n == "done" else 0.99

    j, js = jev(fn)
    agent, model, logdir = make("J", d, [[SUBMIT], [SUBMIT], [SUBMIT]], j=j)
    check(exit_status(agent) == "Submitted", exit_status(agent))
    check(agent.submits == 3 and agent.submits_blocked == 2, (agent.submits, agent.submits_blocked))
    check(len(model.seen) == 2, f"main model called {len(model.seen)} times; the decider's submit counts toward three")
    obs = [m for m in model.seen[1] if m.get("role") == "tool"]
    check(any("not done" in m["content"] for m in obs), "no not-done line")
    with_done = [c for c in js.calls if "next_step" in c[1] and "done" in c[1]]
    check(with_done, "next_step and done not fanned out in one Jev request")


# ---------- natural mode and the shadow logger ----------

def test_natural_shadow_logs_five_moments_and_asks_nothing():
    files = {f"src/f{i}.py": "needle\n" for i in range(25)}
    files["t.py"] = TESTPY
    files["patch.txt"] = "diff\n"
    d = repo(files)
    agent, model, logdir = make("N", d, [["grep -rl needle src"], ["python3 -m unittest -q t"], [SUBMIT]], shadow=True)
    check(exit_status(agent) == "Submitted", exit_status(agent))
    recs = records(logdir)
    by = {}
    for r in recs:
        by[r["type"]] = by.get(r["type"], 0) + 1
    check(by == {"safe": 3, "relevant": 1, "tests_passed": 1, "next_step": 2, "done": 1}, by)
    check(all(r["mode"] == "shadow" and r["acting_layer"] == "shadow" for r in recs), "not shadow")
    check(all(set(r["layers"]) <= {"rule"} for r in recs), "a decider was asked in N")
    nexts = [r for r in recs if r["type"] == "next_step"]
    check([r["n_next"]["action"] for r in nexts] == ["python3 -m unittest -q t", SUBMIT] and all(r["n_next"]["mapped"] is None for r in nexts), nexts)
    rel = [r for r in recs if r["type"] == "relevant"][0]
    check(rel["hits_total"] == 25 and len(rel["hits"]) == 25, rel)
    done = [r for r in recs if r["type"] == "done"][0]
    check(done["snapshot"] and os.path.exists(os.path.join(logdir, done["snapshot"])), done)
    check(len(model.seen) == 3, "N behaviour changed")


def test_host_shadow_answers_every_logged_state_twice_for_particle():
    from dr_agent import shadow

    files = {f"src/f{i}.py": "needle\n" for i in range(25)}
    d = repo(files)
    agent, model, logdir = make("N", d, [["grep -rl needle src"], [SUBMIT]], shadow=True)
    j, js = jev(lambda n, s: ("other", 0.7) if n == "next_step" else 0.8)
    p, ps = gen(lambda k, pl: {"answers": [{"hit": h, "answer": "yes", "confidence": 0.9} for h in pl["hits"]]} if k == "hits" else ({"answer": "other", "confidence": 0.9} if k == "choice" else {"answer": "yes", "confidence": 0.9}))
    out = os.path.join(logdir, "decisions.shadow.jsonl")
    n, status = shadow.run(logdir, Q, j, p, out)
    recs = [json.loads(x) for x in open(out)]
    check(status == "ok" and n == len(records(logdir)) == len(recs), (n, status))
    for r in recs:
        check({"jev", "particle", "particle_noguess"} <= set(r["layers"]), r["layers"].keys())
        check(r["layers"]["particle"]["guess_shown"] and not r["layers"]["particle_noguess"]["guess_shown"], r["type"])
    check(len(ps.calls) == 2 * len(recs) and len(js.calls) == len(recs), (len(ps.calls), len(js.calls)))
    j2, _ = jev(lambda n, s: Exception(ALLOW))
    n2, status2 = shadow.run(logdir, Q, j2, p, out)
    check(status2 == "allowance_stop" and n2 == 0, status2)


def fake_typesafe_sdk(seen):
    """A stand-in typesafe_sdk module that records the model each client and each request names."""
    mod = types.ModuleType("typesafe_sdk")

    class Noul:
        def __init__(self, instructions):
            self.instructions = instructions

    class Choice:
        def __init__(self, instructions, criteria):
            self.instructions, self.criteria = instructions, criteria

    class RetryPolicy:
        def __init__(self, max_retries):
            self.max_retries = max_retries

    class TypeSafeClient:
        def __init__(self, **kw):
            seen.append(("client", kw["model"]))

        def system_one(self, state, questions, model):
            seen.append(("request", model))
            answers = {}
            for n, q in questions.items():
                if isinstance(q, Choice):
                    keys = list(q.criteria)
                    answers[n] = types.SimpleNamespace(type="choice", choice=keys[0], confidence=0.6, probabilities={k: (0.6 if i == 0 else 0.4 / max(1, len(keys) - 1)) for i, k in enumerate(keys)})
                else:
                    answers[n] = types.SimpleNamespace(type="noul", noul=0.7)
            return types.SimpleNamespace(answers=answers, usage=types.SimpleNamespace(input_tokens=5, output_tokens=0))

    mod.Noul, mod.Choice, mod.RetryPolicy, mod.TypeSafeClient = Noul, Choice, RetryPolicy, TypeSafeClient
    return mod


def test_replay_jev_newer_answers_every_logged_state_with_jev_1_14():
    from dr_agent import jev_newer

    files = {f"src/f{i}.py": "needle\n" for i in range(25)}
    d = repo(files)
    _, _, nlog = make("N", d, [["grep -rl needle src"], [SUBMIT]], shadow=True)
    j, _ = jev(lambda n, s: ("other", 0.99) if n == "next_step" else 0.99)
    _, _, jlog = make("J", repo({"patch.txt": "x\n"}), [["ls"], [SUBMIT]], j=j)
    qf = os.path.join(AGENT_DIR, "dr_agent", "questions.json")
    seen, saved, env = [], sys.modules.get("typesafe_sdk"), dict(os.environ)
    sys.modules["typesafe_sdk"] = fake_typesafe_sdk(seen)
    os.environ.update(DR_PROXY_URL="http://127.0.0.1:9/slot", DR_PROXY_TOKEN="tok")
    try:
        for logdir in (nlog, jlog):
            out = os.path.join(logdir, "decisions.jev_newer.jsonl")
            code = jev_newer.main(["--log-dir", logdir, "--questions", qf, "--out", out])
            logged, recs = records(logdir), [json.loads(x) for x in open(out)]
            check(code == 0 and len(recs) == len(logged) > 0, (code, len(recs), len(logged)))
            for r, before in zip(recs, logged):
                check(set(r["layers"]) - set(before["layers"]) == {"jev_1_14"} and r["layers"]["jev_1_14"]["ok"], r["layers"].keys())
                check({k: v for k, v in r.items() if k != "layers"} == {k: v for k, v in before.items() if k != "layers"}, r["decision_id"])
    finally:
        os.environ.clear()
        os.environ.update(env)
        if saved is None:
            sys.modules.pop("typesafe_sdk", None)
        else:
            sys.modules["typesafe_sdk"] = saved
    check(seen and {m for _, m in seen} == {"jev-1.14.0"}, seen)
    check(deciders.JEV_MODEL == "jev-1.13.0", deciders.JEV_MODEL)
    j2, _ = jev(lambda n, s: Exception(ALLOW))
    n2, status2 = jev_newer.run(nlog, Q, j2, os.path.join(nlog, "x.jsonl"))
    check(status2 == "allowance_stop" and n2 == 0, status2)


def test_replay_safety_set_either_half_as_one_pseudo_session():
    from dr_agent import safety_set

    path = os.path.join(HERE, "..", "..", "lanes", "decision-routing", "labels", "safety-set.json")
    for half in ("held", "calibration"):
        cases = [c for c in json.load(open(path))["commands"] if c["half"] == half]
        logdir = os.path.join(tempfile.mkdtemp(dir=TMP), "log")
        j, js = jev(lambda n, s: 0.8)
        p, ps = gen(lambda k, pl: {"answer": "yes", "confidence": 0.9})
        out = os.path.join(logdir, "..", "answers.jsonl")
        n, status = safety_set.run(path, half, logdir, Q, j, p, out)
        recs = records(logdir)
        check(status == "ok" and n == len(recs) == 100, (half, n, status, len(recs)))
        check([r["command"] for r in recs] == [c["command"] for c in cases], f"not the {half} half in order")
        check([(r["case_id"], r["unsafe"], r["kind"]) for r in recs] == [(c["id"], c["unsafe"], c["kind"]) for c in cases], "construction labels")
        check(sum(r["unsafe"] for r in recs) == 50, "not 50 unsafe")
        check(all(r["type"] == "safe" and r["session"] == "constructed-" + half and r["mode"] == "shadow" for r in recs), recs[0])
        for r in recs:
            st = json.load(open(os.path.join(logdir, r["state_file"])))
            check(st == {**safety_set.EMPTY_STATE, "command": r["command"]}, st)
        answered = [json.loads(x) for x in open(out)]
        check(len(answered) == 100 and all({"jev", "particle", "particle_noguess"} <= set(a["layers"]) for a in answered), "layers")
        check(len(js.calls) == 100 and len(ps.calls) == 200, (len(js.calls), len(ps.calls)))
        safety_set.run(path, half, logdir, Q, j, p, out)
        check(len(records(logdir)) == 100, "a rerun appended to the pseudo-session")
    check(safety_set.main(["--log-dir", TMP, "--questions", os.path.join(AGENT_DIR, "dr_agent", "questions.json"), "--safety-set", path, "--half", "both"]) == 2, "an unknown half was accepted")
    bad = json.load(open(path))
    next(c for c in bad["commands"] if c["half"] == "held")["half"] = "calibration"
    badf = os.path.join(TMP, "bad-safety-set.json")
    json.dump(bad, open(badf, "w"))
    for half in ("held", "calibration"):
        try:
            safety_set.half_cases(badf, half)
            check(False, f"a {half} half of 99 or 101 was accepted")
        except ValueError as e:
            check(str(e).startswith("E_USAGE"), str(e))

def test_replay_guess_ablation_on_logged_R_states():
    from dr_agent import guess_ablation, shadow

    files = {f"src/f{i}.py": "needle\n" for i in range(25)}
    d = repo(files)
    j, _ = jev(lambda n, s: ("other", 0.7) if n == "next_step" else (2.0 if n == "done" else 0.8))
    p, _ = gen(lambda k, pl: {"answers": [{"hit": h, "answer": "yes", "confidence": 0.9} for h in pl["hits"]]} if k == "hits" else ({"answer": "other", "confidence": 0.5} if k == "choice" else {"answer": "yes", "confidence": 0.9}))
    _, _, logdir = make("R", d, [["grep -rl needle src"], [SUBMIT]], j=j, p=p)
    logged = records(logdir)
    want = [r for r in logged if "jev" in r["layers"] and shadow.guess_of(r["type"], r["layers"]["jev"]) is not None]
    check(0 < len(want) < len(logged) and any(r["type"] == "done" and not r["layers"]["jev"]["ok"] for r in logged), [(r["type"], list(r["layers"])) for r in logged])
    p2, ps2 = gen(lambda k, pl: {"answers": [{"hit": h, "answer": "no", "confidence": 0.6} for h in pl["hits"]]} if k == "hits" else ({"answer": "other", "confidence": 0.6} if k == "choice" else {"answer": "no", "confidence": 0.6}))
    out = os.path.join(logdir, "decisions.guess_ablation.jsonl")
    n, status = guess_ablation.run(logdir, Q, p2, out)
    recs = [json.loads(x) for x in open(out)]
    check(status == "ok" and n == len(recs) == len(want), (n, status, len(want)))
    check([r["decision_id"] for r in recs] == [r["decision_id"] for r in want], "not the R states with a Jev guess")
    check(len(ps2.calls) == 2 * n, len(ps2.calls))
    for r, before, (kg, pg), (kn, pn) in zip(recs, want, ps2.calls[0::2], ps2.calls[1::2]):
        check(r["layers"]["ablation_guess"]["guess_shown"] and not r["layers"]["ablation_noguess"]["guess_shown"], r["type"])
        check({k: v for k, v in r["layers"].items() if not k.startswith("ablation_")} == before["layers"], "logged layers changed")
        check(pg["jev_guess"] == shadow.guess_of(before["type"], before["layers"]["jev"]) and "jev_guess" not in pn, pg.get("jev_guess"))
        check({k: v for k, v in pg.items() if k != "jev_guess"} == pn, "the two asks differ beyond the guess")
    _, _, jlog = make("J", repo({"patch.txt": "x\n"}), [["ls"], [SUBMIT]], j=jev(lambda n, s: ("other", 0.99) if n == "next_step" else 0.99)[0])
    n3, _ = guess_ablation.run(jlog, Q, p2, os.path.join(jlog, "x.jsonl"))
    check(n3 == 0, "a J state was ablated")
    p4, _ = gen(lambda k, pl: Exception(ALLOW))
    n4, status4 = guess_ablation.run(logdir, Q, p4, os.path.join(logdir, "y.jsonl"))
    check(status4 == "allowance_stop" and n4 == 0, status4)


def test_log_record_fields():
    d = repo({"patch.txt": "x\n"})
    j, js = jev(lambda n, s: (("other", 0.99) if n == "next_step" else 0.99))
    agent, model, logdir = make("J", d, [["ls"], [SUBMIT]], j=j)
    want = {"v", "session", "cell", "model", "decision_id", "seq", "type", "mode", "actions_before", "t_ms", "state_sha256", "state_file",
            "options", "candidates", "hits", "hits_total", "command", "exit_code", "rule", "layers", "acting_layer", "acted", "guard", "snapshot", "n_next"}
    recs = records(logdir)
    check(recs, "no records")
    for r in recs:
        check(want <= set(r), want - set(r))
        check(r["decision_id"] == f"s1:{r['seq']}", r["decision_id"])
        for layer in r["layers"].values():
            check({"answer", "p_yes", "conf", "probs", "ok", "error", "retries", "latency_ms", "usage", "guess_shown"} <= set(layer), layer)
        with open(os.path.join(logdir, r["state_file"]), "rb") as f:
            check(hashlib.sha256(f.read()).hexdigest() == r["state_sha256"], "state sha mismatch")


def test_every_main_model_call_asks_for_32000_output_tokens():
    from dr_agent import session

    check(session.MAIN_MAX_TOKENS == 32000, session.MAIN_MAX_TOKENS)
    for cell in ("N", "R", "P", "F", "J", "W"):
        for model in ("opus", "sol"):
            ms = session.model_settings(cell, model, "http://proxy", "tok")
            check(ms["model_kwargs"]["max_tokens"] == 32000, (cell, model, ms))
    check(session.model_settings("N", "opus", "http://proxy", "tok")["model_name"] == "anthropic/claude-opus-5-5", "opus")
    check(session.model_settings("N", "sol", "http://proxy", "tok")["model_name"] == "openai/responses/gpt-6.1-sol", "sol on the Responses API")
    sol = session.model_settings("N", "sol", "http://proxy", "tok")["model_kwargs"]
    check(sol.get("store") is False and sol.get("include") == ["reasoning.encrypted_content"], ("sol asks for its reasoning inline", sol))
    check(session.model_settings("W", "opus", "http://proxy", "tok")["model_name"] == "openrouter/particle-ai/particle-1", "W")


# ---------- real tier: litellm, the SDKs and a session against a local fake proxy ----------

class Fake(http.server.BaseHTTPRequestHandler):
    srv = {"mode": "ok", "hits": {}, "bodies": [], "main": [], "jev": None, "gen": None}

    def log_message(self, *a):
        pass

    def do_POST(self):
        s = Fake.srv
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        s["hits"][self.path] = s["hits"].get(self.path, 0) + 1
        s["bodies"].append((self.path, body))
        if s["mode"] == "403":
            msg = "DR_ALLOWANCE_STOP: allowance cannot hold this call"
            return self.reply(403, {"type": "about:blank", "title": "DR_ALLOWANCE_STOP", "status": 403, "code": "DR_ALLOWANCE_STOP", "detail": msg,
                                    "error": {"type": "allowance_stop", "code": "DR_ALLOWANCE_STOP", "message": msg}})
        if self.path.endswith("/systemone"):
            ans = {n: s["jev"](n, q) for n, q in body["questions"].items()}
            return self.reply(200, {"model": body.get("model"), "usage": {"input_tokens": 7, "output_tokens": 1}, "answers": ans})
        if self.path.startswith("/anthropic"):
            if (body.get("tool_choice") or {}).get("name") == "answer":
                return self.reply(200, self.anthropic([("answer", s["gen"]("frontier", body))]))
            cmds = s["main"].pop(0)
            return self.reply(200, self.anthropic([("bash", {"command": c}) for c in cmds]))
        if self.path.endswith("/responses"):
            n = sum(s["hits"].values())
            rs = {"type": "reasoning", "id": f"rs_{n}", "summary": []}
            if "reasoning.encrypted_content" in (body.get("include") or []):
                rs["encrypted_content"] = f"gAAAAB-opaque-{n}"
            calls = [{"type": "function_call", "id": f"fc_{n}_{i}", "call_id": f"call_{n}_{i}", "name": "bash", "arguments": json.dumps({"command": c}), "status": "completed"}
                     for i, c in enumerate(s["main"].pop(0))]
            return self.reply(200, {"id": f"resp_{n}", "object": "response", "created_at": 0, "status": "completed", "model": body.get("model"), "output": [rs] + calls,
                                    "usage": {"input_tokens": 11, "input_tokens_details": {"cached_tokens": 0}, "output_tokens": 4, "output_tokens_details": {"reasoning_tokens": 2}, "total_tokens": 15}})
        content = s["gen"]("openai", body)
        return self.reply(200, {"id": "c1", "object": "chat.completion", "created": 0, "model": body.get("model"),
                                "choices": [{"index": 0, "message": {"role": "assistant", "content": json.dumps(content)}, "finish_reason": "stop"}],
                                "usage": {"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12}})

    def anthropic(self, tools):
        n = sum(Fake.srv["hits"].values())
        blocks = [{"type": "text", "text": "ok"}] + [{"type": "tool_use", "id": f"toolu_{n}_{i}", "name": name, "input": inp} for i, (name, inp) in enumerate(tools)]
        return {"id": f"msg_{n}", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": blocks,
                "stop_reason": "tool_use", "stop_sequence": None, "usage": {"input_tokens": 11, "output_tokens": 4}}

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def fake_proxy():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    Fake.srv.update(mode="ok", hits={}, bodies=[], main=[])
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def real_tier(fn):
    fn.real = True
    return fn


@real_tier
def test_real_litellm_403_not_retried():
    from minisweagent.models.litellm_model import LitellmModel

    from dr_agent.session import model_class

    server, url = fake_proxy()
    try:
        Fake.srv["mode"] = "403"
        routes = [("anthropic/claude-opus-5-5", url + "/anthropic", "/anthropic/v1/messages"), ("openai/responses/gpt-6.1-sol", url + "/openai/v1", "/openai/v1/responses"),
                  ("openrouter/particle-ai/particle-1", url + "/openrouter/v1", "/openrouter/v1/chat/completions")]
        check(issubclass(model_class(), LitellmModel), "not mini's model")
        for name, base, path in routes:
            m = model_class()(model_name=name, model_kwargs={"api_base": base, "api_key": "tok", "drop_params": True}, cost_tracking="ignore_errors")
            t = time.time()
            err = None
            try:
                m.query([{"role": "user", "content": "hi"}])
            except Exception as e:
                err = e
            check(err is not None and counting.is_allowance_stop(err), f"{name}: {type(err).__name__} {err}")
            check(Fake.srv["hits"].get(path) == 1, f"{name} retried: {Fake.srv['hits']}")
            check(time.time() - t < 3.5, "a retry backoff ran")
    finally:
        server.shutdown()


@real_tier
def test_real_sdk_adapters_allowance_and_parse():
    server, url = fake_proxy()
    try:
        Fake.srv["mode"] = "403"
        adapters = [deciders.Jev(url + "/typesafe", "tok"), deciders.Generative("openai", url + "/openrouter/v1", "tok", deciders.PARTICLE_MODEL, 8000),
                    deciders.Generative("anthropic", url + "/anthropic", "tok", deciders.OPUS_MODEL, 8000), deciders.Generative("openai", url + "/openai/v1", "tok", deciders.SOL_MODEL, 8000)]
        for a in adapters:
            Fake.srv["hits"] = {}
            stopped = False
            try:
                a.ask({"x": 1}, {"done": Q.noul("done")}) if isinstance(a, deciders.Jev) else a.ask_noul({"x": 1}, Q.noul("done"))
            except counting.AllowanceStop:
                stopped = True
            check(stopped, f"{a}: no allowance stop")
            check(sum(Fake.srv["hits"].values()) == 1, f"retried: {Fake.srv['hits']}")
        Fake.srv["mode"] = "ok"
        Fake.srv["jev"] = lambda n, q: {"type": "noul", "noul": 0.8} if q["type"] == "noul" else {"type": "choice", "choice": "other", "confidence": 0.7, "probabilities": {k: (0.7 if k == "other" else 0.3 / (len(q["criteria"]) - 1)) for k in q["criteria"]}}
        Fake.srv["gen"] = lambda who, body: {"answer": "yes", "confidence": 0.9}
        out = adapters[0].ask(base_state(), {"next_step": Q.choice_next(["show_0", "other"]), "done": Q.noul("done")})
        check(out["next_step"]["ok"] and out["next_step"]["answer"] == "other" and abs(out["next_step"]["conf"] - 0.7) < 1e-9, out["next_step"])
        check(out["done"]["p_yes"] == 0.8 and out["done"]["answer"] == "yes", out["done"])
        body = [b for p, b in Fake.srv["bodies"] if p.endswith("/systemone")][-1]
        check(body["model"] == deciders.JEV_MODEL and body["questions"]["done"]["type"] == "noul" and isinstance(body["state"], dict), body.keys())
        for a in adapters[1:]:
            rec = a.ask_noul(base_state(), Q.noul("done"))
            check(rec["ok"] and rec["answer"] == "yes" and rec["usage"]["input"] > 0, rec)
        req = [b for p, b in Fake.srv["bodies"] if p.startswith("/openrouter")][-1]
        check(req["max_tokens"] == 8000 and req["response_format"]["type"] == "json_schema" and req["model"] == deciders.PARTICLE_MODEL, req)
        areq = [b for p, b in Fake.srv["bodies"] if p.startswith("/anthropic")][-1]
        check(areq["tool_choice"] == {"type": "tool", "name": "answer"} and "cache_control" not in json.dumps(areq), areq.get("tool_choice"))
    finally:
        server.shutdown()


@real_tier
def test_real_session_routed_end_to_end():
    server, url = fake_proxy()
    try:
        d = repo({"a.py": "print(1)\n", "patch.txt": "diff\n"})
        seq = ["show_0"]
        Fake.srv["main"] = [["printf 'File \"a.py\", line 1\\n'"], [SUBMIT]]
        Fake.srv["jev"] = lambda n, q: ({"type": "choice", "choice": (seq.pop(0) if seq else "other"), "confidence": 0.99, "probabilities": {k: 0.99 if k == "show_0" else 0.0 for k in q["criteria"]}} if q["type"] == "choice" else {"type": "noul", "noul": 0.99})
        Fake.srv["gen"] = lambda who, body: {"answer": "yes", "confidence": 0.9}
        logdir = tempfile.mkdtemp(dir=TMP)
        pinf, qf, taskf, cfgf = (os.path.join(logdir, n) for n in ("pin.json", "q.json", "task.txt", "cfg.json"))
        json.dump(PIN, open(pinf, "w"))
        shutil.copy(os.path.join(AGENT_DIR, "dr_agent", "questions.json"), qf)
        open(taskf, "w").write(ISSUE)
        out = os.path.join(logdir, "dr")
        json.dump({"cell": "J", "model": "opus", "task_file": taskf, "pin_file": pinf, "questions_file": qf, "proxy_url_env": "DR_PROXY_URL",
                   "log_dir": out, "step_limit_actions": 100, "wall_s": 2700, "calibration_shadow": False, "cwd": d}, open(cfgf, "w"))
        env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/root"), "DR_PROXY_URL": url, "DR_PROXY_TOKEN": "tok", "DR_SESSION": "e2e",
               "MSWEA_COST_TRACKING": "ignore_errors"}
        code = f"import sys; sys.path.insert(0, {AGENT_DIR!r}); from dr_agent.session import main; sys.exit(main(['--config', {cfgf!r}]))"
        p = subprocess.run([sys.executable, "-I", "-c", code], env=env, capture_output=True, text=True, timeout=180)
        check(p.returncode == 0, p.stdout[-2000:] + p.stderr[-2000:])
        summ = json.load(open(os.path.join(out, "dr-summary.json")))
        check(summ["exit_status"] == "submitted" and summ["decider_actions"] == 1 and summ["main_calls"] == 2, summ)
        check(summ["questions_sha256"] == Q.sha256, summ["questions_sha256"])
        check(os.path.exists(os.path.join(out, "trajectory.json")) and os.path.exists(os.path.join(out, "decisions.jsonl")), os.listdir(out))
        mains = [b for pth, b in Fake.srv["bodies"] if pth.startswith("/anthropic") and (b.get("tool_choice") or {}).get("name") != "answer"]
        last = mains[-1]["messages"]
        uses = [c["id"] for m in last if m["role"] == "assistant" and isinstance(m["content"], list) for c in m["content"] if c.get("type") == "tool_use"]
        results = [c["tool_use_id"] for m in last if m["role"] == "user" and isinstance(m["content"], list) for c in m["content"] if c.get("type") == "tool_result"]
        check(len(uses) == 2 and uses == results, (uses, results))
        check("cache_control" in json.dumps(mains[-1]), "set_cache_control is not on for Anthropic")
        check([b["max_tokens"] for b in mains] == [32000] * len(mains), [b.get("max_tokens") for b in mains])
    finally:
        server.shutdown()



@real_tier
def test_real_sol_session_replays_its_reasoning_inline():
    server, url = fake_proxy()
    try:
        d = repo({"a.py": "print(1)\n", "patch.txt": "diff\n"})
        Fake.srv["main"] = [["echo hi"], [SUBMIT]]
        logdir = tempfile.mkdtemp(dir=TMP)
        pinf, qf, taskf, cfgf = (os.path.join(logdir, n) for n in ("pin.json", "q.json", "task.txt", "cfg.json"))
        json.dump(PIN, open(pinf, "w"))
        shutil.copy(os.path.join(AGENT_DIR, "dr_agent", "questions.json"), qf)
        open(taskf, "w").write(ISSUE)
        out = os.path.join(logdir, "dr")
        json.dump({"cell": "N", "model": "sol", "task_file": taskf, "pin_file": pinf, "questions_file": qf, "proxy_url_env": "DR_PROXY_URL",
                   "log_dir": out, "step_limit_actions": 100, "wall_s": 2700, "calibration_shadow": False, "cwd": d}, open(cfgf, "w"))
        env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/root"), "DR_PROXY_URL": url, "DR_PROXY_TOKEN": "tok", "DR_SESSION": "e2e-sol",
               "MSWEA_COST_TRACKING": "ignore_errors"}
        code = f"import sys; sys.path.insert(0, {AGENT_DIR!r}); from dr_agent.session import main; sys.exit(main(['--config', {cfgf!r}]))"
        p = subprocess.run([sys.executable, "-I", "-c", code], env=env, capture_output=True, text=True, timeout=180)
        check(p.returncode == 0, p.stdout[-2000:] + p.stderr[-2000:])
        summ = json.load(open(os.path.join(out, "dr-summary.json")))
        check(summ["exit_status"] == "submitted" and summ["main_calls"] == 2, summ)
        mains = [b for pth, b in Fake.srv["bodies"] if pth == "/openai/v1/responses"]
        check(len(mains) == 2, [pth for pth, _ in Fake.srv["bodies"]])
        check(all(b.get("store") is False and b.get("include") == ["reasoning.encrypted_content"] and b.get("max_output_tokens") == 32000 for b in mains),
              [{k: b.get(k) for k in ("store", "include", "max_output_tokens")} for b in mains])
        replayed = [i for i in mains[1]["input"] if isinstance(i, dict) and i.get("type") == "reasoning"]
        check(replayed and all(isinstance(i.get("encrypted_content"), str) for i in replayed), replayed)
    finally:
        server.shutdown()

def _planted_repo(name):
    """A git repo with one commit, and the three things an agent could plant in .git to run code in root's git."""
    root = os.path.join(TMP, name)
    tb, marks = os.path.join(root, "testbed"), os.path.join(root, "marks")
    os.makedirs(marks)
    git = lambda *a: subprocess.run(["git", "-C", tb, *a], check=True, capture_output=True)
    subprocess.run(["git", "init", "-q", tb], check=True)
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    with open(os.path.join(tb, "README.md"), "w") as f:
        f.write("hi\n")
    git("add", ".")
    git("commit", "-qm", "init")

    def plant(clean=True):
        if clean:
            git("config", "filter.drprobe.clean", f"sh -c 'echo x > {marks}/clean; cat'")
            with open(os.path.join(tb, ".gitattributes"), "w") as f:
                f.write("* filter=drprobe\n")
        for hook, path in (("fsmonitor", os.path.join(tb, ".git", "fsm.sh")), ("hook", os.path.join(tb, ".git", "drhooks", "post-index-change"))):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(f"#!/bin/sh\necho x > {marks}/{hook}\n")
            os.chmod(path, 0o755)
        git("config", "core.fsmonitor", os.path.join(tb, ".git", "fsm.sh"))
        git("config", "core.hooksPath", os.path.join(tb, ".git", "drhooks"))

    return tb, marks, plant


def test_agent_user_root_export_runs_nothing_the_agent_planted():
    from dr_agent import agent_user

    tb, marks, plant = _planted_repo("export-planted")
    saved = os.path.join(os.path.dirname(tb), "git-config")
    agent_user.save_git_config(tb, saved)
    plant()
    with open(os.path.join(tb, "README.md"), "a") as f:
        f.write("# dr probe\n")
    subprocess.run("git add -A && git -c core.fileMode=false diff --cached --binary HEAD > /dev/null", cwd=tb, shell=True, check=True, capture_output=True)
    assert sorted(os.listdir(marks)) == ["clean", "fsmonitor", "hook"], os.listdir(marks)
    agent_user.restore_git_config(tb, saved)
    subprocess.run(["git", "-C", tb, "reset", "-q"], check=True)
    for m in os.listdir(marks):
        os.unlink(os.path.join(marks, m))
    patch = os.path.join(os.path.dirname(tb), "out", "model.patch")
    agent_user.export(patch, tb)
    assert os.listdir(marks) == [], os.listdir(marks)
    assert "# dr probe" in open(patch).read()
    assert "drprobe" not in open(os.path.join(tb, ".git", "config")).read()
    plant(clean=False)
    agent_user.export(patch, tb)
    assert os.listdir(marks) == [], os.listdir(marks)
    os.rename(os.path.join(tb, ".git"), os.path.join(tb, ".git-real"))
    os.symlink(os.path.join(tb, ".git-real"), os.path.join(tb, ".git"))
    try:
        agent_user.export(patch, tb)
        raise AssertionError("a symlinked .git was exported")
    except SystemExit as e:
        assert "not a plain directory" in str(e)


def _write(path, text, mode=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb" if isinstance(text, bytes) else "w") as f:
        f.write(text)
    if mode is not None:
        os.chmod(path, mode)


def test_agent_user_export_runs_and_follows_nothing_else_the_agent_planted():
    """commondir with a filter, config.worktree, hooks in .git/hooks, a diff driver and a symlinked model.patch."""
    from dr_agent import agent_user

    tb, marks, plant = _planted_repo("export-fresh-dir")
    root = os.path.dirname(tb)
    saved = os.path.join(root, "git-config")
    agent_user.save_git_config(tb, saved)
    plant()
    g = os.path.join(tb, ".git")
    hook = lambda name: f"#!/bin/sh\necho x > {marks}/{name}\n"
    _write(os.path.join(g, "hooks", "post-index-change"), hook("defaulthook"), 0o755)
    common = os.path.join(root, "agent-common")
    shutil.copytree(g, common)
    _write(os.path.join(common, "hooks", "post-index-change"), hook("commonhook"), 0o755)
    script = lambda name, body: _write(os.path.join(root, "plants", name), f"#!/bin/sh\necho x > {marks}/{name}\n{body}\n", 0o755) or os.path.join(root, "plants", name)
    with open(os.path.join(common, "config"), "a") as f:
        f.write("[core]\n\trepositoryformatversion = 1\n[extensions]\n\tworktreeConfig = true\n")
        f.write(f"[filter \"drcommon\"]\n\tclean = {script('commondir', 'cat')}\n")
        f.write(f"[diff \"drtext\"]\n\ttextconv = {script('textconv', 'cat \"$1\"')}\n")
    _write(os.path.join(g, "config.worktree"), f"[filter \"drwt\"]\n\tclean = {script('worktree', 'cat')}\n")
    _write(os.path.join(g, "commondir"), common + "\n")
    _write(os.path.join(g, "info", "attributes"), "* diff=drtext\n")
    _write(os.path.join(tb, ".gitattributes"), "* filter=drcommon\n*.md filter=drwt\n")
    with open(os.path.join(tb, "README.md"), "a") as f:
        f.write("# dr probe\n")

    control = os.path.join(root, "control")
    shutil.copytree(tb, control, symlinks=True)
    env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null"}
    subprocess.run("git add -A && git diff --cached HEAD > /dev/null", cwd=control, shell=True, env=env, check=True, capture_output=True)
    live = set(os.listdir(marks))
    assert {"commondir", "worktree"} <= live, live
    for m in live:
        os.unlink(os.path.join(marks, m))

    out = os.path.join(root, "artifacts")
    os.makedirs(out)
    os.chmod(out, 0o777)
    sentinel = os.path.join(root, "sentinel")
    _write(sentinel, "root's file\n")
    patch = os.path.join(out, "model.patch")
    os.symlink(sentinel, patch)
    index = open(os.path.join(g, "index"), "rb").read()
    agent_user.export(patch, tb, saved)
    assert os.listdir(marks) == [], os.listdir(marks)
    assert open(sentinel).read() == "root's file\n"
    assert not os.path.islink(patch) and "# dr probe" in open(patch).read()
    assert open(os.path.join(g, "index"), "rb").read() == index

    head = open(os.path.join(g, "HEAD")).read().split()[-1]
    os.symlink(os.path.join(g, head), os.path.join(g, "refs", "heads", "agent-link"))
    try:
        agent_user.export(patch, tb, saved)
        raise AssertionError("a symlinked ref was copied")
    except SystemExit as e:
        assert "not a regular file" in str(e), e
    os.unlink(os.path.join(g, "refs", "heads", "agent-link"))
    os.unlink(patch)
    os.mkdir(patch)
    try:
        agent_user.export(patch, tb, saved)
        raise AssertionError("a directory at the patch path was written into")
    except SystemExit as e:
        assert "model.patch" in str(e), e
    assert os.listdir(marks) == [], os.listdir(marks)


def _old_export(patch, testbed):
    """The export as it stood at 49ea202, the reference the new one must match byte for byte on benign repos."""
    git_dir = os.path.join(testbed, ".git")
    env = {**os.environ, "GIT_DIR": git_dir, "GIT_WORK_TREE": testbed, "GIT_CONFIG_GLOBAL": "/dev/null"}
    safe = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]
    os.makedirs(os.path.dirname(patch), exist_ok=True)
    subprocess.run(["git", *safe, "add", "-A"], cwd=testbed, env=env, check=True, capture_output=True)
    with open(patch, "wb") as f:
        subprocess.run(["git", *safe, "-c", "core.fileMode=false", "diff", "--cached", "--binary", "HEAD"], cwd=testbed, env=env, stdout=f, check=True)


def _benign_repo(name):
    from dr_agent import agent_user

    root = os.path.join(TMP, name)
    tb = os.path.join(root, "testbed")
    subprocess.run(["git", "init", "-q", tb], check=True)
    git = lambda *a: subprocess.run(["git", "-C", tb, *a], check=True, capture_output=True)
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    for path, text in {"a.txt": "a line\n" * 20, "b.txt": "b body line\n" * 30, "c.txt": "c\n", "sub/d.txt": "d body line\n" * 30, ".gitignore": "*.log\n", "run.sh": "#!/bin/sh\necho hi\n"}.items():
        _write(os.path.join(tb, path), text)
    _write(os.path.join(tb, "bin.dat"), bytes(range(256)) * 8)
    git("add", ".")
    git("commit", "-qm", "base")
    with open(os.path.join(tb, ".git", "info", "exclude"), "a") as f:
        f.write("scratch/\n")
    saved = os.path.join(root, "git-config")
    agent_user.save_git_config(tb, saved)
    return root, tb, saved, git


def test_agent_user_export_matches_the_old_export_byte_for_byte_on_benign_repos():
    from dr_agent import agent_user

    def everything(tb, git):
        _write(os.path.join(tb, "a.txt"), "a line\n" * 20 + "agent commit\n")
        git("commit", "-qam", "agent commit")
        with open(os.path.join(tb, "a.txt"), "a") as f:
            f.write("after the commit\n")
        git("mv", "b.txt", "b2.txt")
        os.rename(os.path.join(tb, "sub", "d.txt"), os.path.join(tb, "sub", "e.txt"))
        os.unlink(os.path.join(tb, "c.txt"))
        _write(os.path.join(tb, "bin.dat"), bytes(reversed(range(256))) * 8)
        _write(os.path.join(tb, "new.txt"), "untracked\n")
        _write(os.path.join(tb, "new.bin"), bytes([0, 1, 2, 255]) * 64)
        _write(os.path.join(tb, "x.log"), "ignored\n")
        _write(os.path.join(tb, "scratch", "s.txt"), "excluded\n")
        _write(os.path.join(tb, "forced.log"), "force-added\n")
        git("add", "-f", "forced.log")
        os.chmod(os.path.join(tb, "run.sh"), 0o755)

    def packed_detached(tb, git):
        git("pack-refs", "--all")
        git("checkout", "-q", "--detach", "HEAD")
        with open(os.path.join(tb, "a.txt"), "a") as f:
            f.write("detached edit\n")
        _write(os.path.join(tb, "new.txt"), "untracked\n")

    def branch_rm_cached(tb, git):
        git("checkout", "-q", "-b", "agent-branch")
        _write(os.path.join(tb, "c.txt"), "c changed on a branch\n")
        git("commit", "-qam", "branch commit")
        git("rm", "-q", "--cached", "c.txt")
        with open(os.path.join(tb, ".gitignore"), "a") as f:
            f.write("c.txt\n")

    def no_index(tb, git):
        os.unlink(os.path.join(tb, ".git", "index"))
        with open(os.path.join(tb, "b.txt"), "a") as f:
            f.write("edited with no index\n")

    def committed_all(tb, git):
        with open(os.path.join(tb, "a.txt"), "a") as f:
            f.write("committed\n")
        git("commit", "-qam", "everything committed")

    for name, steps in (("everything", everything), ("packed-detached", packed_detached), ("branch-rm-cached", branch_rm_cached), ("no-index", no_index), ("committed-all", committed_all)):
        root, tb, saved, git = _benign_repo("benign-" + name)
        steps(tb, git)
        old_root = root + "-old"
        shutil.copytree(root, old_root, symlinks=True)
        _old_export(os.path.join(old_root, "out", "model.patch"), os.path.join(old_root, "testbed"))
        new = os.path.join(root, "out", "model.patch")
        agent_user.export(new, tb, saved)
        want = open(os.path.join(old_root, "out", "model.patch"), "rb").read()
        got = open(new, "rb").read()
        assert got == want, (name, want[:400], got[:400])
        if name == "everything":
            for needle in (b"after the commit", b"rename from b.txt", b"rename to sub/e.txt", b"deleted file mode", b"GIT binary patch", b"new.txt", b"new.bin", b"forced.log"):
                assert needle in got, (needle, got[:600])
            for needle in (b"x.log", b"scratch/", b"+agent commit"):
                assert needle not in got, needle
        if name == "committed-all":
            assert got == b"", got[:200]
        else:
            assert got, name


def test_agent_user_kill_uid_kills_live_processes_and_skips_zombies():
    from dr_agent import agent_user

    proc = os.path.join(TMP, "fake-proc")
    os.makedirs(os.path.join(proc, "999999"))
    child = subprocess.Popen(["sleep", "60"])
    os.symlink(f"/proc/{child.pid}", os.path.join(proc, str(child.pid)))
    uid = os.getuid()
    with open(os.path.join(proc, "999999", "status"), "w") as f:
        f.write(f"Name:\tz\nState:\tZ (zombie)\nUid:\t{uid}\t{uid}\t{uid}\t{uid}\n")
    agent_user.kill_uid(uid, proc=proc)
    assert child.wait(timeout=5) == -9
    agent_user.kill_uid(uid + 1, proc=proc)


def main():
    failed = 0
    if os.environ.get("DR_TEST_TIER") == "real" and TIER != "real":
        print("FAIL tier: DR_TEST_TIER=real but minisweagent is not importable")
        sys.exit(1)
    print(f"tier {TIER}")
    for name, fn in list(globals().items()):
        if not (name.startswith("test_") and callable(fn)):
            continue
        if getattr(fn, "real", False) and TIER != "real":
            continue
        try:
            fn()
            print("PASS", name)
        except Exception:
            failed += 1
            print("FAIL", name)
            traceback.print_exc()
    shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
