// Interfaces that more than one build unit codes against. A change here lands with the agreement of every unit that
// uses the type, and with a wiki post when it changes a contract. Amounts are US dollars; times are ISO-8601 UTC.
import type { ReasonCode } from "./errors/codes.ts";

export type Host = "claude" | "codex";

export type Verdict = "PASS" | "FAIL" | "INCOMPLETE";

/** 0 no loss detected, 1 the edit lost something, 2 no verdict, 3 calibration failed. Several models: 3, then 1, then 2, then 0. */
export type ExitCode = 0 | 1 | 2 | 3;

/** A built gstack-evals command module exports main; bin/gstack-evals calls it with the arguments after the command name. */
export type CommandMain = (argv: string[]) => Promise<number>;

// Arms (plan v3.2 "Arms and the measured configuration"; schema/arms.schema.json is U5's).

/** A repository pinned at a full commit sha, such as gstack at the preregistered sha. */
export interface StackRef {
  repo: string;
  sha: string;
}

export type ArmKind = "bare" | "placebo" | "stack" | "overlay" | "loadout";

/**
 * A resolved arm. The command-line grammar (name=<dir>, name=<repo>@<sha>, name=<loadout.json>, none, placebo) resolves
 * to one of these: none is an overlay that removes the target skill from a base, or bare without a base.
 */
export type ArmSpec =
  | { name: string; kind: "bare" }
  /** Generated from the named arm's installed tree by the seeded placebo generator. */
  | { name: string; kind: "placebo"; of: string }
  /** A whole stack at a sha, installed by its own setup; one install command per host. */
  | { name: string; kind: "stack"; stack: StackRef; install: Partial<Record<Host, string>> }
  /**
   * A base with the target skill replaced at its real install path (dir set), or removed (dir null).
   * With base null, dir is a loose folder, as in skill-diet.
   */
  | { name: string; kind: "overlay"; base: StackRef | null; skill: string; dir: string | null }
  /** Plan Amendment A1, unreviewed: no plan review has read the loadout kind yet. */
  | { name: string; kind: "loadout"; manifest: LoadoutManifest };

/** Plan Amendment A1, unreviewed. base is "gstack@<sha>". */
export interface LoadoutManifest {
  name: string;
  base: string;
  modules: { kind: "skill" | "section" | "overlay" | "preamble-tier"; id: string }[];
}

// Spend: leases and reservations. The metering proxy (U3) reserves and settles against the ledger (U4) through
// ReservationLedger, so the two units build in parallel.

/** Tokens by class for one call or one session. Reasoning tokens are counted apart from output tokens. */
export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache_read: number;
  cache_write: number;
}

/** One run's hold on one line item of an approved cap. A replacement worker cannot lease the item until this one is settled or reconciled. */
export interface Lease {
  lease_id: string;
  line_item: string;
  run_id: string;
  machine_id: string;
  reserved_usd: number;
  expires_at: string;
  state: "open" | "settled" | "reconciled";
}

/** Which attempt of which cell a call belongs to. The proxy journals this with the reservation id before it forwards the call. */
export interface CellAttempt {
  run_id: string;
  arm: string;
  task: string;
  model: string;
  trial: number;
  attempt: number;
  /** Public meter id: it appears in receipts and authorizes nothing. The per-session bearer never appears in any record. */
  meter_id: string;
}

/**
 * A charge held before one call is forwarded, at the request's real maximum. An unknown outcome keeps its full charge
 * and is never resent; resume reconciles it by reservation_id.
 */
export interface Reservation {
  reservation_id: string;
  lease_id: string;
  cell: CellAttempt;
  max_usd: number;
  state: "reserved" | "settled" | "unknown";
  spent_usd: number | null;
  usage: TokenUsage | null;
}

export type CallOutcome = { kind: "spent"; spent_usd: number; usage: TokenUsage } | { kind: "unknown" };

export interface ReservationLedger {
  /** Holds max_usd against the lease, or refuses with the code to print (CAP_STOP, E_ALLOWANCE, E_LEDGER_MISSING, E_LEASE_UNSETTLED). */
  reserve(request: { lease_id: string; cell: CellAttempt; max_usd: number }): Promise<{ ok: true; reservation: Reservation } | { ok: false; code: ReasonCode; message: string }>;
  /** Idempotent by reservation_id: settling twice with the same outcome returns the same reservation. */
  settle(reservation_id: string, outcome: CallOutcome): Promise<Reservation>;
}

// Outcomes: how a trial or a replay item ended, apart from its grade and its effects (plan v3.2, Lane B error taxonomy
// and review replay requirement 4).

/** Failures charged to the arm. */
export type ArmFailure = "malformed_output" | "malformed_tool_call" | "refusal" | "context_overflow" | "empty_response" | "harness_crash";

export type Termination =
  /** The agent finished; pass or fail is in grade. */
  | { kind: "completed" }
  /** Counts against the arm. */
  | { kind: "arm_failure"; failure: ArmFailure }
  /** Its own outcome, never a pass or a fail (TIMEOUTS). */
  | { kind: "timeout" }
  /** No outcome to count, such as a provider failure before any model output or E_USER_TURNS_MISSING. */
  | { kind: "missing"; code: ReasonCode }
  /** An evidenced, preregistered provider incident: excluded, and exclusions are counted per arm. */
  | { kind: "infra"; incident: string }
  /** Invalid credentials stop the run (E_KEY_REJECTED). */
  | { kind: "credentials_rejected" }
  /** The cap ran out before this item ran (CAP_STOP). */
  | { kind: "cap_stop" }
  /** A paid send with no recorded outcome: it keeps its charge and is never resent. */
  | { kind: "unknown"; reservation_id: string };

export interface TrialResult {
  termination: Termination;
  /** null unless termination is completed. */
  grade: "pass" | "fail" | null;
  /** Ids of the gated effects the evaluator observed outside the agent's container. */
  effects: string[];
}

// The versioned error record that --json writes as <out>/error.json (interface v0.4, "Error records").

export interface ErrorContext {
  resource_ids: Record<string, string>;
  gstack_evals_version: string;
  host: Host | null;
  host_version: string | null;
  image_digest: string | null;
  policy_sha256: string | null;
  ledger: string | null;
  ledger_record: string | null;
  /** Names of the environment variables involved, never their values. */
  env_names: string[];
}

export interface ErrorRecord {
  schema_version: 1;
  code: ReasonCode;
  operation: string;
  role: string | null;
  model: string | null;
  message: string;
  /** The underlying error's code and message, with secret values scrubbed, not dropped. */
  cause: { code: string; message: string } | null;
  context: ErrorContext;
  fix: string;
  /** The docs/errors.md anchor (docAnchor in src/errors/codes.ts). */
  doc: string;
  side_effects: string;
  retry: { safe: boolean; max: number };
  resumable: boolean;
  correlation_id: string | null;
  /** Path of the trace file, when one was written. */
  trace: string | null;
}
