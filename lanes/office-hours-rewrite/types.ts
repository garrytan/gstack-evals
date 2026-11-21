// Copyright (c) 2026 Garry Tan. MIT License.
// Shared shapes for the office-hours rewrite eval (prereg wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg,
// as changed by its dated pre-run changes). Briefs, keys, sheets, transcripts and labels live sealed outside the repo;
// these are only their shapes. A briefs directory holds one folder per brief id:
//   <briefs>/<id>/opening.md   the founder's or builder's first message (section 3)
//   <briefs>/<id>/sheet.json   Sheet: the persona and the hidden facts, given only to the simulator
//   <briefs>/<id>/key.json     Key: the right call (never mounted, never shown to an arm or a simulator session)
//   <briefs>/<id>/brief.json   BriefMeta (never mounted)
//   <briefs>/<id>/prior.json   PriorSession, T8 only: the seeded prior session (section 4 step 6)
// Every area of the lane codes against these shapes. Change one only with the areas that read it.
import type { Fact, FounderTurn, JudgeKey, ModelId, Seam, Sheet } from "../office-hours-founder/types.ts";

export type { Fact, FounderTurn, JudgeKey, ModelId, Seam, Sheet };

/** Section 2: the two pinned skills and no gstack. */
export type ArmId = "none" | "current" | "new";
export type SkillArm = Exclude<ArmId, "none">;
export type BriefKind = "founder" | "builder";
/** Section 3's founder types. T1 to T6 come as matched pairs; T7 and T8 are unpaired. */
export type FounderType = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8";
/** Section 3's builder goals. */
export type BuilderGoal = "hackathon" | "open-source" | "research" | "learning" | "fun";
export type AuthorFamily = "sol" | "argon";
/** Pilot briefs are placed into these sets like any other (pre-run change 1, item 4d). */
export type SetName = "calibration" | "comparison" | "reserve";

/**
 * key.json (section 3, Key). call is the decision line for a founder and the build-first call for a builder.
 * actions holds 2 to 4 acceptable next-action classes (founder) or acceptable first steps (builder). decisive holds the
 * 1 or 2 decisive fact ids on this brief's sheet. A paired founder brief names its twin and has no wrong_call; every
 * unpaired brief, founder or builder, has twin null and one plausible wrong call the hidden facts rule out.
 */
export interface Key {
  call: string;
  actions: string[];
  decisive: string[];
  twin: string | null;
  /** The founder has a named payer or user. Always false on a builder brief. */
  traction: boolean;
  wrong_call: string | null;
}

export interface BriefMeta {
  id: string;
  kind: BriefKind;
  type: FounderType | BuilderGoal;
  /** 1 to 5 for comparison briefs; 0 for calibration and reserve briefs. */
  skin: number;
  /** The opening cluster: twins share one, every unpaired brief is its own (section 3; section 8's clusters). */
  cluster: string;
  set: SetName;
  /** Seeded draw position. */
  draw: number;
  author: AuthorFamily;
  /** The twin's brief id on a paired founder brief, else null. */
  twin_of: string | null;
  traction: boolean;
  /** The founder anti-pattern the opening carries as its surface (section 3); null on builder briefs. */
  anti_pattern: string | null;
  industry: string;
  /** Authored in the pilot (pre-run change 1, item 4d). */
  pilot: boolean;
  /** sha256 over the brief's current opening.md, sheet.json, key.json and, on T8, prior.json: every check binds it. */
  digest: string;
}

/** T8's seeded prior session (section 4 step 6): the assignment and its test; the new pin also gets date and condition. */
export interface PriorSession {
  /** ISO date of the prior session. */
  date: string;
  assignment: string;
  /** The test the founder set; its outcome stays a hidden fact on the sheet. */
  test: string;
  /** ISO date the test was due; read only by the new pin's seed. */
  test_date: string;
  /** The kill or success condition; read only by the new pin's seed. */
  condition: string;
}

/**
 * One simulator turn as the session records it (pre-run change 1, item 4c). delivered is true when the adviser received
 * the reply; a reply the closing message replaced is false. done is the simulator's done field (item 4e). Draws the checks
 * rejected are kept in rejected_draws and never count toward R1, G3 or the reply cap.
 */
export interface Turn extends FounderTurn {
  delivered: boolean;
  done: boolean;
  rejected_draws: { revealed: string[]; checks: string[] }[];
}

/** The closing block (section 4 step 4), after the parser's cut of each line to 40 words. */
export interface Block {
  decision: string;
  next_action: string;
  why: string;
}

export type BlockParse =
  | { kind: "block"; block: Block; cut: { decision: boolean; next_action: boolean; why: boolean }; body_sha256: string }
  | { kind: "no-block"; reason: string; body_sha256: string | null };

/**
 * How a session ended (section 8's failure table). block: a block was read. no-block: no block after two closing
 * messages (R = 0). safety-stop: a provider safety filter stopped it (R = 0, its own outcome). refusal: the model
 * refused (R = 0). missing: an upstream, provider, simulator or harness failure after the one retry. contaminated: a
 * gstack read in the none arm (missing, counted as contamination).
 */
export type EndState = "block" | "no-block" | "safety-stop" | "refusal" | "missing" | "contaminated";

/** One scheduled session. Stage 1 runs the calibration briefs; stage 2 the comparison briefs. */
export interface ManifestEntry {
  stage: 1 | 2;
  brief: string;
  model: ModelId;
  arm: ArmId;
}

/** One session as the run side hands it to the scorer. */
export interface SessionRow extends ManifestEntry {
  end: EndState;
  /** The reason code behind any end other than block. */
  code: string | null;
  block: BlockParse | null;
  founder_turns: Turn[];
  /** Closing messages sent: 0, 1 or 2. */
  closings: number;
  /** The founder set done (as opposed to the reply cap sending the closing message). */
  founder_done: boolean;
  /** Assistant replies, the closing replies included. */
  replies: number;
  /** The SESSION_KIND value the skill printed, or null. Skill sessions must print "interactive" (A7). */
  session_kind: string | null;
  /**
   * The models the scored attempt's replies report, joined by ", " (Claude Code's transcript, or the model tap for Sol),
   * or null with no reply; and the CLI version its transcript names. rowProblems checks both against the pins (the
   * second attempt's pre-run change 2).
   */
  served_model: string | null;
  cli_version: string | null;
  /** Simulator turns that failed the reveal guard after its retries (pre-run change 1, item 4b). */
  guard_failures: number;
  /** gstack files read in the none arm's tool calls (the read audit). */
  gstack_reads: string[];
  /** Metered dollars on the arm's slot and on the simulator, attempts summed. */
  usd: number;
  sim_usd: number;
  attempts: number;
  /** Path of the sealed transcript, outside the repo; the scorer reads detectors from it. */
  transcript: string | null;
  /** Path of the session's state root after the run, outside the repo; deliverable and approval checks read it. */
  state_root: string | null;
}

/**
 * What a judge packet carries of a key (section 5): the call, the acceptable action classes and the contrast call it
 * must not make (the twin's call on a paired brief, the key's wrong call on an unpaired one). Never a sheet, an opening,
 * a fact id or a transcript.
 */
export interface KeyItems {
  call: string;
  actions: string[];
  contrast: string;
}

/** A judge's two cells on one block. Null is unlabelled. */
export interface Cells {
  decision: boolean | null;
  action: boolean | null;
  model_version: string | null;
}

/**
 * Labels blocks against one brief's key items, one packet. Authoring's unanimous-key and give-away screens and the
 * scoring side call the same labeller, so every R2 and R3 label in the eval comes from one prompt. A null entry is a
 * block the judge left unlabelled after its one resend.
 */
export type Labeller = (req: {
  judge: JudgeKey;
  brief: string;
  items: KeyItems;
  blocks: ReadonlyArray<{ id: string; block: Block }>;
  effort: "medium" | "max";
  label: string;
}) => Promise<Map<string, Cells | null>>;

/** The block parser the session loop uses to decide whether a reply closed the session (score/ implements it). */
export type BlockParser = (replyText: string) => BlockParse;

/** One production label for one block: R2 (decision) and R3 (action). Null is unlabelled. */
export interface LabelRecord {
  block: string;
  brief: string;
  judge: JudgeKey;
  model_version: string | null;
  effort: "medium" | "max";
  decision: boolean | null;
  action: boolean | null;
}

type Bit = 0 | 1 | null;

/** Skill-session procedure reads (section 12's exposure, frozen; markers per pin frozen from stage 1). */
export interface Exposure {
  read_skill: boolean;
  interactive: boolean;
  /** Diagnostic or generative questions asked one at a time, each answered by a founder reply. */
  questions_one_at_a_time: number;
  wrote_deliverable: boolean;
  exposed: boolean;
}

/** Section 7's kept-whole parts for a builder session in a skill arm. */
export interface KeptWhole {
  builder_mode: boolean;
  /** Startup-only questions the detector found (the section 7 list); G1 confirms each by a hand read. */
  startup_only: string[];
  builder_doc_approved: boolean;
  before_cap: boolean;
  kept: boolean;
}

/** Section 11's compliance checks, reported, never scored. */
export interface Compliance {
  deliverable: "design" | "memo" | "other" | "none";
  action_with_date_and_number: boolean;
  kill_line: boolean;
  wrote_code: boolean;
  approved_on_disk: boolean;
  /** Pre-run change 1, item 4f, descriptive: a startup design doc carries a SUCCESS line. */
  success_line: boolean;
  /** Pre-run change 1, item 4f, descriptive: the new arm wrote a commitment entry; null outside new-arm founder sessions. */
  commitment: boolean | null;
}

/** One session after scoring: what the readings consume. A null bit is missing or unscored. */
export interface ScoredSession extends ManifestEntry {
  kind: BriefKind;
  cluster: string;
  set: SetName;
  traction: boolean;
  end: EndState;
  /** R1 found (mechanical), R2 decision and R3 action (judged), and R (all three). On builder briefs R is the builder right call. */
  R1: Bit;
  R2: Bit;
  R3: Bit;
  R: Bit;
  /** Skill arms only. */
  exposure: Exposure | null;
  /** Builder briefs in skill arms only. */
  kept_whole: KeptWhole | null;
  compliance: Compliance | null;
  /** Founder replies before the closing message (G3), and adviser questions asked (G2). */
  founder_replies: number;
  questions: number;
  usd: number;
  sim_usd: number;
}
