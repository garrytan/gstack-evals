#!/usr/bin/env bash
# Runs inside a check container (see check-arms.sh). Prints key=value lines.
set -u
arm=$1
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }

t=$(date +%s%N); tar -x -C /root -f /arm.tar; echo "extract_rc=$? extract_ms=$(ms "$t")"
echo "claude_version=$(claude --version)"
echo "bun=$(command -v bun) bun_version=$(bun --version)"
echo "node_version=$(/opt/laneb/bin/node --version)"
echo "skills=$(find /root/.claude/skills -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l)"
echo "root_entries=$(cd /root && ls -A | tr '\n' ' ')"

if [ "$arm" = gstack ]; then
  start="$HOME/.claude/skills/gstack/bin/gstack-skill-start"
  t=$(date +%s%N); timeout 60 "$start" --skill "investigate" --model "claude" > /tmp/preamble.txt 2>&1; rc=$?
  echo "preamble_rc=$rc preamble_ms=$(ms "$t") proto=$(grep -c '^SKILL_START_PROTO: 1$' /tmp/preamble.txt)"
  grep -E '^(BRANCH|REPO_MODE|SESSION_KIND|TELEMETRY|UPDATE_CHECK|PROACTIVE|STATE_ROOT): ' /tmp/preamble.txt | tr '\n' ' '; echo
  echo "instruction_blocks=$(grep '^GSTACK_INSTRUCTION_BEGIN: ' /tmp/preamble.txt | cut -d' ' -f2 | tr '\n' ' ')"
  grep -v -E '^[A-Z_]+: |^GSTACK_INSTRUCTION_|^(Feature discovery|Say|Show this)' /tmp/preamble.txt | head -5 | sed 's/^/preamble_other: /'
  if command -v git > /dev/null; then
    mkdir -p /tmp/repo && cd /tmp/repo && git init -q && echo x > a.txt && git add a.txt \
      && git -c user.name=check -c user.email=check@example.invalid commit -q -m init
    timeout 60 "$start" --skill "investigate" --model "claude" > /tmp/preamble-git.txt 2>&1
    echo "git_repo_preamble_rc=$? instruction_blocks=$(grep '^GSTACK_INSTRUCTION_BEGIN: ' /tmp/preamble-git.txt | cut -d' ' -f2 | tr '\n' ' ')"
    cd /app
  fi

  # Same preamble against a tarpit: github.com and raw.githubusercontent.com
  # resolve to a local listener that accepts connections and never answers.
  /opt/laneb/bin/node -e 'for (const p of [80, 443]) require("net").createServer(() => {}).listen(p, "127.0.0.1")' &
  pit=$!
  cp /etc/hosts /tmp/hosts.bak
  echo "127.0.0.1 github.com raw.githubusercontent.com api.github.com" >> /etc/hosts
  rm -f /root/.gstack/last-update-check
  sleep 0.5
  t=$(date +%s%N); timeout 120 "$start" --skill "review" --model "claude" > /tmp/preamble2.txt 2>&1; rc=$?
  echo "tarpit_preamble_rc=$rc tarpit_preamble_ms=$(ms "$t") proto=$(grep -c '^SKILL_START_PROTO: 1$' /tmp/preamble2.txt)"
  cat /tmp/hosts.bak > /etc/hosts
  kill "$pit"

  hook="$HOME/.claude/skills/gstack/hosts/claude/hooks/timeline-stop-hook"
  t=$(date +%s%N)
  echo '{"session_id":"check","hook_event_name":"Stop","stop_hook_active":false,"cwd":"/app"}' | timeout 30 "$hook" > /tmp/stop.txt 2>&1
  echo "stop_hook_rc=$? stop_hook_ms=$(ms "$t") stop_hook_output_bytes=$(wc -c < /tmp/stop.txt)"

  t=$(date +%s%N)
  echo '{"tool_name":"Edit","tool_input":{"file_path":"/app/x.py"},"cwd":"/app"}' \
    | timeout 30 bash -c "test -x \"$HOME/.claude/skills/gstack/freeze/bin/check-freeze.sh\" && exec bash \"$HOME/.claude/skills/gstack/freeze/bin/check-freeze.sh\"; exit 0" > /tmp/freeze.txt 2>&1
  echo "freeze_hook_rc=$? freeze_hook_ms=$(ms "$t") freeze_hook_output=$(head -c 200 /tmp/freeze.txt | tr '\n' ' ')"
fi

# Skill listing: point Claude Code at a local stub that records each request
# and answers 400, so no model is called. Then read the skill list Claude Code
# put in its largest request.
/opt/laneb/bin/node -e '
  const fs = require("fs"); let n = 0;
  require("http").createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      fs.writeFileSync("/tmp/req-" + n++ + ".json", body);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stub" } }));
    });
  }).listen(8787, "127.0.0.1");' &
stub=$!
sleep 0.5
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=stub-not-a-key CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  timeout 120 claude -p "hello" --output-format json > /tmp/claude.txt 2>&1
echo "claude_stub_rc=$?"
kill "$stub"
/opt/laneb/bin/node -e '
  const fs = require("fs");
  const files = fs.readdirSync("/tmp").filter((f) => f.startsWith("req-"));
  const main = files.map((f) => fs.readFileSync("/tmp/" + f, "utf8")).sort((a, b) => b.length - a.length)[0] || "{}";
  const texts = [];
  const walk = (v) => { if (typeof v === "string") texts.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(JSON.parse(main));
  const all = texts.join("\n");
  const at = all.indexOf("The following skills are available");
  const block = at < 0 ? "" : all.slice(at).split(/\n\n(?!- )/).slice(0, 2).join("\n\n");
  const names = [...block.matchAll(/\n- ([A-Za-z0-9_:.-]+):/g)].map((m) => m[1]);
  const extra = names.filter((s) => !fs.existsSync("/root/.claude/skills/" + s));
  console.log("stub_requests=" + files.length + " skills_listed=" + names.length + " listing_chars=" + block.length +
    " listed_not_in_tree=" + (extra.join(",") || "-"));'
