import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBatch, type BatchOptions } from "../../lanes/decision-routing/host/controller.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { CHAT_PRICES, openRouterRouting, priceRequest, quoteClientValue, reservationMicros, sseUsage, TOOL_USE_SYSTEM_TOKENS, UNKNOWN_CHAIN_CONTEXT_TOKENS, usageCost } from "../../src/runner/pricing/prices.ts";
import { isTrialNetworkHost, MeteringProxy, problem, ProxyControl, reconcileJournal, routable, scrubbedCause, type BindRequest, type ProxyOptions } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const KEY = "sk-ant-real-key-0123456789";
const OPENAI_KEY = "sk-openai-real-key-0123456789";
const OPENROUTER_KEY = "sk-or-v1-real-key-0123456789";
const MANAGEMENT = "management-token-0123456789abcdef";
const cell: Omit<CellAttempt, "meter_id"> = { run_id: "r1", arm: "gstack", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 };

class FakeLedger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  settles: Array<[string, CallOutcome]> = [];
  failSettles = 0;
  refuseSettles = 0;
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
    if (this.refuseSettles > 0) {
      this.refuseSettles--;
      return { ok: false, code: "CAP_STOP", message: "settle refused" };
    }
    const prior = this.reservations.get(id);
    if (prior && prior.state !== "reserved" && (outcome.kind === "spent" ? prior.state !== "settled" || prior.spent_micros !== outcome.spent_micros || JSON.stringify(prior.usage) !== JSON.stringify(outcome.usage) : prior.state !== "unknown")) return { ok: false, code: "E_SETTLE_CONFLICT", message: `reservation ${id} was already ${prior.state}` };
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
  const calls: Array<{ url: string; headers: Headers; body: any; raw: string }> = [];
  const sleeps: number[] = [];
  const proxy = new MeteringProxy({
    ledger,
    leaseId: "l1",
    host: "127.0.0.1",
    managementSocket: join(dir, "management.sock"),
    managementToken: MANAGEMENT,
    journal: join(dir, "journal.ndjson"),
    retry: { attempts: 3, elapsed_ms: 60_000 },
    env: { ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: OPENAI_KEY, OPENROUTER_API_KEY: OPENROUTER_KEY },
    sleep: async ms => void sleeps.push(ms),
    fetch: async (url, init) => {
      calls.push({ url, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined, raw: init.body ? String(init.body) : "" });
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

  // Added by /ship coverage audit, pass 2.
  // Value: protects=a call with no provider key gets 503 E_KEY_MISSING and never reaches upstream or the ledger;
  // fails_when=the key guard is removed; why_new=no test sets env without the key; seam=none; no_claim=real env loading
  test("a provider with no key in the proxy's environment is refused before the ledger and the provider", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), { env: { OPENAI_API_KEY: OPENAI_KEY } });
    const a = t.bind();
    const body = await expectProblem(await t.call(a.slot, a.token), 503, "E_KEY_MISSING");
    expect(body.detail).toContain("ANTHROPIC_API_KEY");
    expect(t.calls).toHaveLength(0);
    expect(t.ledger.reservations.size).toBe(0);
    expect((await t.proxy.finalize(a.meter_id)).refused).toBe(1);
  });

  // Added by /ship coverage audit, pass 2.
  // Value: protects=400 E_ALLOWANCE for non-JSON and non-object bodies; fails_when=a parse guard is dropped and the
  // request crashes or is forwarded; why_new=untested; seam=none; no_claim=none beyond protects
  test("a body that is not a JSON object is refused before the ledger and the provider", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    for (const raw of ["not json", "[]", '"claude-opus-5-5"', "null"]) {
      const res = await fetch(`http://127.0.0.1:${t.proxy.port}/${a.slot}/anthropic/v1/messages`, { method: "POST", headers: { "x-api-key": a.token }, body: raw });
      await expectProblem(res, 400, "E_ALLOWANCE");
    }
    expect(t.calls).toHaveLength(0);
    expect(t.ledger.reservations.size).toBe(0);
  });

  // Added by /ship coverage audit, pass 2.
  // Value: protects=a request naming no output cap is sent with its route's cap field and reserved at that cap;
  // fails_when=injection is removed or uses the wrong field; why_new=only the refusal is tested; seam=none;
  // no_claim=provider acceptance of the field (fake upstream)
  test("a request naming no output cap gets the cell's cap in its route's field and is reserved at it", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), { maxOutputTokens: 2000 });
    const a = t.bind();
    const rows = [
      ["/anthropic/v1/messages", "anthropic", { model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }] }, "max_tokens"],
      ["/openai/v1/chat/completions", "openai", { model: "gpt-6.1-sol", messages: [{ role: "user", content: "hi" }] }, "max_completion_tokens"],
      ["/openai/v1/responses", "openai", { model: "gpt-6.1-sol", input: "hi" }, "max_output_tokens"],
    ] as const;
    for (const [i, [path, provider, body, field]] of rows.entries()) {
      expect((await t.call(a.slot, a.token, path, body)).status).toBe(200);
      const sent = t.calls[i]!.body;
      expect(sent[field]).toBe(2000);
      for (const other of ["max_tokens", "max_completion_tokens", "max_output_tokens"].filter(f => f !== field)) expect(sent[other]).toBeUndefined();
      expect(t.ledger.reservations.get(`res_${i + 1}`)!.max_micros).toBe(reservationMicros(priceRequest(provider, sent, 2000)));
    }
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
    const ledger = new FakeLedger();
    const reserve = ledger.reserve.bind(ledger);
    ledger.reserve = async request => {
      await Bun.sleep(10);
      return reserve(request);
    };
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), { ledger });
    const a = t.bind({ allowance_micros: 30_000 });
    const statuses = (await Promise.all([t.call(a.slot, a.token), t.call(a.slot, a.token)])).map(r => r.status).sort();
    expect(statuses).toEqual([200, 402]);
    expect(t.calls).toHaveLength(1);
  });

  test("replayed hosted-tool calls and results are priced by their bytes; enabling a hosted tool is refused", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    const replay = { model: "gpt-6.1-sol", input: [{ type: "web_search_call", id: "ws_1", status: "completed" }, { role: "user", content: "hi" }] };
    expect((await t.call(a.slot, a.token, "/openai/v1/responses", replay)).status).toBe(200);
    const anthropic = { model: "claude-opus-5-5", messages: [{ role: "assistant", content: [{ type: "web_search_tool_result", tool_use_id: "t1", content: [] }] }, { role: "user", content: "next" }] };
    expect((await t.call(a.slot, a.token, undefined, anthropic)).status).toBe(200);
    await expectProblem(await t.call(a.slot, a.token, undefined, { ...anthropic, tools: [{ type: "web_search_20250305", name: "web_search" }] }), 402, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(2);
  });

  test("a reservation the ledger fails to answer is refused and gives back the slot's claim", async () => {
    const ledger = new FakeLedger();
    const reserve = ledger.reserve.bind(ledger);
    let failures = 1;
    ledger.reserve = async request => {
      if (failures-- > 0) throw new Error("ledger restarted");
      return reserve(request);
    };
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), { ledger });
    const a = t.bind({ allowance_micros: 30_000 });
    const body = await expectProblem(await t.call(a.slot, a.token), 503, "E_LEDGER_UNAVAILABLE");
    expect(body.detail).toContain("nothing was sent");
    expect(t.calls).toHaveLength(0);
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    expect(t.calls).toHaveLength(1);
  });

  test("rate multipliers the reservation cannot see are refused", async () => {
    const t = setup(() => ok({}));
    const a = t.bind();
    await expectProblem(await t.call(a.slot, a.token, "/openai/v1/chat/completions", { model: "gpt-6.1-sol", n: 50, max_completion_tokens: 1000, messages: [] }), 402, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, "/openai/v1/responses", { model: "gpt-6.1-sol", service_tier: "priority", input: "hi" }), 402, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(0);
  });

  test("Anthropic fast mode and inference_geo, and OpenAI stored prompts, are refused; fast-mode usage is not priced", async () => {
    const t = setup(() => ok({}));
    const a = t.bind();
    const msg = { model: "claude-opus-5-5", max_tokens: 1000, messages: [] };
    await expectProblem(await t.call(a.slot, a.token, undefined, { ...msg, speed: "fast" }), 402, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, undefined, { ...msg, inference_geo: "us" }), 402, "E_ALLOWANCE");
    await expectProblem(await t.call(a.slot, a.token, "/openai/v1/responses", { model: "gpt-6.1-sol", prompt: { id: "pmpt_1" }, input: "hi" }), 402, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(0);
    expect(usageCost(priceRequest("anthropic", msg, 1000), { input_tokens: 10, output_tokens: 5, speed: "fast" })).toBeNull();
    const stream = [{ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1, speed: "fast" } } }, { type: "message_delta", usage: { output_tokens: 5 } }];
    expect(usageCost(priceRequest("anthropic", msg, 1000), sseUsage(stream.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")))).toBeNull();
  });

  test("stored context from previous_response_id, a conversation or an item reference is reserved at the context bound", () => {
    const base = { model: "gpt-6.1-sol", input: "hi" };
    const plain = priceRequest("openai", base, 1000).inputTokens;
    for (const extra of [{ previous_response_id: "resp_1" }, { conversation: "conv_1" }, { input: [{ type: "item_reference", id: "msg_1" }] }, { input: [{ id: "msg_1" }] }]) {
      expect(priceRequest("openai", { ...base, ...extra }, 1000).inputTokens).toBeGreaterThanOrEqual(plain + UNKNOWN_CHAIN_CONTEXT_TOKENS - 64);
    }
  });

  test("an assistant replay with an id and a role is priced by its bytes; a type: null reference is reserved at the context bound", () => {
    const base = { model: "gpt-6.1-sol", input: "hi" };
    const plain = priceRequest("openai", base, 1000).inputTokens;
    expect(priceRequest("openai", { ...base, input: [{ id: "msg_1", type: null }] }, 1000).inputTokens).toBeGreaterThanOrEqual(plain + UNKNOWN_CHAIN_CONTEXT_TOKENS - 64);
    const replay = { ...base, input: [{ role: "assistant", id: "msg_1", content: [{ type: "output_text", text: "hello" }] }] };
    expect(priceRequest("openai", replay, 1000).inputTokens).toBeLessThan(10_000);
  });

  test("a reasoning item with an id and no encrypted_content is reserved at the context bound; one that carries its encrypted_content is priced by its bytes", () => {
    const base = { model: "gpt-6.1-sol", input: "hi" };
    const plain = priceRequest("openai", base, 1000).inputTokens;
    for (const item of [{ type: "reasoning", id: "rs_1", summary: [] }, { type: "reasoning", id: "rs_1", summary: [], encrypted_content: null }]) {
      expect(priceRequest("openai", { ...base, input: [item] }, 1000).inputTokens).toBeGreaterThanOrEqual(plain + UNKNOWN_CHAIN_CONTEXT_TOKENS - 64);
    }
    const inline = { ...base, input: [{ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAAB-opaque" }] };
    expect(priceRequest("openai", inline, 1000).inputTokens).toBeLessThan(10_000);
  });

  test("a request with tools reserves the tool-use system prompt", () => {
    const msg = { model: "claude-opus-5-5", max_tokens: 1000, messages: [] };
    const plain = priceRequest("anthropic", msg, 1000).inputTokens;
    const tools = [{ name: "t", input_schema: { type: "object" } }];
    expect(priceRequest("anthropic", { ...msg, tools }, 1000).inputTokens - plain).toBeGreaterThanOrEqual(TOOL_USE_SYSTEM_TOKENS);
  });

  test("inference_geo global is forwarded, and an OpenAI call that names no service_tier is pinned to default", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    expect((await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", inference_geo: "global", max_tokens: 1000, messages: [] })).status).toBe(200);
    expect((await t.call(a.slot, a.token, "/openai/v1/responses", { model: "gpt-6.1-sol", input: "hi" })).status).toBe(200);
    expect(t.calls[1]!.body.service_tier).toBe("default");
  });

  test("an Anthropic call that names no inference_geo is pinned to global", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    expect(t.calls[0]!.body.inference_geo).toBe("global");
  });

  test("Claude 4.5 and older, which answer inference_geo with a 400, are sent without the pin; an id the version pattern cannot read is pinned", async () => {
    const older = ["claude-opus-4-5", "claude-sonnet-4", "claude-3-5-haiku", "claude-opus-4-5@20251101"];
    for (const model of older) CHAT_PRICES[`anthropic:${model}`] = CHAT_PRICES["anthropic:claude-opus-5-5"]!;
    try {
      const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
      const models = ["claude-opus-4-5-20251101", "claude-sonnet-4-20250514", "claude-3-5-haiku-20241022", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-4-5@20251101"];
      const a = t.bind({ models: models.map(m => `anthropic:${m}`) });
      for (const model of models) expect((await t.call(a.slot, a.token, undefined, { model, max_tokens: 1000, messages: [] })).status).toBe(200);
      expect(t.calls.map(c => c.body.inference_geo)).toEqual([undefined, undefined, undefined, "global", "global", "global"]);
    } finally {
      for (const model of older) delete CHAT_PRICES[`anthropic:${model}`];
    }
  });

  test("a cap named in a field the route's provider does not read still gets the cell's cap in the route's field", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    expect((await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", max_output_tokens: 10, messages: [] })).status).toBe(200);
    expect(t.calls[0]!.body.max_tokens).toBe(32_768);
  });

  test("long prompts are reserved and settled at the long-prompt rates", () => {
    const p = priceRequest("openai", { model: "gpt-6.1-sol", input: "x".repeat(300_000) }, 1000);
    expect(p.inputTokens).toBeGreaterThan(272_000);
    expect(reservationMicros(p)).toBe(p.inputTokens * 5 + 1000 * 15);
    expect(usageCost(p, { input_tokens: 300_000, output_tokens: 10 })!.micros).toBe(300_000 * 4 + 10 * 15);
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

  test("a journal write that fails while a stream settles is counted, and the call is still metered and settled", async () => {
    const enc = new TextEncoder();
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const upstream = () =>
      new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } })}\n\n`));
            await gate;
            c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 5 } })}\n\n`));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const t = setup(upstream);
    const a = t.bind();
    const res = await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", stream: true, max_tokens: 1000, messages: [] });
    const proxy = t.proxy as unknown as { journalFd: number | null };
    const fd = proxy.journalFd;
    proxy.journalFd = 2 ** 30;
    const err = spyOn(console, "error").mockImplementation(() => {});
    release();
    expect(await res.text()).toContain("message_delta");
    const meter = await t.proxy.finalize(a.meter_id);
    proxy.journalFd = fd;
    expect(String(err.mock.calls[0]?.[0])).toStartWith("E_INTERNAL: metering proxy: the outcome of reservation ");
    err.mockRestore();
    expect(meter.unsettled).toBe(1);
    expect(meter.micros).toBe(10 * 4 + 5 * 20);
    expect(t.ledger.settles).toHaveLength(1);
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

  const brokenStream = (breakAt: Promise<void> | null) => () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 1 } } })}\n\n`));
          const reset = () => c.error(new Error(`connection reset carrying ${KEY}`));
          if (breakAt) void breakAt.then(reset);
          else reset();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

  async function expectHeldAsUnknown(t: ReturnType<typeof setup>, meterId: string, clientError: string | null) {
    expect(clientError).not.toBeNull();
    expect(clientError).not.toContain(KEY);
    const meter = await t.proxy.finalize(meterId);
    const held = t.ledger.reservations.get("res_1")!;
    expect(held.state).toBe("unknown");
    expect(meter).toMatchObject({ unknown: 1, undrained: 0, requests: 1, micros: held.max_micros });
    expect(t.ledger.settles).toEqual([["res_1", { kind: "unknown" }]]);
    expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toContain(KEY);
    expect(t.journal().find(l => l.kind === "outcome")).toMatchObject({ reservation_id: "res_1", outcome: { kind: "unknown" }, reason: "the stream broke: connection reset carrying [redacted]" });
  }

  test("a stream that breaks after its headers keeps its full reservation as unknown and leaks no key", async () => {
    let headersSeen!: () => void;
    const t = setup(brokenStream(new Promise<void>(r => (headersSeen = r))));
    const a = t.bind();
    const res = await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", stream: true, max_tokens: 1000, messages: [] });
    expect(res.status).toBe(200);
    headersSeen();
    await expectHeldAsUnknown(t, a.meter_id, await res.text().then(() => null, e => String(e)));
  });

  test("a stream already broken when the proxy reads it keeps its full reservation as unknown and leaks no key", async () => {
    const t = setup(brokenStream(null));
    const a = t.bind();
    const clientError = await t
      .call(a.slot, a.token, undefined, { model: "claude-opus-5-5", stream: true, max_tokens: 1000, messages: [] })
      .then(res => res.text())
      .then(() => null, e => String(e));
    await expectHeldAsUnknown(t, a.meter_id, clientError);
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

describe("OpenRouter route", () => {
  const PARTICLE = "particle-ai/particle-1";
  const DEEPSEEK = "deepseek/deepseek-v4.1-flash-1017";
  const models = [`openrouter:${PARTICLE}`, `openrouter:${DEEPSEEK}`, `openrouter:${PARTICLE}:online`];
  const chat = (model = PARTICLE, extra: Record<string, unknown> = {}) => ({ model, messages: [{ role: "user", content: "hi" }], ...extra });
  const PATH = "/openrouter/v1/chat/completions";

  test("the DeepSeek V4.1 Flash row routes only to zero-retention fp8 hosts, with deny, and never to DeepSeek's own endpoint", () => {
    // OpenRouter's provider-logging table and this model's endpoints list, read 2026-10-31: inference.net keeps no prompts and serves it at fp8; DeepSeek may train on prompts.
    const ZERO_RETENTION_FP8 = ["inference-net"];
    const route = openRouterRouting(CHAT_PRICES[`openrouter:${DEEPSEEK}`]!);
    expect(route.only?.length).toBeGreaterThan(0);
    expect(route.only!.every((p) => ZERO_RETENTION_FP8.includes(p))).toBe(true);
    expect(route.only).not.toContain("deepseek");
    expect([route.data_collection, route.allow_fallbacks, route.quantizations]).toEqual(["deny", false, ["fp8"]]);
  });

  test("a call goes out with OPENROUTER_API_KEY and the price row's routing, and settles from reported tokens at the row", async () => {
    const t = setup(() =>
      t.calls.length === 1
        ? ok({ prompt_tokens: 1000, completion_tokens: 200, cost: 0.0002 })
        : ok({ prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 800 }, cost: 0.00005 }),
    );
    const a = t.bind({ models });
    expect((await t.call(a.slot, a.token, PATH, chat(PARTICLE, { provider: { sort: "price", only: ["somewhere-pricier"] } }))).status).toBe(200);
    expect((await t.call(a.slot, a.token, PATH, chat(DEEPSEEK))).status).toBe(200);
    expect(t.calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(t.calls[0]!.headers.get("authorization")).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(t.calls[0]!.headers.get("x-api-key")).toBeNull();
    expect(t.calls[0]!.body.provider).toEqual({ only: ["particle-ai"], allow_fallbacks: false, data_collection: "deny", max_price: { prompt: 0.1, completion: 1, request: 0, image: 0 } });
    expect(t.calls[0]!.body.max_tokens).toBe(32_768);
    expect(t.calls[0]!.body.max_completion_tokens).toBeUndefined();
    expect(t.calls[1]!.body.provider).toEqual({ only: ["inference-net"], allow_fallbacks: false, quantizations: ["fp8"], data_collection: "deny", max_price: { prompt: 0.08, completion: 0.55, request: 0, image: 0 } });
    expect(t.ledger.settles).toEqual([
      ["res_1", { kind: "spent", spent_micros: 1000 * 0.1 + 200 * 1, usage: { input: 1000, output: 200, reasoning: 0, cache_read: 0, cache_write: 0 } }],
      ["res_2", { kind: "spent", spent_micros: Math.ceil(200 * 0.08 + 800 * 0.008 + 100 * 0.55), usage: { input: 200, output: 100, reasoning: 0, cache_read: 800, cache_write: 0 } }],
    ]);
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter.by_model[`openrouter:${PARTICLE}`]).toEqual({ micros: 300, requests: 1 });
    expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toContain(OPENROUTER_KEY);
  });

  test("a chat call always carries max_tokens, OpenRouter's documented output limit, at most the reserved output", async () => {
    const t = setup(() => ok({ prompt_tokens: 10, completion_tokens: 5 }));
    const a = t.bind({ models });
    await t.call(a.slot, a.token, PATH, chat(PARTICLE, { max_completion_tokens: 1000 }));
    await t.call(a.slot, a.token, PATH, chat(PARTICLE, { max_tokens: 500, max_completion_tokens: 2000 }));
    await expectProblem(await t.call(a.slot, a.token, PATH, chat(PARTICLE, { max_tokens: 100_000 })), 400, "E_ALLOWANCE");
    expect(t.calls.map(c => [c.body.max_tokens, c.body.max_completion_tokens])).toEqual([[1000, 1000], [500, 2000]]);
    const held = [...t.ledger.reservations.values()].map(r => r.max_micros);
    expect(held).toEqual(t.calls.map(c => reservationMicros(priceRequest("openrouter", c.body, Math.max(c.body.max_tokens, c.body.max_completion_tokens)))));
  });

  test("a stream settles from the usage in its last chunk, past OpenRouter's keep-alive comments", async () => {
    const chunks = [": OPENROUTER PROCESSING", `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }], usage: null })}`, `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 400, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 40 }, cost: 0.0001 } })}`, "data: [DONE]"];
    const t = setup(() => new Response(chunks.join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
    const a = t.bind({ models });
    expect(await (await t.call(a.slot, a.token, PATH, chat(PARTICLE, { stream: true }))).text()).toContain('"content":"hi"');
    expect(t.calls[0]!.body.stream_options).toEqual({ include_usage: true });
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter).toMatchObject({ micros: 400 * 0.1 + 100 * 1, unknown: 0, requests: 1 });
    expect(t.ledger.settles).toEqual([["res_1", { kind: "spent", spent_micros: 140, usage: { input: 400, output: 60, reasoning: 40, cache_read: 0, cache_write: 0 } }]]);
  });

  test("a Responses stream, as Codex sends one, gets the row's routing and settles from response.completed", async () => {
    const usage = { input_tokens: 2000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 }, cost: 0.0004 };
    const t = setup(() => sse([{ type: "response.created", response: { usage: null } }, { type: "response.output_text.delta", delta: "hi" }, { type: "response.completed", response: { usage } }]));
    const a = t.bind({ models });
    const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];
    await (await t.call(a.slot, a.token, "/openrouter/v1/responses", { model: PARTICLE, stream: true, store: false, input, reasoning: { effort: "high" } })).text();
    expect(t.calls[0]!.url).toBe("https://openrouter.ai/api/v1/responses");
    expect(t.calls[0]!.body).toMatchObject({ provider: { max_price: { prompt: 0.1, completion: 1, request: 0, image: 0 } }, max_output_tokens: 32_768 });
    expect(t.ledger.settles).toEqual([["res_1", { kind: "spent", spent_micros: 2000 * 0.1 + 300 * 1, usage: { input: 2000, output: 200, reasoning: 100, cache_read: 0, cache_write: 0 } }]]);
  });

  test("a call OpenRouter bills above its tokens at the row settles at what OpenRouter billed", async () => {
    const t = setup(() => ok({ prompt_tokens: 1000, completion_tokens: 200, cost: 0.002 }));
    const a = t.bind({ models });
    await t.call(a.slot, a.token, PATH, chat());
    expect(t.ledger.settles[0]![1]).toMatchObject({ kind: "spent", spent_micros: 2000 });
  });

  test("settled OpenRouter spend counts toward the cap, so the next call that cannot fit is a cap stop sent nowhere", async () => {
    const t = setup(() => ok({ prompt_tokens: 1000, completion_tokens: 10_000 }), { ledger: new FakeLedger(40_000) });
    const a = t.bind({ models });
    expect((await t.call(a.slot, a.token, PATH, chat())).status).toBe(200);
    const held = t.ledger.reservations.get("res_1")!.max_micros;
    expect(held).toBeGreaterThan(40_000 - 10_100);
    await expectProblem(await t.call(a.slot, a.token, PATH, chat()), 402, "CAP_STOP");
    expect(t.calls).toHaveLength(1);
    expect(t.ledger.committed()).toBe(10_100);
  });

  test("with no OPENROUTER_API_KEY the call is refused by that name before the ledger and the provider", async () => {
    const t = setup(() => ok({ prompt_tokens: 10, completion_tokens: 5 }), { env: { ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: OPENAI_KEY } });
    const a = t.bind({ models });
    const body = await expectProblem(await t.call(a.slot, a.token, PATH, chat()), 503, "E_KEY_MISSING");
    expect(body.detail).toContain("OPENROUTER_API_KEY");
    expect(t.calls).toHaveLength(0);
    expect(t.ledger.reservations.size).toBe(0);
  });

  test("a provider error with no usage is passed on: a 4xx releases its hold, a 5xx is retried and keeps its charge", async () => {
    const noEndpoint = { error: { code: 404, message: "No endpoints found matching your max_price" } };
    const t = setup(() => (t.calls.length === 1 ? Response.json(noEndpoint, { status: 404 }) : Response.json({ error: { code: 502, message: "provider returned error" } }, { status: 502 })));
    const a = t.bind({ models });
    const res = await t.call(a.slot, a.token, PATH, chat());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(noEndpoint);
    expect(t.ledger.settles[0]).toEqual(["res_1", { kind: "spent", spent_micros: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 } }]);
    await expectProblem(await t.call(a.slot, a.token, PATH, chat()), 502, "UPSTREAM");
    expect(t.calls).toHaveLength(4);
    const kept = t.ledger.settles.slice(1).map(([id, o]) => [id, o.kind === "spent" ? o.spent_micros : null]);
    expect(kept).toEqual(["res_2", "res_3", "res_4"].map(id => [id, t.ledger.reservations.get(id)!.max_micros]));
  });

  test("fields that reach other models, tiers or paid server tools, and unpriced variants, are refused before the provider", async () => {
    const t = setup(() => ok({ prompt_tokens: 10, completion_tokens: 5 }));
    const a = t.bind({ models });
    for (const extra of [{ models: [PARTICLE, "openai/gpt-6-astra"] }, { route: "fallback" }, { preset: "@preset/x" }, { plugins: [{ id: "web" }] }, { web_search_options: {} }, { service_tier: "priority" }, { prompt: { id: "p" } }, { background: true }, { modalities: ["image"] }, { max_price: { prompt: 100 } }, { tools: [{ type: "openrouter:subagent" }] }]) {
      await expectProblem(await t.call(a.slot, a.token, PATH, chat(PARTICLE, extra)), 402, "E_ALLOWANCE");
    }
    await expectProblem(await t.call(a.slot, a.token, PATH, chat(`${PARTICLE}:online`)), 402, "E_ALLOWANCE");
    for (const file_data of ["https://example.com/a.pdf", "data:application/pdf;base64,JVBERi0="]) {
      await expectProblem(await t.call(a.slot, a.token, PATH, chat(PARTICLE, { messages: [{ role: "user", content: [{ type: "file", file: { filename: "a.pdf", file_data } }] }] })), 402, "E_ALLOWANCE");
    }
    await expectProblem(await t.call(a.slot, a.token, "/openrouter/v1/responses", { model: PARTICLE, input: [{ role: "user", content: [{ type: "input_file", file_data: "https://example.com/a.pdf" }] }] }), 402, "E_ALLOWANCE");
    for (const extra of [{ plugins: [{ id: "web" }] }, { tools: [{ type: "web_search_20250305", name: "web_search" }] }]) {
      await expectProblem(await t.call(a.slot, a.token, "/openrouter/v1/messages", chat(PARTICLE, extra)), 402, "E_ALLOWANCE");
    }
    await expectProblem(await t.call(a.slot, a.token, "/openrouter/v1/completions", chat()), 403, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(0);
    expect((await t.call(a.slot, a.token, PATH, chat(PARTICLE, { tools: [{ type: "function", function: { name: "f", parameters: {} } }] }))).status).toBe(200);
  });

  test("routable names a model the proxy can route and price", () => {
    expect(routable("openrouter", PARTICLE)).toBe(true);
    expect(routable("openrouter", DEEPSEEK)).toBe(true);
    expect(routable("anthropic", "claude-opus-5-5")).toBe(true);
    expect(routable("openrouter", `${PARTICLE}:online`)).toBe(false);
    expect(routable("openrouter", "claude-opus-5-5")).toBe(false);
    expect(routable("gemini", "gemini-4-argon")).toBe(false);
    expect(Object.keys(CHAT_PRICES).filter(id => id.startsWith("openrouter:"))).toEqual([`openrouter:${PARTICLE}`, `openrouter:${DEEPSEEK}`, "openrouter:openai/gpt-6.1-sol", "openrouter:google/gemini-4-argon"]);
  });

  // Value: protects=Claude Code's token counts on OpenRouter's Messages route are answered by the proxy, as Lane B's proxy answers them, instead of refused into review-units' degraded share, and still pass the slot's model check; fails_when=a count is refused, sent upstream, reserved or charged, or a model off the slot gets a count; why_new=GST-1019 (GEVA-89: all 106 of particle-1's refusals were token counts); seam=forward's estimate route; no_claim=how Claude Code uses the count
  test("Claude Code's token counts on the Messages route are answered at a token per four bytes, sent nowhere, after the model check", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind({ models });
    const body = { model: PARTICLE, messages: [{ role: "user", content: "x".repeat(1001) }], tools: [] };
    const res = await t.call(a.slot, a.token, "/openrouter/v1/messages/count_tokens", body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ input_tokens: Math.ceil(Buffer.byteLength(JSON.stringify(body)) / 4) });
    await expectProblem(await t.call(a.slot, a.token, "/openrouter/v1/messages/count_tokens", { ...body, model: "openai/gpt-6-astra" }), 403, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(0);
    expect(t.ledger.reservations.size).toBe(0);
    expect(t.journal().map(l => [l.kind, l.status ?? null, l.estimated ?? null])).toEqual([["free", 200, true], ["refusal", null, null]]);
    expect((await t.proxy.finalize(a.meter_id))).toMatchObject({ micros: 0, requests: 0, refused: 1 });
  });

  // Value: protects=a Sol prompt past 272,000 tokens still finds the openai endpoint, which bills it at $4 and $15, because max_price carries the long rates; fails_when=max_price sends the base $2 and $10 and OpenRouter has no endpoint for a long prompt; why_new=GST-1019 Capy review finding (max_price above 272k); seam=openRouterRouting on the Messages route; no_claim=OpenRouter's live filtering
  test("a Sol call past 272,000 prompt tokens goes out with max_price at the long rates and settles at them", async () => {
    const SOL = "openai/gpt-6.1-sol";
    const t = setup(() => ok({ input_tokens: 280_000, output_tokens: 10 }));
    const a = t.bind({ models: [`openrouter:${SOL}`], allowance_micros: 20_000_000 });
    const res = await t.call(a.slot, a.token, "/openrouter/v1/messages", { model: SOL, max_tokens: 1000, messages: [{ role: "user", content: "x".repeat(1_120_000) }] });
    expect(res.status).toBe(200);
    expect(t.calls[0]!.body.provider).toEqual({ only: ["openai"], allow_fallbacks: false, data_collection: "deny", max_price: { prompt: 4, completion: 15, request: 0, image: 0 } });
    expect(t.ledger.settles[0]![1]).toMatchObject({ kind: "spent", spent_micros: 280_000 * 4 + 10 * 15 });
  });

  const SOL = "openai/gpt-6.1-sol";
  const ARGON = "google/gemini-4-argon";
  /** The routing bytes main sent at 5a01538 for every OpenRouter row that lists no image price. */
  const MAIN_ROUTING: Record<string, string> = {
    [PARTICLE]: '{"only":["particle-ai"],"allow_fallbacks":false,"data_collection":"deny","max_price":{"prompt":0.1,"completion":1,"request":0,"image":0}}',
    [DEEPSEEK]: '{"only":["inference-net"],"allow_fallbacks":false,"quantizations":["fp8"],"data_collection":"deny","max_price":{"prompt":0.08,"completion":0.55,"request":0,"image":0}}',
    [SOL]: '{"only":["openai"],"allow_fallbacks":false,"data_collection":"deny","max_price":{"prompt":4,"completion":15,"request":0,"image":0}}',
  };
  /** main's openRouterRouting at 5a01538, copied so a row with no image price can be held to it byte for byte. */
  const mainRouting = (price: (typeof CHAT_PRICES)[string]) => ({ ...(price.providers ? { only: price.providers, allow_fallbacks: false } : {}), ...(price.quantizations ? { quantizations: price.quantizations } : {}), data_collection: "deny" as const, max_price: { prompt: Math.max(price.input, price.long?.input ?? 0), completion: Math.max(price.output, price.long?.output ?? 0), request: 0, image: 0 } });

  // Value: protects=an Argon send reaches google-vertex/global, whose listed image price is $0.000002; fails_when=max_price.image stays 0, below every Argon endpoint's image price, and OpenRouter answers 404 "No endpoints found that satisfy the max price for this request" (failed_routing_step "Filter by Max Price"), as both tbv keys sends and the 2026-11-07 probe did; why_new=tbv keys round 1 stopped on that 404 twice; seam=the Argon row, openRouterRouting and the proxy's outgoing body; no_claim=OpenRouter's live endpoint list after the cited read
  test("Argon's routing carries max_price.image at the image price its pinned endpoint lists, in the proxy's outgoing body too", async () => {
    const argon = '{"only":["google-vertex"],"allow_fallbacks":false,"data_collection":"deny","max_price":{"prompt":2,"completion":10,"request":0,"image":0.000002}}';
    expect(JSON.stringify(openRouterRouting(CHAT_PRICES[`openrouter:${ARGON}`]!))).toBe(argon);
    const t = setup(() => ok({ prompt_tokens: 32, completion_tokens: 1, cost: 0.00007326 }));
    const a = t.bind({ models: [`openrouter:${ARGON}`] });
    expect((await t.call(a.slot, a.token, PATH, { model: ARGON, messages: [{ role: "user", content: "Hello" }], max_tokens: 1 })).status).toBe(200);
    expect(t.calls.map(c => c.raw)).toEqual([`{"model":"${ARGON}","messages":[{"role":"user","content":"Hello"}],"max_tokens":1,"provider":${argon}}`]);
  });

  // Value: protects=every OpenRouter model but Argon routes exactly as before the image price fix; fails_when=the fix changes max_price, its key order or any other routing byte for a row that lists no image price; why_new=the Argon fix touches the routing every OpenRouter call shares; seam=openRouterRouting and the proxy's outgoing body; no_claim=OpenRouter's live filtering
  test("every OpenRouter row but Argon lists no image price and sends main's routing bytes, Sol, particle-1 and DeepSeek included", async () => {
    const rows = Object.entries(CHAT_PRICES).filter(([id]) => id.startsWith("openrouter:")).map(([id, row]) => [id.slice("openrouter:".length), row] as const);
    const others = rows.filter(([id]) => id !== ARGON);
    expect(others.map(([id]) => id).sort()).toEqual(Object.keys(MAIN_ROUTING).sort());
    for (const [id, row] of others) {
      expect(row.image).toBeUndefined();
      expect(JSON.stringify(openRouterRouting(row))).toBe(MAIN_ROUTING[id]!);
    }
    const shapes = [{ input: 1, output: 2 }, { input: 1, output: 2, providers: ["p"] }, { input: 1, output: 2, quantizations: ["fp8"] }, { input: 1, output: 2, long: { above_input_tokens: 10, input: 3, output: 4 }, providers: ["p", "q"], quantizations: ["bf16"] }];
    for (const row of shapes) expect(JSON.stringify(openRouterRouting(row))).toBe(JSON.stringify(mainRouting(row)));
    const t = setup(() => ok({ prompt_tokens: 10, completion_tokens: 1 }));
    const a = t.bind({ models: Object.keys(MAIN_ROUTING).map(id => `openrouter:${id}`) });
    for (const model of Object.keys(MAIN_ROUTING)) expect((await t.call(a.slot, a.token, PATH, { model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 })).status).toBe(200);
    expect((await t.call(a.slot, a.token, "/openrouter/v1/messages", { model: SOL, max_tokens: 1, messages: [{ role: "user", content: "hi" }] })).status).toBe(200);
    expect(t.calls.map(c => c.raw)).toEqual([
      ...Object.keys(MAIN_ROUTING).map(model => `{"model":"${model}","messages":[{"role":"user","content":"hi"}],"max_tokens":1,"provider":${MAIN_ROUTING[model]}}`),
      `{"model":"${SOL}","max_tokens":1,"messages":[{"role":"user","content":"hi"}],"provider":${MAIN_ROUTING[SOL]}}`,
    ]);
  });
});

describe("upstream error bodies in the journal", () => {
  const PARTICLE = "particle-ai/particle-1";
  const DEEPSEEK = "deepseek/deepseek-v4.1-flash-1017";
  const PATH = "/openrouter/v1/chat/completions";
  const models = [`openrouter:${PARTICLE}`, `openrouter:${DEEPSEEK}`];
  const chat = (content = "hi", model = PARTICLE) => ({ model, messages: [{ role: "user", content }] });
  const outcomes = (t: ReturnType<typeof setup>) => t.journal().filter(l => l.kind === "outcome");
  const withheld = (s: string) => `[withheld: it repeats the request's text, ${Buffer.byteLength(s)} bytes]`;
  const bytes = (s: string) => Buffer.byteLength(s);

  // Value: protects=a refused send says why in the journal; fails_when=the journal keeps only the status, as on tbv keys round 1, where two 404s left no reason; why_new=tbv keys round 1 (the max_price.image 404); seam=the paid path's outcome line; no_claim=the provider's error wording
  test("today's 404 body journals its code, failed routing step and the message's byte length, and the answer is passed on unchanged", async () => {
    const message = "No endpoints found that satisfy the max price for this request";
    const noEndpoints = { error: { message, code: 404, metadata: { routing_funnel: [{ step: "Initial Endpoints", endpoint_count: 6 }, { step: "Filter by Regional Surcharge", endpoint_count: 5 }, { step: "Filter by Tier Endpoint Rows", endpoint_count: 2, reason: "Excluded tier endpoint rows the request did not opt into" }], failed_routing_step: "Filter by Max Price" } } };
    const t = setup(() => Response.json(noEndpoints, { status: 404 }));
    const a = t.bind({ models });
    const res = await t.call(a.slot, a.token, PATH, chat());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(noEndpoints);
    expect(outcomes(t)).toEqual([expect.objectContaining({ status: 404, upstream_body: JSON.stringify({ error: { code: 404, message_bytes: bytes(message), metadata: { failed_routing_step: "Filter by Max Price" } } }) })]);
  });

  test("each 5xx attempt journals its own fields, and a 2xx answer journals none", async () => {
    let n = 0;
    const t = setup(() => (++n < 3 ? Response.json({ error: { code: 502, type: `upstream_error_${n}`, message: "provider returned error" } }, { status: 502 }) : ok({ prompt_tokens: 10, completion_tokens: 5 })));
    const a = t.bind({ models });
    expect((await t.call(a.slot, a.token, PATH, chat())).status).toBe(200);
    const lines = outcomes(t);
    expect(lines.map(l => [l.status, l.upstream_body])).toEqual([[502, '{"error":{"code":502,"type":"upstream_error_1","message_bytes":23}}'], [502, '{"error":{"code":502,"type":"upstream_error_2","message_bytes":23}}'], [200, undefined]]);
    expect("upstream_body" in lines[2]!).toBe(false);
  });

  test("a body that is not a JSON object keeps only its size", async () => {
    const page = "<html><body>502 Bad Gateway</body></html>";
    const t = setup(() => (t.calls.length === 1 ? new Response(page, { status: 400 }) : new Response('"a bare string"', { status: 400 })));
    const a = t.bind({ models });
    await t.call(a.slot, a.token, PATH, chat());
    await t.call(a.slot, a.token, PATH, chat());
    expect(outcomes(t).map(l => l.upstream_body)).toEqual([`[not a JSON object, ${page.length} bytes]`, "[not a JSON object, 15 bytes]"]);
  });

  test("a JSON array body keeps only its size", async () => {
    const list = '[{"error":{"message":"x"}}]';
    const t = setup(() => new Response(list, { status: 400 }));
    const a = t.bind({ models });
    await t.call(a.slot, a.token, PATH, chat());
    expect(outcomes(t).map(l => l.upstream_body)).toEqual([`[not a JSON object, ${list.length} bytes]`]);
  });

  test("the proxy's key is redacted, fields off the allow-list are dropped, and each kept string is cut to 512 characters", async () => {
    const t = setup(() => Response.json({ error: { type: `bad key ${OPENROUTER_KEY} ${"x".repeat(1_000)}`, message: `bad key ${OPENROUTER_KEY}`, detail: "y".repeat(10_000) }, user_id: "u-1" }, { status: 400 }));
    const a = t.bind({ models });
    await t.call(a.slot, a.token, PATH, chat());
    const kept = JSON.parse(outcomes(t)[0]!.upstream_body as string);
    expect(kept).toEqual({ error: { type: `bad key [redacted] ${"x".repeat(512 - 19)}`, message_bytes: bytes(`bad key ${OPENROUTER_KEY}`) } });
    expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toContain(OPENROUTER_KEY);
  });

  test("the 4,096-byte bound never splits a multibyte character", async () => {
    const wide = "€".repeat(600);
    const t = setup(() => Response.json({ error: { type: wide, message: wide, metadata: { failed_routing_step: wide, provider_name: wide } } }, { status: 400 }));
    const a = t.bind({ models });
    await t.call(a.slot, a.token, PATH, chat());
    const kept = outcomes(t)[0]!.upstream_body as string;
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(4096);
    expect(Buffer.byteLength(kept)).toBeGreaterThan(4090);
    expect(kept).not.toContain("\uFFFD");
    expect(kept).toEndWith("€");
  });

  // Value: protects=no prompt text reaches the journal through an error field that quotes the request; fails_when=a kept field that repeats part of a prompt is journaled as sent; why_new=journaling upstream error bodies; seam=the outcome and free lines; no_claim=an echo shorter than 24 characters
  test("a kept field that repeats 24 or more characters of the request's text is withheld, escaped or not, and one that names the model is kept", async () => {
    const prompt = 'The task asks why the parser drops "trailing" commas\nafter a nested array in strict mode.';
    const types = [`Invalid content: '${prompt.slice(4, 40)}...'`, `Invalid content: ${JSON.stringify(prompt.slice(20, 70))}`, `No endpoints found for ${DEEPSEEK}.`];
    const t = setup(() => Response.json({ error: { code: 400, type: types[t.calls.length - 1] } }, { status: 400 }));
    const a = t.bind({ models });
    await t.call(a.slot, a.token, PATH, chat(prompt));
    await t.call(a.slot, a.token, PATH, chat(prompt));
    await t.call(a.slot, a.token, PATH, chat(prompt, DEEPSEEK));
    expect(outcomes(t).map(l => JSON.parse(l.upstream_body as string).error.type)).toEqual([withheld(types[0]!), withheld(types[1]!), types[2]]);
    const journal = readFileSync(join(t.dir, "journal.ndjson"), "utf8");
    expect(journal).not.toContain(prompt.slice(4, 40));
    expect(journal).not.toContain("trailing");
  });

  const code = "x_zebra = 7\n".repeat(8);
  const cjk = "请解释斑马量子算法为什么在严格模式下会丢弃嵌套数组之后的尾随逗号并给出修复方案谢谢你的帮助";
  const goCode = "q_go<1&&q_go>0\n".repeat(6);
  const sealed = "SEALED_ANSWER_TOKEN_42 is the value the held-out check expects to see returned";
  const asciiEscaped = (s: string) => s.replace(/[\u0080-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const goEscaped = (s: string) => s.replace(/[<>&]/g, c => "\\u00" + c.charCodeAt(0).toString(16));
  const leaks = ["x_zebra", "斑马", asciiEscaped("斑马").slice(1, 6), "q_go", "SEALED_ANSWER"];
  const rawCases: [string, string, string][] = [
    ["a code prompt with newlines", code, JSON.stringify({ error: { input: code } })],
    ["a CJK prompt escaped as \\uXXXX", cjk, asciiEscaped(JSON.stringify({ error: { input: cjk } }))],
    ["a raw cut off mid-string (invalid JSON)", code, JSON.stringify({ error: { input: code } }).slice(0, -12)],
  ];
  // Value: protects=no prompt text reaches the journal through a provider error passed on as a string; fails_when=metadata.raw is journaled, where a quoted prompt is escaped twice and slips past the echo check; why_new=the third review round on the journal check; seam=the paid path's outcome line; no_claim=what OpenRouter puts in raw
  for (const [name, prompt, raw] of rawCases) {
    test(`metadata.raw is dropped for its byte length, so ${name} quoted inside it never reaches the journal`, async () => {
      const t = setup(() => Response.json({ error: { code: 400, message: "Provider returned error", metadata: { provider_name: "SomeHost", raw } } }, { status: 400 }));
      const a = t.bind({ models });
      await t.call(a.slot, a.token, PATH, chat(prompt));
      const journal = readFileSync(join(t.dir, "journal.ndjson"), "utf8");
      for (const leak of leaks) expect(journal).not.toContain(leak);
      expect(outcomes(t).map(l => l.upstream_body)).toEqual([JSON.stringify({ error: { code: 400, message_bytes: bytes("Provider returned error"), metadata: { provider_name: "SomeHost", raw_bytes: bytes(raw) } } })]);
    });
  }

  const messageCases: [string, string, string][] = [
    ["a CJK prompt escaped as \\uXXXX", cjk, "Provider returned error: " + asciiEscaped(JSON.stringify({ input: cjk }))],
    ["a code prompt escaped twice", code, JSON.stringify(JSON.stringify({ input: code }))],
    ["a prompt Go escapes as \\u003c", goCode, "upstream said: " + goEscaped(JSON.stringify({ input: goCode }))],
    ["an echo the 512-character cut would split", sealed, "d".repeat(490) + " quoted: " + sealed],
  ];
  // Value: protects=no prompt text reaches the journal through error.message; fails_when=error.message is journaled, where an escaped or cut echo slips past the echo check; why_new=the fourth review round on the journal's kept fields; seam=the paid path's outcome line; no_claim=how a provider escapes its message
  for (const [name, prompt, message] of messageCases) {
    test(`error.message is dropped for its byte length, so ${name} quoted inside it never reaches the journal`, async () => {
      const t = setup(() => Response.json({ error: { code: 400, message } }, { status: 400 }));
      const a = t.bind({ models });
      await t.call(a.slot, a.token, PATH, chat(prompt));
      const journal = readFileSync(join(t.dir, "journal.ndjson"), "utf8");
      for (const leak of leaks) expect(journal).not.toContain(leak);
      expect(outcomes(t).map(l => l.upstream_body)).toEqual([JSON.stringify({ error: { code: 400, message_bytes: bytes(message) } })]);
    });
  }

  test("a free route's non-2xx answer journals its error fields too", async () => {
    const missing = { error: { message: "Generation not found", code: 404 } };
    const t = setup(() => Response.json(missing, { status: 404 }));
    const a = t.bind({ models });
    const res = await fetch(`http://127.0.0.1:${t.proxy.port}/${a.slot}/openrouter/v1/generation?id=gen-1`, { headers: { authorization: `Bearer ${a.token}` } });
    expect(res.status).toBe(404);
    expect(t.journal().filter(l => l.kind === "free")).toEqual([expect.objectContaining({ status: 404, upstream_body: '{"error":{"code":404,"message_bytes":20}}' })]);
  });

  // Value: protects=a diagnostic field never stops a paid call from settling; fails_when=an error body the proxy cannot measure throws before settle, leaving no outcome line and the ledger hold open; why_new=journaling upstream error bodies; seam=the paid path's settle; no_claim=bodies a provider would really send
  test("an error body too deep to measure still settles its call, with a size note", async () => {
    const deep = '{"error":{"metadata":{"raw":' + '{"a":'.repeat(50_000) + "1" + "}".repeat(50_000) + "}}}";
    const t = setup(() => new Response(deep, { status: 400, headers: { "content-type": "application/json" } }));
    const a = t.bind({ models });
    const res = await t.call(a.slot, a.token, PATH, chat());
    expect(res.status).toBe(400);
    expect(outcomes(t)).toEqual([expect.objectContaining({ status: 400, upstream_body: `[unreadable, ${deep.length} bytes]` })]);
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
      if (ledger.reservations.size === 1) await Bun.sleep(600);
      return reserve(request);
    };
    const t = setup(() => new Response("{}", { status: 503, headers: { "retry-after-ms": "1" } }), { ledger, retry: { attempts: 3, elapsed_ms: 500 } });
    const a = t.bind();
    const body = await expectProblem(await t.call(a.slot, a.token), 502, "UPSTREAM");
    expect(body.detail).toContain("not sent");
    expect(t.calls).toHaveLength(1);
    expect(ledger.settles[1]).toEqual(["res_2", { kind: "spent", spent_micros: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 } }]);
  });

  test("one slot's 429 pauses another slot's call, which is refused when the pause outlasts its budget", async () => {
    const t = setup(() => new Response("{}", { status: 429, headers: { "retry-after": "30" } }), { retry: { attempts: 1, elapsed_ms: 10_000 } });
    const a = t.bind();
    const b = t.bind();
    await expectProblem(await t.call(a.slot, a.token), 502, "UPSTREAM");
    await expectProblem(await t.call(b.slot, b.token), 502, "UPSTREAM");
    expect(t.calls).toHaveLength(1);
    expect((await t.proxy.finalize(b.meter_id)).refused).toBe(1);
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

  // Added by /ship coverage audit, pass 2.
  // Value: protects=a non-retryable 4xx goes back verbatim, is sent once and spends 0; fails_when=a 4xx gets retried
  // or charged; why_new=only 401/429/5xx are tested; seam=none; no_claim=none beyond protects
  test("a non-retryable 4xx is passed back verbatim, sent once, and settled at zero spend", async () => {
    const error = '{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}';
    const t = setup(() => new Response(error, { status: 400, headers: { "content-type": "application/json" } }));
    const a = t.bind({ allowance_micros: 30_000 });
    const res = await t.call(a.slot, a.token);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(error);
    expect(t.calls).toHaveLength(1);
    expect(t.sleeps).toHaveLength(0);
    expect(t.ledger.settles).toEqual([["res_1", { kind: "spent", spent_micros: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 } }]]);
    const meter = await t.proxy.finalize(a.meter_id);
    expect(meter).toMatchObject({ micros: 0, requests: 1, unknown: 0, upstream: { statuses: { "400": 1 } } });
    t.calls.length = 0;
    expect((await t.call(a.slot, a.token)).status).toBe(400);
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

  test("a free route that fails upstream is journaled and answered with a coded problem that leaks no key", async () => {
    const t = setup(() => {
      throw new Error(`connection reset sending ${KEY}`);
    });
    const a = t.bind();
    const body = await expectProblem(await t.call(a.slot, a.token, "/anthropic/v1/messages/count_tokens", { model: "claude-opus-5-5", messages: [] }), 502, "UPSTREAM");
    expect(body.detail).not.toContain(KEY);
    expect(body.detail).toContain("[redacted]");
    expect(t.journal().map(l => [l.kind, l.status])).toEqual([["free", null]]);
  });

  test("a forbidden marker in the path, query string or headers is refused, raw or decoded, on free GET routes too", async () => {
    const t = setup(() => Response.json({ data: [] }), { forbiddenMarkers: ["HIDDEN-FACT-42", "K=V&W+X"] });
    const a = t.bind();
    const get = (path: string, extra: Record<string, string> = {}) => fetch(`http://127.0.0.1:${t.proxy.port}/${a.slot}/openai/v1/models${path}`, { headers: { authorization: `Bearer ${a.token}`, ...extra } });
    const leaking = [get("?q=HIDDEN-FACT-42"), get("?q=HIDDEN%2DFACT%2D42"), get("?q=K=V&W+X"), get("?q=K%3DV%26W%2BX"), get("/HIDDEN-FACT-42"), get("/HIDDEN%2DFACT%2D42"), get("", { "x-note": "HIDDEN-FACT-42" }), get("", { "x-note": "HIDDEN%2DFACT%2D42" }), get("/%ZZHIDDEN%2DFACT%2D42"), get("", { "x-note": "%ZZ HIDDEN%2DFACT%2D42" })];
    for (const res of await Promise.all(leaking)) expect((await expectProblem(res, 403, "E_TRIPWIRE")).detail).not.toContain("HIDDEN-FACT-42");
    expect((await get("?q=fine")).status).toBe(200);
    expect(t.calls).toHaveLength(1);
  });

  test("a journal that cannot be written stops the call with E_INTERNAL, before the send and with no key", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    const proxy = t.proxy as unknown as { journalFd: number | null };
    const fd = proxy.journalFd;
    proxy.journalFd = 2 ** 30;
    const body = await expectProblem(await t.call(a.slot, a.token), 500, "E_INTERNAL");
    proxy.journalFd = fd;
    expect(body.detail).not.toContain(KEY);
    expect(t.calls).toHaveLength(0);
  });

  test("a request-journal failure after reserve gives back the slot's claim and settles the reservation at zero", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    const proxy = t.proxy as unknown as { journalFd: number | null; journal: (line: Record<string, unknown>) => void; slots: Map<string, { committedMicros: number }> };
    const fd = proxy.journalFd;
    const journal = proxy.journal.bind(t.proxy);
    proxy.journal = line => {
      if (line.kind === "request") proxy.journalFd = 2 ** 30;
      journal(line);
    };
    await expectProblem(await t.call(a.slot, a.token), 500, "E_INTERNAL");
    proxy.journalFd = fd;
    expect(t.ledger.settles).toEqual([["res_1", { kind: "spent", spent_micros: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 } }]]);
    expect(proxy.slots.get(a.slot)!.committedMicros).toBe(0);
  });

  test("a request line that is written but not synced reconciles to the spent-0 outcome the call was settled with", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    const proxy = t.proxy as unknown as { journal: (line: Record<string, unknown>) => void };
    const journal = proxy.journal.bind(t.proxy);
    proxy.journal = line => {
      journal(line);
      if (line.kind === "request") throw new Error("EIO: fsync failed");
    };
    await expectProblem(await t.call(a.slot, a.token), 500, "E_INTERNAL");
    expect(t.calls).toHaveLength(0);
    t.proxy.stop();
    expect(await reconcileJournal(join(t.dir, "journal.ndjson"), t.ledger)).toEqual({ settled: ["res_1"], unknown: [], released: [], refused: [], unreadable: 0 });
    expect(t.ledger.reservations.get("res_1")).toMatchObject({ state: "settled", spent_micros: 0 });
  });

  test("a proxy started on a journal torn by a crash starts its first line on a fresh line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u3-journal-"));
    dirs.push(dir);
    const path = join(dir, "journal.ndjson");
    appendFileSync(path, '{"kind":"outcome","reserv');
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), { journal: path });
    const a = t.bind();
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    t.proxy.stop();
    expect(await reconcileJournal(path, new FakeLedger())).toEqual({ settled: ["res_1"], unknown: [], released: [], refused: [], unreadable: 1 });
  });

  test("a failure before the slot check answers E_INTERNAL, not a stack page", async () => {
    const t = setup(() => ok({}));
    const a = t.bind();
    const proxy = t.proxy as unknown as { journalFd: number | null };
    const fd = proxy.journalFd;
    proxy.journalFd = 2 ** 30;
    await expectProblem(await t.call(a.slot, "wrong"), 500, "E_INTERNAL");
    proxy.journalFd = fd;
  });

  test("after a torn journal write the next line starts on its own line, and reconcile skips only the torn one", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    const proxy = t.proxy as unknown as { journalFd: number | null };
    const fd = proxy.journalFd;
    appendFileSync(join(t.dir, "journal.ndjson"), '{"kind":"requ');
    proxy.journalFd = 2 ** 30;
    await t.call(a.slot, "wrong");
    proxy.journalFd = fd;
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    t.proxy.stop();
    const result = await reconcileJournal(join(t.dir, "journal.ndjson"), new FakeLedger());
    expect(result).toEqual({ settled: ["res_1"], unknown: [], released: [], refused: [], unreadable: 1 });
  });

  test("reconcile skips a truncated last line and settles the rest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u3-journal-"));
    dirs.push(dir);
    const path = join(dir, "journal.ndjson");
    appendFileSync(path, `${JSON.stringify({ kind: "request", reservation_id: "res_9" })}\n{"kind":"outcome","reserv`);
    expect(await reconcileJournal(path, new FakeLedger())).toEqual({ settled: [], unknown: ["res_9"], released: [], refused: [], unreadable: 1 });
  });

  test("reconcile settles an outcome whose request line was lost with the journaled outcome", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u3-journal-"));
    dirs.push(dir);
    const path = join(dir, "journal.ndjson");
    const outcome: CallOutcome = { kind: "spent", spent_micros: 1234, usage: { input: 10, output: 5, reasoning: 0, cache_read: 0, cache_write: 0 } };
    appendFileSync(path, `{"kind":"request","reserv\n${JSON.stringify({ kind: "outcome", reservation_id: "res_7", outcome })}\n`);
    const ledger = new FakeLedger();
    expect(await reconcileJournal(path, ledger)).toEqual({ settled: ["res_7"], unknown: [], released: [], refused: [], unreadable: 1 });
    expect(ledger.settles).toEqual([["res_7", outcome]]);
  });

  test("a reserve the ledger recorded but never answered is released at zero by reconcile, so the lease closes with nothing held for it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u3-lost-ack-"));
    dirs.push(dir);
    const local = LocalLedger.open(join(dir, "ledger.sqlite"));
    const lease_id = "gst8.0001.abcdef";
    local.addLease({ schema: 1, kind: "lease", item: "gst8", seq: 1, lease_id, run_id: "r1", machine_id: "m-test", reserved_micros: 5_000_000, expires_at: new Date(Date.now() + 3_600_000).toISOString(), created_at: new Date().toISOString() });
    const reserve = local.reserve.bind(local);
    let lose = 1;
    local.reserve = async request => {
      const reply = await reserve(request);
      if (lose-- > 0) throw new Error("connection reset after the ledger wrote the reservation");
      return reply;
    };
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), { ledger: local as unknown as ReservationLedger, leaseId: lease_id });
    const a = t.bind();
    const body = await expectProblem(await t.call(a.slot, a.token), 503, "E_LEDGER_UNAVAILABLE");
    expect(body.detail).toContain("reconcileJournal releases it at $0");
    expect(t.calls).toHaveLength(0);
    t.proxy.stop();
    const result = await reconcileJournal(join(t.dir, "journal.ndjson"), local);
    expect(result).toMatchObject({ settled: [], unknown: [], refused: [], unreadable: 0 });
    expect(result.released).toHaveLength(1);
    expect(await reconcileJournal(join(t.dir, "journal.ndjson"), local)).toEqual(result);
    expect(local.stageClose(lease_id)).toMatchObject({ spent_micros: 0, unknown_micros: 0, unknown_calls: 0 });
    local.close();
  });

  test("reconcile asks the ledger again only for reserves it never answered", async () => {
    const ledger = new FakeLedger(1);
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }), { ledger });
    const a = t.bind();
    await expectProblem(await t.call(a.slot, a.token), 402, "CAP_STOP");
    const reserves = spyOn(ledger, "reserve");
    t.proxy.stop();
    expect(await reconcileJournal(join(t.dir, "journal.ndjson"), ledger)).toEqual({ settled: [], unknown: [], released: [], refused: [], unreadable: 0 });
    expect(reserves).not.toHaveBeenCalled();
  });

  test("reconcile refuses a journal a running proxy holds, so it cannot release a call the proxy may still send; a second proxy cannot open it either", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind();
    const path = join(t.dir, "journal.ndjson");
    appendFileSync(path, JSON.stringify({ kind: "reserve", idempotency_key: `${a.meter_id}:1:1`, lease_id: "l1", cell: { ...cell, meter_id: a.meter_id }, max_micros: 1000 }) + "\n");
    await expect(reconcileJournal(path, t.ledger)).rejects.toThrow(/^E_USAGE: metering proxy: the journal .* is held by another proxy or reconcile \(process \d+\)/);
    expect(t.ledger.reservations.size).toBe(0);
    expect(() => setup(() => ok({}), { journal: path })).toThrow(/^E_USAGE: metering proxy: the journal .* is held by another proxy or reconcile/);
    t.proxy.stop();
    expect((await reconcileJournal(path, t.ledger)).released).toEqual(["res_1"]);
  });

  test("lock residue a crashed holder left, a takeover guard from an older build included, never blocks the journal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u3-stale-lock-"));
    dirs.push(dir);
    const path = join(dir, "journal.ndjson");
    appendFileSync(path, `${JSON.stringify({ kind: "request", reservation_id: "res_5" })}\n`);
    const dead = String(Bun.spawnSync(["true"]).pid);
    writeFileSync(`${path}.lock`, dead);
    writeFileSync(`${path}.lock.takeover`, `${dead} crashed-taker`);
    expect(await reconcileJournal(path, new FakeLedger())).toEqual({ settled: [], unknown: ["res_5"], released: [], refused: [], unreadable: 0 });
    expect(await reconcileJournal(path, new FakeLedger())).toEqual({ settled: [], unknown: ["res_5"], released: [], refused: [], unreadable: 0 });
  });

  test("the journal lock excludes another process, and a holder killed with SIGKILL releases it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u3-killed-holder-"));
    dirs.push(dir);
    const path = join(dir, "journal.ndjson");
    const script = join(dir, "holder.ts");
    writeFileSync(script, [
      `import { MeteringProxy } from ${JSON.stringify(join(import.meta.dir, "../../src/runner/proxy/metering-proxy.ts"))};`,
      `const unused = async () => { throw new Error("unused"); };`,
      `new MeteringProxy({ ledger: { reserve: unused, settle: unused }, leaseId: "l1", host: "127.0.0.1", managementSocket: ${JSON.stringify(join(dir, "holder.sock"))}, managementToken: ${JSON.stringify(MANAGEMENT)}, journal: ${JSON.stringify(path)}, retry: { attempts: 1, elapsed_ms: 1000 }, env: {} }).start();`,
      `console.log("ready");`,
      `setInterval(() => {}, 1000);`,
    ].join("\n"));
    const holder = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "inherit" });
    expect(new TextDecoder().decode((await holder.stdout.getReader().read()).value)).toContain("ready");
    await expect(reconcileJournal(path, new FakeLedger())).rejects.toThrow(new RegExp(`is held by another proxy or reconcile \\(process ${holder.pid}\\)`));
    holder.kill(9);
    await holder.exited;
    expect(await reconcileJournal(path, new FakeLedger())).toEqual({ settled: [], unknown: [], released: [], refused: [], unreadable: 0 });
  });

  test.skipIf(!existsSync("/dev/full"))("a lock whose holder pid cannot be recorded, as on a full disk, is released, not stranded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u3-full-lock-"));
    dirs.push(dir);
    const path = join(dir, "journal.ndjson");
    appendFileSync(path, "");
    symlinkSync("/dev/full", `${path}.lock`);
    for (let i = 0; i < 2; i++) {
      const error = await reconcileJournal(path, new FakeLedger()).then(() => null, (e: Error) => e);
      expect(error?.message).not.toContain("held by another proxy or reconcile");
      expect(error).not.toBeNull();
    }
  });

  test("a proxy that fails to start after taking the journal lock releases it", async () => {
    const t = setup(() => ok({}));
    const dir = mkdtempSync(join(tmpdir(), "u3-failed-start-"));
    dirs.push(dir);
    const path = join(dir, "journal.ndjson");
    expect(() => setup(() => ok({}), { journal: path, port: t.proxy.port })).toThrow();
    expect(await reconcileJournal(path, new FakeLedger())).toEqual({ settled: [], unknown: [], released: [], refused: [], unreadable: 0 });
  });

  test("finalize over the socket refuses a timeout_ms that is not a non-negative integer", async () => {
    const t = setup(() => ok({}));
    const a = t.bind();
    const res = await fetch("http://localhost/finalize", { unix: join(t.dir, "management.sock"), method: "POST", headers: { "x-gstack-evals-management": MANAGEMENT }, body: JSON.stringify({ meter_id: a.meter_id, timeout_ms: "soon" }) });
    await expectProblem(res, 400, "E_USAGE");
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
    expect(seen.map(line => line.kind)).toEqual(["reserve", "request"]);
    expect(seen[0]).toMatchObject({ kind: "reserve", idempotency_key: `${a.meter_id}:1:1`, lease_id: "l1", cell: { ...cell, meter_id: a.meter_id }, try: 1, source: "127.0.0.1" });
    expect(seen[1]).toMatchObject({ kind: "request", reservation_id: "res_1", idempotency_key: `${a.meter_id}:1:1`, lease_id: "l1", cell: { ...cell, meter_id: a.meter_id }, try: 1, source: "127.0.0.1" });
  });

  test("a settle the ledger refuses is counted as unsettled, and reconcile reports the refusal", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    t.ledger.refuseSettles = 1;
    const a = t.bind();
    expect((await t.call(a.slot, a.token)).status).toBe(200);
    expect((await t.proxy.finalize(a.meter_id)).unsettled).toBe(1);
    const refusing = new FakeLedger();
    refusing.refuseSettles = 1;
    t.proxy.stop();
    const result = await reconcileJournal(join(t.dir, "journal.ndjson"), refusing);
    expect(result).toEqual({ settled: [], unknown: [], released: [], refused: [{ reservation_id: "res_1", code: "CAP_STOP", message: "settle refused" }], unreadable: 0 });
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
    t.proxy.stop();
    const result = await reconcileJournal(path, fresh);
    expect(result).toEqual({ settled: ["res_1"], unknown: ["res_crashed"], released: [], refused: [], unreadable: 0 });
    expect(fresh.settles[0]![1]).toMatchObject({ kind: "spent" });
    expect(fresh.settles[1]).toEqual(["res_crashed", { kind: "unknown" }]);
    expect(t.calls).toHaveLength(1);
  });

  // Added by /ship coverage audit, pass 2.
  // Value: protects=finalize timeout returns undrained>0 and keeps the meter, so the late call is still metered;
  // fails_when=the meter is deleted while calls are still in flight; why_new=only the drained case is tested;
  // seam=none; no_claim=real clock (50 ms timeout)
  test("finalize that times out reports the call still in flight and keeps the meter for it", async () => {
    let release!: () => void;
    let sent!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const reached = new Promise<void>(r => (sent = r));
    const t = setup(async () => {
      sent();
      await gate;
      return ok({ input_tokens: 10, output_tokens: 5 });
    });
    const a = t.bind();
    const pending = t.call(a.slot, a.token);
    await reached;
    const early = await t.proxy.finalize(a.meter_id, 50);
    expect(early.undrained).toBe(1);
    expect(early.requests).toBe(1);
    release();
    expect((await pending).status).toBe(200);
    const late = await t.proxy.finalize(a.meter_id, 50);
    expect(late).toMatchObject({ undrained: 0, requests: 1 });
    expect(late.micros).toBeGreaterThan(0);
    expect(late.by_model["anthropic:claude-opus-5-5"]).toEqual({ micros: late.micros, requests: 1 });
  });
});

test("scrubbedCause walks nested causes and redacts every secret", () => {
  const e = new Error("outer", { cause: new Error("inner gse_abc", { cause: "deepest sk-1" }) });
  expect(scrubbedCause(e, ["gse_abc", "sk-1"])).toBe("outer: inner [redacted]: deepest [redacted]");
});


describe("the per-session meter record (the CEO stage 2 amendment, section 5 and notes F and K)", () => {
  // Value: protects=projection's trip check and the smoke rerun's peak in-flight read come from what the proxy reserved and what the provider reported; fails_when=two calls in flight read as one, a settled call keeps counting as in flight, or the largest prompt, bytes per token or cache-write modes misread; why_new=stage 2 amendment section 5 (two calls in flight trip an allowance early) and carried notes F and K; seam=MeteringProxy.finalize; no_claim=the reservation arithmetic, which the pricing tests cover
  test("two calls held in flight at once read as a peak of two, with both worst cases; usage sets the largest prompt and bytes per token", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>(r => (release = r));
    let n = 0;
    const t = setup(async () => {
      const k = ++n;
      if (k <= 2) await held;
      return k === 1 ? ok({ input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 25, output_tokens: 5 }) : ok({ input_tokens: 10, output_tokens: 5 });
    });
    const a = t.bind({ allowance_micros: 50_000_000 });
    const plain = { model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "hi" }] };
    const cached = { model: "claude-opus-5-5", max_tokens: 1000, system: [{ type: "text", text: "s", cache_control: { type: "ephemeral", ttl: "1h" } }], messages: [{ role: "user", content: "x".repeat(400) }] };
    const first = t.call(a.slot, a.token, undefined, cached);
    const second = t.call(a.slot, a.token, undefined, plain);
    while (t.calls.length < 2) await Bun.sleep(5);
    release();
    expect([(await first).status, (await second).status]).toEqual([200, 200]);
    expect((await t.call(a.slot, a.token, undefined, plain)).status).toBe(200);
    const meter = await t.proxy.finalize(a.meter_id);
    const reserves = t.journal().filter(e => e.kind === "reserve").map(e => e.max_micros as number);
    expect(meter.peak_inflight_calls).toBe(2);
    expect(meter.peak_inflight_micros).toBe(reserves[0]! + reserves[1]!);
    expect(meter.largest_prompt).toBe(175);
    const bytes = t.calls.map(c => Buffer.byteLength(JSON.stringify(c.body)));
    expect(meter.bytes_per_token).toBeCloseTo(Math.max(bytes[0]! / 175, bytes[1]! / 10, bytes[2]! / 10), 9);
    expect(meter.cache_write).toEqual(["none", "1h"]);
  });
  test("a meter whose calls reported no usage keeps null prompt figures, and a refused call reserves nothing", async () => {
    const t = setup(() => new Response("upstream down", { status: 400 }));
    const a = t.bind({ allowance_micros: 30_000 });
    expect((await t.call(a.slot, a.token)).status).toBe(400);
    await expectProblem(await t.call(a.slot, a.token, undefined, { model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "x".repeat(30_000) }] }), 402, "E_ALLOWANCE");
    const meter = await t.proxy.finalize(a.meter_id);
    expect([meter.peak_inflight_calls, meter.largest_prompt, meter.bytes_per_token, meter.cache_write]).toEqual([1, null, null, ["none"]]);
  });
});


describe("free POST routes and the request-shape refusals (containment tightening)", () => {
  const PARTICLE = "particle-ai/particle-1";
  const COUNT = "/anthropic/v1/messages/count_tokens";
  const ESTIMATE = "/openrouter/v1/messages/count_tokens";
  const count = { model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }] };
  const mcpServer = { type: "url", url: "https://mcp.example.com/sse", name: "x" };
  const toolset = { type: "mcp_toolset", mcp_server_name: "x" };
  const shapes: Record<string, unknown>[] = [
    { tools: [{ type: "web_search_20250305", name: "web_search" }] },
    { tools: [{ type: "web_fetch_20250910", name: "web_fetch" }] },
    { tools: [{ type: "code_execution_20250825", name: "code_execution" }] },
    { mcp_servers: [mcpServer], tools: [toolset] },
    { mcp_servers: [] },
    { tools: [toolset] },
    { messages: [{ role: "user", content: [{ type: "document", source: { type: "url", url: "https://example.com/a.pdf" } }] }] },
    { messages: [{ role: "user", content: [{ type: "document", source: { type: "file", file_id: "file_1" } }] }] },
    { messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }] }] },
    { n: 2 },
    { speed: "fast" },
    { inference_geo: "us" },
  ];

  // Value: protects=the free Anthropic count route, which forwards its body to the provider unreserved: a count body can no longer carry a hosted tool, an MCP server or toolset, a remote or stored source, or any other shape the paid route refuses; fails_when=the free route forwards before the shape check, or answers one shape differently from the paid route; why_new=GST-2321; seam=forward's free routes; no_claim=whether Anthropic connects to an MCP server while counting
  test("the free count route refuses every request shape the paid route refuses, before the provider and with the paid route's answer", async () => {
    const t = setup(() => Response.json({ input_tokens: 12 }));
    const a = t.bind();
    for (const shape of shapes) {
      const free = await expectProblem(await t.call(a.slot, a.token, COUNT, { ...count, ...shape }), 402, "E_ALLOWANCE");
      const paid = await expectProblem(await t.call(a.slot, a.token, undefined, { ...count, max_tokens: 1000, ...shape }), 402, "E_ALLOWANCE");
      expect(free.detail).toStartWith("E_ALLOWANCE: metering proxy: unpriced request refused: ");
      expect(free.detail).toBe(paid.detail);
    }
    expect(t.calls).toHaveLength(0);
    expect(t.ledger.reservations.size).toBe(0);
    const refusals = t.journal().filter(l => l.route === "/v1/messages/count_tokens");
    expect(refusals.map(l => [l.kind, l.code])).toEqual(shapes.map(() => ["refusal", "E_ALLOWANCE"]));
    expect((await t.call(a.slot, a.token, COUNT, count)).status).toBe(200);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.raw).toBe(JSON.stringify(count));
    expect(await t.proxy.finalize(a.meter_id)).toMatchObject({ micros: 0, requests: 0, refused: shapes.length * 2 });
  });

  // Value: protects=the free count route sends the provider only the body its checks read, as the paid route does, so a duplicate JSON key cannot hide a hosted tool, an MCP server or a remote source in the copy JSON.parse drops; fails_when=the free route forwards the raw bytes, or the paid route stops sending its checked body; why_new=GST-2321 (Captain's scope addition: forward the checked body); seam=forward's free routes; no_claim=which copy a provider's parser keeps
  test("a duplicate key cannot hide a refused shape from the checks: every checked route forwards the body it checked", async () => {
    const t = setup(url => (url.endsWith("/count_tokens") ? Response.json({ input_tokens: 12 }) : ok({ input_tokens: 10, output_tokens: 5 })));
    const a = t.bind();
    const send = (path: string, text: string) => fetch(`http://127.0.0.1:${t.proxy.port}/${a.slot}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": a.token }, body: text });
    const head = '{"model":"claude-opus-5-5","max_tokens":1000';
    const hidden = [
      head + ',"tools":[{"type":"web_search_20250305","name":"web_search"}],"messages":[{"role":"user","content":"hi"}],"tools":[]}',
      head + ',"messages":[{"role":"user","content":[{"type":"document","source":{"type":"url","url":"https://example.com/a.pdf"},"source":{"type":"text","media_type":"text/plain","data":"x"}}]}]}',
    ];
    for (const text of hidden) {
      for (const path of [COUNT, "/anthropic/v1/messages"]) {
        expect((await send(path, text)).status).toBe(200);
        const out = t.calls.at(-1)!.raw;
        expect(out).not.toMatch(/web_search|example\.com/);
        expect(out).toBe(JSON.stringify({ ...JSON.parse(text), ...(path === COUNT ? {} : { inference_geo: "global" }) }));
      }
    }
    const servers = head + ',"messages":[{"role":"user","content":"hi"}],"mcp_servers":[{"type":"url","url":"https://mcp.example.com/sse","name":"x"}],"mcp_servers":[]}';
    for (const path of [COUNT, "/anthropic/v1/messages"]) await expectProblem(await send(path, servers), 402, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(hidden.length * 2);
  });

  // Value: protects=the OpenRouter count route, answered by the proxy, which gives no count for a body the paid route refuses; fails_when=a refused shape gets an estimate; why_new=GST-2321 (every free POST route); seam=forward's estimate route; no_claim=what OpenRouter does with a count
  test("the estimate route answers no count for a request shape the paid route refuses", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind({ models: [`openrouter:${PARTICLE}`] });
    const body = { ...count, model: PARTICLE };
    const routerShapes: Record<string, unknown>[] = [
      ...shapes.filter(s => s.speed === undefined && s.inference_geo === undefined),
      { plugins: [{ id: "web" }] },
      { web_search_options: {} },
      { tools: [{ type: "openrouter:web_search" }] },
      { messages: [{ role: "user", content: [{ type: "file", file: { filename: "a.pdf", file_data: "https://example.com/a.pdf" } }] }] },
    ];
    for (const shape of routerShapes) await expectProblem(await t.call(a.slot, a.token, ESTIMATE, { ...body, ...shape }), 402, "E_ALLOWANCE");
    expect(t.journal().filter(l => l.estimated)).toHaveLength(0);
    const res = await t.call(a.slot, a.token, ESTIMATE, body);
    expect(await res.json()).toEqual({ input_tokens: Math.ceil(Buffer.byteLength(JSON.stringify(body)) / 4) });
    expect(t.calls).toHaveLength(0);
    expect(t.ledger.reservations.size).toBe(0);
  });

  // Value: protects=the three named refusals on the paid routes: mcp_servers and an mcp_toolset tool on every chat provider, and OpenAI's web_search_options; fails_when=an empty mcp_servers, a toolset with no server URL beside it, or web_search_options on the openai route reaches the provider; why_new=GST-2321 items 2 to 4; seam=refuseRequestShape; no_claim=how the provider would bill them
  test("mcp_servers, an mcp_toolset tool and OpenAI's web_search_options are refused by name on the paid routes", async () => {
    const t = setup(() => ok({ input_tokens: 10, output_tokens: 5 }));
    const a = t.bind({ models: ["anthropic:claude-opus-5-5", "openai:gpt-6.1-sol", `openrouter:${PARTICLE}`] });
    const named: Array<[string, Record<string, unknown>, string]> = [
      ["/anthropic/v1/messages", { ...count, max_tokens: 1000, mcp_servers: [] }, "mcp_servers"],
      ["/anthropic/v1/messages", { ...count, max_tokens: 1000, mcp_servers: [{ type: "url", name: "x" }] }, "mcp_servers"],
      ["/anthropic/v1/messages", { ...count, max_tokens: 1000, tools: [toolset] }, "mcp_toolset"],
      ["/openrouter/v1/messages", { ...count, model: PARTICLE, max_tokens: 1000, mcp_servers: [] }, "mcp_servers"],
      ["/openrouter/v1/chat/completions", { ...count, model: PARTICLE, tools: [toolset] }, "mcp_toolset"],
      ["/openai/v1/chat/completions", { model: "gpt-6.1-sol", messages: [{ role: "user", content: "hi" }], web_search_options: {} }, "web_search_options"],
      ["/openai/v1/responses", { model: "gpt-6.1-sol", input: "hi", web_search_options: { search_context_size: "low" } }, "web_search_options"],
    ];
    for (const [path, body, name] of named) expect((await expectProblem(await t.call(a.slot, a.token, path, body), 402, "E_ALLOWANCE")).detail).toContain(name);
    expect(t.calls).toHaveLength(0);
    for (const [path, body] of named.slice(0, 3)) await expectProblem(await t.call(a.slot, a.token, path.replace("/v1/messages", "/v1/messages/count_tokens"), body), 402, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(0);
  });

  // Value: protects=every refusal that existed before this change: a body refused before keeps its code, status and message, because the named refusals run after every older check; fails_when=a new check runs first and changes an older refusal's message; why_new=GST-2321 (no existing refusal changes); seam=refuseRequestShape's order; no_claim=the order among the new checks
  test("a body refused before the named refusals existed keeps its message", () => {
    const reason = (provider: Parameters<typeof priceRequest>[0], body: Record<string, unknown>) => {
      try {
        priceRequest(provider, body, 1000);
        return "priced";
      } catch (e) {
        return (e as Error).message;
      }
    };
    const msg = { model: "claude-opus-5-5", max_tokens: 1000, messages: [] };
    const remote = "the request uses a remote url, whose cost the proxy cannot bound from the request";
    expect(reason("anthropic", { ...msg, mcp_servers: [mcpServer], tools: [toolset] })).toBe(remote);
    expect(reason("anthropic", { ...msg, tools: [toolset], mcp_servers: [mcpServer] })).toBe(remote);
    expect(reason("anthropic", { ...msg, mcp_servers: [], speed: "fast" })).toBe('speed "fast" bills above the standard rates in the price table');
    expect(reason("anthropic", { ...msg, tools: [toolset], inference_geo: "us" })).toBe('inference_geo "us" may bill above the standard rates in the price table');
    expect(reason("anthropic", { ...msg, n: 3, mcp_servers: [] })).toBe("n=3 asks for several completions, each billed in full");
    expect(reason("openai", { model: "gpt-6.1-sol", messages: [], web_search_options: {}, service_tier: "priority" })).toBe('service_tier "priority" may bill above the standard rates in the price table');
    expect(reason("openai", { model: "gpt-6.1-sol", input: "hi", web_search_options: {}, prompt: { id: "p" } })).toBe("a stored prompt adds input, and may enable hosted tools, that the request does not show");
    expect(reason("openrouter", { model: PARTICLE, messages: [], web_search_options: {} })).toBe("OpenRouter's web_search_options field can reach other models, tiers, stored input or paid tools that the price row does not cover");
    expect(reason("openrouter", { model: PARTICLE, messages: [{ role: "user", content: [{ type: "file", file: { filename: "a.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } }] }], mcp_servers: [] })).toBe("a file part can be fetched from a URL or parsed by paid OCR, which the request's bytes do not bound");
    expect(reason("typesafe", { model: "jev-1.14.0", mcp_servers: [] })).toBe("a System One request with no questions cannot be priced");
  });

  // Value: protects=refuseServerTools leases (the state machines and planning families): a count body with a server tool or mcp_servers still gets E_PROXY_SERVER_TOOL, as before, and the shape refusals apply after it; fails_when=the shape check runs before the lease's own check and changes its code; why_new=GST-2321 (keep #290's refusals as they are); seam=forward's order; no_claim=the paid route, which sm-proxy.test.ts covers
  test("on a refuseServerTools lease a count body with a server tool or mcp_servers still gets E_PROXY_SERVER_TOOL", async () => {
    const t = setup(() => Response.json({ input_tokens: 12 }), { refuseServerTools: true });
    const a = t.bind();
    await expectProblem(await t.call(a.slot, a.token, COUNT, { ...count, tools: [{ type: "web_search_20250305", name: "web_search" }] }), 403, "E_PROXY_SERVER_TOOL");
    await expectProblem(await t.call(a.slot, a.token, COUNT, { ...count, mcp_servers: [mcpServer] }), 403, "E_PROXY_SERVER_TOOL");
    await expectProblem(await t.call(a.slot, a.token, COUNT, { ...count, ...shapes[6] }), 402, "E_ALLOWANCE");
    expect(t.calls).toHaveLength(0);
    expect((await t.call(a.slot, a.token, COUNT, count)).status).toBe(200);
  });

  // Value: protects=honest Claude Code traffic: the shapes Claude Code 2.1.314 sends (captured against a local upstream: per-tool counts from /context with untyped client tools, deferred MCP tools and JSON Schema bodies, and a tool-use turn) and every key Lane B's allow list admits pass the free and paid routes, and a count body is forwarded byte for byte; fails_when=a new check refuses an untyped client tool, a tool named WebFetch or WebSearch, a schema property named url, defer_loading, a system message, thinking, context_management or output_config; why_new=GST-2321 (honest traffic unchanged); seam=refuseRequestShape on the free and paid routes; no_claim=Claude Code versions other than the capture's
  test("Claude Code's own count and message shapes pass both count routes and the paid route unchanged", async () => {
    const t = setup(url => (url.endsWith("/count_tokens") ? Response.json({ input_tokens: 12 }) : sse([{ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } }, { type: "message_delta", usage: { output_tokens: 5 } }])));
    const a = t.bind({ models: ["anthropic:claude-opus-5-5", `openrouter:${PARTICLE}`] });
    const schema = (properties: Record<string, unknown>) => ({ $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties, required: Object.keys(properties).slice(0, 1), additionalProperties: false });
    const tools = [
      { name: "Read", description: "Read a file.", input_schema: schema({ file_path: { type: "string" }, limit: { type: "number" } }) },
      { name: "WebFetch", description: "Fetch a page.", input_schema: schema({ url: { type: "string", format: "uri" }, prompt: { type: "string" } }) },
      { name: "WebSearch", description: "Search the web.", input_schema: schema({ query: { type: "string" }, allowed_domains: { type: "array", items: { type: "string" } } }) },
      { name: "mcp__t__echo", description: "Echo text back", defer_loading: true, input_schema: schema({ text: { type: "string" }, url: { type: "string", description: "optional link" } }) },
    ];
    const counts = [{ model: "claude-opus-5-5", messages: [{ role: "user", content: "x" }], tools: [] }, ...tools.map(tool => ({ model: "claude-opus-5-5", messages: [{ role: "user", content: "x" }], tools: [tool] }))];
    const turn = {
      model: "claude-opus-5-5",
      messages: [
        { role: "user", content: [{ type: "text", text: "Read a.py" }] },
        { role: "system", content: "a reminder" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/w/a.py" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "print(1)" }] },
      ],
      system: [{ type: "text", text: "You are a coding agent." }, { type: "text", text: "Rules.", cache_control: { type: "ephemeral" } }],
      tools,
      tool_choice: { type: "auto" },
      metadata: { user_id: "user_1" },
      max_tokens: 32_000,
      stop_sequences: ["END"],
      temperature: 1,
      top_p: 0.95,
      top_k: 40,
      output_format: { type: "json_schema", schema: schema({ answer: { type: "string" } }) },
      thinking: { type: "adaptive", display: "omitted" },
      context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
      output_config: { effort: "medium" },
      stream: true,
    };
    for (const body of counts) {
      expect((await t.call(a.slot, a.token, COUNT, body)).status).toBe(200);
      expect(t.calls.at(-1)!.raw).toBe(JSON.stringify(body));
      expect((await t.call(a.slot, a.token, ESTIMATE, { ...body, model: PARTICLE })).status).toBe(200);
    }
    expect((await t.call(a.slot, a.token, COUNT, { ...turn, max_tokens: undefined, stream: undefined })).status).toBe(200);
    expect((await t.call(a.slot, a.token, undefined, turn)).status).toBe(200);
    expect(t.calls).toHaveLength(counts.length + 2);
    expect(t.journal().filter(l => l.kind === "refusal")).toHaveLength(0);
  });
  // Value: protects=a refusal that quotes a client value (n, service_tier, speed, inference_geo, a hosted tool type, an OpenRouter server tool type, the mcp_toolset type) gives an honest value the same text as before; fails_when=bounding the quote changes the text an honest value gets; why_new=GST-2321 review (bounded quoting of client values, Captain's A2); seam=refuseRequestShape's reasons; no_claim=values no provider documents
  test("a refusal quotes an honest client value with the same text as before", () => {
    const reason = (provider: Parameters<typeof priceRequest>[0], body: Record<string, unknown>) => {
      try {
        priceRequest(provider, body, 1000);
        return "priced";
      } catch (e) {
        return (e as Error).message;
      }
    };
    const msg = { model: "claude-opus-5-5", max_tokens: 1000, messages: [] };
    const sol = { model: "gpt-6.1-sol", messages: [] };
    const router = { model: PARTICLE, messages: [] };
    const several = "asks for several completions, each billed in full";
    const tier = "may bill above the standard rates in the price table";
    const hosted = (type: string) => `the request uses the hosted tool ${type}, whose cost the proxy cannot bound from the request`;
    const honest: Array<[Parameters<typeof priceRequest>[0], Record<string, unknown>, string]> = [
      ["anthropic", { ...msg, n: 2 }, `n=2 ${several}`],
      ["anthropic", { ...msg, n: "2" }, `n="2" ${several}`],
      ["anthropic", { ...msg, n: 0 }, `n=0 ${several}`],
      ["anthropic", { ...msg, n: null }, `n=null ${several}`],
      ["anthropic", { ...msg, n: true }, `n=true ${several}`],
      ["openai", { ...sol, service_tier: "priority" }, `service_tier "priority" ${tier}`],
      ["openai", { ...sol, service_tier: "flex" }, `service_tier "flex" ${tier}`],
      ["openai", { ...sol, service_tier: "auto" }, `service_tier "auto" ${tier}`],
      ["anthropic", { ...msg, speed: "fast" }, 'speed "fast" bills above the standard rates in the price table'],
      ["anthropic", { ...msg, inference_geo: "us" }, `inference_geo "us" ${tier}`],
      ["anthropic", { ...msg, tools: [{ type: "web_search_20250305", name: "web_search" }] }, hosted("web_search_20250305")],
      ["anthropic", { ...msg, tools: [{ type: "web_fetch_20250910", name: "web_fetch" }] }, hosted("web_fetch_20250910")],
      ["anthropic", { ...msg, tools: [{ type: "code_execution_20250825", name: "code_execution" }] }, hosted("code_execution_20250825")],
      ["openai", { model: "gpt-6.1-sol", input: "hi", tools: [{ type: "web_search_preview_2025_03_11" }] }, hosted("web_search_preview_2025_03_11")],
      ["openai", { model: "gpt-6.1-sol", input: "hi", tools: [{ type: "mcp", server_url: "x" }] }, hosted("mcp")],
      ["openrouter", { ...router, tools: [{ type: "openrouter:web_search" }] }, hosted("openrouter:web_search")],
      ["openrouter", { ...router, tools: [{ type: "openrouter:datetime" }] }, "the OpenRouter server tool openrouter:datetime runs and bills outside the model's tokens"],
      ["anthropic", { ...msg, tools: [toolset] }, "the MCP toolset mcp_toolset has the provider run a remote MCP server's tools, outside the sandbox and the request's bytes"],
    ];
    for (const [provider, body, want] of honest) expect(reason(provider, body)).toBe(want);
  });

  // Value: protects=an unusual client value (a long string, a marker, a newline, an object) never reaches the 402 or the journal through a refusal reason, on the paid and count routes; fails_when=a reason quotes a value that is not a short token of letters, digits and _.-; why_new=GST-2321 review (adversarial finding on echoed client values, Captain's A2); seam=refuseRequestShape's reasons through MeteringProxy.refuse; no_claim=a token-shaped value, which is quoted as written
  test("an unusual client value never reaches the 402 or the journal through a refusal reason", async () => {
    const t = setup(() => Response.json({ input_tokens: 12 }));
    const a = t.bind({ models: ["anthropic:claude-opus-5-5", "openai:gpt-6.1-sol", `openrouter:${PARTICLE}`] });
    const hostile: unknown[] = ["L".repeat(200), "HIDDEN FACT: 42", "line1\nINJECTED", { x: "OBJSECRET" }];
    const never = ["L".repeat(41), "HIDDEN FACT", "INJECTED", "OBJSECRET"];
    const cases: Array<[string, Record<string, unknown>]> = [];
    for (const h of hostile) {
      for (const path of ["/anthropic/v1/messages", COUNT]) {
        const body = { ...count, ...(path === COUNT ? {} : { max_tokens: 1000 }) };
        cases.push([path, { ...body, n: h }], [path, { ...body, speed: h }], [path, { ...body, inference_geo: h }]);
        if (typeof h === "string") cases.push([path, { ...body, tools: [{ type: `web_search_${h}`, name: "w" }] }], [path, { ...body, tools: [{ type: `mcp_toolset${h}` }] }]);
      }
      cases.push(["/openai/v1/chat/completions", { model: "gpt-6.1-sol", messages: [{ role: "user", content: "hi" }], service_tier: h }]);
      if (typeof h === "string") for (const path of ["/openrouter/v1/chat/completions", ESTIMATE]) cases.push([path, { ...count, model: PARTICLE, tools: [{ type: `openrouter:${h}` }] }]);
    }
    for (const [path, body] of cases) {
      const res = await t.call(a.slot, a.token, path, body);
      expect(res.status).toBe(402);
      const text = await res.text();
      for (const s of never) expect(text).not.toContain(s);
    }
    const journal = readFileSync(join(t.dir, "journal.ndjson"), "utf8");
    for (const s of never) expect(journal).not.toContain(s);
    expect(t.journal().filter(l => l.kind === "refusal" && l.code === "E_ALLOWANCE")).toHaveLength(cases.length);
    expect(t.calls).toHaveLength(0);
  });
  // Value: protects=the proxy's own refusals that quote a client value (the allowlist's model, a refuseServerTools lease's tool types and capabilities) give an honest value the same text and journal fields as before; fails_when=bounding the quote changes an honest model id or tool type; why_new=GST-2321 review (Captain's A2, widened to metering-proxy.ts); seam=forward's allowlist and refuseServerTools refusals; no_claim=model ids outside the 1 to 3 segment shape
  test("the proxy's allowlist and server-tool refusals quote an honest value with the same text as before", async () => {
    const plain = setup(() => Response.json({ input_tokens: 12 }));
    const a = plain.bind({ models: ["anthropic:claude-opus-5-5", `openrouter:${PARTICLE}`] });
    const detail = async (t: typeof plain, slot: { slot: string; token: string }, path: string, body: Record<string, unknown>, status: number, code: string) => (await expectProblem(await t.call(slot.slot, slot.token, path, body), status, code)).detail;
    expect(await detail(plain, a, "/anthropic/v1/messages", { ...count, model: "claude-haiku-5-5", max_tokens: 1000 }, 403, "E_ALLOWANCE")).toBe("E_ALLOWANCE: metering proxy: anthropic:claude-haiku-5-5 is not on this slot's model allowlist");
    expect(await detail(plain, a, "/openrouter/v1/chat/completions", { ...count, model: "meta/muse-spark-1.3" }, 403, "E_ALLOWANCE")).toBe("E_ALLOWANCE: metering proxy: openrouter:meta/muse-spark-1.3 is not on this slot's model allowlist");
    expect(await detail(plain, a, "/anthropic/v1/messages", { messages: [], max_tokens: 1000 }, 403, "E_ALLOWANCE")).toBe("E_ALLOWANCE: metering proxy: anthropic:(no model) is not on this slot's model allowlist");
    expect(plain.journal().map(l => l.model)).toEqual(["claude-haiku-5-5", "meta/muse-spark-1.3", null]);
    const sm = setup(() => Response.json({ input_tokens: 12 }), { refuseServerTools: true });
    const b = sm.bind({ models: ["anthropic:claude-opus-5-5", `openrouter:${PARTICLE}`] });
    const lease = "E_PROXY_SERVER_TOOL: metering proxy: provider-side tools are refused on this lease: ";
    expect(await detail(sm, b, "/anthropic/v1/messages", { ...count, max_tokens: 1000, tools: [{ type: "web_search_20250305", name: "web_search" }] }, 403, "E_PROXY_SERVER_TOOL")).toBe(lease + "web_search_20250305");
    expect(await detail(sm, b, COUNT, { ...count, tools: [{ type: "function", name: "f" }, { type: "custom", name: "c" }, { type: "bash_20250124", name: "bash" }] }, 403, "E_PROXY_SERVER_TOOL")).toBe(lease + "function, bash_20250124");
    expect(await detail(sm, b, "/openrouter/v1/chat/completions", { ...count, model: PARTICLE, tools: [{ type: "openrouter:web_search" }] }, 403, "E_PROXY_SERVER_TOOL")).toBe(lease + "openrouter:web_search");
    expect(await detail(sm, b, COUNT, { ...count, mcp_servers: [], plugins: [] }, 403, "E_PROXY_SERVER_TOOL")).toBe("E_PROXY_SERVER_TOOL: metering proxy: provider-side capabilities are refused on this lease: mcp_servers, plugins");
    expect(sm.journal().map(l => l.tools)).toEqual([["web_search_20250305"], ["function", "bash_20250124"], ["openrouter:web_search"], ["mcp_servers", "plugins"]]);
    expect(plain.calls.length + sm.calls.length).toBe(0);
  });

  // Value: protects=an unusual model id or tool type (a long string, a marker-like phrase, a newline, a path of more than 3 segments) never reaches the 403 or the journal through the allowlist or refuseServerTools refusals; fails_when=the proxy quotes a model or tool type that is not a short token; why_new=GST-2321 review (Captain's A2, widened to metering-proxy.ts); seam=forward's allowlist and refuseServerTools refusals; no_claim=a token-shaped value, which is quoted as written
  test("an unusual model id or tool type never reaches the 403 or the journal", async () => {
    const hostile = ["L".repeat(200), "HIDDEN FACT: 42", "line1\nINJECTED", "seg1/seg2/seg3/SEG4X"];
    const never = ["L".repeat(41), "HIDDEN FACT", "INJECTED", "SEG4X"];
    const plain = setup(() => Response.json({ input_tokens: 12 }));
    const a = plain.bind();
    const sm = setup(() => Response.json({ input_tokens: 12 }), { refuseServerTools: true });
    const b = sm.bind({ models: ["anthropic:claude-opus-5-5", `openrouter:${PARTICLE}`] });
    const bodies: string[] = [];
    for (const h of hostile) {
      for (const path of ["/anthropic/v1/messages", COUNT]) {
        bodies.push(await (await plain.call(a.slot, a.token, path, { ...count, model: h, max_tokens: 1000 })).text());
        bodies.push(await (await sm.call(b.slot, b.token, path, { ...count, max_tokens: 1000, tools: [{ type: h }] })).text());
      }
      bodies.push(await (await sm.call(b.slot, b.token, "/openrouter/v1/chat/completions", { ...count, model: PARTICLE, tools: [{ type: `openrouter:${h}` }] })).text());
    }
    const journals = readFileSync(join(plain.dir, "journal.ndjson"), "utf8") + readFileSync(join(sm.dir, "journal.ndjson"), "utf8");
    for (const s of never) {
      for (const body of bodies) expect(body).not.toContain(s);
      expect(journals).not.toContain(s);
    }
    expect(plain.journal().map(l => l.code)).toEqual(hostile.flatMap(() => ["E_ALLOWANCE", "E_ALLOWANCE"]));
    expect(sm.journal().map(l => l.code)).toEqual(hostile.flatMap(() => ["E_PROXY_SERVER_TOOL", "E_PROXY_SERVER_TOOL", "E_PROXY_SERVER_TOOL"]));
    expect(plain.calls.length + sm.calls.length).toBe(0);
  });

  // Value: protects=a DR_ALLOWANCE_STOP slot's non-canary markers never reach a journal line or a refusal's answer, wherever the request puts them (the model, a tool type, a refused field), on the paid and count routes, while the call's stops, codes and allowance stops stay as before; fails_when=a refusal or the marker_hit line quotes a marker the request carried; why_new=GST-2321 review (Captain's A1 on the marker_hit model field); seam=forward's marker_hit line and MeteringProxy.refuse; no_claim=what the provider echoes back in an upstream error
  test("a slot marker the request carries never reaches a journal line or a refusal's answer", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const markers = ["TestParserRegression", "tests/test_hidden_regression_data.py", "x y hidden phrase"];
    const slotOf = (t: ReturnType<typeof setup>) => t.bind({ forbidden_markers: [CANARY, ...markers], canary: CANARY, deciders: ["anthropic:claude-opus-5-5"] });
    const plain = setup(() => Response.json({ input_tokens: 12 }), { allowanceCode: "DR_ALLOWANCE_STOP" });
    const sm = setup(() => Response.json({ input_tokens: 12 }), { allowanceCode: "DR_ALLOWANCE_STOP", refuseServerTools: true });
    const a = slotOf(plain);
    const b = slotOf(sm);
    const answers: Array<[number, string]> = [];
    for (const marker of markers) {
      for (const path of ["/anthropic/v1/messages", COUNT]) {
        const body = { ...count, ...(path === COUNT ? {} : { max_tokens: 1000 }) };
        for (const sent of [{ ...body, model: marker }, { ...body, model: `x ${marker}` }, { ...body, speed: marker }, { ...body, inference_geo: marker }, { ...body, tools: [{ type: `web_search_${marker}` }] }]) {
          const res = await plain.call(a.slot, a.token, path, sent);
          answers.push([res.status, await res.text()]);
        }
        const res = await sm.call(b.slot, b.token, path, { ...body, tools: [{ type: marker }] });
        answers.push([res.status, await res.text()]);
      }
    }
    const journals = readFileSync(join(plain.dir, "journal.ndjson"), "utf8") + readFileSync(join(sm.dir, "journal.ndjson"), "utf8");
    for (const marker of markers) {
      for (const [, text] of answers) expect(text).not.toContain(marker);
      expect(journals).not.toContain(marker);
    }
    expect(answers.map(([status]) => status)).toEqual(markers.flatMap(() => [403, 403, 402, 402, 402, 403, 403, 403, 402, 402, 402, 403]));
    const lines = [...plain.journal(), ...sm.journal()];
    expect(lines.filter(l => l.kind === "marker_hit")).toHaveLength(answers.length);
    expect(lines.filter(l => l.kind === "refusal").map(l => l.code).sort()).toEqual(markers.flatMap(() => [...Array(4).fill("E_ALLOWANCE"), ...Array(6).fill("E_ALLOWANCE"), "E_PROXY_SERVER_TOOL", "E_PROXY_SERVER_TOOL"]).sort());
    expect(plain.calls.length + sm.calls.length).toBe(0);
    expect(await plain.proxy.finalize(a.meter_id)).toMatchObject({ allowance_stops: 0 });
  });

  // Value: protects=a DR_ALLOWANCE_STOP slot whose markers nest (one a prefix of another) or overlap leaves no piece of either marker in a refusal's answer or its journal line, wherever the request puts the value (the model, a field, a hosted, server or OpenRouter tool type) on the paid, count and estimate routes; fails_when=the shorter marker is masked first and the longer one's tail stays, or one of two overlapping markers is masked and the rest of the other stays; why_new=#313's open note on nested markers; seam=quoteClientValue's marker masking (maskMarkers) through MeteringProxy.refuse; no_claim=the marker_hit line, which journals a model that holds a marker as <unquoted>
  test("nested or overlapping slot markers leave no piece of either marker in a refusal", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const SHORT = "authx";
    const LONG = "authx_rejects_expired_token";
    const LEFT = "parser_case";
    const RIGHT = "case_hidden_row";
    const BOTH = "parser_case_hidden_row";
    const plain = setup(() => Response.json({ input_tokens: 12 }), { allowanceCode: "DR_ALLOWANCE_STOP" });
    const sm = setup(() => Response.json({ input_tokens: 12 }), { allowanceCode: "DR_ALLOWANCE_STOP", refuseServerTools: true });
    const slot = { models: ["anthropic:claude-opus-5-5", `openrouter:${PARTICLE}`], forbidden_markers: [CANARY, SHORT, LONG, LEFT, RIGHT], canary: CANARY };
    const a = plain.bind(slot);
    const b = sm.bind(slot);
    const detail = async (t: typeof plain, s: { slot: string; token: string }, path: string, body: Record<string, unknown>, status: number, code: string) => (await expectProblem(await t.call(s.slot, s.token, path, body), status, code)).detail;
    const unpriced = "E_ALLOWANCE: metering proxy: unpriced request refused: ";
    for (const path of ["/anthropic/v1/messages", COUNT]) {
      const body = { ...count, ...(path === COUNT ? {} : { max_tokens: 1000 }) };
      expect(await detail(plain, a, path, { ...body, speed: LONG }, 402, "E_ALLOWANCE")).toBe(`${unpriced}speed "<unquoted>" bills above the standard rates in the price table`);
      expect(await detail(plain, a, path, { ...body, inference_geo: BOTH }, 402, "E_ALLOWANCE")).toBe(`${unpriced}inference_geo "<unquoted>" may bill above the standard rates in the price table`);
      expect(await detail(plain, a, path, { ...body, n: `${LONG}.v2` }, 402, "E_ALLOWANCE")).toBe(`${unpriced}n="<unquoted>.v2" asks for several completions, each billed in full`);
      expect(await detail(plain, a, path, { ...body, tools: [{ type: `web_search_${BOTH}`, name: "w" }] }, 402, "E_ALLOWANCE")).toBe(`${unpriced}the request uses the hosted tool web_search_<unquoted>, whose cost the proxy cannot bound from the request`);
      expect(await detail(plain, a, path, { ...body, model: `acme/${LONG}` }, 403, "E_ALLOWANCE")).toBe("E_ALLOWANCE: metering proxy: anthropic:acme/<unquoted> is not on this slot's model allowlist");
      expect(await detail(sm, b, path, { ...body, tools: [{ type: BOTH, name: "x" }] }, 403, "E_PROXY_SERVER_TOOL")).toBe("E_PROXY_SERVER_TOOL: metering proxy: provider-side tools are refused on this lease: <unquoted>");
    }
    for (const path of ["/openrouter/v1/chat/completions", ESTIMATE]) expect(await detail(plain, a, path, { ...count, model: PARTICLE, tools: [{ type: `openrouter:${LONG}` }] }, 402, "E_ALLOWANCE")).toBe(`${unpriced}the OpenRouter server tool openrouter:<unquoted> runs and bills outside the model's tokens`);
    const journals = readFileSync(join(plain.dir, "journal.ndjson"), "utf8") + readFileSync(join(sm.dir, "journal.ndjson"), "utf8");
    for (const piece of [LONG, RIGHT, "_rejects_expired_token", "_hidden_row", "parser_"]) expect(journals).not.toContain(piece);
    const refusals = [...plain.journal(), ...sm.journal()].filter(l => l.kind === "refusal");
    expect(refusals.map(l => l.model)).toEqual([...Array(2).fill(["claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5", "acme/<unquoted>"]).flat(), PARTICLE, PARTICLE, "claude-opus-5-5", "claude-opus-5-5"]);
    expect(refusals.filter(l => l.code === "E_PROXY_SERVER_TOOL").map(l => l.tools)).toEqual([["<unquoted>"], ["<unquoted>"]]);
    expect([...plain.journal(), ...sm.journal()].filter(l => l.kind === "marker_hit")).toHaveLength(refusals.length);
    expect(plain.calls.length + sm.calls.length).toBe(0);
  });

  // Value: protects=on a request that carried slot markers, a refusal masks only the client values it quotes: markers that are words of the proxy's own text (model, price, lease, tokens, plugins) or a piece of the <unquoted> placeholder leave every answer and every refusal line's reason, model and tools exactly as a slot without markers gets them; fails_when=a refusal masks its whole reason, so "this slot's model allowlist", "the price table", a refused capability's name or the placeholder itself changes; why_new=#313's open review finding at metering-proxy.ts:579; seam=MeteringProxy.refuse and the quoting sites in forward and prices.ts; no_claim=a marker inside a quoted client value, which the nested-marker test covers
  test("a slot marker masks only the client values a refusal quotes, never the proxy's text or the placeholder", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const words = ["model", "price", "lease", "tokens", "plugins", "quot"];
    const said = [{ role: "user", content: words.join(" ") }];
    const sends: Array<[string, Record<string, unknown>]> = [
      ["/anthropic/v1/messages", { model: "claude-haiku-5-5", max_tokens: 1000, messages: said }],
      ["/anthropic/v1/messages", { model: "x y", max_tokens: 1000, messages: said }],
      ["/anthropic/v1/messages", { model: "claude-opus-5-5", max_tokens: 1000, speed: "fast", messages: said }],
      [COUNT, { model: "claude-opus-5-5", tools: [{ type: "web_search_20250305", name: "web_search" }], messages: said }],
      [COUNT, { model: "claude-opus-5-5", plugins: [], messages: said }],
      ["/anthropic/v1/messages", { model: "claude-opus-5-5", max_tokens: 999_999, messages: said }],
    ];
    const run = async (markers: string[]) => {
      const t = setup(() => Response.json({ input_tokens: 12 }), { allowanceCode: "DR_ALLOWANCE_STOP", refuseServerTools: true, maxOutputTokens: 4096 });
      const s = t.bind(markers.length ? { forbidden_markers: [CANARY, ...markers], canary: CANARY } : {});
      const answers: string[] = [];
      for (const [path, body] of sends) {
        const res = await t.call(s.slot, s.token, path, body);
        answers.push(`${res.status} ${await res.text()}`);
      }
      const lines = t.journal();
      expect(t.calls).toHaveLength(0);
      return { answers, hits: lines.filter(l => l.kind === "marker_hit").length, refusals: lines.filter(l => l.kind === "refusal").map(({ code, model, reason, tools }) => ({ code, model, reason, tools })) };
    };
    const marked = await run(words);
    const unmarked = await run([]);
    expect(marked.hits).toBe(sends.length);
    expect(unmarked.hits).toBe(0);
    expect(marked.refusals.map(l => l.reason)).toEqual([
      "anthropic:claude-haiku-5-5 is not on this slot's model allowlist",
      "anthropic:<unquoted> is not on this slot's model allowlist",
      'unpriced request refused: speed "fast" bills above the standard rates in the price table',
      "provider-side tools are refused on this lease: web_search_20250305",
      "provider-side capabilities are refused on this lease: plugins",
      "the request asks for 999999 output tokens, above this cell's cap of 4096",
    ]);
    expect(marked.refusals.map(l => l.model)).toEqual(["claude-haiku-5-5", "<unquoted>", "claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5"]);
    expect(marked.refusals).toEqual(unmarked.refusals);
    expect(marked.answers).toEqual(unmarked.answers);
  });

  // Value: protects=an OpenRouter model id with one :suffix token on its last segment (particle-ai/particle-1:online) is quoted as written in the allowlist refusal, its journal line and the marker_hit line, while a second colon, a colon before the last segment, an empty or over-long suffix, or a fourth segment still reads <unquoted>; fails_when=the model form refuses a :suffix, or accepts a colon anywhere else; why_new=#313's open review finding at prices.ts:153; seam=quoteClientValue's model form; no_claim=which suffixes OpenRouter serves
  test("a model id with one :suffix token on its last segment is quoted as written", async () => {
    for (const id of [`${PARTICLE}:online`, `${PARTICLE}:free`, "a:b", "a/b/c:d"]) expect(quoteClientValue(id, "model")).toBe(id);
    for (const id of ["a:b:c", "a:b/c", "a/b:c/d", "a/b:", ":b", `a/b:${"s".repeat(41)}`, "a/b/c/d:e", "a/b: c", "a/b:c d"]) expect(quoteClientValue(id, "model")).toBe("<unquoted>");
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const MARK = "SEALED-MARKER-7f3a9c";
    const t = setup(() => Response.json({ input_tokens: 12 }), { allowanceCode: "DR_ALLOWANCE_STOP" });
    const a = t.bind({ models: [`openrouter:${PARTICLE}`], forbidden_markers: [CANARY, MARK], canary: CANARY });
    const res = await t.call(a.slot, a.token, "/openrouter/v1/chat/completions", { model: `${PARTICLE}:online`, messages: [{ role: "user", content: MARK }] });
    expect((await expectProblem(res, 403, "E_ALLOWANCE")).detail).toBe(`E_ALLOWANCE: metering proxy: openrouter:${PARTICLE}:online is not on this slot's model allowlist`);
    expect(t.journal().map(l => [l.kind, l.model])).toEqual([["marker_hit", `${PARTICLE}:online`], ["refusal", `${PARTICLE}:online`]]);
    expect(t.calls).toHaveLength(0);
  });

  // Value: protects=the route-not-allowlisted refusal quotes the request path through quoteClientValue: an honest path (extra segments, a doubled or trailing slash) keeps its text in the 403 and the journal, an unusual one (a segment past 64 characters, a percent escape, more than 8 segments) reads <unquoted>, and a marker in the path (plain, nested, or percent-encoded) is masked on any proxy, in the tripwire's E_TRIPWIRE line for a proxy-wide marker too, while the refusal keeps its place before the key check, its 403 and its E_ALLOWANCE; fails_when=the refusal echoes the raw path, so a marker or a long string reaches the answer or the journal's reason or route field; why_new=the route echo the outside review of #313 left (Captain's ruling to fold it into this PR); seam=forward's route allowlist refusal; no_claim=the E_SLOT_DENIED path refusal, which runs before any slot is known
  test("the route refusal quotes the path, masking any marker in it, in the 403 and the journal", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const SHORT = "authx";
    const LONG = "authx_rejects_expired_token";
    const MARK = "SEALED-MARKER-7f3a9c";
    const WIDE = "PROXY-WIDE-MARKER-0042";
    const reason = (path: string) => `E_ALLOWANCE: metering proxy: route POST /anthropic${path} is not allowlisted`;
    const send = async (t: ReturnType<typeof setup>, s: { slot: string; token: string }, path: string) => (await expectProblem(await t.call(s.slot, s.token, `/anthropic${path}`, { ...count, max_tokens: 1000 }), 403, "E_ALLOWANCE")).detail;
    const honest = ["/v1/nope", "/v1/messages/batches", "/api/event_logging/batch", "//v1/messages", "/v1/messages/", "/v1.2/a_b/c-d", "/v1/responses/resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b/input_items"];
    const unusual = [`/v1/${"L".repeat(65)}`, "/v1/a%20b", "/a/b/c/d/e/f/g/h/i", "/v1/a:b"];
    const plain = setup(() => Response.json({}), { env: {}, forbiddenMarkers: [WIDE] });
    const p = plain.bind({ forbidden_markers: [MARK] });
    for (const path of honest) expect(await send(plain, p, path)).toBe(reason(path));
    for (const path of unusual) expect(await send(plain, p, path)).toBe(reason("<unquoted>"));
    expect(await send(plain, p, `/v1/${MARK}`)).toBe(reason("/v1/<unquoted>"));
    expect(await send(plain, p, `/v1/${WIDE}/x`)).toBe(reason("/v1/<unquoted>/x"));
    expect(plain.journal().map(l => [l.kind, l.code, l.route])).toEqual([...honest.map(r => ["refusal", "E_ALLOWANCE", r]), ...unusual.map(() => ["refusal", "E_ALLOWANCE", "<unquoted>"]), ["refusal", "E_ALLOWANCE", "/v1/<unquoted>"], ["refusal", "E_TRIPWIRE", "/v1/<unquoted>/x"], ["refusal", "E_ALLOWANCE", "/v1/<unquoted>/x"]]);
    const dr = setup(() => Response.json({}), { env: {}, allowanceCode: "DR_ALLOWANCE_STOP" });
    const d = dr.bind({ forbidden_markers: [CANARY, SHORT, LONG, MARK], canary: CANARY });
    expect(await send(dr, d, `/v1/${LONG}`)).toBe(reason("/v1/<unquoted>"));
    expect(await send(dr, d, `/v1/x-${MARK}-y/z`)).toBe(reason("/v1/x-<unquoted>-y/z"));
    expect(await send(dr, d, `/v1/%53EALED-MARKER-7f3a9c`)).toBe(reason("<unquoted>"));
    expect(dr.journal().filter(l => l.kind === "refusal").map(l => [l.code, l.route, l.reason])).toEqual([
      ["E_ALLOWANCE", "/v1/<unquoted>", "route POST /anthropic/v1/<unquoted> is not allowlisted"],
      ["E_ALLOWANCE", "/v1/x-<unquoted>-y/z", "route POST /anthropic/v1/x-<unquoted>-y/z is not allowlisted"],
      ["E_ALLOWANCE", "<unquoted>", "route POST /anthropic<unquoted> is not allowlisted"],
    ]);
    const journals = readFileSync(join(plain.dir, "journal.ndjson"), "utf8") + readFileSync(join(dr.dir, "journal.ndjson"), "utf8");
    for (const piece of [MARK, WIDE, LONG, "_rejects_expired_token", "EALED-MARKER", "L".repeat(65)]) expect(journals).not.toContain(piece);
    expect(plain.calls.length + dr.calls.length).toBe(0);
  });

  const journalCheck = (dir: string) => {
    const out = join(dir, "batch");
    mkdirSync(join(out, "journals"), { recursive: true });
    writeFileSync(join(out, "journals", "dr-x.ndjson"), readFileSync(join(dir, "journal.ndjson")));
    return runBatch({ plan: [{ item: "dr-x" }], out, proxyHost: "127.0.0.1", temp: true } as unknown as BatchOptions);
  };

  // Value: protects=a canary in a refused route's path on a DR_ALLOWANCE_STOP proxy writes the line the tripwire writes for a canary in a body (a DR_CUSTODY_HIT refusal line with the slot's cell, each marker's index and sha256 prefix, no model and the same reason) on the masked path, so the decision-routing controller's journal check stops on it, and writes no marker_hit line for it, while the call is still answered 403 E_ALLOWANCE and the meter counts one E_ALLOWANCE refusal; fails_when=a canary in a refused path is journaled as a marker_hit line or not at all, the controller's journal check passes, or the custody line carries the raw path; why_new=Captain's ruling on #315 (a canary in a refused path counts as a canary); seam=forward's route allowlist refusal and the controller's pre-launch journal check; no_claim=the controller's in-run stop, which reads the same line and tests/decision-routing covers
  test("a canary in a refused route's path writes the tripwire's custody line and no marker_hit, so the journal check stops, and the call is still refused E_ALLOWANCE", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const MARK = "SEALED-MARKER-7f3a9c";
    const sha = (m: string) => createHash("sha256").update(m).digest("hex").slice(0, 12);
    const t = setup(() => Response.json({}), { allowanceCode: "DR_ALLOWANCE_STOP" });
    const s = t.bind({ forbidden_markers: [CANARY, MARK], canary: CANARY });
    for (const path of [`/v1/${CANARY}`, `/v1/${MARK}/x-${CANARY}`]) await expectProblem(await t.call(s.slot, s.token, `/anthropic${path}`, { ...count, max_tokens: 1000 }), 403, "E_ALLOWANCE");
    const custody = (route: string, markers: Array<[number, string]>) => ({ kind: "refusal", code: "DR_CUSTODY_HIT", meter_id: s.meter_id, provider: "anthropic", route, model: null, reason: `the request carries ${markers.length} runner-only marker(s); custody hit, the run stops`, source: "127.0.0.1", cell, markers: markers.map(([index, m]) => ({ index, sha256: sha(m) })) });
    const lines = t.journal().map(({ at, ...l }) => l);
    expect(lines.map(l => (l.kind === "refusal" ? l.code : l.kind))).toEqual(["DR_CUSTODY_HIT", "E_ALLOWANCE", "DR_CUSTODY_HIT", "E_ALLOWANCE"]);
    expect(lines.filter(l => l.code === "DR_CUSTODY_HIT")).toEqual([custody("/v1/<unquoted>", [[0, CANARY]]), custody("/v1/<unquoted>/x-<unquoted>", [[0, CANARY], [1, MARK]])]);
    const u = setup(() => Response.json({}), { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = u.bind({ forbidden_markers: [CANARY, MARK], canary: CANARY });
    await expectProblem(await u.call(b.slot, b.token, "/anthropic/v1/messages", { ...count, max_tokens: 1000, messages: [{ role: "user", content: CANARY }] }), 403, "DR_CUSTODY_HIT");
    const tripwire = u.journal().map(({ at, ...l }) => l)[0]!;
    expect(Object.keys(lines[0]!)).toEqual(Object.keys(tripwire));
    expect({ ...lines[0], meter_id: b.meter_id, route: "/v1/messages" }).toEqual(tripwire);
    const journal = readFileSync(join(t.dir, "journal.ndjson"), "utf8");
    for (const piece of [CANARY, MARK, "00112233445566778899"]) expect(journal).not.toContain(piece);
    await expect(journalCheck(t.dir)).rejects.toThrow(new RegExp(`^DR_CUSTODY_HIT: the journal .* holds a custody hit \\(meter ${s.meter_id}\\)`));
    expect(await t.proxy.finalize(s.meter_id)).toMatchObject({ refused: 2, refusals: ["E_ALLOWANCE"], allowance_stops: 0 });
    expect(t.calls.length + u.calls.length).toBe(0);
  });

  // Value: protects=any other slot marker in a refused route's path on a DR_ALLOWANCE_STOP proxy is recorded as a marker_hit line (the slot's cell and each marker's index and sha256 prefix, the masked path, no model) right before the 403 E_ALLOWANCE, never as a custody line, so the controller's journal check passes; a path with no marker records none, a proxy without DR_ALLOWANCE_STOP records none for a slot marker, and a proxy-wide marker writes the tripwire's E_TRIPWIRE line instead of a marker_hit line; fails_when=a marker in a non-allowlisted path skips the tripwire and leaves no marker_hit line, the line carries the raw path, or a non-canary marker writes a custody line that stops the run; why_new=Captain's ruling on #315 (the route echo also hid the containment signal, and a non-canary marker never counts as a canary); seam=forward's route allowlist refusal and its marker_hit line; no_claim=none
  test("any other slot marker in a refused route's path writes a marker_hit line only, before the refusal, and the journal check passes", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const MARK = "SEALED-MARKER-7f3a9c";
    const OTHER = "tests/test_hidden_regression_data.py";
    const WIDE = "PROXY-WIDE-MARKER-0042";
    const sha = (m: string) => createHash("sha256").update(m).digest("hex").slice(0, 12);
    const t = setup(() => Response.json({}), { allowanceCode: "DR_ALLOWANCE_STOP", forbiddenMarkers: [WIDE] });
    const s = t.bind({ forbidden_markers: [CANARY, MARK, OTHER], canary: CANARY });
    for (const path of [`/v1/${MARK}`, "/v1/nope", `/v1/%53EALED-MARKER-7f3a9c/${encodeURIComponent(OTHER)}`, `/v1/${WIDE}`]) await expectProblem(await t.call(s.slot, s.token, `/anthropic${path}`, { ...count, max_tokens: 1000 }), 403, "E_ALLOWANCE");
    const hit = (route: string, markers: Array<[number, string]>) => ({ kind: "marker_hit", meter_id: s.meter_id, provider: "anthropic", route, model: null, source: "127.0.0.1", decider: false, cell, markers: markers.map(([index, m]) => ({ index, sha256: sha(m) })) });
    const lines = t.journal().map(({ at, ...l }) => l);
    expect(lines.filter(l => l.kind === "marker_hit")).toEqual([hit("/v1/<unquoted>", [[1, MARK]]), hit("<unquoted>", [[1, MARK], [2, OTHER]])]);
    expect(lines.map(l => (l.kind === "refusal" ? l.code : l.kind))).toEqual(["marker_hit", "E_ALLOWANCE", "E_ALLOWANCE", "marker_hit", "E_ALLOWANCE", "E_TRIPWIRE", "E_ALLOWANCE"]);
    await expect(journalCheck(t.dir)).rejects.toThrow(/^E_USAGE: --temp needs --fake-upstreams/);
    const plain = setup(() => Response.json({}));
    const q = plain.bind({ forbidden_markers: [MARK] });
    await expectProblem(await plain.call(q.slot, q.token, `/anthropic/v1/${MARK}`, { ...count, max_tokens: 1000 }), 403, "E_ALLOWANCE");
    expect(plain.journal().map(l => [l.kind, l.code, l.route])).toEqual([["refusal", "E_ALLOWANCE", "/v1/<unquoted>"]]);
    expect(await t.proxy.finalize(s.meter_id)).toMatchObject({ refused: 4, refusals: ["E_ALLOWANCE"], allowance_stops: 0 });
    expect(t.calls.length + plain.calls.length).toBe(0);
  });

  // Value: protects=an allowlisted path that holds a marker (GET /v1/models/<id>) is journaled in the path form in every line the call writes (the marker_hit and free lines on a DR_ALLOWANCE_STOP proxy, the tripwire's custody line for a canary, and the E_TRIPWIRE refusal for a proxy-wide marker on any proxy), while the call is forwarded and answered as before, and an honest path, or a marker outside the path, leaves the path's text as it was; fails_when=a journal line carries the raw path or a piece of a marker; why_new=Captain's ruling on #315; seam=forward's path masking for allowlisted routes, before the key check; no_claim=a non-2xx upstream answer that echoes the id, which the free line's upstream_body does not scrub for a GET
  test("an allowlisted models path that holds a marker is journaled in the path form in every line", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const MARK = "SEALED-MARKER-7f3a9c";
    const WIDE = "PROXY-WIDE-MARKER-0042";
    const t = setup(() => Response.json({ id: "m" }), { allowanceCode: "DR_ALLOWANCE_STOP", forbiddenMarkers: [WIDE] });
    const s = t.bind({ forbidden_markers: [CANARY, MARK], canary: CANARY });
    const get = (w: ReturnType<typeof setup>, b: { slot: string; token: string }, path: string, extra: Record<string, string> = {}) => fetch(`http://127.0.0.1:${w.proxy.port}/${b.slot}/anthropic/v1/models${path}`, { headers: { "x-api-key": b.token, ...extra } });
    const ids = [`/${MARK}`, `/x-${MARK}`, "/claude-opus-5-5", "/%53EALED-MARKER-7f3a9c"];
    for (const path of ids) expect((await get(t, s, path)).status).toBe(200);
    expect((await get(t, s, "/claude-opus-5-5", { "x-note": MARK })).status).toBe(200);
    await expectProblem(await get(t, s, `/${CANARY}`), 403, "DR_CUSTODY_HIT");
    expect((await expectProblem(await get(t, s, `/${WIDE}`), 403, "E_TRIPWIRE")).detail).toBe("E_TRIPWIRE: metering proxy: the request carries 1 forbidden marker(s); the cell is invalid");
    expect(t.journal().map(l => [l.kind === "refusal" ? l.code : l.kind, l.route])).toEqual([
      ["marker_hit", "/v1/models/<unquoted>"],
      ["free", "/v1/models/<unquoted>"],
      ["marker_hit", "/v1/models/x-<unquoted>"],
      ["free", "/v1/models/x-<unquoted>"],
      ["free", "/v1/models/claude-opus-5-5"],
      ["marker_hit", "<unquoted>"],
      ["free", "<unquoted>"],
      ["marker_hit", "/v1/models/claude-opus-5-5"],
      ["free", "/v1/models/claude-opus-5-5"],
      ["DR_CUSTODY_HIT", "/v1/models/<unquoted>"],
      ["E_TRIPWIRE", "/v1/models/<unquoted>"],
    ]);
    const plain = setup(() => Response.json({ id: "m" }), { forbiddenMarkers: [WIDE] });
    const p = plain.bind();
    await expectProblem(await get(plain, p, `/${WIDE}`), 403, "E_TRIPWIRE");
    expect(plain.journal().map(l => [l.code, l.route])).toEqual([["E_TRIPWIRE", "/v1/models/<unquoted>"]]);
    const journals = readFileSync(join(t.dir, "journal.ndjson"), "utf8") + readFileSync(join(plain.dir, "journal.ndjson"), "utf8");
    for (const piece of [CANARY, MARK, WIDE, "EALED-MARKER"]) expect(journals).not.toContain(piece);
    expect(t.calls.map(c => c.url)).toEqual([...ids, "/claude-opus-5-5"].map(path => `https://api.anthropic.com/v1/models${path}`));
    expect(plain.calls).toHaveLength(0);
  });

  // Value: protects=a slot denial quotes an unmatched path through the path form (an honest path keeps its text, an unusual one becomes <unquoted>) and masks the proxy-wide markers and every open slot's markers in that path and in the slot id it quotes, in the 403 and the journal, while every denial stays a 403 E_SLOT_DENIED; fails_when=a denial echoes a marker, or an unmatched path's raw text past the path form; why_new=Captain's ruling on #315; seam=handle's E_SLOT_DENIED refusal; no_claim=a custody line for a canary in a denied path, since no slot's tripwire runs on a denied call
  test("a slot denial quotes an unmatched path in the path form and masks every open slot's markers, in the 403 and the journal", async () => {
    const MARK = "SEALED-MARKER-7f3a9c";
    const WIDE = "PROXY-WIDE-MARKER-0042";
    const t = setup(() => Response.json({}), { forbiddenMarkers: [WIDE] });
    const s = t.bind({ forbidden_markers: [MARK] });
    const cases: Array<[string, string | null, string | null, string]> = [
      ["/nope/v1/messages", null, null, "no provider route /nope/v1/messages"],
      [`/x/${MARK}/y`, null, null, "no provider route /x/<unquoted>/y"],
      [`/x-${WIDE}`, null, null, "no provider route /x-<unquoted>"],
      ["/a%20b", null, null, "no provider route <unquoted>"],
      ["/a/b/c/d/e/f/g/h/i", null, null, "no provider route <unquoted>"],
      [`/${MARK}/anthropic/v1/messages`, s.token, "<unquoted>", "slot <unquoted> is not open"],
      ["/s_unknown/anthropic/v1/messages", s.token, "s_unknown", "slot s_unknown is not open"],
      [`/${s.slot}/anthropic/v1/messages`, "wrong", s.slot, `the credential presented is not slot ${s.slot}'s bearer`],
    ];
    for (const [path, credential, , reason] of cases) {
      const res = await fetch(`http://127.0.0.1:${t.proxy.port}${path}`, { headers: credential ? { "x-api-key": credential } : {} });
      expect((await expectProblem(res, 403, "E_SLOT_DENIED")).detail).toBe(`E_SLOT_DENIED: metering proxy: ${reason}`);
    }
    expect(t.journal().map(l => [l.code, l.slot, l.reason])).toEqual(cases.map(([, , slot, reason]) => ["E_SLOT_DENIED", slot, reason]));
    expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toMatch(/SEALED|PROXY-WIDE/);
    expect(t.calls).toHaveLength(0);
  });

  const PLACES = ["path", "body", "query", "headers"] as const;
  type Place = (typeof PLACES)[number];
  type Riders = { path?: string; content?: string; query?: string; header?: string };
  const rider = (place: Place, marker: string): Riders => (place === "path" ? { path: `/v1/nope-${marker}` } : place === "body" ? { content: `context ${marker}` } : place === "query" ? { query: marker } : { header: marker });
  const refused = (t: ReturnType<typeof setup>, s: { slot: string; token: string }, at: Riders) =>
    fetch(`http://127.0.0.1:${t.proxy.port}/${s.slot}/anthropic${at.path ?? "/v1/nope"}${at.query ? `?note=${encodeURIComponent(at.query)}` : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": s.token, ...(at.header ? { "x-note": at.header } : {}) },
      body: JSON.stringify({ ...count, max_tokens: 1000, messages: [{ role: "user", content: at.content ?? "hi" }] }),
    });
  const routeAnswer = (route: string) => problem("E_ALLOWANCE", 403, `route POST /anthropic${route} is not allowlisted`).text();
  const shortSha = (m: string) => createHash("sha256").update(m).digest("hex").slice(0, 12);
  const withoutAt = (t: ReturnType<typeof setup>) => t.journal().map(({ at, ...l }) => l);

  // Value: protects=a canary anywhere in a request the route allowlist refuses (its path, body, query string or headers) on a DR_ALLOWANCE_STOP proxy writes the tripwire's DR_CUSTODY_HIT line, key for key and value for value as for a canary in an allowlisted body apart from the meter and the masked route, so the controller's journal check stops the run, while the 403 E_ALLOWANCE answer stays byte for byte what it was and the meter counts the one E_ALLOWANCE refusal; fails_when=a canary in a refused request's body, query string or headers leaves no custody line, or the line or the answer differs; why_new=#315's review (a canary outside a refused route's path wrote no custody line), by the Captain's ruling; seam=forward's route allowlist refusal and the controller's pre-launch journal check; no_claim=the refusals before the tripwire other than the route's (E_KEY_MISSING, an undecodable zstd body, E_SLOT_DENIED)
  test("a canary anywhere in a refused request writes the tripwire's custody line, so the journal check stops, and the answer is unchanged", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const MARK = "SEALED-MARKER-7f3a9c";
    const slot = { forbidden_markers: [CANARY, MARK], canary: CANARY };
    const u = setup(() => Response.json({}), { allowanceCode: "DR_ALLOWANCE_STOP" });
    const b = u.bind(slot);
    await expectProblem(await u.call(b.slot, b.token, "/anthropic/v1/messages", { ...count, max_tokens: 1000, messages: [{ role: "user", content: CANARY }] }), 403, "DR_CUSTODY_HIT");
    const tripwire = withoutAt(u)[0]!;
    for (const place of PLACES) {
      const t = setup(() => Response.json({}), { allowanceCode: "DR_ALLOWANCE_STOP" });
      const s = t.bind(slot);
      const route = place === "path" ? "/v1/nope-<unquoted>" : "/v1/nope";
      const res = await refused(t, s, rider(place, CANARY));
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(await routeAnswer(route));
      const lines = withoutAt(t);
      expect(lines.map(l => l.code)).toEqual(["DR_CUSTODY_HIT", "E_ALLOWANCE"]);
      expect(Object.keys(lines[0]!)).toEqual(Object.keys(tripwire));
      expect(lines[0]).toEqual({ ...tripwire, meter_id: s.meter_id, route });
      expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toContain(CANARY);
      await expect(journalCheck(t.dir)).rejects.toThrow(new RegExp(`^DR_CUSTODY_HIT: the journal .* holds a custody hit \\(meter ${s.meter_id}\\)`));
      expect(await t.proxy.finalize(s.meter_id)).toMatchObject({ refused: 1, refusals: ["E_ALLOWANCE"], allowance_stops: 0 });
      expect(t.calls).toHaveLength(0);
    }
  });

  // Value: protects=any other slot marker anywhere in a refused request (its path, body, query string or headers) on a DR_ALLOWANCE_STOP proxy writes one marker_hit line (the slot's cell, the marker's index and sha256 prefix, the masked route, no model) and no custody line, so the controller's journal check passes, while the answer stays byte for byte what it was; fails_when=a marker in a refused request's body, query string or headers leaves no marker_hit line, or a non-canary marker writes a custody line that stops the run; why_new=#315's review, by the Captain's ruling; seam=forward's route allowlist refusal and its marker_hit line; no_claim=the decision-routing scorer's label for these lines
  test("any other slot marker anywhere in a refused request writes only its marker_hit line, and the journal check passes", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const MARK = "SEALED-MARKER-7f3a9c";
    for (const place of PLACES) {
      const t = setup(() => Response.json({}), { allowanceCode: "DR_ALLOWANCE_STOP" });
      const s = t.bind({ forbidden_markers: [CANARY, MARK], canary: CANARY });
      const route = place === "path" ? "/v1/nope-<unquoted>" : "/v1/nope";
      const res = await refused(t, s, rider(place, MARK));
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(await routeAnswer(route));
      expect(withoutAt(t)).toEqual([
        { kind: "marker_hit", meter_id: s.meter_id, provider: "anthropic", route, model: null, source: "127.0.0.1", decider: false, cell, markers: [{ index: 1, sha256: shortSha(MARK) }] },
        { kind: "refusal", code: "E_ALLOWANCE", meter_id: s.meter_id, provider: "anthropic", route, model: null, reason: `route POST /anthropic${route} is not allowlisted`, source: "127.0.0.1" },
      ]);
      expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toContain(MARK);
      await expect(journalCheck(t.dir)).rejects.toThrow(/^E_USAGE: --temp needs --fake-upstreams/);
      expect(t.calls).toHaveLength(0);
    }
  });

  // Value: protects=a proxy-wide marker anywhere in a refused request (its path, body, query string or headers) writes the tripwire's E_TRIPWIRE refusal line, key for key and value for value as for that marker in an allowlisted body apart from the meter and the masked route, on a default proxy and a DR_ALLOWANCE_STOP one, so the cell reads invalid, with no marker_hit or custody line, while the answer stays byte for byte the 403 E_ALLOWANCE it was and the meter counts only that refusal; fails_when=a proxy-wide marker in a refused request is masked and leaves no record, the record carries the marker, or the answer changes; why_new=#315's review (a proxy-wide marker in a refused path left no record), by the Captain's ruling; seam=forward's route allowlist refusal; no_claim=a slot marker on a proxy without DR_ALLOWANCE_STOP, which a refused request still does not record
  test("a proxy-wide marker anywhere in a refused request writes the tripwire's masked E_TRIPWIRE line on any proxy, and the answer is unchanged", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const MARK = "SEALED-MARKER-7f3a9c";
    const WIDE = "PROXY-WIDE-MARKER-0042";
    for (const allowanceCode of [undefined, "DR_ALLOWANCE_STOP"] as const) {
      const slot = allowanceCode ? { forbidden_markers: [CANARY, MARK], canary: CANARY } : {};
      const u = setup(() => Response.json({}), { allowanceCode, forbiddenMarkers: [WIDE] });
      const b = u.bind(slot);
      await expectProblem(await u.call(b.slot, b.token, "/anthropic/v1/messages", { ...count, max_tokens: 1000, messages: [{ role: "user", content: WIDE }] }), 403, "E_TRIPWIRE");
      const tripwire = withoutAt(u)[0]!;
      for (const place of PLACES) {
        const t = setup(() => Response.json({}), { allowanceCode, forbiddenMarkers: [WIDE] });
        const s = t.bind(slot);
        const route = place === "path" ? "/v1/nope-<unquoted>" : "/v1/nope";
        const res = await refused(t, s, rider(place, WIDE));
        expect(res.status).toBe(403);
        expect(await res.text()).toBe(await routeAnswer(route));
        const lines = withoutAt(t);
        expect(lines.map(l => l.code)).toEqual(["E_TRIPWIRE", "E_ALLOWANCE"]);
        expect(Object.keys(lines[0]!)).toEqual(Object.keys(tripwire));
        expect(lines[0]).toEqual({ ...tripwire, meter_id: s.meter_id, route });
        expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toContain(WIDE);
        if (allowanceCode) await expect(journalCheck(t.dir)).rejects.toThrow(/^E_USAGE: --temp needs --fake-upstreams/);
        expect(await t.proxy.finalize(s.meter_id)).toMatchObject({ refused: 1, refusals: ["E_ALLOWANCE"], allowance_stops: 0 });
        expect(t.calls).toHaveLength(0);
      }
    }
  });

  // Value: protects=a canary riding with a proxy-wide marker in a refused request, in any mix of places, writes both the tripwire's custody line (the slot's markers only, with their indexes) and its E_TRIPWIRE line (every marker counted), so the controller's journal check still stops the run, while each answer stays byte for byte the 403 E_ALLOWANCE it was; fails_when=the proxy-wide marker hides the canary, so no custody line is written and the run goes on; why_new=#315's review note on a canary beside a proxy-wide marker, by the Captain's ruling; seam=forward's route allowlist refusal and the controller's pre-launch journal check; no_claim=an allowlisted request carrying both, which keeps today's single E_TRIPWIRE refusal (tests/decision-routing/custody.test.ts)
  test("a canary riding with a proxy-wide marker in a refused request writes both the custody and the E_TRIPWIRE lines, so the run still stops", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const MARK = "SEALED-MARKER-7f3a9c";
    const WIDE = "PROXY-WIDE-MARKER-0042";
    const t = setup(() => Response.json({}), { allowanceCode: "DR_ALLOWANCE_STOP", forbiddenMarkers: [WIDE] });
    const s = t.bind({ forbidden_markers: [CANARY, MARK], canary: CANARY });
    const cases: Array<[Riders, string, Array<[number, string]>, number]> = [
      [{ path: `/v1/${WIDE}/nope-${CANARY}` }, "/v1/<unquoted>/nope-<unquoted>", [[0, CANARY]], 2],
      [{ path: `/v1/nope-${WIDE}`, content: CANARY }, "/v1/nope-<unquoted>", [[0, CANARY]], 2],
      [{ path: `/v1/nope-${CANARY}`, header: WIDE }, "/v1/nope-<unquoted>", [[0, CANARY]], 2],
      [{ query: WIDE, content: `${MARK} ${CANARY}` }, "/v1/nope", [[0, CANARY], [1, MARK]], 3],
    ];
    const expected: Record<string, unknown>[] = [];
    for (const [at, route, markers, all] of cases) {
      const res = await refused(t, s, at);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(await routeAnswer(route));
      const line = { meter_id: s.meter_id, provider: "anthropic", route, model: null };
      expected.push(
        { kind: "refusal", code: "DR_CUSTODY_HIT", ...line, reason: `the request carries ${markers.length} runner-only marker(s); custody hit, the run stops`, source: "127.0.0.1", cell, markers: markers.map(([index, m]) => ({ index, sha256: shortSha(m) })) },
        { kind: "refusal", code: "E_TRIPWIRE", ...line, reason: `the request carries ${all} forbidden marker(s); the cell is invalid`, source: "127.0.0.1" },
        { kind: "refusal", code: "E_ALLOWANCE", ...line, reason: `route POST /anthropic${route} is not allowlisted`, source: "127.0.0.1" },
      );
    }
    expect(withoutAt(t)).toEqual(expected);
    const journal = readFileSync(join(t.dir, "journal.ndjson"), "utf8");
    for (const piece of [CANARY, MARK, WIDE]) expect(journal).not.toContain(piece);
    await expect(journalCheck(t.dir)).rejects.toThrow(new RegExp(`^DR_CUSTODY_HIT: the journal .* holds a custody hit \\(meter ${s.meter_id}\\)`));
    expect(await t.proxy.finalize(s.meter_id)).toMatchObject({ refused: cases.length, refusals: ["E_ALLOWANCE"], allowance_stops: 0 });
    expect(t.calls).toHaveLength(0);
  });

  // Value: protects=a refused request whose JSON body nests too deep for the tripwire to walk its parsed strings is still scanned in its path, query string, headers and raw body, so a canary there writes the custody line and the answer stays the 403 E_ALLOWANCE it was, never a 500 with no record; fails_when=the body's traversal overflows the stack and the call ends E_INTERNAL with no custody line, or a canary in the headers or the raw body of a refused request is not recorded; why_new=Capy's review of #319 (deeply nested refused bodies suppressed custody evidence); seam=forward's route allowlist refusal and tripwireText; no_claim=a JSON-escaped marker inside a body too deep to walk, which only the raw text is searched for
  test("a refused request whose body nests too deep to walk still records a canary in its path, headers or raw body, and the answer is unchanged", async () => {
    const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";
    const deep = (inner: string) => `${"[".repeat(100_000)}${inner}${"]".repeat(100_000)}`;
    const cases: Array<[Riders, string, string]> = [
      [{ path: `/v1/nope-${CANARY}` }, "/v1/nope-<unquoted>", deep("")],
      [{ header: CANARY }, "/v1/nope", deep("")],
      [{}, "/v1/nope", deep(JSON.stringify(CANARY))],
    ];
    for (const [at, route, body] of cases) {
      const t = setup(() => Response.json({}), { allowanceCode: "DR_ALLOWANCE_STOP" });
      const s = t.bind({ forbidden_markers: [CANARY], canary: CANARY });
      const res = await fetch(`http://127.0.0.1:${t.proxy.port}/${s.slot}/anthropic${at.path ?? "/v1/nope"}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": s.token, ...(at.header ? { "x-note": at.header } : {}) }, body });
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(await routeAnswer(route));
      expect(withoutAt(t).map(l => [l.code, l.route])).toEqual([["DR_CUSTODY_HIT", route], ["E_ALLOWANCE", route]]);
      expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toContain(CANARY);
      await expect(journalCheck(t.dir)).rejects.toThrow(/^DR_CUSTODY_HIT: /);
      expect(t.calls).toHaveLength(0);
    }
  });

  // Value: protects=a slot denial masks the markers of slots that have closed as well as the open slots' markers, in the unmatched path and the slot id it quotes, in the 403 and the journal, while every denial stays a 403 E_SLOT_DENIED and an honest path or slot id keeps its text; fails_when=unbinding a slot drops its markers from the denial's masking, so a later denial echoes one; why_new=#315's review (E_SLOT_DENIED did not mask closed slots' markers), by the Captain's ruling; seam=handle's E_SLOT_DENIED refusal and unbind; no_claim=a custody line for a canary in a denied call, since no slot's tripwire runs on it
  test("a slot denial masks the markers of closed slots as well as open ones, in the 403 and the journal", async () => {
    const CLOSED = "SEALED-MARKER-7f3a9c";
    const OPEN = "OPEN-SLOT-MARKER-0055";
    const t = setup(() => Response.json({}));
    const a = t.bind({ forbidden_markers: [CLOSED] });
    const b = t.bind({ forbidden_markers: [OPEN] });
    t.proxy.unbind(a.slot);
    const cases: Array<[string, string | null, string | null, string]> = [
      [`/x/${CLOSED}/y`, null, null, "no provider route /x/<unquoted>/y"],
      [`/x-${OPEN}`, null, null, "no provider route /x-<unquoted>"],
      [`/${CLOSED}/anthropic/v1/messages`, b.token, "<unquoted>", "slot <unquoted> is not open"],
      [`/${a.slot}/anthropic/v1/messages`, a.token, a.slot, `slot ${a.slot} is not open`],
      ["/nope/v1/messages", null, null, "no provider route /nope/v1/messages"],
    ];
    for (const [path, credential, , reason] of cases) {
      const res = await fetch(`http://127.0.0.1:${t.proxy.port}${path}`, { headers: credential ? { "x-api-key": credential } : {} });
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(await problem("E_SLOT_DENIED", 403, reason).text());
    }
    expect(t.journal().map(l => [l.code, l.slot, l.reason])).toEqual(cases.map(([, , slot, reason]) => ["E_SLOT_DENIED", slot, reason]));
    expect(readFileSync(join(t.dir, "journal.ndjson"), "utf8")).not.toMatch(/SEALED|OPEN-SLOT/);
    expect(t.calls).toHaveLength(0);
  });
});

