"""One real_agent session for the outcome-skills driver's keyless dry run (dryrun.ts).

real_agent runs on the real pinned claude-agent-sdk 0.2.174 and Harbor f3a5a92 with the stub Claude Code
(tests/real-outcome/fixtures/stub_claude.py) and the stand-in docker (fake-docker.sh), as tests/real-outcome/agent_test.py
runs it; the sandbox sidecar is a real one. The driver's control plane and its proxies are real: nothing replaces Lane
B's post_json. Only the container lookups and the egress helper are replaced. Usage: python dryrun_session.py '<json>'.
It prints one JSON line: the error real_agent raised (or null), the stub's log and real-summary.json.
"""

import asyncio
import json
import os
import subprocess
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "tests/real-outcome/fixtures"
sys.path[:0] = [str(ROOT / "lanes/real-outcome/agent"), str(ROOT / "quick/laneb/runner/agent")]

import claude_agent_sdk  # noqa: E402
import egress  # noqa: E402
import laneb_agent as lb  # noqa: E402
import real_agent as ra  # noqa: E402

assert claude_agent_sdk.__version__ == "0.2.174", claude_agent_sdk.__version__
GIT_ENV = {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": "fixture", "GIT_AUTHOR_EMAIL": "f@x.invalid", "GIT_COMMITTER_NAME": "fixture", "GIT_COMMITTER_EMAIL": "f@x.invalid"}


def sh(cwd, cmd):
    r = subprocess.run(["sh", "-c", cmd], cwd=cwd, capture_output=True, text=True, env={**os.environ, **GIT_ENV})
    assert r.returncode == 0, (cmd, r.stderr)
    return r.stdout.strip()


def main():
    a = json.loads(sys.argv[1])
    d = Path(a["dir"])
    repo, bindir = d / "testbed", d / "bin"
    (repo / "src").mkdir(parents=True)
    bindir.mkdir()
    (repo / "src/app.js").write_text("export const add = (a, b) => a + b;\n")
    sh(repo, "git init -q -b main && git add -A && git commit -qm base")
    task = {"repo_dir": str(repo), "base_branch": "main", "base_commit": sh(repo, "git rev-parse HEAD"), "kind": "K2", "start_ref": "main"}
    (d / "task.json").write_text(json.dumps(task))
    os.symlink(FIXTURES / "fake-docker.sh", bindir / "docker")
    os.symlink(FIXTURES / "stub_claude.py", bindir / "claude")
    stub_log = d / "stub.jsonl"
    env = {**GIT_ENV, "PATH": str(bindir) + ":" + os.environ["PATH"], "STUB_LOG": str(stub_log), "STUB_SCENARIO": a.get("scenario", "u4_calls"), "STUB_CALLS": str(a.get("calls", 3)), "STUB_LABEL": a.get("label", "none")}
    agent = ra.RealAgent(
        logs_dir=d / "trial/agent", model_name="anthropic/claude-opus-5-5", base_url=a["base_url"], task_json=str(d / "task.json"), arm=a["arm"], arm_tar="unused",
        upstream_model="claude-opus-5-5", arms_path=a["arms_path"], sidecar_url=a["sidecar"], control_url=a["control_url"], ledger=a["ledger"],
        task_label=a.get("task", ""), trial_n=a.get("trial_n", 0), rerun=a.get("rerun", ""),
    )
    agent.logs_dir.mkdir(parents=True)
    agent._arm_info = {"event": "arm", "arm": a["arm"], "tar_sha256": "t", "skills_dirs": 0}
    agent._container_id = lambda environment: "cid"
    agent._container_ip = lambda container: "127.0.0.1"

    def run_here(container, script, stdin=None, timeout=300):
        if script == lb.KILL_CLAUDE:
            return subprocess.CompletedProcess(script, 0, b"", b"")
        if script == lb.LIST_PROCESSES:
            return subprocess.CompletedProcess(script, 0, b"1\tsleep\tsleep infinity \n", b"")
        return subprocess.run(["sh", "-c", script], input=stdin, capture_output=True, timeout=timeout, env={**os.environ, **env})

    agent._exec = run_here
    sidecar = agent._sidecar
    agent._sidecar = lambda path, body, timeout=120: sidecar(path, {**body, "config_dir": str(d / "etc"), "bin_dir": str(bindir), "node": a["node"]} if path == "/trials" else body, timeout)
    egress.apply = lambda container, allow: {"event": "egress", "allow": allow}
    egress.probe = lambda exec_fn, container, allow, node: {"event": "egress_probe"}
    os.environ.update(env)
    error = None
    try:
        asyncio.run(agent.run("Add a mul function to src/app.js.", types.SimpleNamespace(session_id="dryrun-" + d.name), types.SimpleNamespace()))
    except BaseException as e:
        error = {"type": type(e).__name__, "message": str(e)[:600]}
    evdir = d / "trial/evaluator"
    summary = evdir / "real-summary.json"
    events = evdir / "usersim-events.jsonl"
    print(json.dumps({
        "error": error,
        "stub": [json.loads(line) for line in stub_log.read_text().splitlines()] if stub_log.exists() else [],
        "summary": json.loads(summary.read_text()) if summary.exists() else None,
        "events": [json.loads(line).get("event") for line in events.read_text().splitlines()] if events.exists() else [],
    }))


main()
