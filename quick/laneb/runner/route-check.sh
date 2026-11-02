#!/usr/bin/env bash
# Route check, the first paid step: per model, two sessions through the real proxy and the real ledger. The smoke task under
# arm none proves the model completes a Claude Code session through its route (OpenRouter's Anthropic route for particle-1
# and gpt-6.1-sol). The listing check runs arm gstack on runner/route-listing.md and proves the skill listing, a
# system-role message, reaches the model: its reply must quote /investigate's description. runner/route-verdict.ts reads
# both (Run D section 8). Exits 1 when Harbor fails or a model fails either check; such a model is retried once, then leaves the run.
# Needs ANTHROPIC_API_KEY and OPENROUTER_API_KEY in this shell (only the proxy sees them), and GSTACK_TAR, the
# preregistered gstack arm tar, which the agent checks against arms/manifests/gstack.json before any model call.
# Every phase is public here (Capy cloud kernels cannot run Harbor's egress sidecar).
# SYSTEM_PROMPT (an agent system_prompt value) and MAX_TURNS (sdk_max_turns) are passed to the agent when set.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
out=${OUT:-$HOME/.capy/work/gsta12/route-check}
ledger=${LEDGER:-$HOME/.capy/drive/captain-gstack-evals/ledger/laneb-quick.jsonl}
: "${ANTHROPIC_API_KEY:?}" "${OPENROUTER_API_KEY:?}" "${PREREG:?set PREREG to the preregistration commit sha}" "${GSTACK_TAR:?set GSTACK_TAR to the gstack arm tar}"
gstack_sha=$(jq -r .tar.sha256 "$root/arms/manifests/gstack.json")
mkdir -p "$out/arms/none/.claude/skills"
tar -C "$out/arms/none" -cf "$out/arms/none.tar" .claude
rm -rf "$out/task" "$out/listing-task" && cp -r "$here/smoke-task" "$out/task"
sed -i 's/^network_mode = .*/network_mode = "public"/' "$out/task/task.toml"
cp -r "$out/task" "$out/listing-task" && cp "$here/route-listing.md" "$out/listing-task/instruction.md"
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
failed=()
# session <model> <kind> <task dir> <job name> <agent kwargs...>
session() {
  local m=$1 kind=$2 task=$3 job=$4 cap hm
  shift 4
  cap=$(jq -r --arg m "$m" '.models[] | select(.id == $m) | .session_cap_usd' "$root/config/cells.json")
  hm=$(jq -r --arg m "$m" '.models[] | select(.id == $m) | .harbor_model' "$root/config/cells.json")
  env -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u OPENAI_API_KEY ANTHROPIC_API_KEY=placeholder-not-a-key PYTHONPATH="$here/agent" \
    harbor run -y -p "$task" \
    -a laneb_agent:LanebAgent -m "$hm" --base-url "http://$gateway:8787" \
    --ak skip_install=true --ak persona_path="$here/agent/persona.json" "$@" \
    --ak session_cap_usd="$cap" --ak wrapper_path="$here/prompt-wrapper.md" --ak upstream_model="$m" --ak max_output_tokens=32000 --ak repo_dir=/testbed --ak workdir=/testbed "${agent_opts[@]}" \
    -e docker -o "$out/jobs" --job-name "$job" || { echo "route check: harbor failed for $m ($kind)"; return 1; }
}
for m in $models; do
  ts=$(date +%s)
  smoke=route-$m-$ts listing=listing-$m-$ts
  ok=1
  session "$m" smoke "$out/task" "$smoke" --ak arm=none --ak arm_tar="$out/arms/none.tar" || ok=0
  session "$m" listing "$out/listing-task" "$listing" --ak arm=gstack --ak arm_tar="$GSTACK_TAR" --ak arm_sha256="$gstack_sha" || ok=0
  bun "$here/route-verdict.ts" "$m" "$out/jobs/$smoke" "$out/jobs/$listing" || ok=0
  [ $ok = 1 ] || failed+=("$m")
done
[ -s "$out/proxy-sessions.jsonl" ] && jq -c '{model, spent_usd: (.spent_micros / 1e6), requests, refused, close_reason, usage}' "$out/proxy-sessions.jsonl"
for r in "$out"/jobs/route-*/*/verifier/reward.txt; do [ -f "$r" ] && echo "$r $(cat "$r")"; done
bun "$here/ledger.ts" status --path "$ledger" --item "${ITEM:-laneb-quick}"
if [ ${#failed[@]} -gt 0 ]; then
  echo "route check: FAILED for ${failed[*]}"
  exit 1
fi
echo "route check: passed for $models"
