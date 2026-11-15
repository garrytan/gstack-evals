// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic fixtures for the readings part's dry run and tests (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg,
// section 13). Units, builds and review sessions are made up: no real repository, fix, plan, hint or case id.
import type { CaseClass, CaseRuns } from "../../eng-build/types.ts";
import type { BuildArm, GradedBuild, PlantedUnit, Reviewer, ReviewRecord, SessionOutcome, SkillArm } from "../types.ts";
import type { AnalysisInput } from "./analysis.ts";

const three = (c: CaseClass): CaseClass[] => [c, c, c];
const cases = (prefix: string, n: number, cls: (i: number) => CaseClass): CaseRuns[] => Array.from({ length: n }, (_, i) => ({ id: prefix + i, runs: three(cls(i)) }));

/** A synthetic unit with P planted and F functional cases, in its own repository unless repo is given. */
export function fxUnit(i: number, P = 1, F = 1, o: Partial<PlantedUnit> = {}): PlantedUnit {
  const planted = Array.from({ length: P }, (_, k) => "p" + k);
  return {
    id: "u" + i,
    repo: "r" + i,
    set: "comparison",
    ecosystem: "go",
    stars: "1k-9.9k",
    publicMonth: "2026-08",
    strictWindow: false,
    regionLines: 20,
    planted,
    plantedClass: Object.fromEntries(planted.map((p) => [p, "assert" as const])),
    functional: Array.from({ length: F }, (_, k) => "f" + k),
    foresee: ["yes", "yes"],
    winnable: true,
    hard: null,
    pilot: false,
    ...o,
  };
}

export interface FxBuild {
  /** Planted cases passing, from the first. */
  pass?: number;
  /** Functional cases passing, from the first; the rest fail with fnFail. */
  fn?: number;
  fnFail?: CaseClass;
  catch?: boolean | null;
  reviewer?: Reviewer | null;
  pilot?: boolean;
  outcome?: SessionOutcome;
  limitStop?: boolean;
}

/** A synthetic graded build: the first pass planted cases pass and the rest fail by assertion. */
export function fxBuild(u: PlantedUnit, arm: BuildArm, rep: number, o: FxBuild = {}): GradedBuild {
  const reviewed = arm === "plain" || arm === "engphase" || arm === "standalone";
  const fn = o.fn ?? u.functional.length;
  return {
    unit: u.id,
    arm,
    reviewer: o.reviewer === undefined ? (reviewed ? "opus" : null) : o.reviewer,
    rep,
    pilot: o.pilot ?? false,
    outcome: o.outcome ?? "completed",
    limitStop: o.limitStop ?? false,
    planted: cases("p", u.planted.length, (i) => (i < (o.pass ?? 0) ? "pass" : "assert")),
    functional: cases("f", u.functional.length, (i) => (i < fn ? "pass" : (o.fnFail ?? "assert"))),
    catch: o.catch === undefined ? false : o.catch,
    catchDrop: o.catch === null ? "compile" : null,
    readReview: reviewed ? true : null,
    coverage: null,
    testLinesAdded: 10,
    costUsd: 2.5,
  };
}

/** A synthetic review session. */
export function fxReview(unit: string, arm: "plain" | SkillArm, rep: number, exposed: boolean | null, outcome: SessionOutcome = "completed", reviewer: Reviewer = "opus"): ReviewRecord {
  return { unit, arm, reviewer, rep, outcome, exposed: arm === "plain" ? null : exposed, exposedBeforeBlock: arm === "plain" ? null : exposed, blocks: 0, bundleWords: arm === "plain" ? 800 : 2000, truncated: false, repoEditsDiscarded: 0, costUsd: 1 };
}

export type ArmSpec = (i: number, rep: number) => FxBuild;

/** A whole comparison on n units with P planted and F functional cases each: k builds a cell for the reviewed arms and
 * one for each control given, every review exposed unless exposed says otherwise, and a smoke that passes. */
export function fxWorld(n: number, P: number, F: number, spec: Partial<Record<BuildArm, ArmSpec>>, o: { k?: number; exposed?: (i: number, rep: number) => boolean; repo?: (i: number) => string; seed?: number; draws?: number } = {}): AnalysisInput {
  const k = o.k ?? 3;
  const units = Array.from({ length: n }, (_, i) => fxUnit(i, P, F, { repo: o.repo ? o.repo(i) : "r" + i }));
  const builds: GradedBuild[] = [];
  const reviews: ReviewRecord[] = [];
  const planned: Partial<Record<BuildArm, number>> = {};
  const plain: ArmSpec = () => ({});
  for (const arm of ["plain", "engphase", "standalone", "stock", "none"] as const) {
    const s = spec[arm] ?? (arm === "plain" || arm === "engphase" || arm === "standalone" ? plain : null);
    if (!s) continue;
    const reps = arm === "stock" || arm === "none" ? 1 : k;
    planned[arm] = n * reps;
    for (const u of units) {
      const i = Number(u.id.slice(1));
      for (let rep = 1; rep <= reps; rep++) {
        builds.push(fxBuild(u, arm, rep, s(i, rep)));
        if (arm === "plain" || arm === "engphase" || arm === "standalone") reviews.push(fxReview(u.id, arm, rep, o.exposed ? o.exposed(i, rep) : true));
      }
    }
  }
  const smoke = (["standalone", "engphase"] as const).flatMap((arm) => [1, 2, 3, 4, 5, 6].map((i) => fxReview("c" + i, arm, 1, true)));
  return { units, population: "all", primary: "composite", admitted: true, builds, reviews, smoke, reviewer: "opus", planned, seed: o.seed ?? 20261115, draws: o.draws ?? 10000, designMdd: 0.105, judged: null };
}
