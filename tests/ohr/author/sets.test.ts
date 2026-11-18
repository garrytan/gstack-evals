// Value: protects=section 3's sets: pairs placed whole, and reserve replacement by kind in draw order, a pair only by a pair, never after stage 2 ran.
import { describe, expect, test } from "bun:test";
import { placeSets, replaceDropped, setRecord, type Member } from "../../../lanes/office-hours-rewrite/author/sets.ts";

const m = (id: string, set: Member["set"], kind: Member["kind"], draw: number, twin: string | null = null, skin = set === "comparison" ? 2 : 0): Member => ({ id, slot: set + id, set, kind, type: kind === "builder" ? "fun" : kind === "pair" ? "T1" : "T7", skin, cluster: "d" + draw, draw, twin, digest: "x" + id, pilot: false });
const S = placeSets([
  m("d1a", "comparison", "pair", 1, "d1b"), m("d1b", "comparison", "pair", 1, "d1a"),
  m("d2", "comparison", "founder", 2), m("d3", "comparison", "builder", 3),
  m("d9", "reserve", "builder", 9), m("d5a", "reserve", "pair", 5, "d5b"), m("d5b", "reserve", "pair", 5, "d5a"), m("d6", "reserve", "founder", 6), m("d4", "reserve", "founder", 4),
]);

describe("placeSets", () => {
  test("drops a twin whose partner is not placed", () => {
    const s = placeSets([m("d1a", "comparison", "pair", 1, "d1b"), m("d2", "comparison", "founder", 2)]);
    expect(s.comparison.map((x) => x.id)).toEqual(["d2"]);
  });
  test("orders each set by draw", () => {
    expect(S.reserve.map((x) => x.id)).toEqual(["d4", "d5a", "d5b", "d6", "d9"]);
  });
});

describe("replaceDropped", () => {
  test("a dropped twin takes its partner out and a reserve pair comes in whole, with the dropped skin", () => {
    const r = replaceDropped(S, "d1b", new Set());
    expect(r.removed.sort()).toEqual(["d1a", "d1b"]);
    expect(r.replaced).toEqual(["d5a", "d5b"]);
    expect(r.sets.comparison.filter((x) => x.kind === "pair").map((x) => [x.id, x.skin, x.set])).toEqual([["d5a", 2, "comparison"], ["d5b", 2, "comparison"]]);
    expect(r.sets.reserve.map((x) => x.id)).toEqual(["d4", "d6", "d9"]);
  });
  test("an unpaired founder is replaced by the first unpaired founder reserve in draw order, not a builder", () => {
    expect(replaceDropped(S, "d2", new Set()).replaced).toEqual(["d4"]);
    expect(replaceDropped(S, "d3", new Set()).replaced).toEqual(["d9"]);
  });
  test("nothing changes once a stage 2 session ran on the brief or its twin", () => {
    expect(replaceDropped(S, "d1b", new Set(["d1a"])).replaced).toBeNull();
    expect(replaceDropped(S, "d1b", new Set(["d1a"])).sets).toBe(S);
  });
  test("with no reserve of its kind left the brief is removed and nothing replaces it", () => {
    const noFounders = { ...S, reserve: S.reserve.filter((x) => x.kind !== "founder") };
    const r = replaceDropped(noFounders, "d2", new Set());
    expect([r.replaced, r.removed]).toEqual([null, ["d2"]]);
  });
});

test("setRecord gives counts and a digest only", () => {
  const r = setRecord(S.comparison);
  expect(r).toMatchObject({ size: 4, clusters: 3, kinds: { builder: 1, founder: 1, pair: 2 } });
  expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
});
