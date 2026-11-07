// Copyright (c) 2026 Garry Tan. MIT License.
// Shared types of the trust-but-verify lane (prereg 2026-11-05-geva-313 as amendment 1 changes it). Every module that
// another module reads codes against these, so a change here is a change to every builder's contract.
import type { Provider } from "../../src/runner/pricing/prices.ts";
import type { TokenUsage } from "../../src/types.ts";

export type Source = "A" | "B";
export type Family = "investigate" | "ship" | "capy" | "review";
export type Arm = "none" | "current" | "principle" | "lens";
export type Model = "opus" | "sol" | "particle";
export type Judge = "sol" | "opus";
export type Stratum = "long" | "short" | "other" | "clean";
export type Turn = "report" | "followup" | "d1" | "d2";

/** The models under test and the route each arm request takes (prereg section 1): Opus on Anthropic, Sol and particle-1 on OpenRouter's Anthropic-compatible Messages route. */
export const ARM_MODELS: Readonly<Record<Model, { provider: "anthropic" | "openrouter"; id: string }>> = {
  opus: { provider: "anthropic", id: "claude-opus-5-5" },
  sol: { provider: "openrouter", id: "openai/gpt-6.1-sol" },
  particle: { provider: "openrouter", id: "particle-ai/particle-1" },
};
/** Section 7: Opus arms are judged by Sol, Sol and particle-1 arms by Opus. */
export const JUDGE_OF: Readonly<Record<Model, Judge>> = { opus: "sol", sol: "opus", particle: "opus" };
export const otherJudge = (j: Judge): Judge => (j === "sol" ? "opus" : "sol");

/** Frozen bundle files, repo-relative. judge-brief-v2.md replaces judge-brief.md (amendment item 9). */
export const PREREG_DIR = "wiki/plans/2026-11-05-geva-313-trust-but-verify-prereg";
export const AMENDMENT_DIR = "wiki/plans/2026-11-05-geva-326-tbv-prereg-amendment-1";
export const BUNDLE = {
  stock: { path: PREREG_DIR + "/stock.txt", sha256: "e04a8816842bf4ada37c1acfd1577599bbcc6c2cbea851546cc850c1d5cbb229" },
  lens: { path: PREREG_DIR + "/lens.txt", sha256: "e2e99bd829c830feb77f371b0c639c89ec2fbfc8ea2c795dda16cdc7139bf278" },
  turns: { path: PREREG_DIR + "/turns.txt", sha256: "f8257cf34ea1c60dd56662f49c20d60f247849c3c8cced3ff1b44de64d54efe2" },
  keyBrief: { path: PREREG_DIR + "/key-brief.md", sha256: "e9e9dab127c598adbcc269bc6ed683e10e29836783839e6036f7bfc8837ccd65" },
  judgeBrief: { path: AMENDMENT_DIR + "/judge-brief-v2.md", sha256: "110c275b54c186ba22edb8e18c3e3a305f993d6f8f85ac7bf0391bcacdfdc1ca" },
} as const;

/** The three user turns and the follow-up, from turns.txt (report, d1, d2, followup). */
export type Turns = Readonly<Record<Turn, string>>;

// ---------- Messages API shapes ----------

export type Block =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; cache_control?: { type: "ephemeral" } }
  | { type: "tool_result"; tool_use_id: string; content: string | Array<{ type: "text"; text: string }>; is_error?: boolean; cache_control?: { type: "ephemeral" } };
export interface Message {
  role: "user" | "assistant";
  content: Block[];
}

// ---------- History (history/events.ts, history/source-a.ts, history/source-b.ts) ----------

export type HistoryEvent =
  | { n: number; kind: "user-text"; text: string }
  | { n: number; kind: "assistant-text"; text: string }
  | { n: number; kind: "tool-use"; id: string; name: string; input: Record<string, unknown> }
  | { n: number; kind: "tool-result"; tool_use_id: string; content: string; is_error: boolean };

/** One task's frozen work. events[0] is the task's own first user message; numbering starts at 1 and the key cites it. sha256 is historySha256(events). */
export interface History {
  schema: "tbv-history.v1";
  source: Source;
  task: string;
  cluster: string;
  family: Family;
  events: HistoryEvent[];
  sha256: string;
  /** Source facts the extractor and the stratum need and the model never sees: model.patch file list, verifier resolved, changed files, check states. Never sent. */
  side: { files: string[]; resolved: boolean | null; patch: string | null };
}

export type AssembleResult = { ok: true; history: History } | { ok: false; drop: string; detail: string };

// ---------- Extractor (extract.ts) ----------

export interface Candidate {
  kind: "test" | "test-summary" | "env" | "exit" | "config" | "check" | "finding";
  state: string;
  name: string;
  /** Lowercased names a report may use for it (node id, base, last segment, path, basename). */
  names: string[];
  events: number[];
  material: boolean;
}
export interface ListItem {
  name: string;
  state: string;
  flagged: boolean;
  events: number[];
}
export interface Extract {
  schema: "tbv-extract.v1";
  task: string;
  history_sha256: string;
  candidates: Candidate[];
  lists: ListItem[][];
  /** The longest list, in the record's own order. */
  longest: ListItem[];
  stratum: Stratum | "none";
  /** History characters / 3 (amendment item 12's count). */
  tokens: number;
}

// ---------- Shape and splice (shape.ts, splice.ts) ----------

/** Per-run fields in captured text, filled per model when a request is built. */
export const PLACEHOLDERS = { modelId: "{{TBV_MODEL_ID}}", modelName: "{{TBV_MODEL_NAME}}", cwd: "{{TBV_CWD}}", date: "{{TBV_DATE}}", firstUser: "{{TBV_FIRST_USER}}" } as const;

/** The request shape Claude Code sends at a pin for an arm, with per-run fields as placeholders. Captured text is never committed; its sha256 is. */
export interface Shape {
  schema: "tbv-shape.v1";
  arm: Arm;
  pin: string | null;
  claude_code: string;
  system: Array<{ type: "text"; text: string }>;
  tools: Array<Record<string, unknown>>;
  max_tokens: number;
  sha256: string;
}

/** What a gstack arm's history carries for a family at a pin (prereg section 3, splice set). */
export interface SpliceSet {
  schema: "tbv-splice.v1";
  family: Family;
  pin: string;
  /** The first user message as Claude Code renders it, with PLACEHOLDERS.firstUser where the task's own first message goes. */
  opening: Block[];
  /** Assistant tool calls and their results after the opening and before the source's work (skill-start, Reads; capy: factory.md). Alternating assistant and user messages. */
  head: Message[];
  /** Capy only: the Reads of report.md and READY.md as the last tool calls before the report turn. Empty otherwise. */
  tail: Message[];
  /** The closer byte check (de-rendered text): the preamble's closer paragraph, or capy's three files by sha256. */
  closer: { kind: "preamble"; paragraph: string } | { kind: "capy"; files: Array<{ name: string; sha256: string }> };
  skillStart: { command: string; stdout_sha256: string } | null;
  files: Array<{ path: string; sha256: string }>;
  sha256: string;
}

// ---------- Requests (request.ts) ----------

export interface Reply {
  text: string;
  /** The assistant content blocks as returned (text and any tool_use), so later turns carry the conversation. */
  content: Block[];
  stopReason: string | null;
}
export interface BuildInput {
  history: History;
  shape: Shape;
  splice: SpliceSet | null;
  turns: Turns;
  arm: Arm;
  model: Model;
  turn: Turn;
  /** Replies so far in this reading, in turn order (report, then followup if sent, then d1). */
  prior: Array<{ turn: Turn; reply: Reply }>;
}
export interface BuiltRequest {
  provider: "anthropic" | "openrouter";
  route: "/v1/messages";
  body: Record<string, unknown>;
  /** Request characters / 3. */
  estTokens: number;
  sha256: string;
}
export type Validation = { ok: true } | { ok: false; size: true; tokens: number; window: number } | { ok: false; size: false; problem: string };

// ---------- Sends and item runs (drive.ts) ----------

/** One send's outcome as the driver classifies it; rule.ts endState reads the kinds. */
export type AttemptKind = "text" | "tool-only" | "empty" | "refusal" | "max-tokens" | "5xx" | "timeout" | "broken-stream" | "truncated" | "no-final" | "4xx" | "budget" | "allowance" | "validator" | "size" | "closer" | "outage";
export interface SendRequest {
  provider: Provider;
  route: string;
  body: Record<string, unknown>;
  stream: boolean;
}
export interface SendResult {
  kind: AttemptKind;
  status: number | null;
  reply: Reply | null;
  responseId: string | null;
  /** The reply's own id (an Anthropic msg_ id, or the body's id), kept beside responseId. Set by the report driver. */
  messageId?: string | null;
  /** Where responseId came from: OpenRouter's X-Generation-Id header, the reply body, or null when an OpenRouter answer carried no gen- id. */
  idFrom?: "x-generation-id" | "body" | null;
  /** meter:call:attempt, the proxy's idempotency key for this send. */
  idempotencyKey: string | null;
  problemCode: string | null;
  usage: TokenUsage | null;
}
/** One proxy slot (a reading, a judge packet or a key task): sends go through the item's lease. */
export interface Slot {
  label: string;
  send(req: SendRequest): Promise<SendResult>;
  /** Settled micros on this slot so far (the proxy meter). */
  micros(): Promise<number>;
  close(): Promise<void>;
}
export interface ItemRunOptions {
  item: string;
  runId: string;
  /** The ledger record directory and the local ledger file (src/runner/ledger/paths.ts). */
  record: string;
  ledger: string;
  out: string;
  env: Record<string, string | undefined>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}
export interface ItemRun {
  runId: string;
  leaseId: string;
  slot(label: string, models: string[], allowanceMicros: number): Slot;
  /** Settled, reserved and unknown micros on the lease, and the item's cap. */
  spend(): Promise<{ settled: number; reserved: number; unknown: number; cap: number }>;
  close(): Promise<{ settled: number; unknown: number }>;
}

/** One reading of one task by one arm and model in one pass (driver output, sealed for held-out). */
export interface ReadingRecord {
  schema: "tbv-reading.v1";
  /** Random label minted by the driver (crypto random), the only key that leaves custody. */
  label: string;
  item: string;
  task: string;
  family: Family;
  arm: Arm;
  model: Model;
  pass: number;
  cls: "scored" | "no-report" | "gap" | "harness" | "cap" | "outage" | "size-drop";
  why: string;
  drill: Partial<Record<"d1" | "d2", string>>;
  texts: { report: string | null; d1: string | null; d2: string | null };
  responseIds: string[];
  maxTokens: Turn[];
  sends: Array<{ turn: Turn; attempt: number; kind: AttemptKind; status: number | null; responseId: string | null; messageId?: string | null; idFrom?: "x-generation-id" | "body" | null; idempotencyKey: string | null; micros: number | null; usage: TokenUsage | null }>;
  usd: number;
  cacheRead: number | null;
}

// ---------- Keys, packets, judging (keys.ts, packet.ts, judge.ts) ----------

export const CATEGORIES = ["broken test", "skipped or unrun test", "check failed or not run", "config or CI changed", "claim not verified", "guess stated as fact", "scope cut", "change outside scope", "environment problem"] as const;
export type Category = (typeof CATEGORIES)[number];
export interface KeyFact {
  id: string;
  category: Category;
  statement: string;
  events: number[];
  critical: boolean;
}
export interface KeyTrap {
  id: string;
  claim: string;
  why_false: string;
  events: number[];
}
export interface Key {
  schema: "tbv-key.v1";
  task: string;
  history_sha256: string;
  facts: KeyFact[];
  traps: KeyTrap[];
  list: Array<{ name: string; state: string }> | null;
  digest: string;
  /** Fact ids each auditor rejected, what each found material and missing from the digest, and the ids dropped for it. */
  audits: Array<{ auditor: Judge; rejected: string[]; missing: string[]; responseIds: string[] }>;
  dropped: string[];
}

export type PacketKind = "first" | "d2" | "control";
export interface Packet {
  schema: "tbv-packet.v1";
  id: string;
  kind: PacketKind;
  digest: string;
  facts: Array<{ id: string; statement: string }>;
  traps: Array<{ id: string; claim: string }>;
  list: Array<{ name: string; state: string }> | null;
  /** The first reply with the boundary line after its 250th word (first and control), or D2's reply (d2). */
  reply: string;
  d1: string | null;
}
/** Kept apart from the packets: what each packet id stands for and who judges it. */
export interface PacketKeyEntry {
  packet: string;
  sha256: string;
  kind: PacketKind;
  /** The reading's label, or for a control "stock:<task>" or "oracle:<task>". */
  label: string;
  task: string;
  primary: Judge;
  /** The other judge when the seeded double read picked the reading; both judges read every control. */
  second: Judge | null;
}
export interface JudgeAnswer {
  facts: Array<{ id: string; in: boolean; any: boolean }>;
  unsupported: string[];
  traps: string[];
  list: { named: boolean; order: boolean; rest: boolean; offer: boolean } | null;
  d1: Array<{ name: string; state: string }> | null;
}
export interface JudgeRecord {
  packet: string;
  judge: Judge;
  role: "primary" | "second";
  status: "judged" | "unjudged";
  answer: JudgeAnswer | null;
  responseIds: string[];
  reason: string;
}

// ---------- The readings file rule.ts reads (readings.ts writes it) ----------

export type ReadingStatus = "scored" | "no-report" | "gap" | "harness" | "unjudged" | "cap" | "outage" | "size-drop";
export interface FactLabel {
  in: boolean;
  any: boolean;
}
export interface ReadingRow {
  id: string;
  task: string;
  family: Family;
  arm: Arm;
  model: Model;
  pass: number;
  status: ReadingStatus;
  judge: Judge;
  facts: FactLabel[];
  unsupported: number;
  exposed: boolean | null;
  words: number;
  usd: number;
  cacheRead?: number;
  responseIds: string[];
  maxTokens: Turn[];
  list?: { named: boolean; order: boolean; rest: boolean; offer: boolean };
  shortShare?: number;
  d1?: number | null;
  second?: { judge: Judge; status: "judged" | "unjudged"; facts: FactLabel[]; responseIds: string[] };
  /** The D2 packet's primary read; unjudged with no claims when it has no judge record or failed. Absent when the reading has no D2 packet. */
  d2?: { status: "judged" | "unjudged"; unsupported: string[] };
  /** The D1 states the first packet's primary judge returned. */
  d1States?: Array<{ name: string; state: string }>;
  /** The trap labels the first packet's primary judge returned. */
  traps?: string[];
}
export interface TaskRow {
  id: string;
  cluster: string;
  source: Source;
  stratum: Stratum;
  nfacts: number;
  family?: "investigate" | "ship" | "review";
}
export interface ControlRow {
  task: string;
  kind: "stock" | "oracle";
  judge: Judge;
  status: "judged" | "unjudged";
  facts: FactLabel[];
  responseIds: string[];
}
export interface ReadingsFile {
  stage: "hr" | "dev" | "held";
  tasks: TaskRow[];
  readings: ReadingRow[];
  controls?: ControlRow[];
  plan: {
    models: Model[];
    passes: Partial<Record<Model, number>>;
    capyPasses?: number;
    skillArms: Arm[];
    taskIds: string[];
    controlTaskIds: string[];
    manifestSha256: string;
    devGap?: { opusPrincipleMinusNone: number; devMdd: number };
  };
}

/** The split manifest B2 writes (custody): the planned tasks of a stage, the one source of denominators. */
export interface SplitManifest {
  schema: "tbv-split.v1";
  stage: "hr" | "dev" | "held";
  tasks: TaskRow[];
  controlTaskIds: string[];
}

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
