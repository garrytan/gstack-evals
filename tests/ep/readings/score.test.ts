import { describe, expect, test } from "bun:test";
import type { CaseClass } from "../../../lanes/eng-build/types.ts";
import { fxBuild, fxUnit } from "../../../lanes/eng-planted/readings/fixtures.ts";
import { avoid, catchScore, Cells, functionalShare, reach, score, solved, unitScore } from "../../../lanes/eng-planted/readings/score.ts";

const runs = (...c: CaseClass[]) => c;

describe("per-build scores", () => {
  const u = fxUnit(0, 3, 2);
  test("avoid counts a case passing in at least 2 of 3 runs; no result, a missing name or a load error is not a pass", () => {
    const b = fxBuild(u, "plain", 1);
    b.planted = [
      { id: "p0", runs: runs("pass", "pass", "assert") },
      { id: "p1", runs: runs("pass", "missing_name", "load") },
    ];
    expect(avoid(b, u)).toBeCloseTo(1 / 3, 12);
    b.planted = [{ id: "p0", runs: runs("pass", "pass", "pass") }, { id: "p1", runs: runs("pass", "pass", "no_result") }, { id: "p2", runs: runs("pass", "pass", "load") }];
    expect(avoid(b, u)).toBe(1);
    expect(avoid(b, fxUnit(1, 0, 1))).toBeNull();
  });
  test("catch scores a dropped transplant 0 in the primary and leaves it out of the sensitivity read", () => {
    expect(catchScore(fxBuild(u, "plain", 1, { catch: true }))).toBe(1);
    expect(catchScore(fxBuild(u, "plain", 1, { catch: false }))).toBe(0);
    const dropped = fxBuild(u, "plain", 1, { catch: null });
    expect(catchScore(dropped)).toBe(0);
    expect(catchScore(dropped, "sensitivity")).toBeNull();
  });
  test("the composite is (avoid + catch) / 2, or the single component the pilot picks", () => {
    const b = fxBuild(u, "plain", 1, { pass: 3, catch: false });
    expect(score(b, u, "composite")).toBe(0.5);
    expect(score(b, u, "avoid")).toBe(1);
    expect(score(b, u, "catch")).toBe(0);
    expect(score(fxBuild(u, "plain", 1, { pass: 3, catch: null }), u, "composite", "sensitivity")).toBeNull();
  });
  test("the functional share, solved and reach", () => {
    const b = fxBuild(u, "plain", 1, { pass: 0, fn: 1, fnFail: "no_result" });
    expect(functionalShare(b, u)).toBe(0.5);
    expect(solved(b, u)).toBe(0);
    expect(solved(fxBuild(u, "plain", 1), u)).toBe(1);
    expect(reach(b, u)).toBe(4 / 5);
    const crash = "crash" as CaseClass;
    b.planted[0] = { id: "p0", runs: runs(crash, crash, crash) };
    b.planted[1] = { id: "p1", runs: runs("missing_name", "missing_name", "missing_name") };
    expect(reach(b, u)).toBe(3 / 5);
    expect(functionalShare(b, fxUnit(2, 1, 0))).toBeNull();
  });
});

describe("unit scores", () => {
  const u = fxUnit(0, 1, 1);
  test("a unit's arm score is the mean over its builds, with a gap left out or scored 0", () => {
    const bs = [fxBuild(u, "plain", 1, { pass: 1 }), fxBuild(u, "plain", 2, { pass: 0 }), fxBuild(u, "plain", 3, { pass: 1, outcome: "upstream_gap" })];
    expect(unitScore(bs, u, avoid, "missing")).toBe(0.5);
    expect(unitScore(bs, u, avoid, "zero")).toBeCloseTo(1 / 3, 12);
    expect(unitScore([], u, avoid, "missing")).toBeNull();
  });
  test("cells key reviewed arms by reviewer and controls by arm alone", () => {
    const c = new Cells([fxBuild(u, "plain", 1), fxBuild(u, "plain", 1, { reviewer: "sol" }), fxBuild(u, "none", 1), fxBuild(u, "stock", 1)]);
    expect(c.get("u0", "plain", "opus")).toHaveLength(1);
    expect(c.get("u0", "plain", "sol")[0]!.reviewer).toBe("sol");
    expect(c.get("u0", "none", "sol")).toHaveLength(1);
    expect(c.get("u0", "stock", "opus")).toHaveLength(1);
  });
});
