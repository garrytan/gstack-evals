// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's blind judge packets (prereg section 5, and section 12's judge check) and the map from
// their random ids back to sessions and anchors. The rules this file holds:
// - label: one packet per (stage, brief, model): that model's blocks for the brief from all three arms, the three stock
//   rows (frozen.STOCK_ROWS) and one near-miss row, the contrast call written into a block by script (the twin's call on a
//   paired brief, the key's wrong call on an unpaired one), routed to frozen.JUDGE_FOR[model].
// - check: section 12's judge check, its own map. The stage 1 label packets again under new ids, plus one anchor packet
//   per brief holding authoring's answers in block form, the oracle block on a calibration brief, the near-miss row and
//   the stock rows. Astra and Opus both label every check packet: at max effort for gold, at medium for the check itself.
// - A packet holds its brief's KeyItems and blocks under random ids, never a sheet, an opening, a fact id, a brief id, an
//   arm or a transcript. Every id comes from seeded random draws (frozen.SEED); blocks and packets are in seeded order.
// - Packet ids and block ids are unique across every map a stage uses (assertUnique), and a check build skips every id an
//   earlier map holds.
// - Scripted blocks (stock, near-miss, oracle, answers) pass through the block parser, so they are cut at 40 words like
//   any session block. The map is written outside the packets folder, and neither may sit inside the repository.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomId, seededRandom, shuffle } from "../../product-value/stats.ts";
import { JUDGE_FOR, STOCK_ROWS } from "../frozen.ts";
import type { Block, BriefMeta, JudgeKey, Key, KeyItems, ManifestEntry, ModelId, SessionRow } from "../types.ts";
import { parseBlock, renderBlock } from "./block.ts";

export interface Brief {
  key: Key;
  meta: BriefMeta;
}

/** Authoring's full-information and opening-only answers, in block form (section 12). */
export interface CheckAnswer {
  brief: string;
  author: string;
  source: "full" | "opening";
  block: Block;
}

export type BlockRef =
  | { kind: "session"; session: ManifestEntry }
  | { kind: "stock"; row: 1 | 2 | 3 }
  | { kind: "near-miss" }
  | { kind: "oracle" }
  | { kind: "answer"; author: string; source: "full" | "opening" };

export interface PacketMeta {
  id: string;
  role: "label" | "check" | "anchor";
  stage: 1 | 2;
  brief: string;
  /** The model whose blocks the packet holds; null on an anchor packet. */
  model: ModelId | null;
  judges: readonly JudgeKey[];
  blocks: Record<string, BlockRef>;
}

/** What a judge reads. */
export interface PacketFile {
  id: string;
  items: KeyItems;
  blocks: Array<{ id: string; block: Block }>;
}

export interface PacketMap {
  version: 1;
  kind: "label" | "check";
  stage: 1 | 2;
  seed: number;
  packets: Record<string, PacketMeta>;
}

export interface Built {
  packets: PacketFile[];
  map: PacketMap;
}

const fail = (code: string, msg: string): never => {
  throw new Error(code + " " + msg);
};

/** A brief's key items: the call, the action classes and the contrast call. */
export function itemsOf(id: string, briefs: ReadonlyMap<string, Brief>): KeyItems {
  const b = briefs.get(id) ?? fail("E_OHR_PACKET_INPUT", "brief " + id + " is not in the briefs");
  const twin = b.key.twin === null ? null : briefs.get(b.key.twin) ?? fail("E_OHR_PACKET_INPUT", "brief " + id + " names twin " + b.key.twin + ", which is not in the briefs");
  const contrast = twin ? twin.key.call : b.key.wrong_call ?? fail("E_OHR_PACKET_INPUT", "unpaired brief " + id + " has no wrong call for its near-miss row");
  return { call: b.key.call, actions: [...b.key.actions], contrast };
}

/** A scripted block, cut at 40 words by the same parser the sessions pass through. */
export function scripted(b: Block): Block {
  const p = parseBlock(renderBlock(b));
  return p.kind === "block" ? p.block : fail("E_OHR_PACKET_INPUT", "a scripted block does not parse: " + p.reason);
}

export const nearMiss = (items: KeyItems): Block => scripted({ decision: items.contrast, next_action: items.actions[0]!, why: "" });
export const oracle = (items: KeyItems): Block => scripted({ decision: items.call, next_action: items.actions[0]!, why: "" });
const stock = (): Array<{ ref: BlockRef; block: Block }> => STOCK_ROWS.map((s) => ({ ref: { kind: "stock", row: s.row }, block: scripted(s) }));
export const sessionKey = (s: ManifestEntry): string => [s.stage, s.brief, s.model, s.arm].join(":");
const entry = (r: SessionRow): ManifestEntry => ({ stage: r.stage, brief: r.brief, model: r.model, arm: r.arm });
const byKey = <T>(m: Map<string, T>): Array<[string, T]> => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

interface Draft {
  role: PacketMeta["role"];
  brief: string;
  model: ModelId | null;
  judges: readonly JudgeKey[];
  items: KeyItems;
  blocks: Array<{ ref: BlockRef; block: Block }>;
}

/** The label drafts of one stage: one per (brief, model) with at least one block. */
function labelDrafts(stage: 1 | 2, briefs: ReadonlyMap<string, Brief>, rows: readonly SessionRow[]): Draft[] {
  const groups = new Map<string, SessionRow[]>();
  for (const r of rows) {
    if (r.stage !== stage) continue;
    if (!briefs.has(r.brief)) fail("E_OHR_PACKET_INPUT", "a session row names brief " + r.brief + ", which is not in the briefs");
    if (r.end !== "block" || r.block?.kind !== "block") continue;
    const g = r.brief + "|" + r.model;
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  return byKey(groups).map(([, rs]) => {
    const { brief, model } = rs[0]!;
    const seen = new Set<string>();
    for (const r of rs) if (seen.has(r.arm) || !seen.add(r.arm)) fail("E_OHR_PACKET_INPUT", "two sessions of arm " + r.arm + " on brief " + brief + " and model " + model);
    const items = itemsOf(brief, briefs);
    const sessions = [...rs].sort((a, b) => (a.arm < b.arm ? -1 : 1)).map((r) => ({ ref: { kind: "session", session: entry(r) } as BlockRef, block: (r.block as Extract<SessionRow["block"], { kind: "block" }>).block }));
    return { role: "label" as const, brief, model, judges: [JUDGE_FOR[model]], items, blocks: [...sessions, ...stock(), { ref: { kind: "near-miss" }, block: nearMiss(items) }] };
  });
}

function seal(d: Draft, built: Built, rng: () => number, taken: Set<string>): void {
  const id = randomId(rng, taken);
  const blocks = shuffle(d.blocks.map((b) => ({ ...b, id: randomId(rng, taken) })), rng);
  built.packets.push({ id, items: d.items, blocks: blocks.map((b) => ({ id: b.id, block: b.block })) });
  built.map.packets[id] = { id, role: d.role, stage: built.map.stage, brief: d.brief, model: d.model, judges: d.judges, blocks: Object.fromEntries(blocks.map((b) => [b.id, b.ref])) };
}

const takenBy = (maps: readonly PacketMap[]): Set<string> => new Set(maps.flatMap((m) => Object.values(m.packets).flatMap((p) => [p.id, ...Object.keys(p.blocks)])));

/** Section 5's production packets for one stage, routed by frozen.JUDGE_FOR. */
export function buildLabelPackets(inp: { stage: 1 | 2; seed: number; briefs: ReadonlyMap<string, Brief>; rows: readonly SessionRow[]; taken?: readonly PacketMap[] }): Built {
  const rng = seededRandom(inp.seed + inp.stage);
  const taken = takenBy(inp.taken ?? []);
  const built: Built = { packets: [], map: { version: 1, kind: "label", stage: inp.stage, seed: inp.seed, packets: {} } };
  for (const d of labelDrafts(inp.stage, inp.briefs, inp.rows)) seal(d, built, rng, taken);
  return { ...built, packets: shuffle(built.packets, rng) };
}

export const CHECK_JUDGES: readonly JudgeKey[] = ["astra", "opus"];

/** Section 12's judge check packets: stage 1's label packets again, and one anchor packet per brief. */
export function buildCheckPackets(inp: { seed: number; briefs: ReadonlyMap<string, Brief>; rows: readonly SessionRow[]; answers: readonly CheckAnswer[]; taken?: readonly PacketMap[] }): Built {
  const rng = seededRandom(inp.seed + 10);
  const taken = takenBy(inp.taken ?? []);
  const built: Built = { packets: [], map: { version: 1, kind: "check", stage: 1, seed: inp.seed, packets: {} } };
  for (const d of labelDrafts(1, inp.briefs, inp.rows)) seal({ ...d, role: "check", judges: CHECK_JUDGES }, built, rng, taken);
  for (const a of inp.answers) if (!inp.briefs.has(a.brief)) fail("E_OHR_PACKET_INPUT", "an answer names brief " + a.brief + ", which is not in the briefs");
  for (const [brief, b] of byKey(new Map(inp.briefs))) {
    const items = itemsOf(brief, inp.briefs);
    const answers = inp.answers.filter((a) => a.brief === brief).sort((x, y) => (x.author + x.source < y.author + y.source ? -1 : 1)).map((a) => ({ ref: { kind: "answer", author: a.author, source: a.source } as BlockRef, block: scripted(a.block) }));
    const anchors = [...(b.meta.set === "calibration" ? [{ ref: { kind: "oracle" } as BlockRef, block: oracle(items) }] : []), { ref: { kind: "near-miss" } as BlockRef, block: nearMiss(items) }];
    if (b.meta.set !== "calibration" && !answers.length) continue;
    seal({ role: "anchor", brief, model: null, judges: CHECK_JUDGES, items, blocks: [...answers, ...anchors, ...stock()] }, built, rng, taken);
  }
  return { ...built, packets: shuffle(built.packets, rng) };
}

/** Refuses any packet id or block id that appears twice across the maps (the founder lane never checked this). */
export function assertUnique(maps: readonly PacketMap[]): void {
  const seen = new Set<string>();
  for (const m of maps)
    for (const p of Object.values(m.packets))
      for (const id of [p.id, ...Object.keys(p.blocks)]) {
        if (seen.has(id)) fail("E_OHR_ID_CLASH", "id " + id + " appears twice across the packet maps");
        seen.add(id);
      }
}

const REPO = resolve(import.meta.dir, "..", "..", "..");
const real = (p: string): string => {
  let cur = resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur) && dirname(cur) !== cur) {
    rest.unshift(cur.slice(dirname(cur).length + 1));
    cur = dirname(cur);
  }
  return join(realpathSync(cur), ...rest);
};
export function refuseInRepo(what: string, p: string): void {
  const r = real(p), root = realpathSync(REPO);
  if (r === root || r.startsWith(root + sep)) fail("E_OHR_PACKET_INPUT", what + " " + p + " is inside the repository; packets and maps stay sealed outside it");
}

/** Writes one file per packet into dir and the map to mapPath, which must sit outside dir; both outside the repo. */
export function writePackets(built: Built, dir: string, mapPath: string): void {
  if ((resolve(mapPath) + sep).startsWith(resolve(dir) + sep)) fail("E_OHR_PACKET_INPUT", "the packet map " + mapPath + " must sit outside the packets folder " + dir);
  refuseInRepo("the packets folder", dir);
  refuseInRepo("the packet map", mapPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const p of built.packets) writeFileSync(join(dir, p.id + ".json"), JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(mapPath, JSON.stringify(built.map, null, 2) + "\n", { mode: 0o600 });
}

export function readPackets(dir: string): Map<string, PacketFile> {
  if (!existsSync(dir)) fail("E_OHR_PACKET_INPUT", "packets folder " + dir + " does not exist");
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const p = JSON.parse(readFileSync(join(dir, f), "utf8")) as PacketFile;
    return [p.id, p];
  }));
}

/** The text a judge reads after its prompt. */
export const renderPacket = (p: Pick<PacketFile, "items" | "blocks">): string =>
  ["KEY ITEMS", "Call: " + p.items.call, "Contrast: " + p.items.contrast, ...p.items.actions.map((a, i) => "Action " + (i + 1) + ": " + a), "", "BLOCKS", ...p.blocks.flatMap((b) => ["", "Block " + b.id, renderBlock(b.block)])].join("\n");
