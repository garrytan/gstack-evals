// A driver run directory's sessions.jsonl, as the ledger's settle paths see it (GST-1433). The outcome-skills driver
// appends a line for each launch, session open and session close there, and admission counts each arm's calls of unknown
// cost from the close lines (unknownFromRun), so every path that closes a driver's lease closes the sessions it left open
// on that lease: the driver's own recovery, ledger settle --lease and ledger reconcile.
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LocalLedger } from "./local.ts";
import type { LeaseFile } from "./record.ts";

/** A close line's figures for one session. A reconciled close has no per-session spend, so it gives none. */
export interface SessionClose {
  spent_micros?: number;
  unknown_micros: number;
  unknown_calls: number;
}

/** Each session's figures as the local ledger holds them on the lease: its settled spend and its calls of unknown cost. */
export const meterFigures = (local: LocalLedger, lease_id: string): ((meter_id: string) => SessionClose) => {
  const meters = local.meters(lease_id);
  return (meter_id) => {
    const m = meters.get(meter_id);
    return { spent_micros: m?.spent_micros ?? 0, unknown_micros: m?.unknown_micros ?? 0, unknown_calls: m?.unknown_calls ?? 0 };
  };
};

/** True when the file's last byte is not a newline, as after a writer killed in the middle of a line. */
function cutShort(file: string): boolean {
  const size = statSync(file).size;
  if (size === 0) return false;
  const fd = openSync(file, "r");
  try {
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes a close line with the given reason for each session the lease holder's sessions.jsonl still shows open on the
 * lease, with figures(meter_id) as its figures, and returns how many it wrote. A retry writes only the lines still
 * missing. Returns null when the lease names no holder, its run directory's sessions.jsonl is not on this machine, or a
 * session is still open and no figures are given.
 */
export function closeOpenSessions(lease: LeaseFile, reason: string, figures: ((meter_id: string) => SessionClose) | null, at: Date): number | null {
  const file = lease.holder && join(lease.holder.dir, "sessions.jsonl");
  if (!file || !existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split("\n").flatMap((l) => {
    try {
      const e = JSON.parse(l) as { run_id?: unknown; event?: unknown; id?: unknown; lease_id?: unknown; meter_id?: unknown };
      return e && typeof e === "object" && e.run_id === lease.run_id ? [e] : [];
    } catch {
      return [];
    }
  });
  const closed = new Set(lines.flatMap((e) => (e.event === "close" && typeof e.id === "string" ? [e.id] : [])));
  const out: string[] = [];
  for (const e of lines) {
    if (e.event !== "open" || e.lease_id !== lease.lease_id || typeof e.id !== "string" || closed.has(e.id)) continue;
    closed.add(e.id);
    const meter_id = typeof e.meter_id === "string" ? e.meter_id : "";
    out.push(JSON.stringify({ at: at.toISOString(), run_id: lease.run_id, event: "close", item: lease.item, id: e.id, reason, lease_id: lease.lease_id, meter_id: e.meter_id, ...figures?.(meter_id) }) + "\n");
  }
  if (!out.length) return 0;
  if (!figures) return null;
  appendFileSync(file, (cutShort(file) ? "\n" : "") + out.join(""));
  return out.length;
}
