// Copyright (c) 2026 Garry Tan. MIT License.
// pv score (prereg 2026-11-08-geva-403, sections 6, 8 and 11): A per review with one-to-one credit, and every secondary
// the labels and rows give. A = credited primary items / the unit's primary items, where credit is a maximum one-to-one
// matching between the list's changes and the key items over every change index the judge named, so one change earns
// at most one item. A no-block reply scores 0; a missing or web-contaminated session is missing; a review with any
// unlabelled primary cell is unscored and counts as missing. Units weigh equally. Each secondary takes its own maximum
// matching over its own item set.
import type { Io } from "./cli.ts";
import { loadUnits, need, parseArgs, PvError, readJson, readRecords, readRows, refuseAliases, refuseInRepo, writeJson, type LoadedUnit } from "./io.ts";
import type { PairRecord, ProbeRecord } from "./judge.ts";
import type { LabelRecord, PacketMap, PacketMeta } from "./packets.ts";
import { clusterBootstrap, DRAWS, expit, logistic, maxMatching, mean, ols, percentileInterval, r4, SEED } from "./stats.ts";
import type { ArmId, Family, Label, ModelId, Row } from "./types.ts";

export type Status = "scored" | "no-block" | "missing" | "unscored";

export interface Review {
  unit: string;
  family: Family;
  model: ModelId;
  arm: ArmId;
  pass: number;
  session: string;
  status: Status;
  /** Primary A; 0 for no-block; null when missing or unscored. */
  A: number | null;
  shuffled: number | null;
  specificity: number | null;
  A_R: number | null;
  A_generic: number | null;
  A_mentioned: number | null;
  A_U: number | null;
  A_E: number | null;
  A_plan: number | null;
  A_foreseeable: number | null;
  precision: number | null;
  multi: number | null;
  words: number;
  items: number;
  cut: number;
  exposed: boolean | null;
  mode: string | null;
}

/** The production judge's records for a packet: the single judge's, or the particle-1 panel's. */
export const productionJudge = (m: PacketMeta): LabelRecord["judge"] => (m.judges.length > 1 ? "panel" : m.judges[0]!);

export type LabelIndex = Map<string, Map<string, Label | null>>;

/** Indexes production labels by packet, then by list|item. */
export function indexLabels(map: PacketMap, labels: readonly LabelRecord[]): LabelIndex {
  const out: LabelIndex = new Map();
  for (const l of labels) {
    const meta = map.packets[l.packet];
    if (!meta || l.judge !== productionJudge(meta)) continue;
    const cells = out.get(l.packet) ?? new Map();
    cells.set(l.list + "|" + l.item, l.label);
    out.set(l.packet, cells);
  }
  return out;
}

/** Credited items over a set of item ids for one list instance, or null when any of their cells is unlabelled. */
export function credit(meta: PacketMeta, cells: Map<string, Label | null> | undefined, list: string, itemIds: readonly string[]): { credited: number; total: number; perChange: Map<number, number> } | null {
  const ids = new Map(Object.entries(meta.items).map(([pid, ref]) => [ref.item, pid]));
  const edges: number[][] = [];
  const perChange = new Map<number, number>();
  for (const it of itemIds) {
    const pid = ids.get(it);
    if (pid === undefined) return null;
    const lab = cells?.get(list + "|" + pid);
    if (!lab) return null;
    edges.push(lab.anticipated ? lab.changes : []);
    for (const c of lab.anticipated ? lab.changes : []) perChange.set(c, (perChange.get(c) ?? 0) + 1);
  }
  return { credited: maxMatching(edges).size, total: itemIds.length, perChange };
}

const share = (c: { credited: number; total: number } | null): number | null => (c && c.total ? c.credited / c.total : null);

export interface ScoreInput {
  units: Map<string, LoadedUnit>;
  rows: Row[];
  map: PacketMap;
  labels: LabelRecord[];
}

/** Scores every review row of the map's family. */
export function scoreReviews(inp: ScoreInput): Review[] {
  const idx = indexLabels(inp.map, inp.labels);
  const where = new Map<string, { role: string; meta: PacketMeta; list: string }[]>();
  for (const meta of Object.values(inp.map.packets))
    for (const [lid, ref] of Object.entries(meta.lists)) if (ref.kind === "arm" && ref.session) where.set(ref.session, [...(where.get(ref.session) ?? []), { role: meta.role, meta, list: lid }]);
  const out: Review[] = [];
  for (const r of inp.rows.filter((x) => x.family === inp.map.family)) {
    const u = inp.units.get(r.unit);
    if (!u?.key) throw new PvError("E_USAGE", "row " + r.session + " names unit " + r.unit + ", which has no key under --units");
    const key = u.key;
    const base: Review = { unit: r.unit, family: r.family, model: r.model, arm: r.arm, pass: r.pass, session: r.session, status: "missing", A: null, shuffled: null, specificity: null, A_R: null, A_generic: null, A_mentioned: null, A_U: null, A_E: null, A_plan: null, A_foreseeable: null, precision: null, multi: null, words: r.words, items: r.items, cut: r.cut, exposed: r.exposed, mode: r.mode ?? null };
    if (r.end === "missing" || r.end === "contaminated") {
      out.push(base);
      continue;
    }
    if (r.end === "no-block") {
      out.push({ ...base, status: "no-block", A: 0, shuffled: 0, specificity: 0 });
      continue;
    }
    const prod = where.get(r.session)?.find((w) => w.role === "production");
    if (!prod) throw new PvError("E_USAGE", "session " + r.session + " ends in a block but no production packet in the map holds its list; build packets from these rows");
    const cells = idx.get(prod.meta.id);
    const ids = (pred: (i: (typeof key.items)[number]) => boolean) => key.items.filter(pred).map((i) => i.id);
    const primary = credit(prod.meta, cells, prod.list, key.primary);
    if (!primary) {
      out.push({ ...base, status: "unscored" });
      continue;
    }
    const byId = new Map(key.items.map((i) => [i.id, i]));
    const A = primary.credited / primary.total;
    const sh = where.get(r.session)?.find((w) => w.role === "shuffled");
    const shKey = sh ? inp.units.get(sh.meta.unit)?.key : null;
    const shuffled = sh && shKey ? share(credit(sh.meta, idx.get(sh.meta.id), sh.list, shKey.primary)) : null;
    const all = credit(prod.meta, cells, prod.list, key.items.map((i) => i.id));
    const n = r.list!.length;
    const prim = new Map<number, number>(primary.perChange);
    out.push({
      ...base,
      status: "scored",
      A,
      shuffled,
      specificity: shuffled === null ? null : A - shuffled,
      A_R: share(credit(prod.meta, cells, prod.list, ids((i) => i.kind === "R"))),
      A_generic: share(credit(prod.meta, cells, prod.list, ids((i) => i.generic && i.kind !== "R"))),
      A_mentioned: share(credit(prod.meta, cells, prod.list, ids((i) => i.mentioned && i.kind !== "R"))),
      A_U: share(credit(prod.meta, cells, prod.list, key.primary.filter((p) => byId.get(p)!.kind === "U"))),
      A_E: share(credit(prod.meta, cells, prod.list, key.primary.filter((p) => byId.get(p)!.kind === "E"))),
      A_plan: r.family === "brief" ? share(credit(prod.meta, cells, prod.list, key.commitments.map((_, i) => "c" + (i + 1)))) : null,
      A_foreseeable: share(credit(prod.meta, cells, prod.list, key.primary.filter((p) => byId.get(p)!.foreseeable !== "no"))),
      precision: all && n ? all.credited / n : null,
      multi: n ? [...prim.values()].filter((k) => k > 1).length / n : null,
    });
  }
  return out;
}

export interface StockCredit {
  unit: string;
  model: ModelId;
  row: number;
  /** Null when a primary cell of the row stayed unlabelled. */
  credited: boolean | null;
}

/** Section 8: whether each stock row earned a primary item on each unit, from the production judge's own labels. */
export function stockCredits(inp: ScoreInput): StockCredit[] {
  const idx = indexLabels(inp.map, inp.labels);
  const out: StockCredit[] = [];
  for (const meta of Object.values(inp.map.packets)) {
    if (meta.role !== "production") continue;
    const key = inp.units.get(meta.unit)!.key!;
    for (const [lid, ref] of Object.entries(meta.lists)) {
      if (ref.kind !== "stock") continue;
      const c = credit(meta, idx.get(meta.id), lid, key.primary);
      out.push({ unit: meta.unit, model: meta.model, row: ref.stock!, credited: c === null ? null : c.credited > 0 });
    }
  }
  return out.sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : a.model < b.model ? -1 : a.model > b.model ? 1 : a.row - b.row));
}

/** Unit-weighted mean of a review field over reviews with a value: each unit's mean, then the mean over units. */
export function unitMean(reviews: readonly Review[], f: (r: Review) => number | null): { mean: number | null; units: number } {
  const byUnit = new Map<string, number[]>();
  for (const r of reviews) {
    const v = f(r);
    if (v !== null) byUnit.set(r.unit, [...(byUnit.get(r.unit) ?? []), v]);
  }
  const ms = [...byUnit.values()].map(mean);
  return { mean: ms.length ? mean(ms) : null, units: ms.length };
}

export interface Pair {
  unit: string;
  pass: number;
  a: Review;
  b: Review;
}
export const isMissing = (r: Review) => r.status === "missing" || r.status === "unscored";

/** Pairs two arms' reviews by unit and pass; a pair with either side missing or unscored drops (section 6). */
export function pairArms(reviews: readonly Review[], model: ModelId, family: Family, b: ArmId, a: ArmId): { pairs: Pair[]; dropped: number } {
  const key = (r: Review) => r.unit + "#" + r.pass;
  const side = (arm: ArmId) => new Map(reviews.filter((r) => r.model === model && r.family === family && r.arm === arm).map((r) => [key(r), r]));
  const A = side(a), B = side(b);
  const pairs: Pair[] = [];
  let dropped = 0;
  for (const [k, rb] of [...B.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const ra = A.get(k);
    if (!ra) continue;
    if (isMissing(ra) || isMissing(rb)) dropped++;
    else pairs.push({ unit: rb.unit, pass: rb.pass, a: ra, b: rb });
  }
  return { pairs, dropped };
}

const interval95 = (draws: number[]): [number, number] | null => (draws.length ? percentileInterval(draws, 0.95) : null);

/** Section 8: the unit-pass difference in A regressed on the difference in word counts; the intercept and its interval. */
export function lengthAdjusted(pairs: readonly Pair[], o = { seed: SEED, draws: DRAWS }): { intercept: number | null; slope: number | null; ci95: [number, number] | null; n: number } {
  const pts = pairs.map((p) => ({ unit: p.unit, x: p.b.words - p.a.words, y: p.b.A! - p.a.A! }));
  if (pts.length < 2) return { intercept: null, slope: null, ci95: null, n: pts.length };
  const fit = ols(pts.map((p) => p.x), pts.map((p) => p.y));
  const draws = clusterBootstrap(pts, (p) => p.unit, (s) => ols(s.map((p) => p.x), s.map((p) => p.y)).intercept, o);
  return { intercept: fit.intercept, slope: fit.slope, ci95: interval95(draws), n: pts.length };
}

export interface PairwiseSummary {
  model: ModelId;
  contrast: string;
  judge: string;
  n: number;
  wins: number;
  losses: number;
  ties: number;
  unread: number;
  /** wins / (wins + losses); ties print beside it. */
  raw: number | null;
  /** A logistic model of the skill's win on the word-count difference (per 10 words), read at equal length. */
  length_controlled: number | null;
  ci95: [number, number] | null;
  first_position: number | null;
}

/** Section 8's pairwise secondary: raw and length-controlled win rates, and the first-position win rate. */
export function pairwiseSummary(map: PacketMap, records: readonly PairRecord[], o = { seed: SEED, draws: DRAWS }): PairwiseSummary[] {
  const groups = new Map<string, Array<{ unit: string; win: number | null; dw: number; first: boolean | null }>>();
  for (const r of records) {
    const meta = map.packets[r.packet];
    if (!meta?.pair) continue;
    const skill = Object.entries(meta.lists).find(([, l]) => l.arm === "skill")!;
    const other = Object.entries(meta.lists).find(([, l]) => l.arm !== "skill")!;
    const k = meta.model + "|" + meta.pair.contrast + "|" + r.judge;
    const win = r.choice === null || r.choice === "tie" ? null : r.choice === skill[0] ? 1 : 0;
    groups.set(k, [...(groups.get(k) ?? []), { unit: meta.unit, win: r.choice === null ? NaN : win, dw: (skill[1].words - other[1].words) / 10, first: r.choice === null || r.choice === "tie" ? null : r.choice === "A" }]);
  }
  const out: PairwiseSummary[] = [];
  for (const [k, xs] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [model, contrast, judge] = k.split("|") as [ModelId, string, string];
    const read = xs.filter((x) => !Number.isNaN(x.win as number));
    const decided = read.filter((x) => x.win !== null) as Array<{ unit: string; win: number; dw: number; first: boolean }>;
    const wins = decided.filter((x) => x.win === 1).length;
    const fit = (s: typeof decided) => (s.length ? expit(logistic(s.map((x) => x.dw), s.map((x) => x.win)).intercept) : NaN);
    out.push({
      model,
      contrast,
      judge,
      n: xs.length,
      wins,
      losses: decided.length - wins,
      ties: read.length - decided.length,
      unread: xs.length - read.length,
      raw: decided.length ? wins / decided.length : null,
      length_controlled: decided.length ? fit(decided) : null,
      ci95: decided.length >= 2 ? interval95(clusterBootstrap(decided, (x) => x.unit, fit, o)) : null,
      first_position: decided.length ? decided.filter((x) => x.first).length / decided.length : null,
    });
  }
  return out;
}

/** Section 9, attack 5: the arm-guess probe's tally; above 70% correct, the post flags it. */
export function probeTally(map: PacketMap, records: readonly ProbeRecord[]): { n: number; correct: number; unread: number; rate: number | null; flag: boolean } {
  let correct = 0, unread = 0;
  for (const r of records) {
    if (r.guess === null) unread++;
    else if (map.packets[r.packet]?.lists.L?.arm === r.guess) correct++;
  }
  const n = records.length - unread;
  const rate = n ? correct / n : null;
  return { n, correct, unread, rate, flag: rate !== null && r4(rate) > 0.7 };
}

export type SplitName = "type" | "source" | "inspiration" | "source_kind" | "real_plan";
export const splitOf = (u: LoadedUnit, s: SplitName): string => {
  const m = u.meta;
  if (s === "type") return m.type;
  if (s === "source") return m.source;
  if (s === "inspiration") return m.source === "transposed" && m.inspiration === "capy" ? "capy" : "public";
  if (s === "source_kind") return m.source_kind;
  return m.source_kind === "plan" || m.source_kind === "accepted-outside" ? "real-plan" : "other";
};

export interface CellSummary {
  family: Family;
  model: ModelId;
  arm: ArmId;
  planned: number;
  scored: number;
  no_block: number;
  missing: number;
  unscored: number;
  A: number | null;
  units: number;
  secondaries: Record<string, number | null>;
  mean_words: number | null;
  mean_items: number | null;
  cut_share: number | null;
  exposure: number | null;
  modes: Record<string, number>;
}

const SECONDARY_FIELDS = ["shuffled", "specificity", "A_R", "A_generic", "A_mentioned", "A_U", "A_E", "A_plan", "A_foreseeable", "precision", "multi"] as const;

export function cellSummaries(reviews: readonly Review[]): CellSummary[] {
  const keys = [...new Set(reviews.map((r) => r.family + "|" + r.model + "|" + r.arm))].sort();
  return keys.map((k) => {
    const [family, model, arm] = k.split("|") as [Family, ModelId, ArmId];
    const rs = reviews.filter((r) => r.family === family && r.model === model && r.arm === arm);
    const done = rs.filter((r) => r.status === "scored" || r.status === "no-block");
    const blocks = rs.filter((r) => r.status === "scored");
    const items = blocks.reduce((s, r) => s + r.items, 0);
    const exp = rs.filter((r) => r.exposed !== null);
    const modes: Record<string, number> = {};
    for (const r of rs) if (r.mode) modes[r.mode] = (modes[r.mode] ?? 0) + 1;
    const m = unitMean(rs, (r) => r.A);
    return {
      family,
      model,
      arm,
      planned: rs.length,
      scored: done.length,
      no_block: rs.filter((r) => r.status === "no-block").length,
      missing: rs.filter((r) => r.status === "missing").length,
      unscored: rs.filter((r) => r.status === "unscored").length,
      A: m.mean,
      units: m.units,
      secondaries: Object.fromEntries(SECONDARY_FIELDS.map((f) => [f, unitMean(rs, (r) => r[f]).mean])),
      mean_words: blocks.length ? mean(blocks.map((r) => r.words)) : null,
      mean_items: blocks.length ? items / blocks.length : null,
      cut_share: items ? blocks.reduce((s, r) => s + r.cut, 0) / items : null,
      exposure: exp.length ? exp.filter((r) => r.exposed).length / exp.length : null,
      modes,
    };
  });
}

/** Per-split cell means (type, source, inspiration, source kind, real plans), descriptive only. */
export function splitSummaries(reviews: readonly Review[], units: Map<string, LoadedUnit>): Array<{ split: SplitName; value: string; family: Family; model: ModelId; arm: ArmId; A: number | null; units: number }> {
  const out = [];
  for (const split of ["type", "source", "inspiration", "source_kind", "real_plan"] as SplitName[]) {
    const vals = [...new Set(reviews.map((r) => splitOf(units.get(r.unit)!, split)))].sort();
    for (const value of vals)
      for (const c of [...new Set(reviews.map((r) => r.family + "|" + r.model + "|" + r.arm))].sort()) {
        const [family, model, arm] = c.split("|") as [Family, ModelId, ArmId];
        const m = unitMean(reviews.filter((r) => r.family === family && r.model === model && r.arm === arm && splitOf(units.get(r.unit)!, split) === value), (r) => r.A);
        out.push({ split, value, family, model, arm, A: m.mean, units: m.units });
      }
  }
  return out;
}

const USAGE = "gstack-evals pv score --units <dir> --rows <rows> [--rows <rows>] --map <label map.json> --labels <labels.ndjson> [--labels <labels.ndjson>] --out <scores.json> [--pairwise-map <map.json> --pairwise <pairwise.ndjson>] [--probe-map <map.json> --probe <probe.ndjson>]";

export function run(argv: string[], io: Io): number {
  const a = parseArgs(argv, { units: "one", rows: "many", map: "one", labels: "many", out: "one", "pairwise-map": "one", pairwise: "one", "probe-map": "one", probe: "one" }, USAGE);
  need(a, ["units", "rows", "map", "labels", "out"], USAGE);
  const paths: Array<[string, string]> = [["--units", a.one.units!], ["--map", a.one.map!], ["--out", a.one.out!], ...a.many.rows!.map((p) => ["--rows", p] as [string, string]), ...a.many.labels!.map((p) => ["--labels", p] as [string, string])];
  for (const f of ["pairwise-map", "pairwise", "probe-map", "probe"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  refuseInRepo("--out", a.one.out!);
  if (!!a.one["pairwise-map"] !== !!a.one.pairwise || !!a.one["probe-map"] !== !!a.one.probe) throw new PvError("E_USAGE", "--pairwise and --probe each come with their map; usage: " + USAGE);
  const map = readJson<PacketMap>(a.one.map!, "label map");
  if (map.kind !== "label") throw new PvError("E_USAGE", "--map is a " + map.kind + " map; score reads the label map");
  const units = loadUnits(a.one.units!, { keys: true });
  const inp: ScoreInput = { units, rows: a.many.rows!.flatMap(readRows), map, labels: a.many.labels!.flatMap((p) => readRecords<LabelRecord>(p, "labels file")) };
  const reviews = scoreReviews(inp);
  const lengths = [];
  for (const model of ["opus", "sol", "particle"] as ModelId[])
    for (const [b, x] of [["skill", "none"], ["skill", "lens"], ["lens", "none"]] as Array<[ArmId, ArmId]>) {
      const { pairs } = pairArms(reviews, model, map.family, b, x);
      if (pairs.length) lengths.push({ model, contrast: b + "-" + x, ...lengthAdjusted(pairs) });
    }
  const out = {
    version: 1,
    family: map.family,
    stage: map.stage,
    reviews,
    stock: stockCredits(inp),
    cells: cellSummaries(reviews),
    splits: splitSummaries(reviews, units),
    length_adjusted: lengths,
    pairwise: a.one.pairwise ? pairwiseSummary(readJson<PacketMap>(a.one["pairwise-map"]!, "pairwise map"), readRecords<PairRecord>(a.one.pairwise, "pairwise file")) : null,
    probe: a.one.probe ? probeTally(readJson<PacketMap>(a.one["probe-map"]!, "probe map"), readRecords<ProbeRecord>(a.one.probe, "probe file")) : null,
  };
  writeJson(a.one.out!, out);
  const count = (s: Status) => reviews.filter((r) => r.status === s).length;
  io.out("pv score: " + reviews.length + " reviews (scored " + count("scored") + ", no-block " + count("no-block") + ", missing " + count("missing") + ", unscored " + count("unscored") + ") written to " + a.one.out);
  if (count("unscored")) io.err("E_PV_LABEL_MISSING " + count("unscored") + " reviews have an unlabelled primary cell; they are unscored and count as missing");
  return 0;
}
