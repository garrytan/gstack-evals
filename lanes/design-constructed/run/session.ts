// Copyright (c) 2026 Garry Tan. MIT License.
// The session loop and the end-state classifier (plan section 6 as PD-6 and R2-22 order it). A session's end is read
// in this order, and the first step that applies decides: contamination (a successful web result, or a gstack file read
// in a none, lens or reference session), then a cap stop or a session a drift stop cut (PD-25: incomplete, whatever
// block it holds, never retried and never scored), then termination on
// the session's own limit (an arm stop, even with a block, and even after the D1 hook held it), then a failure outside
// the agent, then only a completed reply's last block is parsed, with the frozen autoplan row. A cell gets at most one
// retry whatever the cause, J1 reconciliation runs before it, and the retry's outcome is final. No cell gets a third
// session. This replaces D's classifier, which scored a parsed block before it read the termination
// (lanes/devex/run/parse.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94); the loop's shape follows D's
// lanes/devex/run/session.ts and main's src/trial/review/er-run.ts.
import { createHash } from "node:crypto";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { CELL_STATES, HARNESS, SEED } from "../frozen.ts";
import type { Termination } from "../../../src/types.ts";
import type { SessionKind } from "../types.ts";
import { isGstackArm } from "./arms.ts";
import type { AttemptEnd, AttemptRecord, Cell, CellOutcome, EndRead, LoopSeams, ParseBlock } from "./types.ts";

/**
 * The driver's termination as an attempt end (BT, and the Captain's 2026-11-14 ruling). errorSeen says the API, the
 * provider or the harness returned an error in the session's last exchange; it decides only a malformed tool call.
 */
export function endOf(t: Termination, errorSeen = false): AttemptEnd {
  switch (t.kind) {
    case "completed":
      return { kind: "completed" };
    case "timeout":
      return { kind: "own-limit", limit: "timeout" };
    case "turn_cap":
      return { kind: "own-limit", limit: "turns" };
    case "allowance_stop":
      return { kind: "own-limit", limit: "dollars" };
    case "cap_stop":
      return { kind: "cap-stop" };
    case "arm_failure":
      if (t.failure === "context_overflow") return { kind: "own-limit", limit: "context" };
      if (t.failure === "harness_crash") return { kind: "outside", reason: "harness crash" };
      if (t.failure === "malformed_tool_call") return errorSeen ? { kind: "outside", reason: MALFORMED_OUTSIDE } : { kind: "own-limit", limit: "tool-call" };
      return { kind: "completed" };
    case "missing":
      return { kind: "outside", reason: t.code };
    case "infra":
      return { kind: "outside", reason: "infra: " + t.incident };
    case "unknown":
      return { kind: "outside", reason: "unknown outcome " + t.reservation_id };
    case "credentials_rejected":
      return { kind: "outside", reason: "credentials rejected" };
  }
}

/** One attempt's read, in the precedence order. */
export function readAttempt(kind: SessionKind, r: AttemptRecord, parse: ParseBlock): EndRead {
  if (r.webResult) return { state: "web-contaminated", list: null, why: "a successful web result" };
  if (r.gstackRead && !isGstackArm(kind)) return { state: "gstack-read", list: null, why: "a gstack file read in a " + kind + " session" };
  if (r.end.kind === "cap-stop") return { state: "incomplete", list: null, why: "a cap stop" };
  if (r.end.kind === "drift-stop") return { state: "incomplete", list: null, why: "a drift stop, read as a cap stop reads (PD-25)" };
  if (r.end.kind === "own-limit") return { state: "arm-stop", list: null, why: (r.end.limit === "tool-call" ? "the harness ended the session on the model's own malformed tool call" : "the session's own " + r.end.limit + " limit") + (r.heldBlock ? ", with a block written before it stopped" : "") };
  if (r.end.kind === "outside") return { state: "infra-missing", list: null, why: "a failure outside the agent: " + r.end.reason };
  const list = parse(r.reply);
  if (!list) return { state: "no-block", list: null, why: "a completed reply with no block that parses" };
  if (kind === "autoplan" && !(r.autoplan?.gateAnswered && r.autoplan.approved)) return { state: "scored-unexposed", list, why: "autoplan with a block but " + (r.autoplan?.gateAnswered ? "no APPROVED" : "no gate answered") };
  return { state: "scored", list, why: "the completed reply's last block" };
}

/** The states a first attempt may retry from: an arm stop (a fresh session) and a failure outside the agent (J1). */
const RETRIES = new Set(["fresh-session", "j1"]);

/** One cell from its first session to its final state, with at most one retry. */
export async function runCell(cell: Cell, seams: LoopSeams): Promise<CellOutcome> {
  const log = seams.log ?? (() => {});
  const first = await seams.session(cell, 1);
  const r1 = readAttempt(cell.kind, first, seams.parse);
  const attempts: CellOutcome["attempts"] = [{ attempt: 1, end: first.end, read: r1, heldBlock: first.heldBlock }];
  const done = (read: EndRead, why: string): CellOutcome => ({ cell, state: read.state, list: read.list, attempts, why });
  if (!RETRIES.has(CELL_STATES[r1.state].retry)) return done(r1, r1.why);
  const rec = await seams.reconcile(cell, 1);
  if (!rec.ok) {
    log("J1 " + cellId(cell) + ": reconciliation failed (" + rec.why + "); the cell is missing, never retried");
    return { cell, state: "infra-missing", list: null, attempts, why: "J1 could not reconcile attempt 1: " + rec.why };
  }
  if (first.judged || rec.judged) return done(r1, r1.why + "; a judge read attempt 1, so it is never retried");
  log("retry " + cellId(cell) + ": " + r1.why);
  const second = await seams.session(cell, 2);
  const r2 = readAttempt(cell.kind, second, seams.parse);
  attempts.push({ attempt: 2, end: second.end, read: r2, heldBlock: second.heldBlock });
  return done(r2, "the retry is final: " + r2.why);
}

export const cellId = (c: Cell) => [c.unit, c.kind, c.model, "p" + c.pass].join(":");

/** A uint32 seed from the first 8 hex digits of sha256 of the seed, a newline and the parts joined by newlines (BT, after R2-21). */
export const seedOf = (...parts: string[]): number => parseInt(createHash("sha256").update(String(SEED) + "\n" + parts.join("\n")).digest("hex").slice(0, 8), 16) >>> 0;

/** The run order: units in the order given, each unit's cells in a seeded order (Fisher-Yates on seedOf(unit, "cells")). */
export function cellOrder(cells: readonly Cell[]): Cell[] {
  const units: string[] = [];
  const by = new Map<string, Cell[]>();
  for (const c of cells) {
    if (!by.has(c.unit)) {
      by.set(c.unit, []);
      units.push(c.unit);
    }
    by.get(c.unit)!.push(c);
  }
  return units.flatMap((u) => {
    const list = [...by.get(u)!].sort((a, b) => (cellId(a) < cellId(b) ? -1 : 1));
    const rng = seededRandom(seedOf(u, "cells"));
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  });
}

/** Every cell in cellOrder, at most HARNESS.maxSessionsAtOnce sessions at once; a retry holds its cell's slot. */
export async function runCells(cells: readonly Cell[], seams: LoopSeams, limit: number = HARNESS.maxSessionsAtOnce): Promise<CellOutcome[]> {
  if (limit < 1 || limit > HARNESS.maxSessionsAtOnce) throw new Error("E_USAGE: at most " + HARNESS.maxSessionsAtOnce + " sessions run at once");
  const order = cellOrder(cells);
  const out: CellOutcome[] = new Array(order.length);
  let next = 0;
  const worker = async () => {
    while (next < order.length) {
      const i = next++;
      out[i] = await runCell(order[i]!, seams);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, order.length) }, worker));
  return out;
}

/** The descriptive print beside the sensitivity read: per arm and model, arm-stop attempts that held a block. Decides nothing. */
export function armStopsWithBlock(outcomes: readonly CellOutcome[]): Array<{ kind: SessionKind; model: string; attempts: number }> {
  const counts = new Map<string, number>();
  for (const o of outcomes) for (const a of o.attempts) if (a.read.state === "arm-stop" && a.heldBlock) counts.set(o.cell.kind + "\t" + o.cell.model, (counts.get(o.cell.kind + "\t" + o.cell.model) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => ({ kind: k.split("\t")[0] as SessionKind, model: k.split("\t")[1]!, attempts: n }));
}

export const printArmStopsWithBlock = (outcomes: readonly CellOutcome[]): string[] => armStopsWithBlock(outcomes).map((r) => "arm stops that held a block: " + r.kind + " on " + r.model + " " + r.attempts + " (descriptive)");

/** The reason an outside end carries when a malformed tool call ended the session after an API, provider or harness error. */
export const MALFORMED_OUTSIDE = "a malformed tool call after an API, provider or harness error";

/** Per arm and model, attempts a malformed tool call ended: read as an arm stop, and read as outside the agent (Captain, 2026-11-14). */
export function malformedToolCalls(outcomes: readonly CellOutcome[]): Array<{ kind: SessionKind; model: string; armStop: number; outside: number }> {
  const counts = new Map<string, { armStop: number; outside: number }>();
  for (const o of outcomes)
    for (const a of o.attempts) {
      const arm = a.end.kind === "own-limit" && a.end.limit === "tool-call";
      const out = a.end.kind === "outside" && a.end.reason === MALFORMED_OUTSIDE;
      if (!arm && !out) continue;
      const k = o.cell.kind + "	" + o.cell.model;
      const c = counts.get(k) ?? { armStop: 0, outside: 0 };
      if (arm) c.armStop++;
      else c.outside++;
      counts.set(k, c);
    }
  return [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, c]) => ({ kind: k.split("	")[0] as SessionKind, model: k.split("	")[1]!, ...c }));
}

export const printMalformedToolCalls = (outcomes: readonly CellOutcome[]): string[] =>
  malformedToolCalls(outcomes).map((r) => "malformed tool calls: " + r.kind + " on " + r.model + " " + r.armStop + " read as arm stops, " + r.outside + " as outside the agent");

/** A cell is final once its outcome exists; a label packet is built only from final cells (plan section 6). */
export function packetReady(planned: readonly Cell[], outcomes: ReadonlyMap<string, CellOutcome>): boolean {
  return planned.every((c) => outcomes.has(cellId(c)));
}
