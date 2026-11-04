#!/usr/bin/env bash
# R3b's keyless hook check (R3 amendment 5 section 9 item 2). The told arm at gstack 699a41cb runs in Lane B's own agent
# container, through the real vm-run.sh, metering proxy, ledger service, Harbor and Lane B agent, with the contract stub
# model (runner/fake_upstream_contract.ts on 127.0.0.1:8799, the claude-opus-5-5 route's base_url) in place of a
# provider. One job runs two made-up fixture tasks in both arms, at cells.r3a4.json's Opus cell: demo__met, where the stub
# ends with a full DEBUG REPORT, and demo__unmet, where it first ends with none. The positive control: the contract Stop
# hook refuses the unmet stop (event blocked, then met_after_block once the report comes) and lets the met stop through
# (event met, no block); the route hook logs a line for each told trial; the agent copies each told trial's hook logs out,
# and r3b.ts hooks reads them (both arms run on R3b's told agent, laneb_hooks.LanebHooksAgent); the none trials carry no
# gstack state. The fixtures are e2e-r3a4's demo task (its calc.py,
# never a pool task), materialized through materializeRebench, FROM python:3.11-slim-bookworm by its Docker Hub digest.
# The task network is public, as in every local e2e, because a Capy machine's kernel can't run Harbor's egress sidecar.
# No provider key exists in any process: ~/.laneb-keys holds a placeholder for the run and is removed after.
# It ends with named assertions, each a PASS or FAIL line, and exits 0 only when every one passes.
# Needs docker, harbor (uv tool install at vm-bootstrap.sh's pin, with the pinned Agent SDK), bun, jq and python3.
# Usage: bash quick/laneb/r3/hook-check.sh <arms dir holding none.tar.gz and gstack.tar.gz> <empty work dir>
set -u
L=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd); A=$(cd "$1" && pwd); W=$(mkdir -p "$2" && cd "$2" && pwd)
[ -z "$(ls -A "$W")" ] || { echo "$W is not empty"; exit 2; }
unset ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY UBICLOUD_API_KEY UBICLOUD_API_TOKEN
mkdir -p "$W/bin" && ln -sf /usr/bin/sg "$W/bin/sg"
export PATH="$W/bin:$HOME/.local/bin:$PATH"
for p in 8787 8788 8799 9911; do if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "127.0.0.1:$p already answers; stop it first"; exit 2; fi; done
[ ! -e "$HOME/.laneb-keys" ] || { echo "$HOME/.laneb-keys exists; refusing to overwrite it"; exit 2; }
fpid=""; lpid=""
cleanup() { rm -f "$HOME/.laneb-keys"; [ -z "$fpid" ] || kill "$fpid" 2>/dev/null; [ -z "$lpid" ] || kill "$lpid" 2>/dev/null; true; }
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
(umask 077; echo "ANTHROPIC_API_KEY=dry-run-placeholder-not-a-key" > "$HOME/.laneb-keys")
echo "harbor $(harbor --version 2>/dev/null | head -1), bun $(bun --version), docker $(docker version --format '{{.Server.Version}}')"
M=$L/arms/manifests/r3b
R=$W/run
mkdir -p "$R/arms" "$R/tasks"
for arm in none gstack; do
  cp "$A/$arm.tar.gz" "$R/arms/$arm.tar.gz"
  got=$(gzip -dc "$R/arms/$arm.tar.gz" | sha256sum | cut -d' ' -f1)
  want=$(jq -r .tar.sha256 "$M/$arm.json")
  echo "arm $arm: tar sha256 $got (manifest $want)"
  [ "$got" = "$want" ] || { echo "arm $arm is not the manifest's tar; nothing ran"; exit 2; }
done
bun "$L/r3/r3b.ts" arm-check "$M" | tee "$W/arm-check.txt"
IMG=python:3.11-slim-bookworm
docker pull -q "$IMG" > /dev/null && DIG=$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMG" | sed 's/.*@//')
echo "fixture base image $IMG, digest $DIG"
fixture() {
  local F=$W/src/$1
  mkdir -p "$F/environment" "$F/tests" "$F/solution"
  printf '[task]\nname = "swe-rebench/%s"\n\n[metadata]\ndifficulty = "medium"\n\n[verifier]\ntimeout_sec = 600\n\n[agent]\ntimeout_sec = 900\n\n[environment]\nbuild_timeout_sec = 1800.0\ncpus = 2\nmemory = '"'"'8G'"'"'\nstorage = '"'"'16G'"'"'\n' "$1" > "$F/task.toml"
  cat > "$F/environment/Dockerfile" <<EOF
FROM $IMG

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /testbed
RUN printf 'def add(a, b):\\n    return a - b\\n' > calc.py && git init -q && git -c user.email=fixture@example.com -c user.name=fixture add -A && git -c user.email=fixture@example.com -c user.name=fixture commit -qm base
RUN mkdir -p /logs
EOF
  echo "calc.add(2, 3) returns -1 instead of 5. Fix it.$2" > "$F/instruction.md"
  printf '#!/bin/bash\ncd /testbed && sed -i "s/return a - b/return a + b/" calc.py\n' > "$F/solution/solve.sh"
  printf '#!/bin/bash\nset -u\npython3 /tests/parser.py\n' > "$F/tests/test.sh"
  echo "{\"instance_id\": \"$1\"}" > "$F/tests/config.json"
  cat > "$F/tests/parser.py" <<'EOF'
import json, subprocess
ok = subprocess.run(["python3", "-c", "import calc; assert calc.add(2, 3) == 5"], cwd="/testbed").returncode == 0
open("/logs/verifier/reward.txt", "w").write("1\n" if ok else "0\n")
print(json.dumps({"instance_id": json.load(open("/tests/config.json"))["instance_id"], "passed": ok}))
EOF
  bun "$W/materialize.ts" "$L" "$F" "$R/tasks/$1" "$IMG" "$DIG" "$1"
  sed -i 's/^network_mode = .*/network_mode = "public"/' "$R/tasks/$1/task.toml"
}
cat > "$W/materialize.ts" <<'EOF'
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [L, src, dest, image, digest, id] = process.argv.slice(2);
const { materializeRebench, treeDigest } = await import(L + "/runner/materialize.ts");
const files = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? files(join(d, e.name)) : 1), 0);
const task = { task_id: id, created: "2026-01", repo: "demo/demo", hub_ref: "", digest: "sha256:" + treeDigest(src), digest_files: files(src), image, image_digest: digest };
const m = materializeRebench(join(src, ".."), task, dest, { runtimeStages: readFileSync(L + "/runner/runtime-stages.Dockerfile", "utf8"), runtimeCopy: readFileSync(L + "/runner/runtime-copy.Dockerfile", "utf8"), network: "public" });
console.log("materialized " + id + ": image " + m.image + ", source digest " + m.sourceDigest);
EOF
fixture demo__met ""
fixture demo__unmet " STOP_UNMET_FIRST"
FAKE_UPSTREAM_LOG="$W/fake-upstream.jsonl" setsid bun "$L/runner/fake_upstream_contract.ts" > "$W/fake-upstream.log" 2>&1 < /dev/null &
fpid=$!
jq '.routes[.models["claude-opus-5-5"].route].base_url = "http://127.0.0.1:8799"' "$L/config/proxy.json" > "$R/proxy.json"
ns=$(jq -r .tar.sha256 "$M/none.json"); gs=$(jq -r .tar.sha256 "$M/gstack.json")
# Both arms run on laneb_hooks.LanebHooksAgent here, R3b's told arm's agent, so the none trials show there is no gstack
# state to copy; R3b's own none arm keeps Lane B's agent.
armjson=$(jq -n --arg r "$R" --arg ns "$ns" --arg gs "$gs" '[{name: "none", tar: ($r + "/arms/none.tar"), sha256: $ns, system_prompt: "claude-code-preset", gstack_hooks: "copy"}, {name: "gstack", tar: ($r + "/arms/gstack.tar"), sha256: $gs, system_prompt: "claude-code-preset", told: "investigate", procedure_line: "investigate-phases", gstack_hooks: "copy"}]')
jq -n --arg r "$R" --arg l "$L" --argjson arms "$armjson" --slurpfile c "$L/config/cells.r3a4.json" '{job_name: "r3b-hookcheck", tasks_dir: ($r + "/tasks"), tasks: ["demo__met", "demo__unmet"],
  models: [$c[0].models[] | select(.id == "claude-opus-5-5")], arms: $arms, attempts: 1, n_concurrent: 2, agent_dir: ($l + "/runner/agent"), runner_dir: ($l + "/runner"), base_url: "http://__GATEWAY__:8787",
  max_output_tokens: $c[0].max_output_tokens, verifier_timeout_multiplier: $c[0].verifier_timeout_multiplier, repo_dir: "/testbed"}' > "$R/spec.json"
bun "$L/runner/grid.ts" "$R/spec.json" "$R/job.json"
jq -n --argjson arms "$armjson" '{arms: [$arms[] | {name, sha256}]}' > "$R/manifest.json"
# The paid job runs in order.json's order, not Harbor's task-then-agent order (runner/agent/sitecustomize.py).
echo '[["demo__unmet","gstack"],["demo__met","none"],["demo__unmet","none"],["demo__met","gstack"]]' > "$R/order.json"
bun -e 'const { Ledger } = await import(process.argv[1] + "/runner/ledger.ts"); new Ledger(process.argv[2], "r3b-hookcheck").approve(60, { words: "keyless hook check, no spend", by: "hook-check.sh" });' "$L" "$R/ledger.jsonl"
setsid bun "$L/runner/ledger.ts" serve --path "$R/ledger.jsonl" --item r3b-hookcheck --port 9911 > "$R/ledger-service.log" 2>&1 < /dev/null &
lpid=$!
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:9911/status > /dev/null 2>&1 && break; sleep 0.5; done
t0=$SECONDS
setsid bash "$L/runner/vm-run.sh" "$R" "r3b-hookcheck/" 60 > "$R/vm-run.stdout" 2>&1 < /dev/null
rc=$?
echo "$rc" > "$R/vm-run.sh.rc"
echo "vm-run.sh exit $rc after $((SECONDS - t0)) s"
kill "$lpid" 2>/dev/null; wait "$lpid" 2>/dev/null; lpid=""
echo "--- trials"
for d in "$R"/jobs/r3b-hookcheck/*/; do
  [ -f "$d/config.json" ] || continue
  task=$(jq -r '.task.path | split("/") | last' "$d/config.json"); arm=$(jq -r .agent.kwargs.arm "$d/config.json")
  echo "$task $arm: reward $(cat "$d/verifier/reward.txt" 2>/dev/null || echo none), exception $(jq -r '.exception_info.exception_type // "none"' "$d/result.json" 2>/dev/null), gstack-hooks: $(cd "$d/evaluator" 2>/dev/null && find gstack-hooks -type f 2>/dev/null | sort | tr '\n' ' ')"
  bun "$L/r3/r3b.ts" hooks "$d" > "$W/hooks-$task-$arm.json"
  echo "  r3b.ts hooks: $(cat "$W/hooks-$task-$arm.json")"
  for f in "$d"/evaluator/gstack-hooks/hooks/*.log; do [ -f "$f" ] && sed 's/^/  log: /' "$f"; done
done
echo "--- stub requests that carried the hook's refusal: $(grep -c 'contract' "$W/fake-upstream.jsonl" 2>/dev/null || true)"
echo "--- leftovers: containers $(docker ps -q | wc -l)"
echo; echo "## assertions"
fails=0
ok() { if "${@:2}"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
h() { jq -e "$2" "$W/hooks-$1.json" > /dev/null 2>&1; }
trials() { local n=0 d; for d in "$R"/jobs/r3b-hookcheck/*/; do [ -f "$d/config.json" ] || continue; n=$((n + 1)); [ "$(cat "$d/verifier/reward.txt" 2>/dev/null)" = 1 ] || return 1; [ "$(jq -r '.exception_info.exception_type // "none"' "$d/result.json" 2>/dev/null)" = none ] || return 1; done; [ "$n" = 4 ]; }
first2() { for d in "$R"/jobs/r3b-hookcheck/*/; do [ -f "$d/result.json" ] && echo "$(jq -r .started_at "$d/result.json") $(jq -r '.task.path | split("/") | last' "$d/config.json")/$(jq -r .agent.kwargs.arm "$d/config.json")"; done | sort | head -2 | cut -d' ' -f2 | sort | paste -sd' '; }
ok "the arm check passes: both hook entries in the told arm's settings.json" grep -q '^arm-check: pass' "$W/arm-check.txt"
ok "Harbor applied order.json (laneb order: applied 4 trials)" grep -q 'laneb order: applied 4 trials' "$R/out/harbor.log"
ok "the first two trials to start are order.json's first two (told demo__unmet, none demo__met)" [ "$(first2)" = "demo__met/none demo__unmet/gstack" ]
ok "vm-run.sh exits 0" [ "$rc" = 0 ]
ok "all four trials (2 tasks x none and told) reach the verifier with reward 1 and no exception" trials
ok "told demo__unmet: the Stop hook ran and held a stop back (event blocked)" h demo__unmet-gstack '.stop_hook_ran == true and .held_back == true'
ok "told demo__unmet: the hook let the next stop through once the report came (met_after_block)" h demo__unmet-gstack '.outcome == "met_after_block"'
ok "told demo__met: the Stop hook ran and passed the stop with no block (event met)" h demo__met-gstack '.stop_hook_ran == true and .held_back == false and .outcome == "met"'
ok "both told trials: the route hook logged a line" h demo__met-gstack '.route_hook_ran == true' && h demo__unmet-gstack '.route_hook_ran == true'
ok "both none trials: no gstack hook state" h demo__met-none '.stop_hook_ran == false and .route_hook_ran == false and .files == 0' && h demo__unmet-none '.stop_hook_ran == false and .route_hook_ran == false and .files == 0'
exit $((fails > 0))
