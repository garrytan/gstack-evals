#!/usr/bin/env bash
# Runs one Lane B batch on the VM: the metering proxy (holding the provider keys) and
# Harbor (holding none). The ledger service is reached through the SSH reverse tunnel
# on 127.0.0.1:9911; if it is missing, no session can open.
# Every exit writes out/vm-run.exit with the exit code, after the sessions are closed; launch.sh
# pulls only once it exists. out/ and jobs/ exist from the start, so an early exit leaves both to
# pull. A STOP file in the run dir (launch.sh writes it on an interrupt) keeps the paid run from
# starting, or stops a running one with one SIGINT to Harbor. Before the oracle gate it pulls each task's base image
# (manifest.json), up to 3 tries 30 s apart; a task whose image still doesn't pull is infra: out/pull-fails.txt lists it
# with its image, and the run exits 10 before any model call.
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
declare -A pull=()
while read -r task image; do
  if [ -z "${pull[$image]:-}" ]; then
    pull[$image]=failed
    for try in 1 2 3; do
      if sg docker -c "docker pull '$image'" < /dev/null >> "$run/out/pull.log" 2>&1; then pull[$image]=ok; break; fi
      [ "$try" = 3 ] || sleep 30
    done
  fi
  [ "${pull[$image]}" = ok ] || echo "$task $image" >> "$run/out/pull-fails.txt"
done < <(jq -r '(.tasks // {}) | to_entries[] | "\(.key) \(.value.image)"' "$run/manifest.json")
if [ -s "$run/out/pull-fails.txt" ]; then echo "base image pull failed after 3 tries (infra), no paid trial started:" >&2; cat "$run/out/pull-fails.txt" >&2; exit 10; fi
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
