// The local ledger, the machine-local tier: a SQLite file that holds one lease's calls against its amount. Every reserve
// and settle is one BEGIN IMMEDIATE transaction, so processes that share the file serialize on SQLite's lock. It is
// refused on a network or FUSE mount (E_LEDGER_PATH), where that lock does not hold.
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger, TokenUsage } from "../../types.ts";
import { isMicros, usd } from "./money.ts";
import { ledgerPath, readMounts, remoteMount, type Mount, type Resolved } from "./paths.ts";
import { LedgerError, type CloseFile, type LeaseFile } from "./record.ts";

const FORMAT = "gstack-evals-ledger/1";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leases (lease_id TEXT PRIMARY KEY, file TEXT NOT NULL, state TEXT NOT NULL, close TEXT);
CREATE TABLE IF NOT EXISTS reservations (
  reservation_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, lease_id TEXT NOT NULL REFERENCES leases (lease_id),
  cell TEXT NOT NULL, max_micros INTEGER NOT NULL, state TEXT NOT NULL, spent_micros INTEGER, usage TEXT, created_at TEXT NOT NULL);
`;

interface Row {
  reservation_id: string;
  idempotency_key: string;
  lease_id: string;
  cell: string;
  max_micros: number;
  state: Reservation["state"];
  spent_micros: number | null;
  usage: string | null;
}

export interface LocalLease {
  file: LeaseFile;
  state: "open" | "closing" | "settled" | "reconciled";
  close: CloseFile | null;
}

/** JSON with sorted keys, so equal cells and usages compare equal as text. */
const flat = (value: object) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))));
const refuse = (code: ReasonCode, message: string): LedgerReply => ({ ok: false, code, message });
const outcomeText = (r: Pick<Row, "state" | "spent_micros">) => (r.state === "settled" ? "spent " + usd(r.spent_micros ?? 0) : r.state);

function toReservation(r: Row): Reservation {
  const { reservation_id, idempotency_key, lease_id, max_micros, state, spent_micros } = r;
  return { reservation_id, idempotency_key, lease_id, cell: JSON.parse(r.cell), max_micros, state, spent_micros, usage: r.usage === null ? null : JSON.parse(r.usage) };
}

export class LocalLedger implements ReservationLedger {
  private constructor(
    readonly path: string,
    private readonly db: Database,
    private readonly now: () => Date,
  ) {}

  static open(path: string, now = () => new Date()): LocalLedger {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { create: true, strict: true });
    try {
      db.exec("PRAGMA busy_timeout = 20000");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = FULL");
      db.exec(SCHEMA);
      db.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('format', ?)", [FORMAT]);
      const format = db.query("SELECT value FROM meta WHERE key = 'format'").get() as { value: string };
      if (format.value !== FORMAT) throw new Error("it is a " + format.value + " file, not " + FORMAT);
    } catch (error) {
      db.close();
      throw error;
    }
    return new LocalLedger(path, db, now);
  }

  close(): void {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }

  addLease(file: LeaseFile): void {
    const text = JSON.stringify(file);
    this.db.run("INSERT OR IGNORE INTO leases (lease_id, file, state) VALUES (?, ?, 'open')", [file.lease_id, text]);
    if (JSON.stringify(this.getLease(file.lease_id)!.file) !== text) {
      throw new LedgerError("E_INTERNAL", "the local ledger " + this.path + " already holds a different lease " + file.lease_id);
    }
  }

  getLease(lease_id: string): LocalLease | null {
    const row = this.db.query("SELECT file, state, close FROM leases WHERE lease_id = ?").get(lease_id) as { file: string; state: LocalLease["state"]; close: string | null } | null;
    return row && { file: JSON.parse(row.file), state: row.state, close: row.close === null ? null : JSON.parse(row.close) };
  }

  /** Spend that counts against the lease: settled calls at their cost, the rest at their full reservation. */
  private held(lease_id: string): number {
    const row = this.db.query("SELECT COALESCE(SUM(CASE WHEN state = 'settled' THEN spent_micros ELSE max_micros END), 0) AS held FROM reservations WHERE lease_id = ?").get(lease_id) as { held: number };
    return row.held;
  }

  async reserve(request: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const { idempotency_key, lease_id, max_micros } = request;
    const cell = flat(request.cell);
    if (!isMicros(max_micros)) return refuse("E_INTERNAL", "max_micros must be a whole number of micro-dollars, not " + max_micros);
    return this.tx(() => {
      const prior = this.db.query("SELECT * FROM reservations WHERE idempotency_key = ?").get(idempotency_key) as Row | null;
      if (prior) {
        if (prior.lease_id === lease_id && prior.max_micros === max_micros && prior.cell === cell) return { ok: true, reservation: toReservation(prior) };
        return refuse("E_RESERVE_CONFLICT", "idempotency key " + idempotency_key + " holds " + usd(prior.max_micros) + " on lease " + prior.lease_id + " for " + prior.cell + "; this reserve asked for " + usd(max_micros) + " on lease " + lease_id + " for " + cell);
      }
      const lease = this.getLease(lease_id);
      if (!lease) return refuse("E_LEDGER_MISSING", "no lease " + lease_id + " in the local ledger " + this.path + "; the run leases its line item before it spends");
      if (lease.state !== "open") return refuse("E_LEASE_CLOSED", "lease " + lease_id + " is " + lease.state);
      if (this.now() >= new Date(lease.file.expires_at)) return refuse("E_LEASE_CLOSED", "lease " + lease_id + " expired at " + lease.file.expires_at);
      const held = this.held(lease_id);
      if (held + max_micros > lease.file.reserved_micros) {
        return refuse("CAP_STOP", "lease " + lease_id + " holds " + usd(held) + " of " + usd(lease.file.reserved_micros) + "; this call needs up to " + usd(max_micros));
      }
      const row: Row = { reservation_id: "rsv_" + randomUUID(), idempotency_key, lease_id, cell, max_micros, state: "reserved", spent_micros: null, usage: null };
      this.db.run("INSERT INTO reservations (reservation_id, idempotency_key, lease_id, cell, max_micros, state, created_at) VALUES (?, ?, ?, ?, ?, 'reserved', ?)", [row.reservation_id, idempotency_key, lease_id, cell, max_micros, this.now().toISOString()]);
      return { ok: true, reservation: toReservation(row) };
    });
  }

  async settle(reservation_id: string, outcome: CallOutcome): Promise<LedgerReply> {
    if (outcome.kind === "spent" && !isMicros(outcome.spent_micros)) return refuse("E_INTERNAL", "spent_micros must be a whole number of micro-dollars, not " + outcome.spent_micros);
    const next = outcome.kind === "spent" ? { state: "settled" as const, spent_micros: outcome.spent_micros, usage: flat(outcome.usage) } : { state: "unknown" as const, spent_micros: null, usage: null };
    return this.tx(() => {
      const row = this.db.query("SELECT * FROM reservations WHERE reservation_id = ?").get(reservation_id) as Row | null;
      if (!row) return refuse("E_INTERNAL", "no reservation " + reservation_id + " in the local ledger " + this.path);
      if (row.state !== "reserved") {
        if (row.state === next.state && row.spent_micros === next.spent_micros && row.usage === next.usage) return { ok: true, reservation: toReservation(row) };
        return refuse("E_SETTLE_CONFLICT", "reservation " + reservation_id + " was settled as " + outcomeText(row) + (row.usage ? " " + row.usage : "") + "; this settle says " + outcomeText(next) + (next.usage ? " " + next.usage : ""));
      }
      this.db.run("UPDATE reservations SET state = ?, spent_micros = ?, usage = ? WHERE reservation_id = ?", [next.state, next.spent_micros, next.usage, reservation_id]);
      return { ok: true, reservation: toReservation({ ...row, ...next }) };
    });
  }

  /**
   * Fixes the lease's close once and stores it, so every retry writes the same bytes to the record. Calls still
   * reserved become unknown: their charge is kept and a later settle of them is a conflict.
   */
  stageClose(lease_id: string): CloseFile {
    return this.tx(() => {
      const lease = this.getLease(lease_id);
      if (!lease) throw new LedgerError("E_LEASE_UNSETTLED", "no lease " + lease_id + " in the local ledger " + this.path + "; settle it on its own machine, or, if that machine or its local ledger is gone, the owner reconciles it");
      if (lease.close) return lease.close;
      this.db.run("UPDATE reservations SET state = 'unknown' WHERE lease_id = ? AND state = 'reserved'", [lease_id]);
      const rows = this.db.query("SELECT * FROM reservations WHERE lease_id = ?").all(lease_id) as Row[];
      const settled = rows.filter((r) => r.state === "settled");
      const unknown = rows.filter((r) => r.state === "unknown");
      const usage: TokenUsage = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
      for (const r of settled) for (const [k, v] of Object.entries(JSON.parse(r.usage ?? "{}") as TokenUsage)) usage[k as keyof TokenUsage] += v;
      const close: CloseFile = {
        schema: 1,
        kind: "close",
        item: lease.file.item,
        seq: lease.file.seq,
        lease_id,
        how: "settled",
        spent_micros: settled.reduce((sum, r) => sum + (r.spent_micros ?? 0), 0),
        unknown_micros: unknown.reduce((sum, r) => sum + r.max_micros, 0),
        unknown_calls: unknown.length,
        usage,
        closed_at: this.now().toISOString(),
      };
      this.db.run("UPDATE leases SET state = 'closing', close = ? WHERE lease_id = ?", [JSON.stringify(close), lease_id]);
      return close;
    });
  }

  markClosed(lease_id: string, how: CloseFile["how"]): void {
    this.db.run("UPDATE leases SET state = ? WHERE lease_id = ?", [how, lease_id]);
  }
}

/** Opens the local ledger, refusing a network or FUSE mount or a file SQLite cannot use with E_LEDGER_PATH. */
export function openLocalLedger(at: Resolved, mounts: Mount[] = readMounts()): LocalLedger {
  const fix = "point --ledger at a local disk; the default here is " + ledgerPath(undefined).path;
  const type = remoteMount(at.path, mounts);
  if (type) throw new LedgerError("E_LEDGER_PATH", "the local ledger " + at.path + " (from " + at.rule + ") is on a " + type + " mount, where SQLite's lock does not hold; " + fix);
  try {
    return LocalLedger.open(at.path);
  } catch (error) {
    throw new LedgerError("E_LEDGER_PATH", "the local ledger " + at.path + " (from " + at.rule + ") cannot be used: " + (error as Error).message + "; " + fix);
  }
}
