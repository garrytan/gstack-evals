#!/usr/bin/env bash
# R3c's keyless capture (R3 amendment 6 section 10, the build gate's transcript and Stop hook checks). Both R3c arms run in
# Lane B's own agent container through the real vm-run.sh, metering proxy, ledger service, Harbor, Lane B agent, Agent SDK
# and Claude Code 2.1.312, against the stub model runner/fake_upstream_r3c.ts on 127.0.0.1:8799 in place of a provider. The
# stub writes a ROOT CAUSE FILES block in three places: a thinking block (a wrong file), a subagent's text (a second wrong
# file) and the main thread's last message (calc.py), except in demo__nomain, where the main thread writes none. One job runs
# three made-up fixture tasks, demo__met, demo__unmet and demo__nomain, with demo__met listed twice, in both arms, under an
# order.json that names the repeated trials; the oracle job runs as on a paid VM. The fixtures are hook-check.sh's calc.py demo (never a pool task), materialized through materializeRebench, with a
# verifier parser that writes report.json in the pool parser's shape.
# It asserts that the agent logs parent_tool_use_id on every assistant record, that r3c.ts readClosing reads calc.py from
# every demo__met and demo__unmet trial and nothing from either demo__nomain trial (a block only in a thinking block or a
# subagent message is not read), never a wrong file, that the told arm's contract Stop hook lets a DEBUG REPORT followed by the closing block
# stop and refuses the unmet stop while the block before its continuation still counts, that Harbor keeps report.json and the
# oracle's model.patch, and that Harbor runs a job that lists a task twice in order.json's order. It copies each trial's
# sdk-messages.jsonl to <work dir>/capture/.
# No provider key exists in any process: ~/.laneb-keys holds a placeholder for the run and is removed after. The task network
# is public, as in every local e2e, because a Capy machine's kernel can't run Harbor's egress sidecar.
# Needs docker, harbor (uv tool install at vm-bootstrap.sh's pin, with the pinned Agent SDK), bun, jq and python3.
# Usage: bash quick/laneb/r3/r3c-capture.sh <arms dir holding none.tar.gz and gstack.tar.gz> <empty work dir>
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
mkdir -p "$R/arms" "$R/tasks" "$W/capture"
for arm in none gstack; do
  cp "$A/$arm.tar.gz" "$R/arms/$arm.tar.gz"
  got=$(gzip -dc "$R/arms/$arm.tar.gz" | sha256sum | cut -d' ' -f1); want=$(jq -r .tar.sha256 "$M/$arm.json")
  echo "arm $arm: tar sha256 $got (manifest $want)"
  [ "$got" = "$want" ] || { echo "arm $arm is not the manifest's tar; nothing ran"; exit 2; }
done
IMG=python:3.11-slim-bookworm
docker pull -q "$IMG" > /dev/null && DIG=$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMG" | sed 's/.*@//')
echo "fixture base image $IMG, digest $DIG"
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
  printf '#!/bin/bash\nset -u\nmkdir -p /logs/verifier\npython3 /tests/parser.py\n' > "$F/tests/test.sh"
  echo "{\"instance_id\": \"$1\", \"FAIL_TO_PASS\": [\"tests/test_calc.py::test_add\"], \"PASS_TO_PASS\": [\"tests/test_calc.py::test_import\"]}" > "$F/tests/config.json"
  cat > "$F/tests/parser.py" <<'EOF'
import json, subprocess
run = lambda code: "PASSED" if subprocess.run(["python3", "-c", code], cwd="/testbed").returncode == 0 else "FAILED"
report = {"fail_to_pass": {"tests/test_calc.py::test_add": run("import calc; assert calc.add(2, 3) == 5")}, "pass_to_pass": {"tests/test_calc.py::test_import": run("import calc")}}
report["resolved"] = all(v in ("PASSED", "XFAIL") for d in (report["fail_to_pass"], report["pass_to_pass"]) for v in d.values())
open("/logs/verifier/report.json", "w").write(json.dumps(report, indent=2))
open("/logs/verifier/reward.txt", "w").write("1\n" if report["resolved"] else "0\n")
EOF
  bun "$W/materialize.ts" "$L" "$F" "$R/tasks/$1" "$IMG" "$DIG" "$1" || exit 2
  sed -i 's/^network_mode = .*/network_mode = "public"/' "$R/tasks/$1/task.toml"
}
fixture demo__met ""
fixture demo__unmet " STOP_UNMET_FIRST"
fixture demo__nomain " NO_MAIN_BLOCK"
FAKE_UPSTREAM_LOG="$W/fake-upstream.jsonl" setsid bun "$L/runner/fake_upstream_r3c.ts" > "$W/fake-upstream.log" 2>&1 < /dev/null &
fpid=$!
jq '.routes[.models["claude-opus-5-5"].route].base_url = "http://127.0.0.1:8799"' "$L/config/proxy.json" > "$R/proxy.json"
armspec=$(bun -e 'const { armSpec } = await import(process.argv[1] + "/runner/grid.ts"); const { R3C_NONE, R3C_TOLD } = await import(process.argv[1] + "/r3/r3c.ts"); console.log(JSON.stringify([armSpec(R3C_NONE), armSpec(R3C_TOLD)]));' "$L") || exit 2
echo "arms: $armspec"
ns=$(jq -r .tar.sha256 "$M/none.json"); gs=$(jq -r .tar.sha256 "$M/gstack.json")
armjson=$(jq -n --arg r "$R" --arg ns "$ns" --arg gs "$gs" --argjson s "$armspec" '[($s[0] + {tar: ($r + "/arms/none.tar"), sha256: $ns}), ($s[1] + {tar: ($r + "/arms/gstack.tar"), sha256: $gs})]')
jq -n --arg r "$R" --arg l "$L" --argjson arms "$armjson" --slurpfile c "$L/config/cells.r3a4.json" '{job_name: "r3c-capture", tasks_dir: ($r + "/tasks"), tasks: ["demo__met", "demo__unmet", "demo__met", "demo__nomain"],
  models: [$c[0].models[] | select(.id == "claude-opus-5-5")], arms: $arms, attempts: 1, n_concurrent: 2, agent_dir: ($l + "/runner/agent"), runner_dir: ($l + "/runner"), base_url: "http://__GATEWAY__:8787",
  max_output_tokens: $c[0].max_output_tokens, verifier_timeout_multiplier: $c[0].verifier_timeout_multiplier, repo_dir: "/testbed"}' > "$R/spec.json"
bun "$L/runner/grid.ts" "$R/spec.json" "$R/job.json" || exit 2
jq '. + {job_name: "r3c-capture-oracle", n_attempts: 1, agents: [{name: "oracle"}], tasks: (.tasks | unique)}' "$R/job.json" > "$R/oracle.json"
jq -n --argjson arms "$armjson" '{arms: [$arms[] | {name, sha256}]}' > "$R/manifest.json"
echo '[["demo__unmet","gstack"],["demo__met","none"],["demo__nomain","none"],["demo__met","gstack"],["demo__unmet","none"],["demo__met","none"],["demo__nomain","gstack"],["demo__met","gstack"]]' > "$R/order.json"
bun -e 'const { Ledger } = await import(process.argv[1] + "/runner/ledger.ts"); new Ledger(process.argv[2], "r3c-capture").approve(90, { words: "keyless capture, no spend", by: "r3c-capture.sh" });' "$L" "$R/ledger.jsonl"
setsid bun "$L/runner/ledger.ts" serve --path "$R/ledger.jsonl" --item r3c-capture --port 9911 > "$R/ledger-service.log" 2>&1 < /dev/null &
lpid=$!
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:9911/status > /dev/null 2>&1 && break; sleep 0.5; done
t0=$SECONDS
setsid bash "$L/runner/vm-run.sh" "$R" "r3c-capture/" 90 > "$R/vm-run.stdout" 2>&1 < /dev/null
rc=$?
echo "vm-run.sh exit $rc after $((SECONDS - t0)) s"
kill "$lpid" 2>/dev/null; wait "$lpid" 2>/dev/null; lpid=""
echo "--- trials"
cat > "$W/read.ts" <<'EOF'
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [L, d] = process.argv.slice(2);
const { readClosing, testRecord } = await import(L + "/r3/r3c.ts");
const { hookState } = await import(L + "/r3/r3b.ts");
const lines = existsSync(join(d, "evaluator/sdk-messages.jsonl")) ? readFileSync(join(d, "evaluator/sdk-messages.jsonl"), "utf8").split("\n") : [];
const recs = lines.filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => r.type === "AssistantMessage");
const blocks = recs.flatMap((r) => (Array.isArray(r.content) ? r.content : []));
const ev = existsSync(join(d, "evaluator/usersim-events.jsonl")) ? readFileSync(join(d, "evaluator/usersim-events.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
const prompt = ev.find((e) => e.event === "prompt") ?? null;
console.log(JSON.stringify({ closing: readClosing(lines), assistant_records: recs.length, with_parent_field: recs.filter((r) => "parent_tool_use_id" in r).length, subagent_records: recs.filter((r) => r.parent_tool_use_id).length,
  subagent_wrong: recs.some((r) => r.parent_tool_use_id && JSON.stringify(r.content).includes("wrong_subagent.py")), thinking_blocks: blocks.filter((b) => b && "thinking" in b).length,
  thinking_wrong: blocks.some((b) => b && "thinking" in b && String(b.thinking).includes("wrong_thinking.py")), report: testRecord(d), hooks: hookState(d), closing_line: prompt?.closing_line ?? null }));
EOF
n=0
for d in "$R"/jobs/r3c-capture/*/; do
  [ -f "$d/config.json" ] || continue
  task=$(jq -r '.task.path | split("/") | last' "$d/config.json"); arm=$(jq -r .agent.kwargs.arm "$d/config.json"); n=$((n + 1))
  cp "$d/evaluator/sdk-messages.jsonl" "$W/capture/$task-$arm-$n.jsonl" 2>/dev/null
  bun "$W/read.ts" "$L" "$d" > "$W/read-$task-$arm-$n.json"
  echo "$task $arm #$n: reward $(cat "$d/verifier/reward.txt" 2>/dev/null || echo none), exception $(jq -r '.exception_info.exception_type // "none"' "$d/result.json" 2>/dev/null), read $(cat "$W/read-$task-$arm-$n.json")"
done
for d in "$R"/jobs/r3c-capture-oracle/*/; do
  [ -f "$d/config.json" ] || continue
  echo "oracle $(jq -r '.task.path | split("/") | last' "$d/config.json"): reward $(cat "$d/verifier/reward.txt" 2>/dev/null || echo none), model.patch $( [ -s "$d/artifacts/logs/artifacts/model.patch" ] && echo present || echo missing), report.json $( [ -s "$d/verifier/report.json" ] && echo present || echo missing)"
done
echo "--- stub replies: $(jq -c .reply "$W/fake-upstream.jsonl" 2>/dev/null | sort | uniq -c | tr '\n' ' ')"
echo "--- leftovers: containers $(docker ps -q | wc -l)"
echo; echo "## assertions"
fails=0
ok() { local name=$1; shift; if "$@"; then echo "PASS $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi; }
each() { local f; for f in "$W"/read-*.json; do jq -e "$1" "$f" > /dev/null 2>&1 || return 1; done; [ "$(ls "$W"/read-*.json | wc -l)" = 8 ]; }
some() { local f; for f in "$W"/read-$1-*.json; do jq -e "$2" "$f" > /dev/null 2>&1 || return 1; done; ls "$W"/read-$1-*.json > /dev/null 2>&1; }
oracle_ok() { local d c=0; for d in "$R"/jobs/r3c-capture-oracle/*/; do [ -f "$d/config.json" ] || continue; c=$((c + 1)); [ -s "$d/artifacts/logs/artifacts/model.patch" ] && grep -q '^diff --git a/calc.py b/calc.py' "$d/artifacts/logs/artifacts/model.patch" && [ -s "$d/verifier/report.json" ] || return 1; done; [ "$c" = 3 ]; }
ok "vm-run.sh exits 0" [ "$rc" = 0 ]
ok "Harbor applied order.json with demo__met listed twice (laneb order: applied 8 trials)" grep -q 'laneb order: applied 8 trials' "$R/out/harbor.log"
ok "all eight trials (demo__met twice, demo__unmet and demo__nomain, in both arms) pass the fixture's FAIL_TO_PASS test" each '.report.f2p["tests/test_calc.py::test_add"] == "PASSED"'
ok "every trial's prompt log records the closing line r3c-root-cause-files" each '.closing_line == "r3c-root-cause-files"'
ok "every assistant record carries the parent_tool_use_id field" each '.assistant_records > 0 and .with_parent_field == .assistant_records'
ok "readClosing reads calc.py from the main thread in every demo__met trial, with no error" some demo__met '.closing.error == null and .closing.block == ["calc.py"]'
ok "readClosing reads calc.py from the main thread in both demo__unmet trials, with no error" some demo__unmet '.closing.error == null and .closing.block == ["calc.py"]'
ok "demo__nomain, both arms: blocks only in a thinking block and a subagent message are not read (an empty block, no error)" some demo__nomain '.closing.error == null and .closing.block == []'
ok "two demo__nomain trials, one per arm" sh -c "ls '$W'/read-demo__nomain-none-*.json '$W'/read-demo__nomain-gstack-*.json > /dev/null"
ok "a thinking block naming wrong_thinking.py is in every log, and never read" each '.thinking_wrong == true and ((.closing.block // []) | index("wrong_thinking.py")) == null'
ok "a subagent message (parent_tool_use_id set) naming wrong_subagent.py is in every log, and never read" each '.subagent_wrong == true and ((.closing.block // []) | index("wrong_subagent.py")) == null'
ok "told demo__met: the Stop hook lets a DEBUG REPORT followed by the closing block stop (met, no block)" some demo__met-gstack '.hooks.stop_hook_ran == true and .hooks.held_back == false and .hooks.outcome == "met"'
ok "told demo__nomain: a DEBUG REPORT alone stops too (met, no block)" some demo__nomain-gstack '.hooks.stop_hook_ran == true and .hooks.held_back == false and .hooks.outcome == "met"'
ok "told demo__unmet: the Stop hook held the stop back, then met_after_block, and the block before its continuation is read" some demo__unmet-gstack '.hooks.held_back == true and .hooks.outcome == "met_after_block" and .closing.block == ["calc.py"]'
ok "every none trial: no gstack hook state" sh -c "for f in '$W'/read-*-none-*.json; do jq -e '.hooks.stop_hook_ran == false and .hooks.files == 0' \"\$f\" > /dev/null || exit 1; done"
ok "Harbor keeps the parser's report.json in each trial's verifier/ directory" each '.report.p2p["tests/test_calc.py::test_import"] == "PASSED"'
ok "the oracle job keeps each task's model.patch (calc.py) under artifacts/logs/artifacts/, and report.json" oracle_ok
exit $((fails > 0))
