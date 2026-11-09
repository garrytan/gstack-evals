// Copyright (c) 2026 Garry Tan. MIT License.
// er packets (prereg 2026-11-08-geva-405, sections 7, 8 and 9): the blind packets every judge reads, and the sealed map
// from their random ids back to units, arms, passes and key items. Packets hold text and random ids only. The map, the
// keys and the gold answers stay in files outside the packets directory, and every output path sits outside the repo.
//   label        one packet per (unit, pass, model): that model's normalized checks lists for the unit-pass across arms,
//                the three stock rows and, in stage 1 on a calibration unit, the oracle list; a shuffled-key packet beside
//                each; in stage 2 also the gold packets and the plain rendering.
//   check        the judge check's separate pass: packets that mirror stage 1's label packets, for Astra and Opus.
//   pairwise     pass 1, Opus and Sol only: each skill arm against none and against the lens, and the stock block against
//                none, with plan.md and the merged diff's file list.
//   armguess     30 seeded block lists, one a packet, for Astra.
//   recognition  one packet per unit with the recognition probe's reply as a list, for the production judge of Opus.
// Build-time choices, each tested both ways:
// - Label packets hold every key item (primary, mentioned and generic) and the own-test items, so every secondary reads the
//   same labels. A B item's statement carries "Files and functions: " and its blamed sites.
// - The shuffled-key packet holds the same lists and stock rows against the deranged unit's primary items only.
// - The derangement runs over every keyed unit under --units with at least one primary item, in levels: units of one
//   repository form one seeded cycle; the rest group by type and language, then by type, then all together; a group of two
//   or more is one cycle and its singles fall to the next level. A last lone unit joins a cycle of its own type when one
//   exists, else any cycle, by swapping with a seeded host.
// - Stage 2 gold: per production judge, 20 anticipated and 20 not-anticipated gold cells over B, T and C items, each class
//   drawn round-robin over (arm or anchor, item kind) strata in sorted order, seeded within each stratum. Gold packets
//   number one per 8 of that model's unit-pass label packets (rounded up); the drawn cells group by their check packet
//   and the groups split into that many packets as evenly as possible in sorted order. A gold packet shows the drawn
//   lists, the three stock rows and every item of its source packets; only gold cells count. Each gold packet sits in the
//   judge order after its batch of 8. The plain rendering is a seeded 40 of the gold cells for each model's lists.
// - Pairwise: a side with no block skips the pair. The stock block holds the stock paths and rows 1 and 2 as its checks
//   (16 checks; each row is normalized on its own, so neither row is cut).
// - Arm guess: 30 seeded block rows from the rows given, across models; the probe sees the checks list only.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "./cli.ts";
import { need, parseArgs, PvError, readJson, readRecords, realOf, refuseAliases, refuseInRepo, writeJson } from "../product-value/io.ts";
import { randomId, SEED, seededRandom, shuffle } from "../product-value/stats.ts";
import type { OracleFile } from "./oracle.ts";
import { normalizeChecks, words } from "./parse.ts";
import { stockPaths, stockRow } from "./stock.ts";
import { MODELS_IN_ORDER, SKILL_ARMS, type ArmId, type ItemKind, type Key, type Label, type ModelId, type Row } from "./types.ts";
import { loadUnits, readPlan, readRows, type LoadedUnit } from "./units.ts";

export type JudgeKey = "astra" | "opus" | "gemini";
export type Role = "production" | "shuffled" | "gold" | "check" | "pairwise" | "armguess" | "generic" | "recognition";
export type PromptName = "brief" | "audit" | "pairwise" | "armguess" | "recognition";
export type MapKind = "label" | "check" | "pairwise" | "armguess" | "recognition";

/** Section 7 (R78): Astra labels Claude lists, Opus labels GPT lists, particle-1 lists go to both, Gemini on splits. */
export const PRODUCTION_JUDGES: Readonly<Record<ModelId, readonly JudgeKey[]>> = { opus: ["astra"], sol: ["opus"], particle: ["astra", "opus"] };
export const CHECK_JUDGES: readonly JudgeKey[] = ["astra", "opus"];
export const PAIRWISE_MODELS: readonly ModelId[] = ["opus", "sol"];

export interface ListRef {
  kind: "arm" | "stock" | "oracle" | "probe";
  unit: string;
  model: ModelId;
  pass: number;
  arm?: ArmId;
  session?: string;
  stock?: number;
  words: number;
}
export interface ItemRef {
  unit: string;
  item: string;
  kind: ItemKind | "own";
}
export interface GoldCell {
  list: string;
  item: string;
  gold: boolean;
  /** Stock rows 1 and 2 and oracle lists. */
  anchor: boolean;
  /** An arm's list. */
  real: boolean;
  stratum: string;
}
export interface PacketMeta {
  id: string;
  role: Role;
  stage: 1 | 2;
  unit: string;
  lists_unit?: string;
  model: ModelId;
  pass: number;
  judges: readonly JudgeKey[];
  lists: Record<string, ListRef>;
  items: Record<string, ItemRef>;
  gold?: GoldCell[];
  pair?: { contrast: string; arms: [string, string] };
}
export interface PacketFile {
  id: string;
  prompt: PromptName;
  items: Array<{ id: string; statement: string }>;
  lists: Array<{ id: string; checks: string[]; paths?: string[] }>;
  input?: string;
}
export interface PacketMap {
  version: 1;
  kind: MapKind;
  stage: 1 | 2;
  seed: number;
  /** The order the judge sends packets in. */
  order: string[];
  packets: Record<string, PacketMeta>;
}
/** One judge's answer for one (list, item) cell; label is null when the cell stayed unlabelled (section 7). */
export interface LabelRecord {
  packet: string;
  judge: JudgeKey | "panel";
  model_id: string;
  version: string | null;
  effort: string;
  prompt_sha256: string;
  packet_sha256: string;
  list: string;
  item: string;
  label: Label | null;
  quotes?: string[];
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const packetDigest = (p: PacketFile): string => sha256(JSON.stringify(p));
const listWords = (xs: readonly string[]) => xs.reduce((s, x) => s + words(x), 0);
/** A list's identity across builds: the check pass and production packets name the same list with different ids. */
export const listKey = (r: ListRef): string => r.kind + ":" + r.unit + ":" + r.model + ":" + r.pass + ":" + (r.kind === "arm" ? r.session : r.kind === "stock" ? "row" + r.stock : r.kind);
export const itemKey = (r: ItemRef): string => r.unit + ":" + r.item;

/** A key item as a judge reads it: its statement, and for a B item its files and functions. */
export function itemStatement(i: Key["items"][number]): string {
  if (i.kind !== "B" || !i.sites?.length) return i.statement.trim();
  const files = new Map<string, string[]>();
  for (const s of i.sites) files.set(s.file, [...(files.get(s.file) ?? []), ...(s.function ? [s.function] : [])]);
  return i.statement.trim() + " Files and functions: " + [...files].map(([f, fns]) => f + (fns.length ? " (" + [...new Set(fns)].join(", ") + ")" : "")).join("; ") + ".";
}

/** The text a judge reads after its prompt. */
export function renderPacket(p: PacketFile): string {
  const lines = (xs: readonly string[]) => xs.map((c, i) => i + 1 + ". " + c).join("\n");
  if (p.prompt === "pairwise") return (p.input ?? "") + "\n\n" + p.lists.map((l) => "PLAN " + l.id + "\nPaths:\n" + lines(l.paths ?? []) + "\nChecks:\n" + lines(l.checks)).join("\n\n");
  if (p.prompt === "armguess") return "CHECKS\n" + lines(p.lists[0]?.checks ?? []);
  if (p.prompt === "recognition") return p.input ?? "";
  return "KEY ITEMS\n" + p.items.map((i) => "[" + i.id + "] " + i.statement).join("\n") + "\n\nCHECK LISTS\n\n" + p.lists.map((l) => "List " + l.id + "\n" + lines(l.checks)).join("\n\n");
}

export interface Built {
  packets: PacketFile[];
  map: PacketMap;
  plain?: Record<string, { text: string; answers: Array<{ cell: number; gold: boolean; unit: string; list: string; item: string }> }>;
}

export interface BuildInput {
  stage: 1 | 2;
  seed: number;
  units: Map<string, LoadedUnit>;
  rows: Row[];
  oracle?: OracleFile;
  check?: { map: PacketMap; packets: Map<string, PacketFile>; labels: LabelRecord[] };
  replies?: Record<string, { changes: string[] }>;
}

class Ids {
  readonly taken = new Set<string>();
  constructor(readonly rng: () => number) {}
  next(): string {
    return randomId(this.rng, this.taken);
  }
}

interface Draft {
  role: Role;
  unit: string;
  lists_unit?: string;
  model: ModelId;
  pass: number;
  judges: readonly JudgeKey[];
  lists: Array<{ ref: ListRef; checks: string[] }>;
  items: Array<{ ref: ItemRef; statement: string }>;
  gold?: Array<{ listKey: string; item: string; gold: boolean; anchor: boolean; real: boolean; stratum: string }>;
}

function seal(d: Draft, prompt: PromptName, inp: BuildInput, ids: Ids, built: Built): string {
  const id = ids.next();
  const lists = shuffle(d.lists.map((l) => ({ ...l, id: ids.next() })), ids.rng);
  const items = shuffle(d.items.map((it) => ({ ...it, id: ids.next() })), ids.rng);
  const byList = new Map(lists.map((l) => [listKey(l.ref), l.id]));
  const byItem = new Map(items.map((it) => [itemKey(it.ref), it.id]));
  built.packets.push({ id, prompt, items: items.map((i) => ({ id: i.id, statement: i.statement })), lists: lists.map((l) => ({ id: l.id, checks: l.checks })) });
  built.map.packets[id] = {
    id, role: d.role, stage: inp.stage, unit: d.unit, ...(d.lists_unit ? { lists_unit: d.lists_unit } : {}), model: d.model, pass: d.pass, judges: d.judges,
    lists: Object.fromEntries(lists.map((l) => [l.id, l.ref])),
    items: Object.fromEntries(items.map((i) => [i.id, i.ref])),
    ...(d.gold ? { gold: d.gold.map((g) => ({ list: byList.get(g.listKey)!, item: byItem.get(g.item)!, gold: g.gold, anchor: g.anchor, real: g.real, stratum: g.stratum })) } : {}),
  };
  built.map.order.push(id);
  return id;
}

const keyOf = (inp: BuildInput, unit: string): Key => {
  const k = inp.units.get(unit)?.key;
  if (!k) throw new PvError("E_USAGE", "unit " + unit + " has no key under --units");
  return k;
};

/** Every key item and own-test item of a unit, or its primary items only. */
export function keyItems(key: Key, o: { primaryOnly: boolean }): Array<{ ref: ItemRef; statement: string }> {
  const prim = new Set(key.primary);
  const items = key.items.filter((i) => !o.primaryOnly || prim.has(i.id)).map((i) => ({ ref: { unit: key.unit, item: i.id, kind: i.kind } as ItemRef, statement: itemStatement(i) }));
  if (o.primaryOnly) return items;
  return [...items, ...key.own.map((i) => ({ ref: { unit: key.unit, item: i.id, kind: "own" } as ItemRef, statement: i.statement.trim() }))];
}

const stockLists = (unit: string, model: ModelId, pass: number) => ([1, 2, 3] as const).map((k) => {
  const checks = stockRow(k);
  return { ref: { kind: "stock", unit, model, pass, stock: k, words: listWords(checks) } as ListRef, checks };
});

function rowsOf(inp: BuildInput): Row[] {
  for (const r of inp.rows) if (!inp.units.has(r.unit)) throw new PvError("E_USAGE", "row " + r.session + " names unit " + r.unit + ", which is not under --units");
  return inp.rows;
}

/** The (unit, pass, model) cells, each with its arm lists in arm order. */
export function cells(inp: BuildInput): Array<{ unit: string; pass: number; model: ModelId; lists: Array<{ ref: ListRef; checks: string[] }> }> {
  const rows = rowsOf(inp);
  const out = [];
  const keys = [...new Set(rows.map((r) => r.unit + "\u0000" + r.pass + "\u0000" + r.model))].sort();
  for (const k of keys) {
    const [unit, pass, model] = k.split("\u0000") as [string, string, ModelId];
    const mine = rows.filter((r) => r.unit === unit && r.pass === Number(pass) && r.model === model && r.end === "block").sort((a, b) => (a.session < b.session ? -1 : 1));
    out.push({ unit, pass: Number(pass), model, lists: mine.map((r) => ({ ref: { kind: "arm", unit, model, pass: r.pass, arm: r.arm, session: r.session, words: r.check_words } as ListRef, checks: r.checks! })) });
  }
  return out.sort((a, b) => MODELS_IN_ORDER.indexOf(a.model) - MODELS_IN_ORDER.indexOf(b.model) || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : a.pass - b.pass));
}

function oracleFor(inp: BuildInput, unit: string, model: ModelId, pass: number): Array<{ ref: ListRef; checks: string[] }> {
  if (inp.stage !== 1 || inp.units.get(unit)!.meta.set !== "calibration") return [];
  const o = inp.oracle?.units[unit];
  if (!o) throw new PvError("E_USAGE", "calibration unit " + unit + " has no oracle list; run er oracle and pass --oracle");
  const checks = normalizeChecks([...o.checks]);
  return [{ ref: { kind: "oracle", unit, model, pass, words: listWords(checks) }, checks }];
}

const empty = (inp: BuildInput, kind: MapKind): Built => ({ packets: [], map: { version: 1, kind, stage: inp.stage, seed: inp.seed, order: [], packets: {} } });

/**
 * Section 7's shuffled-key control: a seeded derangement over the units, kept inside the same repository where it can,
 * then the same type and language, then the same type. Null for fewer than two units. Returns unit -> the unit whose key
 * its lists are labelled against.
 */
export function derangeUnits(units: ReadonlyArray<{ id: string; repo: string; type: string; language: string }>, rng: () => number): Map<string, string> | null {
  if (units.length < 2) return null;
  const out = new Map<string, string>();
  const cycleOf = new Map<string, string[]>();
  const by = new Map(units.map((u) => [u.id, u]));
  const cycle = (members: string[]) => {
    const order = shuffle([...members].sort(), rng);
    order.forEach((id, i) => {
      out.set(id, order[(i + 1) % order.length]!);
      cycleOf.set(id, order);
    });
  };
  const levels: Array<(u: (typeof units)[number]) => string> = [(u) => "r:" + u.repo, (u) => "tl:" + u.type + "/" + u.language, (u) => "t:" + u.type, () => "all"];
  let left = [...units].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const level of levels) {
    const groups = new Map<string, string[]>();
    for (const u of left) groups.set(level(u), [...(groups.get(level(u)) ?? []), u.id]);
    const singles: string[] = [];
    for (const [, members] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (members.length >= 2) cycle(members);
      else singles.push(members[0]!);
    }
    left = left.filter((u) => singles.includes(u.id));
  }
  if (left.length === 1) {
    const lone = left[0]!;
    const hosts = [...out.keys()].sort();
    const same = hosts.filter((h) => by.get(h)!.type === lone.type);
    const pool = same.length ? same : hosts;
    const host = pool[Math.floor(rng() * pool.length)]!;
    out.set(lone.id, out.get(host)!);
    out.set(host, lone.id);
  }
  return out;
}

function derangement(inp: BuildInput, rng: () => number): Map<string, string> {
  const keyed = [...inp.units.values()].filter((u) => u.key && u.key.primary.length).map((u) => ({ id: u.meta.id, repo: u.meta.repo, type: u.meta.type, language: u.meta.language }));
  const sigma = derangeUnits(keyed, rng);
  if (!sigma) throw new PvError("E_USAGE", "the shuffled-key control needs at least two keyed units under --units; it holds " + keyed.length);
  return sigma;
}

/** Production label packets, a shuffled-key packet beside each, and in stage 2 the gold packets and plain renderings. */
export function buildLabelPackets(inp: BuildInput): Built {
  const ids = new Ids(seededRandom(inp.seed));
  const built = empty(inp, "label");
  const sigma = derangement(inp, ids.rng);
  const all = cells(inp);
  const produced = new Map<ModelId, string[]>();
  for (const c of all) {
    const key = keyOf(inp, c.unit);
    const pid = seal({ role: "production", unit: c.unit, model: c.model, pass: c.pass, judges: PRODUCTION_JUDGES[c.model], lists: [...c.lists, ...stockLists(c.unit, c.model, c.pass), ...oracleFor(inp, c.unit, c.model, c.pass)], items: keyItems(key, { primaryOnly: false }) }, "brief", inp, ids, built);
    produced.set(c.model, [...(produced.get(c.model) ?? []), pid]);
    const other = sigma.get(c.unit);
    if (!c.lists.length || !other) continue;
    seal({ role: "shuffled", unit: other, lists_unit: c.unit, model: c.model, pass: c.pass, judges: PRODUCTION_JUDGES[c.model], lists: [...c.lists, ...stockLists(c.unit, c.model, c.pass)], items: keyItems(keyOf(inp, other), { primaryOnly: true }) }, "brief", inp, ids, built);
  }
  if (inp.stage === 2) {
    if (!inp.check) throw new PvError("E_USAGE", "stage 2 label packets carry gold cells; pass the judge check's --check-map, --check-packets and --check-labels");
    addGold(inp, ids, built, produced);
  }
  return built;
}

/** The judge check's separate pass: packets that mirror stage 1's label packets, labelled by Astra and Opus. */
export function buildCheckPackets(inp: BuildInput): Built {
  if (inp.stage !== 1) throw new PvError("E_USAGE", "the judge check draws from stage 1 (section 7); pass --stage 1");
  const ids = new Ids(seededRandom(inp.seed + 1));
  const built = empty(inp, "check");
  for (const c of cells(inp)) seal({ role: "check", unit: c.unit, model: c.model, pass: c.pass, judges: CHECK_JUDGES, lists: [...c.lists, ...stockLists(c.unit, c.model, c.pass), ...oracleFor(inp, c.unit, c.model, c.pass)], items: keyItems(keyOf(inp, c.unit), { primaryOnly: false }) }, "audit", inp, ids, built);
  return built;
}

export interface GoldRef {
  packet: string;
  list: string;
  item: string;
  gold: boolean;
  ref: ListRef;
  itemRef: ItemRef;
  model: ModelId;
  unit: string;
}

/** The judge-check stratum of a list: its arm, or the anchor or stock row it is. */
export const listStratum = (r: ListRef): string => (r.kind === "arm" ? r.arm! : r.kind === "stock" ? "stock" + r.stock : r.kind);
export const isAnchor = (r: ListRef): boolean => r.kind === "oracle" || (r.kind === "stock" && (r.stock === 1 || r.stock === 2));

/** Section 7: gold labels are the check-pass cells over B, T and C items where Astra and Opus agree. */
export function goldCells(map: PacketMap, labels: readonly LabelRecord[]): GoldRef[] {
  const votes = new Map<string, Partial<Record<JudgeKey, boolean>>>();
  for (const l of labels) {
    if (!map.packets[l.packet] || l.label === null || (l.judge !== "astra" && l.judge !== "opus")) continue;
    const k = l.packet + "|" + l.list + "|" + l.item;
    votes.set(k, { ...(votes.get(k) ?? {}), [l.judge]: l.label.anticipated });
  }
  const out: GoldRef[] = [];
  for (const id of [...Object.keys(map.packets)].sort()) {
    const p = map.packets[id]!;
    if (p.role !== "check") continue;
    for (const list of Object.keys(p.lists).sort())
      for (const item of Object.keys(p.items).sort()) {
        if (p.items[item]!.kind === "own") continue;
        const v = votes.get(id + "|" + list + "|" + item);
        if (v?.astra === undefined || v.opus === undefined || v.astra !== v.opus) continue;
        out.push({ packet: id, list, item, gold: v.astra, ref: p.lists[list]!, itemRef: p.items[item]!, model: p.model, unit: p.unit });
      }
  }
  return out;
}

/** Draws a production judge's stage 2 gold cells: half of each class, round-robin over (arm, item kind) strata. */
export function drawGold(cellsIn: readonly GoldRef[], rng: () => number, total = 40): GoldRef[] {
  const half = Math.floor(total / 2);
  const take = (pool: GoldRef[], n: number): GoldRef[] => {
    const strata = new Map<string, GoldRef[]>();
    for (const c of pool) {
      const s = listStratum(c.ref) + "/" + c.itemRef.kind;
      strata.set(s, [...(strata.get(s) ?? []), c]);
    }
    const queues = [...strata.keys()].sort().map((k) => shuffle(strata.get(k)!, rng));
    const out: GoldRef[] = [];
    while (out.length < n && queues.some((q) => q.length)) for (const q of queues) if (q.length && out.length < n) out.push(q.shift()!);
    return out;
  };
  const ant = take(cellsIn.filter((c) => c.gold), half);
  const not = take(cellsIn.filter((c) => !c.gold), total - ant.length);
  return [...ant, ...not];
}

function addGold(inp: BuildInput, ids: Ids, built: Built, produced: Map<ModelId, string[]>): void {
  const { map, packets, labels } = inp.check!;
  if (map.kind !== "check") throw new PvError("E_USAGE", "--check-map is not a judge check map");
  const gold = goldCells(map, labels);
  const rng = seededRandom(inp.seed + 2);
  built.plain = {};
  for (const model of MODELS_IN_ORDER) {
    const prod = produced.get(model) ?? [];
    if (!prod.length) continue;
    const drawn = drawGold(gold.filter((g) => g.model === model), rng);
    const nPackets = Math.ceil(prod.length / 8);
    const sources = [...new Set(drawn.map((g) => g.packet))].sort();
    const chunks: string[][] = Array.from({ length: Math.min(nPackets, sources.length) }, () => []);
    sources.forEach((s, i) => chunks[Math.floor((i * chunks.length) / sources.length)]!.push(s));
    const goldIds: string[] = [];
    for (const chunk of chunks) {
      const lists: Draft["lists"] = [];
      const items: Draft["items"] = [];
      const goldDraft: NonNullable<Draft["gold"]> = [];
      for (const src of chunk) {
        const file = packets.get(src);
        if (!file) throw new PvError("E_USAGE", "the judge check's packet " + src + " is not under --check-packets");
        const meta = map.packets[src]!;
        const gs = drawn.filter((g) => g.packet === src);
        const text = new Map(file.lists.map((l) => [l.id, l.checks]));
        const listIds = [...new Set(gs.map((g) => g.list))];
        for (const k of [1, 2, 3]) {
          const sid = Object.keys(meta.lists).find((l) => meta.lists[l]!.kind === "stock" && meta.lists[l]!.stock === k);
          if (sid && !listIds.includes(sid)) listIds.push(sid);
        }
        for (const l of listIds) lists.push({ ref: meta.lists[l]!, checks: text.get(l)! });
        for (const i of file.items) items.push({ ref: meta.items[i.id]!, statement: i.statement });
        for (const g of gs) goldDraft.push({ listKey: listKey(g.ref), item: itemKey(g.itemRef), gold: g.gold, anchor: isAnchor(g.ref), real: g.ref.kind === "arm", stratum: listStratum(g.ref) + "/" + g.itemRef.kind });
      }
      const first = map.packets[chunk[0]!]!;
      goldIds.push(seal({ role: "gold", unit: first.unit, model, pass: first.pass, judges: PRODUCTION_JUDGES[model], lists, items, gold: goldDraft }, "brief", inp, ids, built));
    }
    const order = built.map.order.filter((id) => !goldIds.includes(id));
    goldIds.forEach((g, i) => {
      const after = prod[Math.min(prod.length, (i + 1) * 8) - 1]!;
      let at = order.indexOf(after) + 1;
      while (at < order.length && built.map.packets[order[at]!]!.role === "shuffled") at++;
      order.splice(at, 0, g);
    });
    built.map.order = order;
    const subset = shuffle(gold.filter((g) => g.model === model), seededRandom(inp.seed + 3)).slice(0, 40);
    const text: string[] = ["# Gold cells, plain rendering (" + model + " lists)", "", "For each cell: does a check in the list anticipate the item? Answer yes or no per cell, by section 7's anticipated rule.", ""];
    const answers: Array<{ cell: number; gold: boolean; unit: string; list: string; item: string }> = [];
    subset.forEach((g, i) => {
      const file = packets.get(g.packet)!;
      text.push("## Cell " + (i + 1), "", "Item: " + file.items.find((x) => x.id === g.item)!.statement, "", "Checks:", ...file.lists.find((x) => x.id === g.list)!.checks.map((c, k) => k + 1 + ". " + c), "");
      answers.push({ cell: i + 1, gold: g.gold, unit: g.unit, list: listKey(g.ref), item: itemKey(g.itemRef) });
    });
    built.plain[model] = { text: text.join("\n"), answers };
  }
}

function pairInput(u: LoadedUnit): string {
  const key = u.key;
  if (!key) throw new PvError("E_USAGE", "unit " + u.meta.id + " has no key.json, which carries the merged diff's file list");
  return "PLAN\n" + readPlan(u).trim() + "\n\nFILES THE MERGED CHANGE TOUCHED\n" + key.diffstat.map((d) => d.file + " +" + d.added + " -" + d.deleted).join("\n");
}

/** The stock block of the pairwise read: the stock paths, and rows 1 and 2 as its checks. */
export const stockBlock = (): { paths: string[]; checks: string[] } => ({ paths: stockPaths(), checks: [...stockRow(1), ...stockRow(2)] });

/** Pairwise packets for pass 1 on Opus and Sol: each skill arm against none and the lens, and the stock block against none. */
export function buildPairwisePackets(inp: BuildInput): Built {
  const rng = seededRandom(inp.seed + 4);
  const taken = new Set<string>();
  const built = empty(inp, "pairwise");
  const rows = rowsOf(inp).filter((r) => r.pass === 1 && r.end === "block");
  for (const model of PAIRWISE_MODELS)
    for (const unit of [...new Set(rows.map((r) => r.unit))].sort()) {
      const arm = (a: ArmId) => rows.find((r) => r.unit === unit && r.model === model && r.arm === a);
      const side = (a: ArmId | "stock") => {
        if (a === "stock") return { arm: "stock", ref: { kind: "stock", unit, model, pass: 1, words: listWords(stockBlock().checks) } as ListRef, ...stockBlock() };
        const r = arm(a);
        return r ? { arm: a as string, ref: { kind: "arm", unit, model, pass: 1, arm: a, session: r.session, words: r.check_words } as ListRef, paths: r.paths!, checks: r.checks! } : null;
      };
      const pairs: Array<[ArmId | "stock", ArmId]> = [...SKILL_ARMS.flatMap((s) => [[s, "none"], [s, "lens"]] as Array<[ArmId, ArmId]>), ["stock", "none"]];
      for (const [x, y] of pairs) {
        const a = side(x), b = side(y);
        if (!a || !b) continue;
        const order = rng() < 0.5 ? [a, b] : [b, a];
        const id = randomId(rng, taken);
        built.packets.push({ id, prompt: "pairwise", items: [], input: pairInput(inp.units.get(unit)!), lists: order.map((s, i) => ({ id: i ? "B" : "A", paths: s.paths, checks: s.checks })) });
        built.map.packets[id] = { id, role: "pairwise", stage: inp.stage, unit, model, pass: 1, judges: PRODUCTION_JUDGES[model], items: {}, pair: { contrast: x + "-" + y, arms: [x, y] }, lists: Object.fromEntries(order.map((s, i) => [i ? "B" : "A", s.ref])) };
        built.map.order.push(id);
      }
    }
  return built;
}

/** The arm-guess probe (section 9, item 5): 30 seeded block lists, one a packet, for Astra. */
export function buildArmGuessPackets(inp: BuildInput, n = 30): Built {
  const rng = seededRandom(inp.seed + 5);
  const taken = new Set<string>();
  const built = empty(inp, "armguess");
  const rows = shuffle(rowsOf(inp).filter((r) => r.end === "block").sort((a, b) => (a.session < b.session ? -1 : 1)), rng).slice(0, n);
  for (const r of rows) {
    const id = randomId(rng, taken);
    built.packets.push({ id, prompt: "armguess", items: [], lists: [{ id: "L", checks: r.checks! }] });
    built.map.packets[id] = { id, role: "armguess", stage: inp.stage, unit: r.unit, model: r.model, pass: r.pass, judges: ["astra"], items: {}, lists: { L: { kind: "arm", unit: r.unit, model: r.model, pass: r.pass, arm: r.arm, session: r.session, words: r.check_words } } };
    built.map.order.push(id);
  }
  return built;
}

/** The recognition probe's replies as lists, one packet per calibration unit, for Astra (the production judge of Opus). */
export function buildRecognitionPackets(inp: BuildInput): Built {
  if (!inp.replies) throw new PvError("E_USAGE", "recognition packets need --replies from er probe ask");
  const ids = new Ids(seededRandom(inp.seed + 6));
  const built = empty(inp, "recognition");
  for (const unit of Object.keys(inp.replies).sort()) {
    const checks = normalizeChecks([...inp.replies[unit]!.changes]);
    seal({ role: "recognition", unit, model: "opus", pass: 1, judges: PRODUCTION_JUDGES.opus, lists: [{ ref: { kind: "probe", unit, model: "opus", pass: 1, words: listWords(checks) }, checks }], items: keyItems(keyOf(inp, unit), { primaryOnly: true }) }, "brief", inp, ids, built);
  }
  return built;
}

export function readPackets(dir: string): Map<string, PacketFile> {
  const out = new Map<string, PacketFile>();
  if (!existsSync(dir)) throw new PvError("E_USAGE", "packets directory " + dir + " does not exist");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const p = readJson<PacketFile>(join(dir, f), "packet");
    out.set(p.id, p);
  }
  return out;
}

const USAGE = "gstack-evals er packets --kind label|check|pairwise|armguess|recognition --stage 1|2 --units <dir> --rows <rows> [--rows <rows>] --out <packets dir> --map <map.json> [--oracle <oracle.json>] [--check-map <map.json> --check-packets <dir> --check-labels <labels.ndjson> --plain <dir>] [--replies <replies.json>] [--seed n]";

export function run(argv: string[], io: Io): number {
  const a = parseArgs(argv, { kind: "one", stage: "one", units: "one", rows: "many", out: "one", map: "one", oracle: "one", "check-map": "one", "check-packets": "one", "check-labels": "one", plain: "one", replies: "one", seed: "one" }, USAGE);
  need(a, ["kind", "stage", "units", "out", "map"], USAGE);
  const kind = a.one.kind as MapKind;
  if (!["label", "check", "pairwise", "armguess", "recognition"].includes(kind)) throw new PvError("E_USAGE", "--kind is label, check, pairwise, armguess or recognition");
  if (kind !== "recognition") need(a, ["rows"], USAGE);
  const stage = Number(a.one.stage);
  if (stage !== 1 && stage !== 2) throw new PvError("E_USAGE", "--stage is 1 or 2");
  const seed = a.one.seed === undefined ? SEED : Number(a.one.seed);
  if (!Number.isSafeInteger(seed)) throw new PvError("E_USAGE", "--seed is a whole number");
  const paths: Array<[string, string]> = [["--units", a.one.units!], ...(a.many.rows ?? []).map((r) => ["--rows", r] as [string, string]), ["--out", a.one.out!], ["--map", a.one.map!]];
  for (const f of ["oracle", "check-map", "check-packets", "check-labels", "plain", "replies"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  for (const f of ["out", "map", "plain"]) if (a.one[f]) refuseInRepo("--" + f, a.one[f]!);
  if (realOf(a.one.map!).startsWith(realOf(a.one.out!) + "/")) throw new PvError("E_USAGE", "--map sits inside --out; the map from ids to arms is written outside the packets");
  const inp: BuildInput = { stage: stage as 1 | 2, seed, units: loadUnits(a.one.units!, { keys: true }), rows: (a.many.rows ?? []).flatMap(readRows) };
  if (a.one.oracle) inp.oracle = readJson<OracleFile>(a.one.oracle, "oracle file");
  if (a.one.replies) inp.replies = readJson<{ units: Record<string, { changes: string[] }> }>(a.one.replies, "probe replies").units;
  if (kind === "label" && stage === 2) {
    need(a, ["check-map", "check-packets", "check-labels", "plain"], USAGE);
    inp.check = { map: readJson<PacketMap>(a.one["check-map"]!, "check map"), packets: readPackets(a.one["check-packets"]!), labels: readRecords<LabelRecord>(a.one["check-labels"]!, "check labels") };
  }
  const built = kind === "label" ? buildLabelPackets(inp) : kind === "check" ? buildCheckPackets(inp) : kind === "pairwise" ? buildPairwisePackets(inp) : kind === "armguess" ? buildArmGuessPackets(inp) : buildRecognitionPackets(inp);
  for (const p of built.packets) writeJson(join(a.one.out!, p.id + ".json"), p);
  writeJson(a.one.map!, built.map);
  for (const [model, pl] of Object.entries(built.plain ?? {})) {
    writeJson(join(a.one.plain!, "gold-plain-" + model + "-answers.json"), pl.answers);
    writeFileSync(join(a.one.plain!, "gold-plain-" + model + ".md"), pl.text + "\n", { mode: 0o600 });
  }
  const roles = new Map<string, number>();
  for (const m of Object.values(built.map.packets)) roles.set(m.role, (roles.get(m.role) ?? 0) + 1);
  io.out("er packets: " + built.packets.length + " " + kind + " packets (" + [...roles].map(([r, n]) => r + " " + n).join(", ") + ") under " + a.one.out + "; map " + a.one.map);
  return 0;
}
