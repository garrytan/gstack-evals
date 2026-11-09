# Copyright (c) 2026 Garry Tan. MIT License.
"""Harbor agent for egress-smoke.sh. From inside the task container, as root and as the agent's uid, it runs
egress_probe.py against the allowlisted proxy stand-in, against another port on the proxy's host, and against public
hosts (example.com:80 by name, 1.1.1.1:80 by IP, pypi.org:443 over TLS), and reads each one as open only when bytes came
back. DNS, which Harbor's sidecar leaves open, is printed, not judged. It writes <trial>/agent/egress.json and does
nothing else."""

import json
import os
import re
import shlex
from pathlib import Path
from typing import override

from harbor.agents.nop import NopAgent

AGENT_UID = 10001
PROBE = (Path(__file__).resolve().parent / "egress_probe.py").read_text()
PROBES = {
    "proxy": ("{proxy_host}", "{proxy_port}", ""),
    "host_off_port": ("{proxy_host}", "{off_port}", ""),
    "closed_example_com_80": ("example.com", "80", ""),
    "closed_1_1_1_1_80": ("1.1.1.1", "80", ""),
    "closed_pypi_org_443": ("pypi.org", "443", "--tls"),
}
DNS = "getent hosts example.com > /dev/null && echo resolves || echo no-answer"


def reading(stdout: str, return_code: int) -> tuple[str, str]:
    """open when the probe printed bytes=<n> with n > 0, closed when n is 0, else an error the smoke can't judge."""
    m = re.search(r"^bytes=(\d+) (\S+)$", stdout or "", re.M)
    if not m:
        return "error", "exit %d: %s" % (return_code, (stdout or "").strip()[-200:])
    return ("open" if int(m.group(1)) > 0 else "closed"), m.group(0)


class EgressSmokeAgent(NopAgent):
    @staticmethod
    @override
    def name() -> str:
        return "dr-egress-smoke"

    @override
    async def run(self, instruction, environment, context) -> None:
        values = {"proxy_host": os.environ["DR_SMOKE_PROXY_HOST"], "proxy_port": os.environ["DR_SMOKE_PROXY_PORT"], "off_port": os.environ["DR_SMOKE_OFF_PORT"]}
        result = dict(values)
        for user in ("root", AGENT_UID):
            for name, (host, port, flag) in PROBES.items():
                args = " ".join(shlex.quote(a.format(**values)) for a in (host, port, flag) if a)
                command = 'py=$(command -v python3 || command -v python) && "$py" -c ' + shlex.quote(PROBE) + " " + args
                r = await environment.exec(command=command, user=user, timeout_sec=30)
                result[f"{name}_as_{user}"], result[f"{name}_raw_as_{user}"] = reading(r.stdout or "", r.return_code)
            r = await environment.exec(command=DNS, user=user, timeout_sec=30)
            result[f"dns_example_com_as_{user}"] = (r.stdout or "").strip() or f"exit {r.return_code}"
        (self.logs_dir / "egress.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
