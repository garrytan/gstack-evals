// Copyright (c) 2026 Garry Tan. MIT License.
// The session driver's h2h stage branch (driver/stage.ts with h2h/sessions/driver.ts) and the metering proxy's
// reservation-bound signal (post sections 3 and 7): each h2h model item serves its own arms only, one slot per session at
// the session allowance, one whole-session retry naming meta.rerun, and 5 and 21 calls in flight at the proxy's byte
// fallback, where the calls that only in-flight reservations block are retryable 429s counted apart from allowance stops.
// On a temporary ledger with a stub upstream; no key, no paid call.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { MeteringProxy, RESERVATION_RETRY_AFTER_S } from "../../src/runner/proxy/metering-proxy.ts";
import { serveStages, type ServeOptions, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";
import { H2H_STAGES } from "../../lanes/outcome-skills/h2h/sessions/driver.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const D = 1_000_000;
const P = readPrereg();
const MODEL = P.model;
const CAP = P.limits.allowance_usd;
const quote = { words: "test words", by: "test", source: "h2h-driver.test.ts" };
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

type Upstream = (url: string, init: RequestInit) => Promise<Response>;
const ok = (output = 10): Response => Response.json({ id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });

function ledger(items: Record<string, { cap: number; skills?: string[] }>, upstream: Upstream = async () => ok()) {
  const root = mkdtempSync(join(tmpdir(), "h2h-driver-test-"));
  roots.push(root);
  const record = join(root, "record");
  recordProgram(record, { program: "w", cap_micros: 5_000 * D, skill_cap_micros: 5_000 * D, skills: ["h2h", "pf"], credit_rate_micros: D, quotes: [quote] });
  for (const [item, v] of Object.entries(items)) recordApproval(record, { action: "init", item, cap_micros: v.cap * D, quotes: [quote], admission: "required", program: "w", skills: v.skills ?? ["h2h"] });
  const local = LocalLedger.open(join(root, "ledger.sqlite"));
  const serve = (stages: StageSpec[], extra: Partial<ServeOptions> = {}) => serveStages({ record, local, run_id: "r1", envelope_host: "m1", machine: "m1", stages, host: "127.0.0.1", dir: join(root, "run"), fetch: upstream, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key" }, log: () => {}, ...extra });
  return { root, local, serve };
}

function client(control: string) {
  const open = async (o: { arm: string; cap?: number; model?: string; task?: string; rerun?: string; phase?: string }) => {
    const meta = { arm: o.arm, task: o.task ?? "u1", trial_n: 1, ...(o.rerun ? { rerun: o.rerun } : {}), ...(o.phase ? { phase: o.phase } : {}) };
    const res = await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t", model: o.model ?? MODEL, cap_usd: o.cap ?? CAP, ledger: "u4", open_key: crypto.randomUUID(), meta }) });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  const close = async (id: string) => (await (await fetch(control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).json()) as Record<string, any>;
  return { open, close };
}

/** A Messages body at the proxy's byte fallback: about 690 KB of input with a cache marker, as Claude Code sends, and a 32,000-token output cap. */
const big = JSON.stringify({ model: MODEL, max_tokens: 32_000, system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: "x".repeat(690_000) }], tools: [{ name: "Bash", description: "run", input_schema: { type: "object" } }] });
const call = (base: string, token: string) => fetch(base + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": token }, body: big });

/** An upstream that holds every answer until release() is called, counting arrivals. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((r) => (release = r));
  const g = { arrived: 0, release, upstream: (async () => {
    g.arrived++;
    await opened;
    return ok();
  }) as Upstream };
  return g;
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 400 && !f(); i++) await Bun.sleep(10);
  expect(f()).toBe(true);
};

test("each h2h model item starts on its own arms; mixed lanes, an unknown item, a stage model, a stray arm, a wrong skill and a chosen allowance are refused", async () => {
  for (const [item, arms] of Object.entries(H2H_STAGES)) {
    const { serve, local } = ledger({ [item]: { cap: 100 } });
    const served = await serve([{ item, arm: item, arms }]);
    expect(served.stages.map((s) => s.item)).toEqual([item]);
    expect(await served.stop()).toBe(0);
    local.close?.();
  }
  const refused = async (items: Record<string, { cap: number; skills?: string[] }>, stages: StageSpec[], text: string, extra: Partial<ServeOptions> = {}) => {
    const { serve, local } = ledger(items);
    await expect(serve(stages, extra)).rejects.toThrow(text);
    local.close?.();
  };
  await refused({ "h2h-opus": { cap: 100 } }, [{ item: "h2h-opus", arm: "h2h-opus", arms: ["h2h:none", "sm:A0"] }], "mixes h2h arms with other lanes' arms");
  await refused({ "h2h-opus": { cap: 100 } }, [{ item: "h2h-opus", arm: "h2h-opus", arms: ["h2h:none", "pf:P"] }], "mixes PF arms");
  await refused({ "h2h-x": { cap: 100 } }, [{ item: "h2h-x", arm: "h2h-x", arms: ["h2h:none"] }], "is not an h2h model item");
  await refused({ "h2h-opus": { cap: 100 } }, [{ item: "h2h-opus", arm: "h2h-opus", model: MODEL, arms: ["h2h:none"] }], "runs prereg.json's model");
  await refused({ "h2h-opus": { cap: 100 } }, [{ item: "h2h-opus", arm: "h2h-opus", arms: ["h2h:gstack-qa"] }], "not h2h:gstack-qa");
  await refused({ "h2h-opus": { cap: 100, skills: ["pf"] } }, [{ item: "h2h-opus", arm: "h2h-opus", arms: ["h2h:none"] }], "spends for h2h");
  await refused({ "h2h-opus": { cap: 100 } }, [{ item: "h2h-opus", arm: "h2h-opus", arms: ["h2h:none"] }], "not $30", { h2h_allowance_usd: 30 });
});

test("one slot per session at the allowance, one whole-session retry naming meta.rerun, and the doubled allowance after stage 1", async () => {
  const { serve, local, root } = ledger({ "h2h-opus": { cap: 500 }, "h2h-pony": { cap: 200 }, "h2h-qa": { cap: 100 } });
  const served = await serve([{ item: "h2h-opus", arm: "h2h-opus", arms: H2H_STAGES["h2h-opus"]! }, { item: "h2h-pony", arm: "h2h-pony", arms: H2H_STAGES["h2h-pony"]! }, { item: "h2h-qa", arm: "h2h-qa", arms: H2H_STAGES["h2h-qa"]! }]);
  const { open, close } = client(served.control);
  const first = await open({ arm: "h2h:gstack" });
  expect(first.status).toBe(200);
  expect(first.json).toMatchObject({ item: "h2h-opus", allowance_micros: CAP * D });
  expect(first.json.base_url).toEndWith("/anthropic");
  const pony = await open({ arm: "h2h:gstack-pony" });
  expect(pony.json).toMatchObject({ item: "h2h-pony" });
  const qa = await open({ arm: "h2h:gstack-qa" });
  expect(qa.json).toMatchObject({ item: "h2h-qa" });
  expect((await open({ arm: "h2h:none", cap: 6 })).json.detail).toContain("session_cap_usd of " + CAP);
  expect((await open({ arm: "h2h:none", phase: "task" })).json.detail).toContain("PF sessions only");
  expect((await open({ arm: "h2h:none", model: "claude-sonnet-5-5" })).status).toBe(400);
  expect((await open({ arm: "h2h:gstack" })).status).toBe(422);
  const retry = await open({ arm: "h2h:gstack", rerun: "upstream end" });
  expect(retry.status).toBe(200);
  expect((await open({ arm: "h2h:gstack", rerun: "again" })).json.detail).toContain("one rerun at most");
  const answer = await close(first.json.id);
  expect(answer).toMatchObject({ finalized: true, allowance_stops: 0, reservation_bound: 0 });
  for (const id of [pony.json.id, qa.json.id, retry.json.id]) await close(id);
  expect(await served.stop()).toBe(0);
  const lines = readFileSync(join(root, "run", "sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.filter((e) => e.event === "open").map((e) => [e.arm, e.model, e.rerun ?? null])).toEqual([["h2h:gstack", MODEL, null], ["h2h:gstack-pony", MODEL, null], ["h2h:gstack-qa", MODEL, null], ["h2h:gstack", MODEL, "upstream end"]]);
  local.close?.();

  const doubled = ledger({ "h2h-opus": { cap: 500 } });
  const s2 = await doubled.serve([{ item: "h2h-opus", arm: "h2h-opus", arms: ["h2h:none"] }], { h2h_allowance_usd: 2 * CAP });
  const c2 = client(s2.control);
  expect((await c2.open({ arm: "h2h:none", cap: CAP })).status).toBe(400);
  const twice = await c2.open({ arm: "h2h:none", cap: 2 * CAP });
  expect(twice.json).toMatchObject({ allowance_micros: 2 * CAP * D });
  await c2.close(twice.json.id);
  expect(await s2.stop()).toBe(0);
  doubled.local.close?.();
});

test("5 calls in flight at the byte fallback fit the allowance; of 21, the ones only in-flight reservations block are retryable 429s counted apart from allowance stops; a settled-spend refusal is an allowance stop", async () => {
  const g5 = gate();
  const five = ledger({ "h2h-smoke": { cap: 200 } }, (u, i) => g5.upstream(u, i));
  const s5 = await five.serve([{ item: "h2h-smoke", arm: "h2h-smoke", arms: ["h2h:none"] }]);
  const c5 = client(s5.control);
  const slot5 = (await c5.open({ arm: "h2h:none" })).json;
  const calls5 = Array.from({ length: 5 }, () => call(slot5.base_url, slot5.token));
  await until(() => g5.arrived === 5);
  g5.release();
  expect((await Promise.all(calls5)).map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
  expect(await c5.close(slot5.id)).toMatchObject({ allowance_stops: 0, reservation_bound: 0, refusals: [] });
  expect(await s5.stop()).toBe(0);
  five.local.close?.();

  const g21 = gate();
  const many = ledger({ "h2h-smoke": { cap: 200 } }, (u, i) => g21.upstream(u, i));
  const s21 = await many.serve([{ item: "h2h-smoke", arm: "h2h-smoke", arms: ["h2h:gstack"] }]);
  const c21 = client(s21.control);
  const slot = (await c21.open({ arm: "h2h:gstack" })).json;
  const answers: Response[] = [];
  const calls = Array.from({ length: 21 }, () => call(slot.base_url, slot.token).then((r) => (answers.push(r), r)));
  await until(() => g21.arrived + answers.length === 21);
  const refused = answers.filter((r) => r.status === 429);
  const journal = readFileSync(join(many.root, "run", s21.stages[0]!.lease_id + ".journal.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const worst = journal.find((j) => j.kind === "reserve").max_micros as number;
  expect(5 * worst).toBeLessThanOrEqual(CAP * D);
  expect(21 * worst).toBeGreaterThan(CAP * D);
  expect(g21.arrived).toBe(Math.floor((CAP * D) / worst));
  expect(refused.length).toBe(21 - g21.arrived);
  expect(refused[0]!.headers.get("retry-after")).toBe(String(RESERVATION_RETRY_AFTER_S));
  expect(((await refused[0]!.json()) as { code: string }).code).toBe("E_H2H_RESERVATION_BOUND");
  expect(journal.filter((j) => j.kind === "refusal").every((j) => j.code === "E_H2H_RESERVATION_BOUND" && j.reservation_bound === true)).toBe(true);
  g21.release();
  await Promise.all(calls);
  expect(await c21.close(slot.id)).toMatchObject({ allowance_stops: 0, reservation_bound: 21 - g21.arrived, refusals: ["E_H2H_RESERVATION_BOUND"] });

  let n = 0;
  const filled = ledger({ "h2h-smoke": { cap: 200 } }, async () => ok(n++ === 0 ? 1_200_000 : 10));
  const s3 = await filled.serve([{ item: "h2h-smoke", arm: "h2h-smoke", arms: ["h2h:gsd"] }]);
  const c3 = client(s3.control);
  const slot3 = (await c3.open({ arm: "h2h:gsd" })).json;
  expect((await call(slot3.base_url, slot3.token)).status).toBe(200);
  const stop = await call(slot3.base_url, slot3.token);
  expect(stop.status).toBe(402);
  expect(await c3.close(slot3.id)).toMatchObject({ allowance_stops: 1, reservation_bound: 0, refusals: ["E_ALLOWANCE"] });
  expect(await s21.stop()).toBe(0);
  expect(await s3.stop()).toBe(0);
  many.local.close?.();
  filled.local.close?.();
});

class Ledger implements ReservationLedger {
  n = 0;
  rows = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: "res_" + ++this.n, idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros, state: "reserved", spent_micros: null, usage: null };
    this.rows.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.rows.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

test("without reservationBoundRetry the proxy answers every allowance refusal as before: 402 E_ALLOWANCE, an allowance stop, no reservation_bound field", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2h-proxy-"));
  roots.push(dir);
  const g = gate();
  const proxy = new MeteringProxy({ ledger: new Ledger(), leaseId: "l1", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789abcdef", journal: join(dir, "j.ndjson"), retry: { attempts: 1, elapsed_ms: 60_000 }, env: { ANTHROPIC_API_KEY: "k" }, sleep: async () => {}, fetch: g.upstream });
  proxy.start();
  const slot = proxy.bind({ cell: { run_id: "r", arm: "a", task: "t", model: MODEL, trial: 1, attempt: 1 }, models: ["anthropic:" + MODEL], allowance_micros: CAP * D });
  const base = "http://127.0.0.1:" + proxy.port + "/" + slot.slot + "/anthropic";
  const answers: Response[] = [];
  const calls = Array.from({ length: 21 }, () => call(base, slot.token).then((r) => (answers.push(r), r)));
  await until(() => g.arrived + answers.length === 21);
  expect(answers.every((r) => r.status === 402 && r.headers.get("retry-after") === null)).toBe(true);
  g.release();
  await Promise.all(calls);
  const m = await proxy.finalize(slot.meter_id);
  expect(m.allowance_stops).toBe(21 - g.arrived);
  expect("reservation_bound" in m).toBe(false);
  proxy.stop();
});
