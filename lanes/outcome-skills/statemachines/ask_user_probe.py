"""Drives the pinned Claude Code through the real Agent SDK with family SM's no-answer rule, for
tests/outcome-skills/sm-claude.test.ts: can_use_tool and the PreToolUse hook as real_agent sets them, NoAnswer from
lanes/real-outcome/agent/sm_user.py. argv: the agent folder, then a JSON config. Prints NoAnswer's counts."""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient  # noqa: E402
from claude_agent_sdk.types import HookMatcher, PermissionResultAllow  # noqa: E402
from sm_user import NoAnswer  # noqa: E402

cfg = json.loads(sys.argv[2])
user = NoAnswer(cfg["reply"], Path(cfg["log"]))


async def can_use_tool(name, tool_input, ctx):
    if name == "AskUserQuestion":
        return PermissionResultAllow(updated_input={**tool_input, "answers": user.answer(tool_input.get("questions", []))})
    return PermissionResultAllow(updated_input=tool_input)


async def keep_open(input_data, tool_use_id, ctx):
    return {"continue_": True}


async def main():
    options = ClaudeAgentOptions(
        cli_path=cfg["cli"], cwd=cfg["cwd"], env=cfg["env"], can_use_tool=can_use_tool, hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[keep_open])]},
        system_prompt={"type": "preset", "preset": "claude_code"}, permission_mode="default", model=cfg["model"], setting_sources=["user", "project"], max_turns=4,
        disallowed_tools=["WebSearch", "WebFetch"], extra_args={"strict-mcp-config": None},
    )
    async with ClaudeSDKClient(options=options) as client:
        await client.query(cfg["prompt"])
        async for message in client.receive_response():
            last = getattr(message, "content", None)
            if isinstance(last, list):
                for b in last:
                    if type(b).__name__ == "TextBlock":
                        user.prose(b.text)
    print(json.dumps(user.counts))


asyncio.run(main())
