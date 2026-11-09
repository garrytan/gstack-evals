// Copyright (c) 2026 Garry Tan. MIT License.
// dx score (prereg 2026-11-09-geva-417, sections 6, 8 and 11): A per review with one-to-one credit, and every secondary the
// labels and rows give. A = credited primary items / the unit's primary items, where credit is a maximum one-to-one
// matching between the list's changes and the key items over every change index the judge named, so one change earns at
// most one item. A no-block reply and a session the arm stopped score 0; a missing or contaminated session is missing; a
// review with any unlabelled primary cell is unscored and counts against coverage, never as not anticipated. A unit's arm
// score is the mean over its passes and units weigh equally. Each secondary takes its own matching over its own items.
import { maxMatching, mean } from "../../aftermath/stats.ts";
import type { ArmId, ItemClass, Key, KeyItem, Label, ModelId, Row, Stage, UnitMeta } from "../types.ts";
import { READER, type LabelRecord, type PacketMap, type PacketMeta, type Reader } from "./packets.ts";

export type Status = "scored" | "no-block" | "stop" | "missing" | "unscored";
export const CLASSES: readonly ItemClass[] = ["G", "E", "D", "U"];
/** The strict stratum: units first exposed on or after this date print beside every Opus primary (section 11). */
export const STRICT_FROM = "2026-08-01";

export interface Review {
  unit: string;
  model: ModelId;
  arm: ArmId;
  stage: Stage;
  pass: number;
  smoke: boolean;
  session: string;
  status: Status;
  /** Primary A; 0 for no-block and arm stops; null when missing or unscored. */
  A: number | null;
  credited: number | null;
  shuffled: number | null;
  specificity: number | null;
  by_class: Record<ItemClass, number | null>;
  surface: number | null;
  who: number | null;
  precision: number | null;
  outside: number | null;
  followup: number | null;
  mentioned: number | null;
  generic: number | null;
  foreseeable: number | null;
  words: number;
  exposed: boolean | null;
  markers: Record<string, boolean>;
  spend_micros: number | null;
}

/** The records a reader's labels come from in a packet: Astra's or Opus's own, or the panel's. */
export const readerOf = (meta: PacketMeta): Reader => (meta.model ? READER[meta.model] : "astra");

export type LabelIndex = Map<string, Map<string, Label | null>>;

/** Indexes labels by packet, then list|item, keeping only the records of reader(meta) (default: the production judge). */
export function indexLabels(map: PacketMap, labels: readonly LabelRecord[], reader: (meta: PacketMeta) => string = readerOf): LabelIndex {
  const out: LabelIndex = new Map();
  for (const l of labels) {
    const meta = map.packets[l.packet];
    if (!meta || l.judge !== reader(meta)) continue;
    const cells = out.get(l.packet) ?? new Map();
    cells.set(l.list + "|" + l.item, l.label);
    out.set(l.packet, cells);
  }
  return out;
}

export type Field = "anticipated" | "surface" | "who";
const IDX: Record<Field, "changes" | "surface_changes" | "who_changes"> = { anticipated: "changes", surface: "surface_changes", who: "who_changes" };

/** Credited items over key item ids for one list in one packet, or null when any of their cells is unlabelled. */
export function credit(meta: PacketMeta, cells: Map<string, Label | null> | undefined, list: string, itemIds: readonly string[], field: Field = "anticipated"): { credited: number; total: number } | null {
  const pid = new Map(Object.entries(meta.items).map(([p, k]) => [k, p]));
  const edges: number[][] = [];
  for (const it of itemIds) {
    const p = pid.get(it);
    if (p === undefined) return null;
    const lab = cells?.get(list + "|" + p);
    if (!lab) return null;
    edges.push(lab[field] === true ? lab[IDX[field]] : []);
  }
  return { credited: maxMatching(edges).size, total: itemIds.length };
}

const share = (c: { credited: number; total: number } | null): number | null => (c && c.total ? c.credited / c.total : null);

export interface ScoreInput {
  units: ReadonlyMap<string, { meta: UnitMeta; key: Key }>;
  rows: readonly Row[];
  map: PacketMap;
  labels: readonly LabelRecord[];
}

/** The foreseeable stratum: primary items no auditor rated no. */
export const foreseeable = (i: KeyItem): boolean => i.foreseeable !== null && i.foreseeable.opus !== "no" && i.foreseeable.sol !== "no";

/** Scores every review row of the map's stage. */
export function scoreReviews(inp: ScoreInput): Review[] {
  const idx = indexLabels(inp.map, inp.labels);
  const where = new Map<string, Array<{ meta: PacketMeta; list: string }>>();
  for (const meta of Object.values(inp.map.packets))
    for (const [lid, ref] of Object.entries(meta.lists)) if (ref.kind === "arm" && ref.session) where.set(ref.session, [...(where.get(ref.session) ?? []), { meta, list: lid }]);
  const out: Review[] = [];
  for (const r of inp.rows.filter((x) => x.stage === inp.map.stage)) {
    const u = inp.units.get(r.unit);
    if (!u) throw new Error("row " + r.session + " names unit " + r.unit + ", which has no key");
    const key = u.key;
    const nulls = { by_class: { G: null, E: null, D: null, U: null }, surface: null, who: null, precision: null, outside: null, followup: null, mentioned: null, generic: null, foreseeable: null };
    const base: Review = { unit: r.unit, model: r.model, arm: r.arm, stage: r.stage, pass: r.pass, smoke: r.smoke, session: r.session, status: "missing", A: null, credited: null, shuffled: null, specificity: null, ...nulls, words: r.words, exposed: r.exposed, markers: r.markers, spend_micros: r.spend_micros };
    if (r.end === "missing" || r.end === "contaminated") {
      out.push(base);
      continue;
    }
    if (r.end === "no-block" || r.end === "session-stop") {
      out.push({ ...base, status: r.end === "no-block" ? "no-block" : "stop", A: 0, credited: 0, shuffled: 0, specificity: 0 });
      continue;
    }
    const prod = where.get(r.session)?.find((w) => w.meta.role === "production");
    if (!prod) throw new Error("session " + r.session + " ends in a block but no production packet holds its list; build packets from these rows");
    const cells = idx.get(prod.meta.id);
    const on = (ids: readonly string[], field: Field = "anticipated") => share(credit(prod.meta, cells, prod.list, ids, field));
    const primary = credit(prod.meta, cells, prod.list, key.primary);
    if (!primary) {
      out.push({ ...base, status: "unscored" });
      continue;
    }
    const byId = new Map(key.items.map((i) => [i.id, i]));
    const prim = key.primary.map((id) => byId.get(id)!);
    const A = primary.credited / primary.total;
    const sh = where.get(r.session)?.find((w) => w.meta.role === "shuffled");
    const shKey = sh ? inp.units.get(sh.meta.unit)?.key : null;
    const shuffled = sh && shKey ? share(credit(sh.meta, idx.get(sh.meta.id), sh.list, shKey.primary)) : null;
    const all = credit(prod.meta, cells, prod.list, key.items.map((i) => i.id));
    const n = r.list!.length;
    const ids = (pred: (i: KeyItem) => boolean, from: readonly KeyItem[] = prim) => from.filter(pred).map((i) => i.id);
    out.push({
      ...base,
      status: "scored",
      A,
      credited: primary.credited,
      shuffled,
      specificity: shuffled === null ? null : A - shuffled,
      by_class: Object.fromEntries(CLASSES.map((c) => [c, on(ids((i) => i.class === c))])) as Record<ItemClass, number | null>,
      surface: on(key.primary, "surface"),
      who: on(ids((i) => i.context !== null), "who"),
      precision: all && n ? all.credited / n : null,
      outside: on(ids((i) => i.source === "outside")),
      followup: on(ids((i) => i.source !== "outside")),
      mentioned: on(ids((i) => i.mentioned, key.items)),
      generic: on(ids((i) => i.generic, key.items)),
      foreseeable: on(ids(foreseeable)),
    });
  }
  return out;
}

export interface StockCredit {
  unit: string;
  model: ModelId;
  row: number;
  /** Null when a primary cell of the row stayed unlabelled in every packet of the unit. */
  credited: boolean | null;
}

/** Section 8: whether each stock row earned a primary item on each unit for each model, from the production judge's labels. */
export function stockCredits(inp: Omit<ScoreInput, "rows">): StockCredit[] {
  const idx = indexLabels(inp.map, inp.labels);
  const acc = new Map<string, StockCredit>();
  for (const meta of Object.values(inp.map.packets)) {
    if (meta.role !== "production" || !meta.model) continue;
    const key = inp.units.get(meta.unit)!.key;
    for (const [lid, ref] of Object.entries(meta.lists)) {
      if (ref.kind !== "stock") continue;
      const c = credit(meta, idx.get(meta.id), lid, key.primary);
      const k = meta.unit + "|" + meta.model + "|" + ref.stock;
      const prior = acc.get(k);
      const v = c === null ? null : c.credited > 0;
      acc.set(k, { unit: meta.unit, model: meta.model, row: ref.stock!, credited: prior?.credited === true || v === true ? true : prior?.credited === false || v === false ? false : null });
    }
  }
  return [...acc.values()].sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : a.model < b.model ? -1 : a.model > b.model ? 1 : a.row - b.row));
}

/** Section 3's primary rule: neither mentioned nor generic, at most 6, in rank order. */
export const primaryOf = (key: Key): string[] => key.items.filter((i) => !i.mentioned && !i.generic).slice(0, 6).map((i) => i.id);

/**
 * The generic screen (section 3): Astra and Opus each label every key item against stock rows 1 and 2 as if they were
 * reviews; an item either judge marks anticipated on either row becomes generic. It reads no arm output. A cell still
 * missing after the one resend leaves its item not generic and is counted. Returns each key with generic flags and its
 * primary recomputed, and the units left with no primary item (dropped, never deleted).
 */
export function genericScreen(map: PacketMap, labels: readonly LabelRecord[], keys: ReadonlyMap<string, Key>): { keys: Map<string, Key>; generic: number; unlabelled: number; dropped: string[] } {
  const hits = new Map<string, Set<string>>();
  let unlabelled = 0;
  for (const l of labels) {
    const meta = map.packets[l.packet];
    if (!meta || meta.role !== "generic" || (l.judge !== "astra" && l.judge !== "opus")) continue;
    if (l.label === null) unlabelled++;
    else if (l.label.anticipated) hits.set(meta.unit, (hits.get(meta.unit) ?? new Set()).add(meta.items[l.item]!));
  }
  const out = new Map<string, Key>();
  let generic = 0;
  const dropped: string[] = [];
  for (const [unit, key] of keys) {
    const items = key.items.map((i) => (hits.get(unit)?.has(i.id) ? { ...i, generic: true } : i));
    generic += items.filter((i) => i.generic).length;
    const next = { ...key, items, primary: primaryOf({ ...key, items }) };
    if (!next.primary.length) dropped.push(unit);
    out.set(unit, next);
  }
  return { keys: out, generic, unlabelled, dropped };
}

/** Unit-weighted mean of a review field over reviews with a value: each unit's mean over its passes, then the mean over units. */
export function unitMean(reviews: readonly Review[], f: (r: Review) => number | null): { mean: number | null; units: number } {
  const byUnit = new Map<string, number[]>();
  for (const r of reviews) {
    const v = f(r);
    if (v !== null) byUnit.set(r.unit, [...(byUnit.get(r.unit) ?? []), v]);
  }
  const ms = [...byUnit.values()].map(mean);
  return { mean: ms.length ? mean(ms) : null, units: ms.length };
}

export const isMissing = (r: Review): boolean => r.status === "missing" || r.status === "unscored";

export interface ArmSummary {
  model: ModelId;
  arm: ArmId;
  A: number | null;
  units: number;
  by_class: Record<ItemClass, number | null>;
  surface: number | null;
  who: number | null;
  precision: number | null;
  specificity: number | null;
  shuffled: number | null;
  outside: number | null;
  followup: number | null;
  mentioned: number | null;
  generic: number | null;
  foreseeable: number | null;
  strict: { A: number | null; units: number };
  by_month: Record<string, number | null>;
  prerelease: { A: number | null; units: number };
  release: { A: number | null; units: number };
  by_dev_class: Record<string, { A: number | null; units: number }>;
  markers: Record<string, { shown: number | null; not: number | null }>;
  cost_per_review: number | null;
  cost_per_credited_item: number | null;
}

/** Every section 8 and 11 secondary of one arm on one model, unit-weighted. */
export function armSummary(reviews: readonly Review[], metas: ReadonlyMap<string, UnitMeta>, model: ModelId, arm: ArmId): ArmSummary {
  const rs = reviews.filter((r) => r.model === model && r.arm === arm && !r.smoke);
  const m = (f: (r: Review) => number | null, from: readonly Review[] = rs) => unitMean(from, f).mean;
  const sub = (pred: (u: UnitMeta) => boolean) => {
    const u = unitMean(rs.filter((r) => pred(metas.get(r.unit)!)), (r) => r.A);
    return { A: u.mean, units: u.units };
  };
  const months = [...new Set(rs.map((r) => metas.get(r.unit)!.merged_at.slice(0, 7)))].sort();
  const classes = [...new Set(rs.map((r) => metas.get(r.unit)!.dev_class))].sort();
  const markerNames = [...new Set(rs.flatMap((r) => Object.keys(r.markers)))].sort();
  const spent = rs.filter((r) => r.spend_micros !== null);
  const credited = rs.reduce((s, r) => s + (r.credited ?? 0), 0);
  const cost = spent.reduce((s, r) => s + r.spend_micros!, 0) / 1e6;
  return {
    model,
    arm,
    A: m((r) => r.A),
    units: unitMean(rs, (r) => r.A).units,
    by_class: Object.fromEntries(CLASSES.map((c) => [c, m((r) => r.by_class[c])])) as Record<ItemClass, number | null>,
    surface: m((r) => r.surface),
    who: m((r) => r.who),
    precision: m((r) => r.precision),
    specificity: m((r) => r.specificity),
    shuffled: m((r) => r.shuffled),
    outside: m((r) => r.outside),
    followup: m((r) => r.followup),
    mentioned: m((r) => r.mentioned),
    generic: m((r) => r.generic),
    foreseeable: m((r) => r.foreseeable),
    strict: sub((u) => u.earliest_exposure.slice(0, 10) >= STRICT_FROM),
    by_month: Object.fromEntries(months.map((mo) => [mo, unitMean(rs.filter((r) => metas.get(r.unit)!.merged_at.slice(0, 7) === mo), (r) => r.A).mean])),
    prerelease: sub((u) => u.release.prerelease),
    release: sub((u) => !u.release.prerelease),
    by_dev_class: Object.fromEntries(classes.map((c) => [c, sub((u) => u.dev_class === c)])),
    markers: Object.fromEntries(markerNames.map((k) => [k, { shown: m((r) => r.A, rs.filter((r) => r.markers[k] === true)), not: m((r) => r.A, rs.filter((r) => r.markers[k] === false)) }])),
    cost_per_review: spent.length ? cost / spent.length : null,
    cost_per_credited_item: credited ? cost / credited : null,
  };
}
