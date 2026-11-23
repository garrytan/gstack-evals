"""Drive one B2 scripted Claude Code session the way a trial does.

A copy of the harness mechanics driver (lanes/harness-mechanics/sessions-driver.py) with one change: session_kind comes from
the spec, so B2's gstack arms run with GSTACK_SESSION_KIND=unattended as their arm specs set it. LanebHooksAgent runs as in a
trial with only Harbor stubbed: the pinned claude-agent-sdk on the host, Claude Code in a running arm container through the
agent's docker exec -i wrapper, the arm tar extracted after the snapshot strip by the agent's own _inject_arm, and the stub
model (lanes/delivery-route/fake-model.ts) in place of the proxy, so no key reaches the container. Run by sessions.ts.

    python sessions-driver.py '<json: case, arm, tar, strip, told, session_kind, container, base_url, instruction, out>'
"""

import asyncio
import json
import subprocess
import sys
import types
from pathlib import Path


def module(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


SPEC = json.loads(sys.argv[1])
REPO = Path(__file__).resolve().parents[2]


class StubClaudeCode:
    def _resolve_auth_env(self):
        return {"ANTHROPIC_BASE_URL": SPEC["base_url"]}

    def _resolved_model_name(self):
        return "claude-opus-5-5"


for name in ("harbor", "harbor.agents", "harbor.agents.installed", "harbor.environments", "harbor.environments.docker", "harbor.models", "harbor.models.agent"):
    module(name)
module("harbor.agents.installed.claude_code", ClaudeCode=StubClaudeCode, ClaudeCodeOptions=object)
module("harbor.environments.base", BaseEnvironment=object)
module("harbor.environments.docker.docker", _sanitize_docker_compose_project_name=lambda s: s)
module("harbor.models.agent.context", AgentContext=object)

import laneb_agent as la  # noqa: E402
import laneb_hooks as lh  # noqa: E402


def post(url, body, timeout=30):
    if url.endswith("/sessions"):
        return {"id": SPEC["case"], "token": "hm-stub-token"}
    return {"id": SPEC["case"], "ok_responses": 1, "spent_micros": 0, "usage": {}}


la.post_json = post
lh.post_json = post

out = Path(SPEC["out"])
a = lh.LanebHooksAgent.__new__(lh.LanebHooksAgent)
a.options = types.SimpleNamespace(
    persona_path=str(REPO / "quick/laneb/runner/agent/persona.json"), arm=SPEC["arm"], arm_tar=SPEC["tar"], arm_sha256="", strip_snapshot=SPEC["strip"],
    control_url="http://127.0.0.1:9", session_cap_usd=5.0, wrapper_path=str(REPO / "quick/laneb/runner/prompt-wrapper.md"), upstream_model="claude-opus-5-5",
    repo_dir="/testbed", workdir=SPEC.get("workdir", "/testbed"), max_output_tokens=32000, sdk_max_turns=30, close_timeout_sec=30, system_prompt="claude-code-preset",
    session_kind=SPEC.get("session_kind", ""), told_skill=SPEC["told"], procedure_line="", closing_line="hm-status", checks_trust=SPEC.get("checks_trust", False),
    judge_backend=SPEC.get("backend"),
)
a.logs_dir = out / "agent"
a.logs_dir.mkdir(parents=True, exist_ok=True)
a._container_id = lambda environment: SPEC["container"]
a._arm_info = a._inject_arm(SPEC["container"])
if SPEC.get("after_inject"):
    subprocess.run(["docker", "exec", SPEC["container"], "sh", "-c", SPEC["after_inject"]], check=True, timeout=120)
a._preflight(SPEC["container"])
asyncio.run(a.run(SPEC["instruction"], types.SimpleNamespace(session_id=SPEC["case"]), types.SimpleNamespace()))
print(json.dumps({"case": SPEC["case"], "arm_info": a._arm_info}))
