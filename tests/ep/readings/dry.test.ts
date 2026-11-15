import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { DRY_CASES } from "../../../lanes/eng-planted/readings/commands.ts";

const UV = spawnSync("uv", ["--version"], { encoding: "utf8" }).status === 0;

describe("the readings part's dry-run cases", () => {
  for (const c of DRY_CASES) {
    const power = c.name.startsWith("power.py");
    test.skipIf(power && !UV)(c.name, async () => {
      const r = await c.run();
      if (!r.ok) throw new Error(c.name + ": " + r.detail);
      expect(r.detail).not.toContain("undefined");
    }, power ? 600_000 : 30_000);
  }
  test("no case needs Docker, and the names are unique", () => {
    expect(DRY_CASES.some((c) => c.docker)).toBe(false);
    expect(new Set(DRY_CASES.map((c) => c.name)).size).toBe(DRY_CASES.length);
  });
});
