// Metering proxy for the Lane B quick look.
// Data plane: Anthropic Messages API for trial containers, authenticated by a per-session token.
// Control plane (127.0.0.1 only): open and close sessions, read totals.
// Real provider keys stay in this process; containers only ever hold a session token.
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

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
// per token. The slack covers tokens the provider adds around tools and system text.
export const COUNT_SLACK_TOKENS = 64;
export const BYTE_SLACK_TOKENS = 1024;
export const COUNT_FIELDS = ["model", "messages", "system", "tools", "tool_choice", "thinking"];
export const byteBoundTokens = (body: string) => Buffer.byteLength(body) + BYTE_SLACK_TOKENS;

// Refuse provider-side tools (web search, web fetch, code execution): they run outside any sandbox.
export function serverTools(body: any): string[] {
  if (!Array.isArray(body?.tools)) return [];
  return body.tools.filter((t: any) => t && typeof t.type === "string" && t.type !== "custom").map((t: any) => t.type);
}

// Incremental SSE parser that pulls usage out of message_start and message_delta events.
export class SseUsage {
  private buf = "";
  readonly usage = emptyUsage();
  providerCost: number | null = null;
  stopReason: string | null = null;
  feed(text: string) {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const event = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const data = JSON.parse(line.slice(5).trim());
          if (data.type === "message_start") mergeUsage(this.usage, data.message?.usage);
          if (data.type === "message_delta") {
            mergeUsage(this.usage, data.usage);
            if (data.delta?.stop_reason) this.stopReason = data.delta.stop_reason;
            if (typeof data.usage?.cost === "number") this.providerCost = data.usage.cost;
          }
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
  meta: Record<string, unknown>;
  ledgerReserved: boolean;
  cmdExpanded?: boolean;
  firstReqPromptTokens?: number;
};

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
};

export function startProxy(opts: ProxyOptions) {
  const env = opts.env ?? process.env;
  const sessions = new Map<string, Session>();
  const byToken = new Map<string, Session>();
  let globalSpent = 0;
  let inflightWorst = 0;
  let reqSeq = 0;
  let capStop: string | null = null;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const closeWaitMs = opts.closeWaitMs ?? 30_000;
  const log = (entry: Record<string, unknown>) => appendFileSync(opts.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");

  const ledgerCall = async (path: "/reserve" | "/settle", body: Record<string, unknown>) => {
    if (!opts.ledgerUrl) return { ok: true } as any;
    const res = await fetch(opts.ledgerUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as any;
  };

  const anthropicError = (status: number, type: string, message: string) => Response.json({ type: "error", error: { type, message } }, { status });

  const summary = (s: Session) => ({
    id: s.id, trial: s.trial, model: s.model, cap_micros: s.capMicros, spent_micros: s.spentMicros, usage: s.usage,
    requests: s.requests, ok_responses: s.okResponses, refused: s.refused, refused_budget: s.refusedBudget, requested_models: s.requestedModels, open: s.open, opened_at: s.openedAt, closed_at: s.closedAt, meta: s.meta,
    cmd_expanded: s.cmdExpanded ?? null, first_req_prompt_tokens: s.firstReqPromptTokens ?? null,
  });

  // Stop admission, let in-flight requests finish for closeWaitMs, then abort the rest and charge each its worst case,
  // so the settle never undercounts. Usage that arrives after that is logged, not added.
  const closeSession = async (s: Session, reason: string) => {
    if (!s.open) return summary(s);
    s.open = false;
    byToken.delete(s.token);
    const deadline = Date.now() + closeWaitMs;
    while (s.pending.size && Date.now() < deadline) await sleep(100);
    for (const [rid, p] of s.pending) {
      s.pending.delete(rid);
      p.abort.abort();
      inflightWorst -= p.worst;
      s.spentMicros += p.worst;
      globalSpent += p.worst;
      log({ event: "charged_at_worst", session: s.id, request: rid, worst_micros: p.worst, reason: "still in flight at close" });
    }
    s.closedAt = new Date().toISOString();
    const out = summary(s);
    if (s.ledgerReserved) {
      const settle = await ledgerCall("/settle", { id: (opts.ledgerPrefix ?? "") + s.id, usd_micros: s.spentMicros, meta: { trial: s.trial, model: s.model, usage: s.usage, requests: s.requests, refused: s.refused, close_reason: reason, ...s.meta } });
      (out as any).ledger_settle = settle;
    }
    appendFileSync(opts.sessionsPath, JSON.stringify({ ...out, close_reason: reason }) + "\n");
    return out;
  };

  const control = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.controlPort,
    async fetch(req) {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "GET" && url.pathname === "/healthz") return Response.json({ ok: true });
      if (req.method === "GET" && url.pathname === "/totals") {
        return Response.json({ global_spent_micros: globalSpent, cap_stop: capStop, open_sessions: [...sessions.values()].filter((s) => s.open).length, sessions: sessions.size });
      }
      if (req.method === "POST" && url.pathname === "/sessions") {
        const body = (await req.json()) as { trial: string; model: string; cap_usd: number; meta?: Record<string, unknown> };
        if (!opts.config.models[body.model]) return Response.json({ error: "unknown model " + body.model }, { status: 400 });
        const capMicros = Math.round(body.cap_usd * 1_000_000);
        if (!(capMicros > 0)) return Response.json({ error: "cap_usd must be positive" }, { status: 400 });
        if (capStop) return Response.json({ error: "budget stop latched: " + capStop }, { status: 409 });
        const id = "s-" + randomBytes(6).toString("hex");
        const s: Session = { id, token: "laneb-" + randomBytes(24).toString("hex"), trial: body.trial, model: body.model, capMicros, spentMicros: 0, usage: emptyUsage(), requests: 0, okResponses: 0, refused: 0, refusedBudget: 0, pending: new Map(), requestedModels: {}, open: true, openedAt: new Date().toISOString(), meta: body.meta ?? {}, ledgerReserved: false };
        const reserve = await ledgerCall("/reserve", { id: (opts.ledgerPrefix ?? "") + id, usd_micros: capMicros, meta: { trial: body.trial, model: body.model, worst_case: "session cap enforced by the proxy", ...s.meta } });
        if (!reserve.ok) {
          capStop = `ledger refused a reserve for ${body.trial} at ${new Date().toISOString()}`;
          log({ event: "cap_stop", reason: capStop, ledger: reserve });
          return Response.json({ error: "ledger refused the reserve", ledger: reserve }, { status: 409 });
        }
        s.ledgerReserved = Boolean(opts.ledgerUrl);
        sessions.set(id, s);
        byToken.set(s.token, s);
        log({ event: "session_open", session: id, trial: s.trial, model: s.model, cap_micros: capMicros });
        return Response.json({ id, token: s.token });
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
        const out = [];
        for (const s of sessions.values()) if (s.open) out.push(await closeSession(s, "close-all"));
        return Response.json(out);
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
      const requested = String(body.model ?? "");
      s.requestedModels[requested] = (s.requestedModels[requested] ?? 0) + 1;
      const isCount = url.pathname.endsWith("/count_tokens");
      if (!url.pathname.endsWith("/v1/messages") && !isCount) return anthropicError(404, "not_found_error", "laneb proxy: only /v1/messages is served");
      const server = serverTools(body);
      if (server.length) {
        s.refused++;
        log({ event: "refused", session: s.id, reason: "server_tools", tools: server });
        return anthropicError(400, "invalid_request_error", "laneb proxy: provider-side tools are not allowed: " + server.join(","));
      }
      body.model = model.upstream_model;
      for (const f of model.strip_fields ?? []) delete body[f];
      Object.assign(body, model.body_overrides ?? {});
      const key = env[route.key_env];
      if (!key) return anthropicError(500, "api_error", "laneb proxy: no upstream key configured for route " + model.route);
      const headers: Record<string, string> = { "content-type": "application/json" };
      for (const h of ["anthropic-version", "anthropic-beta", "accept"]) {
        const v = req.headers.get(h);
        if (v) headers[h] = v;
      }
      if (route.auth === "x-api-key") headers["x-api-key"] = key;
      else headers["authorization"] = "Bearer " + key;
      const outBody = JSON.stringify(body);

      if (isCount) {
        if (route.count_tokens === "estimate") return Response.json({ input_tokens: Math.ceil(outBody.length / 4) });
        const res = await fetch(route.base_url + "/v1/messages/count_tokens", { method: "POST", headers, body: outBody });
        return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
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
      // Body-load probe: on the session's first forwarded request, record whether the CLI expanded a
      // slash command (the outgoing body carries "<command-name>", so a skill body was injected) and the
      // token bound for that first request. Both land in the session summary; cost accounting is untouched.
      if (s.cmdExpanded === undefined) {
        s.cmdExpanded = outBody.includes("<command-name>");
        s.firstReqPromptTokens = inputTokens;
        log({ event: "body_load_probe", session: s.id, cmd_expanded: s.cmdExpanded, first_req_prompt_tokens: inputTokens });
      }
      const worst = worstCaseMicros(inputTokens, Number(body.max_tokens ?? 32000), maxPrice(model), asksLongTtl(outBody));
      if (!Number.isFinite(worst) || worst <= 0) {
        // A request-validity refusal, not a budget stop: count it in s.refused only, like server_tools,
        // so it never reaches refused_budget and the preregistered budget-stop column.
        s.refused++;
        log({ event: "refused", session: s.id, reason: "worst_case", max_tokens: body.max_tokens });
        return anthropicError(400, "invalid_request_error", "laneb proxy: worst-case cost is not a positive number");
      }
      const inflight = [...s.pending.values()].reduce((x, p) => x + p.worst, 0);
      if (s.spentMicros + inflight + worst > s.capMicros) {
        s.refused++;
        s.refusedBudget++;
        log({ event: "refused", session: s.id, reason: "session_cap", spent_micros: s.spentMicros, inflight_micros: inflight, worst_micros: worst, cap_micros: s.capMicros, input_tokens_bound: inputTokens, counted, max_tokens: body.max_tokens });
        return anthropicError(400, "invalid_request_error", "laneb proxy: session budget exhausted");
      }
      if (opts.globalCapMicros !== undefined && globalSpent + inflightWorst + worst > opts.globalCapMicros) {
        s.refused++;
        s.refusedBudget++;
        capStop ??= `batch cap reached at ${new Date().toISOString()}`;
        log({ event: "refused", session: s.id, reason: "global_cap" });
        return anthropicError(400, "invalid_request_error", "laneb proxy: global budget exhausted");
      }
      const rid = ++reqSeq;
      const abort = new AbortController();
      s.requests++;
      s.pending.set(rid, { worst, abort });
      inflightWorst += worst;
      const started = Date.now();
      // complete=false (a stream cut off before its final usage) charges the worst case.
      const account = (usage: Usage, providerCost: number | null, status: number, stream: boolean, stopReason: string | null, complete = true) => {
        const micros = complete ? costMicros(usage, priceFor(usage, model)) : worst;
        const entry = { session: s.id, trial: s.trial, model: s.model, request: rid, requested_model: requested, upstream_model: model.upstream_model, status, stream, complete, usage, cost_micros: micros, worst_micros: worst, input_tokens_bound: inputTokens, counted, body_bytes: outBody.length, max_tokens: body.max_tokens, provider_cost_usd: providerCost, stop_reason: stopReason, ms: Date.now() - started };
        if (!s.pending.delete(rid)) { log({ event: "late_usage", ...entry }); return; }
        inflightWorst -= worst;
        if (status === 200) s.okResponses++;
        s.spentMicros += micros;
        globalSpent += micros;
        for (const k of Object.keys(usage) as (keyof Usage)[]) s.usage[k] += usage[k];
        log({ event: "request", ...entry });
      };
      let upstream: Response;
      try {
        upstream = await fetch(route.base_url + "/v1/messages", { method: "POST", headers, body: outBody, signal: abort.signal });
      } catch (e) {
        if (s.pending.delete(rid)) inflightWorst -= worst;
        log({ event: "upstream_error", session: s.id, request: rid, error: String(e) });
        return anthropicError(529, "overloaded_error", "laneb proxy: upstream unreachable");
      }
      const contentType = upstream.headers.get("content-type") ?? "";
      if (!upstream.body || !contentType.includes("text/event-stream")) {
        const text = await upstream.text();
        const usage = emptyUsage();
        let providerCost: number | null = null;
        let stopReason: string | null = null;
        try {
          const j = JSON.parse(text);
          mergeUsage(usage, j.usage);
          if (typeof j.usage?.cost === "number") providerCost = j.usage.cost;
          stopReason = j.stop_reason ?? null;
          if (upstream.status >= 400) log({ event: "upstream_status", session: s.id, status: upstream.status, error_type: j.error?.type, message: String(j.error?.message ?? "").slice(0, 300) });
        } catch {}
        account(usage, providerCost, upstream.status, false, stopReason);
        return new Response(text, { status: upstream.status, headers: { "content-type": contentType || "application/json" } });
      }
      const parser = new SseUsage();
      const decoder = new TextDecoder();
      let done = false;
      const finish = (complete: boolean) => {
        if (done) return;
        done = true;
        account(parser.usage, parser.providerCost, upstream.status, true, parser.stopReason, complete && parser.stopReason !== null);
      };
      const reader = upstream.body.getReader();
      const read = async () => {
        const r = await reader.read();
        if (r.value) parser.feed(decoder.decode(r.value, { stream: true }));
        return r;
      };
      // If the client goes away mid-stream, keep reading so the final usage still arrives; close aborts it if it runs long.
      const drain = async () => {
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
        cancel() { cancelled = true; void drain(); },
      });
      return new Response(out, { status: upstream.status, headers: { "content-type": contentType, "cache-control": "no-cache" } });
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
