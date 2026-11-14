// Copyright (c) 2026 Garry Tan. MIT License.
// Pairwise tasks, the stock block's flag and the arm-guess probe.
import { describe, expect, test } from "bun:test";
import { makeRow } from "../../../lanes/design-constructed/score/fixtures.ts";
import { armGuess, armGuessSample, pairwiseSummary, pairwiseTasks, runPairwise } from "../../../lanes/design-constructed/score/pairwise.ts";

const rows = ["none", "lens", "plan-design-review", "autoplan"].flatMap((kind) => [makeRow("u1", kind as "none", ["change " + kind], { stage: 2, session: "u1:" + kind }), makeRow("u1", kind as "none", ["change " + kind], { stage: 2, model: "particle", session: "p:" + kind })]);

describe("pairwise", () => {
  test("each gstack arm against none and the lens, and both stock blocks against none, on Opus and Sol only", () => {
    const t = pairwiseTasks(rows);
    expect(t.map((x) => x.x.side + ">" + x.y.side)).toEqual(["plan-design-review>none", "plan-design-review>lens", "autoplan>none", "autoplan>lens", "stock-1>none", "stock-2>none"]);
    expect(t.every((x) => x.model === "opus")).toBe(true);
  });
  test("the answer maps back through the shown order", async () => {
    const task = pairwiseTasks(rows)[0]!;
    const call = async () => ({ text: '{"better": "A", "why": "w"}', modelId: "m", version: null, problem: null });
    const r = await runPairwise(task, { plan: "p", context: "c" }, call);
    expect(r.winner).toBe(task.aIs);
    const summary = pairwiseSummary([r]);
    expect(summary.rows[0]!.winRate).toBe(task.aIs === "x" ? 1 : 0);
  });
});

describe("arm guess", () => {
  test("samples Opus lists only and reads the share correct", async () => {
    const sample = armGuessSample(rows);
    expect(sample.every((r) => r.model === "opus")).toBe(true);
    const call = async (c: { prompt: string }) => ({ text: '{"arm": "' + (c.prompt.includes("change none") ? "none" : "lens") + '"}', modelId: "m", version: null, problem: null });
    const g = await armGuess(sample, call as never);
    expect(g.correct).toBe(2);
    expect(g.rate).toBe(0.5);
    expect(g.flag).toBe(false);
  });
});
