// Copyright (c) 2026 Garry Tan. MIT License.
// A stub Claude Code CLI for the eng-review run loop's real-SDK test (tests/er/er-sdk.ts). It answers the SDK's control
// requests, keeps the hook callback ids the SDK registers for Stop, and on the prompt plays ER_STUB_TURNS (a JSON array):
// each turn is {"content": [blocks]}, {"apierror": text} or {"maxturns": true}. After each content turn it fires the Stop
// hook when one is registered; a block plays the next turn (the last one again when none is left) and a release ends the
// session with a success result. ER_STUB_DELAY ms pass before the first turn. STUB_RECORD gets the argv, every message
// the SDK sends and every hook decision.
const fs = require("fs");
const rl = require("readline").createInterface({ input: process.stdin });
const env = process.env;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const record = (o) => env.STUB_RECORD && fs.appendFileSync(env.STUB_RECORD, JSON.stringify(o) + "\n");
record({ argv: process.argv.slice(2) });
const usage = { input_tokens: 1, output_tokens: 1 };
const turns = JSON.parse(env.ER_STUB_TURNS || "[]");
let stopIds = [];
let n = 0;
let pending = null;
const result = (subtype, extra = {}) => out({ type: "result", subtype, is_error: subtype !== "success", num_turns: n, result: "", session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "r" + n, ...extra });
function play() {
  const t = turns[Math.min(n, turns.length - 1)] || { content: [{ type: "text", text: "Done." }] };
  n++;
  if (t.apierror) {
    out({ type: "assistant", message: { id: "synthetic", type: "message", role: "assistant", model: "<synthetic>", content: [{ type: "text", text: t.apierror }], stop_reason: "stop_sequence", usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: null, session_id: "s", uuid: "ae" + n, error: "unknown", is_api_error_message: true, api_error_status: 529 });
    out({ type: "result", subtype: "success", is_error: true, num_turns: n, result: t.apierror, api_error_status: 529, terminal_reason: "api_error", session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "rerr" });
    return;
  }
  if (t.maxturns) {
    out({ type: "assistant", message: { id: "m" + n, type: "message", role: "assistant", model: "stub", content: [{ type: "text", text: "Still working through the plan." }], stop_reason: "end_turn", usage }, parent_tool_use_id: null, session_id: "s", uuid: "a" + n });
    result("error_max_turns", { errors: [] });
    return;
  }
  out({ type: "assistant", message: { id: "m" + n, type: "message", role: "assistant", model: "stub", content: t.content, stop_reason: "end_turn", usage }, parent_tool_use_id: null, session_id: "s", uuid: "a" + n });
  if (!stopIds.length) return result("success");
  pending = "stub-" + n;
  out({ type: "control_request", request_id: pending, request: { subtype: "hook_callback", callback_id: stopIds[0], input: { hook_event_name: "Stop", stop_hook_active: n > 1, session_id: "s", transcript_path: "", cwd: process.cwd() } } });
}
rl.on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  record(m);
  if (m.type === "control_request") {
    if (m.request && m.request.subtype === "initialize") stopIds = ((m.request.hooks && m.request.hooks.Stop) || []).flatMap((x) => x.hookCallbackIds || []);
    out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { commands: [], models: [], account: {}, output_style: "default", available_output_styles: [] } } });
    return;
  }
  if (m.type === "control_response" && pending && m.response && m.response.request_id === pending) {
    pending = null;
    const decision = (m.response.response || {}).decision;
    record({ hook: decision || "release", reason: (m.response.response || {}).reason || null });
    if (decision === "block") return play();
    return result("success");
  }
  if (m.type !== "user") return;
  out({ type: "system", subtype: "init", session_id: "s", model: "stub", tools: [], cwd: process.cwd(), permissionMode: "default", apiKeySource: "none", claude_code_version: "0", skills: [], mcp_servers: [], slash_commands: [], output_style: "default", uuid: "i" });
  setTimeout(play, Number(env.ER_STUB_DELAY || 0));
});
