// Copyright (c) 2026 Garry Tan. MIT License.
// Two-turn sessions (plan sections 4, 5 and 11): the session plan seeded by order_seed, the end rules of the task turn
// and the wrap-up turn, the effort fields of a model's first request, and the pf-session.v1 record score.ts reads.
// The task turn ends, the session-end commit (capture.sh) saves S in the session container, then the wrap-up turn runs
// in the same Claude Code session with its own limits; wrapup.sh keeps only CHECKS.json from it and counts the rest.
import { writeFileSync } from "node:fs";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { endKind, type EndKind } from "../statemachines/session.ts";
import { DISALLOWED_TOOLS, type Names, type PfArm } from "./arms.ts";
import type { Capture } from "./capture.ts";
import { ARMS, MODEL_ITEM, MODELS, OPUS } from "./items.ts";
import { pfFail } from "./prereg.ts";

export { endKind, type EndKind };
export type PartKind = "admit" | "test" | "blind";
export interface PfPlanned { unit: string; part: number; index: number; model: string; arm: PfArm; item: string }

const itemOf = (kind: PartKind, model: string): string => (kind === "admit" ? "pf-admit" : kind === "blind" ? "pf-blind" : MODEL_ITEM[model] ?? pfFail("E_PF_INPUT", "no item for model " + model));

/** One part's sessions in order. Per unit, every (model, arm) cell of the part, shuffled by one seededRandom(order_seed +
 *  part) stream, so all sessions of a unit run together, interleaved (section 11). test: the 9 told cells; admit: the
 *  models given (Opus, or the price probe's Sol and particle-1); blind: P blind on Opus. */
export function planPart(units: string[], orderSeed: number, part: number, kind: PartKind = "test", models: readonly string[] = kind === "test" ? MODELS : [OPUS]): PfPlanned[] {
  if (!Number.isSafeInteger(orderSeed) || orderSeed < 0) pfFail("E_PF_SEED", "the order seed must be a whole number, from prereg.json order_seed");
  if (kind === "blind" && (models.length !== 1 || models[0] !== OPUS)) pfFail("E_PF_INPUT", "the blind probe runs on Opus only");
  const rand = seededRandom(orderSeed + part);
  const out: PfPlanned[] = [];
  for (const unit of units) {
    const cells = models.flatMap((model) => (kind === "blind" ? (["blind"] as PfArm[]) : [...ARMS]).map((arm) => ({ model, arm })));
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    for (const c of cells) out.push({ unit, part, index: out.length, model: c.model, arm: c.arm, item: itemOf(kind, c.model) });
  }
  return out;
}

const LIMIT = new Set<EndKind>(["limit_wall", "limit_turns", "limit_allowance"]);
/** Section 5, task turn: completed or a limit goes on to the wrap-up turn; an upstream or infra end retries the whole
 *  session once from a fresh container, and a second is a gap. */
export function taskStep(ends: EndKind[]): { action: "wrapup" } | { action: "retry_session" } | { action: "gap"; code: "E_PF_UPSTREAM_GAP" | "E_PF_INFRA_GAP" } {
  const last = ends.at(-1) ?? pfFail("E_PF_INPUT", "taskStep needs at least one end");
  if (last === "completed" || LIMIT.has(last)) return { action: "wrapup" };
  if (ends.length === 1) return { action: "retry_session" };
  return { action: "gap", code: last === "upstream" ? "E_PF_UPSTREAM_GAP" : "E_PF_INFRA_GAP" };
}
/** Section 5, wrap-up turn: completed or a limit is scored (a limit with no valid manifest scores 0, "no manifest
 *  (wrap-up limit)"); an upstream end reruns only the wrap-up turn once, resuming the same session on the saved S, and a
 *  second is a gap. An infra end in the wrap-up turn takes the same one rerun (this build's reading of "Infra: one rerun"). */
export function wrapupStep(ends: EndKind[]): { action: "score"; wrapup_end: EndKind } | { action: "rerun_wrapup" } | { action: "gap"; code: "E_PF_UPSTREAM_GAP" | "E_PF_INFRA_GAP" } {
  const last = ends.at(-1) ?? pfFail("E_PF_INPUT", "wrapupStep needs at least one end");
  if (last === "completed" || LIMIT.has(last)) return { action: "score", wrapup_end: last };
  if (ends.length === 1) return { action: "rerun_wrapup" };
  return { action: "gap", code: last === "upstream" ? "E_PF_UPSTREAM_GAP" : "E_PF_INFRA_GAP" };
}

/** The effort and thinking fields of a request body (section 4's model settings). Missing keys read null. */
export const EFFORT_KEYS = ["thinking", "output_config", "reasoning", "reasoning_effort", "effort"] as const;
export function effortFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(EFFORT_KEYS.map((k) => [k, body[k] ?? null]));
}
/** A session whose first request's effort fields differ from the dry run's record for its model is an infra gap. */
export const effortDiffers = (recorded: Record<string, unknown>, body: Record<string, unknown>): boolean => JSON.stringify(effortFields(body)) !== JSON.stringify(effortFields(recorded));

export interface Discard { checks: boolean; discarded: string[] }
/** wrapup.sh keep's lines: PF_DISCARD <path> per discarded change and one PF_WRAPUP line. */
export function readWrapup(stdout: string): Discard {
  const m = stdout.match(/^PF_WRAPUP checks=([01]) discarded=(\d+)$/m);
  if (!m) return pfFail("E_PF_CAPTURE", "wrapup.sh printed no PF_WRAPUP line: " + stdout.slice(-300));
  const discarded = [...stdout.matchAll(/^PF_DISCARD (.+)$/gm)].map((x) => x[1]!);
  if (discarded.length !== Number(m[2])) pfFail("E_PF_CAPTURE", "the discard count does not match the paths printed");
  return { checks: m[1] === "1", discarded };
}

export interface PfSessionRecord {
  schema: "pf-session.v1"; unit: string; part: number; index: number; model: string; arm: PfArm; item: string; lease_id: string;
  attempt: 1 | 2; names: Names; task: { end: EndKind; turns: number | null; wall_ms: number; spent_micros: number };
  wrapup: { ends: EndKind[]; turns: number | null; spent_micros: number } | null; wrapup_end: EndKind | null; gap: string | null;
  capture: Capture | null; forced: string[]; discarded: string[]; checks: string | null; s: { repo: string; ref: string } | null; transcript: string | null;
  effort: Record<string, unknown> | null; questions: { ask_user_question: number; prose: number };
  env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" }; disallowed_tools: string[]; plugin: string | null; tools: string;
}

/** Writes pf-session.v1 once (exclusive create) after checking section 4's harness rules. */
export function writeSessionRecord(file: string, r: PfSessionRecord): void {
  if (r.schema !== "pf-session.v1" || r.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS !== "1" || DISALLOWED_TOOLS.some((t) => !r.disallowed_tools.includes(t))) pfFail("E_PF_ARM", "the session record breaks section 4's harness rules");
  if ((r.plugin !== null) !== (r.arm === "P" || r.arm === "blind")) pfFail("E_PF_ARM", "only P and the blind probe mount the pstack plugin");
  if (!r.gap && (!r.s || r.wrapup_end === null)) pfFail("E_PF_INPUT", "a session with no gap exports S and the wrap-up turn's end");
  writeFileSync(file, JSON.stringify(r, null, 1) + "\n", { flag: "wx" });
}
