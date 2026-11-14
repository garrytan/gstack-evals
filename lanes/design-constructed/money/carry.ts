// Copyright (c) 2026 Garry Tan. MIT License.
// The carry across launches (the Captain's ruling before launch 7). Each launch builds a fresh book and a fresh local
// ledger while the approval record is shared, so spend that lives only in a book (host hours, an unknown held with no
// local reservation behind it) would vanish at the next launch. At launch the launcher reads every earlier launch's
// archive as dc host teardown --archive writes it and rebuilds each book the way recovery does (durability.ts recover:
// the latest snapshot, then the chained lines after its watermark, with every reservation in flight there held unknown
// at its full reservation). It applies the archive's reconciliation file when there is one, then sums each item's
// settled and unknown micros. The launch refuses when an archive's books can't be read, when two archives hold one
// lease, or when the approval record holds a lease for the run that no supplied book holds, so a forgotten archive
// refuses instead of under-counting. The figures reach the host in its work folder (CARRY_FILE), where the ledger
// service carries them into the book and every lease (ledger-main.ts).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { listItems, readItem } from "../../../src/runner/ledger/record.ts";
import { DcError } from "../errors.ts";
import { LEDGER_ITEMS } from "../frozen.ts";
import type { LedgerItemId } from "../types.ts";
import type { BookJson, MoneyController } from "./book.ts";
import { recover, type Snapshot } from "./durability.ts";
import type { LeaseSeam, OffHostTarget } from "./types.ts";

/** The carry in the host's work folder, which the ledger service reads at every boot and the teardown seals. */
export const CARRY_FILE = ".carry.json";
/** An archive's reconciliation file: one line per owner-approved L3 reconciliation of an archived unknown, in the book's own reconcile line's shape, {"kind":"reconcile","sub":"<id>","spent":<micros>}. */
export const RECONCILE_FILE = "reconcile.ndjson";
const LINES = "wal-lines.ndjson";
const SNAPSHOT = /^snap-\d{10}\.json$/;

export interface CarriedItem {
  settledMicros: number;
  unknownMicros: number;
}

export interface CarryFile {
  runId: string;
  /** Each earlier launch's archive in the plan's order: its folder name, its snapshot, the lease ids its book holds and the reconcile lines applied. */
  archives: Array<{ name: string; snapshot: string | null; leases: string[]; reconciled: number }>;
  /** Each item those books hold spend on, summed over them. */
  items: Partial<Record<LedgerItemId, CarriedItem>>;
}

/** An item's carried figure: its settled and unknown micros together. */
export const carriedMicros = (c: CarryFile | null | undefined, item: LedgerItemId): number => (c?.items[item]?.settledMicros ?? 0) + (c?.items[item]?.unknownMicros ?? 0);

const no = (why: string): never => {
  throw new DcError("E_DCH_CARRY", why);
};

/** An archive folder as a read-only off-host target, so recovery reads it the way it reads the WAL host. */
class ArchiveTarget implements OffHostTarget {
  constructor(
    readonly dir: string,
    readonly snapshot: string | null,
  ) {}
  async append(): Promise<void> {
    throw new Error("an archive is read only");
  }
  async putSnapshot(): Promise<void> {
    throw new Error("an archive is read only");
  }
  async lines(): Promise<string[]> {
    return readFileSync(join(this.dir, LINES), "utf8").split("\n").filter(Boolean);
  }
  async latestSnapshot(): Promise<string | null> {
    return this.snapshot;
  }
  async getSnapshot(name: string): Promise<Uint8Array | null> {
    return name === this.snapshot ? new Uint8Array(readFileSync(join(this.dir, name + ".json"))) : null;
  }
}

const NO_LEASES: LeaseSeam = {
  open: () => no("an archived book opens no lease"),
  settle: () => no("an archived book settles no lease"),
  recordStop: () => no("an archived book records no stop"),
};

/** One archive's book, rebuilt as recovery rebuilds it, with its reconciliation file applied. */
async function readArchive(dir: string, runId: string): Promise<{ book: MoneyController; snapshot: string | null; reconciled: number }> {
  const at = "the archive " + dir;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) no(at + " is not a folder");
  if (!existsSync(join(dir, LINES))) no(at + " holds no " + LINES + ", so its book can't be shown complete");
  const snapshot = readdirSync(dir).filter((n) => SNAPSHOT.test(n)).sort().at(-1)?.replace(/\.json$/, "") ?? null;
  let book: BookJson | undefined;
  if (snapshot) {
    try {
      book = (JSON.parse(readFileSync(join(dir, snapshot + ".json"), "utf8")) as Snapshot).book;
    } catch {
      no(at + "'s " + snapshot + ".json does not parse");
    }
    if (!book || typeof book.runId !== "string" || typeof book.holder !== "string" || !Array.isArray(book.subs) || !Array.isArray(book.items)) no(at + "'s " + snapshot + ".json holds no book");
    if (book!.runId !== runId) no(at + " holds run " + book!.runId + "'s book, not run " + runId + "'s");
  }
  const target = new ArchiveTarget(dir, snapshot);
  let rec: Awaited<ReturnType<typeof recover>> | undefined;
  try {
    if (!snapshot && !(await target.lines()).length) no(at + " holds no snapshot and no lines");
    rec = await recover(target, { runId, holder: book?.holder ?? "/" + runId, leases: NO_LEASES });
  } catch (e) {
    if (e instanceof DcError) throw e;
    no(at + "'s book could not be rebuilt: " + (e as Error).message);
  }
  if (rec!.kind === "captain") return no(at + "'s book can't be shown complete: " + rec!.why);
  const c = rec!.controller;
  let reconciled = 0;
  const file = join(dir, RECONCILE_FILE);
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()) : [];
  for (const [i, text] of lines.entries()) {
    const where = at + "'s " + RECONCILE_FILE + " line " + (i + 1);
    let r: { kind?: unknown; sub?: unknown; spent?: unknown } | null = null;
    try {
      r = JSON.parse(text);
    } catch {}
    if (r?.kind !== "reconcile" || typeof r.sub !== "string" || !Number.isSafeInteger(r.spent) || (r.spent as number) < 0) return no(where + " is not {\"kind\":\"reconcile\",\"sub\":<id>,\"spent\":<whole micros>}");
    try {
      await c.reconcile(r.sub, r.spent as number);
    } catch (e) {
      no(where + ": " + (e as Error).message);
    }
    reconciled++;
  }
  return { book: c, snapshot, reconciled };
}

/**
 * Reads every earlier launch's archive for the run and sums each item's settled and unknown micros. Refuses (E_DCH_CARRY)
 * when an archive's books can't be read, two archives hold one lease, or the record holds a lease for the run that no
 * supplied book holds.
 */
export async function readCarry(archives: readonly string[], record: string, runId: string): Promise<CarryFile> {
  const held = new Map<string, string>();
  const items: CarryFile["items"] = {};
  const read: CarryFile["archives"] = [];
  const dirs = archives.map((a) => resolve(a));
  const twice = dirs.find((d, i) => dirs.indexOf(d) !== i);
  if (twice) no("the archive " + twice + " is named twice; each launch's book counts once");
  for (const dir of dirs) {
    const a = await readArchive(dir, runId);
    const leases = a.book.toJSON().items.flatMap(([, v]) => v.leases.map((l) => l.leaseId));
    for (const id of leases) {
      const other = held.get(id);
      if (other) no("the archives " + other + " and " + dir + " both hold lease " + id + "; each launch's book counts once");
      held.set(id, dir);
    }
    for (const item of Object.keys(LEDGER_ITEMS) as LedgerItemId[]) {
      const f = a.book.figures(item);
      const unknown = f.unknownMicros + f.inFlightMicros;
      if (!f.settledMicros && !unknown) continue;
      const t = (items[item] ??= { settledMicros: 0, unknownMicros: 0 });
      t.settledMicros += f.settledMicros;
      t.unknownMicros += unknown;
    }
    read.push({ name: basename(dir), snapshot: a.snapshot, leases, reconciled: a.reconciled });
  }
  try {
    for (const item of listItems(record)) {
      for (const { lease } of readItem(record, item).leases) {
        if (lease.run_id === runId && !held.has(lease.lease_id)) no("the approval record holds lease " + lease.lease_id + " on " + item + " for run " + runId + ", and no supplied archive's book holds it; name every earlier launch's teardown archive in the host plan's archives");
      }
    }
  } catch (e) {
    if (e instanceof DcError) throw e;
    no("the approval record " + record + " can't be read: " + (e as Error).message);
  }
  return { runId, archives: read, items };
}

/** The room an item's lease would have at launch: the recorded cap less the larger of the record's committed spend and the carried figure. Null when no cap is recorded. */
export function leaseRoom(record: string, carry: CarryFile, item: LedgerItemId): { capMicros: number; committedMicros: number; carriedMicros: number; roomMicros: number } | null {
  const state = readItem(record, item);
  if (state.cap_micros === null) return null;
  const carried = carriedMicros(carry, item);
  return { capMicros: state.cap_micros, committedMicros: state.committed_micros, carriedMicros: carried, roomMicros: state.cap_micros - Math.max(state.committed_micros, carried) };
}

/** Reads the carry the launcher shipped to the host; throws unless it is this run's, with whole non-negative figures. */
export function readCarryFile(path: string, runId: string): CarryFile {
  const c = JSON.parse(readFileSync(path, "utf8")) as CarryFile;
  if (c?.runId !== runId || !Array.isArray(c.archives) || typeof c.items !== "object" || c.items === null) throw new Error(path + " is not run " + runId + "'s carry");
  const whole = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  for (const [item, f] of Object.entries(c.items)) {
    if (!(item in LEDGER_ITEMS) || !f || !whole(f.settledMicros) || !whole(f.unknownMicros)) throw new Error(path + " holds a figure for " + item + " that is not whole non-negative micros on a ledger item");
  }
  return c;
}

/** Carries each leased item's figure into a booted book. */
export function carryInto(c: MoneyController, carry: CarryFile): void {
  for (const item of Object.keys(LEDGER_ITEMS) as LedgerItemId[]) if (LEDGER_ITEMS[item].leased) c.carryIn(item, carriedMicros(carry, item));
}
