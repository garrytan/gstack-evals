// Copyright (c) 2026 Garry Tan. MIT License.
// The bundle's power.py in TypeScript (plan section 13): the MDD by simulation of the exact two-sided McNemar test at 80%
// power with design effect 1.2, on numpy's default_rng stream (rng.ts), so it prints power.txt's table byte for byte.
// mdd() is what section 9's "MDD at the measured discordant share" and section 10's "half the MDD" read, at any n, share
// and alpha; the seed is power.py's own default.
import { defaultRng, type NumpyGenerator } from "./rng.ts";

export const POWER = { seed: 20261115, sims: 4000, deff: 1.2, target: 0.8 } as const;

/** Python's round(): half to even. */
export const pyRound = (x: number): number => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
};

const pcache = new Map<string, number>();
/** power.py pval(b, c): the exact two-sided McNemar p, the tail summed in integers and divided once, as Python does. */
export function pval(b: number, c: number): number {
  const key = b + "," + c;
  const hit = pcache.get(key);
  if (hit !== undefined) return hit;
  const n = b + c;
  let p = 1;
  if (n > 0) {
    const k = Math.min(b, c);
    let term = 1n, sum = 0n;
    for (let i = 0; i <= k; i++) {
      sum += term;
      term = (term * BigInt(n - i)) / BigInt(i + 1);
    }
    p = Math.min(1, 2 * (Number(sum) / 2 ** n));
  }
  pcache.set(key, p);
  return p;
}

/** power.py power(): the share of simulated tables where b > c and the exact p is below alpha. */
export function power(n: number, d: number, delta: number, alpha: number, rng: NumpyGenerator, sims: number = POWER.sims, deff: number = POWER.deff): number {
  const ne = Math.max(2, pyRound(n / deff));
  const pb = (d + delta) / 2, pc = (d - delta) / 2;
  if (pc < 0) return NaN;
  const pv = [pb, pc, 1 - pb - pc];
  let hits = 0;
  for (let i = 0; i < sims; i++) {
    const [b, c] = rng.multinomial(ne, pv) as [number, number, number];
    if (b > c && pval(b, c) < alpha) hits++;
  }
  return hits / sims;
}

/** power.py mdd(): the smallest delta in steps of 0.01, at most d, with power at least 0.8; null when none. */
export function mdd(n: number, d: number, alpha: number, seed: number = POWER.seed): number | null {
  const rng = defaultRng(seed);
  for (let step = 1; step <= 100; step++) {
    const delta = step / 100;
    if (delta > d) return null;
    if (power(n, d, delta, alpha, rng) >= POWER.target) return delta;
  }
  return null;
}

const fmt = (x: number | null) => (x === null ? "none" : String(pyRound(100 * x)));
/** Python's str() of the shares the table prints (0.2, 0.3, 0.4). */
const pyFloat = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** power.txt's table, line for line. */
export function powerTable(ns: readonly number[] = [20, 30, 40, 50, 60, 80, 100, 120, 150, 200], ds: readonly number[] = [0.2, 0.3, 0.4]): string {
  const out = ["n units | discordant share | MDD a=0.05/12 | MDD a=0.05/6 | MDD a=0.05"];
  for (const n of ns) for (const d of ds) out.push(n + " | " + pyFloat(d) + " | " + fmt(mdd(n, d, 0.05 / 12)) + " | " + fmt(mdd(n, d, 0.05 / 6)) + " | " + fmt(mdd(n, d, 0.05)));
  return out.join("\n") + "\n";
}
