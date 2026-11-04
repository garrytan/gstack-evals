import { describe, expect, test } from "bun:test";
import { breakEvenGain, costGuard, G3 } from "../../src/runner/stats/outcome-cost.ts";
import type { OutcomeTrial } from "../../src/runner/stats/outcome-decision.ts";

const ARMS = { control: "none", treatment: "told" };
const t = (task: string, arm: string, n: number, solved: boolean, cost: number | null, o: Partial<OutcomeTrial> = {}): OutcomeTrial => ({ task, repo: "repo-" + task, arm, trial: n, status: "scored", solved, truncated: false, cost_usd: cost, exposed: arm === "none" ? null : true, ...o });
/** n identical tasks: each arm runs 2 trials and solves the first. */
const flat = (n: number, none: number, told: number) => Array.from({ length: n }, (_, i) => [t("t" + i, "none", 1, true, none), t("t" + i, "none", 2, false, none), t("t" + i, "told", 1, true, told), t("t" + i, "told", 2, false, told)]).flat();

describe("the cost-per-solved guard, #169's G3", () => {
  test("frozen as #169 froze it: upper bound at most 1.5, 10,000 task resamples, seed 20261102", () => {
    expect(G3).toEqual({ bar: 1.5, bootstrap: { seed: 20261102, draws: 10000 } });
  });

  test("holds when told's cost per solved task is at most 1.5 times none's, and fails above it", () => {
    const ok = costGuard(flat(10, 1, 1.2), ARMS);
    expect(ok.ratio).toBeCloseTo(1.2, 12);
    expect(ok.ci95[0]).toBeCloseTo(1.2, 12);
    expect(ok.ci95[1]).toBeCloseTo(1.2, 12);
    expect(ok.holds).toBe(true);
    expect(ok.session_multiple).toBeCloseTo(1.2, 12);
    expect(costGuard(flat(10, 1, 1.5), ARMS).holds).toBe(true);
    const over = costGuard(flat(10, 1, 1.6), ARMS);
    expect(over.holds).toBe(false);
    expect(over.reason).toContain("above 1.5");
  });

  test("a told arm that solves no task fails; a none arm that solves no task leaves told's ratio unbounded below, so it holds", () => {
    const told0 = flat(5, 1, 1).map((x) => (x.arm === "told" ? { ...x, solved: false } : x));
    const a = costGuard(told0, ARMS);
    expect(a.holds).toBe(false);
    expect(a.ratio).toBeNull();
    expect(a.ci95).toEqual([Infinity, Infinity]);
    const none0 = flat(5, 1, 9).map((x) => (x.arm === "none" ? { ...x, solved: false } : x));
    const b = costGuard(none0, ARMS);
    expect(b.holds).toBe(true);
    expect(b.reason).toContain("unbounded");
  });

  test("the interval is a task-clustered bootstrap, reproducible, around the point ratio", () => {
    const trials = Array.from({ length: 30 }, (_, i) => [t("t" + i, "none", 1, i % 2 === 0, 1 + (i % 5) / 10), t("t" + i, "told", 1, i % 3 !== 0, 1.3 + (i % 7) / 10)]).flat();
    const a = costGuard(trials, ARMS), b = costGuard(trials, ARMS);
    expect(a).toEqual(b);
    expect(a.ci95[0]).toBeLessThan(a.ratio!);
    expect(a.ci95[1]).toBeGreaterThan(a.ratio!);
    expect(a.tasks).toBe(30);
    expect(a.holds).toBe(a.ci95[1] <= 1.5);
  });

  test("counts every scored trial, arm stops included, over the tasks both arms share; gaps and contamination stay out", () => {
    const trials = [...flat(4, 1, 1), t("t0", "told", 3, false, 5, { truncated: true }), t("t1", "told", 4, false, 50, { status: "gap" }), t("t2", "none", 3, true, 50, { status: "contaminated" }), t("solo", "told", 1, true, 1)];
    const g = costGuard(trials, ARMS);
    expect(g.tasks).toBe(4);
    expect(g.treatment.trials).toBe(9);
    expect(g.treatment.cost_usd).toBeCloseTo(13, 12);
    expect(g.control.trials).toBe(8);
  });

  test("a counted trial with no metered cost is refused, not guessed", () => {
    expect(() => costGuard([...flat(3, 1, 1), t("t0", "told", 3, true, null)], ARMS)).toThrow(/metered cost/);
  });

  test("break-even gain is p times (m / 1.5 minus 1), plan v3 section 8's column", () => {
    expect(breakEvenGain(0.5, 2.2)).toBeCloseTo(0.2333, 4);
    expect(breakEvenGain(0.5, 2.4)).toBeCloseTo(0.3, 12);
    expect(breakEvenGain(0.5, 2.5)).toBeCloseTo(0.3333, 4);
    expect(breakEvenGain(0.5, 3.0)).toBeCloseTo(0.5, 12);
    expect(breakEvenGain(0.5, 5.0)).toBeCloseTo(1.1667, 4);
    expect(breakEvenGain(0.5, 2.2 * 1.15)).toBeCloseTo(0.3433, 4);
  });
});
