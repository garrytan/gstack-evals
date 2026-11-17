// Copyright (c) 2026 Garry Tan. MIT License.
// Authoring (section 3): the refusals, the rewrite and re-ask rules, what each prompt shows, the seeded order and draw.
import { describe, expect, test } from "bun:test";
import { authorCalls, drawSets, hintAuditPrompt, hintRefusal, hintWriterPrompt, planAuditPrompt, planRefusal, planWriterPrompt, raterPrompt, replaceLost, seededOrder, type Authored } from "../../../lanes/eng-planted/stages/author.ts";
import { codeOf, MATERIAL, scriptedCalls } from "../../../lanes/eng-planted/stages/cases.ts";

const plan = (n: number) => "# Plan\n\n" + Array.from({ length: n }, () => "w").join(" ");

describe("refusals", () => {
  test("a plan stands at 200 to 500 words, silent at the condition, with signatures only", () => {
    const ok = { condition: "SILENT" as const, code: "SIGNATURES" as const };
    expect(planRefusal(plan(250), ok)).toBeNull();
    expect(planRefusal(plan(197), ok)).toMatch(/words/);
    expect(planRefusal(plan(510), ok)).toMatch(/words/);
    expect(planRefusal(plan(250), { condition: "BOTH", code: "SIGNATURES" })).toMatch(/BOTH/);
    expect(planRefusal(plan(250), { condition: "SILENT", code: "MORE" })).toMatch(/code/);
    expect(planRefusal(plan(250), null)).toMatch(/CONDITION/);
  });
  test("a hint is one clean sentence of 5 to 80 words", () => {
    expect(hintRefusal("Parse must accept the two bounds in either order.", "CLEAN")).toBeNull();
    expect(hintRefusal("Too short.", "CLEAN")).toMatch(/words/);
    expect(hintRefusal("Parse must accept the bounds in either order\nand more.", "CLEAN")).toMatch(/one line/);
    expect(hintRefusal("Parse must accept the two bounds in either order", "CLEAN")).toMatch(/sentence/);
    expect(hintRefusal("Parse must accept the two bounds in either order.", "CODE")).toMatch(/code/);
  });
});

describe("authorCalls", () => {
  test("the writer and the raters never see the fix; the audits and the hint writer do", () => {
    const { fix, ...blind } = MATERIAL;
    for (const p of [planWriterPrompt(blind, false), planWriterPrompt(blind, true), raterPrompt(plan(250), blind, "Parse must accept either order.")]) {
      expect(p).not.toContain(fix.diff.trim());
      expect(p).not.toContain(fix.message);
    }
    expect(planAuditPrompt(plan(250), fix)).toContain(fix.diff.trim());
    expect(hintWriterPrompt(fix)).toContain(fix.message);
    expect(hintAuditPrompt("Parse must accept either order.")).not.toContain(fix.diff.trim());
    expect(planWriterPrompt(blind, true)).not.toBe(planWriterPrompt(blind, false));
  });
  test("a hint gets one rewrite, then the unit drops at hint-audit", async () => {
    const r = await authorCalls(MATERIAL, scriptedCalls({ conditions: ["SILENT"], hintAudit: "CODE" }));
    expect(r.record.drop).toBe("hint-audit");
    expect(r.record.hint!.drafts).toBe(2);
    expect(r.hint).toBeNull();
    expect(r.plan).not.toBeNull();
  });
  test("an unreadable rating is asked once more, then the unit drops at rater-unreadable", async () => {
    const once = await authorCalls(MATERIAL, scriptedCalls({ conditions: ["SILENT"], ratings: ["perhaps", "no", "maybe"] }));
    expect(once.record.foresee).toEqual(["no", "maybe"]);
    const twice = await authorCalls(MATERIAL, scriptedCalls({ conditions: ["SILENT"], ratings: ["perhaps", "unsure"] }));
    expect(twice.record.drop).toBe("rater-unreadable");
  });
  test("cost adds every call", async () => {
    const r = await authorCalls(MATERIAL, scriptedCalls({ conditions: ["SILENT"] }));
    expect(r.record.costUsd).toBeCloseTo(0.1 + 0.1 + 0.05 + 0.05 + 0.05 + 0.05, 9);
  });
});

describe("the seeded order and the draw", () => {
  const seed = "0123456789abcdef0123456789abcdef";
  const cands = Array.from({ length: 12 }, (_, i) => ({ id: "c" + i, repo: "r" + i }));
  test("the order is a function of the recorded seed alone; a seed that is not hex is refused", async () => {
    expect(seededOrder(cands, seed)).toEqual(seededOrder([...cands].reverse(), seed));
    expect(seededOrder(cands, seed)).not.toEqual(seededOrder(cands, "f".repeat(32)));
    expect(await codeOf(() => seededOrder(cands, "seed-from-a-name"))).toBe("E_USAGE");
  });
  test("the walk stops at the first unit with no authoring outcome", () => {
    const order = seededOrder(cands, seed);
    const authored = new Map<string, Authored>(order.slice(0, 3).map((c) => [c.id, { admitted: true, reason: null, unforeseeable: false }]));
    const d = drawSets(order, authored, { calibration: 2, comparison: 3, reserve: 0 });
    expect(d.calibration).toEqual([order[0]!.id, order[1]!.id]);
    expect(d.comparison).toEqual([order[2]!.id]);
    expect(d.next).toBe(order[3]!.id);
    expect(d.filled || d.exhausted).toBe(false);
  });
  test("lost comparison units take reserve units in order; with the reserve spent the rest go unreplaced", async () => {
    const r = replaceLost({ comparison: ["a", "b", "c"], reserve: ["x", "y"] }, [{ id: "c", reason: "image" }, { id: "a", reason: "image" }, { id: "b", reason: "image" }]);
    expect(r.swaps.map((s) => s.lost + ">" + s.by)).toEqual(["a>x", "b>y"]);
    expect(r.unreplaced).toEqual(["c"]);
    expect(r.comparison).toEqual(["x", "y"]);
    expect(await codeOf(() => replaceLost({ comparison: ["a"], reserve: [] }, [{ id: "z", reason: "image" }]))).toBe("E_USAGE");
  });
});
