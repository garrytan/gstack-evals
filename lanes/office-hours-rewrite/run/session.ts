// Copyright (c) 2026 Garry Tan. MIT License.
// One arm session of the office-hours rewrite eval (prereg sections 4 and 8; pre-run change 1, items 4b and 4c): the
// first message, the closing loop the Claude Code driver calls after each reply, and the end state of each attempt and of
// the session under section 8's failure table with one retry. Nothing here calls a model: the simulator comes in as an
// injected turn (sim/founder.ts simTurn), the block parser as an injected BlockParser (score/), and the launch lives in
// run.ts.
//
// - The first message is frozen.firstMessage(arm, opening). No reply ends the session before a closing message.
// - After each adviser reply the simulator takes its turn and its reply goes in as the next user message. When the
//   simulator sets done, frozen.CLOSING goes instead of that reply, which is logged as not delivered. After the 20th
//   delivered founder reply, frozen.CLOSING goes instead of the simulator. The reply to a closing message is parsed;
//   with no block, frozen.CLOSING goes once more (frozen.CLOSING_SENDS), and a second miss ends the session no-block.
// - Every founder turn is recorded with its delivered and done flags, and the draws the simulator's checks rejected
//   ride on it apart (rejected_draws, a guard failure listed as the check "guard"). Only delivered replies count toward
//   the 20-reply cap, and every delivered reply comes before the first closing message.
// - A reveal-guard failure, a check failure and a simulator call that fails on its allowance or at the provider stop
//   the attempt as a simulator failure; a cap refusal is a cap stop; a provider drift halts the launch.
// - A provider safety stop is read from the transcript (safetyStop): a main-agent assistant message whose stop_reason
//   is refusal (Anthropic, and Claude Code's own error frame for it) or content_filter (OpenRouter's finish reason, if
//   its Anthropic route passes it through), or Claude Code's model_refusal_no_fallback or model_refusal_fallback
//   notice. The loop checks it before every simulator turn, and the attempt's outcome checks it before any upstream
//   reading, since Claude Code's error frame for a refusal otherwise reads as UPSTREAM.
// - Pre-run change 4: an assistant message that names a model other than the session's pin (pinned.ts offPin) halts the
//   launch (E_OHR_MODEL_DRIFT), and the session reads missing, so it is never counted; so does a simulator reply that
//   names another model than Argon. No provider signal in this
//   harness marks a reply as a refusal apart from these, so the build never writes the end state refusal; a model that
//   declines in prose reads no-block, or fails R2 at judging.
import type { NextUser } from "../../../src/adapters/claude-code/driver.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { readTranscript } from "../../../src/trial/review/readers.ts";
import type { Termination } from "../../../src/types.ts";
import { CLOSING, CLOSING_SENDS, FOUNDER_REPLIES, firstMessage } from "../frozen.ts";
import type { SimOutcome } from "../sim/founder.ts";
import type { ArmId, BlockParse, BlockParser, EndState, Turn } from "../types.ts";

export { firstMessage };

/** One line of the visible transcript the simulator reads. */
export interface Line {
  role: "assistant" | "person";
  text: string;
}

/** The loop's record of one attempt, read after the driver returns. */
export interface LoopState {
  founder_turns: Turn[];
  transcript: Line[];
  /** Assistant replies the loop saw, the closing replies included. */
  replies: number;
  closings: number;
  founder_done: boolean;
  /** The parse of the last reply to a closing message. */
  parse: BlockParse | null;
  ended: "block" | "no-block" | null;
  sim: { code: ReasonCode; reason: "guard" | "check" | "allowance" | "provider" | "drift" | "cap"; detail: string } | null;
  /** The simulator turn that failed, with its rejected draws, kept apart from the founder turns. */
  failed_turn: { outcome: SimOutcome["kind"]; rejected_draws: Turn["rejected_draws"] } | null;
  guard_failures: number;
  /** The safety stop the loop saw in the transcript before a simulator turn. */
  safety: string | null;
}

const draws = (o: SimOutcome): Turn["rejected_draws"] => o.rejected.map((d) => ({ revealed: d.revealed ?? [], checks: [...d.checks, ...(d.guard ? ["guard"] : [])] }));

/** The delivered founder replies so far. */
export const delivered = (s: Pick<LoopState, "founder_turns">): number => s.founder_turns.filter((t) => t.delivered).length;

/** The driver's nextUser for one attempt, and the state it fills. */
export function closingLoop(o: { parse: BlockParser; founder: (transcript: Line[]) => Promise<SimOutcome>; safety?: () => string | null }): { state: LoopState; nextUser: (texts: string[]) => Promise<NextUser> } {
  const state: LoopState = { founder_turns: [], transcript: [], replies: 0, closings: 0, founder_done: false, parse: null, ended: null, sim: null, failed_turn: null, guard_failures: 0, safety: null };
  const closing = (): NextUser => {
    state.closings++;
    return { reply: CLOSING };
  };
  const nextUser = async (texts: string[]): Promise<NextUser> => {
    state.replies++;
    const text = texts.join("\n\n");
    state.transcript.push({ role: "assistant", text });
    if (state.closings > 0) {
      state.parse = o.parse(text);
      if (state.parse.kind === "block") {
        state.ended = "block";
        return { end: true };
      }
      if (state.closings < CLOSING_SENDS) return closing();
      state.ended = "no-block";
      return { end: true };
    }
    if (delivered(state) >= FOUNDER_REPLIES) return closing();
    const safety = o.safety?.() ?? null;
    if (safety) {
      state.safety = safety;
      return { stop: { kind: "missing", code: "E_OHR_SAFETY_STOP" } };
    }
    const r = await o.founder(state.transcript.map((l) => ({ ...l })));
    if (r.kind === "reply") {
      state.founder_turns.push({ turn: state.founder_turns.length + 1, reply: r.reply, revealed: r.revealed, rules: r.rules, attempts: r.attempts, delivered: !r.done, done: r.done, rejected_draws: draws(r) });
      if (r.done) {
        state.founder_done = true;
        return closing();
      }
      state.transcript.push({ role: "person", text: r.reply });
      return { reply: r.reply };
    }
    state.failed_turn = { outcome: r.kind, rejected_draws: draws(r) };
    if (r.kind === "guard-failed") state.guard_failures++;
    state.sim =
      r.kind === "guard-failed" ? { code: "E_OHR_SIM_GUARD", reason: "guard", detail: "more than two revealed ids on all " + r.attempts + " calls" }
      : r.kind === "check-failed" ? { code: "E_OHR_SIM_CHECK", reason: "check", detail: r.checks.join("; ") }
      : { code: r.reason === "drift" ? (r.detail.startsWith("E_OHR_MODEL_DRIFT") ? "E_OHR_MODEL_DRIFT" : "E_OF_PROVIDER_DRIFT") : r.reason === "cap" ? "CAP_STOP" : "E_OHR_SIM_CALL", reason: r.reason, detail: r.detail };
    return { stop: state.sim.reason === "cap" ? { kind: "cap_stop" } : { kind: "missing", code: state.sim.code } };
  };
  return { state, nextUser };
}

const SAFETY_STOPS = new Set(["refusal", "content_filter"]);
const SAFETY_NOTICES = new Set(["model_refusal_no_fallback", "model_refusal_fallback"]);

/** The first provider safety stop in a transcript, as a short line, or null. */
export function safetyStop(transcript: string): string | null {
  for (const m of readTranscript(transcript) as Record<string, any>[]) {
    if (m.type === "system" && SAFETY_NOTICES.has(m.subtype)) return "Claude Code's " + m.subtype + " notice" + (m.api_refusal_category ? " (" + m.api_refusal_category + ")" : "");
    if (m.type === "assistant" && !m.parent_tool_use_id && SAFETY_STOPS.has(m.message?.stop_reason)) return "a main-agent reply with stop_reason " + m.message.stop_reason + (m.message?.stop_details?.category ? " (" + m.message.stop_details.category + ")" : "");
  }
  return null;
}

/** The SESSION_KIND value the skill's start step printed at load (pre-run change 5; read/load.ts startOutput), else the first main-agent tool result's, or null. */
export function sessionKindOf(transcript: string, start: string | null = null): string | null {
  const atLoad = start === null ? null : /SESSION_KIND: ([A-Za-z0-9._-]+)/.exec(start);
  if (atLoad) return atLoad[1]!;
  for (const m of readTranscript(transcript) as Record<string, any>[]) {
    if (m.type !== "user" || m.parent_tool_use_id || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message.content) {
      if (b?.type !== "tool_result") continue;
      const hit = /SESSION_KIND: ([A-Za-z0-9._-]+)/.exec(typeof b.content === "string" ? b.content : JSON.stringify(b.content));
      if (hit) return hit[1]!;
    }
  }
  return null;
}

/** What run.ts reads from one attempt after the driver returns. */
export interface AttemptRead {
  termination: Termination;
  loop: LoopState;
  /** gstack files a none-arm session read; empty on the skill arms. */
  gstack_reads: string[];
  /** The containment probe's departures (env names, ARM_ENV_UNSET names, mounts, egress); null when it could not run. */
  contained: string[] | null;
  /** A skill container's own pin check: its mismatches, [] when it matched or on the none arm, null when it could not run. */
  pin: string[] | null;
  overflow: boolean;
  safety: string | null;
  session_kind: string | null;
  /** Models the session's assistant messages name that are not its pin (pinned.ts offPin); any one halts the launch. */
  off_pin: string[];
  /** The models the session's replies report (pinned.ts servedModel): Claude Code's transcript, or the tap for Sol. */
  served_model: string | null;
  /** The CLI version the session's transcript names (pinned.ts cliVersion). */
  cli_version: string | null;
  micros: number;
  sim_micros: number;
  /** Pre-run change 5, F1 on a Sol attempt (run/home-watch.ts): every flag on trusting its rollout; null or absent on Claude Code. */
  rollout_flags?: string[] | null;
  /** Pre-run change 5, G1 on a Sol attempt: every turn whose turn_context did not record collaboration mode default. */
  non_default_turns?: string[] | null;
  /** The adapter could not read the Sol session's rollout after a turn, or the rollout was not copied out. */
  rollout_unreadable?: boolean;
}

export type Outcome =
  | { state: EndState; code: ReasonCode | null; why: string }
  | { state: "retry"; as: "arm-stop" | "infra" | "sim"; code: ReasonCode; why: string }
  | { state: "cap"; why: string }
  | { state: "halt"; code: ReasonCode; why: string };

const ARM_STOPS: Partial<Record<Termination["kind"], string>> = { turn_cap: "60 agent turns in one reply", timeout: "120 minutes", allowance_stop: "the session allowance" };

/** Section 8's failure table on one attempt. */
export function attemptOutcome(a: AttemptRead, arm: ArmId): Outcome {
  const t = a.termination;
  const sim = a.loop.sim;
  if (t.kind === "cap_stop") return { state: "cap", why: "the ledger item's cap stopped the session" };
  if (sim?.reason === "cap") return { state: "cap", why: "the ledger item's cap refused a simulator call: " + sim.detail };
  if (sim?.reason === "drift") return { state: "halt", code: sim.code, why: "the simulator drifted from its pin: " + sim.detail };
  if (a.off_pin.length) return { state: "halt", code: "E_OHR_MODEL_DRIFT", why: "the arm's replies name another model than its pin: " + a.off_pin.join(", ") };
  if (a.pin?.length) return { state: "halt", code: "E_OHR_PIN_MISMATCH", why: "the container's gstack tree is not the " + arm + " pin: " + a.pin.join("; ") };
  if (a.contained?.length) return { state: "halt", code: "E_OF_LEAK", why: "the containment probe found " + a.contained.join("; ") };
  if (t.kind === "credentials_rejected") return { state: "halt", code: "E_KEY_REJECTED", why: "the provider rejected the proxy's credentials" };
  const safety = a.safety ?? a.loop.safety;
  if (safety) return { state: "safety-stop", code: "E_OHR_SAFETY_STOP", why: "a provider safety stop: " + safety };
  if (arm === "none" && a.gstack_reads.length) return { state: "contaminated", code: "E_OHR_GSTACK_READ", why: "the none arm read " + a.gstack_reads.join(", ") };
  if (t.kind === "missing" && t.code === "E_LEDGER_UNAVAILABLE") return { state: "missing", code: "E_OHR_INFRA_MISSING", why: "the ledger never admitted the session" };
  if (a.rollout_unreadable) return { state: "retry", as: "infra", code: "E_OHR_ROLLOUT_UNREADABLE", why: "Codex's rollout of the session could not be read or copied out" };
  if (arm !== "none" && a.session_kind !== null && a.session_kind !== "interactive") return { state: "retry", as: "infra", code: "E_OHR_SESSION_KIND", why: "the skill printed SESSION_KIND: " + a.session_kind };
  if (a.contained === null || (arm !== "none" && a.pin === null)) return { state: "retry", as: "infra", code: "E_OHR_INFRA_MISSING", why: "the containment probe or the container's pin check could not run" };
  if (a.loop.ended === "block") return { state: "block", code: null, why: "a block in reply " + a.loop.replies + " after " + a.loop.closings + " closing message" + (a.loop.closings === 1 ? "" : "s") };
  if (a.loop.ended === "no-block") return { state: "no-block", code: "E_OHR_NO_BLOCK", why: "no block after " + CLOSING_SENDS + " closing messages: " + (a.loop.parse?.kind === "no-block" ? a.loop.parse.reason : "") };
  if (sim) return { state: "retry", as: "sim", code: sim.code, why: "a simulator failure: " + sim.detail };
  const stop = ARM_STOPS[t.kind] ?? (a.overflow ? "the context window" : null);
  if (stop) return { state: "retry", as: "arm-stop", code: "E_OHR_ARM_STOP", why: "the arm's own stop: " + stop };
  return { state: "retry", as: "infra", code: "E_OHR_INFRA_MISSING", why: "an upstream or harness failure: " + t.kind + ("code" in t ? " " + t.code : "incident" in t ? " " + t.incident : "") };
}

/** The one retry: a retryable outcome on the first attempt retries; on the retry an arm stop reads no-block (R = 0) and every other failure is missing. */
export function settle(o: Outcome, attempt: number): Outcome {
  if (o.state !== "retry" || attempt < 2) return o;
  return o.as === "arm-stop" ? { state: "no-block", code: "E_OHR_ARM_STOP", why: o.why + ", on the retry" } : { state: "missing", code: o.code, why: o.why + ", on the retry" };
}
