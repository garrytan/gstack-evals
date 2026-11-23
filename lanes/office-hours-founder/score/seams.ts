// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's dry-run seams (prereg section 14, start rule 7). Each drives one frozen rule on one side of its edge
// through the real packets, judge, scorer, anchors and detectors, on the invented fixtures in fixtures.ts, with the stub
// judge in place of any model.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESEND_NOTE, type Caller } from "../../product-value/judge.ts";
import { SEED } from "../frozen.ts";
import { normalizeBlock, parseFirstMove } from "../parse.ts";
import type { Seam, SessionRow } from "../types.ts";
import { EXPOSED, FENCED, KEY, block, row, stubCaller, transcript, unit } from "./fixtures.ts";
import { designDoc, exposure, loaded } from "./exposure.ts";
import { judgePackets } from "./judge.ts";
import { sellSentence } from "./oracle.ts";
import { buildLabelPackets, drawGold, goldFloor, shuffledKeys, type GoldRef } from "./packets.ts";
import { constructed, realReadout, scoreSessions, type ScoreUnit } from "./score.ts";
import { seededRandom } from "../../product-value/stats.ts";

const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => w + i).join(" ");
const sell = "Sell " + KEY.wedge.toLowerCase() + " to " + KEY.customer.toLowerCase();

/** Packets, the stub judge and the scorer, end to end, for stage 1 rows. */
export async function judged(units: Map<string, ScoreUnit>, rows: SessionRow[], call: Caller = stubCaller()) {
  const built = buildLabelPackets({ stage: 1, seed: SEED, units, rows });
  const { labels } = await judgePackets({ map: built.map, packets: new Map(built.packets.map((p) => [p.id, p])), call, concurrency: 1 });
  return { built, labels, scored: scoreSessions({ rows, units, maps: [built.map], labels }) };
}

const one = (id = "u1", o: Parameters<typeof unit>[1] = {}) => new Map([[id, unit(id, o)]]);
const check = (ok: boolean, detail: string) => ({ ok, detail });

async function wFor(first_move: string, o: { units?: Map<string, ScoreUnit>; model?: SessionRow["model"]; call?: Caller } = {}) {
  const units = o.units ?? one();
  const { scored } = await judged(units, [row({ unit: [...units.keys()][0]!, model: o.model ?? "opus", block: block(first_move) })], o.call);
  return scored[0]!;
}

const fixedGold = (credited: number, oracle: number, not: number): GoldRef[] => [
  ...Array.from({ length: credited }, (_, i) => ({ packet: "p", block: "c" + i, item: "customer" as const, gold: true, oracle: false, model: "opus" as const })),
  ...Array.from({ length: oracle }, (_, i) => ({ packet: "p", block: "o" + i, item: "customer" as const, gold: true, oracle: true, model: "opus" as const })),
  ...Array.from({ length: not }, (_, i) => ({ packet: "p", block: "n" + i, item: "wedge" as const, gold: false, oracle: false, model: "opus" as const })),
];

function withStateRoot<T>(assignment: string, f: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "of-score-"));
  try {
    mkdirSync(join(root, "projects", "shop"), { recursive: true });
    writeFileSync(join(root, "projects", "shop", "user-main-design-20261109.md"), "# Design: Shop\n\n## The Assignment\n" + assignment + "\n## What I noticed about how you think\n- It.\n");
    return f(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const PHASE_2A = ".claude/skills/gstack/office-hours/sections/phase-2a-startup-diagnostic.md";

export const seams: Seam[] = [
  {
    name: "score: normalization strips markdown and numbering before a judge reads a block",
    run: () => {
      const built = buildLabelPackets({ stage: 1, seed: SEED, units: one("u1", { set: "twin" }), rows: [row({ unit: "u1", block: block("**1. Sell** `a weekly parts reorder list` to [owners](https://example.com)") })] });
      const text = built.packets.find((p) => built.map.packets[p.id]!.role === "label")!.blocks.map((b) => b.text).join("\n");
      return check(text.includes("First move: Sell a weekly parts reorder list to owners") && !/[*`\[]/.test(text.split("\n").find((l) => l.includes("reorder"))!), text.split("\n")[0]!);
    },
  },
  { name: "score: a first move of 40 words is not cut", run: () => { const n = normalizeBlock({ first_move: words(40), next_action: "x", other_moves: [], doubt: "" }); return check(!n.cut.first_move && n.words.first_move === 40, "cut " + n.cut.first_move); } },
  { name: "score: a first move of 41 words is cut at its 40th", run: () => { const n = normalizeBlock({ first_move: words(41), next_action: "x", other_moves: [], doubt: "" }); return check(n.cut.first_move && n.words.first_move === 40 && n.first_move_full.endsWith("word40"), "cut " + n.cut.first_move); } },
  { name: "score: the lenient parse reads a block with trailing commas", run: () => { const p = parseFirstMove(['```first-move\n{"first_move": "x", "next_action": "y", "other_moves": ["a",], "doubt": "",}\n```']); return check(p.kind === "block" && JSON.stringify(p.lenient) === '["commas"]', p.kind); } },
  { name: "score: the lenient parse refuses a block with no next_action", run: () => { const p = parseFirstMove(['```first-move\n{"first_move": "x", "other_moves": [], "doubt": ""}\n```']); return check(p.kind === "no-block", p.kind); } },
  { name: "score: a first move with two targets keeps its W", run: async () => { const s = await wFor(sell + ", target1 and target2."); return check(s.W === 1, "W " + s.W); } },
  { name: "score: a first move with three targets loses its W (multi-target)", run: async () => { const s = await wFor(sell + ", target1, target2 and target3."); return check(s.W === 0, "W " + s.W); } },
  {
    name: "score: a third target after word 40 still voids W, read from the uncut first move",
    run: async () => {
      const fm = sell + " target1 target2 " + words(40, "x") + " target3.";
      const s = await wFor(fm);
      return check(s.W === 0 && !block(fm).block.first_move.includes("target3"), "W " + s.W);
    },
  },
  { name: "score: an oracle sentence of 40 words is written", run: () => check(sellSentence(words(19), words(19)) !== null, "40 words") },
  { name: "score: an oracle sentence of 41 words is not written", run: () => check(sellSentence(words(20), words(19)) === null, "41 words") },
  {
    name: "score: a credited customer with a missing multi-target cell reads missing",
    run: async () => {
      const s = await wFor(sell + ".", { call: stubCaller((_j, _a, _b, c) => ({ ...c, multi_target: undefined })) });
      return check(s.W === null && s.W_customer === null, "W " + s.W);
    },
  },
  { name: "score: a credited item that is mentioned earns no W", run: async () => { const s = await wFor("Sell repair help to " + KEY.customer.toLowerCase() + ".", { units: one("u1", { primary: ["wedge"], mentioned: ["customer"] }) }); return check(s.W === 0, "W " + s.W); } },
  { name: "score: the same credited item earns W when it is primary", run: async () => { const s = await wFor("Sell repair help to " + KEY.customer.toLowerCase() + "."); return check(s.W === 1, "W " + s.W); } },
  {
    name: "score: the shuffled-key derangement gives every unit another unit's key",
    run: () => {
      const all = new Map(["a", "b", "c", "d", "e"].map((id, i) => [id, unit(id, { type: i < 2 ? "B2B" : i < 4 ? "consumer" : "marketplace" })]));
      const sigma = shuffledKeys([...all.keys()], all, seededRandom(SEED));
      return check(sigma.size === 5 && [...sigma].every(([a, b]) => a !== b) && new Set(sigma.values()).size === 5, JSON.stringify([...sigma]));
    },
  },
  {
    name: "score: the shuffled key comes from the same type where one exists",
    run: () => {
      const all = new Map(["a", "b", "c", "d"].map((id, i) => [id, unit(id, { type: i < 2 ? "B2B" : "consumer" })]));
      const sigma = shuffledKeys([...all.keys()], all, seededRandom(SEED));
      return check([...sigma].every(([a, b]) => all.get(a)!.meta.type === all.get(b)!.meta.type), JSON.stringify([...sigma]));
    },
  },
  ...([true, false] as const).map((vote) => ({
    name: "score: a particle-1 split on customer settles on Gemini's third vote (" + (vote ? "credited" : "not credited") + ")",
    run: async () => {
      const call = stubCaller((j, _a, _b, c) => (j === "opus" ? { ...c, customer: false } : j === "gemini" ? { ...c, customer: vote } : c));
      const s = await wFor("Sell repair help to " + KEY.customer.toLowerCase() + ".", { model: "particle", call });
      return check(s.W === (vote ? 1 : 0), "W " + s.W);
    },
  })),
  {
    name: "score: a packet with a missing cell is resent once, whole, with the fixed note",
    run: async () => {
      const prompts: string[] = [];
      const stub = stubCaller((_j, a, _b, c) => (a === 1 ? { ...c, next: undefined } : c));
      const call: Caller = (c) => (prompts.push(c.prompt), stub(c));
      const { scored, labels } = await judged(one("u1", { set: "twin" }), [row({ unit: "u1" })], call);
      return check(prompts.length === 2 && !prompts[0]!.endsWith(RESEND_NOTE) && prompts[1] === prompts[0] + RESEND_NOTE && scored[0]!.N === 1 && labels.every((l) => l.next !== null), prompts.length + " sends");
    },
  },
  {
    name: "score: a cell still missing after the resend stays unlabelled",
    run: async () => {
      const { scored } = await judged(one("u1", { set: "twin" }), [row({ unit: "u1" })], stubCaller((_j, _a, _b, c) => ({ ...c, next: undefined })));
      return check(scored[0]!.N === null && scored[0]!.W === 1, "N " + scored[0]!.N);
    },
  },
  { name: "score: x1 reads two forcing questions before the block", run: () => check(exposure(transcript(EXPOSED.map((t) => [t])), null, "pre-product").x1, "x1") },
  { name: "score: x1 misses one forcing question, and one asked after the block", run: () => check(!exposure(transcript([[EXPOSED[0]!], ["Advice.\n\n" + FENCED + "\n\nWhat are your users doing right now to solve this?"]]), null, "pre-product").x1, "x1") },
  { name: "score: x2 reads a PREMISES: block of numbered statements", run: () => check(exposure(transcript(EXPOSED.map((t) => [t])), null, null).x2, "x2") },
  { name: "score: x2 misses premises written as prose", run: () => check(!exposure(transcript([["Premises: single shops buy, and they pay for reorders.\n\n" + FENCED]]), null, null).x2, "x2") },
  { name: "score: x3 reads APPROACH A:, APPROACH B: and a RECOMMENDATION: line", run: () => check(exposure(transcript(EXPOSED.map((t) => [t])), null, null).x3, "x3") },
  { name: "score: x3 misses approaches written in lower case with no recommendation line", run: () => check(!exposure(transcript([["Approach A: by hand.\nApproach B: an app.\nI recommend A.\n\n" + FENCED]]), null, null).x3, "x3") },
  { name: "score: the load check reads a successful Read of phase-2a", run: () => check(loaded(transcript([[{ read: PHASE_2A, result: "### Operating Principles" }, EXPOSED[0]!]])), "load") },
  { name: "score: the load check misses a Read that failed", run: () => check(!loaded(transcript([[{ read: PHASE_2A, result: "<tool_use_error>File does not exist.</tool_use_error>", error: true }, EXPOSED[0]!]])), "load") },
  { name: "score: the design doc check reads a non-empty The Assignment section", run: () => check(withStateRoot("Call three shop owners this week.\n", designDoc), "design doc") },
  { name: "score: the design doc check misses an empty The Assignment section", run: () => check(!withStateRoot("\n", designDoc), "design doc") },
  {
    name: "score: a real-stratum session stays out of every primary number",
    run: async () => {
      const units = new Map([["c1", unit("c1")], ["r1", unit("r1", { stratum: "real", set: "real" })]]);
      const { scored } = await judged(units, [row({ unit: "c1" }), row({ unit: "r1" })]);
      return check(constructed(scored).map((s) => s.unit).join() === "c1", constructed(scored).length + " primary sessions");
    },
  },
  {
    name: "score: a session that named its source drops its unit from that model's real readout in every arm",
    run: () => {
      const s = (unit: string, model: "opus" | "sol", arm: "none" | "office-hours", named: boolean) => ({ unit, model, arm, stratum: "real", named_source: named }) as unknown as Parameters<typeof realReadout>[0][number];
      const out = realReadout([s("r1", "opus", "none", false), s("r1", "opus", "office-hours", true), s("r1", "sol", "none", false), s("r2", "opus", "none", false)]);
      return check(out.map((x) => x.unit + ":" + x.model).join() === "r1:sol,r2:opus", out.map((x) => x.unit + ":" + x.model).join());
    },
  },
  { name: "score: gold floor met at 40 credited, 40 not credited, 40 blocks", run: () => { const f = goldFloor(fixedGold(40, 0, 40)); return check(f.meets, JSON.stringify(f)); } },
  { name: "score: gold floor short at 39 credited cells", run: () => { const f = goldFloor(fixedGold(39, 0, 40)); return check(!f.meets && f.credited === 39, JSON.stringify(f)); } },
  { name: "score: oracle cells at half the credited gold cells count in full", run: () => { const f = goldFloor(fixedGold(20, 20, 40)); return check(f.meets && f.credited === 40, JSON.stringify(f)); } },
  { name: "score: oracle cells past half the credited gold cells don't count", run: () => { const f = goldFloor(fixedGold(19, 21, 40)); return check(!f.meets && f.credited === 38, JSON.stringify(f)); } },
  { name: "score: stage 2's gold draw keeps oracle cells to half its credited cells", run: () => { const d = drawGold(fixedGold(5, 30, 60), seededRandom(SEED)); return check(d.filter((c) => c.oracle).length === 5 && d.length === 40, d.filter((c) => c.oracle).length + " oracle of " + d.length); } },
];
