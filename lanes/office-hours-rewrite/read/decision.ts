// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10's ordered decision table for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, section 10, reading sections 7, 8 and 12). The rows are
// checked from top to bottom and the first whose condition holds decides; every row's condition is still computed and
// returned. The pooled primary (Opus 5.5 and Sol) decides; per-model rows act only through row 2's loss guard. Beside
// every outcome go section 10's two readings: new minus none not shown to beat no gstack by the bar, and current minus
// none wholly below zero. The second attempt (its section 3, items 8 to 10) gives row 1 its stops from stops.ts: every
// cap stop in a launch's stops.json or a ledger item's record, authoring that ended any way but on its quotas or on a
// cap stop after calibration and comparison were full, and a stop the command line adds.
import { DECISION } from "../frozen.ts";
import type { ModelId, ScoredSession } from "../types.ts";
import { builderRightCall, keptWhole, type KeptWholeReading, type RightCallReading } from "./builder.ts";
import { estimate, type Estimate } from "./estimate.ts";
import { guardrails, missingLimits, type Guardrails, type HandRead, type MissingLimits } from "./guards.ts";
import { ge, gt, le, lt } from "./stats.ts";

export type Row = 1 | 2 | 3 | 4 | 5 | 6;
export const OUTCOMES = { 1: "INCOMPLETE", 2: "HOLD (harm)", 3: "CUT", 4: "MERGE", 5: "HOLD (below bar)", 6: "INCONCLUSIVE" } as const satisfies Record<Row, string>;
export type Outcome = (typeof OUTCOMES)[Row];

export interface DecisionInput {
  /** Stage 2's scored sessions, one per manifest entry: founder and builder briefs, every arm and model. */
  rows: readonly ScoredSession[];
  /** Section 12's admission after at most one repair (admission.ts admissionState). */
  admission: "admitted" | "repair" | "fix-method";
  /** Every stop that reads row 1 (stops.ts readStops), one line each naming its source. */
  stops: readonly string[];
  /** Each production judge's check. */
  judge_checks: { astra: boolean; opus: boolean };
  /** G1's hand reads of every new-arm builder session the detector flagged. */
  hand_reads: readonly HandRead[];
}

const NEW_CURRENT = { a: "new", b: "current", kind: "founder" } as const;
const below0 = (e: Estimate) => e.hi !== null && lt(e.hi, 0);

export interface Decision {
  row: Row;
  outcome: Outcome;
  conditions: {
    row1: { holds: boolean; admission: DecisionInput["admission"]; stops: readonly string[]; missing_limit: boolean; judge_check_failed: boolean };
    row2: { holds: boolean; pooled_loss: boolean; opus_loss: boolean; sol_loss: boolean; kept_whole_harm: boolean; builder_right_call_loss: boolean; guardrail_broken: boolean };
    row3: { holds: boolean; hi: number | null };
    row4: { holds: boolean; estimate: number | null; lo: number | null; bar: number };
    row5: { holds: boolean; estimate: number | null; lo: number | null; hi: number | null };
    /** Everything else; includes_zero_reaches_bar is the prereg's description of what is left. */
    row6: { holds: boolean; includes_zero_reaches_bar: boolean };
  };
  readings: {
    /** New minus none includes zero and its upper bound is below +15: not shown to beat no gstack by the bar; a Why-null cycle runs. */
    new_vs_none_not_shown: { holds: boolean; lo: number | null; hi: number | null };
    /** Current minus none has an upper bound below 0: office-hours on gstack main loses to no gstack, its own finding. */
    current_loses_to_none: { holds: boolean; hi: number | null };
  };
  contrasts: { new_current: Estimate; new_current_opus: Estimate; new_current_sol: Estimate; new_none: Estimate; current_none: Estimate };
  kept_whole: KeptWholeReading;
  builder_right_call: RightCallReading;
  guardrails: Guardrails;
  missing: MissingLimits;
}

export function decide(x: DecisionInput): Decision {
  const one = (m: ModelId) => estimate(x.rows, { ...NEW_CURRENT, models: [m] });
  const c = {
    new_current: estimate(x.rows, NEW_CURRENT),
    new_current_opus: one("opus"),
    new_current_sol: one("sol"),
    new_none: estimate(x.rows, { a: "new", b: "none", kind: "founder" }),
    current_none: estimate(x.rows, { a: "current", b: "none", kind: "founder" }),
  };
  const kw = keptWhole(x.rows), brc = builderRightCall(x.rows), g = guardrails(x.rows, x.hand_reads), miss = missingLimits(x.rows);
  const nc = c.new_current;

  const r1 = { admission: x.admission, stops: x.stops, missing_limit: miss.broken, judge_check_failed: !(x.judge_checks.astra && x.judge_checks.opus) };
  const r2 = { pooled_loss: below0(nc), opus_loss: below0(c.new_current_opus), sol_loss: below0(c.new_current_sol), kept_whole_harm: kw.state === "broken", builder_right_call_loss: brc.state === "broken", guardrail_broken: g.broken };
  const row4 = nc.estimate !== null && nc.lo !== null && ge(nc.estimate, DECISION.bar) && gt(nc.lo, 0);
  const row5 = nc.estimate !== null && nc.lo !== null && nc.hi !== null && lt(nc.estimate, DECISION.bar) && (gt(nc.lo, 0) || lt(nc.hi, DECISION.bar));
  const above = {
    row1: { holds: r1.admission !== "admitted" || r1.stops.length > 0 || r1.missing_limit || r1.judge_check_failed, ...r1 },
    row2: { holds: Object.values(r2).some(Boolean), ...r2 },
    row3: { holds: below0(c.new_none), hi: c.new_none.hi },
    row4: { holds: row4, estimate: nc.estimate, lo: nc.lo, bar: DECISION.bar },
    row5: { holds: row5, estimate: nc.estimate, lo: nc.lo, hi: nc.hi },
  };
  const conditions: Decision["conditions"] = {
    ...above,
    row6: { holds: !Object.values(above).some((r) => r.holds), includes_zero_reaches_bar: nc.lo !== null && nc.hi !== null && le(nc.lo, 0) && ge(nc.hi, DECISION.bar) },
  };
  const row = ([1, 2, 3, 4, 5, 6] as const).find((r) => conditions[("row" + r) as keyof Decision["conditions"]].holds)!;
  const nn = c.new_none;
  return {
    row,
    outcome: OUTCOMES[row],
    conditions,
    readings: {
      new_vs_none_not_shown: { holds: nn.lo !== null && nn.hi !== null && le(nn.lo, 0) && ge(nn.hi, 0) && lt(nn.hi, DECISION.bar), lo: nn.lo, hi: nn.hi },
      current_loses_to_none: { holds: below0(c.current_none), hi: c.current_none.hi },
    },
    contrasts: c,
    kept_whole: kw,
    builder_right_call: brc,
    guardrails: g,
    missing: miss,
  };
}
