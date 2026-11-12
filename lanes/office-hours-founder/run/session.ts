// Copyright (c) 2026 Garry Tan. MIT License.
// One arm session of the office-hours founder eval (prereg sections 5, 6 and 8, start rule 5, and the Captain's AN-1
// ruling): the first user message, the founder loop the Claude Code driver calls after each reply, and the end state of
// each attempt and of the session under section 6's C1 rows and J1's one retry. Nothing here calls a model: the
// simulated founder comes in as an injected function, and the session's launch lives in run.ts.
//
// - The first message is frozen.ts firstMessage with the arm's first line, or FORCED_LINE on the office-hours arm once
//   smoke rule 4's forced repair is in force. The reference cell's is fullInformation with the sheet's facts in seeded
//   order and no ANSWER_NOW line.
// - After each reply the loop parses that reply's main-agent texts (parse.ts parseFirstMove). A block ends the session.
//   At the founder-reply limit the closing message goes instead of the simulator, and the reply to it ends the session,
//   block or no block. Otherwise the simulator's reply goes in as the next user message. The limit is 20 founder
//   replies, 30 under the limit repair, and 0 in the pitch-only and reference cells, so there the closing message is the
//   first and only founder message.
// - The simulator sees the visible transcript: one assistant line per reply (its texts joined by blank lines) and one
//   person line per founder reply, never tool calls, files or the arm. A check failure on a turn ends the session as
//   missing (E_OF_SIM_TURN); a refusal on the simulator's own allowance is missing (E_OF_INFRA_MISSING) with no retry; a
//   provider failure is an infrastructure failure that gets the session's one retry; a provider drift halts the run.
import { createHash } from "node:crypto";
import type { NextUser } from "../../../src/adapters/claude-code/driver.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import type { Termination } from "../../../src/types.ts";
import { shuffle } from "../../product-value/stats.ts";
import { CLOSING, FIRST_LINE, FORCED_LINE, FOUNDER_REPLIES, FOUNDER_REPLIES_REPAIRED, PITCH_FOUNDER_REPLIES, SEED, firstMessage, fullInformation } from "../frozen.ts";
import { parseFirstMove } from "../parse.ts";
import type { ArmId, EndState, FounderTurn, ManifestEntry, MoveParse, SessionKind, Sheet } from "../types.ts";

/** One line of the visible transcript the simulator reads. */
export interface Line {
  role: "assistant" | "person";
  text: string;
}

/** What the simulator area's founderTurn returns for one founder turn. */
export type FounderResult =
  | { kind: "reply"; reply: string; revealed: string[]; rules: number[]; attempts: number }
  | { kind: "check-failed"; checks: string[]; attempts: number }
  | { kind: "call-failed"; reason: "allowance" | "provider" | "drift"; detail: string };

/** The simulator area's interface: the person sheet, the visible transcript and the metered call it spends through. */
export type FounderTurnFn<S = PersonSheet, C = unknown> = (o: { sheet: S; transcript: Line[]; call: C }) => Promise<FounderResult>;

/** The sheet the simulator gets: sheet.json plus the opening message the founder already sent. */
export type PersonSheet = Sheet & { opening: string };

/** Repairs a session can run under, by name: smoke rule 4's forced sentence and its 30-reply limit, and the simulator prompt's one rule-wording repair (section 4), which the simulator applies. */
export const REPAIRS = ["forced-line", "limit-30", "sim-prompt"] as const;
export type Repair = (typeof REPAIRS)[number];

/** The founder-reply limit: 20, 30 under the limit repair, and 0 in the pitch-only and reference cells. */
export const founderLimit = (kind: SessionKind, repairs: readonly Repair[]): number =>
  kind !== "arm" ? PITCH_FOUNDER_REPLIES : repairs.includes("limit-30") ? FOUNDER_REPLIES_REPAIRED : FOUNDER_REPLIES;

/** The sheet's facts in the reference's seeded order: a shuffle seeded by SEED and the unit id, the same on every pass and model. */
export function factOrder(unit: string, sheet: Sheet): string[] {
  const seed = createHash("sha256").update(SEED + ":" + unit).digest().readUInt32BE(0);
  return shuffle(sheet.facts.map((f) => f.text), seededRandom(seed));
}

/** The session's first user message. */
export function firstUserMessage(entry: Pick<ManifestEntry, "kind" | "arm" | "unit">, opening: string, sheet: Sheet, repairs: readonly Repair[]): string {
  if (entry.kind === "reference") return fullInformation(opening, factOrder(entry.unit, sheet), false);
  return firstMessage(entry.arm === "office-hours" && repairs.includes("forced-line") ? FORCED_LINE : FIRST_LINE[entry.arm], opening);
}

/** The loop's record of one attempt, read after the driver returns. */
export interface LoopState {
  founder_turns: FounderTurn[];
  transcript: Line[];
  /** Assistant replies the loop saw, the closing reply included. */
  replies: number;
  closing_sent: boolean;
  /** The parse of the last reply the loop saw. */
  parse: MoveParse | null;
  ended: "block" | "closing" | null;
  sim: { code: ReasonCode; reason: "check" | "allowance" | "provider" | "drift"; detail: string } | null;
}

/** The driver's nextUser for one attempt, and the state it fills. */
export function founderLoop(limit: number, founder: (transcript: Line[]) => Promise<FounderResult>): { state: LoopState; nextUser: (texts: string[]) => Promise<NextUser> } {
  const state: LoopState = { founder_turns: [], transcript: [], replies: 0, closing_sent: false, parse: null, ended: null, sim: null };
  const nextUser = async (texts: string[]): Promise<NextUser> => {
    state.replies++;
    state.transcript.push({ role: "assistant", text: texts.join("\n\n") });
    state.parse = parseFirstMove(texts);
    if (state.parse.kind === "block") {
      state.ended = "block";
      return { end: true };
    }
    if (state.closing_sent) {
      state.ended = "closing";
      return { end: true };
    }
    if (state.founder_turns.length >= limit) {
      state.closing_sent = true;
      return { reply: CLOSING };
    }
    const r = await founder(state.transcript.map((l) => ({ ...l })));
    if (r.kind === "reply") {
      state.founder_turns.push({ turn: state.founder_turns.length + 1, reply: r.reply, revealed: r.revealed, rules: r.rules, attempts: r.attempts });
      state.transcript.push({ role: "person", text: r.reply });
      return { reply: r.reply };
    }
    state.sim = r.kind === "check-failed" ? { code: "E_OF_SIM_TURN", reason: "check", detail: r.checks.join("; ") } : { code: r.reason === "drift" ? "E_OF_PROVIDER_DRIFT" : "E_OF_INFRA_MISSING", reason: r.reason, detail: r.detail };
    return { stop: { kind: "missing", code: state.sim.code } };
  };
  return { state, nextUser };
}

/** What run.ts reads from one attempt after the driver returns. */
export interface AttemptRead {
  termination: Termination;
  loop: LoopState;
  /** Successful web tool results in the transcript, subagents included. */
  web: number;
  /** gstack files a none or lens session read; empty on the office-hours arm. */
  gstack_reads: string[];
  /** The containment probe's departures (a key name in the env, a mount, open egress); null when the probe could not run. */
  contained: string[] | null;
  /** An API error in the transcript says the context overflowed. */
  overflow: boolean;
  /** Metered spend on the arm's slot and on the simulator, in micro-dollars. */
  micros: number;
  sim_micros: number;
}

/** One attempt's outcome: a scored end, a retryable stop, a cap stop, or a halt for the Captain. */
export type Outcome =
  | { state: EndState; code: ReasonCode | null; why: string }
  | { state: "retry"; as: "arm-stop" | "infra"; why: string }
  | { state: "cap"; why: string }
  | { state: "halt"; code: ReasonCode; why: string };

const ARM_STOPS: Partial<Record<Termination["kind"], string>> = { turn_cap: "turn limit", timeout: "120 minutes", allowance_stop: "allowance" };

/** Section 6's C1 rows on one attempt. */
export function attemptOutcome(a: AttemptRead, arm: ArmId): Outcome {
  const t = a.termination;
  if (t.kind === "cap_stop") return { state: "cap", why: "the ledger item's cap stopped the session" };
  if (a.loop.sim?.reason === "drift") return { state: "halt", code: "E_OF_PROVIDER_DRIFT", why: "the simulator's provider drifted: " + a.loop.sim.detail };
  if (a.contained?.length) return { state: "halt", code: "E_OF_LEAK", why: "the containment probe found " + a.contained.join("; ") };
  if (t.kind === "credentials_rejected") return { state: "halt", code: "E_KEY_REJECTED", why: "the provider rejected the proxy's credentials" };
  if (t.kind === "missing" && t.code === "E_LEDGER_UNAVAILABLE") return { state: "missing", code: "E_OF_INFRA_MISSING", why: "the ledger never admitted the session" };
  if (a.loop.sim?.reason === "allowance") return { state: "missing", code: "E_OF_INFRA_MISSING", why: "the proxy refused a simulator call on the simulator's allowance: " + a.loop.sim.detail };
  if (a.loop.sim?.reason === "check") return { state: "missing", code: "E_OF_SIM_TURN", why: "the simulator failed its per-turn checks twice: " + a.loop.sim.detail };
  if (a.web > 0) return { state: "contaminated", code: "E_OF_WEB_CONTAMINATED", why: a.web + " successful web tool result" + (a.web === 1 ? "" : "s") };
  if (arm !== "office-hours" && a.gstack_reads.length) return { state: "gstack-read", code: "E_OF_GSTACK_READ", why: "read " + a.gstack_reads.join(", ") };
  if (a.contained === null) return { state: "retry", as: "infra", why: "the containment probe could not run" };
  if (a.loop.ended === "block") return { state: "block", code: null, why: "a first-move block in reply " + a.loop.replies };
  if (a.loop.ended === "closing") return { state: "no-block", code: "E_OF_NO_BLOCK", why: "the reply to the closing message holds no block: " + (a.loop.parse?.kind === "no-block" ? a.loop.parse.reason : "") };
  if (a.loop.sim?.reason === "provider") return { state: "retry", as: "infra", why: "a simulator provider failure: " + a.loop.sim.detail };
  const stop = ARM_STOPS[t.kind] ?? (a.overflow ? "context overflow" : null);
  if (stop) return { state: "retry", as: "arm-stop", why: "the arm's own stop: " + stop };
  return { state: "retry", as: "infra", why: "an infrastructure failure: " + t.kind + ("code" in t ? " " + t.code : "incident" in t ? " " + t.incident : "") };
}

/** J1's one retry in all: a retryable outcome on the first attempt retries; on the retry an arm stop scores 0 and an infrastructure failure is missing. */
export function settle(o: Outcome, attempt: number): Outcome {
  if (o.state !== "retry" || attempt < 2) return o;
  return o.as === "arm-stop" ? { state: "arm-stop", code: "E_OF_ARM_STOP", why: o.why + ", on the retry" } : { state: "missing", code: "E_OF_INFRA_MISSING", why: o.why + ", on the retry" };
}
