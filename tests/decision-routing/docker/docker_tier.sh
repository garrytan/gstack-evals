#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# B9's Docker tier on a runner VM: one Harbor docker trial per task with oracle_agent.py (the runtime tarball installed,
# the task's oracle run through the session's environment), the proxy host allowlisted as controller.ts does. Prints
# each trial's reward and the probe record. Pass: every reward is 1 and no probed path is under /opt/dr.
# usage: docker_tier.sh <tasks dir> <runtime tarball> <out dir> <task id>...
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
agent=$(cd "$here/../../../lanes/decision-routing/agent" && pwd)
tasks=$(cd "${1:?usage: docker_tier.sh <tasks dir> <runtime tarball> <out dir> <task id>...}" && pwd)
tarball=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
mkdir -p "$3"
out=$(cd "$3" && pwd)
shift 3
sha=$(sha256sum "$tarball" | cut -d' ' -f1)
host=$(ip -4 -o addr show docker0 | awk '{print $4}' | cut -d/ -f1)
echo '{}' > "$out/pin.json"
fail=0
for id in "$@"; do
  cat > "$out/$id.job.json" << JSON
{
  "job_name": "oracle-$id",
  "jobs_dir": "$out/harbor",
  "n_attempts": 1,
  "n_concurrent_trials": 1,
  "quiet": true,
  "environment": { "type": "docker", "delete": true, "extra_allowed_hosts": ["$host"] },
  "agents": [{ "import_path": "oracle_agent:OracleProbeAgent", "kwargs": { "cell": "N", "model": "opus", "runtime_tarball": "$tarball", "runtime_sha256": "$sha", "pin_file": "$out/pin.json", "item": "dr-calibration", "solution_dir": "$tasks/$id/solution" } }],
  "tasks": [{ "path": "$tasks/$id" }]
}
JSON
  DR_PROXY_BASE=http://127.0.0.1:9 HARBOR_TELEMETRY=0 PYTHONPATH="$here:$agent" harbor run -c "$out/$id.job.json" > "$out/$id.harbor.log" 2>&1 || true
  reward=$(find "$out/harbor/oracle-$id" -name reward.txt -path '*verifier*' | head -1 | xargs -r cat)
  probe=$(find "$out/harbor/oracle-$id" -name oracle-probe.json | head -1)
  echo "== $id reward ${reward:-none}"
  [ -n "$probe" ] && python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(json.dumps({k: r[k] for k in ("run_as","uid","python","conda_env","sys_path","pytest","proc_scan_hits","submit","snapshot_bytes","bearer_in_output")}, indent=1))' "$probe"
  [ "${reward:-}" = 1 ] || [ "${reward:-}" = 1.0 ] || fail=1
  [ -n "$probe" ] && ! grep -q '/opt/dr' <(python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(r["python"], r["sys_path"])' "$probe") || fail=1
done
exit $fail
