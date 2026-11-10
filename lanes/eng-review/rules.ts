// Copyright (c) 2026 Garry Tan. MIT License.
// er readings (prereg 2026-11-08-geva-405, sections 7, 8, 10, 11, 13 and 14): the frozen readings, each a pure function
// so the dry run can drive it on both sides of its edge. Every band edge and gate compares values rounded to four
// decimal places. Rules, with the build-time choices this file makes:
// - Admission: instrument failures first (NO READ: the Opus judge short of gold cells or under kappa 0.6, or under 95%
//   of completed Opus none replies parsed; then STOCK FAIL on Opus lists), then the band: FLOOR under 0.10, CEILING above
//   0.75 or a 95% lower bound above 0.65, else HEADROOM. The interval is a seeded bootstrap of the unit means.
// - STOCK FAIL: per production judge and model, any stock row credited with a primary item on more than floor(n/8) of
//   n units (2 of 16, 7 of 56); a unit counts once whatever its passes.
// - Judge check: gold cells are where Astra and Opus agree in the audit pass; each production judge is scored on the gold
//   cells of its own model's lists with its own production labels. Floors: 40 anticipated, 40 not, from 40 lists over
//   both classes, counted unweighted. Anchors (stock rows 1 and 2 and oracle lists) carry at most a quarter of the total
//   weight: when they are more, each takes weight (real / 3) / anchors. Kappa, catch rate (gold-not cells judged not) and
//   false-fail rate (gold-anticipated cells judged not) are weighted; the unweighted and real-list numbers print beside.
// - Smoke rules 1 to 3 per skill arm; the enforced re-smoke must pass both parse and exposure at 5 of 6.
// - Leak: a unit is leak-exposed for a model when its earliest exposure falls on or before the cutoff's last day.
// - Contrasts pair by unit on the unit mean over scored passes; a unit with no score on a side drops. Holm runs over the
//   three skill-minus-none contrasts; an arm that stopped or has no pair enters with p = 1. Secondary contrasts read their
//   raw p in place of Holm.
// - Verdicts: untested first, then an interval that includes zero (no measurable difference), then helps or hurts, else
//   not shown. CUT-CANDIDATE and trim-to-lens read from the upper bound whenever the contrast is not helps and no untested
//   condition holds. The framing reading: "carries it" when skill minus none helps and skill minus lens's upper bound is
//   under +0.05; "carries part" when lens minus none helps and skill minus lens's bound is not under +0.05.
// - The interim stop reads the first 24 Opus sessions of a skill arm in rows order that ended block or no-block.
// - The pairwise read is untested (stock) when the stock block wins more than 20% of its read pairs against none on Opus;
//   then it raises no KEEP flag.
// - Projection: control rate and ICC from each model's stage 1 none reviews (ICC(1) by one-way ANOVA over units with two
//   or more scored passes, clamped to 0.01 to 0.99), item mix "1-2" when the comparison keys' mean primary count is at
//   most 2.25, else "2-4"; the MDD runs power.py's own mdd() at Holm's first step (alpha 0.05/3). Costs use measured mean
//   spend per (model, arm) from stage 1 rows, else the Opus arm's measured cost times section 14's model ratio (Sol 0.9,
//   particle-1 0.1), else section 14's planning figure times the ratio.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clusteredPairedDelta, holmAdjusted } from "../../src/runner/stats/paired.ts";
import type { Io } from "./cli.ts";
import { need, parseArgs, PvError, readJson, readRecords, refuseAliases, refuseInRepo, writeJson } from "../product-value/io.ts";
import { cutoffEnd } from "../product-value/rules.ts";
import { bootstrapMeans, DRAWS, mean, percentileInterval, r4, SEED } from "../product-value/stats.ts";
import { goldCells, isAnchor, itemKey, listKey, listStratum, type LabelRecord, type PacketMap } from "./packets.ts";
import { indexLabels, isMissing, isStrict, type PairwiseSummary, type Review, type StockCredit } from "./score.ts";
import { isDrawn, MODELS_IN_ORDER, SKILL_ARMS, type ArmId, type ModelId, type Row, type Set_, type UnitMeta } from "./types.ts";
import { loadUnits, readRows, type LoadedUnit } from "./units.ts";

export const MODELS = MODELS_IN_ORDER;
export const BAND = { lo: 0.1, hi: 0.75, lower: 0.65 } as const;
export const MARGIN = 0.05;
export const KAPPA_BAR = 0.6;
export const MDD_BAR = 0.12;
export const STAT = { seed: SEED, draws: DRAWS };
const fmt = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : String(r4(x)));

// ---- Section 8: STOCK FAIL ----

export interface StockReading {
  limit: number;
  units: number;
  rows: Array<{ model: ModelId; row: number; credited: number; unlabelled: number; fail: boolean }>;
  fail: Record<ModelId, boolean>;
}

export function stockReading(credits: readonly StockCredit[], n: number): StockReading {
  const limit = Math.floor(n / 8);
  const rows: StockReading["rows"] = [];
  for (const model of MODELS)
    for (const row of [1, 2, 3]) {
      const mine = credits.filter((c) => c.model === model && c.row === row);
      if (!mine.length) continue;
      const credited = new Set(mine.filter((c) => c.credited).map((c) => c.unit)).size;
      rows.push({ model, row, credited, unlabelled: mine.filter((c) => c.credited === null).length, fail: credited > limit });
    }
  const fail = Object.fromEntries(MODELS.map((m) => [m, rows.some((r) => r.model === m && r.fail)])) as Record<ModelId, boolean>;
  return { limit, units: n, rows, fail };
}

// ---- Section 7: the judge check ----

export interface CheckCell {
  gold: boolean;
  judged: boolean;
  anchor: boolean;
  real: boolean;
  list: string;
  stratum: string;
}
export interface JudgeReading {
  model: ModelId;
  judge: string;
  anticipated: number;
  not: number;
  lists: number;
  anchors: number;
  anchor_weight: number;
  unlabelled: number;
  short_anticipated: boolean;
  shortfall: boolean;
  kappa: number | null;
  catch_rate: number | null;
  false_fail: number | null;
  unweighted: { kappa: number | null; catch_rate: number | null; false_fail: number | null };
  real_only: { kappa: number | null; catch_rate: number | null; false_fail: number | null };
  by_stratum: Record<string, { anticipated: number; not: number }>;
  pass: boolean;
  reading: "pass" | "short of gold cells" | "kappa under 0.6";
}

/** Weighted Cohen's kappa, catch rate and false-fail rate. */
export function weightedScores(cells: ReadonlyArray<{ gold: boolean; judged: boolean; w: number }>): { kappa: number | null; catch_rate: number | null; false_fail: number | null } {
  const W = cells.reduce((s, c) => s + c.w, 0);
  const sum = (f: (c: (typeof cells)[number]) => boolean) => cells.reduce((s, c) => s + (f(c) ? c.w : 0), 0);
  const not = sum((c) => !c.gold), ant = sum((c) => c.gold);
  let kappa: number | null = null;
  if (W > 0) {
    const po = sum((c) => c.gold === c.judged) / W, pa = ant / W, pb = sum((c) => c.judged) / W;
    const pe = pa * pb + (1 - pa) * (1 - pb);
    kappa = pe >= 1 ? null : (po - pe) / (1 - pe);
  }
  return { kappa, catch_rate: not > 0 ? sum((c) => !c.gold && !c.judged) / not : null, false_fail: ant > 0 ? sum((c) => c.gold && !c.judged) / ant : null };
}

/** The anchor weight that keeps anchors at most a quarter of the total weight. */
export const anchorWeight = (anchors: number, real: number): number => (anchors === 0 || anchors * 3 <= real ? 1 : real / 3 / anchors);

export function judgeScore(model: ModelId, judge: string, cells: readonly CheckCell[], o: { minimum: number; unlabelled?: number }): JudgeReading {
  const anchors = cells.filter((c) => c.anchor).length;
  const w = anchorWeight(anchors, cells.length - anchors);
  const anticipated = cells.filter((c) => c.gold).length, not = cells.length - anticipated;
  const lists = new Set(cells.map((c) => c.list)).size;
  const short_anticipated = anticipated < o.minimum;
  const shortfall = short_anticipated || not < o.minimum || lists < o.minimum;
  const weighted = weightedScores(cells.map((c) => ({ gold: c.gold, judged: c.judged, w: c.anchor ? w : 1 })));
  const by_stratum: JudgeReading["by_stratum"] = {};
  for (const c of cells) {
    const s = (by_stratum[c.stratum] ??= { anticipated: 0, not: 0 });
    if (c.gold) s.anticipated++;
    else s.not++;
  }
  const kOk = weighted.kappa !== null && r4(weighted.kappa) >= KAPPA_BAR;
  return {
    model, judge, anticipated, not, lists, anchors, anchor_weight: w, unlabelled: o.unlabelled ?? 0, short_anticipated, shortfall,
    ...weighted,
    unweighted: weightedScores(cells.map((c) => ({ ...c, w: 1 }))),
    real_only: weightedScores(cells.filter((c) => c.real).map((c) => ({ ...c, w: 1 }))),
    by_stratum,
    pass: !shortfall && kOk,
    reading: shortfall ? "short of gold cells" : kOk ? "pass" : "kappa under 0.6",
  };
}

export const JUDGE_NAME: Readonly<Record<ModelId, string>> = { opus: "astra on opus lists", sol: "opus on sol lists", particle: "panel on particle-1 lists" };

/** Section 7's judge check per production judge, plus each judge's kappa against every audit cell (Gemini settling splits). */
export function judgeCheck(o: { checkMap: PacketMap; checkLabels: readonly LabelRecord[]; map: PacketMap; labels: readonly LabelRecord[] }): { judges: JudgeReading[]; all_cells: Record<ModelId, number | null> } {
  const gold = goldCells(o.checkMap, o.checkLabels);
  const idx = indexLabels(o.map, o.labels);
  const where = new Map<string, { packet: string; list: string; item: string }>();
  for (const meta of Object.values(o.map.packets)) {
    if (meta.role !== "production") continue;
    for (const [lid, lref] of Object.entries(meta.lists)) for (const [iid, iref] of Object.entries(meta.items)) where.set(listKey(lref) + "|" + itemKey(iref), { packet: meta.id, list: lid, item: iid });
  }
  const prodLabel = (lk: string, ik: string) => {
    const w = where.get(lk + "|" + ik);
    return w ? idx.get(w.packet)?.get(w.list + "|" + w.item) ?? null : null;
  };
  const judges = MODELS.map((model) => {
    const cells: CheckCell[] = [];
    let unlabelled = 0;
    for (const g of gold.filter((x) => x.model === model)) {
      const lab = prodLabel(listKey(g.ref), itemKey(g.itemRef));
      if (!lab) unlabelled++;
      else cells.push({ gold: g.gold, judged: lab.anticipated, anchor: isAnchor(g.ref), real: g.ref.kind === "arm", list: listKey(g.ref), stratum: listStratum(g.ref) + "/" + g.itemRef.kind });
    }
    return judgeScore(model, JUDGE_NAME[model], cells, { minimum: 40, unlabelled });
  });
  const votes = new Map<string, Partial<Record<string, boolean>>>();
  for (const l of o.checkLabels) if (l.label && o.checkMap.packets[l.packet]) votes.set(l.packet + "|" + l.list + "|" + l.item, { ...(votes.get(l.packet + "|" + l.list + "|" + l.item) ?? {}), [l.judge]: l.label.anticipated });
  const all_cells = Object.fromEntries(MODELS.map((model) => {
    const pairs: Array<{ gold: boolean; judged: boolean; w: number }> = [];
    for (const meta of Object.values(o.checkMap.packets).filter((m) => m.model === model && m.role === "check"))
      for (const [lid, lref] of Object.entries(meta.lists))
        for (const [iid, iref] of Object.entries(meta.items)) {
          if (iref.kind === "own") continue;
          const v = votes.get(meta.id + "|" + lid + "|" + iid);
          const settled = v?.astra !== undefined && v.astra === v.opus ? v.astra : v?.gemini;
          const lab = prodLabel(listKey(lref), itemKey(iref));
          if (settled !== undefined && lab) pairs.push({ gold: settled, judged: lab.anticipated, w: 1 });
        }
    return [model, weightedScores(pairs).kappa];
  })) as Record<ModelId, number | null>;
  return { judges, all_cells };
}

/** Stage 2's blind re-check: the production judge's labels of its gold cells, the same three numbers and the kappa gate. */
export function goldRecheck(map: PacketMap, labels: readonly LabelRecord[]): JudgeReading[] {
  const idx = indexLabels(map, labels);
  return MODELS.flatMap((model) => {
    const cells: CheckCell[] = [];
    let unlabelled = 0;
    for (const meta of Object.values(map.packets)) {
      if (meta.role !== "gold" || meta.model !== model) continue;
      for (const g of meta.gold ?? []) {
        const lab = idx.get(meta.id)?.get(g.list + "|" + g.item);
        if (!lab) unlabelled++;
        else cells.push({ gold: g.gold, judged: lab.anticipated, anchor: g.anchor, real: g.real, list: meta.id + ":" + g.list, stratum: g.stratum });
      }
    }
    return cells.length || unlabelled ? [judgeScore(model, JUDGE_NAME[model], cells, { minimum: 0, unlabelled })] : [];
  });
}

// ---- Section 10: admission and the smoke rules ----

export type Admission = "HEADROOM" | "FLOOR" | "CEILING" | "STOCK FAIL" | "NO READ";

export function admission(i: { noneA: number | null; lower: number | null; stockFail: boolean; judge: Pick<JudgeReading, "pass" | "shortfall" | "short_anticipated" | "kappa">; parsed: number; completed: number }): { reading: Admission; reasons: string[] } {
  const reasons: string[] = [];
  if (i.judge.short_anticipated) reasons.push("the Opus judge (Astra) is short of anticipated gold cells, so A can't be read; a low A may be named as a likely floor, never claimed as FLOOR");
  else if (i.judge.shortfall) reasons.push("the Opus judge (Astra) is short of gold cells");
  else if (!i.judge.pass) reasons.push("the Opus judge (Astra) kappa " + fmt(i.judge.kappa) + " is under 0.6");
  const parse = i.completed ? i.parsed / i.completed : 0;
  if (r4(parse) < 0.95) reasons.push("Opus none replies parsed " + i.parsed + " of " + i.completed + ", under 95%");
  if (reasons.length) return { reading: "NO READ", reasons };
  if (i.stockFail) return { reading: "STOCK FAIL", reasons: ["a stock row was credited on Opus lists on more than one calibration unit in eight"] };
  if (i.noneA === null) return { reading: "NO READ", reasons: ["no scored Opus none review"] };
  const a = r4(i.noneA);
  if (a < BAND.lo) return { reading: "FLOOR", reasons: ["Opus none A " + a + " under " + BAND.lo] };
  if (a > BAND.hi || (i.lower !== null && r4(i.lower) > BAND.lower)) return { reading: "CEILING", reasons: ["Opus none A " + a + " with lower bound " + fmt(i.lower) + " (ceiling above " + BAND.hi + " or lower bound above " + BAND.lower + ")"] };
  return { reading: "HEADROOM", reasons: ["Opus none A " + a + " inside " + BAND.lo + " to " + BAND.hi + ", lower bound " + fmt(i.lower) + " at most " + BAND.lower] };
}

/** A seeded 95% interval of the mean of unit means. */
export function unitInterval(rs: readonly Review[], f: (r: Review) => number | null = (r) => r.A): { mean: number | null; ci95: [number, number] | null; units: number } {
  const byUnit = new Map<string, number[]>();
  for (const r of rs) {
    const v = f(r);
    if (v !== null) byUnit.set(r.unit, [...(byUnit.get(r.unit) ?? []), v]);
  }
  const ms = [...byUnit.values()].map(mean);
  if (!ms.length) return { mean: null, ci95: null, units: 0 };
  return { mean: mean(ms), ci95: ms.length >= 2 ? percentileInterval(bootstrapMeans(ms, STAT), 0.95) : null, units: ms.length };
}

export interface SmokeArm {
  arm: ArmId;
  rule1: { parsed: number; sessions: number; pass: boolean };
  rule2: { exposed: number; fallback: boolean; enforced: { parsed: number; exposed: number; sessions: number } | null; pass: boolean };
  rule3: Record<"sol" | "particle", { exposed: number; sessions: number; descriptive: boolean }>;
  /** FIX-METHOD on the instrument: its stage 2 cells don't run. */
  instrument_fail: boolean;
  enforced_procedure: boolean;
  codes: string[];
}

/** Smoke rules 1 to 3 (section 10) for one skill arm, from the smoke rows; enforced rows are the Stop-hook re-smoke. */
export function smokeArm(arm: ArmId, rows: readonly Row[]): SmokeArm {
  const mine = rows.filter((r) => r.arm === arm);
  const opus = mine.filter((r) => r.model === "opus" && !r.enforced);
  const enforced = mine.filter((r) => r.model === "opus" && r.enforced);
  const parsed = opus.filter((r) => r.end === "block").length;
  const exposed = opus.filter((r) => r.exposed).length;
  const codes: string[] = [];
  const rule1 = { parsed, sessions: opus.length, pass: parsed >= 5 };
  const fallback = exposed < 5;
  const e = fallback && enforced.length ? { parsed: enforced.filter((r) => r.end === "block").length, exposed: enforced.filter((r) => r.exposed).length, sessions: enforced.length } : null;
  if (fallback) codes.push("E_ER_EXPOSURE_FALLBACK");
  const rule2pass = !fallback || (e !== null && e.parsed >= 5 && e.exposed >= 5);
  const r3 = (m: ModelId) => {
    const xs = mine.filter((r) => r.model === m);
    const ex = xs.filter((r) => r.exposed).length;
    return { exposed: ex, sessions: xs.length, descriptive: xs.length > 0 && ex === 0 };
  };
  return { arm, rule1, rule2: { exposed, fallback, enforced: e, pass: rule2pass }, rule3: { sol: r3("sol"), particle: r3("particle") }, instrument_fail: !rule1.pass || !rule2pass, enforced_procedure: fallback && rule2pass, codes };
}

// ---- Section 11: leak exposure ----

export interface Cutoffs {
  as_of: string;
  models: Record<ModelId, { model: string; cutoff: string | null; kind: string; source: string; release_date?: string | null; note?: string }>;
}

export function leakReading(metas: readonly UnitMeta[], model: ModelId, cutoffs: Cutoffs): { model: ModelId; stated: boolean; exposed: string[]; units: number; untested: boolean } {
  const c = cutoffs.models[model]?.cutoff ?? null;
  const exposed = c === null ? [] : metas.filter((m) => m.exposed_at.slice(0, 10) <= cutoffEnd(c)).map((m) => m.id);
  return { model, stated: c !== null, exposed, units: metas.length, untested: metas.length > 0 && r4(exposed.length / metas.length) > 0.25 };
}

export const loadCutoffs = (path = join(import.meta.dir, "cutoffs.json")): Cutoffs => readJson<Cutoffs>(path, "cutoffs file");

// ---- Section 11: contrasts, verdicts and the reading rule ----

export type Verdict = "helps" | "hurts" | "no measurable difference" | "not shown" | "untested";

export interface Contrast {
  model: ModelId;
  contrast: string;
  field: "A" | "A_sens";
  units: number;
  dropped: number;
  delta: number | null;
  ci95: [number, number] | null;
  p: number;
  holm: number | null;
  worse_units: number;
  specificity: { delta: number; ci95: [number, number] | null } | null;
}

const unitMeans = (rs: readonly Review[], f: (r: Review) => number | null): Map<string, number> => {
  const by = new Map<string, number[]>();
  for (const r of rs) {
    const v = f(r);
    if (v !== null && !isMissing(r)) by.set(r.unit, [...(by.get(r.unit) ?? []), v]);
  }
  return new Map([...by].map(([u, xs]) => [u, mean(xs)]));
};

/** One paired contrast b minus a, by unit on the unit means, clustered on the unit. */
export function contrast(reviews: readonly Review[], o: { model: ModelId; b: ArmId; a: ArmId; units: ReadonlySet<string>; field?: "A" | "A_sens" }): Contrast {
  const field = o.field ?? "A";
  const rs = reviews.filter((r) => r.model === o.model && o.units.has(r.unit));
  const B = unitMeans(rs.filter((r) => r.arm === o.b), (r) => r[field]), A = unitMeans(rs.filter((r) => r.arm === o.a), (r) => r[field]);
  const planned = new Set(rs.filter((r) => r.arm === o.b || r.arm === o.a).map((r) => r.unit));
  const both = [...planned].filter((u) => A.has(u) && B.has(u)).sort();
  const base: Contrast = { model: o.model, contrast: o.b + "-" + o.a, field, units: both.length, dropped: planned.size - both.length, delta: null, ci95: null, p: 1, holm: null, worse_units: 0, specificity: null };
  if (!both.length) return base;
  const stats = clusteredPairedDelta(both.map((u) => ({ id: u, cluster: u, a: A.get(u)!, b: B.get(u)! })), STAT);
  if (stats.n_clusters !== both.length) throw new PvError("E_INTERNAL", "the contrast's cluster count " + stats.n_clusters + " differs from its unit count " + both.length);
  const SB = unitMeans(rs.filter((r) => r.arm === o.b), (r) => r.specificity), SA = unitMeans(rs.filter((r) => r.arm === o.a), (r) => r.specificity);
  const sp = both.filter((u) => SA.has(u) && SB.has(u));
  const spec = sp.length ? clusteredPairedDelta(sp.map((u) => ({ id: u, cluster: u, a: SA.get(u)!, b: SB.get(u)! })), STAT) : null;
  return { ...base, delta: stats.delta, ci95: stats.ci95, p: stats.p_two_sided, worse_units: both.filter((u) => B.get(u)! < A.get(u)!).length, specificity: spec ? { delta: spec.delta, ci95: spec.ci95 } : null };
}

/** Holm over the three skill-minus-none contrasts; a stopped arm, or one with no pair, enters with p = 1. */
export function holmFamily(ps: Record<string, number | null>): Record<string, number> {
  const arms = SKILL_ARMS.map(String);
  const adj = holmAdjusted(arms.map((a) => ps[a] ?? 1));
  return Object.fromEntries(arms.map((a, i) => [a, adj[i]!]));
}

export interface VerdictInput {
  ci95: readonly [number, number] | null;
  p: number | null;
  spec_ci95: readonly [number, number] | null;
  untested: readonly string[];
}

export function verdict(v: VerdictInput): { verdict: Verdict; why: string } {
  if (v.untested.length) return { verdict: "untested", why: v.untested.join("; ") };
  if (!v.ci95) return { verdict: "untested", why: "no interval (fewer than two units)" };
  const lo = r4(v.ci95[0]), hi = r4(v.ci95[1]);
  if (lo <= 0 && hi >= 0) return { verdict: "no measurable difference", why: "the interval " + lo + " to " + hi + " includes zero" };
  const up = lo > 0;
  const fails: string[] = [];
  if (v.p === null || r4(v.p) > 0.05) fails.push("Holm p " + fmt(v.p) + " above 0.05");
  const s = v.spec_ci95;
  if (!s || !(up ? r4(s[0]) > 0 : r4(s[1]) < 0)) fails.push("the specificity contrast's interval does not exclude zero in the same direction");
  if (fails.length) return { verdict: "not shown", why: fails.join("; ") };
  return { verdict: up ? "helps" : "hurts", why: "Holm p at most 0.05, the interval and the specificity contrast exclude zero" };
}

export function untestedReasons(i: { exposure: number | null; coverage: readonly number[]; stockFail: boolean; judgePass: boolean; leak: boolean; stopped?: string | null }): string[] {
  const out: string[] = [];
  if (i.stopped) out.push("untested (" + i.stopped + ")");
  if (i.exposure === null || r4(i.exposure) < 0.8) out.push("untested (exposure " + fmt(i.exposure) + " under 0.80)");
  if (i.coverage.some((c) => r4(c) < 0.9)) out.push("untested (coverage under 0.90)");
  if (i.stockFail) out.push("untested (stock)");
  if (!i.judgePass) out.push("untested (judge)");
  if (i.leak) out.push("untested (leak)");
  return out;
}

export interface ReadingInput {
  none: { verdict: Verdict; ci95: readonly [number, number] | null };
  lens: { verdict: Verdict; ci95: readonly [number, number] | null };
  lensNone: { verdict: Verdict };
  exposure: number | null;
  headroom: boolean;
  stockPass: boolean;
  judgePass: boolean;
  coverage: number;
  pairwise: { rate: number | null; ci95: readonly [number, number] | null; untested: boolean } | null;
  stage3: { ci95: readonly [number, number] | null } | null;
}
export interface Reading {
  keep: boolean;
  keep_flag: boolean;
  framing: "carries it" | "carries part" | null;
  cut: boolean;
  trim: boolean;
  fix_method_power: boolean;
  lines: string[];
}

/** Section 11's reading rule for one skill arm on one model, with the frozen +0.05 margin. */
export function readingRule(i: ReadingInput): Reading {
  const lines: string[] = [];
  const keep = i.none.verdict === "helps";
  const pwFlag = i.pairwise !== null && !i.pairwise.untested && i.pairwise.rate !== null && i.pairwise.ci95 !== null && r4(i.pairwise.rate) < 0.5 && r4(i.pairwise.ci95[1]) < 0.5;
  const s3Flag = i.stage3?.ci95 != null && r4(i.stage3.ci95[1]) < 0;
  const keep_flag = keep && (pwFlag || s3Flag);
  if (keep) lines.push("KEEP: its test plan names more of the paths where real bugs and later tests landed" + (keep_flag ? " (flagged: " + [pwFlag ? "the pairwise secondary shows the skill losing at equal length" : "", s3Flag ? "stage 3 builds from its block pass fewer aftermath tests than none's" : ""].filter(Boolean).join("; ") + ")" : ""));
  const ok = i.exposure !== null && r4(i.exposure) >= 0.8 && i.headroom && i.stockPass && i.judgePass && r4(i.coverage) >= 0.9;
  const lensUp = i.lens.ci95 ? r4(i.lens.ci95[1]) : null;
  let framing: Reading["framing"] = null;
  if (keep && lensUp !== null && lensUp < MARGIN) framing = "carries it";
  else if (i.lensNone.verdict === "helps" && !(lensUp !== null && lensUp < MARGIN)) framing = "carries part";
  if (framing === "carries it") lines.push("the one-line framing carries it: skill minus lens's upper bound " + lensUp + " is under +0.05 (an R48 lead to cut the lines that don't help)");
  if (framing === "carries part") lines.push("the framing carries part of the gain: lens minus none helps, and skill minus lens's upper bound is not under +0.05 (no lead to cut)");
  const upper = i.none.ci95 ? r4(i.none.ci95[1]) : null;
  const cut = !keep && i.none.verdict !== "untested" && upper !== null && upper < MARGIN && ok;
  if (cut) lines.push("CUT-CANDIDATE: skill minus none's 95% upper bound " + upper + " is under the frozen +0.05 margin");
  const trim = i.lens.verdict !== "helps" && i.lens.verdict !== "untested" && lensUp !== null && lensUp < MARGIN && ok;
  if (trim) lines.push("trim-to-lens: skill minus lens's 95% upper bound " + lensUp + " is under +0.05; the procedure adds nothing measurable over one line");
  const fix_method_power = i.none.verdict === "no measurable difference" && upper !== null && upper >= MARGIN;
  if (fix_method_power) lines.push("no measurable difference; it rules out gains above " + upper + "; FIX-METHOD on power, never a cut");
  return { keep, keep_flag, framing, cut, trim, fix_method_power, lines };
}

/** Section 11's interim stop on one rate: after 24 sessions, exposure under 0.70 stops the arm. */
export const interimDecide = (sessions: number, rate: number): boolean => sessions >= 24 && r4(rate) < 0.7;

export function interimStop(rows: readonly Row[], arm: ArmId): { sessions: number; exposed: number; ready: boolean; stop: boolean } {
  const first = rows.filter((r) => r.model === "opus" && r.arm === arm && (r.end === "block" || r.end === "no-block")).slice(0, 24);
  const exposed = first.filter((r) => r.exposed).length;
  return { sessions: first.length, exposed, ready: first.length === 24, stop: interimDecide(first.length, first.length ? exposed / first.length : 1) };
}

/** The pairwise read is untested (stock) when the stock block wins more than 20% of its pairs against none on Opus. */
export const pairwiseStockUntested = (pw: readonly PairwiseSummary[]): boolean => pw.some((p) => p.model === "opus" && p.contrast === "stock-none" && p.win_share !== null && r4(p.win_share) > 0.2);

// ---- The projection before stage 2 (sections 13 and 14) ----

/** ICC(1) of review A within units, by one-way ANOVA over units with two or more scored passes, clamped to 0.01 to 0.99. */
export function icc(rs: readonly Review[]): number | null {
  const by = new Map<string, number[]>();
  for (const r of rs) if (r.A !== null && !isMissing(r)) by.set(r.unit, [...(by.get(r.unit) ?? []), r.A]);
  const groups = [...by.values()].filter((g) => g.length >= 2);
  if (groups.length < 2) return null;
  const N = groups.reduce((s, g) => s + g.length, 0), k = groups.length, grand = mean(groups.flat());
  const ssb = groups.reduce((s, g) => s + g.length * (mean(g) - grand) ** 2, 0);
  const ssw = groups.reduce((s, g) => s + g.reduce((t, x) => t + (x - mean(g)) ** 2, 0), 0);
  const msb = ssb / (k - 1), msw = ssw / (N - k), n0 = (N - groups.reduce((s, g) => s + g.length ** 2, 0) / N) / (k - 1);
  const v = msb + (n0 - 1) * msw > 0 ? (msb - msw) / (msb + (n0 - 1) * msw) : 0;
  return Math.min(0.99, Math.max(0.01, v));
}

export const itemMix = (meanPrimary: number): "1-2" | "2-4" => (meanPrimary <= 2.25 ? "1-2" : "2-4");
export type MddFn = (o: { p0: number; rho: number; n: number; passes: number; mset: "1-2" | "2-4"; alpha: number }) => number | null;

/** power.py's own mdd(), run with its definitions only, through uv and numpy at power.py's pin. */
export function pythonMdd(powerPy: string): MddFn {
  if (!existsSync(powerPy)) throw new PvError("E_USAGE", "power.py " + powerPy + " does not exist; pass --power-py");
  const driver = "import sys, json\nsrc = open(sys.argv[1]).read().split('rng = np.random.default_rng(SEED)')[0]\nexec(src)\na = json.loads(sys.argv[2])\nprint(json.dumps(mdd(a['p0'], a['rho'], TAU, a['n'], a['passes'], a['mset'], a['alpha'], np.random.default_rng(SEED))))\n";
  return (o) => {
    const r = spawnSync("uv", ["run", "--with", "numpy==2.3.4", "python", "-c", driver, powerPy, JSON.stringify(o)], { encoding: "utf8", timeout: 1_800_000 });
    if (r.status !== 0) throw new PvError("E_USAGE", "power.py's mdd() failed: " + (r.stderr || r.error?.message || "").trim().split("\n").pop());
    return JSON.parse(r.stdout.trim()) as number | null;
  };
}

export const PLANNING: Readonly<Record<ArmId, number>> = { none: 0.4, lens: 0.45, precut: 2.5, engphase: 2.2, candidate: 2.0 };
export const MODEL_RATIO: Readonly<Record<ModelId, number>> = { opus: 1, sol: 0.9, particle: 0.1 };
export const CAPS = { stage2: 1500, stage3: 280, judges: 520, authoring: 800, crew: 520, all_in: 4000, stop: 5000 } as const;

export interface Actuals {
  /** Everything spent on the line so far, in dollars. */
  spent: number;
  crew: number;
  authoring: number;
  judges_spent: number;
  /** Projected remaining spend on crew, authoring and hosts. */
  remaining_other: number;
  label_packet: Record<ModelId, number>;
  pairwise_call: Record<"opus" | "sol", number>;
}

export function sessionCost(rows: readonly Row[], model: ModelId, arm: ArmId): { dollars: number; source: "measured" | "opus ratio" | "planning" } {
  const m = (md: ModelId) => rows.filter((r) => r.model === md && r.arm === arm && r.spend_micros !== null && r.end !== "missing").map((r) => r.spend_micros! / 1e6);
  if (m(model).length) return { dollars: mean(m(model)), source: "measured" };
  if (m("opus").length) return { dollars: mean(m("opus")) * MODEL_RATIO[model], source: "opus ratio" };
  return { dollars: PLANNING[arm] * MODEL_RATIO[model], source: "planning" };
}

export interface Design {
  units: number;
  stage3: number;
  sol_lens: boolean;
  opus_skill_passes: 1 | 2;
}

export function designCost(rows: readonly Row[], a: Actuals, d: Design) {
  let runs = 0;
  for (const model of MODELS)
    for (const arm of ["none", "lens", ...SKILL_ARMS] as ArmId[]) {
      if (model === "sol" && arm === "lens" && !d.sol_lens) continue;
      const passes = model === "opus" ? (SKILL_ARMS.includes(arm) ? d.opus_skill_passes : 2) : 1;
      runs += d.units * passes * sessionCost(rows, model, arm).dollars;
    }
  const packets = { opus: d.units * 2, sol: d.units, particle: d.units };
  const labels = MODELS.reduce((s, m) => s + (packets[m] * 2 + Math.ceil(packets[m] / 8)) * a.label_packet[m], 0);
  const pairwise = d.units * 7 * (a.pairwise_call.opus + a.pairwise_call.sol);
  const judges = a.judges_spent + labels + pairwise + 3;
  const stage3 = d.stage3 * 6 * 1.5;
  const stage2Budget = CAPS.stage2 - Math.max(0, a.crew - CAPS.crew) - Math.max(0, a.authoring - CAPS.authoring) - Math.max(0, judges - CAPS.judges);
  const allIn = a.spent + runs + labels + pairwise + 3 + stage3 + a.remaining_other;
  return { runs, judges, stage3, stage2_budget: stage2Budget, all_in: allIn, fits: runs <= stage2Budget && stage3 <= CAPS.stage3 };
}

export const CUTS: ReadonlyArray<{ name: string; apply: (d: Design) => Design }> = [
  { name: "stage 3 down to 16 units", apply: (d) => ({ ...d, stage3: 16 }) },
  { name: "Sol's lens cells", apply: (d) => ({ ...d, sol_lens: false }) },
  { name: "comparison units down to 48", apply: (d) => ({ ...d, units: 48 }) },
  { name: "Opus's second pass on the skill arms", apply: (d) => ({ ...d, opus_skill_passes: 1 }) },
];

export interface ProjectionInput {
  stage1: Review[];
  rows: Row[];
  meanPrimary: number;
  units: number;
  actuals: Actuals;
  mdd: MddFn;
}

export function projection(i: ProjectionInput) {
  const est = Object.fromEntries(MODELS.map((m) => {
    const none = i.stage1.filter((r) => r.model === m && r.arm === "none");
    return [m, { p0: unitInterval(none).mean, rho: icc(none) }];
  })) as Record<ModelId, { p0: number | null; rho: number | null }>;
  const mset = itemMix(i.meanPrimary);
  const mddAt = (m: ModelId, n: number, passes: number) => {
    const e = est[m];
    return e.p0 === null || e.rho === null ? null : i.mdd({ p0: e.p0, rho: e.rho, n, passes, mset, alpha: 0.05 / 3 });
  };
  let design: Design = { units: i.units, stage3: 24, sol_lens: true, opus_skill_passes: 2 };
  const steps = [{ cut: "none", design, cost: designCost(i.rows, i.actuals, design), opus_mdd: mddAt("opus", design.units, 2) }];
  for (const c of CUTS) {
    if (steps.at(-1)!.cost.fits) break;
    design = c.apply(design);
    steps.push({ cut: c.name, design, cost: designCost(i.rows, i.actuals, design), opus_mdd: mddAt("opus", design.units, design.opus_skill_passes) });
  }
  const last = steps.at(-1)!;
  const mdd = Object.fromEntries(MODELS.map((m) => [m, mddAt(m, last.design.units, m === "opus" ? last.design.opus_skill_passes : 1)])) as Record<ModelId, number | null>;
  const opusOver = mdd.opus === null || r4(mdd.opus) > MDD_BAR;
  const cutTooFar = steps.length > 1 && steps.slice(1).some((s) => s.opus_mdd === null || r4(s.opus_mdd) > MDD_BAR);
  const lines: string[] = [];
  lines.push("projection: " + (last.cost.fits ? "fits" : "does not fit") + " after cuts [" + steps.slice(1).map((s) => s.cut).join("; ") + "]; stage 2 runs $" + last.cost.runs.toFixed(2) + " of $" + last.cost.stage2_budget.toFixed(2) + ", judges $" + last.cost.judges.toFixed(2) + ", stage 3 $" + last.cost.stage3.toFixed(2) + ", all-in $" + last.cost.all_in.toFixed(2));
  lines.push("MDD at the final size (" + last.design.units + " units, item mix " + mset + "): " + MODELS.map((m) => m + " " + fmt(mdd[m])).join(", "));
  if (opusOver) lines.push("start rule 5: the Opus MDD " + fmt(mdd.opus) + " is above 0.12; grow the set within the line or take the question to the Captain");
  if (cutTooFar) lines.push("a cut takes the Opus MDD past 0.12; it goes to the Captain instead");
  if (last.cost.all_in > CAPS.stop) lines.push("the projection passes $5,000; stop for the Captain");
  return { estimates: est, mix: mset, steps, mdd, opus_over: opusOver, cut_too_far: cutTooFar, stop: last.cost.all_in > CAPS.stop, fits: last.cost.fits, lines };
}

// ---- The command ----

const USAGE = "gstack-evals er readings --stage 1|2|projection --units <dir> --scores <scores.json> --rows <rows> [--rows ...] --out <readings.json> [stage 1 and 2: --map <label map> --labels <labels.ndjson>] [stage 1: --check-map <map> --check-labels <labels.ndjson>] [stage 2: --stage1 <readings.json> [--stage3 <stage3.json>] [--projection <projection.json>]] [projection: --actuals <actuals.json> [--power-py <power.py>] [--final-units n]] [--cutoffs <cutoffs.json>]";

interface ScoresFile {
  stage: number;
  reviews: Review[];
  stock: StockCredit[];
  pairwise: PairwiseSummary[] | null;
}

export function run(argv: string[], io: Io, o: { mdd?: MddFn } = {}): number {
  const a = parseArgs(argv, { stage: "one", units: "one", scores: "one", map: "one", labels: "many", "check-map": "one", "check-labels": "many", rows: "many", out: "one", stage1: "one", stage3: "one", projection: "one", actuals: "one", "power-py": "one", "final-units": "one", cutoffs: "one" }, USAGE);
  need(a, ["stage", "units", "scores", "rows", "out"], USAGE);
  const stage = a.one.stage!;
  if (!["1", "2", "projection"].includes(stage)) throw new PvError("E_USAGE", "--stage is 1, 2 or projection; usage: " + USAGE);
  const paths: Array<[string, string]> = [["--units", a.one.units!], ["--scores", a.one.scores!], ["--out", a.one.out!]];
  for (const f of ["labels", "check-labels", "rows"]) for (const p of a.many[f] ?? []) paths.push(["--" + f, p]);
  for (const f of ["map", "check-map", "stage1", "stage3", "projection", "actuals", "power-py", "cutoffs"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  refuseInRepo("--out", a.one.out!);
  const units = loadUnits(a.one.units!, { keys: true });
  const scores = readJson<ScoresFile>(a.one.scores!, "scores file");
  const rows = a.many.rows!.flatMap(readRows);
  const reviews = scores.reviews;
  const out: Record<string, unknown> = { version: 1, stage };
  const lines: string[] = [];
  const set = (s: Set_) => [...units.values()].filter((u) => isDrawn(u.meta, s));
  if (stage === "projection") {
    need(a, ["actuals"], USAGE);
    const comparison = set("comparison");
    const n = a.one["final-units"] ? Number(a.one["final-units"]) : comparison.length || 56;
    const p = projection({ stage1: reviews, rows, meanPrimary: comparison.length ? mean(comparison.map((u) => u.key!.primary.length)) : 1.5, units: n, actuals: readJson<Actuals>(a.one.actuals!, "actuals"), mdd: o.mdd ?? pythonMdd(a.one["power-py"] ?? join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/power.py")) });
    Object.assign(out, p);
    lines.push(...p.lines);
  } else {
    need(a, ["map", "labels"], USAGE);
    const map = readJson<PacketMap>(a.one.map!, "label map");
    const labels = a.many.labels!.flatMap((p) => readRecords<LabelRecord>(p, "labels file"));
    const cutoffs = loadCutoffs(a.one.cutoffs);
    const keyed = set(stage === "1" ? "calibration" : "comparison");
    const ids = new Set(keyed.map((u) => u.meta.id));
    const leak = Object.fromEntries(MODELS.map((m) => [m, leakReading(keyed.map((u) => u.meta), m, cutoffs)]));
    out.leak = leak;
    for (const m of MODELS) if (!leak[m]!.stated) lines.push(m + ": no published training cutoff; it runs with that limit stated beside its results");
    const stock = stockReading(scores.stock.filter((c) => ids.has(c.unit)), keyed.length);
    out.stock = stock;
    for (const r of stock.rows.filter((x) => x.fail)) lines.push("E_ER_STOCK_FAIL " + JUDGE_NAME[r.model] + ": stock row " + r.row + " credited on " + r.credited + " of " + stock.units + " units, limit " + stock.limit + (stage === "1" && r.model === "opus" ? "; on Opus lists in stage 1 this ends the eval" : "; that model's contrasts read untested (stock)"));
    if (stage === "1") {
      need(a, ["check-map", "check-labels"], USAGE);
      const jc = judgeCheck({ checkMap: readJson<PacketMap>(a.one["check-map"]!, "check map"), checkLabels: a.many["check-labels"]!.flatMap((p) => readRecords<LabelRecord>(p, "check labels file")), map, labels });
      const none = reviews.filter((r) => r.model === "opus" && r.arm === "none" && ids.has(r.unit));
      const iv = unitInterval(none);
      const done = none.filter((r) => r.status === "scored" || r.status === "no-block");
      const opusJudge = jc.judges.find((j) => j.model === "opus")!;
      const adm = admission({ noneA: iv.mean, lower: iv.ci95?.[0] ?? null, stockFail: stock.fail.opus, judge: opusJudge, parsed: done.filter((r) => r.status === "scored").length, completed: done.length });
      const smoke = SKILL_ARMS.map((arm) => smokeArm(arm, rows));
      Object.assign(out, { judges: jc.judges, judge_all_cells: jc.all_cells, admission: adm, opus_none: iv, smoke });
      lines.push("admission: " + adm.reading + " (" + adm.reasons.join("; ") + ")" + (adm.reading === "NO READ" ? "; E_ER_NO_READ ends the eval as FIX-METHOD on the instrument" : ""));
      for (const j of jc.judges) lines.push((j.pass ? "" : j.model === "opus" ? "E_ER_NO_READ " : "E_ER_JUDGE_KAPPA ") + "judge check, " + j.judge + ": " + j.reading + "; gold " + j.anticipated + " anticipated and " + j.not + " not, from " + j.lists + " lists (" + j.anchors + " anchor cells at weight " + fmt(j.anchor_weight) + "); kappa " + fmt(j.kappa) + ", catch " + fmt(j.catch_rate) + ", false-fail " + fmt(j.false_fail) + "; unweighted kappa " + fmt(j.unweighted.kappa) + ", real-list kappa " + fmt(j.real_only.kappa) + "; against every audit cell " + fmt(jc.all_cells[j.model]));
      for (const s of smoke) {
        for (const c of s.codes) lines.push(c + " " + s.arm + ": exposed in " + s.rule2.exposed + " of " + s.rule1.sessions + " Opus smoke sessions; it reruns with the Stop hook" + (s.rule2.enforced ? " (enforced re-smoke: parsed " + s.rule2.enforced.parsed + ", exposed " + s.rule2.enforced.exposed + ")" : ""));
        if (s.instrument_fail) lines.push(s.arm + ": smoke FIX-METHOD on the instrument; its stage 2 cells don't run");
        for (const m of ["sol", "particle"] as const) if (s.rule3[m].descriptive) lines.push(s.arm + " on " + m + ": exposed in 0 of " + s.rule3[m].sessions + " smoke sessions; that contrast is descriptive");
      }
    } else {
      if (!a.one.stage1) throw new PvError("E_USAGE", "stage 2 readings need --stage1 <stage 1 readings.json>");
      const s1 = readJson<{ admission: { reading: Admission }; judges: JudgeReading[]; smoke: SmokeArm[] }>(a.one.stage1, "stage 1 readings");
      const proj = a.one.projection ? readJson<{ mdd: Record<ModelId, number | null> }>(a.one.projection, "projection") : null;
      const s3 = a.one.stage3 ? readJson<Array<{ model: ModelId; arm: ArmId; ci95: [number, number] | null }>>(a.one.stage3, "stage 3 readout") : [];
      const recheck = goldRecheck(map, labels);
      const pwUntested = pairwiseStockUntested(scores.pairwise ?? []);
      if (pwUntested) lines.push("the pairwise read is flagged untested (stock): the stock block wins more than 20% of its pairs against none on Opus");
      const interim = Object.fromEntries(SKILL_ARMS.map((arm) => [arm, interimStop(rows, arm)]));
      for (const [arm, s] of Object.entries(interim)) if (s.stop) lines.push("E_ER_EXPOSURE_STOP " + arm + ": " + s.exposed + " of the first 24 Opus sessions exposed, under 0.70; its cells read untested and its remaining cap is released");
      const results = [];
      for (const m of MODELS) {
        const primary = new Set([...ids].filter((u) => !leak[m]!.exposed.includes(u)));
        if (!reviews.some((r) => r.model === m && primary.has(r.unit))) continue;
        const judgePass = (s1.judges.find((j) => j.model === m)?.pass ?? false) && (recheck.find((j) => j.model === m)?.pass ?? true);
        const cov = (arm: ArmId) => {
          const rs = reviews.filter((r) => r.model === m && r.arm === arm && primary.has(r.unit));
          return rs.length ? rs.filter((r) => !isMissing(r)).length / rs.length : 0;
        };
        const exposureOf = (arm: ArmId) => {
          const rs = reviews.filter((r) => r.model === m && r.arm === arm && primary.has(r.unit) && r.exposed !== null);
          return rs.length ? rs.filter((r) => r.exposed).length / rs.length : null;
        };
        const stoppedOf = (arm: ArmId) => (s1.smoke.find((s) => s.arm === arm)?.instrument_fail ? "smoke FIX-METHOD" : m === "opus" && interim[arm]?.stop ? "interim exposure stop" : null);
        const strata: Array<[string, Set<string>, "A" | "A_sens"]> = [["primary", primary, "A"], ["sensitivity (arm stops missing)", primary, "A_sens"], ...(m === "opus" ? [["strict (first exposed on or after 2026-08-01)", new Set([...primary].filter((u) => isStrict(units.get(u)!.meta))), "A"] as [string, Set<string>, "A"]] : [])];
        for (const [name, us, field] of strata) {
          const vsNone = Object.fromEntries(SKILL_ARMS.map((arm) => [arm, contrast(reviews, { model: m, b: arm, a: "none", units: us, field })]));
          const holm = holmFamily(Object.fromEntries(SKILL_ARMS.map((arm) => [arm, stoppedOf(arm) ? 1 : vsNone[arm]!.units ? vsNone[arm]!.p : 1])));
          for (const arm of SKILL_ARMS) vsNone[arm]!.holm = holm[arm]!;
          const lensNone = contrast(reviews, { model: m, b: "lens", a: "none", units: us, field });
          const lnV = verdict({ ci95: lensNone.ci95, p: lensNone.p, spec_ci95: lensNone.specificity?.ci95 ?? null, untested: untestedReasons({ exposure: 1, coverage: [cov("lens"), cov("none")], stockFail: stock.fail[m], judgePass, leak: leak[m]!.untested }) });
          for (const arm of SKILL_ARMS) {
            const cn = vsNone[arm]!;
            const cl = contrast(reviews, { model: m, b: arm, a: "lens", units: us, field });
            const exposure = exposureOf(arm);
            const base = { exposure, stockFail: stock.fail[m], judgePass, leak: leak[m]!.untested, stopped: stoppedOf(arm) };
            const vn = verdict({ ci95: cn.ci95, p: cn.holm, spec_ci95: cn.specificity?.ci95 ?? null, untested: untestedReasons({ ...base, coverage: [cov(arm), cov("none")] }) });
            const vl = verdict({ ci95: cl.ci95, p: cl.p, spec_ci95: cl.specificity?.ci95 ?? null, untested: untestedReasons({ ...base, coverage: [cov(arm), cov("lens")] }) });
            const pw = (scores.pairwise ?? []).find((p) => p.model === m && p.contrast === arm + "-none") ?? null;
            const rd = readingRule({ none: { verdict: vn.verdict, ci95: cn.ci95 }, lens: { verdict: vl.verdict, ci95: cl.ci95 }, lensNone: { verdict: lnV.verdict }, exposure, headroom: s1.admission.reading === "HEADROOM", stockPass: !stock.fail[m], judgePass, coverage: Math.min(cov(arm), cov("none")), pairwise: pw ? { rate: pw.length_controlled, ci95: pw.ci95, untested: pwUntested } : null, stage3: s3.find((x) => x.model === m && x.arm === arm) ?? null });
            const descriptive = m !== "opus" && (s1.smoke.find((s) => s.arm === arm)?.rule3[m].descriptive ?? false);
            results.push({ model: m, arm, read: name, vs_none: cn, vs_lens: cl, verdict: vn, verdict_lens: vl, exposure, reading: name === "primary" ? rd : null, descriptive, mdd: proj?.mdd[m] ?? null });
            lines.push(m + " " + arm + "-none [" + name + "]: " + fmt(cn.delta) + " [" + (cn.ci95 ? fmt(cn.ci95[0]) + ", " + fmt(cn.ci95[1]) : "n/a") + "], p " + fmt(cn.p) + ", Holm " + fmt(cn.holm) + ", " + cn.worse_units + " of " + cn.units + " units worse; " + vn.verdict + " (" + vn.why + "); MDD " + fmt(proj?.mdd[m]) + (descriptive ? "; descriptive (smoke rule 3)" : ""));
            if (name === "primary") lines.push(...rd.lines.map((l) => m + " " + arm + ": " + l));
          }
          results.push({ model: m, arm: "lens", read: name, vs_none: lensNone, verdict: lnV });
          for (const [b, x] of [["candidate", "precut"], ["engphase", "precut"]] as Array<[ArmId, ArmId]>) results.push({ model: m, arm: b, read: name, vs: x, contrast: contrast(reviews, { model: m, b, a: x, units: us, field }) });
        }
      }
      Object.assign(out, { recheck, interim, pairwise_untested: pwUntested, results });
      for (const j of recheck) lines.push((j.pass ? "" : "E_ER_JUDGE_KAPPA ") + "stage 2 gold re-check, " + j.judge + ": kappa " + fmt(j.kappa) + ", catch " + fmt(j.catch_rate) + ", false-fail " + fmt(j.false_fail) + " on " + (j.anticipated + j.not) + " gold cells");
    }
    for (const m of MODELS) if (leak[m]!.exposed.length) lines.push("E_ER_LEAK_EXPOSED " + m + ": " + leak[m]!.exposed.length + " of " + leak[m]!.units + " units are leak-exposed" + (leak[m]!.untested ? "; its primaries read untested (leak)" : ""));
  }
  out.lines = lines;
  writeJson(a.one.out!, out);
  for (const l of lines) (/^E_/.test(l) ? io.err : io.out)(l);
  return 0;
}
