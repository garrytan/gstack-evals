// Copyright (c) 2026 Garry Tan. MIT License.
// Vendored from harness-evals (https://github.com/garrytan/harness-evals) runner/ledger/budget-ledger.ts at 70cb3d019,
// the pricing section only: CHAT_PRICE_OVERRIDES, chatPrice, priceRequest, reservationUsd, usageCost and sseUsage.
// Changes from upstream (U3):
// - Anthropic Messages and OpenAI chat and Responses only. Embeddings, rerank, Gemini, Groq, TypeSafe and OpenRouter
//   pricing are dropped (OpenRouter waits for M2a), and so is the fallback to gbrain's canonical table: a model missing
//   here is refused, never priced from another table.
// - Rows kept for the current generation of each family plus the ids the plan names; Sonnet rows stay so a caller's own
//   policy can allow it, and the model allowlist, not this table, enforces the no-Sonnet default.
// - Money is integer micro-dollars: reservationMicros and usageCost round up. usageCost returns TokenUsage
//   (src/types.ts), with reasoning tokens split out of output tokens.
// - priceRequest throws PriceError instead of BudgetExceededError, takes the provider, not a URL, and bounds input at one
//   token per byte of the outgoing body (upstream's proxy applied the same floor on top of a 3-bytes-per-token estimate).
// - Inputs the provider bills beyond their bytes (remote media, stored files, hosted tools) are refused, and Anthropic's
//   one-hour cache writes are priced at twice input, in the reservation and the settlement.

import type { TokenUsage } from "../../types.ts";

export type Provider = "anthropic" | "openai";

interface TokenPrices {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

/** A model whose prompts over above_input_tokens (cache reads and writes included) are billed at other rates for the whole request. */
export interface ChatPrice extends TokenPrices {
  long?: TokenPrices & { above_input_tokens: number };
}

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
};

/** A dated API snapshot (gpt-5.5-2026-08-06) is billed at its family's list price. */
export const chatPrice = (id: string): ChatPrice | undefined => CHAT_PRICES[id] ?? CHAT_PRICES[id.replace(/-\d{4}-?\d{2}-?\d{2}$/, "")];

/** Input reserved for an OpenAI previous_response_id: the largest priced OpenAI context window. */
export const UNKNOWN_CHAIN_CONTEXT_TOKENS = 1_050_000;

export class PriceError extends Error {}

export interface RequestPrice extends TokenPrices {
  provider: Provider;
  model: string;
  /** The prompt-cache write the request may pay for: none, a cache_write-rate write, or Anthropic's one-hour write. */
  cacheWrite: "none" | "5m" | "1h";
  long?: ChatPrice["long"];
  /** Input-token bound: one token per byte of the outgoing body, plus the context a previous_response_id carries. */
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

/** Price a chat request from its outgoing JSON body, or throw PriceError: a request the table cannot price is never forwarded. */
export function priceRequest(provider: Provider, body: Record<string, unknown>, maxOutputTokens: number): RequestPrice {
  const model = typeof body.model === "string" ? body.model : "";
  if (!model) throw new PriceError("the request names no model, so its cost cannot be reserved");
  const price = chatPrice(`${provider}:${model}`);
  if (!price) throw new PriceError(`no price for ${provider}:${model}, so its cost cannot be reserved`);
  const unbounded = unboundedInput(body);
  if (unbounded) throw new PriceError(`the request uses ${unbounded}, whose cost the proxy cannot bound from the request`);
  if (body.n !== undefined && body.n !== 1) throw new PriceError(`n=${JSON.stringify(body.n)} asks for several completions, each billed in full`);
  if (provider === "openai" && body.service_tier !== undefined && body.service_tier !== "default") throw new PriceError(`service_tier ${JSON.stringify(body.service_tier)} may bill above the standard rates in the price table`);
  const json = JSON.stringify(body);
  const chained = typeof body.previous_response_id === "string" ? UNKNOWN_CHAIN_CONTEXT_TOKENS : 0;
  // OpenAI caches automatically; Anthropic writes its cache only where a request sets cache_control.
  const cacheWrite = provider === "openai" ? "5m" : !json.includes('"cache_control"') ? "none" : /"ttl"\s*:\s*"1h"/.test(json) ? "1h" : "5m";
  return { provider, model, ...price, cacheWrite, inputTokens: Buffer.byteLength(json) + 64 + chained, maxOutputTokens };
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

/** Cost in integer micro-dollars (rounded up) and tokens from provider-reported usage, or null when it reports none. */
export function usageCost(price: RequestPrice, usage: unknown): { micros: number; usage: TokenUsage } | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const sub = (key: string, field: string) => n((u[key] as Record<string, unknown> | undefined)?.[field]);
  // Anthropic reports cache reads and writes beside input_tokens; OpenAI counts them inside input_tokens or prompt_tokens.
  const cacheRead = n(u.cache_read_input_tokens) + sub("input_tokens_details", "cached_tokens") + sub("prompt_tokens_details", "cached_tokens");
  const cacheWrite = n(u.cache_creation_input_tokens) + sub("input_tokens_details", "cache_write_tokens") + sub("prompt_tokens_details", "cache_write_tokens");
  const write1h = Math.min(sub("cache_creation", "ephemeral_1h_input_tokens"), cacheWrite);
  const allInput = price.provider === "anthropic" ? n(u.input_tokens) + cacheRead + cacheWrite : n(u.input_tokens) + n(u.prompt_tokens);
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
  return { micros: Math.ceil(micros), usage: { input: fresh, output: allOutput - reasoning, reasoning, cache_read: cacheRead, cache_write: cacheWrite } };
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
      for (const [k, v] of Object.entries(usage)) if (typeof v === "number" || (v && typeof v === "object")) merged[k] = v;
    }
    if (finalUsage && typeof finalUsage === "object") final = true;
  }
  return final ? merged : null;
}
