"""Harbor agent that drives Claude Code through the Agent SDK (spike).

The SDK runs here, on the evaluator side. Its CLI subprocess is
`docker exec -i <trial container> claude ...`, so stream-json and the
canUseTool control channel cross the container boundary over stdio only.
The user simulator answers AskUserQuestion from a persona file that never
enters the container, and logs every question and answer.
"""

import json
import subprocess
import tempfile
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, query
from claude_agent_sdk.types import HookMatcher, PermissionResultAllow
from harbor.agents.installed.claude_code import ClaudeCode, ClaudeCodeOptions
from harbor.environments.base import BaseEnvironment
from harbor.environments.docker.docker import _sanitize_docker_compose_project_name
from harbor.models.agent.context import AgentContext
from pydantic import Field
from usersim import Simulator

FORWARDED_ENV = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_AGENT_SDK_VERSION",
    "DISABLE_AUTOUPDATER",
    "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS",
)


class SdkClaudeCodeOptions(ClaudeCodeOptions):
    persona_path: str = Field(description="Host path of the persona file; never uploaded.")
    config_dir: str = Field(default="/root/.claude", description="Baked Claude config dir in the image.")
    disable_bundled_skills: bool = Field(default=True, description="Hide Claude Code's bundled skills so only the arm's skills load.")


class SdkClaudeCode(ClaudeCode):
    options_model = SdkClaudeCodeOptions

    @staticmethod
    def name() -> str:
        return "sdk-claude-code"

    def populate_context_post_run(self, context: AgentContext) -> None:
        return

    def _container_id(self, environment: BaseEnvironment) -> str:
        project = _sanitize_docker_compose_project_name(environment.session_id)
        out = subprocess.check_output(
            ["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project}", "--filter", "label=com.docker.compose.service=main"],
            text=True,
        ).split()
        if len(out) != 1:
            raise RuntimeError(f"expected one main container for {project}, found {out}")
        return out[0]

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        env = self._resolve_auth_env()
        model = self._resolved_model_name()
        if model:
            env["ANTHROPIC_MODEL"] = model
            if "ANTHROPIC_BASE_URL" in env:
                env.update(self._model_alias_env(model, all_aliases=True))
        env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
        env["DISABLE_AUTOUPDATER"] = "1"
        env["CLAUDE_CONFIG_DIR"] = self.options.config_dir
        if self.options.disable_bundled_skills:
            env["CLAUDE_CODE_DISABLE_BUNDLED_SKILLS"] = "1"

        container = self._container_id(environment)
        workdir = Path(tempfile.mkdtemp(prefix="sdk-claude-code-"))
        wrapper = workdir / "claude-in-container"
        forward = " ".join(f"-e {name}" for name in FORWARDED_ENV)
        wrapper.write_text(f"#!/bin/sh\nexec docker exec -i -w /app {forward} {container} claude \"$@\"\n")
        wrapper.chmod(0o755)

        self.logs_dir.mkdir(parents=True, exist_ok=True)
        persona = json.loads(Path(self.options.persona_path).read_text())
        sim = Simulator(persona, self.logs_dir / "usersim-events.jsonl")
        sim.log({"event": "start", "container": container, "forwarded_env": sorted(k for k in env if k in FORWARDED_ENV)})

        async def can_use_tool(tool_name, tool_input, ctx):
            if tool_name == "AskUserQuestion":
                answers = sim.answer(tool_input.get("questions", []))
                return PermissionResultAllow(updated_input={**tool_input, "answers": answers})
            sim.log({"event": "tool_permission", "tool": tool_name, "decision": "allow"})
            return PermissionResultAllow(updated_input=tool_input)

        async def keep_open(input_data, tool_use_id, ctx):
            return {"continue_": True}

        async def prompt():
            yield {"type": "user", "message": {"role": "user", "content": instruction}}

        options = ClaudeAgentOptions(
            cli_path=str(wrapper),
            cwd=str(workdir),
            env={k: v for k, v in env.items() if k in FORWARDED_ENV},
            can_use_tool=can_use_tool,
            hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[keep_open])]},
            permission_mode="default",
            model=model,
            setting_sources=["user", "project"],
            max_turns=12,
            disallowed_tools=self.options.disallowed_tools.split(",") if self.options.disallowed_tools else [],
        )
        sim.log({"event": "disallowed_tools", "tools": options.disallowed_tools})
        with (self.logs_dir / "sdk-messages.jsonl").open("a") as out:
            async for message in query(prompt=prompt(), options=options):
                record = {"type": type(message).__name__}
                data = getattr(message, "data", None)
                if isinstance(data, dict) and data.get("subtype") == "init":
                    record["init"] = {k: data.get(k) for k in ("tools", "skills", "slash_commands", "model", "permissionMode", "cwd", "claude_code_version", "apiKeySource")}
                for attr in ("content", "subtype", "result", "usage", "total_cost_usd", "num_turns", "is_error"):
                    if hasattr(message, attr):
                        record[attr] = getattr(message, attr)
                out.write(json.dumps(record, default=lambda o: getattr(o, "__dict__", str(o))) + "\n")
