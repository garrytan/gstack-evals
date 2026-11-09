# Copyright (c) 2026 Garry Tan. MIT License.
"""The decision-routing Harbor agent: one session of one cell in one task container.

Harbor loads it by import path (dr_harbor:DecisionRoutingAgent) in the runner host's Harbor process. It subclasses
Harbor's installed MiniSweAgent and replaces install and run. It declares its own name and options model, so Harbor checks
the controller's kwargs against DecisionRoutingOptions, before it queues a trial and again when it builds the agent,
rather than against mini-swe-agent's schema:

- install copies the prebuilt runtime tarball (build.sh) into the container and unpacks it at /opt/dr. The container
  needs no network. The tarball's sha256 must equal the runtime_sha256 kwarg, checked on the host and in the container.
- run binds a metering-proxy slot over the evaluator-side management socket (DR_MGMT_SOCKET, DR_MGMT_TOKEN in Harbor's
  own env; the session's proxy URL is DR_PROXY_BASE/<slot>), runs dr_agent.session under env -i with only DR_* values and the slot's bearer, then unbinds and finalizes
  the slot, writes the meter to /logs/agent/dr/meter.json, exports the patch to /logs/artifacts/model.patch, and raises
  DrInfraError when the session failed on infrastructure (prereg line 206): exit_status infra_error, which session.classify
  gives only to provider and transport exceptions, or no successful model response at all. An allowance stop or custody
  hit never counts. Harbor reruns the trial once, from scratch, on DrInfraError (retry.include_exceptions) and deletes the
  trial dir first, so run copies the first attempt's agent logs to <job>/dr-infra-attempts/<trial>/ with attempt.json.
  That copy has no result.json and is never scored; its booked spend stays on the item's lease. The rerun binds as
  attempt 2, and a rerun that fails the same way ends missing.

The bearer reaches the container only through the exec's env and is never written to a file, a command line or a log.
"""

import asyncio
import hashlib
import http.client
import json
import os
import shlex
import shutil
import socket
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, override

from harbor.agents.installed.mini_swe_agent import MiniSweAgent, MiniSweAgentOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths

CELLS_FILE = Path(__file__).resolve().parent.parent / "config/cells.json"
RUNTIME_ROOT = PurePosixPath("/opt/dr")
RUNTIME_PYTHON = RUNTIME_ROOT / "venv/bin/python"
RUN_DIR = RUNTIME_ROOT / "run"
QUESTIONS_FILE = RUNTIME_ROOT / "src/dr_agent/questions.json"
CALL_BACKSTOP = 100
DR_LOG_DIR = EnvironmentPaths.agent_dir / "dr"
PATCH_PATH = EnvironmentPaths.artifacts_dir / "model.patch"
UPLOAD_PATH = "/tmp/dr-runtime.tar.gz"
MANAGEMENT_HEADER = "x-gstack-evals-management"
MANAGEMENT_TIMEOUT_SEC = 120
WALL_GRACE_SEC = 300
CLEAN_STOPS = ("allowance_stop", "custody_hit")
INFRA_ATTEMPTS = "dr-infra-attempts"
CALIBRATION_ITEM = "dr-calibration"
EXPORT_PATCH = (
    f"mkdir -p {EnvironmentPaths.artifacts_dir} && cd /testbed && git add -A && "
    f"git -c core.fileMode=false diff --cached --binary HEAD > {PATCH_PATH}"
)


class DrInfraError(RuntimeError):
    """The session failed on infrastructure (a provider or transport error, or no model response); Harbor reruns it once."""


class DrRuntimeError(RuntimeError):
    """The runtime tarball is missing or does not match its pinned sha256 (E_DR_RUNTIME); never rerun."""


class DrManagementError(RuntimeError):
    """The metering proxy's management socket refused or failed a bind, unbind or finalize; never rerun."""


class _UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float):
        super().__init__("localhost", timeout=timeout)
        self._socket_path = path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self._socket_path)
        self.sock = sock


def manage(route: str, body: dict[str, Any]) -> dict[str, Any]:
    """POST one management request to the metering proxy and return its JSON answer."""
    socket_path, token = os.environ.get("DR_MGMT_SOCKET"), os.environ.get("DR_MGMT_TOKEN")
    if not socket_path or not token:
        raise DrManagementError("DR_MGMT_SOCKET and DR_MGMT_TOKEN must be set in the Harbor process")
    conn = _UnixHTTPConnection(socket_path, MANAGEMENT_TIMEOUT_SEC)
    try:
        conn.request("POST", route, json.dumps(body), {"content-type": "application/json", MANAGEMENT_HEADER: token})
        res = conn.getresponse()
        raw = res.read()
    finally:
        conn.close()
    try:
        answer = json.loads(raw)
    except ValueError:
        answer = {}
    if res.status != 200:
        raise DrManagementError(answer.get("detail") or f"management {route}: HTTP {res.status}")
    return answer


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def successful_responses(meter: dict[str, Any]) -> int:
    statuses = (meter.get("upstream") or {}).get("statuses") or {}
    return sum(n for status, n in statuses.items() if str(status).startswith("2"))


def infra_failure(summary: dict[str, Any], meter: dict[str, Any]) -> bool:
    """True when Harbor should rerun the trial: a provider or transport error (exit_status infra_error), or no successful
    model response. An allowance stop and a custody hit end the session cleanly, and a model-caused exit (agent_error from
    format errors, step_stop, wall_stop, submitted) after a response is the model's outcome; none of them is rerun."""
    status = summary.get("exit_status")
    return status not in CLEAN_STOPS and (status == "infra_error" or successful_responses(meter) == 0)


def attempt_dir(trial_dir: Path) -> Path:
    return trial_dir.parent / INFRA_ATTEMPTS / trial_dir.name


class DecisionRoutingOptions(MiniSweAgentOptions):
    """Exactly the kwargs the controller's Harbor job writes: cell, model, runtime_tarball, runtime_sha256, pin_file,
    item and, with custody on, markers_file (a JSON list of the session's runner-only markers, sent to the proxy's bind
    as forbidden_markers). Harbor refuses any other kwarg."""

    cell: str
    model: str
    runtime_tarball: str
    runtime_sha256: str
    pin_file: str
    item: str
    markers_file: str | None = None


class DecisionRoutingAgent(MiniSweAgent):
    """Takes the kwargs in DecisionRoutingOptions. The slot's allowlist, wall limit and allowance come from
    config/cells.json."""

    options_model = DecisionRoutingOptions

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        o = self.options
        cells = json.loads(CELLS_FILE.read_text())
        if o.cell not in cells["cells"] or o.model not in cells["models"]:
            raise ValueError(f"E_USAGE: no cell {o.cell!r} or model {o.model!r} in {CELLS_FILE}")
        self._cell = o.cell
        self._model = o.model
        self._item = o.item
        self._main = cells["models"][o.model]
        self._allow = [self._main["allow"], *cells["cells"][o.cell]["deciders"]]
        self._limits = cells["limits"]
        self._runtime_tarball = Path(o.runtime_tarball)
        self._runtime_sha256 = o.runtime_sha256
        self._pin_file = Path(o.pin_file)
        self._markers_file = o.markers_file
        self._meter: dict[str, Any] | None = None

    @staticmethod
    @override
    def name() -> str:
        return "decision-routing"

    @classmethod
    @override
    def check_model_credentials(cls, connection, *, kwargs, env, explicit_env=None):
        """Provider keys live only in the metering proxy; the agent needs none."""

    @override
    def get_version_command(self) -> str | None:
        return f"{RUNTIME_PYTHON} -I -c 'import minisweagent; print(minisweagent.__version__)'"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        if not self._runtime_tarball.is_file():
            raise DrRuntimeError(f"E_DR_RUNTIME: no runtime tarball at {self._runtime_tarball}")
        got = sha256_file(self._runtime_tarball)
        if got != self._runtime_sha256:
            raise DrRuntimeError(f"E_DR_RUNTIME: runtime tarball sha256 {got} does not match the pinned {self._runtime_sha256}")
        await environment.upload_file(self._runtime_tarball, UPLOAD_PATH)
        await self.exec_as_root(
            environment,
            command=(
                f"echo {self._runtime_sha256}'  '{UPLOAD_PATH} | sha256sum -c --quiet - && "
                f"mkdir -p {RUNTIME_ROOT} && tar -xzf {UPLOAD_PATH} -C {RUNTIME_ROOT} && rm -f {UPLOAD_PATH} && "
                f"{RUNTIME_PYTHON} -I -c 'import dr_agent'"
            ),
        )

    async def _upload_json(self, environment: BaseEnvironment, value: Any, target: PurePosixPath) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / target.name
            path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
            await environment.upload_file(path, str(target))

    async def _read_json(self, environment: BaseEnvironment, path: PurePosixPath) -> dict[str, Any] | None:
        result = await environment.exec(command=f"cat {path}", user="root")
        if result.return_code != 0:
            return None
        try:
            return json.loads(result.stdout or "")
        except ValueError:
            return None

    def session_config(self, session: str) -> dict[str, Any]:
        """What dr_agent.session reads from /opt/dr/run/session.json (the field names in its docstring).

        calibration_shadow is true only for N on the calibration item: prereg section 6 logs shadow data in the 80
        calibration sessions, never in pilot or scored N sessions.
        """
        return {
            "session": session,
            "cell": self._cell,
            "model": self._model,
            "item": self._item,
            "task_file": str(RUN_DIR / "task.md"),
            "pin_file": str(RUN_DIR / "pin.json"),
            "questions_file": str(QUESTIONS_FILE),
            "log_dir": str(DR_LOG_DIR),
            "step_limit_actions": self._limits["executed_actions"],
            "call_limit": CALL_BACKSTOP,
            "wall_s": self._limits["wall_s"],
            "cwd": "/testbed",
            "calibration_shadow": self._cell == "N" and self._item == CALIBRATION_ITEM,
        }

    @override
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        proxy_base = os.environ.get("DR_PROXY_BASE")
        if not proxy_base:
            raise DrManagementError("DR_PROXY_BASE must be set in the Harbor process")
        session_name = self.logs_dir.parent.name
        await self.exec_as_root(environment, command=f"mkdir -p {RUN_DIR} {DR_LOG_DIR} {EnvironmentPaths.artifacts_dir}")
        await self._upload_json(environment, self.session_config(session_name), RUN_DIR / "session.json")
        with tempfile.TemporaryDirectory() as tmp:
            task = Path(tmp) / "task.md"
            task.write_text(instruction)
            await environment.upload_file(task, str(RUN_DIR / "task.md"))
        await environment.upload_file(self._pin_file, str(RUN_DIR / "pin.json"))
        path = (await self.exec_as_root(environment, command='printf %s "$PATH"')).stdout or "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

        cell_attempt = {"run_id": self._item, "arm": self._cell, "task": self.logs_dir.parent.parent.name, "model": self._model, "trial": 1, "attempt": 2 if attempt_dir(self.logs_dir.parent).exists() else 1}
        binding = await asyncio.to_thread(
            manage, "/bind", {
                "cell": cell_attempt,
                "models": self._allow,
                "allowance_micros": self._limits["allowance_micros"],
                **({"forbidden_markers": json.loads(Path(self._markers_file).read_text())} if self._markers_file else {}),
            },
        )
        values = {
            "PATH": path,
            "HOME": "/root",
            "DR_PROXY_URL": f"{proxy_base.rstrip('/')}/{binding['slot']}",
            "DR_CELL": self._cell,
            "DR_MODEL": self._model,
            "DR_SESSION": session_name,
            "MSWEA_COST_TRACKING": "ignore_errors",
            "LITELLM_LOCAL_MODEL_COST_MAP": "True",
        }
        command = (
            "env -i "
            + " ".join(f"{k}={shlex.quote(v)}" for k, v in values.items())
            + ' DR_PROXY_TOKEN="$DR_PROXY_TOKEN"'
            + f" {RUNTIME_PYTHON} -I -m dr_agent.session --config {RUN_DIR / 'session.json'}"
            + f" > {DR_LOG_DIR / 'session.log'} 2>&1"
        )
        failure: BaseException | None = None
        exit_code: int | None = None
        try:
            result = await environment.exec(
                command=command,
                env={"DR_PROXY_TOKEN": binding["token"]},
                timeout_sec=self._limits["wall_s"] + WALL_GRACE_SEC,
                user="root",
            )
            exit_code = result.return_code
            self.logger.info(f"dr_agent.session exited {exit_code}")
        except BaseException as e:
            failure = e
        finally:
            await asyncio.to_thread(manage, "/unbind", {"slot": binding["slot"]})
            self._meter = await asyncio.to_thread(manage, "/finalize", {"meter_id": binding["meter_id"]})
            await self._upload_json(environment, self._meter, DR_LOG_DIR / "meter.json")
        await self.exec_as_root(environment, command=EXPORT_PATCH)
        if failure is not None:
            raise failure

        summary = await self._read_json(environment, DR_LOG_DIR / "dr-summary.json") or {}
        if infra_failure(summary, self._meter):
            if cell_attempt["attempt"] == 1:
                await self._keep_attempt(environment, summary, binding["meter_id"])
            raise DrInfraError(
                f"infra_error: session {session_name} got no successful model response "
                f"(exit_status {summary.get('exit_status')}, session exit code {exit_code})"
            )

    async def _keep_attempt(self, environment: BaseEnvironment, summary: dict[str, Any], meter_id: str) -> None:
        target = attempt_dir(self.logs_dir.parent)
        target.mkdir(parents=True)
        if environment.is_path_mounted(EnvironmentPaths.agent_dir, self.logs_dir):
            shutil.copytree(self.logs_dir, target / "agent")
        else:
            await environment.download_dir(str(EnvironmentPaths.agent_dir), target / "agent")
        record = {
            "trial": target.name, "attempt": 1, "cell": self._cell, "model": self._model,
            "exit_status": summary.get("exit_status"), "successful_responses": successful_responses(self._meter or {}),
            "meter_id": meter_id, "micros": (self._meter or {}).get("micros", 0),
        }
        (target / "attempt.json").write_text(json.dumps(record, indent=2) + "\n")

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        if self._meter is not None:
            context.cost_usd = self._meter.get("micros", 0) / 1_000_000
