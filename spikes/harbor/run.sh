#!/usr/bin/env bash
# Runs the U8 Harbor spike against the fake upstream. No key, no spend.
# Needs Docker, Harbor from main (f3a5a92 or later) and claude-agent-sdk in Harbor's env.
# NETWORK=public runs a copy of the task with every network phase public, for
# hosts whose kernel cannot run Harbor's egress sidecar.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${OUT:-$here/out}
mkdir -p "$out"
task="$here/spike-task"
if [ "${NETWORK:-}" = public ]; then
  rm -rf "$out/spike-task-public"
  cp -r "$task" "$out/spike-task-public"
  sed -i 's/^network_mode = .*/network_mode = "public"/' "$out/spike-task-public/task.toml"
  task="$out/spike-task-public"
fi
gateway=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
port=${FAKE_UPSTREAM_PORT:-8787}
FAKE_UPSTREAM_LOG="$out/fake-upstream.jsonl" FAKE_UPSTREAM_PORT=$port python3 "$here/fake_upstream.py" "$gateway" &
upstream=$!
trap 'kill $upstream 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do
  sleep 0.5
  kill -0 "$upstream" 2>/dev/null || { echo "fake upstream exited; is port $port taken?" >&2; exit 1; }
  curl -fsS "$gateway:$port/healthz" >/dev/null 2>&1 && break
done
curl -fsS "$gateway:$port/healthz" >/dev/null || { echo "fake upstream never answered on $gateway:$port" >&2; exit 1; }
PYTHONPATH="$here" ANTHROPIC_API_KEY=fake-key-for-the-spike harbor run -y -p "$task" \
  -a sdk_claude_code:SdkClaudeCode -m anthropic/claude-opus-5-5 \
  --base-url "http://$gateway:$port" --ak skip_install=true --ak persona_path="$here/persona.json" \
  -e docker -o "$out/jobs" --job-name "spike-${NETWORK:-allowlist}-$(date +%s)"
