import { describe, expect, test } from "bun:test";
import { planStage } from "../src/plan.ts";

const tasks = [{ id: "a", prompt: "x" }, { id: "b", prompt: "y" }];

describe("planStage", () => {
  test("trial-major order with every arm of a block together, so a cap stop leaves complete trials", () => {
    const cells = planStage("S1", tasks, [1, 2, 3]);
    expect(cells.length).toBe(3 * 2 * 2 * 3);
    const trials = cells.map((c) => c.trial);
    expect(trials).toEqual([...trials].sort());
    expect(cells.slice(0, 6).map((c) => c.model)).toEqual(Array(6).fill("claude-haiku-5-5"));
    expect(cells.slice(6, 12).map((c) => c.model)).toEqual(Array(6).fill("claude-opus-5-5"));
    for (let i = 0; i < cells.length; i += 3) expect(new Set(cells.slice(i, i + 3).map((c) => c.arm))).toEqual(new Set(["before", "after", "none"]));
  });
  test("arm order is seeded, so a rerun plans the same sequence", () => {
    expect(planStage("S1", tasks, [1]).map((c) => c.arm)).toEqual(planStage("S1", tasks, [1]).map((c) => c.arm));
  });
  test("stages pin their arms and models", () => {
    expect(new Set(planStage("S0", tasks, [1]).map((c) => c.model))).toEqual(new Set(["claude-haiku-5-5"]));
    expect(new Set(planStage("S2", tasks, [1]).map((c) => c.arm))).toEqual(new Set(["before2"]));
    expect(new Set(planStage("S3", tasks, [1]).map((c) => c.model))).toEqual(new Set(["claude-opus-5-5"]));
    expect(planStage("S3", tasks, [1]).length).toBe(8);
  });
});
