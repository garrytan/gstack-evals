// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 3's positions and section 12's supply rule. Usable positions count from 1 in the build's order. Stage 0
// and stage 1 take prereg.json's frozen positions; one re-pilot block takes the first unused usable positions (from 3
// upward) whose repository meets the raise's size rule; stage 2 takes the next unused positions from 3 upward, skipping
// every stage 0, stage 1 and re-pilot position, until it has n2 units (meeting the raise's rule when one applies); the
// next 8 unused positions are reserves. The supply check fills stage 0, stage 1, one re-pilot block, stage 2 at its cap
// and the reserves.
import { csoFail, type CsoPrereg } from "../prereg.ts";
import type { CsoArm, CsoModel, CsoStage, UnitRecord } from "../types.ts";

export interface DrawPlan { stage0: number[]; stage1: number[]; repilot: number; n2_min: number; n2_max: number; n2_step: number; reserve: number; size_split: number; supply: number }

const num = (s: unknown, re: RegExp, what: string): number => {
  const m = re.exec(String(s));
  return m ? Number(m[1]) : csoFail("E_CSO_PREREG", "prereg.json states no " + what);
};

/** The draw's frozen numbers, read from prereg.json (E_CSO_PREREG when one is missing or the supply sum differs from
 *  the 134 the plan states). */
export function drawPlan(p: CsoPrereg): DrawPlan {
  const pos = p.units.positions as { stage0: number[]; stage1: number[]; reserve: string; n2_rule: string };
  const h = p.headroom as { of: number; size_split_files: number };
  const plan: DrawPlan = {
    stage0: pos.stage0,
    stage1: pos.stage1,
    repilot: h.of,
    n2_min: num(pos.n2_rule, /from (\d+) to \d+/, "n2 floor"),
    n2_max: num(pos.n2_rule, /from \d+ to (\d+)/, "n2 cap"),
    n2_step: num(pos.n2_rule, /multiple of (\d+)/, "n2 step"),
    reserve: num(pos.reserve, /next (\d+) unused/, "reserve count"),
    size_split: h.size_split_files,
    supply: 0,
  };
  plan.supply = plan.stage0.length + plan.stage1.length + plan.repilot + plan.n2_max + plan.reserve;
  const stated = num((p.arm_pilot as { shows: string[] }).shows.join(" "), /fills every usable position the plan can use \((\d+)\)/, "supply count");
  if (plan.supply !== stated) csoFail("E_CSO_PREREG", "the positions sum to " + plan.supply + " but the plan states " + stated);
  return plan;
}

export type Raise = "floor" | "ceiling";
export interface Drawn { unit: string; position: number; role: CsoStage | "reserve" }
export interface Draw { schema: "cso-draw.v1"; n2: number; raise: Raise | null; units: Drawn[] }

/** The draw over built units in position order (E_CSO_DRAW when n2 or the raise is not one the plan allows, or the
 *  units don't fill it). */
export function draw(plan: DrawPlan, units: readonly Pick<UnitRecord, "unit" | "position" | "source_files">[], n2: number, raise: Raise | null = null): Draw {
  if (!Number.isInteger(n2) || n2 < plan.n2_min || n2 > plan.n2_max || n2 % plan.n2_step) csoFail("E_CSO_DRAW", "n2 " + n2 + " is not a multiple of " + plan.n2_step + " from " + plan.n2_min + " to " + plan.n2_max);
  if (raise !== null && raise !== "floor" && raise !== "ceiling") csoFail("E_CSO_DRAW", "raise " + String(raise) + " is not floor or ceiling");
  const byPos = [...units].sort((a, b) => a.position - b.position);
  byPos.forEach((u, i) => u.position !== i + 1 && csoFail("E_CSO_DRAW", "positions are not 1 to " + byPos.length + " in order"));
  const at = (n: number) => byPos[n - 1] ?? csoFail("E_CSO_DRAW", "position " + n + " is not filled (" + byPos.length + " built)");
  const meets = (u: { source_files: number }) => raise === null || (raise === "floor" ? u.source_files <= plan.size_split : u.source_files > plan.size_split);
  const out: Drawn[] = [];
  const used = new Set<number>();
  const take = (n: number, role: Drawn["role"]) => {
    used.add(n);
    out.push({ unit: at(n).unit, position: n, role });
  };
  for (const n of plan.stage0) take(n, "stage0");
  for (const n of plan.stage1) take(n, "stage1");
  const next = (count: number, role: Drawn["role"], rule: boolean) => {
    let got = 0;
    for (let n = 3; got < count; n++) {
      if (n > byPos.length) csoFail("E_CSO_DRAW", role + " needs " + count + " units and the build ran out at " + got);
      if (used.has(n) || (rule && !meets(at(n)))) continue;
      take(n, role);
      got++;
    }
  };
  if (raise) next(plan.repilot, "repilot", true);
  next(n2, "stage2", true);
  next(plan.reserve, "reserve", true);
  return { schema: "cso-draw.v1", n2, raise, units: out };
}

export interface Ordered { unit: string; model: CsoModel; arm: CsoArm }

/** Section 12's stage 2 order: the stage 2 units in draw order, each unit's four cells (Opus none and cso, particle-1
 *  none and cso) shuffled by one mulberry32 stream seeded with prereg.json's order_seed, so arms interleave within each
 *  unit. */
export function stage2Order(d: Draw, seed: number): Ordered[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return d.units.filter((u) => u.role === "stage2").flatMap((u) => {
    const cells: Ordered[] = [["opus", "none"], ["opus", "cso"], ["particle", "none"], ["particle", "cso"]].map(([model, arm]) => ({ unit: u.unit, model: model as CsoModel, arm: arm as CsoArm }));
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    return cells;
  });
}
