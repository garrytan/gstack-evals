// Copyright (c) 2026 Garry Tan. MIT License.
// A direct call's worst case (plan L1): the metering proxy's own reserve, from main's src/runner/pricing. The body is
// priced as the proxy sends it (its provider routing, service tier, inference region and usage fields added), so the
// controller never admits less than the proxy will reserve: the request's UTF-8 bytes plus overhead, or the provider's
// free input count where input-count.ts supplies one, at the long-input tier and the cache-write rate where either can
// apply, plus the output cap at the list output price, reasoning billed as output. Never characters divided by 3.
import { judgeRequest } from "../../../src/adapters/judge.ts";
import { countedInputTokens, countPlan } from "../../../src/runner/pricing/input-count.ts";
import { chatPrice, openRouterRouting, priceRequest, reservationMicros, type Provider } from "../../../src/runner/pricing/prices.ts";
import { MONEY } from "../frozen.ts";
import type { AnyModel } from "../types.ts";

/**
 * The models the lane calls directly, on the routes the price table lists (prereg start rule 9). served_by matches the
 * provider name OpenRouter returns for the row's pin; any other provider is drift (PD-9).
 */
export const DIRECT_MODELS: Readonly<Record<AnyModel, { provider: Provider; id: string; served_by?: RegExp }>> = {
  opus: { provider: "anthropic", id: "claude-opus-5-5" },
  astra: { provider: "openai", id: "gpt-6-astra" },
  sol: { provider: "openrouter", id: "openai/gpt-6.1-sol", served_by: /^openai$/i },
  particle: { provider: "openrouter", id: "particle-ai/particle-1", served_by: /^particle/i },
  argon: { provider: "openrouter", id: "google/gemini-4-argon", served_by: /^google/i },
};

export const ROUTE: Record<Provider, string> = { anthropic: "/v1/messages", openai: "/v1/responses", openrouter: "/v1/chat/completions" };

export type OutputRole = keyof typeof MONEY.outputCaps;

/** BT (L1): the output cap of a call in its role; a resend asks for twice the cap. */
export const outputCap = (role: OutputRole, resend = false) => MONEY.outputCaps[role] * (resend ? 2 : 1);

/** The request body a direct call sends, before the proxy's additions. */
export function requestBody(model: AnyModel, prompt: string, maxTokens: number, effort?: string | null): Record<string, unknown> {
  const m = DIRECT_MODELS[model];
  if (m.provider === "openai") return judgeRequest("openai", m.id, prompt, maxTokens, effort ?? undefined);
  const messages = [{ role: "user", content: prompt }];
  if (m.provider === "anthropic") return { model: m.id, max_tokens: maxTokens, messages, ...(effort ? { output_config: { effort } } : {}) };
  return { model: m.id, max_tokens: maxTokens, messages, ...(effort ? { reasoning: { effort } } : {}) };
}

/** The body as the metering proxy prices it. An inference region is added on every Anthropic body, which can only raise the bound. */
export function proxiedBody(provider: Provider, route: string, body: Record<string, unknown>): Record<string, unknown> {
  const b = structuredClone(body);
  if (provider === "openai" && b.service_tier === undefined) b.service_tier = "default";
  if (provider === "anthropic" && b.inference_geo === undefined) b.inference_geo = "global";
  const listed = chatPrice(provider + ":" + String(b.model));
  if (provider === "openrouter" && listed) b.provider = openRouterRouting(listed);
  if (provider === "openrouter" && route === "/v1/chat/completions") {
    b.max_tokens ??= b.max_completion_tokens;
    if (b.usage === undefined) b.usage = { include: true };
  }
  return b;
}

const statedCap = (provider: Provider, route: string, body: Record<string, unknown>): number | null => {
  const fields = provider === "anthropic" || route === "/v1/messages" ? ["max_tokens"] : provider === "openrouter" ? ["max_tokens", "max_completion_tokens"] : ["max_output_tokens", "max_completion_tokens", "max_tokens"];
  const stated = fields.map((f) => body[f]).filter((v): v is number => typeof v === "number");
  return stated.length ? Math.max(...stated) : null;
};

/**
 * The worst case in micros. freeCount, when given, is the provider's free input count for the body as the proxy sends
 * it; the reserve then uses main's countedInputTokens, never above the byte bound.
 */
export function worstCaseMicros(provider: Provider, body: Record<string, unknown>, o: { route?: string; freeCount?: number } = {}): number {
  const route = o.route ?? ROUTE[provider];
  const sent = proxiedBody(provider, route, body);
  const cap = statedCap(provider, route, sent);
  if (cap === null) throw new Error("a direct call states its output cap; this body states none");
  const price = priceRequest(provider, sent, cap, route);
  if (o.freeCount === undefined) return reservationMicros(price);
  const plan = countPlan(provider, route, sent, price);
  if (!plan) return reservationMicros(price);
  return reservationMicros({ ...price, inputTokens: countedInputTokens(plan, o.freeCount, price.inputTokens) });
}

/** The worst case of one direct call on a lane model. */
export function callWorstCase(model: AnyModel, prompt: string, maxTokens: number, effort?: string | null): number {
  const m = DIRECT_MODELS[model];
  return worstCaseMicros(m.provider, requestBody(model, prompt, maxTokens, effort));
}
