// Copyright (c) 2026 Garry Tan. MIT License.
// The lane's pinned constants against the B2 plan as merged on main (3e02b099) and its pre-run change 1: the bounds from
// power.txt, the interim half, the item caps (preregistered, and as change 1 records them), sessions and expected spend, the all-in stop, the pilot's arm caps and tasks, the procedure gate and the
// INCOMPLETE share, each read from the plan's own files. Keyless.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { B2, BOUNDS, BUNDLE, CAPS_USD, CHANGE_1, PREREG_CAPS_USD, DRAW, drawnTasks, EXPECTED_USD, GATE, loadBundle, PILOT_ARM_CAPS_USD, PILOT_TASKS, REPO, SESSIONS } from "../../lanes/test-first/pins.ts";

const dir = join(REPO, BUNDLE);
const readme = readFileSync(join(dir, "README.md"), "utf8"), power = readFileSync(join(dir, "power.txt"), "utf8"), draw = readFileSync(join(dir, "draw.txt"), "utf8");
const num = (s: string) => Number(s.replaceAll(",", "").replace("$", ""));
const one = (re: RegExp, text: string): RegExpExecArray => { const m = re.exec(text); if (!m) throw new Error("not in the plan: " + re); return m; };

describe("the lane's pins match the merged plan", () => {
  test("every attachment hashes to the README's front matter", () => {
    expect([...loadBundle().digests.keys()].sort()).toEqual(["draw.py", "draw.txt", "hm-screened.txt", "power.py", "power.txt", "tasks.txt"]);
  });
  test("the bounds: power.txt's look and end for passes, and the regression bound", () => {
    const p = one(/look at (\d+) of (\d+) tasks \(t = [\d.]+\): look \|z\| >= ([\d.]+), end \|z\| >= ([\d.]+)/, power);
    expect([num(p[3]!), num(p[4]!)]).toEqual([BOUNDS.look, BOUNDS.end]);
    expect([num(p[1]!), num(p[2]!)]).toEqual([B2.half, B2.tasks]);
    expect(num(one(/passes with a regression test, alpha 0\.01 two-sided, read at the end only: \|z\| >= ([\d.]+)/, power)[1]!)).toBe(BOUNDS.regression);
    expect(readme).toContain("2.917 at the look, 2.068 at the end");
    expect(readme).toContain("|z| of at least " + BOUNDS.regression);
  });
  test("the interim half: the first 92 tasks, as section 11 and draw.txt say", () => {
    expect(readme).toContain("At: half the units, the first " + B2.half + " of the " + B2.tasks + " tasks in run order");
    expect(one(/interim half: the first (\d+) tasks in run order, ordered sha256 ([0-9a-f]{64})/, draw).slice(1)).toEqual([String(B2.half), DRAW.halfSha256]);
    expect(drawnTasks().half.length).toBe(B2.half);
  });
  test("the items: sessions, expected spend and preregistered caps from the money table, and the all-in stop", () => {
    for (const item of Object.keys(CAPS_USD) as (keyof typeof CAPS_USD)[]) {
      const m = one(new RegExp("^\\| " + item + " \\| (\\d+) \\| ([\\d.]+) \\| (\\d+) \\|$", "m"), readme);
      expect([num(m[1]!), num(m[2]!), num(m[3]!)]).toEqual([SESSIONS[item], EXPECTED_USD[item], PREREG_CAPS_USD[item]]);
    }
    expect(num(one(/plus this thread's own counter passes ([\d,]+) all-in/, readme)[1]!)).toBe(B2.stopUsd);
  });
  test("the recorded caps are pre-run change 1's, which keeps the sum and the all-in stop", () => {
    const change = readFileSync(join(REPO, CHANGE_1), "utf8");
    for (const item of Object.keys(CAPS_USD) as (keyof typeof CAPS_USD)[]) {
      const m = one(new RegExp("^\\| " + item + " \\| (\\d+) \\| ([\\d.]+) \\| (\\d+) \\| (\\d+) \\|$", "m"), change);
      expect([num(m[1]!), num(m[2]!), num(m[3]!), num(m[4]!)]).toEqual([SESSIONS[item], EXPECTED_USD[item], PREREG_CAPS_USD[item], CAPS_USD[item]]);
    }
    expect(change).toContain("the paid caps still sum to $1,365, and the all-in stop stays $" + B2.stopUsd.toLocaleString("en-US"));
  });
  test("the pilot: each arm's pilot cap from section 12, and the three tasks from section 3 and draw.txt", () => {
    for (const a of Object.keys(PILOT_ARM_CAPS_USD) as (keyof typeof PILOT_ARM_CAPS_USD)[]) {
      expect(num(one(new RegExp("^\\| " + a + " \\| \\$[\\d.,]+ \\| (\\$[\\d.]+) \\|", "m"), readme)[1]!)).toBe(PILOT_ARM_CAPS_USD[a]);
    }
    expect(one(/^pilot 3 (.+)$/m, draw)[1]!.split(" ")).toEqual([...PILOT_TASKS]);
    expect(readme).toContain("The pilot takes the first three calibration tasks in the same seeded shuffle of the sorted calibration tasks: " + PILOT_TASKS[0] + ", " + PILOT_TASKS[1] + " and " + PILOT_TASKS[2] + ".");
    expect(drawnTasks().pilot).toEqual([...PILOT_TASKS]);
  });
  test("the procedure gate and the INCOMPLETE share", () => {
    expect(readme).toContain("prove-it's followed rate is at least " + 100 * GATE.pooledPoints + " points above the gstack arm's, and on Opus 5.5 prove-it's followed rate is at least " + 100 * GATE.opusRate + "%");
    expect(readme).toContain("more than " + 100 * B2.gapMax + "% of its tasks not graded");
  });
});
