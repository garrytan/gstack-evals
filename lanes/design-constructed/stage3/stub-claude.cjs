// Copyright (c) 2026 Garry Tan. MIT License.
// A stand-in Claude Code CLI for the VM agents' keyless dry run and tests (stage3/dryrun-cases.ts and
// tests/dc/stage3/agent.test.ts). It speaks the Agent SDK's stream-json: it answers control requests, and on the first
// user message makes one Anthropic Messages call to ANTHROPIC_BASE_URL with ANTHROPIC_AUTH_TOKEN as the bearer and
// ANTHROPIC_MODEL as the model, the way the real CLI reaches the metering proxy. The reply's text decides the end: LIMIT
// ends with the turn cap's error_max_turns result, anything else with a success result carrying the text. "--version"
// prints a version and exits 0. It reads no key and reaches nothing but the URL it is given.
if (process.argv.includes("--version")) {
  process.stdout.write("2.1.314 (stand-in)\n");
  process.exit(0);
}
const env = process.env;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const usage = { input_tokens: 1, output_tokens: 1 };
let users = 0;
const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", async (line) => {
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
  if (m.type !== "user" || ++users > 1) return;
  out({ type: "system", subtype: "init", session_id: "s", model: env.ANTHROPIC_MODEL, tools: [], cwd: process.cwd(), permissionMode: "default", apiKeySource: "none", claude_code_version: "2.1.314", skills: [], mcp_servers: [], slash_commands: [], output_style: "default", uuid: "u0" });
  let text;
  try {
    const res = await fetch(env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", headers: { authorization: "Bearer " + env.ANTHROPIC_AUTH_TOKEN, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: env.ANTHROPIC_MODEL, max_tokens: 1000, messages: [{ role: "user", content: "write the recipe" }] }) });
    const body = await res.json();
    text = res.status === 200 ? body.content[0].text : "API Error: " + res.status + " " + JSON.stringify(body);
  } catch (e) {
    text = "API Error: " + e.message;
  }
  if (text.startsWith("API Error")) {
    out({ type: "assistant", message: { id: "e1", type: "message", role: "assistant", model: "<synthetic>", content: [{ type: "text", text }], stop_reason: "stop_sequence", usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: null, session_id: "s", uuid: "ae", error: "unknown", is_api_error_message: true, api_error_status: 500 });
    out({ type: "result", subtype: "success", is_error: true, num_turns: 1, result: text, api_error_status: 500, terminal_reason: "api_error", session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "r1" });
    return;
  }
  out({ type: "assistant", message: { id: "a1", type: "message", role: "assistant", model: env.ANTHROPIC_MODEL, content: [{ type: "text", text }], stop_reason: "end_turn", usage }, parent_tool_use_id: null, session_id: "s", uuid: "a1" });
  if (text === "LIMIT") out({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 2, errors: ["Reached maximum number of turns (1)"], terminal_reason: "max_turns", stop_reason: "end_turn", session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "rmax" });
  else out({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: text, session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "r1" });
});
