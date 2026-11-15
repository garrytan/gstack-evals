// Copyright (c) 2026 Garry Tan. MIT License.
// The construct part's dry-run cases as tests (lanes/eng-planted/construct/dry.ts). Keyless cases always run; Docker
// cases run with GSTACK_EVALS_DOCKER=1 and the frozen sandbox in the lane's verifier.
import { describe, expect, test } from "bun:test";
import { DRY_CASES } from "../../../lanes/eng-planted/construct/commands.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";

describe("construct dry-run cases", () => {
  for (const c of DRY_CASES) {
    test.skipIf(!!c.docker && !DOCKER)(c.name, async () => {
      const r = await c.run();
      expect(r.detail).toBeTruthy();
      expect(r.ok).toBe(true);
    }, c.docker ? 3600000 : 60000);
  }
});
