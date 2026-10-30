// Copyright (c) 2026 Garry Tan. MIT License.
// The review no-loss decision statistics (plan section 5): the margin-shifted sign-flip test over PR clusters, computed
// exactly at any cluster count. Each blocker's paired values are shares of passes, so every shifted cluster sum is an
// integer on a lattice of 1 / (1000 * lcm(passes)) and the null distribution of the signed sum is built by convolution.
// That is the kit's marginShiftedSignFlipP (src/runner/stats/sign-flip.ts), which enumerates 2^k patterns up to 20
// clusters and samples above; tests/noloss/stats.test.ts checks the two agree exactly up to 20 clusters.
import type { PairedItem } from "../../src/runner/stats/paired.ts";

export const ALPHA = 0.05;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

/**
 * One-sided p that the signed sum of cluster values is at least the observed (all positive) sum when each value's sign
 * is flipped with probability 1/2. Values are integers; zeros change nothing.
 */
export function signFlipTail(values: readonly number[]): number {
  if (!values.every(Number.isSafeInteger)) throw new Error("sign-flip values must be integers on the lattice");
  const nonzero = values.filter((v) => v !== 0).map(Math.abs);
  const g = nonzero.reduce((acc, v) => gcd(acc, v), 0) || 1;
  const steps = nonzero.map((v) => v / g);
  const signed = values.filter((v) => v !== 0).map((v) => v / g);
  const span = steps.reduce((s, v) => s + v, 0);
  let dist = new Float64Array(2 * span + 1);
  dist[span] = 1;
  let reach = 0;
  for (const v of steps) {
    const next = new Float64Array(dist.length);
    for (let s = span - reach; s <= span + reach; s++) {
      const p = dist[s]!;
      if (p === 0) continue;
      next[s + v]! += p / 2;
      next[s - v]! += p / 2;
    }
    dist = next;
    reach += v;
  }
  const observed = signed.reduce((s, v) => s + v, 0);
  let tail = 0;
  for (let s = span + observed; s <= 2 * span; s++) tail += dist[s]!;
  return tail;
}

export interface SignFlip {
  /** Null at a true ceiling or floor, or with fewer than 2 clusters. */
  p: number | null;
  /** The smallest p the observed nonzero clusters could reach: 2^-k. */
  min_p: number | null;
  /** Clusters whose shifted sum is not zero. */
  informative_clusters: number;
  reason: string | null;
}

/** Scales a margin in points (at most one decimal) and the pairs' pass shares onto one integer lattice. */
function lattice(pairs: readonly PairedItem[], passes: readonly number[], marginPoints: number): { scale: number; margin: number } {
  const tenths = Math.round(marginPoints * 10);
  if (!Number.isFinite(marginPoints) || marginPoints < 0 || Math.abs(tenths - marginPoints * 10) > 1e-9) throw new Error("a margin is a non-negative number of points with at most one decimal");
  const l = passes.reduce((acc, p) => lcm(acc, p), 1);
  const scale = 1000 * l;
  for (const p of pairs) for (const v of [p.a, p.b]) if (Math.abs(Math.round(v * l) - v * l) > 1e-9) throw new Error("paired value " + v + " is not a share of " + passes.join(" or ") + " passes");
  return { scale, margin: tenths * l };
}

/**
 * One-sided p that V (b) is no worse than R (a) by the margin, a larger value being better: each PR's summed difference
 * is shifted by the margin once per blocker and its sign flipped. margin 0 with a and b swapped is the LOSS test.
 * When no blocker differs the statistic is computed directly ("no discordant blocker"), which gives 2^-k at a positive
 * margin; a true ceiling (every value 1) or floor (every value 0) stays null.
 */
export function shiftedSignFlip(pairs: readonly PairedItem[], marginPoints: number, passes: readonly number[]): SignFlip {
  const { scale, margin } = lattice(pairs, passes, marginPoints);
  const byCluster = new Map<string, number>();
  for (const p of pairs) byCluster.set(p.cluster, (byCluster.get(p.cluster) ?? 0) + Math.round((p.b - p.a) * scale) + margin);
  if (byCluster.size < 2) return { p: null, min_p: null, informative_clusters: 0, reason: "fewer than 2 PR clusters" };
  const discordant = pairs.some((p) => p.a !== p.b);
  if (!discordant && pairs.every((p) => p.a === 1)) return { p: null, min_p: null, informative_clusters: 0, reason: "ceiling: both arms found every blocker" };
  if (!discordant && pairs.every((p) => p.a === 0)) return { p: null, min_p: null, informative_clusters: 0, reason: "floor: neither arm found any blocker" };
  const values = [...byCluster.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, v]) => v);
  const k = values.filter((v) => v !== 0).length;
  return { p: signFlipTail(values), min_p: 2 ** -k, informative_clusters: k, reason: discordant ? null : "no discordant blocker" };
}

export type Verdict = "NO_LOSS" | "LOSS" | "NOT_DISTINGUISHED";

/** Plan section 5: NO_LOSS when the margin test rejects at 0.05, else LOSS when the swapped margin-0 test does, else NOT_DISTINGUISHED. */
export function decide(pNoLoss: number | null, pLoss: number | null, alphaNoLoss = ALPHA): Verdict {
  if (pNoLoss !== null && pNoLoss < alphaNoLoss) return "NO_LOSS";
  if (pLoss !== null && pLoss < ALPHA) return "LOSS";
  return "NOT_DISTINGUISHED";
}

/** Both tests for one comparison: V against R at the margin, and R against V at margin 0. */
export function pairedTests(pairs: readonly PairedItem[], marginPoints: number, passes: readonly number[]): { no_loss: SignFlip; loss: SignFlip } {
  return { no_loss: shiftedSignFlip(pairs, marginPoints, passes), loss: shiftedSignFlip(pairs.map((p) => ({ ...p, a: p.b, b: p.a })), 0, passes) };
}
