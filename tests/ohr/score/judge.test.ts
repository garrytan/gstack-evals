// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite eval's judge prompt, routing, resend and labeller (prereg section 5; section 12's gold pass).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESEND_NOTE } from "../../../lanes/product-value/judge.ts";
import { JUDGE_FOR, SEED } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { BRIEFS, allRows, block, stubCaller } from "../../../lanes/office-hours-rewrite/score/fixtures.ts";
import { JUDGE_PROMPT_SHA256, judgePackets, labeller, loadPrompt, parseCells } from "../../../lanes/office-hours-rewrite/score/judge.ts";
import { buildCheckPackets, buildLabelPackets, itemsOf } from "../../../lanes/office-hours-rewrite/score/packets.ts";

const packet = { id: "p", items: itemsOf("a", BRIEFS), blocks: [{ id: "b1", block: block("x", "y") }, { id: "b2", block: block("x", "y") }] };

describe("judge", () => {
  test("the prompt is pinned by sha256 and asks for the two cells", () => {
    const text = readFileSync(join(import.meta.dir, "../../../lanes/office-hours-rewrite/score/prompts/judge.md"), "utf8");
    expect(createHash("sha256").update(text).digest("hex")).toBe(JUDGE_PROMPT_SHA256);
    expect(loadPrompt()).toContain('{"labels": [{"block": "<block id>", "decision": true, "action": false}]}');
    expect(loadPrompt()).toContain("{{PACKET}}");
  });
  test("parseCells: one boolean per cell; a missing, non-boolean or disagreeing duplicate cell is null", () => {
    const a = parseCells(JSON.stringify({ labels: [{ block: "b1", decision: true, action: "yes" }, { block: "b2", decision: false, action: true }, { block: "b2", decision: true, action: true }, { block: "zz", decision: true, action: true }] }), packet);
    expect(a.cells.get("b1")).toEqual({ decision: true, action: null });
    expect(a.cells.get("b2")).toEqual({ decision: null, action: true });
    expect(a.missing).toBe(2);
    expect(parseCells(null, packet).missing).toBe(4);
    expect(parseCells("garbage", packet).missing).toBe(4);
  });
  test("routing: frozen.JUDGE_FOR on label packets, both judges on check packets", async () => {
    const built = buildLabelPackets({ stage: 1, seed: SEED, briefs: BRIEFS, rows: [...allRows("opus"), ...allRows("sol"), ...allRows("particle")] });
    const call = stubCaller();
    const { labels } = await judgePackets({ map: built.map, packets: new Map(built.packets.map((p) => [p.id, p])), call, effort: "medium" });
    for (const l of labels) expect(l.judge).toBe(JUDGE_FOR[built.map.packets[l.packet]!.model!]);
    expect(new Set(labels.map((l) => l.judge))).toEqual(new Set(["astra", "opus"]));
    expect(labels.every((l) => l.effort === "medium" && l.model_version === "v1")).toBe(true);
    const check = buildCheckPackets({ seed: SEED, briefs: BRIEFS, rows: allRows("opus"), answers: [], taken: [built.map] });
    const gold = await judgePackets({ map: check.map, packets: new Map(check.packets.map((p) => [p.id, p])), call, effort: "max" });
    const per = new Map<string, Set<string>>();
    for (const l of gold.labels) per.set(l.packet, (per.get(l.packet) ?? new Set()).add(l.judge));
    for (const s of per.values()) expect(s).toEqual(new Set(["astra", "opus"]));
  });
  test("effort: medium in production, max allowed only on a check map", async () => {
    const built = buildLabelPackets({ stage: 1, seed: SEED, briefs: BRIEFS, rows: allRows("opus") });
    const pk = new Map(built.packets.map((p) => [p.id, p]));
    await expect(judgePackets({ map: built.map, packets: pk, call: stubCaller(), effort: "max" })).rejects.toThrow(/^E_OHR_JUDGE_INPUT/);
    const seen: string[] = [];
    const call = stubCaller();
    await judgePackets({ map: built.map, packets: pk, call: async (r) => (seen.push(r.effort), call(r)), effort: "medium" });
    expect(new Set(seen)).toEqual(new Set(["medium"]));
  });
  test("a packet with a missing or unparsable cell is resent once, whole, with the fixed note; the resend's answer stands", async () => {
    const call = stubCaller({ garble: 1 });
    const prompts: string[] = [];
    const lab = labeller(async (r) => (prompts.push(r.prompt), call(r)));
    const out = await lab({ judge: "astra", brief: "a", items: itemsOf("a", BRIEFS), blocks: [{ id: "k1", block: block(BRIEFS.get("a")!.key.call, BRIEFS.get("a")!.key.actions[0]!) }], effort: "medium", label: "t" });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe(prompts[0] + RESEND_NOTE);
    expect(out.get("k1")).toEqual({ decision: true, action: true, model_version: "v1" });
  });
  test("a cell still missing after the one resend is null, and a block with no cell is a null entry", async () => {
    const call = stubCaller({ garble: 2 });
    const lab = labeller(call);
    const out = await lab({ judge: "opus", brief: "a", items: itemsOf("a", BRIEFS), blocks: [{ id: "k1", block: block("x", "y") }], effort: "max", label: "t" });
    expect(call.calls).toBe(2);
    expect(out.get("k1")).toBeNull();
    const partial = labeller(stubCaller({ skip: (t) => t.startsWith("skip") }));
    const two = await partial({ judge: "opus", brief: "a", items: itemsOf("a", BRIEFS), blocks: [{ id: "k1", block: block("skip", "y") }, { id: "k2", block: block("x", "y") }], effort: "medium", label: "t" });
    expect(two.get("k1")).toBeNull();
    expect(two.get("k2")).toEqual({ decision: false, action: false, model_version: "v1" });
  });
});
