// Copyright (c) 2026 Garry Tan. MIT License.
// pv sets calibration (prereg section 4): quotas first, fill-ins counting back from draw 16, the supply stop on a second
// short type, twins of the first 8 draws, pilot units and twins left out. Synthetic pools; keyless.
import { describe, expect, test } from "bun:test";
import { drawCalibration, type PoolUnit } from "../../lanes/product-value/author/sets.ts";
import type { ProjectType } from "../../lanes/product-value/types.ts";

const u = (id: string, type: ProjectType, source: "public" | "transposed" = "public", set = "calibration"): PoolUnit => ({ id, type, source, set });
const many = (prefix: string, n: number, type: ProjectType, source: "public" | "transposed" = "public") => Array.from({ length: n }, (_, i) => u(prefix + i, type, source));

describe("the calibration draw", () => {
  test("quotas first: 2 of each named type lead the draw, the rest follow in seeded order, twins are draws 1 to 8", () => {
    const pool = [...many("o", 20, "other"), ...many("m", 3, "mobile"), ...many("c", 3, "consumer"), ...many("s", 3, "server")];
    const { slice, twins } = drawCalibration(pool);
    expect(slice).toHaveLength(16);
    expect(slice.slice(0, 6).map((d) => d.type).sort()).toEqual(["consumer", "consumer", "mobile", "mobile", "server", "server"]);
    expect(slice.every((d) => d.source === "public" && !d.fill_in)).toBe(true);
    expect(twins).toEqual(slice.slice(0, 8).map((d) => d.id));
    expect(drawCalibration([...pool].reverse()).slice.map((d) => d.id)).toEqual(slice.map((d) => d.id));
  });

  test("one public mobile unit: one fill-in takes draw 16; none: two take draws 15 and 16", () => {
    const base = [...many("o", 20, "other"), ...many("c", 2, "consumer"), ...many("s", 2, "server"), ...many("tm", 3, "mobile", "transposed")];
    const one = drawCalibration([...base, u("m0", "mobile")]).slice;
    expect(one.filter((d) => d.fill_in).map((d) => d.rank)).toEqual([16]);
    expect(one.filter((d) => d.source === "public")).toHaveLength(15);
    const none = drawCalibration(base).slice;
    expect(none.filter((d) => d.fill_in).map((d) => d.rank)).toEqual([15, 16]);
    expect(none.filter((d) => d.fill_in).every((d) => d.type === "mobile")).toBe(true);
  });

  test("a second short type is a supply stop; too few transposed units of the short type are one too", () => {
    const base = [...many("o", 20, "other"), ...many("s", 2, "server"), ...many("tm", 3, "mobile", "transposed"), ...many("tc", 3, "consumer", "transposed")];
    expect(() => drawCalibration(base)).toThrow(/second named type/);
    expect(() => drawCalibration([...many("o", 20, "other"), ...many("s", 2, "server"), ...many("c", 2, "consumer"), ...many("tm", 1, "mobile", "transposed")])).toThrow(/fill-ins/);
  });

  test("too few audited public units waits for more; pilot units and twins never enter", () => {
    const pool = [...many("o", 9, "other"), ...many("m", 2, "mobile"), ...many("c", 2, "consumer"), ...many("s", 2, "server")];
    expect(() => drawCalibration(pool)).toThrow(/needs 16 audited public units; 15/);
    expect(() => drawCalibration([...pool, u("p0", "other", "public", "pilot"), { ...u("t0", "other", "transposed"), twin_of: "o0" }])).toThrow(/needs 16/);
    expect(drawCalibration([...pool, u("o9", "other")]).slice).toHaveLength(16);
  });
});
