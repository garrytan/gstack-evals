// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's two supply screens and its draw (prereg 2026-11-24-geva-587-design-time-state-modeling section 2), on units that
// passed attempt 3's authoring. Every model call is a function the caller passes in, so the tests make none.
//
// - State-shaped: GPT-6.2 Astra and Opus 5.5 each read F's message, F's diff and the hint, and answer the state machines
//   eval's two questions with its eight-class definition and answer format, word for word (lanes/outcome-skills/
//   statemachines/packets.ts LABEL_QUESTIONS, STATE_SHAPED, LABEL_FORMAT), as one JSON packet in that lane's shape. A unit
//   is eligible only when both say defect and both say state-shaped; a malformed answer fails closed, as that lane reads
//   it. Agreement prints as Cohen's kappa on each question.
// - Reachable: Gemini 4 Carbon, then Opus 5.5, each with the plan, the stubbed region files, their callers and the hint,
//   never F's diff (prompts/reach.md, attempt 3's rater prompt with this eval's question and a REACH line), answer yes,
//   maybe or no. An answer without its line is asked once more; a second drops the unit (reach-unreadable). A unit stays
//   when neither says no and at least one says yes; "both yes" is kept for the primary's second print.
// - Only a unit that passed the state screen is rated for reach, so a dropped unit spends nothing more.
// - Draw: attempt 3's walk (stages/author.ts): units in the seeded order (sha256 of "<seed>/<unit id>"), a unit whose
//   repository already has 3 drawn units skipped; a passing unit fills calibration (6) first, then comparison (64, not
//   both foreseeability raters "no"), then reserve (6).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cohenKappa, combineLabels, LABEL_FORMAT, LABEL_QUESTIONS, readLabelAnswer, STATE_SHAPED, type LabelAnswer } from "../../outcome-skills/statemachines/packets.ts";
import { renderFiles, unforeseeable, type SourceFile } from "../stages/author.ts";
import type { Foresee } from "../types.ts";
import { E1 } from "./frozen.ts";

export type SupplyRole = "stateAstra" | "stateOpus" | "reachCarbon" | "reachOpus";
export const SUPPLY_MODELS: Readonly<Record<SupplyRole, string>> = { stateAstra: "openai/gpt-6.2-astra", stateOpus: "anthropic/claude-opus-5-5", reachCarbon: "google/gemini-4-carbon", reachOpus: "anthropic/claude-opus-5-5" };
export type SupplyCall = (role: SupplyRole, prompt: string, attempt?: number) => Promise<{ text: string; costUsd: number }>;

/** The state labellers' prompt: the state machines eval's packet body, with F's message, F's diff and the hint. */
export function statePrompt(m: { message: string; diff: string; hint: string }): { prompt: string; digest: string } {
  const body = { questions: LABEL_QUESTIONS, state_shaped: STATE_SHAPED, answer_format: LABEL_FORMAT, message: m.message, fix: m.diff, hint: m.hint };
  const prompt = JSON.stringify(body);
  return { prompt, digest: createHash("sha256").update(prompt).digest("hex").slice(0, 16) };
}

const fill = (t: string, slots: Record<string, string>) => Object.entries(slots).reduce((s, [k, v]) => s.split("{{" + k + "}}").join(v), t);
export const REACH_PROMPT = join(import.meta.dir, "prompts", "reach.md");
export const reachPrompt = (plan: string, m: { stubbed: SourceFile[]; callers: SourceFile[] }, hint: string): string => fill(readFileSync(REACH_PROMPT, "utf8"), { PLAN: plan.trim(), STUBBED: renderFiles(m.stubbed), CALLERS: renderFiles(m.callers), HINT: hint.trim() });

/** The last REACH line's word, or null. */
export function parseReach(answer: string): Foresee | null {
  const hits = answer.split("\n").map((l) => /^REACH:\s*(yes|maybe|no)\s*$/i.exec(l.trim().replace(/^\*\*|\*\*$/g, ""))?.[1] ?? null).filter((x): x is string => x !== null);
  return (hits.at(-1)?.toLowerCase() as Foresee | undefined) ?? null;
}
export const reachKeeps = (r: readonly [Foresee, Foresee]): boolean => !r.includes("no") && r.includes("yes");

export interface ScreenRecord {
  state: { astra: LabelAnswer | null; opus: LabelAnswer | null; eligible: boolean; packet: string };
  reach: [Foresee, Foresee] | null;
  drop: "state" | "reach-unreadable" | "reach" | null;
  bothYes: boolean;
  costUsd: number;
}

export async function screenUnit(call: SupplyCall, m: { message: string; diff: string; hint: string; plan: string; stubbed: SourceFile[]; callers: SourceFile[] }): Promise<ScreenRecord> {
  let cost = 0;
  const ask = async (role: SupplyRole, p: string, attempt?: number) => {
    const r = await call(role, p, attempt);
    cost += r.costUsd;
    return r.text;
  };
  const sp = statePrompt(m);
  const read = (t: string) => {
    const a = readLabelAnswer(t);
    return a.ok ? a.answer : null;
  };
  const astra = read(await ask("stateAstra", sp.prompt));
  const opus = read(await ask("stateOpus", sp.prompt));
  const c = combineLabels(astra, opus);
  const eligible = c.eligible && c.stratum === "state";
  const state = { astra, opus, eligible, packet: sp.digest };
  if (!eligible) return { state, reach: null, drop: "state", bothYes: false, costUsd: cost };
  const rp = reachPrompt(m.plan, m, m.hint);
  const rate = async (role: "reachCarbon" | "reachOpus") => parseReach(await ask(role, rp)) ?? parseReach(await ask(role, rp, 2));
  const carbon = await rate("reachCarbon");
  const o = carbon === null ? null : await rate("reachOpus");
  if (carbon === null || o === null) return { state, reach: null, drop: "reach-unreadable", bothYes: false, costUsd: cost };
  const reach: [Foresee, Foresee] = [carbon, o];
  return { state, reach, drop: reachKeeps(reach) ? null : "reach", bothYes: carbon === "yes" && o === "yes", costUsd: cost };
}

/** Cohen's kappa on each state question, over units where both answers read. */
export function stateAgreement(rows: ReadonlyArray<ScreenRecord>): { defect: number | null; stateShaped: number | null; n: number } {
  const both = rows.filter((r) => r.state.astra && r.state.opus);
  return { defect: cohenKappa(both.map((r) => [r.state.astra!.defect, r.state.opus!.defect] as const)), stateShaped: cohenKappa(both.map((r) => [r.state.astra!.state_shaped, r.state.opus!.state_shaped] as const)), n: both.length };
}

export interface DrawUnit {
  id: string;
  repo: string;
  /** Passed attempt 3's authoring (plan, audits, hint, foreseeability ratings, hinted build). */
  authored: boolean;
  foresee: readonly [Foresee, Foresee] | null;
  screen: ScreenRecord | null;
}

export interface E1Draw {
  seed: string;
  calibration: string[];
  comparison: string[];
  reserve: string[];
  skipped: Array<{ id: string; reason: string }>;
  /** The walk reached a unit with no screen record yet, so later units wait. */
  waiting: string | null;
}

const order = (seed: string, ids: readonly string[]) => [...ids].sort((a, b) => {
  const k = (x: string) => createHash("sha256").update(seed + "/" + x).digest("hex");
  return k(a) < k(b) ? -1 : 1;
});

/** Attempt 3's walk over the seeded order with this eval's screens; it stops at the first passing unit not yet screened. */
export function e1Draw(seed: string, units: readonly DrawUnit[]): E1Draw {
  const by = new Map(units.map((u) => [u.id, u]));
  const d: E1Draw = { seed, calibration: [], comparison: [], reserve: [], skipped: [], waiting: null };
  const perRepo = new Map<string, number>();
  for (const id of order(seed, units.map((u) => u.id))) {
    const u = by.get(id)!;
    if (!u.authored) {
      d.skipped.push({ id, reason: "authoring" });
      continue;
    }
    if (!u.screen) {
      d.waiting = id;
      break;
    }
    if (u.screen.drop) {
      d.skipped.push({ id, reason: u.screen.drop });
      continue;
    }
    if ((perRepo.get(u.repo) ?? 0) >= E1.units.perRepo) {
      d.skipped.push({ id, reason: "repository" });
      continue;
    }
    const comparable = !unforeseeable(u.foresee);
    const set = d.calibration.length < E1.units.calibration ? d.calibration : !comparable ? null : d.comparison.length < E1.units.target ? d.comparison : d.reserve.length < E1.units.reserve ? d.reserve : null;
    if (set === null) {
      d.skipped.push({ id, reason: comparable ? "full" : "unforeseeable" });
      continue;
    }
    set.push(id);
    perRepo.set(u.repo, (perRepo.get(u.repo) ?? 0) + 1);
    if (d.reserve.length === E1.units.reserve) break;
  }
  return d;
}
