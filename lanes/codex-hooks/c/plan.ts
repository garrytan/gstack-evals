// Copyright (c) 2026 Garry Tan. MIT License.
// Part C's schedule and money (preregistration sections 9, 11 and 13).
//
// - Schedule: the pilot runs c-pilot and h-pilot unit by unit over the first six units in seeded order, one pass. The
//   counted run interleaves c-main and h-main by unit, over all 33 units in seeded order, two passes, so a cap stop in
//   either part leaves the other's finished units paired with it. Each step is one review-units run for one item and one
//   unit; all of an item's steps share the item's --out, so they share its run_id, the one its ledger lease binds.
// - Money: an item starts with its approval row at its frozen cap and no other amount. Before each step the guard reads the
//   item's ledger: it refuses a done item, an open lease, or a projection (the sessions left at the item's central cost per
//   session, plus four sessions' allowances held open at once) past what the item has left. Each step leases what the item
//   has left less the VM share of the sessions still to run (the VM is paid outside the ledger, and central_usd includes
//   it), rounded down to the cent, as review-units' --spend-cap; review-units refuses a round whose worst case does not
//   fit (CAP_STOP). A done mark (<record>/codex-hooks-c/<item>.done) closes an item for good, refused while a lease is open.
// - The dry run opens and settles one lease per item on a temporary ledger and checks the schedule against the frozen
//   session counts. It spends nothing.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerStatus, openLease, recordApproval, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../../src/runner/ledger/paths.ts";
import type { Admission } from "../../../src/runner/ledger/record.ts";
import type { Spend } from "../allin.ts";
import { JUDGE_ITEM } from "./analysis/frozen.ts";
import { armRef, ITEM_NAMES, ITEMS, MODEL, PARALLEL, PASSES, PILOT_UNITS, seededUnits, SEVERITY_MAP, SUITE, TIMEOUT_S, type ItemName } from "./pins.ts";

export interface Step {
  item: ItemName;
  unit: string;
}

/** The steps of a phase, in the order they run. */
export function schedule(phase: "pilot" | "main", ids: readonly string[]): Step[] {
  const items = ITEM_NAMES.filter((i) => ITEMS[i].phase === phase);
  const units = phase === "pilot" ? seededUnits(ids).slice(0, PILOT_UNITS) : seededUnits(ids);
  return units.flatMap((unit) => items.map((item) => ({ item, unit })));
}

/** The sessions a set of steps runs per item. */
export const plannedSessions = (steps: readonly Step[]): Record<string, number> => {
  const n: Record<string, number> = {};
  for (const s of steps) n[s.item] = (n[s.item] ?? 0) + PASSES[ITEMS[s.item].phase] * ITEMS[s.item].arms.length;
  return n;
};

export const itemOut = (root: string, item: ItemName) => join(root, item);

export interface ArgvInput {
  item: ItemName;
  units: readonly string[];
  out: string;
  codexArms: string;
  ledger: string;
  record: string;
  spendCapUsd: number;
  sources: Readonly<Record<string, string>>;
  upstream?: string | null;
}

/** One review-units run for an item, as bin/gstack-evals takes it. */
export function reviewArgv(o: ArgvInput): string[] {
  const p = ITEMS[o.item];
  return [
    "review-units", "--host", "codex", "--codex-arms", o.codexArms, "--suite", SUITE.path, "--units", ...o.units,
    "--arms", ...p.arms.map(armRef), "--models", MODEL, "--passes", String(PASSES[p.phase]), "--parallel", String(PARALLEL),
    "--timeout", String(TIMEOUT_S), "--allowance", String(p.allowance_usd), "--session-kind", "unattended", "--severity-map", SEVERITY_MAP,
    "--test", "garrytan/gstack=true", "--test", "garrytan/gbrain=true", ...Object.entries(o.sources).sort().flatMap(([repo, path]) => ["--source", repo + "=" + path]),
    "--item", o.item, "--spend-cap", o.spendCapUsd.toFixed(2), "--ledger", o.ledger, "--record", o.record, "--out", o.out, "--resume",
    ...(o.upstream ? ["--upstream", o.upstream] : []),
  ];
}

const usd = (micros: number) => "$" + (micros / 1e6).toFixed(2);
const refuse = (m: string): never => {
  throw new Error("E_USAGE codex-hooks c: " + m);
};

/** The approval row an item's ledger starts with: its frozen cap, recorded with the approver's own words. */
export function approve(record: string, item: ItemName, capUsd: number, by: string, words: string, admission: Admission = "required") {
  if (Math.round(capUsd * 1e6) !== Math.round(ITEMS[item].cap_usd * 1e6)) refuse(item + "'s frozen cap is $" + ITEMS[item].cap_usd + ", not $" + capUsd);
  if (!by.trim() || !words.trim()) refuse("approve needs --by (who recorded the cap) and --words (their words)");
  if (ledgerStatus(record, item).length) refuse(item + " already has an approval row");
  return recordApproval(record, { action: "init", item, cap_micros: Math.round(capUsd * 1e6), quotes: [{ words, by, source: "codex hooks prereg section 11: " + item }], admission });
}

export const doneMark = (record: string, item: ItemName) => join(record, "codex-hooks-c", item + ".done");

/** The item's status and whether one more step may run: sessionsLeft at its central cost per session plus the parallel reserve, and the model spend it may lease once the VM share of those sessions is held back. */
export function guard(record: string, item: ItemName, sessionsLeft: number) {
  const p = ITEMS[item];
  const s = ledgerStatus(record, item)[0];
  const why: string[] = [];
  if (!s || s.cap_micros === null) why.push(item + " has no approval row in " + record);
  if (existsSync(doneMark(record, item))) why.push(item + " is marked done");
  if (s?.open_lease) why.push(item + " holds open lease " + s.open_lease.lease_id + "; settle it first");
  if (s?.cap_micros !== null && s?.cap_micros !== undefined && s.cap_micros !== Math.round(p.cap_usd * 1e6)) why.push(item + "'s cap is " + usd(s.cap_micros) + ", not its frozen $" + p.cap_usd);
  const left = s ? s.left_micros : 0;
  const projection = Math.round((sessionsLeft * p.central_usd * 1e6) / p.sessions) + (sessionsLeft ? PARALLEL * p.allowance_usd * 1e6 : 0);
  if (projection > left) why.push(item + "'s projection " + usd(projection) + " (" + sessionsLeft + " sessions at " + usd((p.central_usd * 1e6) / p.sessions) + " and " + PARALLEL + " allowances of $" + p.allowance_usd + " open) passes what it has left, " + usd(left));
  const vm = Math.round((sessionsLeft * p.vm_usd * 1e6) / p.sessions);
  const line = "CODEX_C_GUARD " + (why.length ? "REFUSE" : "PASS") + " " + item + ": cap " + usd(s?.cap_micros ?? 0) + ", committed " + usd(s?.committed_micros ?? 0) + ", left " + usd(left) + ", projection " + usd(projection) + " for " + sessionsLeft + " sessions" + (vm ? ", VM share held back " + usd(vm) : "");
  return { ok: why.length === 0, why, line, left_micros: left, vm_micros: vm, spend_cap_usd: Math.floor(Math.max(0, left - vm) / 10_000) / 100 };
}

/** Part C's items and the judge item for the all-in stop (../allin.ts), from one ledger record: spent is what settled plus the
 *  item's VM share (paid outside the ledger, and inside its central) whether or not it is done; while an item runs it projects at
 *  its central plus its parallel allowances, and the judge item at its central. */
export function cSpends(record: string): Spend[] {
  if (!record || !existsSync(record)) refuse("name part C's ledger record for the all-in stop; " + (record || "none") + " does not exist");
  const settled = (item: string) => {
    const s = ledgerStatus(record, item)[0];
    return s ? s.committed_micros - (s.open_lease?.reserved_micros ?? 0) : 0;
  };
  return [
    ...ITEM_NAMES.map((item) => {
      const p = ITEMS[item], done = existsSync(doneMark(record, item));
      return { item, done, spent: settled(item) + Math.round(p.vm_usd * 1e6), projection: Math.round((p.central_usd + PARALLEL * p.allowance_usd) * 1e6) };
    }),
    { item: JUDGE_ITEM.item, done: false, spent: settled(JUDGE_ITEM.item), projection: JUDGE_ITEM.central_usd * 1e6 },
  ];
}

/** Closes an item for good. */
export function markDone(record: string, item: ItemName) {
  const s = ledgerStatus(record, item)[0];
  if (!s) refuse(item + " has no approval row in " + record);
  if (s!.open_lease) refuse(item + " holds open lease " + s!.open_lease.lease_id + "; settle it first");
  const f = doneMark(record, item);
  if (existsSync(f)) refuse(item + " is marked done already");
  mkdirSync(join(record, "codex-hooks-c"), { recursive: true });
  writeFileSync(f, JSON.stringify({ item, at: new Date().toISOString(), committed_micros: s!.committed_micros, left_micros: s!.left_micros }, null, 2) + "\n", { flag: "wx" });
  return f;
}

/** The keyless dry run: one lease per item on a temporary ledger, the guard and the done mark, and the schedule's counts. */
export function dryRun(ids: readonly string[]): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  const check = (name: string, ok: boolean, detail: string) => lines.push((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  const dir = mkdtempSync(join(tmpdir(), "codex-hooks-c-dry-"));
  try {
    const record = join(dir, "record");
    const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite"), {}));
    for (const item of ITEM_NAMES) {
      const p = ITEMS[item];
      approve(record, item, p.cap_usd, "codex-hooks c dry-run", "dry run on a temporary ledger, not an approval", "warn");
      const g = guard(record, item, p.sessions);
      const lease = openLease(record, local, { item, run_id: "dry-" + item, amount_micros: Math.round(g.spend_cap_usd * 1e6) });
      const held = ledgerStatus(record, item)[0]!;
      settleLease(record, local, lease.lease_id);
      const after = ledgerStatus(record, item)[0]!;
      check("lease " + item, g.ok && held.open_lease?.lease_id === lease.lease_id && after.open_lease === null && after.committed_micros === 0 && after.left_micros === Math.round(p.cap_usd * 1e6), "opened " + lease.lease_id + " for $" + g.spend_cap_usd.toFixed(2) + " and settled it at $0.00; left " + usd(after.left_micros) + "; " + g.line);
      markDone(record, item);
      check("done " + item, !guard(record, item, p.sessions).ok, "a done item's guard refuses");
    }
    for (const phase of ["pilot", "main"] as const) {
      const n = plannedSessions(schedule(phase, ids));
      for (const item of ITEM_NAMES.filter((i) => ITEMS[i].phase === phase)) check("sessions " + item, n[item] === ITEMS[item].sessions, (n[item] ?? 0) + " planned, " + ITEMS[item].sessions + " frozen");
    }
    const main = schedule("main", ids);
    check("interleave", main.every((s, i) => s.item === (i % 2 === 0 ? "c-main" : "h-main") && s.unit === main[i - (i % 2)]!.unit), "c-main and h-main alternate unit by unit in seeded order");
  } catch (e) {
    check("dry run", false, (e as Error).message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { ok: lines.every((l) => l.startsWith("PASS")), lines };
}
