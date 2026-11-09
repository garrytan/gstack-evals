// Copyright (c) 2026 Garry Tan. MIT License.
// Decision-routing proxy changes (B3): the DR_ALLOWANCE_STOP refusal behind allowanceCode, the TypeSafe System One route
// and price rows, per-call usage and latency on outcome lines, and particle-1's provider pin.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatPrice, priceRequest, PriceError, REQUEST_OVERHEAD_TOKENS, reservationMicros, usageCost } from "../../src/runner/pricing/prices.ts";
import { MeteringProxy, problem, routable, type BindRequest, type ProxyOptions } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const KEYS = { ANTHROPIC_API_KEY: "sk-ant-dr-0123456789", OPENAI_API_KEY: "sk-openai-dr-0123456789", OPENROUTER_API_KEY: "sk-or-dr-0123456789", TYPESAFE_API_KEY: "ts-dr-key-0123456789" };
const cell: Omit<CellAttempt, "meter_id"> = { run_id: "dr", arm: "R", task: "t1", model: "opus", trial: 1, attempt: 1 };

class Ledger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: `res_${this.reservations.size + 1}`, ...r, state: "reserved", spent_micros: null, usage: null };
    this.reservations.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.reservations.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

function setup(upstream: (url: string, init: RequestInit) => Response, overrides: Partial<ProxyOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dr-proxy-"));
  const ledger = new Ledger();
  const calls: Array<{ url: string; headers: Headers; raw: string }> = [];
  const proxy = new MeteringProxy({
    ledger,
    leaseId: "dr-pilot-rp.0001.abcdef",
    host: "127.0.0.1",
    managementSocket: join(dir, "m.sock"),
    managementToken: "management-token-0123456789",
    journal: join(dir, "journal.ndjson"),
    retry: { attempts: 3, elapsed_ms: 60_000 },
    env: KEYS,
    maxOutputTokens: 32_000,
    sleep: async () => {},
    fetch: async (url, init) => {
      calls.push({ url, headers: new Headers(init.headers), raw: String(init.body ?? "") });
      return upstream(url, init);
    },
    ...overrides,
  });
  proxy.start();
  cleanup.push(() => {
    proxy.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const bind = (r: Partial<BindRequest> = {}) => proxy.bind({ cell, models: ["anthropic:claude-opus-5-5", "openrouter:particle-ai/particle-1", "typesafe:jev-1.13.0"], allowance_micros: 5_000_000, ...r });
  const post = (slot: string, token: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${proxy.port}/${slot}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers }, body: typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body) });
  const journal = () => readFileSync(join(dir, "journal.ndjson"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  return { proxy, ledger, calls, bind, post, journal };
}

const opus = (maxTokens = 1000) => ({ model: "claude-opus-5-5", max_tokens: maxTokens, messages: [{ role: "user", content: "hi" }] });
const anthropicOk = () => Response.json({ id: "msg", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 3000, cache_creation_input_tokens: 50 } });
const systemOne = { model: "jev-1.13.0", state: "the agent ran pytest and 3 tests failed", questions: { tests_passed: { type: "noul", instructions: "Did the tests pass?" }, next_step: { type: "choice", criteria: { run_tests: "run", submit: "submit" } } } };
const OPUS_SPEND = Math.ceil(100 * 4 + 3000 * 0.2 + 50 * 5 + 20 * 20);

describe("allowance refusal (allowanceCode)", () => {
  test("a call that fits is forwarded and billed, with usage and latency on its outcome line", async () => {
    const t = setup(anthropicOk, { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = t.bind();
    const res = await t.post(b.slot, b.token, "/anthropic/v1/messages", opus());
    expect(res.status).toBe(200);
    expect(t.calls).toHaveLength(1);
    const outcome = t.journal().find(l => l.kind === "outcome");
    expect(outcome.outcome.usage).toEqual({ input: 100, output: 20, reasoning: 0, cache_read: 3000, cache_write: 50 });
    expect(outcome.outcome.spent_micros).toBe(OPUS_SPEND);
    expect(typeof outcome.latency_ms).toBe("number");
    expect(outcome.latency_ms).toBeGreaterThanOrEqual(0);
  });

  test("a call that does not fit is refused with DR_ALLOWANCE_STOP: 403, journaled, nothing forwarded, nothing reserved", async () => {
    const t = setup(anthropicOk, { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = t.bind({ allowance_micros: 1_000 });
    const res = await t.post(b.slot, b.token, "/anthropic/v1/messages", opus());
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const text = await res.text();
    expect(text.slice(0, 200)).toContain("DR_ALLOWANCE_STOP");
    const body = JSON.parse(text);
    expect(body).toMatchObject({ title: "DR_ALLOWANCE_STOP", status: 403, code: "DR_ALLOWANCE_STOP" });
    expect(body.type).toEndWith("docs/errors.md#dr_allowance_stop");
    expect(body.detail).toStartWith("DR_ALLOWANCE_STOP: ");
    expect(body.error).toEqual({ type: "allowance_stop", code: "DR_ALLOWANCE_STOP", message: body.detail });
    expect(t.calls).toHaveLength(0);
    expect(t.ledger.reservations.size).toBe(0);
    const lines = t.journal();
    expect(lines.filter(l => l.kind === "reserve")).toHaveLength(0);
    expect(lines).toEqual([expect.objectContaining({ kind: "refusal", code: "DR_ALLOWANCE_STOP", meter_id: b.meter_id, provider: "anthropic", model: "claude-opus-5-5" })]);
    expect(await t.proxy.finalize(b.meter_id)).toMatchObject({ refused: 1, micros: 0, requests: 0 });
  });

  test("spend before the stop is kept and the stop comes once the allowance cannot hold the next call", async () => {
    const t = setup(anthropicOk, { allowanceCode: "DR_ALLOWANCE_STOP" });
    const first = reservationMicros(priceRequest("anthropic", { ...opus(), inference_geo: "global" }, 1000));
    const b = t.bind({ allowance_micros: first + 10 });
    expect((await t.post(b.slot, b.token, "/anthropic/v1/messages", opus())).status).toBe(200);
    const second = await t.post(b.slot, b.token, "/anthropic/v1/messages", opus(30_000));
    expect(second.status).toBe(403);
    expect(((await second.json()) as any).code).toBe("DR_ALLOWANCE_STOP");
    expect(t.calls).toHaveLength(1);
    const meter = await t.proxy.finalize(b.meter_id);
    expect(meter.micros).toBe(OPUS_SPEND);
    expect(meter.refused).toBe(1);
  });

  test("the default keeps today's 402 E_ALLOWANCE body byte for byte", async () => {
    const t = setup(anthropicOk);
    const b = t.bind({ allowance_micros: 1_000 });
    const res = await t.post(b.slot, b.token, "/anthropic/v1/messages", opus());
    expect(res.status).toBe(402);
    const text = await res.text();
    const detail = JSON.parse(text).detail as string;
    expect(text).toBe(await problem("E_ALLOWANCE", 402, detail.replace(/^E_ALLOWANCE: metering proxy: /, "")).text());
    expect(JSON.parse(text).error).toBeUndefined();
    expect(t.journal()).toEqual([expect.objectContaining({ kind: "refusal", code: "E_ALLOWANCE" })]);
  });

  test("other refusals keep their own codes under the DR flag", async () => {
    const t = setup(anthropicOk, { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = t.bind({ models: ["typesafe:jev-latest", "anthropic:claude-opus-5-5"] });
    const unpriced = await t.post(b.slot, b.token, "/typesafe/v1/systemone", { ...systemOne, model: "jev-latest" });
    expect(unpriced.status).toBe(402);
    expect(((await unpriced.json()) as any).code).toBe("E_ALLOWANCE");
    const offList = await t.post(b.slot, b.token, "/typesafe/v1/systemone", systemOne);
    expect(offList.status).toBe(403);
    expect(((await offList.json()) as any).code).toBe("E_ALLOWANCE");
    const overCap = await t.post(b.slot, b.token, "/anthropic/v1/messages", opus(40_000));
    expect(overCap.status).toBe(400);
    expect(t.calls).toHaveLength(0);
  });
});

describe("TypeSafe System One route", () => {
  const tsOk = () => Response.json({ model: "jev-1.13.0", answers: { tests_passed: { type: "noul", noul: 0.1 } }, usage: { input_tokens: 1000, output_tokens: 50 } });

  test("price rows: input only, output free, both pinned Jev versions, nothing else", () => {
    expect(chatPrice("typesafe:jev-1.13.0")).toEqual({ input: 0.042, output: 0 });
    expect(chatPrice("typesafe:jev-1.14.0")).toEqual({ input: 0.042, output: 0 });
    expect(chatPrice("typesafe:jev-latest")).toBeUndefined();
    expect(routable("typesafe", "jev-1.13.0")).toBe(true);
    expect(routable("typesafe", "jev-latest")).toBe(false);
  });

  test("the reservation bounds every question reading the whole request at one token per byte", () => {
    const price = priceRequest("typesafe", systemOne, 32_000, "/v1/systemone");
    const bytes = Buffer.byteLength(JSON.stringify(systemOne));
    expect(price.inputTokens).toBe((bytes + REQUEST_OVERHEAD_TOKENS) * 2);
    expect(reservationMicros(price)).toBe(Math.ceil((bytes + REQUEST_OVERHEAD_TOKENS) * 2 * 0.042));
    expect(usageCost(price, { input_tokens: 1000, output_tokens: 50 })).toEqual({ micros: 42, usage: { input: 1000, output: 50, reasoning: 0, cache_read: 0, cache_write: 0 } });
    expect(() => priceRequest("typesafe", { model: "jev-1.13.0", state: "s", questions: {} }, 0)).toThrow(PriceError);
    expect(() => priceRequest("typesafe", { model: "jev-1.13.0", state: "s" }, 0)).toThrow(PriceError);
  });

  test("a System One call is forwarded with the proxy's TypeSafe key, billed on input only, output tokens journaled", async () => {
    const t = setup(tsOk, { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = t.bind();
    const res = await t.post(b.slot, b.token, "/typesafe/v1/systemone", systemOne);
    expect(res.status).toBe(200);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(t.calls[0]!.headers.get("authorization")).toBe(`Bearer ${KEYS.TYPESAFE_API_KEY}`);
    expect(JSON.parse(t.calls[0]!.raw)).toEqual(systemOne);
    const lines = t.journal();
    const reserve = lines.find(l => l.kind === "reserve");
    expect(reserve.max_micros).toBe(Math.ceil((Buffer.byteLength(JSON.stringify(systemOne)) + REQUEST_OVERHEAD_TOKENS) * 2 * 0.042));
    const outcome = lines.find(l => l.kind === "outcome");
    expect(outcome.outcome).toEqual({ kind: "spent", spent_micros: 42, usage: { input: 1000, output: 50, reasoning: 0, cache_read: 0, cache_write: 0 } });
    expect(JSON.stringify(lines)).not.toContain(KEYS.TYPESAFE_API_KEY);
    expect(JSON.stringify(lines)).not.toContain(b.token);
  });

  test("the SDK's zstd request body is decoded, scanned and forwarded as plain JSON", async () => {
    const t = setup(tsOk, { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = t.bind();
    const res = await t.post(b.slot, b.token, "/typesafe/v1/systemone", Bun.zstdCompressSync(Buffer.from(JSON.stringify(systemOne))), { "content-encoding": "zstd" });
    expect(res.status).toBe(200);
    expect(JSON.parse(t.calls[0]!.raw)).toEqual(systemOne);
    expect(t.calls[0]!.headers.get("content-encoding")).toBeNull();
  });

  test("a zstd body carrying a forbidden marker is refused after decoding", async () => {
    const t = setup(tsOk, { allowanceCode: "DR_ALLOWANCE_STOP", forbiddenMarkers: ["CANARY-7731"] });
    const b = t.bind();
    const res = await t.post(b.slot, b.token, "/typesafe/v1/systemone", Bun.zstdCompressSync(Buffer.from(JSON.stringify({ ...systemOne, state: "leak CANARY-7731" }))), { "content-encoding": "zstd" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("E_TRIPWIRE");
    expect(t.calls).toHaveLength(0);
  });

  test("a System One call over the allowance stops with DR_ALLOWANCE_STOP and is not sent", async () => {
    const t = setup(tsOk, { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = t.bind({ allowance_micros: 1 });
    const res = await t.post(b.slot, b.token, "/typesafe/v1/systemone", systemOne);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.type).toBe("allowance_stop");
    expect(t.calls).toHaveLength(0);
  });
});

describe("particle-1 pin", () => {
  test("the upstream body routes to Particle AI only, with fallbacks off, whatever the client asked", async () => {
    const t = setup(() => Response.json({ id: "gen", usage: { prompt_tokens: 100, completion_tokens: 10 } }), { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = t.bind();
    const res = await t.post(b.slot, b.token, "/openrouter/v1/chat/completions", { model: "particle-ai/particle-1", max_tokens: 8000, provider: { order: ["someone-else"], allow_fallbacks: true }, messages: [{ role: "user", content: "pick" }] });
    expect(res.status).toBe(200);
    expect(t.calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const sent = JSON.parse(t.calls[0]!.raw);
    expect(sent.provider).toMatchObject({ only: ["particle-ai"], allow_fallbacks: false, data_collection: "deny" });
    expect(sent.provider.order).toBeUndefined();
    expect(sent.max_tokens).toBe(8000);
  });
});
