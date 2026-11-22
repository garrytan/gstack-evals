// Copyright (c) 2026 Garry Tan. MIT License.
// B2's money on the Lane B ledger (quick/laneb/runner/ledger.ts) and L1's host and part machinery, as B1's and part R's
// (lanes/delivery-route/money.ts, lanes/codex-hooks/r/money.ts): one ledger item per cap with its approval row at the cap the
// Agent notes record, the item's done mark, the cap rule (ceil5 of 1.35 x expected model spend + six parallel allowances + the
// VM share), the launch guard, the one infrastructure rerun and the dry run. A session reserves its allowance on the item's
// ledger as it opens (the metering proxy) and settles at its metered cost; a refused reserve is a cap stop, never relaunched
// or rerun.
// The launch guard refuses when the item is done, when its projection passes its cap, or when every item's projection plus
// this thread's own counter (cost.dollars from tools.thread.get, passed in by the caller) passes the $1,860 all-in stop. It
// also holds the run's order: no counted part before b2-pilot is marked done, no Sol part before the keyless image check
// recorded every run task's Codex image (images.ts), and no part 5 of any item before the interim look's record exists with
// the decision continue (look.ts).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostTtlHours, itemCheck, L1, plannedCells, relaunchRects, type PartPlan } from "../../quick/laneb/l1/l1.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { ARM_DEFS, B2, CAP_ROUND_USD, CAPS_USD, GUARD_RATES_USD, PREREG_CAPS_USD, isItem, ITEM_NAMES, ITEM_MODEL, modelKey, MODELS, RATES_USD, VM_HOURS_PER_SESSION, type Item } from "./pins.ts";
import { ITEMS, itemPlan, partNumber } from "./plans.ts";
import { buildB2Table, pulledInputs, type B2Row } from "./table.ts";

const usd = (m: number) => "$" + fromMicros(m).toFixed(2);
const refuse = (m: string): never => { throw new Error("E_B2_MONEY refused: " + m); };
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
export const blockUsd = Number(L1.vm.usdPerHour) * Number(L1.vm.reserveHours);
const anyRun = () => Array.from({ length: B2.tasks }, (_, i) => "t" + i);
const anyPilot = ["p0", "p1", "p2"];

/** The approval row an item's ledger starts with, at the item's recorded cap and no other amount. */
export function approve(path: string, item: string, capUsd: number, by: string) {
  if (!isItem(item)) throw new Error("E_USAGE b2 approve: unknown item " + item + "; one of " + ITEM_NAMES.join(", "));
  if (!by.trim()) throw new Error("E_USAGE b2 approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(CAPS_USD[item])) refuse(item + "'s recorded cap is $" + CAPS_USD[item] + ", not $" + capUsd);
  if (readRows(path).length) refuse(path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, item).approve(capUsd, { approved_by: by, source: "B2 prereg Agent notes: the cap recorded for " + item });
  itemCheck(readRows(path), item, CAPS_USD[item]);
}

export type ItemTotals = { cap: number; settled: number; open: number; openIds: string[]; done: boolean; vmSettled: number; vmOpen: number; hostOpen: boolean };
export function itemTotals(rows: Row[], item: Item): ItemTotals {
  const cap0 = toMicros(CAPS_USD[item]);
  if (!rows.length) return { cap: cap0, settled: 0, open: 0, openIds: [], done: false, vmSettled: 0, vmOpen: 0, hostOpen: false };
  const approvals = rows.filter((r) => r.kind === "approval");
  if (!approvals.length || approvals[0]!.item !== item) refuse("the ledger given for " + item + " has no approval row for it");
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

/** A part's planned model spend (its sessions at the planning rate of its model and arm) and its part VM's blocks. */
export function partProjection(item: Item, p: PartPlan, rates = RATES_USD) {
  const m = modelKey(p.model ?? ITEMS[item].model) ?? refuse("no planning rate for model " + (p.model ?? ITEMS[item].model));
  const cells = [...plannedCells(p).entries()];
  const sessions = cells.reduce((x, [, n]) => x + n, 0);
  const model = toMicros(cells.reduce((x, [k, n]) => { const a = ARM_DEFS[k.split("\t")[1]!] ?? refuse("unknown arm " + k.split("\t")[1]); return x + n * rates[m][a.arm]; }, 0));
  const blocks = Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours)));
  return { sessions, model, vm: toMicros(blocks * blockUsd) };
}
const allowanceOf = (item: Item) => ITEMS[item].allowanceUsd;
const planOf = (item: Item) => itemPlan(item, anyRun(), anyPilot).parts;

/** The cap rule: ceil5(1.35 x expected model spend + six parallel allowances + the VM share), the VM share being each part's
 *  blocks and the awake host's reserve for its TTL. */
export function capOf(item: Item, parts: PartPlan[] = planOf(item)) {
  const proj = parts.map((p) => partProjection(item, p));
  const expected = fromMicros(proj.reduce((x, p) => x + p.model, 0));
  const vm = fromMicros(proj.reduce((x, p) => x + p.vm, 0)) + hostTtlHours(parts.length) * L1.host.usdPerHour;
  const parallel = B2.concurrent * allowanceOf(item);
  return { expected, parallel, vm, cap: Math.ceil((1.35 * expected + parallel + vm - 1e-9) / CAP_ROUND_USD) * CAP_ROUND_USD };
}

/** The item guard: its spend so far, its parts still to run at their planned spend, the parallel reserve its sessions hold
 *  open, and its VM share (VM rows so far, the host's reserve for its TTL when none is open, each part left at its blocks).
 *  Parts left are projected at change 3's GUARD_RATES_USD. */
export function itemGuard(item: Item, rows: Row[], parts: PartPlan[], finished: string[], rates = GUARD_RATES_USD) {
  const t = itemTotals(rows, item), left = parts.filter((p) => !finished.includes(p.name)), proj = left.map((p) => partProjection(item, p, rates));
  const parallel = left.length ? toMicros(B2.concurrent * allowanceOf(item)) : 0;
  const model = t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + parallel;
  const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
  const vm = t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
  return { item, cap: t.cap, model, parallel, vm, host, parts_left: left.length, total: model + vm, fits: model + vm <= t.cap };
}

/** This thread's own counter as the caller read it from tools.thread.get (cost.dollars, list price). */
export type Counter = { usd: number; as_of: string };
export function counterMicros(c: Counter) {
  if (typeof c?.as_of !== "string" || !c.as_of.trim() || typeof c.usd !== "number" || !Number.isFinite(c.usd) || c.usd < 0) throw new Error("E_USAGE b2 guard: pass --counter-usd <dollars>, this thread's cost.dollars from tools.thread.get, a number of at least 0, and --counter-as-of <time>");
  return toMicros(c.usd);
}

/** The run's order, read by the guard: the pilot's done mark, the image check's record for Sol and the look's record. */
export type Order = { pilotDone: boolean; images: { ok: boolean; why: string } | null; look: { decision: "continue" | "stop"; z: number } | null };
export function orderProblems(item: Item, part: string | null, o: Order): string[] {
  const why: string[] = [];
  if (item === "b2-pilot") return why;
  if (!o.pilotDone) why.push("b2-pilot is not marked done; no counted part starts before the pilot's readout (section 12)");
  if (item === "b2-sol" && !o.images?.ok) why.push("no image check record shows every run task's image building with Codex added (" + (o.images?.why ?? "no record") + "); run b2 images before Sol's first counted part");
  const n = part ? partNumber(part) : 0;
  if (n > B2.lookParts) {
    if (!o.look) why.push(part + " is past the interim look's half and no look record exists; b2 look first, from parts 1 to " + B2.lookParts + " of all three items");
    else if (o.look.decision !== "continue") why.push("the interim look stopped the run (|z| at least the look bound); no part past " + B2.lookParts + " launches");
  }
  return why;
}

/** Before each launch: the item's guard against its cap, the all-in stop (each done item at its settled, each other item at the
 *  larger of its spend and its projection, plus this thread's counter, against B2.stopUsd) and the run's order. A refusal goes
 *  to the Captain. */
export function launchGuard(item: Item, ledgers: Partial<Record<Item, Row[]>>, plans: Partial<Record<Item, { parts: PartPlan[]; finished: string[] }>>, counter: Counter, order: Order, part: string | null = null) {
  const why: string[] = [];
  const spent = counterMicros(counter), stop = toMicros(B2.stopUsd);
  const items = ITEM_NAMES.map((i) => {
    const t = itemTotals(ledgers[i] ?? [], i), plan = plans[i] ?? { parts: planOf(i), finished: [] };
    const g = itemGuard(i, ledgers[i] ?? [], plan.parts, plan.finished);
    return { item: i, ...t, guard: g, counted: t.done ? t.settled : Math.max(t.settled + t.open, g.total) };
  });
  const own = items.find((i) => i.item === item)!;
  if (own.done) why.push(item + " is marked done; a done item never launches again");
  if (!own.guard.fits) why.push(item + "'s projection " + usd(own.guard.total) + " (model " + usd(own.guard.model) + " with the " + usd(own.guard.parallel) + " parallel reserve, VM share " + usd(own.guard.vm) + ") passes its cap " + usd(own.guard.cap));
  const total = items.reduce((x, i) => x + i.counted, 0) + spent;
  if (total > stop) why.push("all-in " + usd(total) + " (items " + usd(total - spent) + ", this thread " + usd(spent) + " as of " + counter.as_of + ") passes the " + usd(stop) + " stop");
  why.push(...orderProblems(item, part, order));
  const lines = [
    "B2_LAUNCH " + (why.length ? "REFUSE" : "PASS") + " " + item + (part ? " " + part : "") + ": all-in " + usd(total) + " of " + usd(stop) + "; " + item + " " + usd(own.guard.total) + " of cap " + usd(own.guard.cap) + " (" + own.guard.parts_left + " parts to run)",
    ...items.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", cap " + usd(i.cap) + ", counted " + usd(i.counted)),
    "  this thread " + usd(spent) + " as of " + counter.as_of,
    ...why.map((w) => "  refused: " + w),
  ];
  return { ok: !why.length, why, lines, total };
}

/** The parts the guard projects and those finished: the plan's parts and every prepared attempt 2 or relaunch, a part finished
 *  once its result is written. A relaunch is projected before it starts: the part it replaces counts as unfinished. */
export function guardParts(work: string, planned: PartPlan[], relaunching?: string): { parts: PartPlan[]; finished: string[] } {
  const prepared = planned.flatMap((p) => [p.name + "-a2", p.name + "-relaunch"]).map((n) => join(work, n, "l1-part.json")).filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, "utf8")) as PartPlan);
  const parts = [...planned, ...prepared];
  return { parts, finished: parts.map((p) => p.name).filter((n) => n !== relaunching && existsSync(join(work, n + ".result.json"))) };
}

/** Each item's plan beside its recorded cap, sessions and expected spend; the cap rule must give the recorded cap. */
export function planLines(run: string[], pilot: readonly string[]) {
  const lines: string[] = [], bad: string[] = [];
  let counted = 0;
  for (const i of ITEM_NAMES) {
    const p = itemPlan(i, run, pilot), c = capOf(i, p.parts);
    if (i !== "b2-pilot") counted += p.sessions;
    if (c.cap !== PREREG_CAPS_USD[i]) bad.push(i + "'s cap rule gives $" + c.cap + ", not its preregistered $" + PREREG_CAPS_USD[i]);
    lines.push(i + ": " + p.parts.map((x) => x.name + " (" + [...plannedCells(x).values()].reduce((a, b) => a + b, 0) + ")").join(", ") + "; " + p.sessions + " sessions; expected $" + c.expected.toFixed(2) + ", parallel $" + c.parallel.toFixed(2) + ", VM $" + c.vm.toFixed(2) + ", cap rule $" + c.cap + " (recorded $" + CAPS_USD[i] + ", pre-run change 1)");
  }
  const caps = ITEM_NAMES.reduce((a, i) => a + CAPS_USD[i], 0);
  if (caps !== ITEM_NAMES.reduce((a, i) => a + PREREG_CAPS_USD[i], 0)) bad.push("the recorded caps sum to $" + caps + ", not the preregistered sum");
  lines.push("counted sessions " + counted + " (" + B2.tasks + " tasks x 4 arms x 3 models), caps sum $" + caps + ", all-in stop $" + B2.stopUsd);
  if (counted !== B2.tasks * 12) bad.push("the plan counts " + counted + " sessions, not " + B2.tasks * 12);
  return { lines, bad };
}

/** The dry run: for each item, a temporary ledger with its approval row at the recorded cap, one session lease opened at the
 *  item's allowance and settled at zero, and the done mark; the ledger must then read the cap, nothing open and done. */
export function dryRun() {
  const dir = mkdtempSync(join(tmpdir(), "b2-dry-"));
  const lines: string[] = [];
  try {
    for (const i of ITEM_NAMES) {
      const path = join(dir, i + ".jsonl");
      approve(path, i, CAPS_USD[i], "dry run");
      const l = new Ledger(path, i), res = l.reserve("dry-session", toMicros(allowanceOf(i)), { kind_detail: "dry run: one session lease at the allowance" });
      if (!res.ok || res.existing) refuse(i + "'s ledger refused the dry run's lease");
      l.settle("dry-session", 0, { kind_detail: "dry run: settled at zero" });
      markDone(path, i);
      const t = itemTotals(readRows(path), i);
      if (t.cap !== toMicros(CAPS_USD[i]) || t.open || !t.done || t.settled) refuse(i + "'s dry-run ledger does not read back as approved, settled and done");
      lines.push("dry run " + i + ": approval $" + CAPS_USD[i] + ", one lease of $" + allowanceOf(i) + " opened and settled, done");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return lines;
}

// Section 8: an infrastructure session (no result, no model response, no verifier reward, no Codex rollout, or a Codex request
// at another effort or on another model) reruns once as attempt 2, and a second failure is a gap. Allowance stops, turn limits
// and model errors after a response are graded and never rerun; a cap stop never reruns.
export const needsRerun = (r: Pick<B2Row, "outcome">) => r.outcome === "infra";
export function infraRerun(first: B2Row[], second: B2Row[] = []) {
  const key = (r: B2Row) => r.task + "\t" + r.label, rerun = first.filter(needsRerun), again = new Map(second.map((r) => [key(r), r]));
  const stray = second.filter((r) => !rerun.some((x) => key(x) === key(r)));
  if (stray.length) throw new Error("E_USAGE b2 rerun: attempt 2 holds " + key(stray[0]!).replace("\t", " ") + ", which owed no rerun");
  return {
    rects: relaunchRects(rerun.map((r) => ({ task: r.task, arm: r.label, replicates: 1 }))),
    rerun: rerun.map(key),
    missing: rerun.filter((r) => again.has(key(r)) && again.get(key(r))!.outcome !== "graded").map(key),
    pending: rerun.filter((r) => !again.has(key(r))).map(key),
  };
}
export function attempt2Owed(runs: { part: string; dir: string }[]) {
  const cfgs = runs.map((r) => pulledInputs(r.dir, r.part));
  const jobs = cfgs.flatMap((c) => c.jobs), sessions = cfgs.flatMap((c) => c.sessions), requests = cfgs.flatMap((c) => c.requests);
  const rows = jobs.length ? buildB2Table({ jobs, sessions, requests }) : [];
  return { owed: rows.filter(needsRerun).map((r) => ({ task: r.task, arm: r.label, reason: r.reason })), rects: infraRerun(rows).rects };
}
export { ITEM_MODEL, MODELS };
