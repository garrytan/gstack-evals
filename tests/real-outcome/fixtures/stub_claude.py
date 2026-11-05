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


def assistant(*blocks, parent=None):
    out({"type": "assistant", "message": {"id": uid(), "type": "message", "role": "assistant", "model": "stub", "content": list(blocks), "stop_reason": None, "usage": {"input_tokens": 1, "output_tokens": 1}}, "parent_tool_use_id": parent, "session_id": "s", "uuid": uid()})


def text(t, parent=None):
    assistant({"type": "text", "text": t}, parent=parent)


def tool(name, tool_input, output, parent=None):
    """A tool call and its ok result as the session records them, made by the main session or, with parent set to an
    Agent call's id, by that subagent. Nothing runs."""
    tid = uid()
    assistant({"type": "tool_use", "id": tid, "name": name, "input": tool_input}, parent=parent)
    out({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": output, "is_error": False}]}, "parent_tool_use_id": parent, "session_id": "s", "uuid": uid()})
    return tid


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


def model_calls():
    """Model calls through ANTHROPIC_BASE_URL with ANTHROPIC_API_KEY, as Claude Code makes them: STUB_CALLS of them, or
    until one is refused. Every fifth asks for plain JSON, the rest stream. Each names STUB_LABEL and its number, so the
    dry run's stub upstream can match its answers to the ledger call by call. Returns how many it made."""
    import urllib.error
    import urllib.request

    calls = os.environ.get("STUB_CALLS", "3")
    base = os.environ["ANTHROPIC_BASE_URL"].rstrip("/")
    k = 0
    while calls == "until_refused" or k < int(calls):
        k += 1
        stream = k % 5 != 0
        body = {"model": os.environ["ANTHROPIC_MODEL"], "max_tokens": 32000, "stream": stream, "messages": [{"role": "user", "content": f"dryrun-call {os.environ['STUB_LABEL']} {k}"}]}
        req = urllib.request.Request(base + "/v1/messages", data=json.dumps(body).encode(), headers={"content-type": "application/json", "x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read().decode()
                log("api", n=k, status=res.status, stream=stream, sse=raw.startswith("event:"))
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                code = json.loads(raw).get("code")
            except ValueError:
                code = None
            log("api", n=k, status=e.code, code=code)
            break
    return k


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
elif SCENARIO == "bg_progress":
    bash("npm run review", background=True)
    system("task_started", task_id="bg1", description="review agents", tool_use_id="x", task_type="local_agent")
    text("Started the review agents in the background.")
    result()
    log("build_result")
    time.sleep(1.5)
    for _ in range(8):
        system("task_progress", task_id="bg1", description="review agents", usage={"total_tokens": 1, "tool_uses": 1, "duration_ms": 1}, tool_use_id="x", last_tool_name="Read")
        time.sleep(0.4)
    system("task_notification", task_id="bg1", status="completed", output_file="/tmp/bg1.out", summary="review done")
    log("task_done")
elif SCENARIO == "ship_bg_silent":
    text("Implemented mul.")
    result()
    next_user()
    bash("npm run checks", background=True)
    system("task_started", task_id="bg3", description="checks", tool_use_id="x", task_type="local_agent")
    system("task_progress", task_id="bg3", description="checks", usage={"total_tokens": 1, "tool_uses": 1, "duration_ms": 1}, tool_use_id="x")
    text("Running the checks in the background.")
    result()
    log("ship_result")
elif SCENARIO == "turn_never_ends":
    text("Working.")
    next_user()
elif SCENARIO == "u4_calls":
    text(f"Made {model_calls()} calls.")
    result()
elif SCENARIO == "max_turns":
    text("Working.")
    result("error_max_turns", True)
elif SCENARIO == "g_turns":
    # G's registry turns. Each turn the main session starts one Agent subagent, whose message carries the
    # Agent call's id as parent_tool_use_id, then reports. A /plan-eng-review turn also leaves the marks that skill's
    # exposure detector reads: from the main session, or with STUB_G_FROM=subagent from inside the subagent. An /autoplan
    # turn replays the main session's t2 messages of the frozen exposed fixture (tests/outcome-skills/fixtures).
    AUTOPLAN = os.path.join(os.path.dirname(os.path.realpath(__file__)), "../../outcome-skills/fixtures/autoplan-exposed.jsonl")

    def autoplan_replay():
        for r in map(json.loads, open(AUTOPLAN)):
            if r.get("phase") != "t2" or r.get("parent_tool_use_id") is not None:
                continue
            if r["type"] == "AssistantMessage":
                assistant(*r["content"])
            elif r["type"] == "UserMessage":
                out({"type": "user", "message": {"role": "user", "content": r["content"]}, "parent_tool_use_id": None, "session_id": "s", "uuid": uid()})

    def plan_eng_review_marks(parent):
        tool("Read", {"file_path": "/root/.claude/skills/gstack/plan-eng-review/sections/review-sections.md"}, "# Review sections", parent)
        text("## Step 0: Scope Challenge\nThe plan is the right size.\n\n### 1. Architecture review\nOne module changes.\n\n### 2. Code quality review\nNo duplication.\n\n### 3. Test review\nOne unit test covers mul.\n\n### 4. Performance review\nNo hot path.", parent)
        tool("Write", {"file_path": "/root/.gstack/projects/repo/main-eng-review-test-plan-20261105.md", "content": "# Test plan\n- mul(2, 3) is 6\n"}, "File created successfully", parent)

    def g_turn(t):
        review = t.startswith("/plan-eng-review")
        inside = os.environ.get("STUB_G_FROM") == "subagent"
        aid = uid()
        assistant({"type": "tool_use", "id": aid, "name": "Agent", "input": {"description": "Survey", "prompt": "List the source files."}})
        text("src/app.js holds add.", aid)
        if review and inside:
            plan_eng_review_marks(aid)
        out({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": aid, "content": "src/app.js holds add.", "is_error": False}]}, "parent_tool_use_id": None, "session_id": "s", "uuid": uid()})
        if review and not inside:
            plan_eng_review_marks(None)
        if t.startswith("/autoplan"):
            autoplan_replay()
        text("Done with this turn.")
        result()

    if os.environ.get("STUB_CALLS"):
        model_calls()
    g_turn(first)
    while True:
        g_turn(next_user())
else:
    text("Ready.")
    result()

while True:
    next_user()
    text("Ready.")
    result()
