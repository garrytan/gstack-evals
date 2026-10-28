import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

describe("proxy request screening", () => {
  test("max_tokens must be a positive integer", () => {
    for (const v of [1, 32000]) expect(validMaxTokens(v)).toBe(true);
    for (const v of ["abc", "1000", -5, 0, 1.5, NaN, Infinity, null, undefined, 2 ** 60]) expect(validMaxTokens(v)).toBe(false);
  });
  test("only the body keys Claude Code sends pass", () => {
    const cc = { model: "m", messages: [], system: [], tools: [], metadata: {}, max_tokens: 1, stream: true, thinking: {}, context_management: {}, output_config: {} };
    expect(unknownBodyKeys(cc)).toEqual([]);
    expect(unknownBodyKeys({ ...cc, mcp_servers: [], container: "x", plugins: [], models: [], provider: {}, speed: "fast", service_tier: "priority" })).toEqual(["mcp_servers", "container", "plugins", "models", "provider", "speed", "service_tier"]);
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
        if (mode === "nousage") return Response.json({ type: "message", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }, { headers });
        if (mode === "stream-nousage") return new Response(sse(streamEvents(false)), { headers: { "content-type": "text/event-stream" } });
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
