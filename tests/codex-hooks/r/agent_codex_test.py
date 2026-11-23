"""Keyless tests for Lane B's Codex agent (quick/laneb/runner/agent/laneb_codex.py), part R of the Codex hooks eval.

Harbor and the Agent SDK are stubbed as in quick/laneb/tests/agent_test.py. A fake docker on PATH plays Codex: each codex
exec reads its step from scenario.json, appends rollout lines under a temp CODEX_HOME, prints JSONL events and records its
argv, stdin and env; an sh -c call runs the agent's own script under the real sh against that CODEX_HOME. Run by
agent-codex.test.ts, which puts quick/laneb/runner/agent on PYTHONPATH.
"""

import asyncio
import io
import json
import os
import signal
import subprocess
import sys
import tarfile
import tempfile
import traceback
import types
from pathlib import Path


def module(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


class StubOptions:
    pass


class StubClaudeCode:
    async def setup(self, environment):
        return None


module("claude_agent_sdk", ClaudeAgentOptions=lambda **k: k, query=None)
module("claude_agent_sdk.types", HookMatcher=lambda **k: k, PermissionResultAllow=lambda **k: k)
for name in ("harbor", "harbor.agents", "harbor.agents.installed", "harbor.environments", "harbor.environments.docker", "harbor.models", "harbor.models.agent"):
    module(name)
module("harbor.agents.installed.claude_code", ClaudeCode=StubClaudeCode, ClaudeCodeOptions=StubOptions)
module("harbor.environments.base", BaseEnvironment=object)
module("harbor.environments.docker.docker", _sanitize_docker_compose_project_name=lambda s: s)
module("harbor.models.agent.context", AgentContext=object)
try:
    import pydantic  # noqa: F401
except ImportError:
    module("pydantic", Field=lambda default=None, **k: default)

import laneb_agent as la  # noqa: E402
import laneb_codex as lc  # noqa: E402

la.OPEN_RETRY_S = 0
CODEX = "/opt/laneb/codex/codex"
THREAD = "019a0000-0000-7000-8000-000000000001"
REPLY = "No one is available. Treat this question as answered with your recommended option, and keep going."
ARGV = ["exec", "--json", "--strict-config", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust", "--color", "never",
        "-m", "gpt-6.1-sol", "-c", 'model_provider="gstack_evals_proxy"', "-c", 'model_reasoning_effort="low"', "-c", "features.sleep_tool=false", "-"]
RESUME = ARGV[:-1] + ["resume", "__THREAD__", "-"]

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, subprocess, sys, time
here = os.path.dirname(os.path.abspath(__file__))
sc = json.load(open(os.path.join(here, "scenario.json")))
args = sys.argv[1:]
assert args[0] == "exec", args
i, env_args, workdir = 1, [], None
while args[i].startswith("-"):
    if args[i] == "-i":
        i += 1
    elif args[i] == "-e":
        env_args.append(args[i + 1]); i += 2
    elif args[i] == "-w":
        workdir = args[i + 1]; i += 2
    else:
        sys.exit("unknown flag " + args[i])
container, cmd = args[i], args[i + 1:]
if cmd[:2] == ["sh", "-c"]:
    env = {"PATH": os.environ["PATH"]}
    for a in env_args:
        k, _, v = a.partition("=")
        env[k] = sc["codex_home"] if k == "CODEX_HOME" else v
    sys.exit(subprocess.run(cmd, env=env).returncode)
calls = os.path.join(here, "calls.jsonl")
n = sum(1 for _ in open(calls)) if os.path.exists(calls) else 0
stdin = sys.stdin.read()
names = ("OPENAI_API_KEY", "GSTACK_SESSION_KIND", "HOME", "CODEX_HOME", "ANTHROPIC_API_KEY", "LANEB_HOST_SECRET")
with open(calls, "a") as f:
    f.write(json.dumps({"cmd": cmd, "container": container, "env_args": env_args, "workdir": workdir, "stdin": stdin, "env": {k: os.environ.get(k) for k in names}}) + "\n")
step = sc["execs"][n]
with open(os.path.join(here, "pid"), "w") as f:
    f.write(str(os.getpid()))
d = os.path.join(sc["codex_home"], "sessions/2026/11/20")
os.makedirs(d, exist_ok=True)
for line in step.get("rollout", []):
    with open(os.path.join(d, "rollout-2026-11-20T00-00-00-" + sc["thread"] + ".jsonl"), "a") as f:
        f.write(json.dumps(line) + "\n")
for ev in step.get("events", []):
    print(json.dumps(ev), flush=True)
sys.stderr.write("codex stderr line\n")
if step.get("hang"):
    time.sleep(3600)
sys.exit(step.get("exit", 0))
'''


class Fake:
    def __init__(self, tmp: Path, close=None):
        self.tmp = tmp
        self.close = close if close is not None else {"id": "s-1", "ok_responses": 3, "spent_micros": 2500, "usage": {"input_tokens": 100, "cache_read_input_tokens": 400, "cache_creation_input_tokens": 0, "output_tokens": 50}}
        self.open_bodies, self.calls = [], []

    def exec(self, container, script, stdin=None, timeout=300):
        self.calls.append(("exec", script[:60], timeout))
        if script == lc.KILL_CODEX:
            pid = self.tmp / "bin" / "pid"
            if pid.exists():
                try:
                    os.kill(int(pid.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass
            return subprocess.CompletedProcess(script, 0, b"", b"")
        if "/sessions" in script or "/root/.gstack" in script:
            env = {"PATH": os.environ["PATH"], "HOME": str(self.tmp / "root")}
            return subprocess.run(["sh", "-c", script.replace("/root/.gstack", str(self.tmp / "root/.gstack")).replace("CODEX_HOME=/root/.codex;", f"CODEX_HOME={self.tmp / 'root/.codex'};")], env=env, capture_output=True)
        if script.endswith("--version"):
            return subprocess.CompletedProcess(script, 0, b"codex-cli 0.170.0\n", b"")
        if "sha256sum" in script:
            return subprocess.CompletedProcess(script, 0, b"ab" * 32 + b"\n", b"")
        if " get " in script:
            return subprocess.CompletedProcess(script, 0, b"on\n", b"")
        return subprocess.CompletedProcess(script, 0, b"", b"")

    def post(self, url, body, timeout=30):
        self.calls.append(("post", url.rsplit("/", 1)[-1], timeout))
        if url.endswith("/sessions"):
            self.open_bodies.append(body)
            return {"id": "s-1", "token": "laneb-token"}
        return self.close


def events(text="Done. STATUS: FIXED", fail=None):
    out = [{"type": "thread.started", "thread_id": THREAD}, {"type": "turn.started"}, {"type": "item.completed", "item": {"id": "i0", "type": "agent_message", "text": text}}]
    return out + ([{"type": "turn.failed", "error": {"message": fail}}] if fail else [{"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 5}}])


def ask(call_id, name="request_user_input_async", title="Which fix do you want?"):
    return {"type": "response_item", "payload": {"type": "function_call", "name": name, "call_id": call_id, "arguments": json.dumps({"questions": [{"title": title, "options": [{"label": "A (Recommended)"}, {"label": "B"}]}]})}}


def message(text):
    return {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}}


def setup(tmp: Path, execs, fake=None, **opts):
    b = tmp / "bin"
    b.mkdir(parents=True, exist_ok=True)
    (b / "docker").write_text(FAKE_DOCKER)
    (b / "docker").chmod(0o755)
    home = tmp / "root" / ".codex"
    home.mkdir(parents=True, exist_ok=True)
    (b / "scenario.json").write_text(json.dumps({"codex_home": str(home), "thread": THREAD, "execs": execs}))
    os.environ["PATH"] = f"{b}:{os.environ['PATH']}"
    os.environ["ANTHROPIC_API_KEY"] = "host-anthropic"
    os.environ["LANEB_HOST_SECRET"] = "host-secret"
    (tmp / "wrapper.md").write_text("Task: {instruction}\n")
    fake = fake or Fake(tmp)
    a = lc.LanebCodexAgent.__new__(lc.LanebCodexAgent)
    a.options = types.SimpleNamespace(**{
        "persona_path": "", "arm": "r-on", "arm_tar": "", "arm_sha256": "", "control_url": "http://127.0.0.1:8788", "session_cap_usd": 5.0,
        "wrapper_path": str(tmp / "wrapper.md"), "upstream_model": "gpt-6.1-sol", "repo_dir": "", "workdir": "/testbed", "close_timeout_sec": 120,
        "session_kind": "unattended", "closing_line": "hm-status", "strip_snapshot": True, "codex_bin": CODEX, "codex_argv": ARGV, "codex_resume_argv": RESUME,
        "codex_env": {"OPENAI_API_KEY": "__SESSION_TOKEN__", "GSTACK_SESSION_KIND": "unattended"}, "codex_home": "/root/.codex", "hook_trust": True,
        "gstack_config": "/root/gstack/bin/gstack-config", "gstack_pin": "a0534ce6", "arm_tree_sha256": "t" * 64, "prompt_input_sha256": "p" * 64, "question_reply": REPLY, **opts})
    a.logs_dir = tmp / "trial" / "agent"
    a.logs_dir.mkdir(parents=True, exist_ok=True)
    a._arm_info = {"event": "arm", "arm": "r-on", "tar_sha256": "x", "skills_dirs": 1}
    a._container_id = lambda environment: "cid"
    a._exec = fake.exec
    la.post_json = fake.post
    return a, fake


def run(a, timeout=None):
    ctx = types.SimpleNamespace()
    coro = a.run("Fix the bug.", types.SimpleNamespace(session_id="t1__env"), ctx)
    asyncio.run(asyncio.wait_for(coro, timeout) if timeout else coro)
    return ctx


def calls(tmp):
    f = tmp / "bin" / "calls.jsonl"
    return [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []


def ev(tmp, name):
    return tmp / "trial" / "evaluator" / name


def test_one_turn_runs_the_driver_argv_with_the_b1_prompt_and_forwards_no_host_key(tmp):
    a, fake = setup(tmp, [{"events": events(), "rollout": [message("STATUS: FIXED")]}])
    ctx = run(a)
    [c] = calls(tmp)
    assert c["cmd"] == [CODEX, *ARGV], c["cmd"]
    assert c["workdir"] == "/testbed"
    assert c["env_args"] == ["OPENAI_API_KEY", "GSTACK_SESSION_KIND=unattended", "HOME=/root", "CODEX_HOME=/root/.codex"], c["env_args"]
    assert c["env"]["OPENAI_API_KEY"] == "laneb-token"
    assert c["env"]["ANTHROPIC_API_KEY"] is None and c["env"]["LANEB_HOST_SECRET"] is None, c["env"]
    assert c["stdin"] == "Task: Fix the bug.\n\nWhen you finish, end your final message with one line: STATUS: FIXED or STATUS: NOT FIXED.\n", repr(c["stdin"])
    assert fake.open_bodies[0]["model"] == "gpt-6.1-sol" and fake.open_bodies[0]["meta"]["agent"] == "codex" and fake.open_bodies[0]["meta"]["arm"] == "r-on"
    s = json.loads(ev(tmp, "laneb-summary.json").read_text())
    assert s["result"]["thread_id"] == THREAD and s["result"]["resumes"] == 0 and s["result"]["questions"] == 0
    assert s["session"]["ok_responses"] == 3
    assert ctx.n_input_tokens == 500 and ctx.n_cache_tokens == 400 and ctx.n_output_tokens == 50 and ctx.cost_usd == 0.0025
    lines = [json.loads(x) for x in ev(tmp, "codex-events.jsonl").read_text().splitlines()]
    assert [x["exec"] for x in lines] == [0] * 4 and lines[0]["type"] == "thread.started"
    assert "codex stderr line" in ev(tmp, "codex-stderr.log").read_text()
    assert json.loads(ev(tmp, "questions.json").read_text()) == []


def test_init_json_holds_the_section_2_fields(tmp):
    a, _ = setup(tmp, [{"events": events()}])
    run(a)
    init = json.loads(ev(tmp, "init.json").read_text())
    assert init["codex_version"] == "codex-cli 0.170.0" and init["model"] == "gpt-6.1-sol" and init["reasoning_effort"] == "low" and init["hook_trust"] is True
    assert init["switches"] == {"skill_routing": "on", "skill_contracts": "on", "destructive_guard": "on"}
    assert init["settings"] == ["features.sleep_tool=false"] and init["gstack_pin"] == "a0534ce6" and init["hooks_json_sha256"] == "ab" * 32
    assert init["argv"] == [CODEX, *ARGV] and init["resume_argv"] == [CODEX, *RESUME] and init["session_kind"] == "unattended"


def test_an_arm_with_no_gstack_reads_no_switches(tmp):
    a, _ = setup(tmp, [{"events": events()}], gstack_config="", gstack_pin="", hook_trust=False, codex_argv=[x for x in ARGV if x != "--dangerously-bypass-hook-trust"])
    run(a)
    init = json.loads(ev(tmp, "init.json").read_text())
    assert init["switches"] == {"skill_routing": None, "skill_contracts": None, "destructive_guard": None} and init["gstack_pin"] is None and init["hook_trust"] is False


def test_an_async_question_gets_the_reply_by_resume_once(tmp):
    a, _ = setup(tmp, [{"events": events("I have a question."), "rollout": [ask("c1")]}, {"events": events(), "rollout": [message("STATUS: FIXED")]}])
    run(a)
    first, second = calls(tmp)
    assert second["cmd"] == [CODEX, *ARGV[:-1], "resume", THREAD, "-"], second["cmd"]
    assert second["stdin"] == REPLY
    qs = json.loads(ev(tmp, "questions.json").read_text())
    assert qs == [{"call_id": "c1", "questions": ["Which fix do you want?"], "sync": False, "exec": 0, "answer": REPLY}], qs
    s = json.loads(ev(tmp, "laneb-summary.json").read_text())
    assert s["result"]["resumes"] == 1 and s["result"]["questions"] == 1


def test_a_sync_question_is_recorded_and_never_resumed(tmp):
    a, _ = setup(tmp, [{"events": events(), "rollout": [ask("c1", name="request_user_input")]}])
    run(a)
    assert len(calls(tmp)) == 1
    assert json.loads(ev(tmp, "questions.json").read_text())[0]["answer"] is None


def test_a_question_seen_before_is_not_answered_twice(tmp):
    a, _ = setup(tmp, [{"events": events(), "rollout": [ask("c1")]}, {"events": events(), "rollout": [message("ok")]}, {"events": events()}])
    run(a)
    assert len(calls(tmp)) == 2


def test_a_failed_turn_ends_the_session_without_a_resume(tmp):
    a, _ = setup(tmp, [{"events": events(fail="stream disconnected"), "rollout": [ask("c1")], "exit": 1}])
    run(a)
    assert len(calls(tmp)) == 1
    r = json.loads(ev(tmp, "laneb-summary.json").read_text())["result"]["execs"][0]
    assert r["failed"] == "stream disconnected" and r["exit"] == 1


def test_no_ok_response_is_the_retryable_infra_error_after_the_close(tmp):
    fake = Fake(tmp, close={"id": "s-1", "ok_responses": 0, "spent_micros": 0, "usage": {}})
    a, fake = setup(tmp, [{"events": [{"type": "thread.started", "thread_id": THREAD}, {"type": "error", "message": "unexpected status 502"}, {"type": "turn.failed", "error": {"message": "502"}}], "exit": 1}], fake=fake)
    try:
        run(a)
    except la.LanebInfraError as e:
        assert "no model response reached the agent" in str(e)
    else:
        raise AssertionError("expected LanebInfraError")
    assert ("post", "close", 120) in fake.calls


def test_an_agent_timeout_kills_codex_closes_the_session_and_starts_no_resume(tmp):
    a, fake = setup(tmp, [{"events": [{"type": "thread.started", "thread_id": THREAD}], "hang": True}, {"events": events()}])
    try:
        run(a, timeout=2)
    except (asyncio.TimeoutError, TimeoutError):
        pass
    else:
        raise AssertionError("expected the agent timeout")
    assert len(calls(tmp)) == 1
    kinds = [c[1] for c in fake.calls]
    assert kinds.index(lc.KILL_CODEX[:60]) < kinds.index("close"), kinds
    s = json.loads(ev(tmp, "laneb-summary.json").read_text())
    assert s["session"]["ok_responses"] == 3 and "kill_codex" not in s["teardown_errors"]


def test_the_teardown_copies_every_rollout_and_the_hook_state_and_skips_links(tmp):
    a, _ = setup(tmp, [{"events": events(), "rollout": [message("ok")]}])
    sub = tmp / "root/.codex/sessions/2026/11/20"
    sub.mkdir(parents=True, exist_ok=True)
    (sub / "rollout-2026-11-20T00-00-01-019a0000-0000-7000-8000-000000000002.jsonl").write_text('{"type":"session_meta"}\n')
    (tmp / "outside.jsonl").write_text("secret\n")
    (sub / "rollout-2026-11-20T00-00-02-link.jsonl").symlink_to(tmp / "outside.jsonl")
    hooks = tmp / "root/.gstack/hooks"
    hooks.mkdir(parents=True)
    (hooks / "hooks.jsonl").write_text('{"hook":"route"}\n')
    run(a)
    got = sorted(str(p.relative_to(ev(tmp, "codex-sessions"))) for p in ev(tmp, "codex-sessions").rglob("*.jsonl"))
    assert got == ["2026/11/20/rollout-2026-11-20T00-00-00-" + THREAD + ".jsonl", "2026/11/20/rollout-2026-11-20T00-00-01-019a0000-0000-7000-8000-000000000002.jsonl"], got
    assert (ev(tmp, "gstack-hooks") / "hooks/hooks.jsonl").exists()
    s = json.loads(ev(tmp, "laneb-summary.json").read_text())
    assert len(s["codex_sessions"]) == 2 and s["gstack_hooks"] == ["hooks/hooks.jsonl"] and s["teardown_errors"] == {}, s["teardown_errors"]


def test_a_failed_copy_is_recorded_and_never_skips_the_close(tmp):
    a, fake = setup(tmp, [{"events": events()}])
    inner = fake.exec

    def exec_(container, script, stdin=None, timeout=300):
        if "/sessions" in script:
            return subprocess.CompletedProcess(script, 3, b"", b"the tar is over the cap")
        return inner(container, script, stdin, timeout)

    a._exec = exec_
    run(a)
    s = json.loads(ev(tmp, "laneb-summary.json").read_text())
    assert "codex_sessions" in s["teardown_errors"] and s["session"]["ok_responses"] == 3


def test_options_that_break_the_records_are_refused_before_the_session_opens(tmp):
    for opts, word in (({"hook_trust": False}, "hook_trust"), ({"codex_argv": ARGV[:-1] + ["--ephemeral", "-"]}, "ephemeral"), ({"closing_line": "nope"}, "closing_line"), ({"session_kind": "interactive"}, "session_kind")):
        a, fake = setup(tmp, [{"events": events()}], **opts)
        try:
            run(a)
        except ValueError as e:
            assert word in str(e), (word, e)
        else:
            raise AssertionError(f"expected a refusal for {opts}")
        assert fake.open_bodies == []


def test_rollout_questions_reads_titles_like_the_shared_driver(tmp):
    text = "\n".join([json.dumps(ask("c1")), "not json", json.dumps({"type": "response_item", "payload": {"type": "function_call", "name": "request_user_input_async", "call_id": "c2", "arguments": json.dumps({"questions": [{"question": "Q2?"}, {"title": ""}]})}}),
                      json.dumps({"type": "response_item", "payload": {"type": "function_call", "name": "exec", "call_id": "c3", "arguments": "{}"}})])
    assert lc.rollout_questions(text) == [{"call_id": "c1", "questions": ["Which fix do you want?"], "sync": False}, {"call_id": "c2", "questions": ["Q2?"], "sync": False}]


if __name__ == "__main__":
    failed = 0
    path0 = os.environ["PATH"]
    for name, fn in sorted((k, v) for k, v in globals().items() if k.startswith("test_")):
        with tempfile.TemporaryDirectory() as d:
            os.environ["PATH"] = path0
            try:
                fn(Path(d))
                print(f"pass {name}")
            except Exception:
                failed += 1
                print(f"FAIL {name}")
                traceback.print_exc(file=sys.stdout)
    sys.exit(1 if failed else 0)
