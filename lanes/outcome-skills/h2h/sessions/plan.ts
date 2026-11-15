// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's session plan (post sections 5, 6 and 11): which arms run on a unit, which ledger item pays for each
// session, and one stage's sessions in a seeded order that interleaves the arms within each unit, so time-of-day and
// provider drift hit every arm alike. The order comes from prereg.json's order_seed plus the stage's number, through the
// same seededRandom stream the pstack-checks plan uses (one stream per stage, each unit's arms shuffled in turn).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { seededRandom } from "../../../../src/runner/stats/paired.ts";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import { ALL_ARMS, PIECE_G_ARMS, PRIMARY_ARMS, SECONDARY_ARMS, type Entry, type H2hArm, type H2hUnit, type Stage, type UnitKind } from "../types.ts";
import { entryOf } from "./turns.ts";

export const STAGE_PART: Record<Stage, number> = { stage0: 0, stage1: 1, stage2: 2 };
const STAGE_ITEM: Record<Exclude<Stage, "stage2">, string> = { stage0: "h2h-smoke", stage1: "h2h-pilot" };

/** One planned session. index is its place in the stage's order. */
export interface H2hPlanned { unit: string; kind: UnitKind; entry: Entry; stage: Stage; index: number; arm: H2hArm; item: string }
export interface H2hPlan { schema: "h2h-plan.v1"; stage: Stage; order_seed: number; sessions: H2hPlanned[] }

/** The arms a unit runs (section 11): every primary arm on every unit, piece G's two arms on O units, gstack /qa on B1. */
export function armsFor(kind: UnitKind): H2hArm[] {
  return [...PRIMARY_ARMS, ...(kind === "O" ? PIECE_G_ARMS : []), ...(kind === "B1" ? SECONDARY_ARMS : [])];
}

/** The ledger item that pays for one session: h2h-smoke and h2h-pilot pay for every arm of stages 0 and 1; in stage 2,
 *  h2h-opus pays for the primary arms, h2h-pony for piece G's and h2h-qa for gstack /qa. */
export function itemOf(stage: Stage, arm: H2hArm, p: H2hPrereg = readPrereg()): string {
  const item = stage !== "stage2" ? STAGE_ITEM[stage] : (PIECE_G_ARMS as readonly string[]).includes(arm) ? "h2h-pony" : (SECONDARY_ARMS as readonly string[]).includes(arm) ? "h2h-qa" : "h2h-opus";
  if (!p.items.includes(item)) h2hFail("E_H2H_PREREG", "prereg.json lists no item " + item);
  return item;
}

/** One stage's sessions in order: per unit in the order given, every arm the unit runs, shuffled by one
 *  seededRandom(order_seed + stage number) stream. A unit drawn for another stage, a duplicate unit or a unit of the
 *  wrong class for its kind is refused; a reserve unit may stand in for a unit that dropped before any model run. */
export function planStage(units: H2hUnit[], stage: Stage, p: H2hPrereg = readPrereg()): H2hPlan {
  if (!Object.hasOwn(STAGE_PART, stage)) h2hFail("E_H2H_SESSION_INPUT", "stage " + stage + " is not stage0, stage1 or stage2");
  const seen = new Set<string>();
  for (const u of units) {
    if (seen.has(u.id)) h2hFail("E_H2H_SESSION_INPUT", "unit " + u.id + " is listed twice");
    seen.add(u.id);
    if (u.stage !== stage && u.stage !== "reserve") h2hFail("E_H2H_SESSION_INPUT", "unit " + u.id + " was drawn for " + u.stage + ", not " + stage);
    if ((u.kind === "O") !== (u.class === "O")) h2hFail("E_H2H_SESSION_INPUT", "unit " + u.id + " is kind " + u.kind + " in class " + u.class);
  }
  const rand = seededRandom(p.order_seed + STAGE_PART[stage]);
  const sessions: H2hPlanned[] = [];
  for (const u of units) {
    const arms = armsFor(u.kind);
    for (let i = arms.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arms[i], arms[j]] = [arms[j]!, arms[i]!];
    }
    for (const arm of arms) sessions.push({ unit: u.id, kind: u.kind, entry: entryOf(u), stage, index: sessions.length, arm, item: itemOf(stage, arm, p) });
  }
  return { schema: "h2h-plan.v1", stage, order_seed: p.order_seed, sessions };
}

/** Writes a plan once (exclusive create): a stage's order is never rewritten. */
export function writePlan(file: string, plan: H2hPlan): void {
  if (existsSync(file)) h2hFail("E_H2H_SESSION_INPUT", file + " already exists; a stage's session plan is written once");
  writeFileSync(file, JSON.stringify(plan, null, 1) + "\n", { flag: "wx" });
}

/** Reads a plan and refuses one that is not h2h-plan.v1 or whose sessions name an unknown arm or a broken order. */
export function readPlan(file: string): H2hPlan {
  let j: H2hPlan;
  try {
    j = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return h2hFail("E_H2H_SESSION_INPUT", file + " is not a readable plan: " + (e as Error).message);
  }
  if (j?.schema !== "h2h-plan.v1" || !Array.isArray(j.sessions)) h2hFail("E_H2H_SESSION_INPUT", file + " is not an h2h-plan.v1 file");
  j.sessions.forEach((s, i) => {
    if (s.index !== i || !(ALL_ARMS as readonly string[]).includes(s.arm) || s.stage !== j.stage) h2hFail("E_H2H_SESSION_INPUT", file + " session " + i + " is not in the plan's order, names arm " + s.arm + " or another stage");
  });
  return j;
}
