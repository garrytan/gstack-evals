// Value: protects=section 7's judge brief, audit prompt, routing, effort, resend and tie-break rules, which produce every W label.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RESEND_NOTE, type Caller } from "../../../lanes/product-value/judge.ts";
import { PREREG, SEED } from "../../../lanes/office-hours-founder/frozen.ts";
import { block, row, stubCaller, unit } from "../../../lanes/office-hours-founder/score/fixtures.ts";
import { CELLS, judgePackets, labeller, loadPrompt, parseCells, PROMPT_SHA256 } from "../../../lanes/office-hours-founder/score/judge.ts";
import { buildCheckPackets, buildLabelPackets, type PacketFile } from "../../../lanes/office-hours-founder/score/packets.ts";
import type { SessionRow } from "../../../lanes/office-hours-founder/types.ts";

const twin = (id: string, o: Parameters<typeof unit>[1] = {}) => new Map([[id, unit(id, { set: "twin", ...o })]]);
async function run(rows: SessionRow[], o: { units?: ReturnType<typeof twin>; call?: Caller; check?: boolean } = {}) {
  const units = o.units ?? twin("u1");
  const built = (o.check ? buildCheckPackets : buildLabelPackets)({ stage: 1, seed: SEED, units, rows });
  const sent: Array<{ judge: string; effort: string; prompt: string }> = [];
  const stub = o.call ?? stubCaller();
  const call: Caller = (c) => (sent.push(c), stub(c));
  return { built, sent, ...(await judgePackets({ map: built.map, packets: new Map(built.packets.map((p) => [p.id, p])), call, concurrency: 1 })) };
}

describe("the frozen prompts", () => {
  test("each prompt matches its pinned sha256 and holds the packet slot", () => {
    for (const name of Object.keys(PROMPT_SHA256) as Array<keyof typeof PROMPT_SHA256>) expect(loadPrompt(name)).toContain("{{PACKET}}");
  });
  test("both carry section 7's label rules, and three examples for each label", () => {
    const prereg = readFileSync(PREREG, "utf8");
    const rules = [
      "the specific customer the item records (the role and the kind of organization, or the specific user group)",
      'A category alone doesn\'t match ("small businesses" doesn\'t match "office managers at two-chair dental practices"',
      "names three or more distinct customer groups or offerings as things to start with",
      "names a concrete action the founder could finish within seven days, and it is the same kind of action, toward the same customer or offering, as the key's",
      "the part of the opening plan the pivot item says the evidence contradicts",
    ];
    for (const r of rules) expect(prereg).toContain(r);
    for (const name of ["brief", "audit"] as const) {
      const p = loadPrompt(name);
      for (const r of rules) expect(p.toLowerCase()).toContain(r.toLowerCase());
      for (const label of CELLS) expect(p).toMatch(new RegExp("\\n" + label + "\\n1\\. (?:Match|No match)\\..*\\n2\\. (?:Match|No match)\\..*\\n3\\. (?:Match|No match)\\."));
    }
    expect(loadPrompt("audit")).toContain("quote the exact words of the block behind it");
    expect(loadPrompt("brief")).not.toContain("quote");
  });
});

describe("routing and effort", () => {
  test("Astra labels Opus blocks and Opus labels Sol blocks, at medium effort, with the brief", async () => {
    const { sent, labels } = await run([row({ unit: "u1" }), row({ unit: "u1", model: "sol", arm: "lens" })]);
    expect(sent.map((s) => s.judge).sort()).toEqual(["astra", "opus"]);
    expect(new Set(sent.map((s) => s.effort))).toEqual(new Set(["medium"]));
    expect(sent.every((s) => s.prompt.startsWith(loadPrompt("brief").split("{{PACKET}}")[0]!))).toBe(true);
    expect(labels.every((l) => l.effort === "medium" && l.model_version === l.judge + "-v1" && l.model_id === "stub:" + l.judge)).toBe(true);
  });
  test("particle-1 blocks go to Astra and Opus, Gemini only on a split, and the panel takes the majority", async () => {
    const agree = await run([row({ unit: "u1", model: "particle" })]);
    expect(agree.sent.map((s) => s.judge)).toEqual(["astra", "opus"]);
    expect(agree.labels.filter((l) => l.judge === "panel").every((l) => l.customer !== null)).toBe(true);
    const split = await run([row({ unit: "u1", model: "particle" })], { call: stubCaller((j, _a, _b, c) => (j === "opus" ? { ...c, next: !c.next } : j === "gemini" ? { ...c, next: false } : c)) });
    expect(split.sent.map((s) => s.judge)).toEqual(["astra", "opus", "gemini"]);
    const panel = split.labels.filter((l) => l.judge === "panel");
    expect(panel.every((l) => l.next === false)).toBe(true);
    expect(split.labels.filter((l) => l.judge === "gemini").every((l) => l.next === false && l.customer === null)).toBe(true);
    expect(panel[0]!.model_id).toBe("panel:stub:astra+stub:opus+stub:gemini");
  });
  test("a tie-break that leaves a split open is retried once, then the cell stays unlabelled", async () => {
    const r = await run([row({ unit: "u1", model: "particle" })], { call: stubCaller((j, _a, _b, c) => (j === "opus" ? { ...c, alt: !c.alt } : j === "gemini" ? { ...c, alt: undefined } : c)) });
    expect(r.sent.map((s) => s.judge)).toEqual(["astra", "opus", "gemini", "gemini"]);
    expect(r.sent[3]!.prompt.endsWith(RESEND_NOTE)).toBe(true);
    expect(r.labels.filter((l) => l.judge === "panel").every((l) => l.alt === null && l.customer !== null)).toBe(true);
  });
  test("the check pass sends the audit prompt to Astra and Opus at max effort, with no panel, and keeps the quotes", async () => {
    const quoted = stubCaller();
    const call: Caller = async (c) => {
      const r = await quoted(c);
      const obj = JSON.parse(r.text!);
      for (const l of obj.labels) l.quotes = { customer: "bicycle repair shops" };
      return { ...r, text: JSON.stringify(obj) };
    };
    const { sent, labels } = await run([row({ unit: "u1", model: "particle" })], { check: true, call });
    expect(sent.map((s) => [s.judge, s.effort])).toEqual([["astra", "max"], ["opus", "max"]]);
    expect(labels.some((l) => l.judge === "panel")).toBe(false);
    expect(labels.every((l) => l.quotes?.customer === "bicycle repair shops")).toBe(true);
  });
});

describe("cells", () => {
  const p: PacketFile = { id: "p", prompt: "brief", items: { customer: "c", wedge: "w", first_move: "f", pivot: "none" }, doubt: false, blocks: [{ id: "b1", text: "", first_move_full: "" }, { id: "b2", text: "", first_move_full: "" }] };
  const full = { customer: true, wedge: false, multi_target: false, next: true, alt: false };
  test("the doubt cell is needed only when the pivot isn't none", () => {
    const text = JSON.stringify({ labels: [{ block: "b1", ...full }, { block: "b2", ...full }] });
    expect(parseCells(text, p, false).missing).toBe(0);
    expect(parseCells(text, { ...p, doubt: true }, false).missing).toBe(2);
    expect(parseCells(text, p, false).cells.get("b1")!.doubt).toBeNull();
  });
  test("a missing block, a non-boolean cell or two entries that disagree read missing", () => {
    const text = JSON.stringify({ labels: [{ block: "b1", ...full, next: "yes" }, { block: "b1", ...full, customer: false }, { block: "zz", ...full }] });
    const r = parseCells("Here you go:\n```json\n" + text + "\n```", p, false);
    expect(r.cells.get("b1")).toMatchObject({ customer: null, next: null, wedge: false });
    expect(r.missing).toBe(2 + 5);
  });
  test("a no-pivot unit never resends for doubt, and its doubt stays null", async () => {
    const { sent, labels } = await run([row({ unit: "u1" })], { units: twin("u1", { key: { pivot: "none" } }), call: stubCaller((_j, _a, _b, c) => ({ ...c, doubt: undefined })) });
    expect(sent).toHaveLength(1);
    expect(labels.every((l) => l.doubt === null)).toBe(true);
  });
});

test("the Labeller labels with the same brief and returns one record per block", async () => {
  const prompts: string[] = [];
  const stub = stubCaller();
  const label = labeller((c) => (prompts.push(c.prompt), stub(c)));
  const out = await label({ judge: "opus", unit: "u1", items: { customer: "Owners of small bicycle repair shops", wedge: "A weekly parts reorder list", first_move: "Call three shop owners", pivot: "none" }, blocks: [{ id: "x1", block: block("Sell a weekly parts reorder list to owners of small bicycle repair shops") }, { id: "x2", block: block("Build a platform") }], effort: "max", label: "authoring:u1" });
  expect(prompts[0]!.startsWith(loadPrompt("brief").split("{{PACKET}}")[0]!)).toBe(true);
  expect(out.get("x1")).toMatchObject({ judge: "opus", effort: "max", model_version: "opus-v1", customer: true, wedge: true, doubt: null });
  expect(out.get("x2")).toMatchObject({ customer: false, wedge: false });
});
