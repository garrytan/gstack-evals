// Copyright (c) 2026 Garry Tan. MIT License.
// Paired statistics for the office-hours founder eval's readings (prereg
// wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg, sections 8, 10 and 11). A unit's arm score is
// the mean of its matched passes, so units weigh equally; differences pair by unit, clustered on the unit taken from
// each session's unit field, with a 95% cluster-bootstrap interval and a two-sided cluster sign-flip p (10,000 draws
// and flips, seed 20261109). The bootstrap and the sign flips are src/runner/stats/paired.ts's, the rest is the
// product-value eval's stats.ts. Every comparison is rounded to four decimal places.
import { clusteredPairedDelta } from "../../../src/runner/stats/paired.ts";
import { bootstrapMeans, clusterBootstrap, kappa, mean, ols, percentileInterval, r4, resplitDraws, seededRandom, shuffle } from "../../product-value/stats.ts";
import { DRAWS, SEED } from "../frozen.ts";
import type { ScoredSession } from "../types.ts";

export { bootstrapMeans, clusterBootstrap, kappa, mean, ols, percentileInterval, r4, resplitDraws, seededRandom, shuffle };
export const STAT = { seed: SEED, draws: DRAWS };

/** A per-session number; null leaves the session out of that metric. */
export type Metric = (s: ScoredSession) => number | null;
export const W: Metric = (s) => s.W;

/** One unit's arm scores over its matched passes. */
export interface UnitPair {
  unit: string;
  a: number;
  b: number;
  passes: number;
}

/** Every comparison prints paired, with its interval, p and the count of units that got worse (b under a). */
export interface Comparison {
  units: number;
  mean_a: number;
  mean_b: number;
  delta: number;
  ci95: [number, number] | null;
  p: number;
  worse: number;
}

const passKey = (s: ScoredSession) => s.unit + "#" + s.pass;

/** A unit's arm score on a metric: the mean of its scored passes. Then the mean over units, so units weigh equally. */
export function unitMean(sessions: readonly ScoredSession[], metric: Metric): { units: number; mean: number } | null {
  const by = new Map<string, number[]>();
  for (const s of sessions) {
    const v = metric(s);
    if (v !== null) by.set(s.unit, [...(by.get(s.unit) ?? []), v]);
  }
  return by.size ? { units: by.size, mean: r4(mean([...by.values()].map(mean))) } : null;
}

/**
 * A pass counts only when both arms scored it on the metric; a unit's arm score is the mean of its matched passes and a
 * unit with no matched pass leaves. one_side counts passes scored on one arm only.
 */
export function matchUnits(a: readonly ScoredSession[], b: readonly ScoredSession[], metric: Metric): { units: UnitPair[]; one_side: number } {
  const side = (xs: readonly ScoredSession[]) => new Map(xs.flatMap((s) => (metric(s) === null ? [] : [[passKey(s), s] as const])));
  const A = side(a), B = side(b);
  const by = new Map<string, { a: number[]; b: number[] }>();
  for (const [k, sb] of B) {
    const sa = A.get(k);
    if (!sa) continue;
    const u = by.get(sb.unit) ?? { a: [], b: [] };
    u.a.push(metric(sa)!);
    u.b.push(metric(sb)!);
    by.set(sb.unit, u);
  }
  const one_side = [...A.keys()].filter((k) => !B.has(k)).length + [...B.keys()].filter((k) => !A.has(k)).length;
  const units = [...by.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([unit, u]) => ({ unit, a: mean(u.a), b: mean(u.b), passes: u.a.length }));
  return { units, one_side };
}

/** b minus a over units, clustered on the unit; null with no unit. */
export function compare(units: readonly UnitPair[]): Comparison | null {
  if (!units.length) return null;
  const stats = clusteredPairedDelta(units.map((u) => ({ id: u.unit, cluster: u.unit, a: u.a, b: u.b })), STAT);
  const count = new Set(units.map((u) => u.unit)).size;
  if (stats.n_clusters !== count) throw new Error("the comparison's cluster count " + stats.n_clusters + " differs from its unit count " + count);
  return {
    units: count,
    mean_a: r4(stats.mean_a),
    mean_b: r4(stats.mean_b),
    delta: r4(stats.delta),
    ci95: stats.ci95 ? [r4(stats.ci95[0]), r4(stats.ci95[1])] : null,
    p: r4(stats.p_two_sided),
    worse: units.filter((u) => u.b < u.a).length,
  };
}

/** The paired comparison of arm b minus arm a on a metric, with the count of passes one arm alone scored. */
export function contrast(a: readonly ScoredSession[], b: readonly ScoredSession[], metric: Metric): { cmp: Comparison | null; one_side: number } {
  const m = matchUnits(a, b, metric);
  return { cmp: compare(m.units), one_side: m.one_side };
}

/** An interval excludes zero when both ends, rounded, sit on one side of it. */
export const excludesZero = (ci: readonly [number, number] | null): boolean => ci !== null && (r4(ci[0]) > 0 || r4(ci[1]) < 0);

/**
 * Section 8's length-adjusted difference: on unit-passes both arms scored with a block, b's W minus a's regressed on
 * b's first-move word count minus a's; the intercept with its 95% cluster-bootstrap interval over units.
 */
export function lengthAdjusted(a: readonly ScoredSession[], b: readonly ScoredSession[]): { pairs: number; intercept: number; slope: number; ci95: [number, number] | null } | null {
  const A = new Map(a.map((s) => [passKey(s), s]));
  const rows = b.flatMap((sb) => {
    const sa = A.get(passKey(sb));
    if (!sa || sa.W === null || sb.W === null || sa.first_move_words === null || sb.first_move_words === null) return [];
    return [{ unit: sb.unit, x: sb.first_move_words - sa.first_move_words, y: sb.W - sa.W }];
  });
  if (!rows.length) return null;
  const fit = (rs: readonly { x: number; y: number }[]) => ols(rs.map((r) => r.x), rs.map((r) => r.y));
  const f = fit(rows);
  const draws = new Set(rows.map((r) => r.unit)).size > 1 ? clusterBootstrap(rows, (r) => r.unit, (s) => fit(s).intercept, STAT) : [];
  return { pairs: rows.length, intercept: r4(f.intercept), slope: r4(f.slope), ci95: draws.length ? (percentileInterval(draws, 0.95).map(r4) as [number, number]) : null };
}
