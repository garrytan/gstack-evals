// Family SM's session plan and outcomes (the implicit state machines prereg, sections 6, 9 and 13). planPart orders one
// part's sessions: per unit, its first-stage cells shuffled by the frozen order seed, then its follow-ons, each after its
// tree's first stage (S0 needs none). endKind maps real_agent's termination and the driver's close to section 6's end
// kinds; nextStep applies the one-retry rule and names the gap code on a second upstream or infra end. sessionRecord
// writes sm-session.v1 (design 2.2) with exclusive create.
import { writeFileSync } from "node:fs";
import { seededRandom } from "../../../src/runner/stats/paired.ts";

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

export type EndKind = "completed" | "limit_wall" | "limit_turns" | "limit_allowance" | "upstream" | "infra";

/** Section 6's end kind. termination is real_agent's; refusals are the proxy codes the session met; harness is a failure outside the model (container, pull, Harbor, agent setup). */
export function endKind(o: { termination: string | null; refusals?: string[]; upstream_status?: number | null; harness?: boolean }): EndKind {
  if (o.harness) return "infra";
  const refused = o.refusals ?? [];
  if (refused.includes("E_ALLOWANCE")) return "limit_allowance";
  if (o.termination === "wall_limit") return "limit_wall";
  if (o.termination === "turn_ceiling") return "limit_turns";
  if (o.termination === "completed" || o.termination === "bg_wait_expired") return "completed";
  if (refused.includes("UPSTREAM") || (o.upstream_status ?? 0) >= 500 || o.upstream_status === 429 || o.termination === "error_result") return "upstream";
  return "infra";
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
  turns: number | null; spent_micros: number; unknown_micros: number; end: EndKind; attempt: 1 | 2;
  questions: { ask_user_question: number; prose: number }; runtime_id: string; disallowed_tools: string[]; env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };
  strip: { removed: string[] }; memory_loaded: string[]; tree_patch: { path: string; sha256: string } | null; transcript: string;
  exposure: Record<string, unknown>; reads: { inputs: number; gstack: number; drive: number };
}

export function writeSessionRecord(file: string, r: SessionRecord): void {
  if (r.schema !== "sm-session.v1" || (r.attempt !== 1 && r.attempt !== 2) || r.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS !== "1" || ["WebSearch", "WebFetch"].some((t) => !r.disallowed_tools.includes(t))) throw new Error("E_SM_ARM the session record breaks section 4's harness rules");
  writeFileSync(file, JSON.stringify(r, null, 1) + "\n", { flag: "wx" });
}

/** Questions per session from real-summary.json's persona counts (NoAnswer in sm_user.py). */
export const questionCounts = (persona: Record<string, { questions?: number; ask_user_question?: number; prose_questions?: number }>) =>
  Object.values(persona).reduce<{ ask_user_question: number; prose: number }>((a, p) => ({ ask_user_question: a.ask_user_question + (p.ask_user_question ?? 0), prose: a.prose + (p.prose_questions ?? 0) }), { ask_user_question: 0, prose: 0 });
