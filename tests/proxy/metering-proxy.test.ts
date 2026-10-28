import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { priceRequest, reservationMicros, usageCost } from "../../src/runner/pricing/prices.ts";
import { isTrialNetworkHost, MeteringProxy, ProxyControl, reconcileJournal, scrubbedCause, type BindRequest, type ProxyOptions } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const KEY = "sk-ant-real-key-0123456789";
const OPENAI_KEY = "sk-openai-real-key-0123456789";
const MANAGEMENT = "management-token-0123456789abcdef";
const cell: Omit<CellAttempt, "meter_id"> = { run_id: "r1", arm: "gstack", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 };

class FakeLedger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  settles: Array<[string, CallOutcome]> = [];
  failSettles = 0;
  constructor(public capMicros = 100_000_000) {}
  committed() {
    return [...this.reservations.values()].reduce((n, r) => n + (r.state === "settled" ? r.spent_micros! : r.max_micros), 0);
  }
  async reserve(request: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    if (this.committed() + request.max_micros > this.capMicros) return { ok: false, code: "CAP_STOP", message: "the lease is spent" };
    const reservation: Reservation = { reservation_id: `res_${this.reservations.size + 1}`, idempotency_key: request.idempotency_key, lease_id: request.lease_id, cell: request.cell, max_micros: request.max_micros, state: "reserved", spent_micros: null, usage: null };
    this.reservations.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    if (this.failSettles > 0) {
      this.failSettles--;
      throw new Error("lost acknowledgement");
    }
    this.settles.push([id, outcome]);
    const r: Reservation = this.reservations.get(id) ?? { reservation_id: id, idempotency_key: id, lease_id: "l1", cell: { ...cell, meter_id: "m" }, max_micros: 0, state: "reserved", spent_micros: null, usage: null };
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    this.reservations.set(id, r);
    return { ok: true, reservation: r };
  }
}

type Upstream = (url: string, init: RequestInit) => Response | Promise<Response>;
const ok = (usage: Record<string, unknown>) => Response.json({ id: "msg", usage });
const sse = (events: unknown[]) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

let proxies: MeteringProxy[] = [];
let dirs: string[] = [];
afterEach(() => {
  for (const p of proxies) p.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  proxies = [];
  dirs = [];
});

function setup(upstream: Upstream, overrides: Partial<ProxyOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "u3-proxy-"));
  dirs.push(dir);
  const ledger = (overrides.ledger as FakeLedger | undefined) ?? new FakeLedger();
  const calls: Array<{ url: string; headers: Headers; body: any }> = [];
  const sleeps: number[] = [];
  const proxy = new MeteringProxy({
    ledger,
    leaseId: "l1",
    host: "127.0.0.1",
    managementSocket: join(dir, "management.sock"),
    managementToken: MANAGEMENT,
    journal: join(dir, "journal.ndjson"),
    retry: { attempts: 3, elapsed_ms: 60_000 },
    env: { ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: OPENAI_KEY },
    sleep: async ms => void sleeps.push(ms),
    fetch: async (url, init) => {
      calls.push({ url, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined });
      return upstream(url, init);
    },
    ...overrides,
  });
  proxy.start();
  proxies.push(proxy);
  const bind = (request: Partial<BindRequest> = {}) => proxy.bind({ cell, models: ["anthropic:claude-opus-5-5", "openai:gpt-6.1-sol"], allowance_micros: 5_000_000, ...request });
  const call = (slot: string, credential: string | null, path = "/anthropic/v1/messages", body: unknown = { model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "hi" }] }) =>
    fetch(`http://127.0.0.1:${proxy.port}/${slot}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(credential ? { "x-api-key": credential } : {}) }, body: JSON.stringify(body) });
  const journal = () => readFileSync(join(dir, "journal.ndjson"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  return { proxy, ledger, calls, sleeps, bind, call, journal, dir };
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  const body = (await res.json()) as { code: string; detail: string; type: string };
  expect(body.code).toBe(code);
  expect(body.detail).toStartWith(`${code}: `);
  expect(body.type).toEndWith(`docs/errors.md#${code.toLowerCase()}`);
  return body;
}

describe("slot authentication", () => {
  test("only the slot's own bearer is forwarded; others are refused before the provider", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    const b = t.bind();
    await expectProblem(await t.call(a.slot, null), 403, "E_SLOT_DENIED");
    await expectProblem(await t.call(a.slot, "wrong"), 403, "E_SLOT_DENIED");
    await expectProblem(await t.call(a.slot, b.token), 403, "E_SLOT_DENIED");
    await expectProblem(await t.call("s_unknown", a.token), 403, "E_SLOT_DENIED");
    expect(t.calls).toHaveLength(0);
    const res = await fetch(`http://127.0.0.1:${t.proxy.port}/${a.slot}/anthropic/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${a.token}` }, body: JSON.stringify({ model: "claude-opus-5-5", messages: [] }) });
    expect(res.status).toBe(200);
    expect(t.calls[0]!.headers.get("x-api-key")).toBe(KEY);
    expect(t.calls[0]!.headers.get("authorization")).toBeNull();
  });

  test("a receipt's meter id cannot authorize a request", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    await expectProblem(await t.call(a.slot, a.meter_id), 403, "E_SLOT_DENIED");
    const res = await fetch(`http://127.0.0.1:${t.proxy.port}/${a.meter_id}/anthropic/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${a.meter_id}` }, body: "{}" });
    await expectProblem(res, 403, "E_SLOT_DENIED");
    expect(t.calls).toHaveLength(0);
  });

  test("unbind revokes the bearer", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    t.proxy.unbind(a.slot);
    await expectProblem(await t.call(a.slot, a.token), 403, "E_SLOT_DENIED");
    expect(t.calls).toHaveLength(1);
  });
});

describe("management socket", () => {
  test("bind, unbind and finalize need the management credential; a trial bearer is refused there", async () => {
    const t = setup(() => ok({ input_tokens: 1000, output_tokens: 100 }));
    const socket = join(t.dir, "management.sock");
    const control = new ProxyControl(socket, MANAGEMENT);
    const a = await control.bind({ cell, models: ["anthropic:claude-opus-5-5"], allowance_micros: 1_000_000 });
    expect(a.token).toStartWith("gse_");
    for (const headers of [{}, { "x-gstack-evals-management": a.token }, { authorization: `Bearer ${a.token}` }, { "x-api-key": a.token }] as Record<string, string>[]) {
      const res = await fetch("http://localhost/bind", { unix: socket, method: "POST", headers, body: JSON.stringify({ cell, models: ["anthropic:claude-opus-5-5"], allowance_micros: 1_000_000 }) });
      await expectProblem(res, 403, "E_SLOT_DENIED");
    }
    await expect(new ProxyControl(socket, a.token).finalize(a.meter_id)).rejects.toThrow(/^E_SLOT_DENIED: /);
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    await control.unbind(a.slot);
    const meter = await control.finalize(a.meter_id);
    expect(meter.requests).toBe(1);
    expect(meter.micros).toBe(1000 * 4 + 100 * 20);
  });

  test("the trial listener serves no management route, and binds only to the trial network", async () => {
    const t = setup(() => ok({}));
    for (const path of ["/bind", "/finalize", "/__proxy/bind"]) {
      const res = await fetch(`http://127.0.0.1:${t.proxy.port}${path}`, { method: "POST", headers: { "x-gstack-evals-management": MANAGEMENT }, body: JSON.stringify({ cell, models: ["anthropic:claude-opus-5-5"], allowance_micros: 1_000_000 }) });
      await expectProblem(res, 403, "E_SLOT_DENIED");
    }
    for (const host of ["0.0.0.0", "::", "[::]", "", "*", "localhost", "203.0.113.7", "0", "172.32.0.1", "2001:db8::1", "fc::1", "fd::"]) expect(isTrialNetworkHost(host)).toBe(false);
    for (const host of ["127.0.0.1", "10.1.2.3", "172.17.0.1", "192.168.1.5", "::1", "[fd00::1]"]) expect(isTrialNetworkHost(host)).toBe(true);
    expect(() => new MeteringProxy({ ...({} as ProxyOptions), host: "0.0.0.0" })).toThrow(/^E_USAGE: /);
  });
});

describe("allowlist and allowance", () => {
  test("a model off the slot's allowlist and an unpriced model are refused before the provider", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind({ models: ["anthropic:claude-opus-5-5", "anthropic:claude-unpriced-9"] });
    await expectProblem(await t.call(a.slot, a.token, undefined, { model: "claude-sonnet-5-5", messages: [] }), 403, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, undefined, { model: "claude-unpriced-9", messages: [] }), 402, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, "/anthropic/v1/complete", { model: "claude-opus-5-5" }), 403, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", max_tokens: 10_000_000, messages: [] }), 400, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(0);
  });

  test("the allowance stops the slot once it cannot hold the next call's worst case", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 1000 }));
    // Worst case of one call: about 150 input tokens and 1000 output tokens at $4 and $20 per million, about $0.0206.
    const a = t.bind({ allowance_micros: 30_000 });
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    const body = await expectProblem(await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "x".repeat(3000) }] }), 402, "E_ALLOWANCE");
    expect(body.detail).toContain("allowance");
    expect(t.calls).toHaveLength(1);
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter.refused).toBe(1);
  });

  test("a ledger refusal is passed on with the ledger's code", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), { ledger: new FakeLedger(1000) });
    const a = t.bind();
    await expectProblem(await t.call(a.slot, a.token), 402, "CAP_STOP");
    expect(t.calls).toHaveLength(0);
  });

  test("a body carrying a forbidden marker is refused without printing the marker", async () => {
    const t = setup(() => ok({}), { forbiddenMarkers: ["HIDDEN-FACT-42"] });
    const a = t.bind();
    const body = await expectProblem(await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", messages: [{ role: "user", content: "HIDDEN-FACT-42" }] }), 403, "E_TRIPWIRE");
    expect(body.detail).not.toContain("HIDDEN-FACT-42");
    const escaped = '{"model":"claude-opus-5-5","messages":[{"role":"user","content":"\\u0048IDDEN-FACT-42"}]}';
    const res = await fetch(`http://127.0.0.1:${t.proxy.port}/${a.slot}/anthropic/v1/messages`, { method: "POST", headers: { "x-api-key": a.token }, body: escaped });
    await expectProblem(res, 403, "E_TRIPWIRE");
    expect(t.calls).toHaveLength(0);
  });

  test("concurrent calls on one slot cannot both claim an allowance that holds one", async () => {
    const t = setup(async () => {
      await Bun.sleep(30);
      return ok({ input_tokens: 10, output_tokens: 5 });
    });
    const a = t.bind({ allowance_micros: 30_000 });
    const statuses = (await Promise.all([t.call(a.slot, a.token), t.call(a.slot, a.token)])).map(r => r.status).sort();
    expect(statuses).toEqual([200, 402]);
    expect(t.calls).toHaveLength(1);
  });

  test("rate multipliers the reservation cannot see are refused", async () => {
    const t = setup(() => ok({}));
    const a = t.bind();
    await expectProblem(await t.call(a.slot, a.token, "/openai/v1/chat/completions", { model: "gpt-6.1-sol", n: 50, max_completion_tokens: 1000, messages: [] }), 402, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, "/openai/v1/responses", { model: "gpt-6.1-sol", service_tier: "priority", input: "hi" }), 402, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(0);
  });

  test("Anthropic one-hour cache writes are reserved and settled at twice input", () => {
    const body = (ttl: string) => ({ model: "claude-opus-5-5", max_tokens: 0, messages: [{ role: "user", content: [{ type: "text", text: "x".repeat(1000), cache_control: { type: "ephemeral", ttl } }] }] });
    const fiveMinute = priceRequest("anthropic", body("5m"), 0);
    const oneHour = priceRequest("anthropic", body("1h"), 0);
    expect(reservationMicros(fiveMinute)).toBe(fiveMinute.inputTokens * 5);
    expect(reservationMicros(oneHour)).toBe(oneHour.inputTokens * 8);
    const usage = { input_tokens: 10, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 }, output_tokens: 0 };
    expect(usageCost(oneHour, usage)!.micros).toBe(10 * 4 + 400 * 5 + 600 * 8);
  });

  test("inputs the provider bills beyond their bytes are refused", async () => {
    const t = setup(() => ok({}));
    const a = t.bind();
    const image = { model: "gpt-6.1-sol", input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/huge.png" }] }] };
    await expectProblem(await t.call(a.slot, a.token, "/openai/v1/responses", image), 402, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, "/openai/v1/responses", { model: "gpt-6.1-sol", input: "hi", tools: [{ type: "web_search" }] }), 402, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", messages: [{ role: "user", content: [{ type: "document", source: { type: "url", url: "https://example.com/a.pdf" } }] }] }), 402, "E_ALLOWANCE");
    const inline = { model: "gpt-6.1-sol", input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }] }] };
    expect((await t.call(a.slot, a.token, "/openai/v1/responses", inline)).status).toBe(200);
    expect(t.calls).toHaveLength(1);
  });
});

describe("streaming usage", () => {
  test("Anthropic Messages: message_start and the cumulative message_delta", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 1 } } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
      { type: "message_delta", usage: { output_tokens: 50 } },
      { type: "message_stop" },
    ];
    const t = setup(() => sse(events));
    const a = t.bind();
    const res = await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", stream: true, max_tokens: 1000, messages: [] });
    expect(await res.text()).toContain("hello");
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter.micros).toBe(100 * 4 + 2000 * 0.2 + 50 * 20);
    expect(t.ledger.settles[0]![1]).toEqual({ kind: "spent", spent_micros: meter.micros, usage: { input: 100, output: 50, reasoning: 0, cache_read: 2000, cache_write: 0 } });
  });

  test("OpenAI Responses: response.completed, with reasoning split from output", async () => {
    const events = [
      { type: "response.created", response: { id: "r" } },
      { type: "response.output_text.delta", delta: "hi" },
      { type: "response.completed", response: { usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 } } } },
    ];
    const t = setup(() => sse(events));
    const a = t.bind();
    const res = await t.call(a.slot, a.token, "/openai/v1/responses", { model: "gpt-6.1-sol", stream: true, input: "hi" });
    await res.text();
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter.micros).toBe(800 * 2 + 200 * 0.1 + 300 * 10);
    expect(t.ledger.settles[0]![1]).toMatchObject({ kind: "spent", usage: { input: 800, output: 200, reasoning: 100, cache_read: 200, cache_write: 0 } });
    expect(t.calls[0]!.headers.get("authorization")).toBe(`Bearer ${OPENAI_KEY}`);
    expect(t.calls[0]!.body.max_output_tokens).toBe(32_768);
  });

  test("an OpenAI chat stream gets include_usage forced on", async () => {
    const t = setup(() => sse([{ choices: [] }, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } }]));
    const a = t.bind();
    await (await t.call(a.slot, a.token, "/openai/v1/chat/completions", { model: "gpt-6.1-sol", stream: true, stream_options: { include_usage: false }, messages: [] })).text();
    expect(t.calls[0]!.body.stream_options).toEqual({ include_usage: true });
    expect((await t.proxy.finalize(a.meter_id)).micros).toBe(10 * 2 + 4 * 10);
  });

  test("a stream cut before its final usage event keeps its full reservation as unknown", async () => {
    const t = setup(() => sse([{ type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 1 } } }, { type: "content_block_delta", delta: { type: "text_delta", text: "partial" } }]));
    const a = t.bind();
    await (await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", stream: true, max_tokens: 1000, messages: [] })).text();
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter.unknown).toBe(1);
    expect(t.ledger.settles[0]![1]).toEqual({ kind: "unknown" });
    expect(meter.micros).toBe(t.ledger.reservations.get("res_1")!.max_micros);
  });
});

describe("retries", () => {
  test("5xx answers are retried up to the attempt budget, and every paid attempt is journaled and counted", async () => {
    const t = setup(() => new Response("{}", { status: 503 }));
    const a = t.bind({ allowance_micros: 1_000_000 });
    const body = await expectProblem(await t.call(a.slot, a.token), 502, "UPSTREAM");
    expect(body.detail).toContain("3 attempts");
    expect(t.calls).toHaveLength(3);
    const journal = t.journal();
    expect(journal.filter(l => l.kind === "request").map(l => l.try)).toEqual([1, 2, 3]);
    expect(journal.filter(l => l.kind === "outcome")).toHaveLength(3);
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter.requests).toBe(3);
    expect(meter.upstream.statuses["503"]).toBe(3);
  });

  test("a 429 pauses the provider for its retry-after and the call succeeds within budget", async () => {
    let n = 0;
    const t = setup(() => (n++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "2" } }) : ok({ input_tokens: 10, output_tokens: 5 })));
    const a = t.bind();
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    expect(t.calls).toHaveLength(2);
    expect(t.sleeps).toHaveLength(1);
    expect(t.sleeps[0]!).toBeGreaterThan(1500);
    expect(t.ledger.settles[0]![1]).toEqual({ kind: "spent", spent_micros: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 } });
  });

  test("no attempt starts past the elapsed-time budget", async () => {
    const t = setup(() => new Response("{}", { status: 429, headers: { "retry-after": "30" } }), { retry: { attempts: 5, elapsed_ms: 10_000 } });
    const a = t.bind();
    await expectProblem(await t.call(a.slot, a.token), 502, "UPSTREAM");
    expect(t.calls).toHaveLength(1);
    expect(t.sleeps).toHaveLength(0);
  });

  test("no attempt is sent once the elapsed-time budget has passed, even after a slow reservation", async () => {
    const ledger = new FakeLedger();
    const reserve = ledger.reserve.bind(ledger);
    ledger.reserve = async request => {
      if (ledger.reservations.size === 1) await Bun.sleep(80);
      return reserve(request);
    };
    const t = setup(() => new Response("{}", { status: 503, headers: { "retry-after-ms": "1" } }), { ledger, retry: { attempts: 3, elapsed_ms: 60 } });
    const a = t.bind();
    const body = await expectProblem(await t.call(a.slot, a.token), 502, "UPSTREAM");
    expect(body.detail).toContain("not sent");
    expect(t.calls).toHaveLength(1);
    expect(ledger.settles[1]).toEqual(["res_2", { kind: "spent", spent_micros: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 } }]);
  });

  test("a waiting call honours a pause that was extended while it slept", async () => {
    let t: ReturnType<typeof setup>;
    let extended = false;
    t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), {
      sleep: async ms => {
        t.sleeps.push(ms);
        if (extended) return;
        extended = true;
        (t.proxy as unknown as { pausedUntil: Record<string, number> }).pausedUntil.anthropic = Date.now() + 5000;
      },
    });
    (t.proxy as unknown as { pausedUntil: Record<string, number> }).pausedUntil.anthropic = Date.now() + 1000;
    const a = t.bind();
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    expect(t.sleeps).toHaveLength(2);
    expect(t.sleeps[1]!).toBeGreaterThan(4000);
  });

  test("a 401 stops at once with E_KEY_REJECTED", async () => {
    const t = setup(() => new Response("{}", { status: 401 }));
    const a = t.bind();
    await expectProblem(await t.call(a.slot, a.token), 502, "E_KEY_REJECTED");
    expect(t.calls).toHaveLength(1);
  });
});

describe("unknown sends and reconcile", () => {
  test("a lost send keeps its charge, is not resent, and its error carries no bearer or key", async () => {
    const t = setup(() => Promise.reject(new Error("socket hang up", { cause: new Error(`TLS reset while sending x-api-key=${KEY}`) })));
    const a = t.bind();
    const res = await fetch(`http://127.0.0.1:${t.proxy.port}/${a.slot}/anthropic/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${a.token}` }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 100, messages: [] }) });
    const body = await expectProblem(res, 502, "UPSTREAM");
    expect(body.detail).toContain("socket hang up: TLS reset");
    expect(t.calls).toHaveLength(1);
    expect(t.ledger.settles).toEqual([["res_1", { kind: "unknown" }]]);
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter.unknown).toBe(1);
    const channels = [JSON.stringify(body), readFileSync(join(t.dir, "journal.ndjson"), "utf8"), JSON.stringify(meter)];
    for (const text of channels) {
      expect(text).not.toContain(a.token);
      expect(text).not.toContain(KEY);
    }
    expect(t.journal().find(l => l.kind === "request").cell.meter_id).toBe(a.meter_id);
  });

  test("a response body lost after the headers keeps its charge as unknown and is not resent", async () => {
    const t = setup(() => new Response(new ReadableStream({ start: c => c.error(new Error(`reset carrying ${KEY}`)) }), { headers: { "content-type": "application/json" } }));
    const a = t.bind();
    const body = await expectProblem(await t.call(a.slot, a.token), 502, "UPSTREAM");
    expect(body.detail).not.toContain(KEY);
    expect(t.calls).toHaveLength(1);
    expect(t.ledger.settles).toEqual([["res_1", { kind: "unknown" }]]);
    expect((await t.proxy.finalize(a.meter_id)).unknown).toBe(1);
  });

  test("free routes are forwarded unreserved, and every request is journaled with its source address", async () => {
    const t = setup(() => Response.json({ input_tokens: 12 }));
    const a = t.bind();
    expect((await t.call(a.slot, a.token, "/anthropic/v1/messages/count_tokens", { model: "claude-opus-5-5", messages: [] })).status).toBe(200);
    await t.call(a.slot, "wrong");
    expect(t.calls).toHaveLength(1);
    expect(t.ledger.reservations.size).toBe(0);
    const journal = t.journal();
    expect(journal.map(l => l.kind)).toEqual(["free", "refusal"]);
    for (const line of journal) expect(line.source).toBe("127.0.0.1");
  });

  test("each attempt reserves under its own idempotency key", async () => {
    let n = 0;
    const t = setup(() => (n++ === 0 ? new Response("{}", { status: 503, headers: { "retry-after-ms": "1" } }) : ok({ input_tokens: 10, output_tokens: 5 })));
    const a = t.bind();
    await t.call(a.slot, a.token);
    await t.call(a.slot, a.token);
    expect([...t.ledger.reservations.values()].map(r => r.idempotency_key)).toEqual([`${a.meter_id}:1:1`, `${a.meter_id}:1:2`, `${a.meter_id}:2:1`]);
  });

  test("the journal holds the cell attempt and reservation id before the forward", async () => {
    let seen: any[] = [];
    const t = setup(() => {
      seen = t.journal();
      return ok({ input_tokens: 10, output_tokens: 5 });
    });
    const a = t.bind();
    await t.call(a.slot, a.token);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "request", reservation_id: "res_1", lease_id: "l1", cell: { ...cell, meter_id: a.meter_id }, try: 1, source: "127.0.0.1" });
  });

  test("reconcile settles a call with no outcome as unknown and resends nothing; a lost acknowledgement is settled again", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    t.ledger.failSettles = 1;
    const a = t.bind();
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    expect((await t.proxy.finalize(a.meter_id)).unsettled).toBe(1);
    const path = join(t.dir, "journal.ndjson");
    appendFileSync(path, JSON.stringify({ kind: "request", reservation_id: "res_crashed", lease_id: "l1", cell: { ...cell, meter_id: a.meter_id }, try: 1, max_micros: 500_000 }) + "\n");
    const fresh = new FakeLedger();
    const result = await reconcileJournal(path, fresh);
    expect(result).toEqual({ settled: ["res_1"], unknown: ["res_crashed"], refused: [] });
    expect(fresh.settles[0]![1]).toMatchObject({ kind: "spent" });
    expect(fresh.settles[1]).toEqual(["res_crashed", { kind: "unknown" }]);
    expect(t.calls).toHaveLength(1);
  });
});

test("scrubbedCause walks nested causes and redacts every secret", () => {
  const e = new Error("outer", { cause: new Error("inner gse_abc", { cause: "deepest sk-1" }) });
  expect(scrubbedCause(e, ["gse_abc", "sk-1"])).toBe("outer: inner [redacted]: deepest [redacted]");
});
