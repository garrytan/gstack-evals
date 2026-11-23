"""B2's Codex agent (quick/laneb/runner/agent/laneb_b2_codex.py) on part R's harness (tests/codex-hooks/r/agent_codex_test.py:
Harbor and the Agent SDK stubbed, a fake docker playing Codex). The prove-it arm's prompt reaches Codex typed "$prove-it ",
the digest of what was sent goes to codex-agent-events.jsonl, and an arm told nothing sends B1's prompt unchanged.
"""

import hashlib
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "codex-hooks" / "r"))
import agent_codex_test as r  # noqa: E402
import laneb_b2_codex as b2  # noqa: E402

PROMPT = "Task: Fix the bug.\n\nWhen you finish, end your final message with one line: STATUS: FIXED or STATUS: NOT FIXED.\n"


def agent(tmp, told):
    a, fake = r.setup(tmp, [{"events": r.events(), "rollout": [r.message("STATUS: FIXED")]}], told_skill=told, arm="cx-prove-it" if told else "cx-gstack")
    a.__class__ = b2.LanebB2CodexAgent
    return a, fake


def agent_events(tmp):
    f = r.ev(tmp, "codex-agent-events.jsonl")
    return [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []


def test_the_agent_is_named_laneb_b2_codex(tmp):
    assert b2.LanebB2CodexAgent.name() == "laneb-b2-codex"
    assert b2.typed("Fix it.", "prove-it") == "$prove-it Fix it." and b2.typed("Fix it.", "") == "Fix it."


def test_a_told_arm_sends_the_prompt_typed_and_logs_its_digest(tmp):
    a, _ = agent(tmp, "prove-it")
    r.run(a)
    [c] = r.calls(tmp)
    assert c["stdin"] == "$prove-it " + PROMPT, repr(c["stdin"])
    typed = [e for e in agent_events(tmp) if e.get("event") == "typed_prompt"]
    assert len(typed) == 1 and typed[0]["told_skill"] == "prove-it", typed
    assert typed[0]["prompt_sha256"] == hashlib.sha256(("$prove-it " + PROMPT).encode()).hexdigest()


def test_an_arm_told_nothing_sends_b1s_prompt_unchanged(tmp):
    a, _ = agent(tmp, "")
    r.run(a)
    [c] = r.calls(tmp)
    assert c["stdin"] == PROMPT, repr(c["stdin"])
    assert not [e for e in agent_events(tmp) if e.get("event") == "typed_prompt"]


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
