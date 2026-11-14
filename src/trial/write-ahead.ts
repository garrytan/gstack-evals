// Copyright (c) 2026 Garry Tan. MIT License.
// The write-ahead copy for a metering proxy that runs apart from the evaluator, such as the proxy container: a reserve is
// answered only once the evaluator's write-ahead relay acknowledges its line over a unix socket in the proxy's mounted
// directory, so the off-host copy covers this proxy's reserves as it covers the evaluator's own. A relay that does not
// answer 200 makes reserve throw, so the proxy refuses the call with E_LEDGER_UNAVAILABLE and sends nothing, and
// reconcileJournal later releases the hold at $0. Outcomes are copied too, best effort, as reconciliation evidence.
// Off by default: proxy-entry.ts wraps its ledger only when its config names write_ahead_socket.
import type { ReservationLedger } from "../types.ts";

export const WRITE_AHEAD_ROUTE = "/append";

type Send = (url: string, init: RequestInit & { unix?: string }) => Promise<Response>;

export function relayedLedger(inner: ReservationLedger, socket: string, send: Send = (url, init) => fetch(url, init)): ReservationLedger {
  const post = async (entry: Record<string, unknown>) => {
    const res = await send("http://localhost" + WRITE_AHEAD_ROUTE, { unix: socket, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry) });
    if (res.status !== 200) throw new Error("the write-ahead relay answered " + res.status + ": " + (await res.text()).slice(0, 200));
  };
  return {
    async reserve(req) {
      const reply = await inner.reserve(req);
      if (!reply.ok) return reply;
      await post({ kind: "reserve", idempotency_key: req.idempotency_key, lease_id: req.lease_id, cell: req.cell, max_micros: req.max_micros, reservation_id: reply.reservation.reservation_id });
      return reply;
    },
    async settle(rid, outcome) {
      const reply = await inner.settle(rid, outcome);
      try {
        if (reply.ok) await post({ kind: "outcome", reservation_id: rid, outcome });
      } catch {}
      return reply;
    },
  };
}
