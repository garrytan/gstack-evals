// Copyright (c) 2026 Garry Tan. MIT License.
// The judge check's gate on its edges: kappa at 0.59 and 0.60, the floors, the anchor weight and the oracle cap, and the re-check positions.
import { describe, expect, test } from "bun:test";
import { CHECK_SUBJECTS, gate, panelPasses, recheckPositions, ROUTES, type GoldCell, type JudgedCell } from "../../../lanes/design-constructed/score/check.ts";
import { kappa } from "../../../lanes/design-constructed/score/stats.ts";

const cell = (list: string, gold: boolean, kind: GoldCell["kind"] = "agreed"): GoldCell => ({ id: list, list, unit: "u", model: "opus", tier: "base", source: "none", item: "01", change: null, gold, kind, listRef: { source: "none", session: list, unit: "u", words: 0 }, changes: [], packetItem: { statement: "", file: null, detail: null } });
const cells = (n: number, e: number, tag = "l", yesKind: GoldCell["kind"] = "agreed"): JudgedCell[] =>
  [...Array(n).keys()].flatMap((i) => [{ cell: cell(tag + "y" + i, true, yesKind), judged: i >= e }, { cell: cell(tag + "n" + i, false), judged: i < e }]);
const S = CHECK_SUBJECTS[0]!;

describe("the gate", () => {
  test("kappa 0.59 fails and 0.60 passes", () => {
    expect(gate(S, cells(200, 41))).toMatchObject({ pass: false, reading: "kappa under 0.6" });
    expect(gate(S, cells(200, 40))).toMatchObject({ pass: true, reading: "pass" });
    expect(gate(S, cells(200, 40)).catchRate).toBeCloseTo(0.8, 9);
    expect(gate(S, cells(200, 40)).falseFail).toBeCloseTo(0.2, 9);
  });
  test("unlabelled cells leave the gate and are counted", () => {
    const js = cells(40, 0);
    js[0] = { ...js[0]!, judged: null };
    expect(gate(S, js)).toMatchObject({ unlabelled: 1, anticipated: 39, short: true });
  });
  test("oracle cells are capped at the real anticipated count, a seeded subset", () => {
    const g = gate(S, [...cells(10, 0, "r"), ...[...Array(25).keys()].map((i) => ({ cell: cell("o" + i, true, "oracle"), judged: true }))]);
    expect(g.oracle).toEqual({ available: 25, used: 10 });
    expect(g.anticipated).toBe(20);
  });
  test("anchors weigh at most a quarter, and no anchors leave every weight at 1", () => {
    const g = gate(S, [...cells(20, 0, "r"), ...[...Array(40).keys()].map((i) => ({ cell: cell("s" + i, false, "stock"), judged: false }))]);
    expect(g.anchors * g.anchorWeight).toBeCloseTo(40 / 3, 9);
    expect(gate(S, cells(20, 0)).anchorWeight).toBe(1);
  });
  test("weighted kappa, its null cases, and the panel's two-member rule", () => {
    expect(kappa([])).toBeNull();
    expect(kappa([{ gold: true, judged: true, weight: 1 }])).toBeNull();
    const pass = gate(S, cells(40, 0)), fail = gate(S, cells(39, 0));
    expect(panelPasses(pass, pass)).toBe(true);
    expect(panelPasses(pass, fail)).toBe(false);
  });
});

describe("routes and the re-check queue", () => {
  test("every judge route is probed once", () => {
    expect(ROUTES.map((r) => r.name)).toEqual(["labels:astra", "labels:opus", "labels:argon", "check:astra", "check:opus", "check:argon", "pairwise:astra", "pairwise:opus", "arm-guess:astra"]);
    expect(ROUTES.filter((r) => r.name.startsWith("check:")).every((r) => r.effort === "max")).toBe(true);
  });
  test("8 gold packets spread evenly through a queue", () => {
    expect(recheckPositions(72, 8)).toEqual([5, 15, 25, 35, 45, 55, 65, 75]);
  });
});
