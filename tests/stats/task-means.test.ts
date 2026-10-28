import { describe, expect, test } from "bun:test";
import { clusteredPairedDelta, holmAdjusted, nonInferiorityP, PairingError, seededRandom } from "../../src/runner/stats/paired.ts";
import { pairTaskMeans, pairTrials, type MissingCellRule, type TrialValue } from "../../src/runner/stats/task-means.ts";

const TASKS = Array.from({ length: 24 }, (_, i) => `t${String(i).padStart(2, "0")}`);
const DROP: MissingCellRule = { min_trials: 1, on_missing: "drop_task" };

// Plan v3.2 Phase 3: Opus none and gstack at 3 trials; Haiku and both open rungs, every arm, at 5 trials.
const rng = seededRandom(20261028);
const difficulty = TASKS.map(() => rng());
const SHIFTS: Record<string, [number, number]> = {
  "opus/none": [3, 0.15], "opus/gstack": [3, 0.2],
  "haiku/none": [5, -0.25], "haiku/placebo": [5, -0.25], "haiku/gstack": [5, 0.1],
  "deepseek/none": [5, -0.3], "deepseek/placebo": [5, -0.3], "deepseek/gstack": [5, 0],
  "glm/none": [5, -0.35], "glm/placebo": [5, -0.35], "glm/gstack": [5, -0.1],
};
const MATRIX: Record<string, TrialValue[]> = Object.fromEntries(Object.entries(SHIFTS).map(([cell, [trials, shift]]) => [
  cell,
  TASKS.flatMap((task, i) => Array.from({ length: trials }, (_, trial) => ({ task, trial, value: rng() < Math.min(1, Math.max(0, difficulty[i]! + shift)) ? 1 : 0 }))),
]));
const CHEAP = ["haiku", "deepseek", "glm"];

const meanOf = (rows: TrialValue[], task: string) => {
  const values = rows.filter((r) => r.task === task && r.value !== null).map((r) => r.value!);
  return values.reduce((s, v) => s + v, 0) / values.length;
};
const handDelta = (a: TrialValue[], b: TrialValue[], tasks = TASKS) => tasks.reduce((s, t) => s + meanOf(b, t) - meanOf(a, t), 0) / tasks.length;
const problems = (run: () => unknown): string[] => {
  try { run(); return []; } catch (error) { expect(error).toBeInstanceOf(PairingError); return (error as PairingError).problems; }
};

describe("fix 2: 5 cheap-rung trials against 3 Opus trials", () => {
  test("trial-level pairing refuses unequal trials; per-task means pair every task", () => {
    const opus = MATRIX["opus/none"]!, haiku = MATRIX["haiku/gstack"]!;
    expect(problems(() => pairTrials(opus, haiku))[0]).toContain("trials differ for t00: A has 3, B has 5");
    const { pairs, dropped } = pairTaskMeans(opus, haiku, DROP, TASKS);
    expect(pairs).toHaveLength(24);
    expect(dropped).toEqual([]);
    expect(pairs[3]).toEqual({ id: "t03", cluster: "t03", a: meanOf(opus, "t03"), b: meanOf(haiku, "t03") });
    const s = clusteredPairedDelta(pairs, { seed: 7, draws: 5000 });
    expect(s.n_pairs).toBe(24);
    expect(s.n_clusters).toBe(24);
    expect(s.delta).toBeCloseTo(handDelta(opus, haiku), 12);
  });

  test("with equal trials and nothing missing, both pairings give the same difference", () => {
    const none = MATRIX["haiku/none"]!, gstack = MATRIX["haiku/gstack"]!;
    const byTrial = clusteredPairedDelta(pairTrials(none, gstack).pairs, { seed: 7, draws: 5000 });
    const byTask = clusteredPairedDelta(pairTaskMeans(none, gstack, DROP, TASKS).pairs, { seed: 7, draws: 5000 });
    expect(byTrial.n_pairs).toBe(120);
    expect(byTask.n_pairs).toBe(24);
    expect(byTask.delta).toBeCloseTo(byTrial.delta, 12);
    expect(byTask.n_clusters).toBe(byTrial.n_clusters);
  });

  test("the Phase 3 matrix: parity per cheap model with Holm, lift and the placebo check per model", () => {
    const parity = CHEAP.map((c) => {
      const s = clusteredPairedDelta(pairTaskMeans(MATRIX["opus/none"]!, MATRIX[`${c}/gstack`]!, DROP, TASKS).pairs, { seed: 7, draws: 5000 });
      return { s, p: nonInferiorityP(s, 0.1, "higher")! };
    });
    const holm = holmAdjusted(parity.map((x) => x.p));
    parity.forEach((x, i) => {
      expect(x.s.n_clusters).toBe(24);
      expect(x.s.delta).toBeCloseTo(handDelta(MATRIX["opus/none"]!, MATRIX[`${CHEAP[i]}/gstack`]!), 12);
      expect(holm[i]!).toBeGreaterThanOrEqual(x.p);
    });
    expect(Math.min(...holm)).toBeCloseTo(Math.min(1, 3 * Math.min(...parity.map((x) => x.p))), 12);
    for (const model of ["opus", ...CHEAP]) {
      for (const other of model === "opus" ? ["none"] : ["none", "placebo"]) {
        const a = MATRIX[`${model}/${other}`]!, b = MATRIX[`${model}/gstack`]!;
        expect(clusteredPairedDelta(pairTaskMeans(a, b, DROP, TASKS).pairs, { seed: 7, draws: 5000 }).delta).toBeCloseTo(handDelta(a, b), 12);
      }
    }
  });

  test("Lane A's pooled rerun (6 after trials against 3 before) gets an exact sign-flip test over 12 tasks", () => {
    const tasks = TASKS.slice(0, 12);
    const before = tasks.flatMap((task) => [0, 1, 2].map((trial) => ({ task, trial, value: 1 })));
    const after = tasks.flatMap((task, i) => [0, 1, 2, 3, 4, 5].map((trial) => ({ task, trial, value: i < 4 && trial % 3 === 0 ? 0 : 1 })));
    const s = clusteredPairedDelta(pairTaskMeans(before, after, DROP, tasks).pairs, { seed: 7, draws: 5000 });
    expect(s.p_method).toBe("exact-sign-flip");
    expect(s.delta).toBeCloseTo(-4 / 12 / 3, 12);
    expect(s.p_less).toBe(1 / 16);
  });
});

describe("the preregistered missing-cell rule", () => {
  const opus = MATRIX["opus/none"]!.map((r) => (r.task === "t07" ? { ...r, value: null } : r));

  test("one missing cell drops its task from the comparisons that use that cell, and only those", () => {
    for (const c of CHEAP) {
      const { pairs, dropped, valid } = pairTaskMeans(opus, MATRIX[`${c}/gstack`]!, DROP, TASKS);
      expect(pairs.map((p) => p.id)).toEqual(TASKS.filter((t) => t !== "t07"));
      expect(dropped).toEqual([{ task: "t07", reason: "valid trials: A 0, below the preregistered minimum of 1" }]);
      expect(valid.a.t07).toBe(0);
      expect(valid.b.t07).toBe(5);
      const s = clusteredPairedDelta(pairs, { seed: 7, draws: 5000 });
      expect(s.delta).toBeCloseTo(handDelta(opus, MATRIX[`${c}/gstack`]!, TASKS.filter((t) => t !== "t07")), 12);
    }
    expect(pairTaskMeans(MATRIX["haiku/none"]!, MATRIX["haiku/gstack"]!, DROP, TASKS).pairs).toHaveLength(24);
  });

  test("refuse blocks the comparison and names the cell", () => {
    expect(problems(() => pairTaskMeans(opus, MATRIX["haiku/gstack"]!, { min_trials: 1, on_missing: "refuse" }, TASKS)))
      .toEqual(["missing cell for t07: valid trials: A 0, below the preregistered minimum of 1"]);
  });

  test("a minimum of 2 valid trials drops a task with 1, and a share cap blocks too many drops", () => {
    const one = MATRIX["opus/none"]!.map((r) => (r.task === "t07" && r.trial > 0 ? { ...r, value: null } : r));
    expect(pairTaskMeans(one, MATRIX["haiku/gstack"]!, { min_trials: 2, on_missing: "drop_task" }, TASKS).dropped)
      .toEqual([{ task: "t07", reason: "valid trials: A 1, below the preregistered minimum of 2" }]);
    expect(problems(() => pairTaskMeans(opus, MATRIX["haiku/gstack"]!, { ...DROP, max_dropped_share: 0.02 }, TASKS)))
      .toEqual(["1 of 24 tasks dropped, above the preregistered share of 0.02"]);
    expect(pairTaskMeans(opus, MATRIX["haiku/gstack"]!, { ...DROP, max_dropped_share: 0.05 }, TASKS).dropped).toHaveLength(1);
  });

  test("a preregistered task with no rows in either arm is a missing cell, not a silent gap", () => {
    const { dropped } = pairTaskMeans(MATRIX["haiku/none"]!, MATRIX["haiku/gstack"]!, DROP, [...TASKS, "t99"]);
    expect(dropped).toEqual([{ task: "t99", reason: "valid trials: A 0, B 0, below the preregistered minimum of 1" }]);
  });

  test("bad rules, duplicate trials and unlisted tasks block the comparison", () => {
    const rows: TrialValue[] = [{ task: "t00", trial: 0, value: 1 }];
    expect(problems(() => pairTaskMeans(rows, rows, { min_trials: 0, on_missing: "drop_task" })))
      .toContain("missing-cell rule: min_trials must be an integer >= 1");
    expect(problems(() => pairTaskMeans(rows, rows, { min_trials: 1, on_missing: "impute" as never })))
      .toContain("missing-cell rule: on_missing must be drop_task or refuse");
    expect(problems(() => pairTaskMeans([...rows, ...rows], rows, DROP))).toContain("A: duplicate trial 0 for t00");
    expect(problems(() => pairTaskMeans(rows, [{ task: "t50", trial: 0, value: 1 }], DROP, ["t00"]))).toContain("B: t50 is not in the task list");
    expect(problems(() => pairTaskMeans(rows, [{ task: "t00", trial: 0, value: Number.NaN }], DROP)))
      .toContain("B: t00 trial 0 has a value that is neither finite nor null");
    expect(problems(() => pairTaskMeans([{ task: "t00", trial: 0, value: null }], rows, DROP)))
      .toEqual(["no task has enough valid trials in both arms"]);
  });
});
