// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { buildArmGuessPackets, buildCheckPackets, buildLabelPackets, buildPairwisePackets, derangeUnits, drawGold, itemStatement, renderPacket, type GoldRef, type LabelRecord } from "../../lanes/eng-review/packets.ts";
import { seededRandom } from "../../lanes/product-value/stats.ts";
import { item, keyOf, meta, row, tmp, unitsOf, writeUnits } from "./fixtures.ts";
import { loadUnits } from "../../lanes/eng-review/units.ts";

const units = () => unitsOf([1, 2, 3].map((i) => ({ meta: meta("u" + i, { set: "calibration" }), key: keyOf("u" + i, [item("a" + i), item("t" + i, { kind: "T" })]) })));
const rows = () => ["u1", "u2"].flatMap((u) => [1, 2].flatMap((p) => (["none", "lens", "precut"] as const).map((arm) => row({ unit: u, session: u + arm + p, pass: p, arm, checks: ["Unit test for tag-a" + u.slice(1)] }))));
const oracle = { version: 1 as const, units: Object.fromEntries([1, 2, 3].map((i) => ["u" + i, { checks: ["Test src/import.ts: tag-a" + i], items: ["a" + i] }])) };

describe("label packets (section 7)", () => {
  test("one packet per unit-pass and model with its arms, three stock rows and the oracle in stage 1; a shuffled packet beside each", () => {
    const b = buildLabelPackets({ stage: 1, seed: 7, units: units(), rows: rows(), oracle });
    const prod = Object.values(b.map.packets).filter((m) => m.role === "production");
    const sh = Object.values(b.map.packets).filter((m) => m.role === "shuffled");
    expect(prod.length).toBe(4);
    expect(sh.length).toBe(4);
    for (const m of prod) {
      const kinds = Object.values(m.lists).map((l) => l.kind).sort();
      expect(kinds).toEqual(["arm", "arm", "arm", "oracle", "stock", "stock", "stock"]);
      expect(Object.values(m.items).some((i) => i.kind === "own")).toBe(true);
    }
    for (const m of sh) {
      expect(m.unit).not.toBe(m.lists_unit);
      expect(Object.values(m.lists).some((l) => l.kind === "oracle")).toBe(false);
      expect(Object.values(m.items).every((i) => i.kind !== "own")).toBe(true);
    }
    const text = JSON.stringify(b.packets);
    expect(text).not.toContain("precut");
    expect(text).not.toContain("u1");
    expect(b.map.order.length).toBe(8);
  });
  test("stage 2 needs the judge check; a calibration unit without an oracle list is refused in stage 1", () => {
    expect(() => buildLabelPackets({ stage: 2, seed: 7, units: units(), rows: rows() })).toThrow(/gold cells/);
    expect(() => buildLabelPackets({ stage: 1, seed: 7, units: units(), rows: rows() })).toThrow(/oracle list/);
  });
  test("a B item's statement carries its files and functions; a T item's doesn't", () => {
    expect(itemStatement(item("x"))).toContain("Files and functions: src/import.ts (readRows).");
    expect(itemStatement(item("x", { kind: "T", sites: undefined }))).not.toContain("Files and functions");
    expect(renderPacket({ id: "p", prompt: "brief", items: [{ id: "i", statement: "s" }], lists: [{ id: "l", checks: ["c"] }] })).toBe("KEY ITEMS\n[i] s\n\nCHECK LISTS\n\nList l\n1. c");
  });
  test("stage 2 gold: one gold packet per batch of 8, drawn half anticipated and half not across strata, placed after its batch", () => {
    const us = unitsOf(Array.from({ length: 10 }, (_, i) => ({ meta: meta("u" + i), key: keyOf("u" + i, [item("a" + i), item("t" + i, { kind: "T" })]) })));
    const rs = Array.from({ length: 10 }, (_, i) => row({ unit: "u" + i, session: "s" + i, checks: ["Unit test for tag-a" + i] }));
    const check = buildCheckPackets({ stage: 1, seed: 3, units: us, rows: rs });
    const labels: LabelRecord[] = [];
    for (const m of Object.values(check.map.packets)) for (const l of Object.keys(m.lists)) for (const i of Object.keys(m.items)) for (const j of ["astra", "opus"] as const) labels.push({ packet: m.id, judge: j, model_id: j, version: "v", effort: "max", prompt_sha256: "", packet_sha256: "", list: l, item: i, label: { anticipated: m.lists[l]!.kind === "arm" && m.items[i]!.kind === "B", checks: [1], path_hit: false, path_checks: [], credit: "check" } });
    const b = buildLabelPackets({ stage: 2, seed: 3, units: us, rows: rs, check: { map: check.map, packets: new Map(check.packets.map((p) => [p.id, p])), labels } });
    const gold = Object.values(b.map.packets).filter((m) => m.role === "gold");
    expect(gold.length).toBe(2);
    const cells = gold.flatMap((g) => g.gold!);
    expect(cells.filter((c) => c.gold).length).toBe(10);
    expect(cells.filter((c) => !c.gold).length).toBe(30);
    const firstGold = b.map.order.findIndex((id) => b.map.packets[id]!.role === "gold");
    expect(b.map.order.slice(0, firstGold).filter((id) => b.map.packets[id]!.role === "production").length).toBe(8);
    expect(Object.keys(b.plain!)).toEqual(["opus"]);
    expect(b.plain!.opus!.answers.length).toBe(40);
  });
  test("drawGold takes round-robin over strata within each class", () => {
    const mk = (arm: string, kind: "B" | "T", gold: boolean, n: number): GoldRef[] => Array.from({ length: n }, (_, i) => ({ packet: "p", list: arm + i, item: kind + i, gold, ref: { kind: "arm", unit: "u", model: "opus", pass: 1, arm: arm as "none", words: 1 }, itemRef: { unit: "u", item: kind + i, kind }, model: "opus", unit: "u" }));
    const d = drawGold([...mk("none", "B", true, 30), ...mk("precut", "T", true, 3), ...mk("none", "B", false, 30)], seededRandom(1), 40);
    expect(d.filter((c) => c.gold && c.itemRef.kind === "T").length).toBe(3);
    expect(d.filter((c) => c.gold).length).toBe(20);
  });
});

describe("the shuffled-key derangement", () => {
  test("same repository first, then type and language, then type; a lone unit joins a cycle of its type", () => {
    const u = (id: string, repo: string, type: string, language: string) => ({ id, repo, type, language });
    for (let s = 1; s < 20; s++) {
      const d = derangeUnits([u("a", "r1", "mobile", "Swift"), u("b", "r1", "mobile", "Swift"), u("c", "r2", "server", "Go"), u("d", "r3", "server", "Go"), u("e", "r4", "server", "Rust")], seededRandom(s))!;
      for (const [k, v] of d) expect(k).not.toBe(v);
      expect(new Set(d.values()).size).toBe(5);
      expect(d.get("a")).toBe("b");
      for (const x of ["c", "d", "e"]) expect(["c", "d", "e"]).toContain(d.get(x)!);
      const lone = derangeUnits([u("a", "r1", "mobile", "Swift"), u("b", "r1", "mobile", "Swift"), u("f", "r5", "devtools", "Go")], seededRandom(s))!;
      expect([...lone].every(([k, v]) => k !== v) && new Set(lone.values()).size === 3).toBe(true);
    }
    expect(derangeUnits([u("a", "r", "t", "l")], seededRandom(1))).toBeNull();
  });
});

describe("pairwise and arm-guess packets", () => {
  test("pass 1 on Opus and Sol: skill arms against none and lens, the stock block against none; plan.md and the diffstat shown", () => {
    const d = tmp();
    writeUnits(d, [1, 2].map((i) => ({ meta: meta("u" + i), key: keyOf("u" + i, [item("a")]) })));
    const us = loadUnits(d, { keys: true });
    const rs = (["opus", "sol", "particle"] as const).flatMap((m) => (["none", "lens", "precut", "engphase"] as const).flatMap((arm) => [1, 2].map((p) => row({ unit: "u1", session: m + arm + p, model: m, arm, pass: p }))));
    const b = buildPairwisePackets({ stage: 2, seed: 1, units: us, rows: rs });
    const metas = Object.values(b.map.packets);
    expect(metas.every((m) => m.model !== "particle" && m.pass === 1)).toBe(true);
    expect(metas.filter((m) => m.model === "opus").map((m) => m.pair!.contrast).sort()).toEqual(["engphase-lens", "engphase-none", "precut-lens", "precut-none", "stock-none"]);
    const stock = b.packets.find((p) => b.map.packets[p.id]!.pair!.contrast === "stock-none")!;
    expect(stock.lists.some((l) => l.checks.length === 16 && l.paths!.length === 8)).toBe(true);
    expect(stock.input).toContain("FILES THE MERGED CHANGE TOUCHED\nsrc/import.ts +40 -2");
    expect(renderPacket(stock)).toContain("PLAN A\nPaths:\n1. ");
  });
  test("the arm-guess probe holds 30 seeded block lists, one a packet, for Astra", () => {
    const rs = Array.from({ length: 40 }, (_, i) => row({ unit: "u1", session: "s" + i, checks: i % 5 ? ["c" + i] : null }));
    const b = buildArmGuessPackets({ stage: 2, seed: 1, units: units(), rows: rs });
    expect(b.packets.length).toBe(30);
    expect(Object.values(b.map.packets).every((m) => m.judges.join() === "astra")).toBe(true);
  });
});
