#!/usr/bin/env bash
# Runs one Lane B batch on the VM: the metering proxy (holding the provider keys) and
# Harbor (holding none). The ledger service is reached through the SSH reverse tunnel
# on 127.0.0.1:9911; if it is missing, no session can open.
# Every exit writes out/vm-run.exit with the exit code, after the sessions are closed; launch.sh
# pulls only once it exists. out/ and jobs/ exist from the start, so an early exit leaves both to
# pull. A STOP file in the run dir (launch.sh writes it on an interrupt) keeps the paid run from
# starting, or stops a running one with one SIGINT to Harbor.
# Images first (R3 amendment 3's rule 3, at 06e369b): before the oracle gate it pulls, one at a time, every image the jobs
# build from: each FROM in the tasks' environment Dockerfiles and the base of Harbor's egress sidecar. A pull that fails
# is tried again, up to 6 tries in all, waiting 60, 120, 240, 480 and 960 s between tries. Each try has 30 minutes
# (PULL_TRY_SEC), and a try that runs out of time is a failed try. A failure while Docker Hub's
# pull rate limit for this address is used up (ratelimit-remaining 0) is not a try: it waits for the window (the reset
# the registry gives, else 5 minutes) and pulls again, for up to 3 hours in all per image. Each read of the rate limit
# gives up after 30 s, and the failure then counts as a try. Once every image is local, the
# oracle gate and the paid batch build from them without pulling. out/pull.d/ logs each pull and its outcome, and
# out/pulls.tsv has each image's status, tries and seconds waited at the rate limit. An image that still failed is infra:
# out/pull-fails.txt lists it with the tasks that build from it, and the run exits 10 before any model call. A STOP file
# ends the pulls too (exit 130), and kills a pull in flight. The VM's time spent waiting is billed in launch.sh's VM blocks like the rest of the run.
# A HUP, INT or TERM exits 129, 130 or 143, and first kills a pull in flight and its watcher.
# Usage: vm-run.sh <run dir> <ledger prefix> <batch cap usd>
set -euo pipefail
run=$(cd "$1" && pwd)
prefix=$2
cap=$3
runner=$(cd "$(dirname "$0")" && pwd)
# Only tests set PROXY_DATA_PORT, PROXY_CONTROL_PORT and LEDGER_TUNNEL_PORT; job.json's base_url and the agent's control_url assume the defaults.
data_port=${PROXY_DATA_PORT:-8787}; control_port=${PROXY_CONTROL_PORT:-8788}; ledger_port=${LEDGER_TUNNEL_PORT:-9911}
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mkdir -p "$run/out" "$run/jobs"
rm -f "$run/out/vm-run.exit"
trap 'echo $? > "$run/out/vm-run.exit"' EXIT
pulling=""
stop_pull() { if [ -n "$pulling" ]; then kill $pulling 2>/dev/null || true; wait $pulling 2>/dev/null || true; fi; }
trap 'stop_pull; exit 129' HUP; trap 'stop_pull; exit 130' INT; trap 'stop_pull; exit 143' TERM
for gz in "$run"/arms/*.tar.gz; do
  [ -e "$gz" ] || continue
  gzip -dkf "$gz"
  name=$(basename "$gz" .tar.gz)
  want=$(jq -r --arg n "$name" 'first(.arms[] | select((.tar_name // .name) == $n) | .sha256) // ""' "$run/manifest.json")
  got=$(sha256sum "${gz%.gz}" | cut -d' ' -f1)
  [ "$got" = "$want" ] || { echo "arm $name: tar sha256 $got, manifest says $want" >&2; exit 5; }
done
curl -fsS 127.0.0.1:$ledger_port/status > "$run/out/ledger-status-start.json" || { echo "ledger tunnel not reachable" >&2; exit 4; }
hub_auth=${DOCKER_HUB_AUTH_URL:-https://auth.docker.io}
hub=${DOCKER_HUB_URL:-https://registry-1.docker.io}
try_s=${PULL_TRY_SEC:-1800}
# limit_wait: the seconds to wait while Docker Hub's pull limit for this address is used up, or nothing. A HEAD on
# ratelimitpreview/test reads ratelimit-remaining without counting as a pull.
limit_wait() {
  local t h s
  t=$(curl -fsS --max-time 30 "$hub_auth/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull" | jq -r .token) || return 0
  h=$(curl -sS --max-time 30 --head -H "Authorization: Bearer $t" "$hub/v2/ratelimitpreview/test/manifests/latest" | tr -d '\r') || return 0
  grep -qiE '^ratelimit-remaining: *0([;[:space:]]|$)' <<< "$h" || return 0
  s=$(awk -F': *' 'tolower($1) == "ratelimit-reset" || tolower($1) == "retry-after" { print $2; exit }' <<< "$h")
  [[ $s =~ ^[0-9]+$ && $s -gt 0 ]] || s=300
  echo "$s"
}
# nap <seconds>: sleeps in slices of at most 60 s and ends early once a STOP file appears.
nap() {
  local left=$1 d
  while [ "$left" -gt 0 ] && [ ! -e "$run/STOP" ]; do
    d=$((left < 60 ? left : 60))
    sleep "$d"
    left=$((left - d))
  done
}
# pull <image>: prints the image's pulls.tsv row (status, tries, seconds waited at the rate limit, image). Each try runs
# under the time limit in the background, and a watcher kills it once a STOP file appears.
pull() {
  local img=$1 n=0 w=60 waited=0 s log p watch rc
  log="$run/out/pull.d/$(printf '%s' "$img" | tr '/:@' '___').log"
  while :; do
    if [ -e "$run/STOP" ]; then printf 'STOP\t%s\t%s\t%s\n' "$((n + 1))" "$waited" "$img"; return 0; fi
    timeout --kill-after=30 "$try_s" sg docker -c "docker pull -q '$img'" < /dev/null >> "$log" 2>&1 &
    p=$!
    pulling=$p
    (while kill -0 "$p" 2>/dev/null; do
      read -rt 2 <> <(:) || true
      if [ -e "$run/STOP" ]; then kill "$p" 2>/dev/null; break; fi
    done) &
    watch=$!
    pulling="$p $watch"
    rc=0
    wait "$p" || rc=$?
    pulling=""
    kill "$watch" 2>/dev/null || true
    wait "$watch" 2>/dev/null || true
    if [ "$rc" -eq 0 ]; then
      echo "$(date -u +%FT%TZ) pulled on try $((n + 1)) after ${waited} s at the rate limit" >> "$log"
      printf 'ok\t%s\t%s\t%s\n' "$((n + 1))" "$waited" "$img"
      return 0
    fi
    if [ -e "$run/STOP" ]; then printf 'STOP\t%s\t%s\t%s\n' "$((n + 1))" "$waited" "$img"; return 0; fi
    s=""
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
      echo "$(date -u +%FT%TZ) try $((n + 1)) of 6 timed out after $try_s s" >> "$log"
    elif [ "$waited" -lt 10800 ]; then
      s=$(limit_wait)
    fi
    if [ -n "$s" ]; then
      [ $((waited + s)) -le 10800 ] || s=$((10800 - waited))
      echo "$(date -u +%FT%TZ) refused while the rate limit is used up: waiting $s s, not a try" >> "$log"
      nap "$s"
      waited=$((waited + s))
      continue
    fi
    n=$((n + 1))
    echo "$(date -u +%FT%TZ) try $n of 6 failed" >> "$log"
    if [ "$n" -ge 6 ]; then printf 'FAIL\t%s\t%s\t%s\n' "$n" "$waited" "$img"; return 0; fi
    nap "$w"
    w=$((w * 2))
  done
}
mkdir -p "$run/out/pull.d"
side=$(find "$HOME/.local/share/uv/tools/harbor" -path '*harbor-docker-egress-control-sidecar/Dockerfile' 2>/dev/null | head -1 || true)
for f in "$run"/tasks/*/environment/Dockerfile $side; do
  if [ -f "$f" ]; then awk 'toupper($1) == "FROM" { print $2 }' "$f"; fi
done | sort -u > "$run/out/images.txt"
printf 'status\ttries\trate_limit_wait_s\timage\n' > "$run/out/pulls.tsv"
stopped=no
while read -r img; do
  if [ -e "$run/STOP" ]; then stopped=yes; break; fi
  pull "$img" >> "$run/out/pulls.tsv"
done < "$run/out/images.txt"
if [ "$stopped" = yes ] || grep -q '^STOP' "$run/out/pulls.tsv" || { [ -s "$run/out/images.txt" ] && [ -e "$run/STOP" ]; }; then echo "stop requested during the image pulls: no paid trial started" >&2; exit 130; fi
awk -F'\t' 'NR > 1 && $1 != "ok" { print $4 }' "$run/out/pulls.tsv" | while read -r img; do
  users=$(for f in "$run"/tasks/*/environment/Dockerfile; do
    if [ -f "$f" ] && awk -v i="$img" 'toupper($1) == "FROM" && $2 == i { found = 1 } END { exit !found }' "$f"; then basename "$(dirname "$(dirname "$f")")"; fi
  done | paste -sd, -)
  [ -n "$users" ] || users="every task, as the base of the Harbor egress sidecar"
  echo "$img ($users)" >> "$run/out/pull-fails.txt"
done
echo "pulls: $(wc -l < "$run/out/images.txt") images, $(awk -F'\t' 'NR > 1 { s += $3 } END { print s + 0 }' "$run/out/pulls.tsv") s waited at the rate limit"
if [ -s "$run/out/pull-fails.txt" ]; then echo "an image did not pull (6 tries and up to 3 hours at the rate limit), infra: no paid trial started:" >&2; cat "$run/out/pull-fails.txt" >&2; exit 10; fi
# L1 Amendment C: out/task-hooks.tsv logs, for each task, whether its pulled image or build context holds a Claude Code
# UserPromptSubmit hook of its own (task-hooks.sh). It reads only the images pulled above and never stops the run.
bash "$runner/task-hooks.sh" "$run" > "$run/out/task-hooks.tsv" 2> "$run/out/task-hooks.log" || true
echo "task hooks: $(awk -F'\t' 'NR > 1 && $4 == "yes"' "$run/out/task-hooks.tsv" | wc -l) of $(awk 'NR > 1' "$run/out/task-hooks.tsv" | wc -l) tasks name a UserPromptSubmit hook, $(awk -F'\t' 'NR > 1 && $4 == "unknown"' "$run/out/task-hooks.tsv" | wc -l) unknown"
if [ -f "$run/oracle.json" ]; then
  (cd "$run" && sg docker -c "HARBOR_TELEMETRY=0 harbor run -y -c '$run/oracle.json'") > "$run/out/oracle.log" 2>&1 || true
  # Every task in the oracle job needs a trial with reward 1; a task with no trial directory fails too.
  passed=$(for d in "$run"/jobs/*-oracle/*/; do
    [ -f "$d/config.json" ] || continue
    r=$(cat "$d/verifier/reward.txt" 2>/dev/null || echo none)
    if awk -v r="$r" 'BEGIN { exit !(r + 0 == 1) }'; then jq -r '.task.path | split("/") | last' "$d/config.json"; fi
  done | sort -u)
  jq -r '.tasks[].path | split("/") | last' "$run/oracle.json" | sort -u | comm -23 - <(printf '%s\n' "$passed") > "$run/out/oracle-fails.txt"
  if [ -s "$run/out/oracle-fails.txt" ]; then echo "oracle failed, no paid trial started:" >&2; cat "$run/out/oracle-fails.txt" >&2; exit 6; fi
  echo "oracle: every task passed on this host"
fi
[ ! -e "$run/STOP" ] || { echo "stop requested: no paid trial started" >&2; exit 130; }
gw=$(sg docker -c "docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'")
(
  set -a; . "$HOME/.laneb-keys"; set +a
  exec bun "$runner/proxy.ts" --config "$run/proxy.json" --data-host "$gw" --data-port "$data_port" --control-port "$control_port" \
    --log "$run/out/proxy-requests.jsonl" --sessions "$run/out/proxy-sessions.jsonl" \
    --ledger-url http://127.0.0.1:$ledger_port --ledger-prefix "$prefix" --global-cap-usd "$cap"
) > "$run/out/proxy.log" 2>&1 &
proxy=$!
trap 'rc=$?; curl -fsS -X POST 127.0.0.1:$control_port/close-all >/dev/null 2>&1 || true; kill $proxy 2>/dev/null || true; echo $rc > "$run/out/vm-run.exit"' EXIT
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:$control_port/healthz >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS 127.0.0.1:$control_port/healthz >/dev/null 2>&1 || { echo "metering proxy not healthy; see out/proxy.log" >&2; exit 8; }
# Judge wiring (harness-mechanics Stage 3, lanes/harness-mechanics/README.md): started only when this batch has a judge
# arm, so a non-judge or L1 batch starts nothing here and no HM_JUDGE_* ever reaches Harbor. A judge arm sets
# agents[].kwargs.judge_backend in job.json (grid.ts), which the host-side agent (runner/agent/laneb_hooks.py) reads to
# bind a per-session slot over the management socket and forward the slot's proxy URL into the task container. The judge
# proxy is a self-contained bundle prepare-run.ts dropped in the run dir; it holds the keys from ~/.laneb-keys and meters
# the judge deciders against the item's cap on the shared ledger under "judge:" plus this part's ledger prefix, beside the
# session proxy, so each part's judge rows are its own; its journal (HM_JUDGE_JOURNAL) is what the agent checks. When
# jev's judge changes the repo in a forbidden way, the agent writes the STOP file named by HM_JUDGE_STOP_FILE, which the
# watcher below already treats as a stop. A judge call gets five attempts (D11): particle-1's 429s back off 1, 2, 4 and
# 8 s, inside the hook's 30 s particle-1 limit, and a Retry-After the provider sends still sets the wait.
judge_proxy=""
judge_arms=false
for f in "$run"/job.json "$run"/job-*.json; do
  [ -e "$f" ] || continue
  if jq -e 'any((.agents // [])[]; (.kwargs.judge_backend // "") != "")' "$f" >/dev/null 2>&1; then judge_arms=true; break; fi
done
if [ "$judge_arms" = true ]; then
  [ -f "$run/judge-proxy.js" ] || { echo "judge arm present but $run/judge-proxy.js is missing (prepare-run.ts bundles it)" >&2; exit 8; }
  judge_data_port=${JUDGE_PROXY_DATA_PORT:-8790}
  judge_mgmt_socket="$run/out/judge-mgmt.sock"
  export HM_JUDGE_MGMT_SOCKET="$judge_mgmt_socket"
  export HM_JUDGE_MGMT_TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  export HM_JUDGE_PROXY_BASE="http://$gw:$judge_data_port"
  export HM_JUDGE_STOP_FILE="$run/STOP"
  export HM_JUDGE_JOURNAL="$run/out/judge-journal.ndjson"
  (
    set -a; . "$HOME/.laneb-keys"; set +a
    exec bun "$run/judge-proxy.js" --data-host "$gw" --data-port "$judge_data_port" --management-socket "$judge_mgmt_socket" \
      --journal "$HM_JUDGE_JOURNAL" --ledger-url http://127.0.0.1:$ledger_port --ledger-prefix "judge:$prefix" --retry-attempts 5
  ) > "$run/out/judge-proxy.log" 2>&1 &
  judge_proxy=$!
  trap 'rc=$?; curl -fsS -X POST 127.0.0.1:$control_port/close-all >/dev/null 2>&1 || true; kill $proxy 2>/dev/null || true; [ -n "$judge_proxy" ] && kill $judge_proxy 2>/dev/null; echo $rc > "$run/out/vm-run.exit"' EXIT
  for _ in $(seq 1 40); do [ -S "$judge_mgmt_socket" ] && break; sleep 0.5; done
  [ -S "$judge_mgmt_socket" ] || { echo "judge proxy management socket never appeared; see out/judge-proxy.log" >&2; exit 8; }
fi
# proxy_status: the proxy's state, read from its control route GET /totals (proxy.ts serves no /status), as one JSON line
# that keeps /totals' fields one to one: sessions (every session opened this run), open_sessions, unsettled_sessions,
# cap_stop (the latched reason, or null) and global_spent_micros. It prints nothing and fails unless the answer has
# cap_stop and both session counts as numbers, so a missing field never reads as "no cap stop".
proxy_status() {
  curl -fsS --max-time 10 127.0.0.1:$control_port/totals \
    | jq -ce 'select(has("cap_stop") and (.sessions | type) == "number" and (.open_sessions | type) == "number") | {sessions, open_sessions, unsettled_sessions, cap_stop, global_spent_micros}'
}
# More jobs (L1's rectangles, l1/l1.ts): job-2.json, job-3.json, ... run after job.json, one after another, each with its
# own resolved config and Harbor log (out/harbor-2.log, ...). A STOP file or a latched cap stop keeps the next job from
# starting; the exit code is the first job's that was not 0, or 130 when a stop kept a job from starting.
jobs=(job)
while read -r j; do jobs+=("$j"); done < <(cd "$run" && ls 2>/dev/null | sed -n 's/^\(job-[0-9][0-9]*\)\.json$/\1/p' | sort -t- -k2 -n)
for j in "${jobs[@]}"; do sed "s#__GATEWAY__#$gw#g" "$run/$j.json" > "$run/out/$j.resolved.json"; done
cd "$run"
# With a STOP_ON_CAP file in the run dir, a latched cap stop (the ledger or the batch cap refused a session) also stops
# Harbor, so the run ends incomplete instead of starting trials that can't open a session; out/cap-stop.json records the
# proxy_status line that showed it. After 3 failed reads in a row it appends a timestamped line to out/cap-watch.log, so a
# watcher that can't see cap_stop leaves a record; a failed read never stops Harbor.
(fails=0
while kill -0 $$ 2>/dev/null; do
  [ -e "$run/STOP" ] && pkill -INT -f "/bin/harbor run" && break
  if [ -e "$run/STOP_ON_CAP" ]; then
    if s=$(proxy_status 2>/dev/null); then
      fails=0
      if jq -e '.cap_stop != null' <<< "$s" >/dev/null 2>&1; then
        printf '%s\n' "$s" > "$run/out/cap-stop.json"
        pkill -INT -f "/bin/harbor run" && break
      fi
    else
      fails=$((fails + 1))
      if [ "$fails" -eq 3 ]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) proxy_status failed 3 times in a row: the cap watcher can't read cap_stop from GET /totals" >> "$run/out/cap-watch.log"
      fi
    fi
  fi
  sleep 2
done) >/dev/null 2>&1 </dev/null &
# A run dir with order.json (an R3b grid part) runs its paid job in that trial order: runner/agent/sitecustomize.py reads
# LANEB_TRIAL_ORDER, and the job fails before any trial when the file doesn't name each trial once. The oracle job above
# keeps Harbor's own order.
order=""
[ ! -f "$run/order.json" ] || order="LANEB_TRIAL_ORDER='$run/order.json' "
set +e
rc=0
for j in "${jobs[@]}"; do
  if [ -e "$run/STOP" ] || [ -e "$run/out/cap-stop.json" ]; then [ "$rc" -ne 0 ] || rc=130; break; fi
  log=harbor.log; [ "$j" = job ] || log="harbor-${j#job-}.log"
  sg docker -c "env -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u OPENAI_API_KEY -u TYPESAFE_API_KEY ANTHROPIC_API_KEY=placeholder-not-a-key PYTHONPATH='$runner/agent' HARBOR_TELEMETRY=0 ${order}harbor run -y -c '$run/out/$j.resolved.json'" > "$run/out/$log" 2>&1
  r=$?
  [ "$rc" -ne 0 ] || rc=$r
done
set -e
curl -fsS -X POST 127.0.0.1:$control_port/close-all > "$run/out/close-all.json" || true
curl -fsS 127.0.0.1:$control_port/totals > "$run/out/proxy-totals.json" || true
proxy_status > "$run/out/proxy-status-end.json" || true
curl -fsS 127.0.0.1:$ledger_port/status > "$run/out/ledger-status-end.json" || true
echo "harbor exit $rc"; tail -5 "$run/out/harbor.log"; cat "$run/out/proxy-totals.json"
exit $rc
