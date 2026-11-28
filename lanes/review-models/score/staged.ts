// Copyright (c) 2026 Garry Tan. MIT License.
// The staged rule (prereg section 7 as pre-run change 1 items 2 to 4 amend it), read after the pilot for the main
// reviewer only, and the frozen proceed sets.
// - Cost gap: the pilot's lower 95% bound on Fable cell cost minus Opus cell cost per review, paired by unit and voice
//   (FS minus OS and FA minus OA on each pilot unit, the unit as the cluster). The plan names no method for this bound;
//   it is taken as the lower end of the 95% interval change 1 item 4 prints, the mean minus 1.96 clustered bootstrap
//   standard errors, which can only keep Fable in against a one-sided bound.
// - Headroom: P share times (1 minus the lower of two one-sided 95% Clopper-Pearson bounds of Opus's per-bug catch: the
//   54 history units pooled with the pilot's P units, and the pilot's P units alone) plus B share times (1 minus the
//   bound on the pilot's B units). A pilot unit is caught when the mean of its OS and OA catches is at least 0.5; a
//   history unit when the mean of its passes is. Pilot catches read can't tell, gaps and safety stops as misses, which
//   can only raise the headroom.
// - Fable leaves when cost gap / $25 is greater than the headroom.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { clopperPearson } from "../../../src/runner/stats/exact.ts";
import { parseCsv } from "../../ask-replay/build.ts";
import { HISTORY, rmFail, VALUE_PER_CATCH, type Arm } from "./frozen.ts";
import { checkReviews, reviewCatch, type Review } from "./score.ts";
import { clusteredMeanSe, type MeanSe } from "./stats.ts";

export interface Tally {
  units: number;
  caught: number;
}

/** One-sided 95% Clopper-Pearson lower bound: the two-sided bound at alpha 0.10. No units bound nothing, so 0. */
export const cpLower = (t: Tally): number => (t.units ? clopperPearson(t.caught, t.units, 0.1).lower : 0);

/** Harness Evals' per-pass stage 1 CSV, as headroom.py reads it: refused unless its sha256 is the frozen one and it holds 54 outside bugs with 2 passes each. */
export function readHistory(path: string, sha256: string = HISTORY.sha256): Tally & { sha256: string } {
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== sha256) rmFail("E_RM_HISTORY", "the history CSV's sha256 is " + digest + ", not " + sha256);
  const [header, ...rows] = parseCsv(bytes.toString("utf8"));
  const col = (name: string) => header?.indexOf(name) ?? -1;
  const [unit, stratum, arm, named, planted] = ["unit_id", "stratum", "arm", "named_any_severity", "n_planted"].map(col) as [number, number, number, number, number];
  if ([unit, stratum, arm, named, planted].some((i) => i < 0)) rmFail("E_RM_HISTORY", "the history CSV lacks unit_id, stratum, arm, named_any_severity or n_planted");
  const passes = new Map<string, number[]>();
  for (const r of rows) {
    if (r[stratum] !== HISTORY.stratum || r[arm] !== HISTORY.arm) continue;
    const v = Number(r[named]) / Number(r[planted]);
    if (!Number.isFinite(v)) rmFail("E_RM_HISTORY", "unit " + r[unit] + " has a pass that is not a number");
    passes.set(r[unit]!, [...(passes.get(r[unit]!) ?? []), v]);
  }
  if (passes.size !== HISTORY.units || [...passes.values()].some((p) => p.length !== 2)) rmFail("E_RM_HISTORY", "the history CSV holds " + passes.size + " outside bugs, not " + HISTORY.units + " with 2 passes each");
  return { sha256: digest, units: passes.size, caught: [...passes.values()].filter((p) => (p[0]! + p[1]!) / 2 >= 0.5).length };
}

/** The pilot's bug units of one pool, caught when the mean of OS and OA catches is at least 0.5. */
export function pilotCatches(reviews: readonly Review[], pool: "P" | "B"): Tally {
  checkReviews(reviews);
  const units = [...new Set(reviews.filter((r) => r.pool === pool).map((r) => r.unit))];
  let caught = 0;
  for (const unit of units) {
    const pair = (["OS", "OA"] as Arm[]).map((arm) => reviews.find((r) => r.unit === unit && r.arm === arm) ?? rmFail("E_RM_SCORE_INPUT", "pilot unit " + unit + " has no " + arm + " review"));
    if ((reviewCatch(pair[0]!, "strict").catch + reviewCatch(pair[1]!, "strict").catch) / 2 >= 0.5) caught++;
  }
  return { units: units.length, caught };
}

/** Fable minus Opus cell cost per review, paired by unit and voice, over every pilot review with a metered cost. */
export function costGap(reviews: readonly Review[]): MeanSe & { lower: number | null; pairs: number; unpaired: string[] } {
  checkReviews(reviews);
  const cost = new Map(reviews.map((r) => [r.unit + "/" + r.arm, r]));
  const values: Array<{ unit: string; cluster: string; value: number }> = [];
  const unpaired: string[] = [];
  for (const unit of [...new Set(reviews.map((r) => r.unit))].sort())
    for (const [fable, opus] of [["FS", "OS"], ["FA", "OA"]] as const) {
      const f = cost.get(unit + "/" + fable), o = cost.get(unit + "/" + opus);
      if (f?.usd != null && o?.usd != null) values.push({ unit, cluster: unit, value: f.usd - o.usd });
      else unpaired.push(unit + " " + fable + "-" + opus);
    }
  const s = clusteredMeanSe(values);
  return { ...s, lower: s.interval ? s.interval[0] : null, pairs: values.length, unpaired };
}

export interface StagedInput {
  /** The pilot's lower bound on the cost gap, dollars per review. */
  gap_lower: number;
  /** The counted set's shares of P and B bug units. */
  p_share: number;
  b_share: number;
  history: Tally;
  /** Null only for a check on history alone, before any pilot review. */
  pilot_p: Tally | null;
  pilot_b: Tally | null;
}

export interface Staged {
  p_bound_pooled: number;
  p_bound_pilot: number | null;
  p_bound: number;
  b_bound: number;
  headroom: number;
  /** The cost gap at which Fable leaves: $25 times the headroom. */
  break_even_gap: number;
  drop_fable: boolean;
}

export function stagedRule(s: StagedInput): Staged {
  if (!(s.p_share >= 0 && s.b_share >= 0 && Math.abs(s.p_share + s.b_share - 1) < 1e-9)) rmFail("E_RM_SCORE_INPUT", "the counted set's P and B shares must add to 1");
  const pooled = cpLower({ units: s.history.units + (s.pilot_p?.units ?? 0), caught: s.history.caught + (s.pilot_p?.caught ?? 0) });
  const alone = s.pilot_p ? cpLower(s.pilot_p) : null;
  const pBound = alone === null ? pooled : Math.min(pooled, alone);
  const bBound = s.pilot_b ? cpLower(s.pilot_b) : 0;
  const headroom = s.p_share * (1 - pBound) + s.b_share * (1 - bBound);
  return { p_bound_pooled: pooled, p_bound_pilot: alone, p_bound: pBound, b_bound: bBound, headroom, break_even_gap: VALUE_PER_CATCH * headroom, drop_fable: s.gap_lower / VALUE_PER_CATCH > headroom };
}

export type ProceedSet = "all" | "OS_OA_N" | "OS_FS_N" | "stop";
export const SET_ARMS: Record<ProceedSet, Arm[]> = { all: ["OS", "OA", "FS", "FA", "N"], OS_OA_N: ["OS", "OA", "N"], OS_FS_N: ["OS", "FS", "N"], stop: [] };

/**
 * Change 1 item 2. A Fable cell that fails takes its partner out, and so does an Astra cell; FA is both, so its failure
 * takes FS out as a Fable cell, and OA stays only in the set where Fable is out and OA passed its own pilot. OS or N
 * failing leaves no set, and the run stops before counted spend.
 */
export function proceedSet(passed: Record<Arm, boolean>, dropFable: boolean): { set: ProceedSet; arms: Arm[]; reason: string } {
  const out = (set: ProceedSet, reason: string) => ({ set, arms: SET_ARMS[set], reason });
  const failed = (["OS", "OA", "FS", "FA", "N"] as Arm[]).filter((a) => !passed[a]);
  if (!passed.OS || !passed.N) return out("stop", (failed.filter((a) => a === "OS" || a === "N").join(" and ")) + " failed the pilot; no frozen set fits (R111)");
  const fableOut = dropFable || !passed.FS || !passed.FA;
  const astraOut = !passed.OA || !passed.FA;
  if (!fableOut && !astraOut) return out("all", "every arm passed and the staged rule keeps Fable");
  if (fableOut && passed.OA) return out("OS_OA_N", "Fable out: " + [dropFable ? "the staged rule" : "", ...failed.filter((a) => a === "FS" || a === "FA").map((a) => a + " failed its pilot")].filter(Boolean).join(", "));
  if (!fableOut) return out("OS_FS_N", "Astra out: " + failed.join(", ") + " failed the pilot; the voice question is untested");
  return out("stop", "Fable is out and OA failed its pilot; no frozen set fits (R111)");
}
