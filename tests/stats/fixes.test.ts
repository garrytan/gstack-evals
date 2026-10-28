import { describe, expect, test } from "bun:test";
import { evaluateFamily, type ComparisonFamily } from "../../src/runner/stats/gates.ts";
import { clusteredPairedDelta, nonInferiorityP, superiorityP, type PairedDelta, type PairedItem } from "../../src/runner/stats/paired.ts";

const same = (tasks: number, value: number): PairedItem[] => Array.from({ length: tasks }, (_, i) => ({ id: `t${i}`, cluster: `t${i}`, a: value, b: value }));

describe("fix 1: nonInferiorityP when every paired difference is zero", () => {
  test("there is no p-value at any size, so identical arms never show non-inferiority", () => {
    for (const tasks of [3, 12, 300]) {
      for (const value of [0, 0.5, 1]) {
        const s = clusteredPairedDelta(same(tasks, value), { seed: 1, draws: 2000 });
        expect(s.p_method).toBe("degenerate");
        expect(s.ci95).toEqual([0, 0]);
        expect(s.bootstrap).toEqual([]);
        expect(nonInferiorityP(s, 0.1, "higher")).toBeNull();
        expect(nonInferiorityP(s, 0.1, "lower")).toBeNull();
        expect(superiorityP(s, 0, "higher")).toBeNull();
      }
    }
  });

  test("a one-draw bootstrap no longer short-cuts to p = 0", () => {
    const s = clusteredPairedDelta(same(12, 1), { seed: 1, draws: 2000 });
    const oneDraw = (draw: number): PairedDelta => ({ ...s, bootstrap: [draw] });
    expect(nonInferiorityP(oneDraw(0), 0.1, "higher")).toBe(0.5);
    expect(nonInferiorityP(oneDraw(-0.2), 0.1, "higher")).toBe(1);
    expect(superiorityP(oneDraw(0.2), 0.1, "higher")).toBe(0.5);
  });

  test("one task that differs brings the bootstrap back", () => {
    const pairs = same(30, 1);
    pairs[0] = { ...pairs[0]!, b: 2 / 3 };
    const s = clusteredPairedDelta(pairs, { seed: 1, draws: 2000 });
    expect(s.p_method).toBe("monte-carlo-sign-flip");
    expect(s.bootstrap).toHaveLength(2000);
    const p = nonInferiorityP(s, 0.1, "higher");
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.05);
  });

  test("the gate calls identical arms on 40 tasks inconclusive and says why", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, pass: 1 }));
    const family: ComparisonFamily = {
      schema_version: 1, family_id: "fix-1", registered_at: "2026-10-28", alpha: 0.05, seed: 7, draws: 2000, id_field: "id",
      comparisons: [{ id: "pass", metric: "pass", gate: "noninferiority", direction: "higher", tolerance: 0.05, cluster_by: "id" }],
    };
    const d = evaluateFamily(rows, rows, family);
    expect(d.verdict).toBe("inconclusive");
    expect(d.comparisons[0]!.p_noninferiority).toBeNull();
    expect(d.comparisons[0]!.p_holm).toBe(1);
    expect(d.comparisons[0]!.reasons.join(" ")).toContain("every paired difference is zero");
  });
});
