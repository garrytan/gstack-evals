// R3a, the screen (GEVA-101 prereg, section 4.3; build spec 4.8 item 5). One command runs it for one model, writes the
// admitted list, the pilot exposure and the measured costs, and prints the projection:
//   bun quick/laneb/r3/screen.ts all <work dir> [--model <id>]       prepare, run and analyze, in order
//   bun quick/laneb/r3/screen.ts prepare <work dir> [--model <id>]   env LEDGER (the item's jsonl), SWEBV (harbor-datasets checkout), ARMS (arm tar dir)
//   bun quick/laneb/r3/screen.ts run <work dir> [--model <id>]       env LEDGER, UBI_OWNER, VM_USD_PER_HOUR, the provider keys,
//                                                                    LEDGER_PORT (default the model's own); launches screen, then pilot
//   bun quick/laneb/r3/screen.ts analyze <work dir> [--model <id>]   env LEDGER; reads the pulled results
// --model is claude-opus-5-5 (the default) or gpt-6.1-sol. Each model has its own item, cap, parts, ledger and work dir
// (R3A below): Opus 5.5 on r3a-screen ($150, the prereg's), GPT-6.1 Sol on r3a-sol ($140 with VMs, the R3 amendment's
// ruling A1). A model's R3a is one none trial for each of the 93 band tasks less R3's drop list (tasks/swebv-r3-drop.json,
// its sha256 pinned in materialize.ts) and one told trial on each of 10 band tasks drawn with seed 20261101, every arm on
// claude-code-preset (GSTA-2 ruling). A dropped task never reaches the screen's run, its oracle job or its coverage. Both batches and their VM hours settle to its item.
// The item serves one run: prepare refuses a ledger that already holds a reserve or settle, and run binds the item before
// its first spend by creating <LEDGER>.bound, so any later run is refused. Sol's item also takes its route check first
// (route-check.ts): its settled rows under the item's route prefix are allowed, and the screen is refused until the route
// record (<LEDGER>.route.json) says pass with the proxy config the screen's parts run with (an incomplete record is
// refused too, Captain ruling A1). A model's stops read and write only its own ledger, record and work dir, so a
// Sol stop can't touch Opus's item or outcome. run refuses a plan.json prepared for another model's item, and a ledger
// port something already answers on, before it binds the item; each model's ledger service has its own default port
// (Opus 9911, Sol 9912), so the two runs never share one. A cap refusal (a VM block, a session reserve
// or the batch cap) stops the run, and analyze then reports it incomplete and admits nothing. So does a part whose
// trials are not one per planned task: a planned task with no trial, a second trial for a task, or a stray trial (one in
// another arm or on another model). So does a part with more than 10% infra trials, a pulled proxy file that is empty or
// unparseable, or a launch exit that can't be read (GSTA-2 rulings). run reads the screen's stop reason before it launches
// the pilot and stops there when the screen is already incomplete, and analyze removes an earlier analysis's
// admitted.txt and r3b-tasks.txt before it reads anything else (#121's notes, R3 amendment section 6.6). A plan.json that
// parses and names another item is refused first, with nothing removed (Captain ruling B1).
// Exit codes, as r3-dry.ts: 0 admission passed (R3b waits for Garry's caps), 4 incomplete, 5 saturation, 6 pilot
// FIX-METHOD; 2 usage, 1 any other error.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { readSessionRows, rng } from "../analysis/analyze.ts";
import { fromMicros, readRows, totals } from "../runner/ledger.ts";
import { loadR3Drops, loadSwebvTasks, R3_BAND_SHA256, R3_DROP_FILE, R3_DROP_SHA256, type R3Drop } from "../runner/materialize.ts";
import { loadR3Jobs, type R3Trial } from "./exposure.ts";

export const OPUS = "claude-opus-5-5";
export const SOL = "gpt-6.1-sol";
export const PILOT = { tasks: 10, seed: 20261101 };
export const ADMISSION = { minAdmitted: 30, pilotMinExposed: 7, nMax: 70, r3bSeed: 20261102, particleTrialUsd: 0.15 };
export const ALLOWANCE_USD: Record<string, number> = { "claude-opus-5-5": 4, "particle-1": 1, "gpt-6.1-sol": 4 };
// Every R3 arm, as prepare-run's arms entries. told and placebo open the prompt with /investigate (the placebo's skill of
// the same name); none is never told. R3b runs Opus none and gstack, and particle-1 none, gstack and placebo.
export const R3_ARMS = {
  none: "none:system_prompt=claude-code-preset",
  gstack: "gstack:told=investigate:system_prompt=claude-code-preset",
  placebo: "placebo:told=investigate:system_prompt=claude-code-preset",
} as const;
export const R3_CELLS: Record<string, (keyof typeof R3_ARMS)[]> = { "claude-opus-5-5": ["none", "gstack"], "particle-1": ["none", "gstack", "placebo"] };

type Part = { name: "screen" | "pilot"; job: string; arm: string; prefix: string };
export type R3aModel = {
  id: string; label: string; item: string; capUsd: number; capFrom: string;
  // Ledger prefix of the model's route check sessions on its item, or null when the model has no route check.
  routePrefix: string | null;
  // Default local port of the item's ledger service (LEDGER_PORT overrides it).
  ledgerPort: string;
  parts: readonly Part[];
  // Outcome lines: tag follows "R3 outcome" and "R3b start", stop ends a STOP line, incomplete follows an incomplete one.
  tag: string; stop: string; incomplete: string;
  projection: (n: number, cNone: number, cTold: number) => { text: string; usd: Record<string, number> };
};
export const R3A: Record<string, R3aModel> = {
  [OPUS]: {
    id: OPUS, label: "Opus 5.5", item: "r3a-screen", capUsd: 150, capFrom: "the prereg's", routePrefix: null, ledgerPort: "9911",
    parts: [
      { name: "screen", job: "r3a-screen", arm: R3_ARMS.none, prefix: "r3a-screen/" },
      { name: "pilot", job: "r3a-pilot", arm: R3_ARMS.gstack, prefix: "r3a-pilot/" },
    ],
    tag: "", stop: "R3b does not start", incomplete: "R3a stopped, so R3b does not start; the Captain gets the record.",
    projection: (n, cNone, cTold) => {
      const opus = n * 3 * (cNone + cTold), particle = n * 3 * 3 * ADMISSION.particleTrialUsd;
      return { text: `projection r3b-opus $${opus.toFixed(0)}, r3b-particle $${particle.toFixed(0)} (planning estimate $0.15 a trial); Garry records both caps before R3b starts`, usd: { "r3b-opus": opus, "r3b-particle": particle } };
    },
  },
  [SOL]: {
    id: SOL, label: "GPT-6.1 Sol", item: "r3a-sol", capUsd: 140, capFrom: "the R3 amendment's", routePrefix: "r3a-sol-route/", ledgerPort: "9912",
    parts: [
      { name: "screen", job: "r3a-sol-screen", arm: R3_ARMS.none, prefix: "r3a-sol-screen/" },
      { name: "pilot", job: "r3a-sol-pilot", arm: R3_ARMS.gstack, prefix: "r3a-sol-pilot/" },
    ],
    tag: " for GPT-6.1 Sol", stop: "Sol's R3b does not start, and Opus's R3 is unaffected",
    incomplete: "Sol's R3a stopped, so Sol's R3b does not start; Opus's R3a and its outcome are untouched, and the Captain gets the record.",
    projection: (n, cNone, cTold) => {
      const sol = n * 3 * (cNone + cTold);
      return { text: `projection r3b-sol $${sol.toFixed(0)}; Garry records r3b-sol's cap before Sol's R3b starts`, usd: { "r3b-sol": sol } };
    },
  },
};
const HERE = import.meta.dir;
const LANEB = resolve(HERE, "..");

export function bandIds(): string[] {
  return loadSwebvTasks(join(LANEB, "tasks/swebv-r3.txt"), join(LANEB, "tasks/swebv-r3.json"), R3_BAND_SHA256).map((t) => t.task_id);
}

// The screen's tasks: the band less R3's drop list, in band order. The pilot still draws from the whole band.
export function screenIds(drops: R3Drop[] = loadR3Drops(join(LANEB, R3_DROP_FILE), R3_DROP_SHA256, bandIds())): string[] {
  const dropped = new Set(drops.map((d) => d.task_id));
  return bandIds().filter((id) => !dropped.has(id));
}

// r3-dry.ts's draw: 10 tasks from the sorted band, seed 20261101.
export function pilotTasks(band: string[]): string[] {
  const r = rng(PILOT.seed), pool = [...band].sort(), out: string[] = [];
  while (out.length < PILOT.tasks) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
  return out;
}

// The route check's record, beside the item's ledger; route-check.ts writes it with every session's evidence.
export type RouteVerdict = { item: string; model: string; verdict: "pass" | "drop" | null; reason: string | null; incomplete?: string | null; proxy_config_sha256?: string };
export const routeRecordPath = (ledgerPath: string) => ledgerPath + ".route.json";

export function readRoute(ledgerPath: string): RouteVerdict | null {
  const path = routeRecordPath(ledgerPath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RouteVerdict;
  } catch {
    throw new Error(`${path} is not readable JSON; the route check's record can't be read`);
  }
}

// A model with a route check runs its screen only once its record, beside its own ledger, says it passed on its item. A
// pass covers only the proxy config it ran with: each of the screen's proxy configs must hash to the record's
// proxy_config_sha256. Without proxyConfigs it checks the verdict only; bindCheck always passes them.
export function routePassed(ledgerPath: string, m: R3aModel, proxyConfigs?: string[]) {
  if (m.routePrefix === null) return;
  const route = readRoute(ledgerPath);
  if (route && (route.model !== m.id || route.item !== m.item)) throw new Error(`${routeRecordPath(ledgerPath)} is for ${route.model} on ${route.item}, not ${m.id} on ${m.item}`);
  if (route?.verdict === "drop") throw new Error(`${m.label} dropped out of R3a at its route check: ${route.reason}`);
  if (route?.incomplete) throw new Error(`${m.label}'s route check on ${m.item} is incomplete (${route.incomplete}); the Captain decides on a rerun`);
  if (route?.verdict !== "pass") throw new Error(`${m.label} has not passed its route check on ${m.item} (${routeRecordPath(ledgerPath)}); run r3/route-check.ts first`);
  if (!proxyConfigs) return;
  if (!proxyConfigs.length) throw new Error(`the screen names no proxy config to match ${m.label}'s route check against`);
  for (const path of proxyConfigs) {
    if (!existsSync(path)) throw new Error(`the screen's proxy config ${path} is missing, so ${m.label}'s route check can't be matched to it; run prepare first`);
    const got = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (got !== route.proxy_config_sha256) throw new Error(`${m.label}'s route check passed with proxy config sha256 ${route.proxy_config_sha256}, but the screen's ${path} is ${got}; a pass covers only the config it ran with`);
  }
}

// The item's ledger holds its approval row at the model's cap, and no reserve or settle rows but its route check's.
export function itemCheck(ledgerPath: string, m: R3aModel) {
  const rows = readRows(ledgerPath);
  const approval = rows.find((r) => r.kind === "approval");
  if (!approval || approval.item !== m.item) throw new Error(`${ledgerPath}: no approval row for item ${m.item}`);
  if (approval.usd_micros !== m.capUsd * 1_000_000) throw new Error(`${ledgerPath}: ${m.item}'s cap is $${fromMicros(approval.usd_micros)}, not ${m.capFrom} $${m.capUsd}`);
  const route = m.routePrefix;
  const used = rows.filter((r) => (r.kind === "reserve" || r.kind === "settle") && !(route !== null && r.id.startsWith(route)));
  if (used.length) throw new Error(`${ledgerPath}: ${m.item} already holds ${used.length} reserve or settle rows; an item serves one run (prereg section 5)`);
  return rows;
}

// proxyConfigs are the proxy configs the screen runs with, which a model's route check must have passed with.
export function bindCheck(ledgerPath: string, m: R3aModel = R3A[OPUS]!, proxyConfigs: string[] = []) {
  const rows = itemCheck(ledgerPath, m);
  const route = m.routePrefix;
  if (route === null) return;
  const open = totals(rows).openIds.filter((id) => id.startsWith(route));
  if (open.length) throw new Error(`${ledgerPath}: ${open.length} route check reserves are still open on ${m.item} (${open.slice(0, 3).join(", ")}); reconcile them before the screen`);
  routePassed(ledgerPath, m, proxyConfigs);
}

// A model's R3a plan is one trial per planned task on that model in the part's arm. A trial outside the plan (another
// task, arm or model), a second trial for a task, or a planned task with no trial leaves the part incomplete. A trial
// with no reward is still a trial (infra).
export function coverage(trials: R3Trial[], tasks: string[], arm: string, model = OPUS): string | null {
  const planned = new Set(tasks);
  const stray = trials.filter((t) => !planned.has(t.task) || t.arm !== arm || t.model !== model);
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

// The admission rule (section 4.3) on one model's R3a records, printed the way r3-dry.ts prints it. A graded trial with
// no metered cost counts at its allowance in the measured cost, and is listed.
export function admission(screen: R3Trial[], pilot: R3Trial[], m: R3aModel = R3A[OPUS]!): Admission {
  const graded = screen.filter((t) => t.outcome !== "infra");
  const admitted = graded.filter((t) => t.outcome === "fail").map((t) => t.task).sort();
  const pg = pilot.filter((t) => t.outcome !== "infra");
  const pilotExposed = pg.filter((t) => t.exposed).length;
  const cost = (ts: R3Trial[]) => ts.reduce((a, t) => a + (t.cost_usd ?? ALLOWANCE_USD[t.model] ?? NaN), 0) / ts.length;
  const cNone = cost(graded), cTold = cost(pg);
  const missingCost = [...graded, ...pg].filter((t) => t.cost_usd === null).map((t) => t.trial);
  const lines = [`admission: ${admitted.length} of ${graded.length} graded in-band tasks unsolved by ${m.label} none (${screen.length - graded.length} infra); pilot exposure ${pilotExposed} of ${pg.length} graded told trials`];
  const record: Record<string, unknown> = {
    screen: { trials: screen.length, graded: graded.length, infra: screen.length - graded.length, admitted: admitted.length },
    pilot: { tasks: pilot.map((t) => t.task), trials: pilot.length, graded: pg.length, exposed: pilotExposed, body_loaded: pg.filter((t) => t.body_loaded).length, investigate_opened: pg.filter((t) => t.investigate_opened).length, procedure_shown: pg.filter((t) => t.procedure_shown).length },
    measured_cost_per_trial_usd: { none: cNone, told: cTold, missing_cost_trials: missingCost },
  };
  if (admitted.length < ADMISSION.minAdmitted) {
    lines.push(`R3 outcome${m.tag}: STOP (saturation). Only ${admitted.length} in-band tasks are unsolved by ${m.label} with no skill, fewer than 30, so told /investigate can't be tested on ${m.label} on SWE-bench Verified. This report is the finding; ${m.stop}.`);
    return { lines, exit: 5, admitted, r3bTasks: [], record: { ...record, outcome: "saturation" } };
  }
  if (pilotExposed < ADMISSION.pilotMinExposed) {
    lines.push(`R3 outcome${m.tag}: STOP (FIX-METHOD). Told /investigate ran its procedure in ${pilotExposed} of ${pg.length} pilot trials, under 7; ${m.stop}.`);
    return { lines, exit: 6, admitted, r3bTasks: [], record: { ...record, outcome: "pilot-fix-method" } };
  }
  const n = Math.min(ADMISSION.nMax, admitted.length);
  const dr = rng(ADMISSION.r3bSeed), left = [...admitted], r3bTasks: string[] = [];
  while (r3bTasks.length < n) r3bTasks.push(left.splice(Math.floor(dr() * left.length), 1)[0]!);
  const p = m.projection(n, cNone, cTold);
  lines.push(`R3b start${m.tag}: ${n} tasks; measured cost per trial none $${cNone.toFixed(2)}, told $${cTold.toFixed(2)}; ${p.text}`);
  return { lines, exit: 0, admitted, r3bTasks, record: { ...record, outcome: "admitted", n, projection_usd: p.usd } };
}

// The VM block run reserves before each VM starts (launch.sh): VM_USD_PER_HOUR x VM_RESERVE_HOURS, more than $0, at most
// the item's cap and at least 2 seconds long.
export function vmBlock(rate: string, hours: string, capUsd: number): number {
  if (![rate, hours].every((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0)) throw new Error(`E_USAGE VM_USD_PER_HOUR and VM_RESERVE_HOURS must be positive numbers (got ${rate} and ${hours})`);
  const block = Number(rate) * Number(hours);
  if (Math.round(block * 1e6) <= 0 || block > capUsd || Math.trunc(Number(hours) * 3600) < 2) throw new Error(`E_USAGE the VM block (${rate} $/h for ${hours} h) must come to more than $0, at most the $${capUsd} cap, and at least 2 seconds`);
  return block;
}

// Whether something accepts a TCP connection on host:port, such as another run's ledger service or proxy.
export function portTaken(host: string, port: string): boolean {
  return Bun.spawnSync(["bash", "-c", 'exec 3<>"/dev/tcp/$1/$2"', "bash", host, port], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

function sh(cmd: string[], env: Record<string, string | undefined>) {
  const p = Bun.spawnSync(cmd, { env: env as Record<string, string>, stdout: "inherit", stderr: "inherit" });
  return p.exitCode ?? 1;
}

function prepare(work: string, m: R3aModel) {
  const ledger = process.env.LEDGER ?? "";
  bindCheck(ledger, m, [join(LANEB, "config/proxy.json")]);
  const arms = process.env.ARMS;
  if (!arms) throw new Error("E_USAGE set ARMS to the directory holding none, gstack and placebo arm tars (#109's, handoffs/GSTA-30/arms)");
  const pilot = pilotTasks(bandIds());
  mkdirSync(work, { recursive: true });
  for (const part of m.parts) {
    const run = join(work, part.name);
    const env = { ...process.env, TASK_SET: "swebv-r3", CELLS: "cells.r3.json", ARM_MANIFESTS: "arms/manifests/r3", TASKS: part.name === "pilot" ? pilot.join(",") : undefined };
    const rc = sh([process.execPath, join(LANEB, "runner/prepare-run.ts"), run, part.job, m.id, part.arm, arms, "1", process.env.CONCURRENT ?? "8"], env);
    if (rc !== 0) throw new Error(`prepare-run for ${part.name} exited ${rc}`);
    writeFileSync(join(run, "STOP_ON_CAP"), "");
  }
  writeFileSync(join(work, "plan.json"), JSON.stringify({ item: m.item, cap_usd: m.capUsd, band_sha256: R3_BAND_SHA256, pilot_seed: PILOT.seed, pilot_tasks: pilot, parts: m.parts }, null, 2) + "\n");
  console.log(`prepared ${work}: screen (${screenIds().length} tasks, none) and pilot (${pilot.join(", ")}, told /investigate), item ${m.item} unbound`);
}

function run(work: string, m: R3aModel) {
  const ledger = process.env.LEDGER ?? "";
  const rate = process.env.VM_USD_PER_HOUR ?? "", hours = process.env.VM_RESERVE_HOURS ?? "4";
  if (!rate) throw new Error(`E_USAGE set VM_USD_PER_HOUR so the VM hours settle to ${m.item}`);
  vmBlock(rate, hours, m.capUsd);
  if (!existsSync(join(work, "plan.json"))) throw new Error(`E_USAGE ${work} has no plan.json; run prepare first`);
  routePassed(ledger, m);
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  if (plan.item !== undefined && plan.item !== m.item) throw new Error(`E_USAGE ${work}/plan.json is item ${plan.item}'s, not ${m.label}'s ${m.item}; nothing was bound or launched`);
  const lport = process.env.LEDGER_PORT ?? m.ledgerPort;
  const busy = `something already answers on 127.0.0.1:${lport} (another run's ledger service?)`;
  if (portTaken("127.0.0.1", lport)) throw new Error(`E_USAGE ${busy}; set LEDGER_PORT to a free port; ${m.item} is still unbound`);
  const configs = m.parts.map((part) => join(work, part.name, "proxy.json"));
  routePassed(ledger, m, configs);
  const planned: Record<string, string[]> = { screen: screenIds(), pilot: plan.pilot_tasks };
  const bound = ledger + ".bound";
  try {
    writeFileSync(bound, JSON.stringify({ item: m.item, work, at: new Date().toISOString() }) + "\n", { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error(`${m.item} is already bound to a run (${readFileSync(bound, "utf8").trim()}); an item serves one run (prereg section 5)`);
  }
  bindCheck(ledger, m, configs);
  for (const [i, part] of m.parts.entries()) {
    const dir = join(work, part.name);
    if (portTaken("127.0.0.1", lport)) { console.log(`${part.name}: ${busy}; the run stops here`); return; }
    const rc = sh(["bash", join(LANEB, "runner/launch.sh"), dir, part.prefix, String(m.capUsd)], { ...process.env, LEDGER: ledger, LEDGER_PORT: lport, ITEM: m.item, VM_RESERVE_HOURS: hours });
    writeFileSync(join(work, `${part.name}.launch-exit`), `${rc}\n`);
    if (rc !== 0 || existsSync(join(dir, "pulled/out/cap-stop.json")) || existsSync(join(dir, "vm-cap-stop"))) { console.log(`${part.name}: launch exited ${rc}; the run stops here`); return; }
    if (i === m.parts.length - 1) return;
    const stop = loadPart(work, part, planned[part.name]!, m).stop;
    if (stop) { console.log(`${part.name} is incomplete (${stop}); the run stops here`); return; }
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
// can't be ruled out), an image that didn't pull (vm-run.sh's out/pull-fails.txt), a launch that didn't exit 0, a part with no pulled results, trials that are not one per planned
// task on the model, or more than 10% of the part's trials infra (GSTA-2 rulings).
function stopReason(work: string, part: Part, trials: R3Trial[], tasks: string[], m: R3aModel): string | null {
  const dir = join(work, part.name);
  const exitFile = join(work, `${part.name}.launch-exit`);
  const exitText = existsSync(exitFile) ? readFileSync(exitFile, "utf8").trim() : null;
  if (exitText !== null && !/^\d+$/.test(exitText)) return `${part.name}: launch exit unreadable`;
  const rc = exitText === null ? null : Number(exitText);
  if (rc === 9) return `${m.item} refused ${part.name}'s VM reserve`;
  if (existsSync(join(dir, "vm-cap-stop"))) return `${part.name}: ${readFileSync(join(dir, "vm-cap-stop"), "utf8").trim()}`;
  const bad = PROXY_FILES.find((f) => existsSync(join(dir, "pulled/out", f)) && unreadable(join(dir, "pulled/out", f)));
  if (bad) return `${part.name}: pulled/out/${bad} is empty or unparseable`;
  const status = [join(dir, "pulled/out/cap-stop.json"), join(dir, "pulled/out/proxy-status-end.json")].map((p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null)).find((s) => s?.cap_stop);
  if (status) return `${part.name}: ${status.cap_stop}`;
  const capped = trials.find((t) => t.cap_stop);
  if (capped) return `${part.name}: ${capped.trial} stopped at the cap (LedgerCapStop)`;
  const pullFails = join(dir, "pulled/out/pull-fails.txt");
  if (existsSync(pullFails)) return `${part.name}: infra before any model call: an image did not pull (6 tries and up to 3 hours at the rate limit): ${readFileSync(pullFails, "utf8").trim().split("\n").join("; ")}`;
  if (rc === null) return `${part.name} was never launched`;
  if (rc !== 0) return `${part.name}'s launch exited ${rc}`;
  if (!existsSync(join(dir, "pulled/jobs"))) return `${part.name} has no pulled results`;
  const gap = coverage(trials, tasks, part.arm.split(":")[0]!, m.id);
  if (gap) return `${part.name}: ${gap}`;
  const infra = trials.filter((t) => t.outcome === "infra").length;
  return infra * 10 > trials.length ? `${part.name}: ${infra} of ${trials.length} trials are infra, over 10%` : null;
}

// One part's pulled trials and why the part is incomplete, or null.
function loadPart(work: string, part: Part, tasks: string[], m: R3aModel) {
  const dir = join(work, part.name);
  const sessions = join(dir, "pulled/out/proxy-sessions.jsonl");
  const trials = existsSync(join(dir, "pulled/jobs")) ? loadR3Jobs(join(dir, "pulled/jobs"), existsSync(sessions) && !unreadable(sessions) ? readSessionRows([sessions]) : [], JSON.parse(readFileSync(join(dir, "proxy.json"), "utf8"))) : [];
  return { part, trials, stop: stopReason(work, part, trials, tasks, m) };
}

function analyze(work: string, m: R3aModel): number {
  const ledger = process.env.LEDGER ?? "";
  const named = (() => { try { return JSON.parse(readFileSync(join(work, "plan.json"), "utf8")); } catch { return null; } })();
  if (named?.item !== undefined && named.item !== m.item) throw new Error(`E_USAGE ${work}/plan.json is item ${named.item}'s, not ${m.label}'s ${m.item}; nothing was removed`);
  for (const stale of ["admitted.txt", "r3b-tasks.txt"]) rmSync(join(work, stale), { force: true });
  if (!existsSync(join(work, "plan.json"))) throw new Error(`E_USAGE ${work} has no plan.json; run prepare first`);
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const band = bandIds();
  if (JSON.stringify(plan.pilot_tasks) !== JSON.stringify(pilotTasks(band))) throw new Error(`${work}/plan.json's pilot tasks are not the seed ${PILOT.seed} draw`);
  const planned: Record<string, string[]> = { screen: screenIds(), pilot: plan.pilot_tasks };
  const parts = m.parts.map((part) => loadPart(work, part, planned[part.name]!, m));
  const [screen, pilot] = parts.map((p) => p.trials) as [R3Trial[], R3Trial[]];
  writeFileSync(join(work, "trials.jsonl"), parts.flatMap((p) => p.trials.map((t) => JSON.stringify({ part: p.part.name, ...t }))).join("\n") + "\n");
  const rows = readRows(ledger);
  const t = totals(rows);
  const vm = rows.filter((r) => r.kind === "settle" && String(r.kind_detail ?? "").startsWith("VM hours")).map((r) => ({ id: r.id, usd: fromMicros(r.usd_micros), detail: r.kind_detail }));
  const ledgerLine = `${m.item}: ${screen.length} screen trials, ${pilot.length} pilot trials, settled $${fromMicros(t.settledMicros).toFixed(2)} of $${fromMicros(t.capMicros)}, open reserves ${t.openIds.length}`;
  const route = m.routePrefix === null ? {} : { model: m.id, route_check: readRoute(ledger) };
  // Each part's image pulls as vm-run.sh logged them (out/pulls.tsv): images, failures and seconds waited at the rate limit.
  const pulls = Object.fromEntries(m.parts.map((part) => {
    const f = join(work, part.name, "pulled/out/pulls.tsv");
    const rows = existsSync(f) ? readFileSync(f, "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split("\t")) : null;
    return [part.name, rows && { images: rows.length, failed: rows.filter((r) => r[0] !== "ok").map((r) => r[3]), rate_limit_wait_s: rows.reduce((s, r) => s + Number(r[2]), 0) }];
  }));
  const base = { item: m.item, ...route, pulls, ledger: { cap_usd: fromMicros(t.capMicros), settled_usd: fromMicros(t.settledMicros), open_reserves: t.openIds, vm_settles: vm } };
  console.log(ledgerLine);
  const stop = parts.map((p) => p.stop).find(Boolean);
  if (stop) {
    const line = `R3 outcome${m.tag}: none (incomplete: ${stop}). ${m.incomplete}`;
    console.log(line);
    writeFileSync(join(work, "record.json"), JSON.stringify({ ...base, outcome: "incomplete", reason: stop, lines: [ledgerLine, line] }, null, 2) + "\n");
    return 4;
  }
  const a = admission(screen, pilot, m);
  for (const l of a.lines) console.log(l);
  writeFileSync(join(work, "admitted.txt"), a.admitted.map((x) => x + "\n").join(""));
  if (a.r3bTasks.length) writeFileSync(join(work, "r3b-tasks.txt"), a.r3bTasks.map((x) => x + "\n").join(""));
  writeFileSync(join(work, "record.json"), JSON.stringify({ ...base, ...a.record, admitted: a.admitted, r3b_tasks: a.r3bTasks, lines: [ledgerLine, ...a.lines] }, null, 2) + "\n");
  return a.exit;
}

if (import.meta.main) {
  const [cmd, workArg, ...rest] = Bun.argv.slice(2);
  const modelId = rest.length === 0 ? OPUS : rest.length === 2 && rest[0] === "--model" ? rest[1]! : "";
  const m = R3A[modelId];
  if (!workArg || !["all", "prepare", "run", "analyze"].includes(cmd ?? "") || !m) {
    console.error(`E_USAGE usage: bun quick/laneb/r3/screen.ts all|prepare|run|analyze <work dir> [--model ${Object.keys(R3A).join("|")}]`);
    process.exit(2);
  }
  if (!process.env.LEDGER) { console.error(`E_USAGE set LEDGER to ${m.item}'s jsonl ledger`); process.exit(2); }
  const work = resolve(workArg);
  try {
    if (cmd === "prepare" || cmd === "all") prepare(work, m);
    if (cmd === "run" || cmd === "all") run(work, m);
    if (cmd === "analyze" || cmd === "all") process.exit(analyze(work, m));
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    console.error(msg.startsWith("E_USAGE") ? msg : `E_INTERNAL ${msg}`);
    process.exit(msg.startsWith("E_USAGE") ? 2 : 1);
  }
}
