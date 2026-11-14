// Copyright (c) 2026 Garry Tan. MIT License.
// M12's rounding and exact decimal comparison: every statistic is rounded to four decimal places before it meets its
// threshold, and the comparison runs on whole numbers of ten-thousandths, so "at most 0.65" passes 0.6500 and fails 0.6501.
import { ROUND_DECIMALS } from "../frozen.ts";

const SCALE = 10 ** ROUND_DECIMALS;

/**
 * x rounded to four decimals, as a whole number of ten-thousandths. The digits come from x's decimal expansion at ten
 * places, so binary noise such as 0.1 + 0.2 never moves a rounding; a fifth digit of 5 or more rounds away from zero.
 * Infinity stays infinite (k reads infinite when the 2x none A is 0).
 */
export function q4(x: number): number {
  if (Number.isNaN(x)) throw new Error("q4 got NaN");
  if (!Number.isFinite(x)) return x;
  const [int, frac] = Math.abs(x).toFixed(10).split(".") as [string, string];
  let n = Number(int) * SCALE + Number(frac.slice(0, ROUND_DECIMALS));
  if (Number(frac[ROUND_DECIMALS]) >= 5) n += 1;
  return x < 0 && n !== 0 ? -n : n;
}

/** x rounded to four decimals, for printing. */
export const r4 = (x: number): number => (Number.isFinite(x) ? q4(x) / SCALE : x);

/** Four-decimal text, "infinite" for an infinite value. */
export const show = (x: number | null): string => (x === null ? "n/a" : Number.isFinite(x) ? r4(x).toFixed(ROUND_DECIMALS) : x > 0 ? "infinite" : "-infinite");

export const atLeast = (x: number, t: number): boolean => q4(x) >= q4(t);
export const atMost = (x: number, t: number): boolean => q4(x) <= q4(t);
export const above = (x: number, t: number): boolean => q4(x) > q4(t);
export const below = (x: number, t: number): boolean => q4(x) < q4(t);
export const within = (x: number, [lo, hi]: readonly [number, number]): boolean => atLeast(x, lo) && atMost(x, hi);

export const mean = (xs: readonly number[]): number => {
  if (!xs.length) throw new Error("mean of no values");
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};

export const median = (xs: readonly number[]): number => {
  if (!xs.length) throw new Error("median of no values");
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
