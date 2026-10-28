// The approval record, the ledger's append-only tier (plan v3.2, "Where the ledger lives"). Each approval, lease and
// lease close is a write-once JSON file at <record>/items/<item>/<kind>-<slot>.json, read back after it is written, and
// totals are sums over the files. The record may sit on a Capy drive, which has no atomic write, so each line item
// admits one run, and each slot has one winner: a second writer of the same slot finds the first file and refuses.
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import type { TokenUsage } from "../../types.ts";
import { isMicros } from "./money.ts";

export class LedgerError extends Error {
  constructor(
    readonly code: ReasonCode,
    message: string,
  ) {
    super(message);
  }
}

/** One utterance of the owner's approval: their exact words, who said them, and the message or gate they came from. */
export interface Quote {
  words: string;
  by: string;
  source: string;
}

interface Slot {
  schema: 1;
  item: string;
  seq: number;
}

export interface ApprovalFile extends Slot {
  kind: "approval";
  action: "init" | "raise";
  cap_micros: number;
  quotes: Quote[];
  recorded_at: string;
}

export interface LeaseFile extends Slot {
  kind: "lease";
  lease_id: string;
  run_id: string;
  machine_id: string;
  reserved_micros: number;
  expires_at: string;
  created_at: string;
}

/** How a lease ended: settled from its local ledger, or reconciled by the owner when its machine or local ledger is gone. */
export interface CloseFile extends Slot {
  kind: "close";
  lease_id: string;
  how: "settled" | "reconciled";
  spent_micros: number;
  /** The full charge held for calls whose outcome is unknown; it counts as spent and is never released. */
  unknown_micros: number;
  unknown_calls: number;
  usage: TokenUsage | null;
  closed_at: string;
  /** Reconciled only: the owner's words and the provider usage export they settled from. */
  quotes?: Quote[];
  source?: string;
  source_sha256?: string;
}

export type RecordFile = ApprovalFile | LeaseFile | CloseFile;

export const ITEM_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FILE = /^(approval|lease|close)-(\d{4})\.json$/;
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EMLINK"]);
const DIR_SYNC_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EBADF"]);

export const slotPath = (record: string, f: { kind: string; item: string; seq: number }) => join(record, "items", f.item, f.kind + "-" + String(f.seq).padStart(4, "0") + ".json");

/** Test seam: runs after a record file is written and before it is read back. Production code never sets it. */
export const recordHooks: { afterWrite?: (path: string) => void } = {};

/**
 * Writes a record file once. A file already in the slot with the same bytes is "present", so a retried write is
 * idempotent; one with other bytes is a conflict. The file appears whole: it is written and fsynced aside, then linked
 * into place, which fails when the slot is taken. Where links are unsupported it is created exclusively instead. The
 * directory entries are fsynced before the write is acknowledged, new directories included.
 */
export function writeOnce(record: string, file: RecordFile): "written" | "present" | { conflict: RecordFile } {
  const path = slotPath(record, file);
  const text = JSON.stringify(file, null, 2) + "\n";
  const dir = dirname(path);
  const firstNew = mkdirSync(dir, { recursive: true });
  for (let d = dir; firstNew !== undefined; d = dirname(d)) {
    syncDir(dirname(d));
    if (d === firstNew) break;
  }
  const tmp = path + ".tmp-" + process.pid + "-" + randomBytes(4).toString("hex");
  let created = false;
  try {
    writeDurably(tmp, text);
    try {
      linkSync(tmp, path);
      created = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (code !== "EEXIST" && !LINK_UNSUPPORTED.has(code)) throw error;
      if (code !== "EEXIST") created = createExclusive(path, text);
    }
  } finally {
    rmSync(tmp, { force: true });
  }
  if (created) syncDir(dir);
  recordHooks.afterWrite?.(path);
  const back = readFileSync(path, "utf8");
  if (back === text) return created ? "written" : "present";
  if (created) throw new Error("the read-back of " + path + " does not match what was written");
  return { conflict: parseFile(path, back) };
}

function writeDurably(path: string, text: string): void {
  const fd = openSync(path, "wx");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function createExclusive(path: string, text: string): boolean {
  try {
    writeDurably(path, text);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** fsyncs a directory so a new entry in it survives a crash. File systems that cannot fsync a directory (some FUSE mounts) are skipped. */
function syncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } catch (error) {
    if (!DIR_SYNC_UNSUPPORTED.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
  } finally {
    closeSync(fd);
  }
}

function parseFile(path: string, text: string): RecordFile {
  const name = FILE.exec(basename(path));
  let f: RecordFile | null = null;
  try {
    f = JSON.parse(text);
  } catch {}
  const valid =
    name !== null &&
    f !== null &&
    f.schema === 1 &&
    f.kind === name[1] &&
    f.seq === Number(name[2]) &&
    f.item === basename(dirname(path)) &&
    (f.kind === "approval"
      ? isMicros(f.cap_micros) && Array.isArray(f.quotes) && f.quotes.length > 0
      : f.kind === "lease"
        ? isMicros(f.reserved_micros) && typeof f.lease_id === "string" && typeof f.run_id === "string"
        : isMicros(f.spent_micros) && isMicros(f.unknown_micros) && typeof f.lease_id === "string");
  if (!valid) throw new LedgerError("E_LEDGER_RECORD", "the approval record file " + path + " does not parse as a ledger file; repair it by hand, never delete it");
  return f!;
}

export interface ItemState {
  item: string;
  approvals: ApprovalFile[];
  leases: { lease: LeaseFile; close: CloseFile | null }[];
  /** The latest approved cap, or null when none is on record. */
  cap_micros: number | null;
  /** Closed leases count what they spent; open leases count their whole reserved amount. */
  committed_micros: number;
  /** The run the item is bound to: the run of its first lease. */
  run_id: string | null;
  open: LeaseFile | null;
}

/** Reads one line item from the record. A missing slot in a sequence or a close that names another lease is an unreadable record. */
export function readItem(record: string, item: string): ItemState {
  const dir = join(record, "items", item);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => FILE.test(n)).sort() : [];
  const files = names.map((n) => parseFile(join(dir, n), readFileSync(join(dir, n), "utf8")));
  const approvals = files.filter((f): f is ApprovalFile => f.kind === "approval");
  const leaseFiles = files.filter((f): f is LeaseFile => f.kind === "lease");
  const closes = new Map(files.filter((f): f is CloseFile => f.kind === "close").map((c) => [c.seq, c]));
  for (const list of [approvals, leaseFiles]) {
    list.forEach((f, i) => {
      if (f.seq !== i + 1) throw new LedgerError("E_LEDGER_RECORD", "the approval record for line item " + item + " in " + record + " is missing " + f.kind + " slot " + (i + 1));
    });
  }
  for (const c of closes.values()) {
    if (leaseFiles[c.seq - 1]?.lease_id !== c.lease_id) throw new LedgerError("E_LEDGER_RECORD", "the close in " + slotPath(record, c) + " names lease " + c.lease_id + ", which is not the lease in that slot");
  }
  const leases = leaseFiles.map((lease) => ({ lease, close: closes.get(lease.seq) ?? null }));
  return {
    item,
    approvals,
    leases,
    cap_micros: approvals.at(-1)?.cap_micros ?? null,
    committed_micros: leases.reduce((sum, { lease, close }) => sum + (close ? close.spent_micros + close.unknown_micros : lease.reserved_micros), 0),
    run_id: leases[0]?.lease.run_id ?? null,
    open: leases.find((l) => l.close === null)?.lease ?? null,
  };
}

export function listItems(record: string): string[] {
  const dir = join(record, "items");
  return existsSync(dir) ? readdirSync(dir).filter((n) => ITEM_NAME.test(n)).sort() : [];
}
