#!/usr/bin/env bash
# Keyless dry run for Run D's preregistration (GEVA-125, section 10). No provider key, no Ubicloud call, no spend.
#   a  builds the variant tars twice and compares digests; prepare-run for each Run D batch (invoke off, MAX_TURNS=60,
#      preset cells on every model, sdk-default cells on Opus and Haiku)
#   b  listing check through the real proxy and ledger service, with the fake upstream behind a pass-through shim that
#      records each request body; one cell at a time, both system prompts
#   c  one lease for the run on a temp ledger (b's sessions reserve and settle through the proxy)
#   d  start rule: the planned order, and an over-cap case that writes its note row
#   e  analysis on synthetic job folders     f  MDD simulation     g  the route-check command (not run)
# Usage: ARMS_DIR=<dir with none.tar gstack.tar placebo.tar> OUT=<empty work dir> TB2=<terminal-bench-2 checkout>
#        CLAUDE_BIN=<Claude Code 2.1.312 binary> SDK_PYTHON=<python with claude-agent-sdk 0.2.174> runner/dryrun-discovery.sh [steps]
set -euo pipefail
for k in ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY UBICLOUD_API_KEY; do
  if [ -n "${!k:-}" ]; then echo "E_USAGE unset $k: the dry run is keyless" >&2; exit 2; fi
done
for k in ARMS_DIR OUT TB2 CLAUDE_BIN SDK_PYTHON; do
  if [ -z "${!k:-}" ]; then echo "E_USAGE set $k (see the usage line)" >&2; exit 2; fi
done
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
armsrc=$ARMS_DIR
out=$OUT
export TB2
steps=" ${*:-a b c d e f g} "
sdk_python=$SDK_PYTHON
claude_bin=$CLAUDE_BIN
direct_root=${DIRECT_ROOT:-/tmp/rund-direct}
PRESET=claude-code-preset
SDK=sdk-default
MODELS="claude-haiku-5-5 particle-1 claude-sonnet-5-5 claude-opus-5-5 gpt-6.1-sol"
both() { [ "$1" = claude-opus-5-5 ] || [ "$1" = claude-haiku-5-5 ]; }
cells_csv() {
  local m=$1 a cells=()
  for a in none gstack gstack-rewritten placebo; do cells+=("$a:system_prompt=$PRESET"); done
  if both "$m"; then for a in none gstack gstack-rewritten; do cells+=("$a:system_prompt=$SDK"); done; fi
  (IFS=,; echo "${cells[*]}")
}
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
  rm -rf "$out/variants" "$armdir" "$out"/run-d-*
  for b in b1 b2; do bun "$root/arms/variants.ts" --in "$armsrc" --out "$out/variants/$b" | grep -E 'manifest|tokens'; done
  (cd "$out/variants" && sha256sum b1/gstack-rewritten.tar b2/gstack-rewritten.tar)
  [ "$(sha256sum < "$out/variants/b1/gstack-rewritten.tar")" = "$(sha256sum < "$out/variants/b2/gstack-rewritten.tar")" ] || { echo "variants: gstack-rewritten digests differ"; exit 1; }
  echo "variants: both builds give the same gstack-rewritten digest; manifest $(jq -r .tar.sha256 "$root/arms/manifests/gstack-rewritten.json")"
  for t in gstack placebo; do echo "entries of $t.tar carrying '$SHIPPED':"; bun "$root/arms/variants.ts" --carriers "$armsrc/$t.tar" "$SHIPPED" | sed 's/^/  /'; done
  echo "gstack-rewritten investigate frontmatter:"; tar -xOf "$out/variants/b1/gstack-rewritten.tar" .claude/skills/investigate/SKILL.md | sed -n '1,6p' | cut -c1-140 | sed 's/^/  /'
  mkdir -p "$armdir"
  for t in none gstack placebo; do ln -sf "$armsrc/$t.tar" "$armdir/$t.tar"; done
  ln -sf "$out/variants/b1/gstack-rewritten.tar" "$armdir/gstack-rewritten.tar"
  git -C "$TB2" checkout -q 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c
  final=$(jq -r '.tasks | join(",")' "$root/tasks/final.json")
  tasks=$(echo "$final" | tr ',' '\n' | grep -vxE 'crack-7z-hash|adaptive-rejection-sampler|largest-eigenval' | paste -sd,)
  for m in $MODELS; do
    MAX_TURNS=60 TASKS=$tasks bun "$here/prepare-run.ts" "$out/run-d-$m" "discovery-r1-$m-dry" "$m" "$(cells_csv "$m")" "$armdir" 1 12 off >/dev/null
    r=$out/run-d-$m
    echo "run-d-$m: $(jq '.tasks | length' "$r/job.json") tasks, $(jq '.agents | length' "$r/job.json") cells, manifest invoke=$(jq -c '.invoke' "$r/manifest.json") max_turns=$(jq -c '.max_turns' "$r/manifest.json"), arm tars copied $(ls "$r/arms" | wc -l)"
    jq -r '.arms[] | "  manifest \(.label): sha256 \(.sha256[0:12]) system_prompt=\(.system_prompt)"' "$r/manifest.json"
    jq -r '.agents[] | "  job \(.kwargs.upstream_model) \(.kwargs.arm) system_prompt=\(.kwargs.system_prompt) sdk_max_turns=\(.kwargs.sdk_max_turns) invoke=\(.kwargs.invoke) skill_map=\(.kwargs.skill_map | length)"' "$r/job.json"
    rm -rf "$r/arms" "$r/tasks"
  done
  if MAX_TURNS=60 TASKS=$tasks bun "$here/prepare-run.ts" "$out/run-d-dup" dup claude-haiku-5-5 "gstack:system_prompt=$PRESET,gstack:system_prompt=$PRESET" "$armdir" 1 12 off >/dev/null 2>"$out/dup.err"; then echo "duplicate cell accepted (bad)"; exit 1; fi
  echo "a cell listed twice is refused: $(grep -m1 -o '^error: E_USAGE.*' "$out/dup.err")"
fi

# One harness: fake upstream behind the recording shim, the run's temp ledger service, the metering proxy.
harness_run() {
  local item=$1 cap=$2 shim_port=8799; shift 2
  local dir=$out/harness-$item
  rm -rf "$dir" && mkdir -p "$dir"
  cp -r "$here/smoke-task" "$dir/task-public" && sed -i 's/^network_mode = .*/network_mode = "public"/' "$dir/task-public/task.toml"
  cat > "$dir/proxy.json" <<EOF
{"routes": {"fake": {"base_url": "http://127.0.0.1:$shim_port", "key_env": "FAKE_UPSTREAM_KEY", "auth": "x-api-key", "count_tokens": "estimate"}},
 "models": {"claude-opus-5-5": {"route": "fake", "upstream_model": "claude-opus-5-5", "price_per_mtok": {"input": 5, "output": 25, "cache_write_5m": 6.25, "cache_write_1h": 10, "cache_read": 0.5}}}}
EOF
  bun -e "import {Ledger} from '$here/ledger.ts'; new Ledger('$dir/$item.jsonl','$item').approve($cap, {note: 'Run D dry run, temp ledger, no spend'})"
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
  for cell in "$@"; do
    local arm=${cell%@*} sp=${cell#*@}
    echo "$dir/requests-$cell.jsonl" > "$dir/shim-log"
    for _ in $(seq 1 40); do curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 && curl -fsS 127.0.0.1:$shim_port/healthz >/dev/null 2>&1 && break; sleep 0.5; done
    echo "-- $item cell $cell ($(du -h "$armdir/$arm.tar" | cut -f1) tar)"
    PYTHONPATH="$here/agent" timeout 300 "$sdk_python" "$here/dryrun-direct.py" "$arm" "$(readlink -f "$armdir/$arm.tar")" 0 "$claude_bin" "$direct_root/$cell" \
      "http://$gateway:8787" "$dir/task-public/instruction.md" "$here/prompt-wrapper.md" "$sp" 60 >"$dir/direct-$cell.log" 2>&1 || echo "direct driver exited non-zero for $cell (log: direct-$cell.log)"
    grep '^init ' "$dir/direct-$cell.log" || echo "$cell: no init record"
    tail -1 "$dir/direct-$cell.log"
    bun "$here/dryrun-inspect.ts" "$dir/requests-$cell.jsonl" "$cell" "$(readlink -f "$armdir/$arm.tar")" 0 || true
  done
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  free_ports 8787 8788 8798 9911 "$shim_port"
  wait 2>/dev/null || true
  echo "-- lease check for $item"
  jq -c '{trial, spent_micros, requests, ok_responses, ledger_settle, close_reason}' "$dir/proxy-sessions.jsonl"
  bun -e "
    import { Ledger, readRows } from '$here/ledger.ts';
    const l = new Ledger('$dir/$item.jsonl', '$item');
    const rows = readRows(l.path);
    console.log('approval rows ' + rows.filter((r) => r.kind === 'approval').length + ', reserves ' + rows.filter((r) => r.kind === 'reserve').length + ', settles ' + rows.filter((r) => r.kind === 'settle').length);
    const s = l.status();
    console.log('status: cap \$' + s.capMicros / 1e6 + ', settled \$' + s.settledMicros / 1e6 + ', open reserves ' + s.openIds.length);
    try { l.approve(1, {}); console.log('second approval: ACCEPTED (bad)'); } catch (e) { console.log('second approval: refused (' + e.message + ')'); }
    const over = l.reserve('dry-over-cap', s.capMicros - s.settledMicros - s.openReservedMicros + 1);
    console.log('reserve past the cap: ' + (over.ok ? 'ACCEPTED (bad)' : 'refused (' + over.reason + ')'));
    if (s.openIds.length || !rows.some((r) => r.kind === 'settle') || over.ok) process.exit(1);
  "
}

if has b || has c; then
  echo "== b, c. listing check under both system prompts, one lease for the run"
  echo "driver: direct. runner/dryrun-direct.py drives claude-agent-sdk $("$sdk_python" -c 'import claude_agent_sdk as s; print(s.__version__)') and Claude Code $("$claude_bin" --version | cut -d' ' -f1) on the host with laneb_agent.py's options (its SYSTEM_PROMPTS, max_turns 60), env and build_prompt, HOME and CLAUDE_CONFIG_DIR at the arm's extracted .claude/, through the metering proxy."
  harness_run discovery-r1 125 none@$PRESET gstack@$PRESET gstack-rewritten@$PRESET placebo@$PRESET none@$SDK gstack@$SDK gstack-rewritten@$SDK
fi

if has d; then
  echo "== d. start rule"
  bun "$here/start-rule.ts" plan --run discovery-r1
  led=$out/start-rule-discovery-r1.jsonl
  rm -f "$led"
  bun -e "import {Ledger, toMicros} from '$here/ledger.ts'; const l = new Ledger('$led','discovery-r1'); l.approve(125, {note: 'dry run'}); l.reserve('a', toMicros(95)); l.settle('a', toMicros(95));"
  if bun "$here/start-rule.ts" check --run discovery-r1 --ledger "$led" --batch gpt-6.1-sol --note >/dev/null; then echo "over-cap case passed (bad)"; exit 1; fi
  echo "over-cap case (95 settled, then gpt-6.1-sol) refused; note row: $(jq -c 'select(.kind == "note") | {kind, item, pass: .start_rule.pass, bound_usd: .start_rule.bound_usd, cap_usd: .start_rule.cap_usd}' "$led")"
fi

if has e; then
  echo "== e. analysis on synthetic job folders"
  rm -rf "$out/synthetic"
  bun "$root/tests/discovery-tax.fixtures.ts" "$out/synthetic"
  for cfg in "$out"/synthetic/run-d*.json; do echo "--- $(basename "$cfg")"; bun "$root/analysis/discovery-tax.ts" "$cfg"; done
fi

if has f; then
  echo "== f. MDD"
  bun "$root/analysis/mdd-sim.ts" 2>/dev/null | tee "$out/mdd.txt"
fi

if has g; then
  echo "== g. route-check command (not run)"
  echo "PREREG=<merge sha> ITEM=discovery-r1 LEDGER=<captain drive>/ledger/discovery-r1.jsonl MODELS='$MODELS' SYSTEM_PROMPT=$PRESET MAX_TURNS=60 OUT=<work>/route-d quick/laneb/runner/route-check.sh"
fi
