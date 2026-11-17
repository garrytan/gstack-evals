// Copyright (c) 2026 Garry Tan. MIT License.
// The day-one eval's readings (prereg section 10). Nothing here calls a model or reads a sealed file beyond the rows.
// - A build's score is its checklist share (verdict.ts scoreBuild). An arm whose plan came out empty (E_DAYONE_NO_PLAN)
//   scores 0 with nothing_useful true and runs no build. Unscored builds, contaminated plans and gaps are not scored:
//   a brief enters a comparison only when both arms have a score, and every exclusion is listed.
// - Per brief, an arm's score is its mean over replicates. Each comparison X minus Y is the mean over briefs of the
//   per-brief difference, with a 95% percentile interval from DRAWS paired bootstrap draws over briefs (SEED).
// - The MDD is frozen in advance: 2.8 times an assumed paired SD of 0.25 over the square root of the briefs compared
//   (0.18 at 15 briefs, 0.20 at 12). The observed paired SD and the MDD it implies are reported beside it.
// - The R107 reading (decide): keep the review chain when A minus N and A minus D both have intervals above zero; slim
//   to the day-one pass when D minus N's interval is above zero and A minus D's is not; cut both when neither A minus N
//   nor D minus N is above zero; otherwise undecided. GSTA-573's rule (strengthened): S-full ships when S-full minus A
//   is at least the MDD with an interval above zero and S-full minus D's interval reaches zero or above; otherwise
//   only the day-one pass ships.
import { bootstrapMeans, mean, percentileInterval, r4 } from "../product-value/stats.ts";
import { DRAWS, SEED, type PlanArm } from "./frozen.ts";

export interface ScoredBuild {
  unit: string;
  rep: number;
  arm: PlanArm;
  /** Tasks done in rank order; null when unscored. */
  done: boolean[] | null;
  /** The arm's plan was empty. */
  empty_plan: boolean;
  /** The plan was contaminated (web or a gstack read on a no-gstack arm). */
  contaminated: boolean;
  /** Tasks marked implied, in rank order. */
  implied: boolean[];
  obvious: boolean;
}

export interface Interval {
  est: number;
  lo: number;
  hi: number;
  briefs: number;
  sd: number | null;
}

export const ASSUMED_SD = 0.25;
export const mddFor = (briefs: number): number => (briefs > 0 ? Math.round((2.8 * ASSUMED_SD) / Math.sqrt(briefs) * 100) / 100 : NaN);

/** The build's share, or null when it is not scored. */
export function share(b: ScoredBuild): number | null {
  if (b.contaminated) return null;
  if (b.empty_plan) return 0;
  if (!b.done) return null;
  return b.done.filter(Boolean).length / b.done.length;
}

/** Per brief, the arm's mean share over its scored replicates. */
export function briefScores(builds: readonly ScoredBuild[], arm: PlanArm, pick: (b: ScoredBuild) => number | null = share): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const b of builds) {
    if (b.arm !== arm) continue;
    const s = pick(b);
    if (s === null) continue;
    by.set(b.unit, [...(by.get(b.unit) ?? []), s]);
  }
  return new Map([...by].map(([u, xs]) => [u, mean(xs)]));
}

/** The paired difference x minus y over briefs both arms scored, with its bootstrap interval. */
export function paired(x: Map<string, number>, y: Map<string, number>, seed = SEED, draws = DRAWS): Interval {
  const units = [...x.keys()].filter((u) => y.has(u)).sort();
  const d = units.map((u) => x.get(u)! - y.get(u)!);
  if (!d.length) return { est: NaN, lo: NaN, hi: NaN, briefs: 0, sd: null };
  const [lo, hi] = percentileInterval(bootstrapMeans(d, { seed, draws }), 0.95);
  const m = mean(d);
  const sd = d.length > 1 ? Math.sqrt(d.reduce((a, v) => a + (v - m) ** 2, 0) / (d.length - 1)) : null;
  return { est: r4(m), lo: r4(lo), hi: r4(hi), briefs: d.length, sd: sd === null ? null : r4(sd) };
}

export type R107 = "keep" | "slim" | "cut" | "undecided";

/** The R107 reading from the three comparisons. */
export function decide(an: Interval, dn: Interval, ad: Interval): R107 {
  if (an.lo > 0 && ad.lo > 0) return "keep";
  if (dn.lo > 0 && !(ad.lo > 0)) return "slim";
  if (!(an.lo > 0) && !(dn.lo > 0)) return "cut";
  return "undecided";
}

/** GSTA-573's merge rule for the strengthened skills. */
export function strengthened(sa: Interval, sd: Interval, mdd: number): "ship-s-full" | "day-one-pass-only" {
  return sa.est >= mdd && sa.lo > 0 && sd.hi >= 0 ? "ship-s-full" : "day-one-pass-only";
}

/** Share of the top three tasks done; nothing useful when none is. */
export const top3 = (b: ScoredBuild): number | null => {
  const s = share(b);
  if (s === null) return null;
  if (b.empty_plan) return 0;
  return b.done!.slice(0, 3).filter(Boolean).length / Math.min(3, b.done!.length);
};
export const nothingUseful = (b: ScoredBuild): number | null => {
  const t = top3(b);
  return t === null ? null : t === 0 ? 1 : 0;
};
/** Share of implied tasks done; null when the unit has none. */
export const impliedShare = (b: ScoredBuild): number | null => {
  const s = share(b);
  const n = b.implied.filter(Boolean).length;
  if (s === null || n === 0) return null;
  if (b.empty_plan) return 0;
  return b.done!.filter((d, i) => d && b.implied[i]).length / n;
};

export interface Reading {
  arms: Record<string, { briefs: number; share: number; top3: number; nothing_useful: number; implied: number | null }>;
  comparisons: Record<string, Interval>;
  mdd: number;
  mdd_observed: number | null;
  r107: R107;
  strengthened: ReturnType<typeof strengthened> | null;
  excluded: { unit: string; rep: number; arm: PlanArm; why: string }[];
}

/** Every reading over the set's builds (obvious units included; the obvious-only table is descriptive). */
export function read(builds: readonly ScoredBuild[], arms: readonly PlanArm[]): Reading {
  const sc = Object.fromEntries(arms.map((a) => [a, briefScores(builds, a)])) as Record<PlanArm, Map<string, number>>;
  const avg = (a: PlanArm, f: (b: ScoredBuild) => number | null) => {
    const m = briefScores(builds, a, f);
    return m.size ? r4(mean([...m.values()])) : null;
  };
  const armsOut: Reading["arms"] = {};
  for (const a of arms) armsOut[a] = { briefs: sc[a].size, share: avg(a, share) ?? NaN, top3: avg(a, top3) ?? NaN, nothing_useful: avg(a, nothingUseful) ?? NaN, implied: avg(a, impliedShare) };
  const comparisons: Record<string, Interval> = {};
  const pairs: [PlanArm, PlanArm][] = [["a", "n"], ["d", "n"], ["a", "d"], ["s-full", "a"], ["s-full", "d"], ["s-dayone", "a"], ["s-full", "s-dayone"]];
  for (const [x, y] of pairs) if (arms.includes(x) && arms.includes(y)) comparisons[x + "-" + y] = paired(sc[x], sc[y]);
  const an = comparisons["a-n"]!;
  const mdd = mddFor(an?.briefs ?? 0);
  const excluded = builds.filter((b) => share(b) === null).map((b) => ({ unit: b.unit, rep: b.rep, arm: b.arm, why: b.contaminated ? "contaminated plan" : "unscored build" }));
  return {
    arms: armsOut,
    comparisons,
    mdd,
    mdd_observed: an?.sd ? r4((2.8 * an.sd) / Math.sqrt(an.briefs)) : null,
    r107: an && comparisons["d-n"] && comparisons["a-d"] ? decide(an, comparisons["d-n"]!, comparisons["a-d"]!) : "undecided",
    strengthened: comparisons["s-full-a"] && comparisons["s-full-d"] ? strengthened(comparisons["s-full-a"]!, comparisons["s-full-d"]!, mdd) : null,
    excluded,
  };
}
