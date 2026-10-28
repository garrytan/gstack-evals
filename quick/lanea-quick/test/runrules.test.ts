import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../src/analyze.ts";
import { resultOutcome } from "../src/grade.ts";
import { failedAttempts } from "../src/plan.ts";

const r = (task: string, arm: string, trial: number, pass: boolean, status = "complete") =>
  ({ suite: "s", model: "m", task, arm, trial, pass, pass_final: pass, status, opened: arm !== "none", safety: false, cost_usd: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearches: 0 }, requests: 0, loaded_bytes_unique: 0, budget_hit: false, wall_ms: 0 }) as any;

describe("verdict rules", () => {
  test("no PASS without valid after runs", () => {
    const rs = [];
    for (const t of ["a", "b", "c", "d", "e"])
      for (const trial of [1, 2, 3]) rs.push(r(t, "before", trial, true), r(t, "none", trial, false), r(t, "after", trial, false, "infra_error"));
    const [b] = analyze(rs);
    expect(b.verdict).not.toBe("PASS");
    expect(b.informative_tasks).toBe(0);
    expect(b.incomplete.join(" ")).toContain("UNPAIRED");
  });
  test("one missing cell is a warning while every task keeps two paired runs", () => {
    const rs = [];
    for (const t of ["a", "b", "c", "d", "e"]) for (const trial of [1, 2, 3]) rs.push(r(t, "before", trial, trial !== 3), r(t, "after", trial, trial !== 3, t === "a" && trial === 3 ? "timeout" : "complete"), r(t, "none", trial, false));
    const [b] = analyze(rs);
    expect(b.verdict).toBe("PASS");
    expect(b.warnings).toContain("MISSING_CELLS a");
  });
  test("a timeout does not switch off REGRESSION: before 2/3, after 1/2 is under 2/3", () => {
    const rs = [];
    for (const t of ["a", "b", "c", "d", "e"]) for (const trial of [1, 2, 3]) rs.push(r(t, "before", trial, trial !== 3), r(t, "after", trial, trial !== 3, t === "a" && trial === 1 ? "timeout" : "complete"), r(t, "none", trial, false));
    const [b] = analyze(rs);
    expect(b.verdict).toBe("FAIL");
    expect(b.reasons).toEqual(["REGRESSION a"]);
    expect(b.warnings).toContain("MISSING_CELLS a");
  });
  test("a cap stop makes the block INCOMPLETE", () => {
    const rs = [];
    for (const t of ["a", "b", "c", "d", "e"]) for (const trial of [1, 2, 3]) rs.push(r(t, "before", trial, trial !== 3), r(t, "after", trial, trial !== 3), r(t, "none", trial, false));
    expect(analyze(rs)[0].verdict).toBe("PASS");
    expect(analyze(rs, "pass", false, { "s|m": ["CAP_STOP S1"] })[0].verdict).toBe("INCOMPLETE");
  });
  test("a regression still FAILs when cells are missing", () => {
    const rs = [];
    for (const trial of [1, 2, 3]) rs.push(r("a", "before", trial, true), r("a", "after", trial, false), r("a", "none", trial, false));
    rs.push(r("b", "before", 1, true), r("b", "after", 1, true, "infra_error"));
    expect(analyze(rs)[0].verdict).toBe("FAIL");
  });
});

describe("session and rerun rules", () => {
  test("error results are infra failures; budget and turn limits are intended stops", () => {
    expect(resultOutcome({ subtype: "success" }, false)).toEqual({ stop: false, infra: false, reason: "" });
    expect(resultOutcome({ subtype: "success", is_error: true }, false).infra).toBe(true);
    expect(resultOutcome({ subtype: "error_during_execution" }, false).infra).toBe(true);
    expect(resultOutcome({ subtype: "error_max_turns" }, false)).toMatchObject({ stop: true, infra: false });
    expect(resultOutcome({ subtype: "success", is_error: true }, true)).toMatchObject({ stop: true, infra: false, reason: "budget" });
  });
  test("failed attempts are counted from the kept sibling folders", () => {
    const d = mkdtempSync(join(tmpdir(), "cells-"));
    const cell = join(d, "t1");
    expect(failedAttempts(cell)).toBe(0);
    mkdirSync(`${cell}.failed-1`);
    mkdirSync(join(d, "t10.failed-1"));
    expect(failedAttempts(cell)).toBe(1);
  });
});
