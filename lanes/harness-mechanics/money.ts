// Copyright (c) 2026 Garry Tan. MIT License.
// Section 22's money on the Lane B ledger (quick/laneb/runner/ledger.ts) and L1's host and part machinery: each item's
// approval row at its recorded cap, the item's done mark, the launch guard (the 3,000 line all-in, and the C1 guard: the
// item's projected model spend plus its VM share against its cap), section 13's infrastructure rerun, and dry-run steps
// 6-ledger, leases-per-item and reserve-mechanics on a temporary ledger.
// A session reserves its allowance on the item's ledger as it opens (the metering proxy), so a launch of six parallel
// sessions holds six allowances open; each settles at its metered cost. A refused reserve latches the proxy's cap stop:
// the sessions already open finish inside their own reserves, no session opens after it, and a cap stop is never relaunched
// (l1.ts relaunch) or rerun (infraRerun).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostTtlHours, itemCheck, L1, plannedCells, relaunchRects, type PartPlan } from "../../quick/laneb/l1/l1.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import type { HmArm, HmSessionRow } from "../../src/types.ts";
import { bundleLists, CAPS_USD, CARVED, HM, JUDGE, MODELS, NO_GSTACK, RATES_USD, REPLAY, VM_HOURS_PER_SESSION, type ModelKey } from "./pins.ts";
import { ITEMS, itemPlan } from "./plans.ts";
import { buildHmTable, hmRow } from "./table.ts";

export type Item = keyof typeof CAPS_USD;
export const isItem = (x: string): x is Item => Object.hasOwn(CAPS_USD, x);
const usd = (m: number) => "$" + fromMicros(m).toFixed(2);
const refuse = (m: string): never => { throw new Error("E_USAGE refused: " + m); };
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
const blockUsd = Number(L1.vm.usdPerHour) * Number(L1.vm.reserveHours);

// The approval row an item's ledger starts with, at the item's recorded cap and no other amount.
export function approve(path: string, item: string, capUsd: number, by: string) {
  if (!isItem(item)) throw new Error("E_USAGE hm approve: unknown item " + item + "; one of " + Object.keys(CAPS_USD).join(", "));
  if (!by.trim()) throw new Error("E_USAGE hm approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(CAPS_USD[item])) refuse(item + "'s recorded cap is $" + CAPS_USD[item] + ", not $" + capUsd);
  if (readRows(path).length) refuse(path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, item).approve(capUsd, { approved_by: by, source: "harness mechanics prereg section 22: the cap recorded for " + item });
  itemCheck(readRows(path), item, CAPS_USD[item]);
}

// An item is done once every launch has settled: a note row with id done, refused while a reservation is open.
export function markDone(path: string, item: Item) {
  const t = itemTotals(readRows(path), item);
  if (t.done) refuse(item + " is marked done already");
  if (t.openIds.length) refuse(item + " still holds " + t.openIds.length + " open reservations (" + t.openIds.slice(0, 3).join(", ") + "); settle them first");
  appendRow(path, { ts: new Date().toISOString(), item, kind: "note", id: "done", usd_micros: 0 });
}

// D6 (the Captain's pick A, 2026-11-10): Stage 1's items were marked done before hm pick ran, and host-up refuses a done
// item. So hm done now reads the work dir prepare wrote: an item whose hm.json plans picker calls is done only once
// <work>/pick/picks.jsonl holds a pick for every task its plan.json runs in both none and plain-2. vms and stage2-replay
// plan no sessions and need no work dir.
const NO_WORK: Item[] = ["vms", "stage2-replay", "stage2-replay-2", "stage2-replay-3"];
export function doneCheck(item: Item, work: string | undefined) {
  if (NO_WORK.includes(item)) return;
  if (!work) return refuse("hm done needs --work <work> for " + item + ", so it can check the item's pick records (D6)");
  const hm = existsSync(join(work, "hm.json")) ? JSON.parse(readFileSync(join(work, "hm.json"), "utf8")) : null;
  if (!hm) return refuse(work + " holds no hm.json, so " + item + "'s picker plan cannot be checked");
  if (hm.item !== item) refuse(work + " is " + hm.item + "'s work dir, not " + item + "'s");
  if (!hm.picker_calls) return;
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const tasks = (a: string) => new Set<string>(plan.parts.flatMap((x: any) => x.rects.filter((r: any) => r.arms.includes(a)).flatMap((r: any) => r.tasks)));
  const plain = tasks("plain-2"), pairs = [...tasks("none")].filter((t) => plain.has(t)), f = join(work, "pick", "picks.jsonl");
  const picked = new Set(existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).task) : []);
  const gap = pairs.filter((t) => !picked.has(t));
  if (gap.length) refuse(item + " has " + gap.length + " of " + pairs.length + " picker pairs with no pick record in " + f + " (" + gap.slice(0, 3).join(", ") + "); run hm pick before done");
}

export type ItemTotals = { cap: number; settled: number; open: number; openIds: string[]; done: boolean; vmSettled: number; vmOpen: number; hostOpen: boolean };
export function itemTotals(rows: Row[], item: Item): ItemTotals {
  const cap0 = toMicros(CAPS_USD[item]);
  if (!rows.length) return { cap: cap0, settled: 0, open: 0, openIds: [], done: false, vmSettled: 0, vmOpen: 0, hostOpen: false };
  const approvals = rows.filter((r) => r.kind === "approval");
  if (!approvals.length || approvals[0]!.item !== item) throw new Error("E_USAGE hm ledger: the ledger given for " + item + " has no approval row for it");
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

// The crew file the operator writes from each thread's Capy counter on this line; dollars are credits / 1000.
export type HmCrew = { as_of: string; threads: { code: string; credits: number }[] };
export function crewMicros(crew: HmCrew) {
  if (typeof crew?.as_of !== "string" || !Array.isArray(crew.threads)) throw new Error("E_USAGE hm ceiling: the crew file needs as_of and threads [{code, credits}]");
  for (const t of crew.threads) if (typeof t?.code !== "string" || typeof t.credits !== "number" || !(t.credits >= 0)) throw new Error("E_USAGE hm ceiling: crew thread " + JSON.stringify(t?.code) + " needs credits, a number of at least 0");
  return toMicros(crew.threads.reduce((x, t) => x + t.credits, 0) / 1000);
}

// The line all-in: each item's settled and open spend, an item not done at the larger of that and its cap, plus the crew.
// A carved item (CARVED) has its cap inside its parent's, so it counts at its spent until the parent is done.
export function lineCheck(ledgers: Partial<Record<Item, Row[]>>, crew: HmCrew) {
  const items = (Object.keys(CAPS_USD) as Item[]).map((item) => {
    const t = itemTotals(ledgers[item] ?? [], item), spent = t.settled + t.open, parent = CARVED[item];
    const capped = !t.done && (!parent || itemTotals(ledgers[parent] ?? [], parent).done);
    return { item, ...t, counted: capped ? Math.max(t.cap, spent) : spent };
  });
  const crewSpent = crewMicros(crew), total = items.reduce((x, i) => x + i.counted, 0) + crewSpent;
  return { items, crew: crewSpent, total, line: toMicros(HM.lineUsd), fits: total <= toMicros(HM.lineUsd) };
}

// The skeleton's planning sum (D14): the line's count of the items, so a done item counts at its settled once its done row is
// in its ledger and every other item at its cap, plus the crew's cap in place of its spend.
export function plannedLine(ledgers: Partial<Record<Item, Row[]>>) {
  const l = lineCheck(ledgers, { as_of: "plan", threads: [] }), total = l.total + toMicros(HM.crewCapUsd);
  return { items: l.items, total, line: l.line, fits: total <= l.line };
}

const modelKey = (id: string) => (Object.keys(MODELS) as ModelKey[]).find((k) => MODELS[k].id === id) ?? refuse("no planning rate for model " + id);
export const armRate = (arm: string, m: ModelKey) => (NO_GSTACK.includes(arm as HmArm) ? RATES_USD.none : JUDGE.includes(arm as HmArm) ? RATES_USD.judge : RATES_USD.told)[m];
// A part's planned model spend (sessions at section 22's planning rates, and a picker call for each task with none and
// plain-2), and its part VM's reserve: launch.sh's blocks at L1's rate for the hours its sessions take.
export function partProjection(item: Item, p: PartPlan) {
  const m = modelKey(p.model ?? ITEMS[item]!.model), cells = [...plannedCells(p).entries()];
  const sessions = cells.reduce((x, [, n]) => x + n, 0);
  const arms = (a: string) => new Set(cells.filter(([k]) => k.endsWith("\t" + a)).map(([k]) => k.split("\t")[0]));
  const plain = arms("plain-2"), pickers = [...arms("none")].filter((t) => plain.has(t)).length;
  const model = toMicros(cells.reduce((x, [k, n]) => x + n * armRate(k.split("\t")[1]!, m), 0) + pickers * RATES_USD.picker);
  const blocks = Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours)));
  return { sessions, pickers, model, vm: toMicros(blocks * blockUsd) };
}

// The C1 guard: the item's model spend so far, its parts still to run at their planned spend, and the parallel reserve its
// sessions hold open (concurrent x allowance), plus its VM share (VM rows so far, the awake host's reserve for its TTL when no
// host reserve is open, and each part still to run at its part-VM blocks), against the item's cap.
export function c1Guard(item: Item, rows: Row[], parts: PartPlan[], finished: string[]) {
  const t = itemTotals(rows, item), left = parts.filter((p) => !finished.includes(p.name)), proj = left.map((p) => partProjection(item, p));
  const parallel = toMicros(HM.concurrent * ITEMS[item]!.allowanceUsd);
  const model = t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + parallel;
  const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
  const vm = t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
  return { item, cap: t.cap, model, parallel, vm, host, parts_left: left.length, total: model + vm, fits: model + vm <= t.cap };
}

// Before each launch: the line and the C1 guard. A refusal names what doesn't fit, for the lead to take to the Captain, who
// can move room from the vms item to this one and leave the total unchanged.
export function launchGuard(item: string, ledgers: Partial<Record<Item, Row[]>>, crew: HmCrew, parts: PartPlan[], finished: string[]) {
  if (!isItem(item) || !ITEMS[item]) throw new Error("E_USAGE hm launch guard: " + item + " is not a session item (" + Object.keys(ITEMS).join(", ") + ")");
  const line = lineCheck(ledgers, crew), c1 = c1Guard(item, ledgers[item] ?? [], parts, finished);
  const done = line.items.find((i) => i.item === item)!.done;
  const why: string[] = [];
  if (done) why.push(item + " is marked done; a done item never launches again");
  const parent = CARVED[item], pt = parent ? itemTotals(ledgers[parent] ?? [], parent) : null;
  if (parent && !pt!.done) why.push(item + "'s cap sits inside " + parent + "'s, so it launches only once " + parent + " is marked done");
  else if (parent && pt!.settled + toMicros(CAPS_USD[item]) !== toMicros(CAPS_USD[parent])) why.push(item + "'s cap " + usd(toMicros(CAPS_USD[item])) + " is not " + parent + "'s cap less its settled " + usd(pt!.settled));
  if (!line.fits) why.push("the line: all-in " + usd(line.total) + " (items " + usd(line.total - line.crew) + " with each item not done at its cap, crew " + usd(line.crew) + ") passes " + usd(line.line));
  if (!c1.fits) why.push("C1: " + item + "'s projection " + usd(c1.total) + " (model " + usd(c1.model) + " with the " + usd(c1.parallel) + " parallel reserve, VM share " + usd(c1.vm) + ") passes its cap " + usd(c1.cap) + " by " + usd(c1.total - c1.cap));
  const lines = [
    "HM_LAUNCH " + (why.length ? "REFUSE" : "PASS") + " " + item + ": line all-in " + usd(line.total) + " of " + usd(line.line) + "; C1 " + usd(c1.total) + " of cap " + usd(c1.cap) + " (model " + usd(c1.model) + ", VM share " + usd(c1.vm) + ", " + c1.parts_left + " parts to run)",
    ...line.items.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", cap " + usd(i.cap) + ", counted " + usd(i.counted)),
    "  crew " + usd(line.crew),
  ];
  return { ok: !why.length, why, lines, line, c1 };
}

// Sessions through the real ledger the way the proxy runs them: up to concurrent open, each reserving its allowance as it
// opens and settling at its metered cost (a session that reaches its allowance stops there: an allowance stop).
export function runSessions(ledger: Ledger, prefix: string, costsUsd: number[], allowanceUsd: number, concurrent: number = HM.concurrent) {
  const open: { id: string; cost: number }[] = [];
  let i = 0, capStop: string | null = null, allowanceStops = 0, maxCommitted = 0;
  const close = () => {
    const s = open.shift()!, cost = Math.min(s.cost, allowanceUsd);
    if (s.cost >= allowanceUsd) allowanceStops++;
    const r = ledger.settle(s.id, toMicros(cost), { allowance_stop: s.cost >= allowanceUsd });
    if (!r.ok) throw new Error("E_INTERNAL settle " + s.id + ": " + r.reason);
  };
  while (i < costsUsd.length) {
    if (open.length >= concurrent) close();
    const id = prefix + "s" + (i + 1), r = ledger.reserve(id, toMicros(allowanceUsd));
    if (!r.ok) { const t = r.totals; capStop = "ledger refused " + id + ": settled " + usd(t.settledMicros) + " + open " + usd(t.openReservedMicros) + " + " + usd(toMicros(allowanceUsd)) + " passes the cap " + usd(t.capMicros); break; }
    open.push({ id, cost: costsUsd[i]! });
    i++;
    const s = ledger.status();
    maxCommitted = Math.max(maxCommitted, s.settledMicros + s.openReservedMicros);
  }
  while (open.length) close();
  return { started: i, notRun: costsUsd.length - i, capStop, allowanceStops, maxCommitted, status: ledger.status() };
}

// Section 13: a session that ends with no successful response reruns once as attempt 2, and a second failure is missing.
// Allowance stops, turn-limit stops and model errors after a response never rerun, and a cap stop never reruns. A session
// with no verifier reward is a verifier infrastructure error and reruns once.
const NO_RESPONSE = /^(no result\.json|no model response reached the agent|sidecar reset \(D5\)|no verifier reward)/;
export const needsRerun = (r: Pick<HmSessionRow, "outcome" | "reason">) => r.outcome === "infra" && NO_RESPONSE.test(r.reason);
export function infraRerun(first: HmSessionRow[], second: HmSessionRow[] = []) {
  const key = (r: HmSessionRow) => r.task + "\t" + r.arm, rerun = first.filter(needsRerun), again = new Map(second.map((r) => [key(r), r]));
  const stray = second.filter((r) => !rerun.some((x) => key(x) === key(r)));
  if (stray.length) throw new Error("E_USAGE hm rerun: attempt 2 holds " + key(stray[0]!).replace("\t", " ") + ", which owed no rerun");
  return {
    rects: relaunchRects(rerun.map((r) => ({ task: r.task, arm: r.arm, replicates: 1 }))),
    rerun: rerun.map(key),
    missing: rerun.filter((r) => again.has(key(r)) && !["graded", "contaminated"].includes(again.get(key(r))!.outcome)).map(key),
    pending: rerun.filter((r) => !again.has(key(r))).map(key),
  };
}

// The launcher's attempt 2 (plans.ts HM_PROFILE.attempt2, l1.ts rerun): the sessions needsRerun picks in a part's pulled
// results and its relaunch's, each with its reason, and infraRerun's rectangles for them. Only the outcome class is read.
export function attempt2Owed(runs: { part: string; dir: string }[]) {
  const jobs = runs.flatMap((r) => {
    const d = join(r.dir, "jobs");
    return existsSync(d) ? readdirSync(d).filter((j) => statSync(join(d, j)).isDirectory()).map((j) => ({ dir: join(d, j), part: r.part })) : [];
  });
  const rows = jobs.length ? buildHmTable({ jobs, sessions: runs.map((r) => join(r.dir, "out/proxy-sessions.jsonl")).filter((f) => existsSync(f)) }) : [];
  return { owed: rows.filter(needsRerun).map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: infraRerun(rows).rects };
}

// The reserve per launch: a session item's parallel allowances; vms leases one part-VM block; the replay, which runs no
// sessions, leases its expected spend times section 22's margin for its one run (replay.ts runReplay).
export const leaseUsd = (item: Item) => (ITEMS[item] ? HM.concurrent * ITEMS[item]!.allowanceUsd : item === "vms" ? blockUsd : item === "stage2-replay" ? REPLAY.m * REPLAY.expectedUsd : item === "stage2-replay-2" || item === "stage2-replay-3" ? CAPS_USD[item] : null);

type StepResult = { pass: boolean; detail: string };
const tmpLedgers = (out: string) => { const d = mkdtempSync(join(tmpdir(), "hm-ledger-")); mkdirSync(out, { recursive: true }); return d; };

// leases-per-item: every item's approval at its cap (another amount refused), then one lease opened and settled on it.
export function stepLeases(out: string): StepResult {
  const dir = tmpLedgers(out), lines: string[] = [];
  for (const item of Object.keys(CAPS_USD) as Item[]) {
    const p = join(dir, item + ".jsonl");
    try { approve(p, item, CAPS_USD[item] + 10, "dry run"); return { pass: false, detail: item + " took an approval at $" + (CAPS_USD[item] + 10) }; } catch (e) { if (!/^E_USAGE refused/.test((e as Error).message)) throw e; }
    approve(p, item, CAPS_USD[item], "dry run");
    const lease = leaseUsd(item) ?? 1, l = new Ledger(p, item), id = item + "/dry/lease-1";
    if (!l.reserve(id, toMicros(lease)).ok) return { pass: false, detail: item + " refused its lease of $" + lease };
    if (!l.settle(id, toMicros(lease / 2)).ok) return { pass: false, detail: item + " refused the lease's settle" };
    const t = itemTotals(readRows(p), item);
    if (t.open || t.settled !== toMicros(lease / 2) || t.cap !== toMicros(CAPS_USD[item])) return { pass: false, detail: item + " totals after one lease are off" };
    try { itemCheck(readRows(p), item, CAPS_USD[item]); return { pass: false, detail: item + " would serve a second run" }; } catch {}
    lines.push(item + " cap $" + CAPS_USD[item] + " lease $" + lease.toFixed(2) + " settled $" + (lease / 2).toFixed(2));
  }
  writeFileSync(join(out, "leases-per-item.txt"), lines.join("\n") + "\n");
  return { pass: true, detail: lines.length + " items approved at their caps (other amounts refused), one lease opened and settled each, none serves a second run" };
}

// reserve-mechanics: every session item's planned sessions through the real ledger at its planning rates (it completes,
// with its VM rows, and the C1 guard fits), then at its allowance (it cap-stops, never past its cap). Prints the reserve
// check per item.
export function stepReserve(out: string): StepResult {
  const dir = tmpLedgers(out), l = bundleLists(), lines: string[] = [], bad: string[] = [];
  for (const item of Object.keys(CAPS_USD) as Item[]) {
    const lease = leaseUsd(item), cap = CAPS_USD[item];
    if (!ITEMS[item]) { lines.push("RESERVE " + item + ": cap $" + cap + ", reserve per launch " + (lease ? "$" + lease.toFixed(2) + " (one part-VM block)" : "set by the replay's unit") + ", room for settled spend $" + (cap - (lease ?? 0)).toFixed(2)); continue; }
    const parts = itemPlan(item, l).parts, guard = c1Guard(item, [], parts, []);
    for (const [mode, k] of [["rates", 0], ["allowance", 1]] as const) {
      const p = join(dir, item + "-" + mode + ".jsonl");
      approve(p, item, cap, "dry run");
      const ledger = new Ledger(p, item);
      if (!ledger.reserve("host-1", toMicros(hostTtlHours(parts.length) * L1.host.usdPerHour)).ok) { bad.push(item + " " + mode + ": host reserve refused"); continue; }
      let stop: string | null = null, ran = 0, planned = 0;
      for (const part of parts) {
        const m = modelKey(part.model ?? ITEMS[item]!.model), allowance = part.model ? MODELS[m].allowanceUsd : ITEMS[item]!.allowanceUsd, proj = partProjection(item, part);
        const costs = [...plannedCells(part).entries()].flatMap(([key, n]) => Array.from({ length: n }, () => (k ? allowance : armRate(key.split("\t")[1]!, m))));
        planned += costs.length;
        if (stop) continue;
        if (!ledger.reserve(part.prefix + "vm", proj.vm).ok) { stop = part.prefix + "vm refused"; continue; }
        const r = runSessions(ledger, part.prefix, costs, allowance);
        ledger.settle(part.prefix + "vm", toMicros(costs.length * VM_HOURS_PER_SESSION * Number(L1.vm.usdPerHour)));
        ran += r.started;
        if (r.maxCommitted > toMicros(cap)) bad.push(item + " " + mode + ": committed passed the cap");
        if (r.capStop) stop = r.capStop;
      }
      const s = ledger.status();
      if (s.settledMicros + s.openReservedMicros > toMicros(cap)) bad.push(item + " " + mode + ": settled plus open passes the cap");
      if (!k && (stop || ran !== planned)) bad.push(item + " at planning rates stopped: " + stop);
      if (k && !stop) bad.push(item + " at its allowance never cap-stopped");
      if (k) lines.push("RESERVE " + item + ": cap $" + cap + ", reserve per launch $" + lease!.toFixed(2) + " (" + HM.concurrent + " x $" + ITEMS[item]!.allowanceUsd + "), room for settled spend $" + (cap - lease!).toFixed(2) + "; C1 projection " + usd(guard.total) + (guard.fits ? " fits" : " DOES NOT FIT") + "; at the allowance it cap-stops after " + ran + " of " + planned + " sessions, incomplete");
    }
    if (!guard.fits) bad.push(item + " C1 projection " + usd(guard.total) + " passes its cap");
  }
  writeFileSync(join(out, "reserve-mechanics.txt"), [...lines, ...bad.map((b) => "BAD " + b)].join("\n") + "\n");
  return { pass: !bad.length, detail: bad.length ? bad[0]! : "every item completes at its planning rates inside its cap and cap-stops at its allowance without passing it; reserve-mechanics.txt holds the check per item" };
}

// 6-ledger: an allowance stop, a cap stop and the infrastructure rerun, through hm's table rows and the real ledger.
export function stepLedger(out: string): StepResult {
  const dir = tmpLedgers(out), job = join(dir, "job");
  const trial = (name: string, arm: string, reward: number | null, result = true) => {
    const d = join(job, name);
    mkdirSync(join(d, "evaluator"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: MODELS.opus.id } }, task: { path: "tasks/" + name.split("__")[0] } }));
    if (result) writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, ...(reward === null ? {} : { verifier_result: { rewards: { reward } } }) }));
    writeFileSync(join(d, "evaluator", "sdk-messages.jsonl"), "");
    return d;
  };
  const sess = (ok: number, refused: number, spent: number) => [{ ok_responses: ok, refused_budget: refused, spent_micros: spent, closed_at: "x" } as any];
  const row = (d: string, s: any[]) => hmRow(d, { part: "s1-1", sessions: new Map([[d.split("/").at(-1)!, s]]), home: "/root" })!;
  const allow = row(trial("ta__1", "none", 0), sess(9, 1, toMicros(5)));
  if (allow.outcome !== "graded" || !allow.allowance_stop || needsRerun(allow)) return { pass: false, detail: "the allowance stop did not score as a graded session that never reruns: " + allow.reason };
  const p = join(dir, "stage1-opus.jsonl");
  approve(p, "stage1-opus", CAPS_USD["stage1-opus"], "dry run");
  const ledger = new Ledger(p, "stage1-opus"), a = runSessions(ledger, "stage1-opus/s1-1/", [5, 0.4, 0.4], 5);
  if (a.allowanceStops !== 1 || a.capStop) return { pass: false, detail: "the allowance stop on the ledger is off" };
  const c = runSessions(ledger, "stage1-opus/s1-2/", Array(40).fill(5), 5);
  const s = ledger.status();
  if (!c.capStop || c.notRun < 1 || s.settledMicros + s.openReservedMicros > s.capMicros || s.openIds.length) return { pass: false, detail: "the cap stop is off" };
  const cap = { ...allow, outcome: "cap_stop" as const, reason: "ledger cap stop", task: "tc" };
  const none = row(trial("tb__1", "none", null), sess(0, 0, 0)), lost = row(trial("tb__2", "plain-2", null, false), []);
  const after = row(trial("tb__3", "verify-hook", null), sess(4, 0, toMicros(1)));
  const r1 = infraRerun([allow, cap, none, lost, after]);
  if (r1.rerun.length !== 3 || after.outcome !== "infra" || !needsRerun(after) || needsRerun(cap)) return { pass: false, detail: "rerun picked " + r1.rerun.join(", ") };
  const again = row(trial("tb__1b", "none", 1), sess(3, 0, toMicros(1))), again2 = row(trial("tb__2b", "plain-2", null), sess(0, 0, 0)), again3 = row(trial("tb__3b", "verify-hook", 0), sess(4, 0, toMicros(1)));
  const r2 = infraRerun([allow, cap, none, lost, after], [{ ...again, task: none.task }, { ...again2, task: lost.task }, { ...again3, task: after.task }]);
  if (r2.missing.length !== 1 || r2.missing[0] !== lost.task + "\tplain-2" || r2.pending.length) return { pass: false, detail: "attempt 2 left missing " + r2.missing.join(", ") };
  writeFileSync(join(out, "6-ledger.txt"), ["allowance stop: " + allow.reason, "cap stop: " + c.capStop + "; " + c.notRun + " sessions never ran", "rerun: " + r1.rerun.join(", ") + "; missing after attempt 2: " + r2.missing.join(", ")].join("\n").replaceAll("\t", " ") + "\n");
  return { pass: true, detail: "an allowance stop scores graded and never reruns; a cap stop stops the item incomplete (" + c.notRun + " sessions never ran) and never reruns; two sessions with no response and one with no verifier reward rerun as attempt 2, and one second failure is missing" };
}
