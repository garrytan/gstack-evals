#!/usr/bin/env bash
# R3 amendment 4 oracle preflight, one pass on one shard's VM (plan section 4 item 5), adapted from amendment 3's
# oracle-pass.sh.txt. Keyless: no provider key is on the VM and no model is called. oracle-preflight.sh syncs the export's
# quick/laneb/runner to work/runner and the shard's run dir (prepare-run.ts with TASK_SET=swerebench-r3a4 and ORACLE=1)
# to work/run, runs the pin's vm-bootstrap.sh, then starts this script detached, once per pass. It pulls every image the
# oracle job builds from (each pinned by digest), with retries, runs the run dir's oracle job exactly as vm-run.sh's gate
# does and scores it the same way. It writes into work/pass<N>: images.txt, pulls.tsv (status, tries, image, repo digest,
# note), ratelimit-before.txt and ratelimit-after.txt, oracle.log, harbor.exit, oracle-fails.txt, finished (one line
# "finished_at <UTC time>", only when Harbor wrote the job's result.json), jobs/ (the oracle job's trial dirs) and, last,
# pass.exit. A pass counts only with its finished_at line and a pass.exit of 0 (drop-list.py).
# Usage (from the VM user's home): bash work/preflight/oracle-pass.sh <pass number>
set -u
P=$1
run=$HOME/work/run
out=$HOME/work/pass$P
mkdir -p "$out/pull.d"
trap 'echo $? > "$out/pass.exit"' EXIT
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
job=$(jq -r .job_name "$run/oracle.json") || exit 1
side=$(find "$HOME/.local/share/uv/tools/harbor" -path '*harbor-docker-egress-control-sidecar/Dockerfile' 2>/dev/null | head -1)
{
  for f in "$run"/tasks/*/environment/Dockerfile "$run"/tasks/*/tests/Dockerfile $side; do
    awk 'toupper($1) == "FROM" { print $2 }' "$f"
  done
} | sort -u > "$out/images.txt"
ratelimit() {
  local t
  t=$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull" | jq -r .token) \
    && curl -fsS --head -H "Authorization: Bearer $t" https://registry-1.docker.io/v2/ratelimitpreview/test/manifests/latest | grep -i '^ratelimit' \
    || echo "ratelimit: unreadable"
}
ratelimit > "$out/ratelimit-before.txt" 2>&1
# limited: 0 when Docker Hub's pull rate limit for this VM's address is used up. A HEAD request on the registry's
# ratelimitpreview image reads it without counting as a pull.
limited() {
  local t
  t=$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull" | jq -r .token) || return 1
  curl -sS --head -H "Authorization: Bearer $t" https://registry-1.docker.io/v2/ratelimitpreview/test/manifests/latest | grep -qi '^ratelimit-remaining: 0;'
}
# pull <image>: up to 6 tries, waiting 60, 120, 240, 480 and 960 seconds between them. A failure while the rate limit is
# used up is not a try: it waits 5 minutes and pulls again, for up to 3 hours in all. Prints one pulls.tsv row.
pull() {
  local img=$1 n=0 w=60 waited=0 log
  log="$out/pull.d/$(printf '%s' "$img" | tr '/:@' '___').log"
  while :; do
    if sg docker -c "docker pull -q '$img'" >> "$log" 2>&1; then
      printf 'ok\t%s\t%s\t%s\twaited %ss at the rate limit\n' "$((n + 1))" "$img" "$(sg docker -c "docker image inspect --format '{{join .RepoDigests \",\"}}' '$img'" 2>/dev/null)" "$waited"
      return 0
    fi
    if [ "$waited" -lt 10800 ] && limited; then
      echo "rate limit used up at $(date -u +%FT%TZ); waiting 300 s" >> "$log"
      sleep 300
      waited=$((waited + 300))
      continue
    fi
    n=$((n + 1))
    if [ "$n" -ge 6 ]; then
      printf 'FAIL\t%s\t%s\t-\t%s\n' "$n" "$img" "$(grep -v '^rate limit used up' "$log" | tail -1 | tr '\t' ' ' | cut -c1-200)"
      return 0
    fi
    sleep "$w"
    w=$((w * 2))
  done
}
export -f pull limited
export out
xargs -a "$out/images.txt" -P 4 -I{} bash -c 'pull "$1"' _ {} | sort -k3 > "$out/pulls.tsv"
ratelimit > "$out/ratelimit-after.txt" 2>&1
(cd "$run" && sg docker -c "harbor run -y -c '$run/oracle.json'") > "$out/oracle.log" 2>&1
echo $? > "$out/harbor.exit"
passed=$(for d in "$run"/jobs/"$job"/*/; do
  [ -f "$d/config.json" ] || continue
  r=$(cat "$d/verifier/reward.txt" 2>/dev/null || echo none)
  if awk -v r="$r" 'BEGIN { exit !(r + 0 == 1) }'; then jq -r '.task.path | split("/") | last' "$d/config.json"; fi
done | sort -u)
jq -r '.tasks[].path | split("/") | last' "$run/oracle.json" | sort -u | comm -23 - <(printf '%s\n' "$passed" | sed '/^$/d') > "$out/oracle-fails.txt"
[ -f "$run/jobs/$job/result.json" ] && echo "finished_at $(date -u +%FT%TZ)" > "$out/finished"
mv "$run/jobs" "$out/jobs"
