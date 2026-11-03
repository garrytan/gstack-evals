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
     /logs/artifacts/, closes the session (which settles the ledger row), and
     writes laneb-summary.json, even when one of those steps fails.

Evaluator evidence (the simulator log, the SDK message log, process lists and
the summary) goes to evaluator/ beside the trial's agent/ directory. Harbor
bind-mounts agent/ read-write at /logs/agent, so nothing the analysis trusts is
written there.
"""

import asyncio
import hashlib
import json
import subprocess
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, query
from claude_agent_sdk.types import HookMatcher, PermissionResultAllow
from harbor.agents.installed.claude_code import ClaudeCode, ClaudeCodeOptions
from harbor.environments.base import BaseEnvironment
from harbor.environments.docker.docker import _sanitize_docker_compose_project_name
from harbor.models.agent.context import AgentContext
from prompt_builder import PROCEDURE_LINES, build_prompt
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


class LedgerCapStop(Exception):
    """The ledger or the batch cap refused this session's reserve. Never retried."""


class LanebInfraError(Exception):
    """No model response reached the agent (container, proxy or provider failure). The only agent error Harbor retries."""


class HttpStatusError(RuntimeError):
    def __init__(self, url: str, code: int, body):
        super().__init__(f"{url} -> {code}: {str(body)[:500]}")
        self.code = code
        self.body = body


# Linux capability bits: CAP_NET_ADMIN is 12, CAP_NET_RAW is 13. Either one lets a process set SO_MARK and pass
# the egress sidecar's own mark; CAP_NET_RAW also opens AF_PACKET sockets below its rules.
NET_CAPS = {"CAP_NET_ADMIN": 12, "CAP_NET_RAW": 13}

PROBE_TIMEOUT_S = 60

# The agent's system prompt setting, by name, as extra ClaudeAgentOptions. sdk-default passes none, so the SDK sends
# --system-prompt "" and the CLI keeps only its short Agent SDK line; claude-code-preset adds Claude Code's own guidance.
SYSTEM_PROMPTS = {
    "sdk-default": {},
    "claude-code-preset": {"system_prompt": {"type": "preset", "preset": "claude_code"}},
}

# GSTACK_SESSION_KIND for the container's claude. Empty sets nothing; unattended is passed through docker exec -e.
SESSION_KINDS = ("", "unattended")

# A session open that fails with a timeout, a dropped connection or a 5xx (the proxy's ledger reserve failed and may
# have landed) is sent again with the same open_key, so the proxy hands back the session it may already have opened,
# and the ledger reuses a reserve that landed, instead of reserving a second one.
OPEN_ATTEMPTS = 3
OPEN_RETRY_S = 2

KILL_CLAUDE = "for p in /proc/[0-9]*; do [ \"$(cat $p/comm 2>/dev/null)\" = claude ] && kill -9 ${p##*/} 2>/dev/null; done; true"
LIST_PROCESSES = "for p in /proc/[0-9]*; do [ \"${p##*/}\" = $$ ] && continue; printf '%s\\t%s\\t' \"${p##*/}\" \"$(cat $p/comm 2>/dev/null)\"; tr '\\0' ' ' < $p/cmdline 2>/dev/null; echo; done"


def net_caps_held(status: str) -> list[str]:
    """Names of the network capabilities still present in a /proc/<pid>/status text's effective or bounding set."""
    held = set()
    for line in status.splitlines():
        key, _, value = line.partition(":")
        if key in ("CapEff", "CapBnd"):
            mask = int(value.strip(), 16)
            held.update(name for name, bit in NET_CAPS.items() if mask >> bit & 1)
    return sorted(held)


def parse_processes(text: str) -> dict[str, str]:
    out = {}
    for line in text.splitlines():
        pid, _, rest = line.partition("\t")
        if pid.isdigit():
            out[pid] = rest.replace("\t", " ").strip()
    return out


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
        raw = e.read()[:2000]
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = raw
        raise HttpStatusError(url, e.code, parsed) from None


class LanebOptions(ClaudeCodeOptions):
    persona_path: str = Field(description="Host path of the simulator persona; never uploaded.")
    arm: str = Field(description="Arm name: none, gstack or placebo.")
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
    close_timeout_sec: float = Field(default=120, description="Session close timeout: above the proxy's 30 s drain plus its settle retries.")
    system_prompt: str = Field(default="sdk-default", description="A key of SYSTEM_PROMPTS: sdk-default or claude-code-preset.")
    session_kind: str = Field(default="", description="GSTACK_SESSION_KIND in the container: empty (unset) or unattended.")
    told_skill: str = Field(default="", description="Skill this arm is told: the prompt opens with '/<told_skill> ' so the CLI expands it and injects that SKILL.md body. Empty sends the wrapper unchanged.")
    procedure_line: str = Field(default="", description="A key of prompt_builder.PROCEDURE_LINES: a told prompt ends with that line after a blank line. Empty adds nothing.")


class LanebAgent(ClaudeCode):
    options_model = LanebOptions
    DEFAULT_SETUP_TIMEOUT_SEC = 900.0

    @staticmethod
    def name() -> str:
        return "laneb-claude-code"

    def populate_context_post_run(self, context: AgentContext) -> None:
        return

    def _evaluator_dir(self) -> Path:
        return self.logs_dir.parent / "evaluator"

    def _container_id(self, environment: BaseEnvironment) -> str:
        project = _sanitize_docker_compose_project_name(environment.session_id)
        try:
            out = subprocess.check_output(
                ["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project}", "--filter", "label=com.docker.compose.service=main"],
                text=True,
                timeout=PROBE_TIMEOUT_S,
            ).split()
        except (subprocess.SubprocessError, OSError) as e:
            raise LanebInfraError(f"docker ps failed for {project}: {e}") from None
        if len(out) != 1:
            raise LanebInfraError(f"expected one main container for {project}, found {out}")
        return out[0]

    def _exec(self, container: str, script: str, stdin: bytes | None = None, timeout: float = 300) -> subprocess.CompletedProcess:
        return subprocess.run(["docker", "exec", "-i", container, "sh", "-c", script], input=stdin, capture_output=True, timeout=timeout)

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)
        container = await asyncio.to_thread(self._container_id, environment)
        self._arm_info = await asyncio.to_thread(self._inject_arm, container)
        await asyncio.to_thread(self._preflight, container)

    def _preflight(self, container: str) -> None:
        """Before any model call: the agent's container holds no network capability, and the processes running now are recorded."""
        evdir = self._evaluator_dir()
        evdir.mkdir(parents=True, exist_ok=True)
        try:
            res = self._exec(container, "cat /proc/self/status", timeout=PROBE_TIMEOUT_S)
        except (subprocess.SubprocessError, OSError) as e:
            raise LanebInfraError(f"preflight probe failed: {e}") from None
        if res.returncode != 0:
            raise LanebInfraError(f"preflight probe failed: {res.stderr[-300:]!r}")
        held = net_caps_held(res.stdout.decode(errors="replace"))
        if held:
            raise RuntimeError(f"preflight: the agent container must drop NET_RAW and NET_ADMIN (cap_drop in the job's extra compose file); still held: {held!r}")
        try:
            listing = self._exec(container, LIST_PROCESSES, timeout=PROBE_TIMEOUT_S)
        except (subprocess.SubprocessError, OSError) as e:
            raise LanebInfraError(f"preflight process listing failed: {e}") from None
        if listing.returncode != 0:
            raise LanebInfraError(f"preflight process listing failed: {listing.stderr[-300:]!r}")
        (evdir / "processes-before.tsv").write_bytes(listing.stdout)

    def _inject_arm(self, container: str) -> dict:
        tar = Path(self.options.arm_tar)
        digest = sha256_file(tar)
        if self.options.arm_sha256 and digest != self.options.arm_sha256:
            raise RuntimeError(f"arm {self.options.arm}: tar sha256 {digest} is not the preregistered {self.options.arm_sha256}")
        try:
            with tar.open("rb") as f:
                res = subprocess.run(["docker", "exec", "-i", container, "sh", "-c", "mkdir -p /root && tar -x -C /root"], stdin=f, capture_output=True, timeout=600)
        except subprocess.TimeoutExpired:
            raise LanebInfraError("arm extract timed out") from None
        if res.returncode != 0:
            raise LanebInfraError(f"arm extract failed: {res.stderr[-500:]!r}")
        listing = self._exec(container, "ls -1 /root/.claude/skills 2>/dev/null | sort").stdout.decode().split()
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
        if self.options.system_prompt not in SYSTEM_PROMPTS:
            raise ValueError(f"system_prompt {self.options.system_prompt!r} is not one of {sorted(SYSTEM_PROMPTS)}")
        if self.options.session_kind not in SESSION_KINDS:
            raise ValueError(f"session_kind {self.options.session_kind!r} is not one of {list(SESSION_KINDS)}")
        if self.options.procedure_line and (self.options.procedure_line not in PROCEDURE_LINES or not self.options.told_skill):
            raise ValueError(f"procedure_line {self.options.procedure_line!r} is not one of {sorted(PROCEDURE_LINES)} on a told arm")
        agent_options = {"system_prompt": self.options.system_prompt, "session_kind": self.options.session_kind, **({"told_skill": self.options.told_skill} if self.options.told_skill else {}),
                         **({"procedure_line": self.options.procedure_line} if self.options.procedure_line else {})}
        evdir = self._evaluator_dir()
        evdir.mkdir(parents=True, exist_ok=True)
        persona = json.loads(Path(self.options.persona_path).read_text())
        sim = Simulator(persona, evdir / "usersim-events.jsonl")
        log = sim.log

        container = await asyncio.to_thread(self._container_id, environment)
        arm_info = self._arm_info
        log(arm_info)

        auth = self._resolve_auth_env()
        base_url = auth.get("ANTHROPIC_BASE_URL")
        if not base_url:
            raise RuntimeError("laneb agent needs --base-url pointing at the metering proxy")

        open_body = {"trial": environment.session_id, "model": self.options.upstream_model, "cap_usd": self.options.session_cap_usd,
                     "meta": {"arm": self.options.arm, "arm_tar_sha256": arm_info["tar_sha256"], **agent_options}, "open_key": uuid.uuid4().hex}
        for attempt in range(1, OPEN_ATTEMPTS + 1):
            try:
                session = await asyncio.to_thread(post_json, self.options.control_url + "/sessions", open_body)
                break
            except HttpStatusError as e:
                if e.code == 409:
                    log({"event": "ledger_cap_stop", "message": str(e)[:300]})
                    raise LedgerCapStop(str(e)) from None
                if e.code < 500 or attempt == OPEN_ATTEMPTS:
                    raise LanebInfraError(f"session open failed: {e}") from None
                log({"event": "session_open_retry", "attempt": attempt, "message": str(e)[:300]})
                await asyncio.sleep(OPEN_RETRY_S)
            except Exception as e:
                if attempt == OPEN_ATTEMPTS:
                    raise LanebInfraError(f"session open failed after {attempt} attempts: {type(e).__name__}: {e}") from None
                log({"event": "session_open_retry", "attempt": attempt, "message": f"{type(e).__name__}: {e}"[:300]})
                await asyncio.sleep(OPEN_RETRY_S)
        log({"event": "session_open", "session": session["id"], "model": self.options.upstream_model, "cap_usd": self.options.session_cap_usd})

        started = time.time()
        result = {}
        error = None
        summary = None
        try:
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
            forwarded = FORWARDED_ENV
            if self.options.session_kind:
                env["GSTACK_SESSION_KIND"] = self.options.session_kind
                forwarded += ("GSTACK_SESSION_KIND",)

            wrapper_text = Path(self.options.wrapper_path).read_text()
            told = self.options.told_skill
            line = self.options.procedure_line
            prompt_text = build_prompt(wrapper_text, instruction, bool(told), told, procedure_line=line)
            log({"event": "prompt", "wrapper_sha256": hashlib.sha256(wrapper_text.encode()).hexdigest(), "instruction_sha256": hashlib.sha256(instruction.encode()).hexdigest(), "told_skill": told,
                 **({"procedure_line": line, "procedure_line_sha256": hashlib.sha256(PROCEDURE_LINES[line].encode()).hexdigest()} if line else {})})

            host_dir = Path(tempfile.mkdtemp(prefix="laneb-agent-"))
            wrapper = host_dir / "claude-in-container"
            forward = " ".join(f"-e {name}" for name in forwarded)
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
                **SYSTEM_PROMPTS[self.options.system_prompt],
            )
            log({"event": "disallowed_tools", "tools": disallowed})
            with (evdir / "sdk-messages.jsonl").open("a") as out:
                async for message in query(prompt=prompt(), options=options):
                    record = {"type": type(message).__name__, "t": round(time.time() - started, 2)}
                    data = getattr(message, "data", None)
                    if isinstance(data, dict) and data.get("subtype") == "init":
                        record["init"] = {k: data.get(k) for k in ("tools", "skills", "slash_commands", "model", "permissionMode", "cwd", "claude_code_version", "apiKeySource")} | agent_options
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
            # Run in a thread and awaited to the end even if this task is cancelled again, so Harbor never moves on to the
            # verifier before the teardown, close and summary finish.
            base = {"result": result, "error": None if error is None else {"type": type(error).__name__, "message": str(error)[:500]}, "arm": arm_info, **agent_options, "wall_s": round(time.time() - started, 1)}
            teardown = asyncio.ensure_future(asyncio.to_thread(self._teardown, container, session["id"], log, base))
            cancelled = None
            while not teardown.done():
                try:
                    await asyncio.shield(teardown)
                except asyncio.CancelledError as e:
                    cancelled = e
            summary = teardown.result()
            closed = summary["session"] or {}
            usage = closed.get("usage", {})
            cached = usage.get("cache_read_input_tokens", 0)
            context.n_input_tokens = usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_creation_1h_input_tokens", 0) + cached
            context.n_cache_tokens = cached
            context.n_output_tokens = usage.get("output_tokens", 0)
            context.cost_usd = closed["spent_micros"] / 1_000_000 if "spent_micros" in closed else None
            context.metadata = {"laneb": {"arm": self.options.arm, "session": session["id"], "refused": closed.get("refused"), "requests": closed.get("requests"), "ok_responses": closed.get("ok_responses"), "close_error": summary["close_error"], "result": result}}
            if cancelled is not None:
                raise cancelled
        if summary["session"] is not None and not summary["session"].get("ok_responses"):
            raise LanebInfraError(f"no model response reached the agent, so this is an infrastructure failure: {error or result}") from error

    def _teardown(self, container: str, session_id: str, log, base: dict) -> dict:
        """Stop Claude Code, record surviving processes, export the patch, close the session and write the summary.
        Each step's failure is recorded and never skips a later step."""
        evdir = self._evaluator_dir()
        errors = {}

        def note(entry: dict) -> None:
            try:
                log(entry)
            except Exception as e:
                errors.setdefault("log", f"{type(e).__name__}: {e}"[:300])

        try:
            self._exec(container, KILL_CLAUDE, timeout=30)
        except Exception as e:
            errors["kill"] = f"{type(e).__name__}: {e}"[:300]
        try:
            after = self._exec(container, LIST_PROCESSES, timeout=PROBE_TIMEOUT_S).stdout
            (evdir / "processes-after.tsv").write_bytes(after)
            before = parse_processes((evdir / "processes-before.tsv").read_text(errors="replace")) if (evdir / "processes-before.tsv").exists() else {}
            survivors = {pid: cmd for pid, cmd in parse_processes(after.decode(errors="replace")).items() if pid not in before}
            note({"event": "processes_after_agent", "new_since_setup": survivors})
        except Exception as e:
            errors["processes"] = f"{type(e).__name__}: {e}"[:300]
        try:
            patch = self._export_patch(container)
        except Exception as e:
            patch = {"event": "patch", "error": f"{type(e).__name__}: {e}"[:300]}
        note(patch)
        closed = None
        close_error = None
        try:
            closed = post_json(self.options.control_url + f"/sessions/{session_id}/close", {"reason": "agent_finished"}, timeout=self.options.close_timeout_sec)
        except Exception as e:
            close_error = f"{type(e).__name__}: {e}"[:500]
            note({"event": "close_failed", "session": session_id, "message": close_error})
        summary = {**base, "session": closed, "close_error": close_error, "patch": patch, "teardown_errors": errors}
        (evdir / "laneb-summary.json").write_text(json.dumps(summary, indent=2, default=str))
        return summary
