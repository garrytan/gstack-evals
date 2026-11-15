// Copyright (c) 2026 Garry Tan. MIT License.
// The Claude Code driver's founder-loop options through the real pinned Agent SDK and Claude Code CLI against the
// adapter harness's scripted upstream, run as its own process because another test file mocks the Agent SDK for the
// rest of bun's one process (the reason tests/pv/pv-sdk.ts gives). Prints one JSON object with each case's result.
// Usage: bun driver-sdk.ts
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeCodeDriver, type ClaudeCodeOptions, type NextUser } from "../../../src/adapters/claude-code/driver.ts";
import { harness, type Script } from "../../adapters/harness.ts";

const MODEL = "claude-opus-5-5";

async function session(script: Script, extra: Partial<ClaudeCodeOptions>, timeoutMs = 120_000) {
  const h = harness(script);
  try {
    const b = h.bind(MODEL);
    const d = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: b.slot, token: b.token }, skill: null, out: join(h.dir, "host"), query: query as never, ...extra });
    const r = await d.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), d.env!), { id: "t", prompt: "Go." }, timeoutMs);
    const main = h.upstream.filter((u) => (u.body.tools ?? []).some((t: { name: string }) => t.name === "Bash"));
    return { termination: r.termination, requests: main.length, users: main.at(-1)?.body.messages.filter((m: { role: string; content: unknown }) => m.role === "user" && (typeof m.content === "string" || (Array.isArray(m.content) && !m.content.some((b: { type: string }) => b.type === "tool_result")))).length ?? 0 };
  } finally {
    h.close();
  }
}

const replies = (n: number, sleepMs = 0) => {
  const seen: string[][] = [];
  const nextUser = async (texts: string[]): Promise<NextUser> => {
    seen.push(texts);
    if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs));
    return seen.length < n ? { reply: "Answer " + seen.length + "." } : { end: true };
  };
  return { seen, nextUser };
};

const toolThenText: Script = (t) => (t.results.size >= t.users.length ? [{ type: "text", text: "Reply " + t.users.length + "." }] : [{ type: "tool_use", id: "toolu_" + t.users.length, name: "Bash", input: { command: "true" } }]);
const text: Script = (t) => [{ type: "text", text: "Reply " + t.users.length + "." }];

const perReply = replies(3);
const maxTurns = await session(toolThenText, { maxTurns: 2, nextUser: perReply.nextUser });
const paused = replies(3, 4000);
const clock = await session(text, { nextUser: paused.nextUser }, 6000);
const stopped = await session(text, { nextUser: async () => ({ stop: { kind: "missing", code: "E_OF_SIM_TURN" } }) });
const plain = await session(text, {});
console.log(JSON.stringify({ maxTurns: { ...maxTurns, texts: perReply.seen }, clock: { ...clock, texts: paused.seen }, stopped, plain }));
