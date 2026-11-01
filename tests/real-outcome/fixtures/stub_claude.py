#!/usr/bin/env python3
"""A stub Claude Code CLI for the pinned Python Agent SDK (tests/real-outcome/agent_test.py).

It speaks the SDK's stream-json control protocol and plays one scenario (STUB_SCENARIO), acting in its working
directory as a trial's agent would: real files, real git over the sandbox's smart HTTP and the real gh stub. Every user
message, permission answer, background-task notice, its argv and the frozen variables it can see go to STUB_LOG.
"""

import json
import os
import re
import subprocess
import sys
import time

LOG = os.environ["STUB_LOG"]
SCENARIO = os.environ.get("STUB_SCENARIO", "two_turn")
FROZEN = re.compile(r"^((GSTACK|CONDUCTOR)_[A-Za-z0-9_]*|CI|GITHUB_ACTIONS|OPENCLAW_SESSION)$")
n = 0


def log(event, **kw):
    with open(LOG, "a") as f:
        f.write(json.dumps({"event": event, "t": time.time(), **kw}) + "\n")


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def uid():
    global n
    n += 1
    return f"u{n}"


def assistant(*blocks):
    out({"type": "assistant", "message": {"id": uid(), "type": "message", "role": "assistant", "model": "stub", "content": list(blocks), "stop_reason": None, "usage": {"input_tokens": 1, "output_tokens": 1}}, "parent_tool_use_id": None, "session_id": "s", "uuid": uid()})


def text(t):
    assistant({"type": "text", "text": t})


def result(subtype="success", is_error=False):
    out({"type": "result", "subtype": subtype, "is_error": is_error, "num_turns": 1, "result": "", "session_id": "s", "duration_ms": 1, "duration_api_ms": 1, "total_cost_usd": 0, "usage": {"input_tokens": 1, "output_tokens": 1}, "uuid": uid()})


def system(subtype, **kw):
    out({"type": "system", "subtype": subtype, "session_id": "s", "uuid": uid(), **kw})


def bash(command, background=False):
    """A Bash tool call the session records: tool_use, then its tool_result with the command's real exit status."""
    tid = uid()
    assistant({"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": command, **({"run_in_background": True} if background else {})}})
    if background:
        ok, output = True, "started in the background"
    else:
        r = subprocess.run(["sh", "-c", command], capture_output=True, text=True)
        ok, output = r.returncode == 0, (r.stdout + r.stderr)[-2000:]
        log("bash", command=command, rc=r.returncode, output=output)
    out({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": output, "is_error": not ok}]}, "parent_tool_use_id": None, "session_id": "s", "uuid": uid()})
    return tid


pending = []


def read():
    """The next message from the SDK; control responses are returned, user messages queued for next_user."""
    line = sys.stdin.readline()
    if not line:
        log("eof")
        sys.exit(0)
    m = json.loads(line)
    if m.get("type") == "control_request":
        log("control_request", subtype=m["request"].get("subtype"))
        out({"type": "control_response", "response": {"subtype": "success", "request_id": m["request_id"], "response": {"commands": [], "models": [], "account": {}, "output_style": "default", "available_output_styles": []}}})
        return None
    return m


def next_user():
    while not pending:
        m = read()
        if m is not None and m.get("type") == "user":
            pending.append(m)
        elif m is not None and m.get("type") == "control_response":
            raise SystemExit("unexpected control_response")
    m = pending.pop(0)
    content = m["message"]["content"]
    t = content if isinstance(content, str) else "".join(b.get("text", "") for b in content)
    log("user", text=t)
    return t


def ask(questions):
    """AskUserQuestion through the SDK's permission callback; returns the answers the callback put in the input."""
    rid = "cli_" + uid()
    out({"type": "control_request", "request_id": rid, "request": {"subtype": "can_use_tool", "tool_name": "AskUserQuestion", "input": {"questions": questions}, "permission_suggestions": None, "tool_use_id": uid()}})
    while True:
        line = sys.stdin.readline()
        if not line:
            sys.exit(0)
        m = json.loads(line)
        if m.get("type") == "control_response" and m["response"].get("request_id") == rid:
            answers = m["response"]["response"]["updatedInput"].get("answers")
            log("answers", answers=answers)
            return answers
        if m.get("type") == "user":
            pending.append(m)


if sys.argv[1:] in (["-v"], ["--version"]):
    log("version")
    print("2.1.312 (Claude Code)")
    sys.exit(0)
log("start", argv=sys.argv[1:], cwd=os.getcwd(), frozen={k: v for k, v in os.environ.items() if FROZEN.match(k)}, api_key=os.environ.get("ANTHROPIC_API_KEY"), base_url=os.environ.get("ANTHROPIC_BASE_URL"))
first = next_user()
system("init", model="stub", tools=["Bash", "AskUserQuestion"], cwd=os.getcwd(), permissionMode="default", apiKeySource="none", claude_code_version="0", skills=[], mcp_servers=[], slash_commands=[], output_style="default")

if SCENARIO == "two_turn":
    bash("npm test -- --watch", background=True)
    system("task_started", task_id="bg1", description="npm test", tool_use_id="x")
    ask([
        {"question": "Should I push the branch now?", "header": "Push", "multiSelect": False, "options": [{"label": "Push now", "description": "push and open a PR"}, {"label": "Keep working", "description": "more tests first"}]},
        {"question": "Which test runner?", "header": "Runner", "multiSelect": False, "options": [{"label": "jest", "description": "older"}, {"label": "vitest (Recommended)", "description": "fast"}]},
    ])
    bash("mkdir -p src && printf 'export const mul = (a, b) => a * b;\\n' > src/feature.js")
    text("Implemented mul in src/feature.js. Should I also add docs for it?")
    result()
    log("build_result")
    time.sleep(float(os.environ.get("STUB_TASK_DELAY", "2")))
    system("task_notification", task_id="bg1", status="completed", output_file="/tmp/bg1.out", summary="tests passed")
    log("task_done")
    next_user()
    bash("printf '# mul\\n' > MUL.md")
    text("Added MUL.md.")
    result()
    next_user()
    bash("git add -A && git commit -qm 'Add mul' && git push -q -u origin HEAD")
    bash("gh pr create --base main --title 'Add mul' --body 'Adds mul.'")
    text("Opened the pull request.")
    result()
elif SCENARIO == "never_quiet":
    bash("npm run dev", background=True)
    system("task_started", task_id="bg1", description="dev server", tool_use_id="x")
    text("Started the dev server.")
    result()
elif SCENARIO == "updated_killed":
    bash("npm run dev", background=True)
    system("task_started", task_id="bg2", description="dev server", tool_use_id="x")
    text("Started the dev server.")
    result()
    time.sleep(1)
    system("task_updated", task_id="bg2", patch={"status": "killed"})
    log("task_done")
    next_user()
    text("Nothing to ship.")
    result()
elif SCENARIO == "turn_never_ends":
    text("Working.")
    next_user()
elif SCENARIO == "max_turns":
    text("Working.")
    result("error_max_turns", True)
else:
    text("Ready.")
    result()

while True:
    next_user()
    text("Ready.")
    result()
