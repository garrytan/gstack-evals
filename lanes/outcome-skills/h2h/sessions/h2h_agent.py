# Copyright (c) 2026 Garry Tan. MIT License.
"""The head-to-head Harbor agent (post sections 3 and 7), loaded as h2h_agent:H2hAgent with this folder,
lanes/outcome-skills/pfchecks, lanes/real-outcome/agent and quick/laneb/runner/agent on PYTHONPATH. It subclasses
real_agent's RealAgent and leaves real_agent.py and pf_agent.py untouched. Per trial it:
  1. checks the trial container runs the image the manifest pins for its session (real_agent's U4 image check);
  2. allows egress to the metering proxy only, as pf_agent does;
  3. copies pfchecks' sh scripts and this folder's sh/ into the container, and the arm's installed HOME over /root (the
     none arm copies nothing), with docker cp, so the image's own files under /root stay;
  4. runs h2h_turns' session on one driver slot (H2hSlots: meta names no phase, cap_usd is the session allowance, a
     whole-session retry names meta.rerun, and a 409 on the open is a cap stop).
Claude Code is the container's own pinned binary, run through real_agent's docker-exec wrapper (FREEZE) as cli_path.
h2h_config is a host JSON file run.ts writes: turns, continuation, done_rule, continuation_cap, limits, no_answer,
disallowed_tools, env, home (a host dir, or null) and home_rule; the extension's part P (ext/session.ts) adds generations,
which h2h_turns reads to write each answer's generation record before the slot closes.
An s-* arm (the extension's part S, Sol in Codex) runs ext/h2h_codex.py's loop in step 4 instead, on the same slot; its
h2h_config is ext/run.ts's and adds host "codex" and the codex block. Every other arm stays on the Claude Code path.
"""
import asyncio
import json
import shlex
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from pydantic import Field

import egress
import laneb_agent as lb
from h2h_turns import SlotRefused, Turns, run_session
from pf_agent import DriverSlots

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ext"))
from h2h_codex import CodexTurns  # noqa: E402
from real_agent import FREEZE, RealAgent, RealOptions, SandboxSetupError

HERE = Path(__file__).resolve().parent
SH = [HERE.parents[1] / "pfchecks" / "sh", HERE / "sh"]
SH_DIR = "/opt/h2h-sh"
WORK = "/tmp/h2h-work"
HOME = "/root"


class H2hOptions(RealOptions):
    h2h_config: str = Field(description="Host path of the session's h2h config (run.ts writes it); never mounted in the container.")


class H2hSlots(DriverSlots):
    """One U4 slot per session on the outcome driver's h2h stage."""

    def open(self, rerun) -> dict:
        o = self.agent.options
        meta = {"arm": o.arm, "task": o.task_label, "trial_n": o.trial_n, **({"rerun": rerun} if rerun else {})}
        body = {"trial": self.trial, "model": o.upstream_model, "cap_usd": float(self.limits["allowance_usd"]), "ledger": "u4", "open_key": uuid.uuid4().hex, "meta": meta}
        for attempt in range(1, lb.OPEN_ATTEMPTS + 1):
            try:
                session = lb.post_json(o.control_url + "/sessions", body)
            except lb.HttpStatusError as e:
                if e.code == 409:
                    self.log({"event": "ledger_cap_stop", "message": str(e)[:300]})
                    raise SlotRefused(str(e)) from None
                if e.code < 500 or attempt == lb.OPEN_ATTEMPTS:
                    raise lb.LanebInfraError(f"session slot open failed: {e}") from None
            except Exception as e:
                if attempt == lb.OPEN_ATTEMPTS:
                    raise lb.LanebInfraError(f"session slot open failed after {attempt} attempts: {type(e).__name__}: {e}") from None
            else:
                slot = self.agent._u4_slot(session, self.log)
                self.log({"event": "slot_open", "rerun": rerun, "session": slot["id"], "allowance_micros": slot.get("allowance_micros")})
                return {**slot, "phase": "session", "rerun": rerun}
            time.sleep(lb.OPEN_RETRY_S)
        raise lb.LanebInfraError("unreachable")


class H2hAgent(RealAgent):
    options_model = H2hOptions

    @staticmethod
    def name() -> str:
        return "h2h-claude-code"

    async def run(self, instruction: str, environment, context) -> None:
        evdir = self._evaluator_dir()
        evdir.mkdir(parents=True, exist_ok=True)
        o = self.options
        task = json.loads(Path(o.task_json).read_text())
        h = json.loads(Path(o.h2h_config).read_text())
        if o.ledger != "u4" or not (o.task_label and o.trial_n >= 1):
            raise SandboxSetupError("E_REAL_SANDBOX_SETUP an h2h session spends only through a U4 slot: set ledger u4, task_label and trial_n (from 1)")
        base_url = self._resolve_auth_env().get("ANTHROPIC_BASE_URL")
        if not base_url:
            raise RuntimeError("the h2h agent needs --base-url pointing at the metering proxy")
        container = await asyncio.to_thread(self._container_id, environment)
        events = []
        log = events.append
        await asyncio.to_thread(self._check_image, container, log)
        allow = [egress.endpoint(base_url)]
        log(egress.apply(container, allow))
        if o.probe_node:
            log(egress.probe(self._exec, container, allow, o.probe_node))
        for src, dest in [*((s, SH_DIR) for s in SH), *([(Path(h["home"]), HOME)] if h.get("home") else [])]:
            cp = subprocess.run(["docker", "cp", str(src) + "/.", f"{container}:{dest}"], capture_output=True, text=True, timeout=600)
            if cp.returncode != 0:
                raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP could not copy {src} into the container at {dest}: {cp.stderr[-300:]}")
        repo = task["repo_dir"]
        if o.arm.split(":", 1)[-1].startswith("s-"):
            await self._run_codex(h, task, container, evdir, events, log, context)
            return
        model = self._resolved_model_name() or o.upstream_model
        env = {**h["env"], "ANTHROPIC_MODEL": model, **{k: model for k in lb.ALIAS_ENV}}
        host_dir = Path(tempfile.mkdtemp(prefix="h2h-agent-"))
        wrapper = host_dir / "claude-in-container"
        forward = " ".join(f"-e {n}" for n in dict.fromkeys([*lb.FORWARDED_ENV, *env, "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION"]))
        wrapper.write_text(f"#!/bin/sh\nexec docker exec -i -w {shlex.quote(repo)} {forward} {container} sh -c {shlex.quote(FREEZE)} claude \"$@\"\n")
        wrapper.chmod(0o755)
        trial = "h2h-" + uuid.uuid4().hex[:12]
        cfg = {
            "cli_path": str(wrapper), "cwd": str(host_dir), "repo": repo, "work": WORK, "sh_dir": SH_DIR, "home": HOME, "exec_prefix": ["docker", "exec", "-i", "-w", repo, container], "container": container,
            "out": str(evdir), "model": model, "no_answer": h["no_answer"], "env": env, "turns": h["turns"], "continuation": h["continuation"], "done_rule": h["done_rule"],
            "continuation_cap": h["continuation_cap"], "limits": h["limits"], "disallowed_tools": h["disallowed_tools"], "home_rule": h["home_rule"], "rerun": o.rerun or None,
            "commits": task["commits"], "head": task["base_commit"], "generations": bool(h.get("generations")),
        }
        summary = await run_session(Turns(cfg, H2hSlots(self, trial, h["limits"], log)))
        summary["events"] = events
        summary["trial"] = trial
        (evdir / "h2h-summary.json").write_text(json.dumps(summary, indent=1, default=str))
        spent = ((summary.get("slot") or {}).get("close") or {}).get("spent_micros")
        context.cost_usd = spent / 1_000_000 if spent is not None else None
        context.metadata = {"h2h": {"arm": o.arm, "trial": trial, "turns": [t["termination"] for t in summary["turns"]], "refused": summary.get("refused")}}

    async def _run_codex(self, h: dict, task: dict, container: str, evdir: Path, events: list, log, context) -> None:
        """An s-* arm's session: ext/h2h_codex.py's loop on the same driver slot, with Codex run in the container through
        the runtime volume's sol-agent link and the config's codex block (ext/run.ts writes it)."""
        o = self.options
        if not isinstance(h.get("codex"), dict) or h.get("host") != "codex":
            raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP arm {o.arm} runs in Codex, but its h2h config names no codex host block (ext/run.ts writes it); nothing was opened")
        repo = task["repo_dir"]
        trial = "h2h-" + uuid.uuid4().hex[:12]
        cfg = {
            "repo": repo, "work": WORK, "sh_dir": SH_DIR, "home": HOME, "exec_prefix": ["docker", "exec", "-i", "-w", repo, container], "container": container, "out": str(evdir),
            "no_answer": h["no_answer"], "env": h["env"], "turns": h["turns"], "continuation": h["continuation"], "done_rule": h["done_rule"], "continuation_cap": h["continuation_cap"],
            "limits": h["limits"], "home_rule": h["home_rule"], "rerun": o.rerun or None, "commits": task["commits"], "head": task["base_commit"], "codex": h["codex"],
        }
        summary = await run_session(CodexTurns(cfg, H2hSlots(self, trial, h["limits"], log)))
        summary["events"] = events
        summary["trial"] = trial
        (evdir / "h2h-summary.json").write_text(json.dumps(summary, indent=1, default=str))
        spent = ((summary.get("slot") or {}).get("close") or {}).get("spent_micros")
        context.cost_usd = spent / 1_000_000 if spent is not None else None
        context.metadata = {"h2h": {"arm": o.arm, "host": "codex", "trial": trial, "turns": [t["termination"] for t in summary["turns"]], "refused": summary.get("refused"), "thread": (summary.get("codex") or {}).get("thread_id")}}
