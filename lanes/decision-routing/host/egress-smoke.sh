#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Allowlist egress smoke for a decision-routing runner VM, judged by bytes exchanged. It runs one Harbor docker trial of
# <task dir> with the proxy host on the agent's extra_allowed_hosts, as controller.ts harborJob does, with an HTTP stand-in
# for the proxy on <proxy host>:<proxy port> and a second listener on the same host at <off port>. From inside the task
# container, as root and as the agent's uid, egress_smoke_agent.py reads a path as open only when bytes came back, since
# Harbor's sidecar accepts every TCP connect and resets what it doesn't allow. The proxy must read open; the off port
# (outside the runner's container firewall, post-boot.sh) and example.com:80, 1.1.1.1:80 and pypi.org:443 (TLS) must read
# closed. DNS stays open under the sidecar and is printed, not judged. It exits 1 with E_DR_RUNNER when a path that must
# be closed reads open, and 2 when the proxy doesn't read open, a probe can't be judged or the trial gave no result. It
# clears <out dir>/harbor before its trial, so only this run's result is judged.
# usage: egress-smoke.sh <task dir> <out dir> [proxy host IP, default docker0's IPv4] [proxy port, default 47107] [off port, default 18791]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
task=$(cd "${1:?usage: egress-smoke.sh <task dir> <out dir> [proxy host] [proxy port] [off port]}" && pwd)
mkdir -p "${2:?}"
out=$(cd "$2" && pwd)
host=${3:-$(ip -4 -o addr show docker0 | awk '{print $4}' | cut -d/ -f1)}
port=${4:-47107}
off=${5:-18791}
[ -n "$host" ] || { echo "E_DR_RUNNER: no proxy host IP (docker0 has no IPv4 address); pass one" >&2; exit 2; }

mkdir -p "$out/www"
echo "proxy stand-in" > "$out/www/index.html"
python3 -m http.server --bind "$host" "$port" --directory "$out/www" > "$out/listener.log" 2>&1 &
listener=$!
python3 -m http.server --bind "$host" "$off" --directory "$out/www" > "$out/listener-off.log" 2>&1 &
listener_off=$!
trap 'kill $listener $listener_off 2> /dev/null || true' EXIT
sleep 1
cat > "$out/job.json" << JSON
{
  "job_name": "egress-smoke",
  "jobs_dir": "$out/harbor",
  "n_attempts": 1,
  "n_concurrent_trials": 1,
  "quiet": true,
  "environment": { "type": "docker", "delete": true },
  "agents": [{ "import_path": "egress_smoke_agent:EgressSmokeAgent", "extra_allowed_hosts": ["$host"] }],
  "tasks": [{ "path": "$task" }]
}
JSON
rm -rf "$out/harbor"
DR_SMOKE_PROXY_HOST=$host DR_SMOKE_PROXY_PORT=$port DR_SMOKE_OFF_PORT=$off HARBOR_TELEMETRY=0 PYTHONPATH="$here${PYTHONPATH:+:$PYTHONPATH}" \
  harbor run -c "$out/job.json" > "$out/harbor.log" 2>&1 || true
result=$(find "$out/harbor" -name egress.json | head -1)
[ -n "$result" ] || { echo "E_DR_RUNNER: the smoke trial wrote no egress.json; see $out/harbor.log" >&2; exit 2; }
cat "$result"
python3 - "$result" "$host" "$port" "$off" << 'PY'
import json, sys
r, host, port, off = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], sys.argv[4]
fail = 0
for user in ("root", "10001"):
    for name in ("host_off_port", "closed_example_com_80", "closed_1_1_1_1_80", "closed_pypi_org_443", "proxy"):
        got = r.get(name + "_as_" + user, "missing")
        want = "open" if name == "proxy" else "closed"
        if got == want:
            continue
        if got == "open":
            print("E_DR_RUNNER: %s reads open from the task container as %s (bytes came back): %s" % (name, user, r.get(name + "_raw_as_" + user)), file=sys.stderr)
            fail = 1
        else:
            print("E_DR_RUNNER: %s reads %s as %s, not %s: %s" % (name, got, user, want, r.get(name + "_raw_as_" + user)), file=sys.stderr)
            fail = fail or 2
if fail == 0:
    print("egress smoke: the proxy stand-in %s:%s answers; %s:%s, example.com:80, 1.1.1.1:80 and pypi.org:443 (TLS) return no bytes, as root and as uid 10001 (DNS printed above stays open under Harbor's sidecar)" % (host, port, host, off))
sys.exit(fail)
PY
