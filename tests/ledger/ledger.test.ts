import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportLease, importSettlement, ledgerStatus, MAX_LEASE_TTL_MS, openLease, reconcileLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { LedgerError, readItem, slotPath, writeOnce } from "../../src/runner/ledger/record.ts";
import type { CellAttempt, LedgerReply } from "../../src/types.ts";
import { admitThisCheckout } from "../rig/helpers.ts";

const LEDGER = join(import.meta.dir, "../../src/runner/ledger");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "ledger-"));
  dirs.push(d);
  return d;
};

const quote = { words: "Rec", by: "Garry Tan", source: "gate 1 of plan v3.2" };
const cell = (trial: number): CellAttempt => ({ run_id: "run-a", arm: "after", task: "t1", model: "claude-opus-5-5", trial, attempt: 1, meter_id: "m-1" });
const usage = { input: 1000, output: 200, reasoning: 50, cache_read: 0, cache_write: 0 };
const DOLLAR = 1_000_000;

function setup(cap = 10 * DOLLAR) {
  const dir = scratch();
  const record = join(dir, "record");
  recordApproval(record, { action: "init", item: "lanea", cap_micros: cap, quotes: [quote], admission: "warn" });
  return { dir, record, local: LocalLedger.open(join(dir, "machine-a.sqlite")) };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof LedgerError) return error.code;
    throw error;
  }
  return "ok";
}

const reservation = (r: LedgerReply) => {
  if (!r.ok) throw new Error(r.code + " " + r.message);
  return r.reservation;
};

/** Runs one bun script per argument list at the same moment and returns each one's stdout. */
async function race(source: string, argvs: string[][]): Promise<string[]> {
  const script = join(scratch(), "racer.ts");
  writeFileSync(script, source.replaceAll("LEDGER", LEDGER));
  const start = String(Date.now() + 400);
  const procs = argvs.map((argv) => Bun.spawn([process.execPath, script, start, ...argv], { stdout: "pipe", stderr: "inherit" }));
  return Promise.all(procs.map(async (p) => (await new Response(p.stdout).text()).trim()));
}

describe("approvals", () => {
  test("init records the owner's words, a retry is idempotent, raise needs a higher cap", () => {
    const { record } = setup();
    expect(recordApproval(record, { action: "init", item: "lanea", cap_micros: 10 * DOLLAR, quotes: [quote], admission: "warn" }).seq).toBe(1);
    expect(codeOf(() => recordApproval(record, { action: "init", item: "lanea", cap_micros: 20 * DOLLAR, quotes: [quote], admission: "warn" }))).toBe("E_USAGE");
    expect(codeOf(() => recordApproval(record, { action: "raise", item: "lanea", cap_micros: 10 * DOLLAR, quotes: [quote] }))).toBe("E_USAGE");
    expect(codeOf(() => recordApproval(record, { action: "raise", item: "nothing", cap_micros: DOLLAR, quotes: [quote] }))).toBe("E_LEDGER_MISSING");
    expect(codeOf(() => recordApproval(record, { action: "init", item: "lanea2", cap_micros: DOLLAR, quotes: [{ ...quote, words: " " }], admission: "warn" }))).toBe("E_USAGE");
    const raise = { action: "raise" as const, item: "lanea", cap_micros: 15 * DOLLAR, quotes: [quote, { words: "raise ok", by: "Approver", source: "gate 2" }] };
    expect(recordApproval(record, raise).seq).toBe(2);
    expect(recordApproval(record, raise).seq).toBe(2);
    expect(ledgerStatus(record)).toMatchObject([{ item: "lanea", cap_micros: 15 * DOLLAR, committed_micros: 0, left_micros: 15 * DOLLAR, approval: { quotes: raise.quotes } }]);
  });

  test("a lease without an approved cap is E_LEDGER_MISSING, an escalation rather than a command", () => {
    let message = "";
    try {
      openLease(join(scratch(), "record"), null, { item: "lanea", run_id: "run-a" });
    } catch (error) {
      expect((error as LedgerError).code).toBe("E_LEDGER_MISSING");
      message = (error as Error).message;
    }
    expect(message).toContain("a human must approve a cap");
  });
});

describe("reserve and settle", () => {
  test("a reserve under the same idempotency key returns the first reservation; another request under it is E_RESERVE_CONFLICT", async () => {
    const { record, local } = setup();
    const lease = openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: 2 * DOLLAR });
    const first = reservation(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(1), max_micros: DOLLAR }));
    expect(reservation(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(1), max_micros: DOLLAR })).reservation_id).toBe(first.reservation_id);
    expect(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(2), max_micros: DOLLAR })).toMatchObject({ ok: false, code: "E_RESERVE_CONFLICT" });
    expect(await local.reserve({ idempotency_key: "k2", lease_id: lease.lease_id, cell: cell(2), max_micros: DOLLAR + 1 })).toMatchObject({ ok: false, code: "CAP_STOP" });
  });

  test("a second settle with the same outcome returns it; a different outcome is E_SETTLE_CONFLICT, never undefined", async () => {
    const { record, local } = setup();
    const lease = openLease(record, local, { item: "lanea", run_id: "run-a" });
    const r = reservation(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(1), max_micros: DOLLAR }));
    const spent = { kind: "spent" as const, spent_micros: 300_000, usage };
    expect(reservation(await local.settle(r.reservation_id, spent))).toMatchObject({ state: "settled", spent_micros: 300_000, usage });
    expect(reservation(await local.settle(r.reservation_id, spent))).toMatchObject({ state: "settled", spent_micros: 300_000 });
    expect(await local.settle(r.reservation_id, { ...spent, spent_micros: 1 })).toMatchObject({ ok: false, code: "E_SETTLE_CONFLICT" });
    expect(await local.settle(r.reservation_id, { kind: "unknown" })).toMatchObject({ ok: false, code: "E_SETTLE_CONFLICT" });
    const u = reservation(await local.reserve({ idempotency_key: "k2", lease_id: lease.lease_id, cell: cell(2), max_micros: DOLLAR }));
    expect(reservation(await local.settle(u.reservation_id, { kind: "unknown" }))).toMatchObject({ state: "unknown", spent_micros: null });
    expect(await local.settle(u.reservation_id, spent)).toMatchObject({ ok: false, code: "E_SETTLE_CONFLICT" });
    expect(await local.settle("rsv_missing", spent)).toMatchObject({ ok: false, code: "E_INTERNAL" });
  });

  test("an unknown outcome keeps its full charge through settle, and an expired or settled lease admits nothing (E_LEASE_CLOSED)", async () => {
    const { record, local } = setup();
    const lease = openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: 3 * DOLLAR });
    const a = reservation(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(1), max_micros: DOLLAR }));
    await local.settle(a.reservation_id, { kind: "spent", spent_micros: 250_000, usage });
    const b = reservation(await local.reserve({ idempotency_key: "k2", lease_id: lease.lease_id, cell: cell(2), max_micros: DOLLAR }));
    await local.settle(b.reservation_id, { kind: "unknown" });
    await local.reserve({ idempotency_key: "k3", lease_id: lease.lease_id, cell: cell(3), max_micros: 500_000 });
    const close = settleLease(record, local, lease.lease_id);
    expect(close).toMatchObject({ how: "settled", spent_micros: 250_000, unknown_micros: 1_500_000, unknown_calls: 2, usage });
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: 1_750_000, left_micros: 8_250_000, open_lease: null });
    expect(await local.reserve({ idempotency_key: "k4", lease_id: lease.lease_id, cell: cell(4), max_micros: 1 })).toMatchObject({ ok: false, code: "E_LEASE_CLOSED" });
    const next = openLease(record, local, { item: "lanea", run_id: "run-a", ttl_ms: 1, now: new Date(Date.now() - 60_000) });
    expect(await local.reserve({ idempotency_key: "k5", lease_id: next.lease_id, cell: cell(5), max_micros: 1 })).toMatchObject({ ok: false, code: "E_LEASE_CLOSED" });
  });

  test("reserves racing from several processes never hold more than the lease", async () => {
    const { dir, record, local } = setup();
    const lease = openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: 5 * DOLLAR });
    const db = join(dir, "machine-a.sqlite");
    const source = `
import { LocalLedger } from "LEDGER/local.ts";
const [start, db, lease, who] = process.argv.slice(2);
const ledger = LocalLedger.open(db);
await Bun.sleep(Math.max(0, Number(start) - Date.now()));
let ok = 0, stop = 0;
for (let i = 0; i < 30; i++) {
  const cell = { run_id: "run-a", arm: who, task: "t", model: "m", trial: i, attempt: 1, meter_id: "m" };
  const r = await ledger.reserve({ idempotency_key: who + "-" + i, lease_id: lease, cell, max_micros: 100000 });
  if (r.ok) ok++; else if (r.code === "CAP_STOP") stop++;
}
console.log(JSON.stringify({ ok, stop }));
`;
    const results = (await race(source, ["p1", "p2", "p3", "p4"].map((who) => [db, lease.lease_id, who]))).map((line) => JSON.parse(line) as { ok: number; stop: number });
    expect(results.reduce((n, r) => n + r.ok, 0)).toBe(50);
    expect(results.reduce((n, r) => n + r.ok + r.stop, 0)).toBe(120);
  });
});

describe("leases on one line item", () => {
  test("two runs racing for one item: one binds it, the other is refused with E_ITEM_BOUND", () => {
    const { record } = setup();
    let inner = "";
    const outer = codeOf(() =>
      openLease(record, null, {
        item: "lanea",
        run_id: "run-a",
        requireAdmission: () => {
          inner = codeOf(() => openLease(record, null, { item: "lanea", run_id: "run-b" }));
          return null;
        },
      }),
    );
    expect([inner, outer]).toEqual(["ok", "E_ITEM_BOUND"]);
    const state = readItem(record, "lanea");
    expect(state.leases.length).toBe(1);
    expect(state.run_id).toBe("run-b");
  });

  test("two runs racing from separate processes: exactly one lease is written", async () => {
    const { record } = setup();
    const source = `
import { openLease } from "LEDGER/ledger.ts";
const [start, record, run] = process.argv.slice(2);
await Bun.sleep(Math.max(0, Number(start) - Date.now()));
try { openLease(record, null, { item: "lanea", run_id: run }); console.log("ok"); } catch (error) { console.log(error.code ?? error.message); }
`;
    const results = await race(source, ["r1", "r2", "r3", "r4", "r5", "r6"].map((run) => [record, run]));
    expect(results.filter((r) => r === "ok").length).toBe(1);
    expect(results.filter((r) => r !== "ok").every((r) => r === "E_ITEM_BOUND")).toBe(true);
    expect(readItem(record, "lanea").leases.length).toBe(1);
  });

  test("a replacement worker cannot lease while the old lease is open; after settle the same run leases what is left", async () => {
    const { dir, record, local } = setup();
    const first = openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: 4 * DOLLAR });
    const r = reservation(await local.reserve({ idempotency_key: "k1", lease_id: first.lease_id, cell: cell(1), max_micros: DOLLAR }));
    await local.settle(r.reservation_id, { kind: "spent", spent_micros: 600_000, usage });
    const machineB = LocalLedger.open(join(dir, "machine-b.sqlite"));
    expect(codeOf(() => openLease(record, machineB, { item: "lanea", run_id: "run-a" }))).toBe("E_LEASE_UNSETTLED");
    expect(codeOf(() => openLease(record, machineB, { item: "lanea", run_id: "run-b" }))).toBe("E_ITEM_BOUND");
    settleLease(record, local, first.lease_id);
    const second = openLease(record, machineB, { item: "lanea", run_id: "run-a" });
    expect(second.reserved_micros).toBe(10 * DOLLAR - 600_000);
    expect(codeOf(() => openLease(record, machineB, { item: "lanea", run_id: "run-a", amount_micros: 1 }))).toBe("E_LEASE_UNSETTLED");
  });

  test("a line item with nothing left is CAP_STOP, and a raise lets the same run lease again", async () => {
    const { record, local } = setup(DOLLAR);
    const lease = openLease(record, local, { item: "lanea", run_id: "run-a" });
    const r = reservation(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(1), max_micros: DOLLAR }));
    await local.settle(r.reservation_id, { kind: "spent", spent_micros: DOLLAR, usage });
    settleLease(record, local, lease.lease_id);
    expect(codeOf(() => openLease(record, local, { item: "lanea", run_id: "run-a" }))).toBe("CAP_STOP");
    recordApproval(record, { action: "raise", item: "lanea", cap_micros: 3 * DOLLAR, quotes: [{ words: "raise ok", by: "Approver", source: "gate 2" }] });
    expect(codeOf(() => openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: 2 * DOLLAR + 1 }))).toBe("CAP_STOP");
    expect(openLease(record, local, { item: "lanea", run_id: "run-a" }).reserved_micros).toBe(2 * DOLLAR);
  });
});

describe("admission", () => {
  test("a required item asks the requireAdmission seam about the lease it is about to write; a refusal is E_RIG_UNPROVEN and writes nothing", () => {
    const record = join(scratch(), "record");
    recordApproval(record, { action: "init", item: "u16-replay", cap_micros: DOLLAR, quotes: [quote], admission: "required" });
    const seen: string[] = [];
    const refuse = (_: string, lease: { item: string; seq: number; run_id: string }) => {
      seen.push(lease.item + "/" + lease.seq + "/" + lease.run_id);
      return "the Docker tier is red at this commit";
    };
    expect(codeOf(() => openLease(record, null, { item: "u16-replay", run_id: "run-a", requireAdmission: refuse }))).toBe("E_RIG_UNPROVEN");
    expect(readItem(record, "u16-replay").leases).toEqual([]);
    expect(openLease(record, null, { item: "u16-replay", run_id: "run-a", requireAdmission: () => null }).line_item).toBe("u16-replay");
    expect(seen).toEqual(["u16-replay/1/run-a"]);
  });

  test("a warn item leases quietly with a matching admission record, and warns naming a mismatched one", () => {
    const record = join(scratch(), "record");
    for (const item of ["lanea", "laneb"]) recordApproval(record, { action: "init", item, cap_micros: DOLLAR, quotes: [quote], admission: "warn" });
    admitThisCheckout(record, { item: "lanea", proof: "direct", run_id: "run-a", machine_id: "m-1" });
    admitThisCheckout(record, { item: "laneb", proof: "direct", run_id: "run-other", machine_id: "m-1" });
    const warnings: string[] = [];
    const warn = (code: string, message: string) => warnings.push(code + " " + message);
    expect(openLease(record, null, { item: "lanea", run_id: "run-a", machine_id: "m-1", warn }).state).toBe("open");
    expect(warnings).toEqual([]);
    expect(openLease(record, null, { item: "laneb", run_id: "run-a", machine_id: "m-1", warn }).state).toBe("open");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith("RIG_UNPROVEN line item laneb leased without admission: the admission record at ");
    expect(warnings[0]).toContain("admits run run-other, not run-a");
  });
});

describe("settle failures and recovery", () => {
  test.skipIf(process.getuid?.() === 0)("a settle that cannot reach the record is E_LEASE_UNSETTLED and keeps the lease reserved; the retry settles it", async () => {
    const { record, local } = setup();
    const lease = openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: 2 * DOLLAR });
    const r = reservation(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(1), max_micros: DOLLAR }));
    await local.settle(r.reservation_id, { kind: "spent", spent_micros: 400_000, usage });
    const itemDir = join(record, "items", "lanea");
    chmodSync(itemDir, 0o555);
    try {
      expect(codeOf(() => settleLease(record, local, lease.lease_id))).toBe("E_LEASE_UNSETTLED");
    } finally {
      chmodSync(itemDir, 0o755);
    }
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: 2 * DOLLAR, open_lease: { lease_id: lease.lease_id } });
    expect(settleLease(record, local, lease.lease_id).spent_micros).toBe(400_000);
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: 400_000, open_lease: null });
  });

  test("a lost settlement acknowledgement: the close landed but the caller never heard; the retry finds the same bytes", async () => {
    const { record, local } = setup();
    const lease = openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: 2 * DOLLAR });
    const r = reservation(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(1), max_micros: DOLLAR }));
    await local.settle(r.reservation_id, { kind: "spent", spent_micros: 700_000, usage });
    expect(writeOnce(record, local.stageClose(lease.lease_id))).toBe("written");
    expect(local.getLease(lease.lease_id)?.state).toBe("closing");
    const path = slotPath(record, { kind: "close", item: "lanea", seq: 1 });
    const landed = readFileSync(path, "utf8");
    expect(settleLease(record, local, lease.lease_id).spent_micros).toBe(700_000);
    expect(readFileSync(path, "utf8")).toBe(landed);
    expect(readdirSync(join(record, "items", "lanea")).sort()).toEqual(["approval-0001.json", "close-0001.json", "lease-0001.json"]);
    expect(local.getLease(lease.lease_id)?.state).toBe("settled");
  });

  test("a lost machine: the allowance stays reserved until the owner reconciles it with their words and the usage export", async () => {
    const { dir, record, local } = setup();
    const lease = openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: 6 * DOLLAR });
    reservation(await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: cell(1), max_micros: DOLLAR }));
    local.close();
    rmSync(join(dir, "machine-a.sqlite"));
    const machineB = LocalLedger.open(join(dir, "machine-b.sqlite"));
    expect(codeOf(() => openLease(record, machineB, { item: "lanea", run_id: "run-a" }))).toBe("E_LEASE_UNSETTLED");
    expect(codeOf(() => settleLease(record, machineB, lease.lease_id))).toBe("E_LEASE_UNSETTLED");
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: 6 * DOLLAR, left_micros: 4 * DOLLAR });
    const exportFile = join(dir, "anthropic-usage-2026-10-28.csv");
    writeFileSync(exportFile, "date,cost\n2026-10-28,0.81\n");
    const early = { lease_id: lease.lease_id, spent_micros: 810_000, quotes: [{ words: "settle it at 81 cents", by: "Approver", source: "relay" }], source: exportFile };
    expect(codeOf(() => reconcileLease(record, early))).toBe("E_LEASE_UNSETTLED");
    const owner = { ...early, now: new Date(Date.parse(lease.expires_at) + 1) };
    expect(codeOf(() => reconcileLease(record, { ...owner, source: "" }))).toBe("E_USAGE");
    expect(codeOf(() => reconcileLease(record, { ...owner, source: join(dir, "no-such-export.csv") }))).toBe("E_USAGE");
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: 6 * DOLLAR });
    const close = reconcileLease(record, owner);
    expect(close).toMatchObject({ how: "reconciled", spent_micros: 810_000, source_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(reconcileLease(record, owner)).toEqual(close);
    const files = readdirSync(join(record, "items", "lanea")).sort();
    expect(settleLease(record, machineB, lease.lease_id)).toEqual(close);
    expect(readdirSync(join(record, "items", "lanea")).sort()).toEqual(files);
    expect(codeOf(() => reconcileLease(record, { ...owner, spent_micros: 1 }))).toBe("E_SETTLE_CONFLICT");
    expect(openLease(record, machineB, { item: "lanea", run_id: "run-a" }).reserved_micros).toBe(10 * DOLLAR - 810_000);
    const revived = LocalLedger.open(join(dir, "machine-a-restored.sqlite"));
    revived.addLease(readItem(record, "lanea").leases[0]!.lease);
    expect(codeOf(() => settleLease(record, revived, lease.lease_id))).toBe("E_SETTLE_CONFLICT");
  });
});


describe("the sealed workflow's lease round trip", () => {
  test("the thread exports a lease, a fake workflow spends it in its own ledger, and its settle artifact closes the lease in the record", async () => {
    const { record } = setup();
    const lease = openLease(record, null, { item: "lanea", run_id: "sealed-1", machine_id: "workflow:sealed-repo", amount_micros: 3 * DOLLAR });
    const dispatchInput = JSON.stringify(exportLease(record, lease.lease_id));

    const workflow = LocalLedger.open(join(scratch(), "workflow.sqlite"));
    workflow.addLease(JSON.parse(dispatchInput));
    for (const trial of [1, 2]) {
      const r = reservation(await workflow.reserve({ idempotency_key: "w" + trial, lease_id: lease.lease_id, cell: cell(trial), max_micros: DOLLAR }));
      await workflow.settle(r.reservation_id, { kind: "spent", spent_micros: 450_000, usage });
    }
    expect(await workflow.reserve({ idempotency_key: "w3", lease_id: lease.lease_id, cell: cell(3), max_micros: 2_100_001 })).toMatchObject({ ok: false, code: "CAP_STOP" });
    const artifact = JSON.stringify(settleLease(null, workflow, lease.lease_id));
    expect(settleLease(null, workflow, lease.lease_id)).toEqual(JSON.parse(artifact));

    expect(importSettlement(record, JSON.parse(artifact))).toMatchObject({ spent_micros: 900_000 });
    expect(importSettlement(record, JSON.parse(artifact))).toMatchObject({ spent_micros: 900_000 });
    expect(codeOf(() => importSettlement(record, { ...JSON.parse(artifact), spent_micros: 1 }))).toBe("E_SETTLE_CONFLICT");
    expect(codeOf(() => exportLease(record, lease.lease_id))).toBe("E_LEASE_CLOSED");
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: 900_000, run_id: "sealed-1", open_lease: null });
    expect(JSON.parse(readFileSync(slotPath(record, { kind: "lease", item: "lanea", seq: 1 }), "utf8")).machine_id).toBe("workflow:sealed-repo");
  });

  test("an artifact holding more unknown charge than the lease's amount, or off the staged shape, is E_USAGE and writes nothing; one that arrives after the owner reconciled is E_SETTLE_CONFLICT and the reconcile stands", () => {
    const { dir, record } = setup();
    const lease = openLease(record, null, { item: "lanea", run_id: "sealed-1", machine_id: "workflow:sealed-repo", amount_micros: 3 * DOLLAR });
    const workflow = LocalLedger.open(join(scratch(), "workflow.sqlite"));
    workflow.addLease(exportLease(record, lease.lease_id));
    const artifact = settleLease(null, workflow, lease.lease_id);
    for (const bad of [{ ...artifact, unknown_micros: 3 * DOLLAR + 1 }, { ...artifact, usage: { ...artifact.usage!, evil: 1 } }, { ...artifact, usage: null }, { ...artifact, closed_at: "not a time" }, { ...artifact, note: "extra" }]) {
      expect(codeOf(() => importSettlement(record, bad))).toBe("E_USAGE");
    }
    expect(readItem(record, "lanea").leases[0]!.close).toBeNull();
    const exportFile = join(dir, "usage.csv");
    writeFileSync(exportFile, "date,cost\n");
    const reconciled = reconcileLease(record, { lease_id: lease.lease_id, spent_micros: 500_000, quotes: [quote], source: exportFile, now: new Date(Date.parse(lease.expires_at) + 1) });
    expect(codeOf(() => importSettlement(record, artifact))).toBe("E_SETTLE_CONFLICT");
    expect(readItem(record, "lanea").leases[0]!.close).toEqual(reconciled);
  });
});

describe("a call billed above its reservation", () => {
  test("closes its lease at the real spend on both settle paths, with a LEASE_OVERSPENT warning", async () => {
    const { record, local } = setup();
    const warnings: string[] = [];
    const warn = (code: string, message: string) => warnings.push(code + " " + message);
    const sealed = openLease(record, null, { item: "lanea", run_id: "sealed-1", machine_id: "workflow:sealed-repo", amount_micros: DOLLAR });
    const workflow = LocalLedger.open(join(scratch(), "workflow.sqlite"));
    workflow.addLease(exportLease(record, sealed.lease_id));
    const w = reservation(await workflow.reserve({ idempotency_key: "w1", lease_id: sealed.lease_id, cell: cell(1), max_micros: 900_000 }));
    await workflow.settle(w.reservation_id, { kind: "spent", spent_micros: 1_200_000, usage });
    const artifact = JSON.parse(JSON.stringify(settleLease(null, workflow, sealed.lease_id, warn)));
    expect(importSettlement(record, artifact, warn)).toMatchObject({ how: "settled", spent_micros: 1_200_000, unknown_micros: 0 });
    expect(readItem(record, "lanea").leases[0]!.close).toEqual(artifact);

    const direct = openLease(record, local, { item: "lanea", run_id: "sealed-1", amount_micros: DOLLAR });
    const d = reservation(await local.reserve({ idempotency_key: "d1", lease_id: direct.lease_id, cell: cell(2), max_micros: 900_000 }));
    await local.settle(d.reservation_id, { kind: "spent", spent_micros: 1_100_000, usage });
    expect(settleLease(record, local, direct.lease_id, warn)).toMatchObject({ spent_micros: 1_100_000 });
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: 2_300_000, open_lease: null });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toStartWith("LEASE_OVERSPENT lease " + sealed.lease_id + " closes at $1.20, above the $1.00 it reserved");
    expect(warnings[1]).toBe(warnings[0]!);
    expect(warnings[2]).toStartWith("LEASE_OVERSPENT lease " + direct.lease_id + " closes at $1.10, above the $1.00 it reserved");
  });
});

describe("lease guards from the /ship review", () => {
  test("a lease the local ledger cannot hold is closed at $0, so its allowance is not stranded; if the ledger cannot even be read, the lease stays reserved", () => {
    const { dir, record, local } = setup();
    local.addLease = () => {
      throw new Error("disk I/O error");
    };
    expect(codeOf(() => openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: DOLLAR }))).toBe("E_LEDGER_PATH");
    expect(readItem(record, "lanea").leases[0]!.close).toMatchObject({ how: "settled", spent_micros: 0, unknown_micros: 0, unknown_calls: 0 });
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: 0, open_lease: null });
    const healthy = LocalLedger.open(join(dir, "machine-b.sqlite"));
    const second = openLease(record, healthy, { item: "lanea", run_id: "run-a", amount_micros: DOLLAR });
    settleLease(record, healthy, second.lease_id);
    const broken = LocalLedger.open(join(dir, "machine-c.sqlite"));
    broken.addLease = broken.getLease = () => {
      throw new Error("disk I/O error");
    };
    expect(codeOf(() => openLease(record, broken, { item: "lanea", run_id: "run-a", amount_micros: DOLLAR }))).toBe("E_LEASE_UNSETTLED");
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: DOLLAR, leases: 3 });
    local.close();
    healthy.close();
  });

  test("a local ledger that throws after holding the lease keeps it open; one holding other bytes under the lease id is E_LEASE_UNSETTLED", () => {
    const { dir, record, local } = setup();
    const real = local.addLease.bind(local);
    local.addLease = (f) => {
      real(f);
      throw new Error("late failure");
    };
    const held = openLease(record, local, { item: "lanea", run_id: "run-a", amount_micros: DOLLAR });
    expect(held.state).toBe("open");
    expect(readItem(record, "lanea").leases[0]!.close).toBeNull();
    settleLease(record, local, held.lease_id);
    const other = LocalLedger.open(join(dir, "machine-b.sqlite"));
    other.addLease = () => {
      throw new Error("constraint failed");
    };
    other.getLease = (id) => ({ file: { ...readItem(record, "lanea").leases[0]!.lease, lease_id: id, reserved_micros: 1 }, state: "open", close: null });
    expect(codeOf(() => openLease(record, other, { item: "lanea", run_id: "run-a", amount_micros: DOLLAR }))).toBe("E_LEASE_UNSETTLED");
    expect(readItem(record, "lanea").leases[1]!.close).toBeNull();
    expect(ledgerStatus(record)[0]).toMatchObject({ committed_micros: DOLLAR, leases: 2 });
    local.close();
    other.close();
  });

  test("a time to live past 7 days, including one past the Date range, is E_USAGE and writes no lease", () => {
    const { record, local } = setup();
    for (const ttl_ms of [9e15, MAX_LEASE_TTL_MS + 1]) expect(codeOf(() => openLease(record, local, { item: "lanea", run_id: "run-a", ttl_ms }))).toBe("E_USAGE");
    expect(readItem(record, "lanea").leases).toEqual([]);
    expect(openLease(record, local, { item: "lanea", run_id: "run-a", ttl_ms: MAX_LEASE_TTL_MS }).reserved_micros).toBe(10 * DOLLAR);
    local.close();
  });
});

