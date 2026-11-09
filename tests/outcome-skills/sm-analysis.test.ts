// Copyright (c) 2026 Garry Tan. MIT License.
// Hand-checked numbers. Each expected p value and interval below comes from a route other than the code under test:
// sign-flip p values by counting sign patterns by hand or by the brute-force loop in this file; McNemar p values from
// the binomial tail written out (2 * sum C(n, k) / 2^n); bootstrap intervals either degenerate (every repository holds
// the same paired difference, so every resample gives the same value) or taken from the exact bootstrap distribution
// by enumerating all 4^4 ordered resamples of four repositories (the 2.5% and 97.5% points sit at least 3.5 Monte
// Carlo standard errors from a jump, so 10,000 draws land on them).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyse, buildInput, diffOfDiffs, exactSignFlip, MDD_CLAIM1, MDD_CLAIM2, report, stratifiedBootstrap, type AnalysisInput, type FirstRow, type FollowRow, type Outcome, type UnitRow } from "../../lanes/outcome-skills/statemachines/analysis.ts";

const SEED = 107511492;
const rd = (outcome: Outcome | null, gap: string | null = null) => ({ outcome, gap, reruns: { fix: [], no_fix: [], break: [] }, rerun_2of3: false });
const first = (unit: string, cell: FirstRow["cell"], outcome: Outcome, o: Partial<FirstRow> = {}, model = "m"): FirstRow => ({ unit, model, cell, session_gap: null, strict: rd(outcome), adapted: rd(outcome), fallbacks: [], questions: null, exposed: null, ...o });
const fol = (unit: string, tree: FollowRow["tree"], rep: number, inc: 0 | 1 | null, o: Partial<FollowRow> = {}, model = "m"): FollowRow => ({ unit, model, tree, rep, gap: null, incremental: inc, end_to_end: inc, whole: null, drift: false, ...o });
const unit = (id: string, repo: string, o: Partial<UnitRow> = {}): UnitRow => ({ id, repo, month: "2026-07", stratum: "state", july: true, in_source: false, ...o });
const input = (units: UnitRow[], f: FirstRow[], fo: FollowRow[] = [], models = ["m"]): AnalysisInput => ({ schema: "sm-analysis-input.v1", models, units, first: f, followon: fo, config: { bootstrap_seed: SEED, draws: 10_000, replicates: 3 } });
const ids = (n: number) => Array.from({ length: n }, (_, i) => "u" + String(i).padStart(2, "0"));
const three = (u: string, tree: FollowRow["tree"], v: 0 | 1, model = "m") => [1, 2, 3].map((r) => fol(u, tree, r, v, {}, model));

function bruteSignFlip(d: number[]): number {
  const obs = Math.abs(d.reduce((a, x) => a + x, 0));
  let hit = 0;
  for (let mask = 0; mask < 2 ** d.length; mask++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += (mask >> i) & 1 ? -d[i]! : d[i]!;
    if (Math.abs(s) >= obs - 1e-9) hit++;
  }
  return hit / 2 ** d.length;
}

describe("exact sign-flip", () => {
  test("hand-counted patterns", () => {
    expect(exactSignFlip([1, 1, 1]).p).toBe(2 / 8);
    expect(exactSignFlip([1 / 3, 2 / 3, 1]).p).toBe(2 / 8);
    expect(exactSignFlip([1, 1, 1, 1, 1, 0]).p).toBe(2 / 64 * 2);
    expect(exactSignFlip([1, 1, 1, 1, 1, 1]).p).toBe(2 / 64);
    expect(exactSignFlip([1, -1]).p).toBe(1);
    expect(exactSignFlip([0.5, -1 / 3, 1, 2 / 3]).enumerated).toBe(true);
  });
  test("agrees with a brute-force loop for n up to 20, and runs past 20 by convolution alone", () => {
    let x = 12345;
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (const n of [1, 2, 5, 9, 13, 17, 20]) {
      const d = Array.from({ length: n }, () => (Math.floor(rnd() * 13) - 6) / 6);
      expect(exactSignFlip(d).p).toBeCloseTo(bruteSignFlip(d), 12);
    }
    const big = Array.from({ length: 60 }, (_, i) => (i % 7 === 0 ? -1 : i % 3 === 0 ? 0 : 1 / 3));
    const r = exactSignFlip(big);
    expect(r.enumerated).toBe(false);
    expect(r.p).toBeGreaterThan(0);
    expect(r.p).toBeLessThan(1);
    expect(() => exactSignFlip([0.1])).toThrow(/^E_SM_ANALYSIS /);
  });
});

describe("claim 1", () => {
  test("HELPS: 10 repositories, each with one unit better and one tied; interval degenerate at 0.5, McNemar 2/1024", () => {
    const us = ids(20).map((u, i) => unit(u, "r" + Math.floor(i / 2)));
    const f = us.flatMap((u, i) => [first(u.id, "A1", i % 2 ? "no_fix" : "clean_fix"), first(u.id, "A0", "no_fix"), first(u.id, "A2", "no_fix")]);
    const m = analyse(input(us, f)).models[0]!;
    const c = m.claim1.strict[0]!;
    expect(c.name).toBe("A1-A0");
    expect(c.stat!.delta).toBe(0.5);
    expect(c.stat!.ci95).toEqual([0.5, 0.5]);
    expect(c.stat!.p).toBeCloseTo(2 / 1024, 15);
    expect([c.stat!.worse, c.stat!.better]).toEqual([0, 10]);
    expect(c.verdict).toBe("HELPS");
    expect(c.breaks!.stat!.ci95).toEqual([0, 0]);
    expect(c.breaks!.breaks_more).toBe(false);
    expect(m.claim1.stage2!.eligible).toBe(true);
    expect(m.claim1.lens_open).toBeNull();
  });

  test("HURTS, and breaks more when the break-rate interval sits above 0", () => {
    const us = ids(10).map((u, i) => unit(u, "r" + i));
    const f = us.flatMap((u) => [first(u.id, "A1", "no_fix_broke"), first(u.id, "A0", "clean_fix")]);
    const c = analyse(input(us, f)).models[0]!.claim1.strict[0]!;
    expect(c.stat!.ci95).toEqual([-1, -1]);
    expect(c.stat!.p).toBeCloseTo(2 / 1024, 15);
    expect(c.verdict).toBe("HURTS");
    expect(c.breaks!.stat!.ci95).toEqual([1, 1]);
    expect(c.breaks!.breaks_more).toBe(true);
  });

  test("interval from the exact bootstrap distribution (4 repositories, differences +1 +1 0 -1): [-0.5, 1], McNemar p = 1", () => {
    const us = ids(4).map((u, i) => unit(u, "r" + i));
    const a1: Outcome[] = ["clean_fix", "clean_fix", "no_fix", "no_fix"], a0: Outcome[] = ["no_fix", "no_fix", "no_fix", "clean_fix"];
    const f = us.flatMap((u, i) => [first(u.id, "A1", a1[i]!), first(u.id, "A0", a0[i]!), first(u.id, "A2", a1[i]!)]);
    const m = analyse(input(us, f)).models[0]!;
    const c = m.claim1.strict[0]!;
    expect(c.stat!.ci95).toEqual([-0.5, 1]);
    expect(c.stat!.p).toBe(1);
    expect(c.verdict).toBe("NO MEASURABLE DIFFERENCE");
    expect(c.mdd).toMatch(/^MDD above 21\.7 points/);
    expect(m.claim1.stage2!.eligible).toBe(false);
    expect(m.claim1.lens_open!.text).toMatch(/stops at n = 60/);
  });

  test("gap rules: a gap in any arm leaves the contrast, exactly 10% gaps keeps the verdict, more is incomplete; worst case scores gaps as failures", () => {
    const us = ids(10).map((u, i) => unit(u, "r" + i));
    const base = (gaps: string[]) => us.flatMap((u) => [first(u.id, "A1", "clean_fix", gaps.includes(u.id) ? { session_gap: "E_SM_UPSTREAM_GAP" } : {}), first(u.id, "A0", "no_fix", u.id === "u09" ? { adapted: rd(null, "E_SM_TEST_PATCH_CONFLICT") } : {})]);
    const one = analyse(input(us, base(["u00"]))).models[0]!;
    const c1 = one.claim1.strict[0]!;
    expect([c1.stat!.n, c1.dropped, c1.incomplete_cells.length]).toEqual([9, 1, 0]);
    expect(c1.verdict).toBe("HELPS");
    expect(one.cells.first.A1!.strict).toEqual({ units: 10, gaps: 1, incomplete: false });
    expect(one.claim1.adapted[0]!.stat!.n).toBe(8);
    const two = analyse(input(us, base(["u00", "u01"]))).models[0]!;
    const c2 = two.claim1.strict[0]!;
    expect(c2.verdict).toBe("INCOMPLETE");
    expect(c2.incomplete_cells).toEqual(["m A1 (strict)"]);
    expect(c2.stat!.delta).toBe(1);
    expect(c2.worst_case!.stat!.n).toBe(10);
    expect(c2.worst_case!.stat!.delta).toBeCloseTo(0.8, 12);
    expect(report(analyse(input(us, base(["u00", "u01"])))).some((l) => l.includes("E_SM_CELL_INCOMPLETE m A1 (strict)"))).toBe(true);
  });

  test("A0 and A2 not run (claim 1 stopped at admission) reads as not run", () => {
    const us = ids(3).map((u, i) => unit(u, "r" + i));
    const m = analyse(input(us, us.map((u) => first(u.id, "A1", "no_fix")))).models[0]!;
    expect(m.claim1.strict.every((c) => c.status === "not run")).toBe(true);
  });
});

describe("claim 2", () => {
  test("HELPS on 6 units: every A1 tree passes, every S0 tree fails; sign-flip p = 2/64, pass^3, inherited fix sensitivity", () => {
    const us = ids(6).map((u, i) => unit(u, "r" + i));
    const f = us.flatMap((u, i) => [first(u.id, "A1", i === 0 ? "clean_fix" : "no_fix"), first(u.id, "S2", "no_fix")]);
    const fo = us.flatMap((u) => [...three(u.id, "S0", 0), ...three(u.id, "A1", 1), ...three(u.id, "S2", 0)]);
    const m = analyse(input(us, f, fo)).models[0]!;
    const c = m.claim2.incremental[0]!;
    expect(c.name).toBe("A1-S0");
    expect(c.stat!.ci95).toEqual([1, 1]);
    expect(c.stat!.p).toBe(2 / 64);
    expect(c.verdict).toBe("HELPS");
    expect(c.breaks!.breaks_more).toBe(false);
    expect(m.claim2.trees.find((t) => t.tree === "A1")!.pass3).toEqual({ trees: 6, incremental: 6, end_to_end: 6 });
    expect(m.claim2.trees.find((t) => t.tree === "A1")!.inherited_fix).toBe(1);
    const inh = m.sensitivity.inherited_fix[0]!;
    expect([inh.units_left_out, inh.stat!.p]).toEqual([1, 2 / 32]);
    expect(m.claim2.whole_incremental[0]!.stat).toBeNull();
  });

  test("tree rules: 2 of 3 replicates keeps a tree, 1 of 3 removes it, a first-stage conflict removes the tree, a start-set conflict gaps all three", () => {
    const us = ids(4).map((u, i) => unit(u, "r" + i));
    const f = us.flatMap((u) => [first(u.id, "A1", "no_fix", u.id === "u02" ? { strict: rd(null, "E_SM_TEST_PATCH_CONFLICT") } : {}), first(u.id, "S2", "no_fix")]);
    const fo = [
      fol("u00", "A1", 1, 1), fol("u00", "A1", 2, 0), fol("u00", "A1", 3, null, { gap: "E_SM_INFRA_GAP" }),
      fol("u01", "A1", 1, 1), fol("u01", "A1", 2, null, { gap: "E_SM_UPSTREAM_GAP" }), fol("u01", "A1", 3, null, { gap: "E_SM_UPSTREAM_GAP" }),
      ...[1, 2, 3].map((r) => fol("u02", "A1", r, null, { gap: "first_stage_test_patch_conflict" })),
      ...three("u03", "A1", 1),
      ...us.flatMap((u) => three(u.id, "S0", 0)),
      ...[1, 2, 3].map((r) => fol("u03", "S2", r, null, { gap: "start_set_conflict" })), ...us.slice(0, 3).flatMap((u) => three(u.id, "S2", 0)),
    ];
    const m = analyse(input(us, f, fo)).models[0]!;
    const c = m.claim2.incremental[0]!;
    expect([c.stat!.n, c.dropped]).toEqual([2, 2]);
    expect(c.stat!.mean_b).toBeCloseTo(0.75, 12);
    expect(c.stat!.p).toBe(bruteSignFlip([0.5, 1]));
    expect(m.literal).toEqual({ first_stage_test_patch_conflict_trees: 1, start_set_conflict_trees: 1 });
    expect(m.cells.trees.A1).toEqual({ units: 4, gaps: 2, incomplete: true });
    expect(c.verdict).toBe("INCOMPLETE");
    expect(c.worst_case!.stat!.mean_b).toBeCloseTo((1 / 3 + 1 / 3 + 0 + 1) / 4, 12);
  });
});

describe("claim 2 first-stage session gaps", () => {
  test("an upstream gap in A1's first stage removes A1's tree even when follow-on records exist", () => {
    const us = ids(2).map((u, i) => unit(u, "r" + i));
    const f = us.map((u) => first(u.id, "A1", "no_fix", u.id === "u01" ? { session_gap: "E_SM_UPSTREAM_GAP" } : {}));
    const fo = us.flatMap((u) => [...three(u.id, "S0", 0), ...three(u.id, "A1", 1)]);
    const m = analyse(input(us, f, fo)).models[0]!;
    expect(m.claim2.trees.find((t) => t.tree === "A1")!.removed).toEqual([["first-stage gap (code)", 1]]);
    expect(m.claim2.incremental[0]!.stat!.n).toBe(1);
  });
});

describe("pooled, strata and the frozen numbers", () => {
  test("stratified bootstrap and the difference of differences on degenerate tables", () => {
    const p = (repo: string, a: number, b: number, k: number) => ({ unit: repo + k, repo, a, b });
    const byModel = new Map([["x", [p("r1", 0, 1, 1), p("r1", 0, 0, 2), p("r2", 0, 1, 1), p("r2", 0, 0, 2)]], ["y", [p("r3", 0, 1, 1), p("r3", 0, 0, 2)]]]);
    expect(stratifiedBootstrap(byModel, { bootstrap_seed: SEED, draws: 10_000 })).toEqual({ delta: 0.5, ci95: [0.5, 0.5] });
    const dd = diffOfDiffs([p("a", 0, 1, 1), p("b", 0, 1, 1)], [p("c", 0, 0, 1), p("d", 1, 1, 1)], { bootstrap_seed: SEED, draws: 10_000 });
    expect(dd.delta).toBe(1);
    expect(dd.ci95).toEqual([1, 1]);
  });

  test("pooled claim 1 across two models with the same table", () => {
    const us = ids(10).map((u, i) => unit(u, "r" + i, { stratum: i < 5 ? "state" : "other", july: i < 4 }));
    const f = ["m", "n"].flatMap((m) => us.flatMap((u) => [first(u.id, "A1", "clean_fix", {}, m), first(u.id, "A0", "no_fix", {}, m)]));
    const a = analyse(input(us, f, [], ["m", "n"]));
    const pc = a.pooled.claim1[0]!;
    expect([pc.n, pc.delta, pc.better, pc.worse]).toEqual([20, 1, 20, 0]);
    expect(pc.ci95).toEqual([1, 1]);
    expect(pc.p).toBeCloseTo(2 / 2 ** 20, 18);
    const m = a.models[0]!;
    expect(m.strata[0]!.state.stat!.n).toBe(5);
    expect(m.strata[0]!.difference_of_differences!.delta).toBe(0);
    expect(m.july.units).toBe(4);
    expect(m.july.claim1.stat!.p).toBe(2 / 16);
  });

  test("the MDD table matches power.txt", () => {
    const txt = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-09-geva-409-state-machines-prompt-prereg/power.txt"), "utf8");
    for (const r of MDD_CLAIM1) expect(txt).toContain(r.d.toFixed(2) + " | " + r.n60.toFixed(1) + " | " + r.n60_deff.toFixed(1) + " | " + r.pooled.toFixed(1));
    expect(txt).toContain("3 | 0.00 | 0.273 | 9.9 | " + MDD_CLAIM2.incremental[0].toFixed(1));
    expect(txt).toContain("3 | 0.10 | 0.304 | 11.0 | " + MDD_CLAIM2.incremental[1].toFixed(1));
    expect(txt).toContain("0.05 | 0.330 | " + MDD_CLAIM2.end_to_end[0].toFixed(1));
    expect(txt).toContain("0.20 | 0.400 | " + MDD_CLAIM2.end_to_end[1].toFixed(1));
  });

  test("refuses a bad input with E_SM_ANALYSIS", () => {
    const us = [unit("u0", "r0")];
    expect(() => analyse({ ...input(us, []), config: { bootstrap_seed: SEED, draws: 999, replicates: 3 } })).toThrow(/^E_SM_ANALYSIS /);
    expect(() => analyse(input(us, [first("u0", "A1", "no_fix"), first("u0", "A1", "no_fix")]))).toThrow(/^E_SM_ANALYSIS two first-stage rows/);
    expect(() => analyse(input(us, [first("zz", "A1", "no_fix")]))).toThrow(/^E_SM_ANALYSIS /);
  });
});

describe("buildInput from records in the scorer's contract shape, and from older records", () => {
  test("reads reruns, fallbacks, strict and whole follow-on readings, gap reasons, session gaps and questions", () => {
    const units = [
      { schema: "sm-unit.v1", id: "u1", repo: "org/a", month: "2026-07", labels: { stratum: "state" }, split: { in_source_tests: true } },
      { schema: "sm-unit.v1", id: "u2", repo: "org/b", month: "2026-05", labels: null },
    ];
    const reading = (outcome: string, extra: object = {}) => ({ outcome, gap: null, rerun_2of3: false, ...extra });
    const outcomes = [
      { schema: "sm-outcome.v1", stage: "first", unit: "u1", model: "m", cell: "A1", strict: reading("clean_fix", { rerun_2of3: true, reruns: { fix: ["t1"], no_fix: [], break: ["s1"] } }), adapted: reading("clean_fix"), fallbacks: [{ reason: "skip_marker", reading: "adapted", detail: "x" }] },
      { schema: "sm-outcome.v1", stage: "first", unit: "u2", model: "m", cell: "A1", strict: reading("no_fix", { rerun_2of3: true }), adapted: { ...reading("no_fix"), fell_back_to_strict: "an added line holds a skip marker" } },
      { schema: "sm-outcome.v1", stage: "first", unit: "u1", model: "m", cell: "A0", strict: reading("no_fix"), adapted: reading("no_fix") },
    ];
    const sessions = [
      { schema: "sm-session.v1", unit: "u2", model: "m", cell: "A0", stage: "first", end: "upstream", attempt: 2, questions: { ask_user_question: 0, prose: 0 } },
      { schema: "sm-session.v1", unit: "u1", model: "m", cell: "A1", stage: "first", end: "completed", attempt: 1, questions: { ask_user_question: 2, prose: 1 }, exposure: { text: true } },
      { schema: "sm-session.v1", unit: "u1", model: "m", cell: "F-S0-3", stage: "followon", tree_ref: { tree: "S0", first_session: null }, end: "infra", attempt: 2 },
    ];
    const s = (inc: number, e2e: number) => ({ incremental: inc, end_to_end: e2e, f2p_pass: true, start_failed: [], stable_failed: [] });
    const followons = [
      { schema: "sm-followon.v1", unit: "u1", model: "m", tree: "S0", replicate: 1, cell: "F-S0-1", gap: null, incremental: 1, end_to_end: 0, strict: s(1, 0), whole: s(1, 1), drift: { drift: false } },
      { schema: "sm-followon.v1", unit: "u1", model: "m", tree: "S0", replicate: 2, cell: "F-S0-2", gap: null, incremental: 1, end_to_end: 1, drift: { drift: true } },
      { schema: "sm-followon.v1", unit: "u2", model: "m", tree: "A1", replicate: 1, cell: "F-A1-1", gap: "E_SM_TEST_PATCH_CONFLICT", start: { gap: "E_SM_TEST_PATCH_CONFLICT" }, incremental: null, end_to_end: null, drift: { drift: false } },
      { schema: "sm-followon.v1", unit: "u2", model: "m", tree: "A1", replicate: 2, cell: "F-A1-2", gap: "start_set_conflict", incremental: null, end_to_end: null, drift: { drift: false } },
    ];
    const x = buildInput({ units, outcomes, followons, sessions, bootstrap_seed: SEED });
    expect(x.units).toEqual([
      { id: "u1", repo: "org/a", month: "2026-07", stratum: "state", july: true, in_source: true },
      { id: "u2", repo: "org/b", month: "2026-05", stratum: "unclear", july: false, in_source: false },
    ]);
    const a1 = x.first.find((r) => r.unit === "u1" && r.cell === "A1")!;
    expect(a1.strict.reruns).toEqual({ fix: ["t1"], no_fix: [], break: ["s1"] });
    expect(a1.fallbacks).toEqual([{ reason: "skip_marker", reading: "adapted" }]);
    expect(a1.questions).toEqual({ ask_user_question: 2, prose: 1 });
    expect(a1.exposed).toBe(true);
    const old = x.first.find((r) => r.unit === "u2" && r.cell === "A1")!;
    expect(old.strict.reruns).toBeNull();
    expect(old.fallbacks).toEqual([{ reason: "skip_marker", reading: "adapted" }]);
    expect(x.first.find((r) => r.unit === "u2" && r.cell === "A0")!.session_gap).toBe("E_SM_UPSTREAM_GAP");
    const f1 = x.followon.find((r) => r.unit === "u1" && r.rep === 1)!;
    expect([f1.incremental, f1.end_to_end, f1.whole]).toEqual([1, 0, { incremental: 1, end_to_end: 1 }]);
    expect(x.followon.find((r) => r.unit === "u1" && r.rep === 2)!.whole).toBeNull();
    expect(x.followon.find((r) => r.unit === "u1" && r.rep === 3)!.gap).toBe("E_SM_INFRA_GAP");
    expect(x.followon.filter((r) => r.unit === "u2").map((r) => r.gap)).toEqual(["start_set_conflict", "start_set_conflict"]);
    const m = analyse(x).models[0]!;
    expect(m.reruns.A1!.strict).toEqual({ sessions: 2, fix: 1, no_fix: 0, break: 1, direction_unrecorded: 1 });
    expect(m.fallbacks.A1).toEqual({ "skip_marker (adapted)": 2 });
    expect(m.questions.A1).toEqual({ sessions: 1, ask_user_question: 2, prose: 1 });
    expect(m.cells.first.A0!.strict.gaps).toBe(1);
    expect(m.sensitivity.in_source.units_left_out).toBe(1);
  });

  test("refuses a record with no model or an unknown fallback reason", () => {
    const units = [{ id: "u1", repo: "a", month: "2026-07" }];
    expect(() => buildInput({ units, outcomes: [{ schema: "sm-outcome.v1", stage: "first", unit: "u1", model: null, cell: "A1", strict: {}, adapted: {} }], followons: [], bootstrap_seed: SEED })).toThrow(/^E_SM_ANALYSIS /);
    expect(() => buildInput({ units, outcomes: [{ schema: "sm-outcome.v1", stage: "first", unit: "u1", model: "m", cell: "A1", strict: {}, adapted: {}, fallbacks: [{ reason: "other" }] }], followons: [], bootstrap_seed: SEED })).toThrow(/^E_SM_ANALYSIS /);
  });
});
