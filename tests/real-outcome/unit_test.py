"""Keyless unit tests of the real-outcome agent's parts that need no SDK: the ship persona, the /ship step log, the
egress rules and the turn texts. The Agent SDK and Harbor are stubbed only so real_agent imports; agent_test.py runs the
agent itself on the real SDK. Run by agent-units.test.ts with python3.
"""

import json
import sys
import tempfile
import traceback
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path[:0] = [str(ROOT / "lanes/real-outcome/agent"), str(ROOT / "quick/laneb/runner/agent")]


def module(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


try:
    import claude_agent_sdk  # noqa: F401
    import harbor  # noqa: F401
except ImportError:
    class StubOptions:
        pass

    class StubClaudeCode:
        pass

    module("claude_agent_sdk", ClaudeAgentOptions=lambda **k: k, ClaudeSDKClient=object, query=None)
    module("claude_agent_sdk.types", HookMatcher=lambda **k: k, PermissionResultAllow=lambda **k: k, TERMINAL_TASK_STATUSES=frozenset({"completed", "failed", "stopped", "killed"}))
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

import egress  # noqa: E402
import real_agent as ra  # noqa: E402
from ship_steps import ship_steps  # noqa: E402
from ship_user import ShipUser  # noqa: E402

PERSONA = json.loads((ROOT / "lanes/real-outcome/agent/ship-persona.json").read_text())
ARMS = json.loads((ROOT / "lanes/real-outcome/arms/arms.json").read_text())


def user():
    return ShipUser(PERSONA, Path(tempfile.mkdtemp()) / "events.jsonl")


def q(question, *labels):
    return {"question": question, "options": [{"label": label, "description": ""} for label in labels]}


def test_build_turn_holds_shipping_and_follows_recommendations():
    u = user()
    u.start("build")
    a = u.answer([q("Ready to commit and open a PR?", "Yes", "No"), q("Which parser?", "regex", "ast (Recommended)"), q("Which name?", "foo", "bar")])
    assert a == {"Ready to commit and open a PR?": PERSONA["hold"], "Which parser?": "ast (Recommended)", "Which name?": PERSONA["fallback"]}, a
    assert u.counts["build"] == {"questions": 3, "recommended": 1, "fallback": 1, "hold": 1, "prose": 0, "prose_unanswered": 0}, u.counts


def test_ship_turn_answers_ship_questions_with_the_recommendation():
    u = user()
    u.start("ship")
    a = u.answer([q("Push and open the PR now?", "Push now (Recommended)", "Wait"), q("Bump the version?", "MINOR", "PATCH")])
    assert a == {"Push and open the PR now?": "Push now (Recommended)", "Bump the version?": PERSONA["fallback"]}, a


def test_not_recommended_is_not_a_recommendation():
    u = user()
    u.start("ship")
    a = u.answer([q("Mode?", "fast (not recommended)", "safe")])
    assert a == {"Mode?": PERSONA["fallback"]}, a


def test_prose_questions_get_the_fallback_up_to_the_limit():
    u = user()
    u.start("build")
    assert u.prose("Done. Should I add docs as well?") == PERSONA["fallback"]
    assert u.prose("All tests pass.") is None
    assert u.prose("Do you want me to push and open a PR?") is None
    for _ in range(PERSONA["prose_replies_per_turn"] - 1):
        assert u.prose("Want me to refactor the helper?") == PERSONA["fallback"]
    assert u.prose("Shall I also tidy the README?") is None
    assert u.counts["build"]["prose"] == PERSONA["prose_replies_per_turn"] and u.counts["build"]["prose_unanswered"] == 2, u.counts
    u.start("ship")
    assert u.prose("Should I open the PR as a draft?") == PERSONA["fallback"]


def test_only_the_closing_question_is_checked_for_ship_words():
    u = user()
    u.start("build")
    assert u.prose("I checked the base commit and left changes uncommitted.\n\nShould I also support streaming input?") == PERSONA["fallback"]
    assert u.prose("Should I commit and push this now?") is None
    events = [json.loads(line) for line in u.log_path.read_text().splitlines()]
    assert [e["source"] for e in events if e["event"] == "prose"] == ["fallback", "build_turn_ship_question"], events


def test_a_build_turn_recommendation_to_ship_is_never_approved():
    u = user()
    u.start("build")
    for text in (
        "I recommend pushing this and opening a PR. Want me to?",
        "I recommend pushing this branch and opening a PR.\n\nWant me to go ahead?",
        "Next step: git push.\nShould I go ahead?",
        "I'd suggest we open a pull request now.\n\nShall I?",
        "I recommend we ship it.\n\nOK to proceed?",
        "I can merge this into main.\n\nDo you want me to do that?",
    ):
        assert u.prose(text) is None, text
    events = [json.loads(line) for line in u.log_path.read_text().splitlines()]
    assert [e["source"] for e in events if e["event"] == "prose"] == ["build_turn_ship_question"] * 6, events
    u.start("ship")
    assert u.prose("I recommend pushing this branch and opening a PR.\n\nWant me to go ahead?") == PERSONA["fallback"]


def test_a_build_turn_recommendation_that_does_not_ship_gets_the_fallback():
    u = user()
    u.start("build")
    assert u.prose("I recommend adding a test for X. Should I?") == PERSONA["fallback"]
    assert u.prose("I recommend adding a test for X.\n\nShould I?") == PERSONA["fallback"]
    assert u.counts["build"]["prose"] == 2 and u.counts["build"]["prose_unanswered"] == 0, u.counts


def test_background_progress_keeps_the_wait_open_and_silence_expires_it():
    import asyncio
    import time

    class SystemMessage:
        def __init__(self, subtype, **data):
            self.subtype, self.data = subtype, {"subtype": subtype, **data}

    class ResultMessage:
        subtype, is_error = "success", False

    class Client:
        async def query(self, text):
            pass

    async def drive(progress_sec):
        q = asyncio.Queue()
        agent = types.SimpleNamespace(limits={"quiet_sec": 0.2, "bg_wait_sec": 0.6})

        async def feed():
            q.put_nowait(("message", SystemMessage("task_started", task_id="bg1")))
            q.put_nowait(("message", ResultMessage()))
            await asyncio.sleep(0.4)
            stop = time.time() + progress_sec
            while time.time() < stop:
                q.put_nowait(("message", SystemMessage("task_progress", task_id="bg1")))
                await asyncio.sleep(0.1)
            if progress_sec:
                q.put_nowait(("message", SystemMessage("task_notification", task_id="bg1", status="completed")))

        feeder = asyncio.ensure_future(feed())
        t0 = time.time()
        end = await ra.RealAgent._drive(agent, Client(), q, user(), "ship", "/ship", t0 + 10, lambda m, p: None)
        feeder.cancel()
        return end, time.time() - t0

    end, took = asyncio.run(drive(1.5))
    assert end["end"] == "quiet" and end["active_tasks"] == [] and took >= 1.9, (end, took)
    end, took = asyncio.run(drive(0))
    assert end["end"] == "bg_wait_expired" and end["active_tasks"] == ["bg1"] and took < 2, (end, took)


def test_a_stale_question_before_a_tool_call_gets_no_reply():
    import asyncio
    import time

    class TextBlock:
        def __init__(self, text):
            self.text = text

    class ToolUseBlock:
        pass

    class AssistantMessage:
        def __init__(self, *content):
            self.content = list(content)

    class UserMessage:
        content = []

    class ResultMessage:
        subtype, is_error = "success", False

    class Client:
        sent = []

        async def query(self, text):
            self.sent.append(text)

    async def go():
        q = asyncio.Queue()
        for m in (AssistantMessage(TextBlock("Should I also add docs?")), AssistantMessage(ToolUseBlock()), UserMessage(), ResultMessage()):
            q.put_nowait(("message", m))
        agent = types.SimpleNamespace(limits={"quiet_sec": 0.2, "bg_wait_sec": 1})
        return await ra.RealAgent._drive(agent, Client(), q, user(), "build", "Build it.", time.time() + 3, lambda m, p: None)

    end = asyncio.run(go())
    assert end["end"] == "quiet" and Client.sent == ["Build it."], (end, Client.sent)


def test_ship_steps_reads_tool_calls_and_their_errors():
    msgs = [
        {"content": [{"type": "tool_use", "id": "1", "name": "Skill", "input": {"skill": "ship"}}]},
        {"content": [{"type": "tool_use", "id": "2", "name": "Bash", "input": {"command": "~/.claude/skills/gstack/bin/gstack-ship-preflight --base main"}}]},
        {"content": [{"type": "tool_result", "tool_use_id": "2", "is_error": False}]},
        {"content": [{"type": "tool_use", "id": "3", "name": "Read", "input": {"file_path": "/root/.claude/skills/gstack/ship/sections/review-army.md"}}]},
        {"content": [{"type": "tool_use", "id": "4", "name": "Bash", "input": {"command": "git push -u origin feature"}}]},
        {"content": [{"type": "tool_result", "tool_use_id": "4", "is_error": True}]},
    ]
    out = ship_steps(msgs)
    status = {r["step"]: r["status"] for r in out["steps"]}
    assert status["1"] == "ran" and status["9"] == "ran" and status["17"] == "failed" and status["18-19"] == "skipped", status
    assert out["skill_calls"] == ["ship"] and out["tool_calls"] == 4, out


def test_egress_rules_drop_by_default_and_refuse_docker_dns_before_loopback():
    text = egress.ruleset([("10.0.0.2", 8787), ("10.0.0.3", 8790)])
    v4, v6 = text.split("table ip6 ")
    lines = [line.strip() for line in v4.splitlines()]
    assert "type filter hook output priority filter; policy drop;" in lines
    assert lines.index("ip daddr 127.0.0.11 drop") < lines.index('oifname "lo" accept'), lines
    assert "ip daddr 10.0.0.2 tcp dport 8787 accept" in lines and "ip daddr 10.0.0.3 tcp dport 8790 accept" in lines
    assert "policy drop;" in v6 and "accept" not in v6.replace('oifname "lo" accept', ""), v6
    for bad in ([("example.com", 80)], [("10.0.0.2", 0)]):
        try:
            egress.ruleset(bad)
        except (ValueError, AssertionError):
            pass
        else:
            raise AssertionError(f"accepted {bad}")


def test_egress_probe_judge():
    allow = [("10.0.0.2", 8787)]
    ok = {"10.0.0.2:8787": "open", "10.0.0.2:1": "ECONNREFUSED", "1.1.1.1:443": "ECONNREFUSED", "8.8.8.8:53": "timeout", "169.254.169.254:80": "ECONNREFUSED", "127.0.0.11:53": "timeout"}
    assert egress.judge_probe(ok, allow) == []
    assert egress.judge_probe({**ok, "1.1.1.1:443": "open"}, allow) == ["1.1.1.1:443 opened"]
    assert egress.judge_probe({**ok, "10.0.0.2:8787": "ECONNREFUSED"}, allow) == ["10.0.0.2:8787 did not open (ECONNREFUSED)"]
    missing = dict(ok)
    del missing["127.0.0.11:53"]
    assert egress.judge_probe(missing, allow) == ["127.0.0.11:53 has no probe result"]


def test_egress_probe_targets_are_unique_when_endpoints_share_an_address():
    for allow in ([("10.0.0.2", 8787), ("10.0.0.2", 8791)], [("10.0.0.2", 1), ("10.0.0.2", 2), ("10.0.0.2", 2)]):
        allowed, denied = egress.probe_targets(allow)
        targets = allowed + denied
        assert len(targets) == len(set(targets)), targets
        assert set(allowed) == {(ip, int(port)) for ip, port in allow}, allowed
        assert [t for t in denied if t[0] == "10.0.0.2"] and not set(denied) & set(allowed), (allowed, denied)


def test_turn_texts():
    build, ship = ra.phase_texts({"kind": "K2"}, ARMS, "none", "Fix the bug.\n")
    assert build == ("build", "Fix the bug.\n\nWork in this repository. Implement this, and make sure it works. Don't stop to ask; I'll tell you when to ship.")
    assert ship == ("ship", "Ship it: commit, push this branch to origin and open a pull request with gh.")
    assert ra.phase_texts({"kind": "K1"}, ARMS, "gstack", "x")[1] == ("ship", "/ship")
    assert ra.phase_texts({"kind": "K3"}, ARMS, "gstack-untold", "x")[1] == ship
    k4 = {"kind": "K4", "replay": {"description": " Adds retries to the client. "}}
    assert ra.phase_texts(k4, ARMS, "none", "ignored") == [("ship", "Adds retries to the client.\n\n" + ship[1])]
    assert ra.phase_texts(k4, ARMS, "gstack", "ignored") == [("ship", "/ship\n\nAdds retries to the client.")]


def test_frozen_env_pattern():
    import re
    pat = re.compile(ra.FROZEN_ENV)
    for name in ("GSTACK_HEADLESS", "GSTACK_SESSION_KIND", "GSTACK_PLAN_MODE", "GSTACK_STATE_ROOT", "CI", "GITHUB_ACTIONS", "OPENCLAW_SESSION", "CONDUCTOR_PORT"):
        assert pat.match(name), name
    for name in ("CIRCLE", "HOME", "PATH", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS", "XGSTACK_X"):
        assert not pat.match(name), name
    assert "GSTACK|CONDUCTOR" in ra.FREEZE and "GITHUB_ACTIONS|OPENCLAW_SESSION" in ra.FREEZE and ra.FREEZE.endswith('exec claude "$@"')


def test_close_sandbox_places_the_shipment_record_only_after_its_sha256_matches():
    import hashlib
    side = Path(tempfile.mkdtemp())
    files = {"record": side / "shipment.json", "journal": side / "journal.jsonl", "bundle": side / "shipped.bundle"}
    files["record"].write_text('{"status": "none"}\n')
    files["journal"].write_text('{"type": "open"}\n')
    files["bundle"].write_bytes(b"bundle")
    record = {"status": "none", "shipped_head": None, "rig_errors": []}
    good = hashlib.sha256(files["record"].read_bytes()).hexdigest()
    for sha in ("0" * 64, good):
        evdir = Path(tempfile.mkdtemp())
        agent = ra.RealAgent.__new__(ra.RealAgent)
        agent._sidecar = lambda path, body, timeout=120: {"record": record, "record_sha256": sha, "files": {k: str(v) for k, v in files.items()}}
        agent._evaluator_dir = lambda: evdir
        if sha != good:
            try:
                agent._close_sandbox("t1", "agent_finished", lambda e: None)
                raise AssertionError("a record that does not match its sha256 was accepted")
            except RuntimeError as e:
                assert str(e).startswith("E_REAL_SANDBOX_RECORD"), e
            assert sorted(p.name for p in evdir.iterdir()) == [], sorted(p.name for p in evdir.iterdir())
            continue
        info = agent._close_sandbox("t1", "agent_finished", lambda e: None)
        assert (evdir / "shipment.json").read_bytes() == files["record"].read_bytes()
        assert info["record_sha256"] == good and info["files"] == {"record": "shipment.json", "journal": "journal.jsonl", "bundle": "shipped.bundle"}, info
        assert sorted(p.name for p in evdir.iterdir()) == ["journal.jsonl", "shipment.json", "shipped.bundle"]


def main():
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("PASS", name)
            except Exception:
                failed += 1
                print("FAIL", name)
                traceback.print_exc()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
