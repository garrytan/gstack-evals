// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extPowerText, noHarmPass } from "../../lanes/outcome-skills/h2h/ext/power.ts";
import { EXT_POST_ID } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";

const BUNDLE = join(import.meta.dir, "..", "..", "wiki", "plans", EXT_POST_ID);

describe("h2hx power (section 13)", () => {
  test("the TypeScript port prints the bundle's power.txt byte for byte", () => {
    expect(extPowerText()).toBe(readFileSync(join(BUNDLE, "power.txt"), "utf8"));
  }, 120_000);

  test("the no-harm pass probabilities are the plan's at n = 100 and n = 60", () => {
    const at = (n: number, d: number) => [0, -0.05, -0.1].map((t) => Number(noHarmPass(n, d, t).toFixed(2)));
    expect(at(100, 0.2)).toEqual([0.85, 0.5, 0.15]);
    expect(at(100, 0.3)).toEqual([0.8, 0.5, 0.2]);
    expect(at(100, 0.5)).toEqual([0.74, 0.5, 0.26]);
    expect(at(60, 0.2)).toEqual([0.79, 0.5, 0.21]);
  });
});
