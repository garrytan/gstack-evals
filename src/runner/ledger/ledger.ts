// The budget ledger's operations across its two tiers (plan v3.2, "Admission without a shared lock"). An approval
// records a line item's cap with the owner's words. A run leases the item: the first lease binds the item to that run,
// and a new lease waits until the previous one is settled or reconciled. The local ledger holds a lease's calls against
// its amount, and the lease closes into the approval record. Nothing here releases an allowance whose spend is unknown.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import type { ReasonCode } from "../../errors/codes.ts";
import { rigAdmission } from "../../rig/admission.ts";
import type { Lease } from "../../types.ts";
import type { LocalLedger } from "./local.ts";
import { isMicros, usd } from "./money.ts";
import { isRecordFile, isTime, ITEM_NAME, LedgerError, listItems, readItem, writeOnce, type Admission, type ApprovalFile, type CloseFile, type ItemState, type LeaseFile, type Quote, type RecordFile } from "./record.ts";

export const DEFAULT_LEASE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_LEASE_TTL_MS = 7 * DEFAULT_LEASE_TTL_MS;
const ESCALATE = "a human must approve a cap and record it with their exact words (docs/budget-ledger.md); on Capy, ask your Captain through a needs-you report";

/** A stable id for this machine that does not publish /etc/machine-id itself. */
export function machineId(): string {
  try {
    return "m-" + createHash("sha256").update(readFileSync("/etc/machine-id", "utf8").trim()).digest("hex").slice(0, 16);
  } catch {
    return "host-" + hostname();
  }
}

function read(record: string, item: string): ItemState {
  try {
    return readItem(record, item);
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    throw new LedgerError("E_LEDGER_RECORD", "reading line item " + item + " in the approval record " + record + " failed: " + (error as Error).message);
  }
}

function write(record: string, file: RecordFile, code: ReasonCode = "E_LEDGER_RECORD"): ReturnType<typeof writeOnce> {
  try {
    return writeOnce(record, file);
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    throw new LedgerError(code, "writing " + file.kind + " " + file.seq + " of line item " + file.item + " to the approval record " + record + " failed: " + (error as Error).message);
  }
}

function checkQuotes(quotes: Quote[]): void {
  if (quotes.length === 0 || quotes.some((q) => !q.words.trim() || !q.by.trim() || !q.source.trim())) {
    throw new LedgerError("E_USAGE", "every approval and reconcile needs the owner's exact words (--words), who said them (--by) and where (--source)");
  }
}

const sameQuotes = (a: Quote[] | undefined, b: Quote[]) => JSON.stringify(a) === JSON.stringify(b);
const closeText = (c: CloseFile) => c.how + " at " + usd(c.spent_micros) + " spent and " + usd(c.unknown_micros) + " unknown";

/**
 * Records a line item's first cap (init) or a higher one (raise). Retrying the same approval returns the recorded one.
 * mirror runs after every check and before the write, so no approval is recorded until the mirror succeeds.
 */
export function recordApproval(record: string, a: { action: "init" | "raise"; item: string; cap_micros: number; quotes: Quote[]; admission?: Admission; now?: Date }, mirror?: () => void): ApprovalFile {
  if (!isMicros(a.cap_micros) || a.cap_micros === 0) throw new LedgerError("E_USAGE", "a cap must be a positive amount of dollars");
  if (a.action === "init" && a.admission !== "required" && a.admission !== "warn") throw new LedgerError("E_USAGE", "init needs --admission required or --admission warn");
  if (a.action === "raise" && a.admission !== undefined) throw new LedgerError("E_USAGE", "a line item's admission is fixed at init; raise cannot change it");
  checkQuotes(a.quotes);
  const state = read(record, a.item);
  const last = state.approvals.at(-1);
  if (last && last.action === a.action && last.cap_micros === a.cap_micros && last.admission === a.admission && sameQuotes(last.quotes, a.quotes)) return last;
  if (a.action === "init" && last) throw new LedgerError("E_USAGE", "line item " + a.item + " already has an approved cap of " + usd(last.cap_micros) + "; record a higher one with gstack-evals ledger raise");
  if (a.action === "raise" && !last) throw new LedgerError("E_LEDGER_MISSING", "line item " + a.item + " has no approved cap to raise in " + record + "; " + ESCALATE);
  if (last && a.cap_micros <= last.cap_micros) throw new LedgerError("E_USAGE", "raise records a higher cap; line item " + a.item + " is already at " + usd(last.cap_micros));
  const file: ApprovalFile = { schema: 1, kind: "approval", item: a.item, seq: state.approvals.length + 1, action: a.action, cap_micros: a.cap_micros, quotes: a.quotes, ...(a.admission ? { admission: a.admission } : {}), recorded_at: (a.now ?? new Date()).toISOString() };
  mirror?.();
  if (typeof write(record, file) === "object") throw new LedgerError("E_LEDGER_RECORD", "another approval for line item " + a.item + " was recorded at the same moment; read gstack-evals ledger status, then record again if it is still needed");
  return file;
}

function admit(record: string, state: ItemState, run_id: string): void {
  if (state.cap_micros === null) throw new LedgerError("E_LEDGER_MISSING", "no approved cap is on record for line item " + state.item + " in " + record + "; " + ESCALATE);
  if (state.run_id !== null && state.run_id !== run_id) throw new LedgerError("E_ITEM_BOUND", "line item " + state.item + " is bound to run " + state.run_id + ", so run " + run_id + " cannot spend from it");
  const open = state.open;
  if (open) {
    throw new LedgerError(
      "E_LEASE_UNSETTLED",
      "lease " + open.lease_id + " on line item " + state.item + " (machine " + open.machine_id + ", " + usd(open.reserved_micros) + ") is still open; settle it with gstack-evals ledger settle --lease " + open.lease_id + " on that machine, or, if the machine or its local ledger is gone, the owner reconciles it with gstack-evals ledger reconcile --lease " + open.lease_id,
    );
  }
}

const toLease = (f: LeaseFile, state: Lease["state"]): Lease => ({ lease_id: f.lease_id, line_item: f.item, run_id: f.run_id, machine_id: f.machine_id, reserved_micros: f.reserved_micros, expires_at: f.expires_at, state });

export interface LeaseRequest {
  item: string;
  run_id: string;
  /** The holder: this machine by default, or the sealed workflow a lease is exported to. */
  machine_id?: string;
  /** Defaults to everything the line item has left. */
  amount_micros?: number;
  ttl_ms?: number;
  now?: Date;
  /** Checks the lease's admission record on an item initialized with an admission mode; defaults to U20's rigAdmission(). */
  requireAdmission?: RequireAdmission;
  /** Receives a warning, such as RIG_UNPROVEN on a warn item, without stopping the lease. */
  warn?: (code: ReasonCode, message: string) => void;
}

/**
 * The seam U20 fills (GSTA-8, decision 3): runs before a lease is written and returns why the lease is not admitted,
 * or null. The admission record for a lease sits in its slot, <record>/items/<item>/admission-<slot>.json, so it can
 * be written before the lease whose id it shares up to the id's random suffix.
 */
export type RequireAdmission = (record: string, lease: LeaseFile) => string | null;

/** Leases a line item for a run, in the record and, when given, in this machine's local ledger. */
export function openLease(record: string, local: LocalLedger | null, req: LeaseRequest): Lease {
  const state = read(record, req.item);
  admit(record, state, req.run_id);
  const cap = state.cap_micros!;
  const left = cap - state.committed_micros;
  const amount = req.amount_micros ?? left;
  if (!isMicros(amount) || amount === 0 || amount > left) {
    throw new LedgerError("CAP_STOP", "line item " + req.item + " has " + usd(Math.max(left, 0)) + " left of its " + usd(cap) + " cap (" + usd(state.committed_micros) + " committed); this lease asks for " + (isMicros(amount) ? usd(amount) : String(amount)));
  }
  const ttl = req.ttl_ms ?? DEFAULT_LEASE_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_LEASE_TTL_MS) throw new LedgerError("E_USAGE", "a lease's time to live must be a whole number of milliseconds from 1 to " + MAX_LEASE_TTL_MS + " (7 days), not " + ttl);
  const now = req.now ?? new Date();
  const seq = state.leases.length + 1;
  const file: LeaseFile = {
    schema: 1,
    kind: "lease",
    item: req.item,
    seq,
    lease_id: req.item + "." + String(seq).padStart(4, "0") + "." + randomBytes(3).toString("hex"),
    run_id: req.run_id,
    machine_id: req.machine_id ?? machineId(),
    reserved_micros: amount,
    expires_at: new Date(now.getTime() + ttl).toISOString(),
    created_at: now.toISOString(),
  };
  const unproven = state.admission && (req.requireAdmission ?? rigAdmission())(record, file);
  if (unproven && state.admission === "required") throw new LedgerError("E_RIG_UNPROVEN", "line item " + req.item + " requires admission: " + unproven);
  if (unproven) req.warn?.("RIG_UNPROVEN", "line item " + req.item + " leased without admission: " + unproven);
  if (typeof write(record, file) === "object") {
    admit(record, read(record, req.item), req.run_id);
    throw new LedgerError("E_LEASE_UNSETTLED", "another lease on line item " + req.item + " was written at the same moment; read gstack-evals ledger status");
  }
  try {
    local?.addLease(file);
  } catch (error) {
    let held: ReturnType<LocalLedger["getLease"]> | undefined;
    try {
      held = local!.getLease(file.lease_id);
    } catch {}
    if (held === null) {
      const zero: CloseFile = { schema: 1, kind: "close", item: file.item, seq: file.seq, lease_id: file.lease_id, how: "settled", spent_micros: 0, unknown_micros: 0, unknown_calls: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 }, closed_at: now.toISOString() };
      if (typeof write(record, zero, "E_LEASE_UNSETTLED") !== "object") {
        throw new LedgerError("E_LEDGER_PATH", "lease " + file.lease_id + " was recorded, but the local ledger " + local!.path + " could not hold it (" + (error as Error).message + "); no call can spend against it, so it is closed at $0. Fix the local ledger and lease again. The new lease takes slot " + (file.seq + 1) + ", so on an item with --admission required it needs an admission record for that slot.");
      }
    }
    if (!held || JSON.stringify(held.file) !== JSON.stringify(file)) {
      throw new LedgerError("E_LEASE_UNSETTLED", "lease " + file.lease_id + " is in the approval record, but the local ledger " + local!.path + " failed while adding it (" + (error as Error).message + "); settle it on this machine once its ledger works, or the owner reconciles it after it expires at " + file.expires_at);
    }
  }
  return toLease(file, "open");
}

/** Finds a lease in the record by id: the id is <item>.<slot>.<suffix>. */
function findLease(record: string, lease_id: string): { state: ItemState; lease: LeaseFile; close: CloseFile | null } {
  const item = lease_id.replace(/\.\d{4}\.[0-9a-f]{6}$/, "");
  const state = ITEM_NAME.test(item) && item !== lease_id ? read(record, item) : null;
  const entry = state?.leases.find((l) => l.lease.lease_id === lease_id);
  if (!state || !entry) throw new LedgerError("E_LEASE_UNSETTLED", "no lease " + lease_id + " in the approval record " + record + "; check --ledger-record");
  return { state, ...entry };
}

/** The lease export for a sealed workflow that cannot reach the record: the open lease's file, passed as a dispatch input. */
export function exportLease(record: string, lease_id: string): LeaseFile {
  const { lease, close } = findLease(record, lease_id);
  if (close) throw new LedgerError("E_LEASE_CLOSED", "lease " + lease_id + " is already " + closeText(close));
  return lease;
}

/** Warns with LEASE_OVERSPENT when a close holds more than its lease reserved, which a call billed above its reservation causes. */
function warnOverspent(lease: LeaseFile, close: CloseFile, warn?: (code: ReasonCode, message: string) => void): void {
  const held = close.spent_micros + close.unknown_micros;
  if (held > lease.reserved_micros) warn?.("LEASE_OVERSPENT", "lease " + lease.lease_id + " closes at " + usd(held) + ", above the " + usd(lease.reserved_micros) + " it reserved: a provider billed a call above its reservation, and the close records the real spend");
}

/**
 * Closes a lease from this machine's local ledger into the record. Idempotent by lease id: a retry writes the same
 * bytes. With record null, for a workflow that cannot reach the record, it only returns the close as the settle artifact.
 * A close above the lease's amount is recorded as it is, with a LEASE_OVERSPENT warning.
 */
export function settleLease(record: string | null, local: LocalLedger, lease_id: string, warn?: (code: ReasonCode, message: string) => void): CloseFile {
  if (record !== null) {
    const { close: prior } = findLease(record, lease_id);
    if (prior && !local.getLease(lease_id)) return prior;
  }
  const close = local.stageClose(lease_id);
  warnOverspent(local.getLease(lease_id)!.file, close, warn);
  if (record === null) return close;
  const result = write(record, close, "E_LEASE_UNSETTLED");
  if (typeof result === "object") throw new LedgerError("E_SETTLE_CONFLICT", "lease " + lease_id + " is already " + closeText(result.conflict as CloseFile) + " in the approval record; this settle says " + closeText(close));
  local.markClosed(lease_id, "settled");
  return close;
}

const SETTLED_KEYS = "closed_at,how,item,kind,lease_id,schema,seq,spent_micros,unknown_calls,unknown_micros,usage";
const USAGE_KEYS = "cache_read,cache_write,input,output,reasoning";
const keysOf = (o: object | null) => (o === null || typeof o !== "object" ? "" : Object.keys(o).sort().join());

/**
 * Copies a sealed workflow's settle artifact into the record. Idempotent: the same artifact again is present. The record
 * is write-once, so only the exact shape a local ledger stages is accepted, holding no more unknown charge than the lease
 * reserved. Spend above the lease, from a call billed above its reservation, is recorded with a LEASE_OVERSPENT warning.
 */
export function importSettlement(record: string, close: unknown, warn?: (code: ReasonCode, message: string) => void): CloseFile {
  if (!isRecordFile(close) || close.kind !== "close") throw new LedgerError("E_USAGE", "the settle artifact is not a lease close");
  const { lease, close: prior } = findLease(record, close.lease_id);
  const usage = close.usage as Record<string, unknown> | null;
  const shaped = keysOf(close) === SETTLED_KEYS && isTime(close.closed_at) && keysOf(usage) === USAGE_KEYS && Object.values(usage!).every(isMicros);
  if (!shaped || close.how !== "settled" || close.item !== lease.item || close.seq !== lease.seq || close.unknown_micros > lease.reserved_micros) {
    throw new LedgerError("E_USAGE", "the settle artifact for " + close.lease_id + " is not a settled close of the lease in the approval record " + record + " with at most its " + usd(lease.reserved_micros) + " held for unknown calls");
  }
  if (prior && JSON.stringify(prior) !== JSON.stringify(close)) throw new LedgerError("E_SETTLE_CONFLICT", "lease " + close.lease_id + " is already " + closeText(prior) + "; the artifact says " + closeText(close));
  const result = write(record, close, "E_LEASE_UNSETTLED");
  if (typeof result === "object") throw new LedgerError("E_SETTLE_CONFLICT", "lease " + close.lease_id + " is already " + closeText(result.conflict as CloseFile) + "; the artifact says " + closeText(close));
  warnOverspent(lease, close, warn);
  return close;
}

/**
 * The owner's settlement of a lease whose machine or local ledger is gone: their figure, their words and the provider
 * usage export it came from, with its sha256. Until it is recorded the lease's whole amount stays committed. It waits
 * until the lease has expired, so a machine that comes back cannot spend beside a replacement worker.
 */
export function reconcileLease(record: string, r: { lease_id: string; spent_micros: number; quotes: Quote[]; source: string; now?: Date }): CloseFile {
  checkQuotes(r.quotes);
  if (!isMicros(r.spent_micros)) throw new LedgerError("E_USAGE", "--spent must be an amount of dollars");
  let source_sha256: string;
  try {
    source_sha256 = createHash("sha256").update(readFileSync(r.source)).digest("hex");
  } catch (error) {
    throw new LedgerError("E_USAGE", "--source must be the provider usage export file the owner settled from: " + (error as Error).message);
  }
  const { lease, close: prior } = findLease(record, r.lease_id);
  if (prior?.how === "reconciled" && prior.spent_micros === r.spent_micros && prior.source_sha256 === source_sha256 && sameQuotes(prior.quotes, r.quotes)) return prior;
  const now = r.now ?? new Date();
  if (!prior && now < new Date(lease.expires_at)) {
    throw new LedgerError("E_LEASE_UNSETTLED", "lease " + r.lease_id + " can still admit calls on machine " + lease.machine_id + " until " + lease.expires_at + "; settle it there, or reconcile it after it expires");
  }
  const close: CloseFile = {
    schema: 1,
    kind: "close",
    item: lease.item,
    seq: lease.seq,
    lease_id: r.lease_id,
    how: "reconciled",
    spent_micros: r.spent_micros,
    unknown_micros: 0,
    unknown_calls: 0,
    usage: null,
    closed_at: now.toISOString(),
    quotes: r.quotes,
    source: r.source,
    source_sha256,
  };
  const result = prior ? { conflict: prior } : write(record, close);
  if (typeof result === "object") throw new LedgerError("E_SETTLE_CONFLICT", "lease " + r.lease_id + " is already " + closeText(result.conflict as CloseFile) + "; this reconcile says " + closeText(close));
  return close;
}

export interface ItemStatus {
  item: string;
  cap_micros: number | null;
  admission: Admission | null;
  committed_micros: number;
  left_micros: number;
  run_id: string | null;
  open_lease: Lease | null;
  leases: number;
  approval: ApprovalFile | null;
}

/** Every line item in the record, or only the one named, so a damaged item elsewhere does not hide it. */
export function ledgerStatus(record: string, only?: string): ItemStatus[] {
  return listItems(record).filter((item) => only === undefined || item === only).map((item) => {
    const s = read(record, item);
    return {
      item,
      cap_micros: s.cap_micros,
      admission: s.admission,
      committed_micros: s.committed_micros,
      left_micros: (s.cap_micros ?? 0) - s.committed_micros,
      run_id: s.run_id,
      open_lease: s.open && toLease(s.open, "open"),
      leases: s.leases.length,
      approval: s.approvals.at(-1) ?? null,
    };
  });
}
