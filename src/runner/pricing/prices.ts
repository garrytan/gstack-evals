// Copyright (c) 2026 Garry Tan. MIT License.
// Vendored from harness-evals (https://github.com/garrytan/harness-evals) runner/ledger/budget-ledger.ts at 70cb3d019,
// the pricing section only: CHAT_PRICE_OVERRIDES, chatPrice, priceRequest, reservationUsd, usageCost and sseUsage.
// Changes from upstream (U3):
// - Anthropic Messages, OpenAI and OpenRouter chat and Responses, and OpenRouter's Anthropic-compatible Messages, only. Embeddings, rerank, Gemini, Groq
//   and TypeSafe pricing are dropped, and so is the fallback to gbrain's canonical table: a model missing here is refused,
//   never priced from another table.
// - Rows kept for the current generation of each family plus the ids the plan names; Sonnet rows stay so a caller's own
//   policy can allow it, and the model allowlist, not this table, enforces the no-Sonnet default.
// - Money is integer micro-dollars: reservationMicros and usageCost round up. usageCost returns TokenUsage
//   (src/types.ts), with reasoning tokens split out of output tokens.
// - priceRequest throws PriceError instead of BudgetExceededError, takes the provider, not a URL, and bounds input at one
//   token per byte of the outgoing body (upstream's proxy applied the same floor on top of a 3-bytes-per-token estimate).
// - Inputs the provider bills beyond their bytes (remote media, stored files, hosted tools) are refused, and Anthropic's
//   one-hour cache writes are priced at twice input, in the reservation and the settlement.
// - The request-shape refusals are refuseRequestShape, which the metering proxy also runs on its free POST routes;
//   mcp_servers, an mcp_toolset tool and OpenAI's web_search_options are refused by name.
// - TypeSafe's System One (decision routing, B3) is priced again, for the pinned Jev versions only: input tokens at the row,
//   output free, and a reservation that bounds every question reading the whole request at one token per byte.

import type { TokenUsage } from "../../types.ts";

export type Provider = "anthropic" | "openai" | "openrouter";
/** Every provider the metering proxy meters: the chat providers and TypeSafe's System One. */
export type MeteredProvider = Provider | "typesafe";

interface TokenPrices {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

/** A model whose prompts over above_input_tokens (cache reads and writes included) are billed at other rates for the whole request. */
export interface ChatPrice extends TokenPrices {
  long?: TokenPrices & { above_input_tokens: number };
  /** OpenRouter only: the providers OpenRouter may route the model to, with no fallback to others. */
  providers?: string[];
  /** OpenRouter only: the quantizations OpenRouter may route the model to. */
  quantizations?: string[];
  /** OpenRouter only: the image price the pinned endpoint lists on OpenRouter's endpoints API, in its units, sent as max_price.image. OpenRouter's max-price filter drops an endpoint whose listed image price is above max_price.image, so a row whose endpoint lists one carries it; a row without one sends 0. */
  image?: number;
}

/**
 * OpenRouter models by OpenRouter id, at list prices in USD per 1M tokens. To add an open-weight ladder slot, add one row
 * with the prices on its OpenRouter model page, and providers to pin the route when one provider sets the row's price.
 * The proxy sends the row's input and output prices as OpenRouter's max_price, or its long-prompt prices where those are
 * higher, so OpenRouter never routes the call to a provider that bills above the row at any prompt length.
 */
export const OPENROUTER_MODELS: Record<string, ChatPrice> = {
  // OpenRouter's models API (https://openrouter.ai/api/v1/models), read 2026-10-30: $0.10 input, $1 output, $0.003 cache read.
  "particle-ai/particle-1": { input: 0.1, output: 1, cache_read: 0.003, providers: ["particle-ai"] },
  // inference.net, a zero-retention host that serves it at fp8, at its price on OpenRouter's endpoints list for this model, read
  // 2026-10-31: $0.08 input, $0.55 output, $0.008 cache read. DeepSeek's own endpoint may train on prompts, so data_collection deny
  // leaves it no route; the rung runs on a third-party fp8 host instead (GST-575, the Captain's option B).
  "deepseek/deepseek-v4.1-flash-1017": { input: 0.08, output: 0.55, cache_read: 0.008, providers: ["inference-net"], quantizations: ["fp8"] },
  // GPT-6.1 Sol as a model under test on the Claude Code host (R54, GST-1019). OpenRouter's models API
  // (https://openrouter.ai/api/v1/models), read 2026-11-02T16:38:39Z: $2 input, $10 output, $0.10 cache read and $2.50 cache
  // write, and $4, $15, $0.20 and $5 past 272,000 prompt tokens (its min_prompt_tokens override). Its endpoints API, read at the
  // same time, lists the openai endpoint at those prices, as does OpenRouter's record of 2026-11-02
  // (wiki/plans/2026-11-02-geva-177-r3-amendment-3/openrouter-gpt-6.1-sol.json); they match the openai:gpt-6.1-sol row.
  // Pinned to the openai provider, as Lane B's R3 row pins it (quick/laneb/config/proxy.json). The proxy refuses a service_tier
  // on OpenRouter, so OpenRouter serves the standard tier, and max_price, at the long rates of $4 and $15, still leaves out
  // openai/fast ($4 and $20) and openai/ultrafast ($12 and $60).
  "openai/gpt-6.1-sol": { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5, long: { above_input_tokens: 272_000, input: 4, output: 15, cache_read: 0.2, cache_write: 5 }, providers: ["openai"] },
  // Gemini 4 Argon, the tbv key writer (prereg 2026-11-05-geva-313). OpenRouter's models API (https://openrouter.ai/api/v1/models),
  // read 2026-11-05T23:51:01Z: $2 input, $10 output, $0.10 cache read and $0.1875 cache write, with no long-prompt rates listed.
  // Its endpoints API (https://openrouter.ai/api/v1/models/google/gemini-4-argon/endpoints), read at the same time, lists Google
  // Vertex (google-vertex/global) at those prices. Pinned to google-vertex, Google's Cloud endpoint, rather than Google AI
  // Studio. The endpoints API lists no data policy, so data_collection deny is what keeps out an endpoint that may train on or
  // keep prompts; max_price at $2 and $10 leaves out the dearer google-vertex/us and priority endpoints. Every Argon endpoint also
  // lists an image price; google-vertex/global's is 0.000002 (endpoints API, read 2026-11-07T07:27Z). With max_price.image at 0,
  // OpenRouter answered 404 "No endpoints found that satisfy the max price for this request" (failed_routing_step "Filter by
  // Max Price"); at 0.000002 the same request reached Google (probe of 2026-11-07, two calls at max_tokens 1). So the row
  // carries that image price. The tbv key writer sends text only.
  "google/gemini-4-argon": { input: 2, output: 10, cache_read: 0.1, cache_write: 0.1875, providers: ["google-vertex"], image: 0.000002 },
};

/**
 * TypeSafe models by model id, USD per 1M tokens. TypeSafe's models page (https://typesafe.ai/pricing), read
 * 2026-11-09T05:04Z: jev-1.14.0 and jev-1.13.0 at $42 per billion input tokens ($0.042 per million); output tokens are free.
 */
export const TYPESAFE_MODELS: Record<string, ChatPrice> = {
  "jev-1.13.0": { input: 0.042, output: 0 },
  "jev-1.14.0": { input: 0.042, output: 0 },
};

/** List prices, USD per 1M tokens, as harness-evals checked them on 2026-10-02 to 2026-10-08. */
export const CHAT_PRICES: Record<string, ChatPrice> = {
  "anthropic:claude-haiku-5-5": { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125, long: { above_input_tokens: 100_000, input: 0.5, output: 2.5, cache_read: 0.05, cache_write: 0.625 } },
  "anthropic:claude-sonnet-5-5": { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  "anthropic:claude-opus-5-5": { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  "anthropic:claude-fable-5-1": { input: 10, output: 50, cache_read: 0.25, cache_write: 12.5 },
  "openai:gpt-5.5": { input: 5, output: 30, cache_read: 0.5 },
  "openai:gpt-6.1-sol": { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5, long: { above_input_tokens: 272_000, input: 4, output: 15, cache_read: 0.2, cache_write: 5 } },
  "openai:gpt-6-luna": { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125, long: { above_input_tokens: 272_000, input: 0.2, output: 0.75, cache_read: 0.02, cache_write: 0.25 } },
  "openai:gpt-6-astra": { input: 10, output: 50, cache_read: 1, cache_write: 12.5, long: { above_input_tokens: 272_000, input: 20, output: 75, cache_read: 2, cache_write: 25 } },
  ...Object.fromEntries(Object.entries(OPENROUTER_MODELS).map(([id, price]) => [`openrouter:${id}`, price])),
  ...Object.fromEntries(Object.entries(TYPESAFE_MODELS).map(([id, price]) => [`typesafe:${id}`, price])),
};

/** The provider object the proxy sends with every OpenRouter call: the row's pinned providers and quantizations, if any, no provider that may train on or keep the data (data_collection deny), and its prices as the most OpenRouter may route to, at the long-prompt rates where those are higher (a prompt past the row's threshold is billed at them), with no per-request charge and no per-image charge above the row's listed image price (0 for a row that lists none). */
export const openRouterRouting = (price: ChatPrice) => ({ ...(price.providers ? { only: price.providers, allow_fallbacks: false } : {}), ...(price.quantizations ? { quantizations: price.quantizations } : {}), data_collection: "deny" as const, max_price: { prompt: Math.max(price.input, price.long?.input ?? 0), completion: Math.max(price.output, price.long?.output ?? 0), request: 0, image: price.image ?? 0 } });

/** A file part: OpenRouter fetches a URL in it, and parses a PDF it cannot pass to the model with a paid OCR engine. */
const filePart = (value: unknown): boolean =>
  Array.isArray(value) ? value.some(filePart) : !!value && typeof value === "object" && ((value as { type?: unknown }).type === "file" || (value as { type?: unknown }).type === "input_file" || Object.values(value).some(filePart));

/** A dated API snapshot (gpt-5.5-2026-08-06) is billed at its family's list price. */
export const chatPrice = (id: string): ChatPrice | undefined => CHAT_PRICES[id] ?? CHAT_PRICES[id.replace(/-\d{4}-?\d{2}-?\d{2}$/, "")];

/** Input reserved for an OpenAI previous_response_id: the largest priced OpenAI context window. */
export const UNKNOWN_CHAIN_CONTEXT_TOKENS = 1_050_000;

/** Framing tokens a provider adds around any request (roles, turn markers) that the body's bytes do not show. */
export const REQUEST_OVERHEAD_TOKENS = 64;

/** Bound on the system prompt a provider adds when a request carries tools (Anthropic documents about 350 tokens). */
export const TOOL_USE_SYSTEM_TOKENS = 1_000;

export class PriceError extends Error {}

export interface RequestPrice extends TokenPrices {
  provider: MeteredProvider;
  model: string;
  /** The usage shape the route reports: Anthropic Messages (cache reads and writes beside input_tokens) or OpenAI (inside it). */
  format: "anthropic" | "openai";
  /** The prompt-cache write the request may pay for: none, a cache_write-rate write, or Anthropic's one-hour write. */
  cacheWrite: "none" | "5m" | "1h";
  long?: ChatPrice["long"];
  /** Input-token bound: one token per byte of the outgoing body, plus framing, the tool-use system prompt, and the stored context a previous_response_id, conversation or item reference pulls in. */
  inputTokens: number;
  maxOutputTokens: number;
}

/** Anthropic bills one-hour cache writes at twice the base input rate (5-minute writes are cache_write). */
export const ANTHROPIC_CACHE_WRITE_1H_MULT = 2;

const HOSTED_TOOL = /web_search|web_fetch|file_search|code_interpreter|code_execution|image_generation|computer_use_preview|^mcp$/;

/**
 * The first part of a request that the provider bills beyond its bytes: a remote or stored file or image (fetched and
 * tokenized by the provider), or a hosted tool enabled under tools (billed per call). Inline base64 media, and replayed
 * hosted-tool calls and results, are counted by their bytes.
 */
function unboundedInput(value: unknown, key = ""): string | null {
  if (typeof value === "string") {
    if ((key === "image_url" || key === "url" || key === "file_url") && !value.startsWith("data:")) return `a remote ${key}`;
    if (key === "file_id") return "a stored file_id";
    return null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = unboundedInput(v, key);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (key === "tools" && typeof v.type === "string" && HOSTED_TOOL.test(v.type)) return `the hosted tool ${v.type}`;
  if (key === "source" && (v.type === "url" || v.type === "file")) return `a ${v.type} source`;
  for (const [k, child] of Object.entries(v)) {
    const found = unboundedInput(child, k);
    if (found) return found;
  }
  return null;
}

/**
 * Throw PriceError for a request shape the proxy never sends on: input or a tool the provider fetches, runs or bills beyond
 * the request's bytes, several completions, a dearer tier, stored input, an OpenRouter field that reroutes the call, MCP
 * servers or an MCP toolset, or OpenAI's web search option. priceRequest runs it on every paid call, and the metering proxy on
 * every free POST route before the request leaves. The named MCP and web search checks run last, so a request refused before
 * they existed keeps its message. TypeSafe's System One takes questions, not chat fields, so it stops after the first two.
 */
export function refuseRequestShape(provider: MeteredProvider, body: Record<string, unknown>): void {
  const unbounded = unboundedInput(body);
  if (unbounded) throw new PriceError(`the request uses ${unbounded}, whose cost the proxy cannot bound from the request`);
  if (body.n !== undefined && body.n !== 1) throw new PriceError(`n=${JSON.stringify(body.n)} asks for several completions, each billed in full`);
  if (provider === "typesafe") return;
  if (provider === "openai" && body.service_tier !== undefined && body.service_tier !== "default") throw new PriceError(`service_tier ${JSON.stringify(body.service_tier)} may bill above the standard rates in the price table`);
  if (provider === "anthropic" && body.speed !== undefined && body.speed !== "standard") throw new PriceError(`speed ${JSON.stringify(body.speed)} bills above the standard rates in the price table`);
  if (provider === "anthropic" && body.inference_geo !== undefined && body.inference_geo !== "global") throw new PriceError(`inference_geo ${JSON.stringify(body.inference_geo)} may bill above the standard rates in the price table`);
  if (provider === "openai" && body.prompt !== undefined) throw new PriceError("a stored prompt adds input, and may enable hosted tools, that the request does not show");
  const tools = Array.isArray(body.tools) ? (body.tools as Array<{ type?: unknown }>) : [];
  if (provider === "openrouter") {
    const rerouted = ["models", "route", "preset", "plugins", "web_search_options", "service_tier", "prompt", "background", "modalities", "image_config", "max_price"].find(k => body[k] !== undefined);
    if (rerouted) throw new PriceError(`OpenRouter's ${rerouted} field can reach other models, tiers, stored input or paid tools that the price row does not cover`);
    const server = tools.find(t => typeof t?.type === "string" && t.type.startsWith("openrouter:"));
    if (server) throw new PriceError(`the OpenRouter server tool ${server.type} runs and bills outside the model's tokens`);
    if (filePart(body.messages) || filePart(body.input)) throw new PriceError("a file part can be fetched from a URL or parsed by paid OCR, which the request's bytes do not bound");
  }
  if (body.mcp_servers !== undefined) throw new PriceError("mcp_servers has the provider call remote MCP servers, which run outside the sandbox and the request's bytes");
  const toolset = tools.find(t => typeof t?.type === "string" && t.type.startsWith("mcp_toolset"));
  if (toolset) throw new PriceError(`the MCP toolset ${toolset.type} has the provider run a remote MCP server's tools, outside the sandbox and the request's bytes`);
  if (provider === "openai" && body.web_search_options !== undefined) throw new PriceError("OpenAI's web_search_options field turns on a web search that runs and bills outside the model's tokens");
}

/** Price a chat request from its outgoing JSON body, or throw PriceError: a request the table cannot price is never forwarded. */
export function priceRequest(provider: MeteredProvider, body: Record<string, unknown>, maxOutputTokens: number, route = ""): RequestPrice {
  const model = typeof body.model === "string" ? body.model : "";
  if (!model) throw new PriceError("the request names no model, so its cost cannot be reserved");
  const price = chatPrice(`${provider}:${model}`);
  if (!price) throw new PriceError(`no price for ${provider}:${model}, so its cost cannot be reserved`);
  refuseRequestShape(provider, body);
  if (provider === "typesafe") {
    const questions = body.questions && typeof body.questions === "object" && !Array.isArray(body.questions) ? Object.keys(body.questions).length : 0;
    if (questions === 0) throw new PriceError("a System One request with no questions cannot be priced");
    return { provider, model, format: "openai", ...price, cacheWrite: "none", inputTokens: (Buffer.byteLength(JSON.stringify(body)) + REQUEST_OVERHEAD_TOKENS) * questions, maxOutputTokens: 0 };
  }
  const json = JSON.stringify(body);
  const stored = (i: Record<string, unknown>) => typeof i.id === "string" && ((i.type == null && i.role === undefined) || (i.type === "reasoning" && typeof i.encrypted_content !== "string"));
  const chained = typeof body.previous_response_id === "string" || body.conversation !== undefined || json.includes('"item_reference"') || (Array.isArray(body.input) && body.input.some(i => i && typeof i === "object" && stored(i))) ? UNKNOWN_CHAIN_CONTEXT_TOKENS : 0;
  const toolUse = Array.isArray(body.tools) && body.tools.length > 0 ? TOOL_USE_SYSTEM_TOKENS : 0;
  // OpenAI caches automatically; Anthropic writes its cache only where a request sets cache_control.
  const cacheWrite = provider === "openai" ? "5m" : !json.includes('"cache_control"') ? "none" : /"ttl"\s*:\s*"1h"/.test(json) ? "1h" : "5m";
  const format = provider === "anthropic" || route === "/v1/messages" ? "anthropic" : "openai";
  return { provider, model, format, ...price, cacheWrite, inputTokens: Buffer.byteLength(json) + REQUEST_OVERHEAD_TOKENS + toolUse + chained, maxOutputTokens };
}

/**
 * Worst case in integer micro-dollars: every input token at the highest input rate the request may pay, plus the full
 * output allowance, at long-prompt rates past the threshold. Prices are USD per million tokens, so tokens times price is
 * micro-dollars; the result is rounded up.
 */
export function reservationMicros(price: RequestPrice): number {
  const rates = price.long && price.inputTokens > price.long.above_input_tokens ? price.long : price;
  const write = price.cacheWrite === "none" ? 0 : Math.max(rates.cache_write ?? 0, price.cacheWrite === "1h" ? rates.input * ANTHROPIC_CACHE_WRITE_1H_MULT : 0);
  return Math.ceil(price.inputTokens * Math.max(rates.input, write) + price.maxOutputTokens * rates.output);
}

/**
 * Cost in integer micro-dollars (rounded up) and tokens from provider-reported usage, or null when it reports none or
 * reports fast mode, which the table does not price. An OpenRouter call costs the larger of its tokens at the row and the
 * usage.cost OpenRouter billed, so a fee outside the tokens is never under-recorded.
 */
export function usageCost(price: RequestPrice, usage: unknown): { micros: number; usage: TokenUsage } | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  if (u.speed === "fast") return null;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const sub = (key: string, field: string) => n((u[key] as Record<string, unknown> | undefined)?.[field]);
  // Anthropic reports cache reads and writes beside input_tokens; OpenAI counts them inside input_tokens or prompt_tokens.
  const cacheRead = n(u.cache_read_input_tokens) + sub("input_tokens_details", "cached_tokens") + sub("prompt_tokens_details", "cached_tokens");
  const cacheWrite = n(u.cache_creation_input_tokens) + sub("input_tokens_details", "cache_write_tokens") + sub("prompt_tokens_details", "cache_write_tokens");
  const write1h = Math.min(sub("cache_creation", "ephemeral_1h_input_tokens"), cacheWrite);
  const allInput = price.format === "anthropic" ? n(u.input_tokens) + cacheRead + cacheWrite : n(u.input_tokens) + n(u.prompt_tokens);
  const allOutput = n(u.output_tokens) + n(u.completion_tokens);
  if (allInput === 0 && allOutput === 0) return null;
  const reasoning = sub("output_tokens_details", "reasoning_tokens") + sub("completion_tokens_details", "reasoning_tokens");
  const rates = price.long && allInput > price.long.above_input_tokens ? price.long : price;
  const fresh = allInput - cacheRead - cacheWrite;
  const micros =
    fresh * rates.input +
    cacheRead * (rates.cache_read ?? rates.input) +
    (cacheWrite - write1h) * (rates.cache_write ?? rates.input) +
    write1h * rates.input * ANTHROPIC_CACHE_WRITE_1H_MULT +
    allOutput * rates.output;
  const billed = price.provider === "openrouter" && typeof u.cost === "number" && Number.isFinite(u.cost) ? Math.ceil(Number((u.cost * 1e6).toFixed(3))) : 0;
  return { micros: Math.max(Math.ceil(micros), billed), usage: { input: fresh, output: allOutput - reasoning, reasoning, cache_read: cacheRead, cache_write: cacheWrite } };
}

/**
 * Final usage from a server-sent-events body. Anthropic splits it between message_start and the cumulative
 * message_delta, OpenAI Responses sends it in response.completed (or response.incomplete or response.failed), and an
 * OpenAI chat stream in its last chunk when include_usage is set. Later keys win, so message_delta's cumulative
 * output_tokens replaces message_start's. A stream that never sent its final usage event returns null, so a stream cut
 * after message_start keeps its reservation instead of settling on the input count alone.
 */
export function sseUsage(text: string): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {};
  let final = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let event: Record<string, any>;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    const finalUsage = event?.response?.usage ?? (event?.type === undefined || event?.type === "message_delta" ? event?.usage : undefined);
    for (const usage of [event?.message?.usage, finalUsage]) {
      if (!usage || typeof usage !== "object") continue;
      for (const [k, v] of Object.entries(usage)) if (typeof v === "number" || (v && typeof v === "object") || k === "speed") merged[k] = v;
    }
    if (finalUsage && typeof finalUsage === "object") final = true;
  }
  return final ? merged : null;
}
