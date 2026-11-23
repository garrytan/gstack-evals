// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 9, 10 and 12's analysis on stage 2: per model, cso minus none on the named rate, paired by unit with
// repositories as clusters. The test is the head-to-head's McNemar with Obuchowski's clustered variance, Holm over the two
// contrasts at 0.05 (an incomplete cell stays in with p = 1), exact McNemar beside it, and a repository-clustered
// bootstrap interval on bootstrap_seed. Every verdict condition is also read at its gap bound, row states follow section
// 10, and verdicts apply in section 10's order. When stage 2 takes R113's interim look, deviation CV5's O'Brien-Fleming
// bounds replace Holm, with the plan's futility rule.
import { clusteredPairedDelta, holmAdjusted } from "../../../../src/runner/stats/paired.ts";
import { phi } from "../../../../src/runner/stats/outcome-decision.ts";
import { mdd } from "../../h2h/analysis/power.ts";
import { DRAWS, pairedTest, type Pair, type PairedTest } from "../../h2h/analysis/stats.ts";
import { csoFail, type CsoPrereg } from "../prereg.ts";
import type { CsoModel, SessionRecord, UnitRecord } from "../types.ts";
import type { CsoScore } from "../score/outcomes.ts";

export const PRIMARY_MODELS = ["opus", "particle"] as const satisfies readonly CsoModel[];
const ALPHA = 0.05;
const INCOMPLETE_GAP_SHARE = 0.1;
const COUNT_CAP = 10;

interface Rules { exposure_min: number; noninferiority_margin_points: number; claim_margin_points: number; supported_yield_margin: number }
function rules(p: CsoPrereg): Rules {
  const a = p.analysis as Partial<Rules> | undefined;
  for (const k of ["exposure_min", "noninferiority_margin_points", "claim_margin_points", "supported_yield_margin"] as const) if (typeof a?.[k] !== "number") csoFail("E_CSO_ANALYSIS_INPUT", "prereg.json analysis." + k + " is missing");
  return a as Rules;
}

/** Which way a gap bound fills: "cso_up" fills cso gaps as favourable to cso and none gaps against none (the bound for
 *  Behind and CUT-CANDIDATE); "cso_down" the reverse (the bound for Ahead and KEEP). */
export type Bound = "cso_up" | "cso_down";
export interface Cell { units: number; gaps: number; gap_share: number | null; incomplete: boolean }
export interface CountStat { n: number; delta: number | null; ci95: [number, number] | null }
export interface ContrastStats {
  model: CsoModel;
  cells: { none: Cell; cso: Cell };
  complete: PairedTest;
  bound: Record<Bound, PairedTest>;
  unsupported: { complete: CountStat; keep_bound: CountStat };
  supported: { complete: CountStat; keep_bound: CountStat };
  procedure: { ran: number; of: number; rate: number | null };
}

export interface AnalysisInput {
  units: UnitRecord[];
  sessions: SessionRecord[];
  scores: CsoScore[];
  /** Per model: whether the judge route that scores it passed on named, and whether validity is validated (section 7). */
  judge: Record<CsoModel, { named: boolean; validity: boolean }>;
  /** Arms stage 0 left out under R111, by model; their contrast reads Incomplete. */
  left_out?: Partial<Record<CsoModel, boolean>>;
  /** Section 10 step 1: headroom failed after its raise. Step 4: headroom was admitted. */
  headroom_failed?: boolean;
  headroom_admitted?: boolean;
}

/** Score lookup for stage 2 (E_CSO_ANALYSIS_INPUT on a duplicate or a score for a unit not listed). */
export class Data {
  private readonly scores = new Map<string, CsoScore>();
  constructor(readonly i: AnalysisInput) {
    const ids = new Set(i.units.map((u) => u.unit));
    if (ids.size !== i.units.length) csoFail("E_CSO_ANALYSIS_INPUT", "a unit is listed twice");
    for (const s of i.scores) {
      if (s.stage !== "stage2") continue;
      if (s.schema !== "cso-score.v1") csoFail("E_CSO_ANALYSIS_INPUT", "a score record is not cso-score.v1");
      if (!ids.has(s.unit)) csoFail("E_CSO_ANALYSIS_INPUT", "a score for " + s.unit + ", which is not a stage 2 unit");
      const k = s.unit + "\t" + s.arm + "\t" + s.model;
      if (this.scores.has(k)) csoFail("E_CSO_ANALYSIS_INPUT", "two scores for " + k.replace(/\t/g, " "));
      this.scores.set(k, s);
    }
  }
  score = (u: UnitRecord, arm: "none" | "cso", m: CsoModel) => {
    const s = this.scores.get(u.unit + "\t" + arm + "\t" + m);
    return s && s.gap === null ? s : null;
  };
}

const fill = (v: number | null, arm: "none" | "cso", b: Bound, high: number, low: number) => (v !== null ? v : (arm === "cso") === (b === "cso_up") ? high : low);
const countStat = (rows: { id: string; cluster: string; a: number; b: number }[], seed: number): CountStat => {
  if (!rows.length) return { n: 0, delta: null, ci95: null };
  const d = clusteredPairedDelta(rows, { seed, draws: DRAWS });
  return { n: d.n_pairs, delta: d.delta, ci95: d.ci95 };
};

/** One model's contrast: cells, the complete-pair test, both gap bounds on named, the per-session counts on complete
 *  pairs and at the KEEP bound, and the cso procedure rate. */
export function contrast(d: Data, m: CsoModel, p: CsoPrereg): ContrastStats {
  const us = d.i.units;
  const cell = (arm: "none" | "cso"): Cell => {
    const gaps = us.filter((u) => d.score(u, arm, m) === null).length;
    return { units: us.length, gaps, gap_share: us.length ? gaps / us.length : null, incomplete: !us.length || gaps / us.length > INCOMPLETE_GAP_SHARE };
  };
  const named = (u: UnitRecord, arm: "none" | "cso") => {
    const s = d.score(u, arm, m);
    return s ? (s.named ? 1 : 0) : null;
  };
  const complete: Pair[] = us.flatMap((u) => {
    const a = named(u, "none"), b = named(u, "cso");
    return a === null || b === null ? [] : [{ unit: u.unit, repo: u.repo, a, b }];
  });
  const bounded = (b: Bound): Pair[] => us.map((u) => ({ unit: u.unit, repo: u.repo, a: fill(named(u, "none"), "none", b, 1, 0) as 0 | 1, b: fill(named(u, "cso"), "cso", b, 1, 0) as 0 | 1 }));
  const counts = (key: "unsupported" | "supported") => {
    const v = (u: UnitRecord, arm: "none" | "cso") => d.score(u, arm, m)?.[key] ?? null;
    const both = us.flatMap((u) => (v(u, "none") === null || v(u, "cso") === null ? [] : [{ id: u.unit, cluster: u.repo, a: v(u, "none")!, b: v(u, "cso")! }]));
    const keepHigh = key === "supported";
    const keep = us.map((u) => ({ id: u.unit, cluster: u.repo, a: v(u, "none") ?? (keepHigh ? COUNT_CAP : 0), b: v(u, "cso") ?? (keepHigh ? 0 : COUNT_CAP) }));
    return { complete: countStat(both, p.bootstrap_seed), keep_bound: countStat(keep, p.bootstrap_seed) };
  };
  const cso = d.i.sessions.filter((s) => s.stage === "stage2" && s.model === m && s.arm === "cso" && s.end !== "gap");
  const ran = cso.filter((s) => s.exposure.procedure_ran).length;
  return {
    model: m, cells: { none: cell("none"), cso: cell("cso") }, complete: pairedTest(complete, p.bootstrap_seed),
    bound: { cso_up: pairedTest(bounded("cso_up"), p.bootstrap_seed), cso_down: pairedTest(bounded("cso_down"), p.bootstrap_seed) },
    unsupported: counts("unsupported"), supported: counts("supported"), procedure: { ran, of: cso.length, rate: cso.length ? ran / cso.length : null },
  };
}

export type RowState = "ahead" | "behind" | "no_difference" | "incomplete" | "not_exercised" | "judge_not_validated";
export const ROW_TEXT: Record<RowState, string> = { ahead: "Ahead", behind: "Behind", no_difference: "No difference shown", incomplete: "Incomplete", not_exercised: "Skill not exercised as designed", judge_not_validated: "Judge not validated" };

export interface Row {
  model: CsoModel; state: RowState; stats: ContrastStats;
  p_holm: number; p_holm_bound: Record<Bound, number>;
  /** Ahead or Behind on complete pairs that did not hold at its gap bound. */
  complete_only: "ahead" | "behind" | null;
  /** For a No difference shown row: the MDD in points at the measured discordant share, at 0.025 and 0.05. */
  mdd_points: { at_0_025: number | null; at_0_05: number | null };
}

const MDD_MEMO = new Map<string, number | null>();
const mddAt = (n: number, share: number, alpha: number) => {
  const k = n + "|" + share + "|" + alpha;
  if (!MDD_MEMO.has(k)) MDD_MEMO.set(k, mdd(n, share, alpha));
  return MDD_MEMO.get(k)!;
};
const ahead = (p: number, ci: [number, number] | null) => p < ALPHA && !!ci && ci[0] > 0;
const behind = (p: number, ci: [number, number] | null) => p < ALPHA && !!ci && ci[1] < 0;

/** Section 10's rows for both primary contrasts, with Holm over the two (and over the two at each gap bound). */
export function rows(i: AnalysisInput, p: CsoPrereg): Row[] {
  const d = new Data(i), r = rules(p);
  const stats = PRIMARY_MODELS.map((m) => contrast(d, m, p));
  const incomplete = stats.map((s) => !!i.left_out?.[s.model] || s.cells.none.incomplete || s.cells.cso.incomplete || s.complete.n === 0);
  const holm = (ps: number[]) => holmAdjusted(ps.map((x, k) => (incomplete[k] ? 1 : x)));
  const pc = holm(stats.map((s) => s.complete.p)), pu = holm(stats.map((s) => s.bound.cso_up.p)), pd = holm(stats.map((s) => s.bound.cso_down.p));
  return stats.map((s, k) => {
    const isAhead = ahead(pc[k]!, s.complete.ci95), isBehind = behind(pc[k]!, s.complete.ci95);
    const aheadB = isAhead && ahead(pd[k]!, s.bound.cso_down.ci95), behindB = isBehind && behind(pu[k]!, s.bound.cso_up.ci95);
    const state: RowState = incomplete[k] ? "incomplete" : s.procedure.rate === null || s.procedure.rate < r.exposure_min ? "not_exercised" : !i.judge[s.model]?.named ? "judge_not_validated" : aheadB ? "ahead" : behindB ? "behind" : "no_difference";
    const share = state === "no_difference" ? s.complete.discordant_share : null;
    return {
      model: s.model, state, stats: s, p_holm: pc[k]!, p_holm_bound: { cso_up: pu[k]!, cso_down: pd[k]! },
      complete_only: isAhead && !aheadB ? "ahead" : isBehind && !behindB ? "behind" : null,
      mdd_points: { at_0_025: share && s.complete.n ? mddAt(s.complete.n, share, 0.025) : null, at_0_05: share && s.complete.n ? mddAt(s.complete.n, share, 0.05) : null },
    };
  });
}

export type Verdict = "KEEP" | "FIX-METHOD" | "CUT-CANDIDATE";
export interface VerdictLine { model: CsoModel; verdict: Verdict; step: 1 | 2 | 3 | 4 | 5; why: string; row: string }

/** Section 10's verdict for one row, in the plan's order. */
export function verdict(row: Row, i: AnalysisInput, p: CsoPrereg): VerdictLine {
  const r = rules(p), s = row.stats;
  const out = (verdict: Verdict, step: VerdictLine["step"], why: string): VerdictLine => ({ model: row.model, verdict, step, why, row: ROW_TEXT[row.state] });
  if (row.state === "incomplete" || row.state === "not_exercised" || row.state === "judge_not_validated") return out("FIX-METHOD", 1, ROW_TEXT[row.state]);
  if (i.headroom_failed) return out("FIX-METHOD", 1, "headroom failed after its raise");
  if (row.state === "ahead") return out("KEEP", 2, "Ahead at the gap bound");
  const ni = -r.noninferiority_margin_points / 100, validity = !!i.judge[row.model]?.validity;
  const keep2 = (named: PairedTest, uns: CountStat, sup: CountStat) => !!named.ci95 && named.ci95[0] > ni && !!uns.ci95 && uns.ci95[1] < 0 && !!sup.ci95 && sup.ci95[0] > -r.supported_yield_margin && validity;
  if (keep2(s.bound.cso_down, s.unsupported.keep_bound, s.supported.keep_bound)) return out("KEEP", 2, "fewer unsupported findings at no real cost in hits, at the gap bounds");
  if (row.complete_only === "ahead" || keep2(s.complete, s.unsupported.complete, s.supported.complete)) return out("FIX-METHOD", 3, "a KEEP path holds on complete pairs but not at its gap bounds");
  const ran = s.procedure.rate !== null && s.procedure.rate >= r.exposure_min;
  if (row.state === "behind" && ran) return out("CUT-CANDIDATE", 4, "Behind at the gap bound with the procedure run in at least " + r.exposure_min * 100 + "% of cso sessions");
  const claim = r.claim_margin_points / 100;
  const nullCut = (t: PairedTest) => ran && !!i.headroom_admitted && validity && !!t.ci95 && t.ci95[1] < claim;
  if (row.state === "no_difference" && nullCut(s.bound.cso_up)) return out("CUT-CANDIDATE", 4, "no difference, and the interval at the bound favourable to cso rules out a gain of " + r.claim_margin_points + " points");
  if (row.complete_only === "behind" && ran) return out("FIX-METHOD", 5, "on gaps: Behind holds on complete pairs but not at its gap bound");
  if (row.state === "no_difference" && nullCut(s.complete)) return out("FIX-METHOD", 5, "on gaps: the null cut holds on complete pairs but not at its gap bound");
  const ci = s.complete.ci95;
  return out("FIX-METHOD", 5, "on power: interval " + (ci ? "[" + (ci[0] * 100).toFixed(1) + ", " + (ci[1] * 100).toFixed(1) + "] points" : "not estimable"));
}

/** Both rows and both verdict lines; the verdict rests on Opus, and a split names itself. */
export function analyze(i: AnalysisInput, p: CsoPrereg): { rows: Row[]; verdicts: VerdictLine[]; split: boolean } {
  const rs = rows(i, p);
  const vs = rs.map((r) => verdict(r, i, p));
  return { rows: rs, verdicts: vs, split: vs[0]!.verdict !== vs[1]!.verdict };
}

interface InterimRules { at: string; bounds: { first: { interim_abs_z: number; final_abs_z: number }; second: { interim_abs_z: number; final_abs_z: number } } }
const INTERIM_FLOOR_USD = 500;
/** R113 applies only when stage 2 is planned above $500 paid. */
export const interimApplies = (plannedPaidUsd: number): boolean => plannedPaidUsd > INTERIM_FLOOR_USD;

/** Conditional power at information fraction t of rejecting |Z| at least c at the final look, under a true difference
 *  delta with interim standard error se (the final se is se times the square root of t). */
export function conditionalPower(z: number, se: number, delta: number, c: number, t = 0.5): number {
  const drift = delta / (se * Math.sqrt(t));
  const m = z * Math.sqrt(t) + drift * (1 - t), sd = Math.sqrt(1 - t);
  return 1 - phi((c - m) / sd) + phi((-c - m) / sd);
}

export interface LookInput { model: CsoModel; z: number | null; se: number | null; incomplete?: boolean }
export interface LookResult { model: CsoModel; reject: boolean; futile: boolean; bound: number; conditional_power: number | null }

/** The futility rule's effect and power floor, read from prereg.json analysis.interim_look.futility. */
export function futilityRule(p: CsoPrereg): { effect: number; floor: number } {
  const t = String((p.analysis as { interim_look?: { futility?: string } }).interim_look?.futility ?? "");
  const e = t.match(/(\d+)-point effect/), f = t.match(/below (\d+)%/);
  if (!e || !f) return csoFail("E_CSO_ANALYSIS_INPUT", "prereg.json analysis.interim_look.futility names no effect or power floor");
  return { effect: Number(e[1]) / 100, floor: Number(f[1]) / 100 };
}

/** One look under deviation CV5: each contrast is tested at the first bound; once one is rejected (at this look or an
 *  earlier one), the other is tested at the second bound. At the interim look a contrast not rejected stops for futility
 *  when its conditional power at its final bound, under the futility effect either way (the larger), falls below the
 *  floor. An incomplete contrast is never rejected. */
export function look(which: "interim" | "final", contrasts: readonly LookInput[], rejectedBefore: readonly CsoModel[], p: CsoPrereg): LookResult[] {
  const il = (p.analysis as { interim_look?: InterimRules }).interim_look ?? csoFail("E_CSO_ANALYSIS_INPUT", "prereg.json analysis.interim_look is missing");
  const fu = futilityRule(p);
  const key = which === "interim" ? "interim_abs_z" : "final_abs_z";
  const rejected = new Set(rejectedBefore), at = new Map<CsoModel, number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of contrasts) {
      if (rejected.has(c.model)) continue;
      const bound = rejected.size ? il.bounds.second[key] : il.bounds.first[key];
      if (!c.incomplete && c.z !== null && Math.abs(c.z) >= bound) {
        rejected.add(c.model);
        at.set(c.model, bound);
        changed = true;
      }
    }
  }
  return contrasts.map((c) => {
    const reject = rejected.has(c.model);
    const final = rejected.size ? il.bounds.second.final_abs_z : il.bounds.first.final_abs_z;
    const cp = which === "interim" && !reject && c.z !== null && c.se ? Math.max(conditionalPower(c.z, c.se, fu.effect, final), conditionalPower(c.z, c.se, -fu.effect, final)) : null;
    return { model: c.model, reject, futile: cp !== null && cp < fu.floor, bound: at.get(c.model) ?? (rejected.size ? il.bounds.second[key] : il.bounds.first[key]), conditional_power: cp };
  });
}
