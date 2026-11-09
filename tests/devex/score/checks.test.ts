// Copyright (c) 2026 Garry Tan. MIT License.
// The scoring part's dry-run lines (lanes/devex/score/checks.ts, prereg 2026-11-09-geva-417 section 15 rule 4) all pass,
// keyless and under 60 seconds.
import { expect, test } from "bun:test";
import { checks } from "../../../lanes/devex/score/checks.ts";

test("every scoring, judging and reading line passes on both sides of its edge", async () => {
  const t0 = performance.now();
  const lines = await checks();
  const failed = lines.filter((l) => !l.pass).map((l) => l.rule + ": " + l.detail);
  expect(failed).toEqual([]);
  expect(lines.length).toBeGreaterThanOrEqual(30);
  expect(performance.now() - t0).toBeLessThan(60_000);
}, 60_000);
