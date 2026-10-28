#!/bin/bash
set -u
mkdir -p /logs/verifier
f=/app/answer.txt
has() { grep -qx -- "$1" "$f" 2>/dev/null && echo 1 || echo 0; }
matches() { grep -qE -- "$1" "$f" 2>/dev/null && echo 1 || echo 0; }
echo "--- answer.txt as the verifier sees it"
cat "$f" 2>/dev/null || echo "(missing)"
answer=$(has "answer=goodbye")
sentinel=$(has "sentinel=SPIKE-ARM-SENTINEL-4b1d9e0a6c")
hidden=$(( $(has "tests_visible=no") && $(has "solution_visible=no") && $(has "persona_canary_hits=none") ))
if [ -e /app/agent_only.txt ]; then separate=0; else separate=1; fi
egress_blocked=$(( $(matches "^egress_example_com=rc[1-9]") && $(matches "^egress_ip_literal=rc[1-9]") && $(matches "^egress_anthropic=rc[1-9]") ))
proxy_reachable=$(has "proxy_healthz=rc0:200")
cat > /logs/verifier/reward.json <<EOF
{"answer": $answer, "sentinel": $sentinel, "hidden": $hidden, "separate": $separate, "egress_blocked": $egress_blocked, "proxy_reachable": $proxy_reachable}
EOF
cat /logs/verifier/reward.json
