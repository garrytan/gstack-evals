// Copyright (c) 2026 Garry Tan. MIT License.
// B1's money on the Lane B ledger (quick/laneb/runner/ledger.ts) and L1's host and part machinery: each item's approval row
// at its recorded cap, the item's done mark, the cap formula, the launch guard (the item's projection against its cap, and
// every item's projection plus the crew's counter against the all-in stop), and the one infrastructure rerun.
// A session reserves its allowance on the item's ledger as it opens (the metering proxy), so six parallel sessions hold six
// allowances open; each settles at its metered cost. A refused reserve latches the proxy's cap stop: open sessions finish
// inside their reserves, no session opens after it, and a cap stop is never relaunched or rerun.
import { hostTtlHours, itemCheck, L1, plannedCells, relaunchRects, type PartPlan } from "../../quick/laneb/l1/l1.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { armRate, B1, CAPS_USD, isArm, isItem, ITEM_NAMES, modelKey, MODELS, VM_HOURS_PER_SESSION, type Item } from "./pins.ts";
import { ITEMS, itemPlan } from "./plans.ts";
import { buildB1Table, pulledInputs, type B1Row } from "./table.ts";

const usd = (m: number) => "$" + fromMicros(m).toFixed(2);
const refuse = (m: string): never => { throw new Error("E_USAGE refused: " + m); };
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
export const blockUsd = Number(L1.vm.usdPerHour) * Number(L1.vm.reserveHours);

/** The approval row an item's ledger starts with, at the item's recorded cap and no other amount. */
export function approve(path: string, item: string, capUsd: number, by: string) {
  if (!isItem(item)) throw new Error("E_USAGE b1 approve: unknown item " + item + "; one of " + ITEM_NAMES.join(", "));
  if (!by.trim()) throw new Error("E_USAGE b1 approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(CAPS_USD[item])) refuse(item + "'s recorded cap is $" + CAPS_USD[item] + ", not $" + capUsd);
  if (readRows(path).length) refuse(path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, item).approve(capUsd, { approved_by: by, source: "delivery route prereg: the cap recorded for " + item });
  itemCheck(readRows(path), item, CAPS_USD[item]);
}

export type ItemTotals = { cap: number; settled: number; open: number; openIds: string[]; done: boolean; vmSettled: number; vmOpen: number; hostOpen: boolean };
export function itemTotals(rows: Row[], item: Item): ItemTotals {
  const cap0 = toMicros(CAPS_USD[item]);
  if (!rows.length) return { cap: cap0, settled: 0, open: 0, openIds: [], done: false, vmSettled: 0, vmOpen: 0, hostOpen: false };
  const approvals = rows.filter((r) => r.kind === "approval");
  if (!approvals.length || approvals[0]!.item !== item) throw new Error("E_USAGE b1 ledger: the ledger given for " + item + " has no approval row for it");
  if (approvals[0]!.usd_micros !== cap0) refuse(item + "'s approval row is " + usd(approvals[0]!.usd_micros) + ", not its recorded cap $" + CAPS_USD[item]);
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

/** A part's planned model spend (its sessions at the planning rates) and its part VM's reserve (launch.sh's blocks). */
export function partProjection(item: Item, p: PartPlan) {
  const m = modelKey(p.model ?? ITEMS[item].model) ?? refuse("no planning rate for model " + (p.model ?? ITEMS[item].model));
  const cells = [...plannedCells(p).entries()];
  const sessions = cells.reduce((x, [, n]) => x + n, 0);
  const model = toMicros(cells.reduce((x, [k, n]) => { const a = k.split("\t")[1]!; return x + n * (isArm(a) ? armRate(a, m) : refuse("unknown arm " + a)); }, 0));
  const blocks = Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours)));
  return { sessions, model, vm: toMicros(blocks * blockUsd) };
}
const allowanceOf = (item: Item) => Math.max(...itemPlan(item, Array.from({ length: B1.tasks }, (_, i) => "t" + i)).parts.map((p) => MODELS[modelKey(p.model ?? ITEMS[item].model)!].allowanceUsd));

/** The cap formula: ceil10(1.35 x expected model spend + concurrent x the largest allowance + VM share), with the VM share the
 *  host's reserve for its TTL and each part's VM blocks. */
export function capOf(item: Item, parts: PartPlan[]) {
  const proj = parts.map((p) => partProjection(item, p));
  const expected = fromMicros(proj.reduce((x, p) => x + p.model, 0));
  const vm = fromMicros(proj.reduce((x, p) => x + p.vm, 0)) + hostTtlHours(parts.length) * L1.host.usdPerHour;
  const parallel = B1.concurrent * allowanceOf(item);
  return { expected, parallel, vm, cap: Math.ceil((1.35 * expected + parallel + vm) / 10) * 10 };
}

/** The item guard: its spend so far, its parts still to run at their planned spend, the parallel reserve its sessions hold
 *  open, and its VM share (VM rows so far, the host's reserve for its TTL when none is open, each part left at its blocks). */
export function itemGuard(item: Item, rows: Row[], parts: PartPlan[], finished: string[]) {
  const t = itemTotals(rows, item), left = parts.filter((p) => !finished.includes(p.name)), proj = left.map((p) => partProjection(item, p));
  const parallel = left.length ? toMicros(B1.concurrent * allowanceOf(item)) : 0;
  const model = t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + parallel;
  const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
  const vm = t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
  return { item, cap: t.cap, model, parallel, vm, host, parts_left: left.length, total: model + vm, fits: model + vm <= t.cap };
}

/** The crew file the operator writes from this thread's Capy counter (cost.dollars, list price) before each launch. */
export type Crew = { as_of: string; usd: number };
export function crewMicros(crew: Crew) {
  if (typeof crew?.as_of !== "string" || typeof crew.usd !== "number" || !(crew.usd >= 0)) throw new Error("E_USAGE b1 guard: the crew file needs as_of and usd, a number of at least 0");
  return toMicros(crew.usd);
}

/** Before each launch: the item's guard against its cap, and the all-in stop: each done item at its settled, each other item
 *  at the larger of its spend and its guard projection, plus the crew's counter, against B1.stopUsd. A refusal goes to the
 *  Captain. */
export function launchGuard(item: Item, ledgers: Partial<Record<Item, Row[]>>, plans: Partial<Record<Item, { parts: PartPlan[]; finished: string[] }>>, crew: Crew) {
  const why: string[] = [];
  const items = ITEM_NAMES.map((i) => {
    const t = itemTotals(ledgers[i] ?? [], i), plan = plans[i] ?? { parts: itemPlan(i, Array.from({ length: B1.tasks }, (_, k) => "t" + k)).parts, finished: [] };
    const g = itemGuard(i, ledgers[i] ?? [], plan.parts, plan.finished);
    return { item: i, ...t, guard: g, counted: t.done ? t.settled : Math.max(t.settled + t.open, g.total) };
  });
  const own = items.find((i) => i.item === item)!;
  if (own.done) why.push(item + " is marked done; a done item never launches again");
  if (!own.guard.fits) why.push(item + "'s projection " + usd(own.guard.total) + " (model " + usd(own.guard.model) + " with the " + usd(own.guard.parallel) + " parallel reserve, VM share " + usd(own.guard.vm) + ") passes its cap " + usd(own.guard.cap));
  const crewSpent = crewMicros(crew), total = items.reduce((x, i) => x + i.counted, 0) + crewSpent, stop = toMicros(B1.stopUsd);
  if (total > stop) why.push("all-in " + usd(total) + " (items " + usd(total - crewSpent) + ", crew " + usd(crewSpent) + " as of " + crew.as_of + ") passes the " + usd(stop) + " stop");
  const lines = [
    "B1_LAUNCH " + (why.length ? "REFUSE" : "PASS") + " " + item + ": all-in " + usd(total) + " of " + usd(stop) + "; " + item + " " + usd(own.guard.total) + " of cap " + usd(own.guard.cap) + " (" + own.guard.parts_left + " parts to run)",
    ...items.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", cap " + usd(i.cap) + ", counted " + usd(i.counted)),
    "  crew " + usd(crewSpent),
  ];
  return { ok: !why.length, why, lines, total };
}

// The one rerun: a session that ended with no result, no model response or no verifier reward reruns once as attempt 2, and
// a second failure is a gap. Allowance stops, turn caps and model errors after a response never rerun; a cap stop never does.
const NO_RESPONSE = /^(no result\.json|no model response reached the agent|no verifier reward)/;
export const needsRerun = (r: Pick<B1Row, "outcome" | "reason">) => r.outcome === "infra" && NO_RESPONSE.test(r.reason);
export function infraRerun(first: B1Row[], second: B1Row[] = []) {
  const key = (r: B1Row) => r.task + "\t" + r.arm, rerun = first.filter(needsRerun), again = new Map(second.map((r) => [key(r), r]));
  const stray = second.filter((r) => !rerun.some((x) => key(x) === key(r)));
  if (stray.length) throw new Error("E_USAGE b1 rerun: attempt 2 holds " + key(stray[0]!).replace("\t", " ") + ", which owed no rerun");
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
  const rows = jobs.length ? buildB1Table({ jobs, sessions }) : [];
  return { owed: rows.filter(needsRerun).map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: infraRerun(rows).rects };
}
