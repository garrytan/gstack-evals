import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODELS } from "../src/config.ts";
import { MeteringProxy, requestCeilingUsd } from "../src/proxy.ts";

const dir = mkdtempSync(join(tmpdir(), "proxy-"));
let mode: "ok" | "drop" = "ok";
let inflight = 0;
let maxInflight = 0;
const sse = (events: any[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const start = { type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
const upstream = Bun.serve({
  port: 0,
  async fetch() {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    await Bun.sleep(30);
    inflight--;
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
    return new Response(sse([start, { type: "message_delta", usage: { output_tokens: 1000 } }, { type: "message_stop" }]), { headers: { "content-type": "text/event-stream" } });
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
});
