import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { addUsage, costUsd, fromApiUsage, mergeStreamUsage, zeroUsage, type Usage } from "./usage.ts";

export interface ProxySession {
  id: string;
  model: string;
  ceilingUsd: number;
  logPath: string;
  spentUsd: number;
  usage: Usage;
  requests: number;
  refusals: { reason: string; detail: string }[];
  errors: number;
  budgetHit: boolean;
}

export interface ProxyOptions {
  hostname: string;
  port: number;
  upstream: string;
  upstreamKey: () => string;
}

const DROP_REQ = new Set(["host", "x-api-key", "authorization", "content-length", "connection", "accept-encoding"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

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

  register(id: string, model: string, ceilingUsd: number, logPath: string): { token: string; session: ProxySession } {
    const token = "lanea-" + randomBytes(24).toString("hex");
    const session: ProxySession = { id, model, ceilingUsd, logPath, spentUsd: 0, usage: zeroUsage(), requests: 0, refusals: [], errors: 0, budgetHit: false };
    this.sessions.set(token, session);
    return { token, session };
  }

  revoke(token: string): void {
    this.sessions.delete(token);
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

  private async messages(req: Request, s: ProxySession, url: URL): Promise<Response> {
    const body = await req.text();
    let model = "";
    try {
      model = JSON.parse(body).model ?? "";
    } catch {
      return this.refuse(s, "body", "unparseable JSON", apiError(400, "invalid_request_error", "unparseable body"));
    }
    if (model !== s.model) return this.refuse(s, "model", model, apiError(403, "permission_error", `model ${model} is not allowed in this session`));
    if (s.spentUsd >= s.ceilingUsd) {
      s.budgetHit = true;
      return this.refuse(s, "budget", s.spentUsd.toFixed(4), apiError(400, "invalid_request_error", "session budget exhausted"));
    }
    return this.forward(req, s, url, body, model);
  }

  private settle(s: ProxySession, model: string, status: number, started: number, u: Usage, requestId: string | null) {
    const cost = costUsd(model, u);
    s.usage = addUsage(s.usage, u);
    s.spentUsd += cost;
    s.requests++;
    if (status >= 400) s.errors++;
    this.log(s, { event: "request", model, status, ms: Date.now() - started, usage: u, cost_usd: cost, request_id: requestId });
  }

  private async forward(req: Request, s: ProxySession, url: URL, body: string | undefined, model?: string): Promise<Response> {
    const headers = new Headers();
    req.headers.forEach((v, k) => {
      if (!DROP_REQ.has(k.toLowerCase())) headers.set(k, v);
    });
    headers.set("x-api-key", this.opts.upstreamKey());
    headers.set("accept-encoding", "identity");
    const started = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(this.opts.upstream + url.pathname + url.search, { method: req.method, headers, body });
    } catch (e) {
      s.errors++;
      this.log(s, { event: "upstream_error", detail: String((e as Error)?.message ?? e).slice(0, 200) });
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
      const text = await upstream.text();
      let u = zeroUsage();
      try {
        u = fromApiUsage(JSON.parse(text).usage);
      } catch {}
      this.settle(s, model, upstream.status, started, u, requestId);
      return new Response(text, { status: upstream.status, headers: resHeaders });
    }
    const decoder = new TextDecoder();
    let buf = "";
    let start = zeroUsage();
    let delta = zeroUsage();
    const take = (line: string) => {
      if (!line.startsWith("data:")) return;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === "message_start") start = fromApiUsage(ev.message?.usage);
        else if (ev.type === "message_delta") delta = mergeStreamUsage(delta, fromApiUsage(ev.usage));
      } catch {}
    };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (buf) take(buf);
      this.settle(s, model, upstream.status, started, mergeStreamUsage(start, delta), requestId);
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
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel() {
        reader.cancel().catch(() => {});
        finish();
      },
    });
    return new Response(out, { status: upstream.status, headers: resHeaders });
  }
}
