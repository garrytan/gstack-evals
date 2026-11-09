# Copyright (c) 2026 Garry Tan. MIT License.
"""Keyless tests of pf_agent.PfAgent on the real pinned claude-agent-sdk 0.2.174 and Harbor f3a5a92.

Run by pf-agent.test.ts with REAL_OUTCOME_PYTHON, as tests/real-outcome/agent.test.ts runs agent_test.py. The SDK and
Harbor are real, and so are pf_turns, capture.sh and wrapup.sh. A stub Claude Code speaks the SDK's stream-json, and a
stand-in docker runs "docker exec" and "docker cp" on this machine, so the session container is a temp git repo. A small
HTTP server plays the outcome-skills driver's control plane (POST /sessions, POST /sessions/<id>/close). Only the
container lookups and the egress helper are replaced. Prints PASS <name> or FAIL <name> per test.
"""

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import traceback
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "lanes/outcome-skills/pfchecks"), str(ROOT / "lanes/real-outcome/agent"), str(ROOT / "quick/laneb/runner/agent")]

import claude_agent_sdk  # noqa: E402
import egress  # noqa: E402
import laneb_agent as lb  # noqa: E402
import pf_agent  # noqa: E402

assert claude_agent_sdk.__version__ == "0.2.174", claude_agent_sdk.__version__
IMAGE = "sha256:" + "d" * 64
LABEL = "pf-flag/claude-opus-5-5/P/0"
DIRS = []
GIT_ENV = {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": "fixture", "GIT_AUTHOR_EMAIL": "f@x.invalid", "GIT_COMMITTER_NAME": "fixture", "GIT_COMMITTER_EMAIL": "f@x.invalid"}

FAKE_DOCKER = r'''#!/bin/sh
# docker exec [-i] [-w DIR] [-e NAME]... CONTAINER CMD... runs CMD in DIR here; docker cp SRC CONTAINER:DEST copies here.
case "$1" in
  exec)
    shift
    dir=.
    while [ $# -gt 0 ]; do
      case "$1" in
        -i) shift ;;
        -w) dir=$2; shift 2 ;;
        -e) shift 2 ;;
        *) break ;;
      esac
    done
    shift
    cd "$dir" && exec "$@" ;;
  cp) dest=${3#*:}; mkdir -p "$dest" && cp -a "$2" "$dest" ;;
  *) echo "fake docker: only exec and cp are served: $*" >&2; exit 125 ;;
esac
'''

STUB_CLAUDE = r'''#!/usr/bin/env python3
import json, os, sys
argv = sys.argv[1:]
if argv in (["-v"], ["--version"]):
    print("2.1.312 (Claude Code)")
    sys.exit(0)
log = os.environ["PF_STUB_LOG"]
phase = "wrapup" if any(a == "--resume" or a.startswith("--resume=") for a in argv) else "task"
counter = log + "." + phase
n = int(open(counter).read()) + 1 if os.path.exists(counter) else 1
open(counter, "w").write(str(n))
with open(log, "a") as f:
    f.write(json.dumps({"phase": phase, "n": n, "argv": argv, "cwd": os.getcwd(), "base_url": os.environ.get("ANTHROPIC_BASE_URL"), "token": os.environ.get("ANTHROPIC_API_KEY"), "bundled": os.environ.get("CLAUDE_CODE_DISABLE_BUNDLED_SKILLS"), "model": os.environ.get("ANTHROPIC_MODEL")}) + "\n")
error = os.environ.get("PF_STUB_SCENARIO") == "wrapup_error" and phase == "wrapup" and n == 1
def send(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()
for line in sys.stdin:
    m = json.loads(line)
    if m.get("type") == "control_request":
        send({"type": "control_response", "response": {"subtype": "success", "request_id": m["request_id"], "response": {}}})
    elif m.get("type") == "user":
        if phase == "task":
            os.makedirs("checks", exist_ok=True)
            open("checks/regress_test.sh", "w").write("grep -q reset flag/flag.go\n")
        else:
            open("CHECKS.json", "w").write(json.dumps([{"name": "regress", "command": "bash checks/regress_test.sh", "what_it_checks": "the reset"}]))
            open("late_%d.txt" % n, "w").write("wrap-up file\n")
        send({"type": "system", "subtype": "init", "session_id": "s-1", "tools": ["Bash"], "skills": [], "model": "claude-opus-5-5", "claude_code_version": "2.1.312"})
        send({"type": "assistant", "message": {"id": "m%d" % n, "type": "message", "role": "assistant", "model": "stub", "content": [{"type": "text", "text": "Done."}], "stop_reason": None, "usage": {"input_tokens": 1, "output_tokens": 1}}, "parent_tool_use_id": None, "session_id": "s-1", "uuid": "u%d" % n})
        send({"type": "result", "subtype": "error_during_execution" if error else "success", "duration_ms": 1, "duration_api_ms": 1, "is_error": error, "num_turns": 1, "session_id": "s-1", "total_cost_usd": 0, "usage": {}, "result": "Done."})
'''


class Control:
    """The driver's control plane: one slot per open, its base URL on this server, a fixed spend per close."""

    def __init__(self, cap_stop=False):
        self.opens, self.closes = [], []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
                if self.path == "/sessions":
                    if cap_stop:
                        return self.answer(409, {"code": "CAP_STOP", "detail": "stage pf-opus has no room"})
                    outer.opens.append(body)
                    n = len(outer.opens)
                    return self.answer(200, {"id": f"ses_{n}", "token": f"tok-{n}", "base_url": f"{outer.url}/slot{n}/anthropic", "ledger": "u4", "item": "pf-opus", "lease_id": "pf-opus.0001.abcdef", "meter_id": f"m{n}", "allowance_micros": round(body["cap_usd"] * 1e6)})
                outer.closes.append({"path": self.path, **body})
                return self.answer(200, {"spent_micros": 1000 * len(outer.closes), "requests": 1, "ok_responses": 1, "refused": 0, "refusals": [], "usage": {}})

            def answer(self, code, obj):
                raw = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()


def sh(cwd, cmd):
    r = subprocess.run(["sh", "-c", cmd], cwd=cwd, capture_output=True, text=True, env={**os.environ, **GIT_ENV})
    assert r.returncode == 0, (cmd, r.stderr)
    return r.stdout.strip()


def session(scenario="ok", instr=False, cap_stop=False, arm="P"):
    """One PfAgent trial; returns the error it raised, the control plane's calls, the stub's log and pf-summary.json."""
    d = Path(tempfile.mkdtemp(prefix="pf-agent-sdk-"))
    DIRS.append(d)
    repo, bindir = d / "testbed", d / "bin"
    (repo / "flag").mkdir(parents=True)
    bindir.mkdir()
    (repo / "flag/flag.go").write_text("package flag\n\nvar Done bool\n")
    (repo / ".gitignore").write_text("gen/\n")
    if instr:
        (repo / "CLAUDE.md").write_text("PF-HOSTILE\n")
    sh(repo, "git init -q -b main && git add -A && git commit -qm base")
    task = {"repo_dir": str(repo), "commits": 1, "base_commit": sh(repo, "git rev-parse HEAD"), "kind": "PF"}
    (d / "task.json").write_text(json.dumps(task))
    for name, body in (("docker", FAKE_DOCKER), ("claude", STUB_CLAUDE)):
        (bindir / name).write_text(body)
        (bindir / name).chmod(0o755)
    rig = {"quiet_sec": 0.2, "bg_wait_sec": 1}
    pf = {
        "schema": "pf-config.v1", "arm": arm, "names": "short", "task_text": "Write a test that catches the bug.", "wrapup_text": "Last step. Write CHECKS.json.",
        "limits": {"task": {"wall_limit_sec": 60, "max_turns": 250, "allowance_usd": 12, **rig}, "wrapup": {"wall_limit_sec": 60, "max_turns": 20, "allowance_usd": 6, **rig}},
        "no_answer": "No one is available to answer. Use your own judgment.", "plugin": "/opt/pf-pstack" if arm == "P" else None, "env": {"CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1"},
    }
    (d / "pf-config.json").write_text(json.dumps(pf))
    manifest = d / "images.json"
    manifest.write_text(json.dumps({"schema": "tg-images.v1", "rows": [{"label": LABEL, "image_id": IMAGE}]}))
    control = Control(cap_stop)
    pf_agent.SH_DIR = str(d / "pf-sh")
    pf_agent.WORK = str(d / "pf-work")
    agent = pf_agent.PfAgent(
        logs_dir=d / "trial/agent", model_name="anthropic/claude-opus-5-5", base_url=control.url, task_json=str(d / "task.json"), arm="pf:" + arm, arm_tar="unused",
        upstream_model="claude-opus-5-5", control_url=control.url, ledger="u4", task_label=LABEL, trial_n=1, image_id=IMAGE, manifest=str(manifest),
        manifest_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest(), pf_config=str(d / "pf-config.json"), probe_node="",
    )
    agent.logs_dir.mkdir(parents=True)
    agent._container_id = lambda environment: "cid"
    agent._container_image = lambda container: IMAGE
    egress.apply = lambda container, allow: {"event": "egress", "allow": allow}
    stub_log = d / "stub.jsonl"
    saved = dict(os.environ)
    os.environ.update({**GIT_ENV, "PATH": str(bindir) + ":" + os.environ["PATH"], "PF_STUB_LOG": str(stub_log), "PF_STUB_SCENARIO": scenario})
    context = types.SimpleNamespace(cost_usd=None, metadata=None)
    error = None
    try:
        asyncio.run(agent.run("unused", types.SimpleNamespace(session_id="pf-" + d.name), context))
    except BaseException as e:
        error = e
    finally:
        os.environ.clear()
        os.environ.update(saved)
        control.stop()
    ev = d / "trial/evaluator"
    summary = json.loads((ev / "pf-summary.json").read_text()) if (ev / "pf-summary.json").exists() else None
    stub = [json.loads(line) for line in stub_log.read_text().splitlines()] if stub_log.exists() else []
    return types.SimpleNamespace(dir=d, ev=ev, repo=repo, error=error, control=control, stub=stub, summary=summary, context=context)


def check(ok, detail):
    if not ok:
        raise AssertionError(detail)


def flag(argv, name):
    return argv[argv.index(name) + 1] if name in argv else None


def test_two_turns_each_on_its_own_driver_slot():
    s = session()
    check(s.error is None, repr(s.error))
    opens = s.control.opens
    check([o["meta"]["phase"] for o in opens] == ["task", "wrapup"], opens)
    check([o["cap_usd"] for o in opens] == [12.0, 6.0], opens)
    check(all(o["ledger"] == "u4" and o["model"] == "claude-opus-5-5" and o["meta"]["arm"] == "pf:P" and o["meta"]["task"] == LABEL and o["meta"]["trial_n"] == 1 and "rerun" not in o["meta"] for o in opens), opens)
    check(len({o["trial"] for o in opens}) == 1 and len({o["open_key"] for o in opens}) == 2, opens)
    check([c["path"] for c in s.control.closes] == ["/sessions/ses_1/close", "/sessions/ses_2/close"] and all(c["reason"] == "turn_end" for c in s.control.closes), s.control.closes)
    task, wrap = s.stub
    check((task["phase"], wrap["phase"]) == ("task", "wrapup"), s.stub)
    check(task["base_url"].endswith("/slot1/anthropic") and task["token"] == "tok-1", task)
    check(wrap["base_url"].endswith("/slot2/anthropic") and wrap["token"] == "tok-2", wrap)
    check("--resume=s-1" in wrap["argv"] and not any(a.startswith("--resume") for a in task["argv"]), wrap["argv"])
    check(flag(task["argv"], "--max-turns") == "250" and flag(wrap["argv"], "--max-turns") == "20", (task["argv"], wrap["argv"]))
    check(flag(task["argv"], "--plugin-dir") == "/opt/pf-pstack", task["argv"])
    check(flag(task["argv"], "--disallowedTools") == "WebSearch,WebFetch", task["argv"])
    check(task["cwd"] == str(s.repo) and task["bundled"] == "1" and task["model"] == "claude-opus-5-5", task)
    sm = s.summary
    check(sm["claude_version"] == "2.1.312 (Claude Code)", sm["claude_version"])
    check(sm["task"]["termination"] == "completed" and [w["termination"] for w in sm["wrapup"]] == ["completed"], (sm["task"], sm["wrapup"]))
    check([(x["phase"], x["id"], x["allowance_micros"], x["close"]["spent_micros"]) for x in sm["slots"]] == [("task", "ses_1", 12_000_000, 1000), ("wrapup", "ses_2", 6_000_000, 2000)], sm["slots"])
    check("PF_CAPTURE changed=1 " in sm["capture"], sm["capture"])
    check(sm["checks"] is True and "PF_DISCARD late_1.txt" in sm["keep"] and "discarded=1" in sm["keep"], sm["keep"])
    check(json.loads((s.ev / "CHECKS.json").read_text())[0]["command"] == "bash checks/regress_test.sh", (s.ev / "CHECKS.json").read_text())
    bundle = s.dir / "check.git"
    sh(s.dir, f"git clone -q {s.ev / 's.bundle'} {bundle}")
    check((bundle / "checks/regress_test.sh").exists() and not (bundle / "late_1.txt").exists() and not (bundle / "CHECKS.json").exists(), sorted(p.name for p in bundle.iterdir()))
    check([e["event"] for e in sm["events"] if e["event"] in ("image", "egress", "u4_slot", "slot_open", "slot_close")] == ["image", "egress", "u4_slot", "slot_open", "slot_close", "u4_slot", "slot_open", "slot_close"], sm["events"])
    check(s.context.cost_usd == 0.003, s.context.cost_usd)
    check(s.context.metadata["pf"]["task"] == "completed" and s.context.metadata["pf"]["wrapup"] == ["completed"], s.context.metadata)


def test_a_wrapup_error_resets_to_s_and_reruns_once_on_a_new_slot_naming_its_rerun():
    s = session("wrapup_error", arm="N")
    check(s.error is None, repr(s.error))
    opens = s.control.opens
    check([(o["meta"]["phase"], o["meta"].get("rerun")) for o in opens] == [("task", None), ("wrapup", None), ("wrapup", "wrapup_upstream_or_infra")], opens)
    check([w["termination"] for w in s.summary["wrapup"]] == ["error_result", "completed"], s.summary["wrapup"])
    check([x["rerun"] for x in s.summary["slots"]] == [None, None, "wrapup_upstream_or_infra"], s.summary["slots"])
    check("PF_DISCARD late_2.txt" in s.summary["keep"] and "late_1.txt" not in s.summary["keep"] and "discarded=1" in s.summary["keep"], s.summary["keep"])
    check(flag(s.stub[0]["argv"], "--plugin-dir") is None, s.stub[0]["argv"])
    check([x["token"] for x in s.stub] == ["tok-1", "tok-2", "tok-3"], s.stub)


def test_a_tree_refusal_opens_no_slot_and_starts_no_claude():
    s = session(instr=True, arm="C")
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_ARM ") and "INSTR ./CLAUDE.md" in s.summary["refused"], s.summary.get("refused"))
    check(s.control.opens == [] and s.stub == [] and s.summary["slots"] == [] and s.summary["task"] is None, (s.control.opens, s.stub))
    check(s.context.cost_usd is None, s.context.cost_usd)


def test_a_cap_stop_on_the_task_open_raises_before_claude_starts():
    s = session(cap_stop=True)
    check(isinstance(s.error, lb.LedgerCapStop), repr(s.error))
    check(s.stub == [] and s.summary is None, s.stub)


if __name__ == "__main__":
    failed = 0
    for name, fn in [(k, v) for k, v in list(globals().items()) if k.startswith("test_")]:
        try:
            fn()
            print("PASS " + name)
        except Exception:
            failed += 1
            print("FAIL " + name)
            traceback.print_exc()
    for d in DIRS:
        shutil.rmtree(d, ignore_errors=True)
    sys.exit(1 if failed else 0)
