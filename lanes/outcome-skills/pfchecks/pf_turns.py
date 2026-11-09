# Copyright (c) 2026 Garry Tan. MIT License.
"""The pstack-checks two-turn session (plan sections 4 and 5) on the real Claude Agent SDK. The task turn runs, then
capture.sh commits S in the session container, then the wrap-up turn resumes the same Claude Code session in a new CLI
process with its own limits (300 s, 20 turns) on its own proxy slot (its allowance). An upstream or infra end of the
wrap-up turn puts the tree back to S (wrapup.sh reset) and reruns the wrap-up turn once, resuming the same session.
wrapup.sh keep then keeps only CHECKS.json and counts every other change. S leaves the container as a git bundle.

Before any turn the tree must hold none of the files the strip rule removes and the home no gstack and no drive, as
real_agent's family SM check reads them. AskUserQuestion gets the frozen answer through #290's sm_user.NoAnswer.
Usage: python pf_turns.py <config.json>. It writes turns.json, sdk-messages.jsonl (the SDK's stream), claude-session.jsonl
(Claude Code's own transcript, where an expanded skill body appears), usersim-events.jsonl, s.bundle and CHECKS.json (when
kept) under out.
"""
import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from claude_agent_sdk.types import HookMatcher, PermissionResultAllow

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "lanes" / "real-outcome" / "agent"))
from sm_user import NoAnswer  # noqa: E402

CHECK = r"""cd "$1" || exit 3
find . -name .git -prune -o \( -name CLAUDE.md -o -name CLAUDE.local.md -o -name AGENTS.md -o -name .claude \) -print | sed 's/^/INSTR /'
for p in /root/.claude/skills /root/.claude/CLAUDE.md /root/.local/share/gstack /root/.capy /root/.gstack; do [ -e "$p" ] && echo "HOME $p"; done
exit 0
"""


def _block(b) -> dict:
    """Copied from lanes/real-outcome/agent/real_agent.py _block, so the transcript has real_agent's record shape."""
    d = dict(getattr(b, "__dict__", {}) or {})
    d["type"] = {"TextBlock": "text", "ToolUseBlock": "tool_use", "ToolResultBlock": "tool_result", "ThinkingBlock": "thinking"}.get(type(b).__name__, type(b).__name__)
    return d


def message_record(message, t: float) -> dict:
    """Copied from real_agent.py message_record (without its keyless mark, which needs real_agent's parser patch)."""
    record = {"type": type(message).__name__, "t": round(t, 2)}
    for attr in ("subtype", "result", "usage", "total_cost_usd", "num_turns", "is_error", "stop_reason", "data", "parent_tool_use_id", "session_id"):
        if hasattr(message, attr):
            record[attr] = getattr(message, attr)
    content = getattr(message, "content", None)
    if isinstance(content, list):
        record["content"] = [_block(b) for b in content]
    elif content is not None:
        record["content"] = content
    return record


class Session:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.out = Path(cfg["out"])
        self.out.mkdir(parents=True, exist_ok=True)
        self.user = NoAnswer(cfg["no_answer"], self.out / "usersim-events.jsonl")
        self.user.per_turn(["task", "wrapup"])
        self.transcript = (self.out / "sdk-messages.jsonl").open("a")
        self.started = time.time()

    def sh(self, script: str, *args: str, timeout: float = 600) -> subprocess.CompletedProcess:
        return subprocess.run([*self.cfg["exec_prefix"], "bash", "-c", script, "bash", *args], capture_output=True, timeout=timeout)

    def script(self, name: str, *args: str) -> str:
        res = self.sh('d=$1; shift; bash "$d/' + name + '" "$@"', self.cfg["sh_dir"], *args)
        if res.returncode != 0:
            raise RuntimeError(f"E_PF_CAPTURE {name} {args[0] if args else ''} exited {res.returncode}: {res.stderr.decode(errors='replace')[-300:]}")
        return res.stdout.decode(errors="replace")

    async def turn(self, phase: str, text: str, limits: dict, resume) -> dict:
        cfg = self.cfg
        user = self.user

        async def can_use_tool(tool_name, tool_input, ctx):
            if tool_name == "AskUserQuestion":
                return PermissionResultAllow(updated_input={**tool_input, "answers": user.answer(tool_input.get("questions", []))})
            return PermissionResultAllow(updated_input=tool_input)

        async def keep_open(input_data, tool_use_id, ctx):
            return {"continue_": True}

        env = {**cfg["env"], "ANTHROPIC_BASE_URL": cfg["base_urls"][phase], "ANTHROPIC_API_KEY": cfg["tokens"][phase]}
        options = ClaudeAgentOptions(
            cli_path=cfg["cli_path"], cwd=cfg["cwd"], env=env, can_use_tool=can_use_tool, hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[keep_open])]},
            system_prompt={"type": "preset", "preset": "claude_code"}, permission_mode="default", model=cfg["model"], setting_sources=["user", "project"],
            max_turns=int(limits["max_turns"]), disallowed_tools=["WebSearch", "WebFetch"], extra_args={"strict-mcp-config": None}, resume=resume,
            plugins=[{"type": "local", "path": cfg["plugin"]}] if cfg.get("plugin") else [],
        )
        user.start(phase)
        end, result, sid, last_text = None, {}, resume, ""
        client = ClaudeSDKClient(options=options)
        try:
            await client.connect()
            await client.query(text)

            async def read():
                nonlocal sid, last_text
                async for m in client.receive_response():
                    rec = message_record(m, time.time() - self.started)
                    rec["phase"] = phase
                    self.transcript.write(json.dumps(rec, default=lambda o: getattr(o, "__dict__", str(o))) + "\n")
                    self.transcript.flush()
                    sid = getattr(m, "session_id", None) or (getattr(m, "data", None) or {}).get("session_id") or sid
                    if type(m).__name__ == "AssistantMessage":
                        last_text = "\n".join(getattr(b, "text", "") for b in m.content if type(b).__name__ == "TextBlock")
                    if type(m).__name__ == "ResultMessage":
                        return m
                return None

            res = await asyncio.wait_for(read(), timeout=float(limits["wall_limit_sec"]))
            if res is not None and phase == "task":
                self.task_session = getattr(res, "session_id", None) or sid
            if res is None:
                end = "error"
            else:
                result = {k: getattr(res, k, None) for k in ("subtype", "num_turns", "is_error", "total_cost_usd", "stop_reason")}
                end = "turn_ceiling" if res.subtype == "error_max_turns" else "error_result" if res.is_error else "completed"
                user.prose(last_text)
        except (asyncio.TimeoutError, TimeoutError):
            end = "wall_limit"
        except Exception as e:
            end = "error"
            result = {"error": f"{type(e).__name__}: {e}"[:400]}
        finally:
            try:
                await asyncio.wait_for(client.disconnect(), timeout=30)
            except BaseException:
                pass
        return {"phase": phase, "termination": end, "result": result, "session_id": sid}

    async def run(self) -> dict:
        cfg = self.cfg
        repo, work = cfg["repo"], cfg["work"]
        chk = self.sh(CHECK, repo).stdout.decode(errors="replace").splitlines()
        bad = [l for l in chk if l.startswith("INSTR ") or (l.startswith("HOME ") and not cfg.get("plugin_home_ok"))]
        if bad:
            raise RuntimeError(f"E_PF_ARM the session tree or home holds files the strip rule removes or a gstack path: {bad[:10]}; nothing was opened")
        self.sh('mkdir -p "$2" && bash "$1/capture.sh" inventory "$3" > "$2/inv"', cfg["sh_dir"], work, repo)
        task = await self.turn("task", cfg["task_text"], cfg["limits"]["task"], None)
        out = {"task": task, "wrapup": [], "capture": None, "keep": None, "checks": False}
        if task["termination"] == "error" or not task["session_id"]:
            return out
        out["capture"] = self.script("capture.sh", "commit", repo, work + "/inv")
        self.script("wrapup.sh", "save", repo, work)
        for attempt in (1, 2):
            w = await self.turn("wrapup", cfg["wrapup_text"], cfg["limits"]["wrapup"], task["session_id"])
            out["wrapup"].append(w)
            if w["termination"] not in ("error_result", "error") or attempt == 2:
                break
            self.script("wrapup.sh", "reset", repo, work)
        out["keep"] = self.script("wrapup.sh", "keep", repo, work)
        out["checks"] = "PF_WRAPUP checks=1" in out["keep"]
        if out["checks"]:
            (self.out / "CHECKS.json").write_bytes(self.sh('cat "$1/CHECKS.json"', work).stdout)
        bundle = self.sh('git -C "$1" -c safe.directory="*" bundle create "$2/s.bundle" HEAD >/dev/null 2>&1 && cat "$2/s.bundle"', repo, work)
        (self.out / "s.bundle").write_bytes(bundle.stdout)
        (self.out / "claude-session.jsonl").write_bytes(self.sh('cat /root/.claude/projects/*/*.jsonl 2>/dev/null').stdout)
        return out


def main() -> int:
    cfg = json.loads(Path(sys.argv[1]).read_text())
    s = Session(cfg)
    try:
        out = asyncio.run(s.run())
    except RuntimeError as e:
        out = {"refused": str(e)}
    out["questions"] = s.user.counts
    (s.out / "turns.json").write_text(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
