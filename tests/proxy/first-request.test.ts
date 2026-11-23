// The metering proxy's firstRequestFields option (pstack-checks prereg section 3): on for that family's stages only, it
// copies the named top-level fields of a slot's first paid request with a non-empty tools list into the slot's meter, as
// the client sent them; off, every caller's requests, answers and meters stay as before the option existed. Keyless: a
// fake ledger and a fake upstream.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeteringProxy, type ProxyOptions } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const cell: Omit<CellAttempt, "meter_id"> = { run_id: "r1", arm: "pf:P", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 };
const FIELDS = ["thinking", "output_config", "reasoning", "reasoning_effort", "effort", "max_tokens"];

class Ledger implements ReservationLedger {
  reserves = 0;
  rows = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    this.reserves++;
    const reservation: Reservation = { reservation_id: "res_" + this.reserves, idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros, state: "reserved", spent_micros: null, usage: null };
    this.rows.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.rows.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

const dirs: string[] = [];
const proxies: MeteringProxy[] = [];
afterEach(() => {
  for (const p of proxies.splice(0)) p.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(extra: Partial<ProxyOptions>) {
  const dir = mkdtempSync(join(tmpdir(), "first-request-"));
  dirs.push(dir);
  const sent: string[] = [];
  const proxy = new MeteringProxy({
    ledger: new Ledger(), leaseId: "l1", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789abcdef", journal: join(dir, "journal.ndjson"),
    retry: { attempts: 1, elapsed_ms: 60_000 }, env: { ANTHROPIC_API_KEY: "sk-ant-test-0123456789" }, sleep: async () => {},
    fetch: async (_url, init) => {
      sent.push(String(init.body ?? ""));
      return Response.json({ id: "msg", usage: { input_tokens: 10, output_tokens: 5 } });
    },
    ...extra,
  });
  proxy.start();
  proxies.push(proxy);
  const slot = proxy.bind({ cell, models: ["anthropic:claude-opus-5-5"], allowance_micros: 5_000_000 });
  const call = async (body: unknown, route = "/v1/messages") => {
    const res = await fetch("http://127.0.0.1:" + proxy.port + "/" + slot.slot + "/anthropic" + route, { method: "POST", headers: { "content-type": "application/json", "x-api-key": slot.token }, body: JSON.stringify(body) });
    return res.status + " " + (await res.text());
  };
  return { proxy, slot, sent, call };
}

const tools = [{ name: "Bash", description: "run", input_schema: { type: "object" } }];
const side = { model: "claude-opus-5-5", max_tokens: 512, messages: [{ role: "user", content: "title this" }] };
const main = { model: "claude-opus-5-5", messages: [{ role: "user", content: "fix it" }], tools, thinking: { type: "adaptive" }, output_config: { effort: "high" } };
const later = { ...main, thinking: { type: "disabled" }, output_config: { effort: "low" }, max_tokens: 1000 };

// Value: protects=section 3's effort check on paid PF runs; fails_when=the record skips the first main request, takes a request with no or empty tools, records the body after the proxy fills max_tokens, or a later request overwrites it; why_new=pstack-checks ruling 3; seam=ProxyOptions.firstRequestFields; no_claim=what Claude Code sends
test("with firstRequestFields on, the meter keeps the named fields of the first request with a tools list, as sent", async () => {
  const t = setup({ firstRequestFields: FIELDS });
  expect(await t.call(side)).toStartWith("200 ");
  expect(await t.call({ ...side, tools: [] })).toStartWith("200 ");
  expect(await t.call(main)).toStartWith("200 ");
  expect(await t.call(later)).toStartWith("200 ");
  expect(JSON.parse(t.sent[2]!).max_tokens).toBeGreaterThan(0);
  const meter = await t.proxy.finalize(t.slot.meter_id);
  expect(meter.requests).toBe(4);
  expect(meter.first_request).toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "high" }, reasoning: null, reasoning_effort: null, effort: null, max_tokens: null });
});

// Value: protects=a slot that never sent a main request reads as no record, so section 3's check fails it; fails_when=a side request or a token count fills the record; why_new=pstack-checks ruling 3; seam=ProxyOptions.firstRequestFields; no_claim=the driver's close answer (pf-driver.test.ts)
test("with firstRequestFields on, a slot with no paid request carrying tools has no record", async () => {
  const t = setup({ firstRequestFields: FIELDS });
  expect(await t.call(side)).toStartWith("200 ");
  expect(await t.call(main, "/v1/messages/count_tokens")).toStartWith("200 ");
  const meter = await t.proxy.finalize(t.slot.meter_id);
  expect(meter.first_request).toBeUndefined();
});

// Value: protects=every other lane's proxy behaviour (the option is off by default); fails_when=the option changes a body, an answer or a meter when off; why_new=pstack-checks ruling 3; seam=ProxyOptions.firstRequestFields; no_claim=behaviour of other options
test("with firstRequestFields off, every request gets today's answer and upstream bytes, the meter has no record, and on changes no body", async () => {
  const unset = setup({});
  const on = setup({ firstRequestFields: FIELDS });
  const answers = async (t: ReturnType<typeof setup>) => {
    const out: string[] = [];
    for (const b of [side, main, later]) out.push(await t.call(b));
    return out;
  };
  const before = await answers(unset);
  expect(before.every((a) => a.startsWith("200 "))).toBe(true);
  expect(await answers(on)).toEqual(before);
  expect(on.sent).toEqual(unset.sent);
  const plain = await unset.proxy.finalize(unset.slot.meter_id);
  expect("first_request" in plain).toBe(false);
  const { first_request, meter_id, ...rest } = await on.proxy.finalize(on.slot.meter_id);
  expect(first_request).toMatchObject({ thinking: { type: "adaptive" } });
  const { meter_id: plainId, ...plainRest } = plain;
  expect(rest).toEqual(plainRest);
  expect([meter_id, plainId]).toEqual([on.slot.meter_id, unset.slot.meter_id]);
});
