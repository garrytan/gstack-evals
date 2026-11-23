// Copyright (c) 2026 Garry Tan. MIT License.
// Records the /cso real-advisory lane's parts share (plan sections 3, 4, 5, 8 and 9): a built unit, a driven session
// and its exposure. Units and sessions write these; the judge, scorer and analysis read them. Change a shape only with
// every part that reads it.
export type CsoArm = "none" | "cso" | "untold";
export type CsoModel = "opus" | "particle" | "sol";
export type CsoStage = "stage0" | "stage1" | "repilot" | "stage2" | "rerun-pilot" | "rerun";

/** One pre-fix hunk of a non-test source file, by parent line numbers. An insert-only hunk has no removed or changed
 *  line: its range is the two parent lines around the insertion point and added holds the inserted lines. */
export interface PreFixHunk { file: string; start: number; end: number; insert_only: boolean; added?: string[]; text: string }

export interface KnownOpenAdvisory { ghsa: string; summary: string; files: string[] }

/** A unit that passed every gate, at its usable position. */
export interface UnitRecord {
  schema: "cso-unit.v1";
  unit: string;
  position: number;
  part: "part1" | "part2";
  index: number;
  repo: string;
  ghsa: string;
  cves: string[];
  fix_commit: string;
  parent: string;
  ecosystem: string;
  published: string;
  month: string;
  cwe_ids: string[];
  cwe_families: string[];
  fix_files: string[];
  hunks: PreFixHunk[];
  advisory: { summary: string; details: string };
  source_files: number;
  kind: "library" | "service";
  known_open: KnownOpenAdvisory[];
  tree_sha256: string;
}

/** Why a session ended (section 9). gap: the second upstream end or the second infra failure. */
export type SessionEnd = "completed" | "limit_wall" | "limit_turns" | "limit_allowance" | "safety_stop" | "gap";

/** Section 8's detectors over one session's transcript. */
export interface Exposure {
  loaded: boolean;
  procedure_ran: boolean;
  run_id: string | null;
  completeness: "complete" | "partial" | "not_assessed" | null;
  findings_submitted: number | null;
  tooling_errors: number;
  host_reads_after_start: number;
  /** The started run's mode and scope as "<mode>/<scope>" from the helper's start output (policy.mode and policy.scope),
   *  or from its start argv when the output holds no policy: "daily/default" is section 12's default run. Null with no start. */
  scope: string | null;
}

/** The helper's own records for path normalization (section 5): its snapshot root and the handles it printed. */
export interface HelperRecords { snapshot_root: string | null; handles: Record<string, string> }

export interface SessionRecord {
  schema: "cso-session.v1";
  unit: string;
  arm: CsoArm;
  model: CsoModel;
  stage: CsoStage;
  /** The model id and harness version as the session itself reported them, never the plan's. */
  model_id: string;
  harness: "claude-code" | "codex";
  harness_version: string;
  end: SessionEnd;
  reason: string | null;
  attempts: number;
  continuations: number;
  done_seen: boolean;
  /** Every assistant text block, in order, with no tool input or output and no thinking. */
  texts: string[];
  /** Repository-relative paths the session opened or listed through any tool, in order (the miss anatomy reads it). */
  opened: string[];
  helper: HelperRecords;
  exposure: Exposure;
  cost_usd: number;
  wall_sec: number;
  turns: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
}
