#!/bin/sh
# A stand-in for docker in tests/real-outcome/agent_test.py: "docker exec [-i] [-w DIR] [-e NAME]... CONTAINER CMD..."
# runs CMD in DIR on this machine with this environment, as the trial container would with the variables it forwards.
[ "$1" = exec ] || { echo "fake docker: only exec is served: $*" >&2; exit 125; }
shift
dir=.
while [ $# -gt 0 ]; do
  case "$1" in
    -i) shift ;;
    -w) dir=$2; shift 2 ;;
    -e) shift 2 ;;
    *) break ;;
  esac
done
shift
cd "$dir" && exec "$@"
