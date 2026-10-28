#!/usr/bin/env bash
# Keyless end-to-end smoke test of the Lane B runner: fake upstream -> metering proxy
# (with a scratch ledger) -> Harbor -> our SDK agent -> Claude Code in the container ->
# patch artifact -> separate verifier. No key, no spend.
# NETWORK=public runs every phase public (Capy cloud kernels cannot run the egress sidecar).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${OUT:-$HOME/.capy/work/gsta12/smoke}
mkdir -p "$out/arms"
for arm in none skill; do
  rm -rf "$out/arms/$arm" && mkdir -p "$out/arms/$arm/.claude/skills"
  [ "$arm" = skill ] && cp -r "$here/smoke-arm/investigate" "$out/arms/$arm/.claude/skills/"
  tar -C "$out/arms/$arm" -cf "$out/arms/$arm.tar" .claude
done
task="${TASK:-$here/smoke-task}"
if [ "${NETWORK:-}" = public ]; then
  rm -rf "$out/smoke-task-public" && cp -r "$task" "$out/smoke-task-public"
  sed -i 's/^network_mode = .*/network_mode = "public"/' "$out/smoke-task-public/task.toml"
  task="$out/smoke-task-public"
fi
gateway=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
rm -f "$out/ledger.jsonl"
cat > "$out/proxy.json" <<EOF
{"routes": {"fake": {"base_url": "http://127.0.0.1:8799", "key_env": "FAKE_UPSTREAM_KEY", "auth": "x-api-key", "count_tokens": "estimate"}},
 "models": {"claude-opus-5-5": {"route": "fake", "upstream_model": "claude-opus-5-5", "price_per_mtok": {"input": 5, "output": 25, "cache_write_5m": 6.25, "cache_write_1h": 10, "cache_read": 0.5}}}}
EOF
bun -e "import {Ledger} from '$here/ledger.ts'; new Ledger('$out/ledger.jsonl','smoke').approve(20, {note: 'smoke test, no spend'})"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
FAKE_UPSTREAM_LOG="$out/fake-upstream.jsonl" bun "$here/fake_upstream.ts" & pids+=($!)
bun "$here/ledger.ts" serve --path "$out/ledger.jsonl" --item smoke --port 9911 & pids+=($!)
FAKE_UPSTREAM_KEY=fake bun "$here/proxy.ts" --config "$out/proxy.json" --data-host "$gateway" --data-port 8787 --control-port 8788 \
  --log "$out/proxy-requests.jsonl" --sessions "$out/proxy-sessions.jsonl" --ledger-url http://127.0.0.1:9911 --ledger-prefix smoke- & pids+=($!)
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 && curl -fsS 127.0.0.1:8799/healthz >/dev/null 2>&1 && break; sleep 0.5; done
for arm in ${ARMS:-none skill}; do
  PYTHONPATH="$here/agent" ANTHROPIC_API_KEY=placeholder-not-a-key harbor run -y -p "$task" \
    -a laneb_agent:LanebAgent -m anthropic/claude-opus-5-5 --base-url "http://$gateway:8787" \
    --ak skip_install=true --ak persona_path="$here/agent/persona.json" --ak arm="$arm" --ak arm_tar="$out/arms/$arm.tar" \
    --ak session_cap_usd=6 --ak wrapper_path="$here/prompt-wrapper.md" --ak upstream_model=claude-opus-5-5 --ak repo_dir=${REPO_DIR-/testbed} --ak workdir=${WORKDIR-/testbed} \
    -e docker -o "$out/jobs" --job-name "smoke-$arm-${NETWORK:-allowlist}-$(date +%s)"
done
bun "$here/ledger.ts" status --path "$out/ledger.jsonl" --item smoke
