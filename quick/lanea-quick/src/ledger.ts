import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { dirname } from "node:path";

export class CapStop extends Error {
  constructor(public settled: number, public open: number, public want: number, public cap: number) {
    super(`STOP: reason=budget_exhausted spent=${settled.toFixed(4)} reserved=${open.toFixed(4)} want=${want.toFixed(4)} cap=${cap}`);
  }
}

export interface Approval {
  words: string[];
  by: string;
  source: string;
}

const text = (x: unknown) => typeof x === "string" && x.trim().length > 0;
const amount = (usd: number) => {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`E_LEDGER_AMOUNT: ${usd} is not a finite, non-negative amount`);
};

const readLock = (lock: string): { pid?: number; host?: string; started?: string; token?: string } | null => {
  try {
    return JSON.parse(readFileSync(lock, "utf8"));
  } catch {
    return null;
  }
};

// One runner per path: an exclusive lock file beside it, taken before the path is read. A held lock is never replaced,
// even when its pid looks dead here: the ledger sits on a drive that several machines mount, machines restored from one
// snapshot share hostname and boot id, and a pid dead here may be alive on the machine that wrote the lock. Remove a
// lock by hand once its runner has ended. The release removes the lock only while it is still this runner's.
export function lockLedger(path: string): () => void {
  const lock = `${path}.lock`;
  const me = { pid: process.pid, host: hostname(), started: new Date().toISOString(), token: randomBytes(12).toString("hex") };
  mkdirSync(dirname(lock), { recursive: true });
  try {
    const fd = openSync(lock, "wx");
    writeSync(fd, JSON.stringify(me));
    closeSync(fd);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const held = readLock(lock) ?? {};
    throw new Error(`E_LOCK: ${lock} is held by pid ${held.pid ?? "unknown"} on ${held.host ?? "an unknown host"} since ${held.started ?? "an unknown time"}; remove it by hand only once that runner has ended`);
  }
  return () => {
    if (readLock(lock)?.token === me.token) rmSync(lock, { force: true });
  };
}

export class Ledger {
  private settled = 0;
  private open = new Map<string, number>();
  private settledIds = new Set<string>();
  private approved = false;
  private first: any = null;
  private closed: any = null;

  constructor(private path: string, private cap: number, private item: string, private mirror?: string, private fake = false) {
    mkdirSync(dirname(path), { recursive: true });
    this.load();
  }

  private load() {
    this.settled = 0;
    this.open.clear();
    this.settledIds.clear();
    this.approved = false;
    this.first = null;
    this.closed = null;
    if (!existsSync(this.path)) return;
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (!this.first) {
        this.first = row;
        this.approved = row.type === "approval" && this.valid(row);
      }
      if (row.type === "close") this.closed ??= row;
      if (this.settledIds.has(row.reservation_id)) continue;
      if (row.type === "reserve") this.open.set(row.reservation_id, row.usd);
      if (row.type === "settle") {
        this.open.delete(row.reservation_id);
        this.settledIds.add(row.reservation_id);
        this.settled += row.usd;
      }
    }
  }

  private valid(row: any): boolean {
    return Array.isArray(row.words) && row.words.length > 0 && row.words.every(text) && text(row.by) && text(row.source) && row.cap_usd === this.cap && row.item === this.item && (this.fake || (!row.fake && row.source !== "none"));
  }

  private append(row: Record<string, unknown>) {
    const line = JSON.stringify({ ts: new Date().toISOString(), item: this.item, ...row }) + "\n";
    appendFileSync(this.path, line);
    if (this.mirror) appendFileSync(this.mirror, line);
  }

  hasApproval(): boolean {
    this.load();
    return this.approved;
  }

  approve(a: Approval) {
    const row = { type: "approval", item: this.item, cap_usd: this.cap, words: a.words, by: a.by, source: a.source, ...(this.fake ? { fake: true } : {}) };
    if (!this.valid(row)) throw new Error("E_APPROVAL: approve needs --words (one or more), --by and --source");
    if (this.hasApproval()) return;
    if (existsSync(this.path) && readFileSync(this.path, "utf8").trim()) throw new Error(`E_APPROVAL: the approval must be the first row of ${this.path}, which already has rows`);
    this.append(row);
  }

  totals() {
    const open = [...this.open.values()].reduce((x, y) => x + y, 0);
    return { settled: this.settled, open, remaining: this.closed ? 0 : this.cap - this.settled - open, cap: this.cap, unsettled: [...this.open.keys()] };
  }

  assertOpen() {
    this.load();
    if (!this.approved) {
      const f = this.first?.type === "approval" ? `; its first row approves item ${this.first.item} at cap_usd ${this.first.cap_usd}` : "";
      throw new Error(`E_LEDGER_MISSING: ${this.path} has no first-row approval for item ${this.item} at cap_usd ${this.cap}${f}`);
    }
    if (this.closed) throw new Error(`E_LEDGER_CLOSED: ${this.path} is closed: ${this.closed.reason ?? "no reason given"}${this.closed.to_item ? `; its unspent money moved to ${this.closed.to_item}` : ""}`);
  }

  reserve(id: string, usd: number, meta: Record<string, unknown>) {
    amount(usd);
    this.assertOpen();
    const t = this.totals();
    if (t.settled + t.open + usd > this.cap + 1e-9) throw new CapStop(t.settled, t.open, usd, this.cap);
    this.open.set(id, usd);
    this.append({ type: "reserve", reservation_id: id, usd, ...meta });
  }

  settleStale(note: string) {
    this.load();
    for (const [id, usd] of [...this.open.entries()]) this.settle(id, usd, { stale: true, note });
  }

  settle(id: string, usd: number, meta: Record<string, unknown>) {
    amount(usd);
    this.load();
    if (this.settledIds.has(id)) return;
    this.open.delete(id);
    this.settledIds.add(id);
    this.settled += usd;
    this.append({ type: "settle", reservation_id: id, usd, ...meta });
  }
}

// Reserves for parallel workers in the order they ask. A reservation that fails only because this runner's own
// reservations are still open waits for one to settle. One that would pass the cap on settled spend alone, or with
// nothing of ours open, is the cap stop.
export class Reserver {
  readonly open = new Map<string, number>();
  stopped: string | null = null;
  private halted = false;
  private gate: Promise<void> = Promise.resolve();
  private wake = () => {};

  constructor(private ledger: Ledger) {}

  async reserve(id: string, usd: number, meta: Record<string, unknown>): Promise<boolean> {
    const prev = this.gate;
    let done!: () => void;
    this.gate = new Promise((r) => (done = r));
    await prev;
    try {
      while (!this.halted) {
        try {
          this.ledger.reserve(id, usd, meta);
          this.open.set(id, usd);
          return true;
        } catch (e) {
          if (!(e instanceof CapStop)) throw e;
          if (this.open.size === 0 || e.settled + e.want > e.cap + 1e-9) {
            this.stop(e.message);
            return false;
          }
          await new Promise<void>((r) => (this.wake = r));
        }
      }
      return false;
    } finally {
      done();
    }
  }

  settle(id: string, usd: number, meta: Record<string, unknown>) {
    this.ledger.settle(id, usd, meta);
    this.open.delete(id);
    this.wake();
  }

  stop(reason: string) {
    this.stopped ??= reason;
    this.halt();
  }

  halt() {
    this.halted = true;
    this.wake();
  }
}
