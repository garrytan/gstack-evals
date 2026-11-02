// Copyright (c) 2026 Garry Tan. MIT License.
// The real-outcome power simulation (lanes/real-outcome/score/power.ts) against the plan's power.md (open item 15). At
// power.md's own simulation counts the port prints power.md's tables exactly, which shows it is the same simulation;
// at B6's 5,000 simulations per point every MDD lands within one 0.5-point grid step of power.md, with each point's
// Monte Carlo error reported. Keyless and seeded (mulberry32, 20261031); about two minutes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../lanes/real-outcome/score/cli.ts";
import { CEILING_GRID, EIGHT_GRID, grid, gridTable, interim, MAIN_GRID, mcSe, MIN_SIMS, repo, repoTable } from "../../lanes/real-outcome/score/power.ts";

const POWER_MD = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan/power.md"), "utf8");
/** The first fenced block after a heading of power.md. */
const block = (heading: string, nth = 0): string[] => {
  const after = POWER_MD.slice(POWER_MD.indexOf(heading));
  const parts = after.split("```");
  return parts[1 + 2 * nth].split("\n").filter((l) => l.trim() !== "");
};
const cells = (lines: string[]): number[][] => lines.filter((l) => /^\| \d/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => Number(c.trim().split(" ")[0])));

describe("power simulation reproduces power.md", () => {
  test("at power.md's 1,200 simulations per point the main grid matches power.md exactly", () => {
    expect(gridTable(grid({ ...MAIN_GRID, sims: 1200 }))).toEqual(block("## Output, main grid"));
  }, 120_000);

  test("at 5,000 simulations per point every main-grid MDD is within one grid step of power.md, with Monte Carlo error", () => {
    const g = grid({ ...MAIN_GRID, sims: MIN_SIMS });
    const want = block("## Output, main grid");
    expect(g.screen).toEqual(want.slice(0, 2));
    const got = cells(gridTable(g));
    const ref = cells(want);
    expect(got.length).toBe(18);
    for (let i = 0; i < ref.length; i++) {
      expect(got[i].slice(0, 2)).toEqual(ref[i].slice(0, 2));
      for (let j = 2; j < 5; j++) expect(Math.abs(got[i][j] - ref[i][j])).toBeLessThanOrEqual(0.5);
    }
    for (const r of g.rows)
      for (const p of [r.sd10, r.sd15, r.sd20]) {
        expect(p.sims).toBeGreaterThanOrEqual(5000);
        expect(p.power!).toBeGreaterThanOrEqual(0.8);
        expect(p.below!).toBeLessThan(0.8);
        expect(p.power_se!).toBeCloseTo(mcSe(p.power!, p.sims), 12);
        expect(p.power_se!).toBeLessThan(0.006);
      }
    expect(gridTable(g, true).join("\n")).toContain("Monte Carlo error: power at each MDD and at the grid point below it, with standard errors, at 5000 simulations per point.");
  }, 300_000);

  test("the 8-trial and ceiling-heavy tables match at 1,200 and the repository-aware table at 2,000", () => {
    expect(gridTable(grid({ ...EIGHT_GRID, sims: 1200 }))).toEqual(block("## Output, 8 trials per arm"));
    expect(gridTable(grid({ ...CEILING_GRID, sims: 1200 }))).toEqual(block("## Output, ceiling-heavy prior"));
    expect(repoTable(repo(2000))).toEqual(block("## Repository-aware check", 1));
  }, 120_000);

  test("the interim and equivalence shares at 5,000 agree with power.md within Monte Carlo error", () => {
    const ref = block("## Interim look and equivalence", 1).map((l) => l.match(/interim stop ([\d.]+)%, final difference ([\d.]+)%, same within 7 ([\d.]+)%/)!.slice(1).map((x) => Number(x) / 100));
    const rows = interim(MIN_SIMS);
    expect(rows.length).toBe(ref.length);
    rows.forEach((r, i) => {
      [r.interim_stop, r.final_difference, r.same_within_7].forEach((x, j) => {
        const old = ref[i][j];
        const tol = 3 * Math.sqrt(mcSe(x, MIN_SIMS) ** 2 + mcSe(old, 2000) ** 2) + 0.0006;
        expect(Math.abs(x - old)).toBeLessThanOrEqual(tol);
      });
    });
  }, 120_000);

  test("the CLI prints a table and warns below 5,000 simulations", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (s: string) => lines.push(s);
    try {
      expect(await main(["power", "--sims", "1200", "--table", "ceiling"])).toBe(0);
    } finally {
      console.log = log;
    }
    expect(lines[0]).toContain("below B6's minimum of 5000");
    expect(lines[1].split("\n").slice(0, 5)).toEqual(block("## Output, ceiling-heavy prior"));
  }, 60_000);
});
