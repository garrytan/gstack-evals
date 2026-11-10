// Copyright (c) 2026 Garry Tan. MIT License.
// Shared shapes for the plan-eng-review intentions eval (prereg 2026-11-08-geva-405). Units, keys, labels and every
// review live sealed outside the repo; these are only their shapes. A units directory holds one folder per unit id:
//   <units>/<id>/unit.json    UnitMeta (sealed; never mounted)
//   <units>/<id>/plan.md      the team's plan, from the frozen rewrite (mounted at /work/plan.md)
//   <units>/<id>/repo/        the repository at the unit's parent commit: a fresh git repository with one commit and no
//                             remote (mounted at /work/repo)
//   <units>/<id>/key.json     Key (sealed; never mounted in any session)

/** Section 4's project types, in the frozen rule's order: the first match wins. */
export type ProjectType = "mobile" | "consumer" | "server" | "devtools";
export const PROJECT_TYPES: readonly ProjectType[] = ["mobile", "consumer", "server", "devtools"];
/** Section 3: B a post-merge defect, T a follow-up test, C a CI or eval follow-up. */
export type ItemKind = "B" | "T" | "C";
/** B items rank by how they were found: a defect revert, a fix linked to an issue a user opened, any other fix. */
export type BSource = "revert" | "user-issue" | "fix";
export type ModelId = "opus" | "sol" | "particle";
export const MODELS_IN_ORDER: readonly ModelId[] = ["opus", "sol", "particle"];
/** Section 5's five arms. precut is plan-eng-review at b493d4e31, engphase autoplan's Phase 3 at 199931029, candidate /plan-coverage at 57295cbc5. */
export type ArmId = "none" | "lens" | "precut" | "engphase" | "candidate";
export const ARMS: readonly ArmId[] = ["none", "lens", "precut", "engphase", "candidate"];
export const SKILL_ARMS: readonly ArmId[] = ["precut", "engphase", "candidate"];
export type Set_ = "pilot" | "calibration" | "comparison" | "reserve";
/** A unit is in a set only once er sets drew it: the draw wrote its set and a rank of 1 or more. The --set label er author
 * writes, with rank 0, puts no unit in any set. With a set named, the unit must have been drawn into that set. */
export function isDrawn(u: { set: Set_; rank?: number }, set?: Set_): boolean {
  return u.set !== "pilot" && (set === undefined || u.set === set) && (u.rank ?? 0) >= 1;
}
export type Foreseeable = "yes" | "maybe" | "no";

export interface UnitMeta {
  id: string;
  set: Set_;
  type: ProjectType;
  /** owner/name of the source repository (sealed with the unit). */
  repo: string;
  licence: string;
  copyleft: boolean;
  /** The repository's main language at base (the shuffled-key control prefers a key in the same language). */
  language: string;
  /** The first-parent commit on the default branch that is the unit, its parent (the base) and its pull request. */
  merge_sha: string;
  base_sha: string;
  pr: number | null;
  merged_at: string;
  /** Earliest exposure: the pull request opening, its closing issues opening, its commits' author and committer dates. */
  exposed_at: string;
  /** 1 when merged by 2026-09-15 (window closed by 2026-11-14), 2 otherwise. */
  wave: 1 | 2;
  /** merged_at plus 60 days: no key is written before it. */
  window_closes: string;
  /** Non-test source files the change touched and non-test source lines it added (section 4's size floor, section 9's terciles). */
  source_files: number;
  source_added: number;
  /** Seeded draw position within its set. */
  rank: number;
  /** Drawn to make up a short type's quota (section 4). */
  fill_in?: boolean;
  /** The first-parent changes its aftermath candidates name, so no two drawn units hold each other (section 4). */
  aftermath?: string[];
}

export interface BugSite {
  file: string;
  /** The function the blamed lines sit in, where the language's diff headers or a parse name one. */
  function: string | null;
}

export interface KeyItem {
  id: string;
  kind: ItemKind;
  /** B only: how the defect was found, for the primary ranking. */
  b_source?: BSource;
  /** An observed fact of at most 30 words naming the component or flow, the file where it helps and the condition. */
  statement: string;
  /** The file where the item helps. */
  file: string;
  /** Commits, issues and pull requests behind it (sealed). */
  evidence: string[];
  /** The date of the commit that makes it an aftermath event: within 60 days of the merge. */
  dated: string;
  /** B only: the files and functions its blamed lines sit in (section 4's key.json; the bug-site path recall reads them). */
  sites?: BugSite[];
  /** plan.md already names this path and condition as something to test or handle (section 3). */
  mentioned: boolean;
  /** Either screen judge marked it anticipated by stock row 1 or 2 (section 3). */
  generic: boolean;
  /** Each auditor's rating: could a careful reviewer with plan.md and the base code have named this path and condition? */
  foreseeable: { opus: Foreseeable | null; sol: Foreseeable | null };
}

export interface OwnItem {
  id: string;
  /** A behavior the unit's own tests checked, at most 30 words. */
  statement: string;
}

export interface FunctionRef {
  file: string;
  name: string;
}

export interface Key {
  unit: string;
  items: KeyItem[];
  /** Section 3: B, T and C items neither mentioned nor generic, at most 6, ranked B (revert, user issue, other fix), then C, then T, then a seeded tie-break. */
  primary: string[];
  /** Up to 4 behaviors the unit's own tests checked (A_own, secondary). */
  own: OwnItem[];
  /** The real diff's touched non-test source files and, where the language's diff headers give them, functions (path-map recall). */
  touched: { files: string[]; functions: FunctionRef[] };
  /** The real merged diff's file list with line counts (pairwise packets show it; it is a fact about the change, not its aftermath). */
  diffstat: Array<{ file: string; added: number; deleted: number }>;
}

/** One planned review session's outcome (section 6). no-block covers a completed reply with no block and an arm stop after its retry. */
export type EndState = "block" | "no-block" | "missing" | "contaminated";

export interface Row {
  unit: string;
  arm: ArmId;
  model: ModelId;
  pass: number;
  end: EndState;
  /** The session ended no-block because the arm stopped itself twice (E_ER_ARM_STOP): the sensitivity read treats it as missing. */
  arm_stop: boolean;
  /** The normalized paths (at most 15) and checks (at most 8), as plain strings without their numbers; null unless end is block. */
  paths: string[] | null;
  checks: string[] | null;
  /** Words and items across both lists after the cuts, and how many items the 25- and 40-word cuts shortened. */
  words: number;
  items: number;
  cut: number;
  /** Words in the checks list alone, for the length-adjusted read. */
  check_words: number;
  /** Exposure from the arm's frozen detector; null for none and lens and for a session that did not end block or no-block. */
  exposed: boolean | null;
  /** The detector's load check (a secondary). */
  loaded: boolean | null;
  /** The Stop hook fallback was on for this session, and how many stops it blocked. */
  enforced: boolean;
  blocks: number;
  spend_micros: number | null;
  session: string;
}

/** A judge's label of one (list, key item) cell; null when the cell stayed unlabelled (section 7). */
export interface Label {
  anticipated: boolean;
  /** 1-based indices of the checks behind the anticipated label (empty when not anticipated). */
  checks: number[];
  /** Whether one check names the item's path or flow, whatever its condition (secondary), and the checks behind it. */
  path_hit: boolean;
  path_checks: number[];
  /** For an anticipated item: whether the credited check proposes a check (a test, CI job or eval) or a code change. */
  credit: "check" | "code" | null;
}
