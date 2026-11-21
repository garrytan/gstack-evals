# Copyright (c) 2026 Garry Tan. MIT License.
"""Keyless tests of part S's Codex session loop (lanes/outcome-skills/h2h/ext/h2h_codex.py) on the real pinned Codex CLI
0.170.0 against a local stand-in for the Responses API (ext/stub-responses.ts). Run by h2hx-codex.test.ts with
REAL_OUTCOME_PYTHON (claude-agent-sdk 0.2.174, which h2h_turns imports) and H2HX_CODEX_DIR (the unpacked binary and its
code-mode host). The session runs on this machine with no container: the repo, home and work dirs are temp dirs, Codex
starts through a link named sol-agent, and the slot is the dry run's StaticSlot pointing at the stub. Prints PASS <name> or
FAIL <name> per test.
"""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "lanes/outcome-skills/h2h/ext"
sys.path.insert(0, str(EXT))
from h2h_codex import CodexTurns, merged_config, model_responses, rollout_questions  # noqa: E402
from h2h_turns import run_session  # noqa: E402

BASE = json.loads((ROOT / "wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/prereg.json").read_text())
CODEX_DIR = Path(os.environ["H2HX_CODEX_DIR"])
GIT_ENV = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_AUTHOR_NAME": "fixture", "GIT_AUTHOR_EMAIL": "f@x.invalid", "GIT_COMMITTER_NAME": "fixture", "GIT_COMMITTER_EMAIL": "f@x.invalid"}
DIRS = []


def stub():
    log = Path(tempfile.mkdtemp(prefix="h2hx-stub-"))
    DIRS.append(log)
    p = subprocess.Popen(["bun", str(EXT / "stub-responses.ts")], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={**os.environ, "LOG_DIR": str(log)})
    line = p.stdout.readline().decode()
    assert line.startswith("stub-responses listening "), line
    return p, "http://127.0.0.1:" + line.split()[-1], log


def session(name: str, base_url: str, turns: list[str], **over):
    d = Path(tempfile.mkdtemp(prefix=f"h2hx-{name}-"))
    DIRS.append(d)
    repo, home, sh, bindir = d / "repo", d / "home", d / "sh", d / "bin"
    for p in (repo, home, sh, bindir):
        p.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True, env=GIT_ENV)
    (repo / "a.txt").write_text("a\n")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, env=GIT_ENV)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "base"], check=True, env=GIT_ENV)
    for src in (ROOT / "lanes/outcome-skills/pfchecks/sh", ROOT / "lanes/outcome-skills/h2h/sessions/sh"):
        for f in src.iterdir():
            shutil.copy(f, sh / f.name)
    (bindir / "sol-agent").symlink_to(CODEX_DIR / "codex")
    head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, env=GIT_ENV).stdout.strip()
    cfg = {
        "out": str(d / "out"), "no_answer": BASE["texts"]["question_reply"], "limits": {"allowance_usd": 15, "wall_sec": 120, "max_turns": 300, "quiet_sec": 30, "bg_wait_sec": 600},
        "repo": str(repo), "home": str(home), "home_rule": "none", "exec_prefix": [], "sh_dir": str(sh), "work": str(d / "work"), "turns": turns,
        "continuation": BASE["texts"]["continuation"], "done_rule": BASE["done_rule"], "continuation_cap": BASE["continuation_cap"], "env": {"GSTACK_TELEMETRY_SOURCE": "eval"},
        "base_url": base_url, "token": "stub-slot-token", "commits": 1, "head": head,
        "codex": {"bin": str(bindir / "sol-agent"), "home": str(home / ".codex"), "model": "gpt-6.2-sol", "effort": "low", "version": "0.170.0"},
    }
    for k, v in over.items():
        cfg[k] = {**cfg[k], **v} if isinstance(v, dict) and isinstance(cfg.get(k), dict) else v
    return cfg, d


def run(cfg):
    return asyncio.run(run_session(CodexTurns(cfg)))


def requests(log: Path) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(log.glob("req-*.json"))]


def user_texts(body: dict) -> list[str]:
    out = []
    for i in body.get("input") or []:
        if i.get("type") == "message" and i.get("role") == "user":
            t = "".join(c.get("text", "") for c in i.get("content") or [])
            if not t.startswith("<environment_context>"):
                out.append(t)
    return out


def rollouts(out: Path) -> list[Path]:
    return sorted((out / "codex-sessions").rglob("rollout-*.jsonl"))


def test_done_in_one_turn(base_url, log):
    cfg, d = session("done", base_url, ["[fx:done] Fix the parser."])
    s = run(cfg)
    out = Path(cfg["out"])
    assert s.get("refused") is None, s.get("refused")
    assert [t["termination"] for t in s["turns"]] == ["completed"], s["turns"]
    assert s["done"] is True and s["next"] == "end_done" and s["continuations"] == 0
    assert s["codex_version"] == "codex-cli 0.170.0" and s["claude_version"] is None
    assert s["turns_used"] == 1 and s["turns"][0]["num_turns"] == 1
    assert len(s["trees"]) == 2 and all(s["trees"])
    assert (out / "tree.tar").stat().st_size > 0 and s["capture"]["tree_tar_bytes"] > 0
    assert len(rollouts(out)) == 1 and s["codex_sessions"]
    assert not (out / "sdk-messages.jsonl").exists() and (out / "codex-events.jsonl").stat().st_size > 0
    cfg_text = (out / "codex-config.toml").read_text()
    assert 'base_url = "' + base_url + '/v1"' in cfg_text and 'wire_api = "responses"' in cfg_text and 'model_reasoning_effort = "low"' in cfg_text
    assert s["questions"]["t1"]["questions"] == 0 and s["questions"]["t1"]["unanswered"] == 0
    meta = json.loads(rollouts(out)[0].read_text().splitlines()[0])["payload"]
    assert meta["originator"] == "codex_exec" and meta["cli_version"] == "0.170.0" and meta["model_provider"] == "h2h_proxy"


def test_continuations_to_the_cap(base_url, log):
    cfg, d = session("cap", base_url, ["[fx:nodone] Fix the parser."], continuation_cap=2)
    s = run(cfg)
    assert [t["phase"] for t in s["turns"]] == ["t1", "c1", "c2"], [t["phase"] for t in s["turns"]]
    assert s["done"] is False and s["next"] == "end_cap" and s["continuations"] == 2 and s["spurious_continuations"] == 2
    assert len({t["session_id"] for t in s["turns"]}) == 1
    assert len(rollouts(Path(cfg["out"]))) == 1
    kinds = [x["kind"] for t in s["turns"] for x in t["drive"]["execs"]]
    assert kinds == ["turn", "turn", "turn"], kinds


def test_async_question_gets_the_reply_on_the_same_thread(base_url, log):
    before = len(list(log.glob("req-*.json")))
    cfg, d = session("ask", base_url, ["[fx:ask] Fix the parser."])
    s = run(cfg)
    t = s["turns"][0]
    assert t["termination"] == "completed" and s["done"] is True, t
    assert [x["kind"] for x in t["drive"]["execs"]] == ["turn", "reply"]
    q = s["questions"]["t1"]
    assert (q["questions"], q["ask_user_question"], q["async_questions"], q["sync_questions"], q["unanswered"]) == (1, 1, 1, 0, 0), q
    reqs = requests(log)[before:]
    assert user_texts(reqs[-1]["body"])[-1] == BASE["texts"]["question_reply"], user_texts(reqs[-1]["body"])
    assert len(rollouts(Path(cfg["out"]))) == 1
    events = [json.loads(l) for l in (Path(cfg["out"]) / "usersim-events.jsonl").read_text().splitlines()]
    assert events[0]["answer"] == BASE["texts"]["question_reply"]


def test_sync_question_is_counted_unanswered(base_url, log):
    cfg, d = session("asksync", base_url, ["[fx:asksync] Fix the parser."])
    s = run(cfg)
    q = s["questions"]["t1"]
    assert s["done"] is True and [x["kind"] for x in s["turns"][0]["drive"]["execs"]] == ["turn"]
    assert (q["questions"], q["sync_questions"], q["unanswered"], q["async_questions"]) == (1, 1, 1, 0), q
    lines = rollouts(Path(cfg["out"]))[0].read_text().splitlines()
    outs = [json.loads(l)["payload"] for l in lines if '"function_call_output"' in l]
    assert any("Plan mode" in json.dumps(o) or "unavailable" in json.dumps(o) for o in outs), outs


def test_two_scripted_turns_resume_one_thread(base_url, log):
    before = len(list(log.glob("req-*.json")))
    cfg, d = session("two", base_url, ["[fx:done] $spec-driven-development Fix the parser.", "$incremental-implementation Implement every task."])
    s = run(cfg)
    assert [t["phase"] for t in s["turns"]] == ["t1", "t2"] and s["done"] is True
    assert s["turns"][0]["session_id"] == s["turns"][1]["session_id"]
    reqs = requests(log)[before:]
    assert user_texts(reqs[-1]["body"])[-2:] == ["[fx:done] $spec-driven-development Fix the parser.", "$incremental-implementation Implement every task."]


def test_ci_unset_and_env_reaches_tools(base_url, log):
    cmd = 'printf "CI=%s GHA=%s SRC=%s\\n" "${CI-unset}" "${GITHUB_ACTIONS-unset}" "${GSTACK_TELEMETRY_SOURCE-unset}"'
    cfg, d = session("ci", base_url, ["[fx:cmd] " + cmd], env={"GSTACK_TELEMETRY_SOURCE": "eval", "CI": "true", "GITHUB_ACTIONS": "true"})
    s = run(cfg)
    assert s["done"] is True, s["turns"]
    text = rollouts(Path(cfg["out"]))[0].read_text()
    assert "CI=unset GHA=unset SRC=eval" in text, text[-2000:]


def test_policy_failure_is_a_refusal(base_url, log):
    cfg, d = session("fail", base_url, ["[fx:fail] Fix the parser."])
    s = run(cfg)
    t = s["turns"][0]
    assert t["termination"] == "error_result" and t["refusal"] is True, t
    assert s["next"] == "stop" and "cyber_policy" in t["results"][0]["failed"]
    assert (Path(cfg["out"]) / "tree.tar").exists()


def test_wall_limit_kills_codex(base_url, log):
    cfg, d = session("hang", base_url, ["[fx:hang] Fix the parser."], limits={"wall_sec": 8})
    s = run(cfg)
    t = s["turns"][0]
    assert t["termination"] == "wall_limit" and t["drive"]["execs"][0]["killed"] == "wall_limit", t
    assert s["next"] == "stop" and t["wall_s"] < 60
    left = subprocess.run(["pgrep", "-f", str(Path(cfg["codex"]["bin"]))], capture_output=True, text=True).stdout.strip()
    assert left == "", left


def test_hooks_run_under_the_trust_bypass(base_url, log):
    cfg, d = session("hook", base_url, ["[fx:done] Fix the parser."], home_rule="gstack")
    marker = d / "hook-ran"
    codex = Path(cfg["codex"]["home"])
    codex.mkdir(parents=True)
    (codex / "hooks.json").write_text(json.dumps({"hooks": {"UserPromptSubmit": [{"hooks": [{"type": "command", "command": f"echo ran >> {marker}"}]}]}}))
    s = run(cfg)
    assert s["done"] is True and marker.read_text().strip() == "ran"


def test_pack_config_is_kept_and_a_clash_refuses_before_the_slot(base_url, log):
    cfg, d = session("packcfg", base_url, ["[fx:done] Fix the parser."], home_rule="pack")
    codex = Path(cfg["codex"]["home"])
    codex.mkdir(parents=True)
    (codex / "config.toml").write_text('[features]\nmulti_agent = true\n')
    s = run(cfg)
    assert s["done"] is True, s.get("refused")
    text = (Path(cfg["out"]) / "codex-config.toml").read_text()
    assert "[features]\nmulti_agent = true" in text
    cfg2, d2 = session("clash", base_url, ["[fx:done] Fix the parser."], home_rule="pack")
    codex2 = Path(cfg2["codex"]["home"])
    codex2.mkdir(parents=True)
    (codex2 / "config.toml").write_text('model = "gpt-5.5"\n')
    s2 = run(cfg2)
    assert s2["refused"].startswith("E_H2HX_CODEX_CONFIG") and "model" in s2["refused"], s2.get("refused")
    assert s2["slot"] is None and s2["turns"] == []


def test_home_rules_and_wrong_binary_refuse(base_url, log):
    cfg, d = session("homes", base_url, ["[fx:done] Fix the parser."])
    (Path(cfg["home"]) / ".codex/skills/x").mkdir(parents=True)
    s = run(cfg)
    assert s["refused"].startswith("E_H2H_SESSION_ARM") and "HOME .codex/skills" in s["refused"], s.get("refused")
    cfg2, d2 = session("gstackpack", base_url, ["[fx:done] Fix the parser."], home_rule="pack")
    (Path(cfg2["home"]) / ".codex/skills/gstack").mkdir(parents=True)
    s2 = run(cfg2)
    assert "GSTACK" in s2["refused"], s2.get("refused")
    cfg3, d3 = session("agents", base_url, ["[fx:done] Fix the parser."])
    (Path(cfg3["repo"]) / "AGENTS.md").write_text("x\n")
    s3 = run(cfg3)
    assert "INSTR ./AGENTS.md" in s3["refused"], s3.get("refused")
    cfg4, d4 = session("binary", base_url, ["[fx:done] Fix the parser."], codex={"version": "0.169.0"})
    s4 = run(cfg4)
    assert s4["refused"].startswith("E_H2HX_CODEX_RUNTIME"), s4.get("refused")


def test_pure_rules():
    text = "\n".join(json.dumps(x) for x in [
        {"type": "response_item", "payload": {"type": "function_call", "name": "request_user_input_async", "call_id": "a", "arguments": json.dumps({"questions": [{"question": "Q1?"}, {"header": "H2"}]})}},
        {"type": "response_item", "payload": {"type": "function_call", "name": "request_user_input", "call_id": "b", "arguments": "not json"}},
        {"type": "response_item", "payload": {"type": "function_call", "name": "exec_command", "call_id": "c", "arguments": "{}"}},
        {"type": "token_usage_record", "payload": {}}, {"type": "token_usage_record", "payload": {}}, "not an object",
    ]) + "\nnot json"
    assert rollout_questions(text) == [{"call_id": "a", "questions": ["Q1?", "H2"], "sync": False}, {"call_id": "b", "questions": ["(no question text)"], "sync": True}]
    assert model_responses(text) == 2
    t = merged_config("", "gpt-6.2-sol", "low", "http://p:1/s/openai")
    assert t.splitlines()[0] == 'model = "gpt-6.2-sol"' and 'base_url = "http://p:1/s/openai/v1"' in t
    for bad, key in (('model_reasoning_effort = "high"\n', "model_reasoning_effort"), ('[skills.bundled]\nenabled = true\n', "skills.bundled"), ('[analytics]\nother = 1\n', "analytics"), ("model = [", "not TOML"), ('web_search = "live"\n', "web_search")):
        try:
            merged_config(bad, "gpt-6.2-sol", "low", "http://p:1")
            raise AssertionError("no refusal for " + bad)
        except RuntimeError as e:
            assert str(e).startswith("E_H2HX_CODEX_CONFIG") and key in str(e), str(e)


def test_agent_dispatch():
    import types
    import h2h_agent
    d = Path(tempfile.mkdtemp(prefix="h2hx-agent-"))
    DIRS.append(d)
    seen = {}

    class Fake:
        def __init__(self, cfg, slots=None):
            seen.setdefault("made", []).append((type(self).__name__, cfg))

        async def run(self):
            return {}

        def finish(self, refused=None):
            return {"turns": [], "slot": None, "codex": {"thread_id": None}}

    class FakeCodex(Fake):
        pass

    class FakeClaude(Fake):
        pass

    task = d / "task.json"
    task.write_text(json.dumps({"repo_dir": "/work/repo", "commits": 1, "base_commit": "b" * 40}))
    codex_cfg = {"host": "codex", "turns": ["T"], "continuation": "c", "done_rule": BASE["done_rule"], "continuation_cap": 6, "limits": {"allowance_usd": 15, "wall_sec": 5400, "max_turns": 300}, "no_answer": "r", "env": {"GSTACK_TELEMETRY_SOURCE": "eval"}, "home": None, "home_rule": "none", "codex": {"bin": "/opt/h2h-runtimes/bin/sol-agent", "home": "/root/.codex", "model": "gpt-6.2-sol", "effort": "low", "version": "0.170.0"}}
    claude_cfg = {**{k: v for k, v in codex_cfg.items() if k not in ("host", "codex")}, "disallowed_tools": []}
    saved = (h2h_agent.CodexTurns, h2h_agent.Turns, h2h_agent.egress.apply, h2h_agent.subprocess.run)
    h2h_agent.CodexTurns, h2h_agent.Turns = FakeCodex, FakeClaude
    h2h_agent.egress.apply = lambda container, allow: {"egress": allow}
    h2h_agent.subprocess.run = lambda *a, **k: subprocess.CompletedProcess(a, 0, "", "")
    try:
        def agent(arm, cfg):
            p = d / (arm.replace(":", "_") + ".json")
            p.write_text(json.dumps(cfg))
            a = h2h_agent.H2hAgent.__new__(h2h_agent.H2hAgent)
            a.options = types.SimpleNamespace(task_json=str(task), h2h_config=str(p), ledger="u4", task_label="u/" + arm, trial_n=1, arm=arm, probe_node=None, rerun="", upstream_model="m", control_url="http://127.0.0.1:1")
            a._evaluator_dir = lambda: d / ("ev-" + arm.replace(":", "_"))
            a._resolve_auth_env = lambda: {"ANTHROPIC_BASE_URL": "http://127.0.0.1:2"}
            a._container_id = lambda env: "c1"
            a._check_image = lambda c, log: None
            a._resolved_model_name = lambda: "m"
            return a

        ctx = types.SimpleNamespace()
        asyncio.run(agent("h2h:s-gstack", codex_cfg).run("i", None, ctx))
        asyncio.run(agent("h2h:none", claude_cfg).run("i", None, types.SimpleNamespace()))
        try:
            asyncio.run(agent("h2h:s-none", claude_cfg).run("i", None, types.SimpleNamespace()))
            raise AssertionError("an s-* arm with a Claude config was not refused")
        except h2h_agent.SandboxSetupError as e:
            assert str(e).startswith("E_REAL_SANDBOX_SETUP arm h2h:s-none runs in Codex"), str(e)
        made = seen["made"]
        assert [m[0] for m in made] == ["FakeCodex", "FakeClaude"], made
        c = made[0][1]
        assert c["codex"] == codex_cfg["codex"] and c["container"] == "c1" and c["exec_prefix"] == ["docker", "exec", "-i", "-w", "/work/repo", "c1"] and "cli_path" not in c
        assert c["env"] == {"GSTACK_TELEMETRY_SOURCE": "eval"} and c["home"] == "/root" and c["commits"] == 1
        assert "cli_path" in made[1][1] and "codex" not in made[1][1]
        assert ctx.metadata["h2h"]["host"] == "codex"
    finally:
        h2h_agent.CodexTurns, h2h_agent.Turns, h2h_agent.egress.apply, h2h_agent.subprocess.run = saved


TESTS = [test_done_in_one_turn, test_continuations_to_the_cap, test_async_question_gets_the_reply_on_the_same_thread, test_sync_question_is_counted_unanswered, test_two_scripted_turns_resume_one_thread, test_ci_unset_and_env_reaches_tools, test_policy_failure_is_a_refusal, test_wall_limit_kills_codex, test_hooks_run_under_the_trust_bypass, test_pack_config_is_kept_and_a_clash_refuses_before_the_slot, test_home_rules_and_wrong_binary_refuse]


def main() -> int:
    failed = 0
    for t in (test_pure_rules, test_agent_dispatch):
        try:
            t()
            print("PASS " + t.__name__)
        except Exception:
            failed += 1
            print("FAIL " + t.__name__ + "\n" + traceback.format_exc())
    proc, base_url, log = stub()
    try:
        for t in TESTS:
            try:
                t(base_url, log)
                print("PASS " + t.__name__)
            except Exception:
                failed += 1
                print("FAIL " + t.__name__ + "\n" + traceback.format_exc())
    finally:
        proc.kill()
        for d in DIRS:
            shutil.rmtree(d, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
