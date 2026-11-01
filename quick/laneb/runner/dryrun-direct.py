# Direct listing and told check for the GEVA-106 and Run D (GEVA-125) dry runs. The Harbor trial stalled after "Skipping install" with no
# proxy session opened, so this drives the pinned runtime on the host the way agent/laneb_agent.py drives it in the
# container: claude-agent-sdk 0.2.174 (Harbor's Python) and Claude Code 2.1.312 (npm pack, as runtime-stages.Dockerfile),
# the same ClaudeAgentOptions, the same env (CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 included), HOME and CLAUDE_CONFIG_DIR
# at the arm's extracted .claude/, the same build_prompt, laneb_agent.SYSTEM_PROMPTS for the cell's system prompt, and one
# proxy session opened and closed like the agent's. It prints the init record's skills, which the analysis reconciles
# with the listing that reached the model. The work dir must sit outside the operator's home: Claude Code also loads
# .claude/skills from every parent of its cwd, and under a home with gstack installed it picked that install up (the
# container's /testbed has no such parent).
#   python dryrun-direct.py <arm> <arm tar> <told 0|1> <claude binary> <work dir> <proxy base url> <instruction.md> <wrapper.md> [system prompt] [max turns]
import asyncio
import json
import shutil
import subprocess
import sys
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher, PermissionResultAllow, ResultMessage, SystemMessage, query, __version__
from laneb_agent import SYSTEM_PROMPTS, post_json
from prompt_builder import build_prompt

arm, tar, told, claude, work, base_url, instruction_path, wrapper_path = sys.argv[1:9]
system_prompt = sys.argv[9] if len(sys.argv) > 9 else "sdk-default"
max_turns = int(sys.argv[10]) if len(sys.argv) > 10 else 200
told = told == "1"
work = Path(work)
shutil.rmtree(work, ignore_errors=True)
home, workdir, host_dir = work / "home", work / "testbed", work / "host"
for d in (home, workdir, host_dir):
    d.mkdir(parents=True)
subprocess.run(["tar", "-xf", tar, "-C", str(home), "--wildcards", "--no-anchored", ".claude/*"], check=False, stderr=subprocess.DEVNULL)
(home / ".claude").mkdir(exist_ok=True)

control_url = "http://127.0.0.1:8788"
session = post_json(control_url + "/sessions", {"trial": f"task-public__direct-{arm}-{int(told)}", "model": "claude-opus-5-5", "cap_usd": 6,
                                               "meta": {"arm": arm, "system_prompt": system_prompt, "driver": "direct"}})
model = "claude-opus-5-5"
env = {
    "DISABLE_AUTOUPDATER": "1",
    "DISABLE_TELEMETRY": "1",
    "DISABLE_ERROR_REPORTING": "1",
    "IS_SANDBOX": "1",
    "ANTHROPIC_API_KEY": session["token"],
    "ANTHROPIC_BASE_URL": base_url,
    "ANTHROPIC_MODEL": model,
    "CLAUDE_CONFIG_DIR": str(home / ".claude"),
    "HOME": str(home),
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "32000",
}

skill = "investigate" if told else None
prompt_text = build_prompt(Path(wrapper_path).read_text(), Path(instruction_path).read_text(), told, skill, " ")
wrapper = host_dir / "claude-local"
wrapper.write_text(f"#!/bin/sh\ncd {workdir} && exec {claude} \"$@\"\n")
wrapper.chmod(0o755)


async def can_use_tool(tool_name, tool_input, ctx):
    return PermissionResultAllow(updated_input=tool_input)


async def keep_open(input_data, tool_use_id, ctx):
    return {"continue_": True}


async def prompt():
    yield {"type": "user", "message": {"role": "user", "content": prompt_text}}


async def run():
    options = ClaudeAgentOptions(
        cli_path=str(wrapper), cwd=str(host_dir), env=env, can_use_tool=can_use_tool,
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[keep_open])]}, permission_mode="default", model=model,
        setting_sources=["user", "project"], max_turns=max_turns, disallowed_tools=["WebSearch", "WebFetch"],
        **SYSTEM_PROMPTS[system_prompt],
    )
    n, subtype = 0, None
    async for m in query(prompt=prompt(), options=options):
        n += 1
        if isinstance(m, SystemMessage) and m.subtype == "init":
            skills = m.data.get("skills") or []
            print(f"init {arm}@{system_prompt}: {len(skills)} skills in the init record, built-ins {sorted(s for s in skills if s in ('doctor', 'plugin-authoring'))}, "
                  f"claude_code_version {m.data.get('claude_code_version')}", flush=True)
        if isinstance(m, ResultMessage):
            subtype = m.subtype
            break
    return n, subtype


try:
    n, subtype = asyncio.run(asyncio.wait_for(run(), 240))
    outcome = f"{n} SDK messages, result {subtype}"
except Exception as e:
    outcome = f"error {type(e).__name__}: {str(e)[:200]}"
closed = post_json(control_url + f"/sessions/{session['id']}/close", {"reason": "agent_finished"})
shutil.rmtree(home, ignore_errors=True)
print(f"direct {arm}@{system_prompt} told={int(told)} max_turns={max_turns}: sdk {__version__}, {outcome}; session close {json.dumps(closed)[:160]}")
