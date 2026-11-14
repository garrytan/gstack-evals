// Copyright (c) 2026 Garry Tan. MIT License.
// Ledger durability (R2-4, L7): crash-consistent snapshots with a write-ahead watermark, the ledger wrapper that
// copies every proxy reserve off host before the proxy forwards the call, and recovery. A snapshot is taken in one
// synchronous step under the controller's own turn, with the local ledger read through SQLite's serialize (a
// consistent read under its lock), and verified by sha256 once off host. Recovery checks the off-host chain after the
// watermark; when its completeness can't be shown it stops for the Captain with the uncertain allowance held. Otherwise
// every reservation in flight at the watermark or admitted after it is held as unknown at its full reservation until it
// reconciles against provider usage (main's owner reconcile after lease expiry).
import { Database } from "bun:sqlite";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { reconcileLease } from "../../../src/runner/ledger/ledger.ts";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import type { Quote } from "../../../src/runner/ledger/record.ts";
import { reconcileJournal } from "../../../src/runner/proxy/metering-proxy.ts";
import type { CellAttempt, ReservationLedger } from "../../../src/types.ts";
import type { LedgerItemId } from "../types.ts";
import { MoneyController, type BookJson, type ControllerOptions } from "./book.ts";
import type { OffHostTarget, Sub } from "./types.ts";
import { chainAfter, GENESIS, sha256, WriteAhead, type WalLine } from "./wal.ts";

/** L7: a copy after every settlement and at least every 10 minutes. */
export const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
export const snapshotDue = (o: { lastAt: Date | null; now: Date; settledSince: number }) => o.lastAt === null || o.settledSince > 0 || o.now.getTime() - o.lastAt.getTime() >= SNAPSHOT_EVERY_MS;

/** A directory target: fsynced appends and atomic snapshot files. Tests use it on a temp directory; integration may mount an off-host path or bind another target. */
export class DirTarget implements OffHostTarget {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, "snapshots"), { recursive: true });
  }
  async append(line: string): Promise<void> {
    const fd = openSync(join(this.dir, "wal.ndjson"), "a", 0o600);
    try {
      appendFileSync(fd, line + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  async lines(): Promise<string[]> {
    const f = join(this.dir, "wal.ndjson");
    return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
  }
  async putSnapshot(name: string, bytes: Uint8Array): Promise<void> {
    const f = join(this.dir, "snapshots", name);
    writeFileSync(f + ".tmp", bytes, { mode: 0o600 });
    renameSync(f + ".tmp", f);
  }
  async getSnapshot(name: string): Promise<Uint8Array | null> {
    const f = join(this.dir, "snapshots", name);
    return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
  }
  async latestSnapshot(): Promise<string | null> {
    const names = readdirSync(join(this.dir, "snapshots")).filter((n) => /^snap-\d{10}$/.test(n)).sort();
    return names.at(-1) ?? null;
  }
}

export interface Snapshot {
  name: string;
  watermark: number;
  head: string;
  at: string;
  book: BookJson;
  ledger: { path: string; sha256: string; base64: string } | null;
  journal: { path: string; sha256: string; base64: string; lines: number } | null;
}

const filePart = (path: string | undefined, bytes: (p: string) => Uint8Array) => {
  if (!path || !existsSync(path)) return null;
  const b = bytes(path);
  return { path, sha256: sha256(b), base64: Buffer.from(b).toString("base64") };
};

/** A consistent copy of a SQLite file through serialize, read under SQLite's own lock. */
export const ledgerBytes = (path: string): Uint8Array => {
  const db = new Database(path, { readonly: true });
  try {
    return db.serialize();
  } finally {
    db.close();
  }
};

/**
 * Takes a crash-consistent snapshot: the book, the local ledger and the proxy journal captured in one synchronous step
 * at the log's current watermark, then copied off host and read back by sha256. A verified snapshot restarts a broken log.
 */
export async function takeSnapshot(c: MoneyController, wal: WriteAhead, target: OffHostTarget, o: { ledgerPath?: string; journalPath?: string; now?: Date } = {}): Promise<Snapshot> {
  const journal = filePart(o.journalPath, (p) => new Uint8Array(readFileSync(p)));
  const snap: Snapshot = {
    name: "snap-" + String(wal.seq).padStart(10, "0"),
    watermark: wal.seq,
    head: wal.head,
    at: (o.now ?? new Date()).toISOString(),
    book: c.toJSON(),
    ledger: filePart(o.ledgerPath, ledgerBytes),
    journal: journal && { ...journal, lines: Buffer.from(journal.base64, "base64").toString("utf8").split("\n").filter(Boolean).length },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snap));
  await target.putSnapshot(snap.name, bytes);
  const back = await target.getSnapshot(snap.name);
  if (!back || sha256(back) !== sha256(bytes)) throw new Error("snapshot " + snap.name + " did not read back by sha256 from the off-host target");
  if (wal.broken) wal.restart(snap.watermark, snap.head);
  return snap;
}

/**
 * The ledger wrapper for the metering proxy (R2-4): a reserve is answered only once its line is acknowledged off host.
 * A copy that fails throws, so the proxy refuses the call with E_LEDGER_UNAVAILABLE and sends nothing; reconcileJournal
 * later releases that hold at $0. Outcomes are copied too, best effort, as reconciliation evidence.
 */
export function writeAheadLedger(inner: ReservationLedger, wal: WriteAhead): ReservationLedger {
  return {
    async reserve(req) {
      const reply = await inner.reserve(req);
      if (!reply.ok) return reply;
      await wal.append({ kind: "reserve", idempotency_key: req.idempotency_key, lease_id: req.lease_id, cell: req.cell, max_micros: req.max_micros, reservation_id: reply.reservation.reservation_id });
      return reply;
    },
    async settle(rid, outcome) {
      const reply = await inner.settle(rid, outcome);
      try {
        if (reply.ok) await wal.append({ kind: "outcome", reservation_id: rid, outcome });
      } catch {}
      return reply;
    },
  };
}

export interface ReserveLine {
  idempotency_key: string;
  lease_id: string;
  cell: CellAttempt;
  max_micros: number;
  reservation_id: string;
}

export type Recovery =
  | {
      kind: "recovered";
      controller: MoneyController;
      wal: WriteAhead;
      snapshot: Snapshot | null;
      /** Every sub-reservation held as unknown at its full reservation until reconciled. */
      held: Sub[];
      uncertainMicros: number;
      /** Proxy reserve lines after the watermark, for the restored local ledger. */
      reserves: ReserveLine[];
      /** Settle lines after the watermark: evidence for reconciliation, never applied as settled. */
      evidence: Array<Record<string, unknown>>;
    }
  | { kind: "captain"; why: string; uncertainMicros: number };

/** The newest snapshot the target holds, parsed, or null. */
export async function latestSnapshot(target: OffHostTarget): Promise<Snapshot | null> {
  const name = await target.latestSnapshot();
  const bytes = name ? await target.getSnapshot(name) : null;
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as Snapshot) : null;
}

/** Rebuilds the controller from the newest verified snapshot and the off-host lines after its watermark. */
export async function recover(target: OffHostTarget, o: ControllerOptions & { now?: () => Date }): Promise<Recovery> {
  const name = await target.latestSnapshot();
  let snap: Snapshot | null = null;
  if (name) {
    const bytes = await target.getSnapshot(name);
    try {
      snap = JSON.parse(new TextDecoder().decode(bytes!)) as Snapshot;
    } catch {
      return { kind: "captain", why: "snapshot " + name + " does not parse, so the ledger copy can't be shown complete", uncertainMicros: Infinity };
    }
    for (const part of [snap.ledger, snap.journal]) {
      if (part && sha256(Buffer.from(part.base64, "base64")) !== part.sha256) return { kind: "captain", why: "snapshot " + name + " holds a file whose sha256 does not match its record", uncertainMicros: Infinity };
    }
  }
  const watermark = snap?.watermark ?? 0;
  const head = snap?.head ?? GENESIS;
  const openReserved = (book: BookJson | undefined) => (book?.items ?? []).reduce((a, [, v]) => a + (v.lease?.reservedMicros ?? 0), 0);
  const chain = chainAfter(await target.lines(), watermark, head);
  if ("broken" in chain) return { kind: "captain", why: chain.broken + "; every open lease's allowance stays held until the Captain decides", uncertainMicros: openReserved(snap?.book) || Infinity };
  const last = chain.lines.at(-1);
  const wal = new WriteAhead(target, o.now, { seq: last?.seq ?? watermark, head: last?.hash ?? head });
  const opts = { ...o, wal };
  const c = snap ? MoneyController.restore(snap.book, opts) : new MoneyController(opts);
  const held: Sub[] = [];
  const hold = (sub: Sub) => {
    const h: Sub = { ...sub, state: "unknown", unknownMicros: sub.reserveMicros, spentMicros: 0 };
    c.adopt(h);
    held.push(h);
  };
  for (const sub of c.subsOf()) if (sub.state === "in-flight") hold(sub);
  const reserves: ReserveLine[] = [];
  const evidence: Array<Record<string, unknown>> = [];
  for (const line of chain.lines as WalLine[]) {
    const e = line.entry;
    if (e.kind === "admit") hold(e.sub as Sub);
    else if (e.kind === "reserve") reserves.push(e as unknown as ReserveLine);
    else if (["settle", "reconcile", "release", "release-session", "outcome"].includes(e.kind as string)) evidence.push(e);
    else c.applyStructural(e);
  }
  return { kind: "recovered", controller: c, wal, snapshot: snap, held, uncertainMicros: held.reduce((a, s) => a + s.reserveMicros, 0), reserves, evidence };
}

/** Writes the snapshot's local ledger back at its path (the same absolute path on the replacement host). */
export function restoreLedgerFile(snap: Snapshot, path = snap.ledger?.path): string {
  if (!snap.ledger || !path) throw new Error("snapshot " + snap.name + " holds no local ledger");
  if (existsSync(path)) throw new Error("a local ledger already exists at " + path + "; recovery writes only onto an empty path");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(snap.ledger.base64, "base64"), { mode: 0o600 });
  return path;
}

/**
 * Puts the reserves after the watermark back into the restored local ledger and runs main's reconcileJournal over a
 * recovery journal that names each one sent with no outcome, so main's own ledger holds each at its full reservation
 * as unknown. Returns the reconciler's result.
 */
export async function replayReserves(local: LocalLedger, reserves: ReserveLine[], journal: string): Promise<Awaited<ReturnType<typeof reconcileJournal>>> {
  const lines: string[] = [];
  for (const r of reserves) {
    const held = await local.reserve({ idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros });
    if (!held.ok) throw new Error("the restored local ledger refused reserve " + r.idempotency_key + ": " + held.code + " " + held.message);
    lines.push(JSON.stringify({ kind: "reserve", idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros }));
    lines.push(JSON.stringify({ kind: "request", reservation_id: held.reservation.reservation_id, idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros }));
  }
  mkdirSync(dirname(journal), { recursive: true });
  writeFileSync(journal, lines.length ? lines.join("\n") + "\n" : "");
  return reconcileJournal(journal, local);
}

/**
 * The owner's reconcile of a lost host's lease after it expires (main's reconcileLease), with the provider usage export
 * it came from. The provider figure, less what the book already holds settled on that lease, is spread over the held
 * sub-reservations in proportion to their reservations, and the lease leaves the book.
 */
export async function ownerReconcile(record: string, c: MoneyController, item: LedgerItemId, r: { spentMicros: number; quotes: Quote[]; source: string; now: Date }): Promise<void> {
  const lease = c.lease(item);
  if (!lease) throw new Error(item + " holds no open lease to reconcile");
  reconcileLease(record, { lease_id: lease.leaseId, spent_micros: r.spentMicros, quotes: r.quotes, source: r.source, now: r.now });
  const subs = c.subsOf(item).filter((s) => s.leaseId === lease.leaseId);
  const known = subs.filter((s) => s.state === "settled").reduce((a, s) => a + s.spentMicros, 0);
  const heldSubs = subs.filter((s) => s.state === "unknown");
  const total = heldSubs.reduce((a, s) => a + s.unknownMicros, 0);
  let left = Math.max(r.spentMicros - known, 0);
  for (const [i, s] of heldSubs.entries()) {
    const part = i === heldSubs.length - 1 ? left : Math.floor((Math.max(r.spentMicros - known, 0) * s.unknownMicros) / (total || 1));
    left -= part;
    await c.reconcile(s.id, part);
  }
  c.dropLease(item);
}
