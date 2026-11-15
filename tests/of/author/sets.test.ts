// Value: protects=section 3's quotas and minimums, start rule 12's supply stop, the reserve rule and the fixed comparison record.
import { describe, expect, test } from "bun:test";
import { QUOTA } from "../../../lanes/office-hours-founder/frozen.ts";
import { comparisonRecord, fillSets, projectSupply, replaceDropped, setsFull, type Member } from "../../../lanes/office-hours-founder/author/sets.ts";
import type { ProjectType, Shape } from "../../../lanes/office-hours-founder/types.ts";

const TYPES: ProjectType[] = ["B2B", "consumer", "marketplace", "developer tools"];
const SHAPES: Shape[] = ["s1", "s2", "s3", "s4", "s5", "s6"];
const member = (draw: number, type: ProjectType = TYPES[draw % 4]!, shape: Shape = SHAPES[draw % 6]!): Member => ({ id: "c" + draw, draw, type, shape, author: draw % 2 ? "sol" : "argon", digest: "d" + draw });

describe("fillSets", () => {
  test("fills calibration, comparison and reserve in draw order", () => {
    const s = fillSets(Array.from({ length: 100 }, (_, k) => member(k + 1)), QUOTA);
    expect(setsFull(s, QUOTA)).toBe(true);
    expect(s.calibration.map((m) => m.draw)).toEqual(Array.from({ length: 16 }, (_, k) => k + 1));
    expect(s.reserve.map((m) => m.draw)).toEqual([81, 82, 83, 84, 85, 86]);
  });
  test("holds a calibration place for a named type still short of 3", () => {
    const pool = [...Array.from({ length: 20 }, (_, k) => member(k + 1, "B2B")), member(21, "consumer"), member(22, "consumer"), member(23, "consumer"), member(24, "marketplace"), member(25, "marketplace"), member(26, "marketplace"), member(27, "developer tools"), member(28, "developer tools"), member(29, "developer tools")];
    const s = fillSets(pool, QUOTA);
    expect(s.calibration.filter((m) => m.type === "B2B")).toHaveLength(7);
    expect(s.calibration.map((m) => m.draw).slice(7)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29]);
    expect(s.comparison[0]!.draw).toBe(8);
  });
  test("comparison keeps room for 6 of each shape", () => {
    const pool = Array.from({ length: 200 }, (_, k) => member(k + 1, TYPES[k % 4]!, k < 150 ? "s1" : SHAPES[k % 6]!));
    const s = fillSets(pool, QUOTA);
    for (const sh of SHAPES) expect(s.comparison.filter((m) => m.shape === sh).length).toBeGreaterThanOrEqual(6);
  });
});

describe("projectSupply", () => {
  test("projects from the pilot's cost per passing unit, failures included", () => {
    const p = projectSupply({ spent: 8, passing: 2, cap: 400, mdd: () => 0.12 });
    expect(p).toMatchObject({ per_passing: 4, needed: 94, projected: 376, fits: true, comparison_fillable: 64 });
  });
  test("a pilot with no passing unit stops authoring", () => {
    expect(() => projectSupply({ spent: 8, passing: 0, cap: 400, mdd: () => 1 })).toThrow(/E_OF_SUPPLY_SHORT.*0 comparison units/);
  });
});

describe("replaceDropped", () => {
  const s = fillSets(Array.from({ length: 100 }, (_, k) => member(k + 1)), QUOTA);
  test("the first reserve replaces a comparison unit that dropped before stage 2", () => {
    const r = replaceDropped(s, "c20", new Set());
    expect(r.comparison.some((m) => m.id === "c20")).toBe(false);
    expect(r.comparison.at(-1)!.id).toBe("c81");
    expect(r.reserve.map((m) => m.id)).toEqual(["c82", "c83", "c84", "c85", "c86"]);
  });
  test("no replacement once a stage 2 session ran on the unit", () => {
    expect(replaceDropped(s, "c20", new Set(["c20"]))).toBe(s);
  });
});

describe("comparisonRecord", () => {
  test("counts the composition and digests id and digest lines in draw order", () => {
    const a = comparisonRecord([member(2), member(1)]), b = comparisonRecord([member(1), member(2)]);
    expect(a).toEqual(b);
    expect(a.size).toBe(2);
    expect(a.authors).toEqual({ argon: 1, sol: 1 });
  });
});
