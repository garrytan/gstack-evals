"""Keyless tests of the real-outcome lane's two-turn agent on the real pinned Agent SDK and Harbor.

The SDK (claude-agent-sdk 0.2.174) and Harbor (f3a5a92) are the real packages; Claude Code is fixtures/stub_claude.py,
reached through the agent's own wrapper script and a stand-in docker (fixtures/fake-docker.sh) that runs the container
command on this machine. The sandbox sidecar runs as its own process, as beside the proxy, and the stub's git and gh
calls go through it for real. Only the metering proxy's control plane, the container lookups and the egress helper are
replaced. Run by agent.test.ts with REAL_SIDECAR set to the sidecar's control URL.
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FIXTURES = HERE / "fixtures"
sys.path[:0] = [str(ROOT / "lanes/real-outcome/agent"), str(ROOT / "quick/laneb/runner/agent")]

import claude_agent_sdk  # noqa: E402
import egress  # noqa: E402
import laneb_agent as lb  # noqa: E402
import real_agent as ra  # noqa: E402

assert claude_agent_sdk.__version__ == "0.2.174", claude_agent_sdk.__version__
CONTROL = os.environ["REAL_SIDECAR"]
NODE = os.environ["REAL_NODE"]
TMP = Path(tempfile.mkdtemp(prefix="real-agent-test-"))
ARMS = json.loads((ROOT / "lanes/real-outcome/arms/arms.json").read_text())
STATEMENT = "Add a mul function to src/app.js."
GIT_ENV = {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": "fixture", "GIT_AUTHOR_EMAIL": "f@x.invalid", "GIT_COMMITTER_NAME": "fixture", "GIT_COMMITTER_EMAIL": "f@x.invalid"}
# The frozen variables a task image might set; the agent must hide every one from claude.
LEAKY = {"GSTACK_HEADLESS": "1", "GSTACK_SESSION_KIND": "unattended", "GSTACK_PLAN_MODE": "1", "CI": "true", "GITHUB_ACTIONS": "true", "CONDUCTOR_PORT": "1", "OPENCLAW_SESSION": "x"}


def sh(cwd, cmd):
    r = subprocess.run(["sh", "-c", cmd], cwd=cwd, capture_output=True, text=True, env={**os.environ, **GIT_ENV})
    assert r.returncode == 0, (cmd, r.stderr)
    return r.stdout.strip()


class Case:
    def __init__(self, name, arm="none", kind="K2", scenario="two_turn", wall=60):
        self.dir = TMP / name
        self.repo = self.dir / "testbed"
        self.bin = self.dir / "bin"
        self.repo.mkdir(parents=True)
        self.bin.mkdir()
        (self.repo / "src").mkdir()
        (self.repo / "src/app.js").write_text("export const add = (a, b) => a + b;\n")
        sh(self.repo, "git init -q -b main && git add -A && git commit -qm base")
        self.base = sh(self.repo, "git rev-parse HEAD")
        task = {"repo_dir": str(self.repo), "base_branch": "main", "base_commit": self.base, "kind": kind, "start_ref": "main"}
        if kind == "K4":
            sh(self.repo, "git checkout -q -b change && echo 'export const sub = (a, b) => a - b;' >> src/app.js && git commit -qam 'Add sub'")
            task.update(start_ref="change", replay={"role": "replay", "branch": "change", "commit": sh(self.repo, "git rev-parse HEAD"), "description": "Adds a sub function beside add."})
        (self.dir / "task.json").write_text(json.dumps(task))
        arms = json.loads(json.dumps(ARMS))
        for spec in arms["arms"].values():
            spec["limits"] = {**spec["limits"], "wall_limit_sec": wall, "quiet_sec": 1}
        (self.dir / "arms.json").write_text(json.dumps(arms))
        os.symlink(FIXTURES / "fake-docker.sh", self.bin / "docker")
        os.symlink(FIXTURES / "stub_claude.py", self.bin / "claude")
        self.log = self.dir / "stub.jsonl"
        self.env = {**GIT_ENV, **LEAKY, "PATH": str(self.bin) + ":" + os.environ["PATH"], "STUB_LOG": str(self.log), "STUB_SCENARIO": scenario}
        self.posts = []
        self.egress = []
        a = ra.RealAgent(logs_dir=self.dir / "trial/agent", model_name="anthropic/claude-opus-5-5", base_url="http://127.0.0.1:9", task_json=str(self.dir / "task.json"), arm=arm, arm_tar="unused", upstream_model="claude-opus-5-5", arms_path=str(self.dir / "arms.json"), sidecar_url=CONTROL)
        a.logs_dir.mkdir(parents=True)
        a._arm_info = {"event": "arm", "arm": arm, "tar_sha256": "t", "skills_dirs": 0}
        a._container_id = lambda environment: "cid"
        a._container_ip = lambda container: "127.0.0.1"
        a._exec = self.exec
        sidecar = a._sidecar
        a._sidecar = lambda path, body, timeout=120: sidecar(path, {**body, "config_dir": str(self.dir / "etc"), "bin_dir": str(self.bin), "node": NODE} if path == "/trials" else body, timeout)
        self.agent = a
        self.evdir = self.dir / "trial/evaluator"

    def exec(self, container, script, stdin=None, timeout=300):
        if script in (lb.KILL_CLAUDE,):
            return subprocess.CompletedProcess(script, 0, b"", b"")
        if script == lb.LIST_PROCESSES:
            return subprocess.CompletedProcess(script, 0, b"1\tsleep\tsleep infinity \n", b"")
        return subprocess.run(["sh", "-c", script], input=stdin, capture_output=True, timeout=timeout, env={**os.environ, **self.env})

    def post(self, url, body, timeout=30):
        self.posts.append((url.rsplit("/", 1)[-1], body))
        if url.endswith("/sessions"):
            return {"id": "s-1", "token": "real-session-token"}
        return {"id": "s-1", "ok_responses": 3, "spent_micros": 1500, "usage": {"input_tokens": 10, "output_tokens": 5}}

    def run(self):
        saved = dict(os.environ)
        os.environ.update(self.env)
        lb.post_json = self.post
        egress.apply = lambda container, allow: self.egress.append(("apply", allow)) or {"event": "egress", "allow": allow}
        egress.probe = lambda exec_fn, container, allow, node: self.egress.append(("probe", allow)) or {"event": "egress_probe"}
        context = types.SimpleNamespace()
        try:
            asyncio.run(self.agent.run(STATEMENT, types.SimpleNamespace(session_id="trial-" + self.dir.name), context))
        finally:
            os.environ.clear()
            os.environ.update(saved)
        self.context = context
        self.summary = json.loads((self.evdir / "real-summary.json").read_text())
        self.events = [json.loads(line) for line in self.log.read_text().splitlines()]
        return self

    def users(self):
        return [e["text"] for e in self.events if e["event"] == "user"]

    def at(self, event, n=0):
        return [e["t"] for e in self.events if e["event"] == event][n]


def check(cond, what):
    if not cond:
        raise AssertionError(what)


def test_two_turns_wait_for_quiet_and_ship_a_pr():
    c = Case("two-turn").run()
    s = c.summary
    users = c.users()
    check(users == [STATEMENT + "\n\n" + ARMS["build_suffix"], "Go with your recommendation.", ARMS["arms"]["none"]["turn2"]], users)
    users_t = [e["t"] for e in c.events if e["event"] == "user"]
    check(c.at("task_done") - c.at("build_result") >= 1.5, "the stub's task outlived its turn")
    check(users_t[1] > c.at("task_done"), "the prose reply came only after the background task ended")
    check(users_t[2] > users_t[1], "the ship turn came last")
    answers = [e for e in c.events if e["event"] == "answers"][0]["answers"]
    check(answers == {"Should I push the branch now?": "Not yet. Keep working; I'll tell you when to ship.", "Which test runner?": "vitest (Recommended)"}, answers)
    start = [e for e in c.events if e["event"] == "start"][0]
    check(start["frozen"] == {}, ("frozen variables reached claude", start["frozen"]))
    check(start["api_key"] == "real-session-token" and start["base_url"] == "http://127.0.0.1:9", start)
    check(start["cwd"] == str(c.repo), start["cwd"])
    argv = start["argv"]
    check("--system-prompt" not in argv, ("Claude Code's own system prompt is kept", argv))
    check(argv[argv.index("--max-turns") + 1] == "1000", argv)
    check("--strict-mcp-config" in argv and argv[argv.index("--disallowedTools") + 1] == "WebSearch,WebFetch", argv)
    check(s["termination"] == "completed" and [p["end"] for p in s["phases"]] == ["quiet", "quiet"], s["phases"])
    head = sh(c.repo, "git rev-parse HEAD")
    check(s["shipment"]["status"] == "pr" and s["shipment"]["shipped_head"] == head, s["shipment"])
    record = json.loads((c.evdir / "shipment.json").read_text())
    check(record["shipped_head"] == head and record["status"] == "pr", record)
    t1 = s["turn1"]
    patch = (c.evdir / "turn1.patch").read_text()
    check(t1["branch"] == "feature" and t1["head"] == c.base and "src/feature.js" in patch and "MUL.md" in patch, (t1, patch[:300]))
    check(sh(c.repo, "git status --porcelain") == "", "the turn-1 snapshot left the agent's index alone, and the agent committed everything")
    check(s["final"]["head"] == head and (c.evdir / "final.patch").read_text().count("diff --git") == 2, s["final"])
    steps = {r["step"]: r["status"] for r in s["ship_steps"]}
    check(steps["17"] == "ran" and steps["18-19"] == "ran" and steps["1"] == "skipped", steps)
    check(s["persona"]["build"] == {"questions": 2, "recommended": 1, "fallback": 0, "hold": 1, "prose": 1, "prose_unanswered": 0}, s["persona"])
    check([k for k, _ in c.egress] == ["apply", "probe"] and c.egress[0][1][0] == ("127.0.0.1", 9) and c.egress[0][1][1][0] == "127.0.0.1" and c.egress[0][1][1][1] != 9, c.egress)
    opened = [b for k, b in c.posts if k == "sessions"][0]
    check(opened["cap_usd"] == 40 and opened["meta"]["lane"] == "real-outcome", opened)
    check(c.context.cost_usd == 0.0015 and c.context.metadata["real_outcome"]["termination"] == "completed", c.context.metadata)


def test_a_task_that_never_ends_hits_the_wall_and_nothing_ships():
    c = Case("never-quiet", scenario="never_quiet", wall=3).run()
    s = c.summary
    check(c.users() == [STATEMENT + "\n\n" + ARMS["build_suffix"]], c.users())
    check(s["termination"] == "wall_limit" and s["phases"][0]["active_tasks"] == ["bg1"], s["phases"])
    check(s["shipment"]["status"] == "none" and s["shipment"]["shipped_head"] is None, s["shipment"])


def test_a_task_killed_through_task_updated_counts_as_ended():
    c = Case("updated-killed", scenario="updated_killed").run()
    users_t = [e["t"] for e in c.events if e["event"] == "user"]
    check(len(users_t) == 2 and users_t[1] > c.at("task_done"), c.users())
    check(c.summary["termination"] == "completed", c.summary["phases"])


def test_k4_sends_only_the_replay_turn_per_arm():
    none = Case("k4-none", kind="K4", scenario="one").run()
    check(none.users() == ["Adds a sub function beside add.\n\n" + ARMS["arms"]["none"]["turn2"]], none.users())
    check(none.summary["turn1"] is None and [p["phase"] for p in none.summary["phases"]] == ["ship"], none.summary["phases"])
    check(none.summary["sandbox"]["branch"] == "change", none.summary["sandbox"])
    told = Case("k4-told", arm="gstack", kind="K4", scenario="one").run()
    check(told.users() == ["/ship\n\nAdds a sub function beside add."], told.users())
    untold = Case("k4-untold", arm="gstack-untold", kind="K4", scenario="one").run()
    check(untold.users() == none.users(), untold.users())


def test_the_turn_ceiling_stops_the_trial():
    c = Case("max-turns", scenario="max_turns").run()
    check(c.summary["termination"] == "turn_ceiling" and len(c.users()) == 1, c.summary["phases"])


def test_told_arm_turn_two_is_the_slash_command():
    c = Case("told", arm="gstack", scenario="one").run()
    check(c.users() == [STATEMENT + "\n\n" + ARMS["build_suffix"], "/ship"], c.users())


def main():
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("PASS", name)
            except Exception:
                failed += 1
                print("FAIL", name)
                traceback.print_exc()
    shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
