// Value: protects=section 7's blind packets: their composition, the shuffled-key control, the anchors, the check pass, the gold floors and the map kept outside the packets.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED, STOCK_ROWS } from "../../../lanes/office-hours-founder/frozen.ts";
import { normalizeBlock, renderBlock } from "../../../lanes/office-hours-founder/parse.ts";
import { KEY, block, row, stubCaller, unit } from "../../../lanes/office-hours-founder/score/fixtures.ts";
import { judgePackets } from "../../../lanes/office-hours-founder/score/judge.ts";
import { nearMisses, oracleBlock } from "../../../lanes/office-hours-founder/score/oracle.ts";
import { buildCheckPackets, buildLabelPackets, goldCells, readPackets, writePackets, type Built, type Labelled } from "../../../lanes/office-hours-founder/score/packets.ts";
import type { SessionRow } from "../../../lanes/office-hours-founder/types.ts";

const units = new Map([["u1", unit("u1")], ["u2", unit("u2", { key: { customer: "Teachers at rural primary schools", wedge: "A printed weekly lesson pack" } })]]);
const rows: SessionRow[] = ["u1", "u2"].flatMap((u) => [
  row({ unit: u, arm: "none", pass: 1 }),
  row({ unit: u, arm: "office-hours", pass: 1, block: block("Sell office-hours advice to " + u) }),
  row({ unit: u, arm: "none", pass: 2 }),
  row({ unit: u, arm: "none", pass: 3, end: "no-block", block: null }),
  row({ unit: u, model: "sol", arm: "none", pass: 1 }),
  row({ unit: u, kind: "reference", pass: 1 }),
  row({ unit: u, kind: "reference", pass: 2 }),
]);
const byRole = (b: Built, role: string) => b.packets.filter((p) => b.map.packets[p.id]!.role === role);
const kinds = (b: Built, id: string) => Object.values(b.map.packets[id]!.blocks).map((r) => (r.kind === "session" ? r.session.kind + ":" + r.session.arm + ":" + r.session.pass : r.kind === "stock" ? "stock" + r.row : r.kind)).sort();

describe("label packets", () => {
  const built = buildLabelPackets({ stage: 1, seed: SEED, units, rows });
  test("one per (unit, model, pass) with that pass's blocks across arms and the three stock rows", () => {
    const label = byRole(built, "label");
    expect(label).toHaveLength(6);
    const p1 = label.find((p) => built.map.packets[p.id]!.unit === "u1" && kinds(built, p.id).includes("arm:office-hours:1"))!;
    expect(kinds(built, p1.id)).toEqual(["arm:none:1", "arm:office-hours:1", "stock1", "stock2", "stock3"]);
    expect(label.every((p) => !kinds(built, p.id).includes("arm:none:3"))).toBe(true);
  });
  test("reference blocks and anchors sit in packets of their own", () => {
    expect(byRole(built, "reference").map((p) => kinds(built, p.id))).toEqual([["reference:none:1", "reference:none:2", "stock1", "stock2", "stock3"], ["reference:none:1", "reference:none:2", "stock1", "stock2", "stock3"]]);
    const anchor = byRole(built, "anchor");
    expect(anchor).toHaveLength(4);
    expect(kinds(built, anchor[0]!.id)).toEqual(["near-miss", "near-miss", "near-miss", "oracle", "stock1", "stock2", "stock3"]);
  });
  test("each label packet has a shuffled-key packet with the same blocks against the partner's key", () => {
    const shuffled = byRole(built, "shuffled");
    expect(shuffled).toHaveLength(6);
    for (const p of shuffled) {
      const m = built.map.packets[p.id]!;
      expect(m.unit).not.toBe(m.blocks_unit);
      expect(p.items.customer).toBe(units.get(m.unit)!.key.customer);
      expect(Object.values(m.blocks).every((r) => r.unit === m.blocks_unit)).toBe(true);
    }
  });
  test("a packet holds the key's four items and rendered blocks only, under random ids", () => {
    for (const p of built.packets) {
      expect(Object.keys(p).sort()).toEqual(["blocks", "doubt", "id", "items", "prompt"]);
      expect(Object.keys(p.items).sort()).toEqual(["customer", "first_move", "pivot", "wedge"]);
      for (const b of p.blocks) expect(Object.keys(b).sort()).toEqual(["first_move_full", "id", "text"]);
    }
    const stock = built.packets[0]!.blocks.find((b) => built.map.packets[built.packets[0]!.id]!.blocks[b.id]!.kind === "stock" && (built.map.packets[built.packets[0]!.id]!.blocks[b.id] as { row: number }).row === 1)!;
    expect(stock.text).toBe(renderBlock(normalizeBlock(STOCK_ROWS[0]!.block)));
    const ids = built.packets.flatMap((p) => [p.id, ...p.blocks.map((b) => b.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z2-9]{6}$/.test(id))).toBe(true);
  });
  test("seeded: the same input builds the same packets", () => {
    expect(JSON.stringify(buildLabelPackets({ stage: 1, seed: SEED, units, rows }))).toBe(JSON.stringify(built));
  });
  test("pitch blocks sit in packets of their own per (unit, model) across arms", () => {
    const pitch = buildLabelPackets({ stage: 2, seed: SEED, units: new Map([...units].map(([k, u]) => [k, { ...u, meta: { ...u.meta, set: "comparison" as const } }])), rows: ["none", "lens", "office-hours"].map((arm) => row({ stage: 2, kind: "pitch", unit: "u1", arm: arm as SessionRow["arm"] })) }, { map: { version: 1, kind: "check", stage: 1, seed: SEED, packets: {} }, packets: new Map(), labels: [] });
    expect(pitch.packets.map((p) => kinds(pitch, p.id))).toEqual([["pitch:lens:1", "pitch:none:1", "pitch:office-hours:1", "stock1", "stock2", "stock3"]]);
  });
  test("stage 2 refuses to build without the judge check's gold", () => {
    expect(() => buildLabelPackets({ stage: 2, seed: SEED, units, rows: [] })).toThrow("E_USAGE");
  });
});

describe("anchors", () => {
  test("the oracle block sells the wedge to the customer and takes the key's first move as its next action", () => {
    const o = oracleBlock(KEY)!;
    expect(o.block.first_move).toBe("Sell A weekly parts reorder list to Owners of small bicycle repair shops.");
    expect(o.block.next_action).toBe(KEY.first_move);
  });
  test("the near-miss anchors cross the key with its alternative, with fixed labels", () => {
    expect(nearMisses(KEY).map((n) => [n.block.block.first_move, n.expect])).toEqual([
      ["Sell A weekly parts reorder list to Managers of regional bicycle chains.", { customer: false, wedge: true }],
      ["Sell A store analytics dashboard to Owners of small bicycle repair shops.", { customer: true, wedge: false }],
      ["Sell A store analytics dashboard to Managers of regional bicycle chains.", { customer: false, wedge: false }],
    ]);
    expect(nearMisses({ ...KEY, alternative: undefined })).toEqual([]);
    const long = Array.from({ length: 34 }, () => "very").join(" ") + " long customer";
    expect(nearMisses({ ...KEY, alternative: { customer: long, wedge: "x" } }).map((n) => n.near)).toEqual(["customer-only", "neither"]);
  });
});

describe("the judge check and gold", () => {
  const check = buildCheckPackets({ stage: 1, seed: SEED, units, rows });
  test("the check pass holds stage 1's true-key packets again, under the audit prompt, for Astra and Opus", () => {
    const label = buildLabelPackets({ stage: 1, seed: SEED, units, rows });
    expect(check.packets).toHaveLength(label.packets.length - byRole(label, "shuffled").length);
    for (const p of check.packets) expect([p.prompt, check.map.packets[p.id]!.judges]).toEqual(["audit", ["astra", "opus"]]);
    expect(() => buildCheckPackets({ stage: 2, seed: SEED, units, rows })).toThrow("E_USAGE");
  });
  test("gold cells are the customer and wedge cells where Astra and Opus agree", async () => {
    const { labels } = await judgePackets({ map: check.map, packets: new Map(check.packets.map((p) => [p.id, p])), call: stubCaller((j, _a, _b, c) => (j === "opus" ? { ...c, wedge: !c.wedge } : c)), concurrency: 2 });
    const gold = goldCells(check.map, labels);
    expect(gold.every((g) => g.item === "customer")).toBe(true);
    expect(gold).toHaveLength(check.packets.reduce((n, p) => n + p.blocks.length, 0));
    expect(gold.filter((g) => g.oracle).every((g) => g.gold)).toBe(true);
  });
  test("stage 2 inserts at most 40 gold cells per production judge, blind, under the oracle half cap", () => {
    const big = new Map(Array.from({ length: 30 }, (_, i) => ["c" + i, unit("c" + i)] as const));
    const s1 = Array.from(big.keys()).flatMap((u) => [row({ unit: u }), row({ unit: u, pass: 2, block: block("Sell vague help to everyone") })]);
    const chk = buildCheckPackets({ stage: 1, seed: SEED, units: big, rows: s1 });
    const labels: Labelled[] = chk.packets.flatMap((p) => p.blocks.flatMap((b) => (["astra", "opus"] as const).map((judge) => ({ packet: p.id, block: b.id, judge, customer: b.text.includes("bicycle repair"), wedge: false }))));
    const s2units = new Map([["z1", unit("z1", { set: "comparison" })]]);
    const built = buildLabelPackets({ stage: 2, seed: SEED, units: s2units, rows: [row({ stage: 2, unit: "z1" })] }, { map: chk.map, packets: new Map(chk.packets.map((p) => [p.id, p])), labels });
    const gold = byRole(built, "gold").flatMap((p) => built.map.packets[p.id]!.gold!);
    expect(gold).toHaveLength(40);
    expect(gold.filter((g) => g.gold)).toHaveLength(20);
    expect(gold.filter((g) => g.oracle).length).toBeLessThanOrEqual(gold.filter((g) => g.gold && !g.oracle).length);
    for (const p of byRole(built, "gold")) expect(p.prompt).toBe("brief");
  });
});

test("the map is written outside the packets folder", () => {
  const root = mkdtempSync(join(tmpdir(), "of-packets-"));
  try {
    const built = buildLabelPackets({ stage: 1, seed: SEED, units, rows });
    expect(() => writePackets(built, join(root, "packets"), join(root, "packets", "map.json"))).toThrow("E_USAGE");
    writePackets(built, join(root, "packets"), join(root, "map.json"));
    expect(existsSync(join(root, "map.json"))).toBe(true);
    expect(readPackets(join(root, "packets")).size).toBe(built.packets.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
