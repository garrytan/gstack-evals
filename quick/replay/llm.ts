// Provider calls, prices and the spend ledger for the review replay.
// Every call reserves its worst case in the ledger before it is sent and settles with the
// measured usage after. The cap counts settled spend plus every open reservation.
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

export type ModelSpec = {
  key: string;
  provider: 'anthropic' | 'openrouter' | 'openai';
  model: string;
  effort: string;
  maxTokens: number;
  // USD per million tokens: standard text tokens; worst-case prices for metered providers.
  inPerM: number;
  outPerM: number;
  cacheReadFactor?: number;
};

export const MODELS: Record<string, ModelSpec> = {
  opus: { key: 'opus', provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', maxTokens: 32000, inPerM: 4.0, outPerM: 20.0, cacheReadFactor: 0.05 },
  // The exploratory cell: Opus at high effort, gstack arm only, run only if the cap leaves room.
  'opus-high': { key: 'opus-high', provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', maxTokens: 32000, inPerM: 4.0, outPerM: 20.0, cacheReadFactor: 0.05 },
  haiku: { key: 'haiku', provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 32000, inPerM: 0.1, outPerM: 0.5, cacheReadFactor: 0.1 },
  // DeepSeek's own endpoint on OpenRouter; its off-peak list price is 0.15/0.60, peak hours double it.
  deepseek: { key: 'deepseek', provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', effort: 'high', maxTokens: 32000, inPerM: 0.3, outPerM: 1.2 },
  judge: { key: 'judge', provider: 'openai', model: 'gpt-6.1-sol', effort: 'low', maxTokens: 8000, inPerM: 2.0, outPerM: 10.0 },
};

// Haiku 5.5 bills a prompt over 100,000 input tokens at 0.50/2.50.
function anthropicUsd(spec: ModelSpec, u: any): number {
  const inTok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  let inP = spec.inPerM, outP = spec.outPerM;
  if (spec.model === 'claude-haiku-5-5' && inTok > 100000) { inP = 0.5; outP = 2.5; }
  return ((u.input_tokens ?? 0) * inP + (u.cache_creation_input_tokens ?? 0) * inP * 1.25 + (u.cache_read_input_tokens ?? 0) * inP * (spec.cacheReadFactor ?? 0.1) + (u.output_tokens ?? 0) * outP) / 1e6;
}

// Conservative input estimate: 2 bytes per token (GSTA-131 measured 2.35 on these prompts),
// every input token billed as a 1.25x cache write, and the whole max_tokens as output.
export function worstUsd(spec: ModelSpec, promptBytes: number): number {
  let inP = spec.inPerM * (spec.provider === 'anthropic' ? 1.25 : 1), outP = spec.outPerM;
  const inTok = promptBytes / 2;
  if (spec.model === 'claude-haiku-5-5' && inTok > 100000) { inP = 0.625; outP = 2.5; }
  return (inTok * inP + spec.maxTokens * outP) / 1e6;
}

export class CapError extends Error {}

export class Ledger {
  constructor(readonly file: string, readonly item: string, readonly cap: number) {}

  rows(): any[] {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  private append(row: any) {
    fs.appendFileSync(this.file, JSON.stringify(row) + '\n');
  }

  approve(quotes: { words: string; by: string; context: string }[], note: string) {
    if (this.rows().some(r => r.type === 'approval')) return;
    this.append({ type: 'approval', item: this.item, cap_usd: this.cap, quotes, note, at: new Date().toISOString() });
  }

  // Settled spend plus open reservations, in USD.
  committed(): number {
    const rows = this.rows();
    const settled = new Set(rows.filter(r => r.type === 'settle').map(r => r.reserve_id));
    let usd = 0;
    for (const r of rows) {
      if (r.type === 'settle') usd += r.usd;
      if (r.type === 'reserve' && !settled.has(r.id)) usd += r.usd_worst;
    }
    return usd;
  }

  // limit lets a phase stop below the cap (the review runs keep the judge's share).
  reserve(callId: string, spec: ModelSpec, usdWorst: number, limit = this.cap): string {
    if (!this.rows().some(r => r.type === 'approval')) throw new CapError('no approval row in ' + this.file);
    const max = Math.min(limit, this.cap);
    if (!Number.isFinite(max) || !Number.isFinite(usdWorst)) throw new CapError('CAP: limit ' + limit + ' or worst case ' + usdWorst + ' is not a number');
    const c = this.committed();
    if (c + usdWorst > max) throw new CapError('CAP: ' + c.toFixed(4) + ' committed + ' + usdWorst.toFixed(4) + ' worst case > ' + max);
    const id = crypto.randomUUID();
    this.append({ type: 'reserve', id, item: this.item, call_id: callId, provider: spec.provider, model: spec.model, effort: spec.effort, usd_worst: round(usdWorst), at: new Date().toISOString() });
    return id;
  }

  settle(reserveId: string, callId: string, outcome: 'ok' | 'error', usd: number, usage: any) {
    this.append({ type: 'settle', reserve_id: reserveId, item: this.item, call_id: callId, outcome, usd: round(usd), usage, at: new Date().toISOString() });
  }
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export type CallResult = { text: string; usage: any; usd: number; stop: string | null; provider_served: string | null; model_served: string | null; ms: number };

const BASE = {
  anthropic: () => process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
  openrouter: () => process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai',
  openai: () => process.env.OPENAI_BASE_URL ?? 'https://api.openai.com',
};

class HttpError extends Error {
  constructor(readonly status: number, msg: string) { super(msg); }
}

// timeout: false turns off Bun's idle timeout, which would cut a silent non-streaming reply at
// about 5 minutes; the 20-minute abort signal is the only limit.
async function post(url: string, headers: Record<string, string>, body: any): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20 * 60 * 1000), timeout: false } as RequestInit);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok || json?.error) throw new HttpError(res.status, res.status + ' ' + JSON.stringify(json?.error ?? json).slice(0, 300));
  return json;
}

function key(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(name + ' is not set');
  return v;
}

async function once(spec: ModelSpec, prompt: string, schema?: any, cache = true): Promise<CallResult> {
  const t0 = Date.now();
  if (spec.provider === 'anthropic') {
    const j = await post(BASE.anthropic() + '/v1/messages', { 'x-api-key': key('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      { model: spec.model, max_tokens: spec.maxTokens, messages: [{ role: 'user', content: [{ type: 'text', text: prompt, ...(cache ? { cache_control: { type: 'ephemeral' } } : {}) }] }], output_config: { effort: spec.effort } });
    if (!j.usage) throw new Error('Anthropic response carried no usage');
    const text = (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    return { text, usage: j.usage, usd: anthropicUsd(spec, j.usage), stop: j.stop_reason ?? null, provider_served: 'anthropic', model_served: j.model ?? null, ms: Date.now() - t0 };
  }
  if (spec.provider === 'openrouter') {
    const j = await post(BASE.openrouter() + '/api/v1/chat/completions', { authorization: 'Bearer ' + key('OPENROUTER_API_KEY') },
      { model: spec.model, messages: [{ role: 'user', content: prompt }], max_tokens: spec.maxTokens, reasoning: { effort: spec.effort }, provider: { order: ['deepseek'], allow_fallbacks: false }, usage: { include: true } });
    const served = j.provider ?? null;
    if (served && !/deepseek/i.test(served)) throw new Error('served by ' + served + ', not DeepSeek');
    const u = j.usage ?? {};
    if (typeof u.cost !== 'number') throw new Error('OpenRouter response carried no usage.cost');
    return { text: j.choices?.[0]?.message?.content ?? '', usage: u, usd: u.cost, stop: j.choices?.[0]?.finish_reason ?? null, provider_served: served, model_served: j.model ?? null, ms: Date.now() - t0 };
  }
  const j = await post(BASE.openai() + '/v1/responses', { authorization: 'Bearer ' + key('OPENAI_API_KEY') },
    { model: spec.model, input: prompt, reasoning: { effort: spec.effort }, max_output_tokens: spec.maxTokens, ...(schema ? { text: { format: { type: 'json_schema', name: 'verdict', strict: true, schema } } } : {}) });
  if (!j.usage) throw new Error('OpenAI response carried no usage');
  const text = (j.output ?? []).filter((o: any) => o.type === 'message').flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('\n');
  const u = j.usage;
  return { text, usage: u, usd: ((u.input_tokens ?? 0) * spec.inPerM + (u.output_tokens ?? 0) * spec.outPerM) / 1e6, stop: j.status ?? null, provider_served: 'openai', model_served: j.model ?? null, ms: Date.now() - t0 };
}

// One metered call. Only a 429 or 5xx status retries (up to three times, with backoff). A
// failure with an HTTP error status (400 and up) settles at $0, since the provider bills
// nothing for it; any other failure (a 200 with an error body, a timeout, a dropped
// connection, a body without usage) settles at the worst case, since the request may still
// have been billed. Failures are recorded, never retried.
// cache: false sends an Anthropic prompt without cache_control, for a prompt no later call
// repeats (a Red Team prompt carries its own trial's findings).
// A provider failure, settled in the ledger: the call's terminal INFRA outcome. Any other error
// from here (a ledger read or write) is not a provider outcome and should stop the run.
export class ProviderError extends Error {}

export async function meteredCall(ledger: Ledger, callId: string, spec: ModelSpec, prompt: string, opts: { limit?: number; schema?: any; cache?: boolean } = {}): Promise<CallResult> {
  const rid = ledger.reserve(callId, spec, worstUsd(spec, Buffer.byteLength(prompt)), opts.limit);
  let last: any;
  for (let attempt = 0; attempt < 4; attempt++) {
    let r: CallResult;
    try {
      r = await once(spec, prompt, opts.schema, opts.cache ?? true);
    } catch (e: any) {
      last = e;
      const retryable = e instanceof HttpError && (e.status === 429 || e.status >= 500);
      if (!retryable || attempt === 3) break;
      await new Promise(res => setTimeout(res, 2000 * 2 ** attempt));
      continue;
    }
    ledger.settle(rid, callId, 'ok', r.usd, { ...r.usage, attempts: attempt + 1 });
    return r;
  }
  const billed = last instanceof HttpError && last.status >= 400 ? 0 : worstUsd(spec, Buffer.byteLength(prompt));
  ledger.settle(rid, callId, 'error', billed, { error: String(last?.message ?? last).slice(0, 300) });
  throw new ProviderError(String(last?.message ?? last));
}
