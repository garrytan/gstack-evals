// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's money on the Lane B ledger (quick/laneb/runner/ledger.ts) and L1's host and part machinery, as B1's
// (lanes/delivery-route/money.ts): each item's approval row at its recorded cap, its done mark, the cap rule of section 11, the
// launch guard (the item's projection against its cap, and every item's projection plus the crew's counter against the
// Captain's all-in stop, pins.ts ALL_IN_STOP_USD), the one infrastructure rerun, and the dry run that opens and settles one lease per item on a
// temporary ledger. A session reserves its $5 allowance on the item's ledger as it opens (the metering proxy), so six parallel
// sessions hold six allowances open; each settles at its metered cost. A cap stop is never relaunched or rerun.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostTtlHours, itemCheck, L1, plannedCells, relaunchRects, type PartPlan } from "../../../quick/laneb/l1/l1.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../../quick/laneb/runner/ledger.ts";
import { VM_HOURS_PER_SESSION } from "../../delivery-route/pins.ts";
import { ALL_IN_STOP_USD, armRate, isArm, isItem, ITEM_NAMES, ITEMS_USD, R, type Item } from "./pins.ts";
import { itemPlan } from "./plans.ts";
import { buildRTable, pulledInputs, type RRow } from "./table.ts";

const usd = (m: number) => "$" + fromMicros(m).toFixed(2);
const refuse = (m: string): never => { throw new Error("E_CODEX_R_MONEY refused: " + m); };
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
const blockUsd = Number(L1.vm.usdPerHour) * Number(L1.vm.reserveHours);
const anyRun = () => Array.from({ length: R.tasks }, (_, i) => "t" + i);

/** Section 11's cap rule: 1.35 x central plus the parallel sessions' reserve plus any VM share the central leaves out, rounded up to $5. */
export const capRule = (i: Item) => Math.ceil((1.35 * ITEMS_USD[i].central + R.concurrent * R.allowanceUsd + ITEMS_USD[i].vmOutside) / 5) * 5;

/** The approval row an item's ledger starts with, at the item's recorded cap and no other amount. */
export function approve(path: string, item: string, capUsd: number, by: string) {
  if (!isItem(item)) throw new Error("E_USAGE codex-hooks r approve: unknown item " + item + "; one of " + ITEM_NAMES.join(", "));
  if (!by.trim()) throw new Error("E_USAGE codex-hooks r approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(ITEMS_USD[item].cap)) refuse(item + "'s recorded cap is $" + ITEMS_USD[item].cap + ", not $" + capUsd);
  if (readRows(path).length) refuse(path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, item).approve(capUsd, { approved_by: by, source: "Codex hooks prereg section 11: the cap recorded for " + item });
  itemCheck(readRows(path), item, ITEMS_USD[item].cap);
}

export type ItemTotals = { cap: number; settled: number; open: number; openIds: string[]; done: boolean; vmSettled: number; vmOpen: number; hostOpen: boolean };
export function itemTotals(rows: Row[], item: Item): ItemTotals {
  const cap0 = toMicros(ITEMS_USD[item].cap);
  if (!rows.length) return { cap: cap0, settled: 0, open: 0, openIds: [], done: false, vmSettled: 0, vmOpen: 0, hostOpen: false };
  const approvals = rows.filter((r) => r.kind === "approval");
  if (!approvals.length || approvals[0]!.item !== item) refuse("the ledger given for " + item + " has no approval row for it");
  if (approvals[0]!.usd_micros !== cap0) refuse(item + "'s approval row is " + usd(approvals[0]!.usd_micros) + ", not its recorded cap $" + ITEMS_USD[item].cap);
  const reserved = new Map<string, number>(), settled = new Map<string, number>();
  for (const r of rows) { if (r.kind === "reserve") reserved.set(r.id, r.usd_micros); if (r.kind === "settle") settled.set(r.id, r.usd_micros); }
  const t: ItemTotals = { cap: approvals.at(-1)!.usd_micros, settled: 0, open: 0, openIds: [], done: rows.some((r) => r.kind === "note" && r.id === "done"), vmSettled: 0, vmOpen: 0, hostOpen: false };
  for (const [id, v] of settled) { t.settled += v; if (VM_ID.test(id)) t.vmSettled += v; }
  for (const [id, v] of reserved) {
    if (settled.has(id)) continue;
    t.open += v; t.openIds.push(id);
    if (VM_ID.test(id)) t.vmOpen += v;
    if (/^host-\d+$/.test(id)) t.hostOpen = true;
  }
  return t;
}

/** An item is done once every launch has settled: a note row with id done, refused while a reservation is open. */
export function markDone(path: string, item: Item) {
  const t = itemTotals(readRows(path), item);
  if (t.done) refuse(item + " is marked done already");
  if (t.openIds.length) refuse(item + " still holds " + t.openIds.length + " open reservations (" + t.openIds.slice(0, 3).join(", ") + "); settle them first");
  appendRow(path, { ts: new Date().toISOString(), item, kind: "note", id: "done", usd_micros: 0 });
}

/** A part's planned model spend (its sessions at section 11's rates) and its part VM's reserve (launch.sh's blocks). */
export function partProjection(p: PartPlan) {
  const cells = [...plannedCells(p).entries()];
  const sessions = cells.reduce((x, [, n]) => x + n, 0);
  const model = toMicros(cells.reduce((x, [k, n]) => { const a = k.split("\t")[1]!; return x + n * (isArm(a) ? armRate(a) : refuse("unknown arm " + a)); }, 0));
  const blocks = Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours)));
  return { sessions, model, vm: toMicros(blocks * blockUsd) };
}

/** The item guard: its spend so far, its parts still to run at their planned spend, the parallel reserve its sessions hold
 *  open, and its VM share (VM rows so far, the host's reserve for its TTL when none is open, each part left at its blocks). */
export function itemGuard(item: Item, rows: Row[], parts: PartPlan[], finished: string[]) {
  const t = itemTotals(rows, item), left = parts.filter((p) => !finished.includes(p.name)), proj = left.map(partProjection);
  const parallel = left.length ? toMicros(R.concurrent * R.allowanceUsd) : 0;
  const model = t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + parallel;
  const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
  const vm = t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
  return { item, cap: t.cap, model, parallel, vm, host, parts_left: left.length, total: model + vm, fits: model + vm <= t.cap };
}

/** The crew file the operator writes from this thread's Capy counter (cost.dollars, list price) before each launch. */
export type Crew = { as_of: string; usd: number };
export function crewOf(crew: Crew) {
  if (typeof crew?.as_of !== "string" || typeof crew.usd !== "number" || !(crew.usd >= 0)) throw new Error("E_USAGE codex-hooks r guard: the crew file needs as_of and usd, a number of at least 0");
  return { spent: toMicros(crew.usd), stop: toMicros(ALL_IN_STOP_USD) };
}

/** Before each launch: the item's guard against its cap, and the all-in stop: each done item at its settled, each other item at
 *  the larger of its spend and its guard projection, plus the crew's counter. A refusal goes to the Captain. */
export function launchGuard(item: Item, ledgers: Partial<Record<Item, Row[]>>, plans: Partial<Record<Item, { parts: PartPlan[]; finished: string[] }>>, crew: Crew) {
  const why: string[] = [];
  const c = crewOf(crew);
  const items = ITEM_NAMES.map((i) => {
    const t = itemTotals(ledgers[i] ?? [], i), plan = plans[i] ?? { parts: itemPlan(i, anyRun()).parts, finished: [] };
    const g = itemGuard(i, ledgers[i] ?? [], plan.parts, plan.finished);
    return { item: i, ...t, guard: g, counted: t.done ? t.settled : Math.max(t.settled + t.open, g.total) };
  });
  const own = items.find((i) => i.item === item)!;
  if (own.done) why.push(item + " is marked done; a done item never launches again");
  if (item === "r-main" && !items.find((i) => i.item === "r-pilot")!.done) why.push("r-pilot is not marked done; the main run starts after the pilot's readout (section 9)");
  if (!own.guard.fits) why.push(item + "'s projection " + usd(own.guard.total) + " (model " + usd(own.guard.model) + " with the " + usd(own.guard.parallel) + " parallel reserve, VM share " + usd(own.guard.vm) + ") passes its cap " + usd(own.guard.cap));
  const total = items.reduce((x, i) => x + i.counted, 0) + c.spent;
  if (total > c.stop) why.push("all-in " + usd(total) + " (items " + usd(total - c.spent) + ", crew " + usd(c.spent) + " as of " + crew.as_of + ") passes the " + usd(c.stop) + " stop");
  const lines = [
    "R_LAUNCH " + (why.length ? "REFUSE" : "PASS") + " " + item + ": all-in " + usd(total) + " of " + usd(c.stop) + "; " + item + " " + usd(own.guard.total) + " of cap " + usd(own.guard.cap) + " (" + own.guard.parts_left + " parts to run)",
    ...items.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", cap " + usd(i.cap) + ", counted " + usd(i.counted)),
    "  crew " + usd(c.spent),
  ];
  return { ok: !why.length, why, lines, total };
}

/** Each item's plan beside section 11's central and cap; the cap rule must give the recorded cap. */
export function planLines(run: string[]) {
  const lines: string[] = [], bad: string[] = [];
  for (const i of ITEM_NAMES) {
    const p = itemPlan(i, run), proj = p.parts.map(partProjection);
    const model = fromMicros(proj.reduce((x, q) => x + q.model, 0)), vm = fromMicros(proj.reduce((x, q) => x + q.vm, 0)) + hostTtlHours(p.parts.length) * L1.host.usdPerHour;
    if (p.sessions !== ITEMS_USD[i].sessions) bad.push(i + " plans " + p.sessions + " sessions, not " + ITEMS_USD[i].sessions);
    if (capRule(i) !== ITEMS_USD[i].cap) bad.push(i + "'s cap rule gives $" + capRule(i) + ", not its recorded $" + ITEMS_USD[i].cap);
    lines.push(i + ": " + p.parts.map((x) => x.name + " (" + [...plannedCells(x).values()].reduce((a, b) => a + b, 0) + ")").join(", ") + "; " + p.sessions + " sessions; model $" + model.toFixed(2) + ", VM $" + vm.toFixed(2) + "; central $" + ITEMS_USD[i].central + ", cap $" + ITEMS_USD[i].cap + " (rule $" + capRule(i) + ")");
  }
  return { lines, bad };
}

/** The dry run: for each item, a temporary ledger with its approval row at the recorded cap, one session lease opened at the
 *  $5 allowance and settled at zero, and the done mark; then the ledger must read the cap, nothing open and done. */
export function dryRun() {
  const dir = mkdtempSync(join(tmpdir(), "codex-hooks-r-dry-"));
  const lines: string[] = [];
  try {
    for (const i of ITEM_NAMES) {
      const path = join(dir, i + ".jsonl");
      approve(path, i, ITEMS_USD[i].cap, "dry run");
      const l = new Ledger(path, i), res = l.reserve("dry-session", toMicros(R.allowanceUsd), { kind_detail: "dry run: one session lease at the allowance" });
      if (!res.ok || res.existing) refuse(i + "'s ledger refused the dry run's lease");
      l.settle("dry-session", 0, { kind_detail: "dry run: settled at zero" });
      markDone(path, i);
      const t = itemTotals(readRows(path), i);
      if (t.cap !== toMicros(ITEMS_USD[i].cap) || t.open || !t.done || t.settled) refuse(i + "'s dry-run ledger does not read back as approved, settled and done");
      lines.push("dry run " + i + ": approval $" + ITEMS_USD[i].cap + ", one lease of $" + R.allowanceUsd + " opened and settled, done");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return lines;
}

// The one rerun: a session that ended with no result, no model response, no verifier reward or no rollout reruns once as
// attempt 2, and a second failure is a gap. Limit stops and model errors after a response never rerun; a cap stop never does.
const NO_RESPONSE = /^(no result\.json|no model response reached the agent|no verifier reward|no rollout)/;
export const needsRerun = (r: Pick<RRow, "outcome" | "reason">) => r.outcome === "infra" && NO_RESPONSE.test(r.reason);
export function infraRerun(first: RRow[], second: RRow[] = []) {
  const key = (r: RRow) => r.task + "\t" + r.arm, rerun = first.filter(needsRerun), again = new Map(second.map((r) => [key(r), r]));
  const stray = second.filter((r) => !rerun.some((x) => key(x) === key(r)));
  if (stray.length) throw new Error("E_USAGE codex-hooks r rerun: attempt 2 holds " + key(stray[0]!).replace("\t", " ") + ", which owed no rerun");
  return {
    rects: relaunchRects(rerun.map((r) => ({ task: r.task, arm: r.arm, replicates: 1 }))),
    rerun: rerun.map(key),
    missing: rerun.filter((r) => again.has(key(r)) && again.get(key(r))!.outcome !== "graded").map(key),
    pending: rerun.filter((r) => !again.has(key(r))).map(key),
  };
}
export function attempt2Owed(runs: { part: string; dir: string }[]) {
  const cfgs = runs.map((r) => pulledInputs(r.dir, r.part));
  const jobs = cfgs.flatMap((c) => c.jobs), sessions = cfgs.flatMap((c) => c.sessions);
  const rows = jobs.length ? buildRTable({ jobs, sessions }) : [];
  return { owed: rows.filter(needsRerun).map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: infraRerun(rows).rects };
}
