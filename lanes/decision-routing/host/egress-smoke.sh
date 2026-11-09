#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Allowlist egress smoke for a decision-routing runner VM. It runs one Harbor docker trial of <task dir> with
# environment.extra_allowed_hosts = [the proxy host], as controller.ts harborJob does, with a stand-in listener on the
# proxy host, and from inside the task container (as root and as the agent's uid) shows the proxy host reachable and a
# public host, by IP and by name, not reachable over TCP. DNS and ICMP stay open under Harbor's sidecar; they are
# printed, not judged. It exits 1 with E_DR_RUNNER when any public TCP probe connects, and 2 when the proxy host is not
# reachable or the trial gave no result.
# usage: egress-smoke.sh <task dir> <out dir> [proxy host IP, default docker0's IPv4] [port, default 18791]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
task=$(cd "${1:?usage: egress-smoke.sh <task dir> <out dir> [proxy host] [port]}" && pwd)
mkdir -p "${2:?}"
out=$(cd "$2" && pwd)
host=${3:-$(ip -4 -o addr show docker0 | awk '{print $4}' | cut -d/ -f1)}
port=${4:-18791}
[ -n "$host" ] || { echo "E_DR_RUNNER: no proxy host IP (docker0 has no IPv4 address); pass one" >&2; exit 2; }

python3 -m http.server --bind "$host" "$port" --directory "$out" > "$out/listener.log" 2>&1 &
listener=$!
trap 'kill $listener 2> /dev/null || true' EXIT
sleep 1
cat > "$out/job.json" << JSON
{
  "job_name": "egress-smoke",
  "jobs_dir": "$out/harbor",
  "n_attempts": 1,
  "n_concurrent_trials": 1,
  "quiet": true,
  "environment": { "type": "docker", "delete": true, "extra_allowed_hosts": ["$host"] },
  "agents": [{ "import_path": "egress_smoke_agent:EgressSmokeAgent" }],
  "tasks": [{ "path": "$task" }]
}
JSON
DR_SMOKE_PROXY_HOST=$host DR_SMOKE_PROXY_PORT=$port HARBOR_TELEMETRY=0 PYTHONPATH="$here${PYTHONPATH:+:$PYTHONPATH}" \
  harbor run -c "$out/job.json" > "$out/harbor.log" 2>&1 || true
result=$(find "$out/harbor" -name egress.json | head -1)
[ -n "$result" ] || { echo "E_DR_RUNNER: the smoke trial wrote no egress.json; see $out/harbor.log" >&2; exit 2; }
cat "$result"
fail=0
for key in $(python3 -c 'import json,sys; print(" ".join(k for k in json.load(open(sys.argv[1])) if k.startswith("public_")))' "$result"); do
  if [ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$result" "$key")" != closed ]; then
    echo "E_DR_RUNNER: public egress works from the task container: $key is not closed" >&2
    fail=1
  fi
done
for key in proxy_tcp_as_root proxy_tcp_as_10001; do
  if [ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$result" "$key")" != open ]; then
    echo "E_DR_RUNNER: the allowlisted proxy host $host:$port is not reachable ($key)" >&2
    [ $fail = 1 ] || fail=2
  fi
done
[ $fail = 0 ] && echo "egress smoke: proxy host $host:$port reachable; public TCP by IP and by name closed, as root and as uid 10001 (DNS and ICMP printed above stay open under Harbor's sidecar)"
exit $fail
