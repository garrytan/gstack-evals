import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_APPS, FIXTURES } from "../../lanes/day-one/fixtures.ts";
import { loadUnit } from "../../lanes/day-one/units.ts";
import { checkPrompt } from "../../lanes/day-one/verdict.ts";

describe("the checker fixtures (prereg section 6)", () => {
  test("the public fixture unit loads, with a sample its import task names", () => {
    const u = loadUnit(join(FIXTURES, "unit"), "fixplants");
    if ("problems" in u) throw new Error(u.problems.join("; "));
    expect(u.unit.list!.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(u.unit.samples).toEqual(["plants.csv"]);
    expect(checkPrompt(u.unit.list!)).toContain("File: /samples/plants.csv");
  });
  test("each fixture app has the start contract, and the bars are 0 and every task", () => {
    for (const f of FIXTURE_APPS) expect(existsSync(join(FIXTURES, f.app, "start.sh")) && existsSync(join(FIXTURES, f.app, "server.js"))).toBe(true);
    expect(FIXTURE_APPS.map((f) => f.share)).toEqual([0, 1]);
  });
});
