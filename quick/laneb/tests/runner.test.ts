import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, toMicros } from "../runner/ledger.ts";
import { startProxy, costMicros, priceFor, maxPrice, SseUsage, serverTools, worstCaseMicros, type ProxyConfig } from "../runner/proxy.ts";
import { startFakeUpstream } from "../runner/fake_upstream.ts";

const dir = mkdtempSync(join(tmpdir(), "laneb-test-"));
const price = { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5 };

describe("ledger", () => {
  test("approval first, then reserves within the cap, idempotent ids, one settle per id", () => {
    const l = new Ledger(join(dir, "l1.jsonl"), "laneb-quick");
    expect(() => l.status()).toThrow();
    l.approve(10, { quotes: ["Rec"] });
    expect(() => l.approve(10, {})).toThrow();
    expect(l.reserve("a", toMicros(6))).toEqual({ ok: true, existing: false });
    expect(l.reserve("a", toMicros(6))).toEqual({ ok: true, existing: true });
    expect(l.reserve("a", toMicros(5)).ok).toBe(false);
    const over = l.reserve("b", toMicros(5));
    expect(over.ok).toBe(false);
    expect(l.settle("a", toMicros(1.5)).ok).toBe(true);
    expect(l.settle("a", toMicros(1.5))).toEqual({ ok: false, reason: "already settled" });
    expect(l.settle("zzz", 1).ok).toBe(false);
    expect(l.reserve("b", toMicros(5)).ok).toBe(true);
    const t = l.status();
    expect(t.settledMicros).toBe(toMicros(1.5));
    expect(t.openReservedMicros).toBe(toMicros(5));
    expect(readRows(join(dir, "l1.jsonl")).map((r) => r.kind)).toEqual(["approval", "reserve", "settle", "reserve"]);
  });
});

describe("proxy helpers", () => {
  test("cost uses every usage field", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_creation_1h_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
    expect(costMicros(u, price)).toBe(toMicros(5 + 25 + 6.25 + 10 + 0.5));
  });
  test("long prompts switch the whole request to the higher tier", () => {
    const low = { input: 0.1, output: 0.5, cache_write_5m: 0.125, cache_write_1h: 0.2, cache_read: 0.01 };
    const high = { input: 0.5, output: 2.5, cache_write_5m: 0.625, cache_write_1h: 1, cache_read: 0.05 };
    const m = { price_per_mtok: low, long_prompt: { over_tokens: 100_000, price_per_mtok: high } };
    const small = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 99_990 };
    const big = { ...small, cache_read_input_tokens: 99_991 };
    expect(priceFor(small, m)).toBe(low);
    expect(priceFor(big, m)).toBe(high);
    expect(maxPrice(m)).toEqual(high);
  });
  test("worst case bounds a request by body size and max_tokens", () => {
    expect(worstCaseMicros(3000, 1000, price)).toBe(toMicros((1000 * 10 + 1000 * 25) / 1e6));
  });
  test("SSE parser takes usage from message_start and message_delta across chunk splits", () => {
    const p = new SseUsage();
    const text = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7,"cache_read_input_tokens":11,"cache_creation_input_tokens":3,"output_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\n';
    for (let i = 0; i < text.length; i += 17) p.feed(text.slice(i, i + 17));
    expect(p.usage).toEqual({ input_tokens: 7, output_tokens: 42, cache_creation_input_tokens: 3, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 11 });
    expect(p.stopReason).toBe("end_turn");
  });
  test("server-side tools are detected", () => {
    expect(serverTools({ tools: [{ name: "Bash" }, { type: "custom", name: "x" }] })).toEqual([]);
    expect(serverTools({ tools: [{ type: "web_search_20250305", name: "web_search" }] })).toEqual(["web_search_20250305"]);
  });
});

describe("proxy end to end against the fake upstream", () => {
  const ledgerPath = join(dir, "ledger.jsonl");
  const ledger = new Ledger(ledgerPath, "laneb-quick");
  ledger.approve(1, { quotes: ["test"] });
  let fake: ReturnType<typeof startFakeUpstream>;
  let proxy: ReturnType<typeof startProxy>;
  let ledgerServer: ReturnType<typeof Bun.serve>;
  let dataUrl = "";
  let controlUrl = "";

  beforeAll(() => {
    fake = startFakeUpstream(0, join(dir, "fake.jsonl"));
    ledgerServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const b = (await req.json()) as any;
        const out = url.pathname === "/reserve" ? ledger.reserve(b.id, b.usd_micros, b.meta) : ledger.settle(b.id, b.usd_micros, b.meta);
        return Response.json(out, { status: out.ok ? 200 : 409 });
      },
    });
    const config: ProxyConfig = {
      routes: { fake: { base_url: `http://127.0.0.1:${fake.port}`, key_env: "FAKE_KEY", auth: "x-api-key", count_tokens: "estimate" } },
      models: { "claude-opus-5-5": { route: "fake", upstream_model: "claude-opus-5-5", price_per_mtok: price } },
    };
    proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, logPath: join(dir, "req.jsonl"), sessionsPath: join(dir, "sess.jsonl"), ledgerUrl: `http://127.0.0.1:${ledgerServer.port}`, ledgerPrefix: "t-", env: { FAKE_KEY: "fake" } });
    dataUrl = `http://127.0.0.1:${proxy.data.port}`;
    controlUrl = `http://127.0.0.1:${proxy.control.port}`;
  });
  afterAll(async () => {
    await proxy.stop();
    fake.stop(true);
    ledgerServer.stop(true);
  });

  const open = async (cap: number) => (await (await fetch(controlUrl + "/sessions", { method: "POST", body: JSON.stringify({ trial: "trial-1", model: "claude-opus-5-5", cap_usd: cap }) })).json()) as any;
  const message = (token: string, extra: Record<string, unknown> = {}) =>
    fetch(dataUrl + "/v1/messages", { method: "POST", headers: { "x-api-key": token, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "whatever", max_tokens: 1000, stream: true, messages: [{ role: "user", content: "hi" }], tools: [{ name: "Bash" }], ...extra }) });

  test("meters a streamed request, settles on close, and refuses the closed token", async () => {
    const s = await open(0.5);
    expect(s.token).toStartWith("laneb-");
    const res = await message(s.token);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("toolu_fake_1");
    const fakeLog = readFileSync(join(dir, "fake.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(fakeLog.at(-1).model).toBe("claude-opus-5-5");
    const closed = (await (await fetch(controlUrl + `/sessions/${s.id}/close`, { method: "POST", body: "{}" })).json()) as any;
    const expected = costMicros({ input_tokens: 1200, cache_creation_input_tokens: 300, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 5000, output_tokens: 150 }, price);
    expect(closed.spent_micros).toBe(expected);
    expect(closed.requested_models).toEqual({ whatever: 1 });
    expect(closed.ledger_settle).toEqual({ ok: true });
    const rows = readRows(ledgerPath);
    expect(rows.at(-1)).toMatchObject({ kind: "settle", id: "t-" + s.id, usd_micros: expected });
    expect((await message(s.token)).status).toBe(401);
  });

  test("refuses unknown tokens, server tools, and requests past the session cap", async () => {
    expect((await message("nope")).status).toBe(401);
    const s = await open(0.1);
    expect((await message(s.token, { tools: [{ type: "web_search_20250305", name: "web_search" }] })).status).toBe(400);
    const big = await message(s.token, { max_tokens: 64000 });
    expect(big.status).toBe(400);
    expect(await big.text()).toContain("session budget exhausted");
    await fetch(controlUrl + `/sessions/${s.id}/close`, { method: "POST", body: "{}" });
  });

  test("the ledger refuses a session whose cap would pass the line item", async () => {
    const res = await fetch(controlUrl + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t", model: "claude-opus-5-5", cap_usd: 5 }) });
    expect(res.status).toBe(409);
  });
});
