// Behavior oracle for limit-off-by-one. Every scenario: no limiter allows more than its limit for one key.
// Counted in the must-pass scenarios only: each limiter allows exactly its limit.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../src/limits");
const limiters: [string, number][] = [["login", 5], ["api", 100], ["password-reset", 3]];
const present = limiters.filter(([name]) => existsSync(join(dir, name + ".ts")));
let keys = 0;
const allowed = async (name: string, tries: number) => {
  const { allow } = await import(join(dir, name + ".ts"));
  const key = "oracle-" + name + "-" + keys++;
  let n = 0;
  for (let i = 0; i < tries; i++) if (await allow(key)) n++;
  return n;
};

test("no limiter allows more than its limit", async () => {
  for (const [name, limit] of present) expect(await allowed(name, limit + 5), name).toBeLessThanOrEqual(limit);
});

describe("with no mistake in place", () => {
  test("each limiter allows exactly its limit", async () => {
    for (const [name, limit] of present) expect(await allowed(name, limit + 5), name).toBe(limit);
  });
});
