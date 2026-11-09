// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { panelLabel, parseLabels, readEntry } from "../../lanes/eng-review/judge.ts";
import type { PacketFile } from "../../lanes/eng-review/packets.ts";

const packet: PacketFile = { id: "p", prompt: "brief", items: [{ id: "i1", statement: "x" }, { id: "i2", statement: "y" }], lists: [{ id: "l1", checks: ["a", "b"] }] };
const e = (o: object) => ({ list: "l1", item: "i1", anticipated: false, checks: [], path_hit: false, path_checks: [], credit: null, ...o });

describe("reading a judge's answer (section 7)", () => {
  test("an anticipated cell needs check indices in range and a credit; anticipated implies path hit", () => {
    expect(readEntry(e({ anticipated: true, checks: [2], credit: "code" }), 2)).toEqual({ anticipated: true, checks: [2], path_hit: true, path_checks: [2], credit: "code" });
    expect(readEntry(e({ anticipated: true, checks: [3], credit: "check" }), 2)).toBeNull();
    expect(readEntry(e({ anticipated: true, checks: [1] }), 2)).toBeNull();
    expect(readEntry(e({ path_hit: true, path_checks: [] }), 2)).toBeNull();
    expect(readEntry(e({}), 2)).toEqual({ anticipated: false, checks: [], path_hit: false, path_checks: [], credit: null });
  });
  test("a missing or contradictory cell is missing; a repeated identical one is kept", () => {
    const one = JSON.stringify({ labels: [e({}), e({})] });
    expect(parseLabels(one, packet, false).missing).toEqual(["l1|i2"]);
    const clash = JSON.stringify({ labels: [e({}), e({ anticipated: true, checks: [1], credit: "check" }), e({ item: "i2" })] });
    expect(parseLabels(clash, packet, false).missing).toEqual(["l1|i1"]);
    expect(parseLabels("not json", packet, false).missing.length).toBe(2);
  });
  test("the panel takes the majority on each label, the union of yes indices and the majority credit, a tie taking check", () => {
    const y = (checks: number[], credit: "check" | "code") => ({ anticipated: true, checks, path_hit: true, path_checks: checks, credit });
    const n = { anticipated: false, checks: [], path_hit: false, path_checks: [], credit: null };
    expect(panelLabel([y([1], "code"), y([2], "check"), n])).toEqual({ anticipated: true, checks: [1, 2], path_hit: true, path_checks: [1, 2], credit: "check" });
    expect(panelLabel([y([1], "code"), y([1], "code"), y([2], "check")]).credit).toBe("code");
    expect(panelLabel([y([1], "code"), n, n]).anticipated).toBe(false);
  });
});
