// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's build units and build arms (prereg 2026-11-09-geva-417, section 12 "Build units", "Build arms" and section
// 6's stage 3 row). 16 comparison units, 4 of each developer-facing class where supply allows, drawn in seeded order
// among units whose project builds and installs in the sandbox at base and at the merge; a unit whose goal record fails
// its audit twice is replaced by the next unit in seeded order. Four build arms per unit, 1 trial each, all by Opus 5.5
// in Claude Code with no gstack: plan.md plus each arm's normalized block from its stage 2 Opus pass 1, mapped back from
// aliases to the real names, under the frozen prompt and limits ($8, 300 turns, 2 hours).
import type { AliasMap, ArmId, DevClass, Row, UnitMeta } from "../types.ts";
import { MODEL_STRINGS } from "../types.ts";
import { normalize, renderList } from "../run/parse.ts";
import { unaliasText } from "../unit/alias.ts";
import type { AuditResult } from "./goal.ts";

export const BUILD_UNITS = 16;
export const PER_CLASS = 4;
export const CLASSES: readonly DevClass[] = ["CLI", "API", "SDK", "CONFIG"];
export const AUDIT_TRIES = 2;
export const BUILD_PROMPT = "Implement the plan in plan.md in /work/repo, with its docs and tests. A reviewer's notes on the plan follow; use them as you see fit.";
export const BUILD_LIMITS = { dollars: 8, turns: 300, minutes: 120 } as const;
export const BUILD_MODEL = MODEL_STRINGS.opus;
/** The build session's environment: Claude Code's bundled skills off in every arm, and no gstack anywhere. */
export const BUILD_ENV: Readonly<Record<string, string>> = { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };

export interface DrawDeps {
  /** Whether the unit's project builds and installs in the sandbox at base and at the merge. */
  buildable(u: UnitMeta): Promise<boolean>;
  /** One audit attempt of the unit's goal record against the real merged tree. */
  audit(u: UnitMeta, attempt: number): Promise<AuditResult>;
}

export interface BuildDraw {
  units: string[];
  by_class: Record<DevClass, number>;
  not_buildable: string[];
  /** Units whose goal record failed its audit twice, in the order they were replaced. */
  replaced: Array<{ unit: string; problems: string[] }>;
  /** Classes that ended under 4 units; their slots went to other classes in seeded order. */
  short: DevClass[];
}

/**
 * The seeded order is the comparison set's draw order (UnitMeta.rank). The first pass fills each class up to 4 in that
 * order; when a class runs out, a second pass fills the remaining slots from the units the first pass passed over, in the
 * same order.
 */
export async function drawBuildUnits(comparison: readonly UnitMeta[], deps: DrawDeps): Promise<BuildDraw> {
  const order = comparison.filter((u) => u.set === "comparison").sort((a, b) => a.rank - b.rank);
  const by_class = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<DevClass, number>;
  const out: BuildDraw = { units: [], by_class, not_buildable: [], replaced: [], short: [] };
  const seen = new Set<string>();
  const take = async (u: UnitMeta) => {
    seen.add(u.id);
    if (!(await deps.buildable(u))) return void out.not_buildable.push(u.id);
    let last: AuditResult | null = null;
    for (let attempt = 1; attempt <= AUDIT_TRIES; attempt++) {
      last = await deps.audit(u, attempt);
      if (last.pass) {
        out.units.push(u.id);
        by_class[u.dev_class]++;
        return;
      }
    }
    out.replaced.push({ unit: u.id, problems: last?.problems ?? [] });
  };
  for (const u of order) if (out.units.length < BUILD_UNITS && by_class[u.dev_class] < PER_CLASS) await take(u);
  out.short = CLASSES.filter((c) => by_class[c] < PER_CLASS);
  for (const u of order) if (out.units.length < BUILD_UNITS && !seen.has(u.id)) await take(u);
  return out;
}

/** The arm's stage 2 Opus pass 1 row for the unit (never a smoke pass). */
export const passOne = (rows: readonly Row[], unit: string, arm: ArmId): Row | undefined => rows.find((r) => r.unit === unit && r.arm === arm && r.model === "opus" && r.stage === 2 && r.pass === 1 && !r.smoke);

/** The arm's normalized block as numbered lines, mapped back from aliases to the real names; empty without a block. */
export function armBlock(rows: readonly Row[], unit: string, arm: ArmId, alias: AliasMap): string {
  const r = passOne(rows, unit, arm);
  if (!r || r.end !== "block" || !r.list) return "";
  return unaliasText(renderList(normalize(r.list)), alias);
}

export const buildPrompt = (block: string): string => (block ? BUILD_PROMPT + "\n\n" + block : BUILD_PROMPT);

/** What a build session ended with, as the controller saw it in the sandbox. */
export interface BuildEnd {
  base_installs: boolean;
  /** Whether the session ended with a tree at /work/repo. */
  tree: boolean;
  /** Whether the sandbox built and installed the artifact from the final tree. */
  tree_installs: boolean;
}

/**
 * Section 6's stage 3 row: a build with no tree, or a tree the sandbox can't install, scores first success 0 and is
 * counted and printed; the code is E_DX_BUILD_INSTRUMENT when the unit's base fails to install. Null means the build
 * goes on to the docs-only session.
 */
export function buildInstrument(e: BuildEnd): { first_success: 0; code: "E_DX_BUILD_INSTRUMENT" | null; why: "base does not install" | "no tree" | "tree does not install" } | null {
  if (!e.base_installs) return { first_success: 0, code: "E_DX_BUILD_INSTRUMENT", why: "base does not install" };
  if (!e.tree) return { first_success: 0, code: null, why: "no tree" };
  if (!e.tree_installs) return { first_success: 0, code: null, why: "tree does not install" };
  return null;
}
