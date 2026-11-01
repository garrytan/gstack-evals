#!/usr/bin/env bash
# Keyless dry run for GEVA-106's preregistration (section 10). No provider key, no Ubicloud call, no spend.
#   a  builds the variant tars twice and compares digests; prepare-run for Run D (invoke off) and Run T (invoke on)
#   b  listing and told checks through the real proxy, ledger service and Harbor, with the fake upstream behind a
#      pass-through shim that records each request body; one arm at a time
#   c  one lease per run on a temp ledger (b's sessions reserve and settle through the proxy)
#   d  start rule: each run's planned order, and an over-cap case that writes its note row
#   e  analysis on synthetic job folders     f  MDD tables     g  the route-check commands each run would use
# Usage: [ARMS_DIR=<none.tar gstack.tar placebo.tar>] [OUT=<dir>] [TB2=<checkout>] runner/dryrun-discovery.sh [steps]
set -euo pipefail
for k in ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY UBICLOUD_API_KEY; do
  if [ -n "${!k:-}" ]; then echo "E_USAGE unset $k: the dry run is keyless" >&2; exit 2; fi
done
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
armsrc=${ARMS_DIR:-$HOME/.capy/work/geva106/arms}
out=${OUT:-$HOME/.capy/work/geva106/dryrun}
export TB2=${TB2:-$HOME/.capy/work/ref/terminal-bench-2}
steps=" ${*:-a b c d e f g} "
driver=${DRIVER:-direct}
sdk_python=${SDK_PYTHON:-$(head -1 "$(command -v harbor)" | sed 's/^#!//')}
claude_bin=${CLAUDE_BIN:-$HOME/.capy/work/geva106/cc/package/claude}
# Kill whatever still listens on these ports and wait until each is free: a bun server outlived its kill once.
free_ports() {
  local p pid
  for p in "$@"; do
    for _ in $(seq 1 20); do
      pid=$(ss -ltnpH "sport = :$p" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
      [ -z "$pid" ] && break
      kill -9 $pid 2>/dev/null || true; sleep 0.5
    done
  done
}
has() { [[ "$steps" == *" $1 "* ]]; }
mkdir -p "$out"
armdir=$out/arms
SHIPPED='Systematic debugging with root cause investigation.'
echo "dry run at $(git -C "$root" rev-parse --short HEAD), $(date -u +%FT%TZ)"

if has a; then
  echo "== a. variants and prepare-run"
  rm -rf "$out/variants" "$armdir" "$out/run-d" "$out/run-t"
  for b in b1 b2; do bun "$root/arms/variants.ts" --in "$armsrc" --out "$out/variants/$b" | grep -E 'manifest|tokens'; done
  (cd "$out/variants" && sha256sum b1/*.tar b2/*.tar)
  for t in gstack-rewritten placebo-short; do
    [ "$(sha256sum < "$out/variants/b1/$t.tar")" = "$(sha256sum < "$out/variants/b2/$t.tar")" ] || { echo "variants: $t digests differ"; exit 1; }
  done
  echo "variants: both builds give the same digests"
  for t in gstack placebo; do echo "entries of $t.tar carrying '$SHIPPED':"; bun "$root/arms/variants.ts" --carriers "$armsrc/$t.tar" "$SHIPPED" | sed 's/^/  /'; done
  echo "gstack-rewritten investigate frontmatter:"; tar -xOf "$out/variants/b1/gstack-rewritten.tar" .claude/skills/investigate/SKILL.md | sed -n '1,6p' | cut -c1-140 | sed 's/^/  /'
  mkdir -p "$armdir"
  for t in none gstack placebo; do ln -sf "$armsrc/$t.tar" "$armdir/$t.tar"; done
  for t in gstack-rewritten placebo-short; do ln -sf "$out/variants/b1/$t.tar" "$armdir/$t.tar"; done
  if [ ! -d "$TB2/.git" ]; then
    git clone -q --filter=blob:none https://github.com/laude-institute/terminal-bench-2.git "$TB2"
  fi
  git -C "$TB2" checkout -q 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c
  final=$(jq -r '.tasks | join(",")' "$root/tasks/final.json")
  tasks=$(echo "$final" | tr ',' '\n' | grep -vxE 'crack-7z-hash|adaptive-rejection-sampler|largest-eigenval' | paste -sd,)
  TASKS=$tasks bun "$here/prepare-run.ts" "$out/run-d" discovery-r1-dry claude-haiku-5-5,particle-1,claude-sonnet-5-5,claude-opus-5-5,gpt-6.1-sol none,gstack,gstack-rewritten,placebo "$armdir" 1 12 off
  TASKS=$tasks bun "$here/prepare-run.ts" "$out/run-t" texttax-r1-dry particle-1 none,placebo-short,placebo "$armdir" 5 12 on
  for r in run-d run-t; do
    echo "$r: $(jq '.tasks | length' "$out/$r/job.json") tasks, manifest invoke=$(jq -c '.invoke' "$out/$r/manifest.json") invoke_by_arm=$(jq -c '.invoke_by_arm' "$out/$r/manifest.json")"
    jq -r '.agents[] | "  \(.kwargs.upstream_model) \(.kwargs.arm): invoke=\(.kwargs.invoke) skill_map=\(.kwargs.skill_map | to_entries | map(.value) | unique | join(",") | if . == "" then "{}" else . + " x" end)\(.kwargs.skill_map | length)"' "$out/$r/job.json"
  done
fi

# One harness per run: fake upstream behind the recording shim, the run's temp ledger service, the metering proxy.
harness_run() {
  local item=$1 cap=$2 shim_port=8799; shift 2
  [ "$item" = texttax-r1 ] && shim_port=8796
  local dir=$out/harness-$item
  rm -rf "$dir" && mkdir -p "$dir"
  rm -rf "$dir/task" && cp -r "$here/smoke-task" "$dir/task-public" && sed -i 's/^network_mode = .*/network_mode = "public"/' "$dir/task-public/task.toml"
  cat > "$dir/proxy.json" <<EOF
{"routes": {"fake": {"base_url": "http://127.0.0.1:$shim_port", "key_env": "FAKE_UPSTREAM_KEY", "auth": "x-api-key", "count_tokens": "estimate"}},
 "models": {"claude-opus-5-5": {"route": "fake", "upstream_model": "claude-opus-5-5", "price_per_mtok": {"input": 5, "output": 25, "cache_write_5m": 6.25, "cache_write_1h": 10, "cache_read": 0.5}}}}
EOF
  bun -e "import {Ledger} from '$here/ledger.ts'; new Ledger('$dir/$item.jsonl','$item').approve($cap, {note: 'GEVA-106 dry run, temp ledger, no spend'})"
  local gateway pids=()
  gateway=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
  FAKE_UPSTREAM_PORT=8798 FAKE_UPSTREAM_LOG="$dir/fake-upstream.jsonl" bun "$here/fake_upstream.ts" & pids+=($!)
  bun "$here/ledger.ts" serve --path "$dir/$item.jsonl" --item "$item" --port 9911 --prereg dryrun & pids+=($!)
  FAKE_UPSTREAM_KEY=fake bun "$here/proxy.ts" --config "$dir/proxy.json" --data-host "$gateway" --data-port 8787 --control-port 8788 \
    --log "$dir/proxy-requests.jsonl" --sessions "$dir/proxy-sessions.jsonl" --ledger-url http://127.0.0.1:9911 --ledger-prefix dry- & pids+=($!)
  cat > "$dir/shim.ts" <<'EOF'
import { appendFileSync, readFileSync } from "node:fs";
Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.SHIM_PORT), async fetch(req) {
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.text() : undefined;
  if (body !== undefined) appendFileSync(readFileSync(process.env.SHIM_PTR!, "utf8").trim(), JSON.stringify({ path: url.pathname, bytes: Buffer.byteLength(body), body }) + "\n");
  const headers = new Headers(req.headers); headers.delete("host"); headers.delete("content-length");
  const res = await fetch("http://127.0.0.1:8798" + url.pathname + url.search, { method: req.method, headers, body });
  return new Response(res.body, { status: res.status, headers: res.headers });
} });
EOF
  echo "$dir/requests-start.jsonl" > "$dir/shim-log"
  SHIM_PTR="$dir/shim-log" SHIM_PORT=$shim_port bun "$dir/shim.ts" & pids+=($!)
  for a in "$@"; do
    local arm=${a%:*} told=${a#*:}
    echo "$dir/requests-$arm.jsonl" > "$dir/shim-log"
    for _ in $(seq 1 40); do curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 && curl -fsS 127.0.0.1:$shim_port/healthz >/dev/null 2>&1 && break; sleep 0.5; done
    local extra=()
    [ "$told" = 1 ] && extra=(--ak invoke=true --ak 'skill_map={"task-public":"investigate"}')
    echo "-- $item arm $arm told=$told ($(du -h "$armdir/$arm.tar" | cut -f1) tar)"
    if [ "$driver" = harbor ]; then
    PYTHONPATH="$here/agent" ANTHROPIC_API_KEY=placeholder-not-a-key timeout 1800 harbor run -y -q -p "$dir/task-public" \
      -a laneb_agent:LanebAgent -m anthropic/claude-opus-5-5 --base-url "http://$gateway:8787" \
      --ak skip_install=true --ak persona_path="$here/agent/persona.json" --ak arm="$arm" --ak arm_tar="$(readlink -f "$armdir/$arm.tar")" \
      --ak session_cap_usd=6 --ak wrapper_path="$here/prompt-wrapper.md" --ak upstream_model=claude-opus-5-5 --ak repo_dir=/testbed --ak workdir=/testbed "${extra[@]}" \
      -e docker -o "$dir/jobs" --job-name "dry-$arm" >"$dir/harbor-$arm.log" 2>&1 || echo "harbor exited non-zero for $arm (log: $dir/harbor-$arm.log)"
    echo "reward: $(cat "$dir"/jobs/dry-$arm/*/verifier/reward.txt 2>/dev/null || echo none)"
    else
    PYTHONPATH="$here/agent" timeout 300 "$sdk_python" "$here/dryrun-direct.py" "$arm" "$(readlink -f "$armdir/$arm.tar")" "$told" "$claude_bin" "/tmp/geva106-direct/$item-$arm" \
      "http://$gateway:8787" "$dir/task-public/instruction.md" "$here/prompt-wrapper.md" >"$dir/direct-$arm.log" 2>&1 || echo "direct driver exited non-zero for $arm (log: $dir/direct-$arm.log)"
    echo "$(tail -1 "$dir/direct-$arm.log") ($SECONDS s into the dry run)"
    fi
    bun "$here/dryrun-inspect.ts" "$dir/requests-$arm.jsonl" "$arm" "$(readlink -f "$armdir/$arm.tar")" "$told" || true
  done
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  free_ports 8787 8788 8798 9911 "$shim_port"
  wait 2>/dev/null || true
  echo "-- lease check for $item"
  jq -c '{trial, spent_micros, requests, ok_responses, ledger_settle, close_reason}' "$dir/proxy-sessions.jsonl"
  bun -e "
    import { Ledger, readRows, toMicros } from '$here/ledger.ts';
    const l = new Ledger('$dir/$item.jsonl', '$item');
    const rows = readRows(l.path);
    console.log('approval rows ' + rows.filter((r) => r.kind === 'approval').length + ', reserves ' + rows.filter((r) => r.kind === 'reserve').length + ', settles ' + rows.filter((r) => r.kind === 'settle').length);
    const s = l.status();
    console.log('status: cap $' + s.capMicros / 1e6 + ', settled $' + s.settledMicros / 1e6 + ', open reserves ' + s.openIds.length);
    try { l.approve(1, {}); console.log('second approval: ACCEPTED (bad)'); } catch (e) { console.log('second approval: refused (' + e.message + ')'); }
    const over = l.reserve('dry-over-cap', s.capMicros - s.settledMicros - s.openReservedMicros + 1);
    console.log('reserve past the cap: ' + (over.ok ? 'ACCEPTED (bad)' : 'refused (' + over.reason + ')'));
    if (s.openIds.length || !rows.some((r) => r.kind === 'settle') || over.ok) process.exit(1);
  "
}

if has b || has c; then
  echo "== b, c. listing and told checks, one lease per run"
  if [ "$driver" = harbor ]; then echo "driver: Harbor trial (laneb_agent in the task container)"; else echo "driver: direct. The Harbor trial stalled after 'Skipping install' with no proxy session, so runner/dryrun-direct.py drives claude-agent-sdk $("$sdk_python" -c 'import claude_agent_sdk as s; print(s.__version__)') and Claude Code $("$claude_bin" --version | cut -d' ' -f1) on the host with laneb_agent.py's options, env and build_prompt, HOME and CLAUDE_CONFIG_DIR at the arm's extracted .claude/, through the metering proxy."; fi
  harness_run discovery-r1 100 none:0 placebo:0 gstack-rewritten:0 gstack:0
  harness_run texttax-r1 75 placebo:1 placebo-short:1
fi

if has d; then
  echo "== d. start rule"
  for r in texttax-r1 discovery-r1; do bun "$here/start-rule.ts" plan --run "$r"; done
  led=$out/start-rule-texttax-r1.jsonl
  rm -f "$led"
  bun -e "import {Ledger, toMicros} from '$here/ledger.ts'; const l = new Ledger('$led','texttax-r1'); l.approve(75, {note: 'dry run'}); l.reserve('a', toMicros(60)); l.settle('a', toMicros(60));"
  if bun "$here/start-rule.ts" check --run texttax-r1 --ledger "$led" --batch deepseek-v4.1-flash-1017 --note; then echo "over-cap case passed (bad)"; exit 1; fi
  echo "over-cap case refused; note row: $(jq -c 'select(.kind == "note") | {kind, item, pass: .start_rule.pass, bound_usd: .start_rule.bound_usd, cap_usd: .start_rule.cap_usd}' "$led")"
fi

if has e && [ -f "$root/analysis/discovery-tax.ts" ]; then
  echo "== e. analysis on synthetic job folders"
  rm -rf "$out/synthetic"
  bun "$root/tests/discovery-tax.fixtures.ts" "$out/synthetic"
  for cfg in "$out"/synthetic/*.json; do echo "--- $(basename "$cfg")"; bun "$root/analysis/discovery-tax.ts" "$cfg"; done
fi

if has f && [ -f "$root/analysis/mdd-sim.ts" ]; then
  echo "== f. MDD"
  bun "$root/analysis/mdd-sim.ts" | tee "$out/mdd.txt"
fi

if has g; then
  echo "== g. route-check commands (not run)"
  echo "PREREG=<merge sha> ITEM=discovery-r1 LEDGER=\$HOME/.capy/drive/captain-gstack-evals/ledger/discovery-r1.jsonl MODELS='claude-haiku-5-5 particle-1 claude-sonnet-5-5 claude-opus-5-5 gpt-6.1-sol' OUT=\$HOME/.capy/work/geva106/route-d quick/laneb/runner/route-check.sh"
  echo "PREREG=<merge sha> ITEM=texttax-r1 LEDGER=\$HOME/.capy/drive/captain-gstack-evals/ledger/texttax-r1.jsonl MODELS='particle-1 claude-haiku-5-5 deepseek-v4.1-flash-1017' OUT=\$HOME/.capy/work/geva106/route-t quick/laneb/runner/route-check.sh"
fi
