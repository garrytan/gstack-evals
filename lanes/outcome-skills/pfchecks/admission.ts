// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 10 and 13: the admission readings (FLOOR, the contrast floor, CEILING with the cut-report check,
// EXPOSURE, INFRA, cost), the re-price and the n rule, the mid-run check after 10 test units, and the blind-probe fit.
import { issueCut, p95 } from "../statemachines/admission.ts";
import { ALLOWANCE, LINE, MODEL_ITEM, MODELS, OPUS, OWNER_MICROS, PLANNING, VM_USD, ITEMS, type Arm } from "./items.ts";

export { issueCut };
export type Counts = Record<Arm, number>;
const M = 1_000_000;

/** FLOOR: no told arm catches on 2 or more of the 8 units. After the raise, FLOOR again stops the test. */
export function floorReading(c: Counts, raise?: Counts): { reading: "OK" | "FLOOR" | "STOP"; next: string } {
  const floor = (x: Counts) => Math.max(x.P, x.C, x.N) < 2;
  if (!floor(c)) return { reading: "OK", next: "run the test set" };
  if (!raise) return { reading: "FLOOR", next: "raise: add a line naming the files the fix changed to every arm's bug report, on 8 fresh admission units" };
  return floor(raise) ? { reading: "STOP", next: "stop the test and report the finding: no arm leaves a check that catches a reported real bug at a measurable rate" } : { reading: "OK", next: "run the test set with the named-files report" };
}
/** A verdict contrast is floor-bound when both its arms catch on at most 1 of the 8. */
export const contrastFloor = (c: Counts): { "P-N": boolean; "P-C": boolean } => ({ "P-N": c.P <= 1 && c.N <= 1, "P-C": c.P <= 1 && c.C <= 1 });

/** CEILING: N catches on 7 or more of 8. With the cut report, the cut is used when N catches on 6 or fewer and neither P
 *  nor C catches on 1 or fewer; otherwise the full report, and the Opus head-to-head is ceiling-bound. */
export function ceilingReading(n: number, cut?: Counts): { reading: "OK" | "CEILING"; issue: "full" | "cut" | null; ceiling_bound: boolean; next: string } {
  if (n < 7) return { reading: "OK", issue: "full", ceiling_bound: false, next: "full report" };
  if (!cut) return { reading: "CEILING", issue: null, ceiling_bound: false, next: "raise: run P, C and N on the same 8 units with the report cut to its title and first paragraph" };
  if (cut.N <= 6 && cut.P > 1 && cut.C > 1) return { reading: "CEILING", issue: "cut", ceiling_bound: false, next: "use the cut report for every arm and model" };
  return { reading: "CEILING", issue: "full", ceiling_bound: true, next: "full report; the Opus head-to-head can only read HURTS or NO MEASURABLE DIFFERENCE (ceiling-bound)" };
}

export interface PSession { unit: string; loaded: boolean; checker: boolean; harness_defect: string | null }
/** EXPOSURE: any harness defect blocks the test until fixed with the Captain; P loaded but ran a checker in fewer than 6 of
 *  8 sessions is the model's choice, reported and never fixed. */
export function exposureReading(s: PSession[]): { reading: "OK" | "HARNESS_DEFECT" | "MODEL_CHOICE"; defects: string[]; loaded_and_checker: number; sessions: number; process_reading: string } {
  const defects = s.filter((x) => x.harness_defect).map((x) => x.unit + ": " + x.harness_defect);
  const k = s.filter((x) => x.loaded && x.checker).length;
  const fair = k >= Math.ceil(0.75 * s.length);
  const process_reading = fair ? "a fair test of pstack's text" : "pstack as the model ran it (" + k + " of " + s.length + ")";
  if (defects.length) return { reading: "HARNESS_DEFECT", defects, loaded_and_checker: k, sessions: s.length, process_reading };
  return { reading: fair ? "OK" : "MODEL_CHOICE", defects, loaded_and_checker: k, sessions: s.length, process_reading };
}

/** INFRA: gaps on more than 10% of any admission cell, or a scoring path that cannot run entries. */
export function infraReading(cells: Array<{ cell: string; units: number; gaps: number }>, brokenPaths: string[] = []): { reading: "OK" | "INFRA"; over: string[]; broken: string[] } {
  const over = cells.filter((c) => c.units > 0 && c.gaps / c.units > 0.1).map((c) => c.cell);
  return { reading: over.length || brokenPaths.length ? "INFRA" : "OK", over, broken: brokenPaths };
}

/** Cost: each arm's 95th-percentile Opus session cost against half its allowance; an arm over it doubles its allowance on
 *  every model before the test run. */
export function costReading(opusCosts: Record<Arm, number[]>): { arms: Array<{ arm: Arm; p95: number | null; half: number; over: boolean }>; allowance: Record<Arm, Record<string, number>> } {
  const arms = (["P", "C", "N"] as Arm[]).map((arm) => { const p = p95(opusCosts[arm]); const half = ALLOWANCE[arm][OPUS]! / 2; return { arm, p95: p, half, over: p !== null && p > half }; });
  const allowance = Object.fromEntries(arms.map((a) => [a.arm, Object.fromEntries(Object.entries(ALLOWANCE[a.arm]).map(([m, v]) => [m, a.over ? 2 * v : v]))])) as Record<Arm, Record<string, number>>;
  return { arms, allowance };
}

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
const ceil10 = (usd: number) => Math.ceil(usd / 10 - 1e-9) * 10;

/** Re-priced per-session prices: Opus 1.2 x its measured mean per arm; Sol and particle-1 the larger of the planning price
 *  and 1.5 x the measured mean. An arm with no measured session keeps its planning price. */
export function reprice(measured: Record<string, Partial<Record<Arm, number[]>>>): Record<string, Record<Arm, number>> {
  const out: Record<string, Record<Arm, number>> = {};
  for (const m of MODELS) {
    out[m] = {} as Record<Arm, number>;
    for (const a of ["P", "C", "N"] as Arm[]) {
      const mu = mean(measured[m]?.[a] ?? []);
      out[m]![a] = mu === null ? PLANNING[m]![a] : m === OPUS ? 1.2 * mu : Math.max(PLANNING[m]![a], 1.5 * mu);
    }
  }
  return out;
}
/** A model item's re-priced cap for n units: n x (the three arms' prices plus a VM each), rounded up to $10. */
export const itemCap = (prices: Record<Arm, number>, n: number): number => ceil10(n * (prices.P + prices.C + prices.N + 3 * VM_USD));

/** The n rule: the largest n up to 60, never above the supply, whose three re-priced caps fit inside what is left of the
 *  line (its $1,960 less the spend recorded so far and the crew use still held back). Under 30 the Captain decides. */
export function nRule(prices: Record<string, Record<Arm, number>>, o: { supply: number; spent_usd: number; crew_held_usd: number }): { n: number; caps: Record<string, number>; left_usd: number; captain: boolean; owner: boolean } {
  const left_usd = LINE.cap_micros / M - o.spent_usd - o.crew_held_usd;
  const total = (n: number) => MODELS.reduce((s, m) => s + itemCap(prices[m]!, n), 0);
  let n = 0;
  for (let k = Math.min(60, o.supply); k >= 1; k--) if (total(k) <= left_usd + 1e-9) { n = k; break; }
  const caps = Object.fromEntries(MODELS.map((m) => [MODEL_ITEM[m]!, itemCap(prices[m]!, n)]));
  return { n, caps, left_usd, captain: n < 30, owner: o.spent_usd + total(n) > OWNER_MICROS / M };
}

/** The second re-price for Sol and particle-1 after their first 10 test units: spend so far plus the remaining units at the
 *  new price; past the item's cap, the part stops before its next unit and the Captain decides. */
export function midRunCheck(model: string, o: { cap_usd: number; spent_usd: number; done: number; n: number; measured: Partial<Record<Arm, number[]>> }): { projection_usd: number; stop: boolean; prices: Record<Arm, number> } {
  const prices = reprice({ [model]: o.measured })[model]!;
  const projection_usd = o.spent_usd + (o.n - o.done) * (prices.P + prices.C + prices.N + 3 * VM_USD);
  return { projection_usd, stop: projection_usd > o.cap_usd + 1e-9, prices };
}

/** pf-blind runs after the test run only if the spend recorded so far plus its cap stays inside the line. */
export const blindFits = (spentUsd: number): boolean => spentUsd + ITEMS["pf-blind"]!.cap_micros / M <= LINE.cap_micros / M + 1e-9;
