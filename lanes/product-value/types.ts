// Copyright (c) 2026 Garry Tan. MIT License.
// Shared shapes for the product-value eval (prereg 2026-11-08-geva-403). Units and keys live sealed outside the repo;
// these are only their shapes. A units directory holds one folder per unit id:
//   <units>/<id>/unit.json    UnitMeta (no text that names the source)
//   <units>/<id>/plan.md      the plan family's input
//   <units>/<id>/brief.md     the brief family's input
//   <units>/<id>/context/     the project as it stood before the plan (one or more .md files)
//   <units>/<id>/key.json     Key (sealed; never mounted in any session)

export type Family = "plan" | "brief";
export type ProjectType = "consumer" | "server" | "mobile" | "other";
/** Section 4's source kinds; transposed units carry "transposed". */
export type SourceKind = "plan" | "accepted-outside" | "pr-as-plan" | "transposed";
export type ItemKind = "U" | "E" | "R";
export type ModelId = "opus" | "sol" | "particle";
export type ArmId = "none" | "lens" | "skill";
export type Set_ = "pilot" | "calibration" | "comparison" | "reserve";

export interface UnitMeta {
  id: string;
  set: Set_;
  /** "public" for real public units, "transposed" for re-skinned histories. */
  source: "public" | "transposed";
  source_kind: SourceKind;
  /** Transposed units only: where the source history came from. */
  inspiration?: "capy" | "public";
  type: ProjectType;
  /** The date the leak rule reads (section 11): the plan's first-post date; a Capy-inspired unit's authoring date; a public-inspired unit's source plan date. */
  plan_date: string;
  /** A twin's original public unit id (section 4, twin check). */
  twin_of?: string;
  /** A calibration fill-in for a short type (section 4). */
  fill_in?: boolean;
  /** Pre-cutoff public source: never a comparison unit, never a promoted reserve. */
  pre_cutoff?: boolean;
  /** Seeded draw position within its set. */
  rank: number;
}

export interface KeyItem {
  id: string;
  kind: ItemKind;
  /** An observed fact of at most 30 words. */
  statement: string;
  /** Records behind it (sealed). */
  evidence: string[];
  /** Distinct outside users behind the item (ranking, section 3). */
  outside_users: number;
  mentioned: boolean;
  generic: boolean;
  foreseeable: "yes" | "maybe" | "no";
}

export interface Key {
  unit: string;
  items: KeyItem[];
  /** Section 3: U and E items neither mentioned nor generic, at most 6, in rank order. */
  primary: string[];
  /** The plan's 3 central commitments, for the brief family's A_plan. */
  commitments: string[];
}

/** One planned review session's outcome (section 6). */
export type EndState = "block" | "no-block" | "missing" | "contaminated";

export interface Row {
  unit: string;
  family: Family;
  arm: ArmId;
  model: ModelId;
  pass: number;
  end: EndState;
  /** The normalized list ("1." to "5." lines as strings without the number), null unless end is block. */
  list: string[] | null;
  words: number;
  items: number;
  /** Items the 40-word cut shortened. */
  cut: number;
  exposed: boolean | null;
  /** plan-ceo-review's chosen mode, its 0F proposals and how many stayed pending. */
  mode?: string | null;
  proposals?: number;
  pending?: number;
  /** Smoke rule 2: whether a block change carries one of the session's 0F proposals; null without a block or a read. */
  expansion_in_block?: boolean | null;
  spend_micros: number | null;
  session: string;
}

/** A judge's label of one (list, key item) cell; null when the cell stayed unlabelled (section 7). */
export interface Label {
  anticipated: boolean;
  /** 1-based indices of the changes that anticipate the item (empty when not anticipated). */
  changes: number[];
}
