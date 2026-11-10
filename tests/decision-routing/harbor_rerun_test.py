# Copyright (c) 2026 Garry Tan. MIT License.
"""dr_harbor's infrastructure rerun (prereg line 206), keyless: Harbor's modules are stubbed, the container is a temp dir
and the management socket is a fake, so DecisionRoutingAgent.run runs as Harbor calls it, attempt by attempt, with
Harbor's retry step (delete the trial dir, run a fresh trial) done by the test."""

import asyncio
import json
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path, PurePosixPath

AGENT = Path(__file__).resolve().parents[2] / "lanes" / "decision-routing" / "agent"


class _Paths:
    agent_dir = PurePosixPath("/logs/agent")
    artifacts_dir = PurePosixPath("/logs/artifacts")


class _MiniSweAgentOptions:
    pass


class _MiniSweAgent:
    def __init__(self, *args, logs_dir=None, **kwargs):
        self.logs_dir = logs_dir
        self.options = types.SimpleNamespace(markers_file=None, **kwargs)
        self.logger = types.SimpleNamespace(info=lambda *a, **k: None)

    async def exec_as_root(self, environment, command, env=None):
        return await environment.exec(command=command, env=env, user="root")


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod


for pkg in ("harbor", "harbor.agents", "harbor.agents.installed", "harbor.models", "harbor.models.agent", "harbor.models.trial", "harbor.environments"):
    _stub(pkg)
_stub("harbor.agents.installed.mini_swe_agent", MiniSweAgent=_MiniSweAgent, MiniSweAgentOptions=_MiniSweAgentOptions)
_stub("harbor.environments.base", BaseEnvironment=object)
_stub("harbor.models.agent.context", AgentContext=object)
_stub("harbor.models.trial.paths", EnvironmentPaths=_Paths)
sys.path.insert(0, str(AGENT))
import dr_harbor  # noqa: E402


class FakeEnv:
    """The container: /logs/agent is mounted at the trial's agent dir, every other path lives under root."""

    def __init__(self, logs_dir: Path, root: Path, exit_status: str):
        self.logs_dir, self.root, self.exit_status = logs_dir, root, exit_status

    def host(self, path) -> Path:
        p = PurePosixPath(str(path))
        if p.is_relative_to(_Paths.agent_dir):
            return self.logs_dir / p.relative_to(_Paths.agent_dir)
        return self.root / str(p).lstrip("/")

    def is_path_mounted(self, environment_path, host_path):
        return PurePosixPath(str(environment_path)) == _Paths.agent_dir and Path(host_path) == self.logs_dir

    async def download_dir(self, source_dir, target_dir):
        shutil.copytree(self.host(source_dir), target_dir)

    async def upload_file(self, source, target):
        self.host(target).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, self.host(target))

    async def exec(self, command, env=None, user=None, timeout_sec=None):
        self.commands = [*getattr(self, "commands", []), (command, user)]
        out = ""
        if "dr_agent.session" in command:
            summary = self.host(dr_harbor.DR_LOG_DIR / "dr-summary.json")
            summary.parent.mkdir(parents=True, exist_ok=True)
            summary.write_text(json.dumps({"exit_status": self.exit_status}))
        elif command.startswith("cat "):
            path = self.host(command[4:].strip())
            if not path.exists():
                return types.SimpleNamespace(return_code=1, stdout="")
            out = path.read_text()
        elif command.startswith("printf"):
            out = "/usr/bin:/bin"
        return types.SimpleNamespace(return_code=0, stdout=out)


class Rerun(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.trial = self.tmp / "job" / "task-1__abc"
        self.pin = self.tmp / "pin.json"
        self.pin.write_text("{}")
        self.binds = []
        self.bodies = []
        self.meters = []
        dr_harbor.os.environ["DR_PROXY_BASE"] = "http://127.0.0.1:9"

        def manage(route, body):
            if route == "/bind":
                self.binds.append(body["cell"]["attempt"])
                self.bodies.append(body)
                return {"slot": "s", "token": "tok", "meter_id": f"m{len(self.binds)}"}
            if route == "/finalize":
                return self.meters[len(self.binds) - 1]
            return {}

        dr_harbor.manage = manage

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def attempt(self, exit_status: str, ok_responses: int) -> BaseException | None:
        """One Harbor trial attempt: Harbor deletes the trial dir before a retry, then runs a fresh trial."""
        shutil.rmtree(self.trial, ignore_errors=True)
        logs = self.trial / "agent"
        logs.mkdir(parents=True)
        self.meters.append({"micros": 1_500_000, "upstream": {"statuses": {"200": ok_responses, "500": 3}}})
        agent = dr_harbor.DecisionRoutingAgent(cell="N", model="sol", runtime_tarball="/rt.tgz", runtime_sha256="ab", pin_file=str(self.pin), item="dr-pilot-rp", logs_dir=logs)
        env = FakeEnv(logs, self.tmp / f"container{len(self.meters)}", exit_status)
        try:
            asyncio.run(agent.run("fix it", env, None))
        except dr_harbor.DrInfraError as e:
            return e
        return None

    def kept(self) -> Path:
        return self.tmp / "job" / dr_harbor.INFRA_ATTEMPTS / "task-1__abc"

    def test_a_mid_session_provider_error_reruns_once_and_the_rerun_is_the_trial(self):
        self.assertIsInstance(self.attempt("infra_error", 4), dr_harbor.DrInfraError)
        record = json.loads((self.kept() / "attempt.json").read_text())
        self.assertEqual((record["attempt"], record["cell"], record["model"], record["exit_status"], record["successful_responses"], record["meter_id"], record["micros"]), (1, "N", "sol", "infra_error", 4, "m1", 1_500_000))
        self.assertTrue((self.kept() / "agent" / "dr" / "dr-summary.json").exists())
        self.assertFalse((self.kept() / "result.json").exists())
        self.assertIsNone(self.attempt("submitted", 9))
        self.assertEqual(self.binds, [1, 2])
        self.assertEqual(json.loads((self.trial / "agent" / "dr" / "dr-summary.json").read_text())["exit_status"], "submitted")

    def test_zero_responses_still_reruns(self):
        self.assertIsInstance(self.attempt("agent_error", 0), dr_harbor.DrInfraError)
        self.assertTrue((self.kept() / "attempt.json").exists())

    def test_a_model_caused_exit_is_not_rerun(self):
        for status in ("agent_error", "step_stop", "wall_stop", "submitted", "allowance_stop", "custody_hit"):
            with self.subTest(status=status):
                self.assertIsNone(self.attempt(status, 0 if status in dr_harbor.CLEAN_STOPS else 5))
                self.assertFalse(self.kept().exists())

    def test_a_second_infra_failure_raises_again_and_keeps_only_the_first_attempt(self):
        self.assertIsInstance(self.attempt("infra_error", 2), dr_harbor.DrInfraError)
        first = (self.kept() / "attempt.json").read_text()
        self.assertIsInstance(self.attempt("infra_error", 1), dr_harbor.DrInfraError)
        self.assertEqual(self.binds, [1, 2])
        self.assertEqual((self.kept() / "attempt.json").read_text(), first)
        self.assertEqual(json.loads((self.trial / "agent" / "dr" / "dr-summary.json").read_text())["exit_status"], "infra_error")

    def test_the_bind_names_the_cells_deciders_and_the_canary(self):
        logs = self.trial / "agent"
        logs.mkdir(parents=True)
        canary = "DRCANARY-" + "0123456789abcdef" * 2
        markers = self.tmp / "markers.json"
        markers.write_text(json.dumps([canary, "test_hidden_regression_case"]))
        self.meters.append({"micros": 0, "upstream": {"statuses": {"200": 1}}})
        agent = dr_harbor.DecisionRoutingAgent(cell="R", model="opus", runtime_tarball="/rt.tgz", runtime_sha256="ab", pin_file=str(self.pin), item="dr-pilot-rp", logs_dir=logs)
        agent._markers_file = str(markers)
        asyncio.run(agent.run("fix it", FakeEnv(logs, self.tmp / "container", "submitted"), None))
        body = self.bodies[0]
        self.assertEqual(body["models"], ["anthropic:claude-opus-5-5", "typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"])
        self.assertEqual(body["deciders"], ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"])
        self.assertEqual(body["canary"], canary)
        self.assertEqual(body["forbidden_markers"], [canary, "test_hidden_regression_case"])

    def test_only_calibration_n_sessions_log_shadow_data(self):
        logs = self.trial / "agent"
        logs.mkdir(parents=True)

        def shadow(cell, model, item):
            agent = dr_harbor.DecisionRoutingAgent(cell=cell, model=model, runtime_tarball="/rt.tgz", runtime_sha256="ab", pin_file=str(self.pin), item=item, logs_dir=logs)
            return agent.session_config("s").get("calibration_shadow")

        self.assertIs(shadow("N", "opus", "dr-calibration-r3"), True)
        self.assertIs(shadow("N", "sol", "dr-calibration-r3"), True)
        self.assertIs(shadow("N", "opus", "dr-calibration"), False)
        self.assertIs(shadow("N", "opus", "dr-calibration-r2"), False)
        self.assertIs(shadow("N", "opus", "dr-scored-opus"), False)
        self.assertIs(shadow("N", "sol", "dr-pilot-rp"), False)
        self.assertIs(shadow("R", "opus", "dr-calibration-r3"), False)

    def test_every_cell_runs_commands_as_the_agent_user(self):
        sys.path.insert(0, str(AGENT))
        from dr_agent.agent_user import AGENT_USER

        logs = self.trial / "agent"
        logs.mkdir(parents=True)
        self.meters.append({"micros": 1, "upstream": {"statuses": {"200": 1}}})
        cells = json.loads(dr_harbor.CELLS_FILE.read_text())["cells"]
        for cell in cells:
            agent = dr_harbor.DecisionRoutingAgent(cell=cell, model="opus", runtime_tarball="/rt.tgz", runtime_sha256="ab", pin_file=str(self.pin), item="dr-pilot-rp", logs_dir=logs)
            self.assertEqual(agent.session_config("s").get("agent_user"), AGENT_USER, cell)
        env = FakeEnv(logs, self.tmp / "container", "submitted")
        agent = dr_harbor.DecisionRoutingAgent(cell="N", model="opus", runtime_tarball="/rt.tgz", runtime_sha256="ab", pin_file=str(self.pin), item="dr-pilot-rp", logs_dir=logs)
        asyncio.run(agent.run("fix it", env, None))
        order = [c for c, _ in env.commands]
        session = next(i for i, c in enumerate(order) if "dr_agent.session" in c)
        setup = order.index("/opt/dr/venv/bin/python -I -m dr_agent.agent_user setup")
        restore = order.index("/opt/dr/venv/bin/python -I -m dr_agent.agent_user restore")
        export = next(i for i, c in enumerate(order) if "dr_agent.agent_user export" in c)
        self.assertLess(setup, session)
        self.assertLess(session, restore)
        self.assertLess(restore, export)
        self.assertTrue(all(u == "root" for _, u in env.commands))

    def test_harbor_retries_only_on_dr_infra_error_once(self):
        controller = (AGENT.parent / "host" / "controller.ts").read_text()
        self.assertIn('export const HARBOR_RETRY = { max_retries: 1, include_exceptions: ["DrInfraError"', controller)


if __name__ == "__main__":
    unittest.main(verbosity=2)
