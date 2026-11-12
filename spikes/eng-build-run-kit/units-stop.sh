#!/usr/bin/env bash
# eng-build kit: stop the unit build (matches the bun process only, never this shell) and clear its containers and dirs.
for p in $(pgrep -f "gstack-evals eb unit[s]"); do kill "$p" 2>/dev/null || true; done
sleep 3
sg docker -c "docker ps -aq | xargs -r docker rm -f" >/dev/null 2>&1 || true
echo "left: $(pgrep -fc 'gstack-evals eb unit[s]' || true)"
