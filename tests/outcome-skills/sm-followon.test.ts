// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests for the follow-on scorer and drift (the implicit state machines prereg, section 8): start-set
// intersection, the incremental and end-to-end scores, replicate means and the 2-of-3 keep rule, first-stage gaps, the
// inherited-fix flag, the base-run patch switch, the read secondary and the frozen drift forms per language.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideDrift, identOf, namedIds } from "../../lanes/outcome-skills/statemachines/drift.ts";
import { createdPaths, firstInfo, followGap, followScores, passedInAll, readCreated, treeCounts, treeScores, type FirstInfo, type FollowonRecord } from "../../lanes/outcome-skills/statemachines/followon.ts";
import { COMPILED, DRIFT_FORMS, LANGS, type Lang } from "../../lanes/outcome-skills/statemachines/langs.ts";
import * as oracle from "../../lanes/outcome-skills/statemachines/oracle.ts";
import { basePatches } from "../../lanes/outcome-skills/statemachines/oracle.ts";
import type { OutcomeRecord } from "../../lanes/outcome-skills/statemachines/score.ts";

const run = (parsed: Record<string, string> | null, build_failed = false) => ({ parsed, build_failed });

describe("start sets", () => {
  test("the ids that pass in all three runs", () => {
    expect(passedInAll([run({ a: "pass", b: "pass", c: "fail" }), run({ a: "pass", b: "fail", c: "pass" }), run({ a: "pass", b: "pass", c: "pass", d: "pass" })])).toEqual(["a"]);
  });
  test("a build failure or an unparsed run passes nothing", () => {
    expect(passedInAll([run({ a: "pass" }), run({ a: "pass" }, true), run({ a: "pass" })])).toEqual([]);
    expect(passedInAll([run({ a: "pass" }), run(null), run({ a: "pass" })])).toEqual([]);
    expect(passedInAll([])).toEqual([]);
  });
  test("the base-run patches are test.patch then fix-tests.patch whenever the fix was split, with no switch", () => {
    const dir = mkdtempSync(join(tmpdir(), "sm-followon-"));
    writeFileSync(join(dir, "test.patch"), "T");
    expect("BASE_RUNS_FIX_TESTS" in oracle).toBe(false);
    expect(basePatches(dir)).toEqual([["test.patch", "T"]]);
    writeFileSync(join(dir, "fix-source.patch"), "S");
    writeFileSync(join(dir, "fix-tests.patch"), "");
    expect(basePatches(dir)).toEqual([["test.patch", "T"]]);
    writeFileSync(join(dir, "fix-tests.patch"), "F");
    expect(basePatches(dir)).toEqual([["test.patch", "T"], ["fix-tests.patch", "F"]]);
    expect(basePatches(dir, false)).toEqual([["test.patch", "T"]]);
  });
});

describe("the two scores", () => {
  const f2p = ["f"], stable = ["s1", "s2"];
  test("a clean follow-on on a tree that broke s2: incremental 1, end to end 0", () => {
    const r = followScores(f2p, ["s1", "n1"], stable, run({ f: "pass", s1: "pass", s2: "fail", n1: "pass" }));
    expect(r).toEqual({ f2p_pass: true, incremental: 1, end_to_end: 0, start_failed: [], stable_failed: ["s2"] });
  });
  test("a start-set id that fails or goes missing fails incremental", () => {
    expect(followScores(f2p, ["s1", "n1"], stable, run({ f: "pass", s1: "pass", s2: "pass", n1: "fail" }))).toMatchObject({ incremental: 0, end_to_end: 1, start_failed: ["n1"] });
    expect(followScores(f2p, ["s1", "n1"], stable, run({ f: "pass", s1: "pass", s2: "pass" }))).toMatchObject({ incremental: 0, end_to_end: 1, start_failed: ["n1"] });
    expect(followScores(f2p, ["s1"], stable, run({ f: "pass", s1: "skip", s2: "pass" }))).toMatchObject({ incremental: 0, end_to_end: 0 });
  });
  test("a fail-to-pass id that does not pass fails both; so does a build failure", () => {
    expect(followScores(f2p, ["s1"], stable, run({ f: "fail", s1: "pass", s2: "pass" }))).toMatchObject({ f2p_pass: false, incremental: 0, end_to_end: 0 });
    expect(followScores(f2p, ["s1"], stable, run({ f: "pass", s1: "pass", s2: "pass" }, true))).toMatchObject({ f2p_pass: false, incremental: 0, end_to_end: 0, stable_failed: stable });
  });
  test("both pass when everything passes", () => {
    expect(followScores(f2p, stable, stable, run({ f: "pass", s1: "pass", s2: "pass" }))).toMatchObject({ incremental: 1, end_to_end: 1 });
  });
});

const rec = (tree: "S0" | "A1" | "S2", replicate: number, o: Partial<FollowonRecord> = {}): FollowonRecord => ({
  schema: "sm-followon.v1", unit: "u1", model: "m", tree, replicate, cell: "F-" + tree + "-" + replicate, session: null, tree_patch_sha256: "", start: { ids: 1, ids_sha256: "", gap: null },
  change: { files: [], lines: 0, binary_listed: [], unsafe: [], patch_sha256: "", empty: false }, excluded: [], applied: true, apply_failed: false, extractions: 1, merge: "clean", three_way: 0, conflict: [], gap: null,
  strict: null, whole: null, whole_run: null, whole_note: null, run: null, f2p_pass: true, incremental: 1, end_to_end: 1, start_failed: [], stable_failed: [], drift: { named: [], ids: [], drift: false }, first: null,
  secondary: { spent_micros: null, unknown_micros: null, turns: null, wall_ms: null, files_changed: 0, read_first_stage_files: null }, ...o,
});
const first = (cell: string, o: Partial<FirstInfo> = {}): FirstInfo => ({ unit: "u1", model: "m", cell, gap: null, strict: "no_fix", ...o });

describe("tree scores", () => {
  test("the mean over replicates, and pass3 only with all three scored", () => {
    const t = treeScores([rec("S0", 1), rec("S0", 2, { incremental: 0, end_to_end: 0 }), rec("S0", 3, { end_to_end: 0 })], []);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ tree: "S0", kept: true, scored: 3, incremental: 2 / 3, end_to_end: 1 / 3, pass3_incremental: false, pass3_end_to_end: false });
  });
  test("2 of 3 replicates keep a tree (pass3 unset); 1 of 3 removes it", () => {
    const two = treeScores([rec("A1", 1), rec("A1", 2, { gap: "E_SM_UPSTREAM_GAP", incremental: null, end_to_end: null }), rec("A1", 3)], [first("A1")]);
    expect(two[0]).toMatchObject({ kept: true, gaps: 1, scored: 2, incremental: 1, end_to_end: 1, pass3_incremental: null });
    const one = treeScores([rec("A1", 1), rec("A1", 2, { gap: "E_SM_INFRA_GAP" }), rec("A1", 3, { gap: "E_SM_TEST_PATCH_CONFLICT" })], [first("A1")]);
    expect(one[0]).toMatchObject({ kept: false, reason: "1 of 3 replicates scored", incremental: null });
  });
  test("a first-stage gap removes the tree's follow-ons, even with none recorded", () => {
    const t = treeScores([rec("S2", 1), rec("S2", 2), rec("S2", 3)], [first("S2", { gap: "E_SM_TEST_PATCH_CONFLICT" }), first("A1", { gap: "E_SM_UPSTREAM_GAP", strict: null })]);
    expect(t.map((x) => [x.tree, x.kept, x.reason])).toEqual([["A1", false, "first-stage gap E_SM_UPSTREAM_GAP"], ["S2", false, "first_stage_test_patch_conflict"]]);
    expect(treeScores([rec("A1", 1), rec("A1", 2)], [])[0]).toMatchObject({ kept: false, reason: "no first-stage record for the tree" });
  });
  test("an inherited fix is flagged per tree and counted; drift is counted", () => {
    const t = treeScores([rec("A1", 1), rec("A1", 2), rec("A1", 3), rec("S2", 1, { f2p_pass: false, incremental: 0, end_to_end: 0, drift: { named: [{ id: "x", kinds: ["compiler"] }], ids: ["x"], drift: true } }), rec("S2", 2), rec("S0", 1), rec("S0", 2)], [first("A1", { strict: "clean_fix" }), first("S2")]);
    expect(t.map((x) => [x.tree, x.inherited_fix, x.drift])).toEqual([["A1", true, 0], ["S0", false, 0], ["S2", false, 1]]);
    const z = { kept: 0, removed_first_gap: 0, removed_first_test_patch_conflict: 0, removed_start_set_conflict: 0, removed_replicates: 0, removed_no_first: 0, inherited_fix: 0, drift_units: 0 };
    expect(treeCounts(t)).toEqual({ A1: { ...z, kept: 1, inherited_fix: 1 }, S0: { ...z, kept: 1 }, S2: { ...z, kept: 1, drift_units: 1 } });
  });
  test("the two literal choices are told apart and counted: a first-stage test-patch conflict removes the tree; a start-set conflict is a gap on all three replicates", () => {
    const sc = (n: number) => rec("S2", n, { gap: "start_set_conflict", incremental: null, end_to_end: null, f2p_pass: null });
    const t = treeScores([rec("A1", 1), rec("A1", 2), rec("A1", 3), sc(1), sc(2), sc(3), rec("S0", 1), rec("S0", 2), rec("S0", 3)], [first("A1", { gap: "E_SM_TEST_PATCH_CONFLICT" }), first("S2")]);
    expect(t.map((x) => [x.tree, x.kept, x.reason])).toEqual([["A1", false, "first_stage_test_patch_conflict"], ["S0", true, "kept"], ["S2", false, "start_set_conflict"]]);
    const z = { kept: 0, removed_first_gap: 0, removed_first_test_patch_conflict: 0, removed_start_set_conflict: 0, removed_replicates: 0, removed_no_first: 0, inherited_fix: 0, drift_units: 0 };
    expect(treeCounts(t)).toEqual({ A1: { ...z, removed_first_test_patch_conflict: 1 }, S0: { ...z, kept: 1 }, S2: { ...z, removed_start_set_conflict: 1 } });
    const other = treeScores([rec("A1", 1)], [first("A1", { gap: "E_SM_INFRA_GAP" })]);
    expect(treeCounts(other).A1).toEqual({ ...z, removed_first_gap: 1 });
  });
  test("a replicate recorded twice is refused", () => {
    expect(() => treeScores([rec("S0", 1), rec("S0", 1)], [])).toThrow(/E_SM_ARM/);
  });
  test("follow-on gap reasons: start_set_conflict and first_stage_test_patch_conflict are their own codes", () => {
    expect(followGap({ gap: "E_SM_TEST_PATCH_CONFLICT" }, null)).toBe("start_set_conflict");
    expect(followGap({ gap: null }, first("A1", { gap: "E_SM_TEST_PATCH_CONFLICT" }))).toBe("first_stage_test_patch_conflict");
    expect(followGap({ gap: null }, first("A1", { gap: "E_SM_UPSTREAM_GAP" }))).toBe(null);
    expect(followGap({ gap: null }, first("A1"))).toBe(null);
  });
  test("firstInfo reads the strict gap and outcome", () => {
    const o = { unit: "u1", model: "m", cell: "A1", strict: { gap: "E_SM_TEST_PATCH_CONFLICT", outcome: null } } as unknown as OutcomeRecord;
    expect(firstInfo(o)).toEqual({ unit: "u1", model: "m", cell: "A1", gap: "E_SM_TEST_PATCH_CONFLICT", strict: null });
    expect(firstInfo({ ...o, strict: { gap: null, outcome: "clean_fix" } } as unknown as OutcomeRecord, "E_SM_INFRA_GAP").gap).toBe("E_SM_INFRA_GAP");
  });
});

describe("the read secondary", () => {
  const tp = "diff --git a/docs/states.md b/docs/states.md\nnew file mode 100644\n--- /dev/null\n+++ b/docs/states.md\n@@ -0,0 +1 @@\n+table\ndiff --git a/a.go b/a.go\n--- a/a.go\n+++ b/a.go\n@@ -1 +1 @@\n-x\n+y\n";
  test("created paths and the tool inputs that name them", () => {
    expect(createdPaths(tp)).toEqual(["docs/states.md"]);
    const recs = [{ type: "AssistantMessage", content: [{ type: "tool_use", name: "Read", input: { file_path: "/w/docs/states.md" } }, { type: "tool_use", name: "Read", input: { file_path: "/w/a.go" } }] }, { type: "UserMessage", content: [] }];
    expect(readCreated(recs, createdPaths(tp))).toEqual(["docs/states.md"]);
    expect(readCreated(recs.slice(1), createdPaths(tp))).toEqual([]);
  });
});

/** One positive log per language form, in the order of DRIFT_FORMS; each names "widget_count" (or a module path to it). */
const POS: Record<Lang, string[]> = {
  rust: ["error[E0425]: cannot find function \x60widget_count\x60 in this scope", "error: cannot find macro \x60widget_count\x60 in this scope", "error[E0432]: unresolved import \x60crate::gauge::widget_count\x60", "error[E0599]: no method named \x60widget_count\x60 found for struct \x60Gauge\x60 in the current scope", "error[E0609]: no field \x60widget_count\x60 on type \x60Gauge\x60", "error[E0560]: struct \x60Gauge\x60 has no field named \x60widget_count\x60"],
  go: ["./gauge_test.go:9:7: undefined: gauge.widget_count", "./gauge_test.go:9:7: g.widget_count undefined (type *Gauge has no field or method widget_count)", "./gauge_test.go:9:7: unknown field widget_count in struct literal of type Gauge"],
  java: ["GaugeTest.java:9: error: cannot find symbol\n        g.widget_count();\n         ^\n  symbol:   method widget_count()\n  location: class Gauge", "GaugeTest.java:2: error: package org.example.widget_count does not exist"],
  c: ["gauge_test.c:9:5: error: \u2018widget_count\u2019 undeclared (first use in this function)", "gauge_test.c:9:5: error: implicit declaration of function \u2018widget_count\u2019; did you mean \u2018widget_total\u2019? [-Wimplicit-function-declaration]", "gauge_test.c:9:5: error: \u2018struct gauge\u2019 has no member named \u2018widget_count\u2019", "gauge_test.cc:9:5: error: \u2018widget_count\u2019 is not a member of \u2018gauge\u2019", "gauge_test.c:9:5: error: unknown type name \u2018widget_count\u2019", "gauge_test.c:9:5: error: use of undeclared identifier 'widget_count'", "gauge_test.cc:9:5: error: no member named 'widget_count' in 'Gauge'"],
  cpp: [],
  csharp: ["GaugeTests.cs(9,5): error CS0103: The name 'widget_count' does not exist in the current context", "GaugeTests.cs(9,5): error CS1061: 'Gauge' does not contain a definition for 'widget_count' and no accessible extension method", "GaugeTests.cs(2,7): error CS0246: The type or namespace name 'widget_count' could not be found"],
  js: ["ReferenceError: widget_count is not defined", "TypeError: (0 , _gauge.widget_count) is not a function", "SyntaxError: The requested module './gauge.js' does not provide an export named 'widget_count'", "Cannot find module './lib/widget_count.js' from 'test/gauge.test.js'"],
  ts: [],
  python: ["ImportError: cannot import name 'widget_count' from 'gauge' (/w/gauge.py)", "ModuleNotFoundError: No module named 'gauge.widget_count'", "AttributeError: 'Gauge' object has no attribute 'widget_count'", "NameError: name 'widget_count' is not defined"],
};
POS.cpp = POS.c;
POS.ts = [...POS.js, "gauge.test.ts(9,5): error TS2304: Cannot find name 'widget_count'.", "error TS2339: Property 'widget_count' does not exist on type 'Gauge'.", "error TS2305: Module '\"./gauge\"' has no exported member 'widget_count'.", "error TS2724: '\"./gauge\"' has no exported member named 'widget_count'. Did you mean 'widget_total'?", "error TS2307: Cannot find module './widget_count' or its corresponding type declarations."];

/** Errors that are not drift forms: wrong values, type mismatches, panics, and errors that name a type, not the identifier. */
const NEG: Record<Lang, string> = {
  rust: "error[E0308]: mismatched types\n  expected \x60u32\x60, found \x60i64\x60\nthread 'tests::widget_count' panicked at 'assertion failed'",
  go: "./gauge_test.go:9:7: cannot use widget_count (variable of type int) as string value\n--- FAIL: TestWidgetCount (0.00s)",
  java: "GaugeTest.java:9: error: incompatible types: int cannot be converted to String\nexpected:<3> but was:<4>",
  c: "gauge_test.c:9:5: warning: implicit declaration of function \u2018widget_count\u2019\ngauge_test.c:9:5: error: too few arguments to function \u2018widget_count\u2019",
  cpp: "gauge_test.cc:9:5: error: no matching function for call to \u2018widget_count(int)\u2019",
  csharp: "GaugeTests.cs(9,5): error CS1503: Argument 1: cannot convert from 'int' to 'string'",
  js: "TypeError: Cannot read properties of undefined (reading 'widget_count')\nAssertionError: expected 3 to equal 4",
  ts: "error TS2322: Type 'number' is not assignable to type 'string'.\nTypeError: Cannot read properties of undefined (reading 'widget_count')",
  python: "TypeError: 'Gauge' object is not callable\nAssertionError: 3 != 4\nKeyError: 'widget_count'",
};

describe("drift forms", () => {
  test("every language has forms, compiled languages read compiler errors only, and every form cites a source", () => {
    for (const l of LANGS) {
      expect(DRIFT_FORMS[l].length).toBeGreaterThan(0);
      expect(DRIFT_FORMS[l].every((f) => f.source.length > 10 && f.re.global)).toBe(true);
      expect(DRIFT_FORMS[l].every((f) => f.kind === "compiler")).toBe(COMPILED.has(l));
    }
  });
  for (const l of LANGS)
    test(l + ": each form names the identifier, and other errors name none", () => {
      expect(POS[l].length).toBe(DRIFT_FORMS[l].length);
      POS[l].forEach((log, k) => {
        const hits = DRIFT_FORMS[l].filter((f) => [...log.matchAll(f.re)].some((m) => identOf(f.capture, m[1]!) === "widget_count"));
        expect(hits).toContain(DRIFT_FORMS[l][k]!);
        expect(namedIds(l, "noise\n" + log + "\nmore noise").map((n) => n.id)).toEqual(["widget_count"]);
      });
      expect(namedIds(l, NEG[l])).toEqual([]);
    });
  test("identOf takes a qualified name's or a module path's last segment", () => {
    expect(identOf("name", "crate::gauge::widget_count")).toBe("widget_count");
    expect(identOf("name", "_gauge.widget_count")).toBe("widget_count");
    expect(identOf("module", "../lib/widget_count.mjs")).toBe("widget_count");
    expect(identOf("module", "pkg.sub.widget_count")).toBe("widget_count");
  });
  test("the decision: in the base tree's source and not in the start tree's, and only when the fix's tests fail", () => {
    const base = new Set(["widget_count", "Gauge"]);
    expect(decideDrift(true, ["widget_count", "Gauge"], base, new Set(["Gauge"]))).toEqual({ drift: true, ids: ["widget_count"] });
    expect(decideDrift(true, ["widget_count"], base, new Set(["widget_count"]))).toEqual({ drift: false, ids: [] });
    expect(decideDrift(true, ["brand_new"], base, new Set())).toEqual({ drift: false, ids: [] });
    expect(decideDrift(false, ["widget_count"], base, new Set())).toEqual({ drift: false, ids: [] });
    expect(decideDrift(true, [], base, new Set())).toEqual({ drift: false, ids: [] });
  });
});
// Value: protects=section 12's raise attempt reading, where the cut issue's follow-ons are scored apart from the full issue's; fails_when=treeScores averages full-issue and -cut records of one unit, model and tree together, or refuses them only when their replicates overlap; why_new=the /ship review of #325 (red team: treeScores grouped both issue forms); seam=followon.ts treeScores; no_claim=claim2Admission's bands
test("tree scores refuse a set that mixes full-issue and cut follow-ons for one unit, model and tree; a cut-only set scores as a full one", () => {
  const cut = (r: FollowonRecord): FollowonRecord => ({ ...r, cell: r.cell + "-cut" });
  expect(() => treeScores([rec("S0", 1), cut(rec("S0", 2)), rec("S0", 3)], [])).toThrow(/^E_SM_ARM .*mix full-issue and cut/);
  const recs = [rec("S0", 1), rec("S0", 2, { incremental: 0, end_to_end: 0 }), rec("S0", 3)];
  expect(treeScores(recs.map(cut), [])).toEqual(treeScores(recs, []));
});
