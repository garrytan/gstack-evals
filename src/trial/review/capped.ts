// The cap-stop read rule for review units (GSTA-2's ruling for R2). A code session that the turn cap or the slot's
// allowance ended (turn_cap, allowance_stop) is scored on what its main agent wrote before the stop: its findings are those
// of the latest main-agent text turn whose last json block parses as findings (findings.ts's final-turn parser), and with
// no such turn it is missing, scored as finding nothing. A run with cap stops adds CAPPED_PARSER_SHA256 to the session
// key's verifier, so a change to this rule invalidates its cached sessions, and arm.json records it in cap_stops.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFinalTurn, type ParseOutcome } from "./findings.ts";

/** sha256 of this file: part of the session key's verifier in a run with cap stops. */
export const CAPPED_PARSER_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");

/** A cap-stopped code session's parse: the latest main-agent text turn whose last json block parses as findings, else missing. */
export const cappedParse = (turns: readonly string[]): ParseOutcome => turns.map(parseFinalTurn).findLast((p) => p.kind === "findings") ?? { kind: "missing" };
