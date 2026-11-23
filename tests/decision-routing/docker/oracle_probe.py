# Copyright (c) 2026 Garry Tan. MIT License.
"""Runs in the task container as root (oracle_agent.py): the session's environment, the oracle through it, and a record of
what the command user's python resolves to. usage: oracle_probe.py <agent user or ""> <out json>"""
import json
import os
import sys
from pathlib import Path

import yaml
from minisweagent.config import builtin_config_dir
from minisweagent.exceptions import Submitted

from dr_agent import session, state

user, out = sys.argv[1], sys.argv[2]
token = os.environ.get("DR_PROXY_TOKEN", "")
for key in [k for k in os.environ if k.startswith("DR_")]:
    del os.environ[key]
section = yaml.safe_load((Path(builtin_config_dir) / "benchmarks" / "swebench.yaml").read_text())["environment"]
run_as = session.agent_ids({"agent_user": user}) if user and hasattr(session, "agent_ids") else None
state.RUN_AS = run_as
env = session.local_environment(section, "/testbed", run_as=run_as) if run_as else session.local_environment(section, "/testbed")


def run(command):
    try:
        r = env.execute({"command": command, "timeout": 1800}, timeout=1800)
        return {"returncode": r.get("returncode"), "output": r.get("output", "")[-4000:]}
    except Submitted:
        return {"submitted": True}


record = {"agent_user": user, "run_as": run_as}
for name, command in {
    "uid": "id -u",
    "python": "command -v python",
    "conda_env": "echo $CONDA_DEFAULT_ENV",
    "sys_path": "python -c 'import sys; print(sys.executable); print(sys.path)'",
    "pytest": "python -m pytest --version 2>&1 | head -1",
}.items():
    record[name] = run(command)
record["proc_scan_hits"] = run(
    "n=0; for f in /proc/[0-9]*/environ /proc/[0-9]*/cmdline; do cat \"$f\" 2>/dev/null | tr '\\0' '\\n' | grep -c '^DR_PROXY_TOKEN=' ; done | awk '{s+=$1} END {print s+0}'"
)
record["solve"] = run("bash /solution/solve.sh")
record["submit"] = run("echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT")
record["snapshot_bytes"] = len(state.snapshot_diff("/testbed"))
record["bearer_in_output"] = token in json.dumps(record)
Path(out).write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({k: record[k] for k in ("uid", "python", "conda_env", "submit", "snapshot_bytes", "bearer_in_output")}))
