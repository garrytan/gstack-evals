// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-589 change 3: the counted run's $170 check admits a session that lands at or under the total and stops one that
// would pass it, on a temporary ledger record.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { combinedAdmit, combinedCheck, main } from "../../lanes/outcome-skills/cso/combined-cap.ts";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";

const D = 1_000_000;
const quotes = [{ words: "keyless test on a temporary ledger", by: "cso combined cap test", source: "tests/outcome-skills/cso-combined-cap.test.ts" }];
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test("the parts plus the next session are admitted at or just under the cap and stopped just over it", () => {
  expect(combinedAdmit([22.03 * D, 18.7 * D, 100 * D], 29.26 * D, 170 * D).ok).toBe(true);
  expect(combinedAdmit([22.03 * D, 18.7 * D, 100 * D], 29.27 * D, 170 * D).ok).toBe(true);
  expect(combinedAdmit([22.03 * D, 18.7 * D, 100 * D], 29.28 * D, 170 * D).ok).toBe(false);
});

test("the check reads the named programs from the record, adds the run's spend and reserve, and main exits 0 to admit and 10 to stop", () => {
  const dir = mkdtempSync(join(tmpdir(), "cso-combined-"));
  dirs.push(dir);
  const record = join(dir, "record");
  recordProgram(record, { program: "cso3", cap_micros: 90 * D, skill_cap_micros: 90 * D, skills: ["cso"], credit_rate_micros: D, quotes });
  const o = { programs: ["cso3"], spent_usd: 120, reserve_usd: 18.7, cap_usd: 170 };
  expect(combinedCheck(record, { ...o, next_usd: 31.29 })).toMatchObject({ ok: true });
  expect(combinedCheck(record, { ...o, next_usd: 31.31 }).line).toStartWith("E_CSO_COMBINED_STOP ");
  const run = (next: string) => main(["--cap", "170", "--programs", "cso3", "--spent", "120", "--reserve", "18.7", "--next", next, "--ledger-record", record]);
  expect(run("31.29")).toBe(0);
  expect(run("31.31")).toBe(10);
  expect(main(["--cap", "170"])).toBe(2);
});
