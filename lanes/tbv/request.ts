// Copyright (c) 2026 Garry Tan. MIT License.
// The request builder (prereg section 3: four inputs only) and the structural validator.
import { createHash } from "node:crypto";
import { fail } from "./errors.ts";
import { renderHistory } from "./history/events.ts";
import { FROZEN_FIELDS, fillShape, fillText, mapStrings } from "./shape.ts";
import { applySplice, joinRoles } from "./splice.ts";
import { ARM_MODELS, type Block, type BuildInput, type BuiltRequest, type History, type Message, type Model, type Turn, type Validation } from "./types.ts";

export const MAX_TOKENS = 4000;
/** lens.txt's line (prereg section 5); BUNDLE.lens.sha256 is its sha256 with the trailing newline. */
export const LENS_LINE = "In your report, lead with anything that failed, was skipped or was not verified, naming each one.";
/** Context windows from OpenRouter's public models API (https://openrouter.ai/api/v1/models, no key), read 2026-11-05: anthropic/claude-opus-5.5, openai/gpt-6.1-sol, particle-ai/particle-1. */
export const WINDOWS: Readonly<Record<Model, number>> = { opus: 1_000_000, sol: 1_050_000, particle: 1_048_576 };
/** The replies a turn may follow, in order (the follow-up comes only after the report). */
const ORDER: Record<Turn, Turn[][]> = { report: [[]], followup: [["report"]], d1: [["report"], ["report", "followup"]], d2: [["report", "d1"], ["report", "followup", "d1"]] };

const strip = (b: Block): Block => {
  const { cache_control: _, ...rest } = b as Block & { cache_control?: unknown };
  return rest as Block;
};
const withLens = (h: History): History => {
  const [first, ...rest] = h.events;
  if (first?.kind !== "user-text") return fail("E_TBV_REQUEST", h.task + " does not open with the task's first user message");
  return { ...h, events: [{ ...first, text: first.text + "\n\n" + LENS_LINE }, ...rest] };
};

export function buildRequest(input: BuildInput): BuiltRequest {
  const { arm, model, turn, prior, turns } = input;
  const gstack = arm === "current" || arm === "principle";
  if (gstack !== (input.splice !== null)) fail("E_TBV_REQUEST", "the " + arm + " arm " + (gstack ? "needs" : "takes no") + " splice set");
  if (input.shape.arm !== arm && !(arm === "lens" && input.shape.arm === "none")) fail("E_TBV_REQUEST", "a " + input.shape.arm + " shape cannot build a " + arm + " request");
  if (!ORDER[turn].some((seq) => seq.length === prior.length && seq.every((t, i) => prior[i]!.turn === t))) fail("E_TBV_REQUEST", "turn " + turn + " cannot follow replies to [" + prior.map((p) => p.turn).join(", ") + "]");
  const shape = fillShape(input.shape, model, FROZEN_FIELDS);
  const history = arm === "lens" ? withLens(input.history) : input.history;
  const base = input.splice ? applySplice(history, mapStrings(input.splice, (t) => fillText(t, model, FROZEN_FIELDS))) : renderHistory(history);
  const messages = base.map((m) => ({ role: m.role, content: m.content.map(strip) }));
  const last = messages[messages.length - 1];
  if (!last?.content.length) fail("E_TBV_REQUEST", input.history.task + " renders to no messages");
  last.content[last.content.length - 1] = { ...last.content[last.content.length - 1]!, cache_control: { type: "ephemeral" } };
  const ask = (t: Turn): Message => ({ role: "user", content: [{ type: "text", text: turns[t] }] });
  const after: Message[] = [];
  for (const p of prior) {
    after.push(ask(p.turn));
    const content = p.reply.content.filter((b) => b.type !== "tool_use" && (b.type !== "text" || b.text !== "")).map(strip);
    if (content.length) after.push({ role: "assistant", content });
  }
  after.push(ask(turn));
  const body = {
    model: ARM_MODELS[model].id,
    max_tokens: MAX_TOKENS,
    system: shape.system.map((b) => ({ type: "text", text: b.text })),
    tools: shape.tools.map(({ cache_control: _, ...t }) => t),
    tool_choice: { type: "none" },
    messages: joinRoles([...messages, ...after]),
    stream: true,
  };
  const json = JSON.stringify(body);
  return { provider: ARM_MODELS[model].provider, route: "/v1/messages", body, estTokens: Math.ceil(json.length / 3), sha256: createHash("sha256").update(json).digest("hex") };
}

export function validateRequest(body: Record<string, unknown>, model: Model): Validation {
  const problem = (p: string): Validation => ({ ok: false, size: false, problem: p });
  if ("thinking" in body) return problem("the request carries a thinking field");
  const msgs = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!Array.isArray(msgs) || !msgs.length) return problem("the request has no messages");
  const breakpoints: Array<{ ttl?: string }> = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) k === "cache_control" ? breakpoints.push(x as { ttl?: string }) : walk(x);
  };
  walk([body.system, body.tools, msgs]);
  if (breakpoints.length > 4) return problem(breakpoints.length + " cache breakpoints, more than 4");
  if (breakpoints.some((b) => b.ttl === "1h")) return problem("a cache breakpoint with a 1h ttl");
  const blocks = (m: { content: unknown }): Array<Record<string, any>> => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : []);
  const seen = new Set<string>();
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!;
    if (m.role !== "user" && m.role !== "assistant") return problem("message " + i + " has role " + m.role);
    if (i === 0 && m.role !== "user") return problem("the first message is not the user's");
    if (i > 0 && m.role === msgs[i - 1]!.role) return problem("messages " + (i - 1) + " and " + i + " are both " + m.role);
    const bs = blocks(m);
    if (!bs.length) return problem("message " + i + " is empty");
    if (bs.some((b) => b.type === "thinking" || b.type === "redacted_thinking")) return problem("message " + i + " holds a thinking block");
    const uses = bs.filter((b) => b.type === "tool_use").map((b) => String(b.id));
    for (const id of uses) {
      if (seen.has(id)) return problem("tool_use id " + id + " repeats");
      seen.add(id);
      const next = msgs[i + 1];
      if (!next || next.role !== "user" || !blocks(next).some((b) => b.type === "tool_result" && b.tool_use_id === id)) return problem("tool_use " + id + " has no tool_result in the next message");
    }
    const prevUses = i > 0 && msgs[i - 1]!.role === "assistant" ? blocks(msgs[i - 1]!).filter((b) => b.type === "tool_use").map((b) => b.id) : [];
    for (const r of bs.filter((b) => b.type === "tool_result")) if (m.role !== "user" || !prevUses.includes(r.tool_use_id)) return problem("tool_result " + r.tool_use_id + " has no tool_use in the message before it");
  }
  if (msgs[msgs.length - 1]!.role !== "user") return problem("the last message is not the user's turn");
  const tokens = Math.ceil(JSON.stringify(body).length / 3);
  return tokens >= WINDOWS[model] ? { ok: false, size: true, tokens, window: WINDOWS[model] } : { ok: true };
}
