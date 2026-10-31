// Behavior oracle for empty-average. Every scenario: every report over no rows gives finite numbers (or null).
// Counted in the must-pass scenarios only: the averages over real rows.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../src/reports");
const reports = ["latency", "order-value", "session-length"].filter((r) => existsSync(join(dir, r + ".ts")));
const summarize = async (name: string, rows: unknown[]) => (await (await import(join(dir, name + ".ts"))).summarize(rows)) as Record<string, unknown>;

test("a report over no rows gives finite numbers or null", async () => {
  for (const name of reports) {
    for (const [key, value] of Object.entries(await summarize(name, []))) expect(value === null || Number.isFinite(value), name + "." + key + " is " + value).toBe(true);
  }
});

describe("with no mistake in place", () => {
  test("averages over real rows", async () => {
    expect((await summarize("latency", [100, 300])).meanMs).toBe(200);
    expect((await summarize("order-value", [{ total: 10 }, { total: 30 }])).averageOrder).toBe(20);
  });
});
