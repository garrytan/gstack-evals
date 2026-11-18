// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's session rows (prereg section 8; pre-run change 1, item 4c): one line in
// <out>/rows.ndjson per session the launch ran to an end, each a types.ts SessionRow with every attempt's outcome and the
// failed simulator turns beside it. The row's founder turns are the scored attempt's, each with its delivered flag and
// its rejected draws; guard failures are summed over both attempts; dollars are summed over both attempts. A session a
// cap stop left unrun has no row: stops.json lists it, and ohr score sessions scores it missing (E_OHR_UNRUN). The
// founder lane's ndjson reader handles a torn last line.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ndjson } from "../../office-hours-founder/run/rows.ts";
import { ARMS, CLOSING_SENDS, FOUNDER_REPLIES, MODELS } from "../frozen.ts";
import type { EndState, ManifestEntry, SessionRow } from "../types.ts";
import { entryId, readManifest, type LaunchName, type Manifest } from "./manifest.ts";
import type { AttemptRead, LoopState, Outcome } from "./session.ts";

export { ndjson };

export interface RowLine {
  id: string;
  launch: LaunchName;
  row: SessionRow;
  why: string;
  /** Every attempt's outcome, dollars, containment departures and failed simulator turn. */
  attempts: { attempt: number; outcome: Outcome["state"]; code: string | null; why: string; usd: number; sim_usd: number; contained: string[] | null; failed_turn: LoopState["failed_turn"] }[];
}

export const END_STATES: readonly EndState[] = ["block", "no-block", "safety-stop", "refusal", "missing", "contaminated"];

/** The row of a session that ended: the scored attempt is the last. */
export function sessionRow(o: { entry: ManifestEntry; end: { state: EndState; code: string | null }; attempts: readonly AttemptRead[]; transcript: string | null; state_root: string | null }): SessionRow {
  const scored = o.attempts.at(-1)!;
  const sum = (f: (a: AttemptRead) => number) => o.attempts.reduce((s, a) => s + f(a), 0) / 1_000_000;
  const parse = scored.loop.parse;
  return {
    ...o.entry, end: o.end.state, code: o.end.code,
    block: (o.end.state === "block" && parse?.kind === "block") || (o.end.state === "no-block" && parse?.kind === "no-block") ? parse : null,
    founder_turns: scored.loop.founder_turns, closings: scored.loop.closings, founder_done: scored.loop.founder_done, replies: scored.loop.replies,
    session_kind: scored.session_kind, guard_failures: o.attempts.reduce((s, a) => s + a.loop.guard_failures, 0), gstack_reads: scored.gstack_reads,
    usd: sum((a) => a.micros), sim_usd: sum((a) => a.sim_micros), attempts: o.attempts.length, transcript: o.transcript, state_root: o.state_root,
  };
}

/** Why a row line does not hold together, one line per problem. */
export function rowProblems(l: RowLine): string[] {
  const r = l.row;
  const p: string[] = [];
  if (!END_STATES.includes(r.end)) p.push("end " + JSON.stringify(r.end) + " is no section 8 end state");
  if ((r.end === "block") !== (r.block?.kind === "block")) p.push("a block row needs a block, and only a block row has one");
  if ((r.end === "block") !== (r.code === null)) p.push("every end but block names its code");
  if (!MODELS.includes(r.model) || !ARMS.includes(r.arm)) p.push("model " + r.model + " or arm " + r.arm + " is not one the prereg names");
  if (r.attempts !== 1 && r.attempts !== 2) p.push(r.attempts + " attempts, and a session gets at most one retry");
  if (r.attempts !== l.attempts.length) p.push("attempts " + r.attempts + " but " + l.attempts.length + " attempt records");
  if (r.founder_turns.some((t, i) => t.turn !== i + 1)) p.push("founder turns are not numbered 1 to " + r.founder_turns.length);
  if (r.founder_turns.filter((t) => t.delivered).length > FOUNDER_REPLIES) p.push("more than " + FOUNDER_REPLIES + " delivered founder replies");
  if (r.founder_turns.some((t, i) => !t.delivered && (i !== r.founder_turns.length - 1 || !t.done))) p.push("only a last turn that set done may go undelivered");
  if (r.founder_done !== (r.founder_turns.at(-1)?.done === true)) p.push("founder_done does not match the last founder turn");
  if (r.closings < 0 || r.closings > CLOSING_SENDS) p.push(r.closings + " closing messages, and at most " + CLOSING_SENDS + " go");
  if ((r.end === "block" || r.end === "no-block") && r.code !== "E_OHR_ARM_STOP" && r.closings === 0) p.push("a scored block or no-block needs a closing message");
  if (r.arm === "none" && r.end !== "contaminated" && r.gstack_reads.length) p.push("a none-arm row with gstack reads must read contaminated");
  if (entryId(r) !== l.id) p.push("id " + l.id + " does not name the row's session " + entryId(r));
  return p;
}

/** The launch's rows, by session id; the last line for an id wins. A torn last line goes to onTorn, and without it fails. */
export function readRows(out: string, onTorn?: (torn: { text: string; at: number }) => void): Map<string, RowLine> {
  const file = join(out, "rows.ndjson");
  const rows = new Map<string, RowLine>();
  if (!existsSync(file)) return rows;
  const { lines, torn } = ndjson<RowLine>(readFileSync(file, "utf8"), file);
  if (torn && !onTorn) throw new Error("E_USAGE " + file + "'s last line is torn; resume the launch, which drops and records it");
  if (torn) onTorn!(torn);
  for (const line of lines) rows.set(line.id, line);
  return rows;
}

/** A session the frozen manifest schedules and the launch never ran: missing (E_OHR_UNRUN), with nothing logged. */
export const unrunRow = (e: ManifestEntry): SessionRow => ({ ...e, end: "missing", code: "E_OHR_UNRUN", block: null, founder_turns: [], closings: 0, founder_done: false, replies: 0, session_kind: null, guard_failures: 0, gstack_reads: [], usd: 0, sim_usd: 0, attempts: 0, transcript: null, state_root: null });

/** Every session a launch's frozen manifest schedules, in its order: the session's row, or an unrun row. A row the manifest does not schedule is refused. */
export function scheduledRows(out: string): SessionRow[] {
  const rows = readRows(out);
  const entries = readManifest(join(out, "manifest.json")).entries;
  const scheduled = new Set(entries.map(entryId));
  const extra = [...rows.keys()].filter((id) => !scheduled.has(id));
  if (extra.length) throw new Error("E_OHR_SCORE_INPUT " + out + " holds rows its frozen manifest does not schedule: " + extra.join(", "));
  return entries.map((e) => rows.get(entryId(e))?.row ?? unrunRow(e));
}

/** The rows command's report: every problem, the end-state counts per model and arm, and the manifest's sessions with no row. */
export function rowsReport(manifest: Manifest, rows: ReadonlyMap<string, RowLine>): { problems: string[]; counts: Record<string, Record<string, number>>; unrun: string[] } {
  const problems = [...rows.values()].flatMap((l) => rowProblems(l).map((p) => l.id + ": " + p));
  const scheduled = new Set(manifest.entries.map(entryId));
  for (const id of rows.keys()) if (!scheduled.has(id)) problems.push(id + ": not in the frozen manifest");
  const counts: Record<string, Record<string, number>> = {};
  for (const l of rows.values()) {
    const k = l.row.model + " " + l.row.arm;
    counts[k] = { ...counts[k], [l.row.end]: (counts[k]?.[l.row.end] ?? 0) + 1 };
  }
  return { problems, counts, unrun: [...scheduled].filter((id) => !rows.has(id)) };
}
