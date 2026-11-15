// Copyright (c) 2026 Garry Tan. MIT License.
// The skill-pack head-to-head preregistration (wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg, schema h2h-prereg.v1)
// and the lane's refusal helper. prereg.json in the post bundle is the one source for seeds, pins, texts, entries, limits,
// lists and analysis constants; code reads it here and nowhere else. Every refusal message starts with its reason code.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { ALL_ARMS, type H2hArm } from "./types.ts";

export class H2hError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}
export const h2hFail = (code: ReasonCode, message: string): never => {
  throw new H2hError(code, message);
};

export const POST_ID = "2026-11-15-geva-538-skill-pack-h2h-prereg";
export const PREREG_PATH = join(import.meta.dir, "..", "..", "..", "wiki", "plans", POST_ID, "prereg.json");

export interface Pin { repo: string; sha: string; version?: string; marketplace?: string; npm?: string; path?: string; tree?: string }
export interface H2hPrereg {
  schema: "h2h-prereg.v1";
  post: string;
  draw_seed: number;
  bootstrap_seed: number;
  order_seed: number;
  model: string;
  arms: { primary: H2hArm[]; piece_g: H2hArm[]; secondary: H2hArm[] };
  pins: Record<string, Pin>;
  gstack_claude_md: string;
  texts: { task: string; question_reply: string; continuation: string; oneline: string };
  entries: Record<H2hArm, { bug?: string[]; feature?: string[] }>;
  done_rule: { last_nonempty_lines: number; strip: string; case_insensitive: boolean; word: string };
  continuation_cap: number;
  limits: { allowance_usd: number; wall_sec: number; max_turns: number };
  env: Record<string, string>;
  disallowed_tools: string[];
  exclusion: string[];
  licences: string[];
  classes: {
    O: { n: number; reserve: number; stage1: number; window_from: string; walk_back_to: string; repo_cap: number };
    B: { n: number; reserve: number; stage1: number; b1_share_max: number; b1_min_units: number; window: [string, string]; widen_to: string; repo_cap: number; browser_oracle_runs: number };
  };
  analysis: { incomplete_gap_share: number; exposure_floor: number; piece_g: { adopt_min_point_diff: number } };
  stage1_release: string[];
  items: string[];
}

const u32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

/** Reads and checks prereg.json. Refuses (E_H2H_PREREG) on a missing file, bad JSON, another schema, a seed that is not an
 *  unsigned 32-bit integer, an arm list that differs from types.ts, or a missing text, entry or list. */
export function readPrereg(path: string = PREREG_PATH): H2hPrereg {
  if (!existsSync(path)) h2hFail("E_H2H_PREREG", path + " does not exist; the head-to-head's frozen values live in the post bundle's prereg.json");
  let j: H2hPrereg;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return h2hFail("E_H2H_PREREG", path + " is not JSON: " + (e as Error).message);
  }
  if (j.schema !== "h2h-prereg.v1") h2hFail("E_H2H_PREREG", path + " is not an h2h-prereg.v1 file");
  for (const k of ["draw_seed", "order_seed", "bootstrap_seed"] as const) if (!u32(j[k])) h2hFail("E_H2H_PREREG", path + " has no unsigned 32-bit integer " + k);
  const arms = [...(j.arms?.primary ?? []), ...(j.arms?.piece_g ?? []), ...(j.arms?.secondary ?? [])];
  if (arms.join(",") !== ALL_ARMS.join(",")) h2hFail("E_H2H_PREREG", path + " lists arms " + arms.join(",") + ", not " + ALL_ARMS.join(","));
  for (const a of ALL_ARMS) if (!j.entries?.[a]) h2hFail("E_H2H_PREREG", path + " has no entry for arm " + a);
  for (const k of ["task", "question_reply", "continuation", "oneline"] as const) if (typeof j.texts?.[k] !== "string" || !j.texts[k]) h2hFail("E_H2H_PREREG", path + " has no text " + k);
  if (!Array.isArray(j.exclusion) || !j.exclusion.length || !Array.isArray(j.licences) || !j.licences.length) h2hFail("E_H2H_PREREG", path + " has no exclusion or licence list");
  if (!Number.isInteger(j.continuation_cap) || j.continuation_cap < 1) h2hFail("E_H2H_PREREG", path + " has no continuation cap");
  return j;
}
