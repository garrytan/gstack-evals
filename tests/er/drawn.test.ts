// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { isDrawn } from "../../lanes/eng-review/types.ts";

describe("only drawn units enter a set (F7)", () => {
  test("isDrawn: a draw wrote the set and a rank of 1 or more", () => {
    expect(isDrawn({ set: "calibration", rank: 1 })).toBe(true);
    expect(isDrawn({ set: "calibration", rank: 2 }, "calibration")).toBe(true);
    expect(isDrawn({ set: "calibration", rank: 1 }, "comparison")).toBe(false);
    expect(isDrawn({ set: "calibration", rank: 0 })).toBe(false);
    expect(isDrawn({ set: "comparison" })).toBe(false);
    expect(isDrawn({ set: "pilot", rank: 3 })).toBe(false);
  });
});
