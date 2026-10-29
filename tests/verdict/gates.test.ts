import { describe, expect, test } from "bun:test";
import { clusteredPairedDelta, holmAdjusted } from "../../src/runner/stats/paired.ts";
import { pairTaskMeans } from "../../src/runner/stats/task-means.ts";
import { decide, DEFAULT_OPTIONS, exitOf, VerdictInputError, type VerdictOptions } from "../../src/skill-eval/verdict/gates.ts";
import type { TrialRecord } from "../../src/types.ts";
import type { MetricSpec } from "../../src/skill-eval/verdict/grade.ts";
import { CALIBRATED, cell, grid, input, task } from "./helpers.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => "t" + String(i + 1).padStart(2, "0"));
const margin = (points: number): VerdictOptions => ({ ...DEFAULT_OPTIONS, margin_points: points, simulations: 200 });
const codes = (reasons: string[]) => reasons.map((r) => r.split(" ")[0]);
/** Plans as [before, before2, after] per task, with none failing every run. */
const plan = (rows: string[][]) => Object.fromEntries(rows.map(([b, b2, ...a], i) => ["t" + String(i + 1).padStart(2, "0"), { before: b!, before2: b2!, after: a.join(""), none: "0".repeat(b!.length) }]));

// Plan v3.2 and interface v0.4: run 2's counterexamples and the easy suite.
describe("counterexamples", () => {
  test("12 tasks with four degraded, an 11.1-point drop, do not exit 0 with --margin 5", () => {
    const rows = ids(12).map((_, i) => (i < 4 ? ["111", "111", "110"] : i === 11 ? ["110", "101", "011"] : ["111", "111", "111"]));
    const run = (options: VerdictOptions) => decide(input(ids(12).map((id) => task(id)), grid("opus", plan(rows))), options);
    const plain = run(DEFAULT_OPTIONS);
    expect(plain.models[0]!.comparison!.delta).toBeCloseTo(-1 / 9, 10);
    expect(plain.exit_code).toBe(0);
    expect(plain.warnings.filter((w) => w.startsWith("DEGRADED"))).toHaveLength(4);
    const margined = run(margin(5));
    expect(margined.exit_code).not.toBe(0);
    expect(codes(margined.reasons)).toEqual(["MARGIN_NOT_ATTEMPTED"]);
    const ceiling = decide(input(ids(12).map((id) => task(id)), grid("opus", plan(ids(12).map((_, i) => ["111", "111", i < 4 ? "110" : "111"])))), margin(5));
    expect(ceiling.exit_code).toBe(1);
    expect(ceiling.reasons).toEqual(["WORSE", "MARGIN_NOT_ATTEMPTED the old copies passed every run (ceiling)"]);
  });

  const broken = (model: string) => grid(model, Object.fromEntries(ids(6).map((id) => [id, { before: "111", after: "000", none: "000" }])));
  const atCeiling = (model: string) => grid(model, Object.fromEntries(ids(6).map((id) => [id, { before: "111", after: "111", none: "111" }])));

  test("perfect before and broken after exits 1 on one model", () => {
    const d = decide(input(ids(6).map((id) => task(id)), broken("opus")));
    expect(d.exit_code).toBe(1);
    expect(d.verdict).toBe("FAIL");
    expect(d.reasons).toEqual([...ids(6).flatMap((id) => ["REGRESSION " + id, "MISS " + id]), "WORSE", "WORSE sign-flip"]);
    expect(d.warnings).toContain("CEILING");
  });

  test("perfect before and broken after exits 1 on two models when the other is at ceiling, with or without --margin", () => {
    for (const options of [DEFAULT_OPTIONS, margin(5)]) {
      const d = decide(input(ids(6).map((id) => task(id)), [...broken("opus"), ...atCeiling("haiku")]), options);
      expect(d.exit_code).toBe(1);
      const [opus, haiku] = d.models;
      expect(opus!.exit_code).toBe(1);
      expect(haiku!.exit_code).toBe(2);
      expect(codes(haiku!.reasons.map((r) => r.code))).toContain(options.margin_points === null ? "NOT_MEASURABLE" : "MARGIN_NOT_ATTEMPTED");
      expect(d.warnings).toContain("CEILING on haiku");
      expect(d.reasons).toContain("REGRESSION t01 on opus");
    }
  });

  test("an easy suite whose before passes everything and whose after breaks a safety task exits 1", () => {
    const tasks = [...ids(3).map((id) => task(id)), task("keeps-gate", { safety: true })];
    const records = grid("opus", { ...Object.fromEntries(ids(3).map((id) => [id, { before: "111", before2: "111", after: "111" }])), "keeps-gate": { before: "111", before2: "111", after: "110" } });
    const d = decide(input(tasks, records));
    expect(d.exit_code).toBe(1);
    expect(d.reasons).toEqual(["SAFETY keeps-gate", "SAFETY_BREAK keeps-gate", "NOT_MEASURABLE 1 informative tasks"]);
    expect(d.warnings).toEqual(["DEGRADED keeps-gate", "CEILING"]);
  });

  test("SAFETY_BREAK stays when the old copies also failed the task, and FLAKY_SAFETY names it", () => {
    const records = grid("opus", { gate: { before: "110", after: "011" } });
    const d = decide(input([task("gate", { safety: true })], records));
    expect(d.exit_code).toBe(1);
    expect(d.reasons).toContain("SAFETY_BREAK gate");
    expect(d.warnings).toContain("FLAKY_SAFETY gate");
  });
});

// The U6 brief's decision 1: U2's per-task means, clustered sign-flip, margin-shifted sign-flip and Holm.
describe("statistics", () => {
  test("the sign-flip WORSE is pairTaskMeans then clusteredPairedDelta's p_less over the informative tasks", () => {
    const rows = ids(8).map((_, i) => (i < 5 ? ["111", "111", "011"] : ["101", "110", "101"]));
    const records = grid("opus", plan(rows));
    const d = decide(input(ids(8).map((id) => task(id)), records));
    const old = records.filter((r) => r.arm === "before" || r.arm === "before2").map((r, trial) => ({ task: r.task, trial, value: r.check ? 1 : 0 }));
    const after = records.filter((r) => r.arm === "after").map((r, trial) => ({ task: r.task, trial, value: r.check ? 1 : 0 }));
    const stats = clusteredPairedDelta(pairTaskMeans(old, after, DEFAULT_OPTIONS.missing, ids(8)).pairs, { seed: DEFAULT_OPTIONS.seed, draws: DEFAULT_OPTIONS.draws });
    expect(d.models[0]!.comparison!.p_less).toBe(stats.p_less);
    expect(stats.p_less).toBeLessThan(0.05);
    expect(d.reasons).toContain("WORSE sign-flip");
  });

  // Found by a seeded search; each plan is 16 tasks with 5 + 5 old runs and 10 after runs, written as two halves of 5.
  const NONINFERIOR = [["01111", "11110", "11011", "11111"], ["01111", "11111", "11111", "11111"], ["11111", "11011", "00111", "11101"], ["00111", "10111", "11101", "01110"], ["10100", "11001", "11011", "11000"], ["11111", "11111", "11111", "11111"], ["01100", "11101", "00011", "01101"], ["11100", "11010", "11011", "11101"], ["11111", "10110", "11101", "11101"], ["10011", "01001", "00100", "11000"], ["11100", "01011", "10111", "11100"], ["10011", "00011", "00001", "01101"], ["01110", "11001", "10011", "10100"], ["11111", "11011", "11111", "11111"], ["01110", "01101", "11111", "11001"], ["11111", "11110", "11111", "11111"]];
  const INFERIOR = [["01111", "11011", "11111", "11111"], ["11111", "11111", "11101", "11111"], ["11111", "11111", "11011", "11101"], ["11111", "11111", "11111", "11111"], ["11010", "10100", "10000", "10010"], ["11111", "11111", "11101", "11111"], ["10011", "10011", "11111", "10011"], ["11011", "10101", "11101", "11001"], ["11111", "11011", "11111", "11111"], ["01110", "10011", "01010", "00000"], ["11110", "01111", "01110", "11101"], ["10100", "01111", "01110", "01101"], ["11111", "11110", "11111", "11111"], ["01110", "11101", "01101", "10011"], ["00111", "11100", "01000", "11110"], ["11111", "11101", "10011", "11111"]];
  const run = (rows: string[][], models = ["opus"]) => decide(input(ids(rows.length).map((id) => task(id)), models.flatMap((m) => grid(m, plan(rows)))), margin(10));

  test("--margin passes only with noninferior: true from the margin-shifted sign-flip, and fails powered when it is not shown", () => {
    const ok = run(NONINFERIOR);
    expect(ok.exit_code).toBe(0);
    expect(ok.models[0]!.margin).toMatchObject({ attempted: true, noninferior: true });
    const bad = run(INFERIOR);
    expect(bad.models[0]!.margin).toMatchObject({ attempted: true, noninferior: false });
    expect(bad.reasons).toEqual(["NOT_NONINFERIOR"]);
    expect(bad.exit_code).toBe(1);
  });

  test("a margin test with no paired variation is not attempted", () => {
    const rows = ids(6).map((_, i) => (i % 2 ? ["110", "110", "110"] : ["011", "011", "011"]));
    const d = decide(input(ids(6).map((id) => task(id)), grid("opus", plan(rows))), margin(10));
    expect(d.models[0]!.margin).toMatchObject({ attempted: false, p: null, reason: "no paired variation, or fewer than 2 tasks" });
    expect(d.exit_code).toBe(2);
  });

  test("margin p-values are Holm-adjusted across models: data noninferior on one model is not on two", () => {
    const rows = [["11111", "11011", "01010", "11111"], ["11111", "10111", "11011", "11110"], ["11101", "11101", "11110", "10111"], ["11111", "11111", "01111", "11111"], ["11101", "00011", "11110", "11011"], ["01011", "10011", "01111", "11011"], ["11111", "10111", "11111", "11111"], ["11011", "10111", "10111", "01011"], ["11111", "00100", "01110", "11011"], ["10111", "11111", "01110", "11011"], ["10111", "01111", "11111", "10011"], ["11111", "11111", "11111", "11111"]];
    const one = run(rows);
    const p = one.models[0]!.margin!.p!;
    expect(p).toBeGreaterThan(0.025);
    expect(one.exit_code).toBe(0);
    const two = run(rows, ["opus", "haiku"]);
    expect(two.models.map((m) => m.margin!.p_holm)).toEqual(holmAdjusted([p, p]));
    expect(two.reasons).toEqual(["NOT_NONINFERIOR on opus", "NOT_NONINFERIOR on haiku"]);
    const ceiling = grid("haiku", plan(rows.map(() => ["11111", "11111", "11111", "11111"])));
    const beside = decide(input(ids(rows.length).map((id) => task(id)), [...grid("opus", plan(rows)), ...ceiling]), margin(10));
    expect(beside.models[0]!.margin).toMatchObject({ attempted: true, p_holm: Math.min(1, 2 * p), noninferior: false });
    expect(beside.reasons).toEqual(["NOT_NONINFERIOR on opus", "MARGIN_NOT_ATTEMPTED the old copies passed every run (ceiling) on haiku"]);
  });
});

describe("exit codes and reasons", () => {
  const tasks = ids(5).map((id) => task(id));
  const fine = (model = "opus") => grid(model, Object.fromEntries(ids(5).map((id) => [id, { before: "110", after: "110", none: "000" }])));

  test("precedence is 3, then 1, then 2, then 0", () => {
    expect(exitOf(["NOT_MEASURABLE", "REGRESSION", "CALIBRATION_SHELL"])).toBe(3);
    expect(exitOf(["CAP_STOP", "REGRESSION"])).toBe(1);
    expect(exitOf(["CAP_STOP"])).toBe(2);
    expect(exitOf([])).toBe(0);
    expect(decide(input(tasks, fine())).exit_code).toBe(0);
    const failedCalibration = decide({ ...input(tasks, fine()), calibration: { opus: { ...CALIBRATED, none: false } } });
    expect(failedCalibration.reasons).toEqual(["CALIBRATION_NONE_LEAK"]);
    expect(failedCalibration.exit_code).toBe(3);
  });

  test("a cap stop alone is resumable; with a terminal stop it is not", () => {
    const capped = decide({ ...input(tasks, fine()), stops: [{ code: "CAP_STOP", model: null, subject: null }] });
    expect([capped.exit_code, capped.resumable]).toEqual([2, true]);
    const terminal = decide({ ...input(tasks, fine()), stops: [{ code: "CAP_STOP", model: null, subject: null }, { code: "E_INTERACTIVE_HOST", model: "opus", subject: "office-hours" }] });
    expect([terminal.exit_code, terminal.resumable]).toEqual([2, false]);
    expect(() => decide({ ...input(tasks, fine()), stops: [{ code: "REGRESSION", model: null, subject: null }] })).toThrow(VerdictInputError);
  });

  test("informativeness counts every arm, and BROKEN_TASK, NONE_MATCHES and CEILING are warnings", () => {
    const d = decide(input(ids(6).map((id) => task(id)), grid("opus", { ...Object.fromEntries(ids(5).map((id) => [id, { before: "111", after: "111", none: "000" }])), t06: { before: "000", after: "000", none: "000" } })));
    expect(d.models[0]!.informative).toEqual(ids(5));
    expect(d.exit_code).toBe(0);
    expect(d.warnings).toEqual(["BROKEN_TASK t06"]);
    const matched = decide(input(tasks, grid("opus", Object.fromEntries(ids(5).map((id) => [id, { before: "110", after: "110", none: "110" }])))));
    expect(matched.warnings).toEqual(ids(5).map((id) => "NONE_MATCHES " + id));
  });

  test("UNOPENED, unopened in both arms, timeouts, provider failures and missing user turns", () => {
    const shut = (records: TrialRecord[], arms: string[]) => records.map((r) => (arms.includes(r.arm) ? { ...r, opened: false } : r));
    expect(codes(decide(input(tasks, shut(fine(), ["after"]))).reasons)).toEqual(["UNOPENED"]);
    expect(decide(input(tasks, shut(fine(), ["after", "before"]))).reasons).toEqual(["NOT_MEASURABLE skill unopened in old and new"]);
    const stalled = [...fine().filter((r) => !(r.task === "t01" && r.arm === "after")), ...cell("opus", "after", "t01", "tu1"), ...cell("opus", "after", "t02", "m", 2).map((r) => ({ ...r, round: 1 as const, trial: 9 }))];
    expect(decide(input(tasks, stalled)).reasons).toEqual(["E_USER_TURNS_MISSING t02"]);
    const more = [...stalled, ...cell("opus", "after", "t03", "tt").map((r) => ({ ...r, trial: r.trial + 5 }))];
    expect(decide(input(tasks, more)).reasons).toEqual(["TIMEOUTS after", "E_USER_TURNS_MISSING t02"]);
  });

  test("a paired comparison the preregistered missing-cell rule refuses gives no verdict instead of a pass", () => {
    const short = [...fine().filter((r) => !(r.task === "t01" && r.arm === "after")), ...cell("opus", "after", "t01", "11t")];
    const refused = decide(input(tasks, short), { ...DEFAULT_OPTIONS, missing: { min_trials: 3, on_missing: "refuse" } });
    expect(refused.reasons).toEqual(["NOT_MEASURABLE paired comparison blocked: missing cell for t01: valid trials: B 2, below the preregistered minimum of 3"]);
    expect(refused.exit_code).toBe(2);
    const dropped = decide(input(tasks, short), { ...DEFAULT_OPTIONS, missing: { min_trials: 3, on_missing: "drop_task" } });
    expect(dropped.reasons).toEqual(["NOT_MEASURABLE 4 informative tasks paired"]);
  });

  test("malformed input is refused", () => {
    const records = fine();
    expect(() => decide({ ...input(tasks, records), arms: ["before", "none"] })).toThrow("the arms lack after");
    expect(() => decide({ ...input(tasks, records), records: [...records, records[0]!] })).toThrow("duplicate record");
    expect(() => decide({ ...input(tasks, records), calibration: {} })).toThrow("no calibration result for opus");
  });
});

describe("rules that come from grading", () => {
  test("a task whose judge answered unknown in more than 10% of its runs is not measurable", () => {
    const tasks = ["a", "b", "c", "d", "e", "j"].map((id) => task(id, { judge: id === "j" }));
    const records = grid("m", Object.fromEntries(tasks.map((x) => [x.id, { before: "110", after: "110" }])));
    for (const r of records) if (r.task === "j") r.judge = r.trial === 0 && r.arm === "after" ? "unknown" : "done";
    const m = decide(input(tasks, records)).models[0]!;
    expect(m.not_measurable_tasks.map((x) => x.task)).toEqual(["j"]);
    expect(m.informative).not.toContain("j");
  });

  test("a metric comparison with an unscored failure is blocked, and with a failure_value it runs", () => {
    const tasks = ["a", "b"].map((id) => task(id));
    const records = [...cell("m", "before", "a", "111"), ...cell("m", "after", "a", "11x"), ...cell("m", "before", "b", "111"), ...cell("m", "after", "b", "111")];
    for (const r of records) if (r.termination.kind === "completed") r.metrics = { cost_usd: r.arm === "after" ? 0.3 : 0.5 };
    const cost: MetricSpec = { name: "cost_usd", direction: "lower", min: 0 };
    const run = (metric: MetricSpec) => decide(input(tasks, records), { ...DEFAULT_OPTIONS, metrics: [metric] }).models[0]!.metrics[0]!;
    expect(run(cost).blocked).toContain("no cost_usd value");
    const scored = run({ ...cost, failure_value: 2 });
    expect(scored.blocked).toBeNull();
    expect(scored.delta).toBeCloseTo(((0.3 * 2 + 2) / 3 - 0.5 + (0.3 - 0.5)) / 2, 10);
  });
});
