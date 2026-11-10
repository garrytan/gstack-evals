// Input-token counts for the metering proxy's reservation. Each paid call reserves its worst case before it is sent; the
// input part was one token per byte of the request, which runs 3 to 10 times over the real input and, for Sol, crosses
// the 272,000-token long-context line and doubles its rate. Where a provider counts input for free, the proxy now reserves
// at that count; a failed or slow count, or a route whose count once ran short, reserves at the byte bound as before.
// Keyless: a fake ledger, a fake upstream and a fake counter.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANTHROPIC_COUNT_MARGIN, countedInputTokens, countPlan, TRANSLATED_BLOCK_TOKENS, TRANSLATED_COUNT_MARGIN } from "../../src/runner/pricing/input-count.ts";
import { priceRequest, REQUEST_OVERHEAD_TOKENS } from "../../src/runner/pricing/prices.ts";
import { COUNT_TIMEOUT_MS, MeteringProxy, type BindRequest, type ProxyOptions } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const KEY = "sk-ant-real-key-0123456789";
const OPENAI_KEY = "sk-openai-real-key-0123456789";
const OPENROUTER_KEY = "sk-or-v1-real-key-0123456789";
const SOL = "openai/gpt-6.1-sol";
const cell: Omit<CellAttempt, "meter_id"> = { run_id: "r1", arm: "gstack", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 };

class Ledger implements ReservationLedger {
  rows = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: "res_" + (this.rows.size + 1), idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros, state: "reserved", spent_micros: null, usage: null };
    this.rows.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.rows.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

type Upstream = (url: string, init: RequestInit) => Response | Promise<Response>;
const usage = (u: Record<string, unknown>) => Response.json({ id: "msg", usage: u });
const counted = (n: unknown) => () => Response.json({ input_tokens: n });

const dirs: string[] = [];
const proxies: MeteringProxy[] = [];
afterEach(() => {
  for (const p of proxies.splice(0)) p.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A proxy with a fake upstream and, unless count is null, a fake counter; null leaves the counter unset, as every caller that injects fetch has it today. */
function setup(o: { upstream?: Upstream; count?: Upstream | null; extra?: Partial<ProxyOptions> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "input-count-"));
  dirs.push(dir);
  const ledger = new Ledger();
  const sends: Array<{ url: string; headers: Headers; raw: string }> = [];
  const counts: Array<{ url: string; headers: Headers; body: any; raw: string }> = [];
  const upstream = o.upstream ?? (() => usage({ input_tokens: 10, output_tokens: 5 }));
  const counter = o.count === undefined ? counted(1000) : o.count;
  const proxy = new MeteringProxy({
    ledger, leaseId: "l1", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789abcdef", journal: join(dir, "journal.ndjson"),
    retry: { attempts: 1, elapsed_ms: 60_000 }, env: { ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: OPENAI_KEY, OPENROUTER_API_KEY: OPENROUTER_KEY }, sleep: async () => {},
    fetch: async (url, init) => {
      sends.push({ url, headers: new Headers(init.headers), raw: String(init.body ?? "") });
      return upstream(url, init);
    },
    ...(counter === null ? {} : {
      count: async (url: string, init: RequestInit) => {
        counts.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)), raw: String(init.body) });
        return counter(url, init);
      },
    }),
    ...o.extra,
  });
  proxy.start();
  proxies.push(proxy);
  const bind = (r: Partial<BindRequest> = {}) => proxy.bind({ cell, models: ["anthropic:claude-opus-5-5", "openai:gpt-6.1-sol", "openrouter:" + SOL, "openrouter:particle-ai/particle-1"], allowance_micros: 50_000_000, ...r });
  const call = (b: { slot: string; token: string }, path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": b.token, ...headers }, body: JSON.stringify(body) });
  const journal = () => readFileSync(join(dir, "journal.ndjson"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const reserves = () => journal().filter((l) => l.kind === "reserve");
  return { proxy, ledger, sends, counts, bind, call, journal, reserves };
}

/** Today's byte reservation for a request: the same call through a proxy that counts nothing. */
async function byteReservation(path: string, body: unknown, headers: Record<string, string> = {}) {
  const t = setup({ count: null });
  const res = await t.call(t.bind(), path, body, headers);
  return { status: res.status, text: await res.text(), reserve: t.reserves()[0], sends: t.sends.map((s) => s.url + "\n" + s.raw) };
}

const opus = (chars: number) => ({ model: "claude-opus-5-5", max_tokens: 1000, stream: false, metadata: { user_id: "u1" }, system: [{ type: "text", text: "You are Claude Code." }], tools: [{ name: "Bash", description: "Run a shell command", input_schema: { type: "object", properties: { command: { type: "string" } } } }], messages: [{ role: "user", content: [{ type: "text", text: "x".repeat(chars) }] }] });

/** A Claude Code shaped Sol request on OpenRouter's Messages route: system blocks, tools, text, tool calls and their results. */
const sol = (chars: number) => ({
  model: SOL,
  max_tokens: 1000,
  stream: false,
  system: [{ type: "text", text: "You are Claude Code." }, { type: "text", text: "Follow the plan.", cache_control: { type: "ephemeral" } }],
  tools: [
    { name: "Read", description: "Read a file", input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
    { name: "Bash", description: "Run a shell command", input_schema: { type: "object", properties: { command: { type: "string" } } }, cache_control: { type: "ephemeral" } },
  ],
  messages: [
    { role: "user", content: "Review the plan." },
    { role: "assistant", content: [{ type: "text", text: "Reading it." }, { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "plan.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "y".repeat(chars), cache_control: { type: "ephemeral" } }, { type: "text", text: "Go on." }] },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "ls" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: [{ type: "text", text: "plan.md" }, { type: "text", text: "README.md" }] }] },
  ],
});
/** sol()'s translation into OpenAI Responses input, as the counter must receive it. */
const solInput = (chars: number) => [
  { role: "system", content: "You are Claude Code." },
  { role: "system", content: "Follow the plan." },
  { role: "user", content: "Review the plan." },
  { role: "assistant", content: "Reading it." },
  { type: "function_call", call_id: "toolu_1", name: "Read", arguments: '{"file_path":"plan.md"}' },
  { type: "function_call_output", call_id: "toolu_1", output: "y".repeat(chars) },
  { role: "user", content: "Go on." },
  { type: "function_call", call_id: "toolu_2", name: "Bash", arguments: '{"command":"ls"}' },
  { type: "function_call_output", call_id: "toolu_2", output: "plan.md\nREADME.md" },
];
const solTools = [
  { type: "function", name: "Read", description: "Read a file", parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] }, strict: false },
  { type: "function", name: "Bash", description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } } }, strict: false },
];
const SOL_BLOCKS = solInput(0).length + solTools.length;
const solBound = (count: number, opaque = 0) => Math.ceil(count * (1 + TRANSLATED_COUNT_MARGIN)) + SOL_BLOCKS * TRANSLATED_BLOCK_TOKENS + opaque;
const anthropicBound = (count: number) => Math.ceil(count * (1 + ANTHROPIC_COUNT_MARGIN)) + REQUEST_OVERHEAD_TOKENS;

describe("input-token counts for the reservation", () => {
  // Value: protects=an Anthropic call reserves its input at Anthropic's own free count, plus a small margin, instead of a token per byte; fails_when=the count is skipped, sent with fields count_tokens refuses or without the client's beta headers, or the paid send changes; why_new=bytes-as-tokens reservations run about 3 times high on Opus; seam=forward's count before reserve; no_claim=Anthropic's count accuracy, which its docs call an estimate
  test("a large Opus request reserves its input at Anthropic's count plus a small margin, and its paid send and answer are unchanged", async () => {
    const body = opus(400_000);
    const beta = { "anthropic-beta": "context-management-2025-06-27" };
    const before = await byteReservation("/anthropic/v1/messages", body, beta);
    const t = setup({ count: counted(100_000) });
    const res = await t.call(t.bind(), "/anthropic/v1/messages", body, beta);
    expect(res.status).toBe(before.status);
    expect(await res.text()).toBe(before.text);
    expect(t.sends.map((s) => s.url + "\n" + s.raw)).toEqual(before.sends);
    expect(t.counts).toHaveLength(1);
    const c = t.counts[0]!;
    expect(c.url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
    expect(c.headers.get("x-api-key")).toBe(KEY);
    expect(c.headers.get("anthropic-beta")).toBe("context-management-2025-06-27");
    expect(c.headers.get("anthropic-version")).toBe("2023-06-01");
    const sent = JSON.parse(t.sends[0]!.raw);
    expect(c.body).toEqual(Object.fromEntries(Object.entries(sent).filter(([k]) => !["max_tokens", "stream", "metadata", "inference_geo"].includes(k))));
    const price = priceRequest("anthropic", sent, 1000);
    const tokens = anthropicBound(100_000);
    expect(t.reserves()[0]).toMatchObject({ max_micros: Math.ceil(tokens * 4 + 1000 * 20), input_count: { counter: "anthropic", count: 100_000, tokens, byte_tokens: price.inputTokens } });
    expect(t.reserves()[0]!.max_micros).toBeLessThan(before.reserve.max_micros / 3);
  });

  // Value: protects=a count that fails, answers no number, or is slow never lowers the reservation; fails_when=any of these reserves below the byte bound or changes the client's answer; why_new=the brief's fallback rule; seam=the proxy's count send; no_claim=which failures a provider shows
  test("a count that fails, errs, answers no number or is slow reserves at today's byte bound, and the answer is unchanged", async () => {
    const body = opus(40_000);
    const before = await byteReservation("/anthropic/v1/messages", body);
    const failures: Array<[string, Upstream]> = [
      ["throws", () => { throw new Error("socket hang up"); }],
      ["500", () => new Response("{}", { status: 500 })],
      ["429", () => new Response("{}", { status: 429, headers: { "retry-after": "60" } })],
      ["no number", () => Response.json({})],
      ["negative", counted(-1)],
      ["zero", counted(0)],
      ["fraction", counted(1.5)],
      ["text", () => new Response("not json")],
      ["slow", () => new Promise<Response>(() => {})],
      ["slow body", () => new Response(new ReadableStream({ start() {} }))],
    ];
    for (const [name, count] of failures) {
      const t = setup({ count, extra: { countTimeoutMs: 50 } });
      const res = await t.call(t.bind(), "/anthropic/v1/messages", body);
      expect([name, res.status, await res.text()]).toEqual([name, before.status, before.text]);
      const reserve = t.reserves()[0]!;
      expect([name, reserve.max_micros]).toEqual([name, before.reserve.max_micros]);
      expect([name, reserve.input_count.count, reserve.input_count.tokens]).toEqual([name, null, reserve.input_count.byte_tokens]);
      expect(typeof reserve.input_count.fallback).toBe("string");
      expect(JSON.stringify(t.journal())).not.toContain(KEY);
    }
    expect(COUNT_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  // Value: protects=a large Sol request on OpenRouter's Messages route, which Claude Code uses for Sol, reserves near its real input and at the standard tier, so concurrent calls fit the session's allowance; fails_when=the byte bound puts it past 272,000 tokens at the long rates, or the translation the counter sees drops or invents text; why_new=Sol sessions hit their allowance through reservations alone; seam=countPlan's translation and the proxy's count send; no_claim=OpenRouter's own translation, which the probes measure
  test("a large Sol request on OpenRouter's Messages route is counted by Sol's own counter and reserved near its input, at the standard tier", async () => {
    const chars = 1_200_000;
    const body = sol(chars);
    const before = await byteReservation("/openrouter/v1/messages", body);
    expect(before.reserve.max_micros).toBeGreaterThan(5_000_000);
    const t = setup({ count: counted(150_000) });
    const b = t.bind({ allowance_micros: 5_000_000 });
    const res = await t.call(b, "/openrouter/v1/messages", body, { "anthropic-beta": "claude-code-20250219", "user-agent": "claude-cli" });
    expect(res.status).toBe(200);
    expect(t.sends.map((s) => s.url + "\n" + s.raw)).toEqual(before.sends);
    const c = t.counts[0]!;
    expect(c.url).toBe("https://api.openai.com/v1/responses/input_tokens");
    expect([...c.headers.keys()].sort()).toEqual(["authorization", "content-type"]);
    expect(c.headers.get("authorization")).toBe("Bearer " + OPENAI_KEY);
    expect(c.body).toEqual({ model: "gpt-6.1-sol", input: solInput(chars), tools: solTools });
    const tokens = solBound(150_000);
    expect(tokens).toBeLessThan(272_000);
    expect(t.reserves()[0]).toMatchObject({ max_micros: Math.ceil(tokens * 2.5 + 1000 * 10), input_count: { counter: "openai", count: 150_000, tokens } });
  });

  // Value: protects=the other direction: a Sol request whose count fails keeps the byte bound, its long tier and today's allowance answer; fails_when=a failed count reserves less or lets the call past an allowance the byte bound fails; why_new=the brief's fallback rule; seam=forward's count fallback; no_claim=none
  test("the same Sol request whose count fails reserves at bytes, at the long tier, and gets today's allowance refusal", async () => {
    const body = sol(1_200_000);
    const t0 = setup({ count: null });
    const r0 = await t0.call(t0.bind({ allowance_micros: 5_000_000 }), "/openrouter/v1/messages", body);
    const t = setup({ count: () => new Response("{}", { status: 503 }) });
    const res = await t.call(t.bind({ allowance_micros: 5_000_000 }), "/openrouter/v1/messages", body);
    expect([res.status, await res.text()]).toEqual([r0.status, await r0.text()]);
    expect(res.status).toBe(402);
    expect(t.sends).toHaveLength(0);
    const refusal = t.journal().find((l) => l.kind === "refusal")!;
    expect(refusal.reason).toBe(t0.journal().find((l) => l.kind === "refusal")!.reason);
    expect(t.counts).toHaveLength(1);
  });

  // Value: protects=parts the counter is not sent (thinking signatures, images, unknown blocks) stay at a token per byte, and none of their text leaves for the counter; fails_when=an opaque block is dropped from the bound or its content reaches OpenAI's counter; why_new=OpenRouter's signatures and media cannot be counted with the proxy's own OpenAI key; seam=countPlan; no_claim=how OpenRouter bills them
  test("thinking signatures, images and unknown blocks are reserved at a token per byte and never sent to the counter", async () => {
    const body = sol(1000);
    const thinking = { type: "thinking", thinking: "THINKING-TEXT", signature: "SIGNATURE-" + "s".repeat(5000) };
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "IMAGEDATA" + "A".repeat(4000) } };
    const odd = { type: "server_tool_use_like", note: "ODD-BLOCK" };
    (body.messages[1]!.content as unknown[]).unshift(thinking);
    (body.messages[2]!.content as unknown[]).push(image, odd);
    const opaque = [thinking, image, odd].reduce((n, x) => n + Buffer.byteLength(JSON.stringify(x)), 0);
    const t = setup({ count: counted(2000) });
    expect((await t.call(t.bind(), "/openrouter/v1/messages", body)).status).toBe(200);
    for (const s of ["THINKING-TEXT", "SIGNATURE-", "IMAGEDATA", "ODD-BLOCK"]) expect(t.counts[0]!.raw).not.toContain(s);
    expect(t.counts[0]!.body.input).toEqual(solInput(1000));
    expect(t.reserves()[0]!.input_count.tokens).toBe(solBound(2000, opaque));
  });

  // Value: protects=a count never raises a reservation above today's byte bound; fails_when=a count above the bytes reserves more than today; why_new=the brief's ceiling; seam=countedInputTokens; no_claim=none
  test("a counted bound is never above today's byte bound", async () => {
    for (const [path, body] of [["/anthropic/v1/messages", opus(4000)], ["/openrouter/v1/messages", sol(4000)]] as const) {
      const before = await byteReservation(path, body);
      const t = setup({ count: counted(1_000_000) });
      expect((await t.call(t.bind(), path, body)).status).toBe(200);
      expect(t.reserves()[0]!.max_micros).toBe(before.reserve.max_micros);
      expect(t.reserves()[0]!.input_count.tokens).toBe(t.reserves()[0]!.input_count.byte_tokens);
    }
  });

  // Value: protects=a count call never carries what the tripwire, the model allowlist, the output cap or a shape check refuses; fails_when=any refused request reaches a counter; why_new=the brief's custody rule; seam=the count's place after every check; no_claim=none
  test("no count call leaves for a request the tripwire, the model allowlist, the output cap or a shape check refuses", async () => {
    const t = setup({ extra: { forbiddenMarkers: ["HIDDEN-FACT-123"] } });
    const b = t.bind();
    const marked = opus(100);
    marked.messages[0]!.content[0]!.text = "HIDDEN-FACT-123";
    expect((await t.call(b, "/anthropic/v1/messages", marked)).status).toBe(403);
    expect((await t.call(b, "/anthropic/v1/messages", { ...opus(100), model: "claude-fable-5-1" })).status).toBe(403);
    expect((await t.call(b, "/anthropic/v1/messages", { ...opus(100), max_tokens: 1_000_000 })).status).toBe(400);
    expect((await t.call(b, "/anthropic/v1/messages", { ...opus(100), tools: [{ type: "web_search_20250305", name: "web_search" }] })).status).toBe(402);
    expect((await t.call(b, "/openrouter/v1/messages", { ...sol(100), mcp_servers: [{ type: "url", url: "https://example.com" }] })).status).toBe(402);
    expect(t.counts).toHaveLength(0);
    expect(t.sends).toHaveLength(0);
  });

  // Value: protects=counts are free: they reserve nothing, settle nothing, add no request, spend or status to the meter, and a count's 429 pauses no paid call; fails_when=a count touches the ledger, the meter or the provider's rate-limit pause; why_new=the brief's no-spend rule; seam=the count send beside the attempt loop; no_claim=the providers' count rate limits
  test("count calls reserve, settle and spend nothing, and a count's 429 pauses no paid call", async () => {
    const sleeps: number[] = [];
    const t = setup({ count: () => new Response("{}", { status: 429, headers: { "retry-after": "60" } }), extra: { sleep: async (ms) => void sleeps.push(ms) } });
    const b = t.bind();
    expect((await t.call(b, "/anthropic/v1/messages", opus(100))).status).toBe(200);
    expect((await t.call(b, "/anthropic/v1/messages", opus(100))).status).toBe(200);
    expect(sleeps).toEqual([]);
    expect(t.ledger.rows.size).toBe(2);
    const meter = await t.proxy.finalize(b.meter_id);
    expect(meter).toMatchObject({ requests: 2, refused: 0, upstream: { statuses: { "200": 2 }, failed: 0 } });
    expect(meter.micros).toBe([...t.ledger.rows.values()].reduce((n, r) => n + r.spent_micros!, 0));
  });

  // Value: protects=OpenAI's Responses route reserves at OpenAI's exact count with no margin, picks the long tier from the count, and sends the counter only the fields it reads; fails_when=the tier follows bytes, the count is padded, or a generation field reaches the counter and fails it; why_new=OpenAI's counter answers 400 to max_output_tokens; seam=countPlan; no_claim=none
  test("OpenAI's Responses route reserves at the exact count, with the tier the count picks", async () => {
    const input = [{ role: "user", content: "z".repeat(1_100_000) }];
    for (const [count, rate] of [[200_000, 2.5], [280_000, 5]] as const) {
      const t = setup({ count: counted(count) });
      const body = { model: "gpt-6.1-sol", input, instructions: "Be brief.", tools: [{ type: "function", name: "f", parameters: { type: "object" } }], max_output_tokens: 1000, stream: false, store: false, reasoning: { effort: "high" } };
      expect((await t.call(t.bind(), "/openai/v1/responses", body)).status).toBe(200);
      expect(t.counts[0]!.url).toBe("https://api.openai.com/v1/responses/input_tokens");
      expect(t.counts[0]!.headers.get("authorization")).toBe("Bearer " + OPENAI_KEY);
      expect(t.counts[0]!.body).toEqual({ model: "gpt-6.1-sol", input, instructions: "Be brief.", tools: body.tools, reasoning: { effort: "high" } });
      expect(t.reserves()[0]).toMatchObject({ max_micros: Math.ceil(count * rate + 1000 * (rate === 5 ? 15 : 10)), input_count: { counter: "openai", count, tokens: count } });
    }
  });

  // Value: protects=routes with no exact or measured counter keep the byte bound and send no count; fails_when=chained Responses context, chat completions or an OpenRouter model not pinned to OpenAI gets a count; why_new=only the anthropic, openai Responses and probed OpenRouter Sol routes are counted; seam=countPlan; no_claim=none
  test("stored Responses context, chat completions and OpenRouter models not pinned to OpenAI keep the byte bound and send no count", async () => {
    const t = setup();
    const b = t.bind();
    expect((await t.call(b, "/openai/v1/responses", { model: "gpt-6.1-sol", previous_response_id: "resp_1", input: "go on" })).status).toBe(200);
    expect((await t.call(b, "/openai/v1/chat/completions", { model: "gpt-6.1-sol", messages: [{ role: "user", content: "hi" }] })).status).toBe(200);
    expect((await t.call(b, "/openrouter/v1/messages", { ...sol(100), model: "particle-ai/particle-1" })).status).toBe(200);
    expect(t.counts).toHaveLength(0);
    expect(t.reserves().map((r) => r.input_count)).toEqual([undefined, undefined, undefined]);
  });

  // Value: protects=every caller that injects fetch today (tests, stubs, taps) keeps byte reservations and its exact upstream sequence; fails_when=a proxy with an injected fetch sends count calls through it or any other way; why_new=lanes and replays record every upstream send; seam=ProxyOptions.count; no_claim=none
  test("a proxy given a fetch and no count sender counts nothing, as before", async () => {
    const t = setup({ count: null });
    expect((await t.call(t.bind(), "/anthropic/v1/messages", opus(4000))).status).toBe(200);
    expect(t.sends).toHaveLength(1);
    expect(t.reserves()[0]!.input_count).toBeUndefined();
  });

  // Value: protects=a malformed tools entry on the translated route gets the answer it got before counting existed; fails_when=a null tool makes the count plan throw and the proxy answer 500 instead of forwarding; why_new=/ship review; seam=translatedPlan's tool loop; no_claim=what the upstream answers such a request
  test("a null tool entry on OpenRouter's Sol route is forwarded as before, with its bytes reserved", async () => {
    const body = { ...sol(1000), tools: [null] };
    const before = await byteReservation("/openrouter/v1/messages", body);
    const t = setup();
    const res = await t.call(t.bind(), "/openrouter/v1/messages", body);
    expect(res.status).toBe(before.status);
    expect(await res.text()).toBe(before.text);
    expect(t.sends.map((s) => s.url + "\n" + s.raw)).toEqual(before.sends);
    expect(countPlan("openrouter", "/v1/messages", body, priceRequest("openrouter", body, 1000, "/v1/messages"))!.opaqueBytes).toBe(Buffer.byteLength("null"));
  });

  // Value: protects=input a translated request carries outside system, messages and tools stays reserved at a token per byte; fails_when=a structured-output schema or another untranslated top-level field drops out of the bound; why_new=/ship review; seam=translatedPlan; no_claim=how OpenRouter bills each field
  test("top-level fields the Sol translation does not send to the counter are reserved at a token per byte", async () => {
    const schema = { format: { type: "json_schema", schema: { type: "object", description: "z".repeat(50_000) } } };
    const body = { ...sol(1000), output_config: schema };
    const plan = countPlan("openrouter", "/v1/messages", body, priceRequest("openrouter", body, 1000, "/v1/messages"))!;
    expect(plan.opaqueBytes).toBeGreaterThanOrEqual(Buffer.byteLength(JSON.stringify(schema)));
    const t = setup({ count: counted(10) });
    expect((await t.call(t.bind(), "/openrouter/v1/messages", body)).status).toBe(200);
    expect(t.reserves()[0]!.input_count.tokens).toBeGreaterThanOrEqual(Buffer.byteLength(JSON.stringify(schema)));
    expect(countPlan("openrouter", "/v1/messages", sol(1000), priceRequest("openrouter", sol(1000), 1000, "/v1/messages"))!.opaqueBytes).toBe(0);
  });
  // Value: protects=an OpenRouter Sol call reserves at bytes and sends no count when the proxy has no OpenAI key; fails_when=the count goes out with another key or none; why_new=/ship review, an untested fallback; seam=countInput's key check; no_claim=none
  test("an OpenRouter Sol call with no OPENAI_API_KEY sends no count and reserves at the byte bound", async () => {
    const before = await byteReservation("/openrouter/v1/messages", sol(1000));
    const t = setup({ extra: { env: { ANTHROPIC_API_KEY: KEY, OPENROUTER_API_KEY: OPENROUTER_KEY } } });
    expect((await t.call(t.bind(), "/openrouter/v1/messages", sol(1000))).status).toBe(200);
    expect(t.counts).toHaveLength(0);
    expect(t.reserves()[0]!.max_micros).toBe(before.reserve.max_micros);
    expect(t.reserves()[0]!.input_count).toMatchObject({ counter: "openai", count: null });
    expect(t.reserves()[0]!.input_count.fallback).toContain("OPENAI_API_KEY is not set");
  });
});

describe("the guard on a measured count", () => {
  // Value: protects=a call whose real input stays within its counted reservation changes nothing; fails_when=the guard trips on an honest call or stops counting; why_new=the Captain's guard 2, the passing direction; seam=settle; no_claim=none
  test("a call whose real input fits its counted reservation leaves counting on", async () => {
    const t = setup({ count: counted(1000), upstream: () => usage({ input_tokens: 900, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 5 }) });
    const b = t.bind();
    expect((await t.call(b, "/anthropic/v1/messages", opus(4000))).status).toBe(200);
    expect((await t.call(b, "/anthropic/v1/messages", opus(4000))).status).toBe(200);
    expect(t.counts).toHaveLength(2);
    expect(t.journal().filter((l) => l.kind === "count_overrun")).toEqual([]);
    expect(t.reserves().map((r) => r.input_count.count)).toEqual([1000, 1000]);
  });

  // Value: protects=a call whose real input exceeds its counted reservation sends its route back to bytes for the proxy's life and names the call in the journal; fails_when=a short count goes unnoticed or keeps being trusted on that route; why_new=the Captain's guard 2; seam=settle and the next forward; no_claim=how the lane reports the line
  test("a call whose real input exceeds its counted reservation sends that route back to bytes and journals the call", async () => {
    let real = 5000;
    const t = setup({ count: counted(1000), upstream: () => usage({ input_tokens: real, output_tokens: 5 }) });
    const b = t.bind();
    expect((await t.call(b, "/anthropic/v1/messages", opus(20_000))).status).toBe(200);
    const over = t.journal().filter((l) => l.kind === "count_overrun");
    expect(over).toEqual([expect.objectContaining({ reservation_id: "res_1", meter_id: b.meter_id, provider: "anthropic", route: "/v1/messages", model: "claude-opus-5-5", counter: "anthropic", reserved_tokens: anthropicBound(1000), real_tokens: 5000 })]);
    real = 10;
    const before = await byteReservation("/anthropic/v1/messages", opus(20_000));
    expect((await t.call(b, "/anthropic/v1/messages", opus(20_000))).status).toBe(200);
    expect(t.counts).toHaveLength(1);
    const second = t.reserves()[1]!;
    expect(second.max_micros).toBe(before.reserve.max_micros);
    expect(second.input_count).toMatchObject({ counter: "anthropic", count: null, tokens: second.input_count.byte_tokens });
    expect(second.input_count.fallback).toContain("res_1");
    expect((await t.call(b, "/openrouter/v1/messages", sol(1000))).status).toBe(200);
    expect(t.counts).toHaveLength(2);
    expect(t.reserves()[2]!.input_count.count).toBe(1000);
  });

  // Value: protects=a streamed call is held to the same guard as one answered whole; fails_when=the guard reads only non-streamed usage; why_new=Claude Code streams every call; seam=the stream's settle; no_claim=none
  test("a streamed call whose real input exceeds its count trips the guard too", async () => {
    const events = [{ type: "message_start", message: { usage: { input_tokens: 30_000, output_tokens: 1 } } }, { type: "message_delta", usage: { output_tokens: 5 } }];
    const stream = () => new Response(events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
    const t = setup({ count: counted(1000), upstream: stream });
    const b = t.bind();
    const res = await t.call(b, "/openrouter/v1/messages", { ...sol(20_000), stream: true });
    await res.text();
    await t.proxy.finalize(b.meter_id);
    expect(t.journal().filter((l) => l.kind === "count_overrun")).toEqual([expect.objectContaining({ provider: "openrouter", route: "/v1/messages", counter: "openai", reserved_tokens: solBound(1000), real_tokens: 30_000 })]);
  });

  // Value: protects=a retry of a call whose own attempt ran past its count reserves at the byte bound; fails_when=a retryable 429 or 5xx that reports input above the count re-reserves at the stale count; why_new=Capy review of the guard; seam=forward's retry loop; no_claim=none
  test("a retry after an attempt whose real input ran past its count reserves at the byte bound", async () => {
    let n = 0;
    const t = setup({ count: counted(1000), upstream: () => (n++ === 0 ? Response.json({ usage: { input_tokens: 5000, output_tokens: 0 } }, { status: 429, headers: { "retry-after": "1" } }) : usage({ input_tokens: 10, output_tokens: 5 })), extra: { retry: { attempts: 3, elapsed_ms: 60_000 } } });
    const before = await byteReservation("/anthropic/v1/messages", opus(20_000));
    expect((await t.call(t.bind(), "/anthropic/v1/messages", opus(20_000))).status).toBe(200);
    const [first, second] = t.reserves();
    expect(first!.input_count.count).toBe(1000);
    expect(second!.max_micros).toBe(before.reserve.max_micros);
    expect(second!.input_count).toMatchObject({ counter: "anthropic", count: null, tokens: second!.input_count.byte_tokens });
    expect(second!.input_count.fallback).toContain("res_1");
    expect(t.journal().filter((l) => l.kind === "count_overrun")).toHaveLength(1);
  });

  // Value: protects=a call that counted before another call tripped its route reserves its next attempt at the byte bound; fails_when=a call waiting out a provider pause retries at its stale count; why_new=Capy review of the guard; seam=forward's retry loop after the pause; no_claim=none
  test("a call that counted before another call tripped its route retries at the byte bound", async () => {
    let n = 0;
    let paused!: () => void;
    let release!: () => void;
    const hit = new Promise<void>((r) => (paused = r));
    const gate = new Promise<void>((r) => (release = r));
    let sleeps = 0;
    const sleep = async () => {
      if (sleeps++ === 0) {
        paused();
        await gate;
      }
    };
    const upstream = () => (n++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "1" } }) : usage({ input_tokens: n === 2 ? 5000 : 10, output_tokens: 5 }));
    const t = setup({ count: counted(1000), upstream, extra: { retry: { attempts: 3, elapsed_ms: 60_000 }, sleep } });
    const before = await byteReservation("/anthropic/v1/messages", opus(20_000));
    const b = t.bind();
    const a = t.call(b, "/anthropic/v1/messages", opus(20_000));
    await hit;
    expect((await t.call(b, "/anthropic/v1/messages", opus(20_000))).status).toBe(200);
    expect(t.journal().filter((l) => l.kind === "count_overrun")).toEqual([expect.objectContaining({ reservation_id: "res_2" })]);
    release();
    expect((await a).status).toBe(200);
    const retry = t.reserves().find((r) => r.try === 2)!;
    expect(retry.max_micros).toBe(before.reserve.max_micros);
    expect(retry.input_count).toMatchObject({ counter: "anthropic", count: null });
    expect(retry.input_count.fallback).toContain("res_2");
  });

  // Value: protects=a retry whose route never ran past its count keeps the counted reservation; fails_when=the recheck drops every retry to bytes; why_new=Capy review of the guard, the passing direction; seam=forward's retry loop; no_claim=none
  test("a retry on a route no count has run past keeps its counted reservation", async () => {
    let n = 0;
    const t = setup({ count: counted(1000), upstream: () => (n++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "1" } }) : usage({ input_tokens: 900, output_tokens: 5 })), extra: { retry: { attempts: 3, elapsed_ms: 60_000 } } });
    expect((await t.call(t.bind(), "/anthropic/v1/messages", opus(20_000))).status).toBe(200);
    const [first, second] = t.reserves();
    expect(second!.max_micros).toBe(first!.max_micros);
    expect(second!.input_count).toEqual(first!.input_count);
    expect(t.counts).toHaveLength(1);
    expect(t.journal().filter((l) => l.kind === "count_overrun")).toEqual([]);
  });
});

describe("the measured margin for OpenRouter's Sol translation", () => {
  /**
   * The paid probes of 2026-11-11 through this proxy: OpenRouter's Messages route, openai/gpt-6.1-sol, max_tokens 16, on
   * Claude Code request bodies and on bodies that add Read results of this repo's code, docs and JSON, mixed scripts, 120
   * small tool calls and 60 text turns. count is Sol's count of the proxy's translation, blocks and opaque are countPlan's,
   * and real is the input OpenRouter reported (input, cache reads and cache writes). Every real input came in 40 to 340
   * tokens under the count.
   */
  const PROBES: Array<{ name: string; count: number; blocks: number; opaque: number; real: number }> = [
    { name: "cc-cap1-first-turn", count: 12112, blocks: 19, opaque: 0, real: 12072 },
    { name: "cc-cap2-tool-turn", count: 12174, blocks: 21, opaque: 0, real: 12134 },
    { name: "cc-cap2-tool-turn-again", count: 12174, blocks: 21, opaque: 0, real: 12134 },
    { name: "code-reads", count: 37203, blocks: 31, opaque: 0, real: 37163 },
    { name: "markdown-reads", count: 43477, blocks: 31, opaque: 0, real: 43437 },
    { name: "json-reads", count: 19446, blocks: 25, opaque: 0, real: 19406 },
    { name: "unicode-reads", count: 25717, blocks: 28, opaque: 0, real: 25677 },
    { name: "many-small-blocks", count: 16025, blocks: 262, opaque: 0, real: 15985 },
    { name: "many-text-turns", count: 14945, blocks: 202, opaque: 0, real: 14605 },
    { name: "code-reads-streamed", count: 37203, blocks: 31, opaque: 0, real: 37163 },
  ];

  /** The rule the margin answers to: at least 1.5 times the largest relative gap between real and counted input. */
  const marginCovers = (margin: number) => PROBES.every((p) => margin >= 1.5 * ((p.real - p.count) / p.count));

  // Value: protects=the shipped margin is sized from the probes, and each probe's real input sits inside its bound; fails_when=the margin is below 1.5 times the largest observed gap or a probe's real input exceeds its bound; why_new=the Captain's guard 1; seam=TRANSLATED_COUNT_MARGIN and TRANSLATED_BLOCK_TOKENS; no_claim=inputs unlike the probes, which guard 2 catches
  test("the shipped margin covers 1.5 times the largest gap the probes measured, and every probe's input is inside its bound", () => {
    expect(PROBES.length).toBeGreaterThanOrEqual(8);
    expect(marginCovers(TRANSLATED_COUNT_MARGIN)).toBe(true);
    for (const p of PROBES) expect([p.name, p.real <= Math.ceil(p.count * (1 + TRANSLATED_COUNT_MARGIN)) + p.blocks * TRANSLATED_BLOCK_TOKENS + p.opaque]).toEqual([p.name, true]);
  });

  // Value: protects=the other direction: the rule refuses a margin smaller than the probes need; fails_when=the check passes any margin; why_new=the Captain's guard 1; seam=the rule itself; no_claim=none
  test("a margin below 1.5 times the largest measured gap fails the rule", () => {
    const largest = Math.max(...PROBES.map((p) => (p.real - p.count) / p.count));
    expect(marginCovers(1.5 * largest)).toBe(true);
    expect(marginCovers(1.5 * largest - 0.001)).toBe(false);
    expect(TRANSLATED_COUNT_MARGIN).toBeGreaterThan(0);
    expect(TRANSLATED_BLOCK_TOKENS).toBeGreaterThan(0);
  });

  // Value: protects=the pure plan and bound agree with the proxy's reservation; fails_when=countPlan or countedInputTokens drift from the reserve line; why_new=the replay scripts call them directly; seam=countPlan and countedInputTokens; no_claim=none
  test("countPlan and countedInputTokens give the proxy's numbers", () => {
    const body = { ...sol(1000), provider: { only: ["openai"] } };
    const price = priceRequest("openrouter", body, 1000, "/v1/messages");
    const plan = countPlan("openrouter", "/v1/messages", body, price)!;
    expect(plan).toMatchObject({ counter: "openai", path: "/v1/responses/input_tokens", blocks: SOL_BLOCKS, opaqueBytes: 0 });
    expect(plan.body).toEqual({ model: "gpt-6.1-sol", input: solInput(1000), tools: solTools });
    expect(countedInputTokens(plan, 2000, price.inputTokens)).toBe(Math.min(solBound(2000), price.inputTokens));
    expect(countPlan("openrouter", "/v1/chat/completions", { model: SOL, messages: [] }, priceRequest("openrouter", { model: SOL, messages: [] }, 1000, "/v1/chat/completions"))).toBeNull();
  });
});
