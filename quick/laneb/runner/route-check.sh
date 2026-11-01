#!/usr/bin/env bash
# Route check, the first paid step: one trial of the smoke task per model through the real
# proxy and the real laneb-quick ledger, arm none. Proves each model completes a Claude Code
# session through its route (DeepSeek via OpenRouter's Anthropic route) before any batch.
# Needs ANTHROPIC_API_KEY and OPENROUTER_API_KEY in this shell; only the proxy sees them.
# Every phase is public here (Capy cloud kernels cannot run Harbor's egress sidecar).
# SYSTEM_PROMPT (an agent system_prompt value) and MAX_TURNS (sdk_max_turns) are passed to the agent when set.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
out=${OUT:-$HOME/.capy/work/gsta12/route-check}
ledger=${LEDGER:-$HOME/.capy/drive/captain-gstack-evals/ledger/laneb-quick.jsonl}
: "${ANTHROPIC_API_KEY:?}" "${OPENROUTER_API_KEY:?}" "${PREREG:?set PREREG to the preregistration commit sha}"
mkdir -p "$out/arms/none/.claude/skills"
tar -C "$out/arms/none" -cf "$out/arms/none.tar" .claude
rm -rf "$out/task" && cp -r "$here/smoke-task" "$out/task"
sed -i 's/^network_mode = .*/network_mode = "public"/' "$out/task/task.toml"
gateway=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
bun "$here/ledger.ts" serve --path "$ledger" --item "${ITEM:-laneb-quick}" --port 9911 --prereg "$PREREG" & pids+=($!)
bun "$here/proxy.ts" --config "$root/config/proxy.json" --data-host "$gateway" --data-port 8787 --control-port 8788 \
  --log "$out/proxy-requests.jsonl" --sessions "$out/proxy-sessions.jsonl" --ledger-url http://127.0.0.1:9911 --ledger-prefix route- & pids+=($!)
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 && curl -fsS 127.0.0.1:9911/status >/dev/null 2>&1 && break; sleep 0.5; done
models=${MODELS:-claude-haiku-5-5 deepseek-v4.1-flash-1017 claude-opus-5-5}
agent_opts=()
[ -n "${SYSTEM_PROMPT:-}" ] && agent_opts+=(--ak system_prompt="$SYSTEM_PROMPT")
[ -n "${MAX_TURNS:-}" ] && agent_opts+=(--ak sdk_max_turns="$MAX_TURNS")
for m in $models; do
  cap=$(jq -r --arg m "$m" '.models[] | select(.id == $m) | .session_cap_usd' "$root/config/cells.json")
  hm=$(jq -r --arg m "$m" '.models[] | select(.id == $m) | .harbor_model' "$root/config/cells.json")
  env -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u OPENAI_API_KEY ANTHROPIC_API_KEY=placeholder-not-a-key PYTHONPATH="$here/agent" \
    harbor run -y -p "$out/task" \
    -a laneb_agent:LanebAgent -m "$hm" --base-url "http://$gateway:8787" \
    --ak skip_install=true --ak persona_path="$here/agent/persona.json" --ak arm=none --ak arm_tar="$out/arms/none.tar" \
    --ak session_cap_usd="$cap" --ak wrapper_path="$here/prompt-wrapper.md" --ak upstream_model="$m" --ak max_output_tokens=32000 --ak repo_dir=/testbed --ak workdir=/testbed "${agent_opts[@]}" \
    -e docker -o "$out/jobs" --job-name "route-$m-$(date +%s)" || echo "route check: harbor failed for $m"
done
jq -c '{model, spent_usd: (.spent_micros / 1e6), requests, refused, close_reason, usage}' "$out/proxy-sessions.jsonl"
for r in "$out"/jobs/route-*/*/verifier/reward.txt; do echo "$r $(cat "$r")"; done
bun "$here/ledger.ts" status --path "$ledger" --item "${ITEM:-laneb-quick}"
