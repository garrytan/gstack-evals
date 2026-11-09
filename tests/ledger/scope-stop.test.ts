// Copyright (c) 2026 Garry Tan. MIT License.
// LocalLedger.stopScope and settleScope (GST-2016, devex prereg section 15 rule 3): a per-model stop on a lease that
// several models share settles only that model's sessions and reservations, and the lease stays open and keeps
// admitting every other model. Both directions are tested: the stopped model's reservations release, and another
// model's reservations and admission are untouched.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerError } from "../../src/runner/ledger/record.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import type { CellAttempt } from "../../src/types.ts";

const LEASE = "dx-s1-runs.0002.abcdef";
const OTHER = "dx-s1-runs.0003.fedcba";
const USAGE = { input: 10, output: 5, reasoning: 0, cache_read: 0, cache_write: 0 };
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "scope-stop-"));
  dirs.push(dir);
  const ledger = LocalLedger.open(join(dir, "ledger.sqlite"));
  for (const [id, seq] of [[LEASE, 2], [OTHER, 3]] as const) {
    ledger.addLease({ schema: 1, kind: "lease", item: "dx-s1-runs", seq, lease_id: id, run_id: "dx-s1", machine_id: "m1", reserved_micros: 10_000_000, expires_at: new Date(Date.now() + 3_600_000).toISOString(), created_at: new Date().toISOString() });
  }
  let n = 0;
  const cell = (model: string, arm = "plan-devex-review"): CellAttempt => ({ run_id: "dx-s1", arm, task: "unit-1", model, trial: 1, attempt: 1, meter_id: model + "-" + arm });
  const reserve = (model: string, lease = LEASE, arm?: string) => ledger.reserve({ idempotency_key: "k" + ++n, lease_id: lease, cell: cell(model, arm), max_micros: 1_500_000 });
  return { ledger, reserve };
}

const OPUS = "claude-opus-5-5";
const SOL = "openai/gpt-6.1-sol";

describe("a per-model stop on a shared lease", () => {
  test("the stopped model's reservations release: its in-flight call settles as unknown and its later calls are refused", async () => {
    const { ledger, reserve } = setup();
    const done = await reserve(SOL);
    const flying = await reserve(SOL);
    if (!done.ok || !flying.ok) throw new Error("setup reserve refused");
    await ledger.settle(done.reservation.reservation_id, { kind: "spent", spent_micros: 400_000, usage: USAGE });
    const stop = ledger.stopScope(LEASE, { field: "model", value: SOL }, "E_DX_PROVIDER_DRIFT", "sol served by another provider");
    expect(stop).toMatchObject({ first: true, in_flight: 1, stop: { field: "model", value: SOL, code: "E_DX_PROVIDER_DRIFT" } });
    const refused = await reserve(SOL);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("E_DX_PROVIDER_DRIFT");
    expect(ledger.settleScope(LEASE, { field: "model", value: SOL })).toEqual({ settled_calls: 1, spent_micros: 400_000, unknown_calls: 1, unknown_micros: 1_500_000 });
    const late = await ledger.settle(flying.reservation.reservation_id, { kind: "spent", spent_micros: 100_000, usage: USAGE });
    expect(late.ok).toBe(false);
    expect(ledger.getLease(LEASE)!.state).toBe("open");
  });

  test("another model's open lease stays open and still admits: its reservations are untouched and it keeps reserving", async () => {
    const { ledger, reserve } = setup();
    const opusFlying = await reserve(OPUS);
    await reserve(SOL);
    if (!opusFlying.ok) throw new Error("setup reserve refused");
    ledger.stopScope(LEASE, { field: "model", value: SOL }, "E_DX_STOCK_FAIL", "stock fail on sol lists");
    ledger.settleScope(LEASE, { field: "model", value: SOL });
    expect(ledger.getLease(LEASE)!.state).toBe("open");
    const next = await reserve(OPUS);
    expect(next.ok).toBe(true);
    const settled = await ledger.settle(opusFlying.reservation.reservation_id, { kind: "spent", spent_micros: 300_000, usage: USAGE });
    expect(settled.ok).toBe(true);
    const close = ledger.stageClose(LEASE);
    expect(close.spent_micros).toBe(300_000);
    expect(close.unknown_calls).toBe(2);
    expect(close.cap_stop).toBeUndefined();
  });

  test("the first stop on a scope stands, a stop on one lease leaves another lease alone, and an arm scope works the same way", async () => {
    const { ledger, reserve } = setup();
    ledger.stopScope(LEASE, { field: "model", value: SOL }, "E_DX_JUDGE_KAPPA", "first");
    expect(ledger.stopScope(LEASE, { field: "model", value: SOL }, "E_DX_PROVIDER_DRIFT", "second")).toMatchObject({ first: false, stop: { code: "E_DX_JUDGE_KAPPA", scope: "first" } });
    expect((await reserve(SOL, OTHER)).ok).toBe(true);
    ledger.stopScope(LEASE, { field: "arm", value: "autoplan" }, "E_DX_PROVIDER_DRIFT", "arm scope");
    expect((await reserve(OPUS, LEASE, "autoplan")).ok).toBe(false);
    expect((await reserve(OPUS, LEASE, "none")).ok).toBe(true);
    expect(ledger.scopeStops(LEASE).map((s) => s.value)).toEqual([SOL, "autoplan"]);
  });

  test("a closed lease takes no scope stop, and a scope settles only once it is stopped", async () => {
    const { ledger } = setup();
    expect(() => ledger.settleScope(LEASE, { field: "model", value: SOL })).toThrow(LedgerError);
    ledger.stageClose(OTHER);
    ledger.markClosed(OTHER, "settled");
    expect(() => ledger.stopScope(OTHER, { field: "model", value: SOL }, "E_DX_PROVIDER_DRIFT", "late")).toThrow(LedgerError);
  });
});
