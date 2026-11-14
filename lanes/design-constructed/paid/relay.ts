// Copyright (c) 2026 Garry Tan. MIT License.
// The write-ahead relay (money open item 3): the controller's end of a session proxy's copy. A proxy that runs apart
// from the controller (the proxy container in src/trial/proxy-entry.ts) opens its own local ledger handle, so its
// reserves would not reach the controller's write-ahead copy. With write_ahead_socket set, the proxy posts each reserve
// to this relay on a unix socket in its mounted directory and answers the call only after a 200. The relay appends the
// line to the run's one WriteAhead and answers 200 only once the off-host target has acknowledged it, so a lost
// controller host can be reconciled from the off-host copy. The relay accepts only reserve and outcome lines on its own
// lease, rebuilt from their checked fields, so a proxy can never write admissions or book changes into the chain.
import { chmodSync, existsSync, rmSync } from "node:fs";
import { WRITE_AHEAD_ROUTE } from "../../../src/trial/write-ahead.ts";
import type { WriteAhead } from "../money/wal.ts";

export interface Relay {
  socket: string;
  /** Lines acknowledged off host. */
  acked(): number;
  stop(): void;
}

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;

/** The entry to append, rebuilt from checked fields, or the reason the line is refused. */
export function relayEntry(body: unknown, leaseId: string): Record<string, unknown> | string {
  if (!body || typeof body !== "object") return "the line is not a JSON object";
  const b = body as Record<string, any>;
  if (b.kind === "reserve") {
    if (!isText(b.idempotency_key) || !isText(b.reservation_id)) return "a reserve line needs its idempotency key and reservation id";
    if (b.lease_id !== leaseId) return "a reserve line on lease " + String(b.lease_id) + " reached the relay for lease " + leaseId;
    if (!Number.isSafeInteger(b.max_micros) || b.max_micros <= 0) return "a reserve line needs a positive whole max_micros";
    const c = b.cell;
    if (!c || typeof c !== "object" || !isText(c.run_id) || !isText(c.meter_id) || !isText(c.model) || !isText(c.task) || typeof c.arm !== "string" || !Number.isSafeInteger(c.trial) || !Number.isSafeInteger(c.attempt)) return "a reserve line needs its cell";
    const cell = { run_id: c.run_id, arm: c.arm, task: c.task, model: c.model, trial: c.trial, attempt: c.attempt, meter_id: c.meter_id };
    return { kind: "reserve", idempotency_key: b.idempotency_key, lease_id: b.lease_id, cell, max_micros: b.max_micros, reservation_id: b.reservation_id };
  }
  if (b.kind === "outcome") {
    if (!isText(b.reservation_id)) return "an outcome line needs its reservation id";
    const o = b.outcome;
    if (o?.kind === "unknown") return { kind: "outcome", reservation_id: b.reservation_id, outcome: { kind: "unknown" } };
    if (o?.kind !== "spent" || !Number.isSafeInteger(o.spent_micros) || o.spent_micros < 0 || !o.usage || typeof o.usage !== "object") return "an outcome line needs a spent or unknown outcome";
    const u = o.usage;
    const usage = Object.fromEntries(["input", "output", "reasoning", "cache_read", "cache_write"].map((k) => [k, Number.isSafeInteger(u[k]) ? u[k] : 0]));
    return { kind: "outcome", reservation_id: b.reservation_id, outcome: { kind: "spent", spent_micros: o.spent_micros, usage } };
  }
  return "the relay takes reserve and outcome lines only";
}

/** Serves one proxy's relay on a unix socket for one lease. */
export function serveWriteAhead(o: { wal: WriteAhead; socket: string; leaseId: string }): Relay {
  let acked = 0;
  if (existsSync(o.socket)) rmSync(o.socket);
  const server = Bun.serve({
    unix: o.socket,
    async fetch(req) {
      if (req.method !== "POST" || new URL(req.url).pathname !== WRITE_AHEAD_ROUTE) return new Response("no such route", { status: 404 });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response("the line is not JSON", { status: 400 });
      }
      const entry = relayEntry(body, o.leaseId);
      if (typeof entry === "string") return new Response(entry, { status: 400 });
      try {
        const line = await o.wal.append(entry);
        acked++;
        return Response.json({ seq: line.seq });
      } catch (e) {
        return new Response("not acknowledged off host: " + (e as Error).message, { status: 503 });
      }
    },
  });
  chmodSync(o.socket, 0o600);
  return {
    socket: o.socket,
    acked: () => acked,
    stop: () => {
      server.stop(true);
      rmSync(o.socket, { force: true });
    },
  };
}
