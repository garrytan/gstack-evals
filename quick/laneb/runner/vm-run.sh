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
# is tried again, up to 6 tries in all, waiting 60, 120, 240, 480 and 960 s between tries. A failure while Docker Hub's
# pull rate limit for this address is used up (ratelimit-remaining 0) is not a try: it waits for the window (the reset
# the registry gives, else 5 minutes) and pulls again, for up to 3 hours in all per image. Once every image is local, the
# oracle gate and the paid batch build from them without pulling. out/pull.d/ logs each pull and its outcome, and
# out/pulls.tsv has each image's status, tries and seconds waited at the rate limit. An image that still failed is infra:
# out/pull-fails.txt lists it with the tasks that build from it, and the run exits 10 before any model call. A STOP file
# ends the pulls too (exit 130). The VM's time spent waiting is billed in launch.sh's VM blocks like the rest of the run.
# Usage: vm-run.sh <run dir> <ledger prefix> <batch cap usd>
set -euo pipefail
run=$(cd "$1" && pwd)
prefix=$2
cap=$3
runner=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mkdir -p "$run/out" "$run/jobs"
rm -f "$run/out/vm-run.exit"
trap 'echo $? > "$run/out/vm-run.exit"' EXIT
trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
for gz in "$run"/arms/*.tar.gz; do
  [ -e "$gz" ] || continue
  gzip -dkf "$gz"
  name=$(basename "$gz" .tar.gz)
  want=$(jq -r --arg n "$name" '.arms[] | select(.name == $n) | .sha256' "$run/manifest.json")
  got=$(sha256sum "${gz%.gz}" | cut -d' ' -f1)
  [ "$got" = "$want" ] || { echo "arm $name: tar sha256 $got, manifest says $want" >&2; exit 5; }
done
curl -fsS 127.0.0.1:9911/status > "$run/out/ledger-status-start.json" || { echo "ledger tunnel not reachable" >&2; exit 4; }
hub_auth=${DOCKER_HUB_AUTH_URL:-https://auth.docker.io}
hub=${DOCKER_HUB_URL:-https://registry-1.docker.io}
# limit_wait: the seconds to wait while Docker Hub's pull limit for this address is used up, or nothing. A HEAD on
# ratelimitpreview/test reads ratelimit-remaining without counting as a pull.
limit_wait() {
  local t h s
  t=$(curl -fsS "$hub_auth/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull" | jq -r .token) || return 0
  h=$(curl -sS --head -H "Authorization: Bearer $t" "$hub/v2/ratelimitpreview/test/manifests/latest" | tr -d '\r') || return 0
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
# pull <image>: prints the image's pulls.tsv row (status, tries, seconds waited at the rate limit, image).
pull() {
  local img=$1 n=0 w=60 waited=0 s log
  log="$run/out/pull.d/$(printf '%s' "$img" | tr '/:@' '___').log"
  while :; do
    if [ -e "$run/STOP" ]; then printf 'STOP\t%s\t%s\t%s\n' "$((n + 1))" "$waited" "$img"; return 0; fi
    if sg docker -c "docker pull -q '$img'" < /dev/null >> "$log" 2>&1; then
      echo "$(date -u +%FT%TZ) pulled on try $((n + 1)) after ${waited} s at the rate limit" >> "$log"
      printf 'ok\t%s\t%s\t%s\n' "$((n + 1))" "$waited" "$img"
      return 0
    fi
    if [ -e "$run/STOP" ]; then printf 'STOP\t%s\t%s\t%s\n' "$((n + 1))" "$waited" "$img"; return 0; fi
    s=""
    [ "$waited" -ge 10800 ] || s=$(limit_wait)
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
if [ -f "$run/oracle.json" ]; then
  (cd "$run" && sg docker -c "harbor run -y -c '$run/oracle.json'") > "$run/out/oracle.log" 2>&1 || true
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
  exec bun "$runner/proxy.ts" --config "$run/proxy.json" --data-host "$gw" --data-port 8787 --control-port 8788 \
    --log "$run/out/proxy-requests.jsonl" --sessions "$run/out/proxy-sessions.jsonl" \
    --ledger-url http://127.0.0.1:9911 --ledger-prefix "$prefix" --global-cap-usd "$cap"
) > "$run/out/proxy.log" 2>&1 &
proxy=$!
trap 'rc=$?; curl -fsS -X POST 127.0.0.1:8788/close-all >/dev/null 2>&1 || true; kill $proxy 2>/dev/null || true; echo $rc > "$run/out/vm-run.exit"' EXIT
for _ in $(seq 1 40); do curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS 127.0.0.1:8788/healthz >/dev/null 2>&1 || { echo "metering proxy not healthy; see out/proxy.log" >&2; exit 8; }
sed "s#__GATEWAY__#$gw#g" "$run/job.json" > "$run/out/job.resolved.json"
cd "$run"
# With a STOP_ON_CAP file in the run dir, a latched cap stop (the ledger or the batch cap refused a session) also stops
# Harbor, so the run ends incomplete instead of starting trials that can't open a session; out/cap-stop.json records it.
(while kill -0 $$ 2>/dev/null; do
  [ -e "$run/STOP" ] && pkill -INT -f "/bin/harbor run" && break
  if [ -e "$run/STOP_ON_CAP" ] && curl -fsS 127.0.0.1:8788/status 2>/dev/null | jq -e '.cap_stop != null' >/dev/null 2>&1; then
    curl -fsS 127.0.0.1:8788/status > "$run/out/cap-stop.json" 2>/dev/null
    pkill -INT -f "/bin/harbor run" && break
  fi
  sleep 2
done) >/dev/null 2>&1 </dev/null &
set +e
sg docker -c "env -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u OPENAI_API_KEY ANTHROPIC_API_KEY=placeholder-not-a-key PYTHONPATH='$runner/agent' harbor run -y -c '$run/out/job.resolved.json'" > "$run/out/harbor.log" 2>&1
rc=$?
set -e
curl -fsS -X POST 127.0.0.1:8788/close-all > "$run/out/close-all.json" || true
curl -fsS 127.0.0.1:8788/totals > "$run/out/proxy-totals.json" || true
curl -fsS 127.0.0.1:8788/status > "$run/out/proxy-status-end.json" || true
curl -fsS 127.0.0.1:9911/status > "$run/out/ledger-status-end.json" || true
echo "harbor exit $rc"; tail -5 "$run/out/harbor.log"; cat "$run/out/proxy-totals.json"
exit $rc
