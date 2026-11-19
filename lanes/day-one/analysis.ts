// Copyright (c) 2026 Garry Tan. MIT License.
// The day-one eval's readings (prereg section 10). Nothing here calls a model or reads a sealed file beyond the rows.
// - A build's score is its checklist share (verdict.ts scoreBuild). An arm whose plan came out empty (E_DAYONE_NO_PLAN)
//   scores 0 with nothing_useful true and runs no build. Unscored builds, contaminated plans and gaps are not scored:
//   a brief enters a comparison only when both arms have a score, and every exclusion is listed by arm and cause.
// - Per brief, an arm's score is its mean over replicates. Each comparison X minus Y is the mean over briefs of the
//   per-brief difference, with a 95% percentile interval from DRAWS paired bootstrap draws over briefs (SEED).
// - The MDD is frozen in advance: 2.8 times an assumed paired SD of 0.25 over the square root of the briefs compared
//   (0.18 at 15 briefs, 0.20 at 12). The observed paired SD and the MDD it implies are reported beside it.
// - A comparison reads only with at least MIN_BRIEFS briefs; a shorter one (or none) is short and every reading that
//   uses it is undecided. A comparison is above zero when its interval's low end is; below the MDD when its high end
//   is under its MDD; a tie when the whole interval sits inside plus or minus its MDD.
// - The R107 reading (decide, ruling A2): keep when A minus N and A minus D are above zero; slim when D minus N is above
//   zero and A minus D is not; cut when A minus N and D minus N are both below the MDD; otherwise undecided.
// - What the day-one effect comes from (source, ruling B2): wording when D minus R is above zero; second-pass when D minus
//   R is a tie and D minus N and R minus N are both above zero; neither when D minus N and R minus N are both below the
//   MDD; otherwise undecided.
// - GSTA-573's rule (strengthened): S-full ships when S-full minus A is at least its own MDD (from its paired briefs) with
//   an interval above zero and S-full minus D's interval reaches zero or above; otherwise only the day-one pass ships.
// - Every reading prints as "not counted" while a gate it rests on (the checker validation, the fixtures with the real
//   checker) has no passing receipt; the intervals still print.
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
  /** Descriptive: A's exposure and voice (null on other arms), the plan's words, the owner's answers by type, the cell's dollars (plan, voice, responder, build and check), whether the app wrote to a file that already held data at hand-off, and whether its app started for the checker (null with no check row). */
  exposed?: boolean | null;
  voice?: "astra" | "fallback" | null;
  plan_words?: number | null;
  answers?: Record<string, number> | null;
  usd?: number | null;
  prefilled?: boolean | null;
  started?: boolean | null;
}

export interface Interval {
  est: number;
  lo: number;
  hi: number;
  briefs: number;
  sd: number | null;
}

export const ASSUMED_SD = 0.25;
export const MIN_BRIEFS = 12;
export const mddFor = (briefs: number): number => (briefs > 0 ? Math.round((2.8 * ASSUMED_SD) / Math.sqrt(briefs) * 100) / 100 : NaN);

const short = (i: Interval | undefined): boolean => !i || !(i.briefs >= MIN_BRIEFS) || Number.isNaN(i.lo) || Number.isNaN(i.hi);
const above = (i: Interval): boolean => i.lo > 0;
const belowMdd = (i: Interval): boolean => i.hi < mddFor(i.briefs);
const tie = (i: Interval): boolean => i.lo > -mddFor(i.briefs) && i.hi < mddFor(i.briefs);

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
export type Source = "wording" | "second-pass" | "neither" | "undecided";

/** The R107 reading from A minus N, D minus N and A minus D. */
export function decide(an: Interval | undefined, dn: Interval | undefined, ad: Interval | undefined): R107 {
  if (!an || !dn || !ad || short(an) || short(dn) || short(ad)) return "undecided";
  if (above(an) && above(ad)) return "keep";
  if (above(dn) && !above(ad)) return "slim";
  if (belowMdd(an) && belowMdd(dn)) return "cut";
  return "undecided";
}

/** What D's effect comes from, from D minus R, R minus N and D minus N. */
export function source(dr: Interval | undefined, rn: Interval | undefined, dn: Interval | undefined): Source {
  if (!dr || !rn || !dn || short(dr) || short(rn) || short(dn)) return "undecided";
  if (above(dr)) return "wording";
  if (tie(dr) && above(dn) && above(rn)) return "second-pass";
  if (belowMdd(dn) && belowMdd(rn)) return "neither";
  return "undecided";
}

/** GSTA-573's merge rule for the strengthened skills, on S-full minus A's own MDD. */
export function strengthened(sa: Interval, sd: Interval): "ship-s-full" | "day-one-pass-only" {
  return sa.est >= mddFor(sa.briefs) && sa.lo > 0 && sd.hi >= 0 ? "ship-s-full" : "day-one-pass-only";
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
/** Share of the tasks of one origin done (implied, or stated in the brief); null when the unit has none. */
const originShare = (implied: boolean) => (b: ScoredBuild): number | null => {
  const s = share(b);
  const n = b.implied.filter((x) => x === implied).length;
  if (s === null || n === 0) return null;
  if (b.empty_plan) return 0;
  return b.done!.filter((d, i) => d && b.implied[i] === implied).length / n;
};
export const impliedShare = originShare(true);
export const briefShare = originShare(false);

export interface ArmRead {
  briefs: number;
  share: number;
  top3: number;
  nothing_useful: number;
  implied: number | null;
  brief_tasks: number | null;
  obvious_share: number | null;
  plan_words: number | null;
  answers: Record<string, number>;
  cost_per_brief: number | null;
  voice: { astra: number; fallback: number };
  exposed: { yes: number; no: number };
  prefilled: number;
  /** Descriptive: checked builds whose app never answered ("does not start", scored no task done). */
  not_started: number;
}

export interface Reading {
  counted: boolean;
  blocked: string[];
  arms: Record<string, ArmRead>;
  comparisons: Record<string, Interval>;
  a_n_exposed: Interval | null;
  mdd: number;
  mdd_observed: number | null;
  r107: R107 | "not counted";
  source: Source | "not counted" | null;
  strengthened: ReturnType<typeof strengthened> | "not counted" | null;
  excluded: { unit: string; rep: number; arm: PlanArm; why: string }[];
  excluded_counts: Record<string, Record<string, number>>;
}

const meanOr = (xs: number[]): number | null => (xs.length ? r4(mean(xs)) : null);

/** Every reading over the set's builds; blocked names each gate without a passing receipt. */
export function read(builds: readonly ScoredBuild[], arms: readonly PlanArm[], blocked: readonly string[] = []): Reading {
  const sc = Object.fromEntries(arms.map((a) => [a, briefScores(builds, a)])) as Record<PlanArm, Map<string, number>>;
  const avg = (a: PlanArm, f: (b: ScoredBuild) => number | null, from: readonly ScoredBuild[] = builds) => {
    const m = briefScores(from, a, f);
    return m.size ? r4(mean([...m.values()])) : null;
  };
  const armsOut: Reading["arms"] = {};
  for (const a of arms) {
    const mine = builds.filter((b) => b.arm === a);
    const answers: Record<string, number> = {};
    for (const b of mine) for (const [k, v] of Object.entries(b.answers ?? {})) answers[k] = (answers[k] ?? 0) + v;
    armsOut[a] = {
      briefs: sc[a].size,
      share: avg(a, share) ?? NaN,
      top3: avg(a, top3) ?? NaN,
      nothing_useful: avg(a, nothingUseful) ?? NaN,
      implied: avg(a, impliedShare),
      brief_tasks: avg(a, briefShare),
      obvious_share: avg(a, share, builds.filter((b) => b.obvious)),
      plan_words: meanOr(mine.flatMap((b) => (typeof b.plan_words === "number" ? [b.plan_words] : []))),
      answers,
      cost_per_brief: meanOr(mine.flatMap((b) => (typeof b.usd === "number" ? [b.usd] : []))),
      voice: { astra: mine.filter((b) => b.voice === "astra").length, fallback: mine.filter((b) => b.voice === "fallback").length },
      exposed: { yes: mine.filter((b) => b.exposed === true).length, no: mine.filter((b) => b.exposed === false).length },
      prefilled: mine.filter((b) => b.prefilled === true).length,
      not_started: mine.filter((b) => b.started === false).length,
    };
  }
  const comparisons: Record<string, Interval> = {};
  const pairs: [PlanArm, PlanArm][] = [["a", "n"], ["d", "n"], ["a", "d"], ["d", "r"], ["r", "n"], ["s-full", "a"], ["s-full", "d"], ["s-dayone", "a"], ["s-full", "s-dayone"]];
  for (const [x, y] of pairs) if (arms.includes(x) && arms.includes(y)) comparisons[x + "-" + y] = paired(sc[x], sc[y]);
  const an = comparisons["a-n"];
  const excluded = builds.filter((b) => share(b) === null).map((b) => ({ unit: b.unit, rep: b.rep, arm: b.arm, why: b.contaminated ? "contaminated plan" : "unscored build" }));
  const excluded_counts: Reading["excluded_counts"] = {};
  for (const e of excluded) (excluded_counts[e.arm] ??= {})[e.why] = (excluded_counts[e.arm]![e.why] ?? 0) + 1;
  const counted = blocked.length === 0;
  const gate = <T>(v: T): T | "not counted" => (counted ? v : "not counted");
  return {
    counted,
    blocked: [...blocked],
    arms: armsOut,
    comparisons,
    a_n_exposed: arms.includes("a") && arms.includes("n") ? paired(briefScores(builds.filter((b) => b.arm !== "a" || b.exposed === true), "a"), sc.n) : null,
    mdd: mddFor(an?.briefs ?? 0),
    mdd_observed: an?.sd ? r4((2.8 * an.sd) / Math.sqrt(an.briefs)) : null,
    r107: gate(decide(an, comparisons["d-n"], comparisons["a-d"])),
    source: comparisons["d-r"] ? gate(source(comparisons["d-r"], comparisons["r-n"], comparisons["d-n"])) : null,
    strengthened: comparisons["s-full-a"] && comparisons["s-full-d"] ? gate(strengthened(comparisons["s-full-a"]!, comparisons["s-full-d"]!)) : null,
    excluded,
    excluded_counts,
  };
}
