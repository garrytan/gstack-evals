import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, reconcile, toMicros } from "../runner/ledger.ts";
import { startProxy, costMicros, SseUsage, splitBetas, unknownBodyKeys, validMaxTokens, type ProxyConfig } from "../runner/proxy.ts";

// Fixes for the blocking findings of #15's ship review, and the state cells it found untested.
const dir = mkdtempSync(join(tmpdir(), "laneb-proxy-review-"));
const price = { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5 };
const usage = { input_tokens: 100, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const usageCost = costMicros({ ...usage, cache_creation_1h_input_tokens: 0 }, price);
const enc = new TextEncoder();
const sse = (events: [string, unknown][], eol = "\n") => events.map(([n, d]) => `event: ${n}${eol}data: ${JSON.stringify(d)}${eol}${eol}`).join("");
const streamEvents = (withUsage: boolean): [string, unknown][] => [
  ["message_start", { type: "message_start", message: withUsage ? { usage: { input_tokens: 100, output_tokens: 1 } } : {} }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, ...(withUsage ? { usage: { output_tokens: 500 } } : {}) }],
  ["message_stop", { type: "message_stop" }],
];
const errorEvent: [string, unknown] = ["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }];

describe("proxy request screening", () => {
  test("max_tokens must be a positive integer", () => {
    for (const v of [1, 32000]) expect(validMaxTokens(v)).toBe(true);
    for (const v of ["abc", "1000", -5, 0, 1.5, NaN, Infinity, null, undefined, 2 ** 60]) expect(validMaxTokens(v)).toBe(false);
  });
  test("only the body keys Claude Code sends pass", () => {
    const cc = { model: "m", messages: [], system: [], tools: [], metadata: {}, max_tokens: 1, stream: true, thinking: {}, context_management: {}, output_config: {} };
    expect(unknownBodyKeys(cc)).toEqual([]);
    expect(unknownBodyKeys({ ...cc, mcp_servers: [], container: "x", plugins: [], models: [], provider: {}, route: "fallback", speed: "fast", service_tier: "priority", inference_geo: "us" })).toEqual(["mcp_servers", "container", "plugins", "models", "provider", "route", "speed", "service_tier", "inference_geo"]);
  });
  test("unlisted beta values are dropped", () => {
    expect(splitBetas("claude-code-20250219, mcp-client-2025-04-04,context-management-2025-06-27,files-api-2025-04-14")).toEqual({ kept: ["claude-code-20250219", "context-management-2025-06-27"], dropped: ["mcp-client-2025-04-04", "files-api-2025-04-14"] });
    expect(splitBetas(null)).toEqual({ kept: [], dropped: [] });
  });
  test("SSE framed with CRLF is parsed", () => {
    const p = new SseUsage();
    const text = sse(streamEvents(true), "\r\n");
    for (let i = 0; i < text.length; i += 7) p.feed(text.slice(i, i + 7));
    expect(p.usage).toMatchObject({ input_tokens: 100, output_tokens: 500 });
    expect(p.stopReason).toBe("end_turn");
    expect(p.sawInput && p.sawOutput).toBe(true);
  });
});

describe("proxy accounting and close against misbehaving upstreams and ledgers", () => {
  const ledgerPath = join(dir, "ledger.jsonl");
  const ledger = new Ledger(ledgerPath, "laneb-quick");
  ledger.approve(10, { quotes: ["test"] });
  const waiting: (() => void)[] = [];
  const release = () => { while (waiting.length) waiting.shift()!(); };
  const seen: { betas: string | null; body: any }[] = [];
  let failSettles = 0;
  let rawMode: "cut" | "reset" = "cut";
  let up: ReturnType<typeof Bun.serve>;
  let raw: Server;
  let ledgerServer: ReturnType<typeof Bun.serve>;
  let proxy: ReturnType<typeof startProxy>;
  let dataUrl = "";
  let controlUrl = "";
  const logPath = join(dir, "req.jsonl");
  const sessionsPath = join(dir, "sess.jsonl");

  beforeAll(async () => {
    up = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as any;
        seen.push({ betas: req.headers.get("anthropic-beta"), body });
        const mode = body.metadata?.user_id ?? "ok";
        const headers = { "retry-after": "7", "request-id": "req_123", "x-should-retry": "true" };
        if (mode === "slow") await new Promise<void>((r) => waiting.push(r));
        if (mode === "error500") return Response.json({ type: "error", error: { type: "api_error", message: "boom" } }, { status: 500, headers });
        if (mode === "nousage") return Response.json({ type: "message", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }, { headers });
        if (mode === "stream-nousage") return new Response(sse(streamEvents(false)), { headers: { "content-type": "text/event-stream" } });
        if (mode === "stream-error") return new Response(sse([errorEvent]), { headers: { "content-type": "text/event-stream" } });
        if (mode === "stream-start-error") return new Response(sse([streamEvents(true)[0], errorEvent]), { headers: { "content-type": "text/event-stream" } });
        if (mode === "crlf") return new Response(sse(streamEvents(true), "\r\n"), { headers: { "content-type": "text/event-stream", ...headers } });
        if (mode === "slow-stream") {
          const stream = new ReadableStream<Uint8Array>({
            async start(ctrl) {
              ctrl.enqueue(enc.encode(sse(streamEvents(true).slice(0, 1))));
              await new Promise<void>((r) => waiting.push(r));
              ctrl.enqueue(enc.encode(sse(streamEvents(true).slice(1))));
              ctrl.close();
            },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream" } });
        }
        return Response.json({ type: "message", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage }, { headers });
      },
    });
    raw = createServer((sock) => {
      sock.once("data", () => {
        if (rawMode === "cut") sock.write('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 1000\r\n\r\n{"usage":');
        setTimeout(() => sock.destroy(), 30);
      });
    });
    await new Promise<void>((r) => raw.listen(0, "127.0.0.1", r));
    ledgerServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const b = (await req.json()) as any;
        if (url.pathname === "/settle" && failSettles > 0) { failSettles--; return new Response("bad gateway", { status: 502 }); }
        const out = url.pathname === "/reserve" ? ledger.reserve(b.id, b.usd_micros, b.meta) : ledger.settle(b.id, b.usd_micros, b.meta);
        return Response.json(out, { status: out.ok ? 200 : 409 });
      },
    });
    const rawPort = (raw.address() as any).port;
    const config: ProxyConfig = {
      routes: {
        up: { base_url: `http://127.0.0.1:${up.port}`, key_env: "FAKE_KEY", auth: "x-api-key", count_tokens: "estimate" },
        raw: { base_url: `http://127.0.0.1:${rawPort}`, key_env: "FAKE_KEY", auth: "x-api-key", count_tokens: "estimate" },
        dead: { base_url: "http://127.0.0.1:1", key_env: "FAKE_KEY", auth: "x-api-key", count_tokens: "estimate" },
      },
      models: {
        "claude-opus-5-5": { route: "up", upstream_model: "claude-opus-5-5", price_per_mtok: price },
        raw: { route: "raw", upstream_model: "raw", price_per_mtok: price },
        dead: { route: "dead", upstream_model: "dead", price_per_mtok: price },
      },
    };
    proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, logPath, sessionsPath, ledgerUrl: `http://127.0.0.1:${ledgerServer.port}`, ledgerPrefix: "r-", env: { FAKE_KEY: "fake" }, closeWaitMs: 200, settleRetryMs: 10 });
    dataUrl = `http://127.0.0.1:${proxy.data.port}`;
    controlUrl = `http://127.0.0.1:${proxy.control.port}`;
  });
  afterAll(async () => {
    release();
    await proxy.stop();
    up.stop(true);
    raw.close();
    ledgerServer.stop(true);
  });

  const open = async (model = "claude-opus-5-5", cap = 0.5) => (await (await fetch(controlUrl + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t", model, cap_usd: cap }) })).json()) as any;
  const send = (token: string, extra: Record<string, unknown> = {}, init: RequestInit = {}, raw?: string) =>
    fetch(dataUrl + "/v1/messages", { method: "POST", headers: { "x-api-key": token, "content-type": "application/json", ...(init.headers as any) }, body: raw ?? JSON.stringify({ model: "m", max_tokens: 1000, messages: [{ role: "user", content: "hi" }], ...extra }), signal: init.signal });
  const close = async (id: string) => (await (await fetch(controlUrl + `/sessions/${id}/close`, { method: "POST", body: "{}" })).json()) as any;
  const entries = (session: string) => readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.session === session);
  const worstOf = (session: string) => entries(session).find((e) => e.worst_micros)?.worst_micros as number;
  const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await Bun.sleep(20); };

  test("finding 1: a non-numeric, negative or fractional max_tokens is refused before any upstream call", async () => {
    const s = await open();
    const before = seen.length;
    for (const max_tokens of ["abc", -5, 0, 1.5, null]) {
      const res = await send(s.token, { max_tokens });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("max_tokens");
    }
    const inf = await send(s.token, {}, {}, '{"model":"m","max_tokens":1e400,"messages":[]}');
    expect(inf.status).toBe(400);
    expect(seen.length).toBe(before);
    expect(proxy.sessions.get(s.id)!.pending.size).toBe(0);
    const closed = await close(s.id);
    expect(closed).toMatchObject({ spent_micros: 0, refused: 6, refused_budget: 0, settled: true });
  });

  test("finding 10: provider-side egress fields are refused and unlisted betas never reach the provider", async () => {
    const s = await open();
    for (const extra of [{ mcp_servers: [{ type: "url", url: "https://example.com/mcp", name: "x" }] }, { container: "skills" }, { plugins: [{ id: "web" }] }, { models: ["other/model"] }]) {
      const res = await send(s.token, extra);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("not allowed");
    }
    const ok = await send(s.token, {}, { headers: { "anthropic-beta": "claude-code-20250219,mcp-client-2025-04-04,code-execution-2025-08-25" } });
    expect(ok.status).toBe(200);
    expect(seen.at(-1)!.betas).toBe("claude-code-20250219");
    expect(entries(s.id).find((e) => e.event === "beta_dropped").betas).toEqual(["mcp-client-2025-04-04", "code-execution-2025-08-25"]);
    await close(s.id);
  });

  test("image and document blocks with a url or file source are refused before any upstream call, count_tokens included", async () => {
    const s = await open();
    const before = seen.length;
    const blocks = [
      { type: "image", source: { type: "url", url: "https://example.com/a.png" } },
      { type: "document", source: { type: "url", url: "https://example.com/a.pdf" } },
      { type: "document", source: { type: "file", file_id: "file_1" } },
    ];
    for (const block of blocks) {
      const messages = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [block] }] }];
      const res = await send(s.token, { messages });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("url or file source");
    }
    const count = await fetch(dataUrl + "/v1/messages/count_tokens", { method: "POST", headers: { "x-api-key": s.token, "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: [blocks[0]] }] }) });
    expect(count.status).toBe(400);
    expect(seen.length).toBe(before);
    const inline = await send(s.token, { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }, { type: "text", text: "what is this?" }] }] });
    expect(inline.status).toBe(200);
    expect(seen.length).toBe(before + 1);
    expect(entries(s.id).filter((e) => e.event === "refused").map((e) => e.sources)).toEqual([["url"], ["url"], ["file"], ["url"]]);
    await close(s.id);
  });

  test("a tool_use input holds model-authored arguments, so a document-typed value in it is not refused, count_tokens included", async () => {
    const s = await open();
    const before = seen.length;
    const toolUse = { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { type: "document", path: "/app/a.pdf" } }] };
    const result = (content: unknown[]) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content }] });
    const count = (messages: unknown[]) => fetch(dataUrl + "/v1/messages/count_tokens", { method: "POST", headers: { "x-api-key": s.token, "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages }) });
    const allowed = [{ role: "user", content: "read it" }, toolUse, result([{ type: "text", text: "a pdf" }])];
    expect((await send(s.token, { messages: allowed })).status).toBe(200);
    expect((await count(allowed)).status).toBe(200);
    expect(seen.length).toBe(before + 1);
    const remote = [{ role: "user", content: "read it" }, toolUse, result([{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }])];
    const refused = await send(s.token, { messages: remote });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("url or file source");
    expect((await count(remote)).status).toBe(400);
    expect(seen.length).toBe(before + 1);
    expect(entries(s.id).filter((e) => e.event === "refused").map((e) => e.sources)).toEqual([["url"], ["url"]]);
    await close(s.id);
  });

  test("finding 5 (json_request x truncated): a JSON body that fails mid-read releases its hold at the worst case", async () => {
    rawMode = "cut";
    const s = await open("raw");
    const res = await send(s.token);
    expect(res.status).toBe(502);
    expect(proxy.sessions.get(s.id)!.pending.size).toBe(0);
    const closed = await close(s.id);
    expect(closed.spent_micros).toBe(worstOf(s.id));
    expect(entries(s.id).find((e) => e.event === "request")).toMatchObject({ complete: false, status: 200 });
  });

  test("finding 9: a request that may have reached the provider and failed is charged its worst case", async () => {
    rawMode = "reset";
    const s = await open("raw");
    expect((await send(s.token)).status).toBe(529);
    const closed = await close(s.id);
    expect(closed).toMatchObject({ requests: 1, ok_responses: 0 });
    expect(closed.spent_micros).toBe(worstOf(s.id));
  });

  test("stream_request x failed_after_send: a stream request that may have reached the provider and failed is charged its worst case", async () => {
    rawMode = "reset";
    const s = await open("raw");
    expect((await send(s.token, { stream: true })).status).toBe(529);
    expect(proxy.sessions.get(s.id)!.pending.size).toBe(0);
    const closed = await close(s.id);
    expect(closed).toMatchObject({ requests: 1, ok_responses: 0 });
    expect(closed.spent_micros).toBe(worstOf(s.id));
  });

  test("json_request and stream_request x upstream_error_status: the error passes through and is billed from its usage, here none", async () => {
    const s = await open();
    for (const stream of [false, true]) {
      const res = await send(s.token, { stream, metadata: { user_id: "error500" } });
      expect(res.status).toBe(500);
      expect(((await res.json()) as any).error.message).toBe("boom");
      expect(proxy.sessions.get(s.id)!.pending.size).toBe(0);
    }
    expect(entries(s.id).filter((e) => e.event === "request").map((e) => [e.status, e.complete, e.cost_micros])).toEqual([[500, true, 0], [500, true, 0]]);
    expect(await close(s.id)).toMatchObject({ spent_micros: 0, ok_responses: 0, requests: 2 });
  });

  test("finding 9: a 200 without usage is charged its worst case, JSON or stream", async () => {
    const s = await open();
    expect((await send(s.token, { metadata: { user_id: "nousage" } })).status).toBe(200);
    expect(await (await send(s.token, { stream: true, metadata: { user_id: "stream-nousage" } })).text()).toContain("message_stop");
    const closed = await close(s.id);
    const reqs = entries(s.id).filter((e) => e.event === "request");
    expect(reqs.map((e) => e.complete)).toEqual([false, false]);
    expect(closed.spent_micros).toBe(reqs[0].worst_micros + reqs[1].worst_micros);
    expect(closed.ok_responses).toBe(2);
  });

  test("a 200 stream that ends in an error event is never an ok response: it costs 0 before message_start and its worst case after", async () => {
    const s = await open();
    const bodies: string[] = [];
    for (const mode of ["stream-error", "stream-start-error"]) {
      const res = await send(s.token, { stream: true, metadata: { user_id: mode } });
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    expect(bodies).toEqual([sse([errorEvent]), sse([streamEvents(true)[0], errorEvent])]);
    const reqs = entries(s.id).filter((e) => e.event === "request");
    expect(reqs.map((e) => [e.status, e.sse_error, e.cost_micros])).toEqual([[200, "overloaded_error", 0], [200, "overloaded_error", reqs[1].worst_micros]]);
    expect(await close(s.id)).toMatchObject({ spent_micros: reqs[1].worst_micros, ok_responses: 0, requests: 2 });
  });

  test("stream_request x upstream_unreachable: a refused connection releases the hold and charges nothing", async () => {
    const s = await open("dead");
    expect((await send(s.token, { stream: true })).status).toBe(529);
    expect(proxy.sessions.get(s.id)!.pending.size).toBe(0);
    expect((await close(s.id)).spent_micros).toBe(0);
  });

  test("CRLF streams are billed from their usage, and retry and request-id headers reach the client", async () => {
    const s = await open();
    const streamed = await send(s.token, { stream: true, metadata: { user_id: "crlf" } });
    await streamed.text();
    expect(streamed.headers.get("retry-after")).toBe("7");
    const plain = await send(s.token);
    expect(plain.headers.get("request-id")).toBe("req_123");
    expect(plain.headers.get("x-should-retry")).toBe("true");
    expect((await close(s.id)).spent_micros).toBe(2 * usageCost);
  });

  test("json_request x client_cancel: a client that leaves is still billed from the usage", async () => {
    const s = await open();
    const abort = new AbortController();
    const pending = send(s.token, { metadata: { user_id: "slow" } }, { signal: abort.signal }).catch(() => null);
    await until(() => waiting.length > 0);
    abort.abort();
    await pending;
    release();
    await until(() => proxy.sessions.get(s.id)!.pending.size === 0);
    expect((await close(s.id)).spent_micros).toBe(usageCost);
  });

  test("json_request x session_close: close aborts the request and charges its worst case once", async () => {
    const s = await open();
    const res = send(s.token, { metadata: { user_id: "slow" } });
    await until(() => waiting.length > 0);
    const closed = await close(s.id);
    expect((await res).status).toBe(529);
    const charged = entries(s.id).filter((e) => e.event === "charged_at_worst");
    expect(charged).toHaveLength(1);
    expect(closed.spent_micros).toBe(charged[0].worst_micros);
    expect(readRows(ledgerPath).filter((r) => r.id === "r-" + s.id && r.kind === "settle").map((r) => r.usd_micros)).toEqual([charged[0].worst_micros]);
    release();
  });

  test("finding 4: a failed settle leaves the session unsettled, keeps its sessions row, and the next close settles it", async () => {
    const s = await open();
    await send(s.token);
    failSettles = 3;
    const first = await close(s.id);
    expect(first).toMatchObject({ settled: false, spent_micros: usageCost, ledger_settle: { ok: false } });
    const row = readFileSync(sessionsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.id === s.id);
    expect(row).toHaveLength(1);
    expect(row[0].spent_micros).toBe(usageCost);
    expect(((await (await fetch(controlUrl + "/totals")).json()) as any).unsettled_sessions).toEqual([s.id]);
    expect(entries(s.id).filter((e) => e.event === "settle_failed")).toHaveLength(3);
    const second = await close(s.id);
    expect(second).toMatchObject({ settled: true, ledger_settle: { ok: true } });
    expect(readRows(ledgerPath).filter((r) => r.id === "r-" + s.id && r.kind === "settle")).toHaveLength(1);
    expect(((await (await fetch(controlUrl + "/totals")).json()) as any).unsettled_sessions).toEqual([]);
  });

  test("finding 4: concurrent closes both wait for the in-flight charge and settle once", async () => {
    const s = await open();
    const res = send(s.token, { metadata: { user_id: "slow" } });
    await until(() => waiting.length > 0);
    const [a, b] = await Promise.all([close(s.id), close(s.id)]);
    await res;
    expect(a.spent_micros).toBeGreaterThan(0);
    expect(b.spent_micros).toBe(a.spent_micros);
    expect(a.settled && b.settled).toBe(true);
    expect(readRows(ledgerPath).filter((r) => r.id === "r-" + s.id && r.kind === "settle")).toHaveLength(1);
    release();
  });

  test("session x close_all: every open session closes, in-flight requests are charged, and an unsettled one is retried", async () => {
    const busy = await open();
    const idle = await open();
    await send(idle.token);
    const res = send(busy.token, { stream: true, metadata: { user_id: "slow-stream" } });
    await until(() => waiting.length > 0);
    const out = (await (await fetch(controlUrl + "/close-all", { method: "POST" })).json()) as any[];
    const by = Object.fromEntries(out.map((s) => [s.id, s]));
    expect(by[busy.id].spent_micros).toBe(entries(busy.id).find((e) => e.event === "charged_at_worst").worst_micros);
    expect(by[idle.id].spent_micros).toBe(usageCost);
    for (const id of [busy.id, idle.id]) {
      expect(by[id]).toMatchObject({ open: false, settled: true });
      expect(readRows(ledgerPath).filter((r) => r.id === "r-" + id && r.kind === "settle")).toHaveLength(1);
    }
    release();
    await (await res).text().catch(() => "");
    expect(((await (await fetch(controlUrl + "/totals")).json()) as any).open_sessions).toBe(0);
  });

  // Generated by gstack /ship Step 7 (test coverage audit) for #25, pass 1.
  // Value: protects=close-all settles a session that already closed but whose settle failed, without draining it twice;
  //   fails_when=close-all goes back to selecting only open sessions, so vm-run's exit trap leaves the reserve open;
  //   why_new=the close-all test above never makes a settle fail, so every session it closes is still open; seam=none;
  //   no_claim=the real ledger service over the SSH tunnel (in-process ledger behind a stub HTTP server)
  test("close-all settles a session that closed earlier with a failed settle, and writes no second sessions row", async () => {
    const s = await open();
    await send(s.token);
    failSettles = 3;
    expect(await close(s.id)).toMatchObject({ settled: false, spent_micros: usageCost });
    const out = (await (await fetch(controlUrl + "/close-all", { method: "POST" })).json()) as any[];
    expect(out.find((x) => x.id === s.id)).toMatchObject({ settled: true, spent_micros: usageCost, ledger_settle: { ok: true } });
    expect(readRows(ledgerPath).filter((r) => r.id === "r-" + s.id && r.kind === "settle").map((r) => r.usd_micros)).toEqual([usageCost]);
    expect(readFileSync(sessionsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.id === s.id)).toHaveLength(1);
    expect(((await (await fetch(controlUrl + "/totals")).json()) as any).unsettled_sessions).toEqual([]);
  });
});

describe("batch cap", () => {
  test("concurrent opens cannot pass the batch cap together while their reserves wait on the ledger", async () => {
    const ledger = new Ledger(join(dir, "ledger-race.jsonl"), "laneb-quick");
    ledger.approve(100, { quotes: ["test"] });
    let garbage = 1;
    const ledgerServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const b = (await req.json()) as any;
        await Bun.sleep(100);
        if (garbage-- > 0) return new Response("not json", { status: 502 });
        const out = new URL(req.url).pathname === "/reserve" ? ledger.reserve(b.id, b.usd_micros, b.meta) : ledger.settle(b.id, b.usd_micros, b.meta);
        return Response.json(out, { status: out.ok ? 200 : 409 });
      },
    });
    const config: ProxyConfig = { routes: { up: { base_url: "http://127.0.0.1:1", key_env: "K", auth: "x-api-key", count_tokens: "estimate" } }, models: { m: { route: "up", upstream_model: "m", price_per_mtok: price } } };
    const proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, logPath: join(dir, "req-race.jsonl"), sessionsPath: join(dir, "sess-race.jsonl"), ledgerUrl: `http://127.0.0.1:${ledgerServer.port}`, env: { K: "k" }, globalCapMicros: toMicros(1), closeWaitMs: 50 });
    try {
      const open = () => fetch(`http://127.0.0.1:${proxy.control.port}/sessions`, { method: "POST", body: JSON.stringify({ trial: "t", model: "m", cap_usd: 0.6 }) });
      expect((await open()).status).toBe(502);
      expect(readFileSync(join(dir, "req-race.jsonl"), "utf8")).toContain("reserve_failed");
      const statuses = (await Promise.all([open(), open()])).map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      expect(ledger.status().openReservedMicros).toBe(toMicros(0.6));
      expect(((await (await fetch(`http://127.0.0.1:${proxy.control.port}/totals`)).json()) as any).cap_stop).toContain("batch cap");
    } finally {
      await proxy.stop();
      ledgerServer.stop(true);
    }
  });

  // A proxy with a 1 USD batch cap in front of a ledger stub; answer() may replace the ledger's reply to the nth reserve.
  const capRig = (name: string, answer: (n: number, body: any) => Promise<Response | undefined>) => {
    const ledger = new Ledger(join(dir, `ledger-${name}.jsonl`), "laneb-quick");
    ledger.approve(100, { quotes: ["test"] });
    let reserves = 0;
    const ledgerServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const b = (await req.json()) as any;
        const isReserve = new URL(req.url).pathname === "/reserve";
        const special = isReserve ? await answer(reserves++, b) : undefined;
        if (special) return special;
        const out = isReserve ? ledger.reserve(b.id, b.usd_micros, b.meta) : ledger.settle(b.id, b.usd_micros, b.meta);
        return Response.json(out, { status: out.ok ? 200 : 409 });
      },
    });
    const config: ProxyConfig = { routes: { up: { base_url: "http://127.0.0.1:1", key_env: "K", auth: "x-api-key", count_tokens: "estimate" } }, models: { m: { route: "up", upstream_model: "m", price_per_mtok: price } } };
    const proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, logPath: join(dir, `req-${name}.jsonl`), sessionsPath: join(dir, `sess-${name}.jsonl`), ledgerUrl: `http://127.0.0.1:${ledgerServer.port}`, env: { K: "k" }, globalCapMicros: toMicros(1), closeWaitMs: 50 });
    const control = `http://127.0.0.1:${proxy.control.port}`;
    return {
      ledger,
      open: (cap: number, open_key?: string) => fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t", model: "m", cap_usd: cap, open_key }) }),
      capStop: async () => ((await (await fetch(control + "/totals")).json()) as any).cap_stop,
      stop: async () => { await proxy.stop(); ledgerServer.stop(true); },
    };
  };

  test("reserve_ok x settle_open: a reserved open stops counting as pending, so two opens that fit the batch cap together both open", async () => {
    const r = capRig("fit", async () => undefined);
    try {
      expect((await r.open(0.4)).status).toBe(200);
      expect((await r.open(0.4)).status).toBe(200);
      expect(r.ledger.status().openReservedMicros).toBe(toMicros(0.8));
      expect(await r.capStop()).toBeNull();
    } finally {
      await r.stop();
    }
  });

  test("reserve_throw x concurrent_open: an open refused beside a pending reserve latches the batch stop, and it stays latched when that reserve then fails", async () => {
    let pending = false;
    const r = capRig("throw-beside", async (n) => {
      if (n > 0) return undefined;
      pending = true;
      await Bun.sleep(200);
      return new Response("not json", { status: 502 });
    });
    try {
      const first = r.open(0.6);
      for (let i = 0; i < 100 && !pending; i++) await Bun.sleep(10);
      expect((await r.open(0.6)).status).toBe(409);
      expect((await first).status).toBe(502);
      expect(r.ledger.status().openReservedMicros).toBe(0);
      expect(await r.capStop()).toContain("batch cap");
      expect((await r.open(0.1)).status).toBe(409);
    } finally {
      await r.stop();
    }
  });

  test("reserve_refused x concurrent_open: a pending reserve the ledger refuses and the open refused beside it both answer 409 and latch the stop", async () => {
    let pending = false;
    const r = capRig("refused-beside", async (n) => {
      if (n > 0) return undefined;
      pending = true;
      await Bun.sleep(200);
      return Response.json({ ok: false, error: "line item cap reached" }, { status: 409 });
    });
    try {
      const first = r.open(0.6);
      for (let i = 0; i < 100 && !pending; i++) await Bun.sleep(10);
      expect((await r.open(0.6)).status).toBe(409);
      expect((await first).status).toBe(409);
      expect(r.ledger.status().openReservedMicros).toBe(0);
      expect(await r.capStop()).toContain("ledger refused");
      expect((await r.open(0.1)).status).toBe(409);
    } finally {
      await r.stop();
    }
  });

  const keyedId = (key: string) => "s-" + createHash("sha256").update(key).digest("hex").slice(0, 12);

  test("open_key: two concurrent opens with one key give one session and one reserve, and the batch cap counts it once", async () => {
    let reserves = 0;
    // gstack-timing-ok: the delay only holds the first reserve open so the second open overlaps it; a late second open gets the same result
    const r = capRig("key-concurrent", async () => { reserves++; await Bun.sleep(100); return undefined; });
    try {
      const [a, b] = await Promise.all([r.open(0.6, "k1"), r.open(0.6, "k1")]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const [ja, jb] = [(await a.json()) as any, (await b.json()) as any];
      expect(jb).toEqual(ja);
      expect(ja.id).toBe(keyedId("k1"));
      expect(reserves).toBe(1);
      expect(r.ledger.status().openIds).toEqual([ja.id]);
      expect((await r.open(0.3)).status).toBe(200);
      expect(await r.capStop()).toBeNull();
    } finally {
      await r.stop();
    }
  });

  test("open_key: a reserve that landed but whose answer was lost gives 502, and the retry with the same key opens on that reserve", async () => {
    const r = capRig("key-lost", async (n, b) => {
      if (n > 0) return undefined;
      r.ledger.reserve(b.id, b.usd_micros, b.meta);
      return new Response("not json", { status: 200 });
    });
    try {
      expect((await r.open(0.6, "k2")).status).toBe(502);
      const retry = await r.open(0.6, "k2");
      expect(retry.status).toBe(200);
      const { id } = (await retry.json()) as any;
      expect(id).toBe(keyedId("k2"));
      expect(readRows(r.ledger.path).filter((x) => x.kind === "reserve" && x.id === id)).toHaveLength(1);
      expect(r.ledger.status().openIds).toEqual([id]);
      expect(await r.capStop()).toBeNull();
    } finally {
      await r.stop();
    }
  });

  test("open_key: a second open after a successful one returns the same id and token without a second reserve", async () => {
    let reserves = 0;
    const r = capRig("key-again", async () => { reserves++; return undefined; });
    try {
      const first = (await (await r.open(0.6, "k3")).json()) as any;
      const again = await r.open(0.6, "k3");
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(first);
      expect(reserves).toBe(1);
      expect(r.ledger.status().openIds).toEqual([first.id]);
    } finally {
      await r.stop();
    }
  });

  test("finding 6: the batch cap refuses at session open, never mid-session", async () => {
    const ledger = new Ledger(join(dir, "ledger-batch.jsonl"), "laneb-quick");
    ledger.approve(100, { quotes: ["test"] });
    const up = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ type: "message", content: [], stop_reason: "end_turn", usage }) });
    const ledgerServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const b = (await req.json()) as any;
        const out = new URL(req.url).pathname === "/reserve" ? ledger.reserve(b.id, b.usd_micros, b.meta) : ledger.settle(b.id, b.usd_micros, b.meta);
        return Response.json(out, { status: out.ok ? 200 : 409 });
      },
    });
    const config: ProxyConfig = { routes: { up: { base_url: `http://127.0.0.1:${up.port}`, key_env: "K", auth: "x-api-key", count_tokens: "estimate" } }, models: { m: { route: "up", upstream_model: "m", price_per_mtok: price } } };
    const proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, logPath: join(dir, "req-batch.jsonl"), sessionsPath: join(dir, "sess-batch.jsonl"), ledgerUrl: `http://127.0.0.1:${ledgerServer.port}`, env: { K: "k" }, globalCapMicros: toMicros(0.08), closeWaitMs: 50 });
    const control = `http://127.0.0.1:${proxy.control.port}`;
    try {
      const open = (cap: number) => fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t", model: "m", cap_usd: cap }) });
      const a = (await (await open(0.05)).json()) as any;
      const b = await open(0.05);
      expect(b.status).toBe(409);
      expect(((await (await fetch(control + "/totals")).json()) as any).cap_stop).toContain("batch cap");
      expect(ledger.status().openIds).toHaveLength(1);
      // Session a runs to its own cap: two requests of about 0.019 each fit, a third does not, and none is refused by the batch cap.
      const send = () => fetch(`http://127.0.0.1:${proxy.data.port}/v1/messages`, { method: "POST", headers: { "x-api-key": a.token }, body: JSON.stringify({ model: "m", max_tokens: 500, messages: [] }) });
      const statuses = [(await send()).status, (await send()).status];
      expect(statuses).toEqual([200, 200]);
      const refused = readFileSync(join(dir, "req-batch.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "refused");
      expect(refused).toEqual([]);
      const closed = (await (await fetch(control + `/sessions/${a.id}/close`, { method: "POST", body: "{}" })).json()) as any;
      expect(closed.refused_budget).toBe(0);
    } finally {
      await proxy.stop();
      up.stop(true);
      ledgerServer.stop(true);
    }
  });
});

describe("ledger", () => {
  test("caller meta cannot overwrite the money fields of a row", () => {
    const l = new Ledger(join(dir, "ledger-meta.jsonl"), "laneb-quick");
    l.approve(1, { quotes: ["test"] });
    expect(l.reserve("a", toMicros(0.6), { kind: "note", usd_micros: 1, id: "zzz" }).ok).toBe(true);
    expect(l.reserve("b", toMicros(0.6)).ok).toBe(false);
    expect(l.settle("a", toMicros(0.1), { usd_micros: 0, kind: "note" }).ok).toBe(true);
    expect(readRows(join(dir, "ledger-meta.jsonl")).slice(1).map((r) => [r.kind, r.id, r.usd_micros])).toEqual([["reserve", "a", 600000], ["settle", "a", 100000]]);
  });

  test("reconcile settles open reserves from the proxy's session rows and leaves the rest open", () => {
    const path = join(dir, "ledger-reconcile.jsonl");
    const l = new Ledger(path, "laneb-quick");
    l.approve(10, { quotes: ["test"] });
    for (const id of ["p-s-1", "p-s-2", "p-s-3", "q-s-9"]) l.reserve(id, toMicros(1));
    l.settle("p-s-3", 5);
    const rows = [
      { id: "s-1", trial: "t1__env", spent_micros: 250_000, closed_at: "x", close_reason: "agent_finished" },
      { id: "s-3", trial: "t3__env", spent_micros: 7, closed_at: "x" },
      { id: "s-9", trial: "t9__env", spent_micros: 9, closed_at: "x" },
    ];
    const out = reconcile(l, rows, "p-");
    expect(out).toEqual({ settled: [{ id: "p-s-1", usd_micros: 250_000 }], leftOpen: ["p-s-2"] });
    expect(readRows(path).at(-1)).toMatchObject({ kind: "settle", id: "p-s-1", usd_micros: 250_000, reconciled: true });
    expect(l.status().openIds).toEqual(["p-s-2", "q-s-9"]);
    const usage = Bun.spawnSync(["bun", join(import.meta.dir, "../runner/ledger.ts"), "reconcile", "--path", path, "--item", "laneb-quick", "--prefix", "q-"]);
    expect(usage.exitCode).toBe(2);
    expect(usage.stderr.toString()).toStartWith("E_USAGE");
    writeFileSync(join(dir, "rows.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const ok = Bun.spawnSync(["bun", join(import.meta.dir, "../runner/ledger.ts"), "reconcile", "--path", path, "--item", "laneb-quick", "--sessions", join(dir, "rows.jsonl"), "--prefix", "q-"]);
    expect(JSON.parse(ok.stdout.toString())).toEqual({ settled: 1, settled_usd: 0.000009, left_open: [] });
  });
});
