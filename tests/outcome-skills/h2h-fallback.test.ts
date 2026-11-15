// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6's B sizes and fallbacks over planted supply counts.
import { describe, expect, test } from "bun:test";
import { planB } from "../../lanes/outcome-skills/h2h/breadth/fallback.ts";

describe("B fallbacks", () => {
  test("enough B1: half of n, no widening, every stage 1 position reached", () => {
    const p = planB({ b1: { primary: 40, widened: 9, multilang: 8 }, b2: { primary: 100, widened: 9 } });
    expect([p.n, p.b1.target, p.b1.units, p.b1.steps, p.b1.infeasible, p.b2.share, p.b2.units, p.b2.steps]).toEqual([60, 30, 30, [], false, 30, 30, []]);
    expect(p.b1.stage1_positions).toEqual([6, 12, 18, 24, 30, 36]);
    expect([p.b1.reserves, p.b1.stage0]).toEqual([5, 1]);
  });
  test("short B1 widens, then adds the MultiLang rows, then fills what it has", () => {
    const p = planB({ b1: { primary: 12, widened: 5, multilang: 8 }, b2: { primary: 100, widened: 0 } });
    expect(p.b1.steps).toEqual(["widen_to_2025-06-01", "multilang_rows"]);
    expect([p.b1.usable, p.b1.units, p.b1.infeasible, p.b2.share]).toEqual([25, 25, false, 35]);
    expect(p.b1.stage1_positions).toEqual([6, 12, 18, 24]);
  });
  test("B1 under 20 after both fallbacks is infeasible and B is B2 alone", () => {
    const p = planB({ b1: { primary: 10, widened: 3, multilang: 4 }, b2: { primary: 100, widened: 0 } });
    expect([p.b1.infeasible, p.b1.code, p.b1.units, p.b1.stage1_positions, p.b2.share, p.b2.units]).toEqual([true, "E_H2H_B_INFEASIBLE", 0, [], 60, 60]);
  });
  test("B2 short of its share widens, and a shortfall is reported, never filled", () => {
    expect(planB({ b1: { primary: 40, widened: 0, multilang: 0 }, b2: { primary: 20, widened: 50 } }).b2).toMatchObject({ steps: ["widen_to_2025-06-01"], units: 30, short: 0 });
    expect(planB({ b1: { primary: 40, widened: 0, multilang: 0 }, b2: { primary: 10, widened: 5 } }).b2).toMatchObject({ units: 15, short: 15 });
  });
});
