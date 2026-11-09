// The local ledger, the machine-local tier: a SQLite file that holds one lease's calls against its amount. Every reserve
// and settle is one BEGIN IMMEDIATE transaction, so processes that share the file serialize on SQLite's lock. It is
// refused on a network or FUSE mount (E_LEDGER_PATH), where that lock does not hold.
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger, TokenUsage } from "../../types.ts";
import { isMicros, usd } from "./money.ts";
import { ledgerPath, readMounts, remoteMount, type Mount, type Resolved } from "./paths.ts";
import { isTime, LedgerError, type CloseFile, type LeaseFile } from "./record.ts";

const FORMAT = "gstack-evals-ledger/1";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leases (lease_id TEXT PRIMARY KEY, file TEXT NOT NULL, state TEXT NOT NULL, close TEXT);
CREATE TABLE IF NOT EXISTS reservations (
  reservation_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, lease_id TEXT NOT NULL REFERENCES leases (lease_id),
  cell TEXT NOT NULL, max_micros INTEGER NOT NULL, state TEXT NOT NULL, spent_micros INTEGER, usage TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS reservations_lease ON reservations (lease_id, state);
CREATE TABLE IF NOT EXISTS stops (lease_id TEXT PRIMARY KEY, scope TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scope_stops (
  lease_id TEXT NOT NULL REFERENCES leases (lease_id), field TEXT NOT NULL, value TEXT NOT NULL, code TEXT NOT NULL, scope TEXT NOT NULL,
  stopped_at TEXT NOT NULL, PRIMARY KEY (lease_id, field, value));
CREATE TABLE IF NOT EXISTS releases (
  reservation_id TEXT PRIMARY KEY REFERENCES reservations (reservation_id), idempotency_key TEXT NOT NULL, lease_id TEXT NOT NULL,
  generation_id TEXT NOT NULL, record_sha256 TEXT NOT NULL, prior_state TEXT NOT NULL, prior_spent_micros INTEGER, prior_usage TEXT,
  released_at TEXT NOT NULL);
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
const USAGE_KEYS = ["input", "output", "reasoning", "cache_read", "cache_write"] as const;
const isCount = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
const outcomeText = (r: Pick<Row, "state" | "spent_micros">) => (r.state === "settled" ? "spent " + usd(r.spent_micros ?? 0) : r.state);

function toReservation(r: Row): Reservation {
  const { reservation_id, idempotency_key, lease_id, max_micros, state, spent_micros } = r;
  return { reservation_id, idempotency_key, lease_id, cell: JSON.parse(r.cell), max_micros, state, spent_micros, usage: r.usage === null ? null : JSON.parse(r.usage) };
}

/** A scope of a lease's cells: those whose cell field holds value (a model under test, or an arm). */
export interface ScopeMatch {
  field: "model" | "arm";
  value: string;
}

export interface ScopeStop extends ScopeMatch {
  code: ReasonCode;
  scope: string;
  stopped_at: string;
}

/** A stopped scope's own figures on its lease: settled calls and their spend, and calls of unknown cost at their full charge. */
export interface ScopeFigures {
  settled_calls: number;
  spent_micros: number;
  unknown_calls: number;
  unknown_micros: number;
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
      db.transaction(() => {
        const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
        if (tables.length > 0) {
          const format = tables.includes("meta") ? (db.query("SELECT value FROM meta WHERE key = 'format'").get() as { value: string } | null)?.value : undefined;
          if (format !== FORMAT) throw new Error("it is " + (format ? "a " + format : "another program's") + " file, not " + FORMAT + "; it was left unchanged");
        }
        db.exec(SCHEMA);
        db.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('format', ?)", [FORMAT]);
      }).immediate();
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = FULL");
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
    if (!isMicros(file.reserved_micros) || !isTime(file.expires_at)) throw new LedgerError("E_USAGE", "lease " + file.lease_id + " needs a whole reserved_micros and a valid expires_at");
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
  held(lease_id: string): number {
    const row = this.db.query("SELECT COALESCE(SUM(CASE WHEN state = 'settled' THEN spent_micros ELSE max_micros END), 0) AS held FROM reservations WHERE lease_id = ?").get(lease_id) as { held: number };
    return row.held;
  }

  /**
   * Per meter id on the lease: what it holds, counted as held() counts the lease, split into its settled calls' spend
   * and the full reservations of its calls with no recorded cost, the count of those calls, and the token usage of its
   * settled calls.
   */
  meters(lease_id: string): Map<string, { held_micros: number; spent_micros: number; unknown_micros: number; unknown_calls: number; usage: TokenUsage }> {
    const rows = this.db.query("SELECT cell, state, max_micros, spent_micros, usage FROM reservations WHERE lease_id = ?").all(lease_id) as Pick<Row, "cell" | "state" | "max_micros" | "spent_micros" | "usage">[];
    const out = new Map<string, { held_micros: number; spent_micros: number; unknown_micros: number; unknown_calls: number; usage: TokenUsage }>();
    for (const r of rows) {
      const id = (JSON.parse(r.cell) as CellAttempt).meter_id;
      let m = out.get(id);
      if (!m) out.set(id, (m = { held_micros: 0, spent_micros: 0, unknown_micros: 0, unknown_calls: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 } }));
      if (r.state === "settled") m.spent_micros += r.spent_micros ?? 0;
      else {
        m.unknown_micros += r.max_micros;
        m.unknown_calls++;
      }
      m.held_micros = m.spent_micros + m.unknown_micros;
      if (r.state === "settled" && r.usage) for (const [k, v] of Object.entries(JSON.parse(r.usage) as TokenUsage)) m.usage[k as keyof TokenUsage] += v;
    }
    return out;
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
      const stop = this.scopeStopOf(lease_id, request.cell);
      if (stop) return refuse(stop.code, "lease " + lease_id + " stopped " + stop.field + " " + stop.value + " (" + stop.scope + "), so this call is not sent; the lease stays open for its other cells");
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
    if (outcome.kind === "spent" && !USAGE_KEYS.every((k) => isCount(outcome.usage?.[k]))) return refuse("E_INTERNAL", "usage must give whole token counts for " + USAGE_KEYS.join(", ") + ", not " + JSON.stringify(outcome.usage));
    const next = outcome.kind === "spent" ? { state: "settled" as const, spent_micros: outcome.spent_micros, usage: flat(Object.fromEntries(USAGE_KEYS.map((k) => [k, outcome.usage[k]]))) } : { state: "unknown" as const, spent_micros: null, usage: null };
    return this.tx(() => {
      const row = this.db.query("SELECT * FROM reservations WHERE reservation_id = ?").get(reservation_id) as Row | null;
      if (!row) return refuse("E_INTERNAL", "no reservation " + reservation_id + " in the local ledger " + this.path);
      if (row.state !== "reserved") {
        if (row.state === next.state && row.spent_micros === next.spent_micros && row.usage === next.usage) return { ok: true, reservation: toReservation(row) };
        const released = this.db.query("SELECT prior_state, prior_spent_micros, prior_usage FROM releases WHERE reservation_id = ?").get(reservation_id) as { prior_state: string; prior_spent_micros: number | null; prior_usage: string | null } | null;
        if (released && released.prior_state === next.state && released.prior_spent_micros === next.spent_micros && released.prior_usage === next.usage) return { ok: true, reservation: toReservation(row) };
        return refuse("E_SETTLE_CONFLICT", "reservation " + reservation_id + " was settled as " + outcomeText(row) + (row.usage ? " " + row.usage : "") + "; this settle says " + outcomeText(next) + (next.usage ? " " + next.usage : ""));
      }
      this.db.run("UPDATE reservations SET state = ?, spent_micros = ?, usage = ? WHERE reservation_id = ?", [next.state, next.spent_micros, next.usage, reservation_id]);
      return { ok: true, reservation: toReservation({ ...row, ...next }) };
    });
  }

  /** The scope stops recorded on a lease, oldest first. */
  scopeStops(lease_id: string): ScopeStop[] {
    return this.db.query("SELECT field, value, code, scope, stopped_at FROM scope_stops WHERE lease_id = ? ORDER BY stopped_at, field, value").all(lease_id) as ScopeStop[];
  }

  private scopeStopOf(lease_id: string, cell: CellAttempt): ScopeStop | undefined {
    return this.scopeStops(lease_id).find((s) => cell[s.field] === s.value);
  }

  /**
   * Stops one scope of an open lease: every later reserve for a cell whose field holds value is refused with code, and
   * every other cell keeps reserving on the same lease, which stays open (GST-2016: a per-model stop on a lease shared by
   * several models settles only that model's sessions and reservations). The first stop on a scope stands. Returns how
   * many of the scope's calls are still in flight; settleScope settles them once their sends are known to be over.
   */
  stopScope(lease_id: string, match: ScopeMatch, code: ReasonCode, scope: string): { first: boolean; stop: ScopeStop; in_flight: number } {
    return this.tx(() => {
      const lease = this.getLease(lease_id);
      if (!lease) throw new LedgerError("E_LEDGER_MISSING", "no lease " + lease_id + " in the local ledger " + this.path);
      if (lease.state !== "open") throw new LedgerError("E_LEASE_CLOSED", "lease " + lease_id + " is " + lease.state + ", so no scope of it can be stopped");
      const inserted = this.db.run("INSERT OR IGNORE INTO scope_stops (lease_id, field, value, code, scope, stopped_at) VALUES (?, ?, ?, ?, ?, ?)", [lease_id, match.field, match.value, code, scope, this.now().toISOString()]).changes === 1;
      const stop = this.db.query("SELECT field, value, code, scope, stopped_at FROM scope_stops WHERE lease_id = ? AND field = ? AND value = ?").get(lease_id, match.field, match.value) as ScopeStop;
      return { first: inserted, stop, in_flight: this.scopeRows(lease_id, match).filter((r) => r.state === "reserved").length };
    });
  }

  private scopeRows(lease_id: string, match: ScopeMatch): Row[] {
    return (this.db.query("SELECT * FROM reservations WHERE lease_id = ?").all(lease_id) as Row[]).filter((r) => (JSON.parse(r.cell) as CellAttempt)[match.field] === match.value);
  }

  /**
   * Settles a stopped scope's own reservations on its open lease and nothing else: a call of the scope still reserved
   * becomes unknown, its full charge kept, as stageClose does for a whole lease, and a later settle of it is a conflict.
   * Call it only once the scope's sends are over (its sessions ended or killed). Other cells and the lease are untouched.
   */
  settleScope(lease_id: string, match: ScopeMatch): ScopeFigures {
    return this.tx(() => {
      const lease = this.getLease(lease_id);
      if (!lease) throw new LedgerError("E_LEDGER_MISSING", "no lease " + lease_id + " in the local ledger " + this.path);
      const stopped = this.db.query("SELECT 1 FROM scope_stops WHERE lease_id = ? AND field = ? AND value = ?").get(lease_id, match.field, match.value);
      if (!stopped) throw new LedgerError("E_USAGE", "lease " + lease_id + " has no stop on " + match.field + " " + match.value + "; stop the scope before settling it");
      for (const r of this.scopeRows(lease_id, match)) if (r.state === "reserved") this.db.run("UPDATE reservations SET state = 'unknown' WHERE reservation_id = ? AND state = 'reserved'", [r.reservation_id]);
      const rows = this.scopeRows(lease_id, match);
      const unknown = rows.filter((r) => r.state === "unknown");
      return { settled_calls: rows.length - unknown.length, spent_micros: rows.reduce((s, r) => s + (r.state === "settled" ? (r.spent_micros ?? 0) : 0), 0), unknown_calls: unknown.length, unknown_micros: unknown.reduce((s, r) => s + r.max_micros, 0) };
    });
  }

  /** Keeps the first cap stop given for a lease, before its close is staged, so every later settle of the lease carries it. */
  stageStop(lease_id: string, scope: string): void {
    this.db.run("INSERT OR IGNORE INTO stops (lease_id, scope) VALUES (?, ?)", [lease_id, scope]);
  }

  /** The scope of the cap stop this ledger holds for a lease, kept by stageStop or staged with its close, or undefined. */
  stagedStop(lease_id: string): string | undefined {
    return (this.db.query("SELECT scope FROM stops WHERE lease_id = ?").get(lease_id) as { scope: string } | null)?.scope ?? this.getLease(lease_id)?.close?.cap_stop;
  }

  /**
   * Fixes the lease's close once and stores it, so every retry writes the same bytes to the record. Calls still
   * reserved become unknown: their charge is kept and a later settle of them is a conflict. A cap stop's scope, given
   * here or kept earlier by stageStop, is stored with the close the first time one is given, so every later settle
   * keeps it, even one that is given none. Once the close is in the record, a stop given later leaves it as written.
   */
  stageClose(lease_id: string, cap_stop?: string): CloseFile {
    return this.tx(() => {
      const lease = this.getLease(lease_id);
      if (!lease) throw new LedgerError("E_LEASE_UNSETTLED", "no lease " + lease_id + " in the local ledger " + this.path + "; settle it on the machine whose local ledger holds it, or, if that machine or its local ledger is gone, the owner reconciles it after it expires");
      cap_stop ??= this.stagedStop(lease_id);
      if (lease.close) {
        if (lease.close.cap_stop || !cap_stop || lease.state !== "closing") return lease.close;
        const stopped: CloseFile = { ...lease.close, cap_stop };
        this.db.run("UPDATE leases SET close = ? WHERE lease_id = ?", [JSON.stringify(stopped), lease_id]);
        return stopped;
      }
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
        ...(cap_stop ? { cap_stop } : {}),
      };
      this.db.run("UPDATE leases SET state = 'closing', close = ? WHERE lease_id = ?", [JSON.stringify(close), lease_id]);
      return close;
    });
  }

  /**
   * Releases at $0 one send of an open lease that the provider's own record shows was not billed (tbv amendment 1 item 13).
   * The send is found by its idempotency key in the proxy's journal, and it must have a final outcome with no usage there:
   * unknown, or a 5xx charged at its reservation. A reserved row (a send in flight) is never released. record is the
   * provider's generation record as returned, which must name generation_id, a total_cost of 0 and token counts of 0; its sha256 is kept in
   * releases with the row's prior outcome, so a later settle of that outcome (reconcileJournal) is accepted as already done.
   */
  releaseUnbilled(r: { lease_id: string; idempotency_key: string; journal: string; generation_id: string; record: string }): LedgerReply {
    let data: { id?: unknown; total_cost?: unknown; tokens_prompt?: unknown; tokens_completion?: unknown } | undefined;
    try {
      data = (JSON.parse(r.record) as { data?: typeof data })?.data;
    } catch {}
    if (data?.id !== r.generation_id || data?.total_cost !== 0 || data?.tokens_prompt !== 0 || data?.tokens_completion !== 0) return refuse("E_USAGE", "the generation record for " + r.idempotency_key + " does not show " + r.generation_id + " at a total_cost of 0 with 0 prompt and completion tokens, so its reservation is kept");
    let rid: string | undefined;
    let outcome: { status: number | null; outcome: CallOutcome } | undefined;
    let text: string;
    try {
      text = readFileSync(r.journal, "utf8");
    } catch (error) {
      return refuse("E_USAGE", "the journal " + r.journal + " cannot be read: " + (error as Error).message);
    }
    for (const line of text.split("\n")) {
      let e: { kind?: string; idempotency_key?: string; lease_id?: string; reservation_id?: string; status?: number | null; outcome?: CallOutcome };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.kind === "request" && e.idempotency_key === r.idempotency_key && e.lease_id === r.lease_id) rid = e.reservation_id;
      if (e.kind === "outcome" && rid !== undefined && e.reservation_id === rid && e.outcome) outcome = { status: e.status ?? null, outcome: e.outcome };
    }
    if (!rid) return refuse("E_USAGE", "the journal " + r.journal + " sent nothing under " + r.idempotency_key + " on lease " + r.lease_id);
    if (!outcome) return refuse("E_SETTLE_CONFLICT", "reservation " + rid + " has no outcome in the journal: the send may still be in flight, so it is not released");
    const o = outcome.outcome;
    const noUsage = o.kind === "unknown" || ((outcome.status ?? 0) >= 500 && USAGE_KEYS.every((k) => o.usage?.[k] === 0));
    if (!noUsage) return refuse("E_SETTLE_CONFLICT", "reservation " + rid + " has an outcome with usage in the journal, so it is not released");
    const sha = createHash("sha256").update(r.record).digest("hex");
    return this.tx(() => {
      const lease = this.getLease(r.lease_id);
      if (!lease || lease.state !== "open") return refuse("E_LEASE_CLOSED", "lease " + r.lease_id + " is " + (lease?.state ?? "missing") + ", so nothing on it is released");
      const row = this.db.query("SELECT * FROM reservations WHERE reservation_id = ?").get(rid) as Row | null;
      if (!row || row.idempotency_key !== r.idempotency_key || row.lease_id !== r.lease_id) return refuse("E_INTERNAL", "no reservation " + rid + " under " + r.idempotency_key + " on lease " + r.lease_id + " in the local ledger " + this.path);
      const prior = this.db.query("SELECT generation_id, record_sha256 FROM releases WHERE reservation_id = ?").get(rid) as { generation_id: string; record_sha256: string } | null;
      if (prior) return prior.generation_id === r.generation_id && prior.record_sha256 === sha ? { ok: true, reservation: toReservation(row) } : refuse("E_SETTLE_CONFLICT", "reservation " + rid + " was released on generation " + prior.generation_id);
      const matches = o.kind === "unknown" ? row.state === "unknown" : row.state === "settled" && row.spent_micros === row.max_micros;
      if (!matches) return refuse("E_SETTLE_CONFLICT", "reservation " + rid + " is " + outcomeText(row) + ", not the no-usage outcome its journal records, so it is not released");
      const zero = flat(Object.fromEntries(USAGE_KEYS.map((k) => [k, 0])));
      this.db.run("INSERT INTO releases (reservation_id, idempotency_key, lease_id, generation_id, record_sha256, prior_state, prior_spent_micros, prior_usage, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [rid, r.idempotency_key, r.lease_id, r.generation_id, sha, row.state, row.spent_micros, row.usage, this.now().toISOString()]);
      this.db.run("UPDATE reservations SET state = 'settled', spent_micros = 0, usage = ? WHERE reservation_id = ?", [zero, rid]);
      return { ok: true, reservation: toReservation({ ...row, state: "settled", spent_micros: 0, usage: zero }) };
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
