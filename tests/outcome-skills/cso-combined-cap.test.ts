// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-589 change 3: the counted run's $170 check over programs cso3 and cso3b admits a session that lands at or under
// the total and stops one that would pass it, on a temporary ledger record.
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

test("the sum of both programs' committed spend plus the next session is admitted just under the cap and stopped just over it", () => {
  expect(combinedAdmit([22.03 * D, 100 * D], 47.96 * D, 170 * D).ok).toBe(true);
  expect(combinedAdmit([22.03 * D, 100 * D], 47.97 * D, 170 * D).ok).toBe(true);
  expect(combinedAdmit([22.03 * D, 100 * D], 47.98 * D, 170 * D).ok).toBe(false);
});

test("the check reads both envelopes from the record, and main exits 0 to admit and 10 to stop", () => {
  const dir = mkdtempSync(join(tmpdir(), "cso-combined-"));
  dirs.push(dir);
  const record = join(dir, "record");
  recordProgram(record, { program: "cso3", cap_micros: 90 * D, skill_cap_micros: 90 * D, skills: ["cso"], credit_rate_micros: D, quotes });
  recordProgram(record, { program: "cso3b", cap_micros: 125 * D, skill_cap_micros: 125 * D, skills: ["cso"], credit_rate_micros: D, quotes });
  expect(combinedCheck(record, ["cso3", "cso3b"], 169.99, 170)).toMatchObject({ ok: true });
  expect(combinedCheck(record, ["cso3", "cso3b"], 170.01, 170).line).toStartWith("COMBINED_STOP ");
  const run = (next: string) => main(["--cap", "170", "--next", next, "--programs", "cso3,cso3b", "--ledger-record", record]);
  expect(run("169.99")).toBe(0);
  expect(run("170.01")).toBe(10);
  expect(main(["--cap", "170"])).toBe(2);
});
