import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAT_PRICES, priceRequest, reservationMicros } from "../../src/runner/pricing/prices.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS, MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import { ER_ADMISSION_RULE, ER_ALLOWANCE_MICROS, ER_MODELS, erAdmits, erAllowance } from "../../src/trial/review/eng-review.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const OPUS = "claude-opus-5-5";
const SOL = "openai/gpt-6.1-sol";
const PARTICLE = "particle-ai/particle-1";
const MANAGEMENT = "management-token-0123456789abcdef";

/** Stage 1's largest Sol allowance refusal (sol-none-r2, a reservation-only stop): settled spend, the two reservations open beside it, and the refused call's worst case. */
const STAGE1 = { settled: 1_298_000, open: [3_499_000, 3_499_000], worst: 1_888_000 };

class Ledger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  async reserve(request: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: "res_" + (this.reservations.size + 1), idempotency_key: request.idempotency_key, lease_id: request.lease_id, cell: request.cell, max_micros: request.max_micros, state: "reserved", spent_micros: null, usage: null };
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
  for (const f of cleanup) f();
  cleanup = [];
});

type Reply = { usage: Record<string, number>; hold?: Promise<void> };
/** A real metering proxy whose upstream answers each call with the next reply, waiting on its hold first. */
function proxyWith(replies: Reply[]) {
  const dir = mkdtempSync(join(tmpdir(), "er-allowance-"));
  const sent: number[] = [];
  const proxy = new MeteringProxy({
    ledger: new Ledger(),
    leaseId: "l1",
    host: "127.0.0.1",
    managementSocket: join(dir, "management.sock"),
    managementToken: MANAGEMENT,
    journal: join(dir, "journal.ndjson"),
    retry: { attempts: 1, elapsed_ms: 1_000 },
    env: { ANTHROPIC_API_KEY: "sk-ant-real-key-0123456789", OPENROUTER_API_KEY: "sk-or-v1-real-key-0123456789" },
    sleep: async () => {},
    fetch: async () => {
      const reply = replies[sent.length]!;
      sent.push(sent.length);
      await reply.hold;
      return Response.json({ id: "msg", usage: reply.usage });
    },
  });
  proxy.start();
  cleanup.push(() => proxy.stop(), () => rmSync(dir, { recursive: true, force: true }));
  return { proxy, sent };
}

const route = (model: string) => (model === OPUS ? { key: "anthropic:" + model, path: "/anthropic/v1/messages", provider: "anthropic" as const } : { key: "openrouter:" + model, path: "/openrouter/v1/messages", provider: "openrouter" as const });
const body = (model: string, chars: number) => ({ model, max_tokens: DEFAULT_MAX_OUTPUT_TOKENS, messages: [{ role: "user", content: "x".repeat(chars) }] });
const worstOf = (model: string, chars: number) => reservationMicros(priceRequest(route(model).provider, body(model, chars), DEFAULT_MAX_OUTPUT_TOKENS, "/v1/messages"));
/** The smallest request whose worst case on this model is at least the target, found by bisection over its length. */
function sized(model: string, target: number): number {
  let lo = 0;
  let hi = 8_000_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (worstOf(model, mid) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
/** Usage that settles at about the given spend on this model, well under its long-prompt threshold. */
const spendUsage = (model: string, micros: number) => ({ input_tokens: 10, output_tokens: Math.ceil(micros / CHAT_PRICES[route(model).key]!.output) });

/** Replays a stage 1 refusal shape on a slot at the model's eng-review allowance: one call settles the spend, two calls stay open, then the shape's last call arrives. */
async function replay(model: string, shape: typeof STAGE1) {
  const release: Array<() => void> = [];
  const holds = shape.open.map(() => new Promise<void>((resolve) => release.push(resolve)));
  const { proxy, sent } = proxyWith([{ usage: spendUsage(model, shape.settled) }, ...holds.map((hold) => ({ usage: { input_tokens: 10, output_tokens: 10 }, hold })), { usage: { input_tokens: 10, output_tokens: 10 } }]);
  const r = route(model);
  const slot = proxy.bind({ cell: { run_id: "r1", arm: "none", task: "unit-a", model, trial: 1, attempt: 1 }, models: [r.key], allowance_micros: erAllowance(model) });
  const call = (chars: number) => fetch("http://127.0.0.1:" + proxy.port + "/" + slot.slot + r.path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": slot.token }, body: JSON.stringify(body(model, chars)) });
  expect((await call(10)).status).toBe(200);
  const open = shape.open.map((micros) => call(sized(model, micros)));
  while (sent.length < 1 + shape.open.length) await Bun.sleep(5);
  const last = await call(sized(model, shape.worst));
  for (const f of release) f();
  await Promise.all(open);
  const meter = await proxy.finalize(slot.meter_id);
  return { status: last.status, detail: last.status === 200 ? "" : ((await last.json()) as { code: string }).code, upstream: sent.length, refused: meter.refused };
}

describe("eng-review allowance per model", () => {
  test("every eng-review model has an allowance; Opus and particle-1 keep $10 and Sol's covers half again stage 1's largest refusal, in whole dollars", () => {
    expect(Object.keys(ER_ALLOWANCE_MICROS).sort()).toEqual(Object.keys(ER_MODELS).sort());
    expect(erAllowance(OPUS)).toBe(10_000_000);
    expect(erAllowance(PARTICLE)).toBe(10_000_000);
    const need = STAGE1.settled + STAGE1.open.reduce((s, x) => s + x, 0) + STAGE1.worst;
    expect(erAllowance(SOL)).toBeGreaterThanOrEqual(Math.ceil((need * 1.5) / 1e6) * 1e6);
    expect(erAllowance(SOL) % 1_000_000).toBe(0);
    expect(() => erAllowance("openai/gpt-6-astra")).toThrow(/^E_MODEL_POLICY: /);
  });

  test("admission counts each attempt in flight at its own model's allowance", () => {
    expect(erAdmits(5_000_000, erAllowance(SOL), erAllowance(OPUS), 15_000_000 + erAllowance(SOL))).toBe(true);
    expect(erAdmits(5_000_001, erAllowance(SOL), erAllowance(OPUS), 15_000_000 + erAllowance(SOL))).toBe(false);
    expect(erAdmits(0, 0, erAllowance(SOL), erAllowance(SOL))).toBe(true);
    expect(erAdmits(0, 0, erAllowance(SOL), erAllowance(SOL) - 1)).toBe(false);
    expect(ER_ADMISSION_RULE).toContain("$10 for an Opus or particle-1 attempt and $" + erAllowance(SOL) / 1e6 + " for a Sol attempt");
  });

  test("a Sol attempt at stage 1's largest refusal shape now proceeds", async () => {
    const r = await replay(SOL, STAGE1);
    expect(r).toEqual({ status: 200, detail: "", upstream: 4, refused: 0 });
  });

  test("an Opus attempt at the same shape still stops at its $10 allowance", async () => {
    const r = await replay(OPUS, STAGE1);
    expect(r).toEqual({ status: 402, detail: "E_ALLOWANCE", upstream: 3, refused: 1 });
  });

  test("real spend past Sol's allowance still stops the attempt", async () => {
    const step = 4_000_000;
    const worst = worstOf(SOL, 10);
    const fits = Math.floor((erAllowance(SOL) - worst) / step) + 1;
    const { proxy, sent } = proxyWith(Array.from({ length: fits + 1 }, () => ({ usage: spendUsage(SOL, step) })));
    const slot = proxy.bind({ cell: { run_id: "r1", arm: "none", task: "unit-a", model: SOL, trial: 1, attempt: 1 }, models: ["openrouter:" + SOL], allowance_micros: erAllowance(SOL) });
    const statuses: number[] = [];
    for (let i = 0; i <= fits; i++) statuses.push((await fetch("http://127.0.0.1:" + proxy.port + "/" + slot.slot + "/openrouter/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": slot.token }, body: JSON.stringify(body(SOL, 10)) })).status);
    expect(statuses).toEqual([...Array.from({ length: fits }, () => 200), 402]);
    expect(sent.length).toBe(fits);
    const meter = await proxy.finalize(slot.meter_id);
    expect(meter.refused).toBe(1);
    expect(meter.micros).toBeGreaterThan(erAllowance(SOL) - step);
  });
});
