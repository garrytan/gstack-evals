// Copyright (c) 2026 Garry Tan. MIT License.
// Shared types of the eng-review build read (prereg 2026-11-11-geva-522-eng-review-build-read-prereg). Modules code
// against these, so a change here is a change to every builder's contract.

export type Arm = "none" | "plain" | "precut" | "engphase" | "candidate";
export type SkillArm = "precut" | "engphase" | "candidate";
export type Reviewer = "opus" | "sol" | "particle";
export type UnitType = "mobile" | "consumer" | "server" | "devtools";
export type Ecosystem = "go" | "node" | "python" | "rust";
export type UnitSet = "comparison" | "reserve" | "calibration" | "new";

/** A test case's class in one verifier run (prereg section 3). Only "assert" is a scorable failure. */
export type CaseClass = "pass" | "assert" | "missing_name" | "load" | "compile" | "timeout" | "no_result";

/** One case's class in each of the verifier's runs. */
export interface CaseRuns {
  id: string;
  runs: CaseClass[];
}

/** One primary B item's later-fix tests (prereg section 3). */
export interface AftermathItem {
  /** The key's item id. */
  item: string;
  /** Assert-class fail on the merged tree and on the fix's parent, pass on the fix, in every run; tied to the change. */
  cases: string[];
  /** Cases in the same fix test files that pass on both the merged and the fixed tree. */
  anchors: string[];
  /** Each aftermath case's outcome on base with the fix's tests in place. Descriptive only. */
  base: Record<string, "pass" | "fail" | "no_result">;
  mentioned: boolean;
  generic: boolean;
  foreseeable: "yes" | "maybe" | "no" | null;
}

export interface BuildUnit {
  id: string;
  /** Repository label minted from random bytes at the build, never derived from the name. The analysis clusters on it. */
  repo: string;
  set: UnitSet;
  type: UnitType;
  ecosystems: Ecosystem[];
  /** "first": keyed under the first attempt's build; "f8": keyed with F8 in this attempt. */
  keying: "first" | "f8";
  /** YYYY-MM of the merge. */
  mergedMonth: string;
  /** First exposed on or after 2026-08-01. */
  strictWindow: boolean;
  functional: string[];
  aftermath: AftermathItem[];
  /** Follow-up test case ids of the unit's T items: compatibility only, never scored as a bug. */
  tCases: string[];
}

export type SessionOutcome = "completed" | "limit" | "upstream_gap" | "infra_gap";

export interface ReviewRecord {
  unit: string;
  arm: Exclude<Arm, "none">;
  reviewer: Reviewer;
  rep: number;
  outcome: SessionOutcome;
  /** The frozen detector on the final transcript; null for the plain arm. */
  exposed: boolean | null;
  /** Exposed with no Stop hook block; null for the plain arm. */
  exposedBeforeBlock: boolean | null;
  blocks: number;
  bundleWords: number;
  truncated: boolean;
  repoEditsDiscarded: number;
  costUsd: number;
}

export interface GradedBuild {
  unit: string;
  arm: Arm;
  /** The reviewer model; null for the no-review arm. Every build is Opus. */
  reviewer: Reviewer | null;
  rep: number;
  pilot: boolean;
  outcome: SessionOutcome;
  functional: CaseRuns[];
  /** Keyed by aftermath item id. */
  aftermath: Record<string, CaseRuns[]>;
  /** Keyed by aftermath item id. */
  anchors: Record<string, CaseRuns[]>;
  tCases: CaseRuns[];
  /** Real-bug catch per B item: one of the build's own cases red on merged and green on fixed in every run. */
  catches: Record<string, boolean | null>;
  /** Changed-line coverage of the build's own tests; null when the tool gave no result for this tree. */
  coverage: number | null;
  mutation: number | null;
  testLinesAdded: number;
  costUsd: number;
}
