import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODELS } from "../src/config.ts";
import { MeteringProxy, requestCeilingUsd } from "../src/proxy.ts";

const dir = mkdtempSync(join(tmpdir(), "proxy-"));
let mode: "ok" | "drop" | "json-drop" | "json-nousage" | "json-nan" | "json-empty" | "slow" | "slow-big" | "delta-empty" = "ok";
let inflight = 0;
let maxInflight = 0;
let hits = 0;
let lastBody = "";
const sse = (events: any[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const start = { type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
const upstream = Bun.serve({
  port: 0,
  async fetch(req) {
    hits++;
    lastBody = await req.text();
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    await Bun.sleep(mode === "slow" || mode === "slow-big" ? 300 : 30);
    inflight--;
    if (mode === "json-nousage") return Response.json({ type: "message", content: [] });
    if (mode === "json-nan") return Response.json({ type: "message", usage: { input_tokens: "many", output_tokens: 10 } });
    if (mode === "json-empty") return Response.json({ type: "message", usage: {} });
    if (mode === "json-drop") {
      let sent = false;
      return new Response(
        new ReadableStream({
          async pull(c) {
            if (!sent) {
              sent = true;
              c.enqueue(new TextEncoder().encode('{"type":"message","usage":'));
              return;
            }
            await Bun.sleep(20);
            c.error(new Error("connection reset"));
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    if (mode === "drop") {
      const enc = new TextEncoder();
      let sent = false;
      return new Response(
        new ReadableStream({
          async pull(c) {
            if (!sent) {
              sent = true;
              c.enqueue(enc.encode(sse([start])));
              return;
            }
            await Bun.sleep(20);
            c.error(new Error("connection reset"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    if (mode === "delta-empty") return new Response(sse([start, { type: "message_delta", usage: {} }, { type: "message_stop" }]), { headers: { "content-type": "text/event-stream" } });
    const first = mode === "slow-big" ? { ...start, message: { usage: { ...start.message.usage, input_tokens: 200_000 } } } : start;
    return new Response(sse([first, { type: "message_delta", usage: { output_tokens: 1000 } }, { type: "message_stop" }]), { headers: { "content-type": "text/event-stream" } });
  },
});
const proxy = new MeteringProxy({ hostname: "127.0.0.1", port: 0, upstream: `http://127.0.0.1:${upstream.port}`, upstreamKey: () => "k" });
afterAll(() => {
  proxy.stop();
  upstream.stop(true);
});

const call = (token: string, body: object) =>
  fetch(`${proxy.url}/v1/messages`, { method: "POST", headers: { "x-api-key": token, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => {
    try {
      await r.text();
    } catch {}
    return r.status;
  });

describe("metering proxy", () => {
  test("a request with a 600 KB body and 64k max_tokens still fits between the ceiling and the reservation", () => {
    for (const m of Object.values(MODELS)) expect(m.sessionCeilingUsd + requestCeilingUsd(m.id, 600_000, 64_000)).toBeLessThanOrEqual(m.reserveUsd);
  });
  test("serializes a session's requests and never lets spend pass the hard limit", async () => {
    const body = { model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "x".repeat(2000) }] };
    const bound = requestCeilingUsd("claude-opus-5-5", JSON.stringify(body).length, 1000);
    const per = (1000 * 4 + 1000 * 20) / 1e6;
    const hard = bound + 2 * per;
    const { token, session } = proxy.register("s1", "claude-opus-5-5", 1, hard, join(dir, "s1.jsonl"));
    maxInflight = 0;
    const statuses = await Promise.all(Array.from({ length: 8 }, () => call(token, body)));
    expect(maxInflight).toBe(1);
    expect(session.spentUsd).toBeLessThanOrEqual(hard);
    expect(statuses.filter((s) => s === 200).length).toBe(3);
    expect(session.budgetHit).toBe(true);
  });
  test("refuses a model other than the session's", async () => {
    const { token, session } = proxy.register("s2", "claude-haiku-5-5", 1, 1, join(dir, "s2.jsonl"));
    expect(await call(token, { model: "claude-sonnet-5-5", max_tokens: 10, messages: [] })).toBe(403);
    expect(session.refusals[0]!.reason).toBe("model");
  });
  test("a dropped stream is still charged, at its upper bound", async () => {
    mode = "drop";
    const body = { model: "claude-haiku-5-5", max_tokens: 1000, messages: [{ role: "user", content: "hi" }] };
    const { token, session } = proxy.register("s3", "claude-haiku-5-5", 1, 1, join(dir, "s3.jsonl"));
    await call(token, body);
    await Bun.sleep(50);
    mode = "ok";
    expect(session.requests).toBe(1);
    expect(session.spentUsd).toBeCloseTo(requestCeilingUsd("claude-haiku-5-5", JSON.stringify(body).length, 1000), 9);
    expect(readFileSync(join(dir, "s3.jsonl"), "utf8")).toContain('"incomplete":true');
  });
  test("an upstream that never answers is charged at the bound", async () => {
    const dead = new MeteringProxy({ hostname: "127.0.0.1", port: 0, upstream: "http://127.0.0.1:9", upstreamKey: () => "k" });
    const body = { model: "claude-haiku-5-5", max_tokens: 500, messages: [] };
    const { token, session } = dead.register("s4", "claude-haiku-5-5", 1, 1, join(dir, "s4.jsonl"));
    const status = await fetch(`${dead.url}/v1/messages`, { method: "POST", headers: { "x-api-key": token }, body: JSON.stringify(body) }).then((r) => r.status);
    dead.stop();
    expect(status).toBe(502);
    expect(session.spentUsd).toBeCloseTo(requestCeilingUsd("claude-haiku-5-5", JSON.stringify(body).length, 500), 9);
  });
  test("an unknown token gets 401", async () => {
    expect(await call("nope", { model: "claude-haiku-5-5" })).toBe(401);
  });
  test("refuses every request once the session has spent its ceiling", async () => {
    const body = { model: "claude-haiku-5-5", max_tokens: 1000, messages: [{ role: "user", content: "hi" }] };
    const { token, session } = proxy.register("s5", "claude-haiku-5-5", 0.0001, 1, join(dir, "s5.jsonl"));
    expect(await call(token, body)).toBe(200);
    expect(session.spentUsd).toBeGreaterThan(0.0001);
    hits = 0;
    expect(await call(token, body)).toBe(400);
    expect(hits).toBe(0);
    expect(session.budgetHit).toBe(true);
    expect(session.refusals.map((r) => r.reason)).toEqual(["budget"]);
  });
});

describe("metering proxy accounting", () => {
  const haiku = { model: "claude-haiku-5-5", max_tokens: 1000, messages: [{ role: "user", content: "hi" }] };
  const bound = requestCeilingUsd("claude-haiku-5-5", JSON.stringify(haiku).length, 1000);
  for (const m of ["json-drop", "json-nousage", "json-nan", "json-empty"] as const)
    test(`a non-stream reply (${m}) is charged at its bound and frees the session`, async () => {
      mode = m;
      const { token, session } = proxy.register(m, "claude-haiku-5-5", 1, 1, join(dir, `${m}.jsonl`));
      const status = await call(token, haiku);
      mode = "ok";
      expect(status).toBe(m === "json-drop" ? 502 : 200);
      expect(session.spentUsd).toBeCloseTo(bound, 9);
      expect(Number.isFinite(session.usage.input)).toBe(true);
      const next = await Promise.race([call(token, haiku), Bun.sleep(2000).then(() => "stuck")]);
      expect(next).toBe(200);
      expect(session.requests).toBe(2);
    });
  test("a revoked session sends nothing more upstream, and drain waits for the request in flight", async () => {
    mode = "slow";
    hits = 0;
    const { token, session } = proxy.register("s6", "claude-haiku-5-5", 1, 1, join(dir, "s6.jsonl"));
    const first = call(token, haiku);
    await Bun.sleep(50);
    const second = call(token, haiku);
    await Bun.sleep(50);
    proxy.revoke(token);
    await proxy.drain(session, 5000);
    const statuses = await Promise.all([first, second]);
    mode = "ok";
    expect(statuses).toEqual([200, 401]);
    expect(hits).toBe(1);
    expect(session.requests).toBe(1);
    expect(session.spentUsd).toBeGreaterThan(0);
  });
  test("drain charges a request still in flight at its bound when it does not settle in time", async () => {
    mode = "slow";
    const { token, session } = proxy.register("s7", "claude-haiku-5-5", 1, 1, join(dir, "s7.jsonl"));
    const first = call(token, haiku);
    await Bun.sleep(50);
    proxy.revoke(token);
    await proxy.drain(session, 10);
    expect(session.spentUsd).toBeCloseTo(bound, 9);
    await first;
    await Bun.sleep(20);
    mode = "ok";
    expect(session.requests).toBe(1);
    expect(session.spentUsd).toBeCloseTo(bound, 9);
  });
  test("a reply that settles after drain adds what it cost beyond its bound", async () => {
    mode = "slow-big";
    const { token, session } = proxy.register("s10", "claude-haiku-5-5", 1, 1, join(dir, "s10.jsonl"));
    const first = call(token, haiku);
    await Bun.sleep(50);
    proxy.revoke(token);
    await proxy.drain(session, 10);
    expect(session.spentUsd).toBeCloseTo(bound, 9);
    await first;
    await Bun.sleep(20);
    mode = "ok";
    expect(session.requests).toBe(1);
    expect(session.spentUsd).toBeGreaterThan(bound * 2);
    const row = readFileSync(join(dir, "s10.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((r) => r.event === "request");
    expect(row).toMatchObject({ after_drain: true });
    expect(row.added_usd).toBeCloseTo(session.spentUsd - bound, 9);
  });
  test("a stream whose message_delta carries no output count is charged at its bound", async () => {
    mode = "delta-empty";
    const { token, session } = proxy.register("s11", "claude-haiku-5-5", 1, 1, join(dir, "s11.jsonl"));
    expect(await call(token, haiku)).toBe(200);
    mode = "ok";
    expect(session.spentUsd).toBeCloseTo(bound, 9);
  });
  test("a parked request whose client left never goes upstream", async () => {
    mode = "slow";
    hits = 0;
    const { token, session } = proxy.register("s9", "claude-haiku-5-5", 1, 1, join(dir, "s9.jsonl"));
    const first = call(token, haiku);
    await Bun.sleep(50);
    const ac = new AbortController();
    const second = fetch(`${proxy.url}/v1/messages`, { method: "POST", headers: { "x-api-key": token }, body: JSON.stringify(haiku), signal: ac.signal }).catch(() => 0);
    await Bun.sleep(50);
    ac.abort();
    await first;
    await second;
    await session.tail;
    mode = "ok";
    expect(hits).toBe(1);
    expect(session.refusals).toEqual([{ reason: "closed", detail: "client gone" }]);
  });
  test("admission refuses what the bound cannot price and forwards the parsed body", async () => {
    const { token, session } = proxy.register("s8", "claude-haiku-5-5", 1, 1, join(dir, "s8.jsonl"));
    hits = 0;
    expect(await call(token, { ...haiku, max_tokens: -5 })).toBe(400);
    expect(await call(token, { ...haiku, max_tokens: 1.5 })).toBe(400);
    expect(await call(token, { ...haiku, mcp_servers: [{ type: "url", url: "https://x" }] })).toBe(400);
    expect(await call(token, { ...haiku, tools: [{ type: "web_fetch_20250910", name: "web_fetch" }] })).toBe(400);
    expect(await call(token, { ...haiku, messages: [{ role: "user", content: [{ type: "document", source: { type: "url", url: "https://x/a.pdf" } }] }] })).toBe(400);
    expect(await call(token, { ...haiku, messages: [{ role: "user", content: [{ type: "image", source: { type: "file", file_id: "f1" } }] }] })).toBe(400);
    expect(hits).toBe(0);
    expect(session.refusals.map((r) => r.reason)).toEqual(["max_tokens", "max_tokens", "unbounded", "unbounded", "unbounded", "unbounded"]);
    expect(await call(token, { ...haiku, tools: [{ name: "Bash", input_schema: {} }, { type: "web_search_20250305", name: "web_search", max_uses: 200 }] })).toBe(200);
    expect(JSON.parse(lastBody).tools[1].max_uses).toBe(5);
    const dup = '{"model":"claude-opus-5-5","max_tokens":64000,"messages":[],"model":"claude-haiku-5-5","max_tokens":10}';
    expect(await fetch(`${proxy.url}/v1/messages`, { method: "POST", headers: { "x-api-key": token }, body: dup }).then((r) => r.status)).toBe(200);
    expect(lastBody).toBe('{"model":"claude-haiku-5-5","max_tokens":10,"messages":[]}');
  });
});
