"""Keyless tests for the Lane B Harbor agent and the user simulator.

Harbor and the Agent SDK are replaced by stubs, so this runs anywhere with python3. Run by agent.test.ts, which puts
runner/agent on PYTHONPATH.
"""

import asyncio
import io
import json
import os
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
        max_output_tokens=32000, sdk_max_turns=5, close_timeout_sec=120, system_prompt="sdk-default", session_kind="", told_skill="", procedure_line="",
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
