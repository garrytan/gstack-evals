// Append-only spend ledger for the Lane B quick look (line item laneb-quick).
// Money is integer micro-dollars. A reserve is idempotent by id; a second settle is refused.
import { appendFileSync, existsSync, readFileSync, mkdirSync, openSync, fsyncSync, closeSync } from "node:fs";
import { dirname } from "node:path";

export type Row = {
  ts: string;
  item: string;
  kind: "approval" | "reserve" | "settle" | "note";
  id: string;
  usd_micros: number;
  [k: string]: unknown;
};

export type Totals = { capMicros: number; settledMicros: number; openReservedMicros: number; openIds: string[] };

export const toMicros = (usd: number) => Math.round(usd * 1_000_000);
export const fromMicros = (m: number) => m / 1_000_000;

export function readRows(path: string): Row[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row);
}

// The cap is the newest approval row's: the first approval, or the latest raise (Ledger.raise) after it.
export function totals(rows: Row[]): Totals {
  const approval = rows.findLast((r) => r.kind === "approval");
  if (!approval) throw new Error("ledger has no approval row");
  const reserved = new Map<string, number>();
  const settled = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === "reserve") reserved.set(r.id, r.usd_micros);
    if (r.kind === "settle") settled.set(r.id, r.usd_micros);
  }
  let settledMicros = 0;
  for (const v of settled.values()) settledMicros += v;
  let openReservedMicros = 0;
  const openIds: string[] = [];
  for (const [id, v] of reserved) {
    if (settled.has(id)) continue;
    openReservedMicros += v;
    openIds.push(id);
  }
  return { capMicros: approval.usd_micros, settledMicros, openReservedMicros, openIds };
}

function appendDurable(path: string, row: Row) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n");
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } catch {} finally { closeSync(fd); }
}

export class Ledger {
  constructor(readonly path: string, readonly item: string) {}

  status() {
    return totals(readRows(this.path));
  }

  approve(capUsd: number, extra: Record<string, unknown>) {
    if (readRows(this.path).some((r) => r.kind === "approval")) throw new Error("approval row already present");
    appendDurable(this.path, { ...extra, ts: new Date().toISOString(), item: this.item, kind: "approval", id: "approval", usd_micros: toMicros(capUsd) });
  }

  // A cap raise the owner approved after the first approval: one more approval row, above the current cap.
  raise(capUsd: number, extra: Record<string, unknown>) {
    const rows = readRows(this.path), approvals = rows.filter((r) => r.kind === "approval");
    if (!approvals.length) throw new Error("ledger has no approval row to raise");
    const from = totals(rows).capMicros;
    if (toMicros(capUsd) <= from) throw new Error(`a raise to $${capUsd} is not above the current cap of $${fromMicros(from)}`);
    appendDurable(this.path, { ...extra, ts: new Date().toISOString(), item: this.item, kind: "approval", id: `raise-${approvals.length}`, usd_micros: toMicros(capUsd), raised_from_micros: from });
  }

  reserve(id: string, usdMicros: number, meta: Record<string, unknown> = {}): { ok: true; existing: boolean } | { ok: false; reason: string; totals: Totals } {
    const rows = readRows(this.path);
    const prior = rows.find((r) => r.kind === "reserve" && r.id === id);
    if (prior) {
      if (prior.usd_micros !== usdMicros) return { ok: false, reason: "reserve id reused with a different amount", totals: totals(rows) };
      return { ok: true, existing: true };
    }
    const t = totals(rows);
    if (t.settledMicros + t.openReservedMicros + usdMicros > t.capMicros) return { ok: false, reason: "cap", totals: t };
    appendDurable(this.path, { ...meta, ts: new Date().toISOString(), item: this.item, kind: "reserve", id, usd_micros: usdMicros });
    return { ok: true, existing: false };
  }

  settle(id: string, usdMicros: number, meta: Record<string, unknown> = {}): { ok: true } | { ok: false; reason: string } {
    const rows = readRows(this.path);
    const reserve = rows.find((r) => r.kind === "reserve" && r.id === id);
    if (!reserve) return { ok: false, reason: "no reserve for id" };
    if (rows.some((r) => r.kind === "settle" && r.id === id)) return { ok: false, reason: "already settled" };
    appendDurable(this.path, { ...meta, ts: new Date().toISOString(), item: this.item, kind: "settle", id, usd_micros: usdMicros, reserved_micros: reserve.usd_micros, over_reserve: usdMicros > reserve.usd_micros });
    return { ok: true };
  }
}

// Settles every open reserve under prefix whose session has a row in the proxy's sessions file, at that row's spend.
// The proxy writes the row once the session's spend is final and before it calls the ledger, so the row is the amount
// a failed settle would have written. Reserves with no row stay open and are listed: they keep counting at their full
// amount against the cap.
export function reconcile(ledger: Ledger, sessionRows: Record<string, any>[], prefix: string) {
  const rows = new Map(sessionRows.filter((r) => r.closed_at && Number.isInteger(r.spent_micros) && r.spent_micros >= 0).map((r) => [prefix + r.id, r]));
  const settled: { id: string; usd_micros: number }[] = [];
  const leftOpen: string[] = [];
  for (const id of ledger.status().openIds) {
    if (!id.startsWith(prefix)) continue;
    const row = rows.get(id);
    if (!row) { leftOpen.push(id); continue; }
    const out = ledger.settle(id, row.spent_micros, { trial: row.trial, model: row.model, usage: row.usage, requests: row.requests, refused: row.refused, close_reason: row.close_reason, reconciled: true });
    if (out.ok) settled.push({ id, usd_micros: row.spent_micros });
    else leftOpen.push(id);
  }
  return { settled, leftOpen };
}

// Service mode: bun ledger.ts serve --path <jsonl> --item <name> [--port 9911]
// Binds 127.0.0.1 only. The VM reaches it through an SSH reverse tunnel.
async function serve(args: Record<string, string>) {
  const ledger = new Ledger(args.path, args.item);
  ledger.status();
  const port = Number(args.port ?? 9911);
  let queue = Promise.resolve();
  const serial = <T>(fn: () => T) => {
    const next = queue.then(fn);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/status") return Response.json(ledger.status());
      if (req.method !== "POST") return new Response("not found", { status: 404 });
      const body = (await req.json()) as { id: string; usd_micros: number; meta?: Record<string, unknown> };
      if (typeof body.id !== "string" || !Number.isInteger(body.usd_micros) || body.usd_micros < 0) return Response.json({ ok: false, reason: "bad request" }, { status: 400 });
      if (url.pathname === "/reserve") {
        const out = await serial(() => ledger.reserve(body.id, body.usd_micros, body.meta ?? {}));
        return Response.json(out, { status: out.ok ? 200 : 409 });
      }
      if (url.pathname === "/settle") {
        const out = await serial(() => ledger.settle(body.id, body.usd_micros, body.meta ?? {}));
        return Response.json(out, { status: out.ok ? 200 : 409 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  console.log(`ledger: serving ${args.item} on 127.0.0.1:${port}`);
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
  return out;
}

if (import.meta.main) {
  const [cmd, ...rest] = Bun.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === "serve") await serve(args);
  else if (cmd === "reconcile") {
    if (!args.sessions || args.prefix === undefined) {
      console.error("E_USAGE usage: bun ledger.ts reconcile --path <jsonl> --item <name> --sessions <proxy-sessions.jsonl> --prefix <ledger prefix>");
      process.exit(2);
    }
    const out = reconcile(new Ledger(args.path, args.item), readRows(args.sessions) as any[], args.prefix);
    console.log(JSON.stringify({ settled: out.settled.length, settled_usd: fromMicros(out.settled.reduce((x, r) => x + r.usd_micros, 0)), left_open: out.leftOpen }));
  } else if (cmd === "reserve" || cmd === "settle") {
    // One-off reserves such as launch.sh's first VM block: unlike the class, the CLI refuses an id the item already holds.
    if (!args.path || !args.item || !args.id || !/^\d+(\.\d+)?$/.test(args.usd ?? "")) {
      console.error(`E_USAGE usage: bun ledger.ts ${cmd} --path <jsonl> --item <name> --id <id> --usd <amount> [--detail <text>]`);
      process.exit(2);
    }
    const ledger = new Ledger(args.path, args.item);
    const meta = args.detail ? { kind_detail: args.detail } : {};
    const out = cmd === "reserve" ? ledger.reserve(args.id, toMicros(Number(args.usd)), meta) : ledger.settle(args.id, toMicros(Number(args.usd)), meta);
    const reused = "existing" in out && out.existing;
    console.log(JSON.stringify(reused ? { ok: false, reason: "id already reserved" } : out));
    process.exit(out.ok && !reused ? 0 : 3);
  } else if (cmd === "raise") {
    // A cap raise the owner approved, with its approver on the row.
    if (!args.path || !args.item || !args["approved-by"] || !/^\d+(\.\d+)?$/.test(args.usd ?? "")) {
      console.error("E_USAGE usage: bun ledger.ts raise --path <jsonl> --item <name> --usd <new cap> --approved-by <approver> [--detail <text>]");
      process.exit(2);
    }
    try {
      new Ledger(args.path, args.item).raise(Number(args.usd), { approved_by: args["approved-by"], ...(args.detail ? { detail: args.detail } : {}) });
    } catch (e) {
      console.log(JSON.stringify({ ok: false, reason: (e as Error).message }));
      process.exit(3);
    }
    console.log(JSON.stringify({ ok: true, cap_usd: fromMicros(new Ledger(args.path, args.item).status().capMicros) }));
  } else if (cmd === "open") {
    for (const id of new Ledger(args.path, args.item).status().openIds) console.log(id);
  } else if (cmd === "status") {
    const t = new Ledger(args.path, args.item).status();
    console.log(JSON.stringify({ cap_usd: fromMicros(t.capMicros), settled_usd: fromMicros(t.settledMicros), open_reserved_usd: fromMicros(t.openReservedMicros), open_ids: t.openIds.length }));
  } else {
    console.error("E_USAGE usage: bun ledger.ts serve|status|open|reconcile|reserve|settle|raise --path <jsonl> --item <name> [--port N] [--sessions <jsonl> --prefix <p>] [--id <id> --usd <amount>] [--approved-by <approver>]");
    process.exit(2);
  }
}
