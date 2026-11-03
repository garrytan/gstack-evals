#!/usr/bin/env bash
# Plan v3 (GEVA-225): every sizing run behind sections 7 and 8, keyless. Run from this folder.
set -euo pipefail
cd "$(dirname "$0")"
run() { echo "== $1"; shift; env "$@" python3 cost.py > /tmp/geva225-cost.json; env "$@" python3 emit.py /tmp/geva225-cost.json base; }
H="P1RATIO=0.41 AUTH_EXTRA=1.2"
run "house central: MULT=5 (the plan)" MULT=5 $H
echo "== the 2-point rule's extra rows at house central (chosen)"; MULT=5 P1RATIO=0.41 AUTH_EXTRA=1.2 python3 cost.py > /tmp/geva225-cost.json; python3 emit.py /tmp/geva225-cost.json chosen
run "v2 central: MULT=2.5" MULT=2.5 $H
run "forced or exposed told, central: MULT=5 TOLD_SCALE=1.15" MULT=5 TOLD_SCALE=1.15 $H
run "forced or exposed told, risk: MULT=5 TOLD_SCALE=1.5" MULT=5 TOLD_SCALE=1.5 $H
run "high: MULT=10" MULT=10 $H
run "high stress: MULT=10 TOLD_SCALE=1.5 AGENT_USER=2.4" MULT=10 TOLD_SCALE=1.5 AGENT_USER=2.4 $H
run "crew at TS's full rate: MULT=5 AUTH_EXTRA=6.2" MULT=5 P1RATIO=0.41 AUTH_EXTRA=6.2
run "cheaper agent user: MULT=5 AGENT_USER=0.12" MULT=5 AGENT_USER=0.12 $H
echo "== one survivor per family, house central"; MULT=5 P1RATIO=0.41 AUTH_EXTRA=1.2 python3 survivor.py
echo "== one survivor per family, forced central"; MULT=5 TOLD_SCALE=1.15 P1RATIO=0.41 AUTH_EXTRA=1.2 python3 survivor.py
