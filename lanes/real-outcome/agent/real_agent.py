"""The real-outcome lane's Harbor agent: one Claude Code conversation, two turns, in the ship sandbox.

Opt-in (plan 2026-11-01-geva-87, open items 4 to 7, 10 and 11): Harbor loads it as real_agent:RealAgent with this folder
and quick/laneb/runner/agent on PYTHONPATH. It wraps Lane B's agent and reuses its arm extract, capability preflight,
metered session, teardown and summary unchanged (laneb_agent.py and prompt-wrapper.md are pinned by sha256 in
tests/real-outcome/arms.test.ts). Per trial it:
  1. bundles the task's base branch from the container, opens the trial on the sidecar (lanes/real-outcome/sandbox),
     writes the IP-and-port egress table (egress.py) and runs the sidecar's prep: the gh stub, origin at the base commit,
     and the starting feature branch (or the K4 replay branch);
  2. opens one metered session and one Claude Code process with Claude Code's own system prompt (the SDK's default is an
     empty one, which no user of bare Claude Code gets) and a frozen environment: every GSTACK_ and CONDUCTOR_
     variable, CI, GITHUB_ACTIONS and OPENCLAW_SESSION the image sets is unset for claude and its children;
  3. sends the build turn (the statement and the shared line), waits until the session is quiet (its turn ended and no
     background task it started is still running, or bg_wait_sec passed after quiet_sec; bounded by the wall limit), snapshots the tree against base, then
     sends the arm's ship turn in the same conversation and waits for quiet again (a K4 replay sends only the ship turn);
  4. answers AskUserQuestion and prose questions from the ship persona (ship_user.py);
  5. always: closes the sidecar trial first and copies its shipment record, journal and bundle out, so nothing after the
     session counts as shipped; then runs Lane B's teardown, snapshots the final tree and writes real-summary.json, with
     the termination cause, the persona's counts, the /ship steps that ran (ship_steps.py) and the skills invoked per turn.
"""

import asyncio
import hashlib
import json
import re
import shlex
import shutil
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from claude_agent_sdk.types import TERMINAL_TASK_STATUSES, HookMatcher, PermissionResultAllow
from pydantic import Field

import egress
import laneb_agent as lb
from ship_steps import ship_steps
from ship_user import ShipUser

HERE = Path(__file__).resolve().parent
ARMS_FILE = HERE.parent / "arms" / "arms.json"
PERSONA_FILE = HERE / "ship-persona.json"

# Unset for claude and every process it starts, whatever the task image sets (eng-native F12): gstack-session-kind reads
# GSTACK_SESSION_KIND, GSTACK_HEADLESS, OPENCLAW_SESSION, CONDUCTOR_*, CI and GITHUB_ACTIONS, and other GSTACK_ variables
# move gstack's state root, plan mode or host. The pattern covers every name the image might set, not a list of today's.
FROZEN_ENV = r"^((GSTACK|CONDUCTOR)_[A-Za-z0-9_]*|CI|GITHUB_ACTIONS|OPENCLAW_SESSION)$"
FREEZE = (
    "for v in $(env | sed -n -E 's/^((GSTACK|CONDUCTOR)_[A-Za-z0-9_]*|CI|GITHUB_ACTIONS|OPENCLAW_SESSION)=.*/\\1/p'); "
    'do unset "$v"; done; exec claude "$@"'
)
TRIAL_CHARS = re.compile(r"[^A-Za-z0-9._-]")


class SandboxSetupError(RuntimeError):
    """E_REAL_SANDBOX_SETUP: the trial could not be prepared; no model was called."""


class RealOptions(lb.LanebOptions):
    persona_path: str = Field(default=str(PERSONA_FILE), description="The ship persona.")
    wrapper_path: str = Field(default="", description="Unused: the arm's turns replace Lane B's wrapper.")
    session_cap_usd: float = Field(default=0, description="Ignored: the arm's limits in arms.json set the cap.")
    task_json: str = Field(description="Host path of the task's task.json (B2); never mounted in the container.")
    arms_path: str = Field(default=str(ARMS_FILE), description="The frozen arms: turn texts and per-arm limits (B5).")
    sidecar_url: str = Field(default="http://127.0.0.1:8791", description="The sandbox sidecar's control plane.")
    repo_name: str = Field(default="sandbox/repo", description="owner/name the gh stub reports; never the upstream's.")
    feature_branch: str = Field(default="feature", description="The branch K1 to K3 trials start on, cut from base.")
    probe_node: str = Field(default="/opt/laneb/bin/node", description="Node in the runtime layer, for the in-container egress probe.")


def _block(b) -> dict:
    d = dict(getattr(b, "__dict__", {}) or {})
    d["type"] = {"TextBlock": "text", "ToolUseBlock": "tool_use", "ToolResultBlock": "tool_result", "ThinkingBlock": "thinking"}.get(type(b).__name__, type(b).__name__)
    return d


def message_record(message, t: float) -> dict:
    record = {"type": type(message).__name__, "t": round(t, 2)}
    for attr in ("subtype", "result", "usage", "total_cost_usd", "num_turns", "is_error", "stop_reason", "data"):
        if hasattr(message, attr):
            record[attr] = getattr(message, attr)
    content = getattr(message, "content", None)
    if isinstance(content, list):
        record["content"] = [_block(b) for b in content]
    elif content is not None:
        record["content"] = content
    return record


def phase_texts(task: dict, arms: dict, arm: str, instruction: str) -> list:
    """The user turns, in order: (phase, text). K4 has no build turn: the arm's replay turn carries the one-line
    description beside its turn 2 (after it, except that a slash command leads so Claude Code loads the skill)."""
    spec = arms["arms"][arm]
    if task["kind"] == "K4":
        return [("ship", spec["replay"].replace("{description}", task["replay"]["description"].strip()))]
    return [("build", instruction.rstrip() + "\n\n" + arms["build_suffix"]), ("ship", spec["turn2"])]


SNAPSHOT = r"""set -e
cd {repo}
gitdir=$(git rev-parse --absolute-git-dir)
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
mkdir -p "$d/objects"
if [ -f "$gitdir/index" ]; then cp "$gitdir/index" "$d/index"; else GIT_INDEX_FILE="$d/index" git read-tree HEAD; fi
export GIT_INDEX_FILE="$d/index" GIT_OBJECT_DIRECTORY="$d/objects" GIT_ALTERNATE_OBJECT_DIRECTORIES="$gitdir/objects"
git add -A >/dev/null 2>&1
tree=$(git write-tree)
echo "TREE $tree $(git rev-parse HEAD) $(git symbolic-ref -q --short HEAD || echo DETACHED)"
git diff --binary {base} "$tree"
"""


class RealAgent(lb.LanebAgent):
    options_model = RealOptions

    @staticmethod
    def name() -> str:
        return "real-outcome-claude-code"

    # The sidecar's control plane, on this host. Never Lane B's post_json, which the proxy calls use.
    def _sidecar(self, path: str, body: dict, timeout: float = 120) -> dict:
        req = urllib.request.Request(self.options.sidecar_url.rstrip("/") + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP sidecar {path} -> {e.code}: {e.read()[:500]!r}") from None
        except (urllib.error.URLError, OSError) as e:
            raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP sidecar {path} unreachable: {e}") from None

    def _container_ip(self, container: str) -> str:
        import subprocess

        out = subprocess.run(["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", container], capture_output=True, text=True, timeout=lb.PROBE_TIMEOUT_S)
        ips = out.stdout.split()
        if out.returncode != 0 or len(ips) != 1:
            raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP the container must sit on exactly one network; found {ips} ({out.stderr.strip()[-200:]})")
        return ips[0]

    def _open_sandbox(self, container: str, trial: str, task: dict, base_url: str, log) -> dict:
        evdir = self._evaluator_dir()
        repo = task["repo_dir"]
        if self.options.repo_dir and self.options.repo_dir != repo:
            raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP repo_dir {self.options.repo_dir} differs from the task's {repo}")
        res = self._exec(container, f"git -C {shlex.quote(repo)} bundle create - refs/heads/{shlex.quote(task['base_branch'])}", timeout=600)
        if res.returncode != 0:
            raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP could not bundle the base branch: {res.stderr[-300:]!r}")
        bundle = evdir / "base.bundle"
        bundle.write_bytes(res.stdout)
        opened = self._sidecar("/trials", {
            "trial": trial, "repo": self.options.repo_name, "kind": task["kind"], "base_branch": task["base_branch"], "base_commit": task["base_commit"],
            "start_ref": task["start_ref"], "bundle": str(bundle), "agent_ip": self._container_ip(container), "repo_dir": repo, "feature_branch": self.options.feature_branch,
        })
        log({"event": "sandbox_open", "trial": trial, "agent_url": opened["agent_url"], "project_docs": opened.get("project_docs", [])})
        try:
            allow = [egress.endpoint(base_url), egress.endpoint(opened["agent_url"])]
            log(egress.apply(container, allow))
            if self.options.probe_node:
                log(egress.probe(self._exec, container, allow, self.options.probe_node))
            prep = self._exec(container, "sh -s", stdin=opened["prep"].encode(), timeout=300)
            line = (prep.stdout.decode(errors="replace").strip().splitlines() or [""])[-1]
            if prep.returncode != 0 or not line.startswith("REAL_PREP_OK "):
                raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP prep failed: rc {prep.returncode} {prep.stderr.decode(errors='replace')[-400:]!r}")
            _, branch, head, origin_head = line.split()
            log({"event": "sandbox_prep", "branch": branch, "head": head, "origin_head": origin_head})
            return {"trial": trial, "branch": branch, "head": head, "project_docs": opened.get("project_docs", [])}
        except Exception:
            try:
                self._sidecar(f"/trials/{trial}/close", {"reason": "setup_failed"})
            except Exception:
                pass
            raise

    def _snapshot(self, container: str, task: dict, name: str) -> dict:
        """The working tree against base, written to evaluator/<name>.patch, without touching the agent's index or objects.
        The temporary index starts as a copy of the agent's, so a tracked file that matches .gitignore stays in the tree."""
        res = self._exec(container, SNAPSHOT.format(repo=shlex.quote(task["repo_dir"]), base=task["base_commit"]), timeout=300)
        out = res.stdout
        head, _, patch = out.partition(b"\n")
        parts = head.decode(errors="replace").split()
        if res.returncode != 0 or len(parts) != 4 or parts[0] != "TREE":
            return {"event": "snapshot", "name": name, "error": f"rc {res.returncode} {res.stderr[-300:]!r}"}
        (self._evaluator_dir() / f"{name}.patch").write_bytes(patch)
        return {"event": "snapshot", "name": name, "tree": parts[1], "head": parts[2], "branch": parts[3], "patch_bytes": len(patch), "patch_sha256": hashlib.sha256(patch).hexdigest()}

    def _open_session(self, trial: str, model: str, cap: float, log) -> dict:
        body = {"trial": trial, "model": self.options.upstream_model, "cap_usd": cap, "meta": {"arm": self.options.arm, "arm_tar_sha256": self._arm_info["tar_sha256"], "lane": "real-outcome"}, "open_key": uuid.uuid4().hex}
        for attempt in range(1, lb.OPEN_ATTEMPTS + 1):
            try:
                return lb.post_json(self.options.control_url + "/sessions", body)
            except lb.HttpStatusError as e:
                if e.code == 409:
                    log({"event": "ledger_cap_stop", "message": str(e)[:300]})
                    raise lb.LedgerCapStop(str(e)) from None
                if e.code < 500 or attempt == lb.OPEN_ATTEMPTS:
                    raise lb.LanebInfraError(f"session open failed: {e}") from None
            except Exception as e:
                if attempt == lb.OPEN_ATTEMPTS:
                    raise lb.LanebInfraError(f"session open failed after {attempt} attempts: {type(e).__name__}: {e}") from None
            log({"event": "session_open_retry", "attempt": attempt})
            time.sleep(lb.OPEN_RETRY_S)
        raise lb.LanebInfraError("unreachable")

    async def _drive(self, client, queue: asyncio.Queue, user: ShipUser, phase: str, text: str, deadline: float, record) -> dict:
        """Sends one phase's opening turn and reads until the session is quiet: the last turn ended, every background task
        it started reached a terminal status, and nothing arrived for quiet_sec. Background tasks still running then get at
        most bg_wait_sec more, and the phase ends quiet with bg_wait_expired. A prose question gets the persona's reply. The
        wall deadline ends the phase as wall_limit, inside any wait and before any turn is sent."""
        if time.time() >= deadline:
            return {"phase": phase, "end": "wall_limit", "results": 0, "active_tasks": []}
        user.start(phase)
        await client.query(text)
        turn_open, active, last_text, results, bg_until = True, set(), "", 0, None
        quiet, bg_wait = float(self.limits["quiet_sec"]), float(self.limits["bg_wait_sec"])
        while True:
            now = time.time()
            remaining = deadline - now
            if remaining <= 0:
                return {"phase": phase, "end": "wall_limit", "results": results, "active_tasks": sorted(active)}
            wait = remaining if turn_open else min(bg_until - now if active and bg_until is not None else quiet, remaining)
            try:
                kind, message = await asyncio.wait_for(queue.get(), timeout=max(wait, 0))
            except (asyncio.TimeoutError, TimeoutError):
                if wait >= remaining or time.time() >= deadline:
                    return {"phase": phase, "end": "wall_limit", "results": results, "active_tasks": sorted(active)}
                if active and bg_until is None:
                    bg_until = time.time() + bg_wait
                    continue
                if active:
                    return {"phase": phase, "end": "quiet", "results": results, "active_tasks": sorted(active), "bg_wait_expired": True}
                reply = user.prose(last_text)
                if reply is None:
                    return {"phase": phase, "end": "quiet", "results": results, "active_tasks": []}
                await client.query(reply)
                turn_open, last_text = True, ""
                continue
            if kind == "end":
                return {"phase": phase, "end": "cli_exit", "results": results, "active_tasks": sorted(active)}
            if kind == "error":
                raise message
            record(message, phase)
            name = type(message).__name__
            sub = getattr(message, "subtype", None)
            data = getattr(message, "data", None) or {}
            if name == "ResultMessage":
                turn_open = False
                results += 1
                if sub == "error_max_turns":
                    return {"phase": phase, "end": "turn_ceiling", "results": results, "active_tasks": sorted(active)}
                if getattr(message, "is_error", False):
                    return {"phase": phase, "end": "error_result", "subtype": sub, "results": results, "active_tasks": sorted(active)}
            elif sub == "task_started":
                active.add(data.get("task_id"))
            elif sub == "task_notification" and data.get("status") in TERMINAL_TASK_STATUSES:
                active.discard(data.get("task_id"))
            elif sub == "task_updated" and (data.get("patch") or {}).get("status") in TERMINAL_TASK_STATUSES:
                active.discard(data.get("task_id"))
            elif name in ("AssistantMessage", "UserMessage", "StreamEvent"):
                turn_open, bg_until = True, None
                if name == "AssistantMessage":
                    last_text = "\n".join(getattr(b, "text", "") for b in getattr(message, "content", []) or [] if type(b).__name__ == "TextBlock")
                elif name == "UserMessage":
                    last_text = ""

    async def run(self, instruction: str, environment, context) -> None:
        evdir = self._evaluator_dir()
        evdir.mkdir(parents=True, exist_ok=True)
        user = ShipUser(json.loads(Path(self.options.persona_path).read_text()), evdir / "usersim-events.jsonl")
        log = user.log
        container = await asyncio.to_thread(self._container_id, environment)
        log(self._arm_info)
        task = json.loads(Path(self.options.task_json).read_text())
        arms = json.loads(Path(self.options.arms_path).read_text())
        if self.options.arm not in arms["arms"]:
            raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP unknown arm {self.options.arm}")
        self.limits = arms["arms"][self.options.arm]["limits"]
        phases = phase_texts(task, arms, self.options.arm, instruction)
        log({"event": "turns", "arm": self.options.arm, "kind": task["kind"], "phases": [p for p, _ in phases], "sha256": [hashlib.sha256(t.encode()).hexdigest() for _, t in phases], "limits": self.limits, "frozen_env": FROZEN_ENV})
        base_url = self._resolve_auth_env().get("ANTHROPIC_BASE_URL")
        if not base_url:
            raise RuntimeError("the real-outcome agent needs --base-url pointing at the metering proxy")
        trial = TRIAL_CHARS.sub("-", environment.session_id)[:100] + "-" + uuid.uuid4().hex[:8]
        opening = asyncio.ensure_future(asyncio.to_thread(self._open_sandbox, container, trial, task, base_url, log))
        try:
            sandbox = await asyncio.shield(opening)
        except (asyncio.CancelledError, KeyboardInterrupt):
            await self._close_cancelled_open(opening, trial, log)
            raise
        try:
            session = await asyncio.to_thread(self._open_session, trial, self.options.upstream_model, float(self.limits["session_cap_usd"]), log)
        except (Exception, asyncio.CancelledError, KeyboardInterrupt) as e:
            await asyncio.shield(asyncio.to_thread(self._close_sandbox, trial, "session_open_failed" if isinstance(e, Exception) else "cancelled", log))
            raise
        log({"event": "session_open", "session": session["id"], "cap_usd": self.limits["session_cap_usd"]})

        started = time.time()
        deadline = started + float(self.limits["wall_limit_sec"])
        outcome = {"phases": [], "termination": None, "turn1": None}
        error = interrupted = None
        result = {}
        by_phase = {p: [] for p, _ in phases}
        reader = None
        client = None
        try:
            model = self._resolved_model_name() or self.options.upstream_model
            env = {
                "ANTHROPIC_API_KEY": session["token"], "ANTHROPIC_BASE_URL": base_url, "ANTHROPIC_MODEL": model, **{k: model for k in lb.ALIAS_ENV},
                "CLAUDE_CONFIG_DIR": "/root/.claude", "HOME": "/root", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1",
                "CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(self.options.max_output_tokens), "DISABLE_AUTOUPDATER": "1", "DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1", "IS_SANDBOX": "1",
            }
            host_dir = Path(tempfile.mkdtemp(prefix="real-agent-"))
            wrapper = host_dir / "claude-in-container"
            forward = " ".join(f"-e {name}" for name in lb.FORWARDED_ENV)
            wrapper.write_text(f"#!/bin/sh\nexec docker exec -i -w {shlex.quote(task['repo_dir'])} {forward} {container} sh -c {shlex.quote(FREEZE)} claude \"$@\"\n")
            wrapper.chmod(0o755)

            async def can_use_tool(tool_name, tool_input, ctx):
                if tool_name == "AskUserQuestion":
                    return PermissionResultAllow(updated_input={**tool_input, "answers": user.answer(tool_input.get("questions", []))})
                return PermissionResultAllow(updated_input=tool_input)

            async def keep_open(input_data, tool_use_id, ctx):
                return {"continue_": True}

            options = ClaudeAgentOptions(
                cli_path=str(wrapper), cwd=str(host_dir), env=env, can_use_tool=can_use_tool, hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[keep_open])]},
                system_prompt={"type": "preset", "preset": "claude_code"},
                permission_mode="default", model=model, setting_sources=["user", "project"], max_turns=int(self.limits["max_turns"]),
                disallowed_tools=["WebSearch", "WebFetch"], extra_args={"strict-mcp-config": None},
            )
            out = (evdir / "sdk-messages.jsonl").open("a")

            def record(message, phase):
                rec = message_record(message, time.time() - started)
                rec["phase"] = phase
                by_phase[phase].append(rec)
                if rec["type"] == "ResultMessage":
                    result.update({k: rec.get(k) for k in ("subtype", "num_turns", "is_error", "total_cost_usd", "stop_reason")})
                out.write(json.dumps(rec, default=lambda o: getattr(o, "__dict__", str(o))) + "\n")
                out.flush()

            client = ClaudeSDKClient(options=options)
            await client.connect()
            queue: asyncio.Queue = asyncio.Queue()

            async def pump():
                try:
                    async for m in client.receive_messages():
                        await queue.put(("message", m))
                    await queue.put(("end", None))
                except Exception as e:
                    await queue.put(("error", e))

            reader = asyncio.ensure_future(pump())
            for phase, text in phases:
                end = await self._drive(client, queue, user, phase, text, deadline, record)
                outcome["phases"].append(end)
                if phase == "build":
                    snap = await asyncio.to_thread(self._snapshot, container, task, "turn1")
                    snap["skill_calls"] = ship_steps(by_phase["build"])["skill_calls"]
                    outcome["turn1"] = snap
                    log(snap)
                if end["end"] != "quiet":
                    break
            outcome["termination"] = "completed" if all(p["end"] == "quiet" for p in outcome["phases"]) and len(outcome["phases"]) == len(phases) else outcome["phases"][-1]["end"]
        except Exception as e:
            error = e
            outcome["termination"] = "error"
            log({"event": "agent_error", "type": type(e).__name__, "message": str(e)[:500]})
        except (asyncio.CancelledError, KeyboardInterrupt) as e:
            interrupted = e
            outcome["termination"] = "cancelled"
            log({"event": "agent_cancelled", "type": type(e).__name__})
        finally:
            if reader is not None:
                reader.cancel()
            base = {"result": result, "error": None if error is None else {"type": type(error).__name__, "message": str(error)[:500]}, "arm": self._arm_info, "wall_s": round(time.time() - started, 1)}
            finish = asyncio.ensure_future(asyncio.to_thread(self._finish, container, session["id"], trial, task, log, base, outcome, user, by_phase, sandbox))
            cancelled = None
            while not finish.done():
                try:
                    await asyncio.shield(finish)
                except asyncio.CancelledError as e:
                    cancelled = e
            summary = finish.result()
            if client is not None and cancelled is None:
                try:
                    await asyncio.wait_for(client.disconnect(), timeout=30)
                except BaseException as e:
                    log({"event": "disconnect_error", "type": type(e).__name__})
            closed = summary["session"] or {}
            usage = closed.get("usage", {})
            cached = usage.get("cache_read_input_tokens", 0)
            context.n_input_tokens = usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_creation_1h_input_tokens", 0) + cached
            context.n_cache_tokens = cached
            context.n_output_tokens = usage.get("output_tokens", 0)
            context.cost_usd = closed["spent_micros"] / 1_000_000 if "spent_micros" in closed else None
            context.metadata = {"real_outcome": {"arm": self.options.arm, "session": session["id"], "termination": outcome["termination"], "shipment": summary.get("real", {}).get("shipment")}}
            if cancelled is not None:
                raise cancelled
        if interrupted is not None:
            raise interrupted
        if summary["session"] is not None and not summary["session"].get("ok_responses"):
            raise lb.LanebInfraError(f"no model response reached the agent, so this is an infrastructure failure: {error or result}") from error

    async def _close_cancelled_open(self, opening, trial: str, log) -> None:
        """A cancellation while the sandbox opens: the open runs on in its thread, so wait for it, then close the trial as
        cancelled. An open that failed has closed its trial itself (setup_failed)."""
        while not opening.done():
            try:
                await asyncio.shield(opening)
            except BaseException:
                pass
        if opening.exception() is None:
            try:
                await asyncio.shield(asyncio.to_thread(self._close_sandbox, trial, "cancelled", log))
            except BaseException:
                pass

    def _close_sandbox(self, trial: str, reason: str, log) -> dict:
        closed = self._sidecar(f"/trials/{trial}/close", {"reason": reason})
        evdir = self._evaluator_dir()
        copied = {}
        for key, path in closed["files"].items():
            if path:
                shutil.copyfile(path, evdir / Path(path).name)
                copied[key] = Path(path).name
        text = (evdir / "shipment.json").read_bytes()
        if hashlib.sha256(text).hexdigest() != closed["record_sha256"]:
            raise RuntimeError("E_REAL_SANDBOX_RECORD the copied shipment record does not match the sidecar's sha256")
        record = closed["record"]
        info = {"record_sha256": closed["record_sha256"], "status": record["status"], "shipped_head": record["shipped_head"], "rig_errors": [e["kind"] for e in record["rig_errors"]], "files": copied}
        log({"event": "sandbox_close", "trial": trial, **info})
        return info

    def _finish(self, container, session_id, trial, task, log, base, outcome, user, by_phase, sandbox) -> dict:
        """Close the sidecar trial first, then Lane B's teardown (kill, processes, patch, session close, laneb-summary.json),
        then the final tree and real-summary.json. Each step's failure is recorded and never skips a later one."""
        errors = {}
        shipment = None
        try:
            shipment = self._close_sandbox(trial, outcome["termination"] or "error", log)
        except Exception as e:
            errors["sandbox_close"] = f"{type(e).__name__}: {e}"[:500]
        summary = self._teardown(container, session_id, log, base)
        try:
            final = self._snapshot(container, task, "final")
        except Exception as e:
            final = {"error": f"{type(e).__name__}: {e}"[:300]}
        steps = ship_steps([m for ms in by_phase.values() for m in ms])
        ship_phase = ship_steps(by_phase.get("ship", []))
        real = {
            "trial": trial, "arm": self.options.arm, "kind": task["kind"], "termination": outcome["termination"], "phases": outcome["phases"],
            "limits": self.limits, "frozen_env": FROZEN_ENV, "sandbox": sandbox, "shipment": shipment, "turn1": outcome["turn1"], "final": final,
            "persona": user.counts, "ship_steps": ship_phase["steps"], "skill_calls": {"build": ship_steps(by_phase.get("build", []))["skill_calls"], "ship": ship_phase["skill_calls"]},
            "tool_calls": steps["tool_calls"], "proxy": {k: (summary["session"] or {}).get(k) for k in ("spent_micros", "requests", "ok_responses", "refused")}, "errors": errors,
        }
        (self._evaluator_dir() / "real-summary.json").write_text(json.dumps(real, indent=2, default=str))
        summary["real"] = real
        return summary
