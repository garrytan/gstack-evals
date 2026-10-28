#!/usr/bin/env bash
# Runs one Lane B batch on the VM: the metering proxy (holding the provider keys) and
# Harbor (holding none). The ledger service is reached through the SSH reverse tunnel
# on 127.0.0.1:9911; if it is missing, no session can open.
# Usage: vm-run.sh <run dir> <ledger prefix> <batch cap usd>
set -euo pipefail
run=$(cd "$1" && pwd)
prefix=$2
cap=$3
runner=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mkdir -p "$run/out"
curl -fsS 127.0.0.1:9911/status > "$run/out/ledger-status-start.json" || { echo "ledger tunnel not reachable" >&2; exit 4; }
gw=$(sg docker -c "docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'")
(
  set -a; . "$HOME/.laneb-keys"; set +a
  exec bun "$runner/proxy.ts" --config "$run/proxy.json" --data-host "$gw" --data-port 8787 --control-port 8788 \
    --log "$run/out/proxy-requests.jsonl" --sessions "$run/out/proxy-sessions.jsonl" \
    --ledger-url http://127.0.0.1:9911 --ledger-prefix "$prefix" --global-cap-usd "$cap"
) > "$run/out/proxy.log" 2>&1 &
proxy=$!
trap 'curl -fsS -X POST 127.0.0.1:8788/close-all >/dev/null 2>&1 || true; kill $proxy 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 && break; sleep 0.5; done
sed "s#__GATEWAY__#$gw#g" "$run/job.json" > "$run/out/job.resolved.json"
cd "$run"
set +e
sg docker -c "env -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u OPENAI_API_KEY ANTHROPIC_API_KEY=placeholder-not-a-key PYTHONPATH='$runner/agent' harbor run -y -c '$run/out/job.resolved.json'" > "$run/out/harbor.log" 2>&1
rc=$?
set -e
curl -fsS -X POST 127.0.0.1:8788/close-all > "$run/out/close-all.json" || true
curl -fsS 127.0.0.1:8788/totals > "$run/out/proxy-totals.json" || true
curl -fsS 127.0.0.1:9911/status > "$run/out/ledger-status-end.json" || true
echo "harbor exit $rc"; tail -5 "$run/out/harbor.log"; cat "$run/out/proxy-totals.json"
exit $rc
