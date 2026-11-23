// Copyright (c) 2026 Garry Tan. MIT License.
// The audit's estimators against power.py (prereg 2026-11-09-geva-419, section 11, part A and D).
import { describe, expect, test } from "bun:test";
import { POWER_FIXED, powerFixed } from "../../lanes/autoplan-audit/dryrun.ts";
import { corrected, kappa, landedInterval, overMissing, percentileLinear, t975, wilson } from "../../lanes/autoplan-audit/stats.ts";

describe("autoplan audit stats", () => {
  test("power.py part A on fixed inputs (values printed by power-check.py)", () => {
    expect(powerFixed()).toBe(true);
    expect(POWER_FIXED.point).toBeCloseTo(0.8627450980392156, 12);
  });
  test("Wilson matches power.py part D: 22 of 22 reads MET at 0.80 and 21 of 22 does not", () => {
    expect(wilson(22, 22)[0]).toBeGreaterThanOrEqual(0.8);
    expect(wilson(21, 22)[0]).toBeLessThan(0.8);
    expect(wilson(13, 22)[1]).toBeLessThan(0.8);
    expect(wilson(14, 22)[1]).toBeGreaterThanOrEqual(0.8);
  });
  test("t quantiles: power.py's table to 15 degrees of freedom, exact above", () => {
    expect(t975(9)).toBe(2.262);
    expect(t975(20)).toBeCloseTo(2.086, 3);
  });
  test("Rogan-Gladen and its floor", () => {
    expect(corrected(0.9, 1, 1)).toBeCloseTo(0.9, 12);
    expect(corrected(0.5, 0.5, 0.5)).toBe(0 / 1e-6);
  });
  test("numpy linear percentiles", () => {
    expect(percentileLinear([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentileLinear([0, 10], 2.5)).toBeCloseTo(0.25, 12);
  });
  test("kappa and the missing-rate rule", () => {
    expect(kappa([[true, true], [false, false]])).toBe(1);
    expect(overMissing(20, 100)).toBe(false);
    expect(overMissing(21, 100)).toBe(true);
  });
  test("the two missing bounds order lost <= labelled <= landed", () => {
    const runs = Array.from({ length: 6 }, (_, i) => ({ k: 4 + (i % 2), n: 5, m: 1 }));
    const gold = { sensK: 39, sensN: 40, specK: 38, specN: 40 };
    const [lost, lab, landed] = (["lost", "labelled", "landed"] as const).map((bound) => landedInterval(runs, gold, { seed: 7, draws: 2000, bound }));
    expect(lost!.point).toBeLessThanOrEqual(lab!.point);
    expect(lab!.point).toBeLessThanOrEqual(landed!.point);
  });
});
