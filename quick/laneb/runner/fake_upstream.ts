// Fake Anthropic Messages upstream for keyless tests of the Lane B runner.
// It plays a fixed script of tool calls and reports token usage, so the proxy's
// metering, the agent, the arm injection, the simulator, the patch export and the
// separate verifier can all be exercised without a key.
import { appendFileSync } from "node:fs";

const LOG = process.env.FAKE_UPSTREAM_LOG ?? "fake-upstream.jsonl";
const PORT = Number(process.env.FAKE_UPSTREAM_PORT ?? 8799);
const USAGE = { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 5000, output_tokens: 150 };

export type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

export function toolResults(messages: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of messages ?? []) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      const c = Array.isArray(b.content) ? b.content.map((x: any) => x.text ?? "").join("") : String(b.content ?? "");
      out[b.tool_use_id] = c;
    }
  }
  return out;
}

export function nextTurn(body: any): Block[] {
  const r = toolResults(body.messages);
  if (!("toolu_fake_1" in r)) return [{ type: "tool_use", id: "toolu_fake_1", name: "Bash", input: { command: "ls -1 /root/.claude/skills 2>/dev/null | head -50; echo ---; cat calc.py", description: "Look around" } }];
  if (!("toolu_fake_2" in r)) {
    if (/\binvestigate\b/.test(r.toolu_fake_1)) return [{ type: "tool_use", id: "toolu_fake_2", name: "Skill", input: { skill: "investigate" } }];
    return [{ type: "tool_use", id: "toolu_fake_2", name: "Bash", input: { command: "echo no-skill", description: "No skill to open" } }];
  }
  if (!("toolu_fake_3" in r)) return [{ type: "tool_use", id: "toolu_fake_3", name: "AskUserQuestion", input: { questions: [{ question: "Which fix should I apply?", header: "Fix", multiSelect: false, options: [{ label: "Fix add (Recommended)", description: "Make add return a + b" }, { label: "Rewrite module", description: "Start over" }] }] } }];
  if (!("toolu_fake_4" in r)) return [{ type: "tool_use", id: "toolu_fake_4", name: "Bash", input: { command: "sed -i 's/return a - b/return a + b/' calc.py && python3 -c 'import calc; print(calc.add(2, 3))'", description: "Apply the fix" } }];
  return [{ type: "text", text: "Fixed add() in calc.py." }];
}

export function sse(model: string, blocks: Block[]): string {
  const stop = blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
  const ev: [string, unknown][] = [["message_start", { type: "message_start", message: { id: "msg_fake_" + Date.now(), type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: USAGE.input_tokens, cache_creation_input_tokens: USAGE.cache_creation_input_tokens, cache_read_input_tokens: USAGE.cache_read_input_tokens, output_tokens: 1 } } }]];
  blocks.forEach((b, i) => {
    if (b.type === "text") {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }]);
    } else {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]);
    }
    ev.push(["content_block_stop", { type: "content_block_stop", index: i }]);
  });
  ev.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: USAGE.output_tokens } }]);
  ev.push(["message_stop", { type: "message_stop" }]);
  return ev.map(([n, e]) => `event: ${n}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

export function startFakeUpstream(port = PORT, logPath = LOG, script: (body: any) => Block[] = nextTurn) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST") return Response.json({ ok: true });
      const body = (await req.json()) as any;
      const tools = Array.isArray(body.tools) ? body.tools.map((t: any) => t.name) : [];
      const entry = { path: url.pathname, model: body.model, auth: req.headers.get("x-api-key") ? "x-api-key" : req.headers.get("authorization") ? "bearer" : "none", stream: Boolean(body.stream), n_tools: tools.length, has_skill_tool: tools.includes("Skill"), cache_ttls: [...new Set([...JSON.stringify(body).matchAll(/"cache_control":\{[^}]*\}/g)].map((m) => m[0]))] };
      if (url.pathname.endsWith("/count_tokens")) {
        appendFileSync(logPath, JSON.stringify(entry) + "\n");
        return Response.json({ input_tokens: 10 });
      }
      const blocks: Block[] = tools.includes("Bash") ? script(body) : [{ type: "text", text: "ok" }];
      appendFileSync(logPath, JSON.stringify({ ...entry, reply: blocks.map((b) => (b.type === "tool_use" ? b.name : "text")) }) + "\n");
      if (!body.stream) {
        return Response.json({ id: "msg_fake", type: "message", role: "assistant", model: body.model, content: blocks, stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: USAGE });
      }
      return new Response(sse(body.model, blocks), { headers: { "content-type": "text/event-stream" } });
    },
  });
}

if (import.meta.main) {
  const s = startFakeUpstream();
  console.log(`fake upstream on 127.0.0.1:${s.port}`);
}
