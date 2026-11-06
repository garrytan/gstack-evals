// Copyright (c) 2026 Garry Tan. MIT License.
// LocalLedger.releaseUnbilled: a send whose journal outcome had no usage, released at $0 only on a zero-cost generation
// record, never a reserved row, with its evidence kept in the releases table.
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { reconcileJournal } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome } from "../../src/types.ts";

const LEASE = "rel.0001.abcdef";
const ZERO = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "release-"));
  dirs.push(dir);
  const path = join(dir, "ledger.sqlite");
  const ledger = LocalLedger.open(path);
  ledger.addLease({ schema: 1, kind: "lease", item: "rel", seq: 1, lease_id: LEASE, run_id: "r1", machine_id: "m1", reserved_micros: 10_000_000, expires_at: new Date(Date.now() + 3_600_000).toISOString(), created_at: new Date().toISOString() });
  const journal = join(dir, "journal.ndjson");
  appendFileSync(journal, "");
  const line = (l: Record<string, unknown>) => appendFileSync(journal, JSON.stringify(l) + "\n");
  /** One send as the proxy journals it: reserve, request, then the outcome (none while the stream is open). */
  const send = async (key: string, outcome: CallOutcome | null, status: number | null = 200) => {
    const cell = { run_id: "r1", arm: "tbv", task: "label", model: "openrouter:openai/gpt-6.1-sol", trial: 1, attempt: 1, meter_id: key.split(":")[0]! };
    line({ kind: "reserve", idempotency_key: key, lease_id: LEASE, cell, max_micros: 42_000 });
    const held = await ledger.reserve({ idempotency_key: key, lease_id: LEASE, cell, max_micros: 42_000 });
    if (!held.ok) throw new Error(held.message);
    const rid = held.reservation.reservation_id;
    line({ kind: "request", reservation_id: rid, idempotency_key: key, lease_id: LEASE, cell, max_micros: 42_000 });
    if (outcome) {
      line({ kind: "outcome", reservation_id: rid, meter_id: cell.meter_id, status, outcome });
      await ledger.settle(rid, outcome);
    }
    return rid;
  };
  const record = (id: string, cost: number, tokens: Record<string, unknown> = { tokens_prompt: 0, tokens_completion: 0 }) => JSON.stringify({ data: { id, total_cost: cost, ...tokens } });
  const release = (key: string, id: string, rec: string) => ledger.releaseUnbilled({ lease_id: LEASE, idempotency_key: key, journal, generation_id: id, record: rec });
  const row = (rid: string) => new Database(path, { readonly: true }).query("SELECT state, spent_micros FROM reservations WHERE reservation_id = ?").get(rid) as { state: string; spent_micros: number | null };
  return { dir, path, ledger, journal, send, record, release, row };
}

describe("releaseUnbilled", () => {
  test("an unknown send with a zero-cost generation record is settled at $0, with the record's sha256 kept", async () => {
    const t = setup();
    const rid = await t.send("m1:1:1", { kind: "unknown" });
    expect(t.ledger.held(LEASE)).toBe(42_000);
    const rec = t.record("gen-a", 0);
    const reply = t.release("m1:1:1", "gen-a", rec);
    expect(reply.ok).toBe(true);
    expect(t.row(rid)).toEqual({ state: "settled", spent_micros: 0 });
    expect(t.ledger.held(LEASE)).toBe(0);
    const db = new Database(t.path, { readonly: true });
    const ev = db.query("SELECT reservation_id, idempotency_key, generation_id, record_sha256 FROM releases").all();
    db.close();
    expect(ev).toEqual([{ reservation_id: rid, idempotency_key: "m1:1:1", generation_id: "gen-a", record_sha256: createHash("sha256").update(rec).digest("hex") }]);
    expect(t.release("m1:1:1", "gen-a", rec).ok).toBe(true);
  });

  test("a reserved row (a stream still open) is never released", async () => {
    const t = setup();
    const rid = await t.send("m1:1:1", null);
    const reply = t.release("m1:1:1", "gen-a", t.record("gen-a", 0));
    expect(reply.ok).toBe(false);
    expect(t.row(rid)).toEqual({ state: "reserved", spent_micros: null });
  });

  test("a 5xx charged at its reservation with no usage can be released", async () => {
    const t = setup();
    const rid = await t.send("m1:1:1", { kind: "spent", spent_micros: 42_000, usage: ZERO }, 503);
    expect(t.release("m1:1:1", "gen-b", t.record("gen-b", 0)).ok).toBe(true);
    expect(t.row(rid)).toEqual({ state: "settled", spent_micros: 0 });
  });

  test("a send that reported usage, a record with a cost, a record for another id, bad JSON or an unknown key are refused", async () => {
    const t = setup();
    const billed = await t.send("m1:1:1", { kind: "spent", spent_micros: 6_000, usage: { ...ZERO, input: 900, output: 120 } });
    const unknown = await t.send("m1:2:1", { kind: "unknown" });
    for (const [key, id, rec] of [
      ["m1:1:1", "gen-a", t.record("gen-a", 0)],
      ["m1:2:1", "gen-c", t.record("gen-c", 0.0012)],
      ["m1:2:1", "gen-c", t.record("gen-other", 0)],
      ["m1:2:1", "gen-c", "not json"],
      ["m1:2:1", "gen-c", JSON.stringify({ data: { id: "gen-c" } })],
      ["m9:1:1", "gen-c", t.record("gen-c", 0)],
    ] as const) expect(t.release(key, id, rec).ok).toBe(false);
    expect(t.row(billed)).toEqual({ state: "settled", spent_micros: 6_000 });
    expect(t.row(unknown)).toEqual({ state: "unknown", spent_micros: null });
  });

  test("a total_cost of 0 with nonzero or missing token counts keeps its reservation; zero token counts release it", async () => {
    const t = setup();
    const rid = await t.send("m1:1:1", { kind: "unknown" });
    expect(t.release("m1:1:1", "gen-a", t.record("gen-a", 0, { tokens_prompt: 900, tokens_completion: 0 })).ok).toBe(false);
    expect(t.release("m1:1:1", "gen-a", t.record("gen-a", 0, { tokens_prompt: 0, tokens_completion: 120 })).ok).toBe(false);
    expect(t.release("m1:1:1", "gen-a", t.record("gen-a", 0, {})).ok).toBe(false);
    expect(t.row(rid)).toEqual({ state: "unknown", spent_micros: null });
    expect(t.release("m1:1:1", "gen-a", t.record("gen-a", 0)).ok).toBe(true);
    expect(t.row(rid)).toEqual({ state: "settled", spent_micros: 0 });
  });

  test("a closed lease releases nothing", async () => {
    const t = setup();
    await t.send("m1:1:1", { kind: "unknown" });
    settleLease(null, t.ledger, LEASE);
    const reply = t.release("m1:1:1", "gen-a", t.record("gen-a", 0));
    expect(reply.ok).toBe(false);
  });

  test("reconcileJournal after a release keeps it, and the close totals leave the released send out", async () => {
    const t = setup();
    await t.send("m1:1:1", { kind: "unknown" });
    await t.send("m1:2:1", { kind: "unknown" });
    await t.send("m1:3:1", { kind: "spent", spent_micros: 6_000, usage: { ...ZERO, input: 900, output: 120 } });
    expect(t.release("m1:1:1", "gen-a", t.record("gen-a", 0)).ok).toBe(true);
    const rec = await reconcileJournal(t.journal, t.ledger);
    expect(rec.refused).toEqual([]);
    const close = settleLease(null, t.ledger, LEASE);
    expect(close.spent_micros).toBe(6_000);
    expect(close.unknown_micros).toBe(42_000);
    expect(close.unknown_calls).toBe(1);
  });

  test("an older ledger file gains the releases table when it opens", () => {
    const t = setup();
    t.ledger.close();
    const db = new Database(t.path);
    db.exec("DROP TABLE releases");
    db.close();
    const again = LocalLedger.open(t.path);
    again.close();
    const check = new Database(t.path, { readonly: true });
    expect(check.query("SELECT name FROM sqlite_master WHERE name = 'releases'").get()).toEqual({ name: "releases" });
    check.close();
  });
});
