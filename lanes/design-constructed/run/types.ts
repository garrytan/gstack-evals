// Copyright (c) 2026 Garry Tan. MIT License.
// The run area's own types and seams: how a session attempt ended, the injected calls the session loop and the hooks
// make (a lease, the metering proxy, the block parser, a container's shell), and the reads the detectors return.
// Integration wires the real pieces; the dry run and the tests pass invented ones. Nothing here changes types.ts.
import type { CellState, ChangeList, Model, SessionKind } from "../types.ts";

/** One shell call in a place: the host, or a review container against its own mount. */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Exec = (command: string) => ExecResult | Promise<ExecResult>;

/** The block parser (the score area's strict and lenient parse): the last plan-changes block in a reply, or null. */
export type ParseBlock = (reply: string) => ChangeList | null;

/**
 * How one attempt ended, read off the driver's termination (BT, plan section 6, with the Captain's 2026-11-14 ruling).
 * own-limit is the session's own limit: context overflow, the harness timeout, the turn, minute or dollar limit, or the
 * harness ending the session on the model's own malformed tool call with no API, provider or harness error. outside is
 * a failure outside the agent: a provider or proxy error, a crash, a closed lease or a lost host, or a malformed tool
 * call that ended the session because one of those returned an error. A refusal, an empty reply or malformed output is
 * a completed reply, which the frozen parse decides.
 */
export type AttemptEnd =
  | { kind: "completed" }
  | { kind: "own-limit"; limit: "context" | "timeout" | "turns" | "dollars" | "tool-call" }
  | { kind: "cap-stop" }
  /** A session a provider drift stop cut (PD-25): read as a cap stop reads. */
  | { kind: "drift-stop" }
  | { kind: "outside"; reason: string };

/** What the classifier reads from one finished attempt. */
export interface AttemptRecord {
  end: AttemptEnd;
  /** The main agent's text blocks in order, joined by a blank line; the parser reads its last block. */
  reply: string;
  /** Whether any main-agent text held a parsable block before the session stopped (the descriptive count). */
  heldBlock: boolean;
  /** A successful WebSearch or WebFetch result (a client tool or the provider's server tool). */
  webResult: boolean;
  /** A gstack file read; only none, lens and reference sessions read it as contamination. */
  gstackRead: boolean;
  /** Whether any judge has read a block of this attempt (J1: such an attempt is never retried). */
  judged: boolean;
  /** autoplan only: a gate answered rec by the harness, and a run that reached APPROVED. Null in other arms. */
  autoplan: { gateAnswered: boolean; approved: boolean } | null;
}

/** A cell's read after an attempt: a frozen cell state. */
export type EndRead = { state: CellState; list: ChangeList | null; why: string };

/** One planned review cell: a unit, an arm or the reference, a model and a pass. */
export interface Cell {
  unit: string;
  kind: SessionKind;
  model: Model;
  pass: number;
}

/** What J1 reconciliation found for an attempt before a retry (the lease, the proxy's record and the session log). */
export type Reconciled = { ok: true; judged: boolean } | { ok: false; why: string };

/** The session loop's seams: one session on the item's lease and its proxy, and J1 reconciliation. */
export interface LoopSeams {
  /** Runs one fresh session for the cell (attempt 1 or 2) and returns its record. */
  session(cell: Cell, attempt: 1 | 2): Promise<AttemptRecord>;
  /** Reconciles an attempt against its lease, the proxy's journal and the session log before any retry. */
  reconcile(cell: Cell, attempt: 1 | 2): Promise<Reconciled>;
  parse: ParseBlock;
  log?: (line: string) => void;
}

/** A cell's final outcome: its state, the scored attempt's list, and every attempt's read. */
export interface CellOutcome {
  cell: Cell;
  state: CellState;
  list: ChangeList | null;
  attempts: Array<{ attempt: 1 | 2; end: AttemptEnd; read: EndRead; heldBlock: boolean }>;
  why: string;
}

/** The run directory reads the gate hook needs, in the place the run lives (a container, or a local session). */
export interface RunBox {
  /** Every run.json under /work and HOME written during this session (mtime at or after since), with its directory. */
  runs(sinceMs: number): Array<{ dir: string; state: Record<string, unknown> }>;
  /** A file's text, or null. */
  read(path: string): string | null;
  /** Runs one pinned gstack binary with arguments, no shell. */
  gstack(bin: "gstack-autoplan" | "gstack-gate" | "gstack-artifact", args: string[]): ExecResult;
}
