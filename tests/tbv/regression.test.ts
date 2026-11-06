// Copyright (c) 2026 Garry Tan. MIT License.
// The regression table reads SUPERSET: every case the frozen tbv-rule.ts.txt blocks, hits or refuses is blocked, hit or
// refused at the head, except rows marked ordered change, and every row matches its expected column.
import { expect, test } from "bun:test";
import { CASES, table } from "../../lanes/tbv/regress.ts";

test("the regression table reads SUPERSET at the head", () => {
  const { text, failing } = table();
  expect(text.split("\n").filter((l) => /LOST|MISMATCH|ERR\(/.test(l))).toEqual([]);
  expect(failing).toBe(0);
  expect(text).toContain("SUPERSET_AND_EXPECTED: ok (" + CASES.length + " cases");
}, 120_000);

test("the table keeps GEVA-322's 41 matcher cases", () => {
  expect(CASES.filter((c) => /^[HL]\d+$/.test(c.id)).length).toBe(41);
});
