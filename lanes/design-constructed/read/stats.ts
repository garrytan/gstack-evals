// Copyright (c) 2026 Garry Tan. MIT License.
// Copied in part from lanes/aftermath/stats.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (branch build-devex-review-eval).
// The readings' small statistics: percentile intervals, a seeded bootstrap of a mean, the twin re-split, least squares and
// a cluster bootstrap. The paired base-app cluster bootstrap, the exact sign flips and Holm come from main's
// src/runner/stats/paired.ts. The shuffle, derangement, matcher, kappa, Spearman and logistic fit stay with their owners.
import { seededRandom } from "../../../src/runner/stats/paired.ts";

/** The percentile interval of sorted draws, with the index rule paired.ts uses for its 95% interval. */
export function percentileInterval(sorted: readonly number[], level: number): [number, number] {
  const n = sorted.length;
  return [sorted[Math.floor((n * (1 - level)) / 2)]!, sorted[Math.ceil((n * (1 + level)) / 2) - 1]!];
}

/** The q quantile of sorted draws by the same rule: the value at index ceil(n * q) - 1. */
export const upperQuantile = (sorted: ArrayLike<number>, q: number): number => sorted[Math.ceil(sorted.length * q) - 1]!;

/** A seeded bootstrap of the mean of values, resampled with replacement; returns the sorted draws. */
export function bootstrapMeans(values: readonly number[], o: { seed: number; draws: number }): number[] {
  const rng = seededRandom(o.seed);
  const n = values.length;
  const out = new Array<number>(o.draws);
  for (let d = 0; d < o.draws; d++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)]!;
    out[d] = s / n;
  }
  return out.sort((a, b) => a - b);
}

/** The 20 ways to split six passes 3 against 3, as index triples for the first side. */
const SPLITS: number[][] = (() => {
  const out: number[][] = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) out.push([a, b, c]);
  return out;
})();

/**
 * The twin check's re-split null: each pair's six passes pooled and re-split 3 against 3, draws times, and the mean over
 * pairs of the absolute difference recomputed each time. A uniform pick of one of the 20 splits is a uniform random
 * re-split. Returns the sorted draws.
 */
export function resplitDraws(pairs: ReadonlyArray<{ a: readonly number[]; b: readonly number[] }>, o: { seed: number; draws: number }): Float64Array {
  const table = pairs.map((p) => {
    const pool = [...p.a, ...p.b];
    if (pool.length !== 6) throw new Error("the twin re-split needs 3 passes on each side of every pair");
    const total = pool.reduce((s, v) => s + v, 0);
    return SPLITS.map((s) => {
      const first = s.reduce((acc, i) => acc + pool[i]!, 0);
      return Math.abs(first / 3 - (total - first) / 3);
    });
  });
  const rng = seededRandom(o.seed);
  const out = new Float64Array(o.draws);
  for (let d = 0; d < o.draws; d++) {
    let s = 0;
    for (const t of table) s += t[Math.floor(rng() * 20)]!;
    out[d] = s / table.length;
  }
  return out.sort();
}

/** Ordinary least squares of y on x; with no spread in x the slope is 0 and the intercept is the mean of y. */
export function ols(x: readonly number[], y: readonly number[]): { intercept: number; slope: number } {
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { intercept: my - slope * mx, slope };
}

/** Resamples whole clusters draws times and returns the sorted statistic over each resample; non-finite draws drop. */
export function clusterBootstrap<T>(points: readonly T[], cluster: (p: T) => string, stat: (sample: T[]) => number, o: { seed: number; draws: number }): number[] {
  const groups = new Map<string, T[]>();
  for (const p of points) groups.set(cluster(p), [...(groups.get(cluster(p)) ?? []), p]);
  const keys = [...groups.keys()].sort();
  const rng = seededRandom(o.seed);
  const out: number[] = [];
  for (let d = 0; d < o.draws; d++) {
    const sample: T[] = [];
    for (let i = 0; i < keys.length; i++) sample.push(...groups.get(keys[Math.floor(rng() * keys.length)]!)!);
    const v = stat(sample);
    if (Number.isFinite(v)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}
