#!/usr/bin/env bash
# Keyless layout check at the moved pins (Codex CLI 0.170.0, stub Responses server): each pin's install as shipped, and with the lane's three-entry fix.
set -uo pipefail
C=~/.capy/work/ohr2/codex; D=~/.capy/work/ohr2/pin5/layout; X=$C/cli/package/vendor/x86_64-unknown-linux-musl/bin/codex
PORT=18557
mkdir -p $D && cd $D
bun $C/stub.ts $D/stub.jsonl $PORT > stub.log 2>&1 &
STUB=$!
sleep 2
run() { # name home extra_config
  local name=$1 src=$2 extra=$3 H=$D/home-$1
  rm -rf $H; mkdir -p $H; cp -a $C/$src/.codex $H/.codex
  printf 'model = "gpt-6.1-sol"\nmodel_provider = "stub"\nmodel_reasoning_effort = "low"\ncheck_for_update_on_startup = false\n%b\n[model_providers.stub]\nname = "stub"\nbase_url = "http://127.0.0.1:%s/v1"\nwire_api = "responses"\nenv_key = "STUB_API_KEY"\n' "$extra" $PORT > $H/.codex/config.toml
  mkdir -p $D/work && (cd $D/work && git init -q 2>/dev/null; : > $D/stub.jsonl; env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY HOME=$H CODEX_HOME=$H/.codex STUB_API_KEY=stub-not-a-key timeout 120 $X exec --json -s read-only '$office-hours Act as a YC partner holding office hours with me.

I run a small bakery and want to sell a scheduling app to other bakeries.' > $D/$name.events.jsonl 2> $D/$name.stderr < /dev/null; echo "$name exit $?")
  cp $D/stub.jsonl $D/$name.request.jsonl
}
fix() { local H=$D/home-$1; printf '[skills.bundled]\nenabled = false\n'; for s in office-hours plan-design-review gstack-upgrade; do printf '[[skills.config]]\npath = "%s/.codex/skills/gstack/%s/SKILL.md"\nenabled = false\n' "$H" "$s"; done; }
run shipped-cur858 home-cur858 ""
run fixed-cur858 home-cur858 "$(fix fixed-cur858)"
run shipped-new8f home-new8f ""
run fixed-new8f home-new8f "$(fix fixed-new8f)"
kill $STUB
