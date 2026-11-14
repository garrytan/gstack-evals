// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 1's readings (prereg section 9, plan M12 and M13), each a pure function: arm means from unit means, the twin
// check, the read order, the tier chain with every edge and the k label, the smoke rules and the lens parse rule.
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { CELL_STATES, ENFORCED_LABEL, JUDGING, PASSES, READS, SATURATION_DETAIL_WORDING, SATURATION_WORDING, SEED, SETS, TIERS } from "../frozen.ts";
import { fail } from "../errors.ts";
import type { GstackArm, Model, Tier } from "../types.ts";
import { above, atLeast, atMost, below, mean, median, show, within } from "./num.ts";
import { bootstrapMeans, percentileInterval, resplitDraws, upperQuantile } from "./stats.ts";
import type { JudgeCheck, ReadCell } from "./types.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";

// ---- Cell values and arm means (M12, M13)

export type Measure = "a" | "g" | "d";

/** A cell's value on a measure: its score when scored, 0 when it counts zero (no block, a second arm stop), else null. */
export function cellValue(c: ReadCell, m: Measure): number | null {
  const count = CELL_STATES[c.state].count;
  if (count === "score") {
    const v = c[m];
    if (v === null && m !== "d") fail("E_USAGE", "cell " + c.unit + " pass " + c.pass + " is scored but has no " + m);
    return v;
  }
  if (count === "zero") return m === "d" && c.d === null ? null : 0;
  return null;
}

/** Each unit's mean over its valued passes (M13): uneven pass counts never weight a unit. */
export function unitMeans(cells: readonly ReadCell[], m: Measure): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const c of cells) {
    const v = cellValue(c, m);
    if (v !== null) by.set(c.unit, [...(by.get(c.unit) ?? []), v]);
  }
  return new Map([...by.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([u, vs]) => [u, mean(vs)]));
}

/** An arm's A, G or D: the mean over units of each unit's mean over its scored passes; null when no unit has one. */
export function armMean(cells: readonly ReadCell[], m: Measure): number | null {
  const um = [...unitMeans(cells, m).values()];
  return um.length ? mean(um) : null;
}

// ---- Judge checks

/** A judge check passes at kappa of at least 0.6, rounded, with its gold floors met. */
export const judgePasses = (c: JudgeCheck): boolean => !c.goldShort && c.kappa !== null && atLeast(c.kappa, JUDGING.kappaMin);

// ---- The twin check (section 9)

export interface TwinPairInput {
  pair: string;
  /** Opus none cells on the first skin and on the second. */
  first: readonly ReadCell[];
  second: readonly ReadCell[];
}

export interface TwinReading {
  tracks: boolean;
  code: ReasonCode | null;
  kept: string[];
  dropped: { pair: string; why: string }[];
  /** Mean paired difference, first minus second skin, with its 90% bootstrap interval. */
  diff: { mean: number; ci90: [number, number] } | null;
  absMean: number | null;
  resplitP95: number | null;
  fails: string[];
  lines: string[];
}

/**
 * The twins track unless (a) the 90% bootstrap interval of the mean paired difference lies wholly outside -0.10 to 0.10,
 * or (b) the mean absolute difference is above the 95th percentile of its re-split distribution. A pair without 3 scored
 * passes on each side drops and is named; with fewer than 6 pairs left the stage reads NO READ (twin).
 */
export function twinCheck(pairs: readonly TwinPairInput[]): TwinReading {
  const need = READS.twin.passesPerSkin;
  const kept: { pair: string; a: number[]; b: number[] }[] = [];
  const dropped: TwinReading["dropped"] = [];
  for (const p of [...pairs].sort((x, y) => (x.pair < y.pair ? -1 : 1))) {
    const vals = (cs: readonly ReadCell[]) => cs.map((c) => cellValue(c, "a")).filter((v): v is number => v !== null);
    const a = vals(p.first), b = vals(p.second);
    if (a.length > need || b.length > need) fail("E_USAGE", "twin pair " + p.pair + " has more than " + need + " passes on a skin");
    if (a.length < need || b.length < need) dropped.push({ pair: p.pair, why: "scored passes " + a.length + " and " + b.length + ", under " + need + " on a side" });
    else kept.push({ pair: p.pair, a, b });
  }
  const lines = dropped.map((d) => "twin pair " + d.pair + " drops: " + d.why);
  const noRead = (why: string): TwinReading => ({ tracks: false, code: "E_DC_TWIN", kept: kept.map((k) => k.pair), dropped, diff: null, absMean: null, resplitP95: null, fails: [why], lines: [...lines, "NO READ (twin): " + why] });
  if (kept.length < SETS.twins.minPairs) return noRead(kept.length + " pairs left with " + need + " scored passes a side, under " + SETS.twins.minPairs);
  const d = kept.map((k) => mean(k.a) - mean(k.b));
  const o = { seed: SEED, draws: READS.draws };
  const ci90 = percentileInterval(bootstrapMeans(d, o), READS.twin.interval);
  const absMean = mean(d.map(Math.abs));
  const resplitP95 = upperQuantile(resplitDraws(kept.map((k) => ({ a: k.a, b: k.b })), o), READS.twin.resplitPercentile);
  const fails: string[] = [];
  if (above(ci90[0], READS.twin.band) || below(ci90[1], -READS.twin.band)) fails.push("(a) the 90% interval " + show(ci90[0]) + " to " + show(ci90[1]) + " lies wholly outside -0.10 to 0.10");
  if (above(absMean, resplitP95)) fails.push("(b) the mean absolute difference " + show(absMean) + " is above the re-split 95th percentile " + show(resplitP95));
  const tracks = !fails.length;
  lines.push("twin check on " + kept.length + " pairs: mean difference " + show(mean(d)) + " (90% " + show(ci90[0]) + " to " + show(ci90[1]) + "), mean absolute difference " + show(absMean) + " against re-split p95 " + show(resplitP95) + ": " + (tracks ? "the twins track" : "NO READ (twin)"));
  return { tracks, code: tracks ? null : "E_DC_TWIN", kept: kept.map((k) => k.pair), dropped, diff: { mean: mean(d), ci90 }, absMean, resplitP95, fails, lines };
}

// ---- The k label (M12)

export interface KMultiple {
  k: number;
  ci95: [number, number];
  label: string;
}

/**
 * k is base-tier none A over 2x none A on the calibration units that keep a 2x version, from unrounded unit means and
 * rounded once; infinite when the 2x none A is 0. Its 95% interval is a paired bootstrap over those units. The tier is
 * labelled "2x" when k is 1.6 to 2.7 and by its measured k otherwise.
 */
export function kMultiple(units: ReadonlyArray<{ unit: string; base: number; x2: number }>): KMultiple {
  if (!units.length) fail("E_USAGE", "k needs at least one unit with a base and a 2x none mean");
  const sorted = [...units].sort((x, y) => (x.unit < y.unit ? -1 : 1));
  const ratio = (xs: typeof sorted) => {
    const den = xs.reduce((s, u) => s + u.x2, 0);
    const num = xs.reduce((s, u) => s + u.base, 0);
    return den === 0 ? (num === 0 ? 0 : Infinity) : num / den;
  };
  const k = ratio(sorted);
  const rng = seededRandom(SEED);
  const draws = new Array<number>(READS.draws);
  for (let i = 0; i < READS.draws; i++) {
    const s = sorted.map(() => sorted[Math.floor(rng() * sorted.length)]!);
    draws[i] = ratio(s);
  }
  draws.sort((a, b) => a - b);
  const ci95 = percentileInterval(draws, READS.interval);
  const label = Number.isFinite(k) && within(k, TIERS.x2.kLabel) ? "2x" : Number.isFinite(k) ? "k " + show(k) : "k infinite";
  return { k, ci95, label };
}

// ---- The read order and the tier chain (section 9)

export interface Stage1Inputs {
  twin: TwinReading;
  /** Astra on Opus lists. */
  opusJudge: JudgeCheck;
  stockFailOpus: boolean;
  opusNoneParse: { parsed: number; replies: number };
  base: { none: number; reference: number };
  /** Given only when 2x versions ran; read as a tier only after a base CEILING, else printed as a lead. */
  x2?: { none: number; reference: number; units: number; costBase: readonly number[]; cost2x: readonly number[]; kUnits: ReadonlyArray<{ unit: string; base: number; x2: number }> };
  x10?: { noneG: number; noneD: number; referenceG: number; detailCheck: JudgeCheck; detailUnits: number };
}

export type R48Kind = "instrument" | "task fit" | "saturation" | "exposure" | "coverage";

export type Stage1Reading =
  | { ends: true; reading: string; code: ReasonCode | null; r48: "FIX-METHOD"; kind: R48Kind; why: string; lines: string[] }
  | { ends: false; reading: "HEADROOM"; tier: Tier; label: string; k: KMultiple | null; lines: string[] };

/** Room is the reference minus none, from unrounded values, rounded once at its threshold. */
const room = (ref: number, none: number) => ref - none;

/**
 * The read order: the twin check, the Opus judge check, STOCK FAIL on Opus lists, the parse rate, then the tier chain.
 * The first that fires decides; each of the four checks ends the eval as R48 FIX-METHOD on the instrument.
 */
export function stage1Reading(i: Stage1Inputs): Stage1Reading {
  const lines: string[] = [...i.twin.lines];
  const end = (reading: string, code: ReasonCode | null, kind: R48Kind, why: string): Stage1Reading => ({ ends: true, reading, code, r48: "FIX-METHOD", kind, why, lines: [...lines, reading + ": " + why + "; R48 FIX-METHOD on " + kind] });
  if (!i.twin.tracks) return end("NO READ (twin)", "E_DC_TWIN", "instrument", i.twin.fails.join("; "));
  if (!judgePasses(i.opusJudge)) return end("NO READ (judge)", "E_DC_NO_READ", "instrument", "the Opus-list judge check " + (i.opusJudge.goldShort ? "is short of gold" : "has kappa " + show(i.opusJudge.kappa) + ", under 0.6"));
  if (i.stockFailOpus) return end("STOCK FAIL", "E_DC_STOCK_FAIL", "instrument", "a stock row is credited past its limit on Opus lists");
  if (i.opusNoneParse.replies < 1) fail("E_USAGE", "the parse rate needs at least one Opus none reply");
  const parse = i.opusNoneParse.parsed / i.opusNoneParse.replies;
  if (below(parse, READS.parseMin)) return end("NO READ (parse)", "E_DC_NO_READ", "instrument", i.opusNoneParse.parsed + " of " + i.opusNoneParse.replies + " Opus none replies parse (" + show(parse) + "), under 0.95");

  const b = i.base, B = TIERS.base;
  lines.push("base tier: Opus none A " + show(b.none) + ", reference A " + show(b.reference) + ", room " + show(room(b.reference, b.none)));
  if (below(b.none, B.noneLowPrint)) lines.push("base tier: Opus none A " + show(b.none) + " is under 0.10; it prints and stops nothing");
  const k = i.x2 ? kMultiple(i.x2.kUnits) : null;
  const leads = () => {
    if (i.x2) lines.push("lead (2x, descriptive): none A " + show(i.x2.none) + ", reference A " + show(i.x2.reference) + ", k " + show(k!.k) + " (95% " + show(k!.ci95[0]) + " to " + show(k!.ci95[1]) + "), cost ratio " + show(costRatio(i.x2)));
    if (i.x10) lines.push("lead (10x, descriptive): none G " + show(i.x10.noneG) + ", none D " + show(i.x10.noneD) + ", reference G " + show(i.x10.referenceG));
  };
  if (!atLeast(b.reference, B.referenceMin)) {
    leads();
    return end("FLOOR", null, "task fit", "the reference A " + show(b.reference) + " is under 0.30: the keys don't follow from the evidence inside the harness");
  }
  if (atMost(b.none, B.noneMax)) {
    if (!atLeast(room(b.reference, b.none), B.roomMin)) {
      leads();
      return end("NO ROOM", null, "task fit", "the reference minus none is " + show(room(b.reference, b.none)) + ", under 0.15: plain Opus decides the same with or without the evidence");
    }
    leads();
    return { ends: false, reading: "HEADROOM", tier: "base", label: "base", k, lines: [...lines, "HEADROOM on the base tier: stage 2 runs on the base tier"] };
  }
  lines.push("base tier: CEILING (none A " + show(b.none) + " above 0.65 with the reference at " + show(b.reference) + "); go to the 2x tier");
  if (!i.x2) fail("E_USAGE", "the base tier reads CEILING, so the chain needs the 2x tier's reads");
  const x = i.x2!, X = TIERS.x2;
  const ratio = costRatio(x);
  const aOk = atMost(x.none, X.noneMax);
  const failsX: string[] = [];
  if (!atLeast(x.reference, X.referenceMin)) failsX.push("(b) the reference A " + show(x.reference) + " is under 0.30");
  if (aOk && !atLeast(room(x.reference, x.none), X.roomMin)) failsX.push("(c) the reference minus none is " + show(room(x.reference, x.none)) + ", under 0.15");
  if (x.units < X.minUnits) failsX.push("(d) " + x.units + " calibration units keep a 2x version, under 12");
  if (!within(ratio, X.budgetAnchor)) failsX.push("(e) the budget anchor reads " + show(ratio) + ", outside 0.80 to 1.25");
  lines.push("2x tier (" + k!.label + "): Opus none A " + show(x.none) + ", reference A " + show(x.reference) + ", " + x.units + " units, cost ratio " + show(ratio) + ", k " + show(k!.k) + " (95% " + show(k!.ci95[0]) + " to " + show(k!.ci95[1]) + ")");
  if (failsX.length) return end("FIX-METHOD (2x " + failsX.map((f) => f.slice(0, 3)).join(" ") + ")", null, "task fit", failsX.join("; "));
  if (aOk) return { ends: false, reading: "HEADROOM", tier: "2x", label: k!.label, k, lines: [...lines, "HEADROOM on the 2x tier, labelled " + k!.label + ": stage 2 runs on the 2x tier"] };
  lines.push("2x tier: CEILING (none A " + show(x.none) + " above 0.60); go to the 10x tier");
  if (!i.x10) fail("E_USAGE", "the 2x tier reads CEILING, so the chain needs the 10x tier's reads");
  const t = i.x10!, T = TIERS.x10;
  lines.push("10x tier: Opus none G " + show(t.noneG) + ", none D " + show(t.noneD) + ", reference G " + show(t.referenceG) + ", " + t.detailUnits + " units with a detail-keyed item");
  if (!judgePasses(t.detailCheck)) return end("NO READ (judge)", "E_DC_NO_READ", "instrument", "Astra's detail check on Opus lists " + (t.detailCheck.goldShort ? "is short of gold" : "has kappa " + show(t.detailCheck.kappa) + ", under 0.6"));
  if (above(t.noneG, T.g[1])) return end("saturation", null, "saturation", "Opus none G " + show(t.noneG) + " is above 0.50: " + SATURATION_WORDING);
  if (above(t.noneD, T.dMax)) return end("saturation (detail)", null, "saturation", "Opus none D " + show(t.noneD) + " is above 0.20: " + SATURATION_DETAIL_WORDING);
  const fails10: string[] = [];
  if (below(t.noneG, T.g[0])) fails10.push("Opus none G " + show(t.noneG) + " is under 0.25");
  if (!atLeast(room(t.referenceG, t.noneG), T.gRoomMin)) fails10.push("the reference G minus none G is " + show(room(t.referenceG, t.noneG)) + ", under 0.15");
  if (t.detailUnits < T.minDetailUnits) fails10.push(t.detailUnits + " calibration units hold a detail-keyed item, under 12");
  if (fails10.length) return end("FIX-METHOD (10x)", null, "task fit", fails10.join("; "));
  return { ends: false, reading: "HEADROOM", tier: "10x", label: "10x", k, lines: [...lines, "HEADROOM on the 10x tier: stage 2 runs on the 10x tier, read on G"] };
}

/** The budget anchor: the median Opus none session cost on 2x versions over the median on the base tier. */
export function costRatio(x: { costBase: readonly number[]; cost2x: readonly number[] }): number {
  const base = median(x.costBase);
  if (base <= 0) fail("E_USAGE", "the budget anchor needs a positive base-tier median cost");
  return median(x.cost2x) / base;
}

// ---- Smoke rules (2026-11-09 section 9, rules 1 to 5)

export interface SmokeSession {
  parsed: boolean;
  exposed: boolean;
  usd: number;
  /** Times the D1 repair hook blocked the stop; 0 on a first smoke. */
  blocks: number;
}

export interface SmokeRun {
  parse: number;
  exposure: number;
  fails: ("parse" | "exposure")[];
  meanUsd: number;
}

/** Rules 1 and 2 on one arm's 6 smoke sessions on one model: a parsable block and exposure each in at least 5 of 6. */
export function smokeRun(sessions: readonly SmokeSession[]): SmokeRun {
  if (sessions.length !== READS.smoke.of) fail("E_USAGE", "a smoke reads exactly " + READS.smoke.of + " sessions, got " + sessions.length);
  const parse = sessions.filter((s) => s.parsed).length;
  const exposure = sessions.filter((s) => s.exposed).length;
  const fails: SmokeRun["fails"] = [];
  if (parse < READS.smoke.parseMin) fails.push("parse");
  if (exposure < READS.smoke.exposureMin) fails.push("exposure");
  return { parse, exposure, fails, meanUsd: mean(sessions.map((s) => s.usd)) };
}

export interface SmokeDecision {
  arm: GstackArm;
  model: Model;
  outcome: "pass" | "repair" | "enforced" | "dropped";
  /** "with an enforced procedure" when the arm passes its re-smoke under the repair hook. */
  label: string | null;
  /** The untested conditions a dropped arm's contrast reads. */
  untested: ("exposure" | "parse")[];
  code: ReasonCode | null;
  /** A dropped arm enters Holm at p = 1. */
  holmP1: boolean;
  /** Rule 3: replaces the planning figure in the projection rerun (BT: the smoke whose result stands). */
  meanUsd: number;
  lines: string[];
}

/**
 * Rule 4: an arm failing rule 1 or 2 on a model reruns its 6 sessions with the repair hook; passing the re-smoke runs it
 * "with an enforced procedure", failing again drops it for that model with its contrast untested (exposure or parse).
 */
export function smokeDecision(arm: GstackArm, model: Model, first: readonly SmokeSession[], resmoke?: readonly SmokeSession[]): SmokeDecision {
  const f = smokeRun(first);
  const head = arm + " on " + model + ": smoke parse " + f.parse + " of 6, exposure " + f.exposure + " of 6";
  const base = { arm, model, label: null, untested: [], code: null, holmP1: false };
  if (!f.fails.length) return { ...base, outcome: "pass", meanUsd: f.meanUsd, lines: [head + ": pass"] };
  if (!resmoke) return { ...base, outcome: "repair", meanUsd: f.meanUsd, lines: [head + ": fails " + f.fails.join(" and ") + "; re-smoke 6 sessions with the repair hook"] };
  const r = smokeRun(resmoke);
  const lines = [head + ": fails " + f.fails.join(" and "), arm + " on " + model + ": re-smoke parse " + r.parse + " of 6, exposure " + r.exposure + " of 6, blocks per session " + resmoke.map((s) => s.blocks).join(" ")];
  if (!r.fails.length) return { ...base, outcome: "enforced", label: ENFORCED_LABEL, meanUsd: r.meanUsd, lines: [...lines, "runs " + ENFORCED_LABEL] };
  return { ...base, outcome: "dropped", untested: r.fails, code: "E_DC_SMOKE_DROP", holmP1: true, meanUsd: r.meanUsd, lines: [...lines, "drops for " + model + " (E_DC_SMOKE_DROP): untested (" + r.fails.join(", ") + "), enters Holm at p = 1"] };
}

/** Rule 5: at least 95% of each model's stage 1 lens reviews parse (46 of 48 on Opus; all 16 on Sol and particle-1). */
export function lensParse(model: Model, parsed: number): { pass: boolean; planned: number; line: string } {
  const planned = PASSES.stage1.baseLens[model] * SETS.calibration;
  const pass = atLeast(parsed / planned, READS.lensParseMin);
  return { pass, planned, line: model + " lens parse " + parsed + " of " + planned + (pass ? ": pass" : ": under 95%, the template goes to the Captain before stage 2") };
}


