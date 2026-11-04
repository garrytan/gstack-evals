import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exposurePass, futilitySim, headroomPass, mddSearch, nullSize, repoLayout, SCENARIOS, screenPass, World } from "../../src/runner/stats/outcome-power.ts";

const POWER_TXT = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-04-geva-262-g-family-admission-prereg/power.txt"), "utf8").split("\n");
const U = SCENARIOS["screened U-pool"]!;

describe("the power re-simulation keeps power.py's data model and layouts", () => {
  test("repository layouts are the most concentrated the cap allows, as power.txt prints them", () => {
    const sizes = (n: number, cap: number) => repoLayout(n, cap, 20).sizes.join("-");
    const lines = POWER_TXT.filter((l) => l.includes("| sizes "));
    expect(lines.length).toBe(12);
    for (const line of lines) {
      const m = /\| (\d+)x\d+ \| sizes ([\d-]+) \|/.exec(line)!;
      expect(sizes(Number(m[1]), 8)).toBe(m[2]!);
    }
    expect(sizes(60, 3)).toBe(Array(20).fill(3).join("-"));
    expect(sizes(48, 3)).toBe([...Array(14).fill(3), ...Array(6).fill(1)].join("-"));
    expect(() => repoLayout(61, 3, 20)).toThrow(/can't fit/);
  });

  test("admission item 2's exposure line is power.txt's, digit for digit", () => {
    const line = "  " + [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1].map((e) => e.toFixed(2) + ": " + exposurePass(e).toFixed(3)).join(" | ");
    expect(POWER_TXT).toContain(line);
  });

  test("G's frozen screen keeps 1 of 2, or 1 of 3 after 0 of 2", () => {
    expect(screenPass(0.5)).toBe(0.625);
    expect(screenPass(0)).toBe(0);
    expect(screenPass(1)).toBe(0);
  });
});

describe("parity with power.txt within Monte Carlo error", () => {
  test("power at the claimed MDD, 60 x 3 at ICC 0.05 on the screened U-pool (power.txt 0.926)", () => {
    const w = new World({ n: 60, k: 3, pool: U, icc: 0.05, sims: 4000, seed: 20261104 });
    expect(Math.abs(w.power(0.186).helps - 0.926)).toBeLessThan(0.025);
  });
  test("power in the plan v3 band at ICC 0.10, 54 x 3 (power.txt 0.817)", () => {
    const w = new World({ n: 54, k: 3, pool: SCENARIOS["plan v3 band"]!, icc: 0.1, sims: 4000, seed: 7 });
    expect(Math.abs(w.power(0.192).helps - 0.817)).toBeLessThan(0.035);
  });
  test("the simulated MDD, 60 x 3 at ICC 0.05 (power.txt 15.5)", () => {
    const w = new World({ n: 60, k: 3, pool: U, icc: 0.05, sims: 4000, seed: 11 });
    expect(Math.abs(mddSearch(w)! - 15.5)).toBeLessThanOrEqual(1);
  });
  test("null size under the heterogeneous null, 60 x 3 at ICC 0 (power.txt helps 0.0200, any claim 0.0395)", () => {
    const w = new World({ n: 60, k: 3, pool: U, icc: 0, sims: 20000, seed: 13 });
    const s = nullSize(w, "heterogeneous");
    expect(Math.abs(s.helps - 0.02)).toBeLessThan(0.005);
    expect(Math.abs(s.any - 0.0395)).toBeLessThan(0.008);
  });
  test("the futility look stops no simulation at a true null or at the planned MDD (power.txt 0.0000 and 0.943)", () => {
    const w = new World({ n: 60, k: 3, pool: U, icc: 0, sims: 4000, seed: 17 });
    const zero = futilitySim(w, 0, 0.186), at = futilitySim(w, 0.186, 0.186);
    expect(zero.stop).toBeLessThanOrEqual(0.002);
    expect(at.stop).toBeLessThanOrEqual(0.002);
    expect(Math.abs(at.helps - 0.943)).toBeLessThan(0.025);
  });
  test("admission item 1's headroom pass rate (power.txt 0.989 at a pool mean of 0.50, 0.522 at 0.20)", () => {
    expect(Math.abs(headroomPass(0.5, 1, 20000, 19) - 0.989)).toBeLessThan(0.006);
    expect(Math.abs(headroomPass(0.2, 1, 20000, 23) - 0.522)).toBeLessThan(0.02);
  });
});
