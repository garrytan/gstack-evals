// The approval record, the ledger's append-only tier (plan v3.2, "Where the ledger lives"). Each approval, lease and
// lease close is a write-once JSON file at <record>/items/<item>/<kind>-<slot>.json, read back after it is written, and
// totals are sums over the files. The record may sit on a Capy drive, which has no atomic write, so each line item
// admits one run. Within one host each slot has one winner: a second writer of the same slot finds the first file and
// refuses. Across hosts that holds only where the file system gives exclusive create to every host; on a drive that
// syncs files between machines, two hosts writing one slot at the same moment can both succeed, which is why an item
// belongs to one run and a replacement worker waits for the previous lease to close.
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

export interface ApprovalFile extends Omit<Slot, "schema"> {
  /** 2 on an item that joins a program, so a reader from before program envelopes stops on it instead of leasing past the envelope. */
  schema: 1 | 2;
  kind: "approval";
  action: "init" | "raise";
  cap_micros: number;
  quotes: Quote[];
  /** On init only, and never changed after: whether a lease on the item needs an admission record (GSTA-8, decision 3). */
  admission?: Admission;
  /** On init only, and never changed after: the program envelope the item's leases are admitted against, and the skills whose lines share its spend evenly. */
  program?: string;
  skills?: string[];
  recorded_at: string;
}

export type Admission = "required" | "warn";

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
const MAX_SLOT = 9999;
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EMLINK"]);
const DIR_SYNC_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EBADF"]);

function checkItem(item: string): void {
  if (!ITEM_NAME.test(item)) throw new LedgerError("E_USAGE", "line item " + JSON.stringify(item) + " must match " + ITEM_NAME);
}

export const isTime = (text: unknown): boolean => typeof text === "string" && !Number.isNaN(Date.parse(text));

export function checkQuotes(quotes: Quote[]): void {
  if (quotes.length === 0 || quotes.some((q) => !q.words.trim() || !q.by.trim() || !q.source.trim())) {
    throw new LedgerError("E_USAGE", "every approval and reconcile needs the owner's exact words (--words), who said them (--by) and where (--source)");
  }
}

/** A non-empty list of distinct skill names, each shaped like a line item name. */
export const isSkillList = (skills: unknown): skills is string[] => Array.isArray(skills) && skills.length > 0 && skills.every((s) => typeof s === "string" && ITEM_NAME.test(s)) && new Set(skills).size === skills.length;

export const slotPath = (record: string, f: { kind: string; item: string; seq: number }) => join(record, "items", f.item, f.kind + "-" + String(f.seq).padStart(4, "0") + ".json");

/** Writes a record file once into its slot; see claimSlot. */
export function writeOnce(record: string, file: RecordFile): "written" | "present" | { conflict: RecordFile } {
  checkItem(file.item);
  if (file.seq > MAX_SLOT) throw new LedgerError("E_LEDGER_RECORD", "line item " + file.item + " has used all " + MAX_SLOT + " " + file.kind + " slots in " + record);
  const path = slotPath(record, file);
  const result = claimSlot(path, JSON.stringify(file, null, 2) + "\n");
  return typeof result === "object" ? { conflict: parseFile(path, result.held) } : result;
}

/**
 * Claims a write-once slot. A file already in the slot with the same bytes is "present", so a retried write is
 * idempotent; one with other bytes is returned as held. The file appears whole: it is written and fsynced aside, then
 * linked into place, which fails when the slot is taken. Where links are unsupported it is created exclusively instead.
 * The directory entries are fsynced before the write is acknowledged, new directories included, and again when a retry
 * finds its own bytes already there.
 */
export function claimSlot(path: string, text: string): "written" | "present" | { held: string } {
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
  syncDir(dir);
  syncDir(dirname(dir));
  const back = readFileSync(path, "utf8");
  if (back === text) return created ? "written" : "present";
  if (created) throw new Error("the read-back of " + path + " does not match what was written");
  return { held: back };
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

/** The shape checks every record file passes, also applied to a lease export or settle artifact before it is used. */
export function isRecordFile(f: unknown): f is RecordFile {
  const r = f as RecordFile | null;
  if (typeof r !== "object" || r === null || (r.schema !== 1 && !(r.kind === "approval" && r.schema === 2)) || typeof r.item !== "string" || !ITEM_NAME.test(r.item) || !Number.isSafeInteger(r.seq)) return false;
  if (r.kind === "approval") {
    const member = r.program === undefined ? r.skills === undefined && r.schema === 1 : r.schema === 2 && r.action === "init" && ITEM_NAME.test(r.program) && isSkillList(r.skills);
    return isMicros(r.cap_micros) && Array.isArray(r.quotes) && r.quotes.length > 0 && (r.action === "init" ? r.admission === "required" || r.admission === "warn" : r.admission === undefined) && member;
  }
  if (r.kind === "lease") return isMicros(r.reserved_micros) && typeof r.lease_id === "string" && typeof r.run_id === "string" && isTime(r.expires_at);
  return r.kind === "close" && isMicros(r.spent_micros) && isMicros(r.unknown_micros) && isMicros(r.unknown_calls) && typeof r.lease_id === "string";
}

function parseFile(path: string, text: string): RecordFile {
  const name = FILE.exec(basename(path));
  let f: unknown = null;
  try {
    f = JSON.parse(text);
  } catch {}
  if (name === null || !isRecordFile(f) || f.kind !== name[1] || f.seq !== Number(name[2]) || f.item !== basename(dirname(path))) {
    throw new LedgerError("E_LEDGER_RECORD", "the approval record file " + path + " does not parse as a ledger file; repair it by hand, never delete it");
  }
  return f;
}

export interface ItemState {
  item: string;
  approvals: ApprovalFile[];
  leases: { lease: LeaseFile; close: CloseFile | null }[];
  /** The latest approved cap, or null when none is on record. */
  cap_micros: number | null;
  admission: Admission | null;
  /** The program envelope the item belongs to, and the skills its spend is split across, from its first approval. */
  program: string | null;
  skills: string[];
  /** Closed leases count what they spent; open leases count their whole reserved amount. */
  committed_micros: number;
  /** The run the item is bound to: the run of its first lease. */
  run_id: string | null;
  open: LeaseFile | null;
}

/** Reads one line item from the record. A missing slot in a sequence or a close that names another lease is an unreadable record. */
export function readItem(record: string, item: string): ItemState {
  checkItem(item);
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
    admission: approvals[0]?.admission ?? null,
    program: approvals[0]?.program ?? null,
    skills: approvals[0]?.skills ?? [],
    committed_micros: leases.reduce((sum, { lease, close }) => sum + (close ? close.spent_micros + close.unknown_micros : lease.reserved_micros), 0),
    run_id: leases[0]?.lease.run_id ?? null,
    open: leases.find((l) => l.close === null)?.lease ?? null,
  };
}

export function listItems(record: string): string[] {
  const dir = join(record, "items");
  return existsSync(dir) ? readdirSync(dir).filter((n) => ITEM_NAME.test(n)).sort() : [];
}
