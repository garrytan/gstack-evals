// Copyright (c) 2026 Garry Tan. MIT License.
// Small statistics the aftermath-keyed plan-review evals share (product-value, prereg 2026-11-08-geva-403; devex, prereg
// 2026-11-09-geva-417): four-decimal rounding, seeded shuffles and derangements, the maximum one-to-one matching, Cohen's
// kappa, Spearman, percentile bootstraps, the twin re-split, least squares and a logistic fit. The paired cluster bootstrap,
// the sign flips and Holm come from src/runner/stats/paired.ts. Each eval binds its own seed (lanes/<eval>/stats.ts).
import { seededRandom } from "../../src/runner/stats/paired.ts";

export { seededRandom };
export const DRAWS = 10_000;

/** Every band edge and gate compares values rounded to four decimal places (section 10). */
export const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A seeded random id of six letters and digits, unique within taken. */
export function randomId(rng: () => number, taken: Set<string>): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(rng() * 32)];
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/**
 * A seeded derangement that keeps each id inside its group where it can: each group of two or more is one random
 * cycle (Sattolo's shape), the singletons form one cycle together, and a lone singleton joins a random cycle. Null for
 * fewer than two ids. Returns id -> the id whose key it takes.
 */
export function derangeByGroup(ids: readonly string[], group: (id: string) => string, rng: () => number): Map<string, string> | null {
  if (ids.length < 2) return null;
  const groups = new Map<string, string[]>();
  for (const id of [...ids].sort()) groups.set(group(id), [...(groups.get(group(id)) ?? []), id]);
  const out = new Map<string, string>();
  const cycle = (members: string[]) => {
    const order = shuffle(members, rng);
    order.forEach((id, i) => out.set(id, order[(i + 1) % order.length]!));
  };
  const singles: string[] = [];
  for (const [, members] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (members.length >= 2) cycle(members);
    else singles.push(members[0]!);
  }
  if (singles.length >= 2) cycle(singles);
  else if (singles.length === 1) {
    const lone = singles[0]!;
    const hosts = [...out.keys()].sort();
    const host = hosts[Math.floor(rng() * hosts.length)]!;
    out.set(lone, out.get(host)!);
    out.set(host, lone);
  }
  return out;
}

/**
 * The maximum one-to-one matching between key items and changes (augmenting paths). edges[i] lists the change indices
 * the judge named for item i. Returns the matched count and, per item, its change or null.
 */
export function maxMatching(edges: ReadonlyArray<readonly number[]>): { size: number; change_of: Array<number | null> } {
  const owner = new Map<number, number>();
  const tryItem = (i: number, seen: Set<number>): boolean => {
    for (const c of edges[i] ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      const o = owner.get(c);
      if (o === undefined || tryItem(o, seen)) {
        owner.set(c, i);
        return true;
      }
    }
    return false;
  };
  let size = 0;
  for (let i = 0; i < edges.length; i++) if (tryItem(i, new Set())) size++;
  const change_of: Array<number | null> = edges.map(() => null);
  for (const [c, i] of owner) change_of[i] = c;
  return { size, change_of };
}

/** Cohen's kappa for two binary raters; null when chance agreement is 1 or there are no cells. */
export function kappa(pairs: ReadonlyArray<readonly [boolean, boolean]>): number | null {
  const n = pairs.length;
  if (!n) return null;
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  const pa = pairs.filter(([a]) => a).length / n;
  const pb = pairs.filter(([, b]) => b).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe >= 1 ? null : (agree - pe) / (1 - pe);
}

const ranks = (xs: readonly number[]): number[] => {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
};

/** Spearman's rank correlation with average ranks for ties; null when either side has no spread. */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  const rx = ranks(x), ry = ranks(y);
  const mx = mean(rx), my = mean(ry);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i]! - mx) * (ry[i]! - my);
    sxx += (rx[i]! - mx) ** 2;
    syy += (ry[i]! - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** The percentile interval of sorted draws, with the index rule paired.ts uses for its 95% interval. */
export function percentileInterval(sorted: readonly number[], level: number): [number, number] {
  const n = sorted.length;
  return [sorted[Math.floor((n * (1 - level)) / 2)]!, sorted[Math.ceil((n * (1 + level)) / 2) - 1]!];
}

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
 * Section 4, twin check part (b)'s null: each pair's six passes pooled and re-split 3 against 3, draws times, and the
 * mean over pairs of the absolute difference recomputed each time. A uniform pick of one of the 20 splits is a uniform
 * random re-split. Returns the sorted draws.
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
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { intercept: my - slope * mx, slope };
}

export const expit = (z: number): number => 1 / (1 + Math.exp(-z));

/**
 * A logistic fit of y (0 or 1) on x by Newton's method, with a ridge of 1e-3 on both coefficients so a separated
 * sample stays finite. expit(intercept) is the rate read at x = 0.
 */
export function logistic(x: readonly number[], y: readonly number[]): { intercept: number; slope: number } {
  let b0 = 0, b1 = 0;
  const ridge = 1e-3;
  for (let it = 0; it < 50; it++) {
    let g0 = -ridge * b0, g1 = -ridge * b1, h00 = ridge, h01 = 0, h11 = ridge;
    for (let i = 0; i < x.length; i++) {
      const p = expit(b0 + b1 * x[i]!);
      const w = p * (1 - p);
      g0 += y[i]! - p;
      g1 += (y[i]! - p) * x[i]!;
      h00 += w;
      h01 += w * x[i]!;
      h11 += w * x[i]! * x[i]!;
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 0)) break;
    const d0 = (h11 * g0 - h01 * g1) / det, d1 = (h00 * g1 - h01 * g0) / det;
    b0 += d0;
    b1 += d1;
    if (Math.abs(d0) + Math.abs(d1) < 1e-10) break;
  }
  return { intercept: b0, slope: b1 };
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
