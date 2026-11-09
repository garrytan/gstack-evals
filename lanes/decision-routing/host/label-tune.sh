#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Labels, tune and pin for the decision-routing calibration (preregistration section 6), on the runner VM after the N batch
# and the host answering step. For every Harbor trial under <batch out>/harbor/<session>/<trial>, it runs labels trial
# (label containers through docker; the verifier image is built per task) and labels join with that session's shadow
# answers from <answer out>/answers/<session>.shadow.jsonl. Then tune reads every labelled file and writes tuned.json and
# rewrite-plan.json. If the plan names a question rewrite (6.3), it stops with exit 3 before pin: rewrite questions.json,
# re-answer the planned states with the answering step and run this again. Otherwise pin writes pin.json and its sha256.
# --constructed takes the safety set's calibration-half answers (answer --mode safety_calibration); they get labels by
# construction (labels constructed), are joined and go to tune beside the real sessions.
#
# usage: label-tune.sh <batch out> <answer out> <tasks dir> <work dir> --proxy-host <host> --questions <questions.json> [--particle-max-tokens 8000|16000] [--constructed <answers.jsonl>]
# DR_CLI overrides the decision-routing command (default: bun <repo>/bin/gstack-evals decision-routing).
set -euo pipefail

die() {
  printf '%s\n' "$1" >&2
  exit 2
}
[ $# -ge 8 ] || die "E_USAGE: label-tune.sh <batch out> <answer out> <tasks dir> <work dir> --proxy-host <host> --questions <questions.json> [--particle-max-tokens n]"
out=$1 answers=$2 tasks=$3 work=$4
shift 4
proxy="" questions="" maxtok=() constructed=""
while [ $# -gt 0 ]; do
  case $1 in
    --proxy-host) proxy=$2 ;;
    --questions) questions=$2 ;;
    --particle-max-tokens) maxtok=(--particle-max-tokens "$2") ;;
    --constructed) constructed=$2 ;;
    *) die "E_USAGE: unknown argument $1" ;;
  esac
  shift 2
done
[ -n "$proxy" ] && [ -n "$questions" ] || die "E_USAGE: --proxy-host and --questions are required"
[ -z "$constructed" ] || [ -f "$constructed" ] || die "E_USAGE: no constructed answers at $constructed"
if [ -n "${DR_CLI:-}" ]; then
  cli=("$DR_CLI")
else
  cli=(bun "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/bin/gstack-evals" decision-routing)
fi
mkdir -p "$work/labels" "$work/labelled"

labelled=()
while IFS= read -r result; do
  trial=$(dirname "$result")
  grep -q '"task_name"' "$result" || continue
  session=$(basename "$(dirname "$trial")")
  task=$(sed -n 's/.*"task_name" *: *"\([^"]*\)".*/\1/p' "$result" | head -1)
  shadow="$answers/answers/$session.shadow.jsonl"
  [ -f "$shadow" ] || die "E_USAGE: session $session has no shadow answers at $shadow; run the answering step first"
  "${cli[@]}" labels trial "$trial" --task "$tasks/$task" --proxy-host "$proxy" --out "$work/labels/$session.jsonl"
  "${cli[@]}" labels join --decisions "$shadow" --labels "$work/labels/$session.jsonl" --out "$work/labelled/$session.jsonl"
  labelled+=(--labelled "$work/labelled/$session.jsonl")
done < <(find "$out/harbor" -mindepth 3 -maxdepth 3 -name result.json | sort)
[ ${#labelled[@]} -gt 0 ] || die "E_USAGE: no Harbor trials under $out/harbor"
trials=$(( ${#labelled[@]} / 2 ))
if [ -n "$constructed" ]; then
  "${cli[@]}" labels constructed --decisions "$constructed" --out "$work/labels/constructed.jsonl"
  "${cli[@]}" labels join --decisions "$constructed" --labels "$work/labels/constructed.jsonl" --out "$work/labelled/constructed.jsonl"
  labelled+=(--labelled "$work/labelled/constructed.jsonl")
fi

"${cli[@]}" tune "${labelled[@]}" --out "$work/tuned.json" --plan "$work/rewrite-plan.json"
if ! grep -Eq '"types": *\[\]' "$work/rewrite-plan.json"; then
  echo "tune plans a question rewrite ($work/rewrite-plan.json): rewrite questions.json, re-answer the planned states, then run this again; no pin was written" >&2
  exit 3
fi
"${cli[@]}" pin --tuned "$work/tuned.json" --questions "$questions" --out "$work/pin.json" "${maxtok[@]}"
echo "labels, tune and pin done: $trials trials, $work/pin.json"
