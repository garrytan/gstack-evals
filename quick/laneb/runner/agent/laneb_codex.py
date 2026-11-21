"""Lane B's Codex agent: Codex CLI in a Lane B task container, for the Codex hooks eval's part R (lanes/codex-hooks/r).

It keeps Lane B's trial: the arm tar extracted into /root after B1's snapshot strip (laneb_hooks.LanebHooksAgent), the
container's network capabilities refused, the metered session opened on the proxy with an open_key and closed in a
teardown that always runs, the patch exported, and laneb-summary.json. Only the session differs: in place of Claude Code
under the Agent SDK it runs `codex exec` inside the container over docker exec, with the prompt on stdin.

- The command line is the one the shared Codex driver builds (src/adapters/codex/driver.ts codexArgs): part R's prepare
  step calls codexArgs and writes its argv into the job (codex_argv, and codex_resume_argv for a resume), with the proxy's
  host as __GATEWAY__, which vm-run.sh replaces. The agent adds nothing to it. codex_env is codexEnv's output, with the
  session token as __SESSION_TOKEN__; the agent puts the token there and adds HOME and CODEX_HOME.
- The prompt is B1's: the arm-neutral wrapper and the closing line (prompt_builder.build_prompt), never told.
- A question the model asks through request_user_input_async gets question_reply as the next user message, by codex exec
  resume, once per turn that asked; the session ends at the first turn that asked nothing (at most MAX_RESUMES resumes).
- Records, in evaluator/: codex-events.jsonl (every exec's JSONL events, each line tagged with its exec), codex-stderr.log,
  init.json (the preregistration's section 2 fields, read in the container before the session), codex-sessions/ (every
  rollout under $CODEX_HOME/sessions, the root thread's and any sub-agent's), gstack-hooks/ (gstack's hook logs and
  contract records), questions.json, and laneb-summary.json with the exec results.
- The teardown stops Codex in the container before the parent's teardown stops Claude Code (none here), records the
  processes, exports the patch and closes the session, and then copies the rollouts and hook state. A copy that fails is
  recorded in teardown_errors and never raises; a session with no ok response raises LanebInfraError, as Lane B's agent does.
"""

import asyncio
import hashlib
import json
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path

from pydantic import Field

import laneb_agent
from laneb_agent import OPEN_ATTEMPTS, PROBE_TIMEOUT_S, HttpStatusError, LanebAgent, LanebInfraError, LedgerCapStop
from laneb_hooks import _CAPPED_TAR, GSTACK_HOOK_STATE, LanebHooksAgent, LanebHooksOptions
from prompt_builder import CLOSING_LINES, build_prompt

TOKEN = "__SESSION_TOKEN__"
THREAD = "__THREAD__"
MAX_RESUMES = 20
DOCKER_ENV = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "XDG_RUNTIME_DIR")
ASYNC_QUESTION = "request_user_input_async"
SYNC_QUESTION = "request_user_input"
SWITCHES = ("skill_routing", "skill_contracts", "destructive_guard")
KILL_CODEX = "for p in /proc/[0-9]*; do case \"$(cat $p/comm 2>/dev/null)\" in codex|codex-code-mode*) kill -9 ${p##*/} 2>/dev/null;; esac; done; true"
CODEX_SESSIONS = 'cd \"${CODEX_HOME:-/root/.codex}/sessions\" 2>/dev/null || exit 0; set --; for f in */*/*/rollout-*.jsonl; do [ -f \"$f\" ] && [ ! -h \"$f\" ] && set -- \"$@\" \"$f\"; done; [ \"$#\" -gt 0 ] || exit 0; ' + _CAPPED_TAR


def rollout_questions(text: str) -> list[dict]:
    """The question calls a rollout holds, in order, as the shared driver's codexQuestions reads them: each with its call id,
    its question titles and whether Codex answers it itself (request_user_input)."""
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
        titles = [str(q.get("title") or q.get("question")) for q in qs if isinstance(q, dict) and (q.get("title") or q.get("question"))]
        out.append({"call_id": str(p.get("call_id")), "questions": titles, "sync": p.get("name") == SYNC_QUESTION})
    return out


def exec_result(events: list[dict]) -> dict:
    """What one codex exec's event stream says: its thread, whether the turn completed or failed, and the last error."""
    r = {"thread_id": None, "completed": False, "failed": None, "last_error": None, "agent_messages": 0}
    for ev in events:
        t = ev.get("type")
        if t == "thread.started" and isinstance(ev.get("thread_id"), str):
            r["thread_id"] = r["thread_id"] or ev["thread_id"]
        elif t == "turn.completed":
            r["completed"] = True
        elif t == "turn.failed":
            r["failed"] = str((ev.get("error") or {}).get("message") or "turn failed")[:500]
        elif t == "error":
            r["last_error"] = str(ev.get("message") or "error")[:500]
        elif t == "item.completed" and (ev.get("item") or {}).get("type") == "agent_message":
            r["agent_messages"] += 1
    return r


class LanebCodexOptions(LanebHooksOptions):
    codex_bin: str = Field(description="The pinned Codex CLI inside the container (part R's task setup installs it).")
    codex_argv: list[str] = Field(description="codexArgs's argv for the session's first exec, after the CLI's name; the prompt follows on stdin.")
    codex_resume_argv: list[str] = Field(default_factory=list, description="codexArgs's argv for a resume, with the thread as __THREAD__.")
    codex_env: dict[str, str] = Field(default_factory=dict, description="codexEnv's output, with the session token as __SESSION_TOKEN__.")
    codex_home: str = Field(default="/root/.codex", description="CODEX_HOME inside the container.")
    hook_trust: bool = Field(default=False, description="Whether codex_argv passes --dangerously-bypass-hook-trust; recorded in init.json and checked against the argv.")
    gstack_config: str = Field(default="", description="gstack-config inside the container, read for the three switches; empty for an arm with no gstack.")
    gstack_pin: str = Field(default="", description="The gstack commit the arm installs; empty for an arm with no gstack.")
    arm_tree_sha256: str = Field(default="", description="The arm tree's digest, from its manifest.")
    prompt_input_sha256: str = Field(default="", description="The sha256 of the arm's codex debug prompt-input capture, from its manifest.")
    question_reply: str = Field(default="", description="The reply a request_user_input_async question gets as the next user message.")


class LanebCodexAgent(LanebHooksAgent):
    options_model = LanebCodexOptions

    @staticmethod
    def name() -> str:
        return "laneb-codex"

    def _init_record(self, container: str) -> dict:
        """Section 2's init.json fields as the container holds them before the session."""
        o = self.options

        def sh(script: str) -> str | None:
            try:
                res = self._exec(container, script, timeout=PROBE_TIMEOUT_S)
            except (subprocess.SubprocessError, OSError):
                return None
            return res.stdout.decode(errors="replace").strip() if res.returncode == 0 else None

        argv = o.codex_argv
        model = argv[argv.index("-m") + 1] if "-m" in argv else None
        effort = next((a.split("=", 1)[1].strip('"') for a in argv if a.startswith("model_reasoning_effort=")), None)
        hooks = sh(f"[ -f {o.codex_home}/hooks.json ] && sha256sum {o.codex_home}/hooks.json | cut -d' ' -f1 || echo -")
        switches = {k: (sh(f"HOME=/root {o.gstack_config} get {k}") if o.gstack_config else None) for k in SWITCHES}
        return {
            "codex_version": sh(f"{o.codex_bin} --version"),
            "codex_bin": o.codex_bin,
            "codex_bin_sha256": sh(f"sha256sum {o.codex_bin} | cut -d' ' -f1"),
            "model": model,
            "reasoning_effort": effort,
            "hook_trust": "--dangerously-bypass-hook-trust" in argv,
            "hooks_json_sha256": None if hooks in (None, "-") else hooks,
            "switches": switches,
            "gstack_pin": o.gstack_pin or None,
            "arm_tree_sha256": o.arm_tree_sha256 or None,
            "prompt_input_sha256": o.prompt_input_sha256 or None,
            "settings": [a for a in argv if a.startswith("features.")],
            "argv": [o.codex_bin, *argv],
            "resume_argv": [o.codex_bin, *o.codex_resume_argv] if o.codex_resume_argv else None,
            "session_kind": o.session_kind or None,
        }

    def _codex_exec(self, container: str, argv: list[str], secret: dict, plain: dict, stdin: str, n: int, evdir: Path) -> dict | None:
        """One codex exec over docker exec -i, the message on stdin. The session token goes by name only, its value in the
        docker client's env beside the few host variables docker needs, so no host key is forwarded and the token never
        sits on a command line; the other variables go as NAME=value."""
        workdir = ["-w", self.options.workdir] if self.options.workdir else []
        forward = [x for k in secret for x in ("-e", k)] + [x for k, v in plain.items() for x in ("-e", f"{k}={v}")]
        cmd = ["docker", "exec", "-i", *workdir, *forward, container, self.options.codex_bin, *argv]
        host = {k: v for k, v in os.environ.items() if k in DOCKER_ENV}
        events = []
        with self._lock:
            if self._stop.is_set():
                return None
            err = (evdir / "codex-stderr.log").open("ab")
            proc = self._proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, env={**host, **secret})
        with err, (evdir / "codex-events.jsonl").open("a") as out:
            try:
                stdout, _ = proc.communicate(stdin.encode())
            except (OSError, ValueError):
                stdout = b""
                proc.wait()
            for line in stdout.decode(errors="replace").splitlines():
                if not line.strip():
                    continue
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                events.append(ev)
                out.write(json.dumps({"exec": n, **ev}) + "\n")
        return {**exec_result(events), "exit": proc.returncode, "stopped": self._stop.is_set(), "exec": n}

    def _read_rollout(self, container: str, thread: str) -> str | None:
        script = 'n=0; for f in "${CODEX_HOME:-/root/.codex}"/sessions/*/*/*/rollout-*-"$1".jsonl; do if [ -f "$f" ] && [ ! -h "$f" ]; then cat -- "$f" || exit 1; n=1; fi; done; [ "$n" = 1 ]'
        try:
            res = subprocess.run(["docker", "exec", "-i", "-e", f"CODEX_HOME={self.options.codex_home}", container, "sh", "-c", script, "sh", thread], capture_output=True, timeout=60)
        except (subprocess.SubprocessError, OSError):
            return None
        return res.stdout.decode(errors="replace") if res.returncode == 0 else None

    def _run_codex(self, container: str, prompt: str, token: str, evdir: Path, log) -> dict:
        """The session: the first exec, then one resume per turn whose rollout holds a new request_user_input_async call,
        until a turn asks nothing, an exec fails, the teardown stops it, or MAX_RESUMES. Harbor's agent timeout cancels
        run(), whose teardown kills Codex in the container, which ends the exec in flight."""
        o = self.options
        secret = {k: token for k, v in o.codex_env.items() if v == TOKEN}
        plain = {**{k: v for k, v in o.codex_env.items() if v != TOKEN}, "HOME": "/root", "CODEX_HOME": o.codex_home}
        execs, questions, seen = [], [], set()
        message, thread = prompt, None
        for n in range(MAX_RESUMES + 1):
            argv = o.codex_argv if thread is None else [thread if a == THREAD else a for a in o.codex_resume_argv]
            r = self._codex_exec(container, argv, secret, plain, message, n, evdir)
            if r is None:
                break
            execs.append(r)
            log({"event": "codex_exec", **{k: r[k] for k in ("exec", "exit", "completed", "failed", "last_error", "stopped", "thread_id")}})
            thread = thread or r["thread_id"]
            if not (r["completed"] and not r["failed"] and r["exit"] == 0) or r["stopped"] or thread is None or not o.codex_resume_argv:
                break
            rollout = self._read_rollout(container, thread)
            if rollout is None:
                log({"event": "rollout_unreadable", "thread": thread})
                break
            fresh = [q for q in rollout_questions(rollout) if q["call_id"] not in seen and q["questions"]]
            seen.update(q["call_id"] for q in fresh)
            asks = [q for q in fresh if not q["sync"]]
            questions += [{**q, "exec": n, "answer": None if q["sync"] or not o.question_reply else o.question_reply} for q in fresh]
            if not asks or not o.question_reply:
                break
            message = o.question_reply
        (evdir / "questions.json").write_text(json.dumps(questions, indent=2) + "\n")
        return {"thread_id": thread, "execs": execs, "questions": len([q for q in questions for _ in q["questions"]]), "resumes": max(0, len(execs) - 1)}

    async def run(self, instruction: str, environment, context) -> None:
        o = self.options
        if o.closing_line and o.closing_line not in CLOSING_LINES:
            raise ValueError(f"closing_line {o.closing_line!r} is not one of {sorted(CLOSING_LINES)}")
        if o.session_kind not in ("", "unattended"):
            raise ValueError(f"session_kind {o.session_kind!r} is not unattended or empty")
        if o.hook_trust != ("--dangerously-bypass-hook-trust" in o.codex_argv):
            raise ValueError("hook_trust does not match codex_argv")
        if "--ephemeral" in o.codex_argv:
            raise ValueError("codex_argv passes --ephemeral, so Codex would write no rollout")
        evdir = self._evaluator_dir()
        evdir.mkdir(parents=True, exist_ok=True)
        events_log = evdir / "codex-agent-events.jsonl"
        self._stop, self._lock, self._proc = threading.Event(), threading.Lock(), None

        def log(entry: dict) -> None:
            with events_log.open("a") as f:
                f.write(json.dumps({"t": round(time.time(), 3), **entry}, default=str) + "\n")

        container = await asyncio.to_thread(self._container_id, environment)
        arm_info = self._arm_info
        log(arm_info)
        init = await asyncio.to_thread(self._init_record, container)
        (evdir / "init.json").write_text(json.dumps(init, indent=2) + "\n")

        agent_options = {"session_kind": o.session_kind, "agent": "codex", **({"closing_line": o.closing_line} if o.closing_line else {})}
        open_body = {"trial": environment.session_id, "model": o.upstream_model, "cap_usd": o.session_cap_usd,
                     "meta": {"arm": o.arm, "arm_tar_sha256": arm_info["tar_sha256"], **agent_options}, "open_key": uuid.uuid4().hex}
        for attempt in range(1, OPEN_ATTEMPTS + 1):
            try:
                session = await asyncio.to_thread(laneb_agent.post_json, o.control_url + "/sessions", open_body)
                break
            except HttpStatusError as e:
                if e.code == 409:
                    log({"event": "ledger_cap_stop", "message": str(e)[:300]})
                    raise LedgerCapStop(str(e)) from None
                if e.code < 500 or attempt == OPEN_ATTEMPTS:
                    raise LanebInfraError(f"session open failed: {e}") from None
                log({"event": "session_open_retry", "attempt": attempt, "message": str(e)[:300]})
                await asyncio.sleep(laneb_agent.OPEN_RETRY_S)
            except Exception as e:
                if attempt == OPEN_ATTEMPTS:
                    raise LanebInfraError(f"session open failed after {attempt} attempts: {type(e).__name__}: {e}") from None
                log({"event": "session_open_retry", "attempt": attempt, "message": f"{type(e).__name__}: {e}"[:300]})
                await asyncio.sleep(laneb_agent.OPEN_RETRY_S)
        log({"event": "session_open", "session": session["id"], "model": o.upstream_model, "cap_usd": o.session_cap_usd})

        started = time.time()
        result: dict = {}
        error = None
        try:
            wrapper_text = Path(o.wrapper_path).read_text()
            prompt = build_prompt(wrapper_text, instruction, False, "", closing_line=o.closing_line)
            log({"event": "prompt", "wrapper_sha256": hashlib.sha256(wrapper_text.encode()).hexdigest(), "instruction_sha256": hashlib.sha256(instruction.encode()).hexdigest(),
                 "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(), **({"closing_line": o.closing_line, "closing_line_sha256": hashlib.sha256(CLOSING_LINES[o.closing_line].encode()).hexdigest()} if o.closing_line else {})})
            result = await asyncio.to_thread(self._run_codex, container, prompt, session["token"], evdir, log)
        except Exception as e:
            error = e
            log({"event": "agent_error", "type": type(e).__name__, "message": str(e)[:500]})
        finally:
            base = {"result": result, "error": None if error is None else {"type": type(error).__name__, "message": str(error)[:500]}, "arm": arm_info, **agent_options, "init": init, "wall_s": round(time.time() - started, 1)}
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
            context.metadata = {"laneb": {"arm": o.arm, "agent": "codex", "session": session["id"], "refused": closed.get("refused"), "requests": closed.get("requests"), "ok_responses": closed.get("ok_responses"), "close_error": summary["close_error"]}}
            if cancelled is not None:
                raise cancelled
        if summary["session"] is not None and not summary["session"].get("ok_responses"):
            raise LanebInfraError(f"no model response reached the agent, so this is an infrastructure failure: {error or result}") from error

    def _teardown(self, container: str, session_id: str, log, base: dict) -> dict:
        """Stop Codex (no new exec starts, the container's codex processes are killed, the local docker exec ends), then
        Lane B's own teardown (processes, patch, close, summary), then the rollouts and gstack's hook state."""
        errors = {}
        with self._lock:
            self._stop.set()
        try:
            self._exec(container, KILL_CODEX, timeout=30)
        except Exception as e:
            errors["kill_codex"] = f"{type(e).__name__}: {e}"[:300]
        if self._proc is not None and self._proc.poll() is None:
            try:
                self._proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        summary = LanebAgent._teardown(self, container, session_id, log, base)
        summary["teardown_errors"].update(errors)
        evdir = self._evaluator_dir()
        for key, script, name in (("codex_sessions", CODEX_SESSIONS, "codex-sessions"), ("gstack_hooks", GSTACK_HOOK_STATE, "gstack-hooks")):
            try:
                files = self._copy_tree(container, f"CODEX_HOME={self.options.codex_home}; export CODEX_HOME; " + script, evdir / name, key)
                summary[key] = files
                if files:
                    log({"event": key, "files": files})
            except Exception as e:
                summary["teardown_errors"][key] = f"{type(e).__name__}: {e}"[:300]
        try:
            (evdir / "laneb-summary.json").write_text(json.dumps(summary, indent=2, default=str))
        except Exception:
            pass
        return summary
