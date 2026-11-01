// A stub Claude Code CLI for the pinned Agent SDK (tests/adapters/claude-code.test.ts). It answers the SDK's control
// requests and, on each user message, emits one tool_use. STUB_MODE=turn1 exits 0 right after the first tool_use;
// STUB_MODE=turn2 ends the first turn with a question and a result, then exits 0 after the second turn's tool_use.
const rl = require("readline").createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const usage = { input_tokens: 1, output_tokens: 1 };
let users = 0;
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
  out({ type: "assistant", message: { id: "m" + users, type: "message", role: "assistant", model: "stub", content: [{ type: "tool_use", id: "tu" + users, name: "Read", input: { file_path: "/x" } }], stop_reason: null, usage }, parent_tool_use_id: null, session_id: "s", uuid: "a" + users });
  if (process.env.STUB_MODE === "turn1" || users >= 2) {
    setTimeout(() => process.exit(0), 100);
    return;
  }
  out({ type: "assistant", message: { id: "t" + users, type: "message", role: "assistant", model: "stub", content: [{ type: "text", text: "Which option do you want?" }], stop_reason: "end_turn", usage }, parent_tool_use_id: null, session_id: "s", uuid: "b" + users });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: "Which option do you want?", session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "r" + users });
});
