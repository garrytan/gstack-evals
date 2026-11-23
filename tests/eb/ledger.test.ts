import { describe, expect, test } from "bun:test";
import { ITEMS, project, reproject } from "../../lanes/eng-build/ledger.ts";

const measured = { reviewUsd: { plain: 0.54, precut: 2.74, engphase: 3.51, candidate: 1.3 }, buildUsd: 2.5 };

describe("money", () => {
  test("one item per row of the plan's table, the plan's projection reproduced", () => {
    expect(ITEMS.length).toBe(9);
    const p = project({ units: 48, k: 3, kNone: 2 }, measured);
    expect(Math.round(p.reviews)).toBe(1165);
    expect(p.builds).toBe(1680);
  });
  test("cuts go in the frozen order and stop past 0.12", () => {
    const r = reproject({ measured: { ...measured, buildUsd: 3.5 }, caps: { reviews: 1500, builds: 2150 }, mdd: () => 0.115 });
    expect(r.cuts).toEqual(["no-review builds to 1 a unit", "comparison units from 48 to 40"]);
    expect(r.stop).toBeNull();
    expect(reproject({ measured, caps: { reviews: 1500, builds: 2150 }, mdd: () => 0.121 }).stop).toStartWith("E_EB_REPROJECT");
  });
});
