import { describe, expect, test } from "bun:test";
import { holm, infer, lengthAdjusted, levelOf, pairUnits, word } from "../../../lanes/eng-planted/readings/stats.ts";
import { fxUnit } from "../../../lanes/eng-planted/readings/fixtures.ts";

const reading = (lo: number, hi: number, p: number) => ({ estimate: (lo + hi) / 2, lo, hi, p, units: 10, repos: 10, worse: 0, sd: 0.1, mdd: 0.28 });

describe("words", () => {
  test("helps and hurts need p and the interval to agree; zero inside is no measurable difference; else not shown", () => {
    expect(word(reading(0.01, 0.2, 0.05))).toBe("helps");
    expect(word(reading(-0.2, -0.01, 0.01))).toBe("hurts");
    expect(word(reading(-0.1, 0.2, 0.01))).toBe("no measurable difference");
    expect(word(reading(0.01, 0.2, 0.06))).toBe("not shown");
    expect(word(reading(0.01, 0.2, 0.01), 0.07)).toBe("not shown");
  });
});

describe("Holm across the two families", () => {
  test("adjusts step-down and rejects only while each step holds", () => {
    const h = holm([{ arm: "standalone", p: 0.03 }, { arm: "engphase", p: 0.04 }]);
    expect(h.map((x) => [x.arm, x.adjusted, x.rejects])).toEqual([["standalone", 0.06, false], ["engphase", 0.06, false]]);
    const g = holm([{ arm: "standalone", p: 0.01 }, { arm: "engphase", p: 0.04 }]);
    expect(g.map((x) => x.rejects)).toEqual([true, true]);
    expect(holm([{ arm: "engphase", p: 0.04 }])[0]!.rejects).toBe(true);
  });
});

describe("paired, repository-clustered inference", () => {
  const units = Array.from({ length: 12 }, (_, i) => fxUnit(i, 1, 1, { repo: "r" + Math.floor(i / 3) }));
  test("pairs by unit, drops a unit missing a side, and counts units worse and repositories", () => {
    const ds = pairUnits(units, (u) => (u.id === "u0" ? null : Number(u.id.slice(1)) % 2), () => 0.5);
    expect(ds).toHaveLength(11);
    const r = infer(ds, 7, 2000)!;
    expect(r.repos).toBe(4);
    expect(r.worse).toBe(5);
    expect(infer(ds, 7, 2000)).toEqual(r);
  });
  test("a constant level has its lower bound at the level", () => {
    const r = levelOf(units, () => 0.65, 1, 2000)!;
    expect(r.lo).toBeCloseTo(0.65, 12);
    expect(r.hi).toBeCloseTo(0.65, 12);
  });
  test("the length-adjusted line is the difference at equal words", () => {
    const la = lengthAdjusted([[0, 0.1], [1000, 0.3], [2000, 0.5]])!;
    expect(la.intercept).toBeCloseTo(0.1, 12);
    expect(la.slopePer1000).toBeCloseTo(0.2, 12);
    expect(lengthAdjusted([])).toBeNull();
  });
});
