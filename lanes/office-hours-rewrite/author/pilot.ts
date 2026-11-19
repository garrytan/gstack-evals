// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's authoring pilot gate (pre-run change 1 item 4d, with section 3's "Supply" and section
// 13's authoring line). After 16 second-twin draws the gate reads the yield with a two-sided 90% Wilson interval against
// the line recomputed from the pilot's own cost per draw and first-pass rate, with pilot.py's line(): go when the lower
// bound is at or above the line, stop when the upper bound is below it, and otherwise read once more at 32. A second read
// still open halts authoring for the Captain, and so does a missing line (the first twins and unpaired briefs alone would
// use up the cap). The Wilson interval is the autoplan audit's, pinned to Newcombe's 1998 worked examples in the tests.
import { wilson } from "../../autoplan-audit/stats.ts";
import { CAPS, PILOT, QUOTA } from "../frozen.ts";

/** Section 13's planning inputs, as pilot.py states them: $129.19 over 124 draws, and 96 in 124 passing first time. */
export const PLANNING = { draw_usd: 129.19 / 124, first_pass: 96 / 124 } as const;
/** Section 13: one allowance for the authoring item's costliest unit, $3.50 for a brief. */
export const BRIEF_ALLOWANCE = 3.5;

/** pilot.py's line(): the second-twin yield the cap less one allowance can carry, or null when there is no room. */
export function line(drawUsd: number, firstPass: number): number | null {
  if (!(drawUsd > 0) || !(firstPass > 0)) return null;
  const room = (CAPS.authoring - BRIEF_ALLOWANCE) / drawUsd - (QUOTA.pairs + QUOTA.unpaired) / firstPass;
  return room > 0 ? QUOTA.pairs / room : null;
}

/** pilot.py's cost(): authoring's projected cost at a yield. */
export const projectedCost = (drawUsd: number, firstPass: number, yieldRate: number): number => ((QUOTA.pairs + QUOTA.unpaired) / firstPass + QUOTA.pairs / yieldRate) * drawUsd;

export const wilson90 = (k: number, n: number): [number, number] => wilson(k, n, PILOT.z);

export type Read = "go" | "stop" | "open";
/** One read of k passing second twins in n draws against the line; no line reads stop. */
export function readAt(k: number, n: number, l: number | null): Read {
  if (l === null) return "stop";
  const [lo, hi] = wilson90(k, n);
  if (lo >= l) return "go";
  if (hi < l) return "stop";
  return "open";
}

export interface ReadRecord {
  k: number;
  n: number;
  lo: number;
  hi: number;
  read: Read;
}

/** The two-step gate over the reads taken so far: more means draw on to the second read. */
export function pilotRead(reads: readonly { k: number; n: number }[], l: number | null): { verdict: "go" | "stop" | "more" | "open"; reads: ReadRecord[] } {
  const recs = reads.map((r) => ({ ...r, lo: wilson90(r.k, r.n)[0], hi: wilson90(r.k, r.n)[1], read: readAt(r.k, r.n, l) }));
  const last = recs.at(-1)!;
  if (last.read !== "open") return { verdict: last.read, reads: recs };
  return { verdict: recs.length === 1 ? "more" : "open", reads: recs };
}
