"""The trial container's egress allowlist by address and port (plan 2026-11-01-geva-87, open item 6).

Two nftables tables in the container's own network namespace, written from outside it by a helper container that shares
the namespace and holds NET_ADMIN; the agent's container holds neither NET_ADMIN nor NET_RAW (Lane B's caps overlay and
its preflight), so nothing inside can change them. IPv4 output is dropped except replies on connections already open,
loopback, and TCP to each allowed address and port: the metering proxy and the sandbox sidecar. IPv6 output is dropped
except loopback. Docker's embedded DNS at 127.0.0.11, which forwards names to the host's resolvers, is refused before
loopback is accepted, so there is no DNS route out either. No ICMP, no UDP, no other port on an allowed address. The
families are ip and ip6, not inet, because some kernels (6.1 builds among them) refuse inet tables. Harbor runs the trial
with network_mode "public", so its own SNI allowlist adds nothing. After writing, the tables are read back and probed from
inside the container.
"""

import ipaddress
import json
import shlex
import subprocess

# Harbor's own egress sidecar image at the pinned Harbor commit (f3a5a92); it carries nft 1.1.5.
HELPER_IMAGE = "gogost/gost:3.2.7-nightly.20260602@sha256:afc0137758ab4ce399d47a299f9abbacbf522b52a17e59cbb4b4e7a1a66e9196"
TABLE = "real_egress"
DOCKER_DNS = "127.0.0.11"
# Denied targets the in-container probe must fail to reach, besides each allowed address on another port.
DENIED_PROBES = (("1.1.1.1", 443), ("8.8.8.8", 53), ("169.254.169.254", 80), (DOCKER_DNS, 53))


class EgressError(RuntimeError):
    """E_REAL_SANDBOX_EGRESS: the rules could not be applied or did not verify. The agent never starts."""


def endpoint(url: str) -> tuple[str, int]:
    """The IPv4 address and port of an http URL. Hostnames are refused: the trial has no DNS."""
    rest = url.split("://", 1)[-1].split("/", 1)[0]
    host, _, port = rest.rpartition(":")
    try:
        ipaddress.IPv4Address(host)
        return host, int(port)
    except ValueError:
        raise EgressError(f"E_REAL_SANDBOX_EGRESS {url} must name an IPv4 address and a port; the trial has no DNS") from None


def allow_rules(allow: list) -> list:
    for ip, port in allow:
        ipaddress.IPv4Address(ip)
        assert 0 < int(port) < 65536, port
    return [f"ip daddr {ip} tcp dport {int(port)} accept" for ip, port in sorted(set((ip, int(port)) for ip, port in allow))]


def ruleset(allow: list) -> str:
    chain = lambda *rules: ["  chain output {", "    type filter hook output priority filter; policy drop;", *("    " + r for r in rules), "  }"]
    return "\n".join([
        f"table ip {TABLE} {{",
        *chain("ct state established,related accept", f"ip daddr {DOCKER_DNS} drop", 'oifname "lo" accept', *allow_rules(allow), "meta l4proto tcp reject with tcp reset", "reject with icmp type admin-prohibited"),
        "}",
        f"table ip6 {TABLE} {{",
        *chain('oifname "lo" accept', "meta l4proto tcp reject with tcp reset", "reject with icmpv6 type admin-prohibited"),
        "}",
    ]) + "\n"


def _helper(container: str, args: list, stdin: str | None = None, docker: str = "docker", timeout: float = 120) -> subprocess.CompletedProcess:
    cmd = [docker, "run", "--rm", "-i", "--network", f"container:{container}", "--cap-drop", "ALL", "--cap-add", "NET_ADMIN", "--entrypoint", "nft", HELPER_IMAGE, *args]
    return subprocess.run(cmd, input=stdin, capture_output=True, text=True, timeout=timeout)


def apply(container: str, allow: list, docker: str = "docker") -> dict:
    """Writes both tables (replacing earlier ones of the same name) and reads them back. Raises EgressError."""
    text = ruleset(allow)
    reset = "".join(f"add table {f} {TABLE}\ndelete table {f} {TABLE}\n" for f in ("ip", "ip6"))
    try:
        wrote = _helper(container, ["-f", "-"], reset + text, docker)
        if wrote.returncode != 0:
            raise EgressError(f"E_REAL_SANDBOX_EGRESS nft refused the ruleset: {wrote.stderr.strip()[-500:]}")
        reads = [_helper(container, ["list", "table", f, TABLE], None, docker) for f in ("ip", "ip6")]
    except (subprocess.SubprocessError, OSError) as e:
        raise EgressError(f"E_REAL_SANDBOX_EGRESS the egress helper failed: {type(e).__name__}: {e}") from None
    got4, got6 = ([line.strip() for line in r.stdout.splitlines() if line.strip()] for r in reads)
    want = allow_rules(allow)
    problems = [f"ip table lacks: {w}" for w in ["policy drop;", f"ip daddr {DOCKER_DNS} drop", *want] if not any(g.endswith(w) for g in got4)]
    problems += [f"ip table has an extra accept: {g}" for g in got4 if g.startswith("ip daddr") and g.endswith("accept") and g not in want]
    problems += [] if any(g.endswith("policy drop;") for g in got6) else ["the ip6 table does not drop"]
    problems += [f"nft list exited {r.returncode}: {r.stderr.strip()[-200:]}" for r in reads if r.returncode != 0]
    if problems:
        raise EgressError("E_REAL_SANDBOX_EGRESS the tables read back differ: " + "; ".join(problems))
    return {"event": "egress", "table": TABLE, "allow": [f"{ip}:{port}" for ip, port in allow], "helper": HELPER_IMAGE, "listing": "\n".join(got4 + got6)}


PROBE_JS = r"""
const net = require("net");
const targets = JSON.parse(process.argv[1]);
let left = targets.length; const out = {};
for (const [host, port] of targets) {
  const s = net.connect({ host, port, timeout: 4000 });
  let settled = false;
  const done = (ok, why) => { if (settled) return; settled = true; out[host + ":" + port] = ok ? "open" : why; s.destroy(); if (--left === 0) console.log(JSON.stringify(out)); };
  s.on("connect", () => done(true));
  s.on("timeout", () => done(false, "timeout"));
  s.on("error", (e) => done(false, e.code || "error"));
}
"""


def probe_targets(allow: list) -> tuple[list, list]:
    """Each target once: the allowed endpoints, the fixed denied ones, and per allowed address a port it does not allow."""
    allowed = list(dict.fromkeys((ip, int(port)) for ip, port in allow))
    ports = {}
    for ip, port in allowed:
        ports.setdefault(ip, set()).add(port)
    denied = [(ip, next(p for p in range(1, 65536) if p not in used)) for ip, used in ports.items()]
    return allowed, list(dict.fromkeys(list(DENIED_PROBES) + denied))


def judge_probe(result: dict, allow: list) -> list:
    """Problems with an in-container probe: an allowed endpoint that did not open, or a denied one that did."""
    allowed, denied = probe_targets(allow)
    problems = [f"{ip}:{port} did not open ({result.get(f'{ip}:{port}')})" for ip, port in allowed if result.get(f"{ip}:{port}") != "open"]
    problems += [f"{ip}:{port} opened" for ip, port in denied if result.get(f"{ip}:{port}") == "open"]
    problems += [f"{ip}:{port} has no probe result" for ip, port in allowed + denied if f"{ip}:{port}" not in result]
    return problems


def probe(exec_fn, container: str, allow: list, node: str) -> dict:
    """Connects from inside the container with its runtime's Node. exec_fn(container, script, stdin, timeout) as in laneb_agent."""
    allowed, denied = probe_targets(allow)
    script = f"{shlex.quote(node)} -e {shlex.quote(PROBE_JS)} {shlex.quote(json.dumps(allowed + denied))}"
    res = exec_fn(container, script, None, 60)
    try:
        result = json.loads(res.stdout.decode().strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise EgressError(f"E_REAL_SANDBOX_EGRESS the in-container probe printed no result: rc {res.returncode} {res.stderr.decode(errors='replace')[-300:]}") from None
    problems = judge_probe(result, allow)
    if problems:
        raise EgressError("E_REAL_SANDBOX_EGRESS the egress probe failed: " + "; ".join(problems))
    return {"event": "egress_probe", "result": result}
