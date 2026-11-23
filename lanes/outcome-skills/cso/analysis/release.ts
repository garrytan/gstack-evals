// Copyright (c) 2026 Garry Tan. MIT License.
// Deviation (b), dated pre-data (deviations post 2026-11-21-capy-cso-advisories-deviations): stage 1's judge-check
// release reports only whether each gold minimum was met and the pass or fail of each gate, not gold counts by class.
// Section 12 releases item 6 as "judge check results (kappa per label, per-arm gate, format variants, refusals, gold
// counts)", but gold counts by class on stage 0 and 1 reports, read beside the released no-gstack named count, would
// tell how many cso reports were named, an arm rate section 12 keeps sealed. Everything else about the check (its counts,
// kappa values and rates) goes into the sealed stage 1 file with the arm outcomes.
import { csoFail } from "../prereg.ts";

/** Section 7's gold minimums: at least 40 gold reports and 10 in each named class, at least 40 gold findings and 10 in
 *  each validity class, and anchors at most 30% of the check set as sent. */
export const GOLD_MINIMUMS = ["named_reports", "named_class", "validity_findings", "validity_class", "anchor_share"] as const;
/** Section 7's gates for a route: named kappa on all gold and on non-anchor gold, the per-arm gate, the two format-variant
 *  thresholds, the refusal limit, the over-cap gold-drop limit, and validity kappa. */
export const GATES = ["named_kappa_all", "named_kappa_non_anchor", "per_arm_gate", "format_pairs", "format_near_misses", "refusals", "gold_overcap", "validity_kappa"] as const;
export type GoldMinimum = (typeof GOLD_MINIMUMS)[number];
export type Gate = (typeof GATES)[number];

/** Section 12's stage 1 release list with item 6 as deviation (b) reads it. */
export const RELEASE_ITEMS = [
  "none arm named count per model",
  "gap, limit and safety-stop counts per cell",
  "per-arm session cost (mean, median, 95th percentile) per model",
  "cso procedure-ran rate per model",
  "untold /cso load rate",
  "judge check results: whether each gold minimum was met and the pass or fail of each gate, per route (deviation (b))",
] as const;

/** One route's check as the judge pipeline computes it. detail holds the counts, kappas and rates; it goes only to the
 *  sealed file. */
export interface JudgeCheck { route: string; minimums: Record<GoldMinimum, boolean>; gates: Record<Gate, boolean>; detail: unknown }
export interface JudgeRelease { route: string; minimums: Record<GoldMinimum, "met" | "not met">; gates: Record<Gate, "pass" | "fail">; named_route: "pass" | "fail"; validity: "validated" | "not validated" }

const NAMED_MINIMUMS: readonly GoldMinimum[] = ["named_reports", "named_class", "anchor_share"];
const NAMED_GATES: readonly Gate[] = ["named_kappa_all", "named_kappa_non_anchor", "per_arm_gate", "format_pairs", "format_near_misses", "refusals", "gold_overcap"];

/** The released part of each route's check: booleans only. A route scores named outcomes when its named minimums are met
 *  and its named gates pass (section 7's route rule); validity secondaries print numbers only when validity's minimums
 *  are met and its kappa passes. E_CSO_RELEASE when a check lacks a minimum or gate, or carries a non-boolean in one. */
export function judgeRelease(checks: readonly JudgeCheck[]): JudgeRelease[] {
  return checks.map((c) => {
    for (const k of GOLD_MINIMUMS) if (typeof c.minimums?.[k] !== "boolean") csoFail("E_CSO_RELEASE", c.route + ": gold minimum " + k + " is not a boolean");
    for (const k of GATES) if (typeof c.gates?.[k] !== "boolean") csoFail("E_CSO_RELEASE", c.route + ": gate " + k + " is not a boolean");
    const extra = [...Object.keys(c.minimums).filter((k) => !(GOLD_MINIMUMS as readonly string[]).includes(k)), ...Object.keys(c.gates).filter((k) => !(GATES as readonly string[]).includes(k))];
    if (extra.length) csoFail("E_CSO_RELEASE", c.route + ": " + extra.join(", ") + " is not a minimum or gate the plan names");
    const named = NAMED_MINIMUMS.every((k) => c.minimums[k]) && NAMED_GATES.every((k) => c.gates[k]);
    const validity = c.minimums.validity_findings && c.minimums.validity_class && c.gates.validity_kappa;
    return {
      route: c.route,
      minimums: Object.fromEntries(GOLD_MINIMUMS.map((k) => [k, c.minimums[k] ? "met" : "not met"])) as JudgeRelease["minimums"],
      gates: Object.fromEntries(GATES.map((k) => [k, c.gates[k] ? "pass" : "fail"])) as JudgeRelease["gates"],
      named_route: named ? "pass" : "fail",
      validity: validity ? "validated" : "not validated",
    };
  });
}
