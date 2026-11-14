// Copyright (c) 2026 Garry Tan. MIT License.
// The carry across launches (lanes/design-constructed/money/carry.ts): each launch's archive is read the way recovery
// reads the off-host copy, each item's settled and unknown micros are summed, and the next launch's leases reserve the
// cap less the larger of the record's committed spend and that figure. Earlier launches are built here on main's real
// ledger, a real local ledger and the real book, their archives laid out as dc host teardown --archive writes them.
// No key, no network, no VM.
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import type { DcError } from "../../../lanes/design-constructed/errors.ts";
import { $, MoneyController } from "../../../lanes/design-constructed/money/book.ts";
import { carryInto, CARRY_FILE, readCarry, RECONCILE_FILE, type CarryFile } from "../../../lanes/design-constructed/money/carry.ts";
import { DirTarget, takeSnapshot } from "../../../lanes/design-constructed/money/durability.ts";
import { makeRecord } from "../../../lanes/design-constructed/money/dryrun-fixture.ts";
import { admitVm } from "../../../lanes/design-constructed/money/hosts.ts";
import { mainLeases } from "../../../lanes/design-constructed/money/ledger-main.ts";
import { openLedgerService, type ServiceConfig } from "../../../lanes/design-constructed/money/ledger-service.ts";
import type { Sub } from "../../../lanes/design-constructed/money/types.ts";
import { WriteAhead } from "../../../lanes/design-constructed/money/wal.ts";
import type { LedgerItemId } from "../../../lanes/design-constructed/types.ts";
import type { LedgerProvider, Providers } from "../../../lanes/design-constructed/wire.ts";
import { REPO_ROOT } from "../../../lanes/design-constructed/wire/fakes.ts";
import { start, type RowEnv } from "../../../lanes/design-constructed/wire/start.ts";

const RUN = "dc-carry-test";
const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "dc-carry-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Launch {
  c: MoneyController;
  local: LocalLedger;
  wal: WriteAhead;
  target: DirTarget;
  ledgerPath: string;
}

/** One launch on the shared record: a fresh book, a fresh local ledger and its own off-host copy, the run's fixed holder. */
function launchOn(root: string, record: string, name: string): Launch {
  const ledgerPath = join(root, name, "ledger.sqlite");
  mkdirSync(join(root, name), { recursive: true });
  const local = LocalLedger.open(ledgerPath);
  const target = new DirTarget(join(root, name, "offhost"));
  const wal = new WriteAhead(target);
  const c = new MoneyController({ runId: RUN, holder: join(root, "holders", RUN), leases: mainLeases({ record, local, requireAdmission: () => null }), wal });
  return { c, local, wal, target, ledgerPath };
}

/** The teardown's archive of a launch's off-host copy: its latest snapshot as snap-*.json and its lines as wal-lines.ndjson. */
async function archiveOf(l: Launch, into: string, snapshot = true): Promise<string> {
  if (snapshot) await takeSnapshot(l.c, l.wal, l.target, { ledgerPath: l.ledgerPath });
  l.local.close();
  mkdirSync(into, { recursive: true });
  const name = await l.target.latestSnapshot();
  if (name) copyFileSync(join(l.target.dir, "snapshots", name), join(into, name + ".json"));
  const lines = join(l.target.dir, "wal.ndjson");
  writeFileSync(join(into, "wal-lines.ndjson"), existsSync(lines) ? readFileSync(lines) : "");
  return into;
}

const admitted = (a: { kind: string; sub?: Sub; why?: string }): Sub => {
  if (a.kind !== "admitted") throw new Error("not admitted: " + a.kind + " " + a.why);
  return a.sub!;
};

/** A model call metered on the lease in the local ledger and settled in the book at the same figure, as the proxy does. */
async function modelCall(l: Launch, item: LedgerItemId, micros: number, key: string): Promise<void> {
  const sub = admitted(await l.c.admitCall(item, { run: key, model: "opus", worstCaseMicros: micros }));
  const res = await l.local.reserve({ idempotency_key: key, lease_id: l.c.lease(item)!.leaseId, cell: { run_id: RUN, arm: "dc", task: key, model: "m", trial: 1, attempt: 1, meter_id: "mtr-" + key }, max_micros: micros });
  if (!res.ok) throw new Error("local reserve refused: " + res.message);
  await l.local.settle(res.reservation.reservation_id, { kind: "spent", spent_micros: micros, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } });
  await l.c.settle(sub.id, { spentMicros: micros });
}

const refusal = async (p: Promise<unknown>): Promise<{ code: string; message: string }> => {
  try {
    await p;
  } catch (e) {
    return { code: (e as DcError).code, message: (e as Error).message };
  }
  return { code: "none", message: "" };
};

const leasesOf = (record: string, item: LedgerItemId) => readItem(record, item).leases;

/** An earlier launch that spent on dc-gate-check through the proxy (746 micros) and ran a controller host (20,672 micros, settled in the book only). */
async function earlier(root: string, record: string, name = "a"): Promise<string> {
  const l = launchOn(root, record, name);
  await l.c.openItem("dc-gate-check");
  await modelCall(l, "dc-gate-check", 746, name + "-probe");
  await l.c.openItem("dc-hosts");
  const vm = admitted(await admitVm(l.c, { vm: "dcctl-" + name, ttlHours: 30, priceMicrosPerHour: 60_000, stage: "hosts", controller: true }));
  await l.c.settle(vm.id, { spentMicros: 20_672 });
  for (const item of l.c.openItems()) await l.c.settleItem(item);
  return archiveOf(l, join(root, "archive-" + name));
}

/** A ledger provider on a book, with the record's caps; the start rules build it first and nothing else before admission. */
const ledgerOf = (c: MoneyController, record: string): LedgerProvider => ({ controller: c, recordedCapMicros: (item) => readItem(record, item).cap_micros, approval: () => null, raise: () => {}, reconcile: async () => null });

function rowEnvOn(ledger: LedgerProvider, built: string[]): RowEnv {
  const never = (name: string) => () => {
    built.push(name);
    throw new Error(name + " was built");
  };
  const providers: Providers = { ledger: () => (built.push("ledger"), ledger), model: never("model"), session: never("session"), vm: never("vm"), stage3: never("stage3") };
  return { providers, dryRun: async () => true, lane: () => ({ commit: "a".repeat(40), dirty: false, root: REPO_ROOT }), now: () => new Date("2026-11-20T00:00:00Z"), power: () => ({ code: 0, stdout: "", stderr: "" }), vocabulary: () => new Set() };
}

describe("the carry across launches", () => {
  // Value: protects=the Captain's ruling that a relaunch carries each item's spend; fails_when=a later launch's lease reserves the whole cap after an earlier launch spent, or a carried spend that fills the cap still admits; why_new=launch 5's dc-hosts lease reset to its cap while launch 3's host hours sat only in its book; seam=readCarry, the book's carryIn and the ledger seam's lease amount, then start's ledger admission; no_claim=live hosts, real models
  test("a carried spend that leaves room admits, and the lease reserves the cap less the carry; one that leaves none refuses before any provider is built", async () => {
    const root = temp();
    const record = makeRecord(root);
    const room = await readCarry([await earlier(root, record)], record, RUN);
    expect(room.items["dc-gate-check"]).toEqual({ settledMicros: 746, unknownMicros: 0 });
    const b = launchOn(root, record, "b");
    carryInto(b.c, room);
    const built: string[] = [];
    const ok = await start({ row: "gatecheck", sink: join(root, "sink-b"), items: ["dc-gate-check"], models: [], terms: [] }, rowEnvOn(ledgerOf(b.c, record), built));
    expect(built).toEqual(["ledger"]);
    expect(b.c.lease("dc-gate-check")!.reservedMicros).toBe($(25) - 746);
    expect(ok.lines.some((x) => x.startsWith("ledger: dc-gate-check admitted on lease ") && x.includes("carried from earlier launches"))).toBe(true);
    expect(admitted(await b.c.admitCall("dc-gate-check", { run: "b-call", model: "opus", worstCaseMicros: $(25) - 746 })).reserveMicros).toBe($(25) - 746);
    expect((await b.c.admitCall("dc-gate-check", { run: "b-past", model: "opus", worstCaseMicros: 1 })).kind).toBe("wait");
    b.local.close();

    const full = temp();
    const fullRecord = makeRecord(full);
    const a = launchOn(full, fullRecord, "a");
    await a.c.openItem("dc-gate-check");
    const sub = admitted(await a.c.admitCall("dc-gate-check", { run: "a-all", model: "opus", worstCaseMicros: $(25) }));
    await a.c.settle(sub.id, { spentMicros: $(25) });
    await a.c.settleItem("dc-gate-check");
    const carry = await readCarry([await archiveOf(a, join(full, "archive-a"))], fullRecord, RUN);
    const c = launchOn(full, fullRecord, "c");
    carryInto(c.c, carry);
    const none: string[] = [];
    const no = await refusal(start({ row: "gatecheck", sink: join(full, "sink-c"), items: ["dc-gate-check"], models: [], terms: [] }, rowEnvOn(ledgerOf(c.c, fullRecord), none)));
    expect(no.code).toBe("E_DCW_LEDGER_REFUSED");
    expect(no.message).toContain("carried from earlier launches");
    expect(none).toEqual(["ledger"]);
    expect(leasesOf(fullRecord, "dc-gate-check").length).toBe(1);
    expect(existsSync(join(full, "sink-c"))).toBe(false);
    const seam = await refusal(c.c.openItem("dc-gate-check"));
    expect(seam.code).toBe("E_DCW_LEDGER_REFUSED");
    expect(leasesOf(fullRecord, "dc-gate-check").length).toBe(1);
    c.local.close();
  });

  // Value: protects=counting a model call once; fails_when=the lease subtracts the record's close and the book's settled spend both; why_new=a model call sits in the record's close and the book; seam=mainLeases open; no_claim=none
  test("a model call in both the record and the book is counted once: the lease reserves the cap less the larger figure", async () => {
    const root = temp();
    const record = makeRecord(root);
    const carry = await readCarry([await earlier(root, record)], record, RUN);
    expect(readItem(record, "dc-gate-check").committed_micros).toBe(746);
    const b = launchOn(root, record, "b");
    carryInto(b.c, carry);
    expect((await b.c.openItem("dc-gate-check")).reservedMicros).toBe($(25) - 746);
    b.local.close();
  });

  // Value: protects=dc-hosts' cap across launches; fails_when=the next launch's dc-hosts lease reserves the whole cap after an earlier launch's host hours; why_new=every dc-hosts close in the record reads $0, since host hours settle only in the book; seam=a real ledger service teardown, readCarry, the next service's boot; no_claim=Ubicloud's bill
  test("host hours an earlier launch's service settled in its book shrink the next launch's dc-hosts lease, and the service shows the carry", async () => {
    const root = temp();
    const record = makeRecord(root);
    const clock = { t: Date.parse("2026-11-20T00:00:00Z") };
    const cfg = (name: string, carry: string | null): ServiceConfig => ({ runId: RUN, holder: join(root, "holders", RUN), record, ledgerPath: join(root, name, "ledger", "ledger.sqlite"), journalDir: join(root, name, "journals"), stateDir: join(root, name, "state"), hosts: [{ vm: "dcctl-" + name, role: "controller", ttlHours: 30, priceMicrosPerHour: 60_000, createdAt: new Date(clock.t).toISOString() }], carry });
    const targetA = new DirTarget(join(root, "a", "offhost"));
    const a = await openLedgerService(cfg("a", null), targetA, { now: () => new Date(clock.t) });
    if (!a.ok) throw new Error(a.captain);
    clock.t += 2 * 3_600_000;
    expect(await a.service.teardown()).toEqual({ ok: true });
    a.service.close();
    expect(leasesOf(record, "dc-hosts")[0]!.close!.spent_micros).toBe(0);
    const archive = join(root, "archive-a");
    mkdirSync(archive);
    const snap = (await targetA.latestSnapshot())!;
    copyFileSync(join(targetA.dir, "snapshots", snap), join(archive, snap + ".json"));
    copyFileSync(join(targetA.dir, "wal.ndjson"), join(archive, "wal-lines.ndjson"));
    const carry = await readCarry([archive], record, RUN);
    expect(carry.items["dc-hosts"]).toEqual({ settledMicros: 120_000, unknownMicros: 0 });
    const file = join(root, CARRY_FILE);
    writeFileSync(file, JSON.stringify(carry));
    const b = await openLedgerService(cfg("b", file), new DirTarget(join(root, "b", "offhost")), { now: () => new Date(clock.t) });
    if (!b.ok) throw new Error(b.captain);
    expect(b.service.controller.lease("dc-hosts")!.reservedMicros).toBe($(80) - 120_000);
    expect(b.service.status().carry).toEqual({ archives: 1, items: { "dc-hosts": { settledMicros: 120_000, unknownMicros: 0 } } });
    expect(b.service.status().items.find((f) => f.item === "dc-hosts")!.carriedMicros).toBe(120_000);
    b.service.close();
    writeFileSync(file, JSON.stringify({ ...carry, items: { "dc-hosts": { settledMicros: $(80), unknownMicros: 0 } } } satisfies CarryFile));
    const c = await openLedgerService(cfg("c", file), new DirTarget(join(root, "c", "offhost")), { now: () => new Date(clock.t) });
    if (!c.ok) throw new Error(c.captain);
    expect(c.service.captain?.why).toContain("dc-hosts' lease did not open: dc-hosts has no room");
    expect(leasesOf(record, "dc-hosts").length).toBe(2);
    c.service.close();
  });

  // Value: protects=the launch's refusal when books can't be read; fails_when=a corrupt snapshot, missing lines or a broken chain carries nothing instead of refusing; why_new=the ruling: a launch refuses when the books can't be read; seam=readCarry; no_claim=none
  test("an archive whose books can't be read or shown complete refuses the launch", async () => {
    const root = temp();
    const record = makeRecord(root);
    const archive = await earlier(root, record);
    const snap = readdirSync(archive).find((n) => n.startsWith("snap-"))!;
    const good = readFileSync(join(archive, snap), "utf8");
    const lines = readFileSync(join(archive, "wal-lines.ndjson"), "utf8");
    const cases: Array<[string, () => void]> = [
      ["does not parse", () => writeFileSync(join(archive, snap), good.slice(0, 40))],
      ["holds no book", () => writeFileSync(join(archive, snap), JSON.stringify({ name: snap }))],
      ["holds no wal-lines.ndjson", () => rmSync(join(archive, "wal-lines.ndjson"))],
      ["can't be shown complete", () => writeFileSync(join(archive, "wal-lines.ndjson"), lines.replace(/"seq":(\d+)/, (_m, n) => '"seq":' + (Number(n) + 100)))],
      ["is not a folder", () => rmSync(archive, { recursive: true })],
    ];
    for (const [why, spoil] of cases) {
      mkdirSync(archive, { recursive: true });
      writeFileSync(join(archive, snap), good);
      writeFileSync(join(archive, "wal-lines.ndjson"), lines);
      spoil();
      const r = await refusal(readCarry([archive], record, RUN));
      expect(r.code).toBe("E_DCH_CARRY");
      expect(r.message).toContain(why);
    }
  });

  // Value: protects=a forgotten archive; fails_when=a launch named without an earlier launch's archive carries less instead of refusing; why_new=the ruling's completeness rule; seam=readCarry against the record; no_claim=a launch whose record copy never came back
  test("a lease the record holds for the run that no supplied book holds refuses, and so does one book named twice", async () => {
    const root = temp();
    const record = makeRecord(root);
    const a = await earlier(root, record, "a");
    const b = await earlier(root, record, "b");
    const missing = await refusal(readCarry([a], record, RUN));
    expect(missing.code).toBe("E_DCH_CARRY");
    expect(missing.message).toMatch(/the approval record holds lease dc-(gate-check|hosts)\.0002\.[0-9a-f]{6} on dc-(gate-check|hosts) for run dc-carry-test, and no supplied archive's book holds it/);
    expect((await refusal(readCarry([], record, RUN))).code).toBe("E_DCH_CARRY");
    expect((await refusal(readCarry([a, b, a], record, RUN))).message).toContain("is named twice");
    const copy = join(root, "archive-a-copy");
    mkdirSync(copy);
    for (const n of readdirSync(a)) copyFileSync(join(a, n), join(copy, n));
    expect((await refusal(readCarry([a, b, copy], record, RUN))).message).toContain("both hold lease");
    const both = await readCarry([a, b], record, RUN);
    expect(both.items["dc-hosts"]).toEqual({ settledMicros: 2 * 20_672, unknownMicros: 0 });
    expect(both.items["dc-gate-check"]).toEqual({ settledMicros: 2 * 746, unknownMicros: 0 });
    expect(both.archives.map((x) => [x.name, x.leases.length])).toEqual([["archive-a", 2], ["archive-b", 2]]);
  });

  // Value: protects=an unknown held in a book with no local reservation behind it; fails_when=a recipe session held unknown when a run stops vanishes at the next launch, or an owner's L3 reconciliation of it is ignored; why_new=book.ts markUnknown's hold had no carry; seam=readCarry's recovery and RECONCILE_FILE; no_claim=the owner's provider usage export
  test("an archived unknown carries at its full reservation, work admitted after the last snapshot is held unknown as recovery holds it, and a reconciliation file brings an unknown to its reconciled figure", async () => {
    const root = temp();
    const record = makeRecord(root);
    const l = launchOn(root, record, "a");
    await l.c.openItem("dc-base-apps");
    const recipe = admitted(await l.c.admitRecipe({ run: "recipe 1" }));
    await l.c.markUnknown(recipe.id);
    await takeSnapshot(l.c, l.wal, l.target, { ledgerPath: l.ledgerPath });
    await l.c.openItem("dc-gate-check");
    admitted(await l.c.admitCall("dc-gate-check", { run: "after the snapshot", model: "opus", worstCaseMicros: 9_000 }));
    const archive = await archiveOf(l, join(root, "archive-a"), false);
    const held = await readCarry([archive], record, RUN);
    expect(held.items["dc-base-apps"]).toEqual({ settledMicros: 0, unknownMicros: $(5) });
    expect(held.items["dc-gate-check"]).toEqual({ settledMicros: 0, unknownMicros: 9_000 });
    writeFileSync(join(archive, RECONCILE_FILE), JSON.stringify({ kind: "reconcile", sub: recipe.id, spent: 0 }) + "\n");
    const zero = await readCarry([archive], record, RUN);
    expect(zero.items["dc-base-apps"]).toBeUndefined();
    expect(zero.archives[0]!.reconciled).toBe(1);
    writeFileSync(join(archive, RECONCILE_FILE), JSON.stringify({ kind: "reconcile", sub: recipe.id, spent: 1_234_000 }) + "\n");
    expect((await readCarry([archive], record, RUN)).items["dc-base-apps"]).toEqual({ settledMicros: 1_234_000, unknownMicros: 0 });
    writeFileSync(join(archive, RECONCILE_FILE), JSON.stringify({ kind: "reconcile", sub: recipe.id, spent: 0 }) + "\n" + JSON.stringify({ kind: "reconcile", sub: recipe.id, spent: 0 }) + "\n");
    expect((await refusal(readCarry([archive], record, RUN))).message).toContain("line 2: sub-reservation " + recipe.id + " holds no unknown charge");
    writeFileSync(join(archive, RECONCILE_FILE), JSON.stringify({ kind: "reconcile", sub: recipe.id, spent: -1 }) + "\n");
    expect((await refusal(readCarry([archive], record, RUN))).code).toBe("E_DCH_CARRY");
  });
});
