// Copyright (c) 2026 Garry Tan. MIT License.
// Judge runs: pinned prompts, the label parse with explicit unlabelled cells, the one resend, and the particle-1 panel.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { MONEY } from "../../../lanes/design-constructed/frozen.ts";
import { defaultEntry, makeKey, makeRow, makeUnit, scriptedCaller } from "../../../lanes/design-constructed/score/fixtures.ts";
import { fill, labelPacket, lastJson, panelCell, parseLabels, PROMPT_DIR, PROMPT_SHA256, splits, toLabelCell } from "../../../lanes/design-constructed/score/labels.ts";
import { buildLabelPackets } from "../../../lanes/design-constructed/score/packets.ts";
import { cellKey, type PacketFile, type RawCell } from "../../../lanes/design-constructed/score/types.ts";

const p: PacketFile = { id: "p", prompt: "brief", tier: "10x", items: [{ id: "i1", statement: "s", file: null, detail: "d" }, { id: "i2", statement: "t", file: null, detail: null }], lists: [{ id: "L", changes: ["a", "b", "c"] }] };
const answer = (labels: object[]) => JSON.stringify({ labels });
const raw = (o: Partial<RawCell>): RawCell => ({ anticipated: false, edges: [], screenHit: false, screenEdges: [], detailEdges: null, noIndex: false, ...o });

describe("prompts", () => {
  test("every score prompt matches its pin, and no prompt uses an em dash", () => {
    for (const [name, pin] of Object.entries(PROMPT_SHA256)) {
      const text = readFileSync(join(PROMPT_DIR, name + ".md"), "utf8");
      expect(createHash("sha256").update(text).digest("hex")).toBe(pin);
      expect(text).not.toContain("\u2014");
    }
  });
  test("fill is literal, so a $ in a list is not a replacement pattern", () => {
    expect(fill("a {{PACKET}} b {{OTHER}}", { PACKET: "$& $1" })).toBe("a $& $1 b {{OTHER}}");
    expect(lastJson('text {"a": 1} more')).toEqual({ a: 1 });
  });
});

describe("parseLabels", () => {
  test("a missing entry, a garbled index, a conflicting repeat and a missing detail field are unlabelled", () => {
    const c = parseLabels(answer([{ list: "L", item: "i1", anticipated: true, changes: [1, 9], screen_hit: false }]), p);
    expect(c.get(cellKey("L", "i1"))).toBeNull();
    expect(c.get(cellKey("L", "i2"))).toBeNull();
    const rep = parseLabels(answer([{ list: "L", item: "i2", anticipated: false, screen_hit: false }, { list: "L", item: "i2", anticipated: true, changes: [1], screen_hit: false, detail_changes: [] }]), p);
    expect(rep.get(cellKey("L", "i2"))).toBeNull();
    const noDetail = parseLabels(answer([{ list: "L", item: "i1", anticipated: true, changes: [1], screen_hit: false }]), p);
    expect(noDetail.get(cellKey("L", "i1"))).toBeNull();
    const bad = parseLabels(answer([{ list: "L", item: "i1", anticipated: true, changes: [1], screen_hit: false, detail_changes: [2] }]), p);
    expect(bad.get(cellKey("L", "i1"))).toBeNull();
  });
  test("a yes with no index parses as a raw cell and reads unlabelled for one judge (R2-18)", () => {
    const c = parseLabels(answer([{ list: "L", item: "i2", anticipated: true, changes: [], screen_hit: false, detail_changes: [] }]), p).get(cellKey("L", "i2"))!;
    expect(c.noIndex).toBe(true);
    expect(toLabelCell(c)).toEqual({ kind: "unlabelled", why: "a yes names no change index (R2-18)" });
    expect(toLabelCell(null).kind).toBe("unlabelled");
  });
  test("a good 10x cell keeps its detail edges; a base packet's cells carry none", () => {
    const c = parseLabels(answer([{ list: "L", item: "i1", anticipated: true, changes: [2, 1, 2], screen_hit: true, screen_changes: [3], detail_changes: [2] }]), p).get(cellKey("L", "i1"))!;
    expect(toLabelCell(c)).toEqual({ kind: "labelled", anticipated: true, screenHit: true, anticipatedEdges: [1, 2], screenHitEdges: [3], detailEdges: [2] });
    const base = parseLabels(answer([{ list: "L", item: "i1", anticipated: false, screen_hit: false }]), { ...p, tier: "base" }).get(cellKey("L", "i1"))!;
    expect(base.detailEdges).toBeNull();
  });
});

describe("the panel (M11)", () => {
  test("agreeing members need no Gemini; a split on the label, the edges or a shared pair's detail does", () => {
    const a = raw({ anticipated: true, edges: [1], screenHit: true, screenEdges: [1], detailEdges: [1] });
    expect(splits(a, a)).toBe(false);
    expect(splits(a, raw({}))).toBe(true);
    expect(splits(a, { ...a, edges: [2], detailEdges: [] })).toBe(true);
    expect(splits(a, { ...a, detailEdges: [] })).toBe(true);
    expect(panelCell(a, a, undefined, true)).toMatchObject({ kind: "labelled", anticipatedEdges: [1], detailEdges: [1], via: "two-vote" });
  });
  test("two yes votes out of three make the label, and a missing first vote leaves the cell unlabelled", () => {
    const y = raw({ anticipated: true, edges: [2], screenHit: true, screenEdges: [2] });
    expect(panelCell(y, raw({}), y, false)).toMatchObject({ kind: "labelled", anticipated: true, anticipatedEdges: [2] });
    expect(panelCell(y, raw({}), raw({}), false)).toMatchObject({ kind: "labelled", anticipated: false, anticipatedEdges: [] });
    expect(panelCell(null, y, y, false).kind).toBe("unlabelled");
    expect(panelCell(y, raw({}), null, false).kind).toBe("unlabelled");
  });
  test("labelPacket asks Gemini once on a split packet and records each judge's own labels", async () => {
    const u = makeUnit("u1", { key: makeKey({ tier: "base" }) });
    const b = buildLabelPackets({ stage: 1, read: "base", units: new Map([["u1", u]]), rows: [makeRow("u1", "none", ["Skeleton ZQ1."], { model: "particle" })], calibration: new Set() });
    const { call, calls } = scriptedCaller({ override: (c) => (c.judge === "opus" && c.item.tag === "ZQ1" && c.list.changes[0] === "Skeleton ZQ1." ? { ...defaultEntry(c), anticipated: false, changes: [], screen_hit: false, screen_changes: [] } : undefined) });
    const l = await labelPacket(b.packets[0]!, b.metas[0]!, call);
    expect(l.judges.map((j) => j.judge)).toEqual(["astra", "opus", "argon"]);
    expect(calls.map((c) => c.effort)).toEqual(["medium", "medium", "medium"]);
    expect(calls.every((c) => c.subject === "particle" && c.maxTokens === MONEY.outputCaps.productionLabels)).toBe(true);
  });
});
