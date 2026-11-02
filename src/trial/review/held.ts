// The held-session read rule (GSTA-2's A1 ruling on #141, GST-734). review-units holds a Claude Code session open while
// background work its main agent started is out, and the CLI takes a turn of its own when that work lands, so a session
// that waited can end on a turn written after its report ("my findings above stand"), which findings.ts's final-turn
// parse would score as finding nothing. A completed code session whose session_end shows it waited (waited_ms > 0) and
// whose final turn has no json block at all is therefore scored from the latest main-agent text whose last json block is
// an array, its body starting with [ after whitespace (findings.ts's final-turn parser, read from its transcript.ndjson),
// when that text sits in an earlier CLI turn than the final text, turns split at result events; a malformed array there
// stays malformed (GSTA-2's Step 11 ruling). The held search reads only array blocks, the attempted findings blocks, so a
// json object an earlier turn wrote, such as a plan, is ignored (GSTA-2's ruling B). A block and a closing line in the
// same final turn score exactly as on main, waited or not, and so does a session that never waited.
// A malformed final block stays malformed, waited or not (GSTA-2's round-2 narrowing), and a cap-stopped session is scored
// by capped.ts. Every code session records the turn it was scored from (scored_turn), arm.json counts held reads that
// parse as findings (held_rescues), and review-units adds HELD_PARSER_SHA256 to the session key's verifier, so a
// change to this rule invalidates cached sessions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SessionEnd, Termination } from "../../types.ts";
import { cappedParse, mainAgentTexts } from "./capped.ts";
import { fencedBlocks, parseFinalTurn, parseFindings, type ParseOutcome } from "./findings.ts";
import { readTranscript } from "./readers.ts";

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

/** Each main-agent text's CLI turn, in mainAgentTexts' order: how many result events came before it in the transcript. */
export function mainAgentTurns(transcript: string): number[] {
  const turns: number[] = [];
  let turn = 0;
  for (const line of transcript.split("\n")) {
    for (const _ of mainAgentTexts(line)) turns.push(turn);
    if (readTranscript(line)[0]?.type === "result") turn++;
  }
  return turns;
}

/** A code session's parse and the turn it was scored from; texts are its transcript's main-agent texts (capped.ts's mainAgentTexts) and turns each text's CLI turn (mainAgentTurns). */
export function codeParse(record: { termination: Termination; turns: readonly string[]; session_end?: SessionEnd }, texts: readonly string[], turns: readonly number[]): { parse: ParseOutcome; scored_turn: ScoredTurn } {
  const kind = record.termination.kind;
  const parses = texts.map(parseFinalTurn);
  const latest = parses.findLastIndex((p) => p.kind === "findings");
  if (kind === "turn_cap" || kind === "allowance_stop") return { parse: cappedParse(texts), scored_turn: { rule: "capped", index: latest < 0 ? null : latest, of: texts.length } };
  const final = parseFindings(record);
  const block = texts.findLastIndex((t) => fencedBlocks(t).filter((b) => b.info.toLowerCase() === "json").at(-1)?.body.trimStart().startsWith("[") === true);
  if (kind === "completed" && (record.session_end?.waited_ms ?? 0) > 0 && final.kind === "missing" && block >= 0 && turns[block]! < turns.at(-1)!) return { parse: parses[block]!, scored_turn: { rule: "held", index: block, of: texts.length } };
  return { parse: final, scored_turn: { rule: "final", index: kind === "completed" && record.turns.length ? record.turns.length - 1 : null, of: record.turns.length } };
}
