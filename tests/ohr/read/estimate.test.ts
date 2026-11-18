// Copyright (c) 2026 Garry Tan. MIT License.
// Section 8's estimator and section 7's builder readings for the office-hours rewrite eval.
import { describe, expect, test } from "bun:test";
import { builderRightCall, keptWhole } from "../../../lanes/office-hours-rewrite/read/builder.ts";
import { estimate, METRIC } from "../../../lanes/office-hours-rewrite/read/estimate.ts";
import { tQuantile } from "../../../lanes/office-hours-rewrite/read/stats.ts";
import type { ArmId, ModelId, ScoredSession } from "../../../lanes/office-hours-rewrite/types.ts";
import { builderRows, row } from "../../../lanes/office-hours-rewrite/read/seams.ts";

const r = (brief: string, cluster: string, model: ModelId, arm: ArmId, R: 0 | 1 | null, o: Partial<ScoredSession> = {}) => row({ brief, cluster, model, arm, R, ...o });

/** Cluster X holds twins x1 and x2, cluster Y the unpaired y1; x2's Sol new session is missing. */
const rows: ScoredSession[] = [
  r("x1", "X", "opus", "new", 1), r("x1", "X", "opus", "current", 0), r("x1", "X", "sol", "new", 1), r("x1", "X", "sol", "current", 1),
  r("x2", "X", "opus", "new", 0), r("x2", "X", "opus", "current", 0), r("x2", "X", "sol", "new", null, { end: "missing" }), r("x2", "X", "sol", "current", 1),
  r("y1", "Y", "opus", "new", 0), r("y1", "Y", "opus", "current", 1), r("y1", "Y", "sol", "new", 0), r("y1", "Y", "sol", "current", 0),
  r("y1", "Y", "particle", "new", 1), r("y1", "Y", "particle", "current", 0),
  r("y1", "Y", "opus", "none", 1), r("x1", "X", "opus", "none", 0), r("x2", "X", "opus", "none", 0),
];

describe("section 8's estimator", () => {
  test("brief over models where both arms scored, cluster over briefs, estimate over clusters", () => {
    const e = estimate(rows, { a: "new", b: "current", kind: "founder" });
    expect(e.briefs.map((b) => [b.brief, b.diff, b.models])).toEqual([["x1", 0.5, ["opus", "sol"]], ["x2", 0, ["opus"]], ["y1", -0.5, ["opus", "sol"]]]);
    expect(e.clusters.map((c) => [c.cluster, c.diff, c.briefs])).toEqual([["X", 0.25, 2], ["Y", -0.5, 1]]);
    expect(e.C).toBe(2);
    expect(e.estimate).toBeCloseTo(-0.125, 12);
    expect(e.mean_a! - e.mean_b!).toBeCloseTo(-0.125, 12);
    expect([e.pairs, e.scored_pairs, e.missing_pairs]).toEqual([6, 5, 1]);
    const h = (tQuantile(0.975, 1) * Math.abs(0.25 + 0.5)) / Math.SQRT2 / Math.SQRT2;
    expect(e.lo!).toBeCloseTo(-0.125 - h, 10);
    expect(e.hi!).toBeCloseTo(-0.125 + h, 10);
  });
  test("each model alone, and particle only when named", () => {
    expect(estimate(rows, { a: "new", b: "current", kind: "founder", models: ["opus"] }).estimate).toBeCloseTo(-0.25, 12);
    expect(estimate(rows, { a: "new", b: "current", kind: "founder", models: ["particle"] }).estimate).toBe(1);
    expect(estimate(rows, { a: "new", b: "none", kind: "founder" }).clusters.map((c) => c.diff)).toEqual([0.5, -1]);
    expect(estimate(rows, { a: "current", b: "none", kind: "founder", models: ["opus"] }).estimate).toBe(0);
  });
  test("a missing or contaminated session never scores, whatever its bit", () => {
    const bad = rows.map((s) => (s.brief === "y1" && s.model === "opus" && s.arm === "current" ? { ...s, end: "contaminated" as const } : s));
    const e = estimate(bad, { a: "new", b: "current", kind: "founder" });
    expect(e.briefs.find((b) => b.brief === "y1")!.diff).toBe(0);
    expect(e.missing_pairs).toBe(2);
  });
  test("other metrics and a brief filter", () => {
    const q = rows.map((s) => ({ ...s, questions: s.arm === "new" ? 7 : 4 }));
    expect(estimate(q, { a: "new", b: "current", kind: "founder", metric: METRIC.questions }).estimate).toBe(3);
    const t = rows.map((s) => ({ ...s, traction: s.brief === "x1" }));
    expect(estimate(t, { a: "new", b: "current", kind: "founder", where: (s) => s.traction }).briefs.map((b) => b.brief)).toEqual(["x1"]);
  });
  test("refuses duplicate rows and briefs whose rows disagree", () => {
    expect(() => estimate([...rows, rows[0]!], { a: "new", b: "current", kind: "founder" })).toThrow(/^E_OHR_READ_INPUT/);
    expect(() => estimate([...rows, r("x1", "Z", "opus", "none", 1, { stage: 2 })], { a: "new", b: "current", kind: "founder" })).toThrow(/^E_OHR_READ_INPUT/);
  });
  test("no cluster with a difference reads no estimate", () => {
    const e = estimate(rows, { a: "new", b: "current", kind: "builder" });
    expect([e.C, e.estimate, e.lo, e.hi]).toEqual([0, null, null, null]);
  });
});

describe("section 7's builder readings", () => {
  test("both models lose the same one brief: corrected lower bound -0.202 breaks the 15-point margin", () => {
    const k = keptWhole(builderRows({ lost: ["b01"] }));
    expect(k.pairs.n).toBe(48);
    expect(k.pairs.lo.toFixed(3)).toBe("-0.202");
    expect(k.pairs.naive.lo.toFixed(3)).toBe("-0.140");
    expect(k.state).toBe("broken");
  });
  test("every session kept whole holds", () => {
    const k = keptWhole(builderRows({}));
    expect(k.state).toBe("held");
    expect(k.pairs.lo).toBeGreaterThan(-0.15);
  });
  test("pairs need both arms scored; a lost model pair leaves a cluster of one", () => {
    const xs = builderRows({}).filter((s) => !(s.brief === "b02" && s.model === "sol" && s.arm === "new"));
    const k = keptWhole(xs);
    expect([k.pairs.n, k.pairs.clusters, k.missing_pairs]).toEqual([47, 24, 1]);
  });
  test("builder right call: each brief its own cluster, harm only when the interval lies below zero", () => {
    const fine = builderRightCall(builderRows({}));
    expect([fine.C, fine.state]).toEqual([24, "held"]);
    const worse = builderRightCall(builderRows({ wrong: ["b01", "b02", "b03", "b04", "b05", "b06", "b07", "b08"] }));
    expect(worse.hi!).toBeLessThan(0);
    expect(worse.state).toBe("broken");
  });
});
