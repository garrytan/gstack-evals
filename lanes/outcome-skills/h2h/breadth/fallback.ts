// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6's fallbacks for B, over usable units (units that pass every gate, counted per frame and window). Part C's draw
// (ordinary/draw.ts) assigns positions and stages; this file decides which rows enter each frame's seeded order and
// whether B1 is usable. B1 is usable when its stage 2 gets at least b1_min_units units, so its frame needs that many plus
// its 6 stage 1 units, the 5 reserves and stage 0 (N of at least 32). Under that: widen B1 to 2025-06-01, then add the
// pinned MultiLang rows that pass the browser checks; still under, B1 is infeasible at this scale (never loosened) and B is
// B2 alone. B1's stage 2 takes up to half of B's n and B2's share is the rest; B2 short of its share widens to 2025-06-01.
// Both windows were mined in one frozen run, so a widening only lets the draw read the rows already tagged widened.
import { readPrereg, type H2hPrereg } from "../prereg.ts";

export interface Supply { primary: number; widened: number }
export interface FrameRows { usable: number; windows: ("primary" | "widened")[]; steps: string[] }
export interface BPlan {
  n: number;
  b1: FrameRows & { multilang: boolean; floor: number; stage2: number; infeasible: boolean; code: "E_H2H_B_INFEASIBLE" | null };
  b2: FrameRows & { share: number; short: number };
}

/** Usable B1 units the frame needs for its stage 2 to reach b1_min_units: that many, plus its stage 1 share, the
 *  reserves and stage 0. */
export const b1Floor = (p: H2hPrereg): number => p.classes.B.b1_min_units + p.classes.B.stage1 / 2 + p.classes.B.reserve + 1;

export function planB(s: { b1: Supply & { multilang: number }; b2: Supply }, p: H2hPrereg = readPrereg()): BPlan {
  const B = p.classes.B;
  const floor = b1Floor(p);
  const b1: BPlan["b1"] = { usable: s.b1.primary, windows: ["primary"], steps: [], multilang: false, floor, stage2: 0, infeasible: false, code: null };
  if (b1.usable < floor) {
    b1.steps.push("widen_to_" + B.widen_to);
    b1.windows.push("widened");
    b1.usable += s.b1.widened;
  }
  if (b1.usable < floor) {
    b1.steps.push("multilang_rows");
    b1.multilang = true;
    b1.usable += s.b1.multilang;
  }
  b1.infeasible = b1.usable < floor;
  b1.code = b1.infeasible ? "E_H2H_B_INFEASIBLE" : null;
  b1.stage2 = b1.infeasible ? 0 : Math.min(b1.usable - (floor - B.b1_min_units), Math.floor(B.n * B.b1_share_max));
  const share = B.n - b1.stage2;
  const b2: BPlan["b2"] = { usable: s.b2.primary, windows: ["primary"], steps: [], share, short: 0 };
  if (b2.usable < share) {
    b2.steps.push("widen_to_" + B.widen_to);
    b2.windows.push("widened");
    b2.usable += s.b2.widened;
  }
  b2.short = Math.max(0, share - b2.usable);
  return { n: B.n, b1, b2 };
}
