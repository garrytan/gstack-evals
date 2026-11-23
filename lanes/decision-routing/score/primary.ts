// Copyright (c) 2026 Garry Tan. MIT License.
// Primary A (R against N) and Primary B (R against P) with their verdict printers (prereg section 11). Success deltas and
// intervals come from clusteredPairedDelta over repository clusters (10,000 draws, seed 20261111); bill and time ratios
// from clusterRatio over the same clusters and seed. A verdict is the first rule that matches, with separate lists for
// contrasts admitted to the non-inferiority test and kept out of it (section 7).
import { clusteredPairedDelta } from "../../../src/runner/stats/paired.ts";
import { clusterRatio } from "./ratio.ts";
import { coverage, pairOnTasks, type SessionOutcome } from "./session.ts";

export const BOOT = { seed: 20261111, draws: 10000 };
export const MARGIN = 7.5;
export const HOLDS_LINE = 0.8;
export const LEG_LINE = 0.9;

export const A_VERDICTS = {
  admitted: ["NO SAVING", "TRADES SUCCESS FOR COST", "INCONCLUSIVE ON SUCCESS", "HOLDS", "SAVES LESS"],
  kept_out: ["NO SAVING", "SUCCESS MEASURABLY LOWER", "CUTS ABOUT 90%, SUCCESS UNTESTED", "CUTS LESS, SUCCESS UNTESTED"],
};
export const B_VERDICTS = {
  admitted: ["PARTICLE-1 ALONE IS BETTER", "INCONCLUSIVE", "THE ROUTER EARNS ITS PLACE ON SUCCESS", "THE ROUTER EARNS ITS PLACE", "PARTICLE-1 ALONE IS ENOUGH"],
  kept_out: ["PARTICLE-1 ALONE IS BETTER", "THE ROUTER EARNS ITS PLACE ON SUCCESS", "R CHEAPER AND FASTER", "R CHEAPER", "R FASTER", "NO COST OR TIME GAIN"],
};

export interface Verdict { verdict: string; rule: number; legs: string[] }
type Rule = [string, boolean, string[]?];

function firstMatch(rules: Rule[]): Verdict {
  const i = rules.findIndex(([, hit]) => hit);
  return { verdict: rules[i]![0], rule: i + 1, legs: rules[i]![2] ?? [] };
}

export function verdictA(b: { cut_lo: number; success_lo: number; success_hi: number }, admitted: boolean): Verdict {
  return firstMatch(admitted ? [
    ["NO SAVING", b.cut_lo <= 0],
    ["TRADES SUCCESS FOR COST", b.success_hi < 0 && b.success_lo <= -MARGIN],
    ["INCONCLUSIVE ON SUCCESS", b.success_lo <= -MARGIN],
    ["HOLDS", b.cut_lo >= HOLDS_LINE],
    ["SAVES LESS", true],
  ] : [
    ["NO SAVING", b.cut_lo <= 0],
    ["SUCCESS MEASURABLY LOWER", b.success_hi < 0],
    ["CUTS ABOUT 90%, SUCCESS UNTESTED", b.cut_lo >= HOLDS_LINE],
    ["CUTS LESS, SUCCESS UNTESTED", true],
  ]);
}

export function verdictB(b: { success_lo: number; success_hi: number; bill_lo: number; bill_hi: number; time_lo: number; time_hi: number }, admitted: boolean): Verdict {
  const cheaper = b.bill_hi < LEG_LINE, faster = b.time_hi < LEG_LINE;
  const successLegs = [cheaper ? "and cheaper" : b.bill_lo > 1 ? "but costlier" : null, faster ? "and faster" : b.time_lo > 1 ? "but slower" : null].filter((x): x is string => x !== null);
  const gain = cheaper && faster ? "cheaper and faster" : cheaper ? "cheaper" : faster ? "faster" : null;
  const untested = ["success untested"];
  return firstMatch(admitted ? [
    ["PARTICLE-1 ALONE IS BETTER", b.success_hi < 0],
    ["INCONCLUSIVE", b.success_lo <= -MARGIN],
    ["THE ROUTER EARNS ITS PLACE ON SUCCESS", b.success_lo > 0, successLegs],
    ["THE ROUTER EARNS ITS PLACE", gain !== null, gain ? [gain] : []],
    ["PARTICLE-1 ALONE IS ENOUGH", true],
  ] : [
    ["PARTICLE-1 ALONE IS BETTER", b.success_hi < 0],
    ["THE ROUTER EARNS ITS PLACE ON SUCCESS", b.success_lo > 0, successLegs],
    ["R CHEAPER AND FASTER", cheaper && faster, untested],
    ["R CHEAPER", cheaper, untested],
    ["R FASTER", faster, untested],
    ["NO COST OR TIME GAIN", true, untested],
  ]);
}

export function successReading(lo: number, hi: number): string {
  if (lo > 0) return "a measurable gain";
  if (hi < 0) return lo > -MARGIN ? "a small measurable loss inside the margin" : "a measurable loss beyond the margin";
  return "no measurable difference";
}

export interface SuccessStats { delta: number; ci: [number, number]; worse: number; better: number; n: number }
interface Common { model?: string; admitted: boolean; success: SuccessStats | null; time_ratio: number | null; time_ci: [number, number] | null; verdict: Verdict | null; void_reason?: string; n_pairs?: number }
export interface PrimaryA extends Common { cut: number | null; cut_ci: [number, number] | null; median_ratio: number | null }
export interface PrimaryB extends Common { bill_ratio: number | null; bill_ci: [number, number] | null }

interface ContrastInput { treatment: readonly SessionOutcome[]; control: readonly SessionOutcome[]; planned: readonly string[]; admitted: boolean; model?: string }

function contrast(input: ContrastInput) {
  const covT = coverage(input.treatment, input.planned), covC = coverage(input.control, input.planned);
  if (!covT.ok || !covC.ok) return { ok: false as const, void_reason: "coverage: treatment graded " + covT.graded + " of " + covT.planned + " (" + covT.not_entered + " not entered), control graded " + covC.graded + " of " + covC.planned + " (" + covC.not_entered + " not entered); 90% graded and at most 10% not entered are needed" };
  const pairs = pairOnTasks(input.control, input.treatment);
  const s = clusteredPairedDelta(pairs.map((p) => ({ id: p.task, cluster: p.repo, a: p.a.success!, b: p.b.success! })), BOOT);
  if (!s.ci95) return { ok: false as const, void_reason: "fewer than two repository clusters in " + pairs.length + " pairs" };
  const success: SuccessStats = { delta: s.delta * 100, ci: [s.ci95[0] * 100, s.ci95[1] * 100], worse: pairs.filter((p) => p.a.success === 1 && p.b.success === 0).length, better: pairs.filter((p) => p.a.success === 0 && p.b.success === 1).length, n: pairs.length };
  const bill = clusterRatio(pairs.map((p) => ({ cluster: p.repo, a: p.a.bill_usd!, b: p.b.bill_usd! })), BOOT);
  const time = clusterRatio(pairs.map((p) => ({ cluster: p.repo, a: p.a.time_ms!, b: p.b.time_ms! })), BOOT);
  const perTask = pairs.filter((p) => p.a.bill_usd! > 0).map((p) => p.b.bill_usd! / p.a.bill_usd!).sort((x, y) => x - y);
  const mid = perTask.length / 2;
  const median = perTask.length ? (perTask.length % 2 ? perTask[Math.floor(mid)]! : (perTask[mid - 1]! + perTask[mid]!) / 2) : null;
  return { ok: true as const, success, bill, time, median, n_pairs: pairs.length };
}

const voidA = (input: ContrastInput, void_reason: string): PrimaryA => ({ model: input.model, admitted: input.admitted, cut: null, cut_ci: null, median_ratio: null, success: null, time_ratio: null, time_ci: null, verdict: null, void_reason });

export function primaryA(input: ContrastInput, withVerdict = true): PrimaryA {
  const c = contrast(input);
  if (!c.ok) return voidA(input, c.void_reason);
  const cut_ci: [number, number] | null = c.bill.ci95 ? [1 - c.bill.ci95[1], 1 - c.bill.ci95[0]] : null;
  return {
    model: input.model, admitted: input.admitted, n_pairs: c.n_pairs, cut: 1 - c.bill.ratio, cut_ci, median_ratio: c.median, success: c.success, time_ratio: c.time.ratio, time_ci: c.time.ci95,
    verdict: withVerdict && cut_ci ? verdictA({ cut_lo: cut_ci[0], success_lo: c.success.ci[0], success_hi: c.success.ci[1] }, input.admitted) : null,
  };
}

export function primaryB(input: ContrastInput): PrimaryB {
  const c = contrast(input);
  if (!c.ok) return { model: input.model, admitted: input.admitted, bill_ratio: null, bill_ci: null, success: null, time_ratio: null, time_ci: null, verdict: null, void_reason: c.void_reason };
  return {
    model: input.model, admitted: input.admitted, n_pairs: c.n_pairs, bill_ratio: c.bill.ratio, bill_ci: c.bill.ci95, success: c.success, time_ratio: c.time.ratio, time_ci: c.time.ci95,
    verdict: c.bill.ci95 && c.time.ci95 ? verdictB({ success_lo: c.success.ci[0], success_hi: c.success.ci[1], bill_lo: c.bill.ci95[0], bill_hi: c.bill.ci95[1], time_lo: c.time.ci95[0], time_hi: c.time.ci95[1] }, input.admitted) : null,
  };
}

const pct = (x: number) => (100 * x).toFixed(1) + "%";
const r3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "unbounded");
const ci = (c: [number, number] | null, f: (x: number) => string) => (c ? " (95% interval " + f(c[0]) + " to " + f(c[1]) + ")" : " (no interval)");

function successLine(label: string, s: SuccessStats | null, admitted: boolean): string {
  if (!s) return "success: none";
  return "success: " + label + " " + s.delta.toFixed(1) + " points" + ci(s.ci, (x) => x.toFixed(1)) + ", worse " + s.worse + ", better " + s.better + ", " + s.n + " paired tasks: " + successReading(s.ci[0], s.ci[1]) + (admitted ? "" : "; non-inferiority not admitted");
}

function verdictLines(r: Common): string[] {
  if (!r.verdict) return ["NO OUTCOME: " + (r.void_reason ?? "an interval could not be computed")];
  return ["verdict: " + r.verdict.verdict, ...(r.verdict.legs.length ? ["legs: " + r.verdict.legs.join(", ")] : [])];
}

/** Primary A's lines: cut, success and time always print; then the verdict (or NO OUTCOME). */
export function printA(r: PrimaryA, label = "R minus N", withVerdict = true): string[] {
  return [
    "cut: " + (r.cut === null ? "none" : pct(r.cut) + ci(r.cut_ci, pct)) + ", median per-task ratio " + (r.median_ratio === null ? "none" : r3(r.median_ratio)),
    successLine(label, r.success, r.admitted),
    "time ratio: " + (r.time_ratio === null ? "none" : r3(r.time_ratio) + ci(r.time_ci, r3)),
    ...(withVerdict ? verdictLines(r) : r.void_reason ? ["NO OUTCOME: " + r.void_reason] : []),
  ];
}

/** Primary B's lines: success, bill ratio and time ratio with the cheaper and faster legs at 0.90, then the verdict. */
export function printB(r: PrimaryB): string[] {
  return [
    successLine("R minus P", r.success, r.admitted),
    "bill ratio R/P: " + (r.bill_ratio === null ? "none" : r3(r.bill_ratio) + ci(r.bill_ci, r3)) + (r.bill_ci && r.bill_ci[1] < LEG_LINE ? ", cheaper" : ""),
    "time ratio R/P: " + (r.time_ratio === null ? "none" : r3(r.time_ratio) + ci(r.time_ci, r3)) + (r.time_ci && r.time_ci[1] < LEG_LINE ? ", faster" : ""),
    ...verdictLines(r),
  ];
}
