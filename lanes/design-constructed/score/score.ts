// Copyright (c) 2026 Garry Tan. MIT License.
// The scorer: A, G and D from fixedMatching (M6), every prereg section 7 secondary, stock counts under PD-4 and PD-8, and the decoy and wrong-way label reads (PD-5).
// Copied from lanes/devex/score/score.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94: every credit is fixedMatching's
// (M1), each read takes its own matching over its own items (M6), and units are means of their scored passes (M13).
//
// - A scored review's primary matching runs over the unit's primary items at the read tier, with the reader's edges and,
//   at 10x, the detail per edge. It gives A, G, D, A by class, A without Y, the per-item credits, and the tie-break print.
// - A no-block or arm-stop review scores 0 on every block score; a missing or incomplete review has none. A review with
//   any unlabelled primary cell is unscored and counts missing (E_DC_LABEL_MISSING), never as not anticipated.
// - Decoy and wrong-way items never enter a matching (M7). Their rates are label reads, at 2x only.
// - Stock rows are scored like lists. A row counts a unit (its base id) when a counted packet's stock list credits a
//   primary item; a packet that credits nothing but holds an unlabelled primary cell leaves the unit unlabelled for
//   that row (PD-4). Counted packets: production packets at the base or 2x read, on the stage's own units, holding an
//   arm's list (twin, reference-only and shuffled packets count nothing, PD-8).
import { fail } from "../errors.ts";
import { CELL_STATES, ITEM_CLASSES, STOCK } from "../frozen.ts";
import type { CellState, ItemClass, KeyItem, LabelCell, Matching, MatchItem, Model, SessionKind, Tier, UnitSet } from "../types.ts";
import { fixedMatching } from "./match.ts";
import { fileNamed, keyItems, keyedAt, primaryItems } from "./packets.ts";
import { mean } from "./stats.ts";
import { cellKey, type PacketLabels, type PacketMeta, type ReaderCell, type ReviewRow, type ScoreUnit, type Stage } from "./types.ts";

/** The packet's reader cells by key item id, for one list. */
interface ListCells {
  meta: PacketMeta;
  list: string;
  cells: Map<string, ReaderCell>;
}

/** The reader's cells of one list in one packet, keyed by the key item id (decoy and wrong-way items by role). */
export function listCells(meta: PacketMeta, labels: PacketLabels | undefined, list: string): ListCells {
  const cells = new Map<string, ReaderCell>();
  for (const [pid, ref] of Object.entries(meta.items)) {
    const k = ref.role === "key" ? ref.id : ref.role === "decoy" ? "decoy" : "wrong-way-" + ref.index;
    cells.set(k, labels?.reader.get(cellKey(list, pid)) ?? { kind: "unlabelled", why: "the packet has no labels" });
  }
  return { meta, list, cells };
}

/** The matcher's input for items over one label field, or null when any of their cells is unlabelled. */
export function matchItems(items: readonly KeyItem[], lc: ListCells, tier: Tier, field: "anticipated" | "screenHit" = "anticipated"): MatchItem[] | null {
  const out: MatchItem[] = [];
  for (const it of items) {
    const c = lc.cells.get(it.id);
    if (!c || c.kind === "unlabelled") return null;
    const keyed = field === "anticipated" && keyedAt(it, tier);
    const edges = field === "anticipated" ? c.anticipatedEdges : c.screenHitEdges;
    out.push({ id: it.id, keyedDetail: keyed, edges: edges.map((change) => ({ change, detail: keyed && (c.detailEdges ?? []).includes(change) })) });
  }
  return out;
}

const share = (items: readonly KeyItem[], lc: ListCells, tier: Tier, field: "anticipated" | "screenHit" = "anticipated"): number | null => {
  if (!items.length) return null;
  const m = matchItems(items, lc, tier, field);
  return m === null ? null : fixedMatching(m).credited / items.length;
};

/** M14: the credited items a tie-break decided, those another maximum matching would leave uncredited. */
export function tieDecided(items: readonly MatchItem[], m: Matching = fixedMatching(items)): string[] {
  return items.filter((it) => m.assigned[it.id] !== null && fixedMatching(items.map((x) => (x.id === it.id ? { ...x, edges: [] } : x))).credited === m.credited).map((it) => it.id).sort();
}

export interface Review {
  session: string;
  unit: string;
  model: Model;
  kind: SessionKind;
  stage: Stage;
  pass: number;
  smoke: boolean;
  read: Tier;
  /** The row's state, or label-missing when a primary cell stayed unlabelled. */
  state: CellState;
  count: (typeof CELL_STATES)[CellState]["count"];
  items: number;
  detailItems: number;
  A: number | null;
  /** 10x only. */
  G: number | null;
  /** 10x only, over units with at least one detail-keyed item. */
  D: number | null;
  credited: number | null;
  assigned: Record<string, number | null> | null;
  byClass: Record<ItemClass, number | null>;
  withoutY: number | null;
  screenHit: number | null;
  precision: number | null;
  /** Shuffled A, or shuffled G at 10x (PD-7). */
  shuffled: number | null;
  specificity: number | null;
  mentioned: number | null;
  generic: number | null;
  /** 2x only. */
  decoyHit: boolean | null;
  /** 2x only. */
  wrongWayHit: boolean | null;
  evidenceOpened: boolean | null;
  fileRead: number | null;
  words: number;
  /** Credited items whose edges came from Gemini's fallback (M11), and from the other judges under R2-18. */
  viaGemini: number;
  viaOthers: number;
  /** PD-26: primary items whose panel cell is a split yes, which no change can credit. */
  splitCells: number;
  /** PD-26's sensitivity read: A and G with the old union edges on split cells. It decides nothing. */
  unionA: number | null;
  unionG: number | null;
  tieDecided: string[];
  /** Why the review is label-missing, when it is. */
  unlabelled: string[];
}

export interface ScoreInput {
  read: Tier;
  units: ReadonlyMap<string, ScoreUnit>;
  rows: readonly ReviewRow[];
  metas: readonly PacketMeta[];
  labels: ReadonlyMap<string, PacketLabels>;
}

const nullClasses = (): Record<ItemClass, number | null> => Object.fromEntries(ITEM_CLASSES.map((c) => [c, null])) as Record<ItemClass, number | null>;

/** Scores every row of the read: one Review each. */
export function scoreReviews(inp: ScoreInput): Review[] {
  const where = new Map<string, { meta: PacketMeta; list: string }[]>();
  for (const meta of inp.metas) {
    if (meta.tier !== inp.read || (meta.role !== "production" && meta.role !== "shuffled")) continue;
    for (const [lid, ref] of Object.entries(meta.lists)) if (ref.session) where.set(ref.session, [...(where.get(ref.session) ?? []), { meta, list: lid }]);
  }
  return inp.rows.map((r) => {
    const u = inp.units.get(r.unit);
    if (!u) fail("E_USAGE", "row " + r.session + " names unit " + r.unit + ", which has no key");
    const prim = primaryItems(u!.key);
    const kept = keyItems(u!.key);
    const tenX = inp.read === "10x";
    const detailItems = prim.filter((i) => keyedAt(i, inp.read)).length;
    const base: Review = {
      session: r.session, unit: r.unit, model: r.model, kind: r.kind, stage: r.stage, pass: r.pass, smoke: r.smoke, read: inp.read, state: r.state, count: CELL_STATES[r.state].count,
      items: prim.length, detailItems, A: null, G: null, D: null, credited: null, assigned: null, byClass: nullClasses(), withoutY: null, screenHit: null, precision: null, shuffled: null, specificity: null, mentioned: null, generic: null, decoyHit: null, wrongWayHit: null,
      evidenceOpened: r.evidenceOpened === null ? null : r.evidenceOpened.length > 0, fileRead: null, words: r.words, viaGemini: 0, viaOthers: 0, splitCells: 0, unionA: null, unionG: null, tieDecided: [], unlabelled: [],
    };
    const ofClass = (items: readonly KeyItem[], c: ItemClass) => items.filter((i) => i.class === c);
    if (base.count === "missing" || base.count === "incomplete") return base;
    if (base.count === "zero") {
      const zero = (items: readonly KeyItem[]) => (items.length ? 0 : null);
      return {
        ...base, A: 0, G: tenX ? 0 : null, unionA: 0, unionG: tenX ? 0 : null, D: tenX && detailItems ? 0 : null, credited: 0, byClass: Object.fromEntries(ITEM_CLASSES.map((c) => [c, zero(ofClass(prim, c))])) as Record<ItemClass, number | null>,
        withoutY: zero(prim.filter((i) => i.class !== "Y")), screenHit: 0, shuffled: 0, specificity: 0, mentioned: zero(kept.filter((i) => i.mentioned)), generic: zero(kept.filter((i) => i.generic)),
        decoyHit: inp.read === "2x" ? false : null, wrongWayHit: inp.read === "2x" ? false : null, fileRead: 0,
      };
    }
    if (r.list === null) fail("E_USAGE", "row " + r.session + " is " + r.state + " but holds no list");
    const at = where.get(r.session) ?? [];
    const prod = at.find((w) => w.meta.role === "production");
    if (!prod) fail("E_USAGE", "session " + r.session + " holds a list but no " + inp.read + " production packet holds it; build packets from these rows");
    const lc = listCells(prod!.meta, inp.labels.get(prod!.meta.id), prod!.list);
    const unl = prim.filter((i) => lc.cells.get(i.id)!.kind === "unlabelled").map((i) => i.id + ": " + (lc.cells.get(i.id) as Extract<LabelCell, { kind: "unlabelled" }>).why);
    if (unl.length) return { ...base, state: "label-missing", count: "missing", unlabelled: unl };
    const mi = matchItems(prim, lc, inp.read)!;
    const m = fixedMatching(mi);
    const A = m.credited / prim.length;
    const G = tenX ? m.score / (2 * prim.length) : null;
    const primary = tenX ? G! : A;
    const creditedIn = (items: readonly KeyItem[]) => (items.length ? items.filter((i) => m.assigned[i.id] !== null).length / items.length : null);
    const sh = at.find((w) => w.meta.role === "shuffled");
    let shuffled: number | null = null;
    if (sh) {
      const pu = inp.units.get(sh.meta.unit);
      if (!pu) fail("E_USAGE", "shuffled packet " + sh.meta.id + " names unit " + sh.meta.unit + ", which has no key");
      const pp = primaryItems(pu!.key);
      const smi = matchItems(pp, listCells(sh.meta, inp.labels.get(sh.meta.id), sh.list), inp.read);
      if (smi && pp.length) {
        const sm = fixedMatching(smi);
        shuffled = tenX ? sm.score / (2 * pp.length) : sm.credited / pp.length;
      }
    }
    const all = matchItems(kept, lc, inp.read);
    const cellOf = (k: string) => lc.cells.get(k);
    const yes = (c: ReaderCell | undefined) => (c === undefined ? null : c.kind === "unlabelled" ? null : c.anticipated);
    let decoyHit: boolean | null = null;
    let wrongWayHit: boolean | null = null;
    if (inp.read === "2x") {
      decoyHit = yes(cellOf("decoy"));
      const ww = u!.key.wrongWay.map((_, k) => yes(cellOf("wrong-way-" + (k + 1))));
      wrongWayHit = ww.some((v) => v === true) ? true : ww.every((v) => v === false) ? false : null;
    }
    const via = (v: string) => prim.filter((i) => m.assigned[i.id] !== null && (lc.cells.get(i.id) as { via?: string }).via === v).length;
    const splitCells = prim.filter((i) => (lc.cells.get(i.id) as ReaderCell).split === true).length;
    const unionCells: ListCells = { ...lc, cells: new Map([...lc.cells].map(([k, c]) => [k, c.kind === "labelled" && c.union ? { ...c, ...c.union } : c])) };
    const um = splitCells ? fixedMatching(matchItems(prim, unionCells, inp.read)!) : m;
    return {
      ...base,
      A, G,
      D: tenX && detailItems ? m.detailCredited / detailItems : null,
      credited: m.credited,
      assigned: m.assigned,
      byClass: Object.fromEntries(ITEM_CLASSES.map((c) => [c, creditedIn(ofClass(prim, c))])) as Record<ItemClass, number | null>,
      withoutY: creditedIn(prim.filter((i) => i.class !== "Y")),
      screenHit: share(prim, lc, inp.read, "screenHit"),
      precision: all && r.list!.length ? fixedMatching(all).credited / r.list!.length : null,
      shuffled,
      specificity: shuffled === null ? null : primary - shuffled,
      mentioned: share(kept.filter((i) => i.mentioned), lc, inp.read),
      generic: share(kept.filter((i) => i.generic), lc, inp.read),
      decoyHit, wrongWayHit,
      fileRead: prim.filter((i) => fileNamed(i, r.list!)).length / prim.length,
      viaGemini: via("gemini"),
      viaOthers: via("others"),
      splitCells,
      unionA: um.credited / prim.length,
      unionG: tenX ? um.score / (2 * prim.length) : null,
      tieDecided: tieDecided(mi, m),
    };
  });
}

/**
 * M8: any list in a packet scored like a review (a stock row, the oracle list): its primary matching's A and, at 10x,
 * G; null when a primary cell is unlabelled. The oracle credit and the stock prints read this.
 */
export function scoreList(meta: PacketMeta, labels: PacketLabels | undefined, list: string, unit: ScoreUnit): { A: number; G: number | null; credited: number } | null {
  const prim = primaryItems(unit.key);
  const mi = prim.length ? matchItems(prim, listCells(meta, labels, list), meta.tier) : null;
  if (!mi) return null;
  const m = fixedMatching(mi);
  return { A: m.credited / prim.length, G: meta.tier === "10x" ? m.score / (2 * prim.length) : null, credited: m.credited };
}

/** M13: each unit's mean over its reviews with a value, then those unit means. */
export function unitMeans(reviews: readonly Review[], f: (r: Review) => number | null): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of reviews) {
    const v = f(r);
    if (v !== null) by.set(r.unit, [...(by.get(r.unit) ?? []), v]);
  }
  return new Map([...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([u, vs]) => [u, mean(vs)]));
}
export const unitWeighted = (reviews: readonly Review[], f: (r: Review) => number | null): number | null => {
  const ms = [...unitMeans(reviews, f).values()];
  return ms.length ? mean(ms) : null;
};
const asShare = (b: boolean | null) => (b === null ? null : b ? 1 : 0);

export interface ArmSummary {
  model: Model;
  kind: SessionKind;
  read: Tier;
  units: number;
  A: number | null;
  G: number | null;
  D: number | null;
  byClass: Record<ItemClass, number | null>;
  withoutY: number | null;
  screenHit: number | null;
  precision: number | null;
  shuffled: number | null;
  specificity: number | null;
  mentioned: number | null;
  generic: number | null;
  decoyHitRate: number | null;
  wrongWayHitRate: number | null;
  evidenceRead: number | null;
  fileRead: number | null;
  words: number | null;
  /** Counts that print beside G and the funnel. */
  viaGemini: number;
  viaOthers: number;
  /** PD-26: split cells over the arm's primary items, and A and G under the old union, for the sensitivity read. */
  splitCells: number;
  unionA: number | null;
  unionG: number | null;
  tieDecided: number;
  labelMissing: number;
  planned: number;
}

/** Every section 7 secondary of one arm on one model, unit-weighted (M13); smoke reviews are left out. */
export function armSummary(reviews: readonly Review[], model: Model, kind: SessionKind): ArmSummary {
  const rs = reviews.filter((r) => r.model === model && r.kind === kind && !r.smoke);
  const m = (f: (r: Review) => number | null) => unitWeighted(rs, f);
  return {
    model, kind, read: rs[0]?.read ?? "base",
    units: unitMeans(rs, (r) => r.A).size,
    A: m((r) => r.A), G: m((r) => r.G), D: m((r) => r.D),
    byClass: Object.fromEntries(ITEM_CLASSES.map((c) => [c, m((r) => r.byClass[c])])) as Record<ItemClass, number | null>,
    withoutY: m((r) => r.withoutY), screenHit: m((r) => r.screenHit), precision: m((r) => r.precision), shuffled: m((r) => r.shuffled), specificity: m((r) => r.specificity),
    mentioned: m((r) => r.mentioned), generic: m((r) => r.generic),
    decoyHitRate: m((r) => asShare(r.decoyHit)), wrongWayHitRate: m((r) => asShare(r.wrongWayHit)),
    evidenceRead: m((r) => asShare(r.evidenceOpened)), fileRead: m((r) => r.fileRead), words: m((r) => (r.count === "score" || r.count === "zero" ? r.words : null)),
    viaGemini: rs.reduce((s, r) => s + r.viaGemini, 0), viaOthers: rs.reduce((s, r) => s + r.viaOthers, 0), splitCells: rs.reduce((s, r) => s + r.splitCells, 0), unionA: m((r) => r.unionA), unionG: m((r) => r.unionG), tieDecided: rs.reduce((s, r) => s + r.tieDecided.length, 0),
    labelMissing: rs.filter((r) => r.state === "label-missing").length, planned: rs.length,
  };
}

export type StockStatus = "credited" | "unlabelled" | "not";
export interface StockCount {
  model: Model;
  /** The base unit's id. */
  unit: string;
  row: 1 | 2 | 3;
  status: StockStatus;
  /** The counted packets that credited the row on this unit. */
  packets: string[];
}

const ARM_SOURCES = new Set<string>(["none", "lens", "plan-design-review", "autoplan"]);

/** PD-8's counted packets: production, base or 2x read, the stage's own unit set, at least one arm's list. */
export const countsForStock = (meta: PacketMeta, unitSet: UnitSet | null, stageSet: UnitSet): boolean =>
  meta.role === "production" && (meta.tier === "base" || meta.tier === "2x") && unitSet === stageSet && Object.values(meta.lists).some((l) => ARM_SOURCES.has(l.source));

/**
 * Each stock row's status per model and unit under PD-4 and PD-8: credited when any counted packet's stock list
 * credits a primary item; else unlabelled when a counted packet's stock list left a primary cell unlabelled; else not.
 */
export function stockCounts(o: { metas: readonly PacketMeta[]; labels: ReadonlyMap<string, PacketLabels>; units: ReadonlyMap<string, ScoreUnit>; stageSet: UnitSet }): StockCount[] {
  const acc = new Map<string, StockCount>();
  const rank: Record<StockStatus, number> = { not: 0, unlabelled: 1, credited: 2 };
  for (const meta of o.metas) {
    const u = o.units.get(meta.unit);
    if (!u) fail("E_USAGE", "packet " + meta.id + " names unit " + meta.unit + ", which has no key");
    if (!countsForStock(meta, u!.unit.set, o.stageSet)) continue;
    const prim = primaryItems(u!.key);
    for (const [lid, ref] of Object.entries(meta.lists)) {
      if (!ref.source.startsWith("stock-")) continue;
      const row = Number(ref.source.slice(6)) as 1 | 2 | 3;
      const lc = listCells(meta, o.labels.get(meta.id), lid);
      const labelled = prim.filter((i) => lc.cells.get(i.id)!.kind === "labelled");
      const credited = labelled.length ? fixedMatching(matchItems(labelled, lc, meta.tier)!).credited > 0 : false;
      const status: StockStatus = credited ? "credited" : labelled.length < prim.length ? "unlabelled" : "not";
      const k = [meta.model, u!.base, row].join("|");
      const prior = acc.get(k) ?? { model: meta.model, unit: u!.base, row, status: "not" as StockStatus, packets: [] };
      acc.set(k, { ...prior, status: rank[status] > rank[prior.status] ? status : prior.status, packets: credited ? [...prior.packets, meta.id].sort() : prior.packets });
    }
  }
  return [...acc.values()].sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : a.row - b.row));
}

export interface StockReading {
  model: Model;
  stage: Stage;
  units: number;
  rows: { row: 1 | 2 | 3; credited: number; unlabelled: number; fail: boolean; failIfUnlabelledCredited: boolean }[];
  fail: boolean;
  /** PD-4: the line is crossed with every unlabelled cell credited and not as observed; the read goes to the Captain first. */
  toCaptain: boolean;
  consequence: "none" | "ends the eval" | "untested (stock)" | "to the Captain";
}

/** STOCK FAIL: row 1 or 2 credited on more than 2 of the 16 calibration units (stage 1), or more than one unit in eight (stage 2). Row 3 prints. */
export function stockReading(counts: readonly StockCount[], model: Model, stage: Stage, units: number): StockReading {
  const over = (n: number) => (stage === 1 ? n > STOCK.stage1MaxUnits : n > units * STOCK.stage2MaxShare);
  const rows = ([1, 2, 3] as const).map((row) => {
    const mine = counts.filter((c) => c.model === model && c.row === row);
    const credited = mine.filter((c) => c.status === "credited").length;
    const unlabelled = mine.filter((c) => c.status === "unlabelled").length;
    return { row, credited, unlabelled, fail: row !== 3 && over(credited), failIfUnlabelledCredited: row !== 3 && over(credited + unlabelled) };
  });
  const failed = rows.some((r) => r.fail);
  const toCaptain = !failed && rows.some((r) => r.failIfUnlabelledCredited);
  return { model, stage, units, rows, fail: failed, toCaptain, consequence: toCaptain ? "to the Captain" : !failed ? "none" : stage === 1 && model === "opus" ? "ends the eval" : "untested (stock)" };
}
