// A stub Claude Code CLI for the pinned Agent SDK (tests/adapters/claude-code.test.ts). It answers the SDK's control
// requests and, on each user message, emits one tool_use. STUB_MODE=turn1 exits 0 right after the first tool_use;
// STUB_MODE=turn2 ends the first turn with a question and a result, then exits 0 after the second turn's tool_use.
// STUB_MODE=content answers instead with the blocks STUB_CONTENT holds (a JSON array) and a success result, STUB_DELAY ms
// after the user message (no result with STUB_HANG=1, so the turn never ends; STUB_CONTENT_LATER, when set, answers every
// user message after the first). STUB_MODE=exit exits with STUB_EXIT after the tool_use: STUB_DELAY ms later, or with
// STUB_ON_EOF=1 only once its stdin closes. STUB_STDERR is written to stderr STUB_STDERR_TIMES times (default once) on each
// user message. STUB_RECORD, when set, names a file the stub appends its argv, every control request and every user
// message to, one JSON line each. The modes below copy pinned CLI 2.1.314's messages
// (tests/adapters/claude-code.test.ts runs the real CLI): STUB_MODE=turns takes one Bash turn per model turn until the
// argv's --max-turns=<n>, then ends with an error_max_turns result; STUB_TURN_TEXTS, a JSON object from turn number to text, writes that text as its own message before the turn's
// tool_use. STUB_MODE=apierror answers with one tool_use, then the CLI's synthetic API error message whose text is
// STUB_API_ERROR (status STUB_API_STATUS) and its result. STUB_MODE=agents launches the subagents STUB_AGENTS lists (a
// JSON array of {id, prompt, started, tokens}) through the Agent tool in one message, starts each with started true
// (task_started, one subagent message, task_notification with tokens as total_tokens when given), then answers with
// STUB_FINAL's text and a success result. STUB_MODE=background copies 2.1.314's background work (GST-734): STUB_BG, a JSON
// object, lists readers ({id, delay, kind, ambient, nested}) the prompt's turn launches in the background (an Agent call,
// or a Bash call for kind local_bash), each with the level (background_tasks_changed), task_started and its tool result.
// STUB_BG.wakeup ({delay, text, stop}) then sets a ScheduleWakeup, and cancels it in the same turn with stop true. The turn ends with "Waiting." and a result, and the stub keeps
// reading. A reader with a delay lands that many ms later: its subagent message, task_updated, task_notification and the
// level without it, then a turn of its own (init, text, a result whose origin is the task notification). That turn's text
// is STUB_FINAL once no reader the main thread launched is out, else "Still waiting."; a null delay never lands. The
// wakeup fires after its delay: a command_lifecycle, then a turn whose text is wakeup.text, or "Still waiting." while a
// reader is out. STUB_BG.wake_error, an API error's text (status STUB_API_STATUS), answers the first turn after the prompt's.
// STUB_BG.late_level sends a landing reader's level after its turn, as the SDK allows (the level's order is unspecified).
// STUB_BG.first replaces the prompt's turn text ("Waiting."). A reader with stall true starts its landing turn (init and
// its text) and never ends it, so the main agent is mid-turn from then on; stall "init" stops right after the turn's init,
// before any text. A reader's think delays its landing turn's text and result that many ms after the turn's init.
const rl = require("readline").createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const env = process.env;
if (env.STUB_RECORD) require("fs").appendFileSync(env.STUB_RECORD, JSON.stringify({ argv: process.argv.slice(2) }) + "\n");
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
    if (env.STUB_RECORD) require("fs").appendFileSync(env.STUB_RECORD, JSON.stringify(m) + "\n");
    out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { commands: [], models: [], account: {}, output_style: "default", available_output_styles: [] } } });
    return;
  }
  if (m.type !== "user") return;
  if (env.STUB_RECORD) require("fs").appendFileSync(env.STUB_RECORD, JSON.stringify(m) + "\n");
  users++;
  if (users === 1) out({ type: "system", subtype: "init", session_id: "s", model: "stub", tools: [], cwd: "/", permissionMode: "default", apiKeySource: "none", claude_code_version: "0", skills: [], mcp_servers: [], slash_commands: [], output_style: "default", uuid: "u0" });
  if (env.STUB_STDERR) process.stderr.write(env.STUB_STDERR.repeat(Number(env.STUB_STDERR_TIMES ?? 1)));
  if (env.STUB_MODE === "turns") {
    const cap = Number((process.argv.find((a) => a.startsWith("--max-turns=")) ?? "=0").split("=")[1]);
    const texts = JSON.parse(env.STUB_TURN_TEXTS || "{}");
    for (let n = 1; n <= cap; n++) {
      if (texts[n]) out(assistant("t" + n, [{ type: "text", text: texts[n] }], "tool_use"));
      out(assistant("t" + n, [{ type: "tool_use", id: "tu_t" + n, name: "Bash", input: { command: "true" } }], "tool_use"));
      out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_t" + n, content: "", is_error: false }] }, parent_tool_use_id: null, session_id: "s", uuid: "ur" + n });
    }
    out({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: cap + 1, errors: ["Reached maximum number of turns (" + cap + ")"], terminal_reason: "max_turns", stop_reason: "tool_use", session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "rmax" });
    return;
  }
  if (env.STUB_MODE === "apierror") {
    out(assistant("e1", [{ type: "tool_use", id: "tu_e1", name: "Bash", input: { command: "true" } }], "tool_use"));
    out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_e1", content: "", is_error: false }] }, parent_tool_use_id: null, session_id: "s", uuid: "ue1" });
    const status = Number(env.STUB_API_STATUS ?? 402);
    out({ type: "assistant", message: { id: "synthetic-e2", type: "message", role: "assistant", model: "<synthetic>", content: [{ type: "text", text: env.STUB_API_ERROR }], stop_reason: "stop_sequence", stop_sequence: "", usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: null, session_id: "s", uuid: "ae2", error: "unknown", is_api_error_message: true, api_error_status: status });
    out({ type: "result", subtype: "success", is_error: true, num_turns: 2, result: env.STUB_API_ERROR, api_error_status: status, terminal_reason: "api_error", stop_reason: "stop_sequence", session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "rerr" });
    return;
  }
  if (env.STUB_MODE === "agents") {
    const agents = JSON.parse(env.STUB_AGENTS || "[]");
    for (const a of agents) out(assistant("launch", [{ type: "tool_use", id: a.id, name: "Agent", input: { description: "reader " + a.id, prompt: a.prompt, subagent_type: "general-purpose" } }], "tool_use"));
    for (const a of agents.filter((x) => x.started)) out({ type: "system", subtype: "task_started", task_id: "task_" + a.id, run_id: "run_" + a.id, tool_use_id: a.id, description: "reader " + a.id, subagent_type: "general-purpose", is_backgrounded: true, spawn_depth: 1, task_type: "local_agent", prompt: a.prompt, session_id: "s", uuid: "ts_" + a.id });
    for (const a of agents) out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: a.id, content: a.started ? "Async agent launched." : "Agent refused.", is_error: !a.started }] }, parent_tool_use_id: null, session_id: "s", uuid: "ul_" + a.id });
    for (const a of agents.filter((x) => x.started)) {
      out({ type: "assistant", message: { id: "sub_" + a.id, type: "message", role: "assistant", model: "stub", content: [{ type: "text", text: "NO FINDINGS" }], stop_reason: null, usage }, parent_tool_use_id: a.id, agent_id: "task_" + a.id, subagent_type: "general-purpose", task_description: "reader " + a.id, session_id: "s", uuid: "as_" + a.id });
      if (a.tokens !== undefined) out({ type: "system", subtype: "task_notification", task_id: "task_" + a.id, run_id: "run_" + a.id, tool_use_id: a.id, status: "completed", summary: "NO FINDINGS", usage: { total_tokens: a.tokens, tool_uses: 0, duration_ms: 1 }, session_id: "s", uuid: "tn_" + a.id });
    }
    out(assistant("final", [{ type: "text", text: env.STUB_FINAL || "done" }], "end_turn"));
    out(result(users, env.STUB_FINAL || "done"));
    return;
  }
  if (env.STUB_MODE === "background") {
    const bg = JSON.parse(env.STUB_BG);
    const live = [];
    const task = (r) => ({ task_id: "task_" + r.id, run_id: "run_" + r.id, task_type: r.kind || "local_agent", description: "reader " + r.id, ...(r.ambient ? { ambient: true } : {}), ...(r.nested ? { parent_task_id: "task_parent" } : {}) });
    const level = () => out({ type: "system", subtype: "background_tasks_changed", tasks: live.map(task), session_id: "s", uuid: "lv" + live.length });
    const out_ = () => live.some((r) => !r.ambient && !r.nested);
    let woken = 0;
    const turn = (text, origin, r = {}) => {
      woken++;
      out({ type: "system", subtype: "init", session_id: "s", model: "stub", tools: [], cwd: "/", permissionMode: "default", apiKeySource: "none", claude_code_version: "0", skills: [], mcp_servers: [], slash_commands: [], output_style: "default", uuid: "i" + woken });
      if (bg.wake_error && woken === 1) {
        out({ type: "assistant", message: { id: "synthetic-w", type: "message", role: "assistant", model: "<synthetic>", content: [{ type: "text", text: bg.wake_error }], stop_reason: "stop_sequence", stop_sequence: "", usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: null, session_id: "s", uuid: "aw", error: "unknown", is_api_error_message: true, api_error_status: Number(env.STUB_API_STATUS ?? 402) });
        out({ type: "result", subtype: "success", is_error: true, num_turns: 1, result: bg.wake_error, terminal_reason: "api_error", session_id: "s", duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage, uuid: "rw" });
        return;
      }
      if (r.stall === "init") return;
      const k = "k" + woken;
      const say = () => {
        out(assistant(k, [{ type: "text", text }], "end_turn"));
        if (r.stall) return;
        out({ ...result(k, text), ...(origin ? { origin } : {}) });
      };
      if (r.think) setTimeout(say, r.think);
      else say();
    };
    for (const r of bg.readers) {
      const bash = r.kind === "local_bash";
      out(assistant("l_" + r.id, [{ type: "tool_use", id: r.id, name: bash ? "Bash" : "Agent", input: bash ? { command: "sleep 600", run_in_background: true } : { description: "reader " + r.id, prompt: "Review the diff.", subagent_type: "general-purpose", run_in_background: true } }], "tool_use"));
      live.push(r);
      level();
      out({ type: "system", subtype: "task_started", task_id: "task_" + r.id, run_id: "run_" + r.id, tool_use_id: r.id, description: "reader " + r.id, task_type: r.kind || "local_agent", is_backgrounded: true, session_id: "s", uuid: "ts_" + r.id });
      out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: r.id, content: bash ? "Command running in background with ID: task_" + r.id + "." : "Async agent launched successfully." }] }, parent_tool_use_id: null, session_id: "s", uuid: "ul_" + r.id });
    }
    if (bg.wakeup) {
      const at = Date.now() + bg.wakeup.delay;
      out(assistant("w", [{ type: "tool_use", id: "tu_wake", name: "ScheduleWakeup", input: { delaySeconds: 60, reason: "fallback in case a reader hangs", prompt: "continue", noop: true } }], "tool_use"));
      out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_wake", content: "Next wakeup scheduled." }] }, parent_tool_use_id: null, session_id: "s", uuid: "uw", tool_use_result: { scheduledFor: at, clampedDelaySeconds: 60, wasClamped: false } });
      if (bg.wakeup.stop) {
        out(assistant("ws", [{ type: "tool_use", id: "tu_wake_stop", name: "ScheduleWakeup", input: { stop: true } }], "tool_use"));
        out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_wake_stop", content: "Loop stopped." }] }, parent_tool_use_id: null, session_id: "s", uuid: "uws", tool_use_result: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false, stopped: true, cancelledWakeups: 1 } });
      } else setTimeout(() => {
        out({ type: "command_lifecycle", command_uuid: "c1", state: "started", wakeup_source: "loop_wakeup", scheduled_for: at, uuid: "cl1", session_id: "s" });
        turn(out_() ? "Still waiting." : bg.wakeup.text);
        out({ type: "command_lifecycle", command_uuid: "c1", state: "completed", uuid: "cl2", session_id: "s" });
      }, bg.wakeup.delay);
    }
    out(assistant("wait", [{ type: "text", text: bg.first || "Waiting." }], "end_turn"));
    out(result("wait", bg.first || "Waiting."));
    for (const r of bg.readers.filter((x) => x.delay !== null)) setTimeout(() => {
      out({ type: "assistant", message: { id: "sub_" + r.id, type: "message", role: "assistant", model: "stub", content: [{ type: "text", text: "FINDING from " + r.id }], stop_reason: null, usage }, parent_tool_use_id: r.id, session_id: "s", uuid: "as_" + r.id });
      out({ type: "system", subtype: "task_updated", task_id: "task_" + r.id, run_id: "run_" + r.id, patch: { status: "completed", end_time: Date.now() }, session_id: "s", uuid: "tu_" + r.id });
      out({ type: "system", subtype: "task_notification", task_id: "task_" + r.id, run_id: "run_" + r.id, tool_use_id: r.id, status: "completed", output_file: "", summary: "done", session_id: "s", uuid: "tn_" + r.id });
      live.splice(live.indexOf(r), 1);
      if (!bg.late_level) level();
      turn(out_() ? "Still waiting." : env.STUB_FINAL || "done", { kind: "task-notification", producer: "session-task", runId: "run_" + r.id }, r);
      if (bg.late_level) level();
    }, r.delay);
    return;
  }
  if (env.STUB_MODE === "content") {
    const n = users;
    setTimeout(() => {
      out(assistant("c" + n, JSON.parse(n > 1 && env.STUB_CONTENT_LATER ? env.STUB_CONTENT_LATER : env.STUB_CONTENT), "end_turn"));
      if (!env.STUB_HANG) out(result(n, ""));
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
