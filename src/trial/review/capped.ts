// The cap-stop read rule for review units (GSTA-2's ruling for R2). A code session that the turn cap or the slot's
// allowance ended (turn_cap, allowance_stop) is scored on what its main agent wrote before the stop: its findings are those
// of the latest main-agent text block whose last json block parses as findings (findings.ts's final-turn parser), and with
// no such block it is missing, scored as finding nothing. The text comes from the session's transcript.ndjson, never from
// the record's turns, which also hold each AskUserQuestion's question with nothing marking it; a missing or unreadable
// transcript leaves no text, so the session is missing. A run with cap stops adds CAPPED_PARSER_SHA256 to the session
// key's verifier, so a change to this rule invalidates its cached sessions, and arm.json records it in cap_stops.
//
// Plan units read stops the same way (panel v3 plan, section 5). A plan session that the turn cap or the allowance ended,
// in either turn, or that timed out after model output, is scored on the latest main-agent text block whose last
// plan-findings block parses as findings (cappedPlanParse); with no such block it is missing, scored as finding nothing.
// Every plan session key's verifier covers this file.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fencedBlocks, parseFinalTurn, type ParseOutcome } from "./findings.ts";
import { PLAN_FENCE, parsePlanBlock, type PlanParse } from "./plan.ts";
import { readTranscript } from "./readers.ts";

/** sha256 of this file: part of the session key's verifier in a run with cap stops. */
export const CAPPED_PARSER_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");

/** The main agent's own non-empty text blocks in a transcript.ndjson, in order: no subagent text, API error or AskUserQuestion. */
export const mainAgentTexts = (transcript: string): string[] =>
  readTranscript(transcript).flatMap((m) => (m.type === "assistant" && !m.parent_tool_use_id && !m.error && !m.is_api_error_message && Array.isArray(m.message?.content) ? m.message.content : []).filter((b: { type?: unknown; text?: unknown }) => b?.type === "text" && typeof b.text === "string" && b.text.trim()).map((b: { text: string }) => b.text));

/** A cap-stopped code session's parse: the latest main-agent text whose last json block parses as findings, else missing. */
export const cappedParse = (turns: readonly string[]): ParseOutcome => turns.map(parseFinalTurn).findLast((p) => p.kind === "findings") ?? { kind: "missing" };

/** A stopped plan session's parse: the latest main-agent text whose last plan-findings block parses as findings, else missing. */
export const cappedPlanParse = (texts: readonly string[]): PlanParse =>
  texts.map((t): PlanParse => {
    const block = fencedBlocks(t).filter((b) => b.info.toLowerCase() === PLAN_FENCE).at(-1);
    return block ? parsePlanBlock(block.body) : { kind: "missing" };
  }).findLast((p) => p.kind === "findings") ?? { kind: "missing" };
