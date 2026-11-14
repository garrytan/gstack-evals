// Copyright (c) 2026 Garry Tan. MIT License.
// Lease renewal (L7 with R2-13): main's ledger has no extension and one metering proxy serves one lease, so renewing an
// item means: stop admitting, drain every session bound to that proxy, stop the proxy, reconcile its journal, settle the
// lease, open its continuation under the same run id, start a new proxy and journal, and admit again. The controller
// renews when a third of the lease's time to live is left.
import type { LedgerItemId } from "../types.ts";
import { DEFAULT_TTL_MS, type MoneyController } from "./book.ts";
import type { LeaseInfo } from "./types.ts";

export function renewalDue(lease: LeaseInfo, now: Date): boolean {
  const start = Date.parse(lease.createdAt);
  const end = Date.parse(lease.expiresAt);
  return end - now.getTime() <= (end - start) / 3;
}

/** The proxy seam renewal drives: one proxy per paid item. */
export interface ProxyLife {
  /** Stops the item's proxy; its journal's lock drops with it. */
  stop(): void | Promise<void>;
  /** Reconciles the stopped proxy's journal into the local ledger (main's reconcileJournal), before the lease settles. */
  reconcile(): unknown | Promise<unknown>;
  /** Starts a new proxy and journal on the continuation lease. */
  start(lease: LeaseInfo): void | Promise<void>;
}

export async function renew(c: MoneyController, item: LedgerItemId, proxy: ProxyLife, ttlMs = DEFAULT_TTL_MS): Promise<LeaseInfo> {
  const old = c.lease(item);
  if (!old) throw new Error(item + " has no open lease to renew");
  await c.pause(item, "renewing lease " + old.leaseId + ": admissions wait until its continuation opens");
  try {
    await c.drained(item);
    await proxy.stop();
    await proxy.reconcile();
    if (!(await c.settleItem(item))) throw new Error(item + " still has work in flight after draining");
    const next = await c.openItem(item, ttlMs);
    await proxy.start(next);
    return next;
  } finally {
    await c.resume(item);
  }
}
