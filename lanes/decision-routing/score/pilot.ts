// Copyright (c) 2026 Garry Tan. MIT License.
// Pilot rules (preregistration section 8), decided on pilot data only:
// - the re-cost: each cell's session rate becomes the higher of its planning rate (price.py, frozen) and its pilot mean,
//   and the plan is priced again with price.py's own formulas; items already recorded (calibration, pilot, replay,
//   crew) keep their caps from config/items.json;
// - the drop order: while the all-in at caps passes the $2,000 line, drop W, then J on Sol, then F, then the subset from
//   100 to 80 tasks, each printed as "not run under the line";
// - particle-1's max_tokens: when its no-answer rate after its retry passes 2% of its pilot decisions, decision
//   max_tokens rises once to 16,000 for the scored stage;
// - the pilot session stop: a pilot session past $2.50 stops for the Captain (DR_PILOT_SESSION_STOP, code first).
//   pilot --trials <dir>... --journal <file>... --prices <prices.json> [--items <items.json>] [--json <out>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { trialDirs } from "./cli.ts";
import { callUsd, loadPrices, readJournal } from "./session.ts";

/** price.py RATE, frozen at the preregistration: dollars of model calls per session, keyed cell:model (W runs alone). */
export const PLANNING_RATE: Readonly<Record<string, number>> = { "N:opus": 0.4, "N:sol": 0.45, "F:opus": 0.8, "R:opus": 0.32, "R:sol": 0.35, "P:opus": 0.3, "P:sol": 0.33, "J:opus": 0.35, "J:sol": 0.38, "W:-": 0.2 };
export const SHADOW_PER_SESSION = 0.06;
export const LABEL_RUNS_PER_SESSION = 2;
export const VM_HOUR_USD = 0.6;
export const CREW_EXPECTED = 220;
export const REPLAY_EXPECTED = 15;
export const PILOT_SESSION_STOP_USD = 2.5;
export const NO_ANSWER_LINE = 0.02;
export const PARTICLE_MAX_TOKENS = { base: 8000, raised: 16000 } as const;
export const ITEMS_FILE = join(import.meta.dir, "..", "config", "items.json");
/** Items whose caps the Captain records before the pilot re-cost; their caps come from items.json. */
const RECORDED = ["dr-calibration", "dr-pilot-rp", "dr-pilot-jfw", "dr-replay", "dr-crew"];

export interface Scope { S: number; S2: number; w: boolean; jSol: boolean; f: boolean }
export const FULL_SCOPE: Scope = { S: 280, S2: 100, w: true, jSol: true, f: true };
export interface PlanItem { item: string; sessions: number; expected: number; cap: number }
export interface Plan { items: PlanItem[]; sessions: number; label_runs: number; vm_hours: number; all_in_expected: number; all_in_cap: number }
export interface ItemsFile { line_micros: number; items: Array<{ item: string; cap_micros: number }> }

const ceil10 = (x: number) => Math.ceil(x / 10) * 10;
export const rateKey = (cell: string, model: string) => cell + ":" + (cell === "W" ? "-" : model);

/** price.py's plan() with a rate table and a scope; recorded items take their caps from the items file. */
export function plan(rate: Readonly<Record<string, number>>, scope: Scope, itemsFile: ItemsFile): Plan {
  const items: PlanItem[] = [];
  let labelRuns = 0;
  const add = (item: string, cells: string[], n: number, o: { extra?: number; m?: number; labelled?: string[] } = {}) => {
    if (!cells.length || n === 0) return;
    const expected = cells.reduce((s, c) => s + rate[c]!, 0) * n + (o.extra ?? 0);
    items.push({ item, sessions: cells.length * n, expected, cap: ceil10((o.m ?? 1.35) * expected + 30) });
    labelRuns += cells.filter((c) => (o.labelled ?? []).includes(c.split(":")[0]!)).length * n * LABEL_RUNS_PER_SESSION;
  };
  add("dr-calibration", ["N:opus", "N:sol"], 40, { extra: SHADOW_PER_SESSION * 2 * 40, m: 1.5, labelled: ["N"] });
  add("dr-pilot-rp", ["R:opus", "R:sol", "P:opus", "P:sol"], 20, { m: 1.5 });
  add("dr-pilot-jfw", ["J:opus", "J:sol", "F:opus", "W:-"], 12, { m: 1.5 });
  add("dr-scored-opus", ["N:opus", "R:opus", "P:opus"], scope.S, { labelled: ["R", "P"] });
  add("dr-scored-sol", ["N:sol", "R:sol", "P:sol"], scope.S, { labelled: ["R", "P"] });
  add("dr-subset", [...(scope.f ? ["F:opus"] : []), "J:opus", ...(scope.jSol ? ["J:sol"] : [])], scope.S2, { labelled: ["F", "J"] });
  if (scope.w) add("dr-w-reference", ["W:-"], scope.S2);
  items.push({ item: "dr-replay", sessions: 0, expected: REPLAY_EXPECTED, cap: 40 });
  const sessions = items.reduce((s, i) => s + i.sessions, 0);
  const vmHours = sessions * 0.05 + labelRuns * 0.005 + 10;
  items.push({ item: "dr-vms", sessions: 0, expected: vmHours * VM_HOUR_USD, cap: ceil10(1.35 * vmHours * VM_HOUR_USD + 20) });
  items.push({ item: "dr-crew", sessions: 0, expected: CREW_EXPECTED, cap: 350 });
  for (const it of items) {
    if (!RECORDED.includes(it.item)) continue;
    const row = itemsFile.items.find((r) => r.item === it.item);
    if (!row) throw new Error("E_USAGE: items file has no row " + it.item);
    it.cap = row.cap_micros / 1e6;
  }
  return { items, sessions, label_runs: labelRuns, vm_hours: vmHours, all_in_expected: items.reduce((s, i) => s + i.expected, 0), all_in_cap: items.reduce((s, i) => s + i.cap, 0) };
}

export const DROPS: ReadonlyArray<{ label: string; apply: (s: Scope) => Scope }> = [
  { label: "W, the whole agent on particle-1 (100 tasks)", apply: (s) => ({ ...s, w: false }) },
  { label: "J on Sol (subset)", apply: (s) => ({ ...s, jSol: false }) },
  { label: "F on Opus (subset)", apply: (s) => ({ ...s, f: false }) },
  { label: "the subset from 100 to 80 tasks", apply: (s) => ({ ...s, S2: 80 }) },
];

export interface Recost { rate: Record<string, number>; means: Record<string, number>; plan: Plan; scope: Scope; dropped: string[]; line: number; fits: boolean }

/** Section 8's re-cost: rates become max(planning, pilot mean), then cells drop in the frozen order until the caps fit the line. */
export function recost(means: Readonly<Record<string, number>>, itemsFile: ItemsFile = JSON.parse(readFileSync(ITEMS_FILE, "utf8"))): Recost {
  const rate = Object.fromEntries(Object.entries(PLANNING_RATE).map(([k, r]) => [k, Math.max(r, means[k] ?? 0)]));
  const line = itemsFile.line_micros / 1e6;
  let scope = FULL_SCOPE;
  let p = plan(rate, scope, itemsFile);
  const dropped: string[] = [];
  for (const d of DROPS) {
    if (p.all_in_cap <= line) break;
    scope = d.apply(scope);
    p = plan(rate, scope, itemsFile);
    dropped.push(d.label);
  }
  return { rate, means: { ...means }, plan: p, scope, dropped, line, fits: p.all_in_cap <= line };
}

export function printRecost(r: Recost): string[] {
  const usd = (x: number) => "$" + x.toFixed(2);
  return [
    ...Object.keys(PLANNING_RATE).map((k) => "rate " + k + ": planning " + usd(PLANNING_RATE[k]!) + ", pilot mean " + (r.means[k] === undefined ? "none" : usd(r.means[k]!)) + ", re-cost " + usd(r.rate[k]!)),
    ...r.plan.items.map((i) => "item " + i.item + ": " + i.sessions + " sessions, expected " + usd(i.expected) + ", cap $" + i.cap),
    ...r.dropped.map((d) => "not run under the line: " + d),
    "all-in at caps $" + r.plan.all_in_cap + " against the $" + r.line + " line: " + (r.fits ? "fits" : "still over after every drop; a raised line needs the Captain"),
  ];
}

export interface NoAnswers { decisions: number; no_answers: number; rate: number; max_tokens: 8000 | 16000 }

/** particle-1's no-answer rate after its retry over its live pilot decisions; a state over the size limit was never asked. */
export function particleNoAnswers(decisions: ReadonlyArray<Record<string, any>>): NoAnswers {
  let n = 0, miss = 0;
  for (const d of decisions) {
    if (d.mode !== "live") continue;
    for (const k of ["particle", "particle_noguess"]) {
      const l = d.layers?.[k];
      if (!l || l.error === "state_over_limit") continue;
      n++;
      if (l.ok !== true) miss++;
    }
  }
  const rate = n ? miss / n : 0;
  return { decisions: n, no_answers: miss, rate, max_tokens: rate > NO_ANSWER_LINE ? PARTICLE_MAX_TOKENS.raised : PARTICLE_MAX_TOKENS.base };
}

/** Pilot sessions past $2.50, each a DR_PILOT_SESSION_STOP line, code first. */
export function pilotSessionStops(sessions: ReadonlyArray<{ session: string; usd: number }>): string[] {
  return sessions.filter((s) => s.usd > PILOT_SESSION_STOP_USD).map((s) => "DR_PILOT_SESSION_STOP pilot session " + s.session + " cost $" + s.usd.toFixed(2) + ", past $2.50: the pilot stops for the Captain; running sessions finish, nothing new launches, every lease is settled");
}

const flag = (argv: string[], name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const flags = (argv: string[], name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
const readJson = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

export async function main(argv: string[]): Promise<number> {
  const roots = flags(argv, "--trials"), journals = flags(argv, "--journal"), prices = flag(argv, "--prices");
  if (!roots.length || !journals.length || !prices) {
    console.error("E_USAGE pilot --trials <dir>... --journal <file>... --prices <prices.json> [--items <items.json>] [--json <out>]");
    return 2;
  }
  const gone = [...roots, ...journals, prices, ...(flag(argv, "--items") ? [flag(argv, "--items")!] : [])].find((p) => !existsSync(p));
  if (gone) { console.error("E_USAGE no such file or directory: " + gone); return 2; }
  const calls = readJournal(journals), table = loadPrices(prices);
  const sums: Record<string, { usd: number; n: number }> = {};
  const sessions: Array<{ session: string; usd: number }> = [];
  const decisions: Array<Record<string, any>> = [];
  for (const dir of roots.flatMap(trialDirs)) {
    const summary = readJson(join(dir, "agent", "dr", "dr-summary.json"));
    const meter = readJson(join(dir, "agent", "dr", "meter.json"))?.meter_id;
    if (!summary || typeof meter !== "string") continue;
    const usd = (calls.get(meter) ?? []).reduce((s, c) => s + callUsd(c, table), 0);
    const k = rateKey(summary.cell, summary.model);
    sums[k] = { usd: (sums[k]?.usd ?? 0) + usd, n: (sums[k]?.n ?? 0) + 1 };
    sessions.push({ session: summary.session, usd });
    const log = join(dir, "agent", "dr", "decisions.jsonl");
    if (existsSync(log)) decisions.push(...readFileSync(log, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)));
  }
  const means = Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v.usd / v.n]));
  const itemsFile = JSON.parse(readFileSync(flag(argv, "--items") ?? ITEMS_FILE, "utf8")) as ItemsFile;
  const r = recost(means, itemsFile);
  const na = particleNoAnswers(decisions);
  const stops = pilotSessionStops(sessions);
  for (const s of stops) console.error(s);
  console.log([...printRecost(r), "particle-1 no-answers after retry: " + na.no_answers + " of " + na.decisions + " pilot decisions (" + (100 * na.rate).toFixed(2) + "%); scored-stage decision max_tokens " + na.max_tokens].join("\n"));
  const out = flag(argv, "--json");
  if (out) writeFileSync(out, JSON.stringify({ recost: r, no_answers: na, session_stops: stops }, null, 2) + "\n");
  return stops.length ? 2 : r.fits ? 0 : 1;
}
