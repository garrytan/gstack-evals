import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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

export class Ledger {
  private settled = 0;
  private open = new Map<string, number>();
  private settledIds = new Set<string>();

  constructor(private path: string, private cap: number, private item: string, private mirror?: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.type === "reserve") this.open.set(row.reservation_id, row.usd);
      if (row.type === "settle") {
        this.open.delete(row.reservation_id);
        this.settledIds.add(row.reservation_id);
        this.settled += row.usd;
      }
    }
  }

  private append(row: Record<string, unknown>) {
    const line = JSON.stringify({ ts: new Date().toISOString(), item: this.item, ...row }) + "\n";
    appendFileSync(this.path, line);
    if (this.mirror) appendFileSync(this.mirror, line);
  }

  hasApproval(): boolean {
    return existsSync(this.path) && readFileSync(this.path, "utf8").split("\n").some((l) => l.includes('"type":"approval"'));
  }

  approve(a: Approval) {
    if (this.hasApproval()) return;
    this.append({ type: "approval", cap_usd: this.cap, words: a.words, by: a.by, source: a.source });
  }

  totals() {
    const open = [...this.open.values()].reduce((x, y) => x + y, 0);
    return { settled: this.settled, open, remaining: this.cap - this.settled - open, cap: this.cap, unsettled: [...this.open.keys()] };
  }

  reserve(id: string, usd: number, meta: Record<string, unknown>) {
    if (!this.hasApproval()) throw new Error("E_LEDGER_MISSING: no approval row");
    const t = this.totals();
    if (t.settled + t.open + usd > this.cap + 1e-9) throw new CapStop(t.settled, t.open, usd, this.cap);
    this.open.set(id, usd);
    this.append({ type: "reserve", reservation_id: id, usd, ...meta });
  }

  settleStale(note: string) {
    for (const [id, usd] of [...this.open.entries()]) this.settle(id, usd, { stale: true, note });
  }

  settle(id: string, usd: number, meta: Record<string, unknown>) {
    if (this.settledIds.has(id)) return;
    this.open.delete(id);
    this.settledIds.add(id);
    this.settled += usd;
    this.append({ type: "settle", reservation_id: id, usd, ...meta });
  }
}
