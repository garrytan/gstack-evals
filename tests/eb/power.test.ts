import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("power.py is seeded and prints the table's row format", () => {
  const run = () => spawnSync("python3", [join(import.meta.dir, "../../lanes/eng-build/power.py"), "--units", "24", "--k", "2", "--sims", "60"], { encoding: "utf8" });
  const a = run();
  expect(a.status).toBe(0);
  expect(a.stdout).toBe(run().stdout);
  expect(a.stdout.trim().split("\n").at(-1)).toMatch(/^pooled  24 2  0\.3  0\.5   (0\.\d{3}|n\/a)$/);
});
