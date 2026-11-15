// Copyright (c) 2026 Garry Tan. MIT License.
// The interfaces the head-to-head's build parts code against: arms, units, sessions, scores and row states (plan sections
// 2 to 9). A part may add optional fields to these records; it never renames or removes one.

export const PRIMARY_ARMS = ["none", "gstack", "superpowers", "agent-skills", "gsd", "pstack", "tstack"] as const;
export const PIECE_G_ARMS = ["gstack-pony", "gstack-oneline"] as const;
export const SECONDARY_ARMS = ["gstack-qa"] as const;
export const ALL_ARMS = [...PRIMARY_ARMS, ...PIECE_G_ARMS, ...SECONDARY_ARMS] as const;
export type PrimaryArm = (typeof PRIMARY_ARMS)[number];
export type H2hArm = (typeof ALL_ARMS)[number];
/** The packs whose comparisons with gstack make the primary family (section 9). */
export const COMPARATORS = ["none", "superpowers", "agent-skills", "gsd", "pstack", "tstack"] as const satisfies readonly PrimaryArm[];

export type UnitClass = "O" | "B";
export type UnitKind = "O" | "B1" | "B2";
export type Entry = "bug" | "feature";
export type Stage = "stage0" | "stage1" | "stage2";

/** One drawn unit (sections 5 and 6). */
export interface H2hUnit {
  id: string;
  class: UnitClass;
  kind: UnitKind;
  repo: string;
  month: string;
  language: string;
  entry: Entry;
  image_digest: string;
  licence: string;
  /** Draw position in the class's seeded order (1-based). */
  position: number;
  stage: Stage | "reserve";
  /** B1 only: the issue URL and the sha256 of the problem statement text. */
  issue_url?: string;
  statement_sha256?: string;
}

/** How a session ended (section 7 step 6). */
export type SessionEnd = "completed" | "limit_wall" | "limit_turns" | "limit_allowance" | "upstream" | "infra" | "safety_stop" | "cap_stop";

/** What the exposure detectors read from one transcript (section 8). */
export interface Exposure {
  loaded: boolean;
  procedure: boolean;
  /** The marker strings that matched, for the published record. */
  markers: string[];
  /** Files read from another pack's install (the read audit). */
  foreign_reads: string[];
}

/** One session (sections 3, 4 and 7). */
export interface H2hSession {
  schema: "h2h-session.v1";
  unit: string;
  arm: H2hArm;
  model: string;
  item: string;
  stage: Stage;
  /** Position in the stage's seeded session order. */
  index: number;
  end: SessionEnd;
  /** A reason code when the session is a gap after the retry rules; null otherwise. */
  gap: string | null;
  turns: number;
  scripted_turns: number;
  continuations: number;
  spurious_continuations: number;
  done_seen: boolean;
  questions: number;
  reservation_refusals: number;
  cost_usd: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  wall_ms: number;
  exposure: Exposure | null;
  /** Relative paths inside the session's record directory. */
  transcript: string;
  tree_bundle: string;
}

export type Outcome = "clean_fix" | "fix_broke" | "no_fix" | "no_fix_broke";

/** One scored session (section 7). */
export interface H2hScore {
  schema: "h2h-score.v1";
  unit: string;
  arm: H2hArm;
  stage: Stage;
  /** null when the session or its scoring is a gap. */
  outcome: Outcome | null;
  /** The primary success: clean_fix under the strict reading with the new-test rule. */
  verified: boolean;
  verified_without_new_test_rule: boolean;
  adapted_verified: boolean | null;
  gap: string | null;
  dropped_arm_tests: string[];
  /** Whether a linked worktree or a branch beyond base holds a change that passes; null when none exists. */
  worktree_pass: boolean | null;
  lines_changed: number;
  planning_lines: number;
}

/** The frozen row states of section 9. */
export type RowState = "ahead" | "behind" | "no_difference" | "incomplete" | "not_exercised" | "infeasible" | "run_as_published";
