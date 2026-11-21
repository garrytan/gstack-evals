#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# B2's keyless driven launch test, one session end to end on one harness: a fake upstream (Lane B's fake Anthropic Messages
# upstream for a Claude Code part, fake-responses.ts for the Sol part) -> Lane B's metering proxy on the part's own
# proxy.json routes with a scratch ledger -> Harbor -> the part's own agent (Lane B's Claude agent, or B2's Codex agent with
# Codex 0.170.0) in the real SWE-rebench task image the part built, with the arm's home -> the task's verifier -> B2's session
# table. No key, no spend. After part R's smoke (lanes/codex-hooks/r/smoke.sh on the Codex hooks branch).
# WORK is a dir `b2 prepare --item b2-pilot` made. Every network mode is public (a Capy cloud kernel cannot run the egress
# sidecar). Harbor and the Agent SDK at Lane B's pins (runner/vm-bootstrap.sh) must be on PATH.
# Lane B stages a big arm tar gzipped and vm-run.sh unpacks it on the part VM; this script unpacks it into OUT the same way.
# Usage: WORK=<prepared dir> PART=pilot-opus|pilot-sol|pilot-p1 [TASK=tox-dev__tox-3810] [ARM=<label>] [OUT=<dir>] lanes/test-first/smoke.sh
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
runner=$repo/quick/laneb/runner
part=$WORK/${PART:?PART=pilot-opus, pilot-sol or pilot-p1}
task=${TASK:-tox-dev__tox-3810}
host=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$part/manifest.json','utf8')).b2.host)")
arm=${ARM:-$([ "$host" = codex ] && echo cx-prove-it || echo prove-it)}
out=${OUT:-${TMPDIR:-/tmp}/b2-smoke-$PART}
rm -rf "$out" && mkdir -p "$out/tasks" "$out/arms"
cp -r "$part/tasks/$task" "$out/tasks/$task"
for f in "$part"/arms/*.tar; do [ -e "$f" ] && cp "$f" "$out/arms/"; done
for gz in "$part"/arms/*.tar.gz; do [ -e "$gz" ] && gzip -dc "$gz" > "$out/arms/$(basename "$gz" .gz)"; done
sed -i 's/^network_mode = .*/network_mode = "public"/' "$out/tasks/$task/task.toml"
gateway=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
PART_DIR="$part" RUNNER="$runner" GATEWAY="$gateway" ARM="$arm" OUT="$out" TASK="$task" bun -e '
const fs = require("node:fs"), e = process.env;
const proxy = JSON.parse(fs.readFileSync(e.PART_DIR + "/proxy.json", "utf8"));
for (const r of Object.keys(proxy.routes)) proxy.routes[r] = { ...proxy.routes[r], base_url: "http://127.0.0.1:8799", key_env: "FAKE_UPSTREAM_KEY" };
fs.writeFileSync(e.OUT + "/proxy.json", JSON.stringify(proxy, null, 2));
const path = require("node:path"), raw = fs.readFileSync(e.PART_DIR + "/job.json", "utf8"), k0 = JSON.parse(raw).agents[0].kwargs;
const arms = path.dirname(k0.arm_tar) + "/", run = path.dirname(path.dirname(k0.arm_tar)) + "/", runner = path.dirname(path.dirname(k0.persona_path)) + "/";
const job = JSON.parse(raw.replaceAll(runner, e.RUNNER + "/").replaceAll(arms, e.OUT + "/arms/").replaceAll(run, e.PART_DIR + "/").replaceAll("__GATEWAY__", e.GATEWAY));
job.job_name = "smoke"; job.jobs_dir = e.OUT + "/jobs"; job.n_concurrent_trials = 1; job.retry = { ...job.retry, max_retries: 0 };
job.agents = job.agents.filter((a) => a.kwargs.arm === e.ARM);
if (job.agents.length !== 1) throw new Error("E_USAGE no agent for arm " + e.ARM + " in " + e.PART_DIR + "/job.json");
job.tasks = [{ path: e.OUT + "/tasks/" + e.TASK }];
job.environment.extra_docker_compose = (job.environment.extra_docker_compose ?? []).filter((f) => fs.existsSync(f));
fs.writeFileSync(e.OUT + "/job.json", JSON.stringify(job, null, 2));
'
bun -e "import {Ledger} from '$runner/ledger.ts'; new Ledger('$out/ledger.jsonl','smoke').approve(20, {note: 'smoke test, no spend'})"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
if [ "$host" = codex ]; then FAKE_UPSTREAM_LOG="$out/fake-upstream.jsonl" bun "$repo/lanes/test-first/fake-responses.ts" & pids+=($!)
else FAKE_UPSTREAM_LOG="$out/fake-upstream.jsonl" bun "$runner/fake_upstream.ts" & pids+=($!); fi
bun "$runner/ledger.ts" serve --path "$out/ledger.jsonl" --item smoke --port 9911 & pids+=($!)
FAKE_UPSTREAM_KEY=fake bun "$runner/proxy.ts" --config "$out/proxy.json" --data-host "$gateway" --data-port 8787 --control-port 8788 \
  --log "$out/proxy-requests.jsonl" --sessions "$out/proxy-sessions.jsonl" --ledger-url http://127.0.0.1:9911 --ledger-prefix smoke- & pids+=($!)
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 && curl -fsS 127.0.0.1:8799/healthz >/dev/null 2>&1 && break; sleep 0.5; done
env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u TYPESAFE_API_KEY ANTHROPIC_API_KEY=placeholder-not-a-key OPENAI_API_KEY=placeholder-not-a-key \
  PYTHONPATH="$runner/agent" HARBOR_TELEMETRY=0 harbor run -y -c "$out/job.json" > "$out/harbor.log" 2>&1 || echo "harbor exit $?"
printf '{"jobs": [{"dir": "%s", "part": "smoke"}], "sessions": ["%s"], "requests": ["%s"]}\n' "$out/jobs/smoke" "$out/proxy-sessions.jsonl" "$out/proxy-requests.jsonl" > "$out/table-config.json"
bun "$repo/lanes/test-first/cli.ts" table "$out/table-config.json" "$out/table.jsonl"
bun -e "
const rows = require('fs').readFileSync('$out/table.jsonl', 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
for (const r of rows) console.log(JSON.stringify({ host: r.host, arm: r.label, task: r.task, outcome: r.outcome, reason: r.reason, reward: r.reward, model: r.model, cli: r.cli_version, effort: r.effort, metered_effort: r.metered_effort, cost_usd: r.cost_usd, steps_seen: r.steps_seen, line_seen: r.line_seen, listed: r.skills_listed.length, routing_named: r.routing_named, start_seen: r.start_seen, followed_b2: r.followed_b2, unreadable: r.unreadable_items }));
if (!rows.length) { console.error('E_B2_TABLE no session row; see $out/harbor.log'); process.exit(1); }
"
bun "$runner/ledger.ts" status --path "$out/ledger.jsonl" --item smoke
