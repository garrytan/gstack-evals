// Copyright (c) 2026 Garry Tan. MIT License.
// Section 7's builder readings for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, section 7, and row 2 of section 10). Kept whole: new
// minus current on the brief-and-model pairs where both arms scored, read by Newcombe's method 10 with the design-effect
// correction; builders are harmed when its 95% lower bound is at or below -15 points. Builder right call: section 8's
// t estimator over builder briefs, each brief a cluster; a quality loss when its interval lies wholly below zero.
import { DECISION, PRIMARY_MODELS } from "../frozen.ts";
import type { ModelId, ScoredSession } from "../types.ts";
import { checkRows, estimate, METRIC, scoredValue, type Estimate } from "./estimate.ts";
import { correctedNewcombe, le, lt, type Corrected, type KeptPair } from "./stats.ts";

export type State = "held" | "broken";

export interface KeptWholeReading {
  state: State;
  margin: number;
  /** Builder brief-and-model pairs with a row in either skill arm, and those missing a side. */
  scheduled_pairs: number;
  missing_pairs: number;
  pairs: Corrected;
}

/** Section 7's non-inferiority on the kept-whole rate, new minus current, stage 2 builder briefs. */
export function keptWhole(rows: readonly ScoredSession[], models: readonly ModelId[] = PRIMARY_MODELS): KeptWholeReading {
  checkRows(rows);
  const keep = rows.filter((s) => s.stage === 2 && s.kind === "builder" && models.includes(s.model) && (s.arm === "new" || s.arm === "current"));
  const cell = new Map(keep.map((s) => [s.brief + "|" + s.model + "|" + s.arm, s]));
  const keys = [...new Set(keep.map((s) => s.brief + "|" + s.model))].sort();
  const pairs: KeptPair[] = [];
  for (const k of keys) {
    const sn = cell.get(k + "|new"), sc = cell.get(k + "|current");
    const y1 = sn ? scoredValue(sn, METRIC.kept) : null, y0 = sc ? scoredValue(sc, METRIC.kept) : null;
    if (y1 === null || y0 === null) continue;
    pairs.push({ cluster: k.split("|")[0]!, model: k.split("|")[1]!, y1: y1 === 1, y0: y0 === 1 });
  }
  const c = correctedNewcombe(pairs);
  return { state: le(c.lo, DECISION.builder_margin) ? "broken" : "held", margin: DECISION.builder_margin, scheduled_pairs: keys.length, missing_pairs: keys.length - pairs.length, pairs: c };
}

export type RightCallReading = Estimate & { state: State };

/** Section 7's builder quality: the builder right call, new minus current, each brief a cluster. */
export function builderRightCall(rows: readonly ScoredSession[], models: readonly ModelId[] = PRIMARY_MODELS): RightCallReading {
  const e = estimate(rows, { a: "new", b: "current", kind: "builder", models, by: "brief" });
  return { ...e, state: e.hi !== null && lt(e.hi, 0) ? "broken" : "held" };
}
