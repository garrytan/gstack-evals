// The held-session read rule (GSTA-2's A1 ruling on #141, GST-734). review-units holds a Claude Code session open while
// background work its main agent started is out, and the CLI takes a turn of its own when that work lands, so a session
// that waited can end on a turn written after its report ("my findings above stand"), which findings.ts's final-turn
// parse would score as finding nothing. A completed code session whose session_end shows it waited (waited_ms > 0) and
// whose final turn has no json block at all is therefore scored from the latest main-agent text whose last json block
// parses as findings (findings.ts's final-turn parser, the rule capped.ts applies to cap stops), read from its
// transcript.ndjson; with no such text it keeps the final-turn parse. A malformed final block stays malformed, waited or
// not (GSTA-2's round-2 narrowing). A session that never waited is scored on its final turn exactly as before, and a cap-stopped one by
// capped.ts. Every code session records the turn it was scored from (scored_turn), and review-units adds
// HELD_PARSER_SHA256 to the session key's verifier, so a change to this rule invalidates cached sessions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SessionEnd, Termination } from "../../types.ts";
import { cappedParse } from "./capped.ts";
import { parseFinalTurn, parseFindings, type ParseOutcome } from "./findings.ts";

/** sha256 of this file: part of the session key's verifier for code units. */
export const HELD_PARSER_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");

/** The turn a code session was scored from. */
export interface ScoredTurn {
  /** final: record.turns' last turn (findings.ts); held: this file's rule; capped: capped.ts's rule. */
  rule: "final" | "held" | "capped";
  /** 0-based, into record.turns for final and into the transcript's main-agent texts otherwise; null when no turn was scored. */
  index: number | null;
  /** How many turns (final) or main-agent texts (held, capped) the session had. */
  of: number;
}

/** Whether any main-agent text's last json block parses as findings. */
export const hasFindingsBlock = (texts: readonly string[]): boolean => texts.some((t) => parseFinalTurn(t).kind === "findings");

/** A code session's parse and the turn it was scored from; texts are its transcript's main-agent texts (capped.ts's mainAgentTexts). */
export function codeParse(record: { termination: Termination; turns: readonly string[]; session_end?: SessionEnd }, texts: readonly string[]): { parse: ParseOutcome; scored_turn: ScoredTurn } {
  const kind = record.termination.kind;
  const latest = texts.map(parseFinalTurn).findLastIndex((p) => p.kind === "findings");
  if (kind === "turn_cap" || kind === "allowance_stop") return { parse: cappedParse(texts), scored_turn: { rule: "capped", index: latest < 0 ? null : latest, of: texts.length } };
  const final = parseFindings(record);
  if (kind === "completed" && (record.session_end?.waited_ms ?? 0) > 0 && final.kind === "missing" && latest >= 0) return { parse: parseFinalTurn(texts[latest]!), scored_turn: { rule: "held", index: latest, of: texts.length } };
  return { parse: final, scored_turn: { rule: "final", index: kind === "completed" && record.turns.length ? record.turns.length - 1 : null, of: record.turns.length } };
}
