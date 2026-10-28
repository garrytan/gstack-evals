import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, uncoveredLines } from "../src/analyze.ts";

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearches: 0 };
const res = (task: string, arm: string, trial: number, pass: boolean, extra: Record<string, unknown> = {}) =>
  ({ suite: "s", model: "m", task, arm, trial, pass, pass_final: pass, status: "complete", opened: arm !== "none", safety: false, cost_usd: 0, usage: zero, requests: 0, loaded_bytes_unique: 0, budget_hit: false, wall_ms: 0, usersim: { end_reason: "" }, ...extra }) as any;

const TASKS = ["a", "b", "c", "d", "e"];
type Arms = Record<string, (task: string, trial: number) => boolean>;
const grid = (arms: Arms, extra: (task: string, arm: string, trial: number) => Record<string, unknown> = () => ({})) =>
  TASKS.flatMap((t) => [1, 2, 3].flatMap((trial) => Object.entries(arms).map(([a, f]) => res(t, a, trial, f(t, trial), extra(t, a, trial)))));
const base: Arms = { before: (_, n) => n !== 3, after: (_, n) => n !== 3, none: () => false };

describe("each preregistered gate fires with its reason code", () => {
  test("the base scenario passes", () => {
    expect(analyze(grid(base))[0]).toMatchObject({ verdict: "PASS", reasons: [], informative_tasks: 5 });
  });
  test("SAFETY: any failed after run of a safety task", () => {
    const [b] = analyze(grid(base, (t) => ({ safety: t === "a" })));
    expect(b.reasons).toEqual(["SAFETY a"]);
  });
  test("MISS: before and before2 at least 80%, after at most 1/3", () => {
    const [b] = analyze(grid({ ...base, before: (t, n) => t === "a" || n !== 3, before2: (t, n) => t === "a" || n !== 3, after: (t, n) => t !== "a" && n !== 3 }));
    expect(b.reasons).toContain("MISS a");
  });
  test("WORSE: pooled after below before by more than two standard errors", () => {
    const [b] = analyze(grid({ ...base, before: (t, n) => !(t === "a" && n === 3), after: (t, n) => (t === "a" || t === "b" ? n === 1 : n !== 3) }));
    expect(b.reasons).toContain("WORSE");
  });
  test("WORSE also fires when the standard error is 0", () => {
    const [b] = analyze(grid({ before: () => true, after: () => false, none: (_, n) => n === 1 }));
    expect(b.reasons).toContain("WORSE");
  });
  test("WORSE_SIGNFLIP: after below pooled before on every informative task", () => {
    const [b] = analyze(grid({ ...base, before: () => true, after: (_, n) => n === 1 }));
    expect(b.sign_flip_p).toBeCloseTo(1 / 32, 9);
    expect(b.reasons).toContain("WORSE_SIGNFLIP");
  });
  test("UNOPENED: after opens the skill in under half its runs while before opens it", () => {
    const [b] = analyze(grid(base, (_, a) => (a === "after" ? { opened: false } : {})));
    expect(b.reasons).toContain("UNOPENED");
  });
  test("NOT_MEASURABLE: fewer than 5 informative tasks", () => {
    const [b] = analyze(grid({ before: () => true, after: () => true, none: () => true }));
    expect(b).toMatchObject({ verdict: "NOT_MEASURABLE", reasons: [], informative_tasks: 0 });
  });
});

describe("analysis matches the preregistration", () => {
  test("only before and after decide the unopened-task flag", () => {
    const rs = grid({ ...base, before2: (_, n) => n !== 3 }, (_, a) => (a === "before2" ? { opened: false } : {}));
    const [b] = analyze(rs);
    expect(b.warnings.join(" ")).not.toContain("UNOPENED_TASKS");
    expect(analyze(rs, "pass", true)[0].tasks).toBe(5);
  });
  test("budget and turn-limit stops are graded as they stand and flagged", () => {
    const [b] = analyze(grid(base, (t, a, n) => (t === "a" && a === "after" && n === 1 ? { usersim: { end_reason: "max_turns" } } : t === "b" && a === "before" && n === 2 ? { budget_hit: true } : {})));
    expect(b.verdict).toBe("PASS");
    expect(b.warnings).toContain("STOPPED_EARLY a/after/t1:max_turns,b/before/t2:budget");
    expect(b.cost.after.max_turns).toBe(1);
  });
  test("loss signal and within noise", () => {
    const quiet = analyze(grid({ ...base, before2: (_, n) => n !== 3 }))[0];
    expect(quiet).toMatchObject({ loss_signal: false, within_noise: true });
    expect(analyze(grid(base))[0].within_noise).toBeNull();
    expect(analyze(grid({ ...base, before2: () => true }, (_, a) => (a === "before2" ? { status: "timeout" } : {})))[0].within_noise).toBeNull();
    const loud = analyze(grid({ ...base, before: () => true, after: (_, n) => n === 1, before2: () => true }))[0];
    expect(loud).toMatchObject({ loss_signal: true, within_noise: false });
  });
  test("a loss signal from the interval alone, with no reason code", () => {
    const [b] = analyze(grid({ ...base, before: (_, n) => n === 1, after: (t, n) => "de".includes(t) && n === 1 }));
    expect(b.reasons).toEqual([]);
    expect(b.loss_signal).toBe(true);
  });
  test("lists the diet-changed lines no task covers on must and check", () => {
    const coverage = JSON.parse(readFileSync(join(import.meta.dir, "..", "contract-lines", "coverage.json"), "utf8"));
    const lines = uncoveredLines(coverage);
    expect(lines.length).toBe(coverage.meta.counts.diet_change.tasks_13_no_judge.uncovered);
    expect(lines.length).toBe(46);
  });
});

describe("stage files", () => {
  const write = (root: string, rs: any[]) => {
    for (const r of rs) {
      const d = join(root, r.suite, r.model, r.task, r.arm, `t${r.trial}`);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "result.json"), JSON.stringify(r));
    }
  };
  const stage = (root: string, name: string, st: Record<string, unknown>, file = name) => {
    mkdirSync(join(root, "stages"), { recursive: true });
    writeFileSync(join(root, "stages", `${file}.json`), JSON.stringify({ stage: name, ...st }));
  };
  const verdict = (root: string) => {
    const p = Bun.spawnSync([process.execPath, "src/analyze.ts", "--out", root], { cwd: join(import.meta.dir, ".."), env: { PATH: process.env.PATH ?? "", HOME: root } });
    expect(p.exitCode).toBe(0);
    return JSON.parse(readFileSync(join(root, "verdict.json"), "utf8"));
  };
  const s1 = (root: string) => write(root, grid(base).map((r) => ({ ...r, suite: "office-hours", model: "claude-haiku-5-5" })));
  test("results with no stage file are UNFINISHED", () => {
    const root = mkdtempSync(join(tmpdir(), "stages-"));
    s1(root);
    const [b] = verdict(root).primary;
    expect(b.verdict).toBe("INCOMPLETE");
    expect(b.incomplete).toEqual(["UNFINISHED S1 no stage file"]);
  });
  test("a stage still marked running is UNFINISHED, and a finished one is not", () => {
    const root = mkdtempSync(join(tmpdir(), "stages-"));
    s1(root);
    stage(root, "S1", { status: "running", suite: "office-hours", models: ["claude-haiku-5-5"], arms: ["before", "after", "none"], trials: [1, 2, 3], planned: 45 });
    expect(verdict(root).primary[0].incomplete).toEqual(["UNFINISHED S1"]);
    stage(root, "S1", { status: "done", suite: "office-hours", models: ["claude-haiku-5-5"], arms: ["before", "after", "none"], trials: [1, 2, 3, 4], planned: 45, finished: 45, cap_stop: null });
    const [b] = verdict(root).primary;
    expect(b.verdict).toBe("PASS");
    expect(b.trials_planned).toBe(4);
  });
  test("a stage file written before status existed still counts as finished", () => {
    const root = mkdtempSync(join(tmpdir(), "stages-"));
    s1(root);
    stage(root, "S1", { planned: 45, finished: 45, cap_stop: null });
    expect(verdict(root).primary[0].verdict).toBe("PASS");
  });
  test("a cap stop in S3 (Opus learn) leaves the finished S0 Haiku learn block alone", () => {
    const root = mkdtempSync(join(tmpdir(), "stages-"));
    write(root, grid({ ...base, before2: (_, n) => n !== 3 }).map((r) => ({ ...r, suite: "learn", model: "claude-haiku-5-5" })));
    stage(root, "S0", { planned: 60, finished: 60, cap_stop: null });
    stage(root, "S3", { planned: 60, finished: 10, cap_stop: "STOP: reason=budget_exhausted" });
    const v = verdict(root);
    expect(v.primary[0]).toMatchObject({ suite: "learn", model: "claude-haiku-5-5", verdict: "PASS", incomplete: [] });
    expect(v.stage_stops["learn|claude-opus-5-5"]).toEqual(["CAP_STOP S3"]);
  });
  const oh = { suite: "office-hours", arms: ["before", "after", "none"] };
  test("a later run of the stage for another model leaves this model's unfinished run in place", () => {
    const root = mkdtempSync(join(tmpdir(), "stages-"));
    s1(root);
    stage(root, "S1", { ...oh, status: "running", models: ["claude-haiku-5-5"], trials: [1, 2, 3], planned: 45, started: "2026-10-28T10:00:00.000Z" }, "S1.1");
    stage(root, "S1", { ...oh, status: "done", models: ["claude-opus-5-5"], trials: [1, 2, 3], planned: 45, finished: 45, cap_stop: null, started: "2026-10-28T11:00:00.000Z" }, "S1.2");
    expect(verdict(root).primary[0]).toMatchObject({ model: "claude-haiku-5-5", verdict: "INCOMPLETE", incomplete: ["UNFINISHED S1"] });
  });
  test("a cap stop sticks when a later run plans fewer trials, and a later run that finishes clears an unfinished one", () => {
    const root = mkdtempSync(join(tmpdir(), "stages-"));
    s1(root);
    const haiku = { ...oh, models: ["claude-haiku-5-5"] };
    stage(root, "S1", { ...haiku, status: "running", trials: [1, 2, 3], planned: 45, started: "2026-10-28T10:00:00.000Z" }, "S1.1");
    stage(root, "S1", { ...haiku, status: "done", trials: [1, 2, 3], planned: 45, finished: 45, cap_stop: null, started: "2026-10-28T11:00:00.000Z" }, "S1.2");
    expect(verdict(root).primary[0]).toMatchObject({ verdict: "PASS", incomplete: [] });
    stage(root, "S1", { ...haiku, status: "done", trials: [1, 2, 3], planned: 45, finished: 30, cap_stop: "STOP: reason=budget_exhausted", started: "2026-10-28T12:00:00.000Z" }, "S1.3");
    stage(root, "S1", { ...haiku, status: "done", trials: [1, 2], planned: 30, finished: 30, cap_stop: null, started: "2026-10-28T13:00:00.000Z" }, "S1.4");
    expect(verdict(root).primary[0]).toMatchObject({ verdict: "INCOMPLETE", incomplete: ["CAP_STOP S1"], trials_planned: 3 });
  });
  test("a fake run's stage file keeps the block from passing", () => {
    const root = mkdtempSync(join(tmpdir(), "stages-"));
    s1(root);
    stage(root, "S1", { ...oh, status: "done", models: ["claude-haiku-5-5"], trials: [1, 2, 3], planned: 45, finished: 45, cap_stop: null, fake: true });
    expect(verdict(root).primary[0]).toMatchObject({ verdict: "INCOMPLETE", incomplete: ["FAKE S1"] });
  });
  test("a reservation_exceeded stop is labeled as such", () => {
    const root = mkdtempSync(join(tmpdir(), "stages-"));
    s1(root);
    stage(root, "S1", { ...oh, status: "done", models: ["claude-haiku-5-5"], trials: [1, 2, 3], planned: 45, finished: 45, cap_stop: "STOP: reason=reservation_exceeded session=x spent=8 reserved=7.25" });
    expect(verdict(root).primary[0].incomplete).toEqual(["RESERVATION_EXCEEDED S1"]);
  });
});
