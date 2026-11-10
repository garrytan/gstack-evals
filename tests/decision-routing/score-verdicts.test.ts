// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { A_VERDICTS, B_VERDICTS, printA, printB, primaryA, primaryB, successReading, verdictA, verdictB } from "../../lanes/decision-routing/score/primary.ts";
import { clusterRatio } from "../../lanes/decision-routing/score/ratio.ts";
import type { SessionOutcome } from "../../lanes/decision-routing/score/session.ts";

const verdictLines = (lines: string[]) => lines.filter((l) => l.startsWith("verdict: "));

describe("Primary A printer, full grid", () => {
  const cuts = [-0.2, 0, 0.3, 0.79, 0.8, 0.95];
  const succ = [-12, -7.5, -7.4, -3, -0.1, 0, 0.5, 4];
  test("exactly one verdict at every point, from the right list, by first match", () => {
    let points = 0;
    for (const admitted of [true, false]) for (const cut_lo of cuts) for (const success_lo of succ) for (const success_hi of succ) {
      if (success_hi < success_lo) continue;
      const v = verdictA({ cut_lo, success_lo, success_hi }, admitted);
      const lines = verdictLines(printA({ cut: 0.5, cut_ci: [cut_lo, 0.99], median_ratio: 0.5, success: { delta: 0, ci: [success_lo, success_hi], worse: 0, better: 0, n: 10 }, time_ratio: 1, time_ci: [0.9, 1.1], admitted, verdict: v }));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe("verdict: " + v.verdict);
      expect((admitted ? A_VERDICTS.admitted : A_VERDICTS.kept_out)).toContain(v.verdict);
      if (cut_lo <= 0) expect(v.verdict).toBe("NO SAVING");
      if (v.verdict === "HOLDS") expect(admitted && cut_lo >= 0.8 && success_lo > -7.5).toBe(true);
      if (v.verdict === "SAVES LESS") expect(cut_lo > 0 && cut_lo < 0.8 && success_lo > -7.5).toBe(true);
      if (v.verdict === "TRADES SUCCESS FOR COST") expect(success_hi < 0 && success_lo <= -7.5 && cut_lo > 0).toBe(true);
      if (v.verdict === "SUCCESS MEASURABLY LOWER") expect(!admitted && success_hi < 0).toBe(true);
      if (!admitted && cut_lo > 0 && success_hi >= 0) expect(v.verdict).toBe(cut_lo >= 0.8 ? "CUTS ABOUT 90%, SUCCESS UNTESTED" : "CUTS LESS, SUCCESS UNTESTED");
      points++;
    }
    expect(points).toBeGreaterThan(400);
  });
  test("success readings", () => {
    expect(successReading(-3, 2)).toBe("no measurable difference");
    expect(successReading(-5, -1)).toBe("a small measurable loss inside the margin");
    expect(successReading(-9, -1)).toBe("a measurable loss beyond the margin");
    expect(successReading(1, 4)).toBe("a measurable gain");
  });
});

describe("Primary B printer, full grid", () => {
  const succ = [-12, -7.5, -7.4, -2, -0.1, 0, 0.1, 3];
  const ratios: Array<[number, number]> = [[0.5, 0.85], [0.8, 0.9], [0.85, 0.95], [0.95, 1.05], [1, 1.2], [1.01, 1.3]];
  test("exactly one verdict at every point, legs named consistently", () => {
    let points = 0;
    for (const admitted of [true, false]) for (const success_lo of succ) for (const success_hi of succ) for (const [bill_lo, bill_hi] of ratios) for (const [time_lo, time_hi] of ratios) {
      if (success_hi < success_lo) continue;
      const b = { success_lo, success_hi, bill_lo, bill_hi, time_lo, time_hi };
      const v = verdictB(b, admitted);
      const lines = verdictLines(printB({ success: { delta: 0, ci: [success_lo, success_hi], worse: 0, better: 0, n: 10 }, bill_ratio: 1, bill_ci: [bill_lo, bill_hi], time_ratio: 1, time_ci: [time_lo, time_hi], admitted, verdict: v }));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe("verdict: " + v.verdict);
      expect((admitted ? B_VERDICTS.admitted : B_VERDICTS.kept_out)).toContain(v.verdict);
      const cheaper = bill_hi < 0.9, faster = time_hi < 0.9;
      if (success_hi < 0) expect(v.verdict).toBe("PARTICLE-1 ALONE IS BETTER");
      if (v.verdict === "THE ROUTER EARNS ITS PLACE ON SUCCESS") {
        expect(success_lo > 0).toBe(true);
        expect(v.legs.includes("and cheaper")).toBe(cheaper);
        expect(v.legs.includes("but costlier")).toBe(bill_lo > 1);
        expect(v.legs.includes("and faster")).toBe(faster);
        expect(v.legs.includes("but slower")).toBe(time_lo > 1);
      }
      if (admitted && v.verdict === "INCONCLUSIVE") expect(success_lo <= -7.5 && success_hi >= 0).toBe(true);
      if (admitted && v.verdict === "THE ROUTER EARNS ITS PLACE") { expect(cheaper || faster).toBe(true); expect(success_lo > -7.5 && success_lo <= 0).toBe(true); expect(v.legs).toEqual(cheaper && faster ? ["cheaper and faster"] : cheaper ? ["cheaper"] : ["faster"]); }
      if (admitted && v.verdict === "PARTICLE-1 ALONE IS ENOUGH") expect(!cheaper && !faster && success_lo > -7.5 && success_lo <= 0 && success_hi >= 0).toBe(true);
      if (!admitted && success_hi >= 0 && success_lo <= 0) expect(v.verdict).toBe(cheaper && faster ? "R CHEAPER AND FASTER" : cheaper ? "R CHEAPER" : faster ? "R FASTER" : "NO COST OR TIME GAIN");
      if (!admitted && v.verdict.startsWith("R ") || v.verdict === "NO COST OR TIME GAIN") expect(v.legs).toContain("success untested");
      points++;
    }
    expect(points).toBeGreaterThan(2000);
  });
});

function sessions(cell: string, rows: Array<[string, string, 0 | 1, number, number]>): SessionOutcome[] {
  return rows.map(([task, repo, success, bill_usd, time_ms]) => ({ session: cell + ":" + task, cell, model: "opus", task, repo, status: "graded", reason: null, success, bill_usd, time_ms, exit_status: "submitted", entered: true, dir: "" }));
}
const planned = (n: number) => Array.from({ length: n }, (_, i) => "t" + i);

describe("Primary A, hand-computed cases", () => {
  test("a cut that holds: R spends 5 cents per dollar of N, success unchanged", () => {
    const tasks = planned(16);
    const n = sessions("N", tasks.map((t, i) => [t, "r" + (i % 8), (i % 2) as 0 | 1, 1, 1000]));
    const r = sessions("R", tasks.map((t, i) => [t, "r" + (i % 8), (i % 2) as 0 | 1, 0.05, 500]));
    const a = primaryA({ treatment: r, control: n, planned: tasks, admitted: true });
    expect(a.cut).toBeCloseTo(0.95, 10);
    expect(a.cut_ci![0]).toBeCloseTo(0.95, 10);
    expect(a.median_ratio).toBeCloseTo(0.05, 10);
    expect(a.time_ratio).toBeCloseTo(0.5, 10);
    expect(a.success!.delta).toBe(0);
    expect(a.verdict!.verdict).toBe("HOLDS");
  });
  test("a cut that does not hold: equal bills give NO SAVING", () => {
    const tasks = planned(16);
    const n = sessions("N", tasks.map((t, i) => [t, "r" + (i % 8), 1, 1 + (i % 3), 1000]));
    const r = sessions("R", tasks.map((t, i) => [t, "r" + (i % 8), 1, 1 + (i % 3), 1000]));
    const a = primaryA({ treatment: r, control: n, planned: tasks, admitted: true });
    expect(a.cut).toBeCloseTo(0, 10);
    expect(a.verdict!.verdict).toBe("NO SAVING");
  });
  test("a success loss inside the margin: 12 worse of 400, wholly below zero", () => {
    const tasks = planned(400);
    const n = sessions("N", tasks.map((t, i) => [t, "r" + i, 1, 1, 1000]));
    const r = sessions("R", tasks.map((t, i) => [t, "r" + i, i < 12 ? 0 : 1, 0.5, 900]));
    const a = primaryA({ treatment: r, control: n, planned: tasks, admitted: true });
    expect(a.success!.delta).toBeCloseTo(-3, 10);
    expect(a.success!.worse).toBe(12);
    expect(a.success!.better).toBe(0);
    expect(a.success!.ci[1]).toBeLessThan(0);
    expect(a.success!.ci[0]).toBeGreaterThan(-7.5);
    expect(a.verdict!.verdict).toBe("SAVES LESS");
    expect(printA(a).join("\n")).toContain("a small measurable loss inside the margin");
  });
  test("a success loss outside the margin: 6 worse of 40 trades success for cost", () => {
    const tasks = planned(40);
    const n = sessions("N", tasks.map((t, i) => [t, "r" + i, 1, 1, 1000]));
    const r = sessions("R", tasks.map((t, i) => [t, "r" + i, i < 6 ? 0 : 1, 0.5, 900]));
    const a = primaryA({ treatment: r, control: n, planned: tasks, admitted: true });
    expect(a.success!.delta).toBeCloseTo(-15, 10);
    expect(a.success!.ci[0]).toBeLessThanOrEqual(-7.5);
    expect(a.success!.ci[1]).toBeLessThan(0);
    expect(a.verdict!.verdict).toBe("TRADES SUCCESS FOR COST");
  });
  test("pairing uses only tasks graded in both cells, and coverage under 90% voids the endpoint", () => {
    const tasks = planned(20);
    const n = sessions("N", tasks.map((t, i) => [t, "r" + i, 1, 1, 1000]));
    const r = sessions("R", tasks.slice(0, 18).map((t, i) => [t, "r" + i, 1, 0.1, 1000]));
    expect(primaryA({ treatment: r, control: n, planned: tasks, admitted: true }).success!.n).toBe(18);
    const short = sessions("R", tasks.slice(0, 17).map((t, i) => [t, "r" + i, 1, 0.1, 1000]));
    const a = primaryA({ treatment: short, control: n, planned: tasks, admitted: true });
    expect(a.verdict).toBeNull();
    expect(a.void_reason).toContain("coverage");
    expect(printA(a).some((l) => l.startsWith("NO OUTCOME"))).toBe(true);
  });
});

describe("Primary B, hand-computed cases", () => {
  test("R cheaper and faster with success equal earns its place", () => {
    const tasks = planned(20);
    const p = sessions("P", tasks.map((t, i) => [t, "r" + (i % 10), (i % 2) as 0 | 1, 1, 1000]));
    const r = sessions("R", tasks.map((t, i) => [t, "r" + (i % 10), (i % 2) as 0 | 1, 0.6, 500]));
    const b = primaryB({ treatment: r, control: p, planned: tasks, admitted: true });
    expect(b.bill_ratio).toBeCloseTo(0.6, 10);
    expect(b.verdict!.verdict).toBe("THE ROUTER EARNS ITS PLACE");
    expect(b.verdict!.legs).toEqual(["cheaper and faster"]);
  });
  test("R costlier with equal success and kept out: NO COST OR TIME GAIN, success untested", () => {
    const tasks = planned(20);
    const p = sessions("P", tasks.map((t, i) => [t, "r" + (i % 10), 1, 1, 1000]));
    const r = sessions("R", tasks.map((t, i) => [t, "r" + (i % 10), 1, 1.5, 1000]));
    const b = primaryB({ treatment: r, control: p, planned: tasks, admitted: false });
    expect(b.verdict!.verdict).toBe("NO COST OR TIME GAIN");
    expect(b.verdict!.legs).toContain("success untested");
  });
});

describe("cluster ratio bootstrap", () => {
  test("identical per-cluster ratios give a degenerate interval at the ratio", () => {
    const r = clusterRatio([{ cluster: "a", a: 2, b: 1 }, { cluster: "b", a: 4, b: 2 }, { cluster: "c", a: 1, b: 0.5 }], { seed: 20261111, draws: 10000 });
    expect(r.ratio).toBeCloseTo(0.5, 12);
    expect(r.ci95![0]).toBeCloseTo(0.5, 12);
    expect(r.ci95![1]).toBeCloseTo(0.5, 12);
  });
  test("resamples whole clusters with the seed, so it is deterministic and spans the cluster ratios", () => {
    const pairs = [{ cluster: "a", a: 1, b: 0.2 }, { cluster: "a", a: 1, b: 0.2 }, { cluster: "b", a: 1, b: 1 }, { cluster: "c", a: 1, b: 0.6 }];
    const x = clusterRatio(pairs, { seed: 20261111, draws: 10000 }), y = clusterRatio(pairs, { seed: 20261111, draws: 10000 });
    expect(x.ci95).toEqual(y.ci95);
    expect(x.ratio).toBeCloseTo(2.0 / 4, 12);
    expect(x.ci95![0]).toBeGreaterThanOrEqual(0.2);
    expect(x.ci95![1]).toBeLessThanOrEqual(1);
    expect(x.n_clusters).toBe(3);
  });
  test("one cluster has no interval; fewer than 1000 draws is refused", () => {
    expect(clusterRatio([{ cluster: "a", a: 1, b: 1 }], { seed: 1, draws: 10000 }).ci95).toBeNull();
    expect(() => clusterRatio([{ cluster: "a", a: 1, b: 1 }], { seed: 1, draws: 10 })).toThrow();
  });
});
