// Copyright (c) 2026 Garry Tan. MIT License.
// The judge check: gold cells from the other two families, anchors and their weights, floors, catch rate, false-fail rate, kappa, the detail check, the stage 2 re-check and the live judge probe.
// Copied from lanes/aftermath/readings.ts and lanes/devex/score/rules.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94,
// with prereg section 6's design in place of D's: each production judge is scored only on gold its own family didn't
// help define (Astra on the cells where Opus and Gemini agree, Opus on the cells where Astra and Gemini agree), plus the
// anchors at their known labels (stock rows 1 and 2 known-bad, the oracle list known-good, on primary items). Oracle
// cells supply at most half of the anticipated class (a seeded subset when there are more); anchors are weighted down
// to at most a quarter of the gate's weight. Floors: 40 cells of each class from 40 distinct lists. Kappa, rounded to
// four decimals, must be at least 0.6. The detail check reads the same way on change and item pairs at 10x.
import { fail } from "../errors.ts";
import { JUDGING, MONEY, SEED } from "../frozen.ts";
import type { Model, Tier } from "../types.ts";
import { loadPrompt, toLabelCell } from "./labels.ts";
import { primaryItems, seal, type Draft } from "./packets.ts";
import type { JudgeCaller } from "./seams.ts";
import { kappa, r4, rngFor, shuffle, type Rated } from "./stats.ts";
import { cellKey, type Built, type Judge, type ListRef, type PacketItem, type PacketLabels, type PacketMeta, type RawCell, type ScoreUnit } from "./types.ts";

/** A production judge as the check scores it: one judge on one model's lists (the panel is checked through Astra and Opus). */
export interface CheckSubject {
  judge: "astra" | "opus";
  model: Model;
}
export const CHECK_SUBJECTS: readonly CheckSubject[] = [
  { judge: "astra", model: "opus" },
  { judge: "opus", model: "sol" },
  { judge: "astra", model: "particle" },
  { judge: "opus", model: "particle" },
];
/** The two families that define a judge's gold. */
export const GOLD_FAMILIES: Readonly<Record<"astra" | "opus", readonly [Judge, Judge]>> = { astra: ["opus", "argon"], opus: ["astra", "argon"] };

export type GoldKind = "agreed" | "oracle" | "stock";

/** One gold cell, with what a re-check packet needs to show it again. */
export interface GoldCell {
  /** Stable across packets: model, tier, list identity and key item id (or, for a detail pair, also the change). */
  id: string;
  list: string;
  unit: string;
  model: Model;
  tier: Tier;
  source: ListRef["source"];
  item: string;
  change: number | null;
  gold: boolean;
  kind: GoldKind;
  listRef: ListRef;
  changes: string[];
  packetItem: Omit<PacketItem, "id">;
}

const listIdentity = (meta: PacketMeta, ref: ListRef) => [meta.model, meta.tier, ref.session ?? ref.source + "@" + ref.unit].join("|");

/** Packets of one model in a fixed order: by tier, unit, pass, main before smoke, then id. A list met twice counts once. */
const ordered = (metas: readonly PacketMeta[], model: Model, role: PacketMeta["role"]) =>
  metas.filter((m) => m.model === model && m.role === role).sort((a, b) => (a.tier < b.tier ? -1 : a.tier > b.tier ? 1 : a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : (a.pass ?? 0) - (b.pass ?? 0) || Number(a.smoke) - Number(b.smoke) || (a.id < b.id ? -1 : 1)));

const judgeCells = (pl: PacketLabels | undefined, j: Judge) => pl?.judges.find((x) => x.judge === j)?.cells;
const labelled = (c: RawCell | null | undefined): RawCell | null => (c && !c.noIndex ? c : null);

export interface CheckInput {
  units: ReadonlyMap<string, ScoreUnit>;
  /** The check pass: packets and three-family labels. */
  check: { built: Built; labels: ReadonlyMap<string, PacketLabels> };
  /** Production: packets and labels, with each judge's own cells. */
  production: { built: Built; labels: ReadonlyMap<string, PacketLabels> };
}

/** Each (list, key item) cell in a model's packets, first occurrence only, with its text. */
function* cellsOf(built: Built, model: Model, role: PacketMeta["role"]) {
  const files = new Map(built.packets.map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (const meta of ordered(built.metas, model, role)) {
    const file = files.get(meta.id)!;
    for (const [lid, ref] of Object.entries(meta.lists))
      for (const [pid, iref] of Object.entries(meta.items)) {
        if (iref.role !== "key") continue;
        const id = listIdentity(meta, ref) + "|" + iref.id;
        if (seen.has(id)) continue;
        seen.add(id);
        const { id: _drop, ...packetItem } = file.items.find((i) => i.id === pid)!;
        yield { id, meta, lid, pid, ref, item: iref.id, changes: file.lists.find((l) => l.id === lid)!.changes, packetItem };
      }
  }
}

/** The gold cells for one subject: agreement of the other two families in the check pass, plus the anchors. */
export function goldFor(s: CheckSubject, inp: CheckInput): GoldCell[] {
  const [x, y] = GOLD_FAMILIES[s.judge];
  const out: GoldCell[] = [];
  const isAnchor = (ref: ListRef, item: string) => {
    const pu = inp.units.get(ref.unit);
    const primary = !!pu && primaryItems(pu.key).some((i) => i.id === item);
    return primary && (ref.source === "oracle" || ref.source === "stock-1" || ref.source === "stock-2");
  };
  for (const c of cellsOf(inp.production.built, s.model, "production")) {
    if (!isAnchor(c.ref, c.item)) continue;
    const oracle = c.ref.source === "oracle";
    out.push({ id: c.id, list: listIdentity(c.meta, c.ref), unit: c.ref.unit, model: s.model, tier: c.meta.tier, source: c.ref.source, item: c.item, change: null, gold: oracle, kind: oracle ? "oracle" : "stock", listRef: c.ref, changes: c.changes, packetItem: c.packetItem });
  }
  for (const c of cellsOf(inp.check.built, s.model, "check")) {
    if (isAnchor(c.ref, c.item)) continue;
    const pl = inp.check.labels.get(c.meta.id);
    const a = labelled(judgeCells(pl, x)?.get(cellKey(c.lid, c.pid))), b = labelled(judgeCells(pl, y)?.get(cellKey(c.lid, c.pid)));
    if (!a || !b || a.anticipated !== b.anticipated) continue;
    out.push({ id: c.id, list: listIdentity(c.meta, c.ref), unit: c.ref.unit, model: s.model, tier: c.meta.tier, source: c.ref.source, item: c.item, change: null, gold: a.anticipated, kind: "agreed", listRef: c.ref, changes: c.changes, packetItem: c.packetItem });
  }
  return out;
}

/** The detail check's gold pairs at 10x: pairs both other families credit and agree on, plus oracle pairs not cut. */
export function detailGoldFor(s: CheckSubject, inp: CheckInput): GoldCell[] {
  const [x, y] = GOLD_FAMILIES[s.judge];
  const out: GoldCell[] = [];
  for (const c of cellsOf(inp.production.built, s.model, "production")) {
    if (c.meta.tier !== "10x" || c.ref.source !== "oracle" || c.packetItem.detail === null) continue;
    const pu = inp.units.get(c.ref.unit);
    const k = pu ? primaryItems(pu.key).findIndex((i) => i.id === c.item) : -1;
    if (k < 0 || (c.ref.cut ?? []).includes(c.item)) continue;
    out.push({ id: c.id + "|" + (k + 1), list: listIdentity(c.meta, c.ref), unit: c.ref.unit, model: s.model, tier: "10x", source: "oracle", item: c.item, change: k + 1, gold: true, kind: "oracle", listRef: c.ref, changes: c.changes, packetItem: c.packetItem });
  }
  for (const c of cellsOf(inp.check.built, s.model, "check")) {
    if (c.meta.tier !== "10x" || c.ref.source === "oracle" || c.packetItem.detail === null) continue;
    const pl = inp.check.labels.get(c.meta.id);
    const a = labelled(judgeCells(pl, x)?.get(cellKey(c.lid, c.pid))), b = labelled(judgeCells(pl, y)?.get(cellKey(c.lid, c.pid)));
    if (!a || !b || !a.anticipated || !b.anticipated) continue;
    for (const ch of a.edges) {
      if (!b.edges.includes(ch)) continue;
      const da = (a.detailEdges ?? []).includes(ch), db = (b.detailEdges ?? []).includes(ch);
      if (da !== db) continue;
      out.push({ id: c.id + "|" + ch, list: listIdentity(c.meta, c.ref), unit: c.ref.unit, model: s.model, tier: "10x", source: c.ref.source, item: c.item, change: ch, gold: da, kind: "agreed", listRef: c.ref, changes: c.changes, packetItem: c.packetItem });
    }
  }
  return out;
}

/** One gold cell as the judge read it in production: its label, or null when unlabelled (or, for a pair, not named). */
export interface JudgedCell {
  cell: GoldCell;
  judged: boolean | null;
}

/** The subject judge's own production labels on its gold cells (or pairs, when detail is set). */
export function judgedOn(s: CheckSubject, gold: readonly GoldCell[], inp: { built: Built; labels: ReadonlyMap<string, PacketLabels> }, detail = false): JudgedCell[] {
  const where = new Map<string, { meta: PacketMeta; lid: string; pid: string }>();
  for (const c of cellsOf(inp.built, s.model, "production")) where.set(c.id, { meta: c.meta, lid: c.lid, pid: c.pid });
  return gold.map((g) => {
    const w = where.get(detail ? g.id.slice(0, g.id.lastIndexOf("|")) : g.id);
    const cell = w ? toLabelCell(judgeCells(inp.labels.get(w.meta.id), s.judge)?.get(cellKey(w.lid, w.pid)) ?? null) : null;
    if (!cell || cell.kind === "unlabelled") return { cell: g, judged: null };
    if (!detail) return { cell: g, judged: cell.anticipated };
    if (!cell.anticipated || !cell.anticipatedEdges.includes(g.change!)) return { cell: g, judged: null };
    return { cell: g, judged: (cell.detailEdges ?? []).includes(g.change!) };
  });
}

export interface GateReading {
  subject: CheckSubject;
  detail: boolean;
  anticipated: number;
  not: number;
  lists: number;
  oracle: { available: number; used: number };
  anchors: number;
  anchorWeight: number;
  unlabelled: number;
  short: boolean;
  catchRate: number | null;
  falseFail: number | null;
  kappa: number | null;
  /** Printed beside the gate: every cell at weight 1, and real-list cells alone. */
  kappaUnweighted: number | null;
  kappaReal: number | null;
  pass: boolean;
  reading: "pass" | "short of gold cells" | "kappa under 0.6";
}

const weightedShare = (cs: readonly Rated[], f: (c: Rated) => boolean): number | null => {
  const w = cs.reduce((s, c) => s + c.weight, 0);
  return w > 0 ? cs.filter(f).reduce((s, c) => s + c.weight, 0) / w : null;
};

/**
 * Scores judged gold cells: the oracle cap (at most half of the anticipated class, a seeded subset), anchor weights (at
 * most a quarter of the weight), the floors (perClass of each class from minLists distinct lists), catch rate, false-fail
 * rate and weighted kappa at 0.6 to four decimals.
 */
export function gate(subject: CheckSubject, judged: readonly JudgedCell[], o: { detail?: boolean; perClass?: number; minLists?: number; seed?: string } = {}): GateReading {
  const perClass = o.perClass ?? JUDGING.goldPerClass;
  const minLists = o.minLists ?? JUDGING.goldDistinctLists;
  const read = judged.filter((j) => j.judged !== null);
  const oracleAll = read.filter((j) => j.cell.kind === "oracle");
  const realYes = read.filter((j) => j.cell.gold && j.cell.kind !== "oracle").length;
  const cap = Math.floor((realYes * JUDGING.oracleShareMax) / (1 - JUDGING.oracleShareMax));
  const oracle = shuffle(oracleAll, rngFor("oracle cap\n" + subject.judge + "|" + subject.model + "|" + (o.detail ? "detail" : "anticipated") + (o.seed ?? ""))).slice(0, cap);
  const used = [...read.filter((j) => j.cell.kind !== "oracle"), ...oracle];
  const anchors = used.filter((j) => j.cell.kind !== "agreed").length;
  const real = used.length - anchors;
  const w = anchors === 0 ? 1 : Math.min(1, (real * JUDGING.anchorWeightMax) / (1 - JUDGING.anchorWeightMax) / anchors);
  const rated: Rated[] = used.map((j) => ({ gold: j.cell.gold, judged: j.judged!, weight: j.cell.kind === "agreed" ? 1 : w }));
  const ant = used.filter((j) => j.cell.gold).length;
  const not = used.length - ant;
  const lists = new Set(used.map((j) => j.cell.list)).size;
  const short = ant < perClass || not < perClass || lists < minLists;
  const k = kappa(rated);
  const ok = k !== null && r4(k) >= JUDGING.kappaMin;
  return {
    subject, detail: !!o.detail, anticipated: ant, not, lists, oracle: { available: oracleAll.length, used: oracle.length }, anchors, anchorWeight: w,
    unlabelled: judged.length - read.length, short,
    catchRate: weightedShare(rated.filter((c) => !c.gold), (c) => !c.judged),
    falseFail: weightedShare(rated.filter((c) => c.gold), (c) => !c.judged),
    kappa: k, kappaUnweighted: kappa(rated.map((c) => ({ ...c, weight: 1 }))), kappaReal: kappa(rated.filter((_, i) => used[i]!.cell.kind === "agreed")),
    pass: !short && ok, reading: short ? "short of gold cells" : ok ? "pass" : "kappa under 0.6",
  };
}

/** Stage 1's judge check for one subject: the anticipated gate and, on the subject's 10x lists, the detail gate. */
export function judgeCheck(s: CheckSubject, inp: CheckInput): { label: GateReading; detail: GateReading; gold: GoldCell[]; detailGold: GoldCell[] } {
  const gold = goldFor(s, inp);
  const detailGold = detailGoldFor(s, inp);
  return { label: gate(s, judgedOn(s, gold, inp.production)), detail: gate(s, judgedOn(s, detailGold, inp.production, true), { detail: true }), gold, detailGold };
}

/**
 * The detail check's stage 2 top-up (prereg section 6): a judge short of detail gold in stage 1 takes its detail check
 * on stage 2 10x unit-passes in this seeded order, as many as reach the floors inside the judge cap. The caller builds
 * check packets for a prefix of it, labels them and reads detailGoldFor and gate again.
 */
export function detailTopUpOrder(rows: readonly { unit: string; model: Model; pass: number; stage: 1 | 2; smoke: boolean }[], s: CheckSubject): string[] {
  const keys = [...new Set(rows.filter((r) => r.stage === 2 && r.model === s.model && !r.smoke).map((r) => r.unit + "|" + r.pass))].sort();
  return shuffle(keys, rngFor("detail top-up\n" + s.judge + "|" + s.model));
}

/** The panel passes only when both members pass. */
export const panelPasses = (astra: GateReading, opus: GateReading): boolean => astra.pass && opus.pass;

/**
 * Stage 2's re-check sample for one subject: cells cells in packets gold packets (80 in 8 for a production judge, 40 in
 * 4 for each panel member), half of each class per packet, each packet one unit's cells, taken in a seeded order of
 * units with the admitted tier's gold first and base-tier gold after, cells within a unit rotated across list sources
 * (the stratum by arm), at least distinctLists lists. Short when the gold runs out.
 */
export function recheckSample(s: CheckSubject, gold: readonly GoldCell[], o: { tier: Tier; cells?: number; packets?: number; distinctLists?: number }): { packets: GoldCell[][]; short: boolean; lists: number } {
  const total = o.cells ?? JUDGING.recheck.cells;
  const nPackets = o.packets ?? JUDGING.recheck.packets;
  const per = total / nPackets;
  if (!Number.isInteger(per) || per % 2) fail("E_USAGE", "a re-check packet holds an even whole number of cells, got " + total + " in " + nPackets);
  const rng = rngFor("recheck\n" + s.judge + "|" + s.model);
  const pools = [gold.filter((g) => g.tier === o.tier && g.change === null), o.tier === "base" ? [] : gold.filter((g) => g.tier === "base" && g.change === null)];
  const used = new Set<string>();
  const packets: GoldCell[][] = [];
  for (const pool of pools) {
    const units = shuffle([...new Set(pool.map((g) => g.unit))].sort(), rng);
    for (const unit of units) {
      if (packets.length === nPackets) break;
      const mine = shuffle(pool.filter((g) => g.unit === unit && !used.has(g.id)), rng);
      const pick = (yes: boolean) => {
        const bySource = new Map<string, GoldCell[]>();
        for (const g of mine.filter((m) => m.gold === yes)) bySource.set(g.source, [...(bySource.get(g.source) ?? []), g]);
        const out: GoldCell[] = [];
        const queues = [...bySource.keys()].sort().map((k) => bySource.get(k)!);
        for (let i = 0; out.length < per / 2 && queues.some((q) => q.length); i++) {
          const q = queues[i % queues.length]!;
          if (q.length) out.push(q.shift()!);
        }
        return out;
      };
      const yes = pick(true), no = pick(false);
      if (yes.length < per / 2 || no.length < per / 2) continue;
      for (const g of [...yes, ...no]) used.add(g.id);
      packets.push([...yes, ...no]);
    }
  }
  const lists = new Set(packets.flat().map((g) => g.list)).size;
  return { packets, short: packets.length < nPackets || lists < (o.distinctLists ?? JUDGING.recheck.distinctLists), lists };
}

/** Builds the blind re-check packets: each formatted like any packet, its gold cells carried in the sealed map. */
export function recheckPackets(s: CheckSubject, sample: readonly GoldCell[][], taken: Set<string> = new Set()): Built {
  const out: Built = { packets: [], metas: [] };
  sample.forEach((cells, k) => {
    const items = [...new Map(cells.map((g) => [g.item, g])).values()];
    const lists = [...new Map(cells.map((g) => [g.list, g])).values()];
    const d: Draft = { role: "recheck", prompt: "brief", stage: 2, tier: cells[0]!.tier, unit: cells[0]!.unit, listsUnit: cells[0]!.unit, model: s.model, pass: null, smoke: false, items: items.map((g) => ({ ref: { role: "key", id: g.item }, item: g.packetItem })), lists: lists.map((g) => ({ ref: g.listRef, changes: g.changes })) };
    const { file, meta } = seal(d, taken, "\nrecheck " + s.judge + " " + (k + 1));
    const lid = new Map(Object.entries(meta.lists).map(([pid, ref]) => [lists.find((g) => g.listRef === ref)!.list, pid]));
    const iid = new Map(Object.entries(meta.items).map(([pid, ref]) => [(ref as { id: string }).id, pid]));
    meta.gold = cells.map((g) => ({ cell: cellKey(lid.get(g.list)!, iid.get(g.item)!), gold: g.gold, anchor: g.kind !== "agreed" }));
    out.packets.push(file);
    out.metas.push(meta);
  });
  return out;
}

/** Spreads n gold packets evenly through a queue of length packets (their positions in the merged queue of length + n). */
export const recheckPositions = (length: number, n: number): number[] => [...Array(n).keys()].map((k) => Math.floor(((k + 0.5) * (length + n)) / n));

/** The re-check gate: the subject judge's own labels of the carried gold, perClass of each class, the same kappa bar. */
export function recheckGate(s: CheckSubject, built: Built, labels: ReadonlyMap<string, PacketLabels>, o: { perClass?: number; distinctLists?: number } = {}): GateReading {
  const judged: JudgedCell[] = [];
  for (const meta of built.metas) {
    if (meta.role !== "recheck") continue;
    for (const g of meta.gold ?? []) {
      const raw = judgeCells(labels.get(meta.id), s.judge)?.get(g.cell) ?? null;
      const c = toLabelCell(raw);
      const listRef = meta.lists[g.cell.split("|")[0]!]!;
      const cell: GoldCell = { id: meta.id + "|" + g.cell, list: listIdentity(meta, listRef), unit: meta.unit, model: s.model, tier: meta.tier, source: listRef.source, item: g.cell, change: null, gold: g.gold, kind: g.anchor ? (g.gold ? "oracle" : "stock") : "agreed", listRef, changes: [], packetItem: { statement: "", file: null, detail: null } };
      judged.push({ cell, judged: c.kind === "labelled" ? c.anticipated : null });
    }
  }
  return gate(s, judged, { perClass: o.perClass ?? JUDGING.recheck.perClass, minLists: o.distinctLists ?? JUDGING.recheck.distinctLists, seed: "recheck" });
}

/** The plain rendering of a seeded subset of 40 gold cells per family, kept so the owner could label it later. */
export function plainSubset(s: CheckSubject, gold: readonly GoldCell[]): string {
  const pick = shuffle([...gold].sort((a, b) => (a.id < b.id ? -1 : 1)), rngFor("plain subset\n" + s.judge)).slice(0, JUDGING.plainSubsetPerFamily);
  return pick.map((g, k) => "Cell " + (k + 1) + "\nItem: " + g.packetItem.statement + (g.packetItem.file ? " (file: " + g.packetItem.file + ")" : "") + "\nChanges:\n" + g.changes.map((c, i) => "  " + (i + 1) + ". " + c).join("\n") + "\nGold: " + (g.gold ? "anticipated" : "not anticipated")).join("\n\n");
}

/** One judge route the probe calls: a judge model at a frozen effort and output cap. */
export interface Route {
  name: string;
  judge: Judge;
  effort: "medium" | "max";
  maxTokens: number;
}
/** Every judge route: production labels and the check pass for all three families, pairwise for Astra and Opus, the arm guess for Astra. */
export const ROUTES: readonly Route[] = [
  ...(["astra", "opus", "argon"] as const).map((judge) => ({ name: "labels:" + judge, judge, effort: JUDGING.productionEffort, maxTokens: MONEY.outputCaps.productionLabels })),
  ...(["astra", "opus", "argon"] as const).map((judge) => ({ name: "check:" + judge, judge, effort: JUDGING.checkEffort, maxTokens: MONEY.outputCaps.judgeCheck })),
  ...(["astra", "opus"] as const).map((judge) => ({ name: "pairwise:" + judge, judge, effort: JUDGING.productionEffort, maxTokens: MONEY.outputCaps.pairwise })),
  { name: "arm-guess:astra", judge: "astra", effort: JUDGING.productionEffort, maxTokens: MONEY.outputCaps.probe },
];

/** The live judge probe: one call down every route; a route passes when text comes back. */
export async function liveProbe(call: JudgeCaller, routes: readonly Route[] = ROUTES): Promise<{ route: string; ok: boolean; problem: string | null }[]> {
  const prompt = loadPrompt("probe");
  const out: { route: string; ok: boolean; problem: string | null }[] = [];
  for (const r of routes) {
    const reply = await call({ judge: r.judge, prompt, effort: r.effort, maxTokens: r.maxTokens, label: "probe:" + r.name, subject: null, cacheKey: "probe|" + r.name + "|" + SEED });
    const ok = typeof reply.text === "string" && reply.text.trim().length > 0;
    out.push({ route: r.name, ok, problem: ok ? null : reply.problem ?? "no text came back" });
  }
  return out;
}
