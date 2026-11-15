// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6's B fallbacks over planted supply counts.
import { describe, expect, test } from "bun:test";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { b1Floor, planB } from "../../lanes/outcome-skills/h2h/breadth/fallback.ts";

describe("B fallbacks", () => {
  test("the B1 floor is 20 stage 2 units plus 6 stage 1 units, 5 reserves and stage 0", () => {
    expect(b1Floor(readPrereg())).toBe(32);
  });
  test("enough B1: stage 2 up to half of n, no widening", () => {
    const p = planB({ b1: { primary: 60, widened: 9, multilang: 8 }, b2: { primary: 100, widened: 9 } });
    expect([p.n, p.b1.stage2, p.b1.steps, p.b1.windows, p.b1.infeasible, p.b2.share, p.b2.steps, p.b2.short]).toEqual([60, 30, [], ["primary"], false, 30, [], 0]);
    expect(planB({ b1: { primary: 40, widened: 0, multilang: 0 }, b2: { primary: 100, widened: 0 } }).b1.stage2).toBe(28);
  });
  test("short B1 widens, then adds the MultiLang rows", () => {
    const p = planB({ b1: { primary: 20, widened: 8, multilang: 8 }, b2: { primary: 100, widened: 0 } });
    expect([p.b1.steps, p.b1.windows, p.b1.multilang, p.b1.usable, p.b1.stage2, p.b1.infeasible, p.b2.share]).toEqual([["widen_to_2025-06-01", "multilang_rows"], ["primary", "widened"], true, 36, 24, false, 36]);
  });
  test("B1 under the floor after both fallbacks is infeasible and B is B2 alone", () => {
    const p = planB({ b1: { primary: 20, widened: 5, multilang: 6 }, b2: { primary: 100, widened: 0 } });
    expect([p.b1.usable, p.b1.infeasible, p.b1.code, p.b1.stage2, p.b2.share]).toEqual([31, true, "E_H2H_B_INFEASIBLE", 0, 60]);
  });
  test("B2 short of its share widens, and a shortfall is reported, never filled", () => {
    expect(planB({ b1: { primary: 60, widened: 0, multilang: 0 }, b2: { primary: 20, widened: 50 } }).b2).toMatchObject({ steps: ["widen_to_2025-06-01"], windows: ["primary", "widened"], usable: 70, short: 0 });
    expect(planB({ b1: { primary: 60, widened: 0, multilang: 0 }, b2: { primary: 10, widened: 5 } }).b2).toMatchObject({ usable: 15, short: 15 });
  });
});
