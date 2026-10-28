// Copyright (c) 2026 Garry Tan. MIT License.
// Vendored from harness-evals (https://github.com/garrytan/harness-evals) runner/ledger/budget-ledger.ts at 70cb3d019,
// the pricing section only: CHAT_PRICE_OVERRIDES, chatPrice, priceRequest, reservationUsd, usageCost and sseUsage.
// Changes from upstream (U3):
// - Anthropic Messages and OpenAI chat and Responses only. Embeddings, rerank, Gemini, Groq, TypeSafe and OpenRouter
//   pricing are dropped (OpenRouter waits for M2a), and so is the fallback to gbrain's canonical table: a model missing
//   here is refused, never priced from another table.
// - Rows kept for the current generation of each family plus the ids the plan names; Sonnet rows stay so a caller's own
//   policy can allow it, and the model allowlist, not this table, enforces the no-Sonnet default.
// - usageCost returns TokenUsage (src/types.ts), with reasoning tokens split out of output tokens.
// - priceRequest throws PriceError instead of BudgetExceededError, and takes the provider and route, not a URL.

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
  /** True when the request may write the prompt cache at a price above input; the reservation then prices all input at cache_write. */
  cacheWritePremium: boolean;
  long?: ChatPrice["long"];
  /** Conservative input-token estimate (3 bytes per token), including tool schemas and continuation context. */
  inputTokens: number;
  maxOutputTokens: number;
}

function textBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value);
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + textBytes(v), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((n: number, v) => n + textBytes(v), 0);
  return 0;
}

/** Price a chat request from its JSON body, or throw PriceError: a request the table cannot price is never forwarded. */
export function priceRequest(provider: Provider, body: Record<string, unknown>, maxOutputTokens: number): RequestPrice {
  const model = typeof body.model === "string" ? body.model : "";
  if (!model) throw new PriceError("the request names no model, so its cost cannot be reserved");
  const price = chatPrice(`${provider}:${model}`);
  if (!price) throw new PriceError(`no price for ${provider}:${model}, so its cost cannot be reserved`);
  const toolBytes = body.tools === undefined ? 0 : Buffer.byteLength(JSON.stringify(body.tools));
  const chained = typeof body.previous_response_id === "string" ? UNKNOWN_CHAIN_CONTEXT_TOKENS : 0;
  const inputTokens = Math.ceil((textBytes([body.system, body.instructions, body.messages, body.prompt, body.input]) + toolBytes) / 3) + 16 + chained;
  const cacheWritePremium = price.cache_write !== undefined && price.cache_write > price.input && (provider !== "anthropic" || JSON.stringify(body).includes('"cache_control"'));
  return { provider, model, ...price, cacheWritePremium, inputTokens, maxOutputTokens };
}

/** Worst case: the input estimate (at the cache-write price when it applies) plus the full output allowance, at long-prompt rates past the threshold. */
export function reservationUsd(price: RequestPrice): number {
  const rates = price.long && price.inputTokens > price.long.above_input_tokens ? price.long : price;
  const inputPrice = price.cacheWritePremium ? Math.max(rates.input, rates.cache_write ?? 0) : rates.input;
  return (price.inputTokens * inputPrice + price.maxOutputTokens * rates.output) / 1e6;
}

/** Cost and tokens from provider-reported usage (Anthropic Messages, OpenAI chat or Responses), or null when it reports none. */
export function usageCost(price: RequestPrice, usage: unknown): { usd: number; usage: TokenUsage } | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const sub = (key: string, field: string) => n((u[key] as Record<string, unknown> | undefined)?.[field]);
  // Anthropic reports cache reads and writes beside input_tokens; OpenAI counts them inside input_tokens or prompt_tokens.
  const cacheRead = n(u.cache_read_input_tokens) + sub("input_tokens_details", "cached_tokens") + sub("prompt_tokens_details", "cached_tokens");
  const cacheWrite = n(u.cache_creation_input_tokens) + sub("input_tokens_details", "cache_write_tokens") + sub("prompt_tokens_details", "cache_write_tokens");
  const allInput = price.provider === "anthropic" ? n(u.input_tokens) + cacheRead + cacheWrite : n(u.input_tokens) + n(u.prompt_tokens);
  const allOutput = n(u.output_tokens) + n(u.completion_tokens);
  if (allInput === 0 && allOutput === 0) return null;
  const reasoning = sub("output_tokens_details", "reasoning_tokens") + sub("completion_tokens_details", "reasoning_tokens");
  const rates = price.long && allInput > price.long.above_input_tokens ? price.long : price;
  const fresh = allInput - cacheRead - cacheWrite;
  const usd = (fresh * rates.input + cacheRead * (rates.cache_read ?? rates.input) + cacheWrite * (rates.cache_write ?? rates.input) + allOutput * rates.output) / 1e6;
  return { usd, usage: { input: fresh, output: allOutput - reasoning, reasoning, cache_read: cacheRead, cache_write: cacheWrite } };
}

/**
 * Usage from a server-sent-events body: Anthropic splits it between message_start and the cumulative message_delta,
 * OpenAI Responses sends it in response.completed (or response.incomplete), and an OpenAI chat stream in its last chunk
 * when include_usage is set. Later keys win, so message_delta's cumulative output_tokens replaces message_start's.
 */
export function sseUsage(text: string): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {};
  let found = false;
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
    for (const usage of [event?.usage, event?.response?.usage, event?.message?.usage]) {
      if (!usage || typeof usage !== "object") continue;
      for (const [k, v] of Object.entries(usage)) {
        if (typeof v === "number" || (v && typeof v === "object")) {
          merged[k] = v;
          found = true;
        }
      }
    }
  }
  return found ? merged : null;
}
