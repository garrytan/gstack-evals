// Copyright (c) 2026 Garry Tan. MIT License.
// The interfaces two or more areas of the design plan review lane share (prereg 2026-11-14). An area keeps its own
// private types in its own folder; a change here is a change to every area's contract.
import type { ReasonCode } from "../../src/errors/codes.ts";

/** The four stage 2 arms (2026-11-09 prereg section 4, kept word for word). */
export type Arm = "none" | "lens" | "plan-design-review" | "autoplan";
export type GstackArm = "plan-design-review" | "autoplan";
/** What a review session runs: an arm, or the full-information reference (stage 1 only, under the none arm's rules). */
export type SessionKind = Arm | "reference";

/** Models under test, which write the reviewed lists. */
export type Model = "opus" | "sol" | "particle";
/** Every model the lane calls in any role: authors, auditors, validators, judges, arms, builders. */
export type AnyModel = Model | "astra" | "argon";
/** The two families that write units: GPT-6.1 Sol and Gemini 4 Argon. */
export type AuthorFamily = "sol" | "argon";

export type Tier = "base" | "2x" | "10x";
export type ItemClass = "S" | "H" | "R" | "A" | "Y";
export type ChangeKind = "k1" | "k2" | "k3" | "k4" | "k5" | "k6";
export type UnitSet = "calibration" | "comparison" | "reserve" | "second-skin";

/** The key-construction step that dropped an item. A drop is a flag in key.json and changes no file. */
export type DropStep = "audit" | "audit-2" | "not-unanimous" | "given-away";

/** One key item (prereg section 2). Its id is assigned at intake in a seeded per-unit order (PD-12) and is the key order. */
export interface KeyItem {
  /** Fixed width, so plain string order is key order. A 2x key inherits each id by byte-identical statement match. */
  id: string;
  class: ItemClass;
  statement: string;
  detail: string;
  evidence: { file: string; line: number }[];
  drop: DropStep | null;
  mentioned: boolean;
  generic: boolean;
  /** True only on the 2x key when all three unanimous blocks carry the detail (M10). */
  detailKeyed: boolean;
}

/** key.json (sealed, never mounted). Validator labels and auditor verdicts are sealed beside it by the author area. */
export interface Key {
  items: KeyItem[];
  wrongWay: string[];
  /** The 2x tier's decoy; null at the base tier. */
  decoy: string | null;
}

/** unit.json (sealed, never mounted) plus the digest every check result binds (K2). */
export interface Unit {
  id: string;
  /** Base-app label; every contrast clusters on it. */
  baseApp: string;
  /** Draw position, counted from 1. */
  position: number;
  kind: ChangeKind;
  author: AuthorFamily;
  tier: Tier;
  set: UnitSet | null;
  digest: string;
}

/** Where a change list comes from. Stock rows and oracle lists are labelled like lists (M8). */
export type ListSource = SessionKind | "stock-1" | "stock-2" | "stock-3" | "oracle";

/** One normalized list: at most 8 changes of at most 40 words. Change i (1 to 8) is changes[i - 1]. */
export interface ChangeList {
  source: ListSource;
  changes: string[];
}

/**
 * A judge's label for one (list, item) cell. A cell is labelled or explicitly unlabelled; there is no default.
 * A yes that names no change index is unlabelled (R2-18).
 */
export type LabelCell =
  | {
      kind: "labelled";
      anticipated: boolean;
      screenHit: boolean;
      /** Change indices behind the anticipated yes; empty when anticipated is false. */
      anticipatedEdges: number[];
      /** Change indices behind the screen-hit yes; empty when screenHit is false. */
      screenHitEdges: number[];
      /** 10x packets only: the anticipated edges whose change states the item's detail. Null on base and 2x packets. */
      detailEdges: number[] | null;
    }
  | { kind: "unlabelled"; why: string };

/** One edge of the matcher: a change index (1 to 8) and, at the 10x read, whether that change carries the detail. */
export interface MatchEdge {
  change: number;
  detail: boolean;
}

/** One key item as the matcher reads it (M1). */
export interface MatchItem {
  id: string;
  /** Whether the item has a keyed detail. False everywhere but the 10x read. */
  keyedDetail: boolean;
  edges: MatchEdge[];
}

/** fixedMatching's result (M3). score is in whole numbers: 2 per credited item, 1 when its keyed detail is missing. */
export interface Matching {
  /** Item id to its credited change index, or null. Keys in id order. */
  assigned: Record<string, number | null>;
  credited: number;
  score: number;
  detailCredited: number;
}

/**
 * How a review cell ends (plan section 6, with the cap stop right after contamination). Read in this order:
 * contamination, cap stop, termination, a failure outside the agent, then a completed reply's last block.
 */
export type CellState =
  | "scored"
  | "scored-unexposed"
  | "no-block"
  | "arm-stop"
  | "gstack-read"
  | "web-contaminated"
  | "infra-missing"
  | "incomplete"
  | "label-missing";

/** How a cell state counts: a score from the matching, a 0, missing against planned cells, or an incomplete run. */
export type CellCount = "score" | "zero" | "missing" | "incomplete";

/** The 17 ledger items of prereg section 13. crew has no lease. */
export type LedgerItemId =
  | "dc-base-apps"
  | "dc-gate-check"
  | "dc-authoring-1"
  | "dc-authoring-2"
  | "dc-authoring-3"
  | "dc-stage1-opus"
  | "dc-stage1-sol"
  | "dc-stage1-particle"
  | "dc-stage2-opus"
  | "dc-stage2-sol"
  | "dc-stage2-particle"
  | "dc-judges"
  | "dc-stage3-authoring"
  | "dc-stage3-builds"
  | "dc-stage3-reads"
  | "dc-hosts"
  | "crew";

/** One frozen run inside its item's one controller-held lease (plan section 5). */
export interface SubReservation {
  item: LedgerItemId;
  /** The frozen run, for example "stage 1 smoke" or "recipe session 7". */
  run: string;
  /** The run id's fixed holder directory, the same absolute path on a replacement host (R2-17). */
  holder: string;
  reserveUsd: number;
}

/** The work a stop halts (plan L5, PD-13). */
export type StopReach = "arm-on-model" | "model-contrasts" | "model-calls" | "eval" | "item" | "authoring" | "stage3" | "base-app-screen" | "every-stage";

export interface StopScope {
  stops: StopReach;
  /** A wider or other reach under a stated condition. */
  unless: { reach: StopReach; when: string } | null;
  keepsRunning: string;
  ledger: string;
}

/** The reason codes that stop work under prereg start rule 3. */
export type DcStopCode = Extract<
  ReasonCode,
  | "E_DC_JUDGE_KAPPA"
  | "E_DC_STOCK_FAIL"
  | "E_DC_NO_READ"
  | "E_DC_TWIN"
  | "E_DC_SMOKE_DROP"
  | "E_DC_EXPOSURE_STOP"
  | "E_DC_PROVIDER_DRIFT"
  | "E_DC_SUPPLY_SHORT"
  | "E_DC_AUTHOR_COST"
  | "E_DC_GATE_CHECK"
  | "E_DC_SANDBOX_AUDIT"
>;

/** One dry-run case. Each area exports its cases from <area>/dryrun-cases.ts. */
export interface DryRunCase {
  /** The rule or plan clause it drives, with no spaces, for example "M3" or "PD-1". */
  rule: string;
  name: string;
  /** Null on a pass, else the reason it failed. A throw is a failure too. */
  check: () => string | null | Promise<string | null>;
}
