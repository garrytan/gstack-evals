# Copyright (c) 2026 Garry Tan. MIT License.
"""Part S's session loop (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg sections 3 and 4): GPT-6.2 Sol
in Codex CLI 0.170.0, on the same contract as sessions/h2h_turns.py. CodexTurns subclasses h2h_turns.Turns and keeps its
run(): the check before the slot, one driver slot for the whole session at its allowance, the arm's scripted turns in
order, the frozen continuation while DONE is absent up to continuation_cap, the tree hash before the first turn and after
each one, tree.tar captured the same way and the same summary fields. Only the turn, the check, the version line and the
records differ.

- Each turn runs Codex in the session container over docker exec (or on this machine when the config names no container,
  as the tests do), through the runtime volume's link named sol-agent (prereg.json parts.S.codex.link_name), so gstack's
  session-kind check finds no ancestor process named codex. The first exec is "sol-agent exec --json", every later one
  "sol-agent exec --json ... resume <thread>", with the message on stdin. CI and GITHUB_ACTIONS are unset in the exec's
  environment (env -u), since gstack reads either as headless.
- CODEX_HOME is the session home's .codex. Its config.toml is the pack's own (when its install wrote one) with the
  harness's settings around it: the model, reasoning effort low, the metering proxy as a Responses provider, approvals
  never, sandbox danger-full-access (the container is the sandbox), and the update check, analytics, web search and
  bundled skills off. Codex 0.170.0 has no config.toml key for hook trust, so every exec passes
  --dangerously-bypass-hook-trust, which lets an installed pack's hooks run. --strict-config makes a renamed key fail
  loudly. A pack config that sets one of the harness's keys to another value refuses with E_H2HX_CODEX_CONFIG before the
  slot opens. No --ephemeral, so Codex writes its rollouts; finish() copies CODEX_HOME/sessions to codex-sessions/.
- Questions. After each exec that completed, the root thread's rollout is read for new request_user_input_async and
  request_user_input calls. An async call gets texts.question_reply, word for word, as the next user message on the same
  thread (exec resume), at most MAX_REPLIES times a turn. request_user_input, which Codex answers itself outside Plan
  mode, and an async call past the cap are counted as unanswered. A turn that asked nothing has its last message read for
  a prose question, as h2h_turns does.
- Limits. The wall deadline is the slot's, enforced inside an exec by killing Codex in the container (wall_limit).
  Codex has no turn cap of its own, so each exec's model responses (the rollout's token_usage_record lines) count against
  max_turns after the exec, and a turn that starts with none left ends as turn_ceiling.
- Ends. A completed exec is a completed turn; a turn.failed event is error_result (an upstream end), with refusal set
  when its error names one of Codex's policy codes; an exec that ends with no turn result is error (infra).

Records under out, beside h2h_turns' own: codex-events.jsonl (every exec's JSONL events, each with its phase and exec
number), codex-stderr.log, codex-sessions/ (every rollout), codex-config.toml (the config the session ran) and
h2h-summary.json, whose turns carry each exec and whose questions add async, sync and unanswered counts per phase.
Usage: python h2h_codex.py <config.json>, or h2h_agent.H2hAgent for an s-* arm under Harbor.
"""
import asyncio
import hashlib
import io
import json
import os
import signal
import subprocess
import sys
import tarfile
import threading
import time
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path[:0] = [str(HERE.parent / "sessions"), str(ROOT / "lanes" / "outcome-skills" / "pfchecks"), str(ROOT / "lanes" / "real-outcome" / "agent"), str(ROOT / "quick" / "laneb" / "runner" / "agent")]
from h2h_turns import REFUSED_HOME, Turns, run_session  # noqa: E402

ASYNC_QUESTION = "request_user_input_async"
SYNC_QUESTION = "request_user_input"
POLICY_CODES = ("cyber_policy", "bio_policy", "misalignment_policy_violation")
MAX_REPLIES = 20
PROVIDER_ID = "h2h_proxy"
DOCKER_ENV = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "XDG_RUNTIME_DIR")
KILL_CODEX = 'for p in /proc/[0-9]*; do case "$(cat "$p/comm" 2>/dev/null)" in "$1"|codex|codex-code-mode*) kill -9 "${p##*/}" 2>/dev/null;; esac; done; true'
ROLLOUT = 'n=0; for f in "$1"/sessions/*/*/*/rollout-*-"$2".jsonl; do if [ -f "$f" ] && [ ! -h "$f" ]; then cat -- "$f" || exit 1; n=1; fi; done; [ "$n" = 1 ]'
SESSIONS_TAR = 'cd "$1" 2>/dev/null && [ -d sessions ] || exit 0; tar -cf - sessions'
CODEX_CHECK = r'''cd "$1" || exit 3
echo "COMMITS $(git rev-list --all --count)"
echo "HEAD $(git rev-parse HEAD)"
find . -name .git -prune -o \( -name CLAUDE.md -o -name CLAUDE.local.md -o -name AGENTS.md -o -name AGENTS.override.md -o -name .claude -o -name .codex -o -name .agents \) -print | sed 's/^/INSTR /'
for p in .codex/skills .codex/plugins .codex/hooks.json .codex/AGENTS.md .codex/config.toml .agents/skills .claude/skills .claude/plugins .claude/CLAUDE.md .local/share/gstack .capy .gstack; do [ -e "$2/$p" ] && echo "HOME $p"; done
[ -d "$2/.codex/skills/gstack" ] && echo "GSTACK $(git -C "$2/.codex/skills/gstack" rev-parse HEAD 2>/dev/null || echo none)"
for t in node bun python3 gh git; do p=$(command -v "$t" 2>/dev/null) && echo "RUNTIME $t $p $("$t" --version 2>&1 | head -1)"; done
echo "CODEX $("$3" --version 2>&1 | head -1)"
exit 0
'''


def toml_str(v) -> str:
    return json.dumps(v) if isinstance(v, str) else ("true" if v is True else "false" if v is False else str(v))


def harness_settings(model: str, effort: str, base_url: str) -> tuple[dict, dict]:
    """The harness's config.toml settings: top-level keys, and tables by name, each a flat dict of keys."""
    top = {"model": model, "model_provider": PROVIDER_ID, "model_reasoning_effort": effort, "approval_policy": "never", "sandbox_mode": "danger-full-access", "check_for_update_on_startup": False, "web_search": "disabled"}
    tables = {
        "analytics": {"enabled": False},
        "skills.bundled": {"enabled": False},
        "model_providers." + PROVIDER_ID: {"name": "h2h metering proxy", "base_url": base_url.rstrip("/") + "/v1", "wire_api": "responses", "env_key": "OPENAI_API_KEY", "request_max_retries": 0, "stream_max_retries": 0},
    }
    return top, tables


def merged_config(pack: str, model: str, effort: str, base_url: str) -> str:
    """The session's config.toml: the harness's top-level keys, the pack's own config.toml text, then the harness's
    tables. A pack config that is not TOML, sets a key the harness sets or holds a table the harness writes refuses with
    E_H2HX_CODEX_CONFIG, and the merged text must read back every harness value."""
    top, tables = harness_settings(model, effort, base_url)
    want = {**top, **{f"{t}.{k}": v for t, kv in tables.items() for k, v in kv.items()}}

    def lookup(tree: dict, key: str):
        node = tree
        for part in key.split("."):
            node = node.get(part) if isinstance(node, dict) else None
        return node

    try:
        own = tomllib.loads(pack)
    except tomllib.TOMLDecodeError as e:
        raise RuntimeError(f"E_H2HX_CODEX_CONFIG the pack's config.toml is not TOML ({e}); nothing was opened") from None
    for key in [*want, *tables]:
        if lookup(own, key) is not None:
            raise RuntimeError(f"E_H2HX_CODEX_CONFIG the pack's config.toml sets {key} to {lookup(own, key)!r}, which the harness sets itself; nothing was opened")
    lines = [f"{k} = {toml_str(v)}" for k, v in top.items()]
    lines += ["", pack.rstrip("\n"), ""] if pack.strip() else [""]
    for name, kv in tables.items():
        lines += [f"[{name}]", *(f"{k} = {toml_str(v)}" for k, v in kv.items()), ""]
    text = "\n".join(lines)
    try:
        parsed = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        raise RuntimeError(f"E_H2HX_CODEX_CONFIG the pack's config.toml and the harness's settings do not make one TOML file ({e}); nothing was opened") from None
    for key, v in want.items():
        if lookup(parsed, key) != v:
            raise RuntimeError(f"E_H2HX_CODEX_CONFIG the merged config.toml reads {key} as {lookup(parsed, key)!r}, not the harness's {v!r}; nothing was opened")
    return text


def rollout_questions(text: str) -> list[dict]:
    """The question calls a rollout holds, in order: call id, question texts and whether Codex answers it itself."""
    out = []
    for line in text.splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        p = d.get("payload") if isinstance(d, dict) and d.get("type") == "response_item" else None
        if not isinstance(p, dict) or p.get("type") != "function_call" or p.get("name") not in (ASYNC_QUESTION, SYNC_QUESTION):
            continue
        try:
            args = json.loads(p.get("arguments") or "{}")
        except ValueError:
            args = {}
        qs = args.get("questions") if isinstance(args, dict) and isinstance(args.get("questions"), list) else []
        texts = [str(q.get("question") or q.get("title") or q.get("header")) for q in qs if isinstance(q, dict) and (q.get("question") or q.get("title") or q.get("header"))]
        out.append({"call_id": str(p.get("call_id")), "questions": texts or ["(no question text)"], "sync": p.get("name") == SYNC_QUESTION})
    return out


def model_responses(text: str) -> int:
    """How many model responses a rollout records: one token_usage_record line per response."""
    n = 0
    for line in text.splitlines():
        try:
            n += json.loads(line).get("type") == "token_usage_record"
        except (ValueError, AttributeError):
            continue
    return n


def exec_result(events: list[dict]) -> dict:
    """What one codex exec's JSONL events say: its thread, whether its turn completed or failed, the last error, the
    agent messages and the turn's usage."""
    r = {"thread_id": None, "completed": False, "failed": None, "last_error": None, "agent_messages": 0, "final": "", "usage": None}
    for ev in events:
        t = ev.get("type")
        if t == "thread.started" and isinstance(ev.get("thread_id"), str):
            r["thread_id"] = r["thread_id"] or ev["thread_id"]
        elif t == "turn.completed":
            r["completed"] = True
            r["usage"] = ev.get("usage")
        elif t == "turn.failed":
            r["failed"] = str((ev.get("error") or {}).get("message") or "turn failed")[:500]
        elif t == "error":
            r["last_error"] = str(ev.get("message") or "error")[:500]
        elif t == "item.completed" and (ev.get("item") or {}).get("type") == "agent_message":
            r["agent_messages"] += 1
            r["final"] = str(ev["item"].get("text") or "")
    return r


class CodexTurns(Turns):
    def __init__(self, cfg: dict, slots=None):
        super().__init__(cfg, slots)
        self.transcript.close()
        (self.out / "sdk-messages.jsonl").unlink(missing_ok=True)
        self.transcript = (self.out / "codex-events.jsonl").open("a")
        self.codex = dict(cfg["codex"])
        self.thread = None
        self.seen_calls: set[str] = set()
        self.responses = 0
        self.execs = 0
        self.config_text = None
        self.summary.update({"codex_version": None, "codex": {"bin": self.codex["bin"], "model": self.codex["model"], "effort": self.codex["effort"], "thread_id": None, "config_sha256": None, "execs": 0}})

    def check(self) -> None:
        cfg = self.cfg
        lines = self.sh(CODEX_CHECK, cfg["repo"], cfg["home"], self.codex["bin"]).stdout.decode(errors="replace").splitlines()
        got = {k: [l.split(" ", 1)[1] for l in lines if l.startswith(k + " ")] for k in ("COMMITS", "HEAD", "INSTR", "HOME", "GSTACK", "RUNTIME", "CODEX")}
        self.summary["check"] = got
        self.summary["runtimes"] = {r.split(" ", 2)[0]: {"path": r.split(" ", 2)[1], "version": (r.split(" ", 2) + [""])[2]} for r in got["RUNTIME"]}
        if "commits" in cfg and (got["COMMITS"] != [str(cfg["commits"])] or got["HEAD"] != [cfg["head"]]):
            raise RuntimeError(f"E_H2H_SESSION_ARM the session tree has commits {got['COMMITS']} at {got['HEAD']}, not {cfg['commits']} at {cfg['head']}; nothing was opened")
        refused = REFUSED_HOME[cfg["home_rule"]]
        bad = ["INSTR " + p for p in got["INSTR"]] + ["HOME " + p for p in got["HOME"] if refused is None or p in refused] + (["GSTACK " + g for g in got["GSTACK"]] if cfg["home_rule"] != "gstack" else [])
        if bad:
            raise RuntimeError(f"E_H2H_SESSION_ARM the session tree holds an instruction file, or the {cfg['home_rule']} home holds a path its rule refuses: {bad[:10]}; nothing was opened")
        if got["CODEX"] != ["codex-cli " + self.codex["version"]]:
            raise RuntimeError(f"E_H2HX_CODEX_RUNTIME {self.codex['bin']} reads {got['CODEX']}, not codex-cli {self.codex['version']}; nothing was opened")
        merged_config(self.pack_config(), self.codex["model"], self.codex["effort"], "http://127.0.0.1:1/check")

    def version(self) -> None:
        self.summary["claude_version"] = None
        self.summary["codex_version"] = ((self.summary.get("check") or {}).get("CODEX") or [None])[0]

    def pack_config(self) -> str:
        res = self.sh('cat "$1/config.toml" 2>/dev/null || true', self.codex["home"])
        return res.stdout.decode(errors="replace")

    def configure(self, slot: dict) -> None:
        """Writes the session's config.toml once, with the slot's proxy base URL."""
        if self.config_text is not None:
            return
        text = merged_config(self.pack_config(), self.codex["model"], self.codex["effort"], slot["base_url"])
        res = self.sh('mkdir -p "$1" && cat > "$1/config.toml"', self.codex["home"], input=text.encode())
        if res.returncode != 0:
            raise RuntimeError("E_H2HX_CODEX_CONFIG could not write the session's config.toml: " + res.stderr.decode(errors="replace")[-300:])
        self.config_text = text
        (self.out / "codex-config.toml").write_text(text)
        self.summary["codex"]["config_sha256"] = hashlib.sha256(text.encode()).hexdigest()

    def argv(self) -> list[str]:
        flags = ["exec", "--json", "--strict-config", "--skip-git-repo-check", "--dangerously-bypass-hook-trust", "--color", "never"]
        return [self.codex["bin"], *flags, *(["resume", self.thread] if self.thread else []), "-"]

    def env(self, slot: dict) -> tuple[dict, dict]:
        """The exec's environment: the slot's bearer by name only, and the session's plain variables."""
        plain = {**self.cfg["env"], "HOME": self.cfg["home"], "CODEX_HOME": self.codex["home"]}
        return {"OPENAI_API_KEY": slot["token"]}, plain

    def command(self, argv: list[str], secret: dict, plain: dict) -> tuple[list[str], dict, str | None]:
        unset = ["env", "-u", "CI", "-u", "GITHUB_ACTIONS"]
        container = self.cfg.get("container")
        if container:
            forward = [x for k in secret for x in ("-e", k)] + [x for k, v in plain.items() for x in ("-e", f"{k}={v}")]
            host = {k: v for k, v in os.environ.items() if k in DOCKER_ENV}
            return ["docker", "exec", "-i", "-w", self.cfg["repo"], *forward, container, *unset, *argv], {**host, **secret}, None
        return [*unset, *argv], {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), **plain, **secret}, self.cfg["repo"]

    def kill(self, proc: subprocess.Popen) -> None:
        container = self.cfg.get("container")
        name = Path(self.codex["bin"]).name[:15]
        if container:
            subprocess.run(["docker", "exec", container, "sh", "-c", KILL_CODEX, "sh", name], capture_output=True, timeout=60)
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()

    def run_exec(self, phase: str, kind: str, message: str, slot: dict) -> dict:
        """One codex exec, its message on stdin, read until it exits or the wall deadline kills it."""
        self.execs += 1
        n = self.execs
        secret, plain = self.env(slot)
        cmd, env, cwd = self.command(self.argv(), secret, plain)
        started = time.time()
        events: list[dict] = []
        with (self.out / "codex-stderr.log").open("ab") as err:
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, env=env, cwd=cwd, start_new_session=not self.cfg.get("container"))

            def read():
                for raw in proc.stdout:
                    line = raw.decode(errors="replace").strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except ValueError:
                        continue
                    events.append(ev)
                    self.transcript.write(json.dumps({"phase": phase, "exec": n, "t": round(time.time() - self.started, 2), **ev}) + "\n")
                    self.transcript.flush()

            reader = threading.Thread(target=read, daemon=True)
            reader.start()
            try:
                proc.stdin.write(message.encode())
                proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass
            killed = None
            try:
                proc.wait(timeout=max(self.deadline - time.time(), 0))
            except subprocess.TimeoutExpired:
                killed = "wall_limit"
                self.kill(proc)
            reader.join(timeout=30)
        r = exec_result(events)
        self.thread = self.thread or r["thread_id"]
        return {"exec": n, "phase": phase, "kind": kind, "exit": proc.returncode, "killed": killed, "wall_s": round(time.time() - started, 1), **{k: r[k] for k in ("thread_id", "completed", "failed", "last_error", "agent_messages", "usage")}, "final": r["final"]}

    def rollout(self) -> str | None:
        if not self.thread:
            return None
        try:
            res = self.sh(ROLLOUT, self.codex["home"], self.thread, timeout=60)
        except subprocess.TimeoutExpired:
            return None
        return res.stdout.decode(errors="replace") if res.returncode == 0 else None

    def count(self, phase: str, key: str, n: int = 1) -> None:
        c = self.user.counts.setdefault(phase, {"questions": 0, "ask_user_question": 0, "prose_questions": 0})
        for k in ("async_questions", "sync_questions", "unanswered"):
            c.setdefault(k, 0)
        c[key] += n

    async def turn(self, phase: str, text: str, resume, slot: dict) -> dict:
        info = {"phase": phase, "termination": None, "session_id": resume, "num_turns": 0, "results": [], "refusal": False, "final": "", "wall_s": 0.0}
        left = int(self.limits["max_turns"]) - self.summary["turns_used"]
        if left <= 0 or time.time() >= self.deadline:
            info["termination"] = "turn_ceiling" if left <= 0 else "wall_limit"
            return info
        self.user.start(phase)
        self.count(phase, "unanswered", 0)
        started = time.time()
        execs = []
        try:
            self.configure(slot)
            message, kind, replies = text, "turn", 0
            while True:
                e = await asyncio.to_thread(self.run_exec, phase, kind, message, slot)
                execs.append(e)
                info["final"] = e["final"] or info["final"]
                if e["killed"]:
                    info["termination"] = e["killed"]
                    break
                if e["failed"]:
                    info["termination"] = "error_result"
                    info["refusal"] = any(c in e["failed"] for c in POLICY_CODES)
                    break
                if not (e["completed"] and e["exit"] == 0 and self.thread):
                    info["termination"] = "error"
                    break
                rollout = self.rollout()
                if rollout is None:
                    info["termination"] = "error"
                    info["rollout_unreadable"] = True
                    break
                total = model_responses(rollout)
                info["num_turns"] += max(total - self.responses, 0)
                self.responses = max(total, self.responses)
                fresh = [q for q in rollout_questions(rollout) if q["call_id"] not in self.seen_calls]
                self.seen_calls.update(q["call_id"] for q in fresh)
                asks = [q for q in fresh if not q["sync"]]
                for q in fresh:
                    if q["sync"]:
                        self.count(phase, "sync_questions", len(q["questions"]))
                        self.count(phase, "unanswered", len(q["questions"]))
                        self.count(phase, "questions", len(q["questions"]))
                        self.user.log({"event": "question", "phase": phase, "tool": SYNC_QUESTION, "questions": q["questions"], "answer": None, "source": "codex_itself"})
                if asks and replies < MAX_REPLIES:
                    for q in asks:
                        self.count(phase, "async_questions", len(q["questions"]))
                        self.user.answer([{"question": t} for t in q["questions"]])
                    message, kind, replies = self.cfg["no_answer"], "reply", replies + 1
                    continue
                if asks:
                    n = sum(len(q["questions"]) for q in asks)
                    self.count(phase, "async_questions", n)
                    self.count(phase, "unanswered", n)
                    self.count(phase, "questions", n)
                    self.user.log({"event": "question", "phase": phase, "tool": ASYNC_QUESTION, "answer": None, "source": "reply_cap"})
                elif not fresh:
                    self.user.prose(info["final"])
                info["termination"] = "completed"
                break
        except Exception as e:
            info["termination"] = "error"
            info["error"] = (str(e) if isinstance(e, RuntimeError) else f"{type(e).__name__}: {e}")[:400]
        info["session_id"] = self.thread or resume
        info["results"] = [{k: x[k] for k in ("exec", "kind", "exit", "completed", "failed", "last_error", "killed")} for x in execs]
        info["drive"] = {"execs": [{k: v for k, v in x.items() if k != "final"} for x in execs]}
        info["wall_s"] = round(time.time() - started, 1)
        self.summary["turns_used"] += info["num_turns"]
        self.summary["codex"].update({"thread_id": self.thread, "execs": self.execs})
        self.last_turn = {"phase": phase, "termination": info["termination"]}
        return info

    def finish(self, refused: str | None = None) -> dict:
        out = self.summary
        if refused:
            out["refused"] = refused
        try:
            res = self.sh(SESSIONS_TAR, self.codex["home"], timeout=600)
            dest = self.out / "codex-sessions"
            dest.mkdir(exist_ok=True)
            if res.returncode == 0 and res.stdout:
                with tarfile.open(fileobj=io.BytesIO(res.stdout)) as t:
                    t.extractall(dest, filter="data")
                out["codex_sessions"] = sorted(str(p.relative_to(dest)) for p in dest.rglob("*.jsonl"))
            elif res.returncode != 0:
                out["codex_sessions_error"] = res.stderr.decode(errors="replace")[-300:]
        except Exception as e:
            out["codex_sessions_error"] = f"{type(e).__name__}: {e}"[:300]
        out["questions"] = self.user.counts
        (self.out / "h2h-summary.json").write_text(json.dumps(out, indent=1, default=str))
        return out


def main() -> int:
    asyncio.run(run_session(CodexTurns(json.loads(Path(sys.argv[1]).read_text()))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
