// Copyright (c) 2026 Garry Tan. MIT License.
// dc-hosts (plan section 5's table, L7, R2-3): the controller-held lease, each VM an atomic sub-reservation of its time
// to live at the Ubicloud list price passed in (read on the day), settled at measured hours; the host-hours projection
// per stage, printed before each stage, with a stage refused for the Captain when it doesn't fit; and the controller
// host's deletion during a wait over 12 hours with nothing in flight, after its leases settle and the off-host copy
// verifies, with relaunch from that copy.
import type { LedgerItemId } from "../types.ts";
import { dollars, type MoneyController } from "./book.ts";
import { takeSnapshot } from "./durability.ts";
import type { Admission, ItemFigures, OffHostTarget, Sub } from "./types.ts";
import type { WriteAhead } from "./wal.ts";

export const IDLE_DELETE_AFTER_HOURS = 12;

const reserveOf = (hours: number, priceMicrosPerHour: number) => Math.ceil(hours * priceMicrosPerHour);

/** One VM's time to live as one atomic sub-reservation on dc-hosts. */
export function admitVm(c: MoneyController, v: { vm: string; ttlHours: number; priceMicrosPerHour: number; stage: string; controller?: boolean; run?: string }): Promise<Admission> {
  if (!(v.ttlHours > 0) || !Number.isSafeInteger(v.priceMicrosPerHour) || v.priceMicrosPerHour <= 0) throw new Error("a VM sub-reservation needs a positive time to live and a positive whole list price in micros per hour");
  return c.admit("dc-hosts", { kind: "vm", run: v.run ?? "vm " + v.vm, reserveMicros: reserveOf(v.ttlHours, v.priceMicrosPerHour), stage: v.stage, tag: v.vm, vm: { id: v.vm, priceMicrosPerHour: v.priceMicrosPerHour, ttlHours: v.ttlHours, controller: v.controller ?? false } });
}

/** Extends a VM's time to live as its own atomic sub-reservation (the controller host's at each stage start). */
export function extendVm(c: MoneyController, vm: string, addHours: number): Promise<Admission> {
  const first = vmSubs(c, vm)[0];
  if (!first?.vm) throw new Error("no VM " + vm + " on dc-hosts");
  return admitVm(c, { vm, ttlHours: addHours, priceMicrosPerHour: first.vm.priceMicrosPerHour, stage: first.stage ?? "", controller: first.vm.controller, run: "vm " + vm + " extension" });
}

export const vmSubs = (c: MoneyController, vm: string): Sub[] => c.subsOf("dc-hosts").filter((s) => s.vm?.id === vm);

/** Settles a VM at its measured hours, spread over its sub-reservations in order, each up to its own time to live. */
export async function settleVm(c: MoneyController, vm: string, measuredHours: number): Promise<number> {
  const subs = vmSubs(c, vm).filter((s) => s.state === "in-flight");
  if (subs.length === 0) throw new Error("VM " + vm + " holds no in-flight sub-reservation");
  let left = measuredHours;
  let total = 0;
  for (const [i, s] of subs.entries()) {
    const hours = i === subs.length - 1 ? left : Math.min(left, s.vm!.ttlHours);
    left -= hours;
    const spent = Math.ceil(hours * s.vm!.priceMicrosPerHour);
    total += spent;
    await c.settle(s.id, { spentMicros: spent });
  }
  return total;
}

export interface StagePlan {
  stage: string;
  /** The controller host's hours over the stage. */
  controllerHours: number;
  /** Throwaway VMs: how many, and each one's hours. */
  vms: Array<{ count: number; hours: number }>;
}

/** The stage's host-hours projection at the list price, printed in the phase 1 report and before each stage. */
export function hostsProjection(p: StagePlan, priceMicrosPerHour: number): { hours: number; micros: number; line: string } {
  const hours = p.controllerHours + p.vms.reduce((a, v) => a + v.count * v.hours, 0);
  const micros = reserveOf(hours, priceMicrosPerHour);
  return { hours, micros, line: "dc-hosts projection for " + p.stage + ": " + hours + " host-hours at " + dollars(priceMicrosPerHour) + " an hour, " + dollars(micros) };
}

/** A stage starts only when its projection fits beside dc-hosts' settled, in-flight and unknown charges; else it goes to the Captain. */
export function admitStage(f: ItemFigures, p: StagePlan, priceMicrosPerHour: number): { ok: true; line: string } | { ok: false; captain: string } {
  const proj = hostsProjection(p, priceMicrosPerHour);
  const held = f.settledMicros + f.inFlightMicros + f.unknownMicros;
  if (held + proj.micros <= f.capMicros) return { ok: true, line: proj.line };
  return { ok: false, captain: proj.line + " does not fit: " + dollars(held) + " already held of the " + dollars(f.capMicros) + " cap, so the stage is refused and goes to the Captain" };
}

/** Whether the controller host is deleted for this wait (R2-3): longer than 12 hours, with nothing in flight anywhere but the host itself. */
export function idleDelete(c: MoneyController, waitHours: number): { delete: boolean; why: string } {
  if (waitHours <= IDLE_DELETE_AFTER_HOURS) return { delete: false, why: "the wait of " + waitHours + " hours is not over " + IDLE_DELETE_AFTER_HOURS };
  const busy = c.subsOf().filter((s) => s.state === "in-flight" && !s.vm?.controller);
  if (busy.length) return { delete: false, why: busy.length + " sub-reservations are in flight (" + busy.map((s) => s.run).join(", ") + ")" };
  return { delete: true, why: "a wait of " + waitHours + " hours with nothing in flight" };
}

/**
 * Deletes the controller host for a long wait: settles every open lease, takes and verifies the off-host snapshot, settles
 * the host's own sub-reservations at measured hours, then deletes the VM. Relaunch is recover() and restoreLedgerFile()
 * on the new host at the same holder path.
 */
export async function deleteController(c: MoneyController, o: { vm: string; measuredHours: number; wal: WriteAhead; target: OffHostTarget; ledgerPath?: string; journalPath?: string; deleteVm: (vm: string) => Promise<void> | void; waitHours: number }): Promise<{ deleted: boolean; why: string; settled: LedgerItemId[] }> {
  const d = idleDelete(c, o.waitHours);
  if (!d.delete) return { deleted: false, why: d.why, settled: [] };
  await settleVm(c, o.vm, o.measuredHours);
  const settled: LedgerItemId[] = [];
  for (const item of c.openItems()) {
    if (!(await c.settleItem(item))) return { deleted: false, why: item + " still has work in flight", settled };
    settled.push(item);
  }
  await takeSnapshot(c, o.wal, o.target, { ledgerPath: o.ledgerPath, journalPath: o.journalPath });
  await o.deleteVm(o.vm);
  return { deleted: true, why: d.why + "; leases settled and the off-host copy verified", settled };
}

