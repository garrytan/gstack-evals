// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 2's readings (prereg section 10, plan M12, M13 and PD-7), each a pure function: unit-paired contrasts clustered
// on the base app, Holm over the two primaries, the interim exposure stop, the untested conditions, the verdict
// precedence and the reading rule. Every contrast entry point requires the unit-to-base-app map and has no default.
import { clusteredPairedDelta, holmAdjusted } from "../../../src/runner/stats/paired.ts";
import { JUDGE_OF, KEEP_WORDING, PANEL, READS, SEED } from "../frozen.ts";
import { fail } from "../errors.ts";
import type { GstackArm, Model, SessionKind, Tier } from "../types.ts";
import { above, below, mean, q4, show } from "./num.ts";
import { cellValue, judgePasses, unitMeans, type R48Kind, type SmokeDecision, type Stage1Reading } from "./stage1.ts";
import { clusterBootstrap, ols, percentileInterval } from "./stats.ts";
import type { JudgeCheck, ReadCell } from "./types.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";

const STAT = { seed: SEED, draws: READS.draws };
export const GSTACK_ARMS: readonly GstackArm[] = ["plan-design-review", "autoplan"];

/** PD-7: the primary and the specificity contrast read G at the 10x tier and A at the base and 2x tiers. */
export const primaryMeasure = (tier: Tier): "a" | "g" => (tier === "10x" ? "g" : "a");

export interface ContrastInput {
  cells: readonly ReadCell[];
  model: Model;
  /** The contrast is b minus a. */
  b: SessionKind;
  a: SessionKind;
  tier: Tier;
  /** Unit id to base-app label. Required: there is no default to unit clusters (M13). */
  baseAppOf: ReadonlyMap<string, string>;
}

export interface Contrast {
  model: Model;
  b: SessionKind;
  a: SessionKind;
  tier: Tier;
  measure: "A" | "G";
  units: number;
  clusters: number;
  /** Units with a mean in one arm only; they leave the contrast. */
  unpaired: string[];
  delta: number;
  ci95: [number, number] | null;
  /** Two-sided base-app sign-flip p, exact at 20 or fewer base apps. */
  p: number;
  pMethod: string;
  worse: number;
  /** The paired difference in differences per unit: (b minus shuffled b) minus (a minus shuffled a). */
  specificity: { units: number; delta: number; ci95: [number, number] | null } | null;
  /** The unit difference regressed on the difference in mean list words: the intercept and its base-app interval. */
  lengthAdjusted: { intercept: number; ci95: [number, number] | null } | null;
}

/** b minus a on one model's cells at one tier, pairing per-arm unit means and clustering on the base app. */
export function contrast(i: ContrastInput): Contrast {
  if (!(i.baseAppOf instanceof Map)) fail("E_USAGE", "a contrast needs the unit-to-base-app map; there is no default to unit clusters");
  const m = primaryMeasure(i.tier);
  const side = (arm: SessionKind) => i.cells.filter((c) => c.model === i.model && c.arm === arm);
  const A = side(i.a), B = side(i.b);
  const ma = unitMeans(A, m), mb = unitMeans(B, m);
  const app = (u: string) => {
    const g = i.baseAppOf.get(u);
    if (!g) fail("E_USAGE", "unit " + u + " has no base app in the unit-to-base-app map");
    return g!;
  };
  const units = [...mb.keys()].filter((u) => ma.has(u)).sort();
  const unpaired = [...new Set([...ma.keys(), ...mb.keys()])].filter((u) => !(ma.has(u) && mb.has(u))).sort();
  if (!units.length) fail("E_USAGE", "contrast " + i.b + " minus " + i.a + " on " + i.model + " has no unit scored in both arms");
  const items = units.map((u) => ({ id: u, cluster: app(u), a: ma.get(u)!, b: mb.get(u)! }));
  const s = clusteredPairedDelta(items, STAT);

  const spec = (cells: readonly ReadCell[]) => {
    const by = new Map<string, number[]>();
    for (const c of cells) {
      const v = cellValue(c, m);
      const sh = c.state === "scored" || c.state === "scored-unexposed" ? (m === "g" ? c.shuffledG : c.shuffledA) : v === null ? null : 0;
      if (v !== null && sh !== null) by.set(c.unit, [...(by.get(c.unit) ?? []), v - sh]);
    }
    return new Map([...by.entries()].map(([u, xs]) => [u, mean(xs)]));
  };
  const sa = spec(A), sb = spec(B);
  const specUnits = units.filter((u) => sa.has(u) && sb.has(u));
  const ss = specUnits.length ? clusteredPairedDelta(specUnits.map((u) => ({ id: u, cluster: app(u), a: sa.get(u)!, b: sb.get(u)! })), STAT) : null;

  const words = (cells: readonly ReadCell[]) => {
    const by = new Map<string, number[]>();
    for (const c of cells) if (cellValue(c, m) !== null && c.words !== null) by.set(c.unit, [...(by.get(c.unit) ?? []), c.words]);
    return new Map([...by.entries()].map(([u, xs]) => [u, mean(xs)]));
  };
  const wa = words(A), wb = words(B);
  const pts = units.filter((u) => wa.has(u) && wb.has(u)).map((u) => ({ app: app(u), x: wb.get(u)! - wa.get(u)!, y: mb.get(u)! - ma.get(u)! }));
  const fit = (ps: typeof pts) => ols(ps.map((p) => p.x), ps.map((p) => p.y)).intercept;
  const lengthDraws = pts.length >= 2 ? clusterBootstrap(pts, (p) => p.app, fit, STAT) : [];

  return {
    model: i.model,
    b: i.b,
    a: i.a,
    tier: i.tier,
    measure: m === "g" ? "G" : "A",
    units: units.length,
    clusters: s.n_clusters,
    unpaired,
    delta: s.delta,
    ci95: s.ci95,
    p: s.p_two_sided,
    pMethod: s.p_method,
    worse: items.filter((x) => x.b - x.a < 0).length,
    specificity: ss ? { units: specUnits.length, delta: ss.delta, ci95: ss.ci95 } : null,
    lengthAdjusted: pts.length ? { intercept: fit(pts), ci95: lengthDraws.length ? percentileInterval(lengthDraws, READS.interval) : null } : null,
  };
}

/**
 * PD-26's sensitivity read: the same contrast with each cell's A and G under the old union rule, and the split cell
 * count per arm. It prints beside particle-1's contrasts and decides nothing; null when no cell carries a union read.
 */
export function unionSensitivity(i: ContrastInput): { contrast: Contrast; split: { b: number; a: number } } | null {
  const own = i.cells.filter((c) => c.model === i.model && (c.arm === i.a || c.arm === i.b));
  if (!own.some((c) => c.unionA !== undefined || c.unionG !== undefined)) return null;
  const cells = i.cells.map((c) => (c.model === i.model ? { ...c, a: c.unionA ?? c.a, g: c.unionG ?? c.g } : c));
  const split = (arm: SessionKind) => own.filter((c) => c.arm === arm).reduce((s, c) => s + (c.split ?? 0), 0);
  return { contrast: contrast({ ...i, cells }), split: { b: split(i.b), a: split(i.a) } };
}

export interface Primary {
  arm: GstackArm;
  contrast: Contrast | null;
  /** The p that entered Holm: 1 for an arm that doesn't run or stops. */
  pIn: number;
  holm: number;
}

/**
 * The two primaries on a model, gstack arm minus none, with Holm over exactly those two. An arm that doesn't run or
 * stops (a smoke drop, the interim exposure stop) enters with p = 1; its partial contrast still prints.
 */
export function primaries(i: Omit<ContrastInput, "a" | "b">, stopped: readonly GstackArm[]): Record<GstackArm, Primary> {
  const rows = GSTACK_ARMS.map((arm) => {
    const ran = i.cells.some((c) => c.model === i.model && c.arm === arm && cellValue(c, primaryMeasure(i.tier)) !== null);
    const c = ran ? contrast({ ...i, b: arm, a: "none" }) : null;
    return { arm, contrast: c, pIn: stopped.includes(arm) || !c ? 1 : c.p };
  });
  const h = holmAdjusted(rows.map((r) => r.pIn));
  return { "plan-design-review": { ...rows[0]!, holm: h[0]! }, autoplan: { ...rows[1]!, holm: h[1]! } };
}

// ---- The interim exposure stop

/** After the first 24 Opus sessions of a gstack arm in stage 2, an arm with exposure under 0.70 stops. */
export function interimStop(model: Model, sessions: ReadonlyArray<{ exposed: boolean | null }>): { ready: boolean; rate: number | null; stop: boolean; code: ReasonCode | null; line: string } {
  const n = READS.interimStop.afterSessions;
  if (model !== "opus") return { ready: false, rate: null, stop: false, code: null, line: "the interim exposure stop reads Opus sessions only" };
  if (sessions.length < n) return { ready: false, rate: null, stop: false, code: null, line: "interim exposure: " + sessions.length + " of " + n + " sessions so far" };
  const rate = sessions.slice(0, n).filter((s) => s.exposed === true).length / n;
  const stop = below(rate, READS.interimStop.exposureMin);
  return { ready: true, rate, stop, code: stop ? "E_DC_EXPOSURE_STOP" : null, line: "interim exposure after " + n + " Opus sessions: " + show(rate) + (stop ? ", under 0.70: the arm stops (E_DC_EXPOSURE_STOP)" : ", the arm goes on") };
}

// ---- Rates against planned cells

/** Missing share against planned cells: cells without a value (missing, contaminated, unlabelled, incomplete or never run). */
export function missingShare(cells: readonly ReadCell[], model: Model, arm: SessionKind, planned: number, tier: Tier): number {
  if (!(planned > 0)) fail("E_USAGE", "missing is counted against a positive planned cell count");
  const valued = cells.filter((c) => c.model === model && c.arm === arm && cellValue(c, primaryMeasure(tier)) !== null).length;
  if (valued > planned) fail("E_USAGE", arm + " on " + model + " holds " + valued + " valued cells, over its " + planned + " planned");
  return (planned - valued) / planned;
}

/** The share of a model's none sessions that read a gstack file. */
export function contaminationShare(cells: readonly ReadCell[], model: Model): number {
  const none = cells.filter((c) => c.model === model && c.arm === "none");
  return none.length ? none.filter((c) => c.state === "gstack-read").length / none.length : 0;
}

/** An arm's exposure: exposed sessions over the arm's stage 2 sessions on that model, an unread detector counting as not exposed (BT). */
export function exposureRate(cells: readonly ReadCell[], model: Model, arm: GstackArm): number | null {
  const s = cells.filter((c) => c.model === model && c.arm === arm);
  return s.length ? s.filter((c) => c.exposed === true).length / s.length : null;
}

/**
 * Whether a model's judge passes, in stage 1 and in the stage 2 re-check: Astra for Opus lists, Opus for Sol lists, and
 * every panel member for particle-1 lists. At the 10x tier each judge's detail check must pass too.
 */
export function judgeOk(model: Model, tier: Tier, checks: Readonly<Record<"astra" | "opus" | "argon", { stage1: JudgeCheck; recheck: JudgeCheck | null; detail?: JudgeCheck }>>): boolean {
  const judge = JUDGE_OF[model];
  const who = judge === "panel" ? [...PANEL] : [judge];
  return who.every((j) => {
    const c = checks[j];
    const detailOk = tier !== "10x" || (c.detail !== undefined && judgePasses(c.detail));
    return judgePasses(c.stage1) && (c.recheck === null || judgePasses(c.recheck)) && detailOk;
  });
}

// ---- The verdict precedence (section 10)

export type Verdict = "ended" | "incomplete" | "untested" | "helps" | "hurts" | "not shown" | "no measurable difference";

export interface UntestedInputs {
  judgeOk: boolean;
  stockFail: boolean;
  exposure: number | null;
  interimStopped: boolean;
  /** Missing shares in the arm and in none. */
  missing: { arm: number; none: number };
  /** Share of that model's none sessions that read a gstack file. */
  contamination: number;
}

/** Rule 4's conditions, each named, in the order the prereg lists them. */
export function untestedConditions(u: UntestedInputs): string[] {
  const out: string[] = [];
  if (!u.judgeOk) out.push("judge");
  if (u.stockFail) out.push("stock");
  if (u.interimStopped || u.exposure === null || below(u.exposure, READS.exposureMin)) out.push("exposure");
  if (above(u.missing.arm, READS.missingMax) || above(u.missing.none, READS.missingMax)) out.push("coverage");
  if (above(u.contamination, READS.contaminationMax)) out.push("contamination");
  return out;
}

export interface VerdictInput {
  stage1: Stage1Reading;
  /** Rule 2: the reason the model's stage 2 is incomplete, or null. */
  incomplete: string | null;
  smoke: SmokeDecision;
  untested: UntestedInputs;
  primary: Primary;
  /** The MDD that prints with a no measurable difference. */
  mdd: number | null;
}

export interface VerdictReading {
  verdict: Verdict;
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  why: string;
  /** R48 kinds this reading names. */
  kinds: R48Kind[];
  untested: string[];
}

const excludesZero = (ci: readonly [number, number]) => q4(ci[0]) > 0 || q4(ci[1]) < 0;

/** The seven steps for one gstack arm on one model; the first that holds gives the reading. */
export function verdict(v: VerdictInput): VerdictReading {
  if (v.stage1.ends) return { verdict: "ended", step: 1, why: "stage 1 ended the eval: " + v.stage1.reading, kinds: [v.stage1.kind], untested: [] };
  if (v.incomplete) return { verdict: "incomplete", step: 2, why: "incomplete on " + v.smoke.model + ": " + v.incomplete + "; partial estimates are descriptive only", kinds: ["task fit"], untested: [] };
  if (v.smoke.outcome === "dropped") {
    const names = v.smoke.untested.map((u) => "untested (" + u + ")");
    return { verdict: "untested", step: 3, why: "dropped at smoke on " + v.smoke.model + ", repair tried: " + names.join(", "), kinds: v.smoke.untested.map((u) => (u === "exposure" ? "exposure" : "instrument")), untested: [...v.smoke.untested] };
  }
  if (v.smoke.outcome === "repair") fail("E_USAGE", "the smoke on " + v.smoke.arm + " awaits its re-smoke; no verdict reads before it");
  const u = untestedConditions(v.untested);
  if (u.length) {
    const kinds = [...new Set(u.map((c): R48Kind => (c === "judge" || c === "stock" ? "instrument" : c === "exposure" ? "exposure" : c === "coverage" ? "coverage" : "task fit")))];
    return { verdict: "untested", step: 4, why: u.map((c) => "untested (" + c + ")").join(", "), kinds, untested: u };
  }
  const c = v.primary.contrast;
  if (!c || !c.ci95) fail("E_USAGE", v.primary.arm + " on " + v.smoke.model + " has no interval to read (fewer than two base apps or no scored unit)");
  const ci = c!.ci95!;
  const ciText = show(ci[0]) + " to " + show(ci[1]);
  if (!excludesZero(ci)) return { verdict: "no measurable difference", step: 7, why: "the interval " + ciText + " includes zero; MDD " + show(v.mdd), kinds: ["task fit"], untested: [] };
  const up = q4(ci[0]) > 0;
  const failed: string[] = [];
  if (!(q4(v.primary.holm) <= q4(READS.alpha))) failed.push("Holm p " + show(v.primary.holm) + " is above 0.05");
  const sp = c!.specificity?.ci95 ?? null;
  if (!sp || !(up ? q4(sp[0]) > 0 : q4(sp[1]) < 0)) failed.push("the specificity contrast's interval " + (sp ? show(sp[0]) + " to " + show(sp[1]) : "n/a") + " doesn't exclude zero in the same direction");
  if (failed.length) return { verdict: "not shown", step: 6, why: "the interval " + ciText + " excludes zero, but " + failed.join("; "), kinds: ["task fit"], untested: [] };
  return { verdict: up ? "helps" : "hurts", step: 5, why: "Holm p " + show(v.primary.holm) + ", the interval " + ciText + " and the specificity contrast exclude zero", kinds: up ? [] : ["task fit"], untested: [] };
}

// ---- The reading rule (section 10)

export interface ReadingInput {
  arm: GstackArm;
  model: Model;
  armNone: VerdictReading;
  armNoneCi: readonly [number, number] | null;
  /** The arm minus the lens, printed beside every headline. */
  armLensCi: readonly [number, number] | null;
  /** The lens minus none's verdict. */
  lensNone: Verdict;
  /** The pairwise secondary shows the arm losing: a length-controlled win rate below 0.5 with an interval that excludes 0.5. */
  pairwiseLosing: boolean;
  /** Stage 3 shows the arm's builds passing fewer key checks than none's, with an interval that excludes zero. */
  stage3Fewer: boolean;
}

export interface Reading {
  r48: "KEEP" | "FIX-METHOD";
  kinds: R48Kind[];
  flagged: string[];
  /** The arm adds something beyond a one-line role: the arm minus the lens sits wholly above zero. */
  beyondRole: boolean;
  framing: "carries it" | "carries part" | null;
  /** For a no measurable difference on Opus: whether the 95% upper bound sits below +0.05 (a trim-track lead only). */
  trimLead: boolean | null;
  lines: string[];
}

/** KEEP needs the arm minus none to read helps; every other reading is R48 FIX-METHOD of the kind its precedence names. */
export function readingRule(i: ReadingInput): Reading {
  const lens = i.armLensCi;
  const beyondRole = lens !== null && q4(lens[0]) > 0;
  const bound = lens !== null && below(lens[1], READS.framingBound);
  const helps = i.armNone.verdict === "helps";
  const framing = helps && bound ? "carries it" : i.lensNone === "helps" && !bound ? "carries part" : null;
  const flagged: string[] = [];
  if (helps && i.pairwiseLosing) flagged.push("the pairwise secondary shows the arm losing");
  if (helps && i.stage3Fewer) flagged.push("stage 3's builds pass fewer key checks than none's");
  const trimLead = i.model === "opus" && i.armNone.verdict === "no measurable difference" && i.armNoneCi !== null ? below(i.armNoneCi[1], READS.framingBound) : null;
  const lines = [i.arm + " on " + i.model + " minus the lens: " + (lens ? show(lens[0]) + " to " + show(lens[1]) : "n/a") + (beyondRole ? " (adds something beyond a one-line role)" : "")];
  if (framing === "carries it") lines.push("the one-line framing carries it");
  if (framing === "carries part") lines.push("the framing carries part of the gain, which is no lead to cut");
  if (trimLead !== null) lines.push("the 95% upper bound " + show(i.armNoneCi![1]) + (trimLead ? " sits below +0.05: a lead for the trim track only" : " doesn't sit below +0.05"));
  if (helps) return { r48: "KEEP", kinds: [], flagged, beyondRole, framing, trimLead, lines: ["KEEP: " + KEEP_WORDING + (flagged.length ? " (flagged: " + flagged.join("; ") + ")" : ""), ...lines] };
  const kinds = i.armNone.kinds.length ? i.armNone.kinds : (["task fit"] as R48Kind[]);
  return { r48: "FIX-METHOD", kinds, flagged, beyondRole, framing, trimLead, lines: ["R48 FIX-METHOD on " + kinds.join(", ") + " (" + i.armNone.verdict + ": " + i.armNone.why + ")", ...lines] };
}


