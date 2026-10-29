import { MODELS, WEB_SEARCH_USD, type Price } from "./config.ts";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  webSearches: number;
}

export const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearches: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    webSearches: a.webSearches + b.webSearches,
  };
}

export function fromApiUsage(u: any): Usage {
  if (!u || typeof u !== "object") return zeroUsage();
  const created = Number(u.cache_creation_input_tokens ?? 0);
  const split = u.cache_creation ?? {};
  const w1h = Number(split.ephemeral_1h_input_tokens ?? 0);
  const w5m = split.ephemeral_5m_input_tokens !== undefined ? Number(split.ephemeral_5m_input_tokens) : created - w1h;
  return {
    input: Number(u.input_tokens ?? 0),
    output: Number(u.output_tokens ?? 0),
    cacheRead: Number(u.cache_read_input_tokens ?? 0),
    cacheWrite5m: Math.max(0, w5m),
    cacheWrite1h: w1h,
    webSearches: Number(u.server_tool_use?.web_search_requests ?? 0),
  };
}

export const finiteUsage = (u: Usage): boolean => Object.values(u).every((x) => Number.isFinite(x) && x >= 0);

// A usage block counts as read only when it carries both token counts; anything less is charged at the bound.
export const hasUsage = (u: any): boolean => typeof u === "object" && u !== null && Number.isFinite(u.input_tokens) && Number.isFinite(u.output_tokens);

export function mergeStreamUsage(start: Usage, delta: Usage): Usage {
  const written = Math.max(start.cacheWrite5m + start.cacheWrite1h, delta.cacheWrite5m + delta.cacheWrite1h);
  const w1h = Math.max(start.cacheWrite1h, delta.cacheWrite1h);
  return {
    input: Math.max(start.input, delta.input),
    output: Math.max(start.output, delta.output),
    cacheRead: Math.max(start.cacheRead, delta.cacheRead),
    cacheWrite5m: Math.max(0, written - w1h),
    cacheWrite1h: w1h,
    webSearches: Math.max(start.webSearches, delta.webSearches),
  };
}

export function priceFor(model: string, u: Usage): Price {
  const spec = MODELS[model];
  if (!spec) throw new Error(`E_PRICE: no price for ${model}`);
  const prompt = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
  if (spec.longPrice && prompt > spec.longPrice.threshold) return spec.longPrice.price;
  return spec.price;
}

export function costUsd(model: string, u: Usage): number {
  const p = priceFor(model, u);
  return (
    (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite5m * p.cacheWrite5m + u.cacheWrite1h * p.cacheWrite1h) / 1e6 +
    u.webSearches * WEB_SEARCH_USD
  );
}
