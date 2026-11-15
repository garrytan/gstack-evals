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
  /** Part S: the attempt the record comes from (2 after the whole-session retry). */
  attempts?: number;
  /** Part S: the slot's allowance stops, counted apart from reservation-bound refusals. */
  allowance_stops?: number;
  /** Part S: the copied home's digest from arms-pins.json, or null for none and fixture homes. */
  home_tree_sha256?: string | null;
  claude_version?: string | null;
  /** Part S: the session runner's refusal line, when the attempt ended on one. */
  refused?: string | null;
  /** The commit the session's repository started from, which the scorer extracts the change against (part C). */
  base_head?: string;
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
  /** Nested worktree directories left out of the extracted change, relative to the repository root (part C). */
  nested_left_out?: string[];
  /** The worktree secondary's candidates, each scored as the main change is (part C). */
  worktree_candidates?: { source: string; verified: boolean; gap: string | null }[];
}

/** The frozen row states of section 9. */
export type RowState = "ahead" | "behind" | "no_difference" | "incomplete" | "not_exercised" | "infeasible" | "run_as_published";

/** One arm's install record in arms-pins.json (part A writes it; the read audit and containment read it). Paths are
 *  relative to the session HOME. */
export interface ArmInstall {
  arm: H2hArm;
  /** The arm whose home this arm reuses (gstack-oneline and gstack-qa reuse gstack's), or null. */
  home_of: H2hArm | null;
  pins: { repo: string; sha: string; version?: string }[];
  /** The roots the pack installed under HOME, for the read audit and containment. */
  roots: string[];
  /** sha256 over the sorted (path, mode, content sha256) list of the installed home. */
  home_tree_sha256: string;
  /** Whether each pinned source's installed files matched its pin's git tree, and how it was checked. */
  pin_checks: { repo: string; matched: boolean; how: string }[];
  /** Newer versions seen on the freeze date; the pins do not move. */
  newer_seen: { repo: string; sha: string; version?: string }[];
  claude_code_version: string;
  /** The pack's browser path as installed (plan section 3), in words. */
  browser?: string;
  /** Where the install differs from the pack README's commands, in words. */
  deviations?: string[];
}

/** The browser conditions sessions, the oracle and scoring share on B1 units (sections 3 and 6). Part B owns the wrapper
 *  script; part S mounts it in session containers. */
export const BROWSER = {
  wrapper_repo_path: "lanes/outcome-skills/h2h/breadth/chromium-wrapper.sh",
  wrapper_container_path: "/opt/h2h/chromium",
  shm_size: "2g",
  env: { CHROME_BIN: "/opt/h2h/chromium", PUPPETEER_EXECUTABLE_PATH: "/opt/h2h/chromium" },
  flags: ["--no-sandbox", "--disable-dev-shm-usage"],
} as const;
