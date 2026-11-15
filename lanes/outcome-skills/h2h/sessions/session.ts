// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's session end rules and record (post sections 3, 4 and 7). h2h_turns.py writes a summary per attempt;
// endOf reads its end the way pfchecks' task_end reads a turn, and the record keeps the counts section 9 reports per arm:
// turns, continuations, spurious continuations, questions, reservation-bound refusals, spend and tokens. A session that
// ends upstream or infra is retried once as a whole, naming meta.rerun; a second such end is a gap (E_H2H_UPSTREAM_GAP,
// E_H2H_INFRA_GAP). The retry is the whole session again, on a slot with the full allowance; it opens only when the money
// cap above the session (rerun's spend cap, or the driver's item lease, which refuses the slot) covers one more full
// allowance, and otherwise the session ends as a cap stop, never as a gap or on a smaller slot. Each attempt's own slot,
// spend and tokens stay in the record: cost_usd and tokens are their sums (pricing and dollars per verified fix), and
// scored_attempt_cost_usd is the last attempt's own spend (section 3's doubling rule, since the allowance binds one
// attempt). A cap stop ends the part incomplete. A tree that could not leave the container is a gap (E_H2H_CAPTURE). A
// safety stop is its own end and is scored like any other.
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

/** One attempt's own slot and usage. allowance_usd is the cap its slot opened with (null when not known). */
export interface AttemptUsage { attempt: 1 | 2; end: SessionEnd; slot: string | null; allowance_usd: number | null; spent_micros: number; tokens: H2hSession["tokens"]; reservation_refusals: number }
export type H2hSessionRecord = H2hSession & { attempt_usage?: AttemptUsage[]; scored_attempt_cost_usd?: number; retry_cap_stop?: string };

export function attemptUsage(attempt: 1 | 2, s: Summary | null, allowanceUsd: number | null): AttemptUsage {
  const close = closeOf(s);
  const u = (close.usage ?? {}) as Record<string, number>;
  return { attempt, end: endOf(s), slot: typeof s?.slot?.id === "string" ? s.slot.id : null, allowance_usd: allowanceUsd, spent_micros: Number(close.spent_micros ?? 0), tokens: { input: u.input ?? 0, output: u.output ?? 0, cache_read: u.cache_read ?? 0, cache_write: u.cache_write ?? 0 }, reservation_refusals: Number(close.reservation_bound ?? 0) };
}

/** Whether the money cap above the session (capLeftUsd: what it had left when the session began) still covers a retry's
 *  full allowance after the attempts so far. No cap given: the driver's lease decides when the slot opens. */
export function retryCovered(capLeftUsd: number | undefined, allowanceUsd: number, used: readonly AttemptUsage[]): boolean {
  if (capLeftUsd === undefined) return true;
  return Math.round(capLeftUsd * 1_000_000) - used.reduce((n, a) => n + a.spent_micros, 0) >= Math.round(allowanceUsd * 1_000_000);
}

const ran = (s: Summary | null): Summary[] => ((s?.turns ?? []) as Summary[]).filter((t) => t.drive !== undefined);

/** One session's record: its end, counts and tree from its last attempt, its spend and tokens summed over every attempt in
 *  usage (the last attempt's alone when usage is not given). retry_cap_stop: why a retry the cap could not cover did not
 *  open; the session then ends as a cap stop. */
export function sessionRecord(p: H2hPlanned, s: Summary | null, o: { model: string; attempt: 1 | 2; exposure: Exposure | null; wall_ms: number; home_tree_sha256: string | null; usage?: AttemptUsage[]; retry_cap_stop?: string }): H2hSessionRecord {
  const end = o.retry_cap_stop !== undefined ? "cap_stop" : endOf(s);
  const close = closeOf(s);
  const head = ((s?.check?.HEAD ?? []) as string[])[0];
  const used = o.usage ?? [attemptUsage(o.attempt, s, null)];
  const total = (k: keyof H2hSession["tokens"]) => used.reduce((n, a) => n + a.tokens[k], 0);
  const questions = Object.values((s?.questions ?? {}) as Record<string, { questions?: number }>).reduce((n, q) => n + (q.questions ?? 0), 0);
  return {
    schema: "h2h-session.v1", unit: p.unit, arm: p.arm, model: o.model, item: p.item, stage: p.stage, index: p.index, end, gap: gapOf(end, o.attempt, s),
    turns: ran(s).length, scripted_turns: ran(s).filter((t) => String(t.phase).startsWith("t")).length, continuations: Number(s?.continuations ?? 0), spurious_continuations: Number(s?.spurious_continuations ?? 0),
    done_seen: s?.done === true, questions, reservation_refusals: Number(close.reservation_bound ?? 0), cost_usd: used.reduce((n, a) => n + a.spent_micros, 0) / 1_000_000,
    tokens: { input: total("input"), output: total("output"), cache_read: total("cache_read"), cache_write: total("cache_write") }, wall_ms: o.wall_ms, exposure: o.exposure,
    transcript: "sdk-messages.jsonl", tree_bundle: "tree.tar", ...(head ? { base_head: head } : {}),
    attempts: o.attempt, allowance_stops: Number(close.allowance_stops ?? 0), home_tree_sha256: o.home_tree_sha256, claude_version: typeof s?.claude_version === "string" ? s.claude_version : null, refused: typeof s?.refused === "string" ? s.refused.slice(0, 600) : null,
    ...(o.usage ? { attempt_usage: o.usage, scored_attempt_cost_usd: o.usage.at(-1)!.spent_micros / 1_000_000 } : {}), ...(o.retry_cap_stop !== undefined ? { retry_cap_stop: o.retry_cap_stop } : {}),
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
