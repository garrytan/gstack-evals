"""Lane B quick-look Harbor agent: Claude Code driven through the Agent SDK.

Grown from the U8 spike (spikes/harbor/sdk_claude_code.py). The SDK runs on the
evaluator side; its CLI subprocess is `docker exec -i <trial container> claude`,
so stream-json and the canUseTool channel cross the boundary over stdio only.

Per trial it:
  1. extracts the arm (a tarball of /root/.claude and friends) into the container,
  2. opens a metered session on the proxy, which reserves the session cap in the
     ledger and hands back a token the container uses as its API key,
  3. sends the arm-neutral prompt wrapper around the task instruction,
  4. answers AskUserQuestion from an evaluator-side simulator,
  5. always: stops Claude Code in the container, exports the patch to
     /logs/artifacts/, and closes the session (which settles the ledger row).
"""

import asyncio
import hashlib
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, query
from claude_agent_sdk.types import HookMatcher, PermissionResultAllow
from prompt_builder import build_prompt
from harbor.agents.installed.claude_code import ClaudeCode, ClaudeCodeOptions
from harbor.environments.base import BaseEnvironment
from harbor.environments.docker.docker import _sanitize_docker_compose_project_name
from harbor.models.agent.context import AgentContext
from pydantic import Field
from usersim import Simulator

FORWARDED_ENV = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
    "DISABLE_AUTOUPDATER",
    "DISABLE_TELEMETRY",
    "DISABLE_ERROR_REPORTING",
    "IS_SANDBOX",
    "HOME",
)

ALIAS_ENV = (
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
)


# Where each arm's skills live: gstack and its placebo under ~/.claude/skills, pstack and its placebo under ~/.local/share/pstack/skills.
SKILL_DIRS = ("/root/.claude/skills", "/root/.local/share/pstack/skills")


class LedgerCapStop(Exception):
    """The ledger refused this session's reserve: the line item's cap is reached. Never retried."""


_DIGESTS: dict[tuple[str, int, int], str] = {}


def sha256_file(path: Path) -> str:
    st = path.stat()
    key = (str(path), st.st_size, st.st_mtime_ns)
    if key in _DIGESTS:
        return _DIGESTS[key]
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    _DIGESTS[key] = h.hexdigest()
    return _DIGESTS[key]


def post_json(url: str, body: dict, timeout: float = 30) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{url} -> {e.code}: {e.read()[:500]!r}") from None


class LanebOptions(ClaudeCodeOptions):
    persona_path: str = Field(description="Host path of the simulator persona; never uploaded.")
    arm: str = Field(description="Arm name: none, gstack, placebo, pstack or pstack-placebo.")
    arm_tar: str = Field(description="Host path of the arm tarball, extracted into /root.")
    arm_sha256: str = Field(default="", description="Preregistered sha256 of the arm tarball; a mismatch fails the trial before any model call.")
    control_url: str = Field(default="http://127.0.0.1:8788", description="Proxy control plane.")
    session_cap_usd: float = Field(description="Per-session spend cap, reserved in the ledger.")
    wrapper_path: str = Field(description="Host path of the arm-neutral prompt wrapper with {instruction}.")
    upstream_model: str = Field(description="Model id the proxy serves for this cell, as named in the proxy config.")
    repo_dir: str = Field(default="", description="Repository whose diff is published as /logs/artifacts/model.patch; empty for tasks graded on container state.")
    workdir: str = Field(default="", description="Claude Code working directory in the container; empty means the image's WORKDIR.")
    max_output_tokens: int = Field(default=32000, description="CLAUDE_CODE_MAX_OUTPUT_TOKENS; Claude Code otherwise asks for 128k, whose worst case exceeds the cheap cells' caps.")
    sdk_max_turns: int = Field(default=200, description="Hard turn ceiling; the session cap and agent timeout bind first.")
    invoke: bool = Field(default=False, description="When true the prompt opens with a slash command '/<skill> ' so the CLI expands it and injects that skill's SKILL.md body. Every arm but none sets it.")
    skill_map: dict[str, str] = Field(default_factory=dict, description="Task id to the preregistered skill this arm invokes for it, from the arm's entry in skill-map.stacks.json; read only when invoke is true.")
    invocation_sep: str = Field(default=" ", description="Separator between the slash command and the wrapper text; the CLI needs one space to parse the slash command.")


class LanebAgent(ClaudeCode):
    options_model = LanebOptions
    DEFAULT_SETUP_TIMEOUT_SEC = 900.0

    @staticmethod
    def name() -> str:
        return "laneb-claude-code"

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

    def _exec(self, container: str, script: str, stdin: bytes | None = None, timeout: float = 300) -> subprocess.CompletedProcess:
        return subprocess.run(["docker", "exec", "-i", container, "sh", "-c", script], input=stdin, capture_output=True, timeout=timeout)

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)
        container = self._container_id(environment)
        self._arm_info = await asyncio.to_thread(self._inject_arm, container)

    def _inject_arm(self, container: str) -> dict:
        tar = Path(self.options.arm_tar)
        digest = sha256_file(tar)
        if self.options.arm_sha256 and digest != self.options.arm_sha256:
            raise RuntimeError(f"arm {self.options.arm}: tar sha256 {digest} is not the preregistered {self.options.arm_sha256}")
        with tar.open("rb") as f:
            res = subprocess.run(["docker", "exec", "-i", container, "sh", "-c", "mkdir -p /root && tar -x -C /root"], stdin=f, capture_output=True, timeout=600)
        if res.returncode != 0:
            raise RuntimeError(f"arm extract failed: {res.stderr[-500:]!r}")
        listing = [entry for d in SKILL_DIRS for entry in self._exec(container, f"ls -1 {d} 2>/dev/null | sort").stdout.decode().split()]
        return {"event": "arm", "arm": self.options.arm, "tar_sha256": digest, "skills_dirs": len(listing)}

    def _export_patch(self, container: str) -> dict:
        repo = self.options.repo_dir
        if not repo:
            return {"event": "patch", "skipped": "task is graded on container state"}
        script = (
            f"mkdir -p /logs/artifacts && cd {repo} && git add -A >/dev/null 2>&1; "
            "git -c core.fileMode=false diff --cached --binary HEAD > /logs/artifacts/model.patch; "
            "wc -c < /logs/artifacts/model.patch"
        )
        res = self._exec(container, script, timeout=120)
        return {"event": "patch", "rc": res.returncode, "bytes": res.stdout.decode().strip(), "stderr": res.stderr.decode()[-300:]}

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        persona = json.loads(Path(self.options.persona_path).read_text())
        sim = Simulator(persona, self.logs_dir / "usersim-events.jsonl")
        log = sim.log

        container = self._container_id(environment)
        arm_info = self._arm_info
        log(arm_info)

        auth = self._resolve_auth_env()
        base_url = auth.get("ANTHROPIC_BASE_URL")
        if not base_url:
            raise RuntimeError("laneb agent needs --base-url pointing at the metering proxy")

        try:
            session = post_json(
                self.options.control_url + "/sessions",
                {"trial": environment.session_id, "model": self.options.upstream_model, "cap_usd": self.options.session_cap_usd,
                 "meta": {"arm": self.options.arm, "arm_tar_sha256": arm_info["tar_sha256"]}},
            )
        except RuntimeError as e:
            if "-> 409" in str(e):
                log({"event": "ledger_cap_stop", "message": str(e)[:300]})
                raise LedgerCapStop(str(e)) from None
            raise
        log({"event": "session_open", "session": session["id"], "model": self.options.upstream_model, "cap_usd": self.options.session_cap_usd})

        model = self._resolved_model_name() or self.options.upstream_model
        env = {
            "ANTHROPIC_API_KEY": session["token"],
            "ANTHROPIC_BASE_URL": base_url,
            "ANTHROPIC_MODEL": model,
            **{k: model for k in ALIAS_ENV},
            "CLAUDE_CONFIG_DIR": "/root/.claude",
            "HOME": "/root",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1",
            "CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(self.options.max_output_tokens),
            "DISABLE_AUTOUPDATER": "1",
            "DISABLE_TELEMETRY": "1",
            "DISABLE_ERROR_REPORTING": "1",
            "IS_SANDBOX": "1",
        }

        wrapper_text = Path(self.options.wrapper_path).read_text()
        task_id = environment.session_id.split("__")[0]
        skill = None
        if self.options.invoke:
            skill = self.options.skill_map.get(task_id)
            if not skill:
                raise RuntimeError(f"laneb agent: task {task_id} has no skill in the skill map, but this arm is invoked")
        prompt_text = build_prompt(wrapper_text, instruction, self.options.invoke, skill, self.options.invocation_sep)
        log({"event": "prompt", "wrapper_sha256": hashlib.sha256(wrapper_text.encode()).hexdigest(), "instruction_sha256": hashlib.sha256(instruction.encode()).hexdigest(),
             "invoke": self.options.invoke, "skill": skill, "invocation_line_present": bool(self.options.invoke and skill)})

        host_dir = Path(tempfile.mkdtemp(prefix="laneb-agent-"))
        wrapper = host_dir / "claude-in-container"
        forward = " ".join(f"-e {name}" for name in FORWARDED_ENV)
        workdir = f"-w {self.options.workdir} " if self.options.workdir else ""
        wrapper.write_text(f"#!/bin/sh\nexec docker exec -i {workdir}{forward} {container} claude \"$@\"\n")
        wrapper.chmod(0o755)

        async def can_use_tool(tool_name, tool_input, ctx):
            if tool_name == "AskUserQuestion":
                answers = sim.answer(tool_input.get("questions", []))
                return PermissionResultAllow(updated_input={**tool_input, "answers": answers})
            return PermissionResultAllow(updated_input=tool_input)

        async def keep_open(input_data, tool_use_id, ctx):
            return {"continue_": True}

        async def prompt():
            yield {"type": "user", "message": {"role": "user", "content": prompt_text}}

        disallowed = ["WebSearch", "WebFetch"]
        options = ClaudeAgentOptions(
            cli_path=str(wrapper),
            cwd=str(host_dir),
            env=env,
            can_use_tool=can_use_tool,
            hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[keep_open])]},
            permission_mode="default",
            model=model,
            setting_sources=["user", "project"],
            max_turns=self.options.sdk_max_turns,
            disallowed_tools=disallowed,
        )
        log({"event": "disallowed_tools", "tools": disallowed})
        started = time.time()
        result = {}
        error = None
        try:
            with (self.logs_dir / "sdk-messages.jsonl").open("a") as out:
                async for message in query(prompt=prompt(), options=options):
                    record = {"type": type(message).__name__, "t": round(time.time() - started, 2)}
                    data = getattr(message, "data", None)
                    if isinstance(data, dict) and data.get("subtype") == "init":
                        record["init"] = {k: data.get(k) for k in ("tools", "skills", "slash_commands", "model", "permissionMode", "cwd", "claude_code_version", "apiKeySource")}
                    for attr in ("content", "subtype", "result", "usage", "total_cost_usd", "num_turns", "is_error", "stop_reason"):
                        if hasattr(message, attr):
                            record[attr] = getattr(message, attr)
                    if type(message).__name__ == "ResultMessage":
                        result = {k: record.get(k) for k in ("subtype", "num_turns", "is_error", "total_cost_usd", "stop_reason")}
                    out.write(json.dumps(record, default=lambda o: getattr(o, "__dict__", str(o))) + "\n")
        except Exception as e:
            error = e
            log({"event": "agent_error", "type": type(e).__name__, "message": str(e)[:500]})
        finally:
            self._exec(container, "for p in /proc/[0-9]*; do [ \"$(cat $p/comm 2>/dev/null)\" = claude ] && kill -9 ${p##*/} 2>/dev/null; done; true", timeout=30)
            patch = self._export_patch(container)
            log(patch)
            closed = post_json(self.options.control_url + f"/sessions/{session['id']}/close", {"reason": "agent_finished"})
            usage = closed.get("usage", {})
            summary = {"session": closed, "result": result, "error": None if error is None else {"type": type(error).__name__, "message": str(error)[:500]}, "arm": arm_info, "wall_s": round(time.time() - started, 1), "patch": patch}
            (self.logs_dir / "laneb-summary.json").write_text(json.dumps(summary, indent=2, default=str))
            cached = usage.get("cache_read_input_tokens", 0)
            context.n_input_tokens = usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_creation_1h_input_tokens", 0) + cached
            context.n_cache_tokens = cached
            context.n_output_tokens = usage.get("output_tokens", 0)
            context.cost_usd = closed.get("spent_micros", 0) / 1_000_000
            context.metadata = {"laneb": {"arm": self.options.arm, "session": closed.get("id"), "refused": closed.get("refused"), "requests": closed.get("requests"), "ok_responses": closed.get("ok_responses"), "result": result}}
        if not closed.get("ok_responses"):
            raise RuntimeError(f"no model response reached the agent, so this is an infrastructure failure: {error or result}") from error
