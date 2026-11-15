"""Keyless tests for the Lane B Harbor agent and the user simulator.

Harbor and the Agent SDK are replaced by stubs, so this runs anywhere with python3. Run by agent.test.ts, which puts
runner/agent on PYTHONPATH.
"""

import asyncio
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback
import types
import urllib.error
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
import laneb_hooks as lh  # noqa: E402
from usersim import Simulator  # noqa: E402

la.OPEN_RETRY_S = 0

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
        self.open_bodies = []
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
            self.open_bodies.append(body)
            error = self.open_error.pop(0) if isinstance(self.open_error, list) else self.open_error
            if error:
                raise error
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
        max_output_tokens=32000, sdk_max_turns=5, close_timeout_sec=120, system_prompt="sdk-default", session_kind="", told_skill="", procedure_line="", closing_line="",
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
    for error, want in ((urllib.error.URLError("refused"), "LanebInfraError"), (la.HttpStatusError("u", 409, {"error": "batch cap reached"}), "LedgerCapStop")):
        try:
            run(agent(tmp, Fake(tmp, open_error=error)))
        except Exception as e:
            assert type(e).__name__ == want, (type(e).__name__, want)
            continue
        raise AssertionError("expected " + want)


def test_session_open_retries_a_timeout_or_a_5xx_with_the_same_open_key(tmp):
    for first in (TimeoutError("timed out"), la.HttpStatusError("u", 502, {"error": "ledger reserve failed"})):
        fake = Fake(tmp, open_error=[first, None])
        run(agent(tmp, fake))
        keys = [b["open_key"] for b in fake.open_bodies]
        assert len(keys) == 2 and keys[0] == keys[1] and len(keys[0]) == 32, (first, keys)
        assert ("post", "close", 120) in fake.calls, fake.calls


def test_session_open_gives_up_after_three_attempts_and_never_retries_a_409(tmp):
    cases = (
        ([urllib.error.URLError("refused"), ConnectionResetError("reset"), TimeoutError("timed out")], "LanebInfraError", 3),
        ([la.HttpStatusError("u", 409, {"error": "batch cap reached"}), None], "LedgerCapStop", 1),
        ([la.HttpStatusError("u", 502, {"error": "ledger reserve failed"})] * 3, "LanebInfraError", 3),
        ([la.HttpStatusError("u", 400, {"error": "unknown model m"}), None], "LanebInfraError", 1),
    )
    for errors, want, calls in cases:
        fake = Fake(tmp, open_error=list(errors))
        try:
            run(agent(tmp, fake))
        except Exception as e:
            assert type(e).__name__ == want, (type(e).__name__, want)
        else:
            raise AssertionError("expected " + want)
        assert len(fake.open_bodies) == calls, (want, fake.open_bodies)
        assert len({b["open_key"] for b in fake.open_bodies}) == 1, fake.open_bodies


def test_preflight_process_listing_failure_is_a_retryable_infra_error(tmp):
    fake = Fake(tmp)
    a = agent(tmp, fake)
    a._inject_arm = lambda container: {"event": "arm", "tar_sha256": "x"}
    env = types.SimpleNamespace(session_id="t1__env")

    def exits_1(script, timeout):
        return subprocess.CompletedProcess(script, 1, b"", b"Error: No such container: cid")

    def hangs(script, timeout):
        raise subprocess.TimeoutExpired(script, timeout)

    def no_docker(script, timeout):
        raise FileNotFoundError("docker")

    for failing in (exits_1, hangs, no_docker):
        a._exec = lambda container, script, stdin=None, timeout=300: failing(script, timeout) if script == la.LIST_PROCESSES else fake.exec(container, script, stdin, timeout)
        try:
            asyncio.run(a.setup(env))
        except Exception as e:
            assert type(e).__name__ == "LanebInfraError", (failing.__name__, type(e).__name__, e)
        else:
            raise AssertionError("a failed process listing passed the preflight")
        assert not (tmp / "trial" / "evaluator" / "processes-before.tsv").exists(), failing.__name__


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


def test_preflight_probe_failure_is_a_retryable_infra_error(tmp):
    fake = Fake(tmp)
    a = agent(tmp, fake)
    a._inject_arm = lambda container: {"event": "arm", "tar_sha256": "x"}
    env = types.SimpleNamespace(session_id="t1__env")

    def exits_1(container, script, stdin=None, timeout=300):
        return subprocess.CompletedProcess(script, 1, b"", b"Error: No such container: cid")

    def hangs(container, script, stdin=None, timeout=300):
        raise subprocess.TimeoutExpired(script, timeout)

    for failing in (exits_1, hangs):
        a._exec = failing
        try:
            asyncio.run(a.setup(env))
        except Exception as e:
            assert type(e).__name__ == "LanebInfraError", (type(e).__name__, e)
        else:
            raise AssertionError("a failed preflight probe passed")


def test_the_process_listing_leaves_out_only_its_own_shell(tmp):
    out = subprocess.run(["sh", "-c", "echo $$; " + la.LIST_PROCESSES], capture_output=True, text=True, check=True).stdout.splitlines()
    pids = set(la.parse_processes("\n".join(out[1:])))
    assert out[0] not in pids, out[0]
    assert str(os.getpid()) in pids, sorted(pids)[:20]


def test_a_process_whose_command_line_names_proc_is_still_recorded(tmp):
    class Listing(Fake):
        def exec(self, container, script, stdin=None, timeout=300):
            if script == la.LIST_PROCESSES:
                self.lists += 1
                rows = "1\tsleep\tsleep infinity \n" + ("88\tsh\tsh -c while :; do ls /proc/[0-9]* >/dev/null; done \n" if self.lists > 1 else "")
                return subprocess.CompletedProcess(script, 0, rows.encode(), b"")
            return super().exec(container, script, stdin, timeout)

    a = agent(tmp, Listing(tmp))
    a._inject_arm = lambda container: {"event": "arm", "tar_sha256": "x"}
    asyncio.run(a.setup(types.SimpleNamespace(session_id="t1__env")))
    run(a)
    events = [json.loads(l) for l in (tmp / "trial" / "evaluator" / "usersim-events.jsonl").read_text().splitlines()]
    seen = [e for e in events if e.get("event") == "processes_after_agent"]
    assert seen and list(seen[0]["new_since_setup"]) == ["88"], seen


def hang_forever():
    async def query(prompt, options):
        await asyncio.sleep(3600)
        yield None

    return query


def test_an_agent_timeout_still_closes_and_writes_the_summary(tmp):
    fake = Fake(tmp)
    a = agent(tmp, fake)
    la.query = hang_forever()

    async def main():
        try:
            await asyncio.wait_for(a.run("do it", types.SimpleNamespace(session_id="t1__env"), types.SimpleNamespace()), 0.2)
        except (asyncio.TimeoutError, TimeoutError):
            return
        raise AssertionError("expected the agent timeout")

    asyncio.run(main())
    assert ("post", "close", 120) in fake.calls, fake.calls
    assert (tmp / "trial" / "evaluator" / "laneb-summary.json").exists()


def test_a_second_cancellation_still_waits_for_the_teardown(tmp):
    fake = Fake(tmp)
    a = agent(tmp, fake)
    la.query = hang_forever()
    teardown = a._teardown

    def slow_teardown(*args):
        time.sleep(0.3)
        return teardown(*args)

    a._teardown = slow_teardown
    summary = tmp / "trial" / "evaluator" / "laneb-summary.json"

    async def main():
        task = asyncio.ensure_future(a.run("do it", types.SimpleNamespace(session_id="t1__env"), types.SimpleNamespace()))
        await asyncio.sleep(0.1)
        task.cancel()
        await asyncio.sleep(0.1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError("expected the cancellation to reach the caller")
        return summary.exists()

    assert asyncio.run(main()), "run() returned before the teardown wrote the summary"
    assert ("post", "close", 120) in fake.calls, fake.calls


def test_a_failing_log_write_never_skips_the_close(tmp):
    fake = Fake(tmp)
    a = agent(tmp, fake)
    (tmp / "trial" / "evaluator").mkdir(parents=True, exist_ok=True)

    def full_disk(entry):
        raise OSError(28, "No space left on device")

    summary = a._teardown("cid", "s-1", full_disk, {"result": {}})
    assert ("post", "close", 120) in fake.calls, fake.calls
    assert summary["session"]["spent_micros"] == 1500 and "OSError" in summary["teardown_errors"]["log"], summary
    assert (tmp / "trial" / "evaluator" / "laneb-summary.json").exists()


# Generated by gstack /ship Step 7 (test coverage audit) for #25, pass 1.
# Value: protects=a docker ps that fails, hangs or finds no single main container raises LanebInfraError, the one
#   error Harbor reruns, and the probe has a timeout; fails_when=the try/except, the timeout or the error type is
#   reverted, so a hung probe blocks or a setup failure is never retried; why_new=every other test stubs _container_id;
#   seam=none; no_claim=real docker behaviour (subprocess.check_output is replaced)
def test_container_lookup_failures_are_retryable_infra_errors(tmp):
    a = agent(tmp, Fake(tmp))
    env = types.SimpleNamespace(session_id="t1__env")
    real = la.subprocess.check_output
    seen = []

    def outcome(fake):
        la.subprocess.check_output = fake
        try:
            return la.LanebAgent._container_id(a, env)
        except Exception as e:
            return e
        finally:
            la.subprocess.check_output = real

    def hang(cmd, **kw):
        seen.append(kw.get("timeout"))
        raise subprocess.TimeoutExpired(cmd, kw.get("timeout"))

    def missing(cmd, **kw):
        raise FileNotFoundError("docker")

    for fake in (hang, missing, lambda cmd, **kw: "", lambda cmd, **kw: "aaa\nbbb\n"):
        got = outcome(fake)
        assert type(got).__name__ == "LanebInfraError", (fake, got)
    assert seen == [la.PROBE_TIMEOUT_S], seen
    assert outcome(lambda cmd, **kw: "abc\n") == "abc"


_REAL_POST_JSON = la.post_json


# Generated by gstack /ship Step 7 (test coverage audit) for #25, pass 1.
# Value: protects=post_json turns an HTTP error into HttpStatusError with the status code and the parsed JSON body, which
#   is how a 409 cap refusal becomes LedgerCapStop; fails_when=post_json goes back to a plain RuntimeError, so a cap stop
#   becomes a retried infra error; why_new=test_session_open_failures builds HttpStatusError by hand; seam=none;
#   no_claim=the real proxy control plane (a local http.server answers)
def test_post_json_keeps_the_status_and_body_of_an_http_error(tmp):
    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get("content-length", 0)))
            body, status = (b'{"error": "batch cap reached"}', 409) if self.path == "/json" else (b"bad gateway", 502)
            self.send_response(status)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        for path, code, body in (("/json", 409, {"error": "batch cap reached"}), ("/text", 502, b"bad gateway")):
            try:
                _REAL_POST_JSON(base + path, {"trial": "t"}, timeout=5)
            except la.HttpStatusError as e:
                assert (e.code, e.body) == (code, body), (e.code, e.body)
            else:
                raise AssertionError("expected HttpStatusError for " + path)
    finally:
        server.shutdown()
        server.server_close()


def _hook_tar(files):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def hooks_agent(tmp, fake):
    a = agent(tmp, fake)
    a.__class__ = lh.LanebHooksAgent
    return a


def test_the_told_arms_gstack_hook_state_is_copied_out_after_the_session(tmp):
    fake = Fake(tmp)
    log = b"2026-11-04T00:00:00.000Z session=abc event=blocked skill=investigate missing=debug-report waived=-\n"
    state = _hook_tar({"hooks/skill-contract.log": log, "skill-contracts/abc.json": b'{"version": 1}'})
    a = hooks_agent(tmp, fake)
    plain = a._exec
    a._exec = lambda container, script, stdin=None, timeout=300: subprocess.CompletedProcess(script, 0, state, b"") if script == lh.GSTACK_HOOK_STATE else plain(container, script, stdin, timeout)
    run(a)
    out = tmp / "trial" / "evaluator" / "gstack-hooks"
    assert (out / "hooks" / "skill-contract.log").read_bytes() == log
    assert (out / "skill-contracts" / "abc.json").exists()
    events = [json.loads(l) for l in (tmp / "trial" / "evaluator" / "usersim-events.jsonl").read_text().splitlines()]
    assert [e["files"] for e in events if e.get("event") == "gstack_hooks"] == [["hooks/skill-contract.log", "skill-contracts/abc.json"]]


def test_an_arm_with_no_gstack_state_copies_nothing_and_lane_bs_own_agent_never_copies(tmp):
    fake = Fake(tmp)
    a = hooks_agent(tmp, fake)
    run(a)
    assert not (tmp / "trial" / "evaluator" / "gstack-hooks").exists()
    assert any(c[1] == lh.GSTACK_HOOK_STATE[:40] for c in fake.calls)
    plain = Fake(tmp)
    run(agent(tmp, plain))
    assert not any(c[1] == lh.GSTACK_HOOK_STATE[:40] for c in plain.calls)
    summary = json.loads((tmp / "trial" / "evaluator" / "laneb-summary.json").read_text())
    assert "gstack_hooks" not in summary["teardown_errors"], summary["teardown_errors"]


def test_a_hook_state_copy_that_fails_or_escapes_is_recorded_after_the_close(tmp):
    for out, rc in ((b"", 2), (_hook_tar({"../escape.log": b"x"}), 0)):
        fake = Fake(tmp)
        a = hooks_agent(tmp, fake)
        plain = a._exec
        a._exec = lambda container, script, stdin=None, timeout=300, out=out, rc=rc: subprocess.CompletedProcess(script, rc, out, b"tar: failed") if script == lh.GSTACK_HOOK_STATE else plain(container, script, stdin, timeout)
        run(a)
        summary = json.loads((tmp / "trial" / "evaluator" / "laneb-summary.json").read_text())
        assert "gstack_hooks" in summary["teardown_errors"], summary["teardown_errors"]
        assert summary["session"]["ok_responses"] == 2 and ("post", "close", 120) in fake.calls
        assert not (tmp / "escape.log").exists() and not (tmp / "trial" / "evaluator" / "escape.log").exists()


# L1 hook evidence. The fixtures under fixtures/l1/hooks are real sessions: Claude Code 2.1.312 in the L1 arm images (after,
# off and before, gstack 699a41cb and 82db89ab) against arms/l1.ts's fake upstream, the after arm untold and told
# (/investigate) with arms/l1.ts's FIXTURE_PROMPT. Each holds what the container had after the session under
# /root/.claude/projects (the transcript, cut to its user, assistant, hook and last-prompt lines) and /root/.gstack (the hook
# logs and contract records the after pin's hooks wrote).
HOOK_FIX = Path(__file__).parent / "fixtures" / "l1" / "hooks"


def _dir_tar(root: Path) -> bytes:
    files = {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()} if root.is_dir() else {}
    return _hook_tar(files) if files else b""


def evidence_agent(tmp, fake, case="", gstack=None, transcripts=None, fail=()):
    """A hooks agent whose container holds a fixture case's hook state and transcripts; fail lists copy scripts that exit 2."""
    a = hooks_agent(tmp, fake)
    plain = a._exec
    state = {lh.GSTACK_HOOK_STATE: _dir_tar(HOOK_FIX / case / "gstack") if gstack is None else gstack,
             lh.CLAUDE_TRANSCRIPTS: _dir_tar(HOOK_FIX / case / "claude-projects") if transcripts is None else transcripts}

    def exec_(container, script, stdin=None, timeout=300):
        if script not in state:
            return plain(container, script, stdin, timeout)
        fake.calls.append(("exec", script[:40], timeout))
        return subprocess.CompletedProcess(script, 2, b"", b"tar: failed") if script in fail else subprocess.CompletedProcess(script, 0, state[script], b"")

    a._exec = exec_
    return a


def l1(tmp):
    ev = json.loads((tmp / "trial" / "evaluator" / "l1-evidence.json").read_text())
    summary = json.loads((tmp / "trial" / "evaluator" / "laneb-summary.json").read_text())
    assert {k: summary[k] for k in ev} == ev, summary
    return [ev["route_hook"], ev["contract_record"], ev["contract_check_met"]], summary


def _transcript(case):
    return next((HOOK_FIX / case / "claude-projects").glob("*/*.jsonl"))


def _tar_one(name, data):
    return _hook_tar({name: data})


def test_l1_evidence_from_real_sessions_in_the_after_arm(tmp):
    run(evidence_agent(tmp, Fake(tmp), "after-untold"))
    assert l1(tmp)[0] == [True, False, None]
    run(evidence_agent(tmp, Fake(tmp), "after-told"))
    assert l1(tmp)[0] == [False, True, False]


def test_l1_evidence_in_the_none_before_and_off_arms_is_false_false_null(tmp):
    for case in ("off-untold", "before-told"):
        run(evidence_agent(tmp, Fake(tmp), case))
        assert l1(tmp)[0] == [False, False, None], case
    run(evidence_agent(tmp, Fake(tmp), "before-told", gstack=b""))
    assert l1(tmp)[0] == [False, False, None]


def test_a_silent_route_hook_or_the_mark_in_a_tool_result_reads_false(tmp):
    t = _transcript("after-untold")
    lines = t.read_text().splitlines()
    silent = "\n".join(l for l in lines if "hook_additional_context" not in l) + "\n"
    assert silent.count("\n") == len(lines) - 1
    run(evidence_agent(tmp, Fake(tmp), "after-untold", transcripts=_tar_one("-app/" + t.name, silent.encode())))
    assert l1(tmp)[0] == [False, False, None]
    read = json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": lh.ROUTE_MARK + " matched ..."}]}})
    run(evidence_agent(tmp, Fake(tmp), "after-untold", transcripts=_tar_one("-app/" + t.name, (silent + read + "\n").encode())))
    assert l1(tmp)[0] == [False, False, None]


def test_the_contract_records_last_investigate_run_decides_met(tmp):
    rec_path = next((HOOK_FIX / "after-told" / "gstack" / "skill-contracts").glob("*.json"))
    rec = json.loads(rec_path.read_text())
    logs = {"hooks/" + p.name: p.read_bytes() for p in (HOOK_FIX / "after-told" / "gstack" / "hooks").iterdir()}
    for outcome, met in (("met", True), ("met_after_block", True), ("met_waived", True), ("blocked", False), ("miss", False), ("deferred", None)):
        runs = {"investigate@3": {**rec["runs"]["investigate@3"], "outcome": outcome, "updated_at": "2026-11-04T14:57:40.000Z"},
                "investigate@1": {**rec["runs"]["investigate@3"], "outcome": "miss", "updated_at": "2026-11-04T14:57:20.000Z"}}
        state = _hook_tar({**logs, "skill-contracts/" + rec_path.name: json.dumps({**rec, "runs": runs}).encode()})
        run(evidence_agent(tmp, Fake(tmp), "after-told", gstack=state))
        assert l1(tmp)[0] == [False, True, met], outcome
    other = _hook_tar({"skill-contracts/" + rec_path.name: json.dumps({**rec, "runs": {"review@4": {"skill": "review", "outcome": "met"}}}).encode()})
    run(evidence_agent(tmp, Fake(tmp), "after-told", gstack=other))
    assert l1(tmp)[0] == [False, True, None]
    broken = _hook_tar({"skill-contracts/" + rec_path.name: b"{not json"})
    run(evidence_agent(tmp, Fake(tmp), "after-told", gstack=broken))
    assert l1(tmp)[0] == [False, None, None]


def test_an_investigate_run_with_no_iso_updated_at_leaves_met_null(tmp):
    # A run with no updated_at sorted as "None", after every ISO date, so it decided the outcome; a number sorted before.
    rec_path = next((HOOK_FIX / "after-told" / "gstack" / "skill-contracts").glob("*.json"))
    rec = json.loads(rec_path.read_text())
    base = rec["runs"]["investigate@3"]
    for odd in ({k: v for k, v in base.items() if k != "updated_at"}, {**base, "updated_at": 1762268260000}, {**base, "updated_at": None}):
        runs = {"investigate@1": {**base, "outcome": "met", "updated_at": "2026-11-04T14:57:40.000Z"}, "investigate@2": {**odd, "outcome": "miss"}}
        state = _hook_tar({"skill-contracts/" + rec_path.name: json.dumps({**rec, "runs": runs}).encode()})
        run(evidence_agent(tmp, Fake(tmp), "after-told", gstack=state))
        assert l1(tmp)[0] == [False, True, None], odd.get("updated_at")


def test_a_missing_or_ambiguous_transcript_is_null_not_false(tmp):
    run(evidence_agent(tmp, Fake(tmp), "after-told", transcripts=b""))
    assert l1(tmp)[0] == [None, None, None]
    t = _transcript("after-told")
    two = _hook_tar({"-app/" + t.name: t.read_bytes(), "-app/0ec3d633-4c98-4c9b-a3a6-3dbbb46b8800.jsonl": _transcript("off-untold").read_bytes()})
    run(evidence_agent(tmp, Fake(tmp), "after-told", transcripts=two))
    assert l1(tmp)[0] == [None, None, None]
    sub = _hook_tar({"-app/" + t.name: t.read_bytes(), "-app/" + t.stem + "/subagents/agent-1.jsonl": b"{}\n"})
    run(evidence_agent(tmp, Fake(tmp), "after-told", transcripts=sub))
    assert l1(tmp)[0] == [False, True, False]
    assert (tmp / "trial" / "evaluator" / "claude-projects" / "-app" / t.stem / "subagents" / "agent-1.jsonl").exists()


def test_a_failed_copy_is_recorded_leaves_its_fields_null_and_never_skips_the_patch_or_close(tmp):
    for fail, want in (((lh.CLAUDE_TRANSCRIPTS,), [None, None, None]), ((lh.GSTACK_HOOK_STATE,), [False, None, None]), ((lh.CLAUDE_TRANSCRIPTS, lh.GSTACK_HOOK_STATE), [None, None, None])):
        fake = Fake(tmp)
        run(evidence_agent(tmp, fake, "after-told", fail=fail))
        got, summary = l1(tmp)
        assert got == want, fail
        assert {"transcripts" if s == lh.CLAUDE_TRANSCRIPTS else "gstack_hooks" for s in fail} <= set(summary["teardown_errors"]), summary["teardown_errors"]
        assert summary["patch"]["event"] == "patch" and summary["session"]["ok_responses"] == 2
        close = fake.calls.index(("post", "close", 120))
        assert all(fake.calls.index(("exec", s[:40], la.PROBE_TIMEOUT_S)) > close for s in (lh.GSTACK_HOOK_STATE, lh.CLAUDE_TRANSCRIPTS))


def test_the_hook_record_paths_are_the_after_pins(tmp):
    # gstack 699a41cb: lib/state-root.ts resolveStateRoot ($HOME/.gstack with no GSTACK_STATE_ROOT, GSTACK_HOME or
    # GSTACK_STATE_DIR), lib/skill-contract.ts recordPath (<root>/skill-contracts/<session id>.json) and lib/skill-route.ts
    # traceLogPath (<root>/hooks/<hook>.log, lines "<time> session=<id> event=<event> ..."). Claude Code 2.1.312 keeps the
    # session transcript at $CLAUDE_CONFIG_DIR/projects/<cwd with / as ->/<session id>.jsonl.
    assert lh.GSTACK_HOOK_STATE.startswith("cd /root/.gstack 2>/dev/null || exit 0;") and "for d in hooks skill-contracts;" in lh.GSTACK_HOOK_STATE
    assert lh.CLAUDE_TRANSCRIPTS.startswith("cd /root/.claude/projects 2>/dev/null || exit 0;") and "*/*.jsonl */*/subagents/*.jsonl" in lh.CLAUDE_TRANSCRIPTS
    t = _transcript("after-told")
    rec = json.loads((HOOK_FIX / "after-told" / "gstack" / "skill-contracts" / (t.stem + ".json")).read_text())
    assert rec["session_id"] == t.stem and rec["transcript_path"] == "/root/.claude/projects/-app/" + t.name
    for case, hook, event in (("after-told", "skill-contract", "event=blocked"), ("after-told", "skill-route", "event=no-route reason=slash-command"), ("after-untold", "skill-route", "event=routed skill=investigate")):
        session = _transcript(case).stem
        assert any(("session=" + session + " " + event) in line for line in (HOOK_FIX / case / "gstack" / "hooks" / (hook + ".log")).read_text().splitlines()), (case, hook)


def test_both_copy_scripts_run_under_the_real_sh_and_tar_on_a_leading_dash_project_folder(tmp):
    # Claude Code names a project folder after the cwd, so it starts with a dash (-app). The copy scripts run as written,
    # under sh and the host's tar, against the after-told session's real tree.
    roots = {"/root/.claude/projects": HOOK_FIX / "after-told" / "claude-projects", "/root/.gstack": HOOK_FIX / "after-told" / "gstack"}
    fake = Fake(tmp)
    a = hooks_agent(tmp, fake)
    plain = a._exec

    def exec_(container, script, stdin=None, timeout=300):
        if script not in (lh.GSTACK_HOOK_STATE, lh.CLAUDE_TRANSCRIPTS):
            return plain(container, script, stdin, timeout)
        for path, real in roots.items():
            script = script.replace(path, str(real))
        return subprocess.run(["sh", "-c", script], capture_output=True, timeout=timeout)

    a._exec = exec_
    run(a)
    got, summary = l1(tmp)
    assert not {"transcripts", "gstack_hooks"} & set(summary["teardown_errors"]), summary["teardown_errors"]
    assert got == [False, True, False]
    assert next((tmp / "trial" / "evaluator" / "claude-projects" / "-app").glob("*.jsonl")).stem == _transcript("after-told").stem
    assert (tmp / "trial" / "evaluator" / "gstack-hooks" / "hooks" / "skill-contract.log").exists()


def test_a_copy_whose_tar_passes_the_cap_is_refused_inside_the_container(tmp):
    # Both copy scripts measure their tar before they send it, so a tree past the cap is a failed copy (fields null), never a
    # tar the agent buffers whole. The cap is lowered to 1 KiB here; the real scripts run under sh and tar.
    roots = {"/root/.claude/projects": HOOK_FIX / "after-told" / "claude-projects", "/root/.gstack": HOOK_FIX / "after-told" / "gstack"}
    fake = Fake(tmp)
    a = hooks_agent(tmp, fake)
    plain = a._exec

    def exec_(container, script, stdin=None, timeout=300):
        if script not in (lh.GSTACK_HOOK_STATE, lh.CLAUDE_TRANSCRIPTS):
            return plain(container, script, stdin, timeout)
        for path, real in roots.items():
            script = script.replace(path, str(real))
        return subprocess.run(["sh", "-c", script.replace(str(lh.TREE_CAP_BYTES), "1024")], capture_output=True, timeout=timeout)

    a._exec = exec_
    run(a)
    got, summary = l1(tmp)
    assert got == [None, None, None]
    assert "over the 1024-byte cap" in summary["teardown_errors"]["transcripts"], summary["teardown_errors"]
    assert "over the 1024-byte cap" in summary["teardown_errors"]["gstack_hooks"], summary["teardown_errors"]
    assert str(lh.TREE_CAP_BYTES) in lh.CLAUDE_TRANSCRIPTS and str(lh.TREE_CAP_BYTES) in lh.GSTACK_HOOK_STATE


def test_a_tree_that_grows_between_the_measure_and_the_send_still_sends_at_most_the_cap(tmp):
    # A process the model left running can grow the tree while the copy runs. The tar shim here prints a small archive the
    # first time (the measure) and runs the real tar on the tree, grown to a megabyte, after that, so a send with no bound
    # would pass the megabyte on; the bounded send passes at most the cap plus one byte and is refused in the container. The
    # cap is lowered to 1 KiB.
    shim = tmp / "bin"
    shim.mkdir()
    (tmp / "x").mkdir()
    (tmp / "x" / "grown").write_bytes(bytes(1000000))
    (shim / "tar").write_text('#!/bin/sh\nn=$(cat "$COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$COUNT"\nif [ "$n" -eq 1 ]; then printf small; else exec "$REAL_TAR" "$@"; fi\n')
    (shim / "tar").chmod(0o755)
    env = {**os.environ, "PATH": f"{shim}:{os.environ['PATH']}", "COUNT": str(tmp / "count"), "REAL_TAR": shutil.which("tar")}
    res = subprocess.run(["sh", "-c", lh._CAPPED_TAR.replace(str(lh.TREE_CAP_BYTES), "1024"), "sh", "x"], capture_output=True, env=env, cwd=tmp, timeout=60)
    assert len(res.stdout) <= 1025, len(res.stdout)
    assert res.returncode == 3 and b"grew past the 1024-byte cap" in res.stderr, (res.returncode, res.stderr)


# Harness mechanics live judge wiring (lanes/harness-mechanics/README.md "Not built"): LanebHooksAgent.run binds a judge
# metering-proxy slot per judge session, injects HM_JUDGE_PROXY / HM_JUDGE_TOKEN / HM_JUDGE_CONFIG into the session's env
# and the claude wrapper's docker exec forward, and stops the batch on a jevChanges line. A non-judge arm takes the pinned
# super().run byte for byte. manage() and query() are stubbed, as Harbor and the SDK are elsewhere in this file.
_REAL_MANAGE = lh.manage
_JUDGE_ENV = ("HM_JUDGE_PROXY_BASE", "HM_JUDGE_MGMT_SOCKET", "HM_JUDGE_MGMT_TOKEN", "HM_JUDGE_STOP_FILE", "HM_JUDGE_JOURNAL")
_HARBOR_JOB = "pilot-opus"


def _harbor_logs_dir(tmp, task):
    # Harbor's layout at the pin (f3a5a923): jobs/<job>/<trial>/agent, the trial named for the task cut to 32 characters
    # less trailing _ and -, plus "__" and 7 characters. The job dir names the job, never the task.
    return tmp / "jobs" / _HARBOR_JOB / (task[:32].rstrip("_-") + "__Ab3dE9x") / "agent"


def _judge_agent(tmp, fake, backend, markers_file=None, markers_dir=None, task="task-a", harbor_layout=False, config=True):
    a = hooks_agent(tmp, fake)
    a.options.judge_backend = backend
    a.options.markers_file = str(markers_file) if markers_file else None
    a.options.markers_dir = str(markers_dir) if markers_dir else None
    a.options.judge_allowance_micros = 2_000_000
    if harbor_layout:
        a.logs_dir = _harbor_logs_dir(tmp, task)
        a.logs_dir.mkdir(parents=True, exist_ok=True)
    # Harbor writes the trial's config.json into the trial dir before the agent starts (Trial._init_result); the judge path
    # reads the task from its task.path.
    if config:
        (a.logs_dir.parent / "config.json").write_text(json.dumps({"task": {"path": "/work/run/tasks/" + task}, "trial_name": a.logs_dir.parent.name}))
    return a


def _run_judge(tmp, fake, backend, markers_file=None, hook_log="", stop_file=None, markers_dir=None, task="task-a", harbor_layout=False, config=True, journal="", hook_rc=0, hook_file=None):
    calls = []

    def fake_manage(route, body):
        calls.append((route, body))
        return {"slot": "sJUDGE", "token": "gse_jtok", "meter_id": "mJUDGE"} if route == "/bind" else {"meter_id": "mJUDGE", "micros": 0}

    captured = {}

    async def cap_query(prompt, options):
        captured["options"] = options
        for m in ():
            yield m

    a = _judge_agent(tmp, fake, backend, markers_file, markers_dir=markers_dir, task=task, harbor_layout=harbor_layout, config=config)
    base_exec = a._exec

    def exec_(container, script, stdin=None, timeout=300):
        if hook_file is not None and lh.JUDGE_HOOK_LOG in script:
            return subprocess.run(["sh", "-c", script.replace(lh.JUDGE_HOOK_LOG, str(hook_file))], capture_output=True)
        if script.startswith("cat " + lh.JUDGE_HOOK_LOG):
            return subprocess.CompletedProcess(script, hook_rc, b"" if hook_rc else hook_log.encode(), b"Error response from daemon: container is not running" if hook_rc else b"")
        return base_exec(container, script, stdin, timeout)

    a._exec = exec_
    lh.manage = fake_manage
    la.query = cap_query
    os.environ["HM_JUDGE_PROXY_BASE"] = "http://172.17.0.1:8790"
    os.environ["HM_JUDGE_MGMT_SOCKET"] = str(tmp / "m.sock")
    os.environ["HM_JUDGE_MGMT_TOKEN"] = "x" * 32
    os.environ.pop("HM_JUDGE_STOP_FILE", None)
    if stop_file is not None:
        os.environ["HM_JUDGE_STOP_FILE"] = str(stop_file)
    os.environ.pop("HM_JUDGE_JOURNAL", None)
    if journal is not None:
        (tmp / "judge-journal.ndjson").write_text(journal)
        os.environ["HM_JUDGE_JOURNAL"] = str(tmp / "judge-journal.ndjson")
    try:
        run(a)
    finally:
        lh.manage = _REAL_MANAGE
        for k in _JUDGE_ENV:
            os.environ.pop(k, None)
    return calls, captured


def test_a_non_judge_hooks_arm_takes_the_pinned_super_run_and_sets_no_judge_env(tmp):
    fake = Fake(tmp)
    calls = []
    lh.manage = lambda route, body: calls.append((route, body))
    captured = {}

    async def cap_query(prompt, options):
        captured["options"] = options
        for m in ():
            yield m

    a = hooks_agent(tmp, fake)  # the default options carry no judge_backend
    la.query = cap_query
    try:
        run(a)
    finally:
        lh.manage = _REAL_MANAGE
    assert calls == [], "a non-judge arm bound a judge slot"
    env = captured["options"]["env"]
    assert not [k for k in env if k.startswith("HM_JUDGE")], env
    assert (tmp / "trial" / "evaluator" / "laneb-summary.json").exists()


def test_the_judge_path_binds_a_slot_with_custody_and_sets_the_three_env_vars_in_env_and_forward(tmp):
    fake = Fake(tmp)
    canary = "DRCANARY-" + "0123456789abcdef" * 2
    markers = tmp / "markers.json"
    markers.write_text(json.dumps([canary, "test_hidden_regression_case"]))
    calls, captured = _run_judge(tmp, fake, "jev", markers_file=markers)
    assert [r for r, _ in calls] == ["/bind", "/unbind", "/finalize"], calls
    bind = next(b for r, b in calls if r == "/bind")
    assert bind["forbidden_markers"] == [canary, "test_hidden_regression_case"]
    assert bind["canary"] == canary
    assert bind["models"] == lh.JUDGE_DECIDERS and bind["deciders"] == lh.JUDGE_DECIDERS
    assert bind["allowance_micros"] == 2_000_000
    env = captured["options"]["env"]
    assert env["HM_JUDGE_PROXY"] == "http://172.17.0.1:8790/sJUDGE"
    assert env["HM_JUDGE_TOKEN"] == "gse_jtok"
    assert env["HM_JUDGE_CONFIG"] == "/root/.hm/judge/judge-jev.json"
    wrapper = Path(captured["options"]["cli_path"]).read_text()
    for name in ("HM_JUDGE_PROXY", "HM_JUDGE_TOKEN", "HM_JUDGE_CONFIG"):
        assert ("-e " + name) in wrapper, wrapper


def test_judge_markers_file_resolves_per_task_from_markers_dir_and_requires_the_file(tmp):
    # One agent config serves every task in a judge rectangle, so custody is resolved per task from <markers_dir>/<task>.json.
    mdir = tmp / "judge-markers"
    mdir.mkdir()
    ca, cb = "DRCANARY-" + "a" * 32, "DRCANARY-" + "b" * 32
    (mdir / "task-a.json").write_text(json.dumps([ca, "test_alpha_regression"]))
    (mdir / "task-b.json").write_text(json.dumps([cb, "test_beta_regression"]))
    opt = types.SimpleNamespace(markers_dir=str(mdir), markers_file=None)
    ma, cana = lh.judge_custody(lh.judge_markers_file(opt, "task-a"))
    mb, canb = lh.judge_custody(lh.judge_markers_file(opt, "task-b"))
    assert cana == ca and canb == cb and cana != canb, (cana, canb)
    assert ma == [ca, "test_alpha_regression"] and mb == [cb, "test_beta_regression"]
    # A markers_dir with no file for this task is a hard error, never a markerless bind.
    try:
        lh.judge_markers_file(opt, "task-c")
        raise AssertionError("a missing per-task markers file did not raise")
    except lh.JudgeManagementError:
        pass
    # markers_dir takes precedence; without it the single markers_file is used, and with neither the bind is markerless.
    single = tmp / "single.json"
    single.write_text(json.dumps([ca]))
    assert lh.judge_markers_file(types.SimpleNamespace(markers_dir=None, markers_file=str(single)), "task-a") == str(single)
    assert lh.judge_markers_file(types.SimpleNamespace(markers_dir=None, markers_file=None), "task-a") is None


def test_the_judge_path_resolves_the_tasks_markers_from_markers_dir_at_runtime(tmp):
    fake = Fake(tmp)
    mdir = tmp / "judge-markers"
    mdir.mkdir()
    canary = "DRCANARY-" + "c" * 32
    (mdir / "task-a.json").write_text(json.dumps([canary, "test_hidden_alpha"]))
    calls, captured = _run_judge(tmp, fake, "jev", markers_dir=mdir, task="task-a")
    bind = next(b for r, b in calls if r == "/bind")
    assert bind["cell"]["task"] == "task-a", bind["cell"]
    assert bind["forbidden_markers"] == [canary, "test_hidden_alpha"]
    assert bind["canary"] == canary


def test_judge_p1_uses_the_p1_config_and_binds_markerless_without_a_markers_file(tmp):
    fake = Fake(tmp)
    calls, captured = _run_judge(tmp, fake, "p1", markers_file=None)
    assert captured["options"]["env"]["HM_JUDGE_CONFIG"] == "/root/.hm/judge/judge-p1.json"
    bind = next(b for r, b in calls if r == "/bind")
    assert "forbidden_markers" not in bind and "canary" not in bind, bind


def test_a_jev_changes_line_in_the_hook_log_stops_the_batch_by_writing_the_stop_file(tmp):
    fake = Fake(tmp)
    stop = tmp / "STOP"
    log = json.dumps({"point": "done", "backend": "jev", "jev_version": "jev-9.9.9", "stopped": False}) + "\n"
    _run_judge(tmp, fake, "jev", hook_log=log, stop_file=stop)
    assert stop.exists(), "a jevChanges line wrote no STOP file"
    rec = json.loads(stop.read_text().strip())
    assert rec["reason"] == "jevChanges" and rec["arm"] == "none"
    assert (tmp / "trial" / "evaluator" / "judge-jevchanges.json").exists()


def test_a_clean_judge_hook_log_writes_no_stop_file(tmp):
    fake = Fake(tmp)
    stop = tmp / "STOP"
    log = json.dumps({"point": "done", "backend": "jev", "jev_version": lh.JEV_MODEL, "stopped": False}) + "\n"
    _run_judge(tmp, fake, "jev", hook_log=log, stop_file=stop)
    assert not stop.exists(), "a clean hook log wrote a STOP file"


_CLEAN_HOOK_LOG = json.dumps({"point": "done", "backend": "jev", "jev_version": lh.JEV_MODEL, "stopped": False}) + "\n"


def _summary(evdir):
    return json.loads((evdir / "laneb-summary.json").read_text())


def _events(evdir):
    return [json.loads(x) for x in (evdir / "usersim-events.jsonl").read_text().splitlines() if x.strip()]


def test_the_judge_task_comes_from_harbors_trial_config_in_harbors_layout_not_from_the_job_dir(tmp):
    # The job dir names the job (pilot-opus), so the old reading, logs_dir.parent.parent.name, took the job for the task and
    # looked up <markers_dir>/pilot-opus.json. The trial dir's name cuts a long task to 32 characters, so it is no task either.
    fake = Fake(tmp)
    task = "pydata__xarray-cutoff-name-past-32-chars-9876"
    logs = _harbor_logs_dir(tmp, task)
    assert logs.parent.parent.name == _HARBOR_JOB != task and logs.parent.name.split("__Ab3dE9x")[0] != task
    mdir = tmp / "judge-markers"
    mdir.mkdir()
    canary = "DRCANARY-" + "d" * 32
    (mdir / (task + ".json")).write_text(json.dumps([canary, "test_hidden_beta"]))
    calls, _ = _run_judge(tmp, fake, "jev", markers_dir=mdir, task=task, harbor_layout=True, hook_log=_CLEAN_HOOK_LOG)
    binds = [b for r, b in calls if r == "/bind"]
    assert len(binds) == 1, calls
    assert binds[0]["cell"]["task"] == task, binds[0]["cell"]
    assert binds[0]["forbidden_markers"] == [canary, "test_hidden_beta"] and binds[0]["canary"] == canary
    assert lh.judge_task(logs) == task


def test_a_trial_with_no_readable_config_fails_closed_and_binds_no_slot(tmp):
    fake = Fake(tmp)
    calls, _ = _run_judge(tmp, fake, "jev", config=False, hook_log=_CLEAN_HOOK_LOG)
    assert not [r for r, _ in calls if r == "/bind"], calls
    errors = [e for e in _events(tmp / "trial" / "evaluator") if e.get("event") == "agent_error"]
    assert errors and errors[0]["type"] == "JudgeManagementError" and "config.json" in errors[0]["message"], errors


def test_a_judge_arm_with_no_judge_journal_set_fails_before_the_session_opens(tmp):
    fake = Fake(tmp)
    try:
        _run_judge(tmp, fake, "jev", journal=None)
    except lh.JudgeManagementError as e:
        assert "HM_JUDGE_JOURNAL" in str(e)
    else:
        raise AssertionError("a judge arm ran with no HM_JUDGE_JOURNAL")
    assert not fake.open_bodies, "a session opened with no judge journal to check"


def _journal(*lines):
    return "".join(json.dumps(x) + "\n" for x in lines)


def test_a_custody_hit_on_this_sessions_meter_writes_the_stop_file_and_the_summary_records_it(tmp):
    stop = tmp / "STOP"
    journal = _journal(
        {"kind": "refusal", "code": "DR_CUSTODY_HIT", "meter_id": "mJUDGE", "provider": "openrouter", "route": "openrouter", "model": "particle-ai/particle-1", "reason": "canary", "source": "proxy"},
        {"kind": "marker_hit", "meter_id": "mJUDGE", "provider": "openrouter", "route": "openrouter", "model": "particle-ai/particle-1", "source": "proxy", "decider": "openrouter:particle-ai/particle-1", "cell": {}, "markers": []},
        {"kind": "refusal", "code": "DR_CUSTODY_HIT", "meter_id": "mOTHER"},
    )
    _run_judge(tmp, Fake(tmp), "jev", stop_file=stop, journal=journal, hook_log=_CLEAN_HOOK_LOG)
    assert stop.exists(), "a custody hit wrote no STOP file"
    rec = json.loads(stop.read_text().strip())
    assert rec["reason"] == "custody_hit" and rec["meter_id"] == "mJUDGE" and rec["custody_hits"] == 1 and rec["marker_hits"] == 1, rec
    evdir = tmp / "trial" / "evaluator"
    assert _summary(evdir)["judge_hits"] == {"meter_id": "mJUDGE", "custody_hits": 1, "marker_hits": 1, "refusals": {}}
    assert [e for e in _events(evdir) if e.get("event") == "custody_hit_stop"]


def test_with_no_custody_hit_the_journal_check_records_marker_hits_and_refusal_counts_and_writes_no_stop(tmp):
    stop = tmp / "STOP"
    journal = _journal(
        {"kind": "marker_hit", "meter_id": "mJUDGE"},
        {"kind": "refusal", "code": "CAP_STOP", "meter_id": "mJUDGE"},
        {"kind": "refusal", "code": "DR_ALLOWANCE_STOP", "meter_id": "mJUDGE"},
        {"kind": "refusal", "code": "DR_CUSTODY_HIT", "meter_id": "mOTHER"},
    ) + "a torn line\n"
    _run_judge(tmp, Fake(tmp), "jev", stop_file=stop, journal=journal, hook_log=_CLEAN_HOOK_LOG)
    assert not stop.exists(), "another session's custody hit, or a refusal, wrote a STOP file"
    evdir = tmp / "trial" / "evaluator"
    assert _summary(evdir)["judge_hits"] == {"meter_id": "mJUDGE", "custody_hits": 0, "marker_hits": 1, "refusals": {"CAP_STOP": 1, "DR_ALLOWANCE_STOP": 1}}


def test_a_failed_hook_log_copy_is_recorded_in_teardown_errors_and_writes_no_hook_log(tmp):
    _run_judge(tmp, Fake(tmp), "jev", hook_rc=1)
    evdir = tmp / "trial" / "evaluator"
    assert not (evdir / "judge-hooks.jsonl").exists(), "an unread hook log was written as an empty copy"
    errors = _summary(evdir)["teardown_errors"]
    assert "judge hook log copy failed: docker exec exited 1" in errors["judge_hook_log"], errors


def test_a_hook_log_the_hook_never_wrote_fails_the_copy_in_a_real_shell_and_writes_no_hook_log(tmp):
    _run_judge(tmp, Fake(tmp), "jev", hook_file=tmp / "never-written.jsonl")
    evdir = tmp / "trial" / "evaluator"
    assert not (evdir / "judge-hooks.jsonl").exists(), "a hook log the hook never wrote was copied out as an empty log"
    errors = _summary(evdir)["teardown_errors"]
    assert "judge hook log copy failed: docker exec exited 1" in errors["judge_hook_log"], errors


def test_a_hook_log_with_lines_copies_out_in_a_real_shell_and_records_no_teardown_error(tmp):
    (tmp / "hooks.jsonl").write_text(_CLEAN_HOOK_LOG)
    _run_judge(tmp, Fake(tmp), "jev", hook_file=tmp / "hooks.jsonl")
    evdir = tmp / "trial" / "evaluator"
    assert (evdir / "judge-hooks.jsonl").read_text() == _CLEAN_HOOK_LOG
    assert not [k for k in _summary(evdir)["teardown_errors"] if k.startswith("judge_")]


def test_a_hook_log_copy_that_succeeds_is_written_and_records_no_teardown_error(tmp):
    _run_judge(tmp, Fake(tmp), "jev", hook_log=_CLEAN_HOOK_LOG)
    evdir = tmp / "trial" / "evaluator"
    assert (evdir / "judge-hooks.jsonl").read_text() == _CLEAN_HOOK_LOG
    assert not [k for k in _summary(evdir)["teardown_errors"] if k.startswith("judge_")]


def _assert_no_provider_key(env, wrapper, stubs):
    # The one credential a session carries is ANTHROPIC_API_KEY, and it is the Lane B proxy's session token ("laneb-token"
    # in these fakes), never a real provider key. No other provider key name is in the env or the docker exec -e forward,
    # and no planted key value appears in either, so the task container the wrapper exec's into never receives one.
    assert env["ANTHROPIC_API_KEY"] == "laneb-token", env["ANTHROPIC_API_KEY"]
    assert "-e ANTHROPIC_API_KEY" in wrapper, wrapper
    for name in ("OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "OPENAI_API_KEY"):
        assert name not in env, name
        assert ("-e " + name) not in wrapper, (name, wrapper)
    for value in stubs.values():
        assert value not in env.values(), value
        assert value not in wrapper, (value, wrapper)


def test_no_provider_key_reaches_a_session_env_or_the_docker_exec_forward(tmp):
    # Even with real-looking provider keys in the process env, a session (judge arm or not) runs with only
    # ANTHROPIC_API_KEY set to the Lane B proxy's session token, plus HM_JUDGE_TOKEN set to the slot token on the judge
    # path. This holds with or without the host shipping the judge proxy's keys to the part VM, because the session env is
    # built fresh rather than inherited.
    stubs = {"ANTHROPIC_API_KEY": "placeholder-anthropic", "OPENROUTER_API_KEY": "placeholder-openrouter",
             "TYPESAFE_API_KEY": "placeholder-typesafe", "OPENAI_API_KEY": "placeholder-openai"}
    saved = {k: os.environ.get(k) for k in stubs}
    os.environ.update(stubs)
    try:
        canary = "DRCANARY-" + "0123456789abcdef" * 2
        markers = tmp / "markers.json"
        markers.write_text(json.dumps([canary, "test_hidden_regression_case"]))
        _, jcap = _run_judge(tmp, Fake(tmp), "p1", markers_file=markers)
        jenv = jcap["options"]["env"]
        jwrap = Path(jcap["options"]["cli_path"]).read_text()
        assert jenv["HM_JUDGE_TOKEN"] == "gse_jtok", jenv
        _assert_no_provider_key(jenv, jwrap, stubs)

        ncap = {}

        async def cap_query(prompt, options):
            ncap["options"] = options
            for _m in ():
                yield _m

        a = hooks_agent(tmp, Fake(tmp))  # default options carry no judge_backend: the pinned super().run path
        la.query = cap_query
        try:
            run(a)
        finally:
            lh.manage = _REAL_MANAGE
        nenv = ncap["options"]["env"]
        nwrap = Path(ncap["options"]["cli_path"]).read_text()
        assert not [k for k in nenv if k.startswith("HM_JUDGE")], nenv
        _assert_no_provider_key(nenv, nwrap, stubs)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


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
