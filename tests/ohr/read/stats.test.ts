// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite eval's two intervals, pinned to published worked examples (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, sections 7 and 8, and its attachment power.txt).
import { describe, expect, test } from "bun:test";
import { correctedNewcombe, designEffect, newcombe, tCdf, tInterval, tQuantile, type KeptPair } from "../../../lanes/office-hours-rewrite/read/stats.ts";

describe("Student t", () => {
  test("quantiles match published tables", () => {
    expect(tQuantile(0.975, 9)).toBeCloseTo(2.262157163, 8);
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.70620474, 7);
    expect(tQuantile(0.975, 39)).toBeCloseTo(2.02269092, 8);
    expect(tQuantile(0.8, 39)).toBeCloseTo(0.85093502, 8);
    expect(tQuantile(0.025, 9)).toBeCloseTo(-2.262157163, 8);
    expect(tCdf(0, 5)).toBe(0.5);
    expect(tCdf(-2.570581836, 5)).toBeCloseTo(0.025, 9);
  });
  test("Student's sleep data (R datasets::sleep, paired) gives mean 1.58 and 0.7001142 to 2.4598858", () => {
    const g1 = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0];
    const g2 = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];
    const t = tInterval(g2.map((v, k) => v - g1[k]!));
    expect(t.n).toBe(10);
    expect(t.mean!).toBeCloseTo(1.58, 12);
    expect(Math.abs(t.lo! - 0.7001142)).toBeLessThan(1e-7);
    expect(Math.abs(t.hi! - 2.4598858)).toBeLessThan(1e-7);
  });
  test("fewer than two clusters gives no interval", () => {
    expect(tInterval([0.5])).toEqual({ n: 1, mean: 0.5, sd: null, lo: null, hi: null });
    expect(tInterval([])).toEqual({ n: 0, mean: null, sd: null, lo: null, hi: null });
  });
});

describe("Newcombe's method 10 with the design effect", () => {
  test("Altman's worked example: a 14, b 5, c 0, d 22 gives 0.1220, 0.0115 to 0.2265", () => {
    const r = newcombe(14, 5, 0, 22);
    expect(r.diff.toFixed(4)).toBe("0.1220");
    expect(r.lo.toFixed(4)).toBe("0.0115");
    expect(r.hi.toFixed(4)).toBe("0.2265");
  });
  test("section 7's example: both models lose the same one brief of 24, uncorrected -0.140, corrected -0.202", () => {
    const pairs: KeptPair[] = [];
    for (let b = 0; b < 24; b++) for (const m of ["opus", "sol"]) pairs.push({ cluster: "b" + b, y1: b !== 0, y0: true, model: m });
    const r = correctedNewcombe(pairs);
    expect([r.a, r.b, r.c, r.d, r.n]).toEqual([46, 0, 2, 0, 48]);
    expect(r.naive.lo.toFixed(3)).toBe("-0.140");
    expect(r.naive.lo.toFixed(4)).toBe("-0.1398");
    expect(r.design_effect).toBe(2);
    expect(r.lo.toFixed(3)).toBe("-0.202");
    expect(r.lo.toFixed(4)).toBe("-0.2024");
    expect(r.lo.toFixed(4)).toBe(newcombe(23, 0, 1, 0).lo.toFixed(4));
  });
  test("the design effect is cluster-robust over independent variance, held between 1 and 2", () => {
    const p = (cluster: string, y1: boolean, y0: boolean): KeptPair => ({ cluster, y1, y0, model: "opus" });
    expect(designEffect([p("a", true, true), p("b", true, true)])).toBe(1);
    expect(designEffect([p("a", false, true), p("a", true, false)])).toBe(2);
    expect(designEffect([p("a", false, true), p("a", true, false), p("b", false, true), p("b", true, false)])).toBe(1);
    const k = designEffect([p("a", false, true), p("a", true, true), p("b", true, true), p("c", true, false), p("c", true, true)]);
    const d = [-1, 0, 0, 1, 0], mean = 0, n = 5, g = 3;
    const vc = (g / (g - 1)) * ((-1 + 0 - 2 * mean) ** 2 + (0 - mean) ** 2 + (1 + 0 - 2 * mean) ** 2) / n ** 2;
    const vs = d.reduce((t, x) => t + (x - mean) ** 2, 0) / n ** 2;
    expect(k).toBeCloseTo(Math.min(2, Math.max(1, vc / vs)), 12);
    expect(designEffect([p("a", false, true), p("a", false, true), p("b", true, true), p("b", true, true), p("c", true, true)])).toBe(2);
  });
  test("a brief with only one model's pair is a cluster of one", () => {
    const pairs: KeptPair[] = [{ cluster: "a", y1: false, y0: true, model: "opus" }, { cluster: "b", y1: true, y0: true, model: "opus" }, { cluster: "b", y1: true, y0: true, model: "sol" }, { cluster: "c", y1: true, y0: false, model: "sol" }];
    const r = correctedNewcombe(pairs);
    expect(r.clusters).toBe(3);
    expect(r.n).toBe(4);
  });
});
