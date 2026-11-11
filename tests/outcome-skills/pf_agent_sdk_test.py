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
import time
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
import pf_turns  # noqa: E402

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
scenario = os.environ.get("PF_STUB_SCENARIO")
error = (scenario == "wrapup_error" and phase == "wrapup" and n == 1) or (scenario == "task_error" and phase == "task")
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
            if scenario in ("task_lock", "task_lock_wall"):
                open(".git/index.lock", "w").close()
            if scenario == "task_grow":
                with open("states.bin", "w") as f:
                    f.truncate(8 << 30)
            if scenario == "task_filter":
                import subprocess
                subprocess.run(["git", "config", "filter.pf.clean", "false"], check=True)
                subprocess.run(["git", "config", "filter.pf.required", "true"], check=True)
                open(".gitattributes", "w").write("* filter=pf\n")
        else:
            if scenario == "wrapup_rm_head":
                os.remove(os.path.join(os.environ["PF_STUB_WORK"], "s.head"))
            open("CHECKS.json", "w").write(json.dumps([{"name": "regress", "command": "bash checks/regress_test.sh", "what_it_checks": "the reset"}]))
            open("late_%d.txt" % n, "w").write("wrap-up file\n")
        send({"type": "system", "subtype": "init", "session_id": "s-1", "tools": ["Bash"], "skills": [], "model": "claude-opus-5-5", "claude_code_version": "2.1.312"})
        send({"type": "assistant", "message": {"id": "m%d" % n, "type": "message", "role": "assistant", "model": "stub", "content": [{"type": "text", "text": "Done."}], "stop_reason": None, "usage": {"input_tokens": 1, "output_tokens": 1}}, "parent_tool_use_id": None, "session_id": "s-1", "uuid": "u%d" % n})
        if scenario == "task_lock_wall" and phase == "task":
            continue
        send({"type": "result", "subtype": "error_during_execution" if error else "success", "duration_ms": 1, "duration_api_ms": 1, "is_error": error, "num_turns": 1, "session_id": "s-1", "total_cost_usd": 0, "usage": {}, "result": "Done."})
'''


class Control:
    """The driver's control plane: one slot per open, its base URL on this server, a fixed spend per close, and the
    proxy-recorded effort fields on the first close. cap_stop True refuses every open with 409; "wrapup" only wrap-up opens.
    wrapup_refusals and wrapup_stops are every wrap-up close's refusal codes and allowance stop count. unfinalized names the
    closes (1 is the first) whose proxy finalize failed: finalized false and the driver's null counts, but a wrap-up close
    still carries wrapup_stops when set, the case where a turn has both. task_refusals and task_stops are the task close's.
    failing_closes maps a slot id to how many of its close requests answer 503 before one is served."""

    def __init__(self, cap_stop=False, wrapup_refusals=(), wrapup_stops=0, unfinalized=(), task_refusals=(), task_stops=0, failing_closes=None):
        self.opens, self.closes, self.refused, self.close_failures = [], [], [], []
        failing = dict(failing_closes or {})
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
                if self.path == "/sessions":
                    if cap_stop is True or (cap_stop == "wrapup" and body["meta"]["phase"] == "wrapup"):
                        outer.refused.append(body)
                        return self.answer(409, {"code": "CAP_STOP", "detail": "stage pf-opus has no room"})
                    outer.opens.append(body)
                    n = len(outer.opens)
                    return self.answer(200, {"id": f"ses_{n}", "token": f"tok-{n}", "base_url": f"{outer.url}/slot{n}/anthropic", "ledger": "u4", "item": "pf-opus", "lease_id": "pf-opus.0001.abcdef", "meter_id": f"m{n}", "allowance_micros": round(body["cap_usd"] * 1e6)})
                sid = self.path.split("/")[2]
                if failing.get(sid, 0) > 0:
                    failing[sid] -= 1
                    outer.close_failures.append(self.path)
                    return self.answer(503, {"code": "UNAVAILABLE", "detail": "driver busy"})
                outer.closes.append({"path": self.path, **body})
                n = len(outer.closes)
                lost = n in unfinalized
                first = {"thinking": {"type": "adaptive"}, "output_config": None, "reasoning": None, "reasoning_effort": None, "effort": None} if n == 1 and not lost else None
                refusals = list(wrapup_refusals) if n > 1 else list(task_refusals)
                stops = wrapup_stops if n > 1 else task_stops
                return self.answer(200, {"spent_micros": 1000 * n, "finalized": not lost, "requests": None if lost else 1, "ok_responses": None if lost else 1, "refused": None if lost else len(refusals), "refusals": refusals, "allowance_stops": (stops or None) if lost else stops, "usage": {}, "first_request": first})

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


def session(scenario="ok", instr=False, cap_stop=False, arm="P", wrapup_refusals=(), wrapup_stops=0, unfinalized=(), task_refusals=(), task_stops=0, failing_closes=None, task_wall=60, base_lfs=False):
    """One PfAgent trial; returns the error it raised, the control plane's calls, the stub's log and pf-summary.json.
    base_lfs sets the filter.lfs keys git lfs install --local writes in the base repo's .git/config."""
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
    if base_lfs:
        sh(repo, "git config filter.lfs.clean 'git-lfs clean -- %f' && git config filter.lfs.smudge 'git-lfs smudge -- %f' && git config filter.lfs.process 'git-lfs filter-process' && git config filter.lfs.required true")
    task = {"repo_dir": str(repo), "commits": 1, "base_commit": sh(repo, "git rev-parse HEAD"), "kind": "PF"}
    (d / "task.json").write_text(json.dumps(task))
    for name, body in (("docker", FAKE_DOCKER), ("claude", STUB_CLAUDE)):
        (bindir / name).write_text(body)
        (bindir / name).chmod(0o755)
    rig = {"quiet_sec": 0.2, "bg_wait_sec": 1}
    pf = {
        "schema": "pf-config.v1", "arm": arm, "names": "short", "task_text": "Write a test that catches the bug.", "wrapup_text": "Last step. Write CHECKS.json.",
        "limits": {"task": {"wall_limit_sec": task_wall, "max_turns": 250, "allowance_usd": 12, **rig}, "wrapup": {"wall_limit_sec": 60, "max_turns": 20, "allowance_usd": 6, **rig}},
        "no_answer": "No one is available to answer. Use your own judgment.", "plugin": "/opt/pf-pstack" if arm == "P" else None, "env": {"CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1"},
    }
    (d / "pf-config.json").write_text(json.dumps(pf))
    manifest = d / "images.json"
    manifest.write_text(json.dumps({"schema": "tg-images.v1", "rows": [{"label": LABEL, "image_id": IMAGE}]}))
    control = Control(cap_stop, wrapup_refusals, wrapup_stops, unfinalized, task_refusals, task_stops, failing_closes)
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
    os.environ.update({**GIT_ENV, "PATH": str(bindir) + ":" + os.environ["PATH"], "PF_STUB_LOG": str(stub_log), "PF_STUB_SCENARIO": scenario, "PF_STUB_WORK": pf_agent.WORK})
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
    check(sm["slots"][0]["close"]["first_request"] == {"thinking": {"type": "adaptive"}, "output_config": None, "reasoning": None, "reasoning_effort": None, "effort": None} and sm["slots"][1]["close"]["first_request"] is None, sm["slots"])
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


def test_a_wrapup_stopped_at_its_allowance_by_the_proxy_is_not_rerun():
    s = session("wrapup_error", wrapup_refusals=("E_ALLOWANCE",), wrapup_stops=1)
    check(s.error is None, repr(s.error))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task", "wrapup"], s.control.opens)
    check([(w["termination"], w["refused"], w["allowance_stops"]) for w in s.summary["wrapup"]] == [("error_result", ["E_ALLOWANCE"], 1)], s.summary["wrapup"])
    check(s.summary["task"]["allowance_stops"] == 0, s.summary["task"])
    check([x["phase"] for x in s.stub] == ["task", "wrapup"], s.stub)


def test_a_wrapup_e_allowance_refusal_that_is_no_allowance_stop_is_rerun_once():
    s = session("wrapup_error", wrapup_refusals=("E_ALLOWANCE",))
    check(s.error is None, repr(s.error))
    check([(o["meta"]["phase"], o["meta"].get("rerun")) for o in s.control.opens] == [("task", None), ("wrapup", None), ("wrapup", "wrapup_upstream_or_infra")], s.control.opens)
    check([(w["termination"], w["refused"], w["allowance_stops"]) for w in s.summary["wrapup"]] == [("error_result", ["E_ALLOWANCE"], 0), ("completed", ["E_ALLOWANCE"], 0)], s.summary["wrapup"])


def test_a_task_turn_whose_proxy_finalize_failed_ends_the_session_before_the_wrapup():
    s = session(unfinalized=(1,))
    check(s.error is None, repr(s.error))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task"], s.control.opens)
    check(s.summary["task"]["finalized"] is False and s.summary["task"]["allowance_stops"] == 0 and s.summary["wrapup"] == [], s.summary["task"])
    check([x["phase"] for x in s.stub] == ["task"], s.stub)


def test_a_wrapup_whose_proxy_finalize_failed_is_not_rerun():
    s = session("wrapup_error", unfinalized=(2,))
    check(s.error is None, repr(s.error))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task", "wrapup"], s.control.opens)
    check([(w["termination"], w["allowance_stops"], w["finalized"]) for w in s.summary["wrapup"]] == [("error_result", 0, False)], s.summary["wrapup"])
    check(s.summary["task"]["finalized"] is True and [x["close"]["finalized"] for x in s.summary["slots"]] == [True, False], s.summary["slots"])


def test_a_wrapup_allowance_stop_whose_proxy_finalize_failed_is_not_rerun():
    s = session("wrapup_error", wrapup_refusals=("E_ALLOWANCE",), wrapup_stops=1, unfinalized=(2,))
    check(s.error is None, repr(s.error))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task", "wrapup"], s.control.opens)
    check([(w["termination"], w["refused"], w["allowance_stops"], w["finalized"]) for w in s.summary["wrapup"]] == [("error_result", ["E_ALLOWANCE"], 1, False)], s.summary["wrapup"])
    check([x["phase"] for x in s.stub] == ["task", "wrapup"], s.stub)


def test_an_upstream_task_end_ends_the_session_before_the_capture_and_the_wrapup():
    s = session("task_error")
    check(s.error is None, repr(s.error))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task"], s.control.opens)
    check(s.summary["task"]["termination"] == "error_result" and s.summary["task"]["allowance_stops"] == 0, s.summary["task"])
    check(s.summary["capture"] is None and s.summary["wrapup"] == [] and s.summary["keep"] is None, s.summary)
    check([x["phase"] for x in s.stub] == ["task"] and not (s.ev / "s.bundle").exists(), s.stub)


def test_a_task_error_result_at_its_allowance_stop_still_runs_the_capture_and_the_wrapup():
    s = session("task_error", task_refusals=("E_ALLOWANCE",), task_stops=1)
    check(s.error is None, repr(s.error))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task", "wrapup"], s.control.opens)
    check((s.summary["task"]["termination"], s.summary["task"]["allowance_stops"]) == ("error_result", 1), s.summary["task"])
    check("PF_CAPTURE changed=1 " in s.summary["capture"] and [w["termination"] for w in s.summary["wrapup"]] == ["completed"], s.summary)
    check([x["phase"] for x in s.stub] == ["task", "wrapup"] and (s.ev / "s.bundle").stat().st_size > 0, s.stub)


def test_a_task_close_that_fails_once_is_sent_again_and_its_answer_read():
    s = session(failing_closes={"ses_1": 1})
    check(s.error is None, repr(s.error))
    check(s.control.close_failures == ["/sessions/ses_1/close"] and [c["path"] for c in s.control.closes] == ["/sessions/ses_1/close", "/sessions/ses_2/close"], (s.control.close_failures, s.control.closes))
    check(s.summary["slots"][0]["close"]["spent_micros"] == 1000 and s.summary["task"]["finalized"] is True, s.summary["slots"])
    check([w["termination"] for w in s.summary["wrapup"]] == ["completed"], s.summary["wrapup"])
    check([e["event"] for e in s.summary["events"] if e["event"] in ("close_failed", "slot_close")] == ["close_failed", "slot_close", "slot_close"], s.summary["events"])


def test_a_task_close_that_keeps_failing_reads_as_a_failed_finalize_and_ends_the_session_before_the_wrapup():
    s = session(failing_closes={"ses_1": 99})
    check(s.error is None, repr(s.error))
    check(s.control.close_failures == ["/sessions/ses_1/close"] * lb.OPEN_ATTEMPTS and s.control.closes == [], (s.control.close_failures, s.control.closes))
    close = s.summary["slots"][0]["close"]
    check(close["finalized"] is False and close["allowance_stops"] is None and close["spent_micros"] is None and "503" in close["error"], close)
    check(s.summary["task"]["finalized"] is False and s.summary["task"]["allowance_stops"] == 0, s.summary["task"])
    check([o["meta"]["phase"] for o in s.control.opens] == ["task"] and s.summary["capture"] is None and s.summary["wrapup"] == [], s.summary)


def test_a_wrapup_close_that_keeps_failing_is_not_rerun():
    s = session("wrapup_error", failing_closes={"ses_2": 99})
    check(s.error is None, repr(s.error))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task", "wrapup"], s.control.opens)
    check([(w["termination"], w["finalized"]) for w in s.summary["wrapup"]] == [("error_result", False)], s.summary["wrapup"])
    check([x["phase"] for x in s.stub] == ["task", "wrapup"], s.stub)


def test_a_cap_stop_on_the_wrapup_open_refuses_the_wrapup_once_with_no_rerun_and_keeps_s():
    s = session(cap_stop="wrapup")
    check(s.error is None, repr(s.error))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task"] and [o["meta"]["phase"] for o in s.control.refused] == ["wrapup"], (s.control.opens, s.control.refused))
    check([x["phase"] for x in s.stub] == ["task"], s.stub)
    w = s.summary["wrapup"]
    check(len(w) == 1 and w[0]["termination"] == "open_refused" and w[0]["refused"] == ["CAP_STOP"] and w[0]["session_id"] == "s-1", w)
    check([(x["phase"], x["id"], x["close"]) for x in s.summary["slots"]] == [("task", "ses_1", s.summary["slots"][0]["close"]), ("wrapup", None, None)] and "CAP_STOP" in s.summary["slots"][1]["open_refused"], s.summary["slots"])
    check(s.summary["checks"] is False and "PF_WRAPUP checks=0 discarded=0" in s.summary["keep"] and (s.ev / "s.bundle").stat().st_size > 0, s.summary["keep"])
    check(any(e["event"] == "ledger_cap_stop" and e["phase"] == "wrapup" for e in s.summary["events"]), s.summary["events"])


def test_a_cap_stop_on_the_task_open_raises_before_claude_starts():
    s = session(cap_stop=True)
    check(isinstance(s.error, lb.LedgerCapStop), repr(s.error))
    check(s.stub == [] and s.summary is None, s.stub)


def test_each_slot_open_is_recorded_before_its_request():
    s = session("wrapup_error")
    check(s.error is None, repr(s.error))
    opens = [json.loads(line) for line in (s.ev / "pf-opens.jsonl").read_text().splitlines()]
    check([(o["phase"], o["rerun"]) for o in opens] == [("task", None), ("wrapup", None), ("wrapup", "wrapup_upstream_or_infra")], opens)
    c = session(cap_stop=True)
    check(isinstance(c.error, lb.LedgerCapStop) and c.summary is None, repr(c.error))
    opens = [json.loads(line) for line in (c.ev / "pf-opens.jsonl").read_text().splitlines()] if (c.ev / "pf-opens.jsonl").exists() else []
    check([o["phase"] for o in opens] == ["task"], opens)


def with_scripts(edit, **kw):
    """One session with pf_agent.SH swapped for a copy of the pf scripts that edit(sh_dir) changed."""
    sh_copy = Path(tempfile.mkdtemp(prefix="pf-sh-"))
    DIRS.append(sh_copy)
    shutil.copytree(pf_agent.SH, sh_copy, dirs_exist_ok=True)
    edit(sh_copy)
    saved, pf_agent.SH = pf_agent.SH, sh_copy
    try:
        return session(**kw)
    finally:
        pf_agent.SH = saved


def with_step(fail, started=True, **kw):
    """One session whose container commands go through fail(script, args) first: a CompletedProcess or an exception it
    returns stands in for that command's run, and None runs it. A post-turn step's own command and args reach fail, not
    pf_turns' process-group wrapper around them. With started, a step that fail times out first starts its real process
    group (sleep 60, cut at 1 s), as a step that timed out leaves one for KILL to end."""
    real = pf_agent.Session.sh

    def sh(self, script, *args, timeout=600):
        group = script == getattr(pf_turns, "GROUP", None)
        r = fail(args[1], args[3:]) if group else fail(script, args)
        if group and started and isinstance(r, subprocess.TimeoutExpired):
            try:
                real(self, script, args[0], "sleep 60", timeout=1)
            except subprocess.TimeoutExpired:
                pass
        if isinstance(r, BaseException):
            raise r
        return r or real(self, script, *args, timeout=timeout)

    pf_agent.Session.sh = sh
    try:
        return session(**kw)
    finally:
        pf_agent.Session.sh = real


def test_an_index_lock_the_task_turn_left_makes_the_capture_failure_the_arms():
    s = session("task_lock")
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_ARM post_turn capture.sh commit: ") and "lock .git/index.lock" in s.summary["refused"], s.summary.get("refused"))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task"] and s.summary["capture"] is None and s.summary["wrapup"] == [], s.summary)


def test_a_lock_the_agents_git_left_at_a_wall_limit_end_is_a_post_turn_cause_after_that_end():
    s = session("task_lock_wall", task_wall=3)
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_ARM post_turn capture.sh commit: "), s.summary.get("refused"))
    pt = s.summary.get("post_turn") or {}
    check(pt.get("step") == "capture.sh commit" and pt.get("timed_out") is False and pt.get("causes") == ["lock .git/index.lock"] and pt.get("after") == {"phase": "task", "termination": "wall_limit"}, pt)


def test_a_lock_the_harness_capture_leaves_as_it_fails_stays_infra():
    def edit(d):
        cap = d / "capture.sh"
        cap.write_text(cap.read_text().replace("  commit)\n", "  commit)\n    : > .git/index.lock; echo 'capture died' >&2; exit 3\n", 1))

    s = with_scripts(edit)
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_CAPTURE capture.sh commit exited 3: capture died"), s.summary.get("refused"))


def test_a_capture_that_times_out_on_a_tree_the_task_turn_grew_is_the_arms():
    s = with_step(lambda script, args: subprocess.TimeoutExpired("docker", 600) if "capture.sh" in script and "commit" in args else None, scenario="task_grow")
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_ARM post_turn capture.sh commit: grown the session wrote files=") and s.summary["refused"].endswith(", at least 2000000 files or 8589934592 bytes"), s.summary.get("refused"))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task"] and s.summary["wrapup"] == [], s.summary)


def test_a_capture_timeout_records_the_files_and_bytes_the_session_wrote_below_and_above_the_line():
    def timeout(script, args):
        return subprocess.TimeoutExpired("docker", 600) if "capture.sh" in script and "commit" in args else None

    below = with_step(timeout)
    check(below.summary["refused"].startswith("E_PF_CAPTURE capture.sh commit timed out after 600 s"), below.summary.get("refused"))
    check((below.summary.get("post_turn") or {}).get("written") == {"files": 1, "bytes": 27, "stopped": False}, below.summary.get("post_turn"))
    above = with_step(timeout, scenario="task_grow")
    w = (above.summary.get("post_turn") or {}).get("written") or {}
    check(above.summary["refused"].startswith("E_PF_ARM post_turn capture.sh commit: grown") and w.get("stopped") is True and w.get("bytes", 0) >= 8 << 30 and w.get("files", 0) >= 1, above.summary.get("post_turn"))


def test_a_capture_that_fails_on_a_git_filter_the_task_turn_set_is_the_arms():
    s = session("task_filter")
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_ARM post_turn capture.sh commit: ") and "filter .git/config sets filter.pf.clean" in s.summary["refused"], s.summary.get("refused"))
    check([o["meta"]["phase"] for o in s.control.opens] == ["task"] and s.summary["capture"] is None, s.summary)

def test_a_base_repo_lfs_filter_leaves_an_infra_failure_of_the_capture_infra_and_a_session_filter_still_makes_it_the_arms():
    def fail(script, args):
        return subprocess.CompletedProcess([], 1, b"", b"Error response from daemon: container cid is not running\n") if "capture.sh" in script and "commit" in args else None

    base = with_step(fail, base_lfs=True)
    check(base.error is None, repr(base.error))
    check(base.summary["refused"].startswith("E_PF_CAPTURE capture.sh commit exited 1: Error response from daemon"), base.summary.get("refused"))
    check((base.summary.get("post_turn") or {}).get("causes") == [], base.summary.get("post_turn"))
    added = with_step(fail, scenario="task_filter", base_lfs=True)
    check(added.error is None, repr(added.error))
    check(added.summary["refused"].startswith("E_PF_ARM post_turn capture.sh commit: "), added.summary.get("refused"))
    check((added.summary.get("post_turn") or {}).get("causes") == ["filter .git/config sets filter.pf.clean", "filter .git/config sets filter.pf.required"], added.summary.get("post_turn"))


def test_the_kill_script_exits_0_only_once_the_steps_group_is_gone():
    work = Path(tempfile.mkdtemp(prefix="pf-kill-"))
    DIRS.append(work)
    kill = lambda: subprocess.run(["bash", "-c", pf_turns.KILL, "bash", str(work)], capture_output=True, timeout=30).returncode
    pid = int(subprocess.run(["bash", "-c", "setsid sleep 60 >/dev/null 2>&1 & echo $!"], capture_output=True, text=True).stdout)
    (work / "pf-step.pid").write_text(f"{pid}\n")
    check(kill() == 0, "a group the signal ended was not confirmed gone")
    zombie = subprocess.Popen(["sleep", "60"], start_new_session=True)
    (work / "pf-step.pid").write_text(f"{zombie.pid}\n")
    try:
        check(kill() != 0, "the kill script exited 0 while a process of the group was still there")
    finally:
        zombie.kill()
        zombie.wait()


def test_a_timed_out_step_whose_kill_is_not_confirmed_is_infra_and_state_sh_does_not_read_the_tree():
    def unconfirmed(script, args):
        if script == pf_turns.KILL:
            return subprocess.CompletedProcess([], 1, b"", b"")
        return subprocess.TimeoutExpired("docker", 600) if "capture.sh" in script and "commit" in args else None

    s = with_step(unconfirmed, scenario="task_grow")
    pid = (s.dir / "pf-work" / "pf-step.pid").read_text().strip()
    subprocess.run(["kill", "-KILL", "--", "-" + pid], capture_output=True)
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_CAPTURE capture.sh commit timed out after 600 s") and "kill of its process group was not confirmed" in s.summary["refused"], s.summary.get("refused"))
    pt = s.summary.get("post_turn") or {}
    check(pt.get("kill_confirmed") is False and pt.get("causes") == [] and pt.get("written") is None, pt)
    confirmed = with_step(lambda script, args: subprocess.TimeoutExpired("docker", 600) if "capture.sh" in script and "commit" in args else None, scenario="task_grow")
    check(confirmed.summary["refused"].startswith("E_PF_ARM post_turn capture.sh commit: grown"), confirmed.summary.get("refused"))
    check((confirmed.summary.get("post_turn") or {}).get("kill_confirmed") is True, confirmed.summary.get("post_turn"))


def test_a_stale_pid_file_from_an_earlier_step_is_never_killed():
    innocent = int(subprocess.run(["bash", "-c", "setsid sleep 60 >/dev/null 2>&1 & echo $!"], capture_output=True, text=True).stdout)

    def stale(script, args):
        if "pf-step.stamp" in script:
            Path(args[0]).mkdir(parents=True, exist_ok=True)
            (Path(args[0]) / "pf-step.pid").write_text(f"{innocent}\n")
            return None
        return subprocess.TimeoutExpired("docker", 600) if "capture.sh" in script and "commit" in args else None

    try:
        s = with_step(stale, started=False)
        alive = Path(f"/proc/{innocent}/stat").exists() and Path(f"/proc/{innocent}/stat").read_text().split(") ")[1][0] != "Z"
        check(alive, "KILL killed the process group a stale pf-step.pid named")
        check(s.summary["refused"].startswith("E_PF_CAPTURE capture.sh commit timed out") and (s.summary.get("post_turn") or {}).get("kill_confirmed") is False, s.summary.get("refused"))
    finally:
        subprocess.run(["kill", "-KILL", "--", "-%d" % innocent], capture_output=True)


def test_the_kill_script_refuses_a_pid_of_1_0_or_one_that_is_not_a_number():
    work = Path(tempfile.mkdtemp(prefix="pf-kill-pid-"))
    DIRS.append(work)
    (work / "bin").mkdir()
    log = work / "kill.log"
    (work / "bin" / "kill").write_text(f"#!/bin/sh\necho \"$*\" >> '{log}'\nexit 1\n")
    (work / "bin" / "kill").chmod(0o755)
    for pid in ("1", "0", "-1", "12x", ""):
        (work / "pf-step.pid").write_text(pid + "\n")
        r = subprocess.run(["bash", "-c", "enable -n kill; " + pf_turns.KILL, "bash", str(work)], capture_output=True, env={**os.environ, "PATH": str(work / "bin") + ":" + os.environ["PATH"]}, timeout=30)
        check(r.returncode != 0 and not log.exists(), (pid, r.returncode, log.exists() and log.read_text()))


def test_a_lock_the_harness_capture_leaves_as_it_times_out_stays_infra():
    def fail(script, args):
        if "capture.sh" not in script or "commit" not in args:
            return None
        stamp = os.stat(os.path.join(args[4], "pf-step.stamp"))
        lock = os.path.join(args[2], ".git", "index.lock")
        open(lock, "w").close()
        os.utime(lock, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        return subprocess.TimeoutExpired("docker", 600)

    s = with_step(fail)
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_CAPTURE capture.sh commit timed out after 600 s"), s.summary.get("refused"))


def test_a_post_turn_step_that_times_out_is_killed_before_state_sh_reads_the_tree():
    def edit(d):
        cap = d / "capture.sh"
        cap.write_text(cap.read_text().replace("  commit)\n", '  commit)\n    (sleep 3; : > "$4/late") >/dev/null 2>&1 &\n    wait\n', 1))

    real = pf_agent.Session.sh

    def sh(self, script, *args, timeout=600):
        capture = "commit" in args and "capture.sh" in script + " ".join(args)
        return real(self, script, *args, timeout=1 if capture else timeout)

    pf_agent.Session.sh = sh
    try:
        s = with_scripts(edit)
    finally:
        pf_agent.Session.sh = real
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_CAPTURE capture.sh commit timed out after 1 s"), s.summary.get("refused"))
    time.sleep(4)
    check(not (s.dir / "pf-work" / "late").exists(), "the timed-out capture kept running and wrote to the tree after state.sh read it")


def test_a_wrapup_turn_that_removes_s_head_makes_the_keep_failure_the_arms():
    s = session("wrapup_rm_head")
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_ARM post_turn wrapup.sh keep: ") and "missing s.head" in s.summary["refused"], s.summary.get("refused"))
    check([w["termination"] for w in s.summary["wrapup"]] == ["completed"] and s.summary["keep"] is None and not (s.ev / "s.bundle").exists(), s.summary)


def test_a_failed_s_bundle_is_a_refusal_and_leaves_no_bundle():
    s = with_step(lambda script, args: subprocess.CompletedProcess([], 128, b"", b"fatal: bundle failed\n") if "bundle create" in script else None)
    check(s.error is None, repr(s.error))
    check(s.summary["refused"].startswith("E_PF_CAPTURE bundle exited 128: fatal: bundle failed"), s.summary.get("refused"))
    check(s.summary["checks"] is True and not (s.ev / "s.bundle").exists(), sorted(p.name for p in s.ev.iterdir()))


def test_a_post_turn_step_that_times_out_is_a_refusal_and_not_an_escape():
    s = with_step(lambda script, args: subprocess.TimeoutExpired("docker", 600) if "wrapup.sh" in script and "keep" in args else None)
    check(s.error is None, repr(s.error))
    check(s.summary is not None and s.summary["refused"].startswith("E_PF_CAPTURE wrapup.sh keep timed out after 600 s"), s.summary and s.summary.get("refused"))


def test_a_failing_keep_after_a_completed_wrapup_still_writes_the_summary_with_the_refusal_and_no_bundle():
    sh_copy = Path(tempfile.mkdtemp(prefix="pf-sh-"))
    DIRS.append(sh_copy)
    shutil.copytree(pf_agent.SH, sh_copy, dirs_exist_ok=True)
    wrap = sh_copy / "wrapup.sh"
    wrap.write_text(wrap.read_text().replace("  keep)\n", "  keep)\n    echo 'keep failed' >&2; exit 3\n", 1))
    saved, pf_agent.SH = pf_agent.SH, sh_copy
    try:
        s = session()
    finally:
        pf_agent.SH = saved
    check(s.error is None, repr(s.error))
    sm = s.summary
    check(sm is not None and sm["refused"].startswith("E_PF_CAPTURE wrapup.sh keep exited 3"), sm and sm.get("refused"))
    check(sm["task"]["termination"] == "completed" and [w["termination"] for w in sm["wrapup"]] == ["completed"], (sm["task"], sm["wrapup"]))
    check("PF_CAPTURE changed=1 " in sm["capture"] and sm["keep"] is None and sm["checks"] is False, (sm["capture"], sm["keep"]))
    check(not (s.ev / "s.bundle").exists(), sorted(p.name for p in s.ev.iterdir()))

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
