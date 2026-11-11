// Copyright (c) 2026 Garry Tan. MIT License.
// Two-turn sessions (plan sections 4, 5 and 11): the session plan seeded by order_seed, the end rules of the task turn
// and the wrap-up turn, the effort fields of a model's first request, and the pf-session.v1 record score.ts reads.
// The task turn ends, the session-end commit (capture.sh) saves S in the session container, then the wrap-up turn runs
// in the same Claude Code session with its own limits; wrapup.sh keeps only CHECKS.json from it and counts the rest.
import { writeFileSync } from "node:fs";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { endKind, type EndKind } from "../statemachines/session.ts";
import { ARM_ENV, DISALLOWED_TOOLS, type Names, type PfArm } from "./arms.ts";
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
/** Section 5, wrap-up turn: completed or a time or turn limit is scored (a limit with no valid manifest scores 0, "no
 *  manifest (wrap-up limit)"); a wrap-up refused for its allowance (limit_allowance: an allowance stop on its slot, or
 *  the driver's refusal of its open) is gap E_PF_WRAPUP_ALLOWANCE, with no rerun; an upstream end reruns only the wrap-up
 *  turn once, resuming the same session on the saved S, and a second is a gap. An infra end in the wrap-up turn takes the
 *  same one rerun (this build's reading of "Infra: one rerun"). */
export function wrapupStep(ends: EndKind[]): { action: "score"; wrapup_end: EndKind } | { action: "rerun_wrapup" } | { action: "gap"; code: "E_PF_UPSTREAM_GAP" | "E_PF_INFRA_GAP" | "E_PF_WRAPUP_ALLOWANCE" } {
  const last = ends.at(-1) ?? pfFail("E_PF_INPUT", "wrapupStep needs at least one end");
  if (last === "limit_allowance") return { action: "gap", code: "E_PF_WRAPUP_ALLOWANCE" };
  if (last === "completed" || LIMIT.has(last)) return { action: "score", wrapup_end: last };
  if (ends.length === 1) return { action: "rerun_wrapup" };
  return { action: "gap", code: last === "upstream" ? "E_PF_UPSTREAM_GAP" : "E_PF_INFRA_GAP" };
}

/** The effort and thinking fields of a request body (section 3's model settings). Missing keys read null. */
export const EFFORT_KEYS = ["thinking", "output_config", "reasoning", "reasoning_effort", "effort"] as const;
export function effortFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(EFFORT_KEYS.map((k) => [k, body[k] ?? null]));
}
/** A session whose first request's effort fields differ from the dry run's record for its model is an infra gap. */
export const effortDiffers = (recorded: Record<string, unknown>, body: Record<string, unknown>): boolean => JSON.stringify(effortFields(body)) !== JSON.stringify(effortFields(recorded));
/** Section 3's effort check: the session's fields, as the driver's proxy recorded them from its task slot's first main
 *  request, equal the dry run's record for its model (effort.json). No recorded fields, or no record for the model, fails. */
export const effortHolds = (recorded: Record<string, unknown> | null, want: Record<string, unknown> | undefined): boolean => recorded !== null && want !== undefined && !effortDiffers(want, recorded);
/** What makes an effort record something other than the dry run's effort.json (an object whose every entry is an object
 *  with exactly EFFORT_KEYS, as effortFields writes it), or null when it is one. A missing key would read null. */
export function effortProblem(effort: unknown): string | null {
  if (effort === null || typeof effort !== "object" || Array.isArray(effort)) return "it is not an object with one record per model";
  const want = [...EFFORT_KEYS].sort().join(", ");
  for (const [model, e] of Object.entries(effort)) {
    if (e === null || typeof e !== "object" || Array.isArray(e)) return model + "'s entry is " + JSON.stringify(e) + ", not an object";
    const keys = Object.keys(e).sort().join(", ");
    if (keys !== want) return model + "'s entry has keys " + (keys || "none") + ", not exactly " + want;
  }
  return null;
}

export interface Discard { checks: boolean; discarded: string[] }
/** wrapup.sh keep's lines: PF_DISCARD <path> per discarded change and one PF_WRAPUP line. */
export function readWrapup(stdout: string): Discard {
  const m = stdout.match(/^PF_WRAPUP checks=([01]) discarded=(\d+)$/m);
  if (!m) return pfFail("E_PF_CAPTURE", "wrapup.sh printed no PF_WRAPUP line: " + stdout.slice(-300));
  const discarded = [...stdout.matchAll(/^PF_DISCARD (.+)$/gm)].map((x) => x[1]!);
  if (discarded.length !== Number(m[2])) pfFail("E_PF_CAPTURE", "the discard count does not match the paths printed");
  return { checks: m[1] === "1", discarded };
}

/** A failed post-turn step as pf_turns saw it: the step, whether it timed out, its failure, the PF_ARM_STATE causes
 *  state.sh found (none for an infra gap), the end of the turn before it, raw (wall_limit, bg_wait_expired...), and on
 *  a timeout the files and bytes the session wrote as the capture lists them (stopped: counting stopped at the
 *  2,000,000-file or 8 GiB line, so both are lower bounds); written is null when the step did not time out. */
export interface PfPostTurn { step: string; timed_out: boolean; failed: string; causes: string[]; after: { phase: string; termination: string } | null; written?: { files: number; bytes: number; stopped: boolean } | null }
export interface PfSessionRecord {
  schema: "pf-session.v1"; unit: string; part: number; index: number; model: string; arm: PfArm; item: string; lease_id: string;
  attempt: 1 | 2; names: Names; task: { end: EndKind; turns: number | null; wall_ms: number; spent_micros: number };
  wrapup: { ends: EndKind[]; turns: number | null; spent_micros: number } | null; wrapup_end: EndKind | null; gap: string | null;
  /** Why an E_PF_ARM gap: tree_check (the tree or home check refused before any open), head_mismatch (the S bundle's HEAD
   *  is not the head capture.sh committed) or post_turn (a post-turn step failed on what the agent wrote); null for every
   *  other gap. */
  gap_reason: string | null;
  /** pf_turns' record of the post-turn step that failed, for an arm gap or an infra gap alike; null when none did. */
  post_turn?: PfPostTurn | null;
  /** The unit's base commit (the session image's head); scoring checks that S's root is this commit. */
  base_commit: string | null;
  capture: Capture | null; forced: string[]; discarded: string[]; checks: string | null; s: { repo: string; ref: string } | null; transcript: string | null;
  claude_session: string | null; effort: Record<string, unknown> | null; questions: { ask_user_question: number; prose: number };
  /** The driver refused the task open with 409 CAP_STOP (the agent's LedgerCapStop): the part ends incomplete, with no gap and no retry. */
  cap_stop: boolean;
  env: typeof ARM_ENV; disallowed_tools: string[]; plugin: string | null; tools: string;
  /** Section 12: the slots' allowance stops that only calls still in flight caused (reservationBound), the subagents
   *  the session asked for and the ones the concurrent-subagent cap refused. */
  in_flight: { reservation_bound: number; subagents: number; subagent_cap_refused: number };
}

/** Writes pf-session.v1 once (exclusive create) after checking section 4's harness rules. */
export function writeSessionRecord(file: string, r: PfSessionRecord): void {
  if (r.schema !== "pf-session.v1" || Object.entries(ARM_ENV).some(([k, v]) => (r.env as Record<string, string>)[k] !== v) || DISALLOWED_TOOLS.some((t) => !r.disallowed_tools.includes(t))) pfFail("E_PF_ARM", "the session record breaks section 4's harness rules");
  if ((r.plugin !== null) !== (r.arm === "P" || r.arm === "blind")) pfFail("E_PF_ARM", "only P and the blind probe mount the pstack plugin");
  if (r.cap_stop && r.gap) pfFail("E_PF_INPUT", "a cap-stopped session is not a gap");
  if (!r.gap && !r.cap_stop && (!r.s || r.wrapup_end === null)) pfFail("E_PF_INPUT", "a session with no gap exports S and the wrap-up turn's end");
  if (!r.gap && !r.cap_stop && r.plugin !== null && !r.claude_session) pfFail("E_PF_INPUT", "a P or blind session with no gap names its claude-session.jsonl, where the skill body appears (section 8)");
  writeFileSync(file, JSON.stringify(r, null, 1) + "\n", { flag: "wx" });
}

/** Refusals at a slot's allowance check that only the worst cases of its calls still in flight caused: the slot's settled
 *  spend plus the refused call's own worst case would have fit the allowance. Read in order from the metering proxy's
 *  journal lines for the slot's meter; a call with no recorded spend counts at its full reservation, as the proxy
 *  counts it. */
export function reservationBound(lines: readonly Record<string, any>[], meterId: string, allowanceMicros: number): number {
  let settled = 0, bound = 0;
  const held = new Map<string, number>(), keyOf = new Map<string, string>();
  for (const j of lines) {
    if (j.kind === "reserve" && j.cell?.meter_id === meterId) held.set(j.idempotency_key, j.max_micros);
    else if (j.kind === "request" && held.has(j.idempotency_key)) keyOf.set(j.reservation_id, j.idempotency_key);
    else if (j.kind === "outcome" && j.meter_id === meterId) {
      const key = keyOf.get(j.reservation_id) ?? "";
      settled += j.outcome?.kind === "spent" ? j.outcome.spent_micros : (held.get(key) ?? 0);
      held.delete(key);
    } else if (j.kind === "refusal" && j.meter_id === meterId) {
      const worst = /cannot hold this call's worst case of \$(\d+(?:\.\d+)?)/.exec(String(j.reason ?? ""));
      if (worst && settled + Math.round(Number(worst[1]) * 1_000_000) <= allowanceMicros) bound++;
    }
  }
  return bound;
}
