// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 2's one interim look (pre-run change 3 to the second attempt, rule R113): the bounds, the interim read on the
// first half's primary comparison, its four actions, the decision table at an early stop and at the final read, and the
// gate that lets the primary comparison be read only on the data the interim's action calls for.
import { describe, expect, test } from "bun:test";
import { decide } from "../../../lanes/office-hours-rewrite/read/decision.ts";
import { estimate } from "../../../lanes/office-hours-rewrite/read/estimate.ts";
import { bound, interimRead, lookGate, LOOK, normalCdf, type LookRecord } from "../../../lanes/office-hours-rewrite/read/look.ts";
import { builderRows, founderRows, plant, row } from "../../../lanes/office-hours-rewrite/read/seams.ts";
import { tQuantile } from "../../../lanes/office-hours-rewrite/read/stats.ts";
import { SIM_RULES_SHA256 } from "../../../lanes/office-hours-rewrite/frozen.ts";
import type { Half } from "../../../lanes/office-hours-rewrite/run/half.ts";
import { manifestSha256, type Manifest } from "../../../lanes/office-hours-rewrite/run/manifest.ts";
import type { ArmId, ModelId, ScoredSession } from "../../../lanes/office-hours-rewrite/types.ts";

const pad = (k: number) => String(k).padStart(2, "0");
/** 16 founder clusters of one brief each on Opus and Sol: cluster k's new-minus-current difference is diffs[k] (0, 0.5 or 1, or their negatives). */
function halfRows(diffs: readonly number[]): ScoredSession[] {
  const out: ScoredSession[] = [];
  diffs.forEach((d, k) => {
    const brief = "f" + pad(k);
    (["opus", "sol"] as ModelId[]).forEach((model, j) => {
      const step = Math.abs(d) === 1 || (Math.abs(d) === 0.5 && j === 0) ? 1 : 0;
      const R = (arm: ArmId) => (arm === "none" ? 0 : d > 0 ? (arm === "new" ? 1 : 1 - step) : (arm === "new" ? 1 - step : 1)) as 0 | 1;
      for (const arm of ["none", "current", "new"] as ArmId[]) out.push(row({ brief, cluster: brief, model, arm, R: R(arm), R2: R(arm), R3: R(arm) }));
    });
  });
  return out;
}
const fill = (n: number, v: number) => Array.from({ length: n }, () => v);
const HALF: Half = { first: { founder: [], builder: [], clusters: 16 }, second: { founder: [], builder: [], clusters: 16 } };

describe("the bounds", () => {
  test("R113's O'Brien-Fleming bounds, 2.80 and 1.98, enter as their two-sided nominal levels", () => {
    expect([LOOK.interim_z, LOOK.final_z]).toEqual([2.8, 1.98]);
    expect(2 * (1 - normalCdf(2.8))).toBeCloseTo(LOOK.interim_level, 7);
    expect(2 * (1 - normalCdf(1.98))).toBeCloseTo(LOOK.final_level, 7);
  });
  test("the normal distribution function matches reference values on both sides of its switch at 3", () => {
    for (const [z, p] of [[-1, 0.15865525393145707], [1.96, 0.9750021048517795], [2.9999, 0.998649658717045], [3, 0.9986501019683699], [-3.5, 2.3262907903552504e-4], [4, 0.9999683287581669], [-6, 9.865876450377012e-10]] as const) expect(Math.abs(normalCdf(z) - p) / Math.min(p, 1 - p)).toBeLessThan(1e-9);
  });
  test("on the plan's t statistic they read 3.2754 at 16 clusters and 2.0617 at 32, against the plan's 2.0395", () => {
    expect(bound(LOOK.interim_level, 16)).toBeCloseTo(3.2753980782, 8);
    expect(bound(LOOK.final_level, 32)).toBeCloseTo(2.0617202575, 8);
    expect(bound(0.05, 32)).toBeCloseTo(tQuantile(0.975, 31), 12);
  });
});

describe("the interim read", () => {
  test("a difference at or past the bound for the new skill stops for it", () => {
    const r = interimRead(halfRows([...fill(12, 1), ...fill(4, 0)]), HALF);
    expect(r.action).toBe("stop-new");
    expect(r.z!).toBeGreaterThanOrEqual(r.bound!);
    expect(r.C).toBe(16);
  });
  test("a difference at or past the bound the other way stops for the current skill", () => {
    expect(interimRead(halfRows([...fill(12, -1), ...fill(4, 0)]), HALF).action).toBe("stop-current");
  });
  test("conditional power under the plan's 15-point lift below 10% stops for futility", () => {
    const r = interimRead(halfRows([...fill(6, -0.5), ...fill(10, 0)]), HALF);
    expect(Math.abs(r.z!)).toBeLessThan(r.bound!);
    expect(r.cp!).toBeLessThan(LOOK.futility);
    expect(r.action).toBe("stop-futility");
  });
  test("anything else continues", () => {
    const r = interimRead(halfRows([...fill(4, 0.5), ...fill(12, 0)]), HALF);
    expect(Math.abs(r.z!)).toBeLessThan(r.bound!);
    expect(r.cp!).toBeGreaterThanOrEqual(LOOK.futility);
    expect(r.action).toBe("continue");
  });
  test("conditional power is the stated formula: at 16 and 16 clusters, Phi(4 (estimate + 0.15) / sd - sqrt(2) times the final bound)", () => {
    const r = interimRead(halfRows([...fill(4, 0.5), ...fill(2, -0.5), ...fill(10, 0)]), HALF);
    const e = estimate(halfRows([...fill(4, 0.5), ...fill(2, -0.5), ...fill(10, 0)]), { a: "new", b: "current", kind: "founder" });
    expect(r.estimate!).toBeCloseTo(e.estimate!, 12);
    expect(r.final_bound!).toBeCloseTo(bound(LOOK.final_level, 32), 12);
    expect(r.cp!).toBeCloseTo(normalCdf((4 * (e.estimate! + LOOK.planned_effect)) / e.sd! - Math.SQRT2 * r.final_bound!), 12);
  });
  test("a half whose clusters all differ by the same amount reads by its sign", () => {
    expect(interimRead(halfRows(fill(16, 0)), HALF).action).toBe("continue");
    expect(interimRead(halfRows(fill(16, 0.5)), HALF).action).toBe("stop-new");
    expect(interimRead(halfRows(fill(16, -0.5)), HALF).action).toBe("stop-current");
  });
  test("fewer than two clusters with a difference give no read", () => {
    expect(() => interimRead(halfRows([1]), HALF)).toThrow(/^E_OHR_READ_INPUT /);
  });
});

describe("the decision table at each look", () => {
  const C = (x: ReturnType<typeof decide>) => x.contrasts.new_current;
  test("the final read uses the level of 1.98 where the plan used t(0.975, C - 1), and only on the pooled primary", () => {
    const d = decide({ ...plant("merge"), look: { action: "continue", early: false, level: LOOK.final_level } });
    const e = C(d);
    expect(d.row).toBe(4);
    expect(e.lo!).toBeCloseTo(e.estimate! - (bound(LOOK.final_level, e.C) * e.sd!) / Math.sqrt(e.C), 12);
    expect(e.lo!).toBeLessThan(C(decide(plant("merge"))).lo!);
    expect(d.contrasts.new_none.lo!).toBeCloseTo(decide(plant("merge")).contrasts.new_none.lo!, 12);
    expect(d.look).toEqual({ action: "continue", early: false, level: LOOK.final_level, bound: bound(LOOK.final_level, e.C), possibly_overstated: false });
  });
  const cut = (c: number, j: number) => Math.floor(j / 2) < c;
  const halfStop = (newRight: number, currentRight: number) => ({ ...plant("merge"), rows: [...founderRows({ R: (arm, j) => (arm === "new" ? cut(newRight, j) : arm === "current" ? cut(currentRight, j) : false) ? 1 : 0 }), ...builderRows({})] });
  test("planted MERGE rows that clear the final bound do not clear the interim bound", () => {
    const d = decide({ ...plant("merge"), look: { action: "stop-new", early: true, level: LOOK.interim_level } });
    expect(d.row).not.toBe(4);
    expect(C(d).lo!).toBeLessThan(0);
  });
  test("an early stop for the new skill reads MERGE on the half at the interim bound, marked possibly overstated", () => {
    const d = decide({ ...halfStop(18, 8), look: { action: "stop-new", early: true, level: LOOK.interim_level } });
    expect(d.row).toBe(4);
    expect(d.outcome).toBe("MERGE");
    expect(C(d).lo!).toBeCloseTo(C(d).estimate! - (bound(LOOK.interim_level, C(d).C) * C(d).sd!) / Math.sqrt(C(d).C), 12);
    expect(d.look!.possibly_overstated).toBe(true);
  });
  test("an early stop the other way reads HOLD (harm), not MERGE", () => {
    const d = decide({ ...halfStop(8, 18), look: { action: "stop-current", early: true, level: LOOK.interim_level } });
    expect(d.row).toBe(2);
    expect(d.conditions.row2.pooled_loss).toBe(true);
  });
  test("a futility stop never reads MERGE, whatever the rows hold", () => {
    expect(decide({ ...halfStop(18, 8), look: { action: "stop-new", early: true, level: LOOK.interim_level } }).row).toBe(4);
    const d = decide({ ...halfStop(18, 8), look: { action: "stop-futility", early: true, level: LOOK.interim_level } });
    expect(d.row).not.toBe(4);
    expect(d.conditions.row4.holds).toBe(false);
    const c = decide({ ...halfStop(18, 8), look: { action: "stop-current", early: true, level: LOOK.interim_level } });
    expect(c.row).not.toBe(4);
  });
});

describe("the gate on the primary comparison", () => {
  const entry = (brief: string, model: ModelId, arm: ArmId) => ({ stage: 2 as const, brief, model, arm });
  const entries = (briefs: string[]) => briefs.flatMap((b) => (["opus", "sol"] as ModelId[]).flatMap((m) => (["none", "current", "new"] as ArmId[]).map((a) => entry(b, m, a))));
  const manifest = (o: Partial<Manifest>): Manifest => ({ schema: 1, launch: "stage2", stage: 2, models: ["opus", "sol"], arms: ["none", "current", "new"], briefs: {}, pins: { current: null, new: null }, sim_rules: SIM_RULES_SHA256, build_commit: "b", dropped: [], replaced: [], entries: [], ...o });
  const half: Half = { first: { founder: ["f01"], builder: ["b01"], clusters: 1 }, second: { founder: ["f02"], builder: ["b02"], clusters: 1 } };
  const p1 = manifest({ part: "first", half, entries: entries(["f01", "b01"]) });
  const rec = (action: LookRecord["read"]["action"]): LookRecord => ({ schema: 1, part1_manifest_sha256: manifestSha256(p1), half, read: { C: 16, C2: 16, estimate: 0, sd: 0, z: 0, bound: 3.27, final_bound: 2.06, cp: 1, action } });
  const p2 = (action: LookRecord["read"]["action"], briefs: string[]) => manifest({ part: "second", action, interim_sha256: "e".repeat(64), entries: entries(briefs) });
  const rows = (briefs: string[]) => entries(briefs).map((e) => row({ ...e, brief: e.brief, cluster: e.brief, kind: e.brief.startsWith("b") ? "builder" : "founder" }));
  const particle = manifest({ launch: "stage2-particle", models: ["particle"], entries: [entry("f01", "particle", "new")] });
  test("a read that continued reads both parts at the final level", () => {
    expect(lookGate({ look: rec("continue"), lookSha: "e".repeat(64), manifests: [p1, p2("continue", ["f02", "b02"]), particle], rows: rows(["f01", "b01", "f02", "b02"]) })).toEqual({ action: "continue", early: false, level: LOOK.final_level });
  });
  test("a read that continued refuses before the second half has run", () => {
    expect(() => lookGate({ look: rec("continue"), lookSha: "e".repeat(64), manifests: [p1], rows: rows(["f01", "b01"]) })).toThrow(/^E_OHR_READ_INPUT /);
    expect(() => lookGate({ look: rec("continue"), lookSha: "e".repeat(64), manifests: [p1, p2("continue", ["f02", "b02"])], rows: rows(["f01", "b01", "f02"]) })).toThrow(/^E_OHR_READ_INPUT /);
  });
  test("a stop for the new skill reads the half and the second half's builders at the interim level", () => {
    expect(lookGate({ look: rec("stop-new"), lookSha: "e".repeat(64), manifests: [p1, p2("stop-new", ["b02"])], rows: rows(["f01", "b01", "b02"]) })).toEqual({ action: "stop-new", early: true, level: LOOK.interim_level });
    expect(() => lookGate({ look: rec("stop-new"), lookSha: "e".repeat(64), manifests: [p1], rows: rows(["f01", "b01"]) })).toThrow(/^E_OHR_READ_INPUT /);
  });
  test("a stop the other way or for futility reads the half alone, and refuses a second part", () => {
    for (const action of ["stop-current", "stop-futility"] as const) {
      expect(lookGate({ look: rec(action), lookSha: "e".repeat(64), manifests: [p1], rows: rows(["f01", "b01"]) })).toEqual({ action, early: true, level: LOOK.interim_level });
      expect(() => lookGate({ look: rec(action), lookSha: "e".repeat(64), manifests: [p1, p2("continue", ["f02", "b02"])], rows: rows(["f01", "b01", "f02", "b02"]) })).toThrow(/^E_OHR_READ_INPUT /);
    }
  });
  test("it refuses a first half the interim did not read, a second part built from another read, and rows no part schedules", () => {
    expect(() => lookGate({ look: { ...rec("stop-futility"), part1_manifest_sha256: "0".repeat(64) }, lookSha: "e".repeat(64), manifests: [p1], rows: rows(["f01", "b01"]) })).toThrow(/^E_OHR_READ_INPUT /);
    expect(() => lookGate({ look: rec("continue"), lookSha: "f".repeat(64), manifests: [p1, p2("continue", ["f02", "b02"])], rows: rows(["f01", "b01", "f02", "b02"]) })).toThrow(/^E_OHR_READ_INPUT /);
    expect(() => lookGate({ look: rec("stop-futility"), lookSha: "e".repeat(64), manifests: [p1], rows: rows(["f01", "b01", "f02"]) })).toThrow(/^E_OHR_READ_INPUT /);
    expect(() => lookGate({ look: rec("stop-futility"), lookSha: "e".repeat(64), manifests: [], rows: rows(["f01", "b01"]) })).toThrow(/^E_OHR_READ_INPUT /);
  });
});
