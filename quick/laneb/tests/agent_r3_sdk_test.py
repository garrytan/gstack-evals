"""R3's arms under the real pinned Agent SDK (GEVA-101 prereg, section 4.8).

Each agent's kwargs come from R3's JobConfig, written by r3.test.ts to the file in R3_AGENTS, and run through
LanebAgent.run with agent_sdk_test.py's stubs: the real claude-agent-sdk at the pin, Harbor stubbed, and a fake docker
that also records the prompt the CLI receives. Every arm must send CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 into the
container and run on Claude Code's preset, and only the told arms may open the prompt with /investigate.
"""

import json
import os
import sys
import tempfile
import traceback
from pathlib import Path

import agent_sdk_test as base
from prompt_builder import PROCEDURE_LINES

RECORD = '    elif m.get("type") == "user":\n'
assert RECORD in base.FAKE_DOCKER
base.FAKE_DOCKER = base.FAKE_DOCKER.replace(RECORD, RECORD + '        open(os.environ["FAKE_DOCKER_LOG"] + ".prompt", "a").write(json.dumps(m["message"]["content"]) + "\\n")\n')

OPTIONS = ("arm", "upstream_model", "session_cap_usd", "repo_dir", "system_prompt", "session_kind", "told_skill", "procedure_line")


def check(tmp: Path, kwargs: dict):
    a, call, init, summary = base.run(tmp, **{k: kwargs[k] for k in OPTIONS if k in kwargs})
    prompts = [json.loads(line) for line in (tmp / "docker.jsonl.prompt").read_text().splitlines()]
    told = kwargs.get("told_skill", "")
    line = kwargs.get("procedure_line", "")
    assert prompts == [("/" + told + " " if told else "") + "Task: do it" + ("\n\n" + PROCEDURE_LINES[line] + "\n" if line else "")], (kwargs["arm"], prompts)
    assert (told == "investigate") == (kwargs["arm"] in ("gstack", "placebo")), kwargs
    assert call["env"]["CLAUDE_CODE_DISABLE_BUNDLED_SKILLS"] == "1", call["env"]
    assert "--system-prompt" not in call["argv"] and "--append-system-prompt" not in call["argv"], call["argv"]
    assert init["system_prompt"] == summary["system_prompt"] == "claude-code-preset", (init, summary)
    assert a.opened[0]["meta"].get("told_skill", "") == told, a.opened[0]["meta"]


if __name__ == "__main__":
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"):
        os.environ.pop(key, None)
    agents = json.loads(Path(os.environ["R3_AGENTS"]).read_text())
    failed = 0
    path = os.environ["PATH"]
    for kwargs in agents:
        name = f"{kwargs['upstream_model']} {kwargs['arm']}"
        with tempfile.TemporaryDirectory() as d:
            try:
                check(Path(d), kwargs)
                print(f"pass arm {name}")
            except Exception:
                failed += 1
                print(f"FAIL arm {name}")
                traceback.print_exc(file=sys.stdout)
            os.environ["PATH"] = path
    sys.exit(1 if failed or not agents else 0)
