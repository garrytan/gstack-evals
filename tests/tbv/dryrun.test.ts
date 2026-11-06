// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless dry run at the head (build plan section 10): the frozen bundle's own run with this checkout as the scorer,
// the 150 frozen checks against the head rule through adapt.ts, and the amendment's and the build's own rules.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dryrun, ORDERED } from "../../lanes/tbv/dryrun.ts";

const DIR = mkdtempSync(join(tmpdir(), "tbv-dryrun-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

test("the dry run at the head prints FAIL 0: PASS 150 in the frozen bundle's own run, every frozen check at the head but the listed ordered changes, and part 3", async () => {
  const lines: string[] = [];
  const r = await dryrun(join(DIR, "out"), { out: (t) => lines.push(...t.split("\n")), err: (t) => lines.push(t) });
  const text = lines.join("\n");
  expect(lines.filter((l) => l.startsWith("FAIL "))).toEqual([]);
  expect(r.fail).toBe(0);
  expect(r.pass).toBeGreaterThanOrEqual(40);
  expect(text).toContain("PASS the frozen dry run exits 0 and prints PASS 150, FAIL 0");
  expect(text).toContain("PASS all 150 frozen checks ran at the head");
  for (const label of Object.keys(ORDERED)) expect(text).toContain("ordered change: " + JSON.stringify(label));
  expect(text).not.toContain("(NOT LISTED)");
  for (const part of ["3a.", "3b.", "3c.", "3d.", "3e.", "3f.", "3g.", "3h.", "3i.", "3j.", "3k.", "3l.", "3m."]) expect(text).toContain("## " + part);
  expect(text.trim().split("\n").at(-1)).toBe("PASS " + r.pass + ", FAIL 0");
}, 900_000);
