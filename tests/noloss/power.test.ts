import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simulate, suiteClusters } from "../../lanes/review-noloss/power.ts";
import { loadSuite, REPO_ROOT } from "../../lanes/review-noloss/suite.ts";
import { run } from "./helpers.ts";

const clusters = suiteClusters(loadSuite("gsta167-14pr").suite);
const base = { clusters, passes_variant: 1, passes_reference: 1, recall: 0.65, spread: 2, margin_points: 10, sims: 2000, seed: 1 };

describe("noloss power", () => {
  test("the 14 PRs carry 29 blocking blockers", () => {
    expect(clusters.length).toBe(14);
    expect(clusters.reduce((a, b) => a + b, 0)).toBe(29);
  });

  test("seeded: the false NO_LOSS rate at delta minus the margin is at most 5%, with Monte Carlo error under 1 point", () => {
    const r = simulate({ ...base, delta_points: -10 });
    expect(r.no_loss).toBeLessThanOrEqual(0.05);
    expect(1.96 * r.mc_se).toBeLessThan(0.01);
    expect(simulate({ ...base, delta_points: -10 })).toEqual(r);
  });

  test("identical arms with near-certain rates get NO_LOSS from the no-discordance rule, which the kit would call null", () => {
    expect(simulate({ ...base, spread: 0.01, delta_points: 0, sims: 300 }).no_loss).toBeGreaterThan(0.9);
  });

  test("every committed power row holds false NO_LOSS at or under 5%", () => {
    const table = JSON.parse(readFileSync(join(REPO_ROOT, "tables/review-noloss.json"), "utf8"));
    expect(table.power.rows.length).toBe(4);
    expect(table.power.rows.map((r: { prs: number; blockers: number }) => [r.prs, r.blockers])).toEqual([[14, 29], [14, 29], [26, 42], [56, 72]]);
    for (const r of table.power.rows) expect(r.false_no_loss).toBeLessThanOrEqual(0.05);
  });

  test("the command needs a margin and a recall; there are no defaults for either", async () => {
    expect((await run(["power", "--suite", "gsta167-14pr", "--passes", "1", "--recall", "0.65"])).err).toContain("E_USAGE noloss power needs at least one --margin");
    expect((await run(["power", "--suite", "gsta167-14pr", "--passes", "1", "--margin", "10"])).err).toContain("--recall is required");
    const ok = await run(["power", "--clusters", "2,1,1", "--passes", "1", "--recall", "0.6", "--margin", "10", "--sims", "50", "--json"]);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out).rows[0].prs).toBe(3);
  });
});
