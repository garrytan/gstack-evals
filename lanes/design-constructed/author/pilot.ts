// Copyright (c) 2026 Garry Tan. MIT License.
// K12, the pilot cost stop, and start rule 12's authoring re-projection. Spend comes from the money area through a
// seam, with settled, in-flight and unknown charges carried apart and all three counted (L1); the meter's settled-only
// figure is never read as committed cost. The pilot stops authoring above $10.00 a passing unit (E_DC_AUTHOR_COST);
// no passing unit reads as infinite. The re-projection, after the pilot and again after the calibration units, sizes
// the comparison set at the measured cost per passing unit within dc-authoring-2's cap: 64 when it fits, fewer down to
// 48, and below 48 authoring stops (E_DC_SUPPLY_SHORT). Each value is rounded to four decimals before its threshold (M12).
import { fail } from "../errors.ts";
import { AUTHORING, LEDGER_ITEMS, ROUND_DECIMALS, SETS } from "../frozen.ts";
import type { ChangeKind } from "../types.ts";
import type { SpendReader, SpendReading } from "./seams.ts";

const round = (x: number): number => (Number.isFinite(x) ? Math.round(x * 10 ** ROUND_DECIMALS) / 10 ** ROUND_DECIMALS : x);

export const committed = (s: SpendReading): number => round(s.settledUsd + s.inFlightUsd + s.unknownUsd);

export interface PilotCost {
  committedUsd: number;
  passing: number;
  perPassingUsd: number;
  stop: boolean;
}

export function pilotCost(spend: SpendReading, passing: number): PilotCost {
  const c = committed(spend);
  const per = passing > 0 ? round(c / passing) : Infinity;
  return { committedUsd: c, passing, perPassingUsd: per, stop: per > AUTHORING.pilot.maxUsdPerPassingUnit };
}

/** The pilot stop: E_DC_AUTHOR_COST above $10.00 a passing unit. */
export function checkPilot(spend: SpendReading, passing: number): PilotCost {
  const p = pilotCost(spend, passing);
  if (p.stop) fail("E_DC_AUTHOR_COST", "the pilot cost $" + p.committedUsd + " for " + passing + " passing units, $" + p.perPassingUsd + " each, above $" + AUTHORING.pilot.maxUsdPerPassingUnit.toFixed(2));
  return p;
}

export interface KindRate {
  kind: ChangeKind;
  attempts: number;
  passed: number;
  rate: number | null;
}

/** Pass rates per change kind, printed with the pilot and again after the calibration units (below-floor note 2). */
export function kindRates(units: readonly { kind: ChangeKind; passed: boolean }[]): KindRate[] {
  const kinds = [...new Set(units.map((u) => u.kind))].sort();
  return kinds.map((kind) => {
    const of = units.filter((u) => u.kind === kind);
    const passed = of.filter((u) => u.passed).length;
    return { kind, attempts: of.length, passed, rate: of.length ? round(passed / of.length) : null };
  });
}

export interface Projection {
  perPassingUsd: number;
  /** dc-authoring-2's room after settled, in-flight and unknown spend. */
  roomUsd: number;
  /** Passing units the room buys at the measured cost. */
  fillable: number;
  comparison: number;
  reserves: number;
  /** dc-authoring-1's line: calibration units still needed, their 2x versions and the twin tries, printed. */
  authoring1: { projectedUsd: number; capUsd: number; fits: boolean };
}

/**
 * The re-projection. perPassingUsd is the measured cost per passing unit, failures included; x2Usd is the cost of one 2x
 * version (the planning $1.40 until measured); twinTries is the second skins still to try, each costed as one passing
 * unit. Comparison units come first, then reserves; below 48 comparison units it stops with E_DC_SUPPLY_SHORT.
 */
export function reproject(p: { perPassingUsd: number; spend1: SpendReading; spend2: SpendReading; calibrationNeeded: number; x2Usd: number; x2Needed: number; twinTries: number }): Projection {
  const cap2 = LEDGER_ITEMS["dc-authoring-2"].capUsd;
  const cap1 = LEDGER_ITEMS["dc-authoring-1"].capUsd;
  const room = round(cap2 - committed(p.spend2));
  const fillable = Number.isFinite(p.perPassingUsd) && p.perPassingUsd > 0 ? Math.floor(round(room / p.perPassingUsd)) : 0;
  const comparison = Math.min(SETS.comparison, Math.max(0, fillable));
  const reserves = Math.min(SETS.reserves, Math.max(0, fillable - SETS.comparison));
  const projected1 = round(committed(p.spend1) + (p.calibrationNeeded + p.twinTries) * p.perPassingUsd + p.x2Needed * p.x2Usd);
  const out: Projection = { perPassingUsd: p.perPassingUsd, roomUsd: room, fillable, comparison, reserves, authoring1: { projectedUsd: projected1, capUsd: cap1, fits: projected1 <= cap1 } };
  if (comparison < SETS.comparisonFloor) fail("E_DC_SUPPLY_SHORT", "at $" + p.perPassingUsd + " a passing unit, dc-authoring-2's $" + room + " of room fills " + comparison + " comparison units, below " + SETS.comparisonFloor);
  return out;
}

/** The pilot stop on the money area's reading of dc-authoring-1, which holds only the pilot when it ends. */
export const checkPilotFrom = (read: SpendReader, passing: number): PilotCost => checkPilot(read("dc-authoring-1"), passing);

/** The re-projection on the money area's readings of dc-authoring-1 and dc-authoring-2. */
export const reprojectFrom = (read: SpendReader, p: Omit<Parameters<typeof reproject>[0], "spend1" | "spend2">): Projection => reproject({ ...p, spend1: read("dc-authoring-1"), spend2: read("dc-authoring-2") });
