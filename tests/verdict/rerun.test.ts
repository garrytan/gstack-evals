import { describe, expect, test } from "bun:test";
import { clusteredPairedDelta, seededRandom } from "../../src/runner/stats/paired.ts";
import { decide, DEFAULT_OPTIONS, rerunPlan, VerdictInputError } from "../../src/skill-eval/verdict/gates.ts";
import { scaledDiffs, signFlipPLess, simulateFalseNegativeRate } from "../../src/skill-eval/verdict/rerun.ts";
import { grid, input, task } from "./helpers.ts";

const tasks = ["a", "b", "c", "d", "e"].map((id) => task(id));
const base = { b: { before: "111", after: "111", none: "000" }, c: { before: "110", after: "101", none: "000" }, d: { before: "011", after: "011", none: "000" }, e: { before: "111", after: "110", none: "000" } };

describe("the same-tree rerun stage", () => {
  test("a red task calls for the rerun; a safety break alone does not, since no rerun clears it", () => {
    expect(rerunPlan(input(tasks, grid("opus", { ...base, a: { before: "111", after: "100", none: "000" } })))).toEqual([{ model: "opus", red: ["a"] }]);
    const safety = [task("a", { safety: true }), ...tasks.slice(1)];
    expect(rerunPlan(input(safety, grid("opus", { ...base, a: { before: "111", after: "110", none: "000" } })))).toEqual([]);
  });

  test("the decision pools both rounds, so a second round can clear a red task", () => {
    const first = grid("opus", { ...base, a: { before: "111", after: "100", none: "000" } });
    const second = grid("opus", { ...base, a: { before: "111", after: "111", none: "000" } }, 2);
    const d = decide(input(tasks, [...first, ...second]));
    expect(d.models[0]!.rerun).toMatchObject({ name: "same-tree-rerun", red: ["a"], state: "done", flaky: [] });
    expect(d.models[0]!.outcomes.a!.after).toEqual([true, false, false, true, true, true]);
    expect(d.exit_code).toBe(0);
  });

  test("a second round can also find a loss, and a missing second round leaves the first round's loss standing", () => {
    const first = grid("opus", { ...base, a: { before: "111", after: "100", none: "000" } });
    const worse = grid("opus", { ...base, a: { before: "111", after: "000", none: "000" }, b: { before: "111", after: "000", none: "000" } }, 2);
    expect(decide(input(tasks, [...first, ...worse])).reasons).toContain("REGRESSION b");
    const lone = decide(input(tasks, first));
    expect(lone.models[0]!.rerun.state).toBe("missing");
    expect(lone.reasons).toContain("REGRESSION a");
  });

  test("a partial second round can add losses but clears none of round 1's", () => {
    const first = grid("opus", { ...base, a: { before: "111", after: "100", none: "000" } });
    const partial = grid("opus", { a: { after: "111" } }, 2);
    const d = decide(input(tasks, [...first, ...partial]));
    expect(d.models[0]!.rerun.state).toBe("partial");
    expect(d.reasons).toContain("REGRESSION a");
    expect(d.exit_code).toBe(1);
  });

  test("FLAKY is recorded only when the old copies also disagree with themselves across rounds", () => {
    const first = grid("opus", { ...base, a: { before: "111", after: "100", none: "000" } });
    const steady = grid("opus", { ...base, a: { before: "111", after: "111", none: "000" } }, 2);
    const shaky = grid("opus", { ...base, a: { before: "100", after: "111", none: "000" } }, 2);
    expect(decide(input(tasks, [...first, ...steady])).warnings).not.toContain("FLAKY a");
    expect(decide(input(tasks, [...first, ...shaky])).warnings).toContain("FLAKY a");
  });

  test("round 2 records without a red task in round 1 are refused, since no trials are added after a result", () => {
    const records = [...grid("opus", base), ...grid("opus", base, 2)];
    expect(() => decide(input(tasks.slice(1), records))).toThrow(VerdictInputError);
  });
});

describe("the two-stage false-negative simulation", () => {
  test("its exact sign-flip count equals clusteredPairedDelta's p_less", () => {
    const rng = seededRandom(5);
    for (let i = 0; i < 40; i++) {
      const counts = Array.from({ length: 3 + (i % 10) }, (_, t) => {
        const ko = Math.floor(rng() * 7), ka = Math.floor(rng() * 4);
        return { id: "t" + t, safety: false, before: { k: 0, n: 0 }, old: { k: ko, n: 6 }, after: { k: ka, n: 3 }, all: { k: ko + ka, n: 9 } };
      });
      const pairs = counts.map((c) => ({ id: c.id, cluster: c.id, a: c.old.k / 6, b: c.after.k / 3 }));
      if (pairs.every((p) => p.a === p.b)) continue;
      expect(signFlipPLess(scaledDiffs(counts))).toBeCloseTo(clusteredPairedDelta(pairs, { seed: 1, draws: 1000 }).p_less, 12);
    }
  });

  test("it is seeded, misses every run with no loss to find, and misses none when after breaks everything", () => {
    const sim = (loss: number) => simulateFalseNegativeRate({ tasks: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, safety: false, old_rate: 1 })), trials: { before: 3, before2: 3, after: 3 }, loss, simulations: 300, seed: 9 });
    expect(sim(0)).toBe(1);
    expect(sim(1)).toBe(0);
    const partial = (seed: number) => simulateFalseNegativeRate({ tasks: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, safety: false, old_rate: 0.8 })), trials: { before: 3, before2: 3, after: 3 }, loss: 0.2, simulations: 300, seed });
    expect(partial(9)).toBe(partial(9));
    expect(partial(9)).toBeGreaterThan(0);
    expect(partial(9)).toBeLessThan(1);
  });

  test("the verdict prints the rate at the run's minimum detectable difference", () => {
    const d = decide(input(tasks, grid("opus", { ...base, a: { before: "110", after: "011", none: "000" } })), { ...DEFAULT_OPTIONS, simulations: 300 });
    const m = d.models[0]!;
    expect(m.rerun.simulated_false_negative_rate).toMatchObject({ mdd_points: m.smallest_detectable_loss.mdd_points, simulations: 300, seed: DEFAULT_OPTIONS.seed });
  });
});
