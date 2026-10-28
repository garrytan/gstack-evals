import { describe, expect, test } from "bun:test";
import { evaluateFamily, validateFamily, type ComparisonFamily } from "../../src/runner/stats/gates.ts";
import { clusteredPairedDelta, nonInferiorityP, superiorityP, type PairedDelta, type PairedItem } from "../../src/runner/stats/paired.ts";
import { toObservation } from "../../src/runner/stats/rows.ts";

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

describe("review fixes to the vendored gates", () => {
  const family = (comparisons: ComparisonFamily["comparisons"]): ComparisonFamily => ({
    schema_version: 1, family_id: "review", registered_at: "2026-10-28", alpha: 0.05, seed: 7, draws: 2000, id_field: "id", comparisons,
  });
  const dashboard = { id: "latency", metric: "latency_ms", gate: "exploratory" as const };

  test("an exploratory metric missing from both runs is blocked alone and cannot hide an exact safety failure", () => {
    const a = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, safe: 1 }));
    const b = a.map((r) => (r.id === "t3" ? { ...r, safe: 0 } : r));
    const d = evaluateFamily(a, b, family([{ id: "safe", metric: "safe", gate: "exact", assertion: { kind: "every_b_equals", value: 1 } }, dashboard]));
    expect(d.verdict).toBe("fail");
    expect(d.comparisons.map((c) => c.status)).toEqual(["fail", "blocked"]);
    expect(d.comparisons[1]!.reasons).toEqual(["no eligible pairs"]);
  });

  test("the same missing metric leaves a confirmatory pass standing", () => {
    const a = Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, pass: i % 10 === 0 ? 0 : 1 }));
    const b = Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, pass: i % 10 === 1 ? 0 : 1 }));
    const d = evaluateFamily(a, b, family([{ id: "pass", metric: "pass", gate: "noninferiority", direction: "higher", tolerance: 0.05, cluster_by: "id" }, dashboard]));
    expect(d.verdict).toBe("pass");
    expect(d.comparisons[1]!.status).toBe("blocked");
  });

  test("below the cluster minimum an interval cannot fail a comparison", () => {
    const a = [{ id: "t0", pass: 1 }, { id: "t1", pass: 1 }];
    const b = [{ id: "t0", pass: 0 }, { id: "t1", pass: 0 }];
    for (const comparison of [
      { id: "pass", metric: "pass", gate: "noninferiority" as const, direction: "higher" as const, tolerance: 0.05, cluster_by: "id" },
      { id: "pass", metric: "pass", gate: "superiority" as const, direction: "higher" as const, min_effect: 0, cluster_by: "id" },
    ]) {
      const d = evaluateFamily(a, b, family([comparison]));
      expect(d.comparisons[0]!.stats!.ci95).toEqual([-1, -1]);
      expect(d.verdict).toBe("inconclusive");
      expect(d.comparisons[0]!.reasons).toEqual(["2 clusters is below the family minimum of 10"]);
    }
  });
});

describe("ship review fixes: superiority and system failures", () => {
  const family = (comparisons: ComparisonFamily["comparisons"]): ComparisonFamily => ({
    schema_version: 1, family_id: "ship", registered_at: "2026-10-28", alpha: 0.05, seed: 7, draws: 2000, id_field: "id", comparisons,
  });
  // Ten tasks: B wins three, the other seven tie. The bootstrap share is 0.7^10, about 0.03; the exact sign-flip p is 1/8.
  const tenTasks = () => Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, a: i < 3 ? 0 : 0.5, b: i < 3 ? 1 : 0.5 }));

  test("superiority uses the exact clustered sign-flip p, so three wins in ten tasks do not pass", () => {
    const s = clusteredPairedDelta(tenTasks().map((t) => ({ ...t, cluster: t.id })), { seed: 7, draws: 2000 });
    expect(s.p_method).toBe("exact-sign-flip");
    expect(s.bootstrap.filter((d) => d <= 0).length / s.bootstrap.length).toBeLessThan(0.05);
    expect(superiorityP(s, 0, "higher")).toBe(0.125);
    const rows = tenTasks();
    const d = evaluateFamily(rows.map(({ id, a }) => ({ id, pass: a })), rows.map(({ id, b }) => ({ id, pass: b })),
      family([{ id: "pass", metric: "pass", gate: "superiority", direction: "higher", min_effect: 0, cluster_by: "id" }]));
    expect(d.verdict).toBe("inconclusive");
    expect(d.comparisons[0]!.p_superiority).toBe(0.125);
    expect(d.comparisons[0]!.reasons[0]).toContain("Holm sign-flip p = 0.1250");
  });

  test("superiority also needs the point estimate to reach the minimum effect, in the metric's direction", () => {
    const pairs = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, cluster: `t${i}`, a: 0, b: 0.25 }));
    const up = clusteredPairedDelta(pairs, { seed: 7, draws: 2000 });
    expect(superiorityP(up, 0.2, "higher")).toBe(1 / 4096);
    expect(superiorityP(up, 0.3, "higher")).toBe(1);
    expect(superiorityP(up, 0, "lower")).toBe(1);
    const down = clusteredPairedDelta(pairs.map((p) => ({ ...p, b: -0.25 })), { seed: 7, draws: 2000 });
    expect(superiorityP(down, 0.2, "lower")).toBe(1 / 4096);
  });

  test("a system failure with no value scores 0 only where higher is better; otherwise it needs failure_value", () => {
    const sel = { idField: "id", metric: "latency_ms" };
    const failed = { id: "t0", error: "crash", error_origin: "sut" };
    expect(toObservation(failed, { ...sel, direction: "higher" })).toMatchObject({ eligible: true, value: 0 });
    expect(toObservation(failed, { ...sel, direction: "lower" })).toMatchObject({ eligible: true, value: null });
    expect(toObservation(failed, sel)).toMatchObject({ eligible: true, value: null });
    expect(toObservation(failed, { ...sel, direction: "lower", failureValue: 600000 })).toMatchObject({ eligible: true, value: 600000 });
    const a = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, latency_ms: 1000 }));
    const b = a.map(({ id }) => ({ id, error: "crash", error_origin: "sut" }));
    const latency = { id: "latency", metric: "latency_ms", gate: "noninferiority" as const, direction: "lower" as const, tolerance: 100, cluster_by: "id" };
    const blocked = evaluateFamily(a, b, family([latency]));
    expect(blocked.verdict).toBe("blocked");
    expect(blocked.reasons[0]).toContain("preregisters no failure_value");
    const scored = evaluateFamily(a, b, family([{ ...latency, failure_value: 600000 }]));
    expect(scored.verdict).toBe("fail");
    expect(() => validateFamily(family([{ ...latency, failure_value: Number.NaN }]))).toThrow("failure_value must be a finite number");
  });

  test("an exact gate that states its direction fails on a crash instead of blocking the family", () => {
    const a = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, safe: 1, pass: 1 }));
    const b = a.map((r) => (r.id === "t3" ? { id: "t3", error: "crash", error_origin: "sut" } : r));
    const gate = { id: "safe", metric: "safe", gate: "exact" as const, assertion: { kind: "every_b_equals" as const, value: 1 } };
    const pass = { id: "pass", metric: "pass", gate: "noninferiority" as const, direction: "higher" as const, tolerance: 0.05, cluster_by: "id" };
    const stated = evaluateFamily(a, b, family([{ ...gate, direction: "higher" }, pass]));
    expect(stated.verdict).toBe("fail");
    expect(stated.comparisons[0]!.violations).toEqual(["t3 (A=1, B=0)"]);
    expect(evaluateFamily(a, b, family([{ ...gate, failure_value: 0 }, pass])).verdict).toBe("fail");
    const unstated = evaluateFamily(a, b, family([gate, pass]));
    expect(unstated.verdict).toBe("blocked");
    expect(unstated.reasons[0]).toContain("preregisters no failure_value");
    expect(() => validateFamily(family([{ ...gate, direction: "up" as never }]))).toThrow("direction must be higher or lower");
    const regression = { id: "pass", metric: "pass", gate: "exact" as const, assertion: { kind: "no_item_regression" as const, direction: "higher" as const } };
    expect(() => validateFamily(family([{ ...regression, direction: "lower" }]))).toThrow("direction lower contradicts the assertion's direction higher");
    expect(validateFamily(family([{ ...regression, direction: "higher" }])).comparisons).toHaveLength(1);
  });

  test("a superiority reason says when the point estimate, not the sign-flip p, fell short", () => {
    const a = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, score: 0 }));
    const b = a.map(({ id }) => ({ id, score: 0.25 }));
    const d = evaluateFamily(a, b, family([{ id: "score", metric: "score", gate: "superiority", direction: "higher", min_effect: 0.3, cluster_by: "id" }]));
    expect(d.comparisons[0]!.p_superiority).toBe(1);
    expect(d.comparisons[0]!.stats!.p_greater).toBe(1 / 4096);
    expect(d.comparisons[0]!.reasons[0]).toBe("the point estimate 0.2500 is below the minimum effect of 0.3, so p_superiority is 1 (the sign-flip p is in stats); this is not evidence of a loss");
  });
});
