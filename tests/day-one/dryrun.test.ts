import { describe, expect, test } from "bun:test";
import { CASES, runDryrun } from "../../lanes/day-one/dryrun.ts";

describe("the keyless dry run (prereg section 12)", () => {
  test("every case passes", async () => {
    const out: string[] = [];
    const code = await runDryrun({ out: (t) => out.push(t), err: () => {} });
    expect(out.filter((l) => !l.startsWith("PASS "))).toEqual([]);
    expect(out.length).toBe(Object.keys(CASES).length);
    expect(code).toBe(0);
  }, 120_000);
});
