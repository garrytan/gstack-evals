import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { MODELS, WEB_SEARCH_USD } from "./config.ts";
import { addUsage, costUsd, finiteUsage, fromApiUsage, mergeStreamUsage, zeroUsage, type Usage } from "./usage.ts";

export interface ProxySession {
  id: string;
  model: string;
  ceilingUsd: number;
  hardLimitUsd: number;
  tail: Promise<void>;
  logPath: string;
  spentUsd: number;
  usage: Usage;
  requests: number;
  refusals: { reason: string; detail: string }[];
  budgetHit: boolean;
  closed: boolean;
  pendingUsd: number;
}

export interface ProxyOptions {
  hostname: string;
  port: number;
  upstream: string;
  upstreamKey: () => string;
}

const DROP_REQ = new Set(["host", "x-api-key", "authorization", "content-length", "connection", "accept-encoding"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

// An upper bound on one request's cost: every prompt token at the dearest input rate (1-hour cache write, long-prompt tier),
// at most one token per two body bytes, plus max_tokens of output and a small web-search allowance.
export function requestCeilingUsd(model: string, bodyBytes: number, maxTokens: number): number {
  const spec = MODELS[model]!;
  const promptTokens = Math.ceil(bodyBytes / 2);
  const p = spec.longPrice && promptTokens > spec.longPrice.threshold ? spec.longPrice.price : spec.price;
  return (promptTokens * Math.max(p.input, p.cacheWrite1h, p.cacheWrite5m) + maxTokens * p.output) / 1e6 + WEB_SEARCH_USES * WEB_SEARCH_USD;
}

const WEB_SEARCH_USES = 5;

// The bound prices only what the body carries. Refuse MCP servers, server tools other than one web search tool, and
// content sent by reference; cap web search at the searches the bound allows.
export function unbounded(body: any): string | null {
  if (body.mcp_servers !== undefined) return "mcp_servers";
  let searches = 0;
  for (const t of Array.isArray(body.tools) ? body.tools : []) {
    if (t?.type === undefined || t.type === "custom") continue;
    if (typeof t.type !== "string" || !t.type.startsWith("web_search_") || ++searches > 1) return `tool ${t.type}`;
    t.max_uses = Number.isInteger(t.max_uses) && t.max_uses > 0 ? Math.min(t.max_uses, WEB_SEARCH_USES) : WEB_SEARCH_USES;
  }
  const byReference = (x: any): string | null => {
    if (!x || typeof x !== "object") return null;
    if ("file_id" in x) return "file_id";
    if (x.source?.type === "url" || x.source?.type === "file") return `${x.source.type} source`;
    for (const [k, v] of Object.entries(x)) {
      const found = k === "input" ? null : byReference(v);
      if (found) return found;
    }
    return null;
  };
  return byReference([body.system, body.messages]);
}

function apiError(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "content-type": "application/json" } });
}

export class MeteringProxy {
  private sessions = new Map<string, ProxySession>();
  private server: ReturnType<typeof Bun.serve>;

  constructor(private opts: ProxyOptions) {
    this.server = Bun.serve({ hostname: opts.hostname, port: opts.port, idleTimeout: 255, fetch: (req) => this.handle(req) });
  }

  get url(): string {
    return `http://${this.opts.hostname}:${this.server.port}`;
  }

  register(id: string, model: string, ceilingUsd: number, hardLimitUsd: number, logPath: string): { token: string; session: ProxySession } {
    const token = "lanea-" + randomBytes(24).toString("hex");
    const session: ProxySession = { id, model, ceilingUsd, hardLimitUsd, tail: Promise.resolve(), logPath, spentUsd: 0, usage: zeroUsage(), requests: 0, refusals: [], budgetHit: false, closed: false, pendingUsd: 0 };
    this.sessions.set(token, session);
    return { token, session };
  }

  revoke(token: string): void {
    const s = this.sessions.get(token);
    if (s) s.closed = true;
    this.sessions.delete(token);
  }

  // Waits for the request in flight to settle. One still running after ms is charged at its bound now.
  async drain(s: ProxySession, ms: number): Promise<void> {
    let timer!: ReturnType<typeof setTimeout>;
    const drained = await Promise.race([s.tail.then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), ms)))]);
    clearTimeout(timer);
    if (drained || !s.pendingUsd) return;
    this.log(s, { event: "drain_timeout", cost_usd: s.pendingUsd });
    s.spentUsd += s.pendingUsd;
    s.pendingUsd = 0;
  }

  stop(): void {
    this.server.stop(true);
  }

  private log(s: ProxySession, row: Record<string, unknown>) {
    appendFileSync(s.logPath, JSON.stringify({ ts: Date.now(), ...row }) + "\n");
  }

  private refuse(s: ProxySession, reason: string, detail: string, res: Response): Response {
    s.refusals.push({ reason, detail });
    this.log(s, { event: "refused", reason, detail });
    return res;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const auth = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const s = this.sessions.get(auth);
    if (!s) return apiError(401, "authentication_error", "unknown or revoked session token");
    if (req.method === "POST" && url.pathname === "/v1/messages") return this.messages(req, s, url);
    if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") return this.forward(req, s, url, await req.text());
    if (req.method === "GET" && url.pathname.startsWith("/v1/models")) return this.forward(req, s, url, undefined);
    return this.refuse(s, "path", `${req.method} ${url.pathname}`, apiError(404, "not_found_error", "path not proxied"));
  }

  // One paid request per session at a time, admitted only if its upper bound fits under the session's hard limit
  // (the ledger reservation), so a session's spend can never pass what the ledger reserved for it.
  private async acquire(s: ProxySession): Promise<() => void> {
    const prev = s.tail;
    let release!: () => void;
    s.tail = new Promise<void>((r) => (release = r));
    await prev;
    return release;
  }

  private async messages(req: Request, s: ProxySession, url: URL): Promise<Response> {
    let parsed: any;
    try {
      parsed = JSON.parse(await req.text());
    } catch {
      return this.refuse(s, "body", "unparseable JSON", apiError(400, "invalid_request_error", "unparseable body"));
    }
    const model = typeof parsed?.model === "string" ? parsed.model : "";
    if (model !== s.model) return this.refuse(s, "model", model, apiError(403, "permission_error", `model ${model} is not allowed in this session`));
    const maxTokens = parsed.max_tokens;
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) return this.refuse(s, "max_tokens", String(maxTokens), apiError(400, "invalid_request_error", "max_tokens must be a positive integer"));
    const refused = unbounded(parsed);
    if (refused) return this.refuse(s, "unbounded", refused, apiError(400, "invalid_request_error", `${refused} is not proxied`));
    const body = JSON.stringify(parsed);
    const bound = requestCeilingUsd(model, Buffer.byteLength(body), maxTokens);
    const release = await this.acquire(s);
    if (s.closed || req.signal.aborted) {
      release();
      return this.refuse(s, "closed", s.closed ? "session revoked" : "client gone", apiError(401, "authentication_error", "session closed"));
    }
    if (s.spentUsd >= s.ceilingUsd || s.spentUsd + bound > s.hardLimitUsd) {
      s.budgetHit = true;
      release();
      return this.refuse(s, "budget", `spent=${s.spentUsd.toFixed(4)} bound=${bound.toFixed(4)}`, apiError(400, "invalid_request_error", "session budget exhausted"));
    }
    return this.forward(req, s, url, body, model, bound, release);
  }

  // A reply whose usage is missing, unreadable or cut short is charged at least its bound.
  private settle(s: ProxySession, model: string, status: number, started: number, u: Usage, requestId: string | null, bound: number, incomplete: boolean) {
    const measured = finiteUsage(u) ? costUsd(model, u) : NaN;
    const charged = incomplete || !Number.isFinite(measured);
    const cost = charged ? Math.max(Number.isFinite(measured) ? measured : 0, bound) : measured;
    if (finiteUsage(u)) s.usage = addUsage(s.usage, u);
    s.spentUsd += cost;
    s.pendingUsd = 0;
    s.requests++;
    this.log(s, { event: "request", model, status, ms: Date.now() - started, usage: u, cost_usd: cost, request_id: requestId, ...(charged ? { incomplete: true } : {}) });
  }

  private async forward(req: Request, s: ProxySession, url: URL, body: string | undefined, model?: string, bound = 0, release: () => void = () => {}): Promise<Response> {
    const headers = new Headers();
    req.headers.forEach((v, k) => {
      if (!DROP_REQ.has(k.toLowerCase())) headers.set(k, v);
    });
    headers.set("x-api-key", this.opts.upstreamKey());
    headers.set("accept-encoding", "identity");
    const started = Date.now();
    if (model) s.pendingUsd = bound;
    let upstream: Response;
    try {
      upstream = await fetch(this.opts.upstream + url.pathname + url.search, { method: req.method, headers, body, signal: req.signal });
    } catch (e) {
      this.log(s, { event: "upstream_error", detail: String((e as Error)?.message ?? e).slice(0, 200) });
      if (model) this.settle(s, model, 502, started, zeroUsage(), null, bound, true);
      release();
      return apiError(502, "api_error", "upstream unreachable");
    }
    const resHeaders = new Headers();
    upstream.headers.forEach((v, k) => {
      if (!DROP_RES.has(k.toLowerCase())) resHeaders.set(k, v);
    });
    const requestId = upstream.headers.get("request-id");
    if (!model) {
      this.log(s, { event: "aux", path: url.pathname, status: upstream.status });
      return new Response(await upstream.text(), { status: upstream.status, headers: resHeaders });
    }
    const isStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
    if (!isStream || !upstream.body) {
      try {
        let text: string;
        try {
          text = await upstream.text();
        } catch (e) {
          this.log(s, { event: "upstream_error", detail: String((e as Error)?.message ?? e).slice(0, 200) });
          this.settle(s, model, 502, started, zeroUsage(), requestId, bound, true);
          return apiError(502, "api_error", "upstream body dropped");
        }
        let usage: unknown;
        try {
          usage = JSON.parse(text).usage;
        } catch {}
        const known = typeof usage === "object" && usage !== null;
        this.settle(s, model, upstream.status, started, fromApiUsage(usage), requestId, bound, upstream.status < 400 && !known);
        return new Response(text, { status: upstream.status, headers: resHeaders });
      } finally {
        release();
      }
    }
    const decoder = new TextDecoder();
    let buf = "";
    let start = zeroUsage();
    let delta = zeroUsage();
    let ended = false;
    let known = false;
    const take = (line: string) => {
      if (!line.startsWith("data:")) return;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === "message_start") {
          start = fromApiUsage(ev.message?.usage);
          known = typeof ev.message?.usage === "object" && ev.message.usage !== null;
        }
        else if (ev.type === "message_delta") delta = mergeStreamUsage(delta, fromApiUsage(ev.usage));
        else if (ev.type === "message_stop") ended = true;
      } catch {}
    };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (buf) take(buf);
      this.settle(s, model, upstream.status, started, mergeStreamUsage(start, delta), requestId, bound, upstream.status < 400 && !(ended && known));
      release();
    };
    const meter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buf += decoder.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          take(buf.slice(0, i).replace(/\r$/, ""));
          buf = buf.slice(i + 1);
        }
      },
      flush() {
        finish();
      },
    });
    const piped = upstream.body.pipeThrough(meter);
    const reader = piped.getReader();
    const out = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            finish();
            controller.close();
          } else controller.enqueue(value);
        } catch (e) {
          finish();
          controller.error(e);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
        finish();
      },
    });
    return new Response(out, { status: upstream.status, headers: resHeaders });
  }
}
