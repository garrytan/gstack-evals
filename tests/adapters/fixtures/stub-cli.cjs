// A stub Claude Code CLI for the pinned Agent SDK (tests/adapters/claude-code.test.ts). It answers the SDK's control
// requests and, on each user message, emits one tool_use. STUB_MODE=turn1 exits 0 right after the first tool_use;
// STUB_MODE=turn2 ends the first turn with a question and a result, then exits 0 after the second turn's tool_use.
// STUB_MODE=content answers instead with the blocks STUB_CONTENT holds (a JSON array) and a success result, STUB_DELAY ms
// after the user message. STUB_MODE=exit exits with STUB_EXIT after the tool_use: STUB_DELAY ms later, or with
// STUB_ON_EOF=1 only once its stdin closes. STUB_STDERR is written to stderr STUB_STDERR_TIMES times (default once) on each
// user message.
const rl = require("readline").createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const env = process.env;
const usage = { input_tokens: 1, output_tokens: Number(env.STUB_OUTPUT_TOKENS ?? 1) };
const assistant = (id, content, stop) => ({ type: "assistant", message: { id, type: "message", role: "assistant", model: "stub", content, stop_reason: stop, usage }, parent_tool_use_id: null, session_id: "s", uuid: "a" + id });
const result = (n, text) => ({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: text, session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "r" + n });
let users = 0;
if (env.STUB_ON_EOF) rl.on("close", () => process.exit(Number(env.STUB_EXIT)));
rl.on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.type === "control_request") {
    out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { commands: [], models: [], account: {}, output_style: "default", available_output_styles: [] } } });
    return;
  }
  if (m.type !== "user") return;
  users++;
  if (users === 1) out({ type: "system", subtype: "init", session_id: "s", model: "stub", tools: [], cwd: "/", permissionMode: "default", apiKeySource: "none", claude_code_version: "0", skills: [], mcp_servers: [], slash_commands: [], output_style: "default", uuid: "u0" });
  if (env.STUB_STDERR) process.stderr.write(env.STUB_STDERR.repeat(Number(env.STUB_STDERR_TIMES ?? 1)));
  if (env.STUB_MODE === "content") {
    const n = users;
    setTimeout(() => {
      out(assistant("c" + n, JSON.parse(env.STUB_CONTENT), "end_turn"));
      out(result(n, ""));
    }, Number(env.STUB_DELAY ?? 0));
    return;
  }
  out(assistant("m" + users, [{ type: "tool_use", id: "tu" + users, name: "Read", input: { file_path: "/x" } }], null));
  if (env.STUB_MODE === "exit") {
    if (!env.STUB_ON_EOF) setTimeout(() => process.exit(Number(env.STUB_EXIT)), Number(env.STUB_DELAY ?? 100));
    return;
  }
  if (env.STUB_MODE === "turn1" || users >= 2) {
    setTimeout(() => process.exit(0), 100);
    return;
  }
  out(assistant("t" + users, [{ type: "text", text: "Which option do you want?" }], "end_turn"));
  out(result(users, "Which option do you want?"));
});
