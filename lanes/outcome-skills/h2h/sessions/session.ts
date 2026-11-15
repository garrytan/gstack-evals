// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's session end rules and record (post sections 3, 4 and 7). h2h_turns.py writes a summary per attempt;
// endOf reads its end the way pfchecks' task_end reads a turn, and the record keeps the counts section 9 reports per arm:
// turns, continuations, spurious continuations, questions, reservation-bound refusals, spend and tokens. A session that
// ends upstream or infra is retried once as a whole, naming meta.rerun; a second such end is a gap (E_H2H_UPSTREAM_GAP,
// E_H2H_INFRA_GAP). A cap stop ends the part incomplete. A tree that could not leave the container is a gap
// (E_H2H_CAPTURE). A safety stop is its own end and is scored like any other.
import { writeFileSync } from "node:fs";
import { h2hFail } from "../prereg.ts";
import type { Exposure, H2hSession, SessionEnd } from "../types.ts";
import type { H2hPlanned } from "./plan.ts";

/** meta.rerun on the whole-session retry. */
export const SESSION_RERUN = "session_upstream_or_infra";
const ENDS: Record<string, SessionEnd> = { completed: "completed", bg_wait_expired: "completed", wall_limit: "limit_wall", turn_ceiling: "limit_turns" };

type Summary = Record<string, any>;
const closeOf = (s: Summary | null): Record<string, any> => s?.slot?.close ?? {};

/** The session's end from an attempt's summary (null when the attempt left none). A harness error, or a close whose proxy
 *  finalize failed with no allowance stop counted, is infra; an allowance stop is limit_allowance whatever the turn
 *  said; a refusal stop in any turn is safety_stop; then the last turn's wall and turn limits and completed; an UPSTREAM
 *  refusal or an error result is upstream; anything else is infra. */
export function endOf(s: Summary | null): SessionEnd {
  if (!s) return "infra";
  if (s.cap_stop) return "cap_stop";
  const close = closeOf(s);
  const stops = Number(close.allowance_stops ?? 0);
  const last = (s.turns ?? []).at(-1) as Summary | undefined;
  if (!last || last.termination === "error" || (close.finalized === false && !stops)) return "infra";
  if (stops) return "limit_allowance";
  if ((s.turns as Summary[]).some((t) => t.refusal)) return "safety_stop";
  const refusals: string[] = Array.isArray(close.refusals) ? close.refusals.map(String) : [];
  return ENDS[last.termination] ?? (refusals.some((r) => r.includes("UPSTREAM")) || last.termination === "error_result" ? "upstream" : "infra");
}

/** Whether an attempt's end gets the one whole-session retry. */
export const retries = (end: SessionEnd, attempt: 1 | 2, s: Summary | null): boolean => attempt === 1 && (end === "upstream" || end === "infra") && !capture(s);
const capture = (s: Summary | null) => typeof s?.refused === "string" && s.refused.startsWith("E_H2H_CAPTURE");

/** The gap after the retry rules, or null. */
export function gapOf(end: SessionEnd, attempt: 1 | 2, s: Summary | null): string | null {
  if (capture(s)) return "E_H2H_CAPTURE";
  if (end === "cap_stop") return "CAP_STOP";
  if (attempt === 2 && end === "upstream") return "E_H2H_UPSTREAM_GAP";
  if (attempt === 2 && end === "infra") return "E_H2H_INFRA_GAP";
  return null;
}

const ran = (s: Summary | null): Summary[] => ((s?.turns ?? []) as Summary[]).filter((t) => t.drive !== undefined);

/** One session's record from its last attempt. */
export function sessionRecord(p: H2hPlanned, s: Summary | null, o: { model: string; attempt: 1 | 2; exposure: Exposure | null; wall_ms: number; home_tree_sha256: string | null }): H2hSession {
  const end = endOf(s);
  const close = closeOf(s);
  const head = ((s?.check?.HEAD ?? []) as string[])[0];
  const usage = (close.usage ?? {}) as Record<string, number>;
  const questions = Object.values((s?.questions ?? {}) as Record<string, { questions?: number }>).reduce((n, q) => n + (q.questions ?? 0), 0);
  return {
    schema: "h2h-session.v1", unit: p.unit, arm: p.arm, model: o.model, item: p.item, stage: p.stage, index: p.index, end, gap: gapOf(end, o.attempt, s),
    turns: ran(s).length, scripted_turns: ran(s).filter((t) => String(t.phase).startsWith("t")).length, continuations: Number(s?.continuations ?? 0), spurious_continuations: Number(s?.spurious_continuations ?? 0),
    done_seen: s?.done === true, questions, reservation_refusals: Number(close.reservation_bound ?? 0), cost_usd: Number(close.spent_micros ?? 0) / 1_000_000,
    tokens: { input: usage.input ?? 0, output: usage.output ?? 0, cache_read: usage.cache_read ?? 0, cache_write: usage.cache_write ?? 0 }, wall_ms: o.wall_ms, exposure: o.exposure,
    transcript: "sdk-messages.jsonl", tree_bundle: "tree.tar", ...(head ? { base_head: head } : {}),
    attempts: o.attempt, allowance_stops: Number(close.allowance_stops ?? 0), home_tree_sha256: o.home_tree_sha256, claude_version: typeof s?.claude_version === "string" ? s.claude_version : null, refused: typeof s?.refused === "string" ? s.refused.slice(0, 600) : null,
  };
}

/** Writes a session record once; an existing file refuses. */
export function writeSessionRecord(file: string, r: H2hSession): void {
  try {
    writeFileSync(file, JSON.stringify(r, null, 1) + "\n", { flag: "wx" });
  } catch (e) {
    h2hFail("E_H2H_SESSION_INPUT", file + " could not be written once: " + (e as Error).message);
  }
}
