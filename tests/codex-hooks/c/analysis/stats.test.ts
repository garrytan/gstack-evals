// Copyright (c) 2026 Garry Tan. MIT License.
// The exact two-sided cluster sign-flip test part C reads (twoSidedSignFlip, by convolution) against a literal
// enumeration of every sign pattern, walked in Gray-code order so each step flips one cluster's sign.
import { describe, expect, test } from "bun:test";
import { seededRandom } from "../../../../src/runner/stats/paired.ts";
import { twoSidedSignFlip } from "../../../../lanes/review-noloss/stats.ts";
import { checkAFails, pairedStats, readingOf, type Stats } from "../../../../lanes/codex-hooks/c/analysis/analysis.ts";

/** p by literal enumeration: every one of the 2^k sign patterns over the nonzero cluster sums, in Gray-code order. */
function grayCodeP(values: readonly number[]): { p: number; visited: number } {
  const v = values.filter((x) => x !== 0);
  const total = 2 ** v.length;
  const signs = v.map(() => 1);
  let sum = v.reduce((s, x) => s + x, 0);
  const observed = Math.abs(sum);
  const seen = new Set<number>();
  let code = 0;
  let extreme = 0;
  for (let i = 0; i < total; i++) {
    if (i > 0) {
      const j = Math.log2(i & -i);
      signs[j] = -signs[j]!;
      sum += 2 * signs[j]! * v[j]!;
      code ^= 1 << j;
    }
    seen.add(code);
    if (Math.abs(sum) >= observed) extreme++;
  }
  return { p: extreme / total, visited: seen.size };
}

describe("the sign-flip test", () => {
  test("4 gains in 4 clusters gives p = 0.125, the smallest p 4 clusters allow", () => {
    expect(grayCodeP([1, 1, 1, 1])).toEqual({ p: 0.125, visited: 16 });
    expect(twoSidedSignFlip([1, 1, 1, 1])).toEqual({ p: 0.125, min_p: 0.125, informative_clusters: 4 });
  });

  test("matches the literal enumeration on seeded cluster sums, zeros and losses included", () => {
    const rng = seededRandom(20261119);
    for (let trial = 0; trial < 200; trial++) {
      const k = 1 + Math.floor(rng() * 14);
      const values = Array.from({ length: k }, () => Math.floor(rng() * 7) - 3);
      const want = grayCodeP(values);
      expect(want.visited).toBe(2 ** values.filter((x) => x !== 0).length);
      const got = twoSidedSignFlip(values);
      if (values.length < 2) expect(got.p).toBeNull();
      else expect(got.p!).toBeCloseTo(want.p, 12);
    }
  });

  test("an observed sum of 0 gives p = 1", () => {
    expect(twoSidedSignFlip([2, -1, -1, 0]).p).toBe(1);
    expect(grayCodeP([2, -1, -1, 0]).p).toBe(1);
  });

  test("pairedStats sums pairs by cluster first: 4 gains in 4 clusters read not shown", () => {
    const pairs = [1, 2, 3, 4].map((c) => ({ id: "x" + c, cluster: "pr#" + c, a: 0, b: 1 }));
    const s = pairedStats(pairs)!;
    expect(s).toMatchObject({ pairs: 4, clusters: 4, delta: 1, ci95: [1, 1], p: 0.125, gains: 4, losses: 0, informative_clusters: 4 });
    expect(readingOf(s.ci95, s.p)).toBe("not_shown");
    const cancel = [...pairs, { id: "y", cluster: "pr#1", a: 1, b: 0 }];
    expect(pairedStats(cancel)!).toMatchObject({ p: 0.25, informative_clusters: 3, gains: 4, losses: 1 });
  });

  test("refuses more clusters than the frozen enumeration limit", () => {
    const pairs = Array.from({ length: 27 }, (_, c) => ({ id: "x" + c, cluster: "pr#" + c, a: 0, b: 1 }));
    expect(() => pairedStats(pairs, { maxClusters: 26 })).toThrow(/^E_CH_C_FROZEN /);
    expect(pairedStats(pairs.slice(1), { maxClusters: 26 })!.p).toBe(2 ** -25);
  });
});

describe("readings", () => {
  const rows: Array<[[number, number] | null, number | null, string]> = [
    [null, 0.01, "includes"],
    [[-0.1, 0.2], 0.01, "includes"],
    [[0, 0.2], 0.01, "includes"],
    [[0.1, 0.3], 0.2, "not_shown"],
    [[0.1, 0.3], 0.05, "not_shown"],
    [[0.1, 0.3], null, "not_shown"],
    [[0.1, 0.3], 0.049, "above"],
    [[-0.3, -0.1], 0.01, "below"],
    [[-0.3, -0.1], 0.5, "not_shown"],
  ];
  for (const [ci, p, want] of rows) test(JSON.stringify(ci) + " with p " + p + " reads " + want, () => expect(readingOf(ci, p)).toBe(want as never));

  const stats = (ci95: [number, number] | null, p: number | null): Stats => ({ pairs: 84, clusters: 26, mean_a: 0, mean_b: 0, delta: 0, ci95, p, min_p: null, informative_clusters: 0, gains: 0, losses: 0 });
  test("check A fails on its interval alone", () => {
    expect(checkAFails(stats([0.01, 0.2], 0.2))).toBe(true);
    expect(checkAFails(stats([-0.2, -0.01], 0.9))).toBe(true);
  });
  test("check A fails on its p alone", () => expect(checkAFails(stats([-0.01, 0.2], 0.03))).toBe(true));
  test("check A holds when the interval includes 0 and p is 0.05 or more, and with no pairs", () => {
    expect(checkAFails(stats([-0.01, 0.2], 0.05))).toBe(false);
    expect(checkAFails(stats([0, 0], 1))).toBe(false);
    expect(checkAFails(stats(null, null))).toBe(false);
    expect(checkAFails(null)).toBe(false);
  });
});
