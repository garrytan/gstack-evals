// Metering proxy for the Lane B quick look.
// Data plane: Anthropic Messages API for trial containers, authenticated by a per-session token.
// Control plane (127.0.0.1 only): open and close sessions, read totals.
// Real provider keys stay in this process; containers only ever hold a session token.
import { appendFileSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

export type Price = { input: number; output: number; cache_write_5m: number; cache_write_1h: number; cache_read: number };
export type ModelCfg = { route: string; upstream_model: string; price_per_mtok: Price; long_prompt?: { over_tokens: number; price_per_mtok: Price }; body_overrides?: Record<string, unknown>; strip_fields?: string[] };
export type RouteCfg = { base_url: string; key_env: string; auth: "x-api-key" | "bearer"; count_tokens: "forward" | "estimate" };
export type ProxyConfig = { routes: Record<string, RouteCfg>; models: Record<string, ModelCfg> };

export type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_creation_1h_input_tokens: number; cache_read_input_tokens: number };

export const emptyUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0 });

export function mergeUsage(into: Usage, raw: any) {
  if (!raw || typeof raw !== "object") return;
  const take = (k: keyof Usage, v: unknown) => {
    if (typeof v === "number" && v > into[k]) into[k] = v;
  };
  take("input_tokens", raw.input_tokens);
  take("output_tokens", raw.output_tokens);
  take("cache_read_input_tokens", raw.cache_read_input_tokens);
  const cc = raw.cache_creation;
  if (cc && typeof cc === "object") {
    take("cache_creation_1h_input_tokens", cc.ephemeral_1h_input_tokens);
    if (typeof cc.ephemeral_5m_input_tokens === "number") take("cache_creation_input_tokens", cc.ephemeral_5m_input_tokens);
    else take("cache_creation_input_tokens", (raw.cache_creation_input_tokens ?? 0) - (cc.ephemeral_1h_input_tokens ?? 0));
  } else {
    take("cache_creation_input_tokens", raw.cache_creation_input_tokens);
  }
}

// Some models bill a whole request at a higher tier once its prompt passes a size.
export function priceFor(u: Usage, m: Pick<ModelCfg, "price_per_mtok" | "long_prompt">): Price {
  const prompt = u.input_tokens + u.cache_creation_input_tokens + u.cache_creation_1h_input_tokens + u.cache_read_input_tokens;
  return m.long_prompt && prompt > m.long_prompt.over_tokens ? m.long_prompt.price_per_mtok : m.price_per_mtok;
}

export function maxPrice(m: Pick<ModelCfg, "price_per_mtok" | "long_prompt">): Price {
  if (!m.long_prompt) return m.price_per_mtok;
  const a = m.price_per_mtok, b = m.long_prompt.price_per_mtok;
  return { input: Math.max(a.input, b.input), output: Math.max(a.output, b.output), cache_write_5m: Math.max(a.cache_write_5m, b.cache_write_5m), cache_write_1h: Math.max(a.cache_write_1h, b.cache_write_1h), cache_read: Math.max(a.cache_read, b.cache_read) };
}

export function costMicros(u: Usage, p: Price): number {
  const usd = (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_creation_input_tokens * p.cache_write_5m + u.cache_creation_1h_input_tokens * p.cache_write_1h + u.cache_read_input_tokens * p.cache_read) / 1_000_000;
  return Math.ceil(usd * 1_000_000);
}

// Worst case for one request: every input token billed at the highest rate the body can incur
// (uncached or a 5-minute cache write; a 1-hour write only when the body asks for a ttl other than 5m), plus max_tokens of output.
export function worstCaseMicros(inputTokens: number, maxTokens: number, p: Price, longTtl = true): number {
  const inputPrice = Math.max(p.input, p.cache_write_5m, longTtl ? p.cache_write_1h : 0);
  return Math.ceil(((inputTokens * inputPrice + maxTokens * p.output) / 1_000_000) * 1_000_000);
}

export const asksLongTtl = (body: string) => /"ttl":"(?!5m")/.test(body);

// Input tokens for the worst case. Anthropic routes use count_tokens. Otherwise, and when counting fails, one token per
// UTF-8 byte: a byte-level tokenizer never emits more tokens than bytes, and Opus 5.5 counts random base64 at 1.05 bytes
// per token. The slack covers tokens the provider adds around tools and system text. Image and document blocks are billed
// by pixels and pages, not bytes, so an Anthropic route never sends them on the byte bound (hasMedia); on OpenRouter
// that gap stays open and the settle's over_reserve flag shows any session it pushed past its reserve.
export const COUNT_SLACK_TOKENS = 64;
export const BYTE_SLACK_TOKENS = 1024;
export const COUNT_FIELDS = ["model", "messages", "system", "tools", "tool_choice", "thinking"];
export const byteBoundTokens = (body: string) => Buffer.byteLength(body) + BYTE_SLACK_TOKENS;

// Refuse provider-side tools (web search, web fetch, code execution): they run outside any sandbox.
export function serverTools(body: any): string[] {
  if (!Array.isArray(body?.tools)) return [];
  return body.tools.filter((t: any) => t && typeof t.type === "string" && t.type !== "custom").map((t: any) => t.type);
}

// Body keys a Messages request may carry: what Claude Code 2.1.312 sends (captured against a local upstream for all three
// cells) plus the standard sampling, stop and tool-choice keys. Anything else is refused: mcp_servers and container reach
// provider-side egress, OpenRouter's plugins, models and provider route around the meter, and speed, service_tier and
// inference_geo change the price.
export const BODY_KEYS = new Set([
  "model", "messages", "system", "max_tokens", "metadata", "stop_sequences", "stream", "temperature", "top_p", "top_k",
  "tools", "tool_choice", "thinking", "context_management", "output_config", "output_format",
]);
export const unknownBodyKeys = (body: Record<string, unknown>) => Object.keys(body).filter((k) => !BODY_KEYS.has(k));

// Image and document blocks must carry their content inline. A url or file source makes the provider fetch outside the
// sandbox, and what it fetches is not in the request bytes that bound the worst case. Callers pass the request content
// (messages and system); the input of a tool_use block is model-authored tool arguments, not content, so it is skipped.
const INLINE_SOURCES = new Set(["base64", "text", "content"]);
export function remoteSources(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(remoteSources);
  if (!v || typeof v !== "object") return [];
  const o = v as any;
  const own = (o.type === "image" || o.type === "document") && !INLINE_SOURCES.has(o.source?.type) ? [String(o.source?.type)] : [];
  return [...own, ...Object.entries(o).filter(([k]) => !(o.type === "tool_use" && k === "input")).flatMap(([, x]) => remoteSources(x))];
}

export function hasMedia(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasMedia);
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if (o.type === "image" || o.type === "document") return true;
  return Object.entries(o).some(([k, x]) => !(o.type === "tool_use" && k === "input") && hasMedia(x));
}

// anthropic-beta values Claude Code 2.1.312 sends in the three cells. Others are dropped before the request leaves, so no
// unlisted beta (MCP connector, code execution, files, server-side fallback) reaches the provider; a request that needed
// one fails upstream with an unbilled 400.
export const BETAS = new Set([
  "advanced-tool-use-2025-11-20", "claude-code-20250219", "context-management-2025-06-27", "effort-2025-11-24",
  "interleaved-thinking-2025-05-14", "mid-conversation-tool-changes-2026-07-01", "per-turn-control-2026-07-01",
  "thinking-display-updates-2026-08-18", "thinking-token-count-2026-05-13",
]);
export function splitBetas(header: string | null): { kept: string[]; dropped: string[] } {
  const all = (header ?? "").split(",").map((b) => b.trim()).filter(Boolean);
  return { kept: all.filter((b) => BETAS.has(b)), dropped: all.filter((b) => !BETAS.has(b)) };
}

// max_tokens bounds the output side of the worst case, so it must be a positive integer.
export const validMaxTokens = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;

// A fetch that failed with one of these never reached the provider, so nothing was billed.
export const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ConnectionRefused", "FailedToOpenSocket"]);

// Response headers the client uses to pace retries and to report errors.
const PASS_HEADERS = ["retry-after", "x-should-retry", "request-id"];
function responseHeaders(upstream: Response, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...extra };
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out[h] = v;
  }
  return out;
}

// Incremental SSE parser that pulls usage out of message_start and message_delta events, and the first error event.
// Output usage counts as seen only from message_delta: message_start's output count is a placeholder.
export class SseUsage {
  private buf = "";
  readonly usage = emptyUsage();
  providerCost: number | null = null;
  stopReason: string | null = null;
  sawInput = false;
  sawOutput = false;
  sawStart = false;
  error: { type: string; message: string } | null = null;
  private note(raw: any) {
    if (typeof raw?.input_tokens === "number") this.sawInput = true;
    if (typeof raw?.output_tokens === "number") this.sawOutput = true;
  }
  feed(text: string) {
    this.buf += text.replace(/\r\n?/g, "\n");
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const event = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const data = JSON.parse(line.slice(5).trim());
          if (data.type === "message_start") {
            this.sawStart = true;
            mergeUsage(this.usage, data.message?.usage);
            if (typeof data.message?.usage?.input_tokens === "number") this.sawInput = true;
          }
          if (data.type === "message_delta") {
            mergeUsage(this.usage, data.usage);
            this.note(data.usage);
            if (data.delta?.stop_reason) this.stopReason = data.delta.stop_reason;
            if (typeof data.usage?.cost === "number") this.providerCost = data.usage.cost;
          }
          if (data.type === "error" && !this.error) this.error = { type: String(data.error?.type ?? ""), message: String(data.error?.message ?? "").slice(0, 300) };
        } catch {}
      }
    }
  }
}

type Session = {
  id: string;
  token: string;
  trial: string;
  model: string;
  capMicros: number;
  spentMicros: number;
  usage: Usage;
  requests: number;
  okResponses: number;
  refused: number;
  refusedBudget: number;
  pending: Map<number, { worst: number; abort: AbortController }>;
  requestedModels: Record<string, number>;
  open: boolean;
  openedAt: string;
  closedAt?: string;
  closeReason?: string;
  drained?: Promise<void>;
  settling?: Promise<unknown>;
  settleResult?: unknown;
  settled: boolean;
  meta: Record<string, unknown>;
  ledgerReserved: boolean;
};

type OpenBody = { trial: string; model: string; cap_usd: number; meta?: Record<string, unknown>; open_key?: unknown };

export type ProxyOptions = {
  config: ProxyConfig;
  dataHost: string;
  dataPort: number;
  controlPort: number;
  logPath: string;
  sessionsPath: string;
  ledgerUrl?: string;
  ledgerPrefix?: string;
  globalCapMicros?: number;
  env?: Record<string, string | undefined>;
  closeWaitMs?: number;
  ledgerTimeoutMs?: number;
  settleRetryMs?: number;
};

export function startProxy(opts: ProxyOptions) {
  const env = opts.env ?? process.env;
  const sessions = new Map<string, Session>();
  const byToken = new Map<string, Session>();
  let globalSpent = 0;
  let reqSeq = 0;
  let capStop: string | null = null;
  let openingMicros = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const closeWaitMs = opts.closeWaitMs ?? 30_000;
  const settleRetryMs = opts.settleRetryMs ?? 2_000;
  const log = (entry: Record<string, unknown>) => appendFileSync(opts.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");

  const ledgerCall = async (path: "/reserve" | "/settle", body: Record<string, unknown>) => {
    if (!opts.ledgerUrl) return { ok: true } as any;
    const res = await fetch(opts.ledgerUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(opts.ledgerTimeoutMs ?? 10_000) });
    return (await res.json()) as any;
  };

  const anthropicError = (status: number, type: string, message: string) => Response.json({ type: "error", error: { type, message } }, { status });

  const summary = (s: Session) => ({
    id: s.id, trial: s.trial, model: s.model, cap_micros: s.capMicros, spent_micros: s.spentMicros, usage: s.usage,
    requests: s.requests, ok_responses: s.okResponses, refused: s.refused, refused_budget: s.refusedBudget, requested_models: s.requestedModels, open: s.open, opened_at: s.openedAt, closed_at: s.closedAt, settled: s.settled, meta: s.meta,
  });

  // Stop admission, let in-flight requests finish for closeWaitMs, then abort the rest and charge each its worst case,
  // so the settle never undercounts. Usage that arrives after that is logged, not added. The sessions row is written once
  // the spend is final and before the ledger is called, so a failed settle can be reconciled from it (ledger.ts reconcile).
  const drain = async (s: Session, reason: string) => {
    s.open = false;
    s.closeReason = reason;
    byToken.delete(s.token);
    const deadline = Date.now() + closeWaitMs;
    while (s.pending.size && Date.now() < deadline) await sleep(100);
    for (const [rid, p] of s.pending) {
      s.pending.delete(rid);
      p.abort.abort();
      s.spentMicros += p.worst;
      globalSpent += p.worst;
      log({ event: "charged_at_worst", session: s.id, request: rid, worst_micros: p.worst, reason: "still in flight at close" });
    }
    s.closedAt = new Date().toISOString();
    const { settled: _, ...row } = summary(s);
    appendFileSync(opts.sessionsPath, JSON.stringify({ ...row, close_reason: reason }) + "\n");
  };

  // Settle with retries. A failure leaves the session unsettled, so the next close or close-all tries again.
  const settle = async (s: Session) => {
    let last: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        last = await ledgerCall("/settle", { id: (opts.ledgerPrefix ?? "") + s.id, usd_micros: s.spentMicros, meta: { trial: s.trial, model: s.model, usage: s.usage, requests: s.requests, refused: s.refused, close_reason: s.closeReason, ...s.meta } });
      } catch (e) {
        last = { ok: false, reason: String(e).slice(0, 300) };
      }
      if (last?.ok || last?.reason === "already settled") {
        s.settled = true;
        return last;
      }
      log({ event: "settle_failed", session: s.id, attempt, result: last });
      if (attempt < 3) await sleep(settleRetryMs * attempt);
    }
    return last;
  };

  const closeSession = async (s: Session, reason: string) => {
    s.drained ??= drain(s, reason);
    await s.drained;
    if (!s.ledgerReserved) return summary(s);
    if (!s.settled) {
      s.settling ??= settle(s).finally(() => { s.settling = undefined; });
      s.settleResult = await s.settling;
    }
    return { ...summary(s), ledger_settle: s.settleResult };
  };

  // An open that carries an open_key gets its session id from the key, and every open with that key shares the first
  // one's result while it runs and after it succeeds, so a client that retries a timed-out open gets the same session
  // and causes no second batch-cap check or reserve. A failed open is forgotten so a retry runs again; with the same
  // id, the ledger reuses a reserve that landed even though its answer was lost.
  const opens = new Map<string, Promise<{ status: number; body: unknown }>>();
  const openSession = async (body: OpenBody, id: string): Promise<{ status: number; body: unknown }> => {
    if (!opts.config.models[body.model]) return { status: 400, body: { error: "unknown model " + body.model } };
    const capMicros = Math.round(body.cap_usd * 1_000_000);
    if (!(capMicros > 0)) return { status: 400, body: { error: "cap_usd must be positive" } };
    if (capStop) return { status: 409, body: { error: "budget stop latched: " + capStop } };
    // The batch cap is enforced here, against every session's full reserve and every open still waiting on the ledger,
    // so a session that opened always runs inside its own cap and is never cut off by the batch cap mid-trial.
    if (opts.globalCapMicros !== undefined) {
      const committed = openingMicros + [...sessions.values()].reduce((x, o) => x + (o.closedAt ? o.spentMicros : Math.max(o.capMicros, o.spentMicros)), 0);
      if (committed + capMicros > opts.globalCapMicros) {
        capStop = `batch cap reached for ${body.trial} at ${new Date().toISOString()}`;
        log({ event: "cap_stop", reason: capStop, committed_micros: committed, cap_micros: capMicros, global_cap_micros: opts.globalCapMicros });
        return { status: 409, body: { error: "batch cap reached", committed_micros: committed } };
      }
    }
    const s: Session = { id, token: "laneb-" + randomBytes(24).toString("hex"), trial: body.trial, model: body.model, capMicros, spentMicros: 0, usage: emptyUsage(), requests: 0, okResponses: 0, refused: 0, refusedBudget: 0, pending: new Map(), requestedModels: {}, open: true, openedAt: new Date().toISOString(), settled: false, meta: body.meta ?? {}, ledgerReserved: false };
    openingMicros += capMicros;
    let reserve: any;
    try {
      reserve = await ledgerCall("/reserve", { id: (opts.ledgerPrefix ?? "") + id, usd_micros: capMicros, meta: { trial: body.trial, model: body.model, worst_case: "session cap enforced by the proxy", ...s.meta } });
    } catch (e) {
      log({ event: "reserve_failed", trial: body.trial, reserve_id: (opts.ledgerPrefix ?? "") + id, error: String(e).slice(0, 300) });
      return { status: 502, body: { error: "ledger reserve failed", detail: String(e).slice(0, 300) } };
    } finally {
      openingMicros -= capMicros;
    }
    if (!reserve.ok) {
      capStop = `ledger refused a reserve for ${body.trial} at ${new Date().toISOString()}`;
      log({ event: "cap_stop", reason: capStop, ledger: reserve });
      return { status: 409, body: { error: "ledger refused the reserve", ledger: reserve } };
    }
    s.ledgerReserved = Boolean(opts.ledgerUrl);
    sessions.set(id, s);
    byToken.set(s.token, s);
    log({ event: "session_open", session: id, trial: s.trial, model: s.model, cap_micros: capMicros });
    return { status: 200, body: { id, token: s.token } };
  };

  const control = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.controlPort,
    async fetch(req) {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "GET" && url.pathname === "/healthz") return Response.json({ ok: true });
      if (req.method === "GET" && url.pathname === "/totals") {
        const all = [...sessions.values()];
        return Response.json({ global_spent_micros: globalSpent, cap_stop: capStop, open_sessions: all.filter((s) => s.open).length, unsettled_sessions: all.filter((s) => s.ledgerReserved && !s.settled).map((s) => s.id), sessions: sessions.size });
      }
      if (req.method === "POST" && url.pathname === "/sessions") {
        const body = (await req.json()) as OpenBody;
        const key = typeof body.open_key === "string" ? body.open_key : undefined;
        if (key === undefined) {
          const r = await openSession(body, "s-" + randomBytes(6).toString("hex"));
          return Response.json(r.body, { status: r.status });
        }
        let opening = opens.get(key);
        if (!opening) {
          opening = openSession(body, "s-" + createHash("sha256").update(key).digest("hex").slice(0, 12));
          opens.set(key, opening);
          opening.then((r) => { if (r.status !== 200) opens.delete(key); }, () => opens.delete(key));
        }
        const r = await opening;
        return Response.json(r.body, { status: r.status });
      }
      if (parts[0] === "sessions" && parts[1]) {
        const s = sessions.get(parts[1]);
        if (!s) return Response.json({ error: "no such session" }, { status: 404 });
        if (req.method === "GET" && parts.length === 2) return Response.json(summary(s));
        if (req.method === "POST" && parts[2] === "close") {
          const body = (await req.json().catch(() => ({}))) as { reason?: string };
          return Response.json(await closeSession(s, body.reason ?? "closed"));
        }
      }
      if (req.method === "POST" && url.pathname === "/close-all") {
        const todo = [...sessions.values()].filter((s) => s.open || (s.ledgerReserved && !s.settled));
        return Response.json(await Promise.all(todo.map((s) => closeSession(s, "close-all"))));
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  const data = Bun.serve({
    hostname: opts.dataHost,
    port: opts.dataPort,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname.endsWith("/healthz")) return Response.json({ ok: true });
      if (req.method === "HEAD" || req.method === "GET") return new Response(null, { status: 200 });
      const token = req.headers.get("x-api-key") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const s = token ? byToken.get(token) : undefined;
      if (!s || !s.open) return anthropicError(401, "authentication_error", "laneb proxy: unknown or closed session");
      const model = opts.config.models[s.model];
      const route = opts.config.routes[model.route];
      const raw = await req.text();
      let body: any;
      try { body = JSON.parse(raw); } catch { return anthropicError(400, "invalid_request_error", "laneb proxy: body is not JSON"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return anthropicError(400, "invalid_request_error", "laneb proxy: body is not a JSON object");
      const requested = String(body.model ?? "");
      s.requestedModels[requested] = (s.requestedModels[requested] ?? 0) + 1;
      const isCount = url.pathname.endsWith("/count_tokens");
      if (!url.pathname.endsWith("/v1/messages") && !isCount) return anthropicError(404, "not_found_error", "laneb proxy: only /v1/messages is served");
      const refuse = (reason: string, message: string, extra: Record<string, unknown> = {}) => {
        s.refused++;
        log({ event: "refused", session: s.id, reason, ...extra });
        return anthropicError(400, "invalid_request_error", "laneb proxy: " + message);
      };
      const server = serverTools(body);
      if (server.length) return refuse("server_tools", "provider-side tools are not allowed: " + server.join(","), { tools: server });
      const unknown = unknownBodyKeys(body);
      if (unknown.length) return refuse("body_keys", "request fields are not allowed: " + unknown.join(","), { keys: unknown });
      const remote = remoteSources([body.messages, body.system]);
      if (remote.length) return refuse("remote_source", "image and document content with a url or file source is not allowed", { sources: remote });
      if (!isCount && !validMaxTokens(body.max_tokens)) return refuse("max_tokens", "max_tokens must be a positive integer", { max_tokens: body.max_tokens });
      body.model = model.upstream_model;
      for (const f of model.strip_fields ?? []) delete body[f];
      Object.assign(body, model.body_overrides ?? {});
      const key = env[route.key_env];
      if (!key) return anthropicError(500, "api_error", "laneb proxy: no upstream key configured for route " + model.route);
      const headers: Record<string, string> = { "content-type": "application/json" };
      for (const h of ["anthropic-version", "accept"]) {
        const v = req.headers.get(h);
        if (v) headers[h] = v;
      }
      const betas = splitBetas(req.headers.get("anthropic-beta"));
      if (betas.kept.length) headers["anthropic-beta"] = betas.kept.join(",");
      if (betas.dropped.length) log({ event: "beta_dropped", session: s.id, betas: betas.dropped });
      if (route.auth === "x-api-key") headers["x-api-key"] = key;
      else headers["authorization"] = "Bearer " + key;
      const outBody = JSON.stringify(body);

      if (isCount) {
        if (route.count_tokens === "estimate") return Response.json({ input_tokens: Math.ceil(outBody.length / 4) });
        const res = await fetch(route.base_url + "/v1/messages/count_tokens", { method: "POST", headers, body: outBody });
        return new Response(res.body, { status: res.status, headers: responseHeaders(res, { "content-type": res.headers.get("content-type") ?? "application/json" }) });
      }

      let inputTokens = byteBoundTokens(outBody);
      let counted = false;
      if (route.count_tokens === "forward") {
        try {
          const countBody = JSON.stringify(Object.fromEntries(COUNT_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]])));
          const res = await fetch(route.base_url + "/v1/messages/count_tokens", { method: "POST", headers, body: countBody });
          const j = (await res.json()) as any;
          if (res.ok && typeof j.input_tokens === "number") { inputTokens = j.input_tokens + COUNT_SLACK_TOKENS; counted = true; }
          else log({ event: "count_failed", session: s.id, status: res.status, message: String(j?.error?.message ?? "").slice(0, 200) });
        } catch (e) {
          log({ event: "count_failed", session: s.id, error: String(e).slice(0, 200) });
        }
      }
      if (!s.open) return anthropicError(401, "authentication_error", "laneb proxy: unknown or closed session");
      if (route.count_tokens === "forward" && !counted && hasMedia([body.messages, body.system])) {
        log({ event: "count_failed_media", session: s.id, input_tokens_bound: inputTokens, max_tokens: body.max_tokens });
        return anthropicError(529, "overloaded_error", "laneb proxy: token count unavailable, retry");
      }
      const worst = worstCaseMicros(inputTokens, body.max_tokens, maxPrice(model), asksLongTtl(outBody));
      if (!Number.isFinite(worst) || worst <= 0) return refuse("worst_case", "the request's worst-case cost is not a positive number", { worst_micros: worst });
      const inflight = [...s.pending.values()].reduce((x, p) => x + p.worst, 0);
      if (s.spentMicros + inflight + worst > s.capMicros) {
        // A failed count is not a budget stop: the byte bound overstates the input, so Claude Code is told to retry.
        if (route.count_tokens === "forward" && !counted) {
          log({ event: "count_failed_over_budget", session: s.id, spent_micros: s.spentMicros, inflight_micros: inflight, worst_micros: worst, cap_micros: s.capMicros, input_tokens_bound: inputTokens, max_tokens: body.max_tokens });
          return anthropicError(529, "overloaded_error", "laneb proxy: token count unavailable, retry");
        }
        s.refusedBudget++;
        return refuse("session_cap", "session budget exhausted", { spent_micros: s.spentMicros, inflight_micros: inflight, worst_micros: worst, cap_micros: s.capMicros, input_tokens_bound: inputTokens, counted, max_tokens: body.max_tokens });
      }
      const rid = ++reqSeq;
      const abort = new AbortController();
      s.requests++;
      s.pending.set(rid, { worst, abort });
      const started = Date.now();
      // complete=false charges the worst case: a stream cut off before its final usage, a body that failed mid-read,
      // a 200 without usage, or a request that failed after it may have reached the provider.
      const account = (usage: Usage, providerCost: number | null, status: number, stream: boolean, stopReason: string | null, complete: boolean, extra: Record<string, unknown> = {}) => {
        const micros = complete ? costMicros(usage, priceFor(usage, model)) : worst;
        const entry = { session: s.id, trial: s.trial, model: s.model, request: rid, requested_model: requested, upstream_model: model.upstream_model, status, stream, complete, usage, cost_micros: micros, worst_micros: worst, input_tokens_bound: inputTokens, counted, body_bytes: outBody.length, max_tokens: body.max_tokens, provider_cost_usd: providerCost, stop_reason: stopReason, ms: Date.now() - started, ...extra };
        if (!s.pending.delete(rid)) { log({ event: "late_usage", ...entry }); return; }
        if (status === 200 && !extra.sse_error && !extra.error) s.okResponses++;
        s.spentMicros += micros;
        globalSpent += micros;
        for (const k of Object.keys(usage) as (keyof Usage)[]) s.usage[k] += usage[k];
        log({ event: "request", ...entry });
      };
      let upstream: Response;
      try {
        upstream = await fetch(route.base_url + "/v1/messages", { method: "POST", headers, body: outBody, signal: abort.signal });
      } catch (e: any) {
        log({ event: "upstream_error", session: s.id, request: rid, error: String(e), code: e?.code ?? null });
        if (s.pending.has(rid)) account(emptyUsage(), null, 0, Boolean(body.stream), null, NOT_SENT_CODES.has(e?.code), { error: String(e).slice(0, 300) });
        return anthropicError(529, "overloaded_error", "laneb proxy: upstream unreachable");
      }
      const contentType = upstream.headers.get("content-type") ?? "";
      if (!upstream.body || !contentType.includes("text/event-stream")) {
        let text: string;
        try {
          text = await upstream.text();
        } catch (e) {
          account(emptyUsage(), null, upstream.status, false, null, false, { error: String(e).slice(0, 300) });
          return anthropicError(502, "api_error", "laneb proxy: upstream response failed mid-body");
        }
        const usage = emptyUsage();
        let providerCost: number | null = null;
        let stopReason: string | null = null;
        let hasUsage = false;
        try {
          const j = JSON.parse(text);
          mergeUsage(usage, j.usage);
          hasUsage = typeof j.usage?.input_tokens === "number" && typeof j.usage?.output_tokens === "number";
          if (typeof j.usage?.cost === "number") providerCost = j.usage.cost;
          stopReason = j.stop_reason ?? null;
          if (upstream.status >= 400) log({ event: "upstream_status", session: s.id, status: upstream.status, error_type: j.error?.type, message: String(j.error?.message ?? "").slice(0, 300) });
        } catch {}
        account(usage, providerCost, upstream.status, false, stopReason, upstream.status !== 200 || hasUsage);
        return new Response(text, { status: upstream.status, headers: responseHeaders(upstream, { "content-type": contentType || "application/json" }) });
      }
      const parser = new SseUsage();
      const decoder = new TextDecoder();
      let done = false;
      // A stream with an error event is never an ok response. It costs nothing when the error came before message_start,
      // and its worst case after, since output may have been billed.
      const finish = (complete: boolean) => {
        if (done) return;
        done = true;
        const err = parser.error;
        if (err) account(parser.usage, parser.providerCost, upstream.status, true, parser.stopReason, complete && !parser.sawStart, { sse_error: err.type, sse_error_message: err.message });
        else account(parser.usage, parser.providerCost, upstream.status, true, parser.stopReason, complete && parser.stopReason !== null && parser.sawInput && parser.sawOutput);
      };
      const reader = upstream.body.getReader();
      const read = async () => {
        const r = await reader.read();
        if (r.value) parser.feed(decoder.decode(r.value, { stream: true }));
        return r;
      };
      // If the client goes away mid-stream, keep reading so the final usage still arrives; close aborts it if it runs long.
      const readToEnd = async () => {
        try { while (!(await read()).done); finish(true); } catch { finish(false); }
      };
      let cancelled = false;
      const out = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          try {
            const { value, done: d } = await read();
            if (d) { finish(true); if (!cancelled) ctrl.close(); return; }
            if (!cancelled) ctrl.enqueue(value);
          } catch (e) {
            if (cancelled) return;
            finish(false);
            ctrl.error(e);
          }
        },
        cancel() { cancelled = true; void readToEnd(); },
      });
      return new Response(out, { status: upstream.status, headers: responseHeaders(upstream, { "content-type": contentType, "cache-control": "no-cache" }) });
    },
  });

  return {
    data,
    control,
    sessions,
    globalSpent: () => globalSpent,
    stop: async () => { data.stop(true); control.stop(true); },
  };
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
  return out;
}

if (import.meta.main) {
  const a = parseArgs(Bun.argv.slice(2));
  const config = JSON.parse(readFileSync(a.config, "utf8")) as ProxyConfig;
  const p = startProxy({
    config,
    dataHost: a["data-host"] ?? "127.0.0.1",
    dataPort: Number(a["data-port"] ?? 8787),
    controlPort: Number(a["control-port"] ?? 8788),
    logPath: a.log ?? "proxy-requests.jsonl",
    sessionsPath: a.sessions ?? "proxy-sessions.jsonl",
    ledgerUrl: a["ledger-url"],
    ledgerPrefix: a["ledger-prefix"],
    globalCapMicros: a["global-cap-usd"] ? Math.round(Number(a["global-cap-usd"]) * 1_000_000) : undefined,
  });
  console.log(`laneb proxy: data ${p.data.hostname}:${p.data.port}, control 127.0.0.1:${p.control.port}`);
}
