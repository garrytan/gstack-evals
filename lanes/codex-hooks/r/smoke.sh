#!/usr/bin/env bash
# Keyless end-to-end smoke of part R: a fake Responses upstream (fake-responses.ts) -> Lane B's metering proxy on its
# Responses route with a scratch ledger -> Harbor -> the Codex agent (laneb_codex.py) -> Codex 0.170 in a real SWE-rebench
# task image, with one arm's home -> the task's verifier -> part R's session table and detector. No key, no spend.
# WORK is a dir `r prepare --item r-pilot` made (its tasks/, arms/ and job.json). Every network mode is public, as in Lane
# B's smoke (a Capy cloud kernel cannot run the egress sidecar).
# Usage: WORK=<prepared r-pilot dir> [TASK=delgan__loguru-1425] [ARM=r-on] [OUT=<dir>] lanes/codex-hooks/r/smoke.sh
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd)
runner=$repo/quick/laneb/runner
work=${WORK:?WORK=<a dir r prepare made>}
task=${TASK:-delgan__loguru-1425}
arm=${ARM:-r-on}
out=${OUT:-${TMPDIR:-/tmp}/codex-hooks-r-smoke}
rm -rf "$out" && mkdir -p "$out"
mkdir -p "$out/tasks" && cp -r "$work/tasks/$task" "$out/tasks/$task"
sed -i 's/^network_mode = .*/network_mode = "public"/' "$out/tasks/$task/task.toml"
gateway=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
WORK="$work" RUNNER="$runner" GATEWAY="$gateway" ARM="$arm" OUT="$out" REPO="$repo" TASK="$task" bun -e '
const fs = require("node:fs"), e = process.env;
const proxy = JSON.parse(fs.readFileSync(e.REPO + "/lanes/codex-hooks/r/proxy.json", "utf8"));
proxy.routes.openai = { ...proxy.routes.openai, base_url: "http://127.0.0.1:8799", key_env: "FAKE_UPSTREAM_KEY" };
fs.writeFileSync(e.OUT + "/proxy.json", JSON.stringify(proxy, null, 2));
const path = require("node:path"), raw = fs.readFileSync(e.WORK + "/job.json", "utf8"), k0 = JSON.parse(raw).agents[0].kwargs;
const up2 = (p) => path.dirname(path.dirname(p)) + "/";
const job = JSON.parse(raw.replaceAll(up2(k0.arm_tar), e.WORK + "/").replaceAll(up2(k0.persona_path), e.RUNNER + "/").replaceAll("__GATEWAY__", e.GATEWAY));
job.job_name = "smoke"; job.jobs_dir = e.OUT + "/jobs"; job.n_concurrent_trials = 1; job.retry = { ...job.retry, max_retries: 0 };
job.agents = job.agents.filter((a) => a.kwargs.arm === e.ARM);
if (job.agents.length !== 1) throw new Error("E_USAGE no agent for arm " + e.ARM + " in " + e.WORK + "/job.json");
job.tasks = [{ path: e.OUT + "/tasks/" + e.TASK }];
job.environment.extra_docker_compose = (job.environment.extra_docker_compose ?? []).filter((f) => fs.existsSync(f));
fs.writeFileSync(e.OUT + "/job.json", JSON.stringify(job, null, 2));
'
bun -e "import {Ledger} from '$runner/ledger.ts'; new Ledger('$out/ledger.jsonl','smoke').approve(20, {note: 'smoke test, no spend'})"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
FAKE_UPSTREAM_LOG="$out/fake-upstream.jsonl" bun "$repo/lanes/codex-hooks/r/fake-responses.ts" & pids+=($!)
bun "$runner/ledger.ts" serve --path "$out/ledger.jsonl" --item smoke --port 9911 & pids+=($!)
FAKE_UPSTREAM_KEY=fake bun "$runner/proxy.ts" --config "$out/proxy.json" --data-host "$gateway" --data-port 8787 --control-port 8788 \
  --log "$out/proxy-requests.jsonl" --sessions "$out/proxy-sessions.jsonl" --ledger-url http://127.0.0.1:9911 --ledger-prefix smoke- & pids+=($!)
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 && curl -fsS 127.0.0.1:8799/healthz >/dev/null 2>&1 && break; sleep 0.5; done
env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u TYPESAFE_API_KEY OPENAI_API_KEY=placeholder-not-a-key \
  PYTHONPATH="$runner/agent" HARBOR_TELEMETRY=0 harbor run -y -c "$out/job.json" > "$out/harbor.log" 2>&1 || echo "harbor exit $?"
printf '{"jobs": [{"dir": "%s", "part": "smoke"}], "sessions": ["%s"], "requests": ["%s"]}\n' "$out/jobs/smoke" "$out/proxy-sessions.jsonl" "$out/proxy-requests.jsonl" > "$out/table-config.json"
bun "$repo/lanes/codex-hooks/cli.ts" r table "$out/table-config.json" "$out/table.jsonl"
bun -e "
const rows = require('fs').readFileSync('$out/table.jsonl', 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
for (const r of rows) console.log(JSON.stringify({ arm: r.arm, task: r.task, outcome: r.outcome, reason: r.reason, reward: r.reward, cost_usd: r.cost_usd, codex: r.root?.cli_version, models: r.root?.models, efforts: r.root?.efforts, loaded: r.loads?.prove_it, line_delivered: r.loads?.line_delivered, hook: r.loads?.hook, destructive: r.destructive }));
if (!rows.length) { console.error('E_CODEX_R_SMOKE no session row; see $out/harbor.log'); process.exit(1); }
"
bun "$runner/ledger.ts" status --path "$out/ledger.jsonl" --item smoke
