// Copyright (c) 2026 Garry Tan. MIT License.
// Statistics of the planted-unit read (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg, section 9):
// differences paired by unit and clustered by repository; a 95% two-stage cluster-bootstrap interval (draw repositories
// with replacement, then units within each drawn repository; 10,000 draws; the seed passed in); a two-sided cluster
// sign-flip p over repository sums (exact up to 16 repositories, else seeded Monte Carlo with as many flips as draws);
// the counts of units that got worse and of repositories; and Holm across the two skill-arm families. Every lower or
// upper bound the readings use is this bootstrap's 2.5% or 97.5% quantile. The bootstrap and sign-flip are the eng-build
// lane's (lanes/eng-build/analysis.ts infer), reused unchanged.
import { at, fmt, infer, lvl, readingLine, type Paired, type Reading } from "../../eng-build/analysis.ts";
import { FROZEN } from "../frozen.ts";
import type { PlantedUnit } from "../types.ts";

export { at, fmt, infer, lvl, readingLine };
export type { Paired, Reading };

export type Word = "helps" | "hurts" | "no measurable difference" | "not shown";

/** The interval holds zero. */
export const holdsZero = (r: Reading) => at(r.lo) <= 0 && at(r.hi) >= 0;

/** helps or hurts: p at most alpha and the interval clear of zero that way; an interval holding zero is no measurable
 * difference; otherwise (p and interval disagree) not shown. Pass a Holm-adjusted p for the public headline. */
export function word(r: Reading, p: number = r.p): Word {
  const sig = at(p) <= FROZEN.alpha;
  if (sig && at(r.lo) > 0) return "helps";
  if (sig && at(r.hi) < 0) return "hurts";
  return holdsZero(r) ? "no measurable difference" : "not shown";
}

/** Per unit, plus minus minus; a unit missing either side is left out. */
export function pairUnits(units: PlantedUnit[], plus: (u: PlantedUnit) => number | null, minus: (u: PlantedUnit) => number | null): Paired[] {
  const out: Paired[] = [];
  for (const u of units) {
    const a = plus(u);
    const b = minus(u);
    if (a !== null && b !== null) out.push({ unit: u.id, repo: u.repo, d: a - b });
  }
  return out;
}

/** One arm's level: its unit scores with the clustered interval (the pilot's component means and lower bounds). */
export function levelOf(units: PlantedUnit[], f: (u: PlantedUnit) => number | null, seed: number, draws: number = FROZEN.bootstrapDraws): Reading | null {
  return infer(pairUnits(units, f, () => 0), seed, draws);
}

export interface HolmRow<A extends string> {
  arm: A;
  p: number;
  adjusted: number;
  rejects: boolean;
}

/** Holm's step-down across the families given, with the adjusted p each prints. */
export function holm<A extends string>(rows: Array<{ arm: A; p: number }>, alpha: number = FROZEN.alpha): HolmRow<A>[] {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  const m = sorted.length;
  let open = true;
  let maxAdj = 0;
  return sorted.map((r, i) => {
    maxAdj = Math.max(maxAdj, Math.min(1, (m - i) * r.p));
    open = open && at(r.p) <= at(alpha / (m - i));
    return { arm: r.arm, p: r.p, adjusted: maxAdj, rejects: open };
  });
}

/** The length-adjusted line: each unit's difference regressed on its review word-count difference; the intercept is the
 * difference at equal words. */
export function lengthAdjusted(points: Array<[number, number]>): { intercept: number; slopePer1000: number; units: number } | null {
  if (!points.length) return null;
  const mw = points.reduce((s, [w]) => s + w, 0) / points.length;
  const md = points.reduce((s, [, d]) => s + d, 0) / points.length;
  const v = points.reduce((s, [w]) => s + (w - mw) ** 2, 0);
  const slope = v > 0 ? points.reduce((s, [w, d]) => s + (w - mw) * (d - md), 0) / v : 0;
  return { intercept: md - slope * mw, slopePer1000: slope * 1000, units: points.length };
}
