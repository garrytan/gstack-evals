"""Keyless unit tests of the real-outcome agent's parts that need no SDK: the ship persona, the /ship step log, the
egress rules and the turn texts. The Agent SDK and Harbor are stubbed only so real_agent imports; agent_test.py runs the
agent itself on the real SDK. Run by agent-units.test.ts with python3.
"""

import json
import sys
import tempfile
import time
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
    sys.modules["claude_agent_sdk"]._internal = module("claude_agent_sdk._internal")
    sys.modules["claude_agent_sdk._internal"].message_parser = module("claude_agent_sdk._internal.message_parser", parse_message=lambda data: None)
    sys.modules["claude_agent_sdk._internal"].client = module("claude_agent_sdk._internal.client", parse_message=lambda data: None)
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
REGISTRY = json.loads((ROOT / "lanes/outcome-skills/arms/registry.json").read_text())
PLAN_LINE = "Before you write code, draft your plan in PLAN.md. Don't write code yet."
IMPLEMENT = "Now implement your plan, and make sure it works."


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


def test_registry_arms_send_g_turns_t1_to_t3():
    pe = ra.phase_texts({"kind": "K3"}, REGISTRY, "plan-eng-review:told", "Add rate limits.\n")
    assert pe == [("t1", "Add rate limits.\n\n" + PLAN_LINE), ("t2", "/plan-eng-review PLAN.md"), ("t3", IMPLEMENT)], pe
    ap = ra.phase_texts({"kind": "K2"}, REGISTRY, "autoplan:told", "Add rate limits.")
    assert ap == [("t1", "Add rate limits.\n\n" + PLAN_LINE), ("t2", "/autoplan PLAN.md"), ("t3", IMPLEMENT)], ap
    none = ra.phase_texts({"kind": "K3"}, REGISTRY, "none", "Add rate limits. \t\n")
    assert none == [("t1", "Add rate limits.\n\nWork in this repository. Implement this, and make sure it works. Don't stop to ask.")], none


def test_registry_arms_refuse_a_k4_task_and_an_empty_statement():
    for task, statement, why in (({"kind": "K4", "replay": {"description": "Adds retries."}}, "x", "K4"), ({"kind": "K3"}, " \n\ufeff\u3000", "empty")):
        try:
            ra.phase_texts(task, REGISTRY, "none", statement)
        except ra.SandboxSetupError as e:
            assert str(e).startswith("E_REAL_SANDBOX_SETUP") and why in str(e), str(e)
            continue
        raise AssertionError(why + " was accepted")


def test_registry_arms_refuse_turns_that_are_not_t1_to_tn():
    for turns in ([], [{"phase": "build", "text": "{statement}"}], [{"phase": "t1", "text": "{statement}"}, {"phase": "t3", "text": "x"}]):
        arms = {**REGISTRY, "arms": {"none": {**REGISTRY["arms"]["none"], "turns": turns}}}
        try:
            ra.phase_texts({"kind": "K3"}, arms, "none", "Add rate limits.")
        except ra.SandboxSetupError as e:
            assert str(e).startswith("E_REAL_SANDBOX_SETUP") and "not t1 to tn" in str(e) and "fix:" in str(e), str(e)
            continue
        raise AssertionError(f"turns {turns} were accepted")


def test_statement_trim_is_linear_in_a_long_whitespace_run():
    statement = "Add rate limits." + " " * 100_000 + "x" + " \u3000\t\n" * 1000
    start = time.monotonic()
    [(phase, text)] = ra.phase_texts({"kind": "K3"}, REGISTRY, "none", statement)
    assert time.monotonic() - start < 2, time.monotonic() - start
    assert phase == "t1" and text.startswith("Add rate limits." + " " * 100_000 + "x\n\n"), text[-120:]


def test_message_records_leave_out_a_parent_tool_use_id_the_frame_did_not_carry():
    class AssistantMessage:
        def __init__(self):
            self.content, self.model, self.parent_tool_use_id = [], "m", None

    for name in ("claude_agent_sdk._internal.message_parser", "claude_agent_sdk._internal.client"):
        assert getattr(sys.modules[name].parse_message, ra.KEYLESS, False), name + " still holds the SDK's own parse_message"
    parse = ra.mark_keyless(lambda data: AssistantMessage())
    keyless = ra.message_record(parse({"type": "assistant", "message": {}}), 1)
    assert "parent_tool_use_id" not in keyless, keyless
    keyed = ra.message_record(parse({"type": "user", "message": {}, "parent_tool_use_id": None}), 1)
    assert "parent_tool_use_id" in keyed and keyed["parent_tool_use_id"] is None, keyed
    assert "parent_tool_use_id" in ra.message_record(parse({"type": "stream_event"}), 1)
    assert ra.mark_keyless(parse) is parse


def test_message_records_keep_parent_tool_use_id_where_the_sdk_sets_it():
    class AssistantMessage:
        def __init__(self, parent):
            self.content, self.model, self.parent_tool_use_id = [], "m", parent

    class UserMessage:
        def __init__(self, parent):
            self.content, self.parent_tool_use_id = "hi", parent

    class SystemMessage:
        def __init__(self):
            self.subtype, self.data = "init", {}

    assert ra.message_record(AssistantMessage("toolu_9"), 1)["parent_tool_use_id"] == "toolu_9"
    top = ra.message_record(UserMessage(None), 1)
    assert "parent_tool_use_id" in top and top["parent_tool_use_id"] is None, top
    assert "parent_tool_use_id" not in ra.message_record(SystemMessage(), 1)


def test_registry_turns_count_per_turn_and_never_hold_shipping():
    u = user()
    u.per_turn(["t1", "t2", "t3"])
    for phase in ("t1", "t2", "t3"):
        u.start(phase)
        a = u.answer([q("Ready to commit and open a PR?", "Commit now (Recommended)", "Wait"), q("Which name?", "foo", "bar")])
        assert a == {"Ready to commit and open a PR?": "Commit now (Recommended)", "Which name?": PERSONA["fallback"]}, (phase, a)
    assert list(u.counts) == ["t1", "t2", "t3"], u.counts
    assert all(c == {"questions": 2, "recommended": 1, "fallback": 1, "hold": 0, "prose": 0, "prose_unanswered": 0} for c in u.counts.values()), u.counts


PLAN_HOLD = "Not yet. Keep to PLAN.md for now; don't write code yet."
CLOSING_ASK = "I've drafted the plan in PLAN.md.\n\nWant me to start implementing?"
IMPLEMENT_Q = q("How would you like to proceed?", "Implement now (Recommended)", "Revise the plan")
IMPLEMENT_ASKS = (
    "The plan is in PLAN.md. Want me to start implementing?",
    "Should I go ahead and implement it?",
    "Shall I proceed?",
    "Would you like me to proceed?",
    "Ready for me to start coding?",
    "Next, I'd implement the parser in src/parse.ts.",
    "Implement now (Recommended)",
    "Yes, implement the plan (Recommended)",
    "Proceed with implementation (Recommended)",
    "Should I start the implementation now?",
    "Let me know if you'd like me to adjust anything or start implementing.",
    "Want me to build it?",
    "Should I begin writing the code?",
    "Shall I start on step 1?",
    "Want me to implement Phase 1?",
    "Let's implement it.",
    "Do you want me to start implementing or not?",
    "Want me to start building?",
    "Should I execute the plan?",
    "Want me to make these changes?",
    "Shall I continue?",
    "Should I go ahead?",
    "Shall we get started?",
    "Would you like me to continue?",
    "Want me to do that?",
    "Should I?",
    "Let me know how you'd like to proceed.",
    "OK to proceed?",
    "Should I start on the parser?",
    "Want me to apply these edits?",
    "Want me to proceed with the review?",
    "How should I proceed?",
    "I can make these changes now.",
    "Shall I proceed with the plan?",
    "Want me to go ahead with the plan?",
    "Should I go ahead with PLAN.md as written?",
    "I'll proceed with the plan once you confirm.",
)
PLAN_QUESTIONS = (
    "Which storage should the plan use?",
    "SQLite (Recommended)",
    "Should the plan cover the migration?",
    "Yes, include it (Recommended)",
    "I've drafted the plan in PLAN.md. Want me to add more detail on the error handling?",
    "Want me to refine the plan before I start implementing?",
    "Before I start implementing, want me to refine anything?",
    "Should the implementation use async I/O?",
    "Let me know if the implementation plan looks right.",
    "Should I add an implementation section to PLAN.md?",
    "Implement with Redis (Recommended)",
    "Should I start writing the plan?",
    "I will not write code until the plan is reviewed.",
    "Should the plan cover the retry path?",
    "Want me to add a section on retries to PLAN.md?",
    "Want me to make these changes to the plan?",
    "Shall I continue with the plan?",
    "Should I continue the plan?",
    "Want me to proceed with the plan's risks section?",
    "Want me to continue with the plan's risks section?",
    "Should I go ahead with option B?",
    "Should the start date be optional?",
    "Let me know if you want me to make any changes to PLAN.md.",
    "Ready to commit and open a PR?",
    "Should I start building the plan's test section?",
)


def told_user():
    u = user()
    u.per_turn(["t1", "t2", "t3"], ra.plan_turns(REGISTRY, "plan-eng-review:told"))
    return u


def test_plan_turns_are_the_turns_before_each_registry_arms_skill_turn():
    assert ra.plan_turns(REGISTRY, "plan-eng-review:told") == ["t1"]
    assert ra.plan_turns(REGISTRY, "autoplan:told") == ["t1"]
    assert ra.plan_turns(REGISTRY, "none") == []
    assert ra.plan_turns(ARMS, "none") == [] and ra.plan_turns(ARMS, "gstack") == []


def test_told_turn_one_holds_a_closing_ask_to_implement():
    u = told_user()
    u.start("t1")
    assert u.prose(CLOSING_ASK) == PLAN_HOLD
    assert u.counts["t1"] == {"questions": 0, "recommended": 0, "fallback": 0, "hold": 1, "prose": 0, "prose_unanswered": 0}, u.counts
    events = [json.loads(line) for line in u.log_path.read_text().splitlines()]
    assert [(e["answer"], e["source"]) for e in events if e["event"] == "prose"] == [(PLAN_HOLD, "hold")], events


def test_told_turn_one_holds_a_recommended_implement_option():
    u = told_user()
    u.start("t1")
    assert u.answer([IMPLEMENT_Q, q("Should I start implementing now?", "Yes", "No")]) == {"How would you like to proceed?": PLAN_HOLD, "Should I start implementing now?": PLAN_HOLD}
    assert u.counts["t1"] == {"questions": 2, "recommended": 0, "fallback": 0, "hold": 2, "prose": 0, "prose_unanswered": 0}, u.counts
    events = [json.loads(line) for line in u.log_path.read_text().splitlines()]
    assert [(e["answer"], e["source"]) for e in events if e["event"] == "question"] == [(PLAN_HOLD, "hold")] * 2, events
    u = told_user()
    u.start("t1")
    assert u.answer([q("Should I go ahead?", "Yes, proceed with the plan (Recommended)", "No")]) == {"Should I go ahead?": PLAN_HOLD}


def test_told_turns_from_the_skill_turn_on_keep_todays_answers():
    u = told_user()
    for phase in ("t2", "t3"):
        u.start(phase)
        assert u.prose(CLOSING_ASK) == PERSONA["fallback"], phase
        assert u.answer([IMPLEMENT_Q]) == {"How would you like to proceed?": "Implement now (Recommended)"}, phase
        assert u.counts[phase] == {"questions": 1, "recommended": 1, "fallback": 0, "hold": 0, "prose": 1, "prose_unanswered": 0}, u.counts


def test_gstacks_questions_in_the_skill_turn_still_get_the_rec_line():
    u = told_user()
    u.start("t2")
    a = u.answer([
        q("Scope challenge: reduce the scope?", "A) Keep the scope as planned (Recommended)", "B) Cut the retry layer"),
        q("The review is done. Ready to implement the reviewed plan?", "A) Yes, implement it (Recommended)", "B) Not yet"),
        q("Which test framework?", "pytest", "unittest"),
    ])
    assert a == {"Scope challenge: reduce the scope?": "A) Keep the scope as planned (Recommended)", "The review is done. Ready to implement the reviewed plan?": "A) Yes, implement it (Recommended)", "Which test framework?": PERSONA["fallback"]}, a
    assert u.prose("Review complete.\n\nShould I start implementing the reviewed plan?") == PERSONA["fallback"]
    assert u.counts["t2"]["hold"] == 0, u.counts


def test_turn_one_choices_between_plan_options_are_not_held():
    u = told_user()
    u.start("t1")
    a = u.answer([
        q("How should I proceed?", "Add caching to the plan (Recommended)", "Keep the plan minimal"),
        q("Which plan section next?", "Risks", "Tests"),
        q("Should I go ahead with one of these?", "Expand PLAN.md's test section", "Add a rollback step to the plan"),
    ])
    assert a == {"How should I proceed?": "Add caching to the plan (Recommended)", "Which plan section next?": PERSONA["fallback"], "Should I go ahead with one of these?": PERSONA["fallback"]}, a
    assert u.counts["t1"]["hold"] == 0, u.counts
    a = u.answer([
        q("Where should I begin?", "Start on the parser (Recommended)", "Expand the plan"),
        q("Which next step?", "Expand PLAN.md's test section", "Proceed"),
        q("What now?", "Proceed with the plan as written (Recommended)", "Revise the plan"),
    ])
    assert a == {"Where should I begin?": PLAN_HOLD, "Which next step?": PLAN_HOLD, "What now?": PLAN_HOLD}, a
    assert u.counts["t1"]["hold"] == 3, u.counts


def test_turn_one_plan_questions_are_not_held():
    u = told_user()
    u.start("t1")
    a = u.answer([q("Which storage should the plan use?", "SQLite (Recommended)", "Postgres"), q("Should the plan cover the migration?", "Yes, include it (Recommended)", "No"), q("Which name?", "foo", "bar")])
    assert a == {"Which storage should the plan use?": "SQLite (Recommended)", "Should the plan cover the migration?": "Yes, include it (Recommended)", "Which name?": PERSONA["fallback"]}, a
    assert u.prose("I've drafted the plan in PLAN.md.\n\nWant me to add more detail on the error handling?") == PERSONA["fallback"]
    assert u.prose("Want me to refine the plan before I start implementing?") == PERSONA["fallback"]
    assert u.counts["t1"]["hold"] == 0, u.counts


def test_the_none_arms_one_turn_keeps_todays_answers():
    u = user()
    u.per_turn(["t1"], ra.plan_turns(REGISTRY, "none"))
    u.start("t1")
    assert u.prose("I found the bug in the parser.\n\nWant me to start implementing the fix?") == PERSONA["fallback"]
    assert u.answer([IMPLEMENT_Q]) == {"How would you like to proceed?": "Implement now (Recommended)"}
    assert u.counts["t1"] == {"questions": 1, "recommended": 1, "fallback": 0, "hold": 0, "prose": 1, "prose_unanswered": 0}, u.counts


def test_a_turn_one_hold_spends_the_prose_allowance():
    u = told_user()
    u.start("t1")
    for _ in range(PERSONA["prose_replies_per_turn"]):
        assert u.prose(CLOSING_ASK) == PLAN_HOLD
    assert u.prose(CLOSING_ASK) is None
    assert u.counts["t1"]["hold"] == PERSONA["prose_replies_per_turn"] and u.counts["t1"]["prose_unanswered"] == 1, u.counts


def test_the_implement_matcher_holds_implement_asks_and_not_plan_questions():
    import ship_user
    assert [t for t in IMPLEMENT_ASKS if not ship_user.implements(t)] == []
    assert [t for t in PLAN_QUESTIONS if ship_user.implements(t)] == []
    for asks, want in ((IMPLEMENT_ASKS, PLAN_HOLD), (PLAN_QUESTIONS, PERSONA["fallback"])):
        for text in (t for t in asks if t.endswith("?")):
            u = told_user()
            u.start("t1")
            assert u.prose("I've drafted the plan in PLAN.md.\n\n" + text) == want, text


HELD_IN_T1 = (
    "A) Implement now (Recommended)",
    "(b) Implement the parser first",
    "- Implement now",
    "**A)** Implement now",
    "Before we discuss tests, should I start implementing?",
    "Before we go further, shall I implement the plan now?",
    "I'll implement the parser now, not the CLI. Sound good?",
    "I'll implement the parser but not the CLI.",
    "I recommend implementing the parser; it is not risky.",
    "Implement now (Recommended), but do not change the public API",
    "PLAN.md is done. Ready for me to wire it up?",
    "Want me to wire up the CLI?",
    "Want me to build out the parser?",
    "Should I build it out?",
    "I can start building the plan now. Should I?",
    "Section 2 of the plan is next. Should I?",
    "Should I proceed with implementing the plan?",
)
UNHELD_IN_T1 = (
    "Want me to proceed with writing PLAN.md?",
    "Should I go ahead with drafting the plan in PLAN.md?",
    "Let me know if you want me to proceed with drafting PLAN.md.",
    "Shall I go ahead with updating the plan?",
    "Should I proceed with finishing PLAN.md?",
    "Want me to go ahead with revising the plan?",
    "I can finish drafting PLAN.md now. Should I?",
    "Should I build out the plan?",
    "Should I build out the plan's risks section?",
    "Before writing code, I'll finish the plan.",
    "I won't implement anything yet; I'll keep to PLAN.md.",
    "I'm not going to write code yet, but I can tighten the plan.",
    "B) Keep refining the plan (Recommended)",
)


def test_the_t1_hold_reads_option_markers_leading_clauses_and_negation_by_clause():
    import ship_user
    assert [t for t in HELD_IN_T1 if not ship_user.implements(t)] == []
    assert [t for t in UNHELD_IN_T1 if ship_user.implements(t)] == []
    for texts, want in ((HELD_IN_T1, PLAN_HOLD), (UNHELD_IN_T1, PERSONA["fallback"])):
        for text in (t for t in texts if t.endswith("?")):
            u = told_user()
            u.start("t1")
            assert u.prose("I've read the code.\n\n" + text) == want, text
    u = told_user()
    u.start("t1")
    answers = u.answer([
        q("Which next step?", "A) Implement now (Recommended)", "B) Revise PLAN.md"),
        q("What now?", "Implement now (Recommended), but do not change the public API", "Revise the plan"),
        q("Next?", "A) Implement now", "B) Keep refining the plan (Recommended)"),
    ])
    assert answers == {"Which next step?": PLAN_HOLD, "What now?": PLAN_HOLD, "Next?": "B) Keep refining the plan (Recommended)"}, answers


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
    files["record"].write_text('{"status": "none", "shipped_head": null, "rig_errors": []}\n')
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


def test_close_sandbox_reports_the_record_it_placed_not_the_http_copy():
    import hashlib
    side = Path(tempfile.mkdtemp())
    files = {"record": side / "shipment.json", "journal": side / "journal.jsonl", "bundle": side / "shipped.bundle"}
    files["record"].write_text('{"status": "none", "shipped_head": null, "rig_errors": [{"kind": "gh_unknown"}]}\n')
    files["journal"].write_text('{"type": "open"}\n')
    files["bundle"].write_bytes(b"bundle")
    sha = hashlib.sha256(files["record"].read_bytes()).hexdigest()
    evdir = Path(tempfile.mkdtemp())
    agent = ra.RealAgent.__new__(ra.RealAgent)
    agent._sidecar = lambda path, body, timeout=120: {"record": {"status": "shipped", "shipped_head": "abc123", "rig_errors": []}, "record_sha256": sha, "files": {k: str(v) for k, v in files.items()}}
    agent._evaluator_dir = lambda: evdir
    info = agent._close_sandbox("t1", "agent_finished", lambda e: None)
    assert (info["status"], info["shipped_head"], info["rig_errors"]) == ("none", None, ["gh_unknown"]), info


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
