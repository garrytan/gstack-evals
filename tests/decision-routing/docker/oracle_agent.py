# Copyright (c) 2026 Garry Tan. MIT License.
"""B9's Docker tier: DecisionRoutingAgent with the session replaced by the task's oracle, run through the session's own
environment. install() is kept (the runtime tarball, checked by sha256). run() prepares the agent user when the build
has one (dr_agent.agent_user), then runs oracle_probe.py in the container as root under env -i with a stand-in bearer,
as the session is launched: it builds the session's environment from mini's swebench.yaml, records what the command
user's python resolves to, and runs /solution/solve.sh through that environment. Then it gives /testbed back to root and
exports the patch exactly as run() does, and Harbor's verifier grades it.
"""

import secrets
from pathlib import Path, PurePosixPath
from typing import Any, override

import dr_harbor

PROBE = Path(__file__).resolve().parent / "oracle_probe.py"


class OracleOptions(dr_harbor.DecisionRoutingOptions):
    solution_dir: str


class OracleProbeAgent(dr_harbor.DecisionRoutingAgent):
    options_model = OracleOptions

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._solution = Path(self.options.solution_dir)

    @staticmethod
    @override
    def name() -> str:
        return "decision-routing-oracle-probe"

    @override
    async def run(self, instruction, environment, context) -> None:
        setup, restore = getattr(dr_harbor, "AGENT_SETUP", None), getattr(dr_harbor, "AGENT_RESTORE", None)
        await self.exec_as_root(environment, command=f"mkdir -p {dr_harbor.RUN_DIR} {dr_harbor.DR_LOG_DIR} {dr_harbor.EnvironmentPaths.artifacts_dir} /solution")
        await environment.upload_dir(self._solution, "/solution")
        await environment.upload_file(PROBE, str(dr_harbor.RUN_DIR / "oracle_probe.py"))
        if setup:
            await self.exec_as_root(environment, command=setup)
        user = self.session_config("oracle").get("agent_user", "")
        out = PurePosixPath(dr_harbor.DR_LOG_DIR) / "oracle-probe.json"
        result = await environment.exec(
            command=f'env -i PATH="$PATH" HOME=/root DR_PROXY_TOKEN="$DR_PROXY_TOKEN" {dr_harbor.RUNTIME_PYTHON} -I {dr_harbor.RUN_DIR / "oracle_probe.py"} "{user}" {out} > {dr_harbor.DR_LOG_DIR / "oracle-probe.log"} 2>&1',
            env={"DR_PROXY_TOKEN": secrets.token_hex(24)},
            timeout_sec=1800,
            user="root",
        )
        self.logger.info(f"oracle probe exited {result.return_code}")
        if restore:
            await self.exec_as_root(environment, command=restore)
        await self.exec_as_root(environment, command=dr_harbor.EXPORT_PATCH)
