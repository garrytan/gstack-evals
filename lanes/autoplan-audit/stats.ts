// Copyright (c) 2026 Garry Tan. MIT License.
// Adapted from lanes/product-value/stats.ts at gstack-evals commit 3744a20 (blob b4d4efc2): four-decimal rounding,
// seeded shuffles, Cohen's kappa, the percentile interval and the seeded bootstraps, kept as they were; the
// product-value-only helpers are left out. Added for the autoplan record audit (prereg 2026-11-09-geva-419): Wilson 95%,
// Jeffreys posterior draws, the Rogan-Gladen correction and the run-bootstrap landed share with power.py part A's
// widening and clipping, and the 20% missing-rate rule.
import { seededRandom } from "../../src/runner/stats/paired.ts";

export { seededRandom };
export const DRAWS = 10_000;

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

// ---- added for the autoplan record audit ----

export const Z975 = 1.959964;

/** Wilson score interval, as power.py computes it. */
export function wilson(k: number, n: number, z = Z975): [number, number] {
  if (n <= 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

/** numpy's default (linear) percentile of sorted values, q in [0, 100]; power.py reads its intervals this way. */
export function percentileLinear(sorted: readonly number[], q: number): number {
  const pos = ((sorted.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function gauss(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function gamma(k: number, rng: () => number): number {
  if (k < 1) return gamma(k + 1, rng) * Math.pow(rng() || 1e-300, 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0, v = 0;
    do {
      x = gauss(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaDraw(a: number, b: number, rng: () => number): number {
  const x = gamma(a, rng);
  return x / (x + gamma(b, rng));
}

/** Jeffreys posterior draws for k of n: Beta(k + 0.5, n - k + 0.5). */
export const jeffreys = (k: number, n: number, draws: number, rng: () => number): number[] => Array.from({ length: draws }, () => betaDraw(k + 0.5, n - k + 0.5, rng));

/** Rogan-Gladen: (o + specificity - 1) / (sensitivity + specificity - 1), the denominator floored at 1e-6 as in power.py. */
export const corrected = (o: number, se: number, sp: number): number => (o + sp - 1) / Math.max(se + sp - 1, 1e-6);

/** power.py's two-sided t(0.975, df) table for df 1 to 15; above it the exact quantile. */
const T975: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131 };

function betacf(a: number, b: number, x: number): number {
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < 1e-300 ? 1e-300 : d);
  let h = d;
  for (let m = 1; m < 300; m++) {
    const m2 = 2 * m;
    for (const aa of [(m * (b - m) * x) / ((a + m2 - 1) * (a + m2)), (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))]) {
      d = 1 + aa * d;
      d = 1 / (Math.abs(d) < 1e-300 ? 1e-300 : d);
      c = 1 + aa / c;
      if (Math.abs(c) < 1e-300) c = 1e-300;
      h *= d * c;
    }
  }
  return h;
}
const lgamma = (z: number): number => {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
};
function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
export function t975(df: number): number {
  if (T975[df] !== undefined) return T975[df]!;
  let lo = 1.9, hi = 2.2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = 1 - 0.5 * ibeta(df / (df + mid * mid), df / 2, 0.5);
    if (p < 0.975) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface RunCounts {
  /** Panel LANDED labels. */
  k: number;
  /** Units with a panel label. */
  n: number;
  /** Units missing a label (counted lost or landed by the bounds). */
  m: number;
}
export interface Gold {
  /** LANDED gold items the panel labelled LANDED, of sensN. */
  sensK: number;
  sensN: number;
  /** NOT_LANDED gold items the panel labelled not LANDED, of specN. */
  specK: number;
  specN: number;
}
export type Bound = "labelled" | "lost" | "landed";

export interface LandedInterval {
  point: number;
  lo: number;
  hi: number;
}

/**
 * power.py part A: the corrected landed share with a run bootstrap; in each draw sensitivity and specificity come from
 * their Jeffreys posteriors; the unclipped draws are scaled about the unclipped point by sqrt(G/(G-1)) x t(0.975, G-1)
 * / 1.96 for G runs, then clipped to [0, 1]; the interval is numpy's 2.5 and 97.5 percentiles. bound "lost" counts every
 * missing unit not landed and "landed" counts every one landed (section 5.5's two bounds); "labelled" drops them.
 * idx, se and sp may be passed to reproduce power.py on fixed draws.
 */
export function landedInterval(runs: readonly RunCounts[], gold: Gold, o: { seed: number; draws: number; bound?: Bound; idx?: number[][]; se?: number[]; sp?: number[] }): LandedInterval {
  const bound = o.bound ?? "labelled";
  const g = runs.length;
  const rng = seededRandom(o.seed);
  const se = o.se ?? jeffreys(gold.sensK, gold.sensN, o.draws, rng);
  const sp = o.sp ?? jeffreys(gold.specK, gold.specN, o.draws, rng);
  const draws = o.idx?.length ?? o.draws;
  const value = (k: number, n: number, m: number, s: number, p: number) => {
    const c = corrected(k / Math.max(n, 1), s, p);
    if (bound === "labelled") return c;
    const total = Math.max(n + m, 1);
    return bound === "lost" ? (c * n) / total : (c * n + m) / total;
  };
  const K = runs.reduce((a, r) => a + r.k, 0), N = runs.reduce((a, r) => a + r.n, 0), M = runs.reduce((a, r) => a + r.m, 0);
  const point = value(K, N, M, gold.sensK / Math.max(gold.sensN, 1), gold.specK / Math.max(gold.specN, 1));
  if (g < 2) return { point: Math.min(1, Math.max(0, point)), lo: 0, hi: 1 };
  const f = (Math.sqrt(g / (g - 1)) * t975(g - 1)) / Z975;
  const out: number[] = [];
  for (let d = 0; d < draws; d++) {
    const pick = o.idx?.[d] ?? Array.from({ length: g }, () => Math.floor(rng() * g));
    let k = 0, n = 0, m = 0;
    for (const i of pick) {
      k += runs[i]!.k;
      n += runs[i]!.n;
      m += runs[i]!.m;
    }
    out.push(Math.min(1, Math.max(0, point + (value(k, n, m, se[d]!, sp[d]!) - point) * f)));
  }
  out.sort((a, b) => a - b);
  return { point: Math.min(1, Math.max(0, point)), lo: percentileLinear(out, 2.5), hi: percentileLinear(out, 97.5) };
}

/** Section 8's missing-rate rule: more than 20% missing reads NO READ (exactly 20% does not). */
export const overMissing = (missing: number, total: number): boolean => total > 0 && missing * 5 > total;
