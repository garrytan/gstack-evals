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

const bootId = (): string => {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "";
  }
};

const readLock = (lock: string): { pid?: number; host?: string; boot?: string; token?: string } | null => {
  try {
    return JSON.parse(readFileSync(lock, "utf8"));
  } catch {
    return null;
  }
};

const pidAlive = (pid: unknown): boolean => {
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

// One runner per path: an exclusive lock file beside it, taken before the path is read. Machines are told apart by
// boot id, since every cloud machine can share one hostname. A lock left by a dead process from this boot is replaced
// under a second exclusive file, so two starters cannot both replace it; any other lock is refused. The release removes
// the lock only while it is still this runner's.
export function lockLedger(path: string): () => void {
  const lock = `${path}.lock`;
  const me = { pid: process.pid, host: hostname(), boot: bootId(), token: randomBytes(12).toString("hex") };
  mkdirSync(dirname(lock), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, JSON.stringify(me));
      closeSync(fd);
      return () => {
        if (readLock(lock)?.token === me.token) rmSync(lock, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const held = readLock(lock) ?? {};
    if (!me.boot || held.boot !== me.boot) throw new Error(`E_LOCK: ${lock} is held by pid ${held.pid} from another machine or boot (${held.host ?? "unknown host"}); remove it only once that runner is gone`);
    if (pidAlive(held.pid)) throw new Error(`E_LOCK: runner ${held.pid} is still running; one runner at a time, since a start settles open reserves as stale`);
    const takeover = `${lock}.takeover`;
    let fd: number;
    try {
      fd = openSync(takeover, "wx");
    } catch {
      throw new Error(`E_LOCK: another runner is replacing ${lock}; retry, or remove ${takeover} if no runner is starting`);
    }
    try {
      const now = readLock(lock);
      if (now && now.token === held.token && now.pid === held.pid && now.boot === held.boot) rmSync(lock, { force: true });
    } finally {
      closeSync(fd);
      rmSync(takeover, { force: true });
    }
  }
  throw new Error(`E_LOCK: could not take ${lock}`);
}

export class Ledger {
  private settled = 0;
  private open = new Map<string, number>();
  private settledIds = new Set<string>();
  private approved = false;

  constructor(private path: string, private cap: number, private item: string, private mirror?: string, private fake = false) {
    mkdirSync(dirname(path), { recursive: true });
    this.load();
  }

  private load() {
    this.settled = 0;
    this.open.clear();
    this.settledIds.clear();
    this.approved = false;
    if (!existsSync(this.path)) return;
    let first = true;
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (first && row.type === "approval" && this.valid(row)) this.approved = true;
      first = false;
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
    return Array.isArray(row.words) && row.words.length > 0 && row.words.every(text) && text(row.by) && text(row.source) && row.cap_usd === this.cap && (this.fake || (!row.fake && row.source !== "none"));
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
    const row = { type: "approval", cap_usd: this.cap, words: a.words, by: a.by, source: a.source, ...(this.fake ? { fake: true } : {}) };
    if (!this.valid(row)) throw new Error("E_APPROVAL: approve needs --words (one or more), --by and --source");
    if (this.hasApproval()) return;
    if (existsSync(this.path) && readFileSync(this.path, "utf8").trim()) throw new Error(`E_APPROVAL: the approval must be the first row of ${this.path}, which already has rows`);
    this.append(row);
  }

  totals() {
    const open = [...this.open.values()].reduce((x, y) => x + y, 0);
    return { settled: this.settled, open, remaining: this.cap - this.settled - open, cap: this.cap, unsettled: [...this.open.keys()] };
  }

  reserve(id: string, usd: number, meta: Record<string, unknown>) {
    amount(usd);
    if (!this.hasApproval()) throw new Error("E_LEDGER_MISSING: no approval row");
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

  // Settles every reservation still open at its full amount; one already settled in the ledger gets no second row.
  settleOpen(note: string) {
    for (const [id, usd] of this.open) this.ledger.settle(id, usd, { stale: true, note });
    this.open.clear();
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
