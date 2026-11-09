# Copyright (c) 2026 Garry Tan. MIT License.
"""Session entry point: python -I -m dr_agent.session --config <json>.

Config fields: cell (N R P F J W), model (opus or sol), task_file, pin_file, questions_file, proxy_url_env (the
env var holding the proxy URL, default DR_PROXY_URL), log_dir, step_limit_actions (100), call_limit (100), wall_s
(2700), calibration_shadow (bool), cwd (default /testbed), agent_user (the user every command runs as; dr_harbor sets it to
dr_agent.agent_user's user, and without it commands run as the session's own user). The proxy token comes from DR_PROXY_TOKEN and the session
id from DR_SESSION; every DR_ variable is removed from the process env before mini starts, so the commands the agent
runs never see the token. The session stays root, so the token in its initial environment (/proc/<pid>/environ) is
readable only by root, while every command, the main model's and the deciders' alike, runs as agent_user: <python> -I -S
-c DROP <uid> <gid> <interpreter> <command> sets the groups, gid and uid and execs the interpreter, so nothing else
about the command changes (cwd, env, timeout, interpreter). The Tracker's git runs as the same user.

Every cell takes the agent, model and environment sections of mini's own swebench.yaml from the installed package and
sets only the model, its max_tokens, the limits and the cwd. Every main-model call asks for MAIN_MAX_TOKENS (32000), on
every model and in every cell: litellm's own default for claude-opus-5-5 is 128000, above the proxy's 32000 output cap,
which refuses it. Sol's main model runs on OpenAI's Responses API (litellm's openai/responses/ route), because OpenAI refuses
function tools on chat completions for gpt-6.1-sol at its default reasoning; there litellm sends the same setting as
max_output_tokens. Sol also asks for each reasoning item inline (include reasoning.encrypted_content, store false), so
the next turn replays its reasoning in the request body: litellm otherwise replays a reasoning item by id alone, which
the proxy reserves at the whole context window, more than a session's allowance holds. The environment section runs in a LocalEnvironment with its docker-only
keys dropped and the rest kept alike in every cell (cwd, timeout, env, and the interpreter, which LocalEnvironment
lacks, so each command runs as <interpreter> <command>). Writes decisions.jsonl, states/, snapshots/,
trajectory.json and dr-summary.json under log_dir.
"""
import argparse
import json
import os
import shlex
import sys
import time
from pathlib import Path

ROUTED = ("R", "P", "F", "J")
EXIT_MAP = {"Submitted": "submitted", "step_stop": "step_stop", "call_backstop": "call_backstop", "LimitsExceeded": "step_stop",
            "wall_stop": "wall_stop", "TimeExceeded": "wall_stop", "allowance_stop": "allowance_stop",
            "custody_hit": "custody_hit"}
DOCKER_ONLY = ("environment_class", "image", "executable", "run_args", "forward_env", "container_timeout", "pull_timeout")
INFRA_MODULES = ("litellm", "openai", "anthropic", "httpx", "httpcore", "typesafe_sdk")
MAIN_MAX_TOKENS = 32000
DROP = "import os,sys;u,g=int(sys.argv[1]),int(sys.argv[2]);os.setgroups([]);os.setgid(g);os.setuid(u);os.getuid()!=0 or sys.exit(126);os.execvp(sys.argv[3],sys.argv[3:])"
STOP_LINE_CODES = {"step_stop": "DR_STEP_STOP", "wall_stop": "DR_WALL_STOP", "allowance_stop": "DR_ALLOWANCE_STOP", "custody_hit": "DR_CUSTODY_HIT"}


def model_settings(cell, model, proxy, token):
    """model_name, api_base and the few settings this build sets on top of swebench.yaml's model section."""
    if cell == "W":
        return {"model_name": "openrouter/particle-ai/particle-1", "model_kwargs": {"api_base": proxy + "/openrouter/v1", "api_key": token, "max_tokens": MAIN_MAX_TOKENS}}
    if model == "opus":
        return {"model_name": "anthropic/claude-opus-5-5", "model_kwargs": {"api_base": proxy + "/anthropic", "api_key": token, "max_tokens": MAIN_MAX_TOKENS},
                "set_cache_control": "default_end"}
    if model == "sol":
        return {"model_name": "openai/responses/gpt-6.1-sol", "model_kwargs": {"api_base": proxy + "/openai/v1", "api_key": token, "max_tokens": MAIN_MAX_TOKENS,
                                                                           "store": False, "include": ["reasoning.encrypted_content"]}}
    raise ValueError(f"unknown model {model!r}")


def model_class():
    """mini's LitellmModel with one arm-neutral change: a DR_ALLOWANCE_STOP refusal aborts mini's retry loop.

    litellm 1.108.3 maps a 403 on the openai route to APIError, which mini's tenacity loop retries up to 10 times;
    only the anthropic route maps it to PermissionDeniedError, which mini aborts on.
    """
    from minisweagent.models.litellm_model import LitellmModel

    from dr_agent.counting import AllowanceStop, as_stop

    class DrLitellmModel(LitellmModel):
        abort_exceptions = [*LitellmModel.abort_exceptions, AllowanceStop]

        def _query(self, messages, **kwargs):
            try:
                return super()._query(messages, **kwargs)
            except Exception as e:
                stop = as_stop(e)
                if stop is None:
                    raise
                raise stop from e

    return DrLitellmModel


def agent_ids(cfg):
    """(uid, gid) of cfg's agent_user, or None without one. A missing or root user is refused (E_DR_RUNTIME)."""
    if not cfg.get("agent_user"):
        return None
    import pwd

    try:
        pw = pwd.getpwnam(cfg["agent_user"])
    except KeyError:
        raise SystemExit(f"E_DR_RUNTIME: no user {cfg['agent_user']!r} for the agent's commands; run python -I -m dr_agent.agent_user setup first")
    if pw.pw_uid == 0:
        raise SystemExit(f"E_DR_RUNTIME: the agent user {cfg['agent_user']!r} is uid 0")
    return pw.pw_uid, pw.pw_gid


def local_environment(section, cwd, run_as=None):
    """A LocalEnvironment from swebench.yaml's environment section: docker-only keys dropped, the rest kept, cwd set.
    With run_as (uid, gid), every command runs as that user through DROP."""
    from minisweagent.environments.local import LocalEnvironment, LocalEnvironmentConfig

    class Config(LocalEnvironmentConfig):
        interpreter: list[str] = []

    class Env(LocalEnvironment):
        def __init__(self, **kwargs):
            super().__init__(config_class=Config, **kwargs)

        def execute(self, action, cwd="", *, timeout=None):
            if self.config.interpreter:
                action = {**action, "command": shlex.join([*self.config.interpreter, action.get("command", "")])}
            if run_as:
                inner = action.get("command", "") if self.config.interpreter else shlex.join(["sh", "-c", action.get("command", "")])
                action = {**action, "command": shlex.join([sys.executable, "-I", "-S", "-c", DROP, *map(str, run_as)]) + " " + inner}
            return super().execute(action, cwd, timeout=timeout)

    return Env(**{**{k: v for k, v in section.items() if k not in DOCKER_ONLY}, "cwd": cwd})


def classify(agent, exc):
    from dr_agent.counting import stop_status

    last = agent.messages[-1] if agent and agent.messages else {}
    status = last.get("extra", {}).get("exit_status") if last.get("role") == "exit" else None
    stop = stop_status(exc)
    if stop:
        return stop
    if status in EXIT_MAP:
        return EXIT_MAP[status]
    if exc is not None and type(exc).__module__.split(".")[0] in INFRA_MODULES:
        return "infra_error"
    return "agent_error"


def main(argv=None):
    ap = argparse.ArgumentParser(prog="dr_agent.session")
    ap.add_argument("--config", required=True)
    args = ap.parse_args(argv)
    t0 = time.time()
    with open(args.config) as f:
        cfg = json.load(f)
    run_as = agent_ids(cfg)
    proxy = os.environ.get(cfg.get("proxy_url_env", "DR_PROXY_URL"), "").rstrip("/")
    token = os.environ.get("DR_PROXY_TOKEN", "")
    session_id = os.environ.get("DR_SESSION", "session")
    for key in [k for k in os.environ if k.startswith("DR_")]:
        del os.environ[key]
    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
    os.environ["MSWEA_COST_TRACKING"] = "ignore_errors"
    os.environ.setdefault("MSWEA_SILENT_STARTUP", "1")

    from dr_agent.deciders import Questions, make_deciders
    from dr_agent.log import DecisionLog
    from dr_agent import state
    from dr_agent.state import Tracker, sha256

    state.RUN_AS = run_as

    cell, model_key = cfg["cell"], cfg.get("model", "opus")
    log_dir = cfg["log_dir"]
    os.makedirs(log_dir, exist_ok=True)
    questions = Questions.load(cfg["questions_file"])
    pin, pin_sha = {}, None
    if cfg.get("pin_file") and os.path.exists(cfg["pin_file"]):
        with open(cfg["pin_file"], "rb") as f:
            raw = f.read()
        pin, pin_sha = json.loads(raw), sha256(raw)
    if cell in ROUTED and pin.get("questions_sha256") != questions.sha256:
        print(f"E_DR_PIN pin questions_sha256 {pin.get('questions_sha256')} does not match questions.json {questions.sha256}. "
              "Fix: rebuild the pin from this questions.json. Recovery: nothing ran. Side effects: none.", file=sys.stderr)
        return 2

    import yaml
    from minisweagent.config import builtin_config_dir
    from dr_agent.natural import NaturalAgent, ShadowLogger
    from dr_agent.routed import Router, RoutedAgent

    swebench = yaml.safe_load((Path(builtin_config_dir) / "benchmarks" / "swebench.yaml").read_text())
    agent_kw = {**swebench["agent"], "step_limit": 0, "cost_limit": 0, "wall_time_limit_seconds": int(cfg.get("wall_s", 2700)),
                "output_path": Path(log_dir) / "trajectory.json"}
    mcfg = dict(swebench["model"])
    ms = model_settings(cell, model_key, proxy, token)
    mcfg["model_kwargs"] = {**mcfg.get("model_kwargs", {}), **ms.pop("model_kwargs")}
    mcfg.update(ms, cost_tracking="ignore_errors")
    model = model_class()(**mcfg)
    cwd = cfg.get("cwd", "/testbed")
    env = local_environment(swebench["environment"], cwd, run_as)
    with open(cfg["task_file"]) as f:
        task = f.read()
    tracker = Tracker(cwd, task)
    dlog = DecisionLog(log_dir, session_id, cell, model_key, t0)
    limits = {"action_limit": int(cfg.get("step_limit_actions", 100)), "call_limit": int(cfg.get("call_limit", 100))}
    if cell in ROUTED:
        jev, particle, frontier = make_deciders(cell, model_key, proxy, token, pin)
        agent = RoutedAgent(model, env, router=Router(cell, pin, questions, jev, particle, frontier), dlog=dlog, tracker=tracker, **limits, **agent_kw)
    else:
        shadow = ShadowLogger(dlog, tracker) if cfg.get("calibration_shadow") else None
        agent = NaturalAgent(model, env, shadow=shadow, **limits, **agent_kw)

    exc = None
    try:
        agent.run(task)
    except Exception as e:
        exc = e
    status = classify(agent, exc)
    mains = [m for m in agent.messages if m.get("role") == "assistant" and not m.get("extra", {}).get("dr_controller")]
    end = time.time()
    summary = {
        "v": 1, "session": session_id, "cell": cell, "model": model_key, "exit_status": status,
        "executed_actions": agent.executed_actions, "main_calls": agent.n_calls, "main_responses": len(mains),
        "backstop_hit": agent.backstop_hit,
        "decider_actions": getattr(agent, "decider_actions", 0), "submits": getattr(agent, "submits", 1 if status == "submitted" else 0),
        "submits_blocked": getattr(agent, "submits_blocked", 0), "guards": getattr(agent, "guards", {"max3": 0, "repeat": 0, "rerun_no_change": 0}),
        "blocked_commands": getattr(agent, "blocked_commands", 0), "decisions_by_type": dlog.by_type,
        "state_over_limit": dlog.state_over_limit, "decider_failures": dlog.decider_failures,
        "first_call_ts": mains[0].get("extra", {}).get("timestamp") if mains else None, "end_ts": end,
        "session_ms": int((end - t0) * 1000), "questions_sha256": questions.sha256, "pin_sha256": pin_sha,
        "error": f"{type(exc).__name__}: {str(exc)[:300]}" if exc is not None and status in ("infra_error", "agent_error") else None,
    }
    with open(os.path.join(log_dir, "dr-summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    agent.save(Path(log_dir) / "trajectory.json")
    if status in STOP_LINE_CODES:
        print(f"{STOP_LINE_CODES[status]}: session {session_id} ({cell}, {model_key}) ended as {status} after {agent.executed_actions} "
              f"executed actions and {agent.n_calls} main-model calls; the verifier grades the patch in {cwd} as it stands.", file=sys.stderr)
    print(f"dr_agent.session {session_id} {cell} {status} actions={agent.executed_actions} calls={agent.n_calls}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
