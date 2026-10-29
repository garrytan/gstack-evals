// A fake Anthropic Messages server for keyless runs. It plays a fixed script against Claude Code:
// open the skill, run a shell probe, ask one AskUserQuestion, ask one prose question, then two more
// turns, so the proxy, the user simulator, grading and the ledger all run without a key.
import { appendFileSync } from "node:fs";

const PROBE =
  "echo CAL-SHELL-OK; echo SKILLS=$(ls ~/.claude/skills | tr '\\n' ' '); " +
  "~/.claude/skills/gstack/bin/gstack-skill-start --skill \"$FAKE_SKILL\" --model claude 2>&1 | grep -E '^(SESSION_KIND|PROACTIVE|TELEMETRY|SKILL_START_PROTO|GSTACK_INSTRUCTION_BEGIN|UPGRADE|LAKE)' ; " +
  "echo STATE_ROOT=$GSTACK_STATE_ROOT; echo BUNDLED=$CLAUDE_CODE_DISABLE_BUNDLED_SKILLS";

function userTexts(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") out.push(m.content);
    else if (Array.isArray(m.content)) {
      const text = m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      const hasResult = m.content.some((b: any) => b.type === "tool_result");
      if (text && !hasResult) out.push(text);
    }
  }
  return out;
}

function results(messages: any[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      const c = Array.isArray(b.content) ? b.content.map((x: any) => x.text ?? "").join("") : String(b.content ?? "");
      out.set(b.tool_use_id, c);
    }
  }
  return out;
}

export function script(body: any, skill: string): any[] {
  const tools = new Set((body.tools ?? []).map((t: any) => t.name));
  if (!tools.has("Bash")) return [{ type: "text", text: "ok" }];
  const msgs = body.messages ?? [];
  const done = results(msgs);
  const turns = userTexts(msgs).length;
  if (tools.has("Skill") && !done.has("toolu_fake_skill")) return [{ type: "tool_use", id: "toolu_fake_skill", name: "Skill", input: { skill } }];
  if (!done.has("toolu_fake_probe")) return [{ type: "tool_use", id: "toolu_fake_probe", name: "Bash", input: { command: PROBE.replaceAll("$FAKE_SKILL", skill), description: "Calibration probe" } }];
  if (!done.has("toolu_fake_ask"))
    return [
      {
        type: "tool_use",
        id: "toolu_fake_ask",
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Before we dig in, what's your goal with this?",
              header: "Goal",
              multiSelect: false,
              options: [
                { label: "Building a startup", description: "Startup mode" },
                { label: "Having fun", description: "Side project, builder mode" },
              ],
            },
          ],
        },
      },
    ];
  if (turns <= 1) return [{ type: "text", text: "Q1 — What's the strongest evidence you have that someone actually wants this?" }];
  if (turns === 2) return [{ type: "text", text: "PREMISES:\n1. Shops lose hours each month. — agree/disagree?\nDo you agree with these premises?" }];
  return [{ type: "text", text: "APPROACH A: minimal CLI.\nAPPROACH B: web upload.\nI'll stop here." }];
}

export function serveFake(hostname: string, port: number, skillFor: (model: string) => string, logPath?: string) {
  return Bun.serve({
    hostname,
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/messages/count_tokens") return Response.json({ input_tokens: 10 });
      if (url.pathname !== "/v1/messages") return Response.json({ type: "error", error: { type: "not_found_error", message: url.pathname } }, { status: 404 });
      const body = (await req.json()) as any;
      const blocks = script(body, skillFor(body.model));
      if (logPath) appendFileSync(logPath, JSON.stringify({ ts: Date.now(), model: body.model, n: (body.messages ?? []).length, reply: blocks.map((b) => b.name ?? b.type) }) + "\n");
      const stop = blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
      const usage = { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 0 } };
      const msg = { id: `msg_fake_${Date.now()}`, type: "message", role: "assistant", model: body.model, content: [] as any[], stop_reason: null as any, stop_sequence: null, usage };
      if (!body.stream) return Response.json({ ...msg, content: blocks, stop_reason: stop, usage: { ...usage, output_tokens: 50 } });
      const ev: [string, any][] = [["message_start", { type: "message_start", message: msg }]];
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
      ev.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 50 } }]);
      ev.push(["message_stop", { type: "message_stop" }]);
      const data = ev.map(([n, e]) => `event: ${n}\ndata: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(data, { headers: { "content-type": "text/event-stream" } });
    },
  });
}
