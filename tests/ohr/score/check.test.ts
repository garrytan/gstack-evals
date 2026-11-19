// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite eval's judge check (prereg section 12, frozen.JUDGE_CHECK), with Cohen's kappa pinned to published examples.
import { describe, expect, test } from "bun:test";
import { kappa } from "../../../lanes/product-value/stats.ts";
import { goldCells, judgeCheck } from "../../../lanes/office-hours-rewrite/score/check.ts";
import { checkInput as input, faithful, judgedLabel as lab, plantCheck as plant } from "../../../lanes/office-hours-rewrite/score/fixtures.ts";

const pairs = (a: number, b: number, c: number, d: number): Array<[boolean, boolean]> => [
  ...Array.from({ length: a }, () => [true, true] as [boolean, boolean]),
  ...Array.from({ length: b }, () => [true, false] as [boolean, boolean]),
  ...Array.from({ length: c }, () => [false, true] as [boolean, boolean]),
  ...Array.from({ length: d }, () => [false, false] as [boolean, boolean]),
];

describe("Cohen's kappa against published worked examples", () => {
  // Wikipedia, "Cohen's kappa": the simple example (20, 5, 10, 15 of 50 gives 0.4) and the two tables with the same
  // agreement of 0.60 (45, 15, 25, 15 gives 0.1304; 25, 35, 5, 35 gives 0.2593).
  test("0.4, 0.1304 and 0.2593", () => {
    expect(kappa(pairs(20, 5, 10, 15))).toBeCloseTo(0.4, 10);
    expect(kappa(pairs(45, 15, 25, 15))!).toBeCloseTo(0.1304, 4);
    expect(kappa(pairs(25, 35, 5, 35))!).toBeCloseTo(0.2593, 4);
    expect(kappa([[true, true]])).toBeNull();
  });
});

describe("judge check", () => {
  test("a faithful judge passes with enough gold, near-misses and stock rows", () => {
    const r = judgeCheck(input({ session: 40, near: 4, stock: 3 }, faithful));
    expect(r.verdict).toBe("PASS");
    expect(r.code).toBeNull();
    expect(r.kappa).toBe(1);
    expect(r.kappa_real).toBe(1);
    expect(r.near_miss).toBe(1);
    expect(r.stock_credited).toBe(0);
    expect(r.outputs).toBe(84);
    expect(r.blocks).toBe(44);
  });
  test("gold is cells where Astra and Opus agree at max; a split or a null drops the cell from gold", () => {
    const { map } = plant({ session: 3 });
    const g = goldCells(map, [lab("astra", "session0", true, true, "max"), lab("opus", "session0", true, false, "max"), lab("astra", "session1", null, false, "max"), lab("opus", "session1", false, false, "max"), lab("astra", "session2", true, true, "medium"), lab("opus", "session2", true, true, "max")]);
    expect(g.map((c) => c.block + ":" + c.cell + ":" + c.gold)).toEqual(["session0:decision:true", "session1:action:false"]);
  });
  test("anchors: an oracle is credited on both cells, a near-miss not credited on decision only", () => {
    const { map } = plant({ session: 0, oracle: 1, near: 1 });
    const g = goldCells(map, []);
    expect(g.map((c) => c.block + ":" + c.cell + ":" + c.gold + ":" + c.anchor)).toEqual(["near0:decision:false:true", "oracle0:action:true:true", "oracle0:decision:true:true"]);
  });
  test("anchors count at most half the credited gold", () => {
    const r = judgeCheck(input({ session: 40, oracle: 30, near: 4, stock: 3 }, faithful));
    expect(r.anchors_credited).toBe(r.credited - r.anchors_credited);
    expect(r.anchors_credited).toBe(40);
  });
  test("under 40 outputs or 40 blocks reads NO READ", () => {
    const r = judgeCheck(input({ session: 19, near: 4, stock: 3 }, faithful));
    expect(r.verdict).toBe("NO READ");
    expect(r.code).toBe("E_OHR_JUDGE_CHECK_NO_READ");
  });
  test("each kappa needs 10 gold cells of each class, else NO READ", () => {
    const one = (o: Parameters<typeof plant>[0]) => {
      const inp = input(o, faithful);
      return { ...inp, gold: inp.gold.map((l) => ({ ...l, decision: true, action: true })), labels: inp.labels.map((l) => (l.block.startsWith("session") ? { ...l, decision: true, action: true } : l)) };
    };
    const r = judgeCheck(one({ session: 45, near: 4, stock: 3 }));
    expect(r.verdict).toBe("NO READ");
    expect(r.reasons.join(" ")).toContain("kappa");
    const real = judgeCheck(input({ session: 8, answer: 40, near: 4, stock: 3 }, faithful));
    expect(real.verdict).toBe("NO READ");
    expect(real.kappa_real).toBeNull();
  });
  test("kappa below 0.6 overall or on real session blocks fails", () => {
    const r = judgeCheck(input({ session: 40, near: 4, stock: 3 }, (b, i, k) => (k === "session" && i < 12 ? [i % 2 !== 0, i % 2 !== 0] : faithful(b, i, k))));
    expect(r.kappa!).toBeLessThan(0.6);
    expect(r.verdict).toBe("FAIL");
    expect(r.code).toBe("E_OHR_JUDGE_CHECK_FAIL");
    const real = judgeCheck(input({ session: 20, answer: 40, near: 4, stock: 3 }, (b, i, k) => (k === "session" && i < 7 ? [i % 2 !== 0, i % 2 !== 0] : faithful(b, i, k))));
    expect(real.kappa!).toBeGreaterThanOrEqual(0.6);
    expect(real.kappa_real!).toBeLessThan(0.6);
    expect(real.verdict).toBe("FAIL");
  });
  test("unlabelled cells count against the judge, never dropped", () => {
    const r = judgeCheck(input({ session: 40, near: 4, stock: 3 }, (b, i, k) => (k === "session" && i < 12 ? [null, null] : faithful(b, i, k))));
    expect(r.outputs).toBe(84);
    expect(r.unlabelled).toBe(24);
    expect(r.kappa!).toBeLessThan(0.6);
    expect(r.verdict).toBe("FAIL");
  });
  test("near-miss accuracy under 0.8 fails, an unlabelled near-miss counts as wrong, and no near-miss fails", () => {
    expect(judgeCheck(input({ session: 40, near: 5, stock: 3 }, (b, i, k) => (k === "near" && i === 0 ? [true, false] : faithful(b, i, k)))).verdict).toBe("PASS");
    const two = judgeCheck(input({ session: 40, near: 5, stock: 3 }, (b, i, k) => (k === "near" && i < 2 ? [i ? null : true, false] : faithful(b, i, k))));
    expect(two.near_miss).toBe(0.6);
    expect(two.verdict).toBe("FAIL");
    expect(judgeCheck(input({ session: 40, near: 0, stock: 3 }, faithful)).verdict).toBe("FAIL");
  });
  test("any stock row credited fails, an unlabelled stock cell fails, and no stock rows fails", () => {
    expect(judgeCheck(input({ session: 40, near: 4, stock: 3 }, (b, i, k) => (k === "stock" && i === 2 ? [false, true] : faithful(b, i, k)))).verdict).toBe("FAIL");
    expect(judgeCheck(input({ session: 40, near: 4, stock: 3 }, (b, i, k) => (k === "stock" && i === 2 ? [false, null] : faithful(b, i, k)))).verdict).toBe("FAIL");
    const none = judgeCheck(input({ session: 40, near: 4, stock: 0 }, faithful));
    expect(none.verdict).toBe("FAIL");
    expect(none.reasons.join(" ")).toContain("no stock row");
  });
  test("labels from the other judge or at max effort are refused", () => {
    const inp = input({ session: 40, near: 4, stock: 3 }, faithful);
    expect(() => judgeCheck({ ...inp, labels: inp.labels.map((l) => ({ ...l, judge: "opus" as const })) })).toThrow(/^E_OHR_JUDGE_INPUT/);
    expect(() => judgeCheck({ ...inp, labels: inp.labels.map((l) => ({ ...l, effort: "max" as const })) })).toThrow(/^E_OHR_JUDGE_INPUT/);
    expect(() => judgeCheck({ ...inp, map: { ...inp.map, kind: "label" } })).toThrow(/^E_OHR_JUDGE_INPUT/);
  });
});
