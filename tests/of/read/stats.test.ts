// Value: protects=section 11's paired machinery: units weigh equally over matched passes, the cluster is the unit, and every comparison rounds to four places.
import { describe, expect, test } from "bun:test";
import { session } from "../../../lanes/office-hours-founder/read/seams.ts";
import { compare, contrast, excludesZero, lengthAdjusted, matchUnits, unitMean, W } from "../../../lanes/office-hours-founder/read/stats.ts";

describe("unitMean", () => {
  test("a unit's score is the mean of its passes and units weigh equally", () => {
    const xs = [session({ unit: "a", pass: 1, W: 1 }), session({ unit: "a", pass: 2, W: 0 }), session({ unit: "b", W: 1 }), session({ unit: "c", W: null })];
    expect(unitMean(xs, W)).toEqual({ units: 2, mean: 0.75 });
    expect(unitMean([session({ W: null })], W)).toBeNull();
  });
});

describe("matchUnits and compare", () => {
  const a = [session({ unit: "a", pass: 1, W: 0 }), session({ unit: "a", pass: 2, W: 0 }), session({ unit: "b", W: 1 }), session({ unit: "c", W: 0 })];
  const b = [session({ unit: "a", pass: 1, W: 1 }), session({ unit: "a", pass: 2, W: null }), session({ unit: "b", W: 0 }), session({ unit: "d", W: 1 })];
  test("only passes both arms scored count; a unit with no matched pass leaves", () => {
    const m = matchUnits(a, b, W);
    expect(m.units).toEqual([{ unit: "a", a: 0, b: 1, passes: 1 }, { unit: "b", a: 1, b: 0, passes: 1 }]);
    expect(m.one_side).toBe(3);
  });
  test("compare reads b minus a over units with the worse count", () => {
    const c = compare(matchUnits(a, b, W).units)!;
    expect(c).toMatchObject({ units: 2, delta: 0, worse: 1, mean_a: 0.5, mean_b: 0.5 });
    expect(contrast(a, b, W).one_side).toBe(3);
    expect(compare([])).toBeNull();
  });
  test("rounding: means and deltas carry four decimal places", () => {
    const xs = ["a", "b", "c"].map((unit, k) => [session({ unit, W: 0 }), session({ unit, W: k === 0 ? 1 : 0 })]);
    const c = compare(matchUnits(xs.map((x) => x[0]!), xs.map((x) => x[1]!), W).units)!;
    expect(c.delta).toBe(0.3333);
    expect(c.ci95).not.toBeNull();
  });
  test("excludesZero reads rounded ends", () => {
    expect(excludesZero([0.00001, 0.2])).toBe(false);
    expect(excludesZero([0.0001, 0.2])).toBe(true);
    expect(excludesZero([-0.2, -0.0001])).toBe(true);
    expect(excludesZero(null)).toBe(false);
  });
});

describe("lengthAdjusted", () => {
  test("the intercept of the W difference regressed on the word-count difference", () => {
    const units = ["a", "b", "c", "d"];
    const a = units.map((unit) => session({ unit, W: 0, first_move_words: 20 }));
    const b = units.map((unit, k) => session({ unit, W: k < 2 ? 1 : 0, first_move_words: 20 + (k < 2 ? 10 : 0) }));
    const r = lengthAdjusted(a, b)!;
    expect(r).toMatchObject({ pairs: 4, intercept: 0, slope: 0.1 });
    expect(lengthAdjusted([session({ first_move_words: null })], [session({})])).toBeNull();
  });
});
