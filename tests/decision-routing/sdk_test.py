# Copyright (c) 2026 Garry Tan. MIT License.
"""B9: the real pinned SDKs from the runtime venv against the stub proxy (stubs/stub_proxy.py). Keyless.

Run it with the runtime venv's own interpreter, which agent-sdk.test.ts does:
  <venv>/bin/python -I tests/decision-routing/sdk_test.py
It checks, at the pins in lanes/decision-routing/agent/runtime/requirements.lock:
- a decider action (a TypeSafe call, then a synthetic assistant tool call that the agent runs) followed by an
  Anthropic main-model call through litellm succeeds, and the next turn reads the cache (cache_read above 0), with
  set_cache_control as mini's get_model sets it for Anthropic models under the swebench.yaml config;
- swebench.yaml asks for parallel tool calls, and its environment section (docker keys dropped) runs every command
  through bash -c with its env, the way the session builds its LocalEnvironment (ruling 2);
- the arm-neutral counter: one reply with 3 tool calls is 3 executed actions and 1 main call, and actions past the
  limit in one reply never run;
- dr_agent.session end to end: a DR_ALLOWANCE_STOP on any route (litellm anthropic, openai and openrouter main
  models, the OpenAI SDK decider on OpenRouter, the typesafe-sdk decider) ends the session as allowance_stop after
  exactly one request to that route, and a DR_CUSTODY_HIT ends it as custody_hit;
- the stub cases point BASH_ENV at an empty file: on a host where /root/.bashrc is unreadable bash prints an error line
  first, and mini then misses the submit marker on the output's first line (the task containers run as root);
- typesafe-sdk compresses its body with zstd only when a zstd module imports; the lock pins none, so the stub records the
  encoding the pinned venv sends and the test prints it;
- mini's step_limit counts model calls, so one reply with several tool calls runs them all inside step_limit 1;
- step_limit 0 and cost_limit 0 are off, and an unpriced model passes only under cost tracking ignore_errors;
- a 403 DR_ALLOWANCE_STOP surfaces with its code in the exception text through litellm (anthropic and openai
  providers), the OpenAI SDK against the OpenRouter route, and typesafe-sdk, and no SDK retries it (one stub hit
  each), while a 500 is retried (two hits), so the hit counter can see a retry. mini aborts on litellm's anthropic
  mapping (PermissionDeniedError) but retries litellm's openai mapping (APIError), so the session layer must stop
  on the code itself.
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

import litellm
import minisweagent
import openai
import typesafe_sdk
import yaml
from minisweagent.agents.default import DefaultAgent
from minisweagent.models import get_model
from minisweagent.models.litellm_model import LitellmModel

HERE = Path(__file__).resolve().parent
STUB_BEARER = "gse_stub_session_token_0123456789"
SWEBENCH = Path(minisweagent.__file__).parent / "config/benchmarks/swebench.yaml"
SUBMIT = "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"
AGENT = HERE.parents[1] / "lanes/decision-routing/agent"
QUESTIONS = AGENT / "dr_agent/questions.json"
sys.path.insert(0, str(AGENT))

from dr_agent.deciders import Questions  # noqa: E402
from dr_agent.natural import NaturalAgent  # noqa: E402
from dr_agent.session import local_environment, model_class  # noqa: E402


def zstd_importable() -> bool:
    for name in ("compression.zstd", "backports.zstd", "zstandard"):
        try:
            if importlib.util.find_spec(name):
                return True
        except ModuleNotFoundError:
            continue
    return False


def bash(*commands: str) -> dict:
    return {"kind": "tool_calls", "calls": [{"name": "bash", "arguments": {"command": c}} for c in commands]}


class StubCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        port_file = Path(cls.tmp.name) / "port"
        cls.server = subprocess.Popen(
            [sys.executable, "-I", str(HERE / "stubs/stub_proxy.py"), "--token", STUB_BEARER, "--port-file", str(port_file)],
            stdout=subprocess.DEVNULL,
        )
        for _ in range(100):
            if port_file.exists():
                break
            time.sleep(0.05)
        cls.url = f"http://127.0.0.1:{port_file.read_text()}"
        cls.config = yaml.safe_load(SWEBENCH.read_text())
        bashrc = Path(cls.tmp.name) / "bashrc"
        bashrc.write_text("")
        cls.config["environment"]["env"] = {**cls.config["environment"]["env"], "BASH_ENV": str(bashrc)}

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.terminate()
        cls.server.wait()
        cls.tmp.cleanup()

    def setUp(self) -> None:
        self.control("/_stub/reset", {})
        self.workdir = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.workdir.cleanup()

    def control(self, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode()
        with urllib.request.urlopen(urllib.request.Request(self.url + path, data=data, method="POST" if data else "GET")) as r:
            return json.load(r)

    def script(self, provider: str, *replies: dict) -> None:
        self.control("/_stub/script", {"provider": provider, "replies": list(replies)})

    def hits(self, provider: str) -> list[dict]:
        return [h for h in self.control("/_stub/hits")["hits"] if h["provider"] == provider]

    def model(self, name: str, base: str, **extra) -> LitellmModel:
        model_config = dict(self.config["model"])
        model_config["model_kwargs"] = {**model_config.get("model_kwargs", {}), "api_base": self.url + base, "api_key": STUB_BEARER}
        model_config.pop("model_name", None)
        model_config.update(extra)
        return get_model(name, model_config)

    def agent(self, model, agent_class=DefaultAgent, **limits) -> DefaultAgent:
        agent_config = {**self.config["agent"], "step_limit": 0, "cost_limit": 0, **limits}
        return agent_class(model, local_environment(self.config["environment"], self.workdir.name), **agent_config)

    def anthropic(self, **extra) -> LitellmModel:
        return self.model("anthropic/claude-opus-5-5", "/anthropic", cost_tracking="ignore_errors", **extra)


class CacheAfterDeciderAction(StubCase):
    def test_decider_action_then_anthropic_call_reads_the_cache(self) -> None:
        url = self.url
        self.script("anthropic", bash("echo first"), bash(SUBMIT))
        self.script("typesafe", {"kind": "answers", "answers": {"next_step": {"type": "choice", "choice": "run_tests", "confidence": 0.97, "probabilities": {"run_tests": 0.97, "submit": 0.03}}}})

        class DeciderAgent(DefaultAgent):
            decided = False

            def step(self):
                if self.n_calls == 1 and not self.decided:
                    self.decided = True
                    client = typesafe_sdk.TypeSafeClient(api_key=STUB_BEARER, base_url=url + "/typesafe", model="jev-1.13.0")
                    answer = client.system_one(
                        "the state",
                        {"next_step": {"type": "choice", "criteria": {"run_tests": "run the tests", "submit": "submit"}}},
                    )
                    command = f"echo decided {answer.answers['next_step'].choice}"
                    synthetic = {
                        "role": "assistant",
                        "content": "Running the next step the decision layer chose.",
                        "tool_calls": [{"id": "toolu_dr_0001", "type": "function", "function": {"name": "bash", "arguments": json.dumps({"command": command})}}],
                        "extra": {"actions": [{"command": command, "tool_call_id": "toolu_dr_0001"}]},
                    }
                    self.add_messages(synthetic)
                    return self.execute_actions(synthetic)
                return super().step()

        model = self.anthropic()
        self.assertEqual(model.config.set_cache_control, "default_end")
        self.assertNotIn("set_cache_control", self.config["model"])
        agent = self.agent(model, DeciderAgent)
        result = agent.run("Fix the bug.")
        self.assertEqual(result["exit_status"], "Submitted")
        main = self.hits("anthropic")
        self.assertEqual([h["status"] for h in main], [200, 200])
        self.assertEqual(len(self.hits("typesafe")), 1)
        self.assertEqual(main[0]["usage"]["cache_read_input_tokens"], 0)
        self.assertGreater(main[0]["usage"]["cache_creation_input_tokens"], 0)
        self.assertGreater(main[1]["usage"]["cache_read_input_tokens"], 0)
        self.assertTrue(any("decided run_tests" in str(m.get("content")) for m in agent.messages))
        usage = [m for m in agent.messages if "response" in m.get("extra", {})][-1]["extra"]["response"]["usage"]
        self.assertGreater(usage["prompt_tokens_details"]["cached_tokens"], 0)

    def test_stub_refuses_a_tool_use_without_its_result(self) -> None:
        self.script("anthropic", bash("echo first"))
        model = self.anthropic()
        messages = [
            {"role": "system", "content": "s"},
            {"role": "user", "content": "u"},
            {"role": "assistant", "content": "a", "tool_calls": [{"id": "toolu_x", "type": "function", "function": {"name": "bash", "arguments": "{}"}}]},
            {"role": "user", "content": "no tool result here"},
        ]
        with self.assertRaises(litellm.exceptions.BadRequestError):
            model._query(model._prepare_messages_for_api(messages))


class StepAndCostLimits(StubCase):
    def test_step_limit_counts_model_calls_not_actions(self) -> None:
        self.script("anthropic", bash("echo a", "echo b", "echo c"), bash("echo d"))
        agent = self.agent(self.anthropic(), step_limit=1)
        result = agent.run("Look around.")
        self.assertEqual(result["exit_status"], "LimitsExceeded")
        self.assertEqual(agent.n_calls, 1)
        self.assertEqual(len(self.hits("anthropic")), 1)
        observations = [m for m in agent.messages if m.get("role") == "tool"]
        self.assertEqual(len(observations), 3)

    def test_zero_limits_are_off_with_cost_tracking_ignored(self) -> None:
        self.script("openai", bash("echo a"), bash("echo b"), bash("echo c"))
        model = self.model("openai/dr-unpriced-model", "/openai/v1", cost_tracking="ignore_errors")
        agent = self.agent(model)
        result = agent.run("Work.")
        self.assertEqual(result["exit_status"], "Submitted")
        self.assertEqual(agent.n_calls, 4)
        self.assertEqual(agent.cost, 0)

    def test_unpriced_model_raises_without_ignore_errors(self) -> None:
        self.script("openai", bash("echo a"))
        model = self.model("openai/dr-unpriced-model", "/openai/v1", cost_tracking="default")
        with self.assertRaisesRegex(RuntimeError, "Error calculating cost"):
            self.agent(model).run("Work.")

    def test_cost_tracking_env_reaches_the_model_config(self) -> None:
        probe = "from minisweagent.models.litellm_model import LitellmModelConfig as C; print(C(model_name='x').cost_tracking)"
        env = {"PATH": os.environ.get("PATH", ""), "HOME": tempfile.gettempdir(), "MSWEA_COST_TRACKING": "ignore_errors"}
        out = subprocess.run([sys.executable, "-I", "-c", probe], env=env, capture_output=True, text=True, check=True)
        self.assertEqual(out.stdout.strip().splitlines()[-1], "ignore_errors")


class AllowanceStop(StubCase):
    def assert_one_refusal(self, provider: str, error: BaseException) -> None:
        self.assertIn("DR_ALLOWANCE_STOP", str(error))
        self.assertEqual([h["status"] for h in self.hits(provider)], [403])

    def test_litellm_anthropic_inside_mini(self) -> None:
        self.script("anthropic", {"kind": "stop"})
        agent = self.agent(self.anthropic())
        with self.assertRaises(litellm.exceptions.PermissionDeniedError) as caught:
            agent.run("Work.")
        self.assert_one_refusal("anthropic", caught.exception)

    def test_litellm_openai_maps_the_403_to_a_retried_api_error(self) -> None:
        """At litellm 1.108.3 the openai provider has no 403 branch: the stop arrives as APIError, which is not in
        mini's abort_exceptions, so raw mini retries it (MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT times, 10 by default).
        litellm itself sends once per attempt. dr_agent must end the session on the code; the session test checks it."""
        self.script("openai", {"kind": "stop"})
        model = self.model("openai/gpt-6.1-sol", "/openai/v1", cost_tracking="ignore_errors")
        with self.assertRaises(litellm.exceptions.APIError) as caught:
            litellm.completion(
                model="openai/gpt-6.1-sol", messages=[{"role": "user", "content": "q"}], api_base=self.url + "/openai/v1", api_key=STUB_BEARER
            )
        self.assertNotIsInstance(caught.exception, litellm.exceptions.PermissionDeniedError)
        self.assert_one_refusal("openai", caught.exception)
        os.environ["MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT"] = "2"
        try:
            with self.assertRaises(litellm.exceptions.APIError) as caught:
                self.agent(model).run("Work.")
        finally:
            del os.environ["MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT"]
        self.assertIn("DR_ALLOWANCE_STOP", str(caught.exception))
        self.assertEqual([h["status"] for h in self.hits("openai")], [403, 403, 403])

    def test_openai_sdk_on_the_openrouter_route(self) -> None:
        self.script("openrouter", {"kind": "stop"})
        client = openai.OpenAI(api_key=STUB_BEARER, base_url=self.url + "/openrouter/v1")
        with self.assertRaises(openai.PermissionDeniedError) as caught:
            client.chat.completions.create(model="particle-ai/particle-1", messages=[{"role": "user", "content": "q"}], max_tokens=8000)
        self.assert_one_refusal("openrouter", caught.exception)

    def test_typesafe_sdk(self) -> None:
        self.script("typesafe", {"kind": "stop"})
        client = typesafe_sdk.TypeSafeClient(api_key=STUB_BEARER, base_url=self.url + "/typesafe", model="jev-1.13.0")
        with self.assertRaises(typesafe_sdk.TypeSafePermissionDeniedError) as caught:
            client.system_one("state", {"safe": {"type": "noul", "instructions": "Is it safe?"}})
        self.assert_one_refusal("typesafe", caught.exception)

    def test_typesafe_body_encoding_follows_zstd_availability(self) -> None:
        self.script("typesafe", {"kind": "answers", "answers": {"next_step": {"type": "choice", "choice": "submit", "confidence": 0.9, "probabilities": {"run_tests": 0.1, "submit": 0.9}}}})
        client = typesafe_sdk.TypeSafeClient(api_key=STUB_BEARER, base_url=self.url + "/typesafe", model="jev-1.13.0")
        client.system_one("state", {"next_step": {"type": "choice", "criteria": {"run_tests": "run the tests", "submit": "submit"}}})
        [hit] = self.hits("typesafe")
        print(f"\ntypesafe-sdk request encoding: {hit['encoding'] or 'identity'}", file=sys.stderr)
        self.assertEqual(hit["status"], 200)
        self.assertEqual(hit["encoding"], "zstd" if zstd_importable() else None)

    def test_a_500_is_retried_so_the_counter_sees_retries(self) -> None:
        self.script("openrouter", {"kind": "status", "status": 500})
        self.script("typesafe", {"kind": "status", "status": 500})
        client = openai.OpenAI(api_key=STUB_BEARER, base_url=self.url + "/openrouter/v1", max_retries=1)
        client.chat.completions.create(model="particle-ai/particle-1", messages=[{"role": "user", "content": "q"}])
        self.assertEqual([h["status"] for h in self.hits("openrouter")], [500, 200])
        ts = typesafe_sdk.TypeSafeClient(api_key=STUB_BEARER, base_url=self.url + "/typesafe", model="jev-1.13.0")
        ts.system_one("state", {"safe": {"type": "noul", "instructions": "Is it safe?"}})
        self.assertEqual([h["status"] for h in self.hits("typesafe")], [500, 200])


class RulingTwoEnvironment(unittest.TestCase):
    def test_parallel_tool_calls_and_the_local_environment(self) -> None:
        config = yaml.safe_load(SWEBENCH.read_text())
        self.assertIs(config["model"]["model_kwargs"]["parallel_tool_calls"], True)
        section = config["environment"]
        self.assertEqual(section["environment_class"], "docker")
        with tempfile.TemporaryDirectory() as tmp:
            env = local_environment(section, tmp)
            self.assertEqual(env.config.model_dump(), {"cwd": tmp, "env": section["env"], "timeout": 60, "interpreter": ["bash", "-c"]})
            out = env.execute({"command": '[[ -n $BASH_VERSION ]] && echo "bash $PAGER $TQDM_DISABLE $BASH_ENV $(pwd)"'})
        self.assertEqual(out["returncode"], 0, out)
        self.assertEqual(out["output"].strip().splitlines()[-1], f"bash cat 1 /root/.bashrc {tmp}")


class ActionCounter(StubCase):
    def dr_model(self):
        mcfg = dict(self.config["model"])
        mcfg["model_kwargs"] = {**mcfg["model_kwargs"], "api_base": self.url + "/anthropic", "api_key": STUB_BEARER}
        mcfg.update(model_name="anthropic/claude-opus-5-5", set_cache_control="default_end", cost_tracking="ignore_errors")
        return model_class()(**mcfg)

    def test_one_reply_with_three_tool_calls_is_three_actions_and_one_call(self) -> None:
        self.script("anthropic", bash("echo a", "echo b", "echo c"))
        agent = self.agent(self.dr_model(), NaturalAgent, call_limit=1)
        result = agent.run("Look around.")
        self.assertEqual(result["exit_status"], "call_backstop")
        self.assertEqual((agent.executed_actions, agent.n_calls, agent.backstop_hit), (3, 1, True))
        self.assertEqual(len([m for m in agent.messages if m.get("role") == "tool"]), 3)
        self.assertEqual(len(self.hits("anthropic")), 1)

    def test_actions_past_the_limit_in_one_reply_never_run(self) -> None:
        self.script("anthropic", bash("echo a > a.txt", "echo b > b.txt", "echo c > c.txt"))
        agent = self.agent(self.dr_model(), NaturalAgent, action_limit=2)
        result = agent.run("Look around.")
        self.assertEqual(result["exit_status"], "step_stop")
        self.assertEqual((agent.executed_actions, agent.n_calls), (2, 1))
        self.assertEqual(sorted(p.name for p in Path(self.workdir.name).iterdir()), ["a.txt", "b.txt"])


class SessionStops(StubCase):
    """dr_agent.session in a subprocess, launched the way the container launches it."""

    def session(self, cell: str, model: str) -> dict:
        tmp = Path(self.workdir.name) / f"{cell}-{model}"
        repo = tmp / "repo"
        repo.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        (tmp / "task.md").write_text("Fix the bug.")
        pin = {
            "v": 1, "questions_sha256": Questions.load(str(QUESTIONS)).sha256, "mapping_sha256": "m", "safety_rule_sha256": "s", "particle_max_tokens": 8000,
            "jev": {"next_step": {"edge": 0.9}, "tests_passed": {"edge": 0.9}, "done": {"edge": None}, "safe": {"block_edge": 0.95, "allow_edge": 0.9}, "relevant": {"drop_edge": 0.9}},
            "particle_guess": {"next_step": {"edge": 0.8}, "relevant": {"drop_edge": 0.95}},
            "particle_noguess": {"next_step": {"edge": 0.6}, "relevant": {"drop_edge": 0.95}},
            "j_fixed": {"choice": 0.9, "noul_yes": 0.9, "noul_no": 0.1, "relevant_drop_p": 0.1}, "ece": {}, "n_labelled": {},
        }
        (tmp / "pin.json").write_text(json.dumps(pin))
        config = {"cell": cell, "model": model, "task_file": str(tmp / "task.md"), "pin_file": str(tmp / "pin.json"), "questions_file": str(QUESTIONS),
                  "log_dir": str(tmp / "logs"), "cwd": str(repo)}
        (tmp / "session.json").write_text(json.dumps(config))
        env = {"PATH": os.environ.get("PATH", ""), "HOME": str(tmp), "DR_PROXY_URL": self.url, "DR_PROXY_TOKEN": STUB_BEARER, "DR_SESSION": f"s-{cell}-{model}",
               "MSWEA_COST_TRACKING": "ignore_errors", "LITELLM_LOCAL_MODEL_COST_MAP": "True"}
        boot = f"import sys; sys.path.insert(0, {str(AGENT)!r}); from dr_agent.session import main; sys.exit(main())"
        out = subprocess.run([sys.executable, "-I", "-c", boot, "--config", str(tmp / "session.json")], env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stdout[-2000:] + out.stderr[-2000:])
        return json.loads((tmp / "logs/dr-summary.json").read_text())

    def stops(self, kind: str, expected: str, routes) -> None:
        for cell, model, provider in routes:
            with self.subTest(cell=cell, provider=provider):
                self.control("/_stub/reset", {})
                if provider != "anthropic" and model == "opus":
                    self.script("anthropic", bash("ls"), bash("git status"), bash("ls -a"))
                self.script(provider, {"kind": kind})
                summary = self.session(cell, model)
                self.assertEqual(summary["exit_status"], expected, summary)
                self.assertEqual([h["status"] for h in self.hits(provider)], [403])
                if provider != "anthropic" and model == "opus":
                    self.assertEqual([h["status"] for h in self.hits("anthropic")], [200])
                if provider == "typesafe":
                    self.assertEqual(self.hits(provider)[0]["encoding"], "zstd" if zstd_importable() else None)

    def test_allowance_stop_ends_the_session_after_one_request_per_route(self) -> None:
        self.stops("stop", "allowance_stop", [("N", "opus", "anthropic"), ("N", "sol", "openai"), ("W", "particle", "openrouter"), ("P", "opus", "openrouter"), ("J", "opus", "typesafe")])

    def test_every_main_model_call_asks_for_32000_output_tokens(self) -> None:
        for model, provider, field in (("opus", "anthropic", "max_tokens"), ("sol", "openai", "max_completion_tokens")):
            with self.subTest(model=model):
                self.control("/_stub/reset", {})
                self.script(provider, bash("ls"), bash(SUBMIT))
                summary = self.session("N", model)
                self.assertEqual(summary["exit_status"], "submitted", summary)
                self.assertEqual([h[field] for h in self.hits(provider)], [32000, 32000])

    def test_litellm_default_for_opus_is_128000(self) -> None:
        self.anthropic().query([{"role": "user", "content": "hi"}])
        self.assertEqual([h["max_tokens"] for h in self.hits("anthropic")], [128000])

    def test_custody_hit_ends_the_session_as_custody_hit(self) -> None:
        self.stops("custody", "custody_hit", [("N", "opus", "anthropic"), ("N", "sol", "openai"), ("J", "opus", "typesafe")])


if __name__ == "__main__":
    unittest.main(verbosity=2)
