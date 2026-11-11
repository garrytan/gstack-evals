// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's money (prereg 2026-11-11-geva-522-eng-review-build-read-prereg, section 10): one ledger line
// item per row of the plan's money table, every lease through main's ledger (src/runner/ledger/) on one run id, and the
// re-projection after the pilot on its measured costs: the frozen cut order (no-review builds to 1 a unit, then units 48
// to 40, then builds a cell 3 to 2) and the stop when the projection does not fit the recorded caps or the pooled MDD
// passes 0.12 (E_EB_REPROJECT). The Captain records each item's cap before its first paid call; the caps here are the
// plan's, for the dry run and the projection print.
import { openLease, settleLease } from "../../src/runner/ledger/ledger.ts";
import type { LocalLedger } from "../../src/runner/ledger/local.ts";
import type { RequireAdmission } from "../../src/runner/ledger/ledger.ts";
import { at, lvl } from "./analysis.ts";
import { fail } from "./errors.ts";
import { FROZEN, SIZE } from "./frozen.ts";
import type { SkillArm } from "./types.ts";

/** Every lease of the line names this run, so one item serves the pilot, the comparison and the route probe alike. */
export const EB_RUN = "geva-522-eb";

export interface EbItem {
  item: string;
  row: string;
  projectionUsd: number;
  capUsd: number;
  conditional: boolean;
}

/** The plan's section 10 table, one line item per row. */
export const ITEMS: readonly EbItem[] = [
  { item: "eb-reviews-opus", row: "Opus comparison reviews, the pilot's 32 plain reviews inside", projectionUsd: 1165, capUsd: 1500, conditional: false },
  { item: "eb-builds-opus", row: "Opus comparison builds, the pilot's 64 inside", projectionUsd: 1680, capUsd: 2150, conditional: false },
  { item: "eb-exposure-smoke", row: "Exposure smoke: Opus 18, Sol 9, particle-1 9 sessions", projectionUsd: 72, capUsd: 95, conditional: false },
  { item: "eb-build-units", row: "Build units: statement notes for 51 units and 30 new units", projectionUsd: 626, capUsd: 920, conditional: false },
  { item: "eb-hosts", row: "Hosts: about 245 VM-hours on Ubicloud standard-8", projectionUsd: 70, capUsd: 100, conditional: false },
  { item: "eb-crew", row: "Crew: this thread, the run thread and the results thread", projectionUsd: 300, capUsd: 400, conditional: false },
  { item: "eb-reserve", row: "Reserve", projectionUsd: 0, capUsd: 150, conditional: false },
  { item: "eb-stage-sol", row: "Conditional Sol stage", projectionUsd: 1873, capUsd: 2400, conditional: true },
  { item: "eb-stage-particle", row: "Conditional particle-1 stage", projectionUsd: 1035, capUsd: 1330, conditional: true },
];

export function itemOf(name: string): EbItem {
  return ITEMS.find((i) => i.item === name) ?? fail("E_USAGE", "no build-read line item " + name + "; the items are " + ITEMS.map((i) => i.item).join(", "));
}

/** Opens one lease on an item for the line's run. */
export function leaseItem(record: string, local: LocalLedger, item: string, o: { amount_micros?: number; requireAdmission?: RequireAdmission; now?: Date } = {}) {
  itemOf(item);
  return openLease(record, local, { item, run_id: EB_RUN, ...o });
}

export const settleItem = (record: string, local: LocalLedger, lease_id: string) => settleLease(record, local, lease_id);

// ---------------------------------------------------------------------------------------------------------------------
// Re-projection (sections 9 and 10).

export interface Design {
  units: number;
  k: number;
  kNone: number;
}

export interface Measured {
  /** Mean cost of one review, per arm, measured on the pilot (plain) or the smoke (skill arms). */
  reviewUsd: Record<"plain" | SkillArm, number>;
  /** Mean cost of one build, measured on the pilot. */
  buildUsd: number;
}

export interface Projection {
  reviews: number;
  builds: number;
}

/** The frozen cut order, each cut kept by the next. */
export const CUTS: ReadonlyArray<{ name: string; apply: (d: Design) => Design }> = [
  { name: "no-review builds to 1 a unit", apply: (d) => ({ ...d, kNone: 1 }) },
  { name: "comparison units from 48 to 40", apply: (d) => ({ ...d, units: 40 }) },
  { name: "builds a cell from 3 to 2", apply: (d) => ({ ...d, k: 2 }) },
];

export function project(d: Design, m: Measured): Projection {
  const perUnit = m.reviewUsd.plain + m.reviewUsd.precut + m.reviewUsd.engphase + m.reviewUsd.candidate;
  return { reviews: d.units * d.k * perUnit, builds: d.units * (4 * d.k + d.kNone) * m.buildUsd };
}

export interface Reprojection {
  design: Design;
  cuts: string[];
  projection: Projection;
  mdd: number;
  /** The E_EB_REPROJECT line, or null when the design fits and its MDD stays at or under 0.12. */
  stop: string | null;
  lines: string[];
}

/**
 * Applies the cuts in order until the projection fits the recorded caps (each item's projected total at or under its
 * cap, and the line's total at or under its cap when given). The design that fits stops for the Captain when its pooled
 * MDD (refitted from the pilot by power.py) passes 0.12; no cut that fits does too.
 */
export function reproject(o: { measured: Measured; caps: { reviews: number; builds: number }; spent?: { reviews: number; builds: number }; line?: { cap: number; committed: number }; mdd: (d: Design) => number; design?: Design }): Reprojection {
  const spent = o.spent ?? { reviews: 0, builds: 0 };
  let design: Design = { ...(o.design ?? SIZE) };
  const cuts: string[] = [];
  const lines: string[] = [];
  const fits = (p: Projection) => p.reviews + spent.reviews <= o.caps.reviews + 1e-9 && p.builds + spent.builds <= o.caps.builds + 1e-9 && (!o.line || o.line.committed + p.reviews + p.builds <= o.line.cap + 1e-9);
  const show = (d: Design, p: Projection, mdd: number) => d.units + " units, " + d.k + " builds a cell, " + d.kNone + " no-review: reviews $" + p.reviews.toFixed(2) + " (cap $" + o.caps.reviews + "), builds $" + p.builds.toFixed(2) + " (cap $" + o.caps.builds + "), pooled MDD " + lvl(mdd);
  for (let i = 0; ; i++) {
    const p = project(design, o.measured);
    const mdd = o.mdd(design);
    lines.push("reprojection" + (cuts.length ? " after " + cuts.join(", then ") : "") + ": " + show(design, p, mdd));
    if (fits(p)) {
      const stop = at(mdd) > FROZEN.mddStop ? "E_EB_REPROJECT projection " + show(design, p, mdd) + "; the pooled MDD passes " + FROZEN.mddStop.toFixed(2) + ", stop for the Captain before any skill-arm build" : null;
      if (stop) lines.push(stop);
      return { design, cuts, projection: p, mdd, stop, lines };
    }
    if (i >= CUTS.length) {
      const stop = "E_EB_REPROJECT projection " + show(design, p, mdd) + "; no frozen cut fits the recorded caps" + (o.line ? " and the line cap $" + o.line.cap : "") + ", stop for the Captain before any further spend";
      lines.push(stop);
      return { design, cuts, projection: p, mdd, stop, lines };
    }
    design = CUTS[i]!.apply(design);
    cuts.push(CUTS[i]!.name);
  }
}
