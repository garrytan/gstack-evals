// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's blind judge packets (prereg sections 7 and 8) and the map from their random ids back
// to units, arms, passes and anchors. A packet holds one unit's four key items and normalized blocks rendered with
// parse.ts's renderBlock, each with its uncut first move for the multi-target label; never a sheet, an opening or a
// transcript. Blocks and packets get seeded random ids and a seeded order. The map is written outside the packets folder.
//   label      one packet per (stage, unit, model, pass): that model's arm blocks for the unit in that pass across arms,
//              plus the three stock rows.
//   shuffled   beside each label packet: the same blocks and stock rows against a seeded derangement of keys, another
//              unit's key of the same type where one exists, deranged within each stratum.
//   reference  the full-information reference blocks of one (unit, model), all passes, plus the stock rows.
//   pitch      the pitch-only cell's blocks of one (unit, model) across arms, plus the stock rows.
//   anchor     stage 1, one per (calibration unit, model): the oracle block and the near-miss anchors, plus the stock rows.
//              The production judges label anchors so the judge check can score them on gold and near-miss cells.
//   check      the judge check's separate pass: the stage 1 label, reference and anchor packets again under new ids, with
//              the audit prompt, for Astra and Opus.
//   gold       stage 2: 40 gold cells per production judge, drawn under the oracle half cap and inserted blind in packets
//              that look like label packets.
// Reference, pitch and anchor blocks sit in packets of their own so the label packets keep their composition.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CHECK_JUDGES, PRODUCTION_JUDGES } from "../../product-value/packets.ts";
import { derangeByGroup, randomId, seededRandom, shuffle } from "../../product-value/stats.ts";
import { MODELS, STOCK_ROWS } from "../frozen.ts";
import { normalizeBlock, renderBlock } from "../parse.ts";
import type { JudgeKey, Key, KeyItems, ManifestEntry, ModelId, NormalizedBlock, SessionRow, UnitMeta, WItem } from "../types.ts";
import { nearMisses, oracleBlock, type NearMiss } from "./oracle.ts";

export type Role = "label" | "shuffled" | "reference" | "pitch" | "anchor" | "check" | "gold";
export type PromptName = "brief" | "audit";

export type BlockRef =
  | { kind: "session"; unit: string; session: ManifestEntry }
  | { kind: "stock"; unit: string; row: 1 | 2 | 3 }
  | { kind: "oracle"; unit: string }
  | { kind: "near-miss"; unit: string; near: NearMiss; expect: { customer: boolean; wedge: boolean } };

export interface GoldCell {
  block: string;
  item: WItem;
  gold: boolean;
  oracle: boolean;
}

export interface PacketMeta {
  id: string;
  role: Role;
  stage: 1 | 2;
  /** The unit whose key items the packet shows. */
  unit: string;
  /** The unit whose blocks it shows: unit itself, or the shuffled-key partner's source. */
  blocks_unit: string;
  model: ModelId;
  judges: readonly JudgeKey[];
  prompt: PromptName;
  /** Whether the doubt label is asked: the key's pivot isn't none. */
  doubt: boolean;
  blocks: Record<string, BlockRef>;
  gold?: GoldCell[];
}

export interface PacketBlock {
  id: string;
  text: string;
  first_move_full: string;
}

/** What a judge reads. */
export interface PacketFile {
  id: string;
  prompt: PromptName;
  items: KeyItems;
  doubt: boolean;
  blocks: PacketBlock[];
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

export interface Unit {
  key: Key;
  meta: UnitMeta;
}

export interface BuildInput {
  stage: 1 | 2;
  seed: number;
  units: ReadonlyMap<string, Unit>;
  rows: readonly SessionRow[];
}

/** One judge's cells for one block in one packet, as judge.ts writes them. */
export interface Labelled {
  packet: string;
  block: string;
  judge: JudgeKey | "panel";
  customer: boolean | null;
  wedge: boolean | null;
}

export const hasPivot = (key: Pick<Key, "pivot">): boolean => key.pivot.trim().toLowerCase() !== "none";
const itemsOf = (k: Key): KeyItems => ({ customer: k.customer, wedge: k.wedge, first_move: k.first_move, pivot: k.pivot });
export const sessionKey = (s: ManifestEntry): string => [s.stage, s.kind, s.unit, s.model, s.arm, s.pass].join(":");
const entry = (r: SessionRow): ManifestEntry => ({ stage: r.stage, kind: r.kind, unit: r.unit, model: r.model, arm: r.arm, pass: r.pass });

type DraftBlock = { ref: BlockRef; text: string; first_move_full: string };
interface Draft {
  role: Role;
  unit: string;
  blocks_unit: string;
  model: ModelId;
  items: KeyItems;
  doubt: boolean;
  blocks: DraftBlock[];
  gold?: Array<{ index: number; item: WItem; gold: boolean; oracle: boolean }>;
}

const drafted = (ref: BlockRef, b: NormalizedBlock): DraftBlock => ({ ref, text: renderBlock(b), first_move_full: b.first_move_full });
const stockBlocks = (unit: string): DraftBlock[] => STOCK_ROWS.map((s) => drafted({ kind: "stock", unit, row: s.row }, normalizeBlock(s.block)));
const ordered = <T>(m: Map<string, T>): Array<[string, T]> => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** The true-key drafts a stage holds: label, reference and pitch packets, and in stage 1 the anchor packets. */
function drafts(inp: BuildInput): Draft[] {
  const groups = new Map<string, SessionRow[]>();
  for (const r of inp.rows) {
    if (r.stage !== inp.stage || r.end !== "block" || !r.block) continue;
    if (!inp.units.has(r.unit)) throw new Error("E_USAGE session row names unit " + r.unit + ", which is not in the units");
    const g = [r.kind, r.unit, r.model, r.kind === "arm" ? r.pass : 0].join("|");
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const out: Draft[] = [];
  for (const [, rows] of ordered(groups)) {
    const { unit, model, kind } = rows[0]!;
    const key = inp.units.get(unit)!.key;
    const sorted = [...rows].sort((a, b) => (sessionKey(entry(a)) < sessionKey(entry(b)) ? -1 : 1));
    out.push({ role: kind === "arm" ? "label" : kind, unit, blocks_unit: unit, model, items: itemsOf(key), doubt: hasPivot(key), blocks: [...sorted.map((r) => drafted({ kind: "session", unit, session: entry(r) }, r.block!)), ...stockBlocks(unit)] });
  }
  if (inp.stage !== 1) return out;
  for (const [unit, u] of ordered(new Map(inp.units))) {
    if (u.meta.set !== "calibration") continue;
    const oracle = oracleBlock(u.key);
    const anchors = [...(oracle ? [drafted({ kind: "oracle", unit }, oracle)] : []), ...nearMisses(u.key).map((n) => drafted({ kind: "near-miss", unit, near: n.near, expect: n.expect }, n.block))];
    for (const model of MODELS) if (anchors.length && inp.rows.some((r) => r.stage === 1 && r.unit === unit && r.model === model)) out.push({ role: "anchor", unit, blocks_unit: unit, model, items: itemsOf(u.key), doubt: hasPivot(u.key), blocks: [...anchors, ...stockBlocks(unit)] });
  }
  return out;
}

/** Shuffles a draft's blocks under random ids and records its map entry. */
function seal(d: Draft, prompt: PromptName, judges: readonly JudgeKey[], built: Built, rng: () => number, taken: Set<string>): void {
  const id = randomId(rng, taken);
  const blocks = shuffle(d.blocks.map((b, index) => ({ ...b, index, id: randomId(rng, taken) })), rng);
  const idOf = new Map(blocks.map((b) => [b.index, b.id]));
  built.packets.push({ id, prompt, items: d.items, doubt: d.doubt, blocks: blocks.map((b) => ({ id: b.id, text: b.text, first_move_full: b.first_move_full })) });
  built.map.packets[id] = {
    id,
    role: d.role,
    stage: built.map.stage,
    unit: d.unit,
    blocks_unit: d.blocks_unit,
    model: d.model,
    judges,
    prompt,
    doubt: d.doubt,
    blocks: Object.fromEntries(blocks.map((b) => [b.id, b.ref])),
    ...(d.gold ? { gold: d.gold.map((g) => ({ block: idOf.get(g.index)!, item: g.item, gold: g.gold, oracle: g.oracle })) } : {}),
  };
}

const empty = (inp: BuildInput, kind: PacketMap["kind"]): Built => ({ packets: [], map: { version: 1, kind, stage: inp.stage, seed: inp.seed, packets: {} } });

/** The shuffled-key partner of each unit: a seeded derangement by project type, run within each stratum. */
export function shuffledKeys(units: readonly string[], all: ReadonlyMap<string, Unit>, rng: () => number): Map<string, string> {
  const out = new Map<string, string>();
  for (const stratum of ["constructed", "real"] as const) {
    const ids = [...new Set(units)].filter((u) => all.get(u)!.meta.stratum === stratum).sort();
    for (const [a, b] of derangeByGroup(ids, (u) => all.get(u)!.meta.type, rng) ?? []) out.set(a, b);
  }
  return out;
}

/**
 * The production packets of one stage: label packets with a shuffled-key packet beside each, reference, pitch and (stage
 * 1) anchor packets, and in stage 2 the gold packets drawn from the judge check.
 */
export function buildLabelPackets(inp: BuildInput, check?: { map: PacketMap; packets: ReadonlyMap<string, PacketFile>; labels: readonly Labelled[] }): Built {
  const rng = seededRandom(inp.seed);
  const taken = new Set<string>();
  const built = empty(inp, "label");
  const all = drafts(inp);
  const sigma = shuffledKeys(all.filter((d) => d.role === "label").map((d) => d.unit), inp.units, rng);
  for (const d of all) {
    seal(d, "brief", PRODUCTION_JUDGES[d.model], built, rng, taken);
    const other = d.role === "label" ? sigma.get(d.unit) : undefined;
    if (!other) continue;
    const key = inp.units.get(other)!.key;
    seal({ ...d, role: "shuffled", unit: other, items: itemsOf(key), doubt: hasPivot(key) }, "brief", PRODUCTION_JUDGES[d.model], built, rng, taken);
  }
  if (inp.stage === 2) {
    if (!check) throw new Error("E_USAGE stage 2 label packets carry gold cells; pass the judge check's map, packets and labels");
    for (const d of goldDrafts(check, seededRandom(inp.seed + 2))) seal(d, "brief", PRODUCTION_JUDGES[d.model], built, rng, taken);
  }
  return { ...built, packets: shuffle(built.packets, rng) };
}

/** The judge check's separate pass: stage 1's true-key packets again, with the audit prompt, for Astra and Opus. */
export function buildCheckPackets(inp: BuildInput): Built {
  if (inp.stage !== 1) throw new Error("E_USAGE the judge check draws from stage 1 (section 7)");
  const rng = seededRandom(inp.seed + 1);
  const taken = new Set<string>();
  const built = empty(inp, "check");
  for (const d of drafts(inp)) seal({ ...d, role: "check" }, "audit", CHECK_JUDGES, built, rng, taken);
  return { ...built, packets: shuffle(built.packets, rng) };
}

export interface GoldRef extends GoldCell {
  packet: string;
  model: ModelId;
}

/** Section 7: gold cells are the check pass's customer and wedge cells where Astra and Opus agree. */
export function goldCells(map: PacketMap, labels: readonly Labelled[]): GoldRef[] {
  const votes = new Map<string, Partial<Record<JudgeKey, Labelled>>>();
  for (const l of labels) if (map.packets[l.packet]?.role === "check" && (l.judge === "astra" || l.judge === "opus")) votes.set(l.packet + "|" + l.block, { ...votes.get(l.packet + "|" + l.block), [l.judge]: l });
  const out: GoldRef[] = [];
  for (const [packet, p] of Object.entries(map.packets).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (p.role !== "check") continue;
    for (const block of Object.keys(p.blocks).sort())
      for (const item of ["customer", "wedge"] as const) {
        const v = votes.get(packet + "|" + block);
        const a = v?.astra?.[item], o = v?.opus?.[item];
        if (a == null || o == null || a !== o) continue;
        out.push({ packet, block, item, gold: a, oracle: p.blocks[block]!.kind === "oracle", model: p.model });
      }
  }
  return out;
}

export interface GoldFloor {
  credited: number;
  not_credited: number;
  oracle: number;
  blocks: number;
  meets: boolean;
}

/**
 * One production judge's gold floor: at least 40 gold cells of each class from at least 40 distinct blocks, with oracle
 * cells counted only up to half the credited gold cells (no more oracle cells than other credited cells).
 */
export function goldFloor(cells: readonly GoldRef[]): GoldFloor {
  const credited = cells.filter((c) => c.gold && !c.oracle);
  const oracle = cells.filter((c) => c.gold && c.oracle).sort((a, b) => (a.packet + a.block + a.item < b.packet + b.block + b.item ? -1 : 1)).slice(0, credited.length);
  const counted = [...credited, ...oracle, ...cells.filter((c) => !c.gold)];
  const blocks = new Set(counted.map((c) => c.packet + "|" + c.block)).size;
  const f = { credited: credited.length + oracle.length, not_credited: counted.length - credited.length - oracle.length, oracle: oracle.length, blocks };
  return { ...f, meets: f.credited >= 40 && f.not_credited >= 40 && f.blocks >= 40 };
}

/** A production judge's stage 2 gold: 20 credited, oracle cells no more than the other credited ones, then 20 not credited. */
export function drawGold(cells: readonly GoldRef[], rng: () => number): GoldRef[] {
  const real = shuffle(cells.filter((c) => c.gold && !c.oracle), rng).slice(0, 20);
  const oracle = shuffle(cells.filter((c) => c.gold && c.oracle), rng).slice(0, Math.min(20 - real.length, real.length));
  return [...real, ...oracle, ...shuffle(cells.filter((c) => !c.gold), rng).slice(0, 40 - real.length - oracle.length)];
}

function goldDrafts(check: { map: PacketMap; packets: ReadonlyMap<string, PacketFile>; labels: readonly Labelled[] }, rng: () => number): Draft[] {
  if (check.map.kind !== "check") throw new Error("E_USAGE the gold source is not a judge check map");
  const gold = goldCells(check.map, check.labels);
  const out: Draft[] = [];
  for (const model of MODELS) {
    const bySource = new Map<string, GoldRef[]>();
    for (const g of drawGold(gold.filter((c) => c.model === model), rng)) bySource.set(g.packet, [...(bySource.get(g.packet) ?? []), g]);
    for (const [src, cells] of ordered(bySource)) {
      const file = check.packets.get(src);
      if (!file) throw new Error("E_USAGE the judge check's packet " + src + " is missing");
      const meta = check.map.packets[src]!;
      const ids = [...new Set(cells.map((c) => c.block))];
      const stock = file.blocks.filter((b) => meta.blocks[b.id]!.kind === "stock" && !ids.includes(b.id)).map((b) => b.id);
      const blocks = [...ids, ...stock].map((id) => ({ ref: meta.blocks[id]!, text: file.blocks.find((b) => b.id === id)!.text, first_move_full: file.blocks.find((b) => b.id === id)!.first_move_full }));
      out.push({ role: "gold", unit: meta.unit, blocks_unit: meta.blocks_unit, model, items: file.items, doubt: file.doubt, blocks, gold: cells.map((c) => ({ index: ids.indexOf(c.block), item: c.item, gold: c.gold, oracle: c.oracle })) });
    }
  }
  return out;
}

/** Writes one packet file per packet into dir and the map to mapPath, which must sit outside dir. */
export function writePackets(built: Built, dir: string, mapPath: string): void {
  if ((resolve(mapPath) + sep).startsWith(resolve(dir) + sep)) throw new Error("E_USAGE the packet map " + mapPath + " must sit outside the packets folder " + dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const p of built.packets) writeFileSync(join(dir, p.id + ".json"), JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(mapPath, JSON.stringify(built.map, null, 2) + "\n", { mode: 0o600 });
}

export function readPackets(dir: string): Map<string, PacketFile> {
  if (!existsSync(dir)) throw new Error("E_USAGE packets folder " + dir + " does not exist");
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const p = JSON.parse(readFileSync(join(dir, f), "utf8")) as PacketFile;
    return [p.id, p];
  }));
}

/** The text a judge reads after its prompt. */
export const renderPacket = (p: PacketFile): string =>
  ["KEY ITEMS", "Customer: " + p.items.customer, "Wedge: " + p.items.wedge, "First move: " + p.items.first_move, "Pivot: " + p.items.pivot, "", "BLOCKS", ...p.blocks.flatMap((b) => ["", "Block " + b.id, b.text, "First move as written (multi_target only): " + b.first_move_full])].join("\n");
