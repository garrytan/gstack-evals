# Copyright (c) 2026 Garry Tan. MIT License.
"""Runs the pinned Harbor's own job preflight and agent factory, with dr_harbor on PYTHONPATH, on the job files
harbor-options.test.ts writes from controller.ts harborJob: plain.json and custody.json must pass both, and typo.json,
with one unknown kwarg, must be refused by name."""

import sys
import tempfile
from pathlib import Path

from harbor.agents.factory import AgentFactory
from harbor.models.job.config import JobConfig

import dr_harbor


def load(path: Path) -> JobConfig:
    return JobConfig.model_validate_json(path.read_text())


def preflight(config: JobConfig) -> None:
    """What harbor run does for each agent before it queues trials (harbor/cli/jobs.py _run_preflight)."""
    for agent in config.agents:
        AgentFactory.run_preflight(agent, skip_credential_checks=config.skip_credential_checks or config.install_only)


jobs = Path(sys.argv[1])
for name in ("plain", "custody"):
    config = load(jobs / f"{name}.json")
    preflight(config)
    with tempfile.TemporaryDirectory() as logs:
        agent = AgentFactory.create_agent_from_config(config.agents[0], logs_dir=Path(logs))
    kwargs = config.agents[0].kwargs
    assert type(agent) is dr_harbor.DecisionRoutingAgent, type(agent)
    assert agent.name() == "decision-routing", agent.name()
    got = (agent._cell, agent._model, agent._item, str(agent._runtime_tarball), agent._runtime_sha256, str(agent._pin_file), agent._markers_file)
    want = tuple(kwargs.get(k) for k in ("cell", "model", "item", "runtime_tarball", "runtime_sha256", "pin_file", "markers_file"))
    assert got == want, (got, want)
    print(f"PASS {name}")

try:
    preflight(load(jobs / "typo.json"))
except ValueError as e:
    assert "Unknown option 'cels'" in str(e) and "'decision-routing'" in str(e), str(e)
    print("PASS typo refused")
else:
    raise SystemExit("FAIL typo.json passed Harbor's preflight")
