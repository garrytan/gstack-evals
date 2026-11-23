// Copyright (c) 2026 Garry Tan. MIT License.
// Shared shapes for the office-hours founder eval (prereg wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg).
// Units, keys, sheets, transcripts and labels live sealed outside the repo; these are only their shapes. A units
// directory holds one folder per unit id:
//   <units>/<id>/opening.md   the founder's first message (section 3)
//   <units>/<id>/sheet.json   Sheet: the persona and the hidden facts, given only to the simulator
//   <units>/<id>/key.json     Key: what the evidence supports (never mounted, never shown to an arm or a simulator session)
//   <units>/<id>/unit.json    UnitMeta (never mounted)
// Every module of the lane codes against these shapes. Change one only with the modules that read it.

export type ModelId = "opus" | "sol" | "particle";
export type ArmId = "none" | "lens" | "office-hours";
/** Production judges and validators by short name: GPT-6 Astra, Opus 5.5 and Gemini 4 Argon (the panel's tie-break). */
export type JudgeKey = "astra" | "opus" | "gemini";
export type Stratum = "constructed" | "real";
export type AuthorFamily = "sol" | "argon";
export type Shape = "s1" | "s2" | "s3" | "s4" | "s5" | "s6";
/** Section 3's project types; the first match in this order wins. */
export type ProjectType = "marketplace" | "developer tools" | "B2B" | "consumer" | "other";
export type FactKind = "demand" | "payment" | "user" | "status-quo" | "attempt" | "reaction" | "channel" | "constraint" | "other";
export type SetName = "pilot" | "calibration" | "twin" | "comparison" | "reserve" | "real";
/** The two W items (section 2). */
export type WItem = "customer" | "wedge";

export interface Fact {
  id: string;
  /** First person, at most 40 words. */
  text: string;
  /** The kind of question that draws it out, at most 20 words. */
  reveal_when: string;
  kind: FactKind;
}

export interface Sheet {
  /** At most 30 words. */
  persona: string;
  facts: Fact[];
}

/** key.json as the author writes it (section 2), plus what later steps record beside it. */
export interface Key {
  customer: string;
  wedge: string;
  first_move: string;
  /** "none" on a no-pivot unit. */
  pivot: string;
  key_facts: string[];
  mentioned: WItem[];
  /** Constructed units only: the weaker alternative the 2 to 4 alternative facts point toward. */
  alternative?: { customer: string; wedge: string };
}

/** The key items a judge packet carries: the four statements only, never the sheet, the opening or a transcript. */
export interface KeyItems {
  customer: string;
  wedge: string;
  first_move: string;
  pivot: string;
}

export interface UnitMeta {
  id: string;
  stratum: Stratum;
  set: SetName;
  /** Seeded draw position (constructed units) or seeded order (real units). */
  draw: number;
  author: AuthorFamily;
  /** Constructed units only. */
  shape: Shape | null;
  type: ProjectType;
  industry: string;
  /** The W items that stay primary after the mentioned flag and the generic screen; at least one. */
  primary: WItem[];
  mentioned: WItem[];
  generic: WItem[];
  /** Descriptive split (section 8): the founder's stage at the opening. */
  founder_stage: "pre-product" | "has users" | null;
  /** A second skin's first-skin unit id (the twin check). */
  twin_of?: string;
  /** Real-history units: the source's dates (opening, first sale) and its fame tercile. */
  source_dates?: { opening: string; first_sale: string };
  fame_tercile?: 1 | 2 | 3;
  /** sha256 over the unit's current opening.md, sheet.json and key.json: every check result binds it. */
  digest: string;
}

/** A first-move block after the parser and before or after normalization (section 6). */
export interface FirstMove {
  first_move: string;
  next_action: string;
  /** At most two after normalization. */
  other_moves: string[];
  doubt: string;
}

/** Which tolerance of the one lenient parse a block needed. */
export type Lenient = "label" | "commas" | "optional";

export type MoveParse =
  | { kind: "block"; block: FirstMove; lenient: Lenient[] | null; body_sha256: string }
  | { kind: "no-block"; reason: string; body_sha256: string | null };

/** A normalized block as judges read it. first_move_full is the whole first_move as written, for the multi-target label only. */
export interface NormalizedBlock {
  block: FirstMove;
  first_move_full: string;
  /** Words per field after the cuts, and which fields the cuts shortened. */
  words: { first_move: number; next_action: number; other_moves: number; doubt: number };
  cut: { first_move: boolean; next_action: boolean; other_moves: boolean; doubt: boolean };
}

/**
 * The kinds of session the run side holds. arm: a primary-manifest session (stage 2) or a stage 1 none or smoke session.
 * reference: the full-information reference, one turn, no simulator (section 8). pitch: the pitch-only cell, outside the
 * primary manifest (the Captain's AN-1 ruling): the founder-reply limit is 0, so the closing message replaces the first
 * founder reply.
 */
export type SessionKind = "arm" | "reference" | "pitch";

/** How a session ended, section 6's C1 rows. */
export type EndState = "block" | "no-block" | "arm-stop" | "missing" | "contaminated" | "gstack-read";

/** One founder turn as the simulator's log records it. */
export interface FounderTurn {
  /** 1-based founder reply number; the closing message is not a founder turn. */
  turn: number;
  reply: string;
  revealed: string[];
  rules: number[];
  /** Attempts the per-turn checks took (1 or 2). */
  attempts: number;
}

/** One session as the run side hands it to the scorer. */
export interface SessionRow {
  stage: 1 | 2;
  kind: SessionKind;
  unit: string;
  model: ModelId;
  arm: ArmId;
  /** 1-based pass. */
  pass: number;
  end: EndState;
  /** The reason code behind a missing or arm-stop end. */
  code: string | null;
  /** The last first-move block of the reply that ended the session; null unless end is block. */
  block: NormalizedBlock | null;
  lenient: Lenient[] | null;
  founder_turns: FounderTurn[];
  /** True when the closing message went (the founder-reply limit was reached). */
  closing_sent: boolean;
  /** Assistant replies in the session, the closing reply included. */
  replies: number;
  /** Exposure detector reads on the final transcript (office-hours sessions), else null. */
  exposure: { x1: boolean; x2: boolean; x3: boolean; exposed: boolean; load: boolean; design_doc: boolean; forcing_asked: number; forcing_routed: number } | null;
  /** Mechanical counters on the assistant's text (section 8). */
  questions: number;
  pushes: number;
  /** Key-fact order check: the founder turn before the session's first recommending reply, or null when none recommends. */
  first_recommendation_reply: number | null;
  /** Successful web tool results and gstack files read (none and lens), from the transcript and the read audit. */
  web: number;
  gstack_reads: string[];
  /** Real stratum: the session's assistant text named the source. */
  named_source: boolean;
  /** Metered dollars on the arm's slot and on the simulator, both attempts summed. */
  usd: number;
  sim_usd: number;
  attempts: number;
  /** Repairs in force (the forced sentence, the 30-reply limit, the simulator prompt repair), by name. */
  repairs: string[];
}

/** One judge label record for one block against one key (true or shuffled). A null cell is unlabelled. */
export interface LabelRecord {
  block: string;
  unit: string;
  /** The unit whose key the block was labelled against: the block's own unit, or the shuffled partner. */
  key_unit: string;
  key: "true" | "shuffled";
  judge: JudgeKey | "panel";
  model_version: string | null;
  effort: string;
  customer: boolean | null;
  wedge: boolean | null;
  multi_target: boolean | null;
  next: boolean | null;
  alt: boolean | null;
  /** Null on a no-pivot unit as well as when unlabelled. */
  doubt: boolean | null;
}

/**
 * Labels blocks against one unit's key items, one packet. Authoring (the unanimous-key and give-away checks, the generic
 * screen) and the scoring side call the same labeller, so every W label in the eval comes from one brief.
 */
export type Labeller = (req: {
  judge: JudgeKey;
  unit: string;
  items: KeyItems;
  blocks: ReadonlyArray<{ id: string; block: NormalizedBlock }>;
  effort: "medium" | "max";
  label: string;
}) => Promise<Map<string, Omit<LabelRecord, "block" | "unit" | "key_unit" | "key"> | null>>;

/** A dry-run seam: one frozen rule driven on one side of its edge. Each area exports its seams; the lane's dry run runs them all. */
export interface Seam {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }> | { ok: boolean; detail: string };
}

/** One scheduled session (section 11's manifest). The pitch-only cell and the real stratum have manifests of their own. */
export interface ManifestEntry {
  stage: 1 | 2;
  kind: SessionKind;
  unit: string;
  model: ModelId;
  arm: ArmId;
  pass: number;
}

type Bit = 0 | 1 | null;

/** One session after judging: what the readings consume. A null score is missing or unscored. */
export interface ScoredSession extends ManifestEntry {
  stratum: Stratum;
  set: SetName;
  end: EndState;
  /** Primary: the judge credits the customer or the wedge on a primary item and the block is not multi-target. Null when missing, or when a cell that can change W is unlabelled. */
  W: Bit;
  /** W against the shuffled key; null when the shuffled-key cells are incomplete (the pass then leaves the specificity guard only). */
  W_shuffled: Bit;
  W_customer: Bit;
  W_wedge: Bit;
  W_both: Bit;
  W_alt: Bit;
  N: Bit;
  /** Null on a unit whose pivot is none. */
  R: Bit;
  /** Shares of key facts (E), of key facts of kind demand or payment (E_demand) and of every hidden fact (E_all) the log records as revealed. */
  E: number | null;
  E_demand: number | null;
  E_all: number | null;
  /** Share of key facts revealed before the first reply that recommends what to build or sell. */
  order_share: number | null;
  founder_turns: number;
  questions: number;
  pushes: number;
  first_move_words: number | null;
  exposed: boolean | null;
  /** The session reached its founder-reply limit (the closing message went). */
  limit_hit: boolean;
  arm_stop: boolean;
  gstack_read: boolean;
  web: boolean;
  named_source: boolean;
  usd: number;
  sim_usd: number;
  repairs: string[];
}

/** A stock row's credit from one production judge in one packet (section 8's stock checks). */
export interface StockCredit {
  stage: 1 | 2;
  /** The model whose blocks the packet held, so the row is judged by that model's production judge. */
  model: ModelId;
  judge: JudgeKey | "panel";
  row: 1 | 2 | 3;
  unit: string;
  W: Bit;
  N: Bit;
}

