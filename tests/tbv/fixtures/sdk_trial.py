# Copyright (c) 2026 Garry Tan. MIT License.
"""Writes one synthetic trial for source-a.test.ts through the real Lane B agent and the real pinned claude-agent-sdk,
with Harbor and docker faked as quick/laneb/tests/agent_sdk_test.py fakes them. The fake docker answers the first user
message with the scripted CLI messages in FAKE_SCRIPT and records the prompt it received.
argv: out dir, wrapper file, instruction file, script file."""
import asyncio
import json
import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "quick/laneb/tests"), str(ROOT / "quick/laneb/runner/agent")]
import agent_sdk_test as base  # noqa: E402

OLD = '        send({"type": "result"'
i = base.FAKE_DOCKER.index(OLD)
j = base.FAKE_DOCKER.index("\n", i)
base.FAKE_DOCKER = base.FAKE_DOCKER[:i] + (
    '        open(os.environ["FAKE_DOCKER_LOG"] + ".prompt", "w").write(json.dumps(m["message"]["content"]))\n'
    '        for o in json.load(open(os.environ["FAKE_SCRIPT"])): send(o)'
) + base.FAKE_DOCKER[j:]

out, wrapper, instruction, script = (Path(a) for a in sys.argv[1:5])
os.environ["FAKE_SCRIPT"] = str(script)
a = base.agent(out)
(out / "wrapper.md").write_text(wrapper.read_text())
asyncio.run(a.run(instruction.read_text(), types.SimpleNamespace(session_id="t1__env"), types.SimpleNamespace()))
