// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless dry run (prereg 2026-11-09-geva-419, section 13.5): every clause, in order, must PASS.
import { beforeAll, describe, expect, test } from "bun:test";
import { dryRun, type Line } from "../../lanes/autoplan-audit/dryrun.ts";

let lines: Line[] = [];
beforeAll(async () => {
  lines = await dryRun();
}, 240_000);

describe("autoplan audit dry run", () => {
  test("drives all 56 clauses of 13.5 in the prereg's order, plus the extra checks", () => {
    expect(lines.map((l) => l.clause)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });
  for (let clause = 1; clause <= 60; clause++)
    test("clause " + clause, () => {
      const l = lines.find((x) => x.clause === clause)!;
      expect({ clause, rule: l.rule, pass: l.pass, detail: l.detail }).toEqual({ clause, rule: l.rule, pass: true, detail: "" });
    });
});
