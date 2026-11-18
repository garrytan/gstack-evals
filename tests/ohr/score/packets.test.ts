// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite eval's blind packets (prereg section 5; section 12's judge check packets).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED, STOCK_ROWS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { BRIEFS, allRows, blockOf, row } from "../../../lanes/office-hours-rewrite/score/fixtures.ts";
import { assertUnique, buildCheckPackets, buildLabelPackets, itemsOf, readPackets, writePackets } from "../../../lanes/office-hours-rewrite/score/packets.ts";

const stage1 = () => buildLabelPackets({ stage: 1, seed: SEED, briefs: BRIEFS, rows: [...allRows("opus"), ...allRows("sol")] });

describe("packets", () => {
  test("one packet per (stage, brief, model) with three arm blocks, three stock rows and one near-miss row", () => {
    const b = stage1();
    expect(b.packets).toHaveLength(8);
    for (const p of b.packets) {
      const m = b.map.packets[p.id]!;
      const kinds = Object.values(m.blocks).map((r) => r.kind).sort();
      expect(kinds).toEqual(["near-miss", "session", "session", "session", "stock", "stock", "stock"]);
      expect(p.blocks).toHaveLength(7);
      expect(m.judges).toEqual([m.model === "opus" ? "astra" : "opus"]);
    }
  });
  test("key items: the twin's call is the contrast on a paired brief, the wrong call on an unpaired one", () => {
    expect(itemsOf("a", BRIEFS).contrast).toBe(BRIEFS.get("b")!.key.call);
    expect(itemsOf("c", BRIEFS).contrast).toBe("Hire a sales lead to fix momentum");
    expect(itemsOf("d", BRIEFS).contrast).toBe("Build the social feed first");
    expect(() => itemsOf("a", new Map([["a", BRIEFS.get("a")!]]))).toThrow(/^E_OHR_PACKET_INPUT/);
    expect(() => itemsOf("c", new Map([["c", { ...BRIEFS.get("c")!, key: { ...BRIEFS.get("c")!.key, wrong_call: null } }]]))).toThrow(/^E_OHR_PACKET_INPUT/);
  });
  test("the near-miss row writes the contrast call into a block; the stock rows are frozen.STOCK_ROWS", () => {
    const b = stage1();
    const p = b.packets.find((x) => b.map.packets[x.id]!.brief === "a")!;
    const m = b.map.packets[p.id]!;
    const near = p.blocks.find((x) => m.blocks[x.id]!.kind === "near-miss")!;
    expect(near.block).toEqual({ decision: BRIEFS.get("b")!.key.call, next_action: BRIEFS.get("a")!.key.actions[0]!, why: "" });
    const stock = p.blocks.filter((x) => m.blocks[x.id]!.kind === "stock").map((x) => x.block.decision).sort();
    expect(stock).toEqual(STOCK_ROWS.map((s) => s.decision).sort());
  });
  test("ids are seeded: the same input builds the same packets, another seed builds others", () => {
    expect(JSON.stringify(stage1())).toBe(JSON.stringify(stage1()));
    const other = buildLabelPackets({ stage: 1, seed: SEED + 7, briefs: BRIEFS, rows: allRows("opus") });
    expect(other.packets[0]!.id).not.toBe(stage1().packets[0]!.id);
  });
  test("packet and block ids are unique across every map, and a clash is refused", () => {
    const label = stage1();
    const check = buildCheckPackets({ seed: SEED, briefs: BRIEFS, rows: [...allRows("opus"), ...allRows("sol")], answers: [], taken: [label.map] });
    expect(() => assertUnique([label.map, check.map])).not.toThrow();
    const twice = buildLabelPackets({ stage: 1, seed: SEED, briefs: BRIEFS, rows: allRows("opus") });
    expect(() => assertUnique([label.map, twice.map])).toThrow(/^E_OHR_ID_CLASH/);
    const p = Object.keys(label.map.packets)[0]!;
    const blockClash = { ...check.map, packets: { ...check.map.packets, zzzzzz: { ...check.map.packets[Object.keys(check.map.packets)[0]!]!, id: "zzzzzz", blocks: { [Object.keys(label.map.packets[p]!.blocks)[0]!]: { kind: "stock" as const, row: 1 as const } } } } };
    expect(() => assertUnique([label.map, blockClash])).toThrow(/^E_OHR_ID_CLASH/);
  });
  test("a packet carries no sheet, opening, fact id, brief id, arm or transcript", () => {
    const b = stage1();
    for (const p of b.packets) {
      expect(Object.keys(p).sort()).toEqual(["blocks", "id", "items"]);
      const text = JSON.stringify(p);
      for (const [, br] of BRIEFS) for (const f of br.key.decisive) expect(text).not.toContain(f);
      expect(text).not.toMatch(/"(?:arm|brief|model|transcript|sheet|opening|decisive)"/);
    }
  });
  test("rows without a block build no session blocks, and a brief with no block builds no packet", () => {
    const rows = allRows("opus").map((r) => (r.brief === "c" ? { ...r, end: "no-block" as const, block: { kind: "no-block" as const, reason: "x", body_sha256: null } } : r));
    const b = buildLabelPackets({ stage: 1, seed: SEED, briefs: BRIEFS, rows });
    expect(Object.values(b.map.packets).map((m) => m.brief).sort()).toEqual(["a", "b", "d"]);
  });
  test("the check packets hold real blocks, answers, an oracle per calibration brief, a near-miss and the stock rows, per judge", () => {
    const answers = [{ brief: "c", author: "astra" as const, source: "full" as const, block: blockOf("Do not hire; cut the scope to one bakery route", "Drop the second route this week").block }];
    const c = buildCheckPackets({ seed: SEED, briefs: BRIEFS, rows: [...allRows("opus"), ...allRows("sol")], answers });
    const metas = Object.values(c.map.packets);
    expect(metas.map((m) => m.role + ":" + m.brief + ":" + m.model).sort()).toEqual(["anchor:a:null", "anchor:b:null", "anchor:c:null", "anchor:d:null", "check:a:opus", "check:a:sol", "check:b:opus", "check:b:sol", "check:c:opus", "check:c:sol", "check:d:opus", "check:d:sol"]);
    for (const m of metas) expect(m.judges).toEqual(["astra", "opus"]);
    const anchor = metas.find((m) => m.role === "anchor" && m.brief === "c")!;
    expect(Object.values(anchor.blocks).map((r) => r.kind).sort()).toEqual(["answer", "near-miss", "oracle", "stock", "stock", "stock"]);
    expect(c.map.kind).toBe("check");
  });
  test("the map must sit outside the packets folder, and both outside the repo", () => {
    const b = stage1();
    const dir = mkdtempSync(join(tmpdir(), "ohr-packets-"));
    expect(() => writePackets(b, join(dir, "p"), join(dir, "p", "map.json"))).toThrow(/^E_OHR_PACKET_INPUT/);
    expect(() => writePackets(b, join(import.meta.dir, "p"), join(dir, "map.json"))).toThrow(/^E_OHR_PACKET_INPUT/);
    writePackets(b, join(dir, "p"), join(dir, "map.json"));
    expect(readdirSync(join(dir, "p"))).toHaveLength(8);
    expect(readPackets(join(dir, "p")).size).toBe(8);
    expect(JSON.parse(readFileSync(join(dir, "map.json"), "utf8")).seed).toBe(SEED);
  });
  test("a row naming a brief outside the set is refused", () => {
    expect(() => buildLabelPackets({ stage: 1, seed: SEED, briefs: BRIEFS, rows: [row({ brief: "a" }), { ...row({ brief: "a" }), brief: "zz" }] })).toThrow(/^E_OHR_PACKET_INPUT/);
  });
});
