// Copyright (c) 2026 Garry Tan. MIT License.
// Shared shapes for the devex eval (prereg wiki/plans/2026-11-09-geva-417-devex-review-intentions-prereg). Units, keys,
// alias maps and reviews live sealed outside the repo; these are only their shapes. A units directory holds one folder
// per unit id:
//   <units>/<id>/unit.json     UnitMeta (no text that names the source)
//   <units>/<id>/plan.md       the plan, from the frozen rewrite, aliased
//   <units>/<id>/repo/         the aliased base snapshot: instruction files stripped, one commit, no remote
//   <units>/<id>/key.json      Key (sealed; never mounted in any session)
//   <units>/<id>/alias.json    AliasMap (sealed with the key; never mounted)
// Every part of the build codes against these shapes; change one only with the parts that use it.

export type ModelId = "opus" | "sol" | "particle";
export const MODEL_IDS: readonly ModelId[] = ["opus", "sol", "particle"];
/** The model strings the review harness and the ledger cells carry, by row id. */
export const MODEL_STRINGS: Readonly<Record<ModelId, string>> = { opus: "claude-opus-5-5", sol: "openai/gpt-6.1-sol", particle: "particle-ai/particle-1" };
export type ArmId = "none" | "lens" | "plan-devex-review" | "autoplan";
export const ARM_IDS: readonly ArmId[] = ["none", "lens", "plan-devex-review", "autoplan"];
export const GSTACK_ARMS: readonly ArmId[] = ["plan-devex-review", "autoplan"];
/** Section 3's classes: getting started, errors, docs, upgrade. */
export type ItemClass = "G" | "E" | "D" | "U";
/** Section 4's developer-facing classes; BREAKING is a tag. */
export type DevClass = "CLI" | "API" | "SDK" | "CONFIG";
export type Set_ = "calibration" | "comparison" | "reserve";
export type Stage = 1 | 2;

export interface UnitMeta {
  id: string;
  set: Set_;
  /** Position in draw order within its set (1-based). */
  rank: number;
  /** sha256(seed + newline + owner/repo#number), the draw order key; never the name itself. */
  draw_digest: string;
  /** sha256(seed + newline + owner/repo): the repository cluster, so a cluster read never needs the name. */
  repo_digest: string;
  dev_class: DevClass;
  breaking: boolean;
  /** The language the repository's primary language field names, for the shuffled-key derangement. */
  language: string | null;
  merged_at: string;
  /** Earliest exposure: the PR's opening, any closing issue's opening, its earliest commit. */
  earliest_exposure: string;
  release: { kind: "release" | "tag"; published_at: string; prerelease: boolean };
  /** The 60-day window after the release's publication. */
  window: { from: string; to: string };
  licence: { spdx: string; tier: "permissive" | "copyleft" };
  /** Instruction files the snapshot builder removed, by relative path. */
  stripped: string[];
  /** Recognition probe results per model (section 11); null before the probe ran. */
  recognized: Record<ModelId, boolean> | null;
}

export type ItemSource = "outside" | "followup-linked" | "followup";
export type Foreseeable = "yes" | "maybe" | "no";

export interface KeyItem {
  id: string;
  class: ItemClass;
  /** An observed fact of at most 30 words, aliased: the surface, the developer's context where the record gives one, and the trouble. */
  statement: string;
  /** The item's surface (command, flag, endpoint, method, config key, install path or upgrade step), aliased. */
  surface: string;
  /** Section 3's context tag: platform, install channel, workflow or experience; null for none. */
  context: string | null;
  source: ItemSource;
  /** Distinct outside developers behind the item (ranking). */
  outside_developers: number;
  /** Evidence pointers and dates (sealed). */
  evidence: Array<{ ref: string; date: string }>;
  mentioned: boolean;
  generic: boolean;
  /** Each auditor's foreseeable rating (section 3). */
  foreseeable: { opus: Foreseeable; sol: Foreseeable } | null;
}

export interface Key {
  unit: string;
  items: KeyItem[];
  /** Section 3: neither mentioned nor generic, at most 6, in rank order. */
  primary: string[];
}

export interface AliasEntry {
  original: string;
  alias: string;
  kind: "project" | "owner" | "package" | "module" | "binary";
}

export interface AliasMap {
  entries: AliasEntry[];
  /** Names left as they are because they are common English words or shorter than 4 characters. */
  kept: Array<{ name: string; why: "common-word" | "short" }>;
}

/** One planned review session's outcome (section 6). */
export type EndState = "block" | "no-block" | "session-stop" | "missing" | "contaminated";

export interface Row {
  unit: string;
  arm: ArmId;
  model: ModelId;
  stage: Stage;
  pass: number;
  /** A smoke session (section 10): its own pass, never mixed with the none passes. */
  smoke: boolean;
  end: EndState;
  /** The reason code behind a non-block end, if any (section 6's table). */
  code: string | null;
  /** The normalized list (at most 8 strings of at most 40 words), null unless end is block. */
  list: string[] | null;
  words: number;
  items: number;
  cut: number;
  /** Section 5's detector on the final transcript and run directory; null for none and lens or without a reading. */
  exposed: boolean | null;
  /** Each exposure marker's reading, by marker name. */
  markers: Record<string, boolean>;
  /** What the pin's bin/gstack-session-kind reported, and whether autoplan's lean mode was on. */
  session_kind: string | null;
  lean: boolean | null;
  /** Whether the DX lens was in autoplan's reviewer brief; null outside the autoplan arm. */
  dx_lens: boolean | null;
  /** Whether the session read a gstack file (none and lens only; the read audit). */
  gstack_read: boolean | null;
  /** One retry ran under a named reason. */
  retried: boolean;
  /** Any of its blocks went to a judge (section 6, recovery rule 2). */
  judged: boolean;
  limit_stops: number;
  spend_micros: number | null;
  session: string;
}

/** A judge's labels of one (list, key item) cell; null when the cell stayed unlabelled (section 7). */
export interface Label {
  anticipated: boolean;
  /** 1-based indices of the changes behind each yes. */
  changes: number[];
  surface: boolean;
  surface_changes: number[];
  /** null for an item tagged with no context. */
  who: boolean | null;
  who_changes: number[];
}

/** One line of the keyless dry run: a frozen rule driven on both sides of its edge. */
export interface DryCheck {
  rule: string;
  pass: boolean;
  detail?: string;
}

/** Each part of the build exports checks(): Promise<DryCheck[]> from its checks.ts; lanes/devex/dryrun.ts runs them all. */
export type PartChecks = () => Promise<DryCheck[]>;

export const SEED = 20261109;
