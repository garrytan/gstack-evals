// Copyright (c) 2026 Garry Tan. MIT License.
// Shared types of the planted-unit eng-review read (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg). Modules
// code against these, so a change here is a change to every module's contract.
import type { CaseRuns, Ecosystem, Reviewer, SessionOutcome } from "../eng-build/types.ts";

export type { CaseRuns, Ecosystem, Reviewer, SessionOutcome };

/** The three review arms (prereg section 4). */
export type ReviewArm = "plain" | "engphase" | "standalone";
export type SkillArm = "engphase" | "standalone";
/** Build-only controls: no review (the authored plan alone) and the fixed stock review. */
export type ControlArm = "none" | "stock";
/** Every build a unit gets: the three reviewed arms, the two controls, and authoring's hinted build. */
export type BuildArm = ReviewArm | ControlArm | "hinted";
export type UnitSet = "calibration" | "comparison" | "reserve" | "raise";
export type Foresee = "yes" | "maybe" | "no";
/** Why a planted case counts (prereg section 2, rule 2): an assertion, or a runtime error raised in a product file. */
export type PlantedClass = "assert" | "crash";
/** The primary the pilot's component rule picks (prereg section 7). */
export type Primary = "composite" | "avoid" | "catch";

export interface PlantedUnit {
  /** Minted from random bytes at the build, never derived from a sha, repo name or case id. */
  id: string;
  /** Repository label minted from random bytes; the analysis clusters on it. */
  repo: string;
  set: UnitSet;
  ecosystem: Ecosystem;
  /** Popularity stratum by stars at the frozen search. */
  stars: "300-999" | "1k-9.9k" | "10k+";
  /** YYYY-MM of the fix's earliest public date. */
  publicMonth: string;
  /** Earliest public date on or after FROZEN.window.strictFrom. */
  strictWindow: boolean;
  /** Lines in the stubbed region. */
  regionLines: number;
  /** Planted case ids: fail on M in every run by assert or crash class, pass on F' in every run. */
  planted: string[];
  plantedClass: Record<string, PlantedClass>;
  /** Functional case ids (prereg section 2, rule 1). */
  functional: string[];
  /** The two raters' answers, Gemini 4 Carbon first; null before authoring. */
  foresee: [Foresee, Foresee] | null;
  /** The hinted build passed a planted case in 2 of 3 runs; null before authoring. */
  winnable: boolean | null;
  /** The no-review build missed on the component at the ceiling (prereg section 7); null until the raise reads it. */
  hard: boolean | null;
  pilot: boolean;
}

export interface ReviewRecord {
  unit: string;
  arm: ReviewArm;
  reviewer: Reviewer;
  rep: number;
  outcome: SessionOutcome;
  /** The frozen detector on the final transcript; null for plain. */
  exposed: boolean | null;
  /** Exposed with no Stop hook block; null for plain. */
  exposedBeforeBlock: boolean | null;
  blocks: number;
  bundleWords: number;
  truncated: boolean;
  repoEditsDiscarded: number;
  costUsd: number;
}

export interface GradedBuild {
  unit: string;
  arm: BuildArm;
  /** The reviewer model; null for none, stock and hinted. Every build is Opus. */
  reviewer: Reviewer | null;
  rep: number;
  pilot: boolean;
  outcome: SessionOutcome;
  /** The build stopped on a session limit; its tree is scored as is. */
  limitStop: boolean;
  planted: CaseRuns[];
  functional: CaseRuns[];
  /** One of the build's own cases fails on M (assert or crash class) in every run and passes on F' in every run; null when the transplant dropped. */
  catch: boolean | null;
  /** Why the transplant dropped, or null. */
  catchDrop: string | null;
  /** The builder opened a file under /work/review/; null for builds with no review files. */
  readReview: boolean | null;
  coverage: number | null;
  testLinesAdded: number;
  costUsd: number;
}

/** A subcommand a module plugs into gstack-evals ep through its part's commands.ts. */
export interface Command {
  run: (args: { flags: Map<string, string>; bools: Set<string>; rest: string[] }, io: { out: (t: string) => void; err: (t: string) => void }) => Promise<number> | number;
  bools: string[];
  usage: string;
  summary: string;
}

/** One keyless dry-run case. Cases that need Docker set docker and print SKIP without GSTACK_EVALS_DOCKER=1, which is never a pass. */
export interface DryCase {
  name: string;
  docker?: boolean;
  run: () => Promise<{ ok: boolean; detail: string }> | { ok: boolean; detail: string };
}

/** The grading seam the build stage calls (construct part): one tree's planted and functional cases, and one build's catch. */
export interface PlantedGrader {
  /** Grade a tree in the unit's pinned image under the frozen sandbox, FROZEN.runs times, with the hidden tests restored. */
  grade(unit: PlantedUnit, unitDir: string, tree: string): Promise<{ planted: CaseRuns[]; functional: CaseRuns[] }>;
  /** Move the build's own new and changed tests onto M and F' (product files at their real content) and apply the catch rule. */
  catchOf(unit: PlantedUnit, unitDir: string, buildTree: string, baseTree: string): Promise<{ catch: boolean | null; drop: string | null }>;
}

/** One bundle the judged secondary reads (prereg section 5): a review's mounted plan and review files, a control, or the authored plan alone. */
export interface JudgedBundle {
  unit: string;
  source: ReviewArm | "stock" | "none" | "plan";
  words: number;
  /** Call 1: at most FROZEN.judge.maxItems quoted conditions, in order. */
  quotes: string[];
  /** Call 2: one quote names the planted condition specifically. */
  named: boolean;
  /** The bundle heading each credited quote sits under. */
  sections: string[];
}
