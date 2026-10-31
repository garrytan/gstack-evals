// Behavior oracle for config-key-typo. Every scenario: each plan gets the limits its config entry means, the enterprise
// plan included once fresh or fresh-ok adds it (found by name, wherever the tree keeps it).
// Counted in the must-pass scenarios only: the rest of every plan's limits.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { limits } from "../src/plans.ts";

const enterprise = readFileSync(join(import.meta.dir, "../config/plans.json"), "utf8").includes('"enterprise"');

test("each plan gets the limits its config entry means", async () => {
  expect((await limits("team")).maxSeats).toBe(10);
  expect((await limits("pro")).maxProjects).toBe(50);
  if (enterprise) expect((await limits("enterprise")).maxSeats).toBe(100);
});

describe("with no mistake in place", () => {
  test("the rest of every plan's limits", async () => {
    expect(await limits("free")).toEqual({ maxProjects: 3, maxSeats: 1 });
    expect(await limits("team")).toEqual({ maxProjects: 20, maxSeats: 10 });
    expect(await limits("pro")).toEqual({ maxProjects: 50, maxSeats: 5 });
    if (enterprise) expect(await limits("enterprise")).toEqual({ maxProjects: 500, maxSeats: 100 });
  });
});
