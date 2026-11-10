# Copyright (c) 2026 Garry Tan. MIT License.
"""The pstack-checks Harbor agent (plan sections 4 and 5), loaded as pf_agent:PfAgent with this folder,
lanes/real-outcome/agent and quick/laneb/runner/agent on PYTHONPATH. It subclasses real_agent's RealAgent and leaves
real_agent.py untouched. Per trial it:
  1. checks the trial container runs the image the T-G manifest pins for its task (real_agent's U4 image check);
  2. allows egress to the metering proxy only, as real_agent's family SM open does;
  3. copies sh/capture.sh and sh/wrapup.sh into the container and runs pf_turns' two-turn core there: the tree and home
     check before any open, the inventory, the task turn on its own driver slot (meta.phase task), capture.sh commit and
     wrapup.sh save, the wrap-up turn on its own slot (meta.phase wrapup) resuming the same session in a new CLI process,
     one wrap-up rerun on a new slot naming meta.rerun after wrapup.sh reset, then wrapup.sh keep and the S bundle.
Claude Code is the container's own pinned binary, run through real_agent's docker-exec wrapper (FREEZE) as cli_path.
pf_config is a host JSON file run.ts writes: task_text, wrapup_text, limits per phase (with allowance_usd), no_answer,
plugin (the pstack plugin dir for P and blind, else null) and env (Claude Code's env block plus the tools volume's).
"""
import asyncio
import shlex
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from pydantic import Field

import egress
import laneb_agent as lb
from pf_turns import OpenRefused, Session, run_session
from real_agent import FREEZE, RealAgent, RealOptions, SandboxSetupError

SH = Path(__file__).resolve().parent / "sh"
SH_DIR = "/opt/pf-sh"
WORK = "/tmp/pf-work"


class PfOptions(RealOptions):
    pf_config: str = Field(description="Host path of the session's pf config (run.ts writes it); never mounted in the container.")


class DriverSlots:
    """One U4 slot per turn on the outcome-skills driver: phase task or wrapup in meta, cap_usd from that turn's allowance.
    A 409 on a wrap-up open raises OpenRefused (the wrap-up is refused for its allowance); on a task open, LedgerCapStop.
    Each close keeps the driver's answer, first_request (the proxy-recorded effort fields) included."""

    def __init__(self, agent: "PfAgent", trial: str, limits: dict, log):
        self.agent, self.trial, self.limits, self.log = agent, trial, limits, log

    def open(self, phase: str, rerun: str | None) -> dict:
        o = self.agent.options
        rerun = rerun if phase == "wrapup" else (o.rerun or None)
        meta = {"arm": o.arm, "task": o.task_label, "trial_n": o.trial_n, "phase": phase, **({"rerun": rerun} if rerun else {})}
        body = {"trial": self.trial, "model": o.upstream_model, "cap_usd": float(self.limits[phase]["allowance_usd"]), "ledger": "u4", "open_key": uuid.uuid4().hex, "meta": meta}
        for attempt in range(1, lb.OPEN_ATTEMPTS + 1):
            try:
                session = lb.post_json(o.control_url + "/sessions", body)
            except lb.HttpStatusError as e:
                if e.code == 409:
                    self.log({"event": "ledger_cap_stop", "phase": phase, "message": str(e)[:300]})
                    raise (OpenRefused if phase == "wrapup" else lb.LedgerCapStop)(str(e)) from None
                if e.code < 500 or attempt == lb.OPEN_ATTEMPTS:
                    raise lb.LanebInfraError(f"{phase} slot open failed: {e}") from None
            except Exception as e:
                if attempt == lb.OPEN_ATTEMPTS:
                    raise lb.LanebInfraError(f"{phase} slot open failed after {attempt} attempts: {type(e).__name__}: {e}") from None
            else:
                slot = self.agent._u4_slot(session, self.log)
                self.log({"event": "slot_open", "phase": phase, "rerun": rerun, "session": slot["id"], "allowance_micros": slot.get("allowance_micros")})
                return {**slot, "phase": phase, "rerun": rerun}
            time.sleep(lb.OPEN_RETRY_S)
        raise lb.LanebInfraError("unreachable")

    def close(self, slot: dict, reason: str) -> dict:
        try:
            closed = lb.post_json(self.agent.options.control_url + f"/sessions/{slot['id']}/close", {"reason": reason})
        except Exception as e:
            self.log({"event": "close_failed", "session": slot["id"], "message": str(e)[:300]})
            return {"error": f"{type(e).__name__}: {e}"[:300]}
        info = {k: closed.get(k) for k in ("spent_micros", "requests", "ok_responses", "refused", "refusals", "allowance_stops", "usage", "first_request")}
        self.log({"event": "slot_close", "phase": slot["phase"], "session": slot["id"], **{k: info[k] for k in ("spent_micros", "refused", "allowance_stops")}})
        return info


class PfAgent(RealAgent):
    options_model = PfOptions

    @staticmethod
    def name() -> str:
        return "pf-checks-claude-code"

    async def run(self, instruction: str, environment, context) -> None:
        import json

        evdir = self._evaluator_dir()
        evdir.mkdir(parents=True, exist_ok=True)
        o = self.options
        task = json.loads(Path(o.task_json).read_text())
        pf = json.loads(Path(o.pf_config).read_text())
        if o.ledger != "u4" or not (o.task_label and o.trial_n >= 1):
            raise SandboxSetupError("E_REAL_SANDBOX_SETUP a pf session spends only through a U4 slot: set ledger u4, task_label and trial_n (from 1)")
        base_url = self._resolve_auth_env().get("ANTHROPIC_BASE_URL")
        if not base_url:
            raise RuntimeError("the pf agent needs --base-url pointing at the metering proxy")
        container = await asyncio.to_thread(self._container_id, environment)
        events = []
        log = events.append
        await asyncio.to_thread(self._check_image, container, log)
        allow = [egress.endpoint(base_url)]
        log(egress.apply(container, allow))
        if o.probe_node:
            log(egress.probe(self._exec, container, allow, o.probe_node))
        cp = subprocess.run(["docker", "cp", str(SH) + "/.", f"{container}:{SH_DIR}"], capture_output=True, text=True, timeout=120)
        if cp.returncode != 0:
            raise SandboxSetupError(f"E_REAL_SANDBOX_SETUP could not copy the pf scripts into the container: {cp.stderr[-300:]}")
        repo = task["repo_dir"]
        model = self._resolved_model_name() or o.upstream_model
        env = {**pf["env"], "ANTHROPIC_MODEL": model, **{k: model for k in lb.ALIAS_ENV}}
        host_dir = Path(tempfile.mkdtemp(prefix="pf-agent-"))
        wrapper = host_dir / "claude-in-container"
        forward = " ".join(f"-e {n}" for n in dict.fromkeys([*lb.FORWARDED_ENV, *env, "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION"]))
        wrapper.write_text(f"#!/bin/sh\nexec docker exec -i -w {shlex.quote(repo)} {forward} {container} sh -c {shlex.quote(FREEZE)} claude \"$@\"\n")
        wrapper.chmod(0o755)
        trial = "pf-" + uuid.uuid4().hex[:12]
        cfg = {
            "cli_path": str(wrapper), "cwd": str(host_dir), "repo": repo, "work": WORK, "sh_dir": SH_DIR, "exec_prefix": ["docker", "exec", "-i", "-w", repo, container],
            "out": str(evdir), "model": model, "no_answer": pf["no_answer"], "env": env, "plugin": pf.get("plugin"), "task_text": pf["task_text"], "wrapup_text": pf["wrapup_text"],
            "limits": pf["limits"], "commits": task["commits"], "head": task["base_commit"],
        }
        s = Session(cfg, DriverSlots(self, trial, pf["limits"], log))
        summary = await run_session(s)
        summary["events"] = events
        summary["trial"] = trial
        (evdir / "pf-summary.json").write_text(json.dumps(summary, indent=1, default=str))
        spent = [(x.get("close") or {}).get("spent_micros") for x in summary["slots"]]
        context.cost_usd = sum(v for v in spent if v) / 1_000_000 if any(v is not None for v in spent) else None
        context.metadata = {"pf": {"arm": o.arm, "trial": trial, "task": (summary.get("task") or {}).get("termination"), "wrapup": [w["termination"] for w in summary["wrapup"]], "refused": summary.get("refused")}}
