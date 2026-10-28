import { describe, expect, test } from "bun:test";
import {
  coveredSd, DECISION_9_DESIGNS, type Decision9Design, decision9Table, exactTasks, minimumDetectable, PARITY_EFFECT, parityDesign, RELEASE_OPTIONS,
  releaseSplitTable, requiredTasks, taskDiffSd,
} from "../../src/runner/stats/sizing.ts";

const [three, one, one80] = DECISION_9_DESIGNS;
const tasks = (sd: number, design: Decision9Design = three, alpha = 0.05) => exactTasks(sd, PARITY_EFFECT, parityDesign(design, alpha));

// The plan prints each count rounded to the nearest task. requiredTasks rounds up, so it is the printed count or one more.
function expectPlanCount(exact: number, printed: number) {
  expect(Math.round(exact)).toBe(printed);
  expect(Math.ceil(exact) - printed).toBeOneOf([0, 1]);
}

describe("plan v3.2 decision 9 table", () => {
  const SDS = [0.2, 0.3, 0.33, 0.38, 0.42];
  const PLAN: Array<[Decision9Design, number[], string]> = [
    [three, [95, 214, 258, 343, 419], "0.30"],
    [one, [70, 157, 190, 252, 308], "0.35"],
    [one80, [50, 114, 137, 182, 223], "0.41"],
  ];

  test("every printed count, and the SD that 213 tasks cover", () => {
    for (const [design, counts, covered] of PLAN) {
      SDS.forEach((sd, i) => expectPlanCount(tasks(sd, design), counts[i]!));
      expect(coveredSd(213, PARITY_EFFECT, parityDesign(design)).toFixed(2)).toBe(covered);
    }
  });

  test("the rendered table rounds up", () => {
    const lines = decision9Table().split("\n");
    expect(lines[0]).toBe("| Design | SD 0.2 | SD 0.3 | SD 0.33 | SD 0.38 | SD 0.42 | SD that 213 tasks cover |");
    expect(lines[2]).toBe("| Three cheap models, Holm, 90% power: the current design | 95 | 214 | 259 | 343 | 419 | 0.30 |");
    expect(lines[3]).toBe("| One preregistered primary cheap model, 90% power | 70 | 158 | 191 | 253 | 309 | 0.35 |");
    expect(lines[4]).toBe("| One primary cheap model, 80% power | 51 | 114 | 138 | 183 | 223 | 0.41 |");
  });

  test("the plan's other sizing sentences", () => {
    expectPlanCount(tasks(0.3, one80), 114);
    expect((PARITY_EFFECT / 0.02) ** 2).toBeCloseTo(12.25, 12);
    expect(exactTasks(0.3, 0.02, parityDesign(three)) / tasks(0.3)).toBeCloseTo(12.25, 9);
  });
});

describe("Amendment A2 release-split table", () => {
  const PLAN: Record<string, Array<[number, number]>> = {
    "v3.2": [[214, 343], [157, 252], [114, 182]],
    A: [[239, 384], [184, 295], [136, 218]],
    B: [[214, 343], [157, 252], [114, 182]],
    C: [[282, 453], [228, 366], [175, 280]],
    "C-steer": [[346, 555], [293, 470], [232, 372]],
  };

  test("every row, at SD 0.30 and 0.38, for all three designs", () => {
    expect(RELEASE_OPTIONS.map((o): string => o.id)).toEqual(Object.keys(PLAN));
    for (const option of RELEASE_OPTIONS) {
      DECISION_9_DESIGNS.forEach((design, i) => {
        const [at30, at38] = PLAN[option.id]![i]!;
        expectPlanCount(tasks(0.3, design, option.parity_alpha), at30);
        expectPlanCount(tasks(0.38, design, option.parity_alpha), at38);
      });
    }
  });

  test("the SD that 213 tasks cover under option C, and the release factors", () => {
    const c = RELEASE_OPTIONS.find((o) => o.id === "C")!, steer = RELEASE_OPTIONS.find((o) => o.id === "C-steer")!;
    expect(DECISION_9_DESIGNS.map((d) => coveredSd(213, PARITY_EFFECT, parityDesign(d, c.parity_alpha)).toFixed(2))).toEqual(["0.26", "0.29", "0.33"]);
    [0.2, 0.3, 0.38].forEach((sd, i) => {
      expectPlanCount(tasks(sd, three, c.parity_alpha), [125, 282, 453][i]!);
      expectPlanCount(tasks(sd, three, steer.parity_alpha), [154, 346, 555][i]!);
    });
    expect(tasks(0.3, three, c.parity_alpha) / tasks(0.3)).toBeCloseTo(1.32, 2);
    expect(tasks(0.3, three, steer.parity_alpha) / tasks(0.3)).toBeCloseTo(1.62, 2);
  });

  test("the rendered table", () => {
    const lines = releaseSplitTable().split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[2]).toBe("| v3.2 as written (parity takes the whole alpha at one release) | 214 / 343 | 158 / 253 | 114 / 183 |");
    expect(lines[4]).toContain("| 214 / 343 for the tranche, plus the tasks the other releases use |");
    expect(lines[5]).toBe("| C. Mint more: four frozen releases at 0.0125 each | 283 / 453 | 228 / 366 | 175 / 281 |");
  });
});

describe("sizing arithmetic", () => {
  test("required tasks, covered SD and the minimum detectable difference agree", () => {
    const design = parityDesign(three);
    expect(requiredTasks(0.3, PARITY_EFFECT, design)).toBe(214);
    expect(minimumDetectable(exactTasks(0.3, PARITY_EFFECT, design), 0.3, design)).toBeCloseTo(PARITY_EFFECT, 12);
    expect(minimumDetectable(213, 0.3, design)).toBeCloseTo(0.0701, 4);
    expect(coveredSd(exactTasks(0.3, PARITY_EFFECT, design), PARITY_EFFECT, design)).toBeCloseTo(0.3, 12);
  });

  test("per-task SD adds the between-task variance and each arm's binomial variance", () => {
    expect(taskDiffSd(0, [{ rate: 0.5, trials: 5 }, { rate: 0.5, trials: 3 }])).toBeCloseTo(Math.sqrt(0.25 / 5 + 0.25 / 3), 12);
    expect(taskDiffSd(0.2, [{ rate: 0.3, trials: 5 }, { rate: 0.6, trials: 3 }])).toBeCloseTo(Math.sqrt(0.04 + 0.21 / 5 + 0.24 / 3), 12);
    expect(taskDiffSd(0.25, [])).toBe(0.25);
  });

  test("bad inputs throw", () => {
    expect(() => exactTasks(0, PARITY_EFFECT, parityDesign(three))).toThrow("sd");
    expect(() => exactTasks(0.3, PARITY_EFFECT, { alpha: 0.6, power: 0.9 })).toThrow("alpha");
    expect(() => exactTasks(0.3, PARITY_EFFECT, { alpha: 0.05, power: 1 })).toThrow("power");
    expect(() => taskDiffSd(0, [{ rate: 1.2, trials: 3 }])).toThrow("rate");
    expect(() => taskDiffSd(0, [{ rate: 0.5, trials: 0 }])).toThrow("trials");
  });
});
