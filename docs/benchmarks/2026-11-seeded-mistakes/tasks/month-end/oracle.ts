// Behavior oracle for month-end. Every scenario: a month from (or before) the 31st lands on the last day of the target month.
// final and touch also: ordinary dates move by exactly a month.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const dir = join(import.meta.dir, "../src/billing");
const day = (d: Date) => d.toISOString().slice(0, 10);
const fn = async (file: string, name: string) => (await import(join(dir, file + ".ts")))[name] as (d: Date) => Date;

test("a month from or before the 31st stays in the target month", async () => {
  expect(day(await (await fn("next-invoice", "nextInvoice"))(new Date("2025-01-31")))).toBe("2025-02-28");
  expect(day(await (await fn("trial-end", "trialEnd"))(new Date("2024-01-31")))).toBe("2024-02-29");
  if (existsSync(join(dir, "reminder.ts"))) expect(day(await (await fn("reminder", "reminderDate"))(new Date("2025-03-31")))).toBe("2025-02-28");
});

test.if(full)("ordinary dates move by exactly a month", async () => {
  expect(day(await (await fn("next-invoice", "nextInvoice"))(new Date("2025-12-15")))).toBe("2026-01-15");
  expect(day(await (await fn("trial-end", "trialEnd"))(new Date("2025-03-10")))).toBe("2025-04-10");
});
