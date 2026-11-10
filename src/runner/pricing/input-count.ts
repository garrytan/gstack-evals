// Copyright (c) 2026 Garry Tan. MIT License.
// Input-token counts for the metering proxy's reservation. priceRequest bounds a call's input at one token per byte of its
// body, which holds for any byte-level tokenizer but runs 3 to 10 times over the real input, and for Sol pushes a large
// request past its 272,000-token line, where every input token costs twice as much. Where a provider counts a request's
// input for free, the proxy reserves at that count instead, and the long-context tier follows the count:
// - Anthropic Messages: Anthropic's count_tokens, sent the request less its generation fields. Anthropic's docs call the
//   count an estimate that may differ from the billed input by a small amount, so the bound adds ANTHROPIC_COUNT_MARGIN and
//   REQUEST_OVERHEAD_TOKENS to it.
// - OpenAI Responses: OpenAI's input_tokens, sent the input fields it takes. OpenAI's docs call the count exact, so the bound
//   is the count. A request that pulls in stored context (storedContext) is not counted.
// - OpenRouter's Messages route, for a model whose row pins it to the openai provider (Sol, as Claude Code runs it): no
//   counter takes the request, so its text, tool calls, tool results and tools are translated into Responses input and
//   counted by the model's own OpenAI counter. Parts the counter is not sent (thinking signatures, media, unknown blocks and
//   tools) stay at a token per byte of their JSON. The bound adds TRANSLATED_BLOCK_TOKENS per translated block, for framing
//   OpenRouter's own translation may add, and TRANSLATED_COUNT_MARGIN, sized from paid probes on this route. That bound is
//   measured, not proven, so the proxy also checks every settled call's real input against it.
// Every bound is capped at the byte bound. Every other route, and any count that fails, keeps the byte bound.

import { chatPrice, REQUEST_OVERHEAD_TOKENS, storedContext, type MeteredProvider, type RequestPrice } from "./prices.ts";

/** Added to Anthropic's count, which its docs call an estimate that may differ from the billed input by a small amount. */
export const ANTHROPIC_COUNT_MARGIN = 0.02;

/**
 * Added to the count of a translated request. The rule: at least 1.5 times the largest relative gap between the input
 * OpenRouter reported and Sol's count of the translation, over the paid probes in tests/proxy/input-count.test.ts. In every
 * probe the reported input came in under the count (by 0.1 to 2.3 percent), so the rule sets no floor above zero, and this
 * margin is a judgment for request shapes the probes did not cover.
 */
export const TRANSLATED_COUNT_MARGIN = 0.05;

/** Framing allowed for each translated block or tool (roles, item wrappers), beyond what the counter's own framing counts. */
export const TRANSLATED_BLOCK_TOKENS = 16;

export interface CountPlan {
  /** The provider whose free counter counts this call's input. */
  counter: "anthropic" | "openai";
  path: "/v1/messages/count_tokens" | "/v1/responses/input_tokens";
  /** The count request's body. */
  body: Record<string, unknown>;
  /** True when body is a translation of the request, not the request itself. */
  translated: boolean;
  /** Translated blocks and tools, each allowed TRANSLATED_BLOCK_TOKENS of framing. */
  blocks: number;
  /** Bytes of the parts the counter is not sent, reserved at a token per byte. */
  opaqueBytes: number;
}

/** Fields of an Anthropic Messages request that shape only its output; count_tokens refuses them. */
const GENERATION_FIELDS = new Set(["max_tokens", "stream", "metadata", "temperature", "top_p", "top_k", "stop_sequences", "service_tier", "inference_geo", "speed"]);

/** The fields OpenAI's input_tokens counter takes; it answers 400 to the rest, max_output_tokens included. */
const RESPONSES_COUNT_FIELDS = ["model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "reasoning", "text", "truncation"];

const ROLES = new Set(["user", "assistant", "system"]);

/** The free count that bounds this call's input, or null when its route has none. body is the request as the proxy sends it. */
export function countPlan(provider: MeteredProvider, route: string, body: Record<string, unknown>, price: RequestPrice): CountPlan | null {
  if (provider === "anthropic" && route === "/v1/messages") return { counter: "anthropic", path: "/v1/messages/count_tokens", body: Object.fromEntries(Object.entries(body).filter(([k]) => !GENERATION_FIELDS.has(k))), translated: false, blocks: 0, opaqueBytes: 0 };
  if (provider === "openai" && route === "/v1/responses") {
    if (storedContext(body)) return null;
    return { counter: "openai", path: "/v1/responses/input_tokens", body: Object.fromEntries(RESPONSES_COUNT_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])), translated: false, blocks: 0, opaqueBytes: 0 };
  }
  const row = chatPrice(`${provider}:${price.model}`);
  if (provider !== "openrouter" || route !== "/v1/messages" || !price.model.startsWith("openai/") || row?.providers?.length !== 1 || row.providers[0] !== "openai") return null;
  return translatedPlan(price.model.slice("openai/".length), body);
}

/** An Anthropic Messages request as OpenAI Responses input: system text, text, tool calls and results, and client tools. */
function translatedPlan(model: string, body: Record<string, any>): CountPlan | null {
  if (!Array.isArray(body.messages)) return null;
  const input: unknown[] = [];
  const tools: unknown[] = [];
  let opaqueBytes = 0;
  const opaque = (v: unknown) => void (opaqueBytes += Buffer.byteLength(JSON.stringify(v) ?? ""));
  const system = body.system;
  if (typeof system === "string") input.push({ role: "system", content: system });
  else if (Array.isArray(system)) for (const s of system) s?.type === "text" && typeof s.text === "string" ? input.push({ role: "system", content: s.text }) : opaque(s);
  else if (system !== undefined) opaque(system);
  for (const m of body.messages) {
    const role = m?.role;
    if (!ROLES.has(role)) {
      opaque(m);
      continue;
    }
    if (typeof m.content === "string") {
      input.push({ role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) {
      opaque(m);
      continue;
    }
    for (const block of m.content) {
      if (block?.type === "text" && typeof block.text === "string") input.push({ role, content: block.text });
      else if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") input.push({ type: "function_call", call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
      else if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
        const parts: string[] = [];
        if (typeof block.content === "string") parts.push(block.content);
        else if (Array.isArray(block.content)) for (const part of block.content) part?.type === "text" && typeof part.text === "string" ? parts.push(part.text) : opaque(part);
        else if (block.content !== undefined) opaque(block.content);
        input.push({ type: "function_call_output", call_id: block.tool_use_id, output: parts.join("\n") });
      } else opaque(block);
    }
  }
  for (const t of Array.isArray(body.tools) ? body.tools : body.tools === undefined ? [] : [body.tools]) {
    if ((t?.type === undefined || t.type === "custom") && typeof t.name === "string" && t.input_schema && typeof t.input_schema === "object") tools.push({ type: "function", name: t.name, ...(typeof t.description === "string" ? { description: t.description } : {}), parameters: t.input_schema, strict: false });
    else opaque(t);
  }
  return { counter: "openai", path: "/v1/responses/input_tokens", body: { model, input, ...(tools.length ? { tools } : {}) }, translated: true, blocks: input.length + tools.length, opaqueBytes };
}

/** The input tokens to reserve for a counted call: the count with its plan's allowances, never above the byte bound. */
export function countedInputTokens(plan: CountPlan, count: number, byteBound: number): number {
  const bound = plan.translated
    ? Math.ceil(count * (1 + TRANSLATED_COUNT_MARGIN)) + plan.blocks * TRANSLATED_BLOCK_TOKENS + plan.opaqueBytes
    : plan.counter === "anthropic"
      ? Math.ceil(count * (1 + ANTHROPIC_COUNT_MARGIN)) + REQUEST_OVERHEAD_TOKENS
      : count;
  return Math.min(bound, byteBound);
}
