# Copyright (c) 2026 Garry Tan. MIT License.
"""The head-to-head session (post sections 3, 4 and 7) on the real Claude Agent SDK, used by h2h_agent.H2hAgent under
Harbor and by the dry run. One driver slot pays for the whole session at its allowance. The arm's scripted turns run in
order, each in a new Claude Code process that resumes the same session; after the last one, a turn whose final message has
no DONE (h2h_rules.has_done) gets the frozen continuation, at most continuation_cap times. The session's limits hold
across its turns: one wall deadline from the slot's open, and max_turns less the turns already used. A turn that does not
end completed (a limit, an error, an upstream end), or in which the assistant stopped for refusal, ends the session;
run.ts reads the end from the summary (session.ts endOf). AskUserQuestion gets texts.question_reply through
sm_user.NoAnswer; prose questions are counted and left to the continuation. sh/treehash.sh hashes the tree before the
first turn and after each one, so a continuation after which the tree did not change counts as spurious. At the end
pfchecks' capture.sh commits the tree (its inventory taken before the first turn) and the tree leaves as a git bundle; a
capture step that fails refuses with E_H2H_CAPTURE, its cause read as pf_turns' Session.step reads it.

Each turn ends as real_agent's _drive ends a phase: the agent ended its turn and its background tasks are quiet (quiet_sec,
then bg_wait_sec with nothing ends it as bg_wait_expired), bounded by the session's wall deadline.

Before the slot opens, the tree must hold no CLAUDE.md, CLAUDE.local.md, AGENTS.md or .claude, and the home no drive. The
none arm's home holds no pack path at all (home_rule none); a pack arm's holds no gstack (pack); gstack's arms may hold
gstack (gstack). CHECK lists the same paths as real_agent's SM_CHECK, under the session's home.
Usage: python h2h_turns.py <config.json>. It writes h2h-summary.json, sdk-messages.jsonl (each record carries its phase,
t1 to tn for scripted turns and c1 to c6 for continuations), claude-session.jsonl, usersim-events.jsonl, tree.bundle and
h2h-opens.jsonl (one line written before the slot open request) under out. Under Harbor the agent passes its driver
slot; the dry run gives control (ControlSlot) or a base_url and token (StaticSlot), and may name local plugin dirs
(plugins) for fixture homes that register no plugin in their settings.
"""
import asyncio
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from claude_agent_sdk.types import HookMatcher, PermissionResultAllow

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path[:0] = [str(HERE), str(ROOT / "lanes" / "outcome-skills" / "pfchecks"), str(ROOT / "lanes" / "real-outcome" / "agent"), str(ROOT / "quick" / "laneb" / "runner" / "agent")]
from h2h_rules import has_done, next_turn  # noqa: E402
from pf_turns import Session as PfSession  # noqa: E402
from real_agent import RealAgent, message_record  # noqa: E402
from sm_user import NoAnswer  # noqa: E402

CHECK = r'''cd "$1" || exit 3
echo "COMMITS $(git rev-list --all --count)"
echo "HEAD $(git rev-parse HEAD)"
find . -name .git -prune -o \( -name CLAUDE.md -o -name CLAUDE.local.md -o -name AGENTS.md -o -name .claude \) -print | sed 's/^/INSTR /'
for p in .claude/skills .claude/plugins .claude/commands .claude/agents .claude/CLAUDE.md .local/share/gstack .capy .gstack; do [ -e "$2/$p" ] && echo "HOME $p"; done
[ -d "$2/.claude/skills/gstack" ] && echo "GSTACK $(git -C "$2/.claude/skills/gstack" rev-parse HEAD 2>/dev/null || echo none)"
exit 0
'''
REFUSED_HOME = {"none": None, "pack": {".capy", ".local/share/gstack", ".gstack"}, "gstack": {".capy"}}
GIT = 'GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -C "$1" -c safe.directory="*" -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.excludesFile=/dev/null'
TREE = re.compile(r"^H2H_TREE ([0-9a-f]{64}) files=(\d+)$", re.M)


class SlotRefused(Exception):
    """The driver refused the session's slot for lack of room (409 CAP_STOP): the session is a cap stop and never starts."""


class StaticSlot:
    """The dry run's slot without a driver: the base URL and token from the config."""

    def __init__(self, cfg: dict):
        self.cfg = cfg

    def open(self, rerun):
        return {"id": None, "phase": "session", "rerun": rerun, "base_url": self.cfg["base_url"], "token": self.cfg["token"]}

    def close(self, slot: dict, reason: str) -> dict:
        return {}


class ControlSlot:
    """A slot on the outcome driver without Harbor (the dry run): POST /sessions on cfg control with the session's arm, task
    and allowance, and its close. A 409 is a cap stop."""

    def __init__(self, cfg: dict):
        self.cfg = cfg

    def post(self, path: str, body: dict, timeout: float = 120) -> dict:
        req = urllib.request.Request(self.cfg["control"] + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 409:
                raise SlotRefused(e.read().decode(errors="replace")[:300]) from None
            raise RuntimeError(f"E_H2H_INFRA_GAP the driver answered {e.code} to {path}: {e.read().decode(errors='replace')[:300]}") from None

    def open(self, rerun):
        c = self.cfg
        meta = {"arm": c["arm"], "task": c["task"], "trial_n": 1, **({"rerun": rerun} if rerun else {})}
        s = self.post("/sessions", {"trial": "h2h-" + uuid.uuid4().hex[:12], "model": c["model"], "cap_usd": float(c["limits"]["allowance_usd"]), "ledger": "u4", "open_key": uuid.uuid4().hex, "meta": meta})
        return {**s, "phase": "session", "rerun": rerun}

    def close(self, slot: dict, reason: str) -> dict:
        return self.post(f"/sessions/{slot['id']}/close", {"reason": reason})


class Turns(PfSession):
    def __init__(self, cfg: dict, slots=None):
        self.cfg = cfg
        self.slots = slots or (ControlSlot(cfg) if cfg.get("control") else StaticSlot(cfg))
        self.out = Path(cfg["out"])
        self.out.mkdir(parents=True, exist_ok=True)
        self.user = NoAnswer(cfg["no_answer"], self.out / "usersim-events.jsonl")
        self.transcript = (self.out / "sdk-messages.jsonl").open("a")
        self.started = time.time()
        self.limits = dict(cfg["limits"])
        self.deadline = None
        self.summary = {"claude_version": None, "check": None, "slot": None, "turns": [], "trees": [], "turns_used": 0, "continuations": 0, "spurious_continuations": 0, "done": False, "next": None, "capture": None, "post_turn": None, "cap_stop": False}
        self.last_turn = None
        self.filters = b""

    def check(self) -> None:
        cfg = self.cfg
        lines = self.sh(CHECK, cfg["repo"], cfg["home"]).stdout.decode(errors="replace").splitlines()
        got = {k: [l.split(" ", 1)[1] for l in lines if l.startswith(k + " ")] for k in ("COMMITS", "HEAD", "INSTR", "HOME", "GSTACK")}
        self.summary["check"] = got
        if "commits" in cfg and (got["COMMITS"] != [str(cfg["commits"])] or got["HEAD"] != [cfg["head"]]):
            raise RuntimeError(f"E_H2H_SESSION_ARM the session tree has commits {got['COMMITS']} at {got['HEAD']}, not {cfg['commits']} at {cfg['head']}; nothing was opened")
        refused = REFUSED_HOME[cfg["home_rule"]]
        bad = ["INSTR " + p for p in got["INSTR"]] + ["HOME " + p for p in got["HOME"] if refused is None or p in refused] + (["GSTACK " + g for g in got["GSTACK"]] if cfg["home_rule"] != "gstack" else [])
        if bad:
            raise RuntimeError(f"E_H2H_SESSION_ARM the session tree holds an instruction file, or the {cfg['home_rule']} home holds a path its rule refuses: {bad[:10]}; nothing was opened")

    def tree(self):
        try:
            res = self.sh('bash "$1/treehash.sh" "$2"', self.cfg["sh_dir"], self.cfg["repo"])
        except subprocess.TimeoutExpired:
            return None
        m = TREE.search(res.stdout.decode(errors="replace"))
        return m[1] if res.returncode == 0 and m else None

    async def turn(self, phase: str, text: str, resume, slot: dict) -> dict:
        cfg, user = self.cfg, self.user
        info = {"phase": phase, "termination": None, "session_id": resume, "num_turns": 0, "results": [], "refusal": False, "final": "", "wall_s": 0.0}
        left = int(self.limits["max_turns"]) - self.summary["turns_used"]
        if left <= 0 or time.time() >= self.deadline:
            info["termination"] = "turn_ceiling" if left <= 0 else "wall_limit"
            return info
        last_text = ""

        async def can_use_tool(tool_name, tool_input, ctx):
            if tool_name == "AskUserQuestion":
                return PermissionResultAllow(updated_input={**tool_input, "answers": user.answer(tool_input.get("questions", []))})
            return PermissionResultAllow(updated_input=tool_input)

        async def keep_open(input_data, tool_use_id, ctx):
            return {"continue_": True}

        def record(m, ph):
            nonlocal last_text
            rec = message_record(m, time.time() - self.started)
            rec["phase"] = ph
            self.transcript.write(json.dumps(rec, default=lambda o: getattr(o, "__dict__", str(o))) + "\n")
            self.transcript.flush()
            info["session_id"] = getattr(m, "session_id", None) or (getattr(m, "data", None) or {}).get("session_id") or info["session_id"]
            name = type(m).__name__
            if getattr(m, "stop_reason", None) == "refusal":
                info["refusal"] = True
            if name == "ResultMessage":
                info["num_turns"] += int(getattr(m, "num_turns", 0) or 0)
                info["results"].append({k: getattr(m, k, None) for k in ("subtype", "is_error", "stop_reason", "num_turns", "api_error_status", "terminal_reason")})
                if isinstance(getattr(m, "result", None), str) and m.result.strip():
                    last_text = m.result
            elif name == "AssistantMessage" and getattr(m, "parent_tool_use_id", None) is None:
                said = "\n".join(getattr(b, "text", "") for b in getattr(m, "content", []) or [] if type(b).__name__ == "TextBlock")
                if said.strip():
                    last_text = said

        env = {**cfg["env"], "ANTHROPIC_BASE_URL": slot["base_url"], "ANTHROPIC_API_KEY": slot["token"]}
        options = ClaudeAgentOptions(
            cli_path=cfg["cli_path"], cwd=cfg["cwd"], env=env, can_use_tool=can_use_tool, hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[keep_open])]},
            system_prompt={"type": "preset", "preset": "claude_code"}, permission_mode="default", model=cfg["model"], setting_sources=["user", "project"],
            max_turns=left, disallowed_tools=list(cfg["disallowed_tools"]), extra_args={"strict-mcp-config": None}, resume=resume,
            plugins=[{"type": "local", "path": p} for p in cfg.get("plugins") or []],
        )
        started = time.time()
        reader = None
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
            end = await RealAgent._drive(self, client, queue, user, phase, text, self.deadline, record)
            info["termination"] = "completed" if end["end"] == "quiet" else end["end"]
            info["drive"] = end
        except Exception as e:
            info["termination"] = "error"
            info["drive"] = {"error": f"{type(e).__name__}: {e}"[:400]}
        finally:
            if reader is not None:
                reader.cancel()
            try:
                await asyncio.wait_for(client.disconnect(), timeout=30)
            except BaseException:
                pass
        info["final"] = last_text
        info["wall_s"] = round(time.time() - started, 1)
        self.summary["turns_used"] += info["num_turns"]
        self.last_turn = {"phase": phase, "termination": info["termination"]}
        return info

    async def run(self) -> dict:
        cfg, out = self.cfg, self.summary
        repo, work = cfg["repo"], cfg["work"]
        self.check()
        out["claude_version"] = self.sh("claude --version").stdout.decode(errors="replace").strip()
        start = self.sh('mkdir -p "$2" && bash "$1/capture.sh" inventory "$3" > "$2/inv" && bash "$1/capture.sh" filters "$3"', cfg["sh_dir"], work, repo)
        self.filters = start.stdout if start.returncode == 0 else b""
        out["trees"].append(self.tree())
        with (self.out / "h2h-opens.jsonl").open("a") as f:
            f.write(json.dumps({"rerun": cfg.get("rerun"), "at": round(time.time() - self.started, 1)}) + "\n")
        try:
            slot = self.slots.open(cfg.get("rerun"))
        except SlotRefused as e:
            out["cap_stop"] = True
            out["slot"] = {"id": None, "open_refused": str(e)[:300], "close": None}
            return out
        out["slot"] = {"id": slot.get("id"), "allowance_micros": slot.get("allowance_micros"), "close": None}
        self.deadline = time.time() + float(self.limits["wall_sec"])
        scripted = list(cfg["turns"])
        sid, done_turns, phase, text = None, 0, "t1", scripted[0]
        try:
            while True:
                t = await self.turn(phase, text, sid, slot)
                out["turns"].append(t)
                sid = t["session_id"] or sid
                tree = self.tree()
                if phase.startswith("c") and tree is not None and tree == out["trees"][-1]:
                    out["spurious_continuations"] += 1
                out["trees"].append(tree)
                if t["termination"] != "completed" or t["refusal"] or not sid:
                    out["next"] = "stop"
                    break
                out["done"] = has_done(t["final"], cfg["done_rule"])
                if phase.startswith("t"):
                    done_turns += 1
                step = out["next"] = next_turn(len(scripted) - done_turns, out["done"], out["continuations"], int(cfg["continuation_cap"]))
                if step == "scripted":
                    phase, text = f"t{done_turns + 1}", scripted[done_turns]
                elif step == "continuation":
                    out["continuations"] += 1
                    phase, text = f"c{out['continuations']}", cfg["continuation"]
                else:
                    break
        finally:
            out["slot"]["close"] = self.slots.close(slot, "agent_finished")
        try:
            out["capture"] = self.script("capture.sh", "commit", repo, work + "/inv", work, needs=("inv",))
            (self.out / "tree.bundle").write_bytes(self.step("bundle", (), GIT + ' bundle create "$2/tree.bundle" HEAD >/dev/null && cat "$2/tree.bundle"', repo, work))
        except RuntimeError as e:
            raise RuntimeError("E_H2H_CAPTURE " + str(e)) from None
        return out

    def finish(self, refused: str | None = None) -> dict:
        out = self.summary
        if refused:
            out["refused"] = refused
        try:
            (self.out / "claude-session.jsonl").write_bytes(self.sh('cat "$1"/.claude/projects/*/*.jsonl 2>/dev/null', self.cfg["home"]).stdout)
        except Exception as e:
            out["claude_session_error"] = f"{type(e).__name__}: {e}"[:300]
        out["questions"] = self.user.counts
        (self.out / "h2h-summary.json").write_text(json.dumps(out, indent=1, default=str))
        return out


async def run_session(s: Turns) -> dict:
    try:
        await s.run()
    except RuntimeError as e:
        return s.finish(str(e))
    return s.finish()


def main() -> int:
    asyncio.run(run_session(Turns(json.loads(Path(sys.argv[1]).read_text()))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
