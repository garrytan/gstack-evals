// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite eval's two intervals (prereg wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, sections 7 and
// 8, and its attachment power.py). Section 8: a paired t interval over cluster differences with C - 1 degrees of
// freedom, two-sided 95%, pinned to Student's sleep data. Section 7: Newcombe's method 10 for paired proportions
// (lanes/delivery-route/analyze.ts, imported unchanged) with each of the four pair counts divided by a design effect:
// the cluster-robust variance of the mean difference, briefs as clusters, over the variance that treats every pair as
// independent, held between 1 and 2. designEffect() is power.py's design_effect() line for line, with clusters of any
// size so that a brief with one model's pair complete is a cluster of one.
import { newcombe } from "../../delivery-route/analyze.ts";
import { DECISION } from "../frozen.ts";

export { newcombe };

/** Comparisons against frozen thresholds carry power.py's tolerance (its bar test reads m >= BAR - 1e-12). */
export const EPS = 1e-12;
export const gt = (x: number, y: number) => x > y + EPS;
export const lt = (x: number, y: number) => x < y - EPS;
export const ge = (x: number, y: number) => x >= y - EPS;
export const le = (x: number, y: number) => x <= y + EPS;

export const mean = (xs: readonly number[]): number => xs.reduce((t, x) => t + x, 0) / xs.length;

/** ln Gamma(x) for x > 0 (Lanczos, g 7, n 9). */
function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The continued fraction of the regularized incomplete beta (modified Lentz). */
function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let delta = 1;
    for (const aa of [(m * (b - m) * x) / ((a + m2 - 1) * (a + m2)), (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))]) {
      d = 1 + aa * d;
      d = 1 / (Math.abs(d) < tiny ? tiny : d);
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      delta = d * c;
      h *= delta;
    }
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return h;
}

/** I_x(a, b), the regularized incomplete beta. */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(a, b, x)) / a : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/** The beta distribution's quantile: bisection on incompleteBeta to double precision. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (!(p > 0 && p < 1) || !(a > 0) || !(b > 0)) throw new Error("E_OHR_READ_INPUT the beta quantile needs 0 < p < 1 and a, b > 0, got p " + p + ", a " + a + " and b " + b);
  let lo = 0, hi = 1;
  for (let k = 0; k < 200 && hi - lo > 1e-15; k++) {
    const mid = (lo + hi) / 2;
    if (incompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Student t's distribution function with df degrees of freedom. */
export function tCdf(t: number, df: number): number {
  if (t === 0) return 0.5;
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** Student t's quantile: bisection on tCdf to double precision. */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) throw new Error("E_OHR_READ_INPUT the t quantile needs 0 < p < 1 and df > 0, got p " + p + " and df " + df);
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  let lo = 0, hi = 1;
  while (tCdf(hi, df) < p) hi *= 2;
  for (let k = 0; k < 200 && hi - lo > 1e-15 * hi; k++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface TInterval {
  /** C, the count of cluster differences. */
  n: number;
  mean: number | null;
  sd: number | null;
  lo: number | null;
  hi: number | null;
}

/** Section 8: the paired t interval over cluster differences, C - 1 degrees of freedom, two-sided 95%. Fewer than two clusters give no interval. */
export function tInterval(diffs: readonly number[]): TInterval {
  const n = diffs.length;
  if (!n) return { n, mean: null, sd: null, lo: null, hi: null };
  const m = mean(diffs);
  if (n < 2) return { n, mean: m, sd: null, lo: null, hi: null };
  const sd = Math.sqrt(diffs.reduce((t, x) => t + (x - m) ** 2, 0) / (n - 1));
  const h = (tQuantile(0.975, n - 1) * sd) / Math.sqrt(n);
  return { n, mean: m, sd, lo: m - h, hi: m + h };
}

/** One brief-and-model pair where both arms scored kept-whole: y1 the first arm (new), y0 the second (current). */
export interface KeptPair {
  cluster: string;
  model: string;
  y1: boolean;
  y0: boolean;
}

/**
 * power.py's design_effect(): vc = G/(G-1) * sum over clusters of (sum of the cluster's d - its size * mean)^2 / n^2, vs
 * = sum of (d - mean)^2 / n^2, k = vc / vs when vs > 0 and 1 otherwise, clipped to [1, 2]. With fewer than two clusters
 * vc is undefined and k takes its upper end, 2.
 */
export function designEffect(pairs: readonly KeptPair[]): number {
  const [floor, cap] = DECISION.design_effect;
  const n = pairs.length;
  const d = pairs.map((p) => Number(p.y1) - Number(p.y0));
  const m = mean(d);
  const sums = new Map<string, number>();
  pairs.forEach((p, j) => sums.set(p.cluster, (sums.get(p.cluster) ?? 0) + d[j]! - m));
  const g = sums.size;
  if (g < 2) return cap;
  const vc = ((g / (g - 1)) * [...sums.values()].reduce((t, s) => t + s * s, 0)) / n ** 2;
  const vs = d.reduce((t, x) => t + (x - m) ** 2, 0) / n ** 2;
  return Math.min(cap, Math.max(floor, vs > 0 ? vc / vs : 1));
}

export interface Corrected {
  n: number;
  clusters: number;
  /** a both kept, b first arm only, c second arm only, d neither: the uncorrected counts. */
  a: number;
  b: number;
  c: number;
  d: number;
  design_effect: number;
  diff: number;
  lo: number;
  hi: number;
  /** Method 10 reading every pair as independent, printed beside the corrected interval. */
  naive: { diff: number; lo: number; hi: number };
}

/** Section 7: method 10 on the four pair counts, each divided by the design effect (power.py's builder_interval()). */
export function correctedNewcombe(pairs: readonly KeptPair[]): Corrected {
  const a = pairs.filter((p) => p.y1 && p.y0).length, b = pairs.filter((p) => p.y1 && !p.y0).length;
  const c = pairs.filter((p) => !p.y1 && p.y0).length, d = pairs.filter((p) => !p.y1 && !p.y0).length;
  const k = designEffect(pairs);
  const r = newcombe(a / k, b / k, c / k, d / k);
  return { n: pairs.length, clusters: new Set(pairs.map((p) => p.cluster)).size, a, b, c, d, design_effect: k, diff: r.diff, lo: r.lo, hi: r.hi, naive: newcombe(a, b, c, d) };
}
