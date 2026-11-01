// R3a, the screen (GEVA-101 prereg, section 4.3; build spec 4.8 item 5). One command runs it, writes the admitted list,
// the pilot exposure and the measured costs, and prints the projection:
//   bun quick/laneb/r3/screen.ts all <work dir>       prepare, run and analyze, in order
//   bun quick/laneb/r3/screen.ts prepare <work dir>   env LEDGER (r3a-screen's jsonl), SWEBV (harbor-datasets checkout), ARMS (arm tar dir)
//   bun quick/laneb/r3/screen.ts run <work dir>       env LEDGER, UBI_OWNER, VM_USD_PER_HOUR, the provider keys; launches screen, then pilot
//   bun quick/laneb/r3/screen.ts analyze <work dir>   env LEDGER; reads the pulled results
// R3a is one none trial on Opus 5.5 for each of the 93 tasks and one told trial on each of 10 tasks drawn with seed
// 20261101, every arm on claude-code-preset (GSTA-2 ruling). Both batches and their VM hours settle to item r3a-screen.
// The item serves one run: prepare refuses a ledger that already holds a reserve or settle, and run binds the item before
// its first spend by creating <LEDGER>.bound, so any later run is refused. A cap refusal (a VM block, a session reserve
// or the batch cap) stops the run, and analyze then reports it incomplete and admits nothing. So does a part whose
// trials are not one per planned task: a planned task with no trial, a second trial for a task, or a stray trial. So does
// a part with more than 10% infra trials, or a pulled proxy file that is empty or unparseable (GSTA-2 rulings).
// Exit codes, as r3-dry.ts: 0 admission passed (R3b waits for Garry's caps), 4 incomplete, 5 saturation, 6 pilot
// FIX-METHOD; 2 usage, 1 any other error.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readSessionRows, rng } from "../analysis/analyze.ts";
import { fromMicros, readRows, totals } from "../runner/ledger.ts";
import { loadSwebvTasks, R3_BAND_SHA256 } from "../runner/materialize.ts";
import { loadR3Jobs, type R3Trial } from "./exposure.ts";

export const ITEM = "r3a-screen";
export const CAP_USD = 150;
export const OPUS = "claude-opus-5-5";
export const PILOT = { tasks: 10, seed: 20261101 };
export const ADMISSION = { minAdmitted: 30, pilotMinExposed: 7, nMax: 70, r3bSeed: 20261102, particleTrialUsd: 0.15 };
export const ALLOWANCE_USD: Record<string, number> = { "claude-opus-5-5": 4, "particle-1": 1 };
// Every R3 arm, as prepare-run's arms entries. told and placebo open the prompt with /investigate (the placebo's skill of
// the same name); none is never told. R3b runs Opus none and gstack, and particle-1 none, gstack and placebo.
export const R3_ARMS = {
  none: "none:system_prompt=claude-code-preset",
  gstack: "gstack:told=investigate:system_prompt=claude-code-preset",
  placebo: "placebo:told=investigate:system_prompt=claude-code-preset",
} as const;
export const R3_CELLS: Record<string, (keyof typeof R3_ARMS)[]> = { "claude-opus-5-5": ["none", "gstack"], "particle-1": ["none", "gstack", "placebo"] };
const PARTS = [
  { name: "screen", job: "r3a-screen", arm: R3_ARMS.none, prefix: "r3a-screen/" },
  { name: "pilot", job: "r3a-pilot", arm: R3_ARMS.gstack, prefix: "r3a-pilot/" },
] as const;
const HERE = import.meta.dir;
const LANEB = resolve(HERE, "..");

export function bandIds(): string[] {
  return loadSwebvTasks(join(LANEB, "tasks/swebv-r3.txt"), join(LANEB, "tasks/swebv-r3.json"), R3_BAND_SHA256).map((t) => t.task_id);
}

// r3-dry.ts's draw: 10 tasks from the sorted band, seed 20261101.
export function pilotTasks(band: string[]): string[] {
  const r = rng(PILOT.seed), pool = [...band].sort(), out: string[] = [];
  while (out.length < PILOT.tasks) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
  return out;
}

export function bindCheck(ledgerPath: string) {
  const rows = readRows(ledgerPath);
  const approval = rows.find((r) => r.kind === "approval");
  if (!approval || approval.item !== ITEM) throw new Error(`${ledgerPath}: no approval row for item ${ITEM}`);
  if (approval.usd_micros !== CAP_USD * 1_000_000) throw new Error(`${ledgerPath}: ${ITEM}'s cap is $${fromMicros(approval.usd_micros)}, not the prereg's $${CAP_USD}`);
  const used = rows.filter((r) => r.kind === "reserve" || r.kind === "settle");
  if (used.length) throw new Error(`${ledgerPath}: ${ITEM} already holds ${used.length} reserve or settle rows; an item serves one run (prereg section 5)`);
}

// R3a's plan is one trial per planned task on Opus 5.5 in the part's arm. A trial outside the plan, a second trial for a
// task, or a planned task with no trial leaves the part incomplete. A trial with no reward is still a trial (infra).
export function coverage(trials: R3Trial[], tasks: string[], arm: string): string | null {
  const planned = new Set(tasks);
  const stray = trials.filter((t) => !planned.has(t.task) || t.arm !== arm || t.model !== OPUS);
  if (stray.length) return `${stray.length} trials outside the plan (${stray.slice(0, 3).map((t) => t.trial).join(", ")})`;
  const seen = new Map<string, number>();
  for (const t of trials) seen.set(t.task, (seen.get(t.task) ?? 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([task]) => task);
  if (twice.length) return `${twice.length} tasks with more than one trial (${twice.slice(0, 3).join(", ")})`;
  const missing = tasks.filter((t) => !seen.has(t));
  if (missing.length) return `${missing.length} of ${tasks.length} planned tasks have no trial (${missing.slice(0, 3).join(", ")})`;
  return null;
}

export type Admission = { lines: string[]; exit: 0 | 5 | 6; admitted: string[]; r3bTasks: string[]; record: Record<string, unknown> };

// The admission rule (section 4.3) on R3a's records, printed the way r3-dry.ts prints it. A graded trial with no metered
// cost counts at its allowance in the measured cost, and is listed.
export function admission(screen: R3Trial[], pilot: R3Trial[]): Admission {
  const graded = screen.filter((t) => t.outcome !== "infra");
  const admitted = graded.filter((t) => t.outcome === "fail").map((t) => t.task).sort();
  const pg = pilot.filter((t) => t.outcome !== "infra");
  const pilotExposed = pg.filter((t) => t.exposed).length;
  const cost = (ts: R3Trial[]) => ts.reduce((a, t) => a + (t.cost_usd ?? ALLOWANCE_USD[t.model] ?? NaN), 0) / ts.length;
  const cNone = cost(graded), cTold = cost(pg);
  const missingCost = [...graded, ...pg].filter((t) => t.cost_usd === null).map((t) => t.trial);
  const lines = [`admission: ${admitted.length} of ${graded.length} graded in-band tasks unsolved by Opus 5.5 none (${screen.length - graded.length} infra); pilot exposure ${pilotExposed} of ${pg.length} graded told trials`];
  const record: Record<string, unknown> = {
    screen: { trials: screen.length, graded: graded.length, infra: screen.length - graded.length, admitted: admitted.length },
    pilot: { tasks: pilot.map((t) => t.task), trials: pilot.length, graded: pg.length, exposed: pilotExposed, body_loaded: pg.filter((t) => t.body_loaded).length, investigate_opened: pg.filter((t) => t.investigate_opened).length, procedure_shown: pg.filter((t) => t.procedure_shown).length },
    measured_cost_per_trial_usd: { none: cNone, told: cTold, missing_cost_trials: missingCost },
  };
  if (admitted.length < ADMISSION.minAdmitted) {
    lines.push(`R3 outcome: STOP (saturation). Only ${admitted.length} in-band tasks are unsolved by Opus 5.5 with no skill, fewer than 30, so told /investigate can't be tested on Opus 5.5 on SWE-bench Verified. This report is the finding; R3b does not start.`);
    return { lines, exit: 5, admitted, r3bTasks: [], record: { ...record, outcome: "saturation" } };
  }
  if (pilotExposed < ADMISSION.pilotMinExposed) {
    lines.push(`R3 outcome: STOP (FIX-METHOD). Told /investigate ran its procedure in ${pilotExposed} of ${pg.length} pilot trials, under 7; R3b does not start.`);
    return { lines, exit: 6, admitted, r3bTasks: [], record: { ...record, outcome: "pilot-fix-method" } };
  }
  const n = Math.min(ADMISSION.nMax, admitted.length);
  const dr = rng(ADMISSION.r3bSeed), left = [...admitted], r3bTasks: string[] = [];
  while (r3bTasks.length < n) r3bTasks.push(left.splice(Math.floor(dr() * left.length), 1)[0]!);
  const projOpus = n * 3 * (cNone + cTold), projPart = n * 3 * 3 * ADMISSION.particleTrialUsd;
  lines.push(`R3b start: ${n} tasks; measured cost per trial none $${cNone.toFixed(2)}, told $${cTold.toFixed(2)}; projection r3b-opus $${projOpus.toFixed(0)}, r3b-particle $${projPart.toFixed(0)} (planning estimate $0.15 a trial); Garry records both caps before R3b starts`);
  return { lines, exit: 0, admitted, r3bTasks, record: { ...record, outcome: "admitted", n, projection_usd: { "r3b-opus": projOpus, "r3b-particle": projPart } } };
}

function sh(cmd: string[], env: Record<string, string | undefined>) {
  const p = Bun.spawnSync(cmd, { env: env as Record<string, string>, stdout: "inherit", stderr: "inherit" });
  return p.exitCode ?? 1;
}

function prepare(work: string) {
  const ledger = process.env.LEDGER ?? "";
  bindCheck(ledger);
  const arms = process.env.ARMS;
  if (!arms) throw new Error("E_USAGE set ARMS to the directory holding none, gstack and placebo arm tars (#109's, handoffs/GSTA-30/arms)");
  const pilot = pilotTasks(bandIds());
  mkdirSync(work, { recursive: true });
  for (const part of PARTS) {
    const run = join(work, part.name);
    const env = { ...process.env, TASK_SET: "swebv-r3", CELLS: "cells.r3.json", ARM_MANIFESTS: "arms/manifests/r3", TASKS: part.name === "pilot" ? pilot.join(",") : undefined };
    const rc = sh([process.execPath, join(LANEB, "runner/prepare-run.ts"), run, part.job, OPUS, part.arm, arms, "1", process.env.CONCURRENT ?? "8"], env);
    if (rc !== 0) throw new Error(`prepare-run for ${part.name} exited ${rc}`);
    writeFileSync(join(run, "STOP_ON_CAP"), "");
  }
  writeFileSync(join(work, "plan.json"), JSON.stringify({ item: ITEM, cap_usd: CAP_USD, band_sha256: R3_BAND_SHA256, pilot_seed: PILOT.seed, pilot_tasks: pilot, parts: PARTS }, null, 2) + "\n");
  console.log(`prepared ${work}: screen (93 tasks, none) and pilot (${pilot.join(", ")}, told /investigate), item ${ITEM} unbound`);
}

function run(work: string) {
  const ledger = process.env.LEDGER ?? "";
  const rate = process.env.VM_USD_PER_HOUR ?? "", hours = process.env.VM_RESERVE_HOURS ?? "4";
  if (!rate) throw new Error("E_USAGE set VM_USD_PER_HOUR so the VM hours settle to r3a-screen");
  if (![rate, hours].every((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0)) throw new Error(`E_USAGE VM_USD_PER_HOUR and VM_RESERVE_HOURS must be positive numbers (got ${rate} and ${hours})`);
  if (!existsSync(join(work, "plan.json"))) throw new Error(`E_USAGE ${work} has no plan.json; run prepare first`);
  const bound = ledger + ".bound";
  try {
    writeFileSync(bound, JSON.stringify({ item: ITEM, work, at: new Date().toISOString() }) + "\n", { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error(`${ITEM} is already bound to a run (${readFileSync(bound, "utf8").trim()}); an item serves one run (prereg section 5)`);
  }
  bindCheck(ledger);
  for (const part of PARTS) {
    const dir = join(work, part.name);
    const rc = sh(["bash", join(LANEB, "runner/launch.sh"), dir, part.prefix, String(CAP_USD)], { ...process.env, LEDGER: ledger, ITEM, VM_RESERVE_HOURS: hours });
    writeFileSync(join(work, `${part.name}.launch-exit`), `${rc}\n`);
    if (rc !== 0 || existsSync(join(dir, "pulled/out/cap-stop.json")) || existsSync(join(dir, "vm-cap-stop"))) { console.log(`${part.name}: launch exited ${rc}; the run stops here`); return; }
  }
}

const PROXY_FILES = ["cap-stop.json", "proxy-status-end.json", "proxy-sessions.jsonl"];

function unreadable(path: string): boolean {
  try {
    const text = readFileSync(path, "utf8");
    if (!text.trim()) return true;
    if (path.endsWith(".jsonl")) text.split("\n").filter((l) => l.trim()).forEach((l) => JSON.parse(l));
    else JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

// Why a part is incomplete, or null. A cap refusal anywhere, a pulled proxy file that is empty or unparseable (a cap stop
// can't be ruled out), a launch that didn't exit 0, a part with no pulled results, trials that are not one per planned
// task, or more than 10% of the part's trials infra (GSTA-2 rulings).
function stopReason(work: string, part: (typeof PARTS)[number], trials: R3Trial[], tasks: string[]): string | null {
  const dir = join(work, part.name);
  const exitFile = join(work, `${part.name}.launch-exit`);
  const rc = existsSync(exitFile) ? Number(readFileSync(exitFile, "utf8").trim()) : null;
  if (rc === 9) return `${ITEM} refused ${part.name}'s VM reserve`;
  if (existsSync(join(dir, "vm-cap-stop"))) return `${part.name}: ${readFileSync(join(dir, "vm-cap-stop"), "utf8").trim()}`;
  const bad = PROXY_FILES.find((f) => existsSync(join(dir, "pulled/out", f)) && unreadable(join(dir, "pulled/out", f)));
  if (bad) return `${part.name}: pulled/out/${bad} is empty or unparseable`;
  const status = [join(dir, "pulled/out/cap-stop.json"), join(dir, "pulled/out/proxy-status-end.json")].map((p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null)).find((s) => s?.cap_stop);
  if (status) return `${part.name}: ${status.cap_stop}`;
  const capped = trials.find((t) => t.cap_stop);
  if (capped) return `${part.name}: ${capped.trial} stopped at the cap (LedgerCapStop)`;
  if (rc === null) return `${part.name} was never launched`;
  if (rc !== 0) return `${part.name}'s launch exited ${rc}`;
  if (!existsSync(join(dir, "pulled/jobs"))) return `${part.name} has no pulled results`;
  const gap = coverage(trials, tasks, part.arm.split(":")[0]!);
  if (gap) return `${part.name}: ${gap}`;
  const infra = trials.filter((t) => t.outcome === "infra").length;
  return infra * 10 > trials.length ? `${part.name}: ${infra} of ${trials.length} trials are infra, over 10%` : null;
}

function analyze(work: string): number {
  const ledger = process.env.LEDGER ?? "";
  if (!existsSync(join(work, "plan.json"))) throw new Error(`E_USAGE ${work} has no plan.json; run prepare first`);
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const band = bandIds();
  if (JSON.stringify(plan.pilot_tasks) !== JSON.stringify(pilotTasks(band))) throw new Error(`${work}/plan.json's pilot tasks are not the seed ${PILOT.seed} draw`);
  const planned: Record<string, string[]> = { screen: band, pilot: plan.pilot_tasks };
  const parts = PARTS.map((part) => {
    const dir = join(work, part.name);
    const sessions = join(dir, "pulled/out/proxy-sessions.jsonl");
    const trials = existsSync(join(dir, "pulled/jobs")) ? loadR3Jobs(join(dir, "pulled/jobs"), existsSync(sessions) && !unreadable(sessions) ? readSessionRows([sessions]) : [], JSON.parse(readFileSync(join(dir, "proxy.json"), "utf8"))) : [];
    return { part, trials, stop: stopReason(work, part, trials, planned[part.name]!) };
  });
  const [screen, pilot] = parts.map((p) => p.trials) as [R3Trial[], R3Trial[]];
  writeFileSync(join(work, "trials.jsonl"), parts.flatMap((p) => p.trials.map((t) => JSON.stringify({ part: p.part.name, ...t }))).join("\n") + "\n");
  const rows = readRows(ledger);
  const t = totals(rows);
  const vm = rows.filter((r) => r.kind === "settle" && String(r.kind_detail ?? "").startsWith("VM hours")).map((r) => ({ id: r.id, usd: fromMicros(r.usd_micros), detail: r.kind_detail }));
  const ledgerLine = `${ITEM}: ${screen.length} screen trials, ${pilot.length} pilot trials, settled $${fromMicros(t.settledMicros).toFixed(2)} of $${fromMicros(t.capMicros)}, open reserves ${t.openIds.length}`;
  const base = { item: ITEM, ledger: { cap_usd: fromMicros(t.capMicros), settled_usd: fromMicros(t.settledMicros), open_reserves: t.openIds, vm_settles: vm } };
  console.log(ledgerLine);
  const stop = parts.map((p) => p.stop).find(Boolean);
  if (stop) {
    const line = `R3 outcome: none (incomplete: ${stop}). R3a stopped, so R3b does not start; the Captain gets the record.`;
    console.log(line);
    writeFileSync(join(work, "record.json"), JSON.stringify({ ...base, outcome: "incomplete", reason: stop, lines: [ledgerLine, line] }, null, 2) + "\n");
    return 4;
  }
  const a = admission(screen, pilot);
  for (const l of a.lines) console.log(l);
  writeFileSync(join(work, "admitted.txt"), a.admitted.map((x) => x + "\n").join(""));
  if (a.r3bTasks.length) writeFileSync(join(work, "r3b-tasks.txt"), a.r3bTasks.map((x) => x + "\n").join(""));
  writeFileSync(join(work, "record.json"), JSON.stringify({ ...base, ...a.record, admitted: a.admitted, r3b_tasks: a.r3bTasks, lines: [ledgerLine, ...a.lines] }, null, 2) + "\n");
  return a.exit;
}

if (import.meta.main) {
  const [cmd, workArg] = Bun.argv.slice(2);
  if (!workArg || !["all", "prepare", "run", "analyze"].includes(cmd ?? "")) {
    console.error("E_USAGE usage: bun quick/laneb/r3/screen.ts all|prepare|run|analyze <work dir>");
    process.exit(2);
  }
  if (!process.env.LEDGER) { console.error("E_USAGE set LEDGER to r3a-screen's jsonl ledger"); process.exit(2); }
  const work = resolve(workArg);
  try {
    if (cmd === "prepare" || cmd === "all") prepare(work);
    if (cmd === "run" || cmd === "all") run(work);
    if (cmd === "analyze" || cmd === "all") process.exit(analyze(work));
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    console.error(msg.startsWith("E_USAGE") ? msg : `E_INTERNAL ${msg}`);
    process.exit(msg.startsWith("E_USAGE") ? 2 : 1);
  }
}
