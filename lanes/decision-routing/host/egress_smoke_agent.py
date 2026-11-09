# Copyright (c) 2026 Garry Tan. MIT License.
"""Harbor agent for egress-smoke.sh. From inside the task container it probes TCP to the allowlisted proxy host and to
public hosts, as root and as the agent's uid, and records DNS and ICMP, which Harbor's sidecar leaves open. It writes
<trial>/agent/egress.json and does nothing else."""

import json
import os
from typing import override

from harbor.agents.nop import NopAgent

AGENT_UID = 10001
PROBES = {
    "proxy_tcp": "tcp {proxy_host} {proxy_port}",
    "public_ip_tcp_443": "tcp 1.1.1.1 443",
    "public_ip_tcp_80": "tcp 8.8.8.8 80",
    "public_name_tcp_443": "tcp example.com 443",
    "dns_example_com": "getent hosts example.com > /dev/null && echo resolves || echo no-answer",
    "icmp_1_1_1_1": "if command -v ping > /dev/null; then ping -c 1 -W 3 1.1.1.1 > /dev/null 2>&1 && echo open || echo closed; else echo no-ping; fi",
}
TCP = 'tcp() { timeout 8 bash -c "exec 3<>/dev/tcp/$1/$2" > /dev/null 2>&1 && echo open || echo closed; }; '


class EgressSmokeAgent(NopAgent):
    @staticmethod
    @override
    def name() -> str:
        return "dr-egress-smoke"

    @override
    async def run(self, instruction, environment, context) -> None:
        values = {"proxy_host": os.environ["DR_SMOKE_PROXY_HOST"], "proxy_port": os.environ["DR_SMOKE_PROXY_PORT"]}
        result = {"proxy_host": values["proxy_host"], "proxy_port": values["proxy_port"]}
        for user in ("root", AGENT_UID):
            for name, probe in PROBES.items():
                r = await environment.exec(command=TCP + probe.format(**values), user=user, timeout_sec=30)
                result[f"{name}_as_{user}"] = (r.stdout or "").strip() or f"exit {r.return_code}"
        (self.logs_dir / "egress.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
