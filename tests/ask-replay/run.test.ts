import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { plainStore } from "../../lanes/ask-replay/custody.ts";
import { answerBody, FIXTURE_GSTACK, Killed, stubSend } from "../../lanes/ask-replay/fixtures.ts";
import { FROZEN } from "../../lanes/ask-replay/frozen.ts";
import { buildPrompt } from "../../lanes/ask-replay/prompt.ts";
import { finalRecords, ledgerClient, openProxyMeter, requestBody, runShard, sampleId, schedule, UPSTREAM_DRAW, upstreamRedraw, type ShardOptions } from "../../lanes/ask-replay/run.ts";
import { generate } from "../../lanes/ask-replay/synthetic/generator.ts";

const items = generate().items;
const byId = new Map(items.map((i) => [i.item, i]));
const quote = [{ words: "test ledger, not an approval", by: "tests", source: "tests" }];

function setup(cap = 50_000_000) {
  const dir = mkdtempSync(join(tmpdir(), "ask-run-"));
  const record = join(dir, "record");
  recordApproval(record, { action: "init", item: "ask-test", cap_micros: cap, quotes: quote, admission: "warn" });
  const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite"), {}));
  const leaseId = openLease(record, local, { item: "ask-test", run_id: "ask-test" }).lease_id;
  return { dir, record, local, leaseId, done: () => (settleLease(record, local, leaseId), local.close(), rmSync(dir, { recursive: true, force: true })) };
}

const shard = (s: ReturnType<typeof setup>, send: ReturnType<typeof stubSend>, samples = schedule(items.slice(0, 3), "opus", 2, 9)): ShardOptions => ({ items: byId, samples, gstack: FIXTURE_GSTACK, client: ledgerClient({ local: s.local, leaseId: s.leaseId, runId: "ask-test", maxOutputTokens: 4000, send }), store: plainStore(join(s.dir, "replies")), out: join(s.dir, "out"), maxOutputTokens: 4000, sleep: async () => {}, concurrency: 2 });

describe("the schedule", () => {
  test("fixed sample ids, every arm and replicate once, arms interleaved in a seeded order within each item", () => {
    const a = schedule(items.slice(0, 5), "sol", 2, 42);
    expect(a).toEqual(schedule(items.slice(0, 5), "sol", 2, 42));
    expect(a).not.toEqual(schedule(items.slice(0, 5), "sol", 2, 43));
    expect(a).toHaveLength(5 * 4 * 2);
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
    expect(a[0]!.id).toBe(sampleId(a[0]!.item, a[0]!.arm, "sol", a[0]!.replicate));
    for (let i = 0; i < a.length; i += 8) expect(new Set(a.slice(i, i + 8).map((s) => s.item)).size).toBe(1);
    expect(schedule(items.slice(0, 2), "particle", 2, 1).some((s) => s.arm === "d")).toBe(false);
  });
});

describe("request bodies", () => {
  const p = buildPrompt(items[10]!, "c", FIXTURE_GSTACK);
  test("Anthropic: cached system prefix, medium effort, JSON schema", () => {
    const b = requestBody("opus", p, "c", 4000) as any;
    expect(b.model).toBe("claude-opus-5-5");
    expect(b.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(b.output_config.effort).toBe("medium");
    expect(b.output_config.format.schema.required).toContain("repeats");
    expect(b.temperature).toBeUndefined();
  });
  test("OpenAI Responses: unstored, medium reasoning, strict JSON schema", () => {
    const b = requestBody("sol", p, "c", 4000) as any;
    expect(b).toMatchObject({ model: "gpt-6.1-sol", store: false, max_output_tokens: 4000, reasoning: { effort: "medium" } });
    expect(b.text.format).toMatchObject({ type: "json_schema", strict: true });
  });
  test("OpenRouter particle-1: chat with no schema mode (frozen), medium reasoning", () => {
    const b = requestBody("particle", p, "c", 4000) as any;
    expect(b).toMatchObject({ model: "particle-ai/particle-1", max_tokens: 4000, reasoning: { effort: "medium" } });
    expect(b.response_format).toBeUndefined();
    expect(b.messages[0].role).toBe("system");
  });
});

describe("shards", () => {
  test("every sample sealed once with its spend settled under its own key", async () => {
    const s = setup();
    try {
      const calls: string[] = [];
      const o = shard(s, stubSend(() => ({ action: "SEND", repeats: "new" }), calls));
      const r = await runShard(o);
      expect(r).toMatchObject({ ran: 24, skipped: 0, stopped: null });
      expect(s.local.meters(s.leaseId).size).toBe(24);
      const again = await runShard(o);
      expect(again).toMatchObject({ ran: 0, skipped: 24 });
      expect(calls).toHaveLength(24);
    } finally {
      s.done();
    }
  });
  test("a killed shard resumes: sealed samples skipped, the open call settled unknown, one redraw, nothing counted twice", async () => {
    const s = setup();
    try {
      const calls: string[] = [];
      let n = 0;
      const o = { ...shard(s, stubSend(() => (++n === 7 ? { raw: "kill" } : { action: "DROP" }), calls)), concurrency: 1 };
      await expect(runShard(o)).rejects.toBeInstanceOf(Killed);
      const warned: string[] = [];
      const r = await runShard({ ...o, warn: (c) => warned.push(c) });
      expect(r.skipped).toBe(6);
      expect(Object.values(r.redrawn).reduce((a, b) => a! + b!, 0)).toBe(1);
      expect(warned).toContain("E_ASK_RESUME");
      const meters = [...s.local.meters(s.leaseId).entries()];
      expect(meters).toHaveLength(calls.length);
      expect(new Set(calls).size).toBe(calls.length);
      expect(meters.filter(([, m]) => m.unknown_calls === 1).map(([k]) => k)).toEqual([calls[6]!]);
      const recs = o.store as ReturnType<typeof plainStore>;
      const redrawn = [...recs.read().values()].filter((x) => x.draw === 2);
      expect(redrawn).toHaveLength(1);
    } finally {
      s.done();
    }
  });
  test("the time stop leaves samples for the next shard", async () => {
    const s = setup();
    try {
      let t = 0;
      const o = { ...shard(s, stubSend(() => ({ action: "SEND" }))), concurrency: 1, now: () => (t += 60_000), stopAfterMs: 5 * 60_000 };
      const r = await runShard(o);
      expect(r.stopped).toBe("time");
      expect(r.ran + r.left).toBe(24);
      expect(r.ran).toBeGreaterThan(0);
    } finally {
      s.done();
    }
  });
  test("a cap stop ends the shard as incomplete", async () => {
    const s = setup(1000);
    try {
      const r = await runShard({ ...shard(s, stubSend(() => ({ action: "SEND" }))), concurrency: 1 });
      expect(r).toMatchObject({ stopped: "cap", ran: 0 });
    } finally {
      s.done();
    }
  });
  test("retries: upstream three times then UPSTREAM; the end-of-run pass redraws it under its own draw", async () => {
    const s = setup();
    try {
      let pass = 1;
      const samples = schedule(items.slice(0, 1), "opus", 1, 2);
      const o = shard(s, stubSend((smp) => (smp.arm === "a" && pass === 1 ? { raw: "upstream" } : smp.arm === "b" ? { raw: "none" } : { action: "FOLD" })), samples);
      await runShard(o);
      pass = 2;
      const r = await upstreamRedraw(o);
      expect(r.redrawn).toBe(2);
      const recs = (o.store as ReturnType<typeof plainStore>).read();
      const a = samples.find((x) => x.arm === "a")!;
      expect(recs.get(a.id)).toMatchObject({ missing: "upstream", attempts: 4 });
      expect(recs.get(a.id + "~u")).toMatchObject({ final_action: "FOLD", draw: UPSTREAM_DRAW, upstream_redraw: true });
      expect(finalRecords(recs).find((x) => x.sample.id === a.id)!.final_action).toBe("FOLD");
      expect(r.still_upstream).toBe(1);
    } finally {
      s.done();
    }
  });
});

describe("the real client through the metering proxy, with a stub upstream", () => {
  test("one lease per shard: the proxy meters the call against it, the reply parses, and close settles the lease", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-proxy-"));
    try {
      const record = join(dir, "record");
      const ledger = join(dir, "ledger.sqlite");
      recordApproval(record, { action: "init", item: "ask-proxy", cap_micros: 5_000_000, quotes: quote, admission: "warn" });
      const seen: string[] = [];
      const fetchStub = (async (url: string | URL | Request) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ ...answerBody("opus", '{"action":"FOLD","reason":"r"}'), id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5" }), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;
      const meter = await openProxyMeter({ item: "ask-proxy", runId: "ask-proxy", out: join(dir, "out"), model: "opus", maxOutputTokens: 4000, record, ledger, env: { ANTHROPIC_API_KEY: "test-key-not-real" }, fetch: fetchStub });
      const samples = schedule(items.slice(0, 1), "opus", 1, 5).slice(0, 2);
      const r = await runShard({ items: byId, samples, gstack: FIXTURE_GSTACK, client: meter.client, store: plainStore(join(dir, "replies")), out: join(dir, "out"), maxOutputTokens: 4000, sleep: async () => {}, concurrency: 1 });
      const spend = await meter.close();
      expect(r.ran).toBe(2);
      expect(seen.every((u) => u.startsWith("https://api.anthropic.com/v1/messages"))).toBe(true);
      expect(spend.spent_micros).toBeGreaterThan(0);
      expect(meter.routing).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("particle-1's route sends data_collection deny", async () => {
    const { chatPrice, openRouterRouting } = await import("../../src/runner/pricing/prices.ts");
    expect(openRouterRouting(chatPrice(FROZEN.models.particle.price_row)!)).toMatchObject({ data_collection: "deny", only: ["particle-ai"], allow_fallbacks: false });
  });
});
