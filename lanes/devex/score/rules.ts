// Copyright (c) 2026 Garry Tan. MIT License.
// dx readings (prereg 2026-11-09-geva-417, sections 7, 8, 10, 11 and 13): the frozen readings, each a pure function so the
// dry run can drive it on both sides of its edge. Stage 1 admission (HEADROOM, FLOOR with its two checks, CEILING, STOCK
// FAIL, NO READ and the 95% parse rate); the stock checks; the judge check with its gold minimum, oracle caps and both
// kappas, and stage 2's blind re-check; the smoke rules 1 to 6 as decisions; the interim exposure check; the paired
// contrasts (clustered on the unit, 10,000 bootstrap draws and sign flips at seed 20261109, Holm over the two primaries,
// the worse count, the specificity contrast, the length-adjusted line and the repository-clustered sensitivity); coverage,
// contamination and the intention-to-treat switch; the five-step verdict precedence; every R48 reading; the framing
// readings; leak exposure with the recognition probe; and the projection's MDD against the 0.13 bound. Every band edge and
// gate compares values rounded to four decimal places. run(argv, io) is dx readings: the smoke rules and decision from a
// rows file, the parse rate and admission, and coverage and contamination per cell.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clusteredPairedDelta, holmAdjusted, type PairedItem } from "../../../src/runner/stats/paired.ts";
import { cutoffEnd, designMdd, parsePower, scoreGold, type GoldRead, type PowerRow } from "../../aftermath/readings.ts";
import { clusterBootstrap, DRAWS, mean, ols, percentileInterval, r4, seededRandom, shuffle } from "../../aftermath/stats.ts";
import { MODEL_IDS, SEED, type ArmId, type Key, type ModelId, type Row, type UnitMeta } from "../types.ts";
import { listKey, READER, type LabelRecord, type ListKind, type PacketMap, type PacketMeta, type Reader } from "./packets.ts";
import { credit, indexLabels, isMissing, unitMean, type Review, type StockCredit } from "./score.ts";
import { smokeSession, type DxRow } from "../run/rows.ts";
import { dxLimits } from "../../../src/trial/review/devex.ts";

export const BAND = { lo: 0.1, hi: 0.65 } as const;
export const MARGIN = 0.05;
export const KAPPA_BAR = 0.6;
export const GOLD_MIN = 40;
export const EXPOSURE_BAR = 0.8;
export const COVERAGE_BAR = 0.9;
export const CONTAMINATION_BAR = 0.05;
export const ITT_GAP = 0.05;
export const PARSE_BAR = 0.95;
export const FLOOR_ORACLE = 0.9;
export const LEAK_SHARE = 0.25;
export const MDD_BOUND = 0.13;
/** Section 11: the interim check reads an arm after its first 24 Opus sessions, or 16 on Sol and on particle-1. */
export const INTERIM: Readonly<Record<ModelId, number>> = { opus: 24, sol: 16, particle: 16 };
export const STAT = { seed: SEED, draws: DRAWS };
/** power.txt's item mixes by mean items a unit (section 13). */
export const MIX_MEAN: Readonly<Record<string, number>> = { "1-2": 1.5, "1-3": 2, "2-4": 3 };
export type R48Word = "KEEP" | "CUT-CANDIDATE" | "FIX-METHOD";

// ---- Section 8: the stock checks ----

export interface StockReading {
  model: ModelId;
  stage: 1 | 2;
  units: number;
  rows: Array<{ row: number; credited: number; unlabelled: number; fail: boolean }>;
  fail: boolean;
  /** Stage 1 on Opus lists ends the eval; anywhere else the model's contrasts read untested (stock). */
  consequence: "none" | "ends the eval" | "untested (stock)";
}

/** Row 1 or 2 credited with a primary item on more than one unit in eight (2 of 16 in stage 1) is STOCK FAIL; row 3 never fails. */
export function stockReading(credits: readonly StockCredit[], model: ModelId, stage: 1 | 2, units: number): StockReading {
  const rows = [1, 2, 3].map((row) => {
    const mine = credits.filter((c) => c.model === model && c.row === row);
    const credited = new Set(mine.filter((c) => c.credited === true).map((c) => c.unit)).size;
    return { row, credited, unlabelled: mine.filter((c) => c.credited === null).length, fail: row !== 3 && credited * 8 > units };
  });
  const fail = rows.some((r) => r.fail);
  return { model, stage, units, rows, fail, consequence: !fail ? "none" : stage === 1 && model === "opus" ? "ends the eval" : "untested (stock)" };
}

// ---- Section 7: the judge check ----

export interface CheckCell extends GoldRead {
  kind: ListKind;
}

/** The oracle caps: verbatim cells at most a quarter, verbatim and paraphrased together at most three quarters, of anticipated gold. */
export function oracleAllowance(other: number, verbatim: number, paraphrased: number): { verbatim: number; paraphrased: number } {
  const p = Math.min(paraphrased, 3 * other);
  const v = Math.max(0, Math.min(verbatim, Math.floor((other + p) / 3), 3 * other - p));
  return { verbatim: v, paraphrased: p };
}

const isOracle = (k: ListKind) => k === "verbatim" || k === "paraphrased";

/** Counted gold under the caps: every not-anticipated cell, and the anticipated cells the oracle caps admit. */
export function countedGold(cells: ReadonlyArray<{ gold: boolean; kind: ListKind }>): number {
  const ant = cells.filter((c) => c.gold);
  const a = oracleAllowance(ant.filter((c) => !isOracle(c.kind)).length, ant.filter((c) => c.kind === "verbatim").length, ant.filter((c) => c.kind === "paraphrased").length);
  return ant.filter((c) => !isOracle(c.kind)).length + a.verbatim + a.paraphrased + cells.filter((c) => !c.gold).length;
}

export interface JudgeReading {
  model: ModelId;
  reader: Reader;
  anticipated: number;
  not: number;
  lists: number;
  real_anticipated: number;
  verbatim: { available: number; used: number };
  paraphrased: { available: number; used: number };
  unlabelled: number;
  shortfall: boolean;
  catch_rate: number | null;
  false_fail: number | null;
  kappa: number | null;
  kappa_real: number | null;
  pass: boolean;
  reading: "pass" | "short of gold cells" | "kappa under 0.6";
  /** Gold cells by list kind and class (anticipated or not), as printed. */
  by_kind: Record<string, { anticipated: number; not: number }>;
}

/** Scores one production judge on gold cells: catch rate, false-fail rate and both kappas, with the gold minimum and the caps. */
export function judgeScore(model: ModelId, cells: readonly CheckCell[], o: { seed?: number; minimum?: number; unlabelled?: number } = {}): JudgeReading {
  const rng = seededRandom(o.seed ?? SEED);
  let used = { verbatim: 0, paraphrased: 0 };
  const g = scoreGold(cells, {
    minimum: o.minimum ?? GOLD_MIN,
    bar: KAPPA_BAR,
    real: (c) => c.kind === "arm",
    capAnticipated: (ant) => {
      const other = ant.filter((c) => !isOracle(c.kind));
      const V = shuffle(ant.filter((c) => c.kind === "verbatim"), rng), P = shuffle(ant.filter((c) => c.kind === "paraphrased"), rng);
      used = oracleAllowance(other.length, V.length, P.length);
      return [...other, ...P.slice(0, used.paraphrased), ...V.slice(0, used.verbatim)];
    },
  });
  const by_kind: JudgeReading["by_kind"] = {};
  for (const c of g.used) {
    const k = (by_kind[c.kind] ??= { anticipated: 0, not: 0 });
    if (c.gold) k.anticipated++;
    else k.not++;
  }
  return {
    model,
    reader: READER[model],
    anticipated: g.anticipated,
    not: g.not,
    lists: g.lists,
    real_anticipated: g.used.filter((c) => c.gold && c.kind === "arm").length,
    verbatim: { available: cells.filter((c) => c.gold && c.kind === "verbatim").length, used: used.verbatim },
    paraphrased: { available: cells.filter((c) => c.gold && c.kind === "paraphrased").length, used: used.paraphrased },
    unlabelled: o.unlabelled ?? 0,
    shortfall: g.shortfall,
    catch_rate: g.catch_rate,
    false_fail: g.false_fail,
    kappa: g.kappa,
    kappa_real: g.kappa_real,
    pass: g.pass,
    reading: g.shortfall ? "short of gold cells" : g.kappa_ok ? "pass" : "kappa under 0.6",
    by_kind,
  };
}

const modelRank = (m: ModelId | null) => (m === null ? 9 : MODEL_IDS.indexOf(m));
/** Packets in a fixed order, a preferred model's first, then by pass, main passes before smoke passes. */
const ordered = (map: PacketMap, prefer: ModelId | null): PacketMeta[] =>
  Object.values(map.packets).sort((a, b) => (a.model === prefer ? 0 : 1) - (b.model === prefer ? 0 : 1) || modelRank(a.model) - modelRank(b.model) || (a.pass ?? 0) - (b.pass ?? 0) || Number(a.smoke) - Number(b.smoke) || (a.id < b.id ? -1 : 1));

export interface GoldCell {
  list: string;
  item: string;
  gold: boolean;
  kind: ListKind;
}

/** Gold cells: where Astra and Opus agree on anticipated in the check pass; a list met in several packets counts once. */
export function goldCells(checkMap: PacketMap, checkLabels: readonly LabelRecord[]): GoldCell[] {
  const a = indexLabels(checkMap, checkLabels, () => "astra"), o = indexLabels(checkMap, checkLabels, () => "opus");
  const out = new Map<string, GoldCell>();
  for (const meta of ordered(checkMap, null)) {
    for (const [lid, ref] of Object.entries(meta.lists))
      for (const [pid, kid] of Object.entries(meta.items)) {
        const k = listKey(ref) + "|" + meta.unit + ":" + kid;
        if (out.has(k)) continue;
        const x = a.get(meta.id)?.get(lid + "|" + pid), y = o.get(meta.id)?.get(lid + "|" + pid);
        if (x && y && x.anticipated === y.anticipated) out.set(k, { list: listKey(ref), item: meta.unit + ":" + kid, gold: x.anticipated, kind: ref.kind });
      }
  }
  return [...out.values()];
}

/**
 * Section 7's judge check per production judge: gold cells from the separate pass scored against the judge's own stage 1
 * labels at production effort (every stage 1 list, so each judge also reads the other models' lists). The judge passes
 * with at least 40 gold cells of each class from at least 40 lists, under the oracle caps, and both kappas at 0.6.
 */
export function judgeCheck(o: { checkMap: PacketMap; checkLabels: readonly LabelRecord[]; map: PacketMap; labels: readonly LabelRecord[]; seed?: number }): JudgeReading[] {
  const gold = goldCells(o.checkMap, o.checkLabels);
  return MODEL_IDS.map((model) => {
    const idx = indexLabels(o.map, o.labels, () => READER[model]);
    const where = new Map<string, import("../types.ts").Label | null>();
    for (const meta of ordered(o.map, model)) {
      if (meta.role !== "production") continue;
      for (const [lid, ref] of Object.entries(meta.lists))
        for (const [pid, kid] of Object.entries(meta.items)) {
          const k = listKey(ref) + "|" + meta.unit + ":" + kid;
          const lab = idx.get(meta.id)?.get(lid + "|" + pid);
          if (!where.get(k) && lab !== undefined) where.set(k, lab);
        }
    }
    const cells: CheckCell[] = [];
    let unlabelled = 0;
    for (const g of gold) {
      const lab = where.get(g.list + "|" + g.item);
      if (!lab) unlabelled++;
      else cells.push({ gold: g.gold, judged: lab.anticipated, kind: g.kind, list: g.list });
    }
    return judgeScore(model, cells, { seed: o.seed, unlabelled });
  });
}

/** Stage 2's blind re-check: the production judge's labels of the calibration packets' carried gold; 40 counted cells and kappa 0.6. */
export function recheck(map: PacketMap, labels: readonly LabelRecord[], model: ModelId): JudgeReading & { recheck_pass: boolean } {
  const idx = indexLabels(map, labels, () => READER[model]);
  const cells: CheckCell[] = [];
  let unlabelled = 0;
  for (const meta of Object.values(map.packets)) {
    if (meta.role !== "calibration" || meta.model !== model) continue;
    for (const g of meta.gold ?? []) {
      const lab = idx.get(meta.id)?.get(g.list + "|" + g.item);
      if (!lab) unlabelled++;
      else cells.push({ gold: g.gold, judged: lab.anticipated, kind: g.kind, list: meta.id + ":" + g.list });
    }
  }
  const j = judgeScore(model, cells, { minimum: 0, unlabelled });
  return { ...j, recheck_pass: j.anticipated + j.not >= GOLD_MIN && j.kappa !== null && r4(j.kappa) >= KAPPA_BAR };
}

// ---- Section 10: stage 1 admission ----

export type Admission = "HEADROOM" | "FLOOR" | "CEILING" | "STOCK FAIL" | "NO READ";

/** A on a set of lists from one reader's labels: credited primary items over primary items, unit-weighted. */
export function readerA(map: PacketMap, labels: readonly LabelRecord[], keys: ReadonlyMap<string, Key>, reader: Reader, pick: (meta: PacketMeta, list: import("./packets.ts").ListRef) => boolean): number | null {
  const idx = indexLabels(map, labels, () => reader);
  const byUnit = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const meta of ordered(map, null))
    for (const [lid, ref] of Object.entries(meta.lists)) {
      if (!pick(meta, ref) || seen.has(listKey(ref))) continue;
      const key = keys.get(meta.unit);
      const c = key ? credit(meta, idx.get(meta.id), lid, key.primary) : null;
      if (c && c.total) {
        seen.add(listKey(ref));
        byUnit.set(meta.unit, [...(byUnit.get(meta.unit) ?? []), c.credited / c.total]);
      }
    }
  return byUnit.size ? mean([...byUnit.values()].map(mean)) : null;
}

/** FLOOR's first check: the check pass's Opus labels on the same Opus none lists give an A under 0.10. */
export const floorCheckA = (checkMap: PacketMap, checkLabels: readonly LabelRecord[], keys: ReadonlyMap<string, Key>): number | null =>
  readerA(checkMap, checkLabels, keys, "opus", (m, l) => l.kind === "arm" && l.model === "opus" && l.arm === "none" && !l.smoke);

/** FLOOR's second check: the share of the verbatim oracle anchors' items Astra credits (a list met several times counts once). */
export function oracleCredit(map: PacketMap, labels: readonly LabelRecord[], keys: ReadonlyMap<string, Key>): number | null {
  const idx = indexLabels(map, labels, () => "astra");
  let credited = 0, total = 0;
  const seen = new Set<string>();
  for (const meta of ordered(map, "opus"))
    for (const [lid, ref] of Object.entries(meta.lists)) {
      if (ref.kind !== "verbatim" || seen.has(ref.unit)) continue;
      const c = credit(meta, idx.get(meta.id), lid, keys.get(meta.unit)?.primary ?? []);
      if (!c) continue;
      seen.add(ref.unit);
      credited += c.credited;
      total += c.total;
    }
  return total ? credited / total : null;
}

export interface AdmissionInput {
  /** Opus none's A on the calibration units, from Astra's production labels. */
  noneA: number | null;
  parsed: number;
  replies: number;
  /** STOCK FAIL on Opus lists in stage 1. */
  stockFail: boolean;
  /** The Opus lists' judge (Astra) in the judge check. */
  judge: { pass: boolean; shortfall: boolean };
  floor: { checkA: number | null; oracleCredit: number | null };
}

/** Section 10's admission: the parse rate, then the instrument (judge at 0.10 or more, FLOOR's two checks under it), stock, then the band. */
export function admission(i: AdmissionInput): { reading: Admission; reasons: string[]; r48: string | null; ends: boolean } {
  const end = (reading: Admission, reasons: string[], r48: string) => ({ reading, reasons, r48, ends: true });
  const parse = i.replies ? i.parsed / i.replies : 0;
  if (r4(parse) < PARSE_BAR) return end("NO READ", ["Opus none replies parsed " + i.parsed + " of " + i.replies + ", under 95%"], "FIX-METHOD on the instrument");
  if (i.noneA === null) return end("NO READ", ["no scored Opus none review on the calibration units"], "FIX-METHOD on the instrument");
  const a = r4(i.noneA);
  if (a >= BAND.lo && !i.judge.pass) return end("NO READ", ["the Opus lists' judge " + (i.judge.shortfall ? "is short of gold cells" : "failed its check")], "FIX-METHOD on the instrument");
  if (a < BAND.lo) {
    const why: string[] = [];
    if (i.floor.checkA === null || r4(i.floor.checkA) >= BAND.lo) why.push("the check pass's Opus labels give A " + (i.floor.checkA === null ? "n/a" : r4(i.floor.checkA)) + ", not under 0.10");
    if (i.floor.oracleCredit === null || r4(i.floor.oracleCredit) < FLOOR_ORACLE) why.push("Astra credits " + (i.floor.oracleCredit === null ? "n/a" : r4(i.floor.oracleCredit)) + " of the verbatim oracle items, under 0.90");
    if (why.length) return end("NO READ", ["Opus none A " + a + " under 0.10, but " + why.join("; ")], "FIX-METHOD on the instrument");
  }
  if (i.stockFail) return end("STOCK FAIL", ["stock row 1 or 2 credited on more than 2 of the calibration units on Opus lists"], "FIX-METHOD on the instrument");
  if (a < BAND.lo) return end("FLOOR", ["Opus none A " + a + " under 0.10, and both FLOOR checks hold"], "FIX-METHOD on task fit");
  if (a > BAND.hi) return end("CEILING", ["Opus none A " + a + " above 0.65"], "FIX-METHOD (saturation)");
  return { reading: "HEADROOM", reasons: ["Opus none A " + a + " inside 0.10 to 0.65"], r48: null, ends: false };
}

/** The anticipated gold a set of lists can give: real anticipated cells plus what the oracle caps admit of 24 of each oracle kind. */
export function anticipatedGoldReach(realAnticipated: number, verbatim = 24, paraphrased = 24): number {
  const a = oracleAllowance(realAnticipated, verbatim, paraphrased);
  return realAnticipated + a.verbatim + a.paraphrased;
}

// ---- Section 10: the smoke rules ----

export type GstackArm = "plan-devex-review" | "autoplan";
export interface SmokeSession {
  model: ModelId;
  parsed: boolean;
  exposed: boolean | null;
  limit_stops: number;
  spend_micros: number | null;
  /** autoplan only: the lean run reached its gate with its reviewer on the cell's model. */
  gate: boolean | null;
}
export interface SmokeFailure {
  rule: 1 | 2 | 4;
  model: ModelId;
  kind: "parse" | "exposure" | "cost-median" | "cost-stops" | "cost-projection";
  why: string;
}
export interface SmokeReading {
  arm: GstackArm;
  failures: SmokeFailure[];
  /** Rule 3: models where autoplan's lean run can't reach its gate on the cell's model; its cells there don't run. */
  autoplan_out: ModelId[];
  pass: boolean;
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

/** Rules 1 to 4 on one arm's smoke: 6 Opus sessions and 2 each on Sol and particle-1. */
export function smokeRules(arm: GstackArm, sessions: readonly SmokeSession[], o: { sessionLimitMicros: number; projectionFits: boolean }): SmokeReading {
  const failures: SmokeFailure[] = [];
  const on = (m: ModelId) => sessions.filter((s) => s.model === m);
  const opus = on("opus");
  const parsed = opus.filter((s) => s.parsed).length;
  if (parsed < 5) failures.push({ rule: 1, model: "opus", kind: "parse", why: "parsed " + parsed + " of " + opus.length + " Opus smoke sessions, under 5" });
  for (const m of MODEL_IDS) {
    const need = m === "opus" ? 5 : 1;
    const exposed = on(m).filter((s) => s.exposed === true).length;
    if (exposed < need) failures.push({ rule: 2, model: m, kind: "exposure", why: "exposed in " + exposed + " of " + on(m).length + " " + m + " smoke sessions, under " + need });
  }
  const autoplan_out = arm === "autoplan" ? MODEL_IDS.filter((m) => on(m).filter((s) => s.gate === true).length < (m === "opus" ? 5 : 1)) : [];
  const med = median(opus.map((s) => s.spend_micros ?? 0));
  if (med > o.sessionLimitMicros / 2) failures.push({ rule: 4, model: "opus", kind: "cost-median", why: "Opus smoke median " + med + " micros exceeds half the session limit" });
  const stops = opus.filter((s) => s.limit_stops > 0).length;
  if (stops >= 2) failures.push({ rule: 4, model: "opus", kind: "cost-stops", why: stops + " of " + opus.length + " Opus sessions stopped by a limit" });
  if (!o.projectionFits) failures.push({ rule: 4, model: "opus", kind: "cost-projection", why: "the measured medians put the stage 2 projection past its cap after the cut list" });
  return { arm, failures, autoplan_out, pass: !failures.length };
}

export interface SmokeDecision {
  outcome: "pass" | "repair" | "dropped";
  /** The one repair, and the name the arm then carries in every headline. */
  repair: { kind: "stop hook" | "gstack stop gate" | "double limits"; name: string | null } | null;
  dropped_on: ModelId[];
  /** Section 11: a dropped arm enters Holm with p = 1 and its cells on those models don't run. */
  holm_p1: boolean;
  code: "E_DX_ARM_DROPPED" | "E_DX_EXPOSURE_REPAIR" | null;
  r48: string | null;
}

/**
 * Rules 5 and 6: a parse or exposure failure gets the arm's one repair (the Stop hook for plan-devex-review, gstack's stop
 * gate for autoplan); a cost failure from limit stops gets doubled session limits for every arm when the re-projection at
 * those limits fits the cap. A failure no single repair covers (a cost median or projection failure, or two kinds) drops
 * the arm. The repaired arm reruns its smoke and must pass every rule, else it drops on the models where the rerun failed.
 */
export function smokeDecision(first: SmokeReading, o: { doubledFits: boolean; rerun?: SmokeReading }): SmokeDecision {
  const drop = (models: ModelId[]): SmokeDecision => ({ outcome: "dropped", repair: null, dropped_on: [...new Set(models)].sort((a, b) => modelRank(a) - modelRank(b)), holm_p1: true, code: "E_DX_ARM_DROPPED", r48: "FIX-METHOD on the instrument" });
  if (first.pass) return { outcome: "pass", repair: null, dropped_on: [], holm_p1: false, code: null, r48: null };
  const kinds = new Set(first.failures.map((f) => (f.kind === "parse" || f.kind === "exposure" ? "procedure" : f.kind)));
  let repair: SmokeDecision["repair"] = null;
  if (kinds.size === 1 && kinds.has("procedure")) repair = first.arm === "plan-devex-review" ? { kind: "stop hook", name: "with an enforced procedure" } : { kind: "gstack stop gate", name: "with gstack's stop gate" };
  else if (kinds.size === 1 && kinds.has("cost-stops") && o.doubledFits) repair = { kind: "double limits", name: null };
  if (!repair) return drop(first.failures.map((f) => f.model));
  if (!o.rerun) return { outcome: "repair", repair, dropped_on: [], holm_p1: false, code: repair.kind === "double limits" ? null : "E_DX_EXPOSURE_REPAIR", r48: null };
  if (o.rerun.pass) return { outcome: "pass", repair, dropped_on: [], holm_p1: false, code: null, r48: null };
  return { ...drop(o.rerun.failures.map((f) => f.model)), repair };
}

// ---- Section 11: the interim exposure check ----

/** After an arm's first 24 Opus (16 Sol or particle-1) stage 2 sessions, exposure under 0.80 pauses the arm on that model. */
export function interimCheck(model: ModelId, sessions: ReadonlyArray<{ exposed: boolean | null }>): { ready: boolean; sessions: number; rate: number | null; pause: boolean } {
  const n = INTERIM[model];
  if (sessions.length < n) return { ready: false, sessions: sessions.length, rate: null, pause: false };
  const rate = sessions.slice(0, n).filter((s) => s.exposed === true).length / n;
  return { ready: true, sessions: n, rate, pause: r4(rate) < EXPOSURE_BAR };
}

// ---- Section 6 and 11: coverage, exposure, contamination and the intention-to-treat switch ----

export interface CellRates {
  planned: number;
  coverage: number;
  missing: number;
  exposure: number | null;
  contamination: number;
  stops: number;
}

/** One arm on one model in stage 2: coverage (scored over planned), missing rate, exposure, contamination and stop rates. */
export function cellRates(reviews: readonly Review[], rows: readonly Row[], model: ModelId, arm: ArmId, planned: number): CellRates {
  const rs = reviews.filter((r) => r.model === model && r.arm === arm && r.stage === 2 && !r.smoke);
  const ws = rows.filter((r) => r.model === model && r.arm === arm && r.stage === 2 && !r.smoke);
  const scored = rs.filter((r) => !isMissing(r)).length;
  const read = ws.filter((r) => r.exposed !== null);
  return {
    planned,
    coverage: planned ? scored / planned : 0,
    missing: planned ? (planned - scored) / planned : 1,
    exposure: read.length ? read.filter((r) => r.exposed === true).length / read.length : null,
    contamination: ws.length ? ws.filter((r) => r.code === "E_DX_ARM_CONTAMINATED" || r.gstack_read === true).length / ws.length : 0,
    stops: ws.length ? ws.filter((r) => r.end === "session-stop").length / ws.length : 0,
  };
}

/** The intention-to-treat read becomes the contrast's primary when the arm misses more than 5 points more sessions than none. */
export const ittSwitch = (armMissing: number, noneMissing: number): boolean => r4(armMissing - noneMissing) > ITT_GAP;

// ---- Section 11: the paired contrasts ----

export interface Contrast {
  model: ModelId;
  b: ArmId;
  a: ArmId;
  read: "primary" | "itt" | "stops missing";
  cluster: "unit" | "repository";
  pairs: number;
  units: number;
  clusters: number;
  dropped: number;
  delta: number;
  ci95: [number, number] | null;
  p: number;
  holm: number | null;
  worse_units: number;
  specificity: { delta: number; ci95: [number, number] | null } | null;
  length_adjusted: { intercept: number | null; ci95: [number, number] | null };
}

/**
 * One paired contrast b minus a on a model's stage 2 reviews: unit-pass pairs (a pair with either side missing drops,
 * unless itt scores missing as 0; stopsMissing is the sensitivity read that treats arm stops as missing), each unit's mean
 * over its pairs, clustered on the unit (cluster count checked against the unit count) or on the repository.
 */
export function contrast(reviews: readonly Review[], o: { model: ModelId; b: ArmId; a: ArmId; itt?: boolean; stopsMissing?: boolean; units?: ReadonlySet<string>; repoOf?: (unit: string) => string }): Contrast | null {
  const rs = reviews.filter((r) => r.model === o.model && r.stage === 2 && !r.smoke && (!o.units || o.units.has(r.unit)));
  const side = (arm: ArmId) => new Map(rs.filter((r) => r.arm === arm).map((r) => [r.unit + "#" + r.pass, r]));
  const A = side(o.a), B = side(o.b);
  const gone = (r: Review) => isMissing(r) || (o.stopsMissing === true && r.status === "stop");
  const byUnit = new Map<string, Array<{ a: number; b: number; sa: number | null; sb: number | null; w: number }>>();
  let dropped = 0;
  for (const [k, rb] of [...B.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const ra = A.get(k);
    if (!ra) continue;
    if (!o.itt && (gone(ra) || gone(rb))) {
      dropped++;
      continue;
    }
    const v = (r: Review) => (isMissing(r) ? 0 : r.A!);
    byUnit.set(rb.unit, [...(byUnit.get(rb.unit) ?? []), { a: v(ra), b: v(rb), sa: o.itt ? null : ra.specificity, sb: o.itt ? null : rb.specificity, w: rb.words - ra.words }]);
  }
  if (!byUnit.size) return null;
  const units = [...byUnit.keys()].sort();
  const cl = (u: string) => (o.repoOf ? o.repoOf(u) : u);
  const items: PairedItem[] = units.map((u) => ({ id: u, cluster: cl(u), a: mean(byUnit.get(u)!.map((x) => x.a)), b: mean(byUnit.get(u)!.map((x) => x.b)) }));
  const stats = clusteredPairedDelta(items, STAT);
  if (!o.repoOf && stats.n_clusters !== units.length) throw new Error("E_INTERNAL the contrast's cluster count " + stats.n_clusters + " differs from its unit count " + units.length);
  const specUnits = units.filter((u) => byUnit.get(u)!.some((x) => x.sa !== null && x.sb !== null));
  const spec = specUnits.length
    ? clusteredPairedDelta(
        specUnits.map((u) => {
          const xs = byUnit.get(u)!.filter((x) => x.sa !== null && x.sb !== null);
          return { id: u, cluster: cl(u), a: mean(xs.map((x) => x.sa!)), b: mean(xs.map((x) => x.sb!)) };
        }),
        STAT,
      )
    : null;
  const pts = units.map((u) => ({ unit: cl(u), x: mean(byUnit.get(u)!.map((v) => v.w)), y: mean(byUnit.get(u)!.map((v) => v.b - v.a)) }));
  const draws = pts.length >= 2 ? clusterBootstrap(pts, (p) => p.unit, (s) => ols(s.map((p) => p.x), s.map((p) => p.y)).intercept, STAT) : [];
  return {
    model: o.model,
    b: o.b,
    a: o.a,
    read: o.itt ? "itt" : o.stopsMissing ? "stops missing" : "primary",
    cluster: o.repoOf ? "repository" : "unit",
    pairs: [...byUnit.values()].reduce((s, x) => s + x.length, 0),
    units: units.length,
    clusters: stats.n_clusters,
    dropped,
    delta: stats.delta,
    ci95: stats.ci95,
    p: stats.p_two_sided,
    holm: null,
    worse_units: items.filter((i) => i.b - i.a < 0).length,
    specificity: spec ? { delta: spec.delta, ci95: spec.ci95 } : null,
    length_adjusted: { intercept: pts.length >= 2 ? ols(pts.map((p) => p.x), pts.map((p) => p.y)).intercept : null, ci95: draws.length ? percentileInterval(draws, 0.95) : null },
  };
}

/** The two primaries of a model, Holm over exactly those two; an arm that didn't run (or has no pair) enters with p = 1. */
export function primaries(reviews: readonly Review[], model: ModelId, o: { notRun: readonly GstackArm[]; itt: Readonly<Record<GstackArm, boolean>>; units?: ReadonlySet<string> }): Record<GstackArm, Contrast | null> {
  const arms: GstackArm[] = ["plan-devex-review", "autoplan"];
  const cs = arms.map((b) => (o.notRun.includes(b) ? null : contrast(reviews, { model, b, a: "none", itt: o.itt[b], units: o.units })));
  const h = holmAdjusted(cs.map((c) => (c ? c.p : 1)));
  cs.forEach((c, i) => c && (c.holm = h[i]!));
  return { "plan-devex-review": cs[0]!, autoplan: cs[1]! };
}

// ---- Section 11: verdicts and their precedence ----

export type Verdict = "helps" | "hurts" | "not shown" | "no measurable difference" | "untested";

/** Step 2's untested causes for one gstack arm's contrast on one model. */
export function untestedCauses(i: { dropped: boolean; interimStopped: boolean; exposure: number | null; coverage: readonly number[]; contamination: readonly number[]; stockFail: boolean; judgePass: boolean; recheckPass: boolean; leak: boolean }): string[] {
  const out: string[] = [];
  if (i.dropped) out.push("dropped at the smoke");
  if (i.interimStopped) out.push("stopped at the interim (E_DX_EXPOSURE_STOP)");
  if (i.exposure === null || r4(i.exposure) < EXPOSURE_BAR) out.push("exposure " + (i.exposure === null ? "n/a" : r4(i.exposure)) + " under 0.80");
  if (i.coverage.some((c) => r4(c) < COVERAGE_BAR)) out.push("coverage under 0.90");
  if (i.contamination.some((c) => r4(c) > CONTAMINATION_BAR)) out.push("contamination over 5%");
  if (i.stockFail) out.push("stock");
  if (!i.judgePass || !i.recheckPass) out.push("judge");
  if (i.leak) out.push("leak");
  return out;
}

export interface VerdictInput {
  stage1: Admission;
  untested: readonly string[];
  ci95: readonly [number, number] | null;
  holm: number | null;
  spec_ci95: readonly [number, number] | null;
}

/** The five steps in order; the first that applies decides. An interval whose ends round to zero or straddle it includes zero. */
export function verdict(v: VerdictInput): { verdict: Verdict; step: 1 | 2 | 3 | 4 | 5; why: string } {
  if (v.stage1 !== "HEADROOM") return { verdict: "untested", step: 1, why: "stage 1 read " + v.stage1 + "; no stage 2 runs" };
  if (v.untested.length) return { verdict: "untested", step: 2, why: v.untested.map((c) => "untested (" + c + ")").join("; ") };
  if (!v.ci95) return { verdict: "untested", step: 2, why: "untested (no interval: fewer than two units)" };
  const lo = r4(v.ci95[0]), hi = r4(v.ci95[1]);
  if (lo <= 0 && hi >= 0) return { verdict: "no measurable difference", step: 5, why: "the interval " + lo + " to " + hi + " includes zero" };
  const up = lo > 0;
  const fails: string[] = [];
  if (v.holm === null || r4(v.holm) > 0.05) fails.push("Holm p " + (v.holm === null ? "n/a" : r4(v.holm)) + " above 0.05");
  const s = v.spec_ci95;
  if (!s || !(up ? r4(s[0]) > 0 : r4(s[1]) < 0)) fails.push("the specificity contrast's interval does not exclude zero in the same direction");
  if (fails.length) return { verdict: "not shown", step: 4, why: fails.join("; ") };
  return { verdict: up ? "helps" : "hurts", step: 3, why: "Holm p at most 0.05, and the interval and the specificity contrast exclude zero" };
}

export interface R48Input {
  arm: GstackArm;
  verdict: Verdict;
  stage1: Admission;
  untested: readonly string[];
  /** arm minus none. */
  ci95: readonly [number, number] | null;
  ceiling: boolean;
  exposure: number | null;
  coverage: number;
  stockPass: boolean;
  judgePass: boolean;
  leak: boolean;
  /** Whether wave 2's owner-control eval has scored DX-7 in its results post. */
  dx7Scored: boolean;
  /** Stage 3 shows the arm's builds reaching first success less often than none's, with an interval that excludes zero. */
  stage3Worse: boolean;
}
export interface R48 {
  reading: R48Word;
  cause: string | null;
  flagged: boolean;
  /** autoplan's whole-run lead. */
  lead: string | null;
  lines: string[];
}

/** Section 11's R48 reading from the verdict word, with the frozen +0.05 margin. */
export function r48(i: R48Input): R48 {
  const fix = (cause: string, lines: string[] = [], lead: string | null = null): R48 => ({ reading: "FIX-METHOD", cause, flagged: false, lead, lines: ["FIX-METHOD on " + cause, ...lines] });
  if (i.stage1 !== "HEADROOM") return fix(i.stage1 === "FLOOR" ? "task fit" : i.stage1 === "CEILING" ? "saturation" : "the instrument");
  if (i.verdict === "untested") return fix(i.untested.join("; ") || "the instrument");
  if (i.verdict === "helps") {
    const words = i.arm === "plan-devex-review" ? "its plan changes anticipate more of the trouble real developers hit after release" : "autoplan's default run anticipates more of the trouble real developers hit after release";
    return { reading: "KEEP", cause: null, flagged: i.stage3Worse, lead: null, lines: ["KEEP: " + words + (i.stage3Worse ? " (flagged: stage 3's builds reach first success less often than none's)" : "")] };
  }
  if (i.ceiling) return fix("saturation", ["the none arm carries the CEILING flag, so no CUT-CANDIDATE or whole-run lead comes from this model"]);
  if (!i.ci95) return fix("the instrument");
  const upper = r4(i.ci95[1]);
  if (upper >= MARGIN) return fix("power", ["the interval rules out gains above " + upper]);
  const conditions = r4(i.exposure ?? 0) >= EXPOSURE_BAR && r4(i.coverage) >= COVERAGE_BAR && i.stockPass && i.judgePass && !i.leak;
  if (!conditions) return fix("the instrument");
  if (i.arm === "autoplan") return fix("task fit", [], "the lean run as a whole shows no DX gain: an R48 lead for gstack to test whether the DX lens earns its place, which only an autoplan-without-DX control could settle");
  if (!i.dx7Scored) return fix("task fit", ["upper bound " + upper + " is under +0.05; this would read CUT-CANDIDATE once DX-7 is scored"]);
  return { reading: "CUT-CANDIDATE", cause: null, flagged: false, lead: null, lines: ["CUT-CANDIDATE: skill minus none's 95% upper bound " + upper + " is under the frozen +0.05 margin"] };
}

/** The CEILING flag: a none arm above 0.65 on its primary units, in stage 1 or stage 2. */
export const ceilingFlag = (noneA: number | null): boolean => noneA !== null && r4(noneA) > BAND.hi;

/** The framing readings: the one-line framing carries it, or carries part of the gain (no lead to cut). */
export function framing(i: { armNone: Verdict; armLensCi: readonly [number, number] | null; lensNone: Verdict }): { carries: boolean; part: boolean; line: string | null } {
  const bound = i.armLensCi !== null && r4(i.armLensCi[1]) < MARGIN;
  const carries = i.armNone === "helps" && bound;
  const part = !carries && i.lensNone === "helps" && !bound;
  return { carries, part, line: carries ? "the one-line framing carries it: an R48 lead to cut the lines of the skill that don't help" : part ? "the framing carries part of the gain, which is no lead to cut" : null };
}

// ---- Section 11: leak exposure ----

export interface Cutoffs {
  as_of: string;
  models: Record<ModelId, { model: string; cutoff: string | null }>;
}

/** The product-value build's cutoffs.json (as of 2026-11-08), which section 11 reuses. */
export const loadCutoffs = (path = join(import.meta.dir, "..", "..", "product-value", "cutoffs.json")): Cutoffs => JSON.parse(readFileSync(path, "utf8"));

/** A unit first exposed on or before a model's stated cutoff, or recognized by its probe, is leak-exposed for that model. */
export function leakReading(metas: readonly UnitMeta[], model: ModelId, cutoffs: Cutoffs): { model: ModelId; stated: boolean; exposed: string[]; recognized: string[]; units: number; share: number; untested: boolean } {
  const c = cutoffs.models[model]?.cutoff ?? null;
  const end = c === null ? null : cutoffEnd(c);
  if (c !== null && end === null) throw new Error("E_USAGE cutoff " + JSON.stringify(c) + " is neither YYYY-MM nor YYYY-MM-DD");
  const recognized = metas.filter((m) => m.recognized?.[model] === true).map((m) => m.id);
  const exposed = metas.filter((m) => (end !== null && m.earliest_exposure.slice(0, 10) <= end) || recognized.includes(m.id)).map((m) => m.id);
  const share = metas.length ? exposed.length / metas.length : 0;
  return { model, stated: c !== null, exposed, recognized, units: metas.length, share, untested: metas.length > 0 && r4(share) > LEAK_SHARE };
}

// ---- Section 13: the projection's MDD ----

export const loadPower = (path = join(import.meta.dir, "..", "..", "..", "wiki", "plans", "2026-11-09-geva-417-devex-review-intentions-prereg", "power.txt")): PowerRow[] => parsePower(readFileSync(path, "utf8"));

/** The rerun's Opus MDD at the final count of primary-eligible units must be at most 0.13; otherwise the question goes to the Captain. */
export function projection(rows: readonly PowerRow[], o: { meanItems: number; n: number; passes: number; stage1?: number | null }): { mdd: number; within: boolean; source: "table" | "stage 1"; n: number } {
  const d = designMdd(rows, MIX_MEAN, o);
  if (!d) throw new Error("E_USAGE power.txt has no row at " + o.n + " units and " + o.passes + " passes");
  return { mdd: d.mdd, within: r4(d.mdd) <= MDD_BOUND, source: d.source, n: d.n };
}


// ---- dx readings: the CLI over the stage 1 readings ----

const READINGS_USAGE = "gstack-evals dx readings smoke --rows <rows.ndjson> --projection-fits yes|no --doubled-fits yes|no [--doubled]\n" +
  "       gstack-evals dx readings admission --rows <rows.ndjson> --input <admission.json>\n" +
  "       gstack-evals dx readings cells --rows <rows.ndjson> [--reviews <reviews.ndjson>]";

class ReadingsUsage extends Error {}
const usage = (why: string, fix: string): never => {
  throw new ReadingsUsage(why + "\n  fix: " + fix);
};

function readNdjson<T>(path: string, what: string): T[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return usage(what + " " + path + " does not read", "pass the " + what + " file the run wrote");
  }
  return text.split("\n").filter((l) => l.trim()).map((l, i) => {
    try {
      return JSON.parse(l) as T;
    } catch {
      return usage(what + " " + path + " line " + (i + 1) + " is not JSON", "pass the " + what + " file the run wrote, unedited");
    }
  });
}

/** Smoke rules 1 to 4 and the rule 5 and 6 decision per gstack arm, from the smoke rows: pass 1 is the smoke, pass 2 its rerun. */
export function smokeReadings(rows: readonly DxRow[], o: { projectionFits: boolean; doubledFits: boolean; doubled: boolean }): Array<{ arm: GstackArm; first: SmokeReading; rerun: SmokeReading | null; decision: SmokeDecision }> {
  const limit = dxLimits(o.doubled).usd * 1_000_000;
  const arms: GstackArm[] = ["plan-devex-review", "autoplan"];
  return arms.filter((arm) => rows.some((r) => r.smoke && r.arm === arm)).map((arm) => {
    const of = (pass: number) => rows.filter((r) => r.smoke && r.arm === arm && r.pass === pass).map(smokeSession);
    const first = smokeRules(arm, of(1), { sessionLimitMicros: limit, projectionFits: o.projectionFits });
    const again = of(2);
    const rerun = again.length ? smokeRules(arm, again, { sessionLimitMicros: limit, projectionFits: o.projectionFits }) : null;
    return { arm, first, rerun, decision: smokeDecision(first, { doubledFits: o.doubledFits, ...(rerun ? { rerun } : {}) }) };
  });
}

/** Per cell (arm on model, stage, smoke or not): planned, coverage, contamination and section 6's end rates. */
export function cellReadings(rows: readonly DxRow[], reviews: readonly Review[] | null): Array<{ cell: string; planned: number; coverage: number; contamination: number; rates: Record<string, number>; untested: string[] }> {
  const cells = new Map<string, DxRow[]>();
  for (const r of rows) {
    const k = r.arm + " on " + r.model + " stage " + r.stage + (r.smoke ? " smoke" : "");
    cells.set(k, [...(cells.get(k) ?? []), r]);
  }
  return [...cells].map(([cell, rs]) => {
    const planned = rs.length;
    const r0 = rs[0]!;
    const scored = reviews ? reviews.filter((v) => v.arm === r0.arm && v.model === r0.model && v.stage === r0.stage && v.smoke === r0.smoke && !isMissing(v)).length : rs.filter((r) => r.end !== "missing" && r.end !== "contaminated").length;
    const coverage = planned ? scored / planned : 0;
    const contamination = planned ? rs.filter((r) => r.code === "E_DX_ARM_CONTAMINATED" || r.gstack_read === true).length / planned : 0;
    const rates = Object.fromEntries((["block", "no-block", "session-stop", "missing", "contaminated"] as const).map((e) => [e, planned ? rs.filter((r) => r.end === e).length / planned : 0]));
    const untested = [...(r4(coverage) < COVERAGE_BAR ? ["coverage"] : []), ...(r4(contamination) > CONTAMINATION_BAR ? ["contamination"] : [])];
    return { cell, planned, coverage, contamination, rates, untested };
  });
}

export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  try {
    return readings(argv, io);
  } catch (e) {
    if (!(e instanceof ReadingsUsage)) throw e;
    io.err("E_USAGE dx readings: " + e.message);
    return 2;
  }
}

function readings(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  const [what, ...rest] = argv;
  if (what === "--help" || what === "-h") {
    io.out(READINGS_USAGE);
    return 0;
  }
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--doubled") bools.add(a);
    else if (["--rows", "--input", "--reviews", "--projection-fits", "--doubled-fits"].includes(a) && rest[i + 1] !== undefined && !rest[i + 1]!.startsWith("--")) flags.set(a, rest[++i]!);
    else usage("unknown or malformed argument " + JSON.stringify(a), "see gstack-evals dx readings --help");
  }
  const need = (f: string) => flags.get(f) ?? usage("dx readings " + (what ?? "") + " needs " + f, "pass " + f + "; see gstack-evals dx readings --help");
  const yesNo = (f: string) => {
    const v = need(f);
    if (v !== "yes" && v !== "no") usage(f + " takes yes or no, not " + JSON.stringify(v), "pass " + f + " yes or " + f + " no");
    return v === "yes";
  };
  if (what === "smoke") {
    const o = { projectionFits: yesNo("--projection-fits"), doubledFits: yesNo("--doubled-fits"), doubled: bools.has("--doubled") };
    const rows = readNdjson<DxRow>(need("--rows"), "rows");
    const read = smokeReadings(rows, o);
    if (!read.length) usage("the rows hold no gstack arm smoke session", "pass the rows of an s1-smoke run (and its s1-resmoke)");
    const fails = (s: SmokeReading) => s.failures.map((f) => "rule " + f.rule + " " + f.model + " " + f.kind + ": " + f.why).join("; ");
    for (const r of read) {
      io.out("smoke " + r.arm + ": " + (r.first.pass ? "pass" : "fail: " + fails(r.first)) + (r.first.autoplan_out.length ? "; rule 3: autoplan's cells don't run on " + r.first.autoplan_out.join(", ") : ""));
      if (r.rerun) io.out("rerun " + r.arm + ": " + (r.rerun.pass ? "pass" : "fail: " + fails(r.rerun)));
      const d = r.decision;
      io.out("decision " + r.arm + ": " + (d.outcome === "pass" ? "pass" + (d.repair ? " " + (d.repair.name ?? "with " + d.repair.kind) : "") : d.outcome === "repair" ? "repair " + (d.repair!.name ?? d.repair!.kind) + (d.code ? " (" + d.code + ")" : "") : "dropped on " + d.dropped_on.join(", ") + " (" + d.code + "); " + d.r48 + ", Holm p = 1"));
    }
    return 0;
  }
  if (what === "admission") {
    const rows = readNdjson<DxRow>(need("--rows"), "rows");
    const inputPath = need("--input");
    let input: Omit<AdmissionInput, "parsed" | "replies">;
    try {
      input = JSON.parse(readFileSync(inputPath, "utf8"));
    } catch {
      return usage("--input " + inputPath + " does not read as JSON", "pass a JSON object with noneA, stockFail, judge {pass, shortfall} and floor {checkA, oracleCredit}");
    }
    if (typeof input?.stockFail !== "boolean" || typeof input?.judge?.pass !== "boolean" || typeof input?.judge?.shortfall !== "boolean" || !input?.floor || !(input.noneA === null || typeof input.noneA === "number")) usage("--input " + inputPath + " lacks noneA, stockFail, judge {pass, shortfall} or floor {checkA, oracleCredit}", "write each field the admission reads");
    const none = rows.filter((r) => r.arm === "none" && r.model === "opus" && r.stage === 1 && !r.smoke);
    if (!none.length) usage("the rows hold no Opus none stage 1 session", "pass the rows of the s1-none run");
    const parsed = none.filter((r) => r.end === "block").length;
    io.out("parse rate " + parsed + " of " + none.length + " (" + (parsed / none.length).toFixed(4) + ") Opus none replies; the bar is " + PARSE_BAR.toFixed(2));
    const a = admission({ ...input, parsed, replies: none.length });
    io.out("admission " + a.reading + ": " + a.reasons.join("; ") + (a.r48 ? "; " + a.r48 : "") + (a.ends ? "; the eval ends here" : ""));
    return 0;
  }
  if (what === "cells") {
    const rows = readNdjson<DxRow>(need("--rows"), "rows");
    const reviews = flags.has("--reviews") ? readNdjson<Review>(flags.get("--reviews")!, "reviews") : null;
    for (const c of cellReadings(rows, reviews)) io.out(c.cell + ": " + c.planned + " planned; coverage " + c.coverage.toFixed(4) + (reviews ? "" : " (before judging: block, no-block and session-stop rows)") + "; contamination " + c.contamination.toFixed(4) + (c.untested.length ? " (untested: " + c.untested.join(", ") + ")" : "") + "; " + Object.entries(c.rates).map(([k, v]) => k + " " + v.toFixed(4)).join(", "));
    return 0;
  }
  return usage(what === undefined ? "dx readings needs a reading" : "unknown reading " + JSON.stringify(what), "run smoke, admission or cells; see gstack-evals dx readings --help");
}
