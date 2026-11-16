// Copyright (c) 2026 Garry Tan. MIT License.
// The stages part's dry-run cases: each frozen rule passes on its fixtures; the driven launch needs Docker.
import { describe, expect, test } from "bun:test";
import { DRY_CASES } from "../../../lanes/eng-planted/stages/commands.ts";

describe("stages dry-run cases", () => {
  for (const c of DRY_CASES.filter((x) => !x.docker)) {
    test(c.name, async () => {
      const r = await c.run();
      expect(r.detail).toBeTruthy();
      expect(r.ok).toBe(true);
    });
  }
  test("the driven launch is the one Docker case", () => {
    expect(DRY_CASES.filter((x) => x.docker).map((x) => x.name)).toEqual(["driven launch of a review and a build"]);
  });
});
