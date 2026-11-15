// Copyright (c) 2026 Garry Tan. MIT License.
// The ask replay eval's shared shapes (prereg 2026-11-15-geva-539, sections 2 to 8). AskItem is the frozen interface
// between the custody builder (build.ts) and the harness, and the public synthetic set uses exactly this shape. Labels,
// after_reply, item ids and the thread map never reach a model prompt (prompt.ts, asserted in tests).

export type Label = "DECISION" | "DUPLICATE" | "PERMISSION_FOR_DEFAULT" | "OBSERVABLE";
export const LABELS: readonly Label[] = ["DECISION", "DUPLICATE", "PERMISSION_FOR_DEFAULT", "OBSERVABLE"];
export type Arm = "a" | "b" | "c" | "d";
export const ARMS: readonly Arm[] = ["a", "b", "c", "d"];
export type Action = "SEND" | "FOLD" | "DROP";
export const ACTIONS: readonly Action[] = ["SEND", "FOLD", "DROP"];
/** astra is a labeller only (frozen.json models.astra.role); it runs no arm. */
export type ModelKey = "opus" | "sol" | "particle" | "astra";
/** The labeller runs (plan section 7): the audit (I3), its contingency (I4) and the duplicate linking (I5). */
export type LabelKind = "audit" | "contingency" | "link";
export type AnswerJudgement = "yes" | "no" | "unclear";

/** One labeller reply. Positions count from 1 in the numbered list of earlier asks the labeller saw. */
export interface LabelReply {
  class: Label;
  repeats_of: number | null;
  answer_judgement: Array<{ row: number; answers: AnswerJudgement }>;
  reason: string;
}
export type From = "agent" | "owner" | "crew";

export interface Message {
  at: string;
  from: From;
  text: string;
}

export interface RuleRow {
  id: string;
  date: string;
  /** The row had no date of its own and took the next dated row's date (plan section 2.2). */
  placed: boolean;
  text: string;
}

export interface OwnerMessage {
  at: string;
  text: string;
}

export interface EarlierAsk {
  at: string;
  order: number;
  text: string;
  /** The first owner message after this ask and before the item's moment (ruling K1). */
  next_owner: OwnerMessage | null;
}

export interface AskItem {
  /** Opaque random id, never derived from content. */
  item: string;
  /** T1 to T8 in custody, S1 to S3 in the synthetic set. */
  thread: string;
  at: string;
  /** Event order within the thread. */
  order: number;
  label: Label;
  /** Before the ask, newest window of whole messages. */
  conversation: Message[];
  /** Older messages were cut. */
  cut: boolean;
  rules: RuleRow[];
  draft: string;
  /** Every earlier ask row in the thread, any class, oldest first. */
  earlier_asks: EarlierAsk[];
  /** Labelling only: the first owner message after the ask. No prompt reads it. */
  after_reply: OwnerMessage | null;
}

/** A parsed reply. repeats and reask_reason are kept as sent (undefined when the field is absent) and read only in arms c and d. */
export interface Reply {
  action: Action;
  reason: string;
  repeats?: unknown;
  reask_reason?: unknown;
}

export type MissingKind = "parse" | "safety" | "upstream";

export interface Sample {
  /** item.arm.model.replicate, fixed before any call; item.label-<kind>.model.1 for a labeller call, whose arm is a and unused. */
  id: string;
  item: string;
  arm: Arm;
  model: ModelKey;
  replicate: number;
}

/** How a c or d reply named its ledger row. not_asked: arms a and b, which have no ledger. */
export type RepeatsKind = "new" | "named" | "missing_field" | "unknown_id" | "not_asked";
/** What the send-time check did (plan section 4). */
export type GateRule = "none" | "drop_answered" | "fold_open" | "reask_kept";

export interface Usage {
  input: number;
  output: number;
  reasoning: number;
  cache_read: number;
  cache_write: number;
}

/** One sample's sealed record. text and reason are model output and stay in custody. */
export interface SampleRecord {
  sample: Sample;
  /** 1; 2 for the one redraw after a resume found an open call with no sealed reply; 3 for the end-of-run UPSTREAM pass. */
  draw: number;
  attempts: number;
  missing: MissingKind | null;
  agent_action: Action | null;
  final_action: Action | null;
  repeats: RepeatsKind;
  named: string | null;
  reask_reason: boolean;
  gate: GateRule;
  reason: string | null;
  text: string | null;
  /** The reply stopped at the output cap. */
  capped: boolean;
  micros: number | null;
  /** The end-of-run UPSTREAM redraw pass wrote this record. */
  upstream_redraw: boolean;
  /** A labeller call's parsed reply (label.ts); absent on arm samples. */
  label?: LabelReply | null;
}

/** The scorer's view of one sample. */
export type Outcome = Pick<SampleRecord, "missing" | "agent_action" | "final_action" | "repeats" | "reask_reason" | "gate" | "reason"> & Partial<Pick<SampleRecord, "named">> & Pick<Sample, "item" | "arm" | "model" | "replicate">;

export const outcomeOf = (r: SampleRecord): Outcome => ({ item: r.sample.item, arm: r.sample.arm, model: r.sample.model, replicate: r.sample.replicate, missing: r.missing, agent_action: r.agent_action, final_action: r.final_action, repeats: r.repeats, reask_reason: r.reask_reason, gate: r.gate, reason: r.reason, named: r.named });
