// Copyright (c) 2026 Garry Tan. MIT License.
// Stock counts and STOCK FAIL on both stages' edges, and unit-weighted means.
import { describe, expect, test } from "bun:test";
import { stockReading, type StockCount } from "../../../lanes/design-constructed/score/score.ts";

const counts = (row: 1 | 2 | 3, credited: number, unlabelled = 0, model: "opus" | "sol" = "opus"): StockCount[] =>
  [...Array(credited + unlabelled).keys()].map((k) => ({ model, unit: "u" + k, row, status: k < credited ? "credited" : "unlabelled", packets: [] }));

describe("STOCK FAIL", () => {
  test("stage 1: more than 2 of the 16 calibration units; on Opus lists it ends the eval, on Sol lists Sol reads untested", () => {
    expect(stockReading(counts(1, 2), "opus", 1, 16).fail).toBe(false);
    expect(stockReading(counts(1, 3), "opus", 1, 16).consequence).toBe("ends the eval");
    expect(stockReading(counts(2, 3, 0, "sol"), "sol", 1, 16).consequence).toBe("untested (stock)");
  });
  test("stage 2: more than one comparison unit in eight", () => {
    expect(stockReading(counts(2, 8), "opus", 2, 64).fail).toBe(false);
    expect(stockReading(counts(2, 9), "opus", 2, 64).consequence).toBe("untested (stock)");
    expect(stockReading(counts(2, 8, 1), "opus", 2, 64)).toMatchObject({ fail: false, toCaptain: true, consequence: "to the Captain" });
  });
  test("row 3 prints and never fails", () => {
    const r = stockReading(counts(3, 10), "opus", 1, 16);
    expect(r.fail).toBe(false);
    expect(r.rows[2]).toMatchObject({ row: 3, credited: 10, fail: false });
  });
});
