// Behavior oracle for config-key-typo. Every scenario: each plan gets the limits its config entry means.
// final and touch also: the rest of every plan's limits.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { limits } from "../src/plans.ts";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const plans = JSON.parse(readFileSync(join(import.meta.dir, "../config/plans.json"), "utf8"));

test("each plan gets the limits its config entry means", async () => {
  expect((await limits("team")).maxSeats).toBe(10);
  expect((await limits("pro")).maxProjects).toBe(50);
  if (plans.enterprise) expect((await limits("enterprise")).maxSeats).toBe(100);
});

test.if(full)("the rest of every plan's limits", async () => {
  expect(await limits("free")).toEqual({ maxProjects: 3, maxSeats: 1 });
  expect(await limits("team")).toEqual({ maxProjects: 20, maxSeats: 10 });
  expect(await limits("pro")).toEqual({ maxProjects: 50, maxSeats: 5 });
});
