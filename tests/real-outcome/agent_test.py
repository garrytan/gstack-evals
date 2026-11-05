"""Keyless tests of the real-outcome lane's two-turn agent on the real pinned Agent SDK and Harbor.

The SDK (claude-agent-sdk 0.2.174) and Harbor (f3a5a92) are the real packages; Claude Code is fixtures/stub_claude.py,
reached through the agent's own wrapper script and a stand-in docker (fixtures/fake-docker.sh) that runs the container
command on this machine. The sandbox sidecar runs as its own process, as beside the proxy, and the stub's git and gh
calls go through it for real. Only the metering proxy's control plane, the container lookups and the egress helper are
replaced. Run by agent.test.ts with REAL_SIDECAR set to the sidecar's control URL.
"""

import asyncio
import hashlib
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
REGISTRY = json.loads((ROOT / "lanes/outcome-skills/arms/registry.json").read_text())
KEEP = os.environ.get("REAL_KEEP")
STATEMENT = "Add a mul function to src/app.js."
GIT_ENV = {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": "fixture", "GIT_AUTHOR_EMAIL": "f@x.invalid", "GIT_COMMITTER_NAME": "fixture", "GIT_COMMITTER_EMAIL": "f@x.invalid"}
# The frozen variables a task image might set; the agent must hide every one from claude.
LEAKY = {"GSTACK_HEADLESS": "1", "GSTACK_SESSION_KIND": "unattended", "GSTACK_PLAN_MODE": "1", "CI": "true", "GITHUB_ACTIONS": "true", "CONDUCTOR_PORT": "1", "OPENCLAW_SESSION": "x"}


def sh(cwd, cmd):
    r = subprocess.run(["sh", "-c", cmd], cwd=cwd, capture_output=True, text=True, env={**os.environ, **GIT_ENV})
    assert r.returncode == 0, (cmd, r.stderr)
    return r.stdout.strip()


class Case:
    def __init__(self, name, arm="none", kind="K2", scenario="two_turn", wall=60, quiet=1, bg_wait=None, registry=False):
        self.dir = TMP / name
        self.repo = self.dir / "testbed"
        self.bin = self.dir / "bin"
        self.repo.mkdir(parents=True)
        self.bin.mkdir()
        (self.repo / "src").mkdir()
        (self.repo / "src/app.js").write_text("export const add = (a, b) => a + b;\n")
        (self.repo / ".gitignore").write_text("*.log\n")
        (self.repo / "keep.log").write_text("a tracked file that matches .gitignore\n")
        sh(self.repo, "git init -q -b main && git add -A && git add -f keep.log && git commit -qm base")
        self.base = sh(self.repo, "git rev-parse HEAD")
        task = {"repo_dir": str(self.repo), "base_branch": "main", "base_commit": self.base, "kind": kind, "start_ref": "main"}
        if kind == "K4":
            sh(self.repo, "git checkout -q -b change && echo 'export const sub = (a, b) => a - b;' >> src/app.js && git commit -qam 'Add sub'")
            task.update(start_ref="change", replay={"role": "replay", "branch": "change", "commit": sh(self.repo, "git rev-parse HEAD"), "description": "Adds a sub function beside add."})
        (self.dir / "task.json").write_text(json.dumps(task))
        arms = json.loads(json.dumps(REGISTRY if registry else ARMS))
        for spec in arms["arms"].values():
            spec["limits"] = {**spec["limits"], "wall_limit_sec": wall, "quiet_sec": quiet, **({} if bg_wait is None else {"bg_wait_sec": bg_wait})}
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

    def run(self, cancel_on=None):
        saved = dict(os.environ)
        os.environ.update(self.env)
        lb.post_json = self.post
        egress.apply = lambda container, allow: self.egress.append(("apply", allow)) or {"event": "egress", "allow": allow}
        egress.probe = lambda exec_fn, container, allow, node: self.egress.append(("probe", allow)) or {"event": "egress_probe"}
        context = types.SimpleNamespace()
        self.cancelled = False

        async def go():
            task = asyncio.ensure_future(self.agent.run(STATEMENT, types.SimpleNamespace(session_id="trial-" + self.dir.name), context))
            while cancel_on and not task.done() and f'"event": "{cancel_on}"' not in (self.log.read_text() if self.log.exists() else ""):
                await asyncio.sleep(0.1)
            if cancel_on:
                task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                self.cancelled = True

        try:
            asyncio.run(go())
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
    check("keep.log" not in patch and "keep.log" not in (c.evdir / "final.patch").read_text(), "a tracked file that matches .gitignore is not reported deleted")
    check(sh(c.repo, "git status --porcelain") == "", "the turn-1 snapshot left the agent's index alone, and the agent committed everything")
    check(s["final"]["head"] == head and (c.evdir / "final.patch").read_text().count("diff --git") == 2, s["final"])
    steps = {r["step"]: r["status"] for r in s["ship_steps"]}
    check(steps["17"] == "ran" and steps["18-19"] == "ran" and steps["1"] == "skipped", steps)
    check(s["persona"]["build"] == {"questions": 2, "recommended": 1, "fallback": 0, "hold": 1, "prose": 1, "prose_unanswered": 0}, s["persona"])
    check([k for k, _ in c.egress] == ["apply", "probe"] and c.egress[0][1][0] == ("127.0.0.1", 9) and c.egress[0][1][1][0] == "127.0.0.1" and c.egress[0][1][1][1] != 9, c.egress)
    opened = [b for k, b in c.posts if k == "sessions"][0]
    check(opened["cap_usd"] == 40 and opened["meta"]["lane"] == "real-outcome", opened)
    check(c.context.cost_usd == 0.0015 and c.context.metadata["real_outcome"]["termination"] == "completed", c.context.metadata)


def test_a_task_that_never_ends_gets_bg_wait_sec_then_the_ship_turn():
    c = Case("never-quiet", scenario="never_quiet", bg_wait=2).run()
    s = c.summary
    users_t = [e["t"] for e in c.events if e["event"] == "user"]
    check(c.users() == [STATEMENT + "\n\n" + ARMS["build_suffix"], ARMS["arms"]["none"]["turn2"]], c.users())
    check(users_t[1] - users_t[0] >= 2.5, "the ship turn waited quiet_sec, then bg_wait_sec, for the task")
    check([p["end"] for p in s["phases"]] == ["bg_wait_expired", "quiet"] and s["phases"][0]["active_tasks"] == ["bg1"], s["phases"])
    check(s["termination"] == "bg_wait_expired", s["termination"])


def test_background_progress_keeps_the_wait_open_past_bg_wait_sec():
    c = Case("bg-progress", scenario="bg_progress", bg_wait=2).run()
    s = c.summary
    check(c.users() == [STATEMENT + "\n\n" + ARMS["build_suffix"], ARMS["arms"]["none"]["turn2"]], c.users())
    check(c.at("task_done") - c.at("build_result") >= 4, "the task sent progress past quiet_sec plus bg_wait_sec")
    sent = [e["ts"] for e in map(json.loads, (c.evdir / "usersim-events.jsonl").read_text().splitlines()) if e["event"] == "phase" and e["phase"] == "ship"]
    check(sent[0] > c.at("task_done"), "the ship turn went out only after the task ended, while its progress arrived")
    check(s["phases"][0] == {"phase": "build", "end": "quiet", "results": 1, "active_tasks": []}, s["phases"])
    check(s["termination"] == "completed" and [p["end"] for p in s["phases"]] == ["quiet", "quiet"], s["phases"])


def test_a_silent_background_task_ends_the_ship_phase_as_bg_wait_expired():
    c = Case("ship-bg-silent", scenario="ship_bg_silent", bg_wait=2).run()
    s = c.summary
    check([p["end"] for p in s["phases"]] == ["quiet", "bg_wait_expired"] and s["phases"][1]["active_tasks"] == ["bg3"], s["phases"])
    check(s["termination"] == "bg_wait_expired" and c.context.metadata["real_outcome"]["termination"] == "bg_wait_expired", s["termination"])
    record = json.loads((c.evdir / "shipment.json").read_text())
    check(record["close_reason"] == "bg_wait_expired" and record["status"] == "none", (record["close_reason"], record["status"]))


def test_a_turn_that_never_ends_hits_the_wall_and_nothing_ships():
    c = Case("turn-never-ends", scenario="turn_never_ends", wall=3).run()
    s = c.summary
    check(c.users() == [STATEMENT + "\n\n" + ARMS["build_suffix"]], c.users())
    check(s["termination"] == "wall_limit" and [p["end"] for p in s["phases"]] == ["wall_limit"], s["phases"])
    check(s["shipment"]["status"] == "none" and s["shipment"]["shipped_head"] is None, s["shipment"])


def test_a_deadline_inside_the_quiet_window_is_the_wall_and_no_ship_turn_goes_out():
    c = Case("deadline-in-quiet", scenario="one", wall=3, quiet=30).run()
    s = c.summary
    check(c.users() == [STATEMENT + "\n\n" + ARMS["build_suffix"]], c.users())
    check(s["termination"] == "wall_limit" and [p["end"] for p in s["phases"]] == ["wall_limit"], s["phases"])


def test_a_cancelled_run_closes_the_trial_as_cancelled():
    c = Case("cancelled", scenario="turn_never_ends").run(cancel_on="user")
    record = json.loads((c.evdir / "shipment.json").read_text())
    check(c.cancelled and record["close_reason"] == "cancelled" and c.summary["termination"] == "cancelled", (c.cancelled, record["close_reason"], c.summary["termination"]))


def test_a_task_killed_through_task_updated_counts_as_ended():
    c = Case("updated-killed", scenario="updated_killed").run()
    users_t = [e["t"] for e in c.events if e["event"] == "user"]
    check(len(users_t) == 2 and users_t[1] > c.at("task_done"), c.users())
    check(c.summary["termination"] == "completed", c.summary["phases"])


def test_the_system_prompt_is_claude_codes_own_and_no_option_changes_it():
    kw = dict(logs_dir=TMP / "options", model_name="anthropic/claude-opus-5-5", base_url="http://127.0.0.1:9", task_json="unused", arm="none", arm_tar="unused", upstream_model="claude-opus-5-5")
    a = ra.RealAgent(**kw)
    check((a.options.system_prompt, a.options.session_kind) == ("claude-code-preset", ""), (a.options.system_prompt, a.options.session_kind))
    for bad in ({"system_prompt": "sdk-default"}, {"session_kind": "unattended"}):
        try:
            ra.RealAgent(**kw, **bad)
        except ValueError as e:
            check(f"{next(iter(bad))}: Input should be" in str(e), str(e))
            continue
        raise AssertionError(f"{bad} was accepted")


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


def u4(case, answer=None, **opts):
    """Switches a Case to the outcome-skills driver's U4 mode; answer is what its control plane returns for an open."""
    manifest = case.dir / "tg-images.json"
    manifest.write_text(json.dumps({"schema": "tg-images.v1", "rows": [{"label": "t-1", "image_id": IMAGE}]}))
    for k, v in {"ledger": "u4", "task_label": "t-1", "trial_n": 1, "image_id": IMAGE, "manifest": str(manifest), "manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(), **opts}.items():
        setattr(case.agent.options, k, v)
    case.agent._container_image = lambda container: IMAGE
    slot = {"id": "s-1", "token": "real-session-token", "ledger": "u4", "item": "g-none", "lease_id": "g-none.0001.abcdef", "meter_id": "m_1", "base_url": "http://127.0.0.1:9/s_slot/anthropic"}
    plain = case.post

    def post(url, body, timeout=30):
        return {**plain(url, body, timeout), **(slot if answer is None else answer)} if url.endswith("/sessions") else plain(url, body, timeout)

    case.post = post
    return case


IMAGE = "sha256:" + "e" * 64


def refused(case):
    """Runs a Case that must raise before its session runs; returns the error."""
    saved = dict(os.environ)
    os.environ.update(case.env)
    lb.post_json = case.post
    egress.apply = lambda container, allow: case.egress.append(("apply", allow)) or {"event": "egress", "allow": allow}
    egress.probe = lambda exec_fn, container, allow, node: case.egress.append(("probe", allow)) or {"event": "egress_probe"}
    try:
        asyncio.run(case.agent.run(STATEMENT, types.SimpleNamespace(session_id="trial-" + case.dir.name), types.SimpleNamespace()))
    except Exception as e:
        return e
    finally:
        os.environ.clear()
        os.environ.update(saved)
    raise AssertionError("the run was not refused")


def test_u4_session_runs_on_the_slot_the_driver_answers():
    c = u4(Case("u4-slot", scenario="one")).run()
    opened = [b for name, b in c.posts if name == "sessions"]
    check(opened and opened[0]["ledger"] == "u4" and opened[0]["meta"] == {"arm": "none", "task": "t-1", "trial_n": 1}, opened)
    start = [e for e in c.events if e["event"] == "start"]
    check(start and start[0]["base_url"] == "http://127.0.0.1:9/s_slot/anthropic", start)
    check(c.summary["termination"] == "completed", c.summary["phases"])


def test_u4_refuses_an_answer_that_is_not_a_slot_and_closes_it():
    c = u4(Case("u4-laneb", scenario="one"), answer={"ledger": None})
    e = refused(c)
    check(isinstance(e, ra.SandboxSetupError) and "not a U4 slot" in str(e), repr(e))
    check([b for name, b in c.posts if name == "close"] == [{"reason": "not_u4"}], c.posts)
    check(not c.log.exists() or '"event": "start"' not in c.log.read_text(), "claude started")


def test_u4_needs_a_task_and_a_trial_before_the_sandbox_opens():
    c = u4(Case("u4-no-trial", scenario="one"), trial_n=0)
    e = refused(c)
    check(isinstance(e, ra.SandboxSetupError) and "task_label and trial_n" in str(e), repr(e))
    check(c.posts == [] and c.egress == [], (c.posts, c.egress))


def test_u4_refuses_a_container_on_another_image_before_the_sandbox_opens():
    c = u4(Case("u4-image", scenario="one"))
    c.agent._container_image = lambda container: "sha256:" + "f" * 64
    e = refused(c)
    check(isinstance(e, ra.SandboxSetupError) and "not the manifest's" in str(e), repr(e))
    check(c.posts == [] and c.egress == [], (c.posts, c.egress))


def test_registry_arms_run_only_on_u4():
    c = Case("registry-laneb", scenario="one")
    c.agent.options.arms_path = str(ROOT / "lanes/outcome-skills/arms/registry.json")
    e = refused(c)
    check(isinstance(e, ra.SandboxSetupError) and "outcome-skills registry" in str(e), repr(e))
    check(c.posts == [] and c.egress == [], (c.posts, c.egress))


def turn_texts(arm):
    return [STATEMENT + t["text"][len("{statement}"):] if t["text"].startswith("{statement}") else t["text"] for t in REGISTRY["arms"][arm]["turns"]]


def messages(case):
    """The session's message records, as the exposure detectors read them, kept in REAL_KEEP when set."""
    path = case.evdir / "sdk-messages.jsonl"
    if KEEP:
        shutil.copyfile(path, Path(KEEP) / (case.dir.name + ".jsonl"))
    return [r for r in map(json.loads, path.read_text().splitlines()) if r["type"] in ("AssistantMessage", "UserMessage")]


def test_g_told_arm_sends_registry_turns_t1_to_t3_and_records_phase_and_parent():
    c = u4(Case("g-pe", arm="plan-eng-review:told", scenario="g_turns", registry=True)).run()
    s = c.summary
    check(c.users() == turn_texts("plan-eng-review:told"), c.users())
    check(s["termination"] == "completed" and [(p["phase"], p["end"]) for p in s["phases"]] == [("t1", "quiet"), ("t2", "quiet"), ("t3", "quiet")], s["phases"])
    turns = [e for e in map(json.loads, (c.evdir / "usersim-events.jsonl").read_text().splitlines()) if e["event"] == "turns"]
    check(turns and turns[0]["phases"] == ["t1", "t2", "t3"], turns)
    recs = messages(c)
    check(recs and all(r.get("phase") in ("t1", "t2", "t3") and "parent_tool_use_id" in r for r in recs), "a message record lacks its turn or parent_tool_use_id")
    agents = {r["phase"]: b["id"] for r in recs if r["parent_tool_use_id"] is None for b in r["content"] if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Agent"}
    check(sorted(agents) == ["t1", "t2", "t3"], agents)
    for phase, aid in agents.items():
        check(any(r["phase"] == phase and r["parent_tool_use_id"] == aid for r in recs), (phase, "the subagent's message does not carry its Agent call's id"))
    check(list(s["persona"]) == ["t1", "t2", "t3"] and list(s["skill_calls"]) == ["t1", "t2", "t3"], (s["persona"], s["skill_calls"]))


def test_g_told_arm_records_a_subagent_doing_the_review_under_its_agent_call():
    c = u4(Case("g-pe-subagent", arm="plan-eng-review:told", scenario="g_turns", registry=True))
    c.env["STUB_G_FROM"] = "subagent"
    c.run()
    recs = messages(c)
    reads = [r for r in recs if any(isinstance(b, dict) and b.get("name") == "Read" for b in r["content"])]
    check(len(reads) == 1 and reads[0]["phase"] == "t2" and reads[0]["parent_tool_use_id"] not in (None, ""), reads)


def test_g_subagent_frame_without_parent_tool_use_id_is_recorded_without_the_key():
    c = u4(Case("g-keyless", arm="plan-eng-review:told", scenario="g_turns", registry=True))
    c.env["STUB_G_KEYLESS"] = "1"
    c.run()
    recs = messages(c)
    survey = [r for r in recs if any(isinstance(b, dict) and b.get("text") == "src/app.js holds add." for b in r["content"])]
    check(len(survey) == 3 and all("parent_tool_use_id" not in r for r in survey), survey)
    check(all("parent_tool_use_id" in r for r in recs if r not in survey), "a keyed frame lost its parent_tool_use_id")


def test_g_autoplan_told_arm_records_the_replayed_review_in_turn_two():
    c = u4(Case("g-ap", arm="autoplan:told", scenario="g_turns", registry=True)).run()
    check(c.users() == turn_texts("autoplan:told"), c.users())
    recs = messages(c)
    published = [r["phase"] for r in recs if r["parent_tool_use_id"] is None for b in r["content"] if isinstance(b, dict) and b.get("type") == "tool_use" and str(b.get("input", {}).get("command", "")).startswith("true autoplan-published")]
    check(published == ["t2", "t2"], published)


def test_g_none_arm_sends_turn_one_only():
    c = u4(Case("g-none", arm="none", scenario="g_turns", registry=True)).run()
    check(c.users() == turn_texts("none"), c.users())
    check(c.summary["termination"] == "completed" and [p["phase"] for p in c.summary["phases"]] == ["t1"], c.summary["phases"])
    check({r["phase"] for r in messages(c)} == {"t1"}, "a none record outside t1")


PLAN_HOLD = "Not yet. Keep to PLAN.md for now; don't write code yet."
FALLBACK = "Go with your recommendation."
NEXT = "How would you like to proceed?"


def test_g_told_arm_holds_code_through_the_sdk_in_turn_one_only():
    c = u4(Case("g-pe-ask", arm="plan-eng-review:told", scenario="g_turns", registry=True))
    c.env["STUB_G_ASK"] = "1"
    c.run()
    t1, t2, t3 = turn_texts("plan-eng-review:told")
    check(c.users() == [t1, PLAN_HOLD, t2, FALLBACK, t3, FALLBACK], c.users())
    answers = [e["answers"] for e in c.events if e["event"] == "answers"]
    check(answers == [{NEXT: PLAN_HOLD}, {NEXT: "Implement now (Recommended)"}, {NEXT: "Implement now (Recommended)"}], answers)
    check([c.summary["persona"][p]["hold"] for p in ("t1", "t2", "t3")] == [2, 0, 0], c.summary["persona"])


def test_g_none_arm_keeps_todays_answers_through_the_sdk():
    c = u4(Case("g-none-ask", arm="none", scenario="g_turns", registry=True))
    c.env["STUB_G_ASK"] = "1"
    c.run()
    check(c.users() == turn_texts("none") + [FALLBACK], c.users())
    answers = [e["answers"] for e in c.events if e["event"] == "answers"]
    check(answers == [{NEXT: "Implement now (Recommended)"}], answers)
    check(c.summary["persona"]["t1"]["hold"] == 0, c.summary["persona"])


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
