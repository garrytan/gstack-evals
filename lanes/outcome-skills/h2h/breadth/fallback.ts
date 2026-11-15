// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6's draw sizes and fallbacks for B, over usable units (units that passed every gate, counted per frame and
// window). B1 fills up to half of B's n; B2 fills the rest. B1 under 20 usable units: widen to 2025-06-01, then add the
// pinned MultiLang rows that pass the browser checks; still under 20, B1 is infeasible at this scale (never loosened)
// and B is B2 alone. B2 short of its share: widen to 2025-06-01. Both windows were mined in one frozen run, so a widening
// only lets the draw read the rows already tagged widened. Stage 1 positions count the frame's usable units in draw
// order, so a frame reaches only the positions its usable count covers; reserves and stage 0 come after the units.
import { readPrereg, type H2hPrereg } from "../prereg.ts";

export interface Supply { primary: number; widened: number }
export interface FramePlan { usable: number; units: number; reserves: number; stage0: number; steps: string[]; stage1_positions: number[] }
export interface BPlan { n: number; b1: FramePlan & { target: number; infeasible: boolean; code: "E_H2H_B_INFEASIBLE" | null }; b2: FramePlan & { share: number; short: number } }

export const stage1Positions = (p: H2hPrereg): number[] => (p.classes.B as { stage1_positions?: number[] }).stage1_positions ?? Array.from({ length: p.classes.B.stage1 / 2 }, (_, i) => 6 * (i + 1));

export function planB(s: { b1: Supply & { multilang: number }; b2: Supply }, p: H2hPrereg = readPrereg()): BPlan {
  const B = p.classes.B;
  const positions = stage1Positions(p);
  const frame = (usable: number, units: number, steps: string[]): FramePlan => {
    const reserves = Math.min(B.reserve, usable - units);
    return { usable, units, reserves, stage0: usable - units - reserves > 0 ? 1 : 0, steps, stage1_positions: positions.filter((x) => x <= usable) };
  };
  const target = Math.floor(B.n * B.b1_share_max);
  const b1Steps: string[] = [];
  let b1 = s.b1.primary;
  if (b1 < B.b1_min_units) {
    b1Steps.push("widen_to_" + B.widen_to);
    b1 += s.b1.widened;
  }
  if (b1 < B.b1_min_units) {
    b1Steps.push("multilang_rows");
    b1 += s.b1.multilang;
  }
  const infeasible = b1 < B.b1_min_units;
  const b1Units = infeasible ? 0 : Math.min(b1, target);
  const share = B.n - b1Units;
  const b2Steps: string[] = [];
  let b2 = s.b2.primary;
  if (b2 < share) {
    b2Steps.push("widen_to_" + B.widen_to);
    b2 += s.b2.widened;
  }
  const b2Units = Math.min(b2, share);
  return {
    n: B.n,
    b1: { ...frame(b1, b1Units, b1Steps), ...(infeasible ? { reserves: 0, stage0: 0, stage1_positions: [] } : {}), target, infeasible, code: infeasible ? "E_H2H_B_INFEASIBLE" : null },
    b2: { ...frame(b2, b2Units, b2Steps), share, short: share - b2Units },
  };
}
