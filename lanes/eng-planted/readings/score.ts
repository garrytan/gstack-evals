// Copyright (c) 2026 Garry Tan. MIT License.
// Per-build scores of the planted-unit read (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg, section 5):
// avoid, catch (a dropped transplant scores 0 in the primary and is left out of the sensitivity read), the composite or
// the single component the pilot picks, the functional share and "solved", reach, and a unit's arm score as the mean
// over its builds, with a gap left out or scored 0.
import { FROZEN } from "../frozen.ts";
import type { BuildArm, CaseRuns, GradedBuild, PlantedUnit, Primary, Reviewer } from "../types.ts";
import { SCORABLE } from "./local.ts";

const index = (rs: CaseRuns[]) => new Map(rs.map((r) => [r.id, r]));
const count = (r: CaseRuns | undefined, ok: (c: string) => boolean) => (r ? r.runs.filter(ok).length : 0);

/** Passes in at least 2 of the 3 runs. A case with no result, a missing name or a load error is not a pass. */
export const passes = (r: CaseRuns | undefined) => count(r, (c) => c === "pass") >= FROZEN.passOf;
/** A pass or a scorable failure (an assertion, or a runtime error raised in a product file) in at least 2 of 3 runs. */
export const reaches = (r: CaseRuns | undefined) => count(r, (c) => c === "pass" || SCORABLE.has(c)) >= FROZEN.passOf;

/** Avoid: the share of the unit's planted cases that pass. */
export function avoid(b: GradedBuild, u: PlantedUnit): number | null {
  if (!u.planted.length) return null;
  const got = index(b.planted);
  return u.planted.filter((c) => passes(got.get(c))).length / u.planted.length;
}

/** "primary" scores a dropped transplant 0; "sensitivity" leaves it out. */
export type CatchRule = "primary" | "sensitivity";

/** Catch: 1 when the build's own tests catch the real bug, 0 when they don't, and a dropped transplant by the rule. */
export const catchScore = (b: GradedBuild, rule: CatchRule = "primary"): number | null => (b.catch === null ? (rule === "primary" ? 0 : null) : b.catch ? 1 : 0);

/** One build's score on the primary the pilot picked: (avoid + catch) / 2, or one component alone. */
export function score(b: GradedBuild, u: PlantedUnit, primary: Primary, rule: CatchRule = "primary"): number | null {
  const a = avoid(b, u);
  const c = catchScore(b, rule);
  if (primary === "avoid") return a;
  if (primary === "catch") return c;
  return a === null || c === null ? null : (a + c) / 2;
}

/** The functional share: functional cases passing over functional cases (section 2, rule 1). */
export function functionalShare(b: GradedBuild, u: PlantedUnit): number | null {
  if (!u.functional.length) return null;
  const got = index(b.functional);
  return u.functional.filter((c) => passes(got.get(c))).length / u.functional.length;
}

/** "Solved": 1 when every functional case passes, else 0. */
export function solved(b: GradedBuild, u: PlantedUnit): number | null {
  const s = functionalShare(b, u);
  return s === null ? null : s === 1 ? 1 : 0;
}

/** Reach: the share of planted and functional cases giving a pass or a scorable failure. */
export function reach(b: GradedBuild, u: PlantedUnit): number | null {
  const ids = [...u.planted, ...u.functional];
  if (!ids.length) return null;
  const got = new Map([...index(b.functional), ...index(b.planted)]);
  return ids.filter((c) => reaches(got.get(c))).length / ids.length;
}

export type Measure = (b: GradedBuild, u: PlantedUnit) => number | null;
export const measureOf =
  (primary: Primary, rule: CatchRule = "primary"): Measure =>
  (b, u) =>
    score(b, u, primary, rule);

/** An upstream or infra error after its one retry: a gap. */
export const isGap = (x: { outcome: string }) => x.outcome === "upstream_gap" || x.outcome === "infra_gap";

/** "missing" leaves a gap out of the unit's mean; "zero" scores it 0 (every verdict also prints this reading). */
export type GapRule = "missing" | "zero";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Builds by unit, arm and reviewer. Reviewed arms carry their reviewer; none, stock and hinted carry null. */
export class Cells {
  private map = new Map<string, GradedBuild[]>();
  constructor(builds: GradedBuild[]) {
    for (const b of builds) {
      const k = Cells.key(b.unit, b.arm, b.reviewer);
      this.map.set(k, [...(this.map.get(k) ?? []), b]);
    }
  }
  static key = (unit: string, arm: BuildArm, reviewer: Reviewer | null) => unit + "|" + arm + "|" + (reviewer ?? "-");
  get(unit: string, arm: BuildArm, reviewer: Reviewer): GradedBuild[] {
    const reviewed = arm === "plain" || arm === "engphase" || arm === "standalone";
    return this.map.get(Cells.key(unit, arm, reviewed ? reviewer : null)) ?? [];
  }
}

/** A unit's arm score: the mean of the measure over its builds. A gap is left out or scores 0 by the gap rule; a build
 * the measure can't read (null) is left out. Null when nothing is left. */
export function unitScore(builds: GradedBuild[], u: PlantedUnit, m: Measure, gaps: GapRule): number | null {
  const vals: number[] = [];
  for (const b of builds) {
    if (isGap(b)) {
      if (gaps === "zero") vals.push(0);
      continue;
    }
    const v = m(b, u);
    if (v !== null) vals.push(v);
  }
  return vals.length ? mean(vals) : null;
}
