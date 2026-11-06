import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { CHAT_PRICES, openRouterRouting, priceRequest, reservationMicros, sseUsage, TOOL_USE_SYSTEM_TOKENS, UNKNOWN_CHAIN_CONTEXT_TOKENS, usageCost } from "../../src/runner/pricing/prices.ts";
import { isTrialNetworkHost, MeteringProxy, ProxyControl, reconcileJournal, routable, scrubbedCause, type BindRequest, type ProxyOptions } from "../../src/runner/proxy/metering-proxy.ts";
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
    env: { ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: OPENAI_KEY, OPENROUTER_API_KEY: OPENROUTER_KEY },
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

