"""Keyless tests for the Lane B Harbor agent and the user simulator.

Harbor and the Agent SDK are replaced by stubs, so this runs anywhere with python3. Run by agent.test.ts.
"""

import asyncio
import json
import subprocess
import sys
import tempfile
import traceback
import types
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "runner" / "agent"))


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

    def _resolve_auth_env(self):
        return {"ANTHROPIC_BASE_URL": "http://gateway:8787"}

    def _resolved_model_name(self):
        return "claude-opus-5-5"


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
from usersim import Simulator  # noqa: E402

CAPS_DEFAULT = "CapInh:\t0000000000000000\nCapEff:\t00000000a80425fb\nCapBnd:\t00000000a80425fb\n"
CAPS_DROPPED = "CapInh:\t0000000000000000\nCapEff:\t00000000a80405fb\nCapBnd:\t00000000a80405fb\n"


class Fake:
    """Records docker exec scripts and control-plane calls; each behaviour is set per test."""

    def __init__(self, tmp: Path, close=None, kill_raises=False, caps=CAPS_DROPPED, open_error=None):
        self.tmp = tmp
        self.close = close if close is not None else {"id": "s-1", "ok_responses": 2, "spent_micros": 1500, "usage": {"input_tokens": 10}}
        self.kill_raises = kill_raises
        self.caps = caps
        self.open_error = open_error
        self.calls = []
        self.lists = 0

    def exec(self, container, script, stdin=None, timeout=300):
        self.calls.append(("exec", script[:40], timeout))
        if "kill -9" in script and self.kill_raises:
            raise subprocess.TimeoutExpired(script, timeout)
        if script == "cat /proc/self/status":
            return subprocess.CompletedProcess(script, 0, self.caps.encode(), b"")
        if script == la.LIST_PROCESSES:
            self.lists += 1
            rows = "1\tsleep\tsleep infinity \n" + ("77\tpython3\tpython3 -m http.server 8080 \n" if self.lists > 1 else "")
            return subprocess.CompletedProcess(script, 0, rows.encode(), b"")
        return subprocess.CompletedProcess(script, 0, b"", b"")

    def post(self, url, body, timeout=30):
        self.calls.append(("post", url.rsplit("/", 1)[-1], timeout))
        if url.endswith("/sessions"):
            if self.open_error:
                raise self.open_error
            return {"id": "s-1", "token": "laneb-token"}
        if isinstance(self.close, Exception):
            raise self.close
        return self.close


def agent(tmp: Path, fake: Fake, messages=()):
    (tmp / "persona.json").write_text(json.dumps({"recommended_markers": ["(recommended)", "recommended"], "fallback": "decide"}))
    (tmp / "wrapper.md").write_text("Task: {instruction}")
    a = la.LanebAgent.__new__(la.LanebAgent)
    a.options = types.SimpleNamespace(
        persona_path=str(tmp / "persona.json"), arm="none", arm_tar="", arm_sha256="", control_url="http://127.0.0.1:8788",
        session_cap_usd=1.0, wrapper_path=str(tmp / "wrapper.md"), upstream_model="claude-opus-5-5", repo_dir="", workdir="",
        max_output_tokens=32000, sdk_max_turns=5, close_timeout_sec=120,
    )
    a.logs_dir = tmp / "trial" / "agent"
    a.logs_dir.mkdir(parents=True, exist_ok=True)
    a._arm_info = {"event": "arm", "arm": "none", "tar_sha256": "x", "skills_dirs": 0}
    a._container_id = lambda environment: "cid"
    a._exec = fake.exec
    la.post_json = fake.post

    async def query(prompt, options):
        for m in messages:
            yield m

    la.query = query
    return a


def run(a):
    env = types.SimpleNamespace(session_id="t1__env")
    ctx = types.SimpleNamespace()
    asyncio.run(a.run("do it", env, ctx))
    return ctx


def evidence(tmp: Path):
    return {p.name for p in (tmp / "trial" / "evaluator").glob("*")} if (tmp / "trial" / "evaluator").exists() else set()


def test_kill_failure_still_closes_and_writes_the_summary(tmp):
    fake = Fake(tmp, kill_raises=True)
    run(agent(tmp, fake))
    assert ("post", "close", 120) in fake.calls, fake.calls
    summary = json.loads((tmp / "trial" / "evaluator" / "laneb-summary.json").read_text())
    assert "TimeoutExpired" in summary["teardown_errors"]["kill"], summary
    assert summary["session"]["spent_micros"] == 1500


def test_close_failure_still_writes_the_summary_and_keeps_the_trial(tmp):
    fake = Fake(tmp, close=TimeoutError("timed out"))
    ctx = run(agent(tmp, fake))
    summary = json.loads((tmp / "trial" / "evaluator" / "laneb-summary.json").read_text())
    assert summary["session"] is None and "TimeoutError" in summary["close_error"], summary
    assert ctx.cost_usd is None


def test_close_waits_longer_than_the_proxy_drain(tmp):
    default = getattr(la.LanebOptions, "close_timeout_sec")
    default = getattr(default, "default", default)
    # The proxy's close drains for up to 30 s, then settles in up to 3 tries of 10 s with 2 s and 4 s pauses.
    assert default > 30 + 3 * 10 + 6, default
    fake = Fake(tmp)
    run(agent(tmp, fake))
    assert [c for c in fake.calls if c[:2] == ("post", "close")] == [("post", "close", 120)], fake.calls


def test_evidence_is_written_outside_the_agent_mount(tmp):
    fake = Fake(tmp)
    msg = types.SimpleNamespace(content=[{"type": "text", "text": "hi"}])
    run(agent(tmp, fake, messages=[msg]))
    assert {"laneb-summary.json", "sdk-messages.jsonl", "usersim-events.jsonl"} <= evidence(tmp), evidence(tmp)
    assert not list((tmp / "trial" / "agent").iterdir()), list((tmp / "trial" / "agent").iterdir())


def test_no_model_response_raises_the_retryable_error(tmp):
    fake = Fake(tmp, close={"id": "s-1", "ok_responses": 0, "spent_micros": 0, "usage": {}})
    try:
        run(agent(tmp, fake))
    except Exception as e:
        assert type(e).__name__ == "LanebInfraError", type(e).__name__
        return
    raise AssertionError("expected LanebInfraError")


def test_session_open_failures(tmp):
    for error, want in ((urllib.error.URLError("refused"), "LanebInfraError"), (la.HttpStatusError("u", 409, {"error": "batch cap reached"}) if hasattr(la, "HttpStatusError") else RuntimeError("u -> 409: cap"), "LedgerCapStop")):
        try:
            run(agent(tmp, Fake(tmp, open_error=error)))
        except Exception as e:
            assert type(e).__name__ == want, (type(e).__name__, want)
            continue
        raise AssertionError("expected " + want)


def test_preflight_refuses_a_container_that_keeps_net_raw(tmp):
    a = agent(tmp, Fake(tmp, caps=CAPS_DEFAULT))
    a._inject_arm = lambda container: {"event": "arm", "tar_sha256": "x"}
    try:
        asyncio.run(a.setup(types.SimpleNamespace(session_id="t1__env")))
    except RuntimeError as e:
        assert "NET_RAW" in str(e) and type(e).__name__ == "RuntimeError", e
    else:
        raise AssertionError("preflight passed a container holding CAP_NET_RAW")
    assert la.net_caps_held(CAPS_DEFAULT) == ["CAP_NET_RAW"]
    assert la.net_caps_held(CAPS_DROPPED) == []
    assert la.net_caps_held("CapEff:\t0000000000001000\nCapBnd:\t0000000000000000\n") == ["CAP_NET_ADMIN"]


def test_processes_started_during_the_agent_phase_are_recorded(tmp):
    fake = Fake(tmp)
    a = agent(tmp, fake)
    a._inject_arm = lambda container: {"event": "arm", "tar_sha256": "x"}
    asyncio.run(a.setup(types.SimpleNamespace(session_id="t1__env")))
    run(a)
    events = [json.loads(l) for l in (tmp / "trial" / "evaluator" / "usersim-events.jsonl").read_text().splitlines()]
    seen = [e for e in events if e.get("event") == "processes_after_agent"]
    assert seen and seen[0]["new_since_setup"] == {"77": "python3 python3 -m http.server 8080"}, seen


def test_simulator_skips_an_option_marked_not_recommended(tmp):
    sim = Simulator({"recommended_markers": ["(recommended)", "recommended"], "fallback": "decide"}, tmp / "log.jsonl")
    q = {"question": "Which?", "options": [{"label": "Rewrite (Not recommended)", "description": "slow"}, {"label": "Patch (Recommended)", "description": "fast"}]}
    assert sim.pick(q) == ("Patch (Recommended)", "recommended_option"), sim.pick(q)
    only_not = {"question": "Which?", "options": [{"label": "A", "description": "not recommended"}, {"label": "B", "description": ""}]}
    assert sim.pick(only_not) == ("decide", "fallback"), sim.pick(only_not)


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted((k, v) for k, v in globals().items() if k.startswith("test_")):
        with tempfile.TemporaryDirectory() as d:
            try:
                fn(Path(d))
                print(f"pass {name}")
            except Exception:
                failed += 1
                print(f"FAIL {name}")
                traceback.print_exc(file=sys.stdout)
    sys.exit(1 if failed else 0)
