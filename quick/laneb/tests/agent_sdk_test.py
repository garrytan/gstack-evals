"""Keyless tests of the Lane B agent's system prompt and session kind options against the real pinned Agent SDK.

The Agent SDK here is the real claude-agent-sdk at the pin in runner/vm-bootstrap.sh; only Harbor is stubbed. The agent's CLI wrapper runs `docker exec -i ... <container> claude`, so a fake docker on PATH stands in for
the container: it passes on only the env vars named with -e, as docker does, records the claude argv and env, and
answers the SDK's stream-json with an init message and a result. Run by agent.test.ts with the pinned SDK's python.
"""

import asyncio
import json
import os
import sys
import tempfile
import traceback
import types
from pathlib import Path

import claude_agent_sdk


def module(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


class StubClaudeCode:
    def _resolve_auth_env(self):
        return {"ANTHROPIC_BASE_URL": "http://gateway:8787"}

    def _resolved_model_name(self):
        return "claude-opus-5-5"


for name in ("harbor", "harbor.agents", "harbor.agents.installed", "harbor.environments", "harbor.environments.docker", "harbor.models", "harbor.models.agent"):
    module(name)
module("harbor.agents.installed.claude_code", ClaudeCode=StubClaudeCode, ClaudeCodeOptions=object)
module("harbor.environments.base", BaseEnvironment=object)
module("harbor.environments.docker.docker", _sanitize_docker_compose_project_name=lambda s: s)
module("harbor.models.agent.context", AgentContext=object)

import laneb_agent as la  # noqa: E402

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
assert args[:2] == ["exec", "-i"], args
i, env = 2, {}
while args[i] in ("-w", "-e"):
    if args[i] == "-e":
        name, eq, value = args[i + 1].partition("=")
        if eq or name in os.environ:
            env[name] = value if eq else os.environ[name]
    i += 2
container, program, argv = args[i], args[i + 1], args[i + 2:]
if argv == ["-v"]:
    print("2.1.312 (Claude Code)")
    sys.exit(0)
with open(os.environ["FAKE_DOCKER_LOG"], "a") as f:
    f.write(json.dumps({"container": container, "program": program, "argv": argv, "env": env}) + "\n")
def send(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()
for line in sys.stdin:
    m = json.loads(line)
    if m.get("type") == "control_request":
        send({"type": "control_response", "response": {"subtype": "success", "request_id": m["request_id"], "response": {}}})
    elif m.get("type") == "user":
        send({"type": "system", "subtype": "init", "session_id": "s", "tools": ["Bash"], "skills": [], "model": "claude-opus-5-5", "claude_code_version": "2.1.312"})
        send({"type": "result", "subtype": "success", "duration_ms": 1, "duration_api_ms": 1, "is_error": False, "num_turns": 1, "session_id": "s", "total_cost_usd": 0, "usage": {}, "result": "done"})
'''


def agent(tmp: Path, **options):
    (tmp / "persona.json").write_text(json.dumps({"recommended_markers": ["(recommended)"], "fallback": "decide"}))
    (tmp / "wrapper.md").write_text("Task: {instruction}")
    bin_dir = tmp / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(FAKE_DOCKER)
    (bin_dir / "docker").chmod(0o755)
    os.environ["PATH"] = f"{bin_dir}:{os.environ['PATH']}"
    os.environ["FAKE_DOCKER_LOG"] = str(tmp / "docker.jsonl")
    a = la.LanebAgent.__new__(la.LanebAgent)
    a.options = types.SimpleNamespace(**{
        "persona_path": str(tmp / "persona.json"), "arm": "gstack", "arm_tar": "", "arm_sha256": "", "control_url": "http://127.0.0.1:8788",
        "session_cap_usd": 1.0, "wrapper_path": str(tmp / "wrapper.md"), "upstream_model": "claude-opus-5-5", "repo_dir": "", "workdir": "",
        "max_output_tokens": 32000, "sdk_max_turns": 5, "invoke": False, "skill_map": {}, "invocation_sep": " ", "system_prompt": "sdk-default", "session_kind": "", **options,
    })
    a.logs_dir = tmp / "trial" / "agent"
    a._arm_info = {"event": "arm", "arm": "gstack", "tar_sha256": "x", "skills_dirs": 1}
    a._container_id = lambda environment: "cid"
    a._exec = lambda container, script, stdin=None, timeout=300: types.SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
    a.opened = []

    def post(url, body, timeout=30):
        if url.endswith("/sessions"):
            a.opened.append(body)
            return {"id": "s-1", "token": "laneb-token"}
        return {"id": "s-1", "ok_responses": 1, "spent_micros": 0, "usage": {}}

    la.post_json = post
    return a


def run(tmp: Path, **options):
    a = agent(tmp, **options)
    asyncio.run(a.run("do it", types.SimpleNamespace(session_id="t1__env"), types.SimpleNamespace()))
    calls = [json.loads(line) for line in (tmp / "docker.jsonl").read_text().splitlines()]
    assert len(calls) == 1, calls
    evdir = tmp / "trial" / "agent"
    init = [json.loads(line) for line in (evdir / "sdk-messages.jsonl").read_text().splitlines() if '"init"' in line]
    assert len(init) == 1, init
    return a, calls[0], init[0]["init"], json.loads((evdir / "laneb-summary.json").read_text())


def recorded(a, init, summary):
    return [a.opened[0]["meta"], {k: init[k] for k in ("system_prompt", "session_kind")}, {k: summary[k] for k in ("system_prompt", "session_kind")}]


def test_the_pinned_sdk_is_the_one_under_test(tmp):
    pin = next(line.split("=", 1)[1] for line in (Path(la.__file__).parent.parent / "vm-bootstrap.sh").read_text().splitlines() if line.startswith("SDK_PIN="))
    assert claude_agent_sdk.__version__ == pin, (claude_agent_sdk.__version__, pin)


def test_sdk_default_sends_an_empty_system_prompt_and_no_session_kind(tmp):
    os.environ["GSTACK_SESSION_KIND"] = "unattended"
    try:
        a, call, init, summary = run(tmp)
    finally:
        del os.environ["GSTACK_SESSION_KIND"]
    argv = call["argv"]
    assert call["container"] == "cid" and call["program"] == "claude", call
    assert argv[argv.index("--system-prompt") + 1] == "", argv
    assert argv.count("--system-prompt") == 1 and "--append-system-prompt" not in argv, argv
    assert "GSTACK_SESSION_KIND" not in call["env"], call["env"]
    assert call["env"]["ANTHROPIC_API_KEY"] == "laneb-token", call["env"]
    want = {"system_prompt": "sdk-default", "session_kind": ""}
    assert recorded(a, init, summary)[1:] == [want, want], recorded(a, init, summary)
    assert a.opened[0]["meta"] == {"arm": "gstack", "arm_tar_sha256": "x", **want}, a.opened[0]


def test_the_claude_code_preset_sends_no_system_prompt_flag(tmp):
    a, call, init, summary = run(tmp, system_prompt="claude-code-preset")
    assert "--system-prompt" not in call["argv"] and "--append-system-prompt" not in call["argv"], call["argv"]
    assert "GSTACK_SESSION_KIND" not in call["env"], call["env"]
    want = {"system_prompt": "claude-code-preset", "session_kind": ""}
    assert recorded(a, init, summary) == [{"arm": "gstack", "arm_tar_sha256": "x", **want}, want, want], recorded(a, init, summary)


def test_an_unattended_session_kind_reaches_the_container(tmp):
    a, call, init, summary = run(tmp, system_prompt="claude-code-preset", session_kind="unattended")
    assert call["env"]["GSTACK_SESSION_KIND"] == "unattended", call["env"]
    assert "--system-prompt" not in call["argv"], call["argv"]
    want = {"system_prompt": "claude-code-preset", "session_kind": "unattended"}
    assert recorded(a, init, summary)[1:] == [want, want], recorded(a, init, summary)


def test_unknown_values_fail_before_the_session_opens(tmp):
    for options in ({"system_prompt": "claude_code"}, {"session_kind": "interactive"}):
        with tempfile.TemporaryDirectory() as d:
            a = agent(Path(d), **options)
            try:
                asyncio.run(a.run("do it", types.SimpleNamespace(session_id="t1__env"), types.SimpleNamespace()))
                raise AssertionError(f"{options} was accepted")
            except ValueError:
                pass
            assert a.opened == [] and not (Path(d) / "docker.jsonl").exists(), options


if __name__ == "__main__":
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"):
        os.environ.pop(key, None)
    failed = 0
    path = os.environ["PATH"]
    for name, fn in sorted((k, v) for k, v in globals().items() if k.startswith("test_")):
        with tempfile.TemporaryDirectory() as d:
            try:
                fn(Path(d))
                print(f"pass {name}")
            except Exception:
                failed += 1
                print(f"FAIL {name}")
                traceback.print_exc(file=sys.stdout)
            os.environ["PATH"] = path
    sys.exit(1 if failed else 0)
