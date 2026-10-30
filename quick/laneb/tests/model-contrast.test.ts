import { describe, expect, test } from "bun:test";
import type { Trial } from "../analysis/analyze.ts";
import { cellTable, gapTable, modelContrasts, referenceContrasts, report, tokensByTrial } from "../analysis/model-contrast.ts";

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

describe("model-contrast reference, cells and gap", () => {
  const T = (task: string, model: string, arm: string, pass: boolean, extra: Partial<Trial> = {}) => trial(task, model, arm, pass, extra);
  const trials = [
    T("t1", "opus", "none", true), T("t2", "opus", "none", true), T("t3", "opus", "none", false),
    T("t1", "c", "none", false), T("t2", "c", "none", false), T("t3", "c", "none", false),
    T("t1", "c", "gstack", true, { costUsd: 0.5, wallS: 120, trialName: "x1" }), T("t2", "c", "gstack", false, { costUsd: 0.5, wallS: 360, trialName: "x2" }), T("t3", "c", "gstack", false, { costUsd: 1, wallS: 600, trialName: "x3" }),
  ];
  test("every cell against the reference, skipping the reference itself and absent cells", () => {
    const rows = referenceContrasts(trials, { models: ["c", "opus"], arms: ["none", "gstack", "placebo"], reference: ["opus", "none"], b: 200 });
    expect(rows.map((r) => r.contrast)).toEqual(["c none - opus none", "c gstack - opus none"]);
    expect(rows[0].diff).toBeCloseTo(-2 / 3);
    expect(rows[1].diff).toBeCloseTo(-1 / 3);
  });
  test("cell table: cost per success, median tokens and median wall minutes", () => {
    const tokens = tokensByTrial([
      { id: "s1", trial: "x1__env", spent_micros: 0, ok_responses: 1, requests: 1, refused: 0, refused_budget: 0, opened_at: "1", usage: { input_tokens: 10, output_tokens: 5 } },
      { id: "s2", trial: "x2__env", spent_micros: 0, ok_responses: 1, requests: 1, refused: 0, refused_budget: 0, opened_at: "1", usage: { input_tokens: 100, cache_read_input_tokens: 50 } },
      { id: "s3", trial: "x3__env", spent_micros: 0, ok_responses: 1, requests: 1, refused: 0, refused_budget: 0, opened_at: "1", usage: { output_tokens: 1000 } },
    ] as any);
    const c = cellTable(trials, tokens, { models: ["c"], arms: ["gstack", "placebo"], b: 200 });
    expect(c.length).toBe(1);
    expect(c[0].costPerSuccess).toBeCloseTo(2);
    expect(c[0].medianTokens).toBe(150);
    expect(c[0].medianWallMin).toBeCloseTo(6);
  });
  test("gap share with its denominator, unstable when the denominator interval reaches zero", () => {
    const [g] = gapTable(trials, { models: ["opus", "c"], reference: "opus", b: 500 });
    expect(g.model).toBe("c");
    expect(g.share).toBeCloseTo(0.5);
    expect(g.denom).toBeCloseTo(2 / 3);
    expect(g.unstable).toBe(true);
    expect(report(trials, new Map(), { models: ["opus", "c"], arms: ["none", "gstack"], reference_cell: ["opus", "none"], b: 100 })).toContain("unstable");
  });
});
