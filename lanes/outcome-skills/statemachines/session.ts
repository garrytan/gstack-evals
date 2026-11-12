// Family SM's session plan and outcomes (the implicit state machines prereg, sections 6, 9 and 13). planPart orders one
// part's sessions: per unit, its first-stage cells shuffled by the frozen order seed, then its follow-ons, each after its
// tree's first stage (S0 needs none). endKind maps real_agent's termination and the driver's close to section 6's end
// kinds; nextStep applies the one-retry rule and names the gap code on a second upstream or infra end. sessionRecord
// writes sm-session.v1 (design 2.2) with exclusive create.
import { writeFileSync } from "node:fs";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { smFail } from "./unit.ts";

export const FIRST_CELLS = ["A0", "A1", "A2", "S2"] as const;
export const QA_CELL = "A3";
export const FOLLOW_TREES = ["S0", "A1", "S2"] as const;
export const REPLICATES = 3;
export const ARM_OF: Record<string, string> = { A0: "sm:A0", A1: "sm:A1", A2: "sm:A2", S2: "sm:S2", A3: "qa:told" };

export interface PlannedSession { unit: string; part: number; index: number; model: string; cell: string; stage: "first" | "followon"; arm: string; tree?: "S0" | "A1" | "S2"; replicate?: number; after?: string }

/** One part's sessions in order, for each model. lines: "sm" (A0, A1, A2, S2 and the follow-ons) and/or "qa" (A3). */
export function planPart(units: string[], models: string[], orderSeed: number, part: number, lines: Array<"sm" | "qa"> = ["sm"]): PlannedSession[] {
  if (!Number.isSafeInteger(orderSeed) || orderSeed < 0) throw new Error("E_SM_SEED the order seed must be a whole number, from prereg.json order_seed");
  const rand = seededRandom(orderSeed + part);
  const shuffle = <T>(xs: T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const out: PlannedSession[] = [];
  for (const unit of units)
    for (const model of models) {
      const first = shuffle([...(lines.includes("sm") ? FIRST_CELLS : []), ...(lines.includes("qa") ? [QA_CELL] : [])]);
      for (const cell of first) out.push({ unit, part, index: out.length, model, cell, stage: "first", arm: ARM_OF[cell]! });
      if (!lines.includes("sm")) continue;
      const follow = shuffle(FOLLOW_TREES.flatMap((tree) => Array.from({ length: REPLICATES }, (_, k) => ({ tree, replicate: k + 1 }))));
      for (const f of follow) out.push({ unit, part, index: out.length, model, cell: "F-" + f.tree + "-" + f.replicate, stage: "followon", arm: "sm:followon", tree: f.tree, replicate: f.replicate, ...(f.tree === "S0" ? {} : { after: f.tree }) });
    }
  return out;
}

/** A follow-on cell's replicate: F-<tree>-<n>, or F-<tree>-<n>-cut for a session with the cut issue (run.ts sessionText). */
export const replicateOf = (cell: string): number | null => Number((/^F-(?:S0|A1|S2)-(\d+)(?:-cut)?$/.exec(cell) ?? [])[1]) || null;

export type EndKind = "completed" | "limit_wall" | "limit_turns" | "limit_allowance" | "upstream" | "infra";

/** Section 6's end kind. termination is real_agent's; refusals are the proxy codes the session met; allowance_stop is a refusal at the slot's allowance check, the one E_ALLOWANCE refusal that is a stop; harness is a failure outside the model (container, pull, Harbor, agent setup). */
export function endKind(o: { termination: string | null; refusals?: string[]; allowance_stop?: boolean; upstream_status?: number | null; harness?: boolean }): EndKind {
  if (o.harness) return "infra";
  const refused = o.refusals ?? [];
  if (o.allowance_stop) return "limit_allowance";
  if (o.termination === "wall_limit") return "limit_wall";
  if (o.termination === "turn_ceiling") return "limit_turns";
  if (o.termination === "completed" || o.termination === "bg_wait_expired") return "completed";
  if (refused.includes("UPSTREAM") || (o.upstream_status ?? 0) >= 500 || o.upstream_status === 429 || o.termination === "error_result") return "upstream";
  return "infra";
}

/** The end kind and unpriced spend of one session from real_agent's real-summary.json, whose proxy block copies the driver's close answer. A harness failure is infra whatever the block holds, and so is a block with no field set, which real_agent writes when no close answer came. A close answer whose proxy finalize failed (finalized false) ends limit_allowance when it still names an allowance stop (allowance_stops above 0), so a real stop is scored as is and never spends again, and infra otherwise, since its counts are unknown (the driver's own close path then reports allowance_stops null and halts the item). Otherwise refusals must be the close answer's array of refusal codes, and allowance_stops and unknown_micros numbers, or the session is refused, so an allowance stop is never read as an upstream end. */
export function sessionEnd(summary: { termination?: string | null; proxy?: Record<string, any> | null } | null, harness: boolean): { end: EndKind; unknown_micros: number } {
  const p = summary?.proxy ?? {};
  if (!summary || harness) return { end: "infra", unknown_micros: typeof p.unknown_micros === "number" ? p.unknown_micros : 0 };
  if (Object.values(p).every((v) => v === null || v === undefined)) return { end: "infra", unknown_micros: 0 };
  if (p.finalized === false) return { end: typeof p.allowance_stops === "number" && p.allowance_stops > 0 ? "limit_allowance" : "infra", unknown_micros: typeof p.unknown_micros === "number" ? p.unknown_micros : 0 };
  if (!Array.isArray(p.refusals) || !p.refusals.every((c: unknown) => typeof c === "string")) return smFail("E_SM_ARM", "real-summary.json's proxy.refusals is " + JSON.stringify(p.refusals) + ", not the close answer's array of refusal codes");
  if (typeof p.unknown_micros !== "number") return smFail("E_SM_ARM", "real-summary.json's proxy.unknown_micros is " + JSON.stringify(p.unknown_micros) + ", not the close answer's number");
  if (typeof p.allowance_stops !== "number") return smFail("E_SM_ARM", "real-summary.json's proxy.allowance_stops is " + JSON.stringify(p.allowance_stops) + ", not the close answer's number");
  return { end: endKind({ termination: summary.termination ?? null, refusals: p.refusals, allowance_stop: p.allowance_stops > 0 }), unknown_micros: p.unknown_micros };
}

/** Scored as is, one retry from a fresh container, or a gap with its code. */
export function nextStep(ends: EndKind[]): { action: "score" } | { action: "retry" } | { action: "gap"; code: "E_SM_UPSTREAM_GAP" | "E_SM_INFRA_GAP" } {
  const last = ends.at(-1);
  if (!last) throw new Error("E_USAGE nextStep needs at least one end");
  if (last !== "upstream" && last !== "infra") return { action: "score" };
  if (ends.length === 1) return { action: "retry" };
  return { action: "gap", code: last === "upstream" ? "E_SM_UPSTREAM_GAP" : "E_SM_INFRA_GAP" };
}

export interface SessionRecord {
  schema: "sm-session.v1"; unit: string; part: number; index: number; model: string; cell: string; stage: "first" | "followon";
  tree_ref: null | { tree: string; first_session: string | null }; lease_id: string; slot: string; started_at: string; ended_at: string; wall_ms: number;
  /** spent_micros is the driver's close answer as real_agent copied it, and null when none reached real-summary.json: an unknown spend is never written as 0 (the lease's ledger still holds it). */
  turns: number | null; spent_micros: number | null; unknown_micros: number; end: EndKind; attempt: 1 | 2;
  /** A first stage's scope rule: "folder" (scope.dir) or "file" (every file the fix patch touches, section 12's retry); null on a follow-on. */
  scope: "folder" | "file" | null;
  questions: { ask_user_question: number; prose: number }; runtime_id: string; disallowed_tools: string[]; env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };
  strip: { removed: string[] }; memory_loaded: string[]; tree_patch: { path: string; sha256: string } | null; transcript: string;
  /** A3 only: the file digest of the /qa home the image build copied into /root (image.ts qaHomeCopy); null in every other arm. */
  qa_home_sha256: string | null;
  exposure: Record<string, unknown>; reads: { inputs: number; gstack: number; drive: number };
}

/** Section 6: a session that ended upstream or infra is never scored and seeds no follow-on tree. On attempt 1 it gets its
 *  one retry from a fresh container; on attempt 2 it is a gap, and a first stage's gap removes that tree's follow-ons. */
export function refuseUnscored(s: { end: EndKind; attempt: number }): void {
  if (s.end !== "upstream" && s.end !== "infra") return;
  if (s.attempt !== 2) smFail("E_SM_ARM", "the session ended " + s.end + " on attempt " + s.attempt + ", so it is not scored and seeds no follow-on: it gets one retry from a fresh container (sm session run --attempt 2) before it is a gap");
  smFail(s.end === "upstream" ? "E_SM_UPSTREAM_GAP" : "E_SM_INFRA_GAP", "the session ended " + s.end + " on its retry, so it is a gap: it is not scored and seeds no follow-on; analysis reads the gap from its session record");
}

export function writeSessionRecord(file: string, r: SessionRecord): void {
  if (r.schema !== "sm-session.v1" || (r.attempt !== 1 && r.attempt !== 2) || r.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS !== "1" || ["WebSearch", "WebFetch"].some((t) => !r.disallowed_tools.includes(t))) throw new Error("E_SM_ARM the session record breaks section 4's harness rules");
  writeFileSync(file, JSON.stringify(r, null, 1) + "\n", { flag: "wx" });
}

/** Questions per session from real-summary.json's persona counts (NoAnswer in sm_user.py). */
export const questionCounts = (persona: Record<string, { questions?: number; ask_user_question?: number; prose_questions?: number }>) =>
  Object.values(persona).reduce<{ ask_user_question: number; prose: number }>((a, p) => ({ ask_user_question: a.ask_user_question + (p.ask_user_question ?? 0), prose: a.prose + (p.prose_questions ?? 0) }), { ask_user_question: 0, prose: 0 });
