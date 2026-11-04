#!/usr/bin/env bash
# Which bun and bash the gstack hooks would reach in each L1 task image.
#
#   quick/laneb/arms/task-bun.sh [out-tsv] [work-dir]
#   quick/laneb/arms/task-bun.sh check <image> [work-dir]   one image, already pulled: bun path, version, bash, ok
#
# Defaults: out-tsv manifests/l1/task-bun.tsv next to this script, work-dir
# ~/.capy/work/laneb-arms-l1/task-bun. Covers the 80 F tasks and the 10 pilot
# tasks of the L1 preregistration, each from its base image pinned by digest
# in quick/laneb/tasks/swerebench-r3a4.json.
#
# The trial runtime comes from runner/runtime-stages.Dockerfile and is laid
# out as runner/runtime-copy.Dockerfile lays it out: bun and node in
# /opt/laneb/bin, bunx a link to bun, and /opt/laneb/bin appended to the
# image's own PATH. Every hook command is a bash shim that runs the first bun
# on PATH, so this records command -v bun, bun --version and whether bash is
# on PATH, with --network none.
#
# Pulls one image at a time and removes it after its check. A pull refused for
# Docker Hub's rate limit waits out the window and tries again. Rows already in
# out-tsv are kept, so a rerun picks up where the last one stopped.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANEB=$(cd "$HERE/.." && pwd)
REPO=$(cd "$LANEB/../.." && pwd)
PLAN=$REPO/wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000
MODE=scan
if [ "${1:-}" = check ]; then MODE=check; IMAGE=$2; shift 2; set -- "" "$@"; fi
TSV=${1:-$HERE/manifests/l1/task-bun.tsv}
WORK=$(mkdir -p "${2:-$HOME/.capy/work/laneb-arms-l1/task-bun}" && cd "${2:-$HOME/.capy/work/laneb-arms-l1/task-bun}" && pwd)
RT=$WORK/trial-runtime
WANT_BUN=1.4.4

if [ ! -x "$RT/opt/laneb/bin/bun" ]; then
  echo "== trial runtime from runner/runtime-stages.Dockerfile"
  mkdir -p "$WORK/ctx"
  { cat "$LANEB/runner/runtime-stages.Dockerfile"
    echo "FROM scratch AS out"
    echo "COPY --from=laneb-claude /usr/local/bin/node /opt/laneb/bin/node"
    echo "COPY --from=laneb-bun /usr/local/bin/bun /opt/laneb/bin/bun"
  } > "$WORK/ctx/Dockerfile"
  rm -rf "$RT"
  docker buildx build -q --target out --output type=local,dest="$RT" "$WORK/ctx" > /dev/null
  ln -sf bun "$RT/opt/laneb/bin/bunx"
fi
test "$("$RT/opt/laneb/bin/bun" --version)" = "$WANT_BUN"

check() {
  docker run --rm --network none --entrypoint /bin/sh -v "$RT/opt/laneb/bin:/opt/laneb/bin:ro" "$1" -c '
    PATH="$PATH:/opt/laneb/bin"
    b=$(command -v bun || echo -)
    v=$(bun --version 2>/dev/null | head -1); [ -n "$v" ] || v=-
    if command -v bash > /dev/null; then h=yes; else h=no; fi
    printf "%s\t%s\t%s\n" "$b" "$v" "$h"'
}

row_of() {
  local row b v h ok=no
  row=$(check "$1") || row=$(printf -- '-\t-\t-')
  IFS=$'\t' read -r b v h <<< "$row"
  [ "$b" = /opt/laneb/bin/bun ] && [ "$v" = "$WANT_BUN" ] && [ "$h" = yes ] && ok=yes
  printf '%s\t%s\t%s\t%s\n' "$b" "$v" "$h" "$ok"
}

if [ "$MODE" = check ]; then row_of "$IMAGE"; exit 0; fi

mkdir -p "$(dirname "$TSV")"
[ -s "$TSV" ] || printf 'task\tset\timage\tbun_path\tbun_version\tbash\tok\n' > "$TSV"

image_of() {
  bun -e '
    const [id] = process.argv.slice(1);
    const t = (await Bun.file(process.env.TASKS).json()).tasks.find((x) => x.task_id === id);
    if (!t) { console.error("E_INTERNAL no task " + id); process.exit(1); }
    console.log(t.image.replace(/:[^/:]+$/, "") + "@" + t.image_digest);' "$1"
}

pull() {
  local img=$1 out
  for _ in $(seq 1 40); do
    if out=$(docker pull -q "$img" 2>&1); then return 0; fi
    if grep -qi -E 'toomanyrequests|rate limit' <<< "$out"; then
      echo "rate limited on $img, waiting 10 minutes" >&2; sleep 600; continue
    fi
    echo "$out" >&2; sleep 30
  done
  return 1
}

export TASKS=$LANEB/tasks/swerebench-r3a4.json
for set in f pilot; do
  [ "$set" = f ] && list=$PLAN/f-tasks.txt || list=$PLAN/pilot-tasks.txt
  while read -r task; do
    [ -n "$task" ] || continue
    cut -f1 "$TSV" | grep -qxF "$task" && continue
    img=$(image_of "$task")
    echo "== $set $task"
    if pull "$img"; then row=$(row_of "$img"); else row=$(printf -- '-\t-\t-\tno'); fi
    printf '%s\t%s\t%s\t%s\n' "$task" "$set" "$img" "$row" >> "$TSV"
    docker rmi -f "$img" > /dev/null 2>&1 || true
  done < "$list"
done
echo "rows=$(($(wc -l < "$TSV") - 1)) not_ok=$(awk -F'\t' 'NR > 1 && $7 != "yes"' "$TSV" | wc -l)"
