// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's session rows: one line in <out>/rows.ndjson per session the launch ran to an end, each
// a types.ts SessionRow with the transcript and state-root paths beside it and every attempt's outcome. The run side
// fills the end state, its code, the block, the founder turns, the closing flag, the reply count, the web and gstack-read
// audits, metered dollars (both attempts summed) and the repairs in force. Exposure and the mechanical counters
// (questions, pushes, the first recommending reply, the named source) stay null for the scoring area, so the run writes
// them through RunSessionRow, which widens those fields to null. A session a cap stop left unrun has no row: the launch's
// stops.json lists it, and the manifest counts it as unrun.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ARMS, MODELS } from "../frozen.ts";
import { normalizeBlock } from "../parse.ts";
import type { EndState, ManifestEntry, SessionRow } from "../types.ts";
import { entryId, type Cell, type Manifest } from "./manifest.ts";
import type { AttemptRead, Outcome, Repair } from "./session.ts";

/** SessionRow with the fields the scoring area fills left null. */
export type RunSessionRow = Omit<SessionRow, "questions" | "pushes" | "named_source"> & { questions: number | null; pushes: number | null; named_source: boolean | null };

export interface RowLine {
  id: string;
  cell: Cell;
  row: RunSessionRow;
  /** Why the session ended as it did. */
  why: string;
  /** The scored attempt's transcript and the office-hours arm's copied state root. */
  transcript: string | null;
  state_root: string | null;
  attempts: { attempt: number; outcome: Outcome["state"]; why: string; usd: number; sim_usd: number }[];
}

export const END_STATES: readonly EndState[] = ["block", "no-block", "arm-stop", "missing", "contaminated", "gstack-read"];

/** The row of a session that ended: the scored attempt is the last. */
export function sessionRow(o: { entry: ManifestEntry; end: { state: EndState; code: string | null }; attempts: readonly AttemptRead[]; repairs: readonly Repair[] }): RunSessionRow {
  const scored = o.attempts.at(-1)!;
  const parse = scored.loop.parse;
  const block = o.end.state === "block" && parse?.kind === "block" ? parse : null;
  const sum = (f: (a: AttemptRead) => number) => o.attempts.reduce((s, a) => s + f(a), 0) / 1_000_000;
  return {
    ...o.entry, end: o.end.state, code: o.end.code, block: block ? normalizeBlock(block.block) : null, lenient: block ? block.lenient : null,
    founder_turns: scored.loop.founder_turns, closing_sent: scored.loop.closing_sent, replies: scored.loop.replies,
    exposure: null, questions: null, pushes: null, first_recommendation_reply: null, web: scored.web, gstack_reads: scored.gstack_reads, named_source: null,
    usd: sum((a) => a.micros), sim_usd: sum((a) => a.sim_micros), attempts: o.attempts.length, repairs: [...o.repairs],
  };
}

/** Why a row line does not hold together, one line per problem. */
export function rowProblems(l: RowLine): string[] {
  const r = l.row;
  const p: string[] = [];
  if (!END_STATES.includes(r.end)) p.push("end " + JSON.stringify(r.end) + " is no C1 end state");
  if ((r.end === "block") !== (r.block !== null)) p.push("a block row needs a block, and only a block row has one");
  if ((r.end === "block") !== (r.code === null)) p.push("every end but block names its code");
  if (!MODELS.includes(r.model) || !ARMS.includes(r.arm)) p.push("model " + r.model + " or arm " + r.arm + " is not one the prereg names");
  if (r.attempts !== 1 && r.attempts !== 2) p.push(r.attempts + " attempts, and a session gets at most one retry");
  if (r.attempts !== l.attempts.length) p.push("attempts " + r.attempts + " but " + l.attempts.length + " attempt records");
  if (r.founder_turns.some((t, i) => t.turn !== i + 1)) p.push("founder turns are not numbered 1 to " + r.founder_turns.length);
  if (r.kind !== "arm" && r.founder_turns.length) p.push("a " + r.kind + " session has founder-reply limit 0, yet holds founder turns");
  if (entryId(r) !== l.id) p.push("id " + l.id + " does not name the row's session " + entryId(r));
  return p;
}

/** The launch's rows, by session id; the last line for an id wins. */
export function readRows(out: string): Map<string, RowLine> {
  const file = join(out, "rows.ndjson");
  const rows = new Map<string, RowLine>();
  if (!existsSync(file)) return rows;
  for (const line of readFileSync(file, "utf8").split("\n")) if (line.trim()) rows.set((JSON.parse(line) as RowLine).id, JSON.parse(line) as RowLine);
  return rows;
}

/** The rows command's report: every problem, the end-state counts per model, arm and kind, and the manifest's unrun sessions. */
export function rowsReport(manifest: Manifest, rows: ReadonlyMap<string, RowLine>): { problems: string[]; counts: Record<string, Record<string, number>>; unrun: string[] } {
  const problems = [...rows.values()].flatMap((l) => rowProblems(l).map((p) => l.id + ": " + p));
  const scheduled = new Set(manifest.entries.map(entryId));
  for (const id of rows.keys()) if (!scheduled.has(id)) problems.push(id + ": not in the frozen manifest");
  const counts: Record<string, Record<string, number>> = {};
  for (const l of rows.values()) {
    const k = l.row.kind + " " + l.row.model + " " + l.row.arm;
    counts[k] = { ...counts[k], [l.row.end]: (counts[k]?.[l.row.end] ?? 0) + 1 };
  }
  return { problems, counts, unrun: [...scheduled].filter((id) => !rows.has(id)) };
}
