// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10's guardrails G1 to G3 and section 8's missing limits for the office-hours rewrite eval, each on both sides.
import { describe, expect, test } from "bun:test";
import { g1, g2, g3, guardrails, missingLimits } from "../../../lanes/office-hours-rewrite/read/guards.ts";
import { builderRows, founderRows } from "../../../lanes/office-hours-rewrite/read/seams.ts";
import type { ArmId, EndState, ModelId } from "../../../lanes/office-hours-rewrite/types.ts";

describe("G1: a startup-only question in a new-arm builder session, hand-confirmed", () => {
  const rows = builderRows({ leak: ["b03", "b07"], models: ["opus", "sol"] });
  test("detector hits the hand read clears hold", () => {
    const r = g1(rows, [{ brief: "b03", model: "opus", confirmed: false }, { brief: "b03", model: "sol", confirmed: false }, { brief: "b07", model: "opus", confirmed: false }, { brief: "b07", model: "sol", confirmed: false }]);
    expect(r.state).toBe("held");
    expect(r.candidates).toEqual(["b03|opus", "b03|sol", "b07|opus", "b07|sol"]);
    expect(r.confirmed).toEqual([]);
  });
  test("one confirmed hit breaks", () => {
    const r = g1(rows, [{ brief: "b03", model: "opus", confirmed: true }, { brief: "b03", model: "sol", confirmed: false }, { brief: "b07", model: "opus", confirmed: false }, { brief: "b07", model: "sol", confirmed: false }]);
    expect(r.state).toBe("broken");
    expect(r.confirmed).toEqual(["b03|opus"]);
  });
  test("no hit holds with no hand read", () => expect(g1(builderRows({}), []).state).toBe("held"));
  test("a hit with no hand read, or a read of no hit, is refused", () => {
    expect(() => g1(rows, [{ brief: "b03", model: "opus", confirmed: false }])).toThrow(/^E_OHR_READ_INPUT/);
    expect(() => g1(builderRows({}), [{ brief: "b01", model: "opus", confirmed: true }])).toThrow(/^E_OHR_READ_INPUT/);
  });
  test("particle-1 is descriptive: its hit is listed, never breaks", () => {
    const r = g1(builderRows({ leak: ["b03"], models: ["particle"] }), [{ brief: "b03", model: "particle", confirmed: true }]);
    expect(r.state).toBe("held");
    expect(r.descriptive).toEqual(["b03|particle"]);
  });
});

/** Twin a of every cluster carries the traction flag; question and reply counts add the given step on alternate clusters. */
const counts = (extra: number) => (arm: ArmId, j: number) => (arm === "new" ? extra + (Math.floor(j / 2) % 2) : 0);

describe("G2: founder questions on traction briefs, new minus current, lower bound above 1", () => {
  test("two or three more questions breaks", () => {
    const r = g2(founderRows({ traction: (j) => j % 2 === 0, questions: counts(2) }));
    expect(r.estimate.C).toBe(20);
    expect(r.estimate.lo!).toBeGreaterThan(1);
    expect(r.state).toBe("broken");
  });
  test("zero or one more question holds", () => {
    const r = g2(founderRows({ traction: (j) => j % 2 === 0, questions: counts(0) }));
    expect(r.estimate.lo!).toBeLessThanOrEqual(1);
    expect(r.state).toBe("held");
  });
  test("only traction briefs count", () => {
    const r = g2(founderRows({ traction: (j) => j % 2 === 0, questions: (arm, j) => (arm === "new" && j % 2 === 1 ? 9 : 0) }));
    expect([r.estimate.estimate, r.state]).toEqual([0, "held"]);
  });
});

describe("G3: founder replies before closing, new minus current, lower bound above 20% of current's mean", () => {
  test("two or three more replies on a mean of 5 breaks", () => {
    const r = g3(founderRows({ replies: counts(2) }));
    expect(r.current_mean).toBe(5);
    expect(r.threshold).toBeCloseTo(1, 12);
    expect(r.state).toBe("broken");
  });
  test("zero or one more reply holds", () => expect(g3(founderRows({ replies: counts(0) })).state).toBe("held"));
  test("guardrails() breaks when any one breaks", () => {
    const rows = [...founderRows({ replies: counts(2) }), ...builderRows({})];
    expect(guardrails(rows, []).broken).toBe(true);
    expect(guardrails([...founderRows({}), ...builderRows({})], []).broken).toBe(false);
  });
});

describe("section 8's missing limits", () => {
  const drop = (cells: Array<[ArmId, ModelId, number, number?]>, end: EndState = "missing") => (arm: ArmId, j: number, model: ModelId): EndState | undefined =>
    cells.some(([a, m, n, from]) => a === arm && m === model && j >= (from ?? 0) && j < n) ? end : undefined;
  test("founder differences: 8 of 80 missing holds, 9 breaks, with every cell inside its limit", () => {
    const eight: Array<[ArmId, ModelId, number, number?]> = [["new", "opus", 3], ["new", "sol", 3], ["current", "opus", 5, 3]];
    const held = missingLimits(founderRows({ end: drop(eight) }));
    expect([held.founder_differences.missing, held.founder_differences.total, held.founder_differences.state, held.cells_state]).toEqual([8, 80, "held", "held"]);
    const broken = missingLimits(founderRows({ end: drop([...eight, ["current", "sol", 40, 39]]) }));
    expect([broken.founder_differences.missing, broken.founder_differences.state, broken.cells_state, broken.broken]).toEqual([9, "broken", "held", true]);
  });
  test("an arm-and-model cell: 4 of 40 holds, 5 breaks", () => {
    expect(missingLimits(founderRows({ end: drop([["none", "opus", 4]]) })).cells_state).toBe("held");
    const r = missingLimits(founderRows({ end: drop([["none", "opus", 5]]) }));
    expect([r.cells_state, r.founder_differences.state, r.broken]).toEqual(["broken", "held", true]);
    expect(r.cells.find((c) => c.arm === "none" && c.model === "opus")!.share).toBe(0.125);
  });
  test("none-arm contamination: 1 of 80 holds, 2 break", () => {
    const one = missingLimits(founderRows({ end: drop([["none", "opus", 1]], "contaminated") }));
    expect([one.contamination.contaminated, one.contamination.sessions, one.contamination.state, one.broken]).toEqual([1, 80, "held", false]);
    const two = missingLimits(founderRows({ end: drop([["none", "opus", 2]], "contaminated") }));
    expect([two.contamination.state, two.cells_state, two.broken]).toEqual(["broken", "held", true]);
  });
  test("particle-1's cells are reported and decide nothing", () => {
    const r = missingLimits(founderRows({ end: drop([["new", "particle", 40]]) }));
    expect(r.broken).toBe(false);
    expect(r.cells.find((c) => c.model === "particle" && c.arm === "new")!.share).toBe(1);
  });
});
