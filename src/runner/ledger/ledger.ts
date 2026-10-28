// The budget ledger's operations across its two tiers (plan v3.2, "Admission without a shared lock"). An approval
// records a line item's cap with the owner's words. A run leases the item: the first lease binds the item to that run,
// and a new lease waits until the previous one is settled or reconciled. The local ledger holds a lease's calls against
// its amount, and the lease closes into the approval record. Nothing here releases an allowance whose spend is unknown.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import type { ReasonCode } from "../../errors/codes.ts";
import type { Lease } from "../../types.ts";
import type { LocalLedger } from "./local.ts";
import { isMicros, usd } from "./money.ts";
import { ITEM_NAME, LedgerError, listItems, readItem, writeOnce, type ApprovalFile, type CloseFile, type ItemState, type LeaseFile, type Quote, type RecordFile } from "./record.ts";

export const DEFAULT_LEASE_TTL_MS = 24 * 60 * 60 * 1000;
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

/** Records a line item's first cap (init) or a higher one (raise). Retrying the same approval returns the recorded one. */
export function recordApproval(record: string, a: { action: "init" | "raise"; item: string; cap_micros: number; quotes: Quote[]; now?: Date }): ApprovalFile {
  if (!ITEM_NAME.test(a.item)) throw new LedgerError("E_USAGE", "line item " + JSON.stringify(a.item) + " must match " + ITEM_NAME);
  if (!isMicros(a.cap_micros) || a.cap_micros === 0) throw new LedgerError("E_USAGE", "a cap must be a positive amount of dollars");
  checkQuotes(a.quotes);
  const state = read(record, a.item);
  const last = state.approvals.at(-1);
  if (last && last.action === a.action && last.cap_micros === a.cap_micros && sameQuotes(last.quotes, a.quotes)) return last;
  if (a.action === "init" && last) throw new LedgerError("E_USAGE", "line item " + a.item + " already has an approved cap of " + usd(last.cap_micros) + "; record a higher one with gstack-evals ledger raise");
  if (a.action === "raise" && !last) throw new LedgerError("E_LEDGER_MISSING", "line item " + a.item + " has no approved cap to raise in " + record + "; " + ESCALATE);
  if (last && a.cap_micros <= last.cap_micros) throw new LedgerError("E_USAGE", "raise records a higher cap; line item " + a.item + " is already at " + usd(last.cap_micros));
  const file: ApprovalFile = { schema: 1, kind: "approval", item: a.item, seq: state.approvals.length + 1, action: a.action, cap_micros: a.cap_micros, quotes: a.quotes, recorded_at: (a.now ?? new Date()).toISOString() };
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
  /** The holder: this machine by default. */
  machine_id?: string;
  /** Defaults to everything the line item has left. */
  amount_micros?: number;
  ttl_ms?: number;
  now?: Date;
  /** Seam for GSTA-8's admission check (U20), not built yet: runs after the item admits the run and before the lease is written. */
  admission?: (lease: LeaseFile, item: ItemState) => { code: ReasonCode; message: string } | null;
}

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
    expires_at: new Date(now.getTime() + (req.ttl_ms ?? DEFAULT_LEASE_TTL_MS)).toISOString(),
    created_at: now.toISOString(),
  };
  const refusal = req.admission?.(file, state);
  if (refusal) throw new LedgerError(refusal.code, refusal.message);
  if (typeof write(record, file) === "object") {
    admit(record, read(record, req.item), req.run_id);
    throw new LedgerError("E_LEASE_UNSETTLED", "another lease on line item " + req.item + " was written at the same moment; read gstack-evals ledger status");
  }
  local?.addLease(file);
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

/** Closes a lease from this machine's local ledger into the record. Idempotent by lease id: a retry writes the same bytes. */
export function settleLease(record: string, local: LocalLedger, lease_id: string): CloseFile {
  findLease(record, lease_id);
  const close = local.stageClose(lease_id);
  const result = write(record, close, "E_LEASE_UNSETTLED");
  if (typeof result === "object") throw new LedgerError("E_SETTLE_CONFLICT", "lease " + lease_id + " is already " + closeText(result.conflict as CloseFile) + " in the approval record; this settle says " + closeText(close));
  local.markClosed(lease_id, "settled");
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
  if (prior?.how === "reconciled" && prior.spent_micros === r.spent_micros && prior.source === r.source && prior.source_sha256 === source_sha256 && sameQuotes(prior.quotes, r.quotes)) return prior;
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
  committed_micros: number;
  left_micros: number;
  run_id: string | null;
  open_lease: Lease | null;
  leases: number;
  approval: ApprovalFile | null;
}

export function ledgerStatus(record: string): ItemStatus[] {
  return listItems(record).map((item) => {
    const s = read(record, item);
    return {
      item,
      cap_micros: s.cap_micros,
      committed_micros: s.committed_micros,
      left_micros: (s.cap_micros ?? 0) - s.committed_micros,
      run_id: s.run_id,
      open_lease: s.open && toLease(s.open, "open"),
      leases: s.leases.length,
      approval: s.approvals.at(-1) ?? null,
    };
  });
}
