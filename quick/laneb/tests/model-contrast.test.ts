import { describe, expect, test } from "bun:test";
import type { Trial } from "../analysis/analyze.ts";
import { modelContrasts } from "../analysis/model-contrast.ts";

const trial = (task: string, model: string, arm: string, pass: boolean, extra: Partial<Trial> = {}): Trial => ({
  task, arm, model, trialName: `${task}-${model}-${arm}-${Math.random()}`, outcome: pass ? "pass" : "fail", reason: "", noReward: false,
  modelResponded: true, costUsd: 0, attempts: 1, requests: 1, refused: 0, skillOpens: [], budgetStop: false, agentTimeout: false, wallS: 1, ...extra,
});

describe("model-contrast", () => {
  test("pairs per arm by task, skips tasks one model lacks, and ignores infra trials", () => {
    const trials = [
      trial("t1", "a", "none", true), trial("t1", "a", "none", false), trial("t1", "b", "none", false),
      trial("t2", "a", "none", true), trial("t2", "b", "none", true),
      trial("t3", "a", "none", true),
      trial("t2", "b", "none", false, { outcome: "infra" }),
      trial("t1", "a", "gstack", false), trial("t1", "b", "gstack", true),
    ];
    const rows = modelContrasts(trials, { pairs: [["a", "b"]], arms: ["none", "gstack"], b: 200 });
    const none = rows.find((r) => r.arm === "none")!;
    expect(none.tasks).toBe(2);
    expect(none.a).toBeCloseTo(0.75);
    expect(none.b).toBeCloseTo(0.5);
    expect(none.diff).toBeCloseTo(0.25);
    const gstack = rows.find((r) => r.arm === "gstack")!;
    expect(gstack.tasks).toBe(1);
    expect(gstack.diff).toBeCloseTo(-1);
  });

  test("drop removes paid trials without a reward; zero keeps them", () => {
    const trials = [trial("t1", "a", "none", false, { noReward: true }), trial("t1", "a", "none", true), trial("t1", "b", "none", true)];
    expect(modelContrasts(trials, { pairs: [["a", "b"]], arms: ["none"], b: 50 })[0].diff).toBeCloseTo(-0.5);
    expect(modelContrasts(trials, { pairs: [["a", "b"]], arms: ["none"], b: 50, noReward: "drop" })[0].diff).toBeCloseTo(0);
  });
});
