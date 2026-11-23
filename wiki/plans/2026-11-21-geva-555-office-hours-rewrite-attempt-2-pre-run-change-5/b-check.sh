#!/usr/bin/env bash
# Keyless check for pre-run change 5: Codex 0.170.0 run through the lane's codex-ohr link (run/codex.ts codexLaunch), at gstack
# 8fcca8a5's helpers. The TUI under a pseudo-terminal, exec as codex, exec as codex-ohr, and both execs with Codex's own sandbox on.
set -uo pipefail
D=$HOME/.capy/work/ohr2/pin5/bcheck; REPO=$HOME/.capy/work/ohr2/wt; V=$HOME/.capy/work/ohr2/codex/cli/package/vendor/x86_64-unknown-linux-musl; X=$V/bin/codex; P=18562
R=$D/run; rm -rf $R; mkdir -p $R
BASE=http://127.0.0.1:$P/v1
one() { # name mode(tui|exec) launcher(codex|codex-ohr) sandbox(bypass|workspace-write)
  local name=$1 mode=$2 via=$3 sbx=$4
  local H=$R/home-$name W=$R/work-$name; mkdir -p $H/.codex $W; (cd $W && git init -q)
  printf '[projects."%s"]\ntrust_level = "trusted"\n' "$W" > $H/.codex/config.toml
  bun $D/b-check-stub.ts $R/$name.requests.jsonl $P $D/b-check-probe.sh > $R/$name.stub.log 2>&1 & local S=$!; sleep 1.5
  local E=(env -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u CI -u GITHUB_ACTIONS -u GSTACK_HEADLESS -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT HOME=$H CODEX_HOME=$H/.codex OPENAI_API_KEY=gse_stub-not-a-key CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 OHR_REAL=$X OHR_SAVE=$W/.probe-save OHR_GSTACK_BIN=$HOME/.capy/work/ohr2/codex/new8f/bin PATH=$V/codex-path:$PATH)
  cd $W
  if [ $mode = tui ]; then
    "${E[@]}" TERM=xterm-256color TUI_LOG=$R/$name.tty python3 $D/b-check-tui.py $X --dangerously-bypass-approvals-and-sandbox -c model_provider='"p"' -c model_providers.p.name='"p"' -c model_providers.p.base_url="\"$BASE\"" -c model_providers.p.wire_api='"responses"' -c model_providers.p.env_key='"OPENAI_API_KEY"' -c model_providers.p.request_max_retries=0 -c check_for_update_on_startup=false -c analytics.enabled=false -c 'features.sleep_tool=false' -m gpt-6.1-sol "Run the probe."
    echo "EXIT=tui" > $R/$name.exit
  else
    local J; J=$(cd $REPO && bun $D/b-check-argv.ts $BASE $V/codex-path)
    mapfile -t A < <(python3 -c 'import json,sys; [print(x) for x in json.loads(sys.argv[1])["argv"]]' "$J")
    local LAUNCH='exec "$0" "$@"'; [ $via = codex-ohr ] && LAUNCH=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["launch"])' "$J")
    if [ $sbx != bypass ]; then for i in "${!A[@]}"; do [ "${A[$i]}" = --dangerously-bypass-approvals-and-sandbox ] && A[$i]=--sandbox && A=("${A[@]:0:$((i+1))}" $sbx "${A[@]:$((i+1))}") && break; done; fi
    printf '%s\n' "${A[@]}" | grep -E '^--(sandbox|dangerously)|^workspace' | tr '\n' ' ' > $R/$name.flags
    "${E[@]}" timeout 90 sh -c "$LAUNCH" $X "${A[@]}" <<< "Run the probe." > $R/$name.events.jsonl 2> $R/$name.stderr
    echo "EXIT=$?" > $R/$name.exit
  fi
  kill $S 2>/dev/null; wait $S 2>/dev/null
}
one tui tui codex bypass
one exec-codex exec codex bypass
one exec-ohr exec codex-ohr bypass
one exec-codex-sbx exec codex workspace-write
one exec-ohr-sbx exec codex-ohr workspace-write
python3 $D/b-check-report.py $R
