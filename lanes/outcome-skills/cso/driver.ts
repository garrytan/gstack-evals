// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 4 and 14: the /cso stages the outcome driver (driver/stage.ts) serves. Each session model item names its
// arms as cso:<arm>; a stage serves both models under test, Opus 5.5 and particle-1, with one slot per session at that
// model's allowance ($8 and $3, or exactly twice it after stage 1's doubling rule). An item's recorded cap may not pass
// prereg.json's, or the re-priced cap the run thread passes for it after stage 1.
import { csoFail, loadCsoPrereg, type CsoPrereg } from "./prereg.ts";
import { csoLimits, modelId } from "./sessions.ts";
import type { CsoModel } from "./types.ts";

export const CSO_PREFIX = "cso:";
/** The program skill every cso item's spend is charged to. */
export const CSO_SKILL = "cso";
const tag = (arms: string[]) => arms.map((a) => CSO_PREFIX + a);
/** The session items and the arms each pays for: stages 0 and 1 run none, cso and untold; stage 2 runs none and cso. */
export const CSO_STAGES: Record<string, string[]> = { "cso-smoke": tag(["none", "cso", "untold"]), "cso-pilot": tag(["none", "cso", "untold"]), "cso-main": tag(["none", "cso"]) };
/** The Claude Code models the cso stages serve, as sessions name them to the driver. */
export const CSO_DRIVER_MODELS: Record<string, CsoModel> = { "claude-opus-5-5": "opus", "particle-ai/particle-1": "particle" };

export const isCsoArm = (arm: string): boolean => arm.startsWith(CSO_PREFIX);

/** The driver's model names from prereg.json (E_CSO_PREREG when they drift from CSO_DRIVER_MODELS). */
export function csoDriverModels(p: CsoPrereg = loadCsoPrereg()): string[] {
  const out = Object.entries(CSO_DRIVER_MODELS).map(([name, m]) => (modelId(m, p).replace(/^anthropic:/, "") === name ? name : csoFail("E_CSO_PREREG", "prereg.json names " + m + " as " + modelId(m, p) + ", not " + name)));
  return out;
}

/** One session's slot limits for a driver model: its allowance (prereg.json's or twice it), wall and turns. */
export function csoDriverLimits(model: string, allowance: Record<string, number> = {}, p: CsoPrereg = loadCsoPrereg()): { session_cap_usd: number; wall_limit_sec: number; max_turns: number } {
  const m = CSO_DRIVER_MODELS[model] ?? csoFail("E_CSO_SESSION", "model " + model + " is not one the cso stages serve: " + Object.keys(CSO_DRIVER_MODELS).join(", "));
  const l = csoLimits(m, p, allowance[model]);
  return { session_cap_usd: l.allowance_usd, wall_limit_sec: l.wall_sec, max_turns: l.max_turns };
}

/** The most an item's recorded cap may be: prereg.json's, or the re-priced cap given for it. */
export function csoItemCapUsd(item: string, caps: Record<string, number> = {}, p: CsoPrereg = loadCsoPrereg()): number {
  return caps[item] ?? p.items[item]?.cap ?? csoFail("E_CSO_PREREG", "prereg.json has no item " + item);
}
