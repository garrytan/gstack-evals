// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10's ordered decision table for the office-hours rewrite eval: every row reachable on planted data, the order
// respected where two rows' conditions hold, and the two readings reported beside every outcome.
import { describe, expect, test } from "bun:test";
import { decide, OUTCOMES } from "../../../lanes/office-hours-rewrite/read/decision.ts";
import { PLANTED, plant, seams } from "../../../lanes/office-hours-rewrite/read/seams.ts";

describe("section 10's rows", () => {
  for (const [name, p] of Object.entries(PLANTED)) {
    test(name + " reads row " + p.row, () => {
      const d = decide(plant(name));
      expect(d.row).toBe(p.row);
      expect(d.outcome).toBe(OUTCOMES[p.row]);
      for (const r of p.also ?? []) expect(d.conditions["row" + r as "row1"].holds).toBe(true);
    });
  }
  test("every row is reachable", () => {
    expect(new Set(Object.values(PLANTED).map((p) => p.row))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });
  test("MERGE reports every condition's value", () => {
    const d = decide(plant("merge"));
    expect(d.conditions.row4.estimate).toBeCloseTo(0.3, 12);
    expect(d.conditions.row4.lo!).toBeGreaterThan(0);
    expect(d.conditions.row1).toMatchObject({ holds: false, admission: "admitted", stops: [], missing_limit: false, judge_check_failed: false });
    expect(d.conditions.row2).toMatchObject({ holds: false, pooled_loss: false, opus_loss: false, sol_loss: false, kept_whole_harm: false, builder_right_call_loss: false, guardrail_broken: false });
    expect(d.conditions.row3.holds).toBe(false);
    expect(d.conditions.row5.holds).toBe(false);
    expect(d.conditions.row6.holds).toBe(false);
  });
  test("INCONCLUSIVE: the interval includes zero and reaches +15", () => {
    const d = decide(plant("inconclusive"));
    expect(d.conditions.row6).toEqual({ holds: true, includes_zero_reaches_bar: true });
    expect(d.conditions.row4.estimate).toBeCloseTo(0.1, 12);
  });
  test("an exact 15-point estimate meets the bar", () => {
    const d = decide(plant("merge-at-bar"));
    expect(d.conditions.row4.estimate).toBeCloseTo(0.15, 12);
    expect(d.row).toBe(4);
  });
});

describe("the two readings beside every outcome", () => {
  test("new minus none includes zero below +15: not shown to beat no gstack", () => {
    const d = decide(plant("below-bar-hi"));
    expect(d.readings.new_vs_none_not_shown.holds).toBe(true);
    expect(decide(plant("merge")).readings.new_vs_none_not_shown.holds).toBe(false);
  });
  test("current minus none wholly below zero: office-hours on main loses to no gstack", () => {
    expect(decide(plant("cut")).readings.current_loses_to_none.holds).toBe(true);
    expect(decide(plant("merge")).readings.current_loses_to_none.holds).toBe(false);
  });
});

describe("seams", () => {
  test("every seam passes", async () => {
    const out = await Promise.all(seams.map(async (s) => ({ name: s.name, ...(await s.run()) })));
    expect(out.filter((o) => !o.ok)).toEqual([]);
    expect(new Set(seams.map((s) => s.name)).size).toBe(seams.length);
    expect(seams.length).toBeGreaterThan(40);
  });
});
