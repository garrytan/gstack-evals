# Copyright (c) 2026 Garry Tan. MIT License.
"""The pstack-checks two-turn session (plan sections 4 and 5) on the real Claude Agent SDK, used by pf_agent.PfAgent under
Harbor and by the dry run. The task turn runs on its own slot, then capture.sh commits S in the session container and
saves its head and inventory in the same run, then the wrap-up turn resumes the same Claude Code session in a new CLI process with its own limits
(300 s, 20 turns) on its own slot. A task turn that ends upstream or infra (task_end) ends the session there, before the
capture, so run.ts retries the whole session; a completed or limit end, an allowance stop included, goes on. An upstream or infra end of the wrap-up turn puts the tree back to S (wrapup.sh reset)
and reruns the wrap-up turn once on a new slot naming meta.rerun. A wrap-up turn refused for its allowance (an allowance
stop on its slot, which the driver's close answer counts in allowance_stops, or the driver's 409 on its open, raised as
OpenRefused) is never rerun; the proxy's other E_ALLOWANCE refusals are no allowance stop. A turn whose close answer says
the proxy's finalize failed (finalized false), with no allowance stop counted, halts the session: nothing more opens
after such a task turn, such a wrap-up turn is not rerun, and run.ts stops with E_PF_FINALIZE_HALT. wrapup.sh keep then keeps only
CHECKS.json and counts every other change. S leaves the container as a git bundle. A post-turn step that fails (the
capture, a reset, the keep or the bundle) ends the session with a refusal: E_PF_ARM post_turn when the cause lies in what
the agent wrote, as sh/state.sh reads it, and E_PF_CAPTURE otherwise (Session.step).

Each turn ends as real_agent's _drive ends a phase: the agent ended its turn and its background tasks are quiet (quiet_sec,
then bg_wait_sec with nothing ends it as bg_wait_expired), bounded by the turn's wall limit. AskUserQuestion and prose
questions get the frozen answer through #290's sm_user.NoAnswer.

Before any slot opens the tree must hold none of the files the strip rule removes and the home no gstack and no drive, as
real_agent's family SM check reads them, with the commit count and head the task names when it names them.
Usage: python pf_turns.py <config.json>. It writes pf-summary.json, sdk-messages.jsonl (records carry phase task or
wrapup), claude-session.jsonl (Claude Code's own transcript), usersim-events.jsonl, s.bundle and CHECKS.json (when kept)
under out, and pf-opens.jsonl, one line before each slot open request, so run.ts can tell that a killed attempt with no
summary may have spent.
"""
import asyncio
import json
import shlex
import subprocess
import sys
import time
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from claude_agent_sdk.types import HookMatcher, PermissionResultAllow

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "lanes" / "real-outcome" / "agent"), str(ROOT / "quick" / "laneb" / "runner" / "agent")]
from real_agent import SM_CHECK, RealAgent, message_record  # noqa: E402
from sm_user import NoAnswer  # noqa: E402

RERUN = {"task": "task_upstream_or_infra", "wrapup": "wrapup_upstream_or_infra"}
ENDS = {"wall_limit": "limit_wall", "turn_ceiling": "limit_turns", "completed": "completed", "bg_wait_expired": "completed"}


def task_end(t: dict) -> str:
    """The task turn's end kind as run.ts pfRecord reads it (statemachines/session.ts endKind): a harness error, or a close
    whose proxy finalize failed with no allowance stop counted, is infra; an allowance stop is limit_allowance whatever the
    termination; then the wall and turn limits and completed; an UPSTREAM refusal or an error_result is upstream; anything
    else is infra. Only completed and limit ends go on to the capture and the wrap-up turn (section 5)."""
    if t["termination"] == "error" or (t["finalized"] is False and not t["allowance_stops"]):
        return "infra"
    if t["allowance_stops"]:
        return "limit_allowance"
    return ENDS.get(t["termination"]) or ("upstream" if "UPSTREAM" in t["refused"] or t["termination"] == "error_result" else "infra")


class OpenRefused(Exception):
    """The driver refused a wrap-up slot's open for lack of room (409 CAP_STOP). The wrap-up turn is then refused for its
    allowance (section 5): it never starts and never reruns."""


class StaticSlots:
    """The dry run's slots without a driver: one base URL and token per phase from the config."""

    def __init__(self, cfg: dict):
        self.cfg = cfg

    def open(self, phase: str, rerun: str | None) -> dict:
        return {"id": None, "phase": phase, "rerun": rerun, "base_url": self.cfg["base_urls"][phase], "token": self.cfg["tokens"][phase]}

    def close(self, slot: dict, reason: str) -> dict:
        return {}


class Session:
    def __init__(self, cfg: dict, slots=None):
        self.cfg = cfg
        self.slots = slots or StaticSlots(cfg)
        self.out = Path(cfg["out"])
        self.out.mkdir(parents=True, exist_ok=True)
        self.user = NoAnswer(cfg["no_answer"], self.out / "usersim-events.jsonl")
        self.user.per_turn(["task", "wrapup"])
        self.transcript = (self.out / "sdk-messages.jsonl").open("a")
        self.started = time.time()
        self.summary = {"claude_version": None, "check": None, "task": None, "wrapup": [], "slots": [], "capture": None, "keep": None, "checks": False}

    def sh(self, script: str, *args: str, timeout: float = 600) -> subprocess.CompletedProcess:
        return subprocess.run([*self.cfg["exec_prefix"], "bash", "-c", script, "bash", *args], capture_output=True, timeout=timeout)

    def step(self, what: str, needs: tuple, cmd: str, *args: str) -> bytes:
        """One post-turn step in the container: the session-end commit, a wrap-up reset or keep, or the S bundle. When it
        fails or times out, sh/state.sh reads what the agent could have written (the work files the step needs, the
        repository's git state, a lock the agent's git left) and a cause there, or a file that vanished while the step
        hashed the tree, raises E_PF_ARM post_turn. Anything else raises E_PF_CAPTURE: the harness, the host, docker or the
        network (#305's run notes item 4)."""
        cfg = self.cfg
        err = ""
        try:
            self.sh('mkdir -p "$1" && touch "$1/pf-step.stamp"', cfg["work"])
            res = self.sh(cmd, *args)
            if res.returncode == 0:
                return res.stdout
            err = res.stderr.decode(errors="replace")
            failed = f"exited {res.returncode}: {err[-300:]}"
        except subprocess.TimeoutExpired as e:
            failed = f"timed out after {e.timeout:.0f} s"
        try:
            probe = self.sh('d=$1; shift; bash "$d/state.sh" "$@"', cfg["sh_dir"], cfg["repo"], cfg["work"], *needs).stdout.decode(errors="replace")
        except subprocess.TimeoutExpired:
            probe = ""
        causes = [l[len("PF_ARM_STATE "):] for l in (err + "\n" + probe).splitlines() if l.startswith("PF_ARM_STATE ")]
        if causes:
            raise RuntimeError(f"E_PF_ARM post_turn {what}: {'; '.join(dict.fromkeys(causes))}"[:600])
        raise RuntimeError(f"E_PF_CAPTURE {what} {failed}")

    def script(self, name: str, *args: str, needs: tuple = ()) -> str:
        return self.step(name + " " + args[0], needs, 'd=$1; shift; bash "$d/' + name + '" "$@"', self.cfg["sh_dir"], *args).decode(errors="replace")

    def check(self) -> None:
        cfg = self.cfg
        lines = self.sh(SM_CHECK.format(repo=shlex.quote(cfg["repo"]))).stdout.decode(errors="replace").splitlines()
        got = {k: [l.split(" ", 1)[1] for l in lines if l.startswith(k + " ")] for k in ("COMMITS", "HEAD", "INSTR", "HOME", "GSTACK")}
        self.summary["check"] = got
        if "commits" in cfg and (got["COMMITS"] != [str(cfg["commits"])] or got["HEAD"] != [cfg["head"]]):
            raise RuntimeError(f"E_PF_ARM the session tree has commits {got['COMMITS']} at {got['HEAD']}, not {cfg['commits']} at {cfg['head']}; nothing was opened")
        bad = ["INSTR " + p for p in got["INSTR"]] + ["HOME " + p for p in got["HOME"]]
        if bad:
            raise RuntimeError(f"E_PF_ARM the session tree or home holds files the strip rule removes or a gstack path: {bad[:10]}; nothing was opened")

    async def turn(self, phase: str, text: str, resume, rerun: str | None = None) -> dict:
        cfg = self.cfg
        user = self.user
        limits = cfg["limits"][phase]
        self.limits = limits
        sid = resume
        with (self.out / "pf-opens.jsonl").open("a") as f:
            f.write(json.dumps({"phase": phase, "rerun": rerun, "at": round(time.time() - self.started, 1)}) + "\n")
        try:
            slot = self.slots.open(phase, rerun)
        except OpenRefused as e:
            if phase != "wrapup":
                raise
            self.summary["slots"].append({"phase": phase, "rerun": rerun, "id": None, "allowance_micros": None, "close": None, "open_refused": str(e)[:300]})
            return {"phase": phase, "termination": "open_refused", "drive": {"error": str(e)[:400]}, "session_id": sid, "wall_s": 0.0, "refused": ["CAP_STOP"], "allowance_stops": 0, "finalized": None}

        async def can_use_tool(tool_name, tool_input, ctx):
            if tool_name == "AskUserQuestion":
                return PermissionResultAllow(updated_input={**tool_input, "answers": user.answer(tool_input.get("questions", []))})
            return PermissionResultAllow(updated_input=tool_input)

        async def keep_open(input_data, tool_use_id, ctx):
            return {"continue_": True}

        def record(m, phase):
            nonlocal sid
            rec = message_record(m, time.time() - self.started)
            rec["phase"] = phase
            self.transcript.write(json.dumps(rec, default=lambda o: getattr(o, "__dict__", str(o))) + "\n")
            self.transcript.flush()
            sid = getattr(m, "session_id", None) or (getattr(m, "data", None) or {}).get("session_id") or sid

        env = {**cfg["env"], "ANTHROPIC_BASE_URL": slot["base_url"], "ANTHROPIC_API_KEY": slot["token"]}
        options = ClaudeAgentOptions(
            cli_path=cfg["cli_path"], cwd=cfg["cwd"], env=env, can_use_tool=can_use_tool, hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[keep_open])]},
            system_prompt={"type": "preset", "preset": "claude_code"}, permission_mode="default", model=cfg["model"], setting_sources=["user", "project"],
            max_turns=int(limits["max_turns"]), disallowed_tools=["WebSearch", "WebFetch"], extra_args={"strict-mcp-config": None}, resume=resume,
            plugins=[{"type": "local", "path": cfg["plugin"]}] if cfg.get("plugin") else [],
        )
        started = time.time()
        end, reader = {}, None
        client = ClaudeSDKClient(options=options)
        try:
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
            end = await RealAgent._drive(self, client, queue, user, phase, text, started + float(limits["wall_limit_sec"]), record)
            termination = "completed" if end["end"] == "quiet" else end["end"]
        except Exception as e:
            termination = "error"
            end = {"error": f"{type(e).__name__}: {e}"[:400]}
        finally:
            if reader is not None:
                reader.cancel()
            try:
                await asyncio.wait_for(client.disconnect(), timeout=30)
            except BaseException:
                pass
            closed = self.slots.close(slot, "turn_end")
        self.summary["slots"].append({"phase": phase, "rerun": rerun, "id": slot.get("id"), "allowance_micros": slot.get("allowance_micros"), "close": closed})
        return {"phase": phase, "termination": termination, "drive": end, "session_id": sid, "wall_s": round(time.time() - started, 1), "refused": (closed or {}).get("refusals") or [], "allowance_stops": int((closed or {}).get("allowance_stops") or 0), "finalized": (closed or {}).get("finalized")}

    async def run(self) -> dict:
        cfg = self.cfg
        out = self.summary
        repo, work = cfg["repo"], cfg["work"]
        self.check()
        out["claude_version"] = self.sh("claude --version").stdout.decode(errors="replace").strip()
        self.sh('mkdir -p "$2" && bash "$1/capture.sh" inventory "$3" > "$2/inv"', cfg["sh_dir"], work, repo)
        task = out["task"] = await self.turn("task", cfg["task_text"], None)
        if task_end(task) in ("upstream", "infra") or not task["session_id"]:
            return out
        out["capture"] = self.script("capture.sh", "commit", repo, work + "/inv", work, needs=("inv",))
        for attempt in (1, 2):
            w = await self.turn("wrapup", cfg["wrapup_text"], task["session_id"], RERUN["wrapup"] if attempt == 2 else None)
            out["wrapup"].append(w)
            if w["termination"] not in ("error_result", "error", "cli_exit") or w["finalized"] is False or w["allowance_stops"] or "CAP_STOP" in w["refused"] or attempt == 2:
                break
            self.script("wrapup.sh", "reset", repo, work, needs=("s.head", "s.inv"))
        out["keep"] = self.script("wrapup.sh", "keep", repo, work, needs=("s.head", "s.inv"))
        out["checks"] = "PF_WRAPUP checks=1" in out["keep"]
        if out["checks"]:
            (self.out / "CHECKS.json").write_bytes(self.sh('cat "$1/CHECKS.json"', work).stdout)
        (self.out / "s.bundle").write_bytes(self.step("bundle", (), 'git -C "$1" -c safe.directory="*" bundle create "$2/s.bundle" HEAD >/dev/null && cat "$2/s.bundle"', repo, work))
        return out

    def finish(self, refused: str | None = None) -> dict:
        out = self.summary
        if refused:
            out["refused"] = refused
        try:
            (self.out / "claude-session.jsonl").write_bytes(self.sh("cat /root/.claude/projects/*/*.jsonl 2>/dev/null").stdout)
        except Exception as e:
            out["claude_session_error"] = f"{type(e).__name__}: {e}"[:300]
        out["questions"] = self.user.counts
        (self.out / "pf-summary.json").write_text(json.dumps(out, indent=1, default=str))
        return out


async def run_session(s: Session) -> dict:
    try:
        await s.run()
    except RuntimeError as e:
        return s.finish(str(e))
    return s.finish()


def main() -> int:
    asyncio.run(run_session(Session(json.loads(Path(sys.argv[1]).read_text()))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
