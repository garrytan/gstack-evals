// Copyright (c) 2026 Garry Tan. MIT License.
// A week's plan, items and money (lanes/weekly-stable/README.md, steps 4 and 5): the frozen task lists, the week's seed, the
// parts (the smoke, then S390's three parts of whole tasks), the launcher profile on L1's host and part machinery, the
// projections, the approval row and the launch guard.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostTtlHours, itemCheck, L1, plannedCells, prefixOf, relaunchRects, seeded, type ItemDef, type PartPlan, type Profile } from "../../quick/laneb/l1/l1.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { blockUsd } from "../delivery-route/money.ts";
import { frontMatterDigests, sha256, TASK_SETUP, VM_HOURS_PER_SESSION } from "../delivery-route/pins.ts";
import { CHANGE1, isWeeklyArm, MODEL, PART_CAPS, PILOT, PREREG, REPO, S390, S390_TASKS, TASK_SET, TASKS, WEEK_CAPS, WEEK_ITEM, WEEK_STOP, WEEKLY, WEEKLY_ARM_NAMES, WEEKLY_ARMS, type WeeklyArm } from "./pins.ts";

const pinErr = (m: string): never => { throw new Error("E_WEEKLY_PIN " + m); };
const usage = (m: string): never => { throw new Error("E_USAGE " + m); };

/** The week's seed: the first 4 bytes of SHA-256 of the UTC date string (YYYY-MM-DD), read big-endian (pre-run change 2). */
export const weekSeed = (date: string) => createHash("sha256").update(date, "utf8").digest().readUInt32BE(0);
/** The ISO week-year and week of a UTC date, and the record's release tag. */
export function isoWeek(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) usage("a week's date is YYYY-MM-DD, not " + date);
  const d = new Date(date + "T00:00:00Z"), day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear(), week = 1 + Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7);
  const nn = String(week).padStart(2, "0");
  return { year, week, label: year + "-W" + nn, tag: "weekly-" + year + "-w" + nn };
}
/** A week's base name, ws-<date> or ws-<date>-r<n>; part k's item is the base plus -<k>. */
export const weekBase = (date: string, remeasure = 0) => "ws-" + date + (remeasure ? "-r" + remeasure : "");
export const partItems = (base: string) => [1, 2, 3].map((k) => base + "-" + k);
export const partOf = (item: string) => Number(WEEK_ITEM.exec(item)?.[3] ?? usage("unknown item " + item + "; ws-<YYYY-MM-DD>[-r<n>]-<1|2|3> or " + PILOT.item));
export const baseOf = (item: string) => item.slice(0, item.lastIndexOf("-"));

function bundleText(file: string, want: string, repo = REPO): string {
  const text = readFileSync(join(repo, file), "utf8"), dir = file.slice(0, file.lastIndexOf("/")), name = file.slice(file.lastIndexOf("/") + 1);
  if (sha256(text) !== want || frontMatterDigests(readFileSync(join(repo, dir, "README.md"), "utf8")).get(name) !== want) pinErr(file + " is not the frozen list (sha256 " + want + ")");
  return text;
}
/** S390's 130 tasks in run order, its first 80 the preregistration's run lines; and the three pilot tasks. */
export function taskLists(repo = REPO): { run: string[]; pilot: string[] } {
  const lines = bundleText(TASKS.file, TASKS.sha256, repo).split("\n").filter(Boolean).map((l) => l.split(" "));
  const run80 = lines.filter((l) => l[0] === "run").map((l) => l[1]!), pilot = lines.filter((l) => l[0] === "pilot").map((l) => l[1]!);
  const run = bundleText(S390_TASKS.file, S390_TASKS.sha256, repo).split("\n").filter(Boolean);
  if (run80.length !== TASKS.run || pilot.length !== TASKS.pilot) pinErr(TASKS.file + " does not hold " + TASKS.run + " run and " + TASKS.pilot + " pilot lines");
  if (run.length !== S390.tasks || new Set(run).size !== run.length || run.slice(0, TASKS.run).join() !== run80.join()) pinErr(S390_TASKS.file + "'s first 80 are not the preregistration's run order");
  if (pilot.some((t) => run.includes(t))) pinErr("a pilot task is one of the 130");
  return { run, pilot };
}
/** S390's parts: whole tasks in run order, 44, 43 and 43, from the tasks the contamination check left. */
export function partTasks(run: string[]): string[][] {
  const base = Math.floor(run.length / S390.parts), extra = run.length % S390.parts, out: string[][] = [];
  for (let i = 0, at = 0; i < S390.parts; i++) { const n = base + (i < extra ? 1 : 0); out.push(run.slice(at, at + n)); at += n; }
  return out.filter((x) => x.length);
}

/** A week's part k, as its own item: item 1 runs the smoke (the pilot tasks on the candidate) first. Each part is three jobs
 *  in turn, so that every task's three candidate and three stable sessions and its none session sit in one part: job 1 runs
 *  all three arms interleaved, jobs 2 and 3 the candidate and stable. Each job's task and arm order is L1's seeded() from the
 *  week's seed. The pilot: its three tasks on every arm, in one job. */
export function weekPlan(item: string, run: string[], pilot: string[], dropped: string[], seed: number): PartPlan[] {
  const part = (p: string, rects: { tasks: string[]; arms: string[]; attempts: number }[]): PartPlan => ({ name: p, prefix: prefixOf(item, p), rects: seeded(rects, seed) });
  if (item === PILOT.item) return [part("pilot", [{ tasks: pilot, arms: [...WEEKLY_ARM_NAMES], attempts: 1 }])];
  const k = partOf(item), tasks = partTasks(run.filter((t) => !dropped.includes(t)))[k - 1] ?? usage("part " + k + " holds no task");
  return [...(k === 1 ? [part("smoke", [{ tasks: pilot, arms: ["candidate"], attempts: 1 }])] : []), part("s390-" + k, [
    { tasks, arms: [...WEEKLY_ARM_NAMES], attempts: 1 }, { tasks, arms: ["candidate", "stable"], attempts: 1 }, { tasks, arms: ["candidate", "stable"], attempts: 1 },
  ])];
}
export const sessionsOf = (p: PartPlan) => [...plannedCells(p).values()].reduce((a, b) => a + b, 0);
export function partProjection(p: PartPlan) {
  let model = 0;
  for (const [cell, n] of plannedCells(p)) { const arm = cell.split("\t")[1]!; model += toMicros(n * (isWeeklyArm(arm) ? WEEKLY_ARMS[arm].rateUsd : usage("a planned cell has arm " + arm))); }
  const sessions = sessionsOf(p);
  return { sessions, model, vm: toMicros(Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours))) * blockUsd) };
}
export const capOf = (item: string) => (item === PILOT.item ? PILOT.capUsd : PART_CAPS[partOf(item) - 1]!);
export const concurrentOf = (item: string) => (item === PILOT.item ? PILOT.concurrent : S390.concurrent);
const parallelUsd = (item: string, parts: PartPlan[]) => Math.min(concurrentOf(item), Math.max(0, ...parts.map(sessionsOf))) * MODEL.allowanceUsd;
/** Expected model spend at the planning rates, the open-session reserve and the VM share, against the item's cap. */
export function projection(item: string, parts: PartPlan[]) {
  const proj = parts.map(partProjection), expected = fromMicros(proj.reduce((x, p) => x + p.model, 0));
  const vm = fromMicros(proj.reduce((x, p) => x + p.vm, 0)) + hostTtlHours(parts.length) * L1.host.usdPerHour;
  return { sessions: proj.reduce((x, p) => x + p.sessions, 0), expected, parallel: parallelUsd(item, parts), vm, cap: capOf(item) };
}

export type WeekState = { date: string; base: string; seed: number; candidate: string; stable: string; stable_tag: string; dropped: string[] };
export function profileFor(item: string, week: WeekState | null, repo = REPO): Profile {
  const lists = taskLists(repo), seed = week?.seed ?? weekSeed(new Date().toISOString().slice(0, 10));
  const def: ItemDef = { capUsd: capOf(item), taskSet: TASK_SET.name, cells: MODEL.cells, allowanceUsd: MODEL.allowanceUsd, model: MODEL.id };
  return {
    items: { [item]: def },
    armSpecs: Object.fromEntries(WEEKLY_ARM_NAMES.map((a) => [a, WEEKLY_ARMS[a].spec])),
    tars: [...WEEKLY_ARM_NAMES],
    armManifests: WEEKLY.armManifests,
    hostRoot: WEEKLY.hostRoot,
    ledgerPort: WEEKLY.ledgerPort,
    seed,
    concurrent: concurrentOf(item),
    taskSetup: TASK_SETUP,
    attempt2: { skip: () => null, owed: (runs) => owedReruns(runs) },
    parts: (name, _frozen, inputs) => {
      for (const dir of [PREREG, CHANGE1]) for (const [f, d] of frontMatterDigests(readFileSync(join(repo, dir, "README.md"), "utf8"))) inputs[dir.split("/").pop() + "/" + f] = d;
      if (week) { inputs["week:candidate"] = week.candidate; inputs["week:stable"] = week.stable; inputs["week:dropped"] = week.dropped.join(",") || "-"; }
      return weekPlan(name, lists.run, lists.pilot, week?.dropped ?? [], seed);
    },
  };
}
let owedReruns: (runs: { part: string; dir: string }[]) => { owed: { task: string; arm: string; reason: string }[]; rects: ReturnType<typeof relaunchRects> } = () => ({ owed: [], rects: [] });
/** read.ts registers the rerun rule here (an infrastructure session reruns once), so plan.ts holds no table code. */
export const setOwedReruns = (f: typeof owedReruns) => { owedReruns = f; };

// ---- Money: the approval row, the item totals and the launch guard.
export function approve(path: string, item: string, capUsd: number, by: string) {
  if (!by.trim()) usage("weekly approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(capOf(item))) usage("refused: " + item + "'s recorded cap is $" + capOf(item) + ", not $" + capUsd);
  if (readRows(path).length) usage("refused: " + path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, item).approve(capUsd, { approved_by: by, source: item === PILOT.item ? "weekly stable number: the one-time pilot's $" + PILOT.capUsd + " cap (pre-run change 3)" : "weekly stable number: part " + partOf(item) + "'s share of the week's $" + (WEEK_CAPS.model + WEEK_CAPS.ubicloud) + " paid cap" });
  itemCheck(readRows(path), item, capOf(item));
}
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
export function totals(rows: Row[], item: string) {
  const t = { cap: toMicros(capOf(item)), settled: 0, open: 0, openIds: [] as string[], done: rows.some((r) => r.kind === "note" && r.id === "done"), vmSettled: 0, vmOpen: 0, hostOpen: false };
  if (!rows.length) return t;
  const approval = rows.find((r) => r.kind === "approval");
  if (!approval || approval.item !== item || approval.usd_micros !== t.cap) usage("refused: the ledger for " + item + " does not open with its approval row at $" + capOf(item));
  const reserved = new Map<string, number>(), settled = new Map<string, number>();
  for (const r of rows) { if (r.kind === "reserve") reserved.set(r.id, r.usd_micros); if (r.kind === "settle") settled.set(r.id, r.usd_micros); }
  for (const [id, v] of settled) { t.settled += v; if (VM_ID.test(id)) t.vmSettled += v; }
  for (const [id, v] of reserved) { if (settled.has(id)) continue; t.open += v; t.openIds.push(id); if (VM_ID.test(id)) t.vmOpen += v; if (/^host-\d+$/.test(id)) t.hostOpen = true; }
  return t;
}
export function markDone(path: string, item: string) {
  const t = totals(readRows(path), item);
  if (t.done) usage("refused: " + item + " is marked done already");
  if (t.openIds.length) usage("refused: " + item + " still holds " + t.openIds.length + " open reservations; settle them first");
  appendRow(path, { ts: new Date().toISOString(), item, kind: "note", id: "done", usd_micros: 0 });
}
/** One item's projection: its spend so far plus its unfinished parts at planned spend, the open-session reserve and the VM
 *  and host shares. The pilot's is its last pair's peak (pre-run change 3): its spend so far, the sessions before the last
 *  pair settled at expected cost, the last pair reserved at the allowance, one VM block and the host's reserve. counted is
 *  what the item adds to the week's all-in sum. */
function itemProjection(item: string, rows: Row[], plan: { parts: PartPlan[]; finished: string[] }, relaunching?: string) {
  const t = totals(rows, item), left = relaunching ? [] : plan.parts.filter((p) => !plan.finished.includes(p.name)), proj = left.map(partProjection);
  const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
  const sessions = proj.reduce((x, p) => x + p.sessions, 0), pair = Math.min(concurrentOf(item), sessions);
  const lastPair = sessions ? Math.round((proj.reduce((x, p) => x + p.model, 0) * (sessions - pair)) / sessions) + toMicros(pair * MODEL.allowanceUsd) : 0;
  const total = item === PILOT.item
    ? t.settled + t.open + (left.length ? lastPair + toMicros(blockUsd) + host : 0)
    : t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + toMicros(left.length ? parallelUsd(item, left) : 0) + t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
  return { item, ...t, total, left: left.length, counted: t.done ? t.settled : Math.max(t.settled + t.open, total) };
}
/** The launch guard. The item's projection against its cap; for a week's part, every part's projection plus the weekly
 *  thread's own meter against the $645 week stop. A relaunch is never refused on money: an overshoot prints OVERSHOOT for
 *  the Captain and the relaunch salvages first. */
export function guard(item: string, ledgers: Record<string, Row[]>, plans: Record<string, { parts: PartPlan[]; finished: string[] }>, meterUsd: number, relaunching?: string) {
  const why: string[] = [], usd = (m: number) => "$" + fromMicros(m).toFixed(2), week = item !== PILOT.item;
  const items = week ? partItems(baseOf(item)) : [item];
  const all = items.map((i) => itemProjection(i, ledgers[i] ?? [], plans[i] ?? usage("the guard has no plan for " + i), i === item ? relaunching : undefined));
  const own = all.find((x) => x.item === item)!, sum = all.reduce((x, i) => x + i.counted, 0) + (week ? toMicros(meterUsd) : 0);
  if (own.done) why.push(item + " is marked done; a done item never launches again");
  const money: string[] = [];
  if (own.total > own.cap) money.push(item + "'s projection " + usd(own.total) + " passes its cap " + usd(own.cap));
  if (week && sum > toMicros(WEEK_STOP)) money.push("all-in " + usd(sum) + ", every part with the weekly thread's meter, passes the $" + WEEK_STOP + " week stop");
  if (!relaunching) why.push(...money);
  const over = !why.length && money.length ? ["  relaunch of " + relaunching + " runs anyway, salvage first; report to the Captain at once: " + money.join("; ")] : [];
  const lines = ["WEEKLY_LAUNCH " + (why.length ? "REFUSE" : over.length ? "OVERSHOOT" : "PASS") + " " + item + ": " + usd(own.total) + " of cap " + usd(own.cap) + " (" + own.left + " parts to run)" + (week ? "; all-in " + usd(sum) + " of $" + WEEK_STOP : ""), ...over,
    ...all.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", counted " + usd(i.counted)), ...(week ? ["  meter " + usd(toMicros(meterUsd))] : [])];
  return { ok: !why.length, why, lines, total: own.total };
}
export const weeklyArmOf = (a: string): WeeklyArm => (isWeeklyArm(a) ? a : usage("arm " + a + " is not a weekly arm"));
