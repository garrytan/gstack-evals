// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { approvedCaps, run, simulateTwins, STAGE1_ITEMS } from "../../lanes/product-value/dryrun.ts";
import { SEED } from "../../lanes/product-value/stats.ts";
import { capture } from "./fixtures.ts";

describe("pv dryrun (section 17 item 4)", () => {
  test("every scoring-side rule passes; it fails only on the run-side hook until that module exists", async () => {
    const c = capture();
    const code = await run([], c.io);
    const fails = c.out.filter((l) => l.startsWith("FAIL "));
    expect(c.out.filter((l) => l.startsWith("PASS ")).length).toBeGreaterThanOrEqual(60);
    expect(fails.every((l) => l.startsWith("FAIL run side:"))).toBe(true);
    expect(code).toBe(fails.length ? 1 : 0);
    for (const rule of ["one ledger lease per stage 1 item", "twin simulation at ICC 0.5", "twin simulation at ICC 0.843", "oracle half cap", "the framing reading", "the MDD tie rule", "a particle-1 split"]) expect(c.out.some((l) => l.startsWith("PASS ") && l.includes(rule))).toBe(true);
  }, 120_000);

  test("the twin simulations separate identical and unrelated twins", () => {
    expect(simulateTwins({ rho: 0.5, p0: 0.35, related: true, runs: 200, seed: SEED })).toBeLessThanOrEqual(0.064);
    expect(simulateTwins({ rho: 0.5, p0: 0.35, related: false, runs: 200, seed: SEED })).toBeGreaterThanOrEqual(0.5);
  }, 60_000);

  test("without the approvals file the frozen stage 1 list stands; a drifted cap is named", async () => {
    expect(approvedCaps("/nonexistent/approvals.md").caps).toEqual({ ...STAGE1_ITEMS });
    const f = "/tmp/pv-approvals-" + process.pid + ".md";
    await Bun.write(f, "## Item caps\n" + Object.entries(STAGE1_ITEMS).map(([k, v]) => k + " $" + (k === "pv-o1-render" ? v + 1 : v)).join("; ") + "\n");
    expect(approvedCaps(f).drift).toEqual(["pv-o1-render"]);
  });

  test("the twin simulations take a pair count, and --twin-pairs runs the twin rules on it", async () => {
    expect(simulateTwins({ rho: 0.5, p0: 0.35, related: true, runs: 200, seed: SEED, pairs: 7 })).toBeLessThanOrEqual(0.064);
    expect(simulateTwins({ rho: 0.5, p0: 0.35, related: false, runs: 200, seed: SEED, pairs: 7 })).toBeGreaterThanOrEqual(0.5);
    expect(simulateTwins({ rho: 0.5, p0: 0.35, related: false, runs: 50, seed: SEED, pairs: 7 })).not.toBe(simulateTwins({ rho: 0.5, p0: 0.35, related: false, runs: 50, seed: SEED }));
    const c = capture();
    await run(["--no-sims", "--no-ledger", "--twin-pairs", "7"], c.io);
    expect(c.out.some((l) => l.startsWith("PASS twin check end to end on 7 pairs"))).toBe(true);
    expect(c.out.some((l) => l.startsWith("PASS admission reads all 23 calibration units"))).toBe(true);
    for (const bad of ["1", "9", "7.5", "x"]) await expect(run(["--twin-pairs", bad], capture().io)).rejects.toThrow(/--twin-pairs takes/);
  }, 60_000);

  test("an unknown argument is a usage error", async () => {
    await expect(run(["--fast"], capture().io)).rejects.toThrow(/unknown argument/);
  });
});
