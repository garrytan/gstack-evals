// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head extension's preregistration (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg, schema
// h2h-ext-prereg.v1): GPT-6.2 Sol in Codex CLI (part S), particle-1 in Claude Code (part P) and the smallest-change sentence
// on fresh units (part L). Its prereg.json holds every value the extension adds; everything else comes from the base post's
// prereg.json through ../prereg.ts. Code reads the extension's values here and nowhere else.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import type { Entry, H2hArm, Stage, UnitKind } from "../types.ts";

export const EXT_POST_ID = "2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg";
export const EXT_PREREG_PATH = join(import.meta.dir, "..", "..", "..", "..", "wiki", "plans", EXT_POST_ID, "prereg.json");

export const PARTS = ["S", "P", "L"] as const;
export type Part = (typeof PARTS)[number];
export const S_ARMS = ["s-none", "s-gstack", "s-gstack-line", "s-superpowers", "s-agent-skills", "s-gsd", "s-tstack"] as const;
export const P_ARMS = ["p-none", "p-gstack", "p-superpowers", "p-agent-skills", "p-gsd", "p-pstack", "p-tstack", "p-gstack-pony", "p-gstack-oneline"] as const;
export const L_ARMS = ["l-none", "l-gstack", "l-gstack-md", "l-gstack-task"] as const;
export const EXT_ARMS = [...S_ARMS, ...P_ARMS, ...L_ARMS] as const;
export type ExtArm = (typeof EXT_ARMS)[number];
export type Host = "codex" | "claude-code";

interface Limits { allowance_usd: number; wall_sec: number; max_turns: number }
type Entries<A extends string> = Record<A, { bug: string[]; feature: string[] }>;
export interface ExtPrereg {
  schema: "h2h-ext-prereg.v1";
  post: string;
  base: string;
  draw_seed: number;
  bootstrap_seed: number;
  order_seed: number;
  sentence: string;
  parts: {
    S: { model: string; host: "codex"; reasoning_effort: string; codex: { version: string; npm: string; platform_tgz: string; platform_tgz_sha256: string; binary: string; link_name: string; arg0_names_to_avoid: string[] }; arms: ExtArm[]; o_only: ExtArm[]; left_out: Record<string, string>; agents_md: Record<string, string>; agents_md_sha256: string; entries: Entries<(typeof S_ARMS)[number]>; limits: Limits; holm_m: number };
    P: { model: string; host: "claude-code"; route: { via: string; provider_only: string[]; data_collection: string; allow_fallbacks: boolean }; arms: ExtArm[]; o_only: ExtArm[]; base_arm: Record<(typeof P_ARMS)[number], H2hArm>; limits: Limits; holm_m: number };
    L: { model: string; host: "claude-code"; arms: ExtArm[]; claude_md: Record<string, string>; task_suffix: Record<string, string>; entries: Entries<(typeof L_ARMS)[number]>; limits: Limits; units: { n: number; reserve: number; pilot: number; repo_cap: number; min_counted: number } };
  };
  gstack: Record<Part, { repo: string; sha: string; tag?: string; version?: string; install?: string }>;
  gstack_config: { telemetry: string; env: Record<string, string> };
  sentence_family: { holm_within: number; min_point_diff: number };
  interim: { part: "S"; bounds_table: Record<string, [number, number]> };
  pilot: { o_units: number; b2_units: number; l_units: number };
  pilot_caps_usd: Record<ExtArm, number>;
  items: { id: string; what: string; central_usd: number; cap_usd: number }[];
  approved_all_in_cap_usd: number;
}

const u32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
const fail = (path: string, why: string): never => h2hFail("E_H2HX_PREREG", path + " " + why);

/** Reads and checks the extension's prereg.json (E_H2HX_PREREG): the schema, the three seeds, each part's arm list against
 *  this file's lists, an entry for every Codex and part L arm, a model and limits per part, the sentence, a pilot cap for
 *  every arm and the items. */
export function readExtPrereg(path: string = EXT_PREREG_PATH): ExtPrereg {
  if (!existsSync(path)) fail(path, "does not exist; the extension's frozen values live in its post bundle's prereg.json");
  let j: ExtPrereg;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail(path, "is not JSON: " + (e as Error).message);
  }
  if (j.schema !== "h2h-ext-prereg.v1") fail(path, "is not an h2h-ext-prereg.v1 file");
  for (const k of ["draw_seed", "order_seed", "bootstrap_seed"] as const) if (!u32(j[k])) fail(path, "has no unsigned 32-bit integer " + k);
  if (typeof j.sentence !== "string" || !j.sentence) fail(path, "has no sentence");
  const want: Record<Part, readonly string[]> = { S: S_ARMS, P: P_ARMS, L: L_ARMS };
  for (const part of PARTS) {
    const p = j.parts?.[part];
    if (!p) fail(path, "has no part " + part);
    if ((p.arms ?? []).join(",") !== want[part].join(",")) fail(path, "lists part " + part + " arms " + (p.arms ?? []).join(",") + ", not " + want[part].join(","));
    if (typeof p.model !== "string" || !p.model) fail(path, "has no model for part " + part);
    const l = p.limits;
    if (!(l?.allowance_usd > 0 && l.wall_sec > 0 && l.max_turns > 0)) fail(path, "has no limits for part " + part);
    if (!j.gstack?.[part]?.sha) fail(path, "has no gstack pin for part " + part);
  }
  for (const a of [...S_ARMS, ...L_ARMS]) {
    const e = (j.parts.S.entries as Record<string, unknown>)[a] ?? (j.parts.L.entries as Record<string, unknown>)[a];
    if (!e) fail(path, "has no entry for arm " + a);
  }
  for (const a of P_ARMS) if (!j.parts.P.base_arm?.[a]) fail(path, "maps part P arm " + a + " to no base arm");
  for (const a of EXT_ARMS) if (!(j.pilot_caps_usd?.[a] > 0)) fail(path, "has no pilot cap for arm " + a);
  if (!Array.isArray(j.items) || !j.items.length) fail(path, "has no items");
  return j;
}

export const partOf = (arm: ExtArm): Part => (arm.startsWith("s-") ? "S" : arm.startsWith("p-") ? "P" : "L");
export const hostOf = (arm: ExtArm, x: ExtPrereg = readExtPrereg()): Host => x.parts[partOf(arm)].host;
export const modelOf = (arm: ExtArm, x: ExtPrereg = readExtPrereg()): string => x.parts[partOf(arm)].model;
export const limitsOf = (arm: ExtArm, x: ExtPrereg = readExtPrereg()): Limits => x.parts[partOf(arm)].limits;

/** The arms one unit runs in a part: every arm of the part on O units, all but the part's O-only arms on B2 units. Part L
 *  runs O units only. */
export function extArmsFor(part: Part, kind: UnitKind, x: ExtPrereg = readExtPrereg()): ExtArm[] {
  if (kind === "B1") h2hFail("E_H2HX_INPUT", "the extension runs no B1 units");
  if (part === "L" && kind !== "O") h2hFail("E_H2HX_INPUT", "part L runs O units only");
  const p = x.parts[part];
  const oOnly = new Set<string>("o_only" in p ? p.o_only : []);
  return p.arms.filter((a) => kind === "O" || !oOnly.has(a));
}

/** The ledger item that pays for a session: h2hx-<part>-pilot in stages 0 and 1, h2hx-<part>-main in stage 2. */
export function extItemOf(stage: Stage, arm: ExtArm, x: ExtPrereg = readExtPrereg()): string {
  const id = "h2hx-" + partOf(arm).toLowerCase() + (stage === "stage2" ? "-main" : "-pilot");
  if (!x.items.some((i) => i.id === id)) h2hFail("E_H2HX_PREREG", "the extension's prereg.json lists no item " + id);
  return id;
}

const STATEMENT = "{problem statement}";
/** T, from the base post's texts.task, with part L's task suffix for l-gstack-task. */
export function extTaskText(arm: ExtArm, statement: string, x: ExtPrereg = readExtPrereg(), base: H2hPrereg = readPrereg()): string {
  const s = statement.replace(/\s+$/u, "");
  if (!s.trim()) h2hFail("E_H2HX_INPUT", "the problem statement is empty; T needs the unit's statement");
  if (base.texts.task.split(STATEMENT).length !== 2) h2hFail("E_H2H_PREREG", "texts.task holds " + STATEMENT + " other than once");
  const t = base.texts.task.replace(STATEMENT, () => s);
  return t + (partOf(arm) === "L" ? (x.parts.L.task_suffix[arm] ?? "") : "");
}

/** The arm's scripted turns for one entry, by the base post's entry_rule: a string ending in a space is a prefix for T,
 *  the empty string is T alone, any other string is a whole turn. Part P arms take their base arm's entries and T
 *  (p-gstack-oneline's T carries the sentence, as in the base post); parts S and L take this file's entries. */
export function extScriptedTurns(arm: ExtArm, entry: Entry, statement: string, x: ExtPrereg = readExtPrereg(), base: H2hPrereg = readPrereg()): string[] {
  const part = partOf(arm);
  let list: string[] | undefined;
  let t: string;
  if (part === "P") {
    const b = x.parts.P.base_arm[arm as (typeof P_ARMS)[number]];
    list = base.entries[b]?.[entry];
    t = extTaskText(arm, statement, x, base) + (b === "gstack-oneline" ? "\n\n" + base.texts.oneline : "");
  } else {
    list = (part === "S" ? (x.parts.S.entries as Record<string, { bug: string[]; feature: string[] }>) : (x.parts.L.entries as Record<string, { bug: string[]; feature: string[] }>))[arm]?.[entry];
    t = extTaskText(arm, statement, x, base);
  }
  if (!list?.length) return h2hFail("E_H2HX_INPUT", "arm " + arm + " has no " + entry + " entry");
  const turns = list.map((e) => (e === "" || e.endsWith(" ") ? e + t : e));
  if (!turns.some((s) => s.includes(t))) h2hFail("E_H2HX_PREREG", "arm " + arm + "'s " + entry + " entry never carries T");
  return turns;
}
