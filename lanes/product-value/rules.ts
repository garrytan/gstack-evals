// Copyright (c) 2026 Garry Tan. MIT License.
// pv readings (prereg 2026-11-08-geva-403, sections 4, 7, 8, 10, 11 and 12): the frozen readings. Each rule is a pure
// function, so the dry run can drive it on both sides of its edge: the twin check, stage 1 admission, STOCK FAIL per
// production judge, the judge check, the smoke rules, the interim exposure stop, the paired contrasts with the pair drop
// and the intention-to-treat switch, the verdicts with the specificity contrast and the source sign rules, the reading
// rule, leak exposure and the MDD. Every band edge and gate compares values rounded to four decimal places.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clusteredPairedDelta, holmAdjusted, type PairedItem } from "../../src/runner/stats/paired.ts";
import type { Io } from "./cli.ts";
import { loadUnits, need, parseArgs, PvError, readJson, readRecords, readRows, refuseAliases, refuseInRepo, writeJson, type LoadedUnit } from "./io.ts";
import { goldCells, itemKey, listKey, type LabelRecord, type PacketMap } from "./packets.ts";
import { indexLabels, isMissing, pairArms, productionJudge, splitOf, type Review, type StockCredit } from "./score.ts";
import { bootstrapMeans, DRAWS, kappa, mean, percentileInterval, r4, resplitDraws, SEED, seededRandom, shuffle, spearman } from "./stats.ts";
import type { ArmId, Family, ModelId, Row, UnitMeta } from "./types.ts";

export const MODELS: readonly ModelId[] = ["opus", "sol", "particle"];
export type Path = "pooled" | "public";
/** Section 10's admission bands. */
export const BAND: Readonly<Record<Path, { lo: number; hi: number }>> = { pooled: { lo: 0.1, hi: 0.6 }, public: { lo: 0.1, hi: 0.5 } };
/** Section 11's frozen margin for CUT-CANDIDATE and the framing reading. */
export const MARGIN = 0.05;
export const KAPPA_BAR = 0.6;
export const STAT = { seed: SEED, draws: DRAWS };

// ---- Section 4: the twin check ----

export interface TwinPair {
  unit: string;
  twin: string;
  /** Opus none's A on the original's 3 passes and on the twin's 3 passes. */
  a: number[];
  b: number[];
}
export interface TwinReading {
  pairs: number;
  dropped: string[];
  ci90: [number, number];
  a_fail: boolean;
  observed: number;
  p95: number;
  b_fail: boolean;
  spearman: number | null;
  track: boolean;
}

/** Part (a) fails when the 90% interval lies wholly outside -0.10 to 0.10; part (b) when the observed mean absolute difference is above its re-split 95th percentile. */
export function twinDecide(ci90: readonly [number, number], observed: number, p95: number): { a_fail: boolean; b_fail: boolean; track: boolean } {
  const a_fail = r4(ci90[0]) > 0.1 || r4(ci90[1]) < -0.1;
  const b_fail = r4(observed) > r4(p95);
  return { a_fail, b_fail, track: !a_fail && !b_fail };
}

export function twinCheck(pairs: readonly TwinPair[], o = STAT): TwinReading {
  const ok = pairs.filter((p) => p.a.length === 3 && p.b.length === 3);
  const dropped = pairs.filter((p) => !ok.includes(p)).map((p) => p.unit);
  if (!ok.length) throw new PvError("E_USAGE", "the twin check has no pair with 3 scored Opus none passes on each side");
  const d = ok.map((p) => mean(p.a) - mean(p.b));
  const ci90 = percentileInterval(bootstrapMeans(d, o), 0.9);
  const observed = mean(d.map(Math.abs));
  const draws = resplitDraws(ok, o);
  const p95 = draws[Math.ceil(0.95 * draws.length) - 1]!;
  return { pairs: ok.length, dropped, ci90, observed, p95, spearman: spearman(ok.map((p) => mean(p.a)), ok.map((p) => mean(p.b))), ...twinDecide(ci90, observed, p95) };
}

/** The twin pairs from plan-family Opus none reviews: each twin's unit.json names its original in twin_of. */
export function twinPairs(reviews: readonly Review[], units: Map<string, LoadedUnit>): TwinPair[] {
  const passes = (unit: string) => reviews.filter((r) => r.unit === unit && r.family === "plan" && r.model === "opus" && r.arm === "none" && r.A !== null).sort((x, y) => x.pass - y.pass).map((r) => r.A!);
  return [...units.values()].filter((u) => u.meta.twin_of).map((u) => ({ unit: u.meta.twin_of!, twin: u.meta.id, a: passes(u.meta.twin_of!), b: passes(u.meta.id) })).sort((x, y) => (x.unit < y.unit ? -1 : 1));
}

/** The calibration units admission reads: every calibration unit when the twins track, else real public units only. */
export function admittedUnits(units: Map<string, LoadedUnit>, path: Path): string[] {
  return [...units.values()].filter((u) => u.meta.set === "calibration" && (path === "pooled" || u.meta.source === "public")).map((u) => u.meta.id).sort();
}

// ---- Section 8: STOCK FAIL per production judge ----

export interface StockReading {
  fail: boolean;
  limit: number;
  units: number;
  rows: Array<{ model: ModelId; row: number; credited: number; unlabelled: number; fail: boolean }>;
}

/** A stock row credited with a primary item on more than floor(n/8) of n units, for any production judge, is STOCK FAIL. */
export function stockReading(credits: readonly StockCredit[], n: number): StockReading {
  const limit = Math.floor(n / 8);
  const rows = [];
  for (const model of MODELS)
    for (const row of [1, 2, 3]) {
      const mine = credits.filter((c) => c.model === model && c.row === row);
      if (!mine.length) continue;
      const credited = new Set(mine.filter((c) => c.credited).map((c) => c.unit)).size;
      rows.push({ model, row, credited, unlabelled: mine.filter((c) => c.credited === null).length, fail: credited > limit });
    }
  return { fail: rows.some((r) => r.fail), limit, units: n, rows };
}

// ---- Section 7: the judge check ----

export interface CheckCell {
  gold: boolean;
  judged: boolean;
  kind: "arm" | "stock" | "oracle";
  list: string;
}
export interface JudgeReading {
  model: ModelId;
  judge: string;
  anticipated: number;
  not: number;
  real_anticipated: number;
  oracle_available: number;
  oracle_used: number;
  lists: number;
  unlabelled: number;
  shortfall: boolean;
  catch_rate: number | null;
  false_fail: number | null;
  kappa: number | null;
  kappa_real: number | null;
  pass: boolean;
  reading: "pass" | "NO READ (judge)" | "kappa under 0.6";
}

/** Gold cells the production judge also labelled; oracle cells capped at the non-oracle anticipated count (half the anticipated gold). */
export function judgeScore(model: ModelId, judge: string, cells: readonly CheckCell[], o: { seed: number; minimum: number; unlabelled?: number }): JudgeReading {
  const rng = seededRandom(o.seed);
  const antNon = cells.filter((c) => c.gold && c.kind !== "oracle");
  const antOracle = cells.filter((c) => c.gold && c.kind === "oracle");
  const oracle = shuffle(antOracle, rng).slice(0, Math.min(antOracle.length, antNon.length));
  const not = cells.filter((c) => !c.gold);
  const used = [...antNon, ...oracle, ...not];
  const lists = new Set(used.map((c) => c.list)).size;
  const shortfall = o.minimum > 0 && (antNon.length + oracle.length < o.minimum || not.length < o.minimum || lists < o.minimum);
  const real = used.filter((c) => c.kind === "arm");
  const k = kappa(used.map((c) => [c.gold, c.judged] as const));
  const kr = kappa(real.map((c) => [c.gold, c.judged] as const));
  const gNot = used.filter((c) => !c.gold), gAnt = used.filter((c) => c.gold);
  const kappaOk = k !== null && kr !== null && r4(k) >= KAPPA_BAR && r4(kr) >= KAPPA_BAR;
  return {
    model,
    judge,
    anticipated: antNon.length + oracle.length,
    not: not.length,
    real_anticipated: antNon.filter((c) => c.kind === "arm").length,
    oracle_available: antOracle.length,
    oracle_used: oracle.length,
    lists,
    unlabelled: o.unlabelled ?? 0,
    shortfall,
    catch_rate: gNot.length ? gNot.filter((c) => !c.judged).length / gNot.length : null,
    false_fail: gAnt.length ? gAnt.filter((c) => !c.judged).length / gAnt.length : null,
    kappa: k,
    kappa_real: kr,
    pass: !shortfall && kappaOk,
    reading: shortfall ? "NO READ (judge)" : kappaOk ? "pass" : "kappa under 0.6",
  };
}

export const JUDGE_NAME: Readonly<Record<ModelId, string>> = { opus: "astra on opus lists", sol: "opus on sol lists", particle: "panel on particle-1 lists" };

/**
 * Section 7's judge check: gold cells from the separate pass (Astra and Opus agree), scored against each production
 * judge's own stage 1 labels of the same list and item. At least 40 gold cells of each class from at least 40 lists.
 */
export function judgeCheck(o: { checkMap: PacketMap; checkLabels: readonly LabelRecord[]; map: PacketMap; labels: readonly LabelRecord[]; seed?: number }): JudgeReading[] {
  const gold = goldCells(o.checkMap, o.checkLabels);
  const idx = indexLabels(o.map, o.labels);
  const where = new Map<string, { packet: string; list: string; item: string }>();
  for (const meta of Object.values(o.map.packets)) {
    if (meta.role !== "production") continue;
    for (const [lid, lref] of Object.entries(meta.lists)) for (const [iid, iref] of Object.entries(meta.items)) where.set(listKey(lref) + "|" + itemKey(iref), { packet: meta.id, list: lid, item: iid });
  }
  return MODELS.map((model) => {
    const cells: CheckCell[] = [];
    let unlabelled = 0;
    for (const g of gold.filter((x) => x.model === model)) {
      const w = where.get(listKey(g.ref) + "|" + itemKey(g.itemRef));
      const lab = w ? idx.get(w.packet)?.get(w.list + "|" + w.item) : undefined;
      if (!lab) {
        unlabelled++;
        continue;
      }
      cells.push({ gold: g.gold, judged: lab.anticipated, kind: g.ref.kind, list: listKey(g.ref) });
    }
    return judgeScore(model, JUDGE_NAME[model], cells, { seed: o.seed ?? SEED, minimum: 40, unlabelled });
  });
}

/** Stage 2's blind re-check: the production judge's labels of the gold cells inserted in its packets, same pass bar. */
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
        else cells.push({ gold: g.gold, judged: lab.anticipated, kind: g.oracle ? "oracle" : g.real ? "arm" : "stock", list: meta.id + ":" + g.list });
      }
    }
    return cells.length || unlabelled ? [judgeScore(model, JUDGE_NAME[model], cells, { seed: SEED, minimum: 0, unlabelled })] : [];
  });
}

// ---- Section 10: admission and the smoke rules ----

export type Admission = "HEADROOM" | "FLOOR" | "CEILING" | "STOCK FAIL" | "NO READ";

/** Instrument failures read first (they make A untrustworthy), then the band. */
export function admission(i: { path: Path; noneA: number | null; stockFail: boolean; astraOnOpus: boolean; parsed: number; completed: number }): { reading: Admission; reasons: string[] } {
  const reasons: string[] = [];
  const parse = i.completed ? i.parsed / i.completed : 0;
  if (!i.astraOnOpus) reasons.push("the Astra judge's check on Opus lists failed");
  if (r4(parse) < 0.95) reasons.push("none replies parsed " + i.parsed + " of " + i.completed + ", under 95%");
  if (reasons.length) return { reading: "NO READ", reasons };
  if (i.stockFail) return { reading: "STOCK FAIL", reasons: ["a stock row was credited on more than one unit in eight"] };
  if (i.noneA === null) return { reading: "NO READ", reasons: ["no scored Opus none review on the admitted units"] };
  const a = r4(i.noneA), b = BAND[i.path];
  if (a < b.lo) return { reading: "FLOOR", reasons: ["Opus none A " + a + " under " + b.lo] };
  if (a > b.hi) return { reading: "CEILING", reasons: ["Opus none A " + a + " above " + b.hi + " (" + i.path + " path)"] };
  return { reading: "HEADROOM", reasons: ["Opus none A " + a + " inside " + b.lo + " to " + b.hi] };
}

export interface SmokeSession {
  model: ModelId;
  parsed: boolean;
  exposed: boolean | null;
  /** Run-side hook: whether the block carries a 0F or 0G expansion proposal (plan-ceo-review only). */
  expansion_in_block: boolean | null;
}
export interface SmokeReading {
  rule1: { parsed: number; pass: boolean };
  rule2: { expansions: number | null; fallback: boolean; rerun: number | null; instrument_fail: boolean } | null;
  rule3: { exposed: number; fallback: "gate" | "stop" | null; gate_exposed: number | null; instrument_fail: boolean };
  rule4: Record<"sol" | "particle", { exposed: number; sessions: number; descriptive: boolean }>;
  instrument_fail: boolean;
  codes: string[];
}

/** Smoke rules 1 to 4 (section 10) on a family's gstack-arm smoke sessions; rerun and gate are the fallbacks' smokes. */
export function smokeRules(family: Family, s: { opus: readonly SmokeSession[]; sol: readonly SmokeSession[]; particle: readonly SmokeSession[]; rerun?: readonly SmokeSession[]; gate?: readonly SmokeSession[] }): SmokeReading {
  const codes: string[] = [];
  const parsed = s.opus.filter((x) => x.parsed).length;
  const rule1 = { parsed, pass: parsed >= 5 };
  let rule2: SmokeReading["rule2"] = null;
  if (family === "plan") {
    const known = s.opus.every((x) => x.expansion_in_block !== null);
    const expansions = known ? s.opus.filter((x) => x.expansion_in_block).length : null;
    const fallback = expansions !== null && expansions < 4;
    const rerun = fallback && s.rerun ? s.rerun.filter((x) => x.expansion_in_block).length : null;
    if (fallback) codes.push("E_PV_EXPOSURE_FALLBACK");
    rule2 = { expansions, fallback, rerun, instrument_fail: fallback && rerun !== null && rerun < 4 };
  }
  const exposed = s.opus.filter((x) => x.exposed).length;
  let rule3: SmokeReading["rule3"] = { exposed, fallback: null, gate_exposed: null, instrument_fail: false };
  if (exposed < 5) {
    if (family === "plan") {
      codes.push("E_PV_EXPOSURE_FALLBACK");
      const gate = s.gate ? s.gate.filter((x) => x.exposed).length : null;
      rule3 = { exposed, fallback: "gate", gate_exposed: gate, instrument_fail: gate !== null && gate < 5 };
    } else {
      codes.push("E_PV_EXPOSURE_STOP");
      rule3 = { exposed, fallback: "stop", gate_exposed: null, instrument_fail: true };
    }
  }
  const r4m = (xs: readonly SmokeSession[]) => ({ exposed: xs.filter((x) => x.exposed).length, sessions: xs.length, descriptive: xs.filter((x) => x.exposed).length === 0 });
  return { rule1, rule2, rule3, rule4: { sol: r4m(s.sol), particle: r4m(s.particle) }, instrument_fail: !rule1.pass || !!rule2?.instrument_fail || rule3.instrument_fail, codes: [...new Set(codes)] };
}

/** Run-side hook: the expansion flag the run records per smoke session (section 5); null until the run side writes it. */
export const expansionInBlock = (r: Row): boolean | null => r.expansion_in_block ?? null;
export const smokeSession = (r: Row): SmokeSession => ({ model: r.model, parsed: r.end === "block", exposed: r.exposed, expansion_in_block: expansionInBlock(r) });

/** Section 11's interim stop: the first 32 completed Opus skill sessions of stage 2, in run order, exposed under 0.70. */
export function interimStop(rows: readonly Row[]): { sessions: number; exposed: number; ready: boolean; stop: boolean } {
  const first = rows.filter((r) => r.model === "opus" && r.arm === "skill" && (r.end === "block" || r.end === "no-block")).slice(0, 32);
  const exposed = first.filter((r) => r.exposed).length;
  const ready = first.length === 32;
  return { sessions: first.length, exposed, ready, stop: ready && r4(exposed / 32) < 0.7 };
}

// ---- Section 11: contrasts, verdicts and the reading rule ----

export type Verdict = "helps" | "hurts" | "no measurable difference" | "not shown" | "untested";
export const signsMatch = (x: number, y: number): boolean => x === 0 || y === 0 || Math.sign(x) === Math.sign(y);

export interface SignSplit {
  applies: boolean;
  sides: Record<string, { units: number; delta: number | null }>;
  consistent: boolean;
}

/** The point estimate on each side of a split; the rule applies only when each side holds at least 12 units. */
export function signSplit(pairs: ReadonlyArray<{ unit: string; d: number }>, side: (unit: string) => string, names: readonly [string, string], o: { required: boolean }): SignSplit {
  const sides: SignSplit["sides"] = {};
  for (const n of names) {
    const mine = pairs.filter((p) => side(p.unit) === n);
    sides[n] = { units: new Set(mine.map((p) => p.unit)).size, delta: mine.length ? mean(mine.map((p) => p.d)) : null };
  }
  const applies = o.required && names.every((n) => sides[n]!.units >= 12);
  const consistent = !applies || signsMatch(sides[names[0]]!.delta!, sides[names[1]]!.delta!);
  return { applies, sides, consistent };
}

export interface Contrast {
  model: ModelId;
  family: Family;
  contrast: "skill-none" | "skill-lens" | "lens-none";
  read: "primary" | "itt";
  pairs: number;
  units: number;
  dropped: number;
  delta: number;
  ci95: [number, number] | null;
  p: number;
  holm: number | null;
  worse_units: number;
  specificity: { delta: number; ci95: [number, number] | null } | null;
  sources: SignSplit;
  inspiration: SignSplit;
}

const paired = (rows: ReadonlyArray<{ unit: string; pass: number; a: number; b: number }>): PairedItem[] => rows.map((r) => ({ id: r.unit + "#" + r.pass, cluster: r.unit, a: r.a, b: r.b }));

/** One paired contrast, clustered on the unit, with #273's check that the cluster count equals the unit count. */
export function contrast(reviews: readonly Review[], units: Map<string, LoadedUnit>, o: { model: ModelId; family: Family; b: ArmId; a: ArmId; itt: boolean; primary: ReadonlySet<string>; transposedInPrimary: boolean }): Contrast {
  const rs = reviews.filter((r) => o.primary.has(r.unit));
  let rows: Array<{ unit: string; pass: number; a: number; b: number; sa: number | null; sb: number | null }>;
  let dropped = 0;
  if (o.itt) {
    const side = (arm: ArmId) => new Map(rs.filter((r) => r.model === o.model && r.family === o.family && r.arm === arm).map((r) => [r.unit + "#" + r.pass, r]));
    const A = side(o.a), B = side(o.b);
    rows = [...B.entries()].filter(([k]) => A.has(k)).map(([k, rb]) => {
      const ra = A.get(k)!;
      return { unit: rb.unit, pass: rb.pass, a: isMissing(ra) ? 0 : ra.A!, b: isMissing(rb) ? 0 : rb.A!, sa: null, sb: null };
    });
  } else {
    const pr = pairArms(rs, o.model, o.family, o.b, o.a);
    dropped = pr.dropped;
    rows = pr.pairs.map((p) => ({ unit: p.unit, pass: p.pass, a: p.a.A!, b: p.b.A!, sa: p.a.specificity, sb: p.b.specificity }));
  }
  if (!rows.length) throw new PvError("E_USAGE", o.model + " " + o.family + " " + o.b + " minus " + o.a + " has no pair to compare");
  const stats = clusteredPairedDelta(paired(rows), STAT);
  const unitCount = new Set(rows.map((r) => r.unit)).size;
  if (stats.n_clusters !== unitCount) throw new PvError("E_INTERNAL", "the contrast's cluster count " + stats.n_clusters + " differs from its unit count " + unitCount);
  const byUnit = new Map<string, number[]>();
  for (const r of rows) byUnit.set(r.unit, [...(byUnit.get(r.unit) ?? []), r.b - r.a]);
  const spec = rows.filter((r) => r.sa !== null && r.sb !== null);
  const specStats = spec.length && !o.itt ? clusteredPairedDelta(paired(spec.map((r) => ({ unit: r.unit, pass: r.pass, a: r.sa!, b: r.sb! }))), STAT) : null;
  const d = rows.map((r) => ({ unit: r.unit, d: r.b - r.a }));
  return {
    model: o.model,
    family: o.family,
    contrast: (o.b + "-" + o.a) as Contrast["contrast"],
    read: o.itt ? "itt" : "primary",
    pairs: rows.length,
    units: unitCount,
    dropped,
    delta: stats.delta,
    ci95: stats.ci95,
    p: stats.p_two_sided,
    holm: null,
    worse_units: [...byUnit.values()].filter((xs) => mean(xs) < 0).length,
    specificity: specStats ? { delta: specStats.delta, ci95: specStats.ci95 } : null,
    sources: signSplit(d, (u) => units.get(u)!.meta.source, ["public", "transposed"], { required: o.transposedInPrimary }),
    inspiration: signSplit(d, (u) => splitOf(units.get(u)!, "inspiration"), ["capy", "public"], { required: true }),
  };
}

/** Missing rate per arm: missing, contaminated and unscored reviews over planned ones. */
export const missingRate = (reviews: readonly Review[], model: ModelId, family: Family, arm: ArmId): number => {
  const rs = reviews.filter((r) => r.model === model && r.family === family && r.arm === arm);
  return rs.length ? rs.filter(isMissing).length / rs.length : 0;
};

/** The intention-to-treat read becomes the model's primary when its skill arm misses more than 5 points more than none. */
export const ittSwitch = (skillMissing: number, noneMissing: number): boolean => r4(skillMissing - noneMissing) > 0.05;

/** The two primaries of a model and family, Holm over the pair. */
export function primaries(reviews: readonly Review[], units: Map<string, LoadedUnit>, o: { model: ModelId; family: Family; primary: ReadonlySet<string>; transposedInPrimary: boolean }): { itt: boolean; contrasts: [Contrast, Contrast]; itt_reads: [Contrast, Contrast] | null } {
  const itt = ittSwitch(missingRate(reviews, o.model, o.family, "skill"), missingRate(reviews, o.model, o.family, "none"));
  const make = (asItt: boolean): [Contrast, Contrast] => {
    const cs = (["none", "lens"] as ArmId[]).map((a) => contrast(reviews, units, { ...o, b: "skill", a, itt: asItt })) as [Contrast, Contrast];
    const h = holmAdjusted(cs.map((c) => c.p));
    cs.forEach((c, i) => (c.holm = h[i]!));
    return cs;
  };
  const main = make(itt);
  return { itt, contrasts: main, itt_reads: itt ? null : make(true) };
}

export interface VerdictInput {
  delta: number;
  ci95: readonly [number, number] | null;
  holm: number | null;
  spec_ci95: readonly [number, number] | null;
  sign_ok: boolean;
  untested: readonly string[];
}

/** Section 11's verdicts; an interval whose ends round to zero or straddle it includes zero. */
export function verdict(v: VerdictInput): { verdict: Verdict; why: string } {
  if (v.untested.length) return { verdict: "untested", why: v.untested.join("; ") };
  if (!v.ci95) return { verdict: "untested", why: "no interval (fewer than two units)" };
  const lo = r4(v.ci95[0]), hi = r4(v.ci95[1]);
  if (lo <= 0 && hi >= 0) return { verdict: "no measurable difference", why: "the interval " + lo + " to " + hi + " includes zero" };
  const up = lo > 0;
  const fails: string[] = [];
  if (v.holm === null || r4(v.holm) > 0.05) fails.push("Holm p " + (v.holm === null ? "n/a" : r4(v.holm)) + " above 0.05");
  const s = v.spec_ci95;
  if (!s || !(up ? r4(s[0]) > 0 : r4(s[1]) < 0)) fails.push("the specificity contrast's interval does not exclude zero in the same direction");
  if (!v.sign_ok) fails.push("not consistent across sources");
  if (fails.length) return { verdict: "not shown", why: fails.join("; ") };
  return { verdict: up ? "helps" : "hurts", why: "Holm p at most 0.05, the interval and the specificity contrast exclude zero" };
}

/** The untested conditions of section 11 for one contrast. */
export function untestedReasons(i: { exposure: number | null; coverage: readonly number[]; stockFail: boolean; judgePass: boolean; leak: boolean }): string[] {
  const out: string[] = [];
  if (i.exposure === null || r4(i.exposure) < 0.8) out.push("untested (exposure " + (i.exposure === null ? "n/a" : r4(i.exposure)) + " under 0.80)");
  if (i.coverage.some((c) => r4(c) < 0.9)) out.push("untested (coverage under 0.90)");
  if (i.stockFail) out.push("untested (stock)");
  if (!i.judgePass) out.push("untested (judge)");
  if (i.leak) out.push("untested (leak)");
  return out;
}

export interface ReadingInput {
  none: { verdict: Verdict; ci95: readonly [number, number] | null };
  lens: { verdict: Verdict; ci95: readonly [number, number] | null };
  exposure: number | null;
  headroom: boolean;
  stockPass: boolean;
  judgePass: boolean;
  coverage: number;
  ceiling: boolean;
  pairwise: { rate: number | null; ci95: readonly [number, number] | null } | null;
  rItems: number;
}
export interface Reading {
  keep: boolean;
  keep_flag: boolean;
  framing: boolean;
  cut: boolean;
  fix_method_power: boolean;
  rollout_covered: boolean;
  lines: string[];
}

/** Section 11's reading rule, with the frozen +0.05 margin for CUT-CANDIDATE and the framing reading. */
export function readingRule(i: ReadingInput): Reading {
  const lines: string[] = [];
  const keep = i.none.verdict === "helps";
  const keep_flag = keep && i.pairwise !== null && i.pairwise.rate !== null && i.pairwise.ci95 !== null && r4(i.pairwise.rate) < 0.5 && r4(i.pairwise.ci95[1]) < 0.5;
  if (keep) lines.push("KEEP: anticipates more of real users' post-launch needs" + (keep_flag ? " (flagged: the pairwise secondary shows the skill losing at equal length)" : ""));
  const framing = keep && i.lens.verdict === "no measurable difference" && i.lens.ci95 !== null && r4(i.lens.ci95[1]) < MARGIN;
  if (framing) lines.push("the one-line framing carries the gain: skill minus lens's upper bound " + r4(i.lens.ci95![1]) + " is under +0.05 (an R48 lead to cut the lines that don't help)");
  const ci = i.none.ci95;
  const nullish = ci !== null && !(r4(ci[0]) > 0) && r4(ci[1]) < MARGIN;
  const cut = nullish && i.none.verdict !== "untested" && i.exposure !== null && r4(i.exposure) >= 0.8 && i.headroom && i.stockPass && i.judgePass && r4(i.coverage) >= 0.9 && !i.ceiling;
  if (cut) lines.push("CUT-CANDIDATE: skill minus none's 95% upper bound " + r4(ci![1]) + " is under the frozen +0.05 margin");
  else if (nullish && i.ceiling) lines.push("no CUT-CANDIDATE: the none arm carries the CEILING flag");
  const fix_method_power = i.none.verdict === "no measurable difference" && ci !== null && r4(ci[1]) >= MARGIN;
  if (fix_method_power) lines.push("no measurable difference; it rules out gains above " + r4(ci![1]) + "; FIX-METHOD on power, never a cut");
  const rollout_covered = i.rItems >= 30;
  if (!rollout_covered) lines.push("first version and rollout read untested (" + i.rItems + " R items, under 30)");
  return { keep, keep_flag, framing, cut, fix_method_power, rollout_covered, lines };
}

/** The CEILING flag: a none arm above the path's admission ceiling. */
export const ceilingFlag = (noneA: number | null, path: Path): boolean => noneA !== null && r4(noneA) > BAND[path].hi;

// ---- Section 11: leak exposure ----

export interface Cutoffs {
  as_of: string;
  models: Record<ModelId, { model: string; cutoff: string | null; kind: string; source: string; quote?: string; note?: string }>;
}

/** A month-stated cutoff covers that whole month: "2026-06" reads as 2026-06-30. */
export function cutoffEnd(c: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return c;
  const m = /^(\d{4})-(\d{2})$/.exec(c);
  if (!m) throw new PvError("E_USAGE", "cutoff " + JSON.stringify(c) + " is neither YYYY-MM nor YYYY-MM-DD");
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return m[1] + "-" + m[2] + "-" + String(last).padStart(2, "0");
}

export function leakReading(metas: readonly UnitMeta[], model: ModelId, cutoffs: Cutoffs): { model: ModelId; stated: boolean; exposed: string[]; units: number; untested: boolean } {
  const c = cutoffs.models[model]?.cutoff ?? null;
  const exposed = c === null ? [] : metas.filter((m) => cutoffEnd(c) > m.plan_date.slice(0, 10)).map((m) => m.id);
  return { model, stated: c !== null, exposed, units: metas.length, untested: metas.length > 0 && r4(exposed.length / metas.length) > 0.25 };
}

export function loadCutoffs(path = join(import.meta.dir, "cutoffs.json")): Cutoffs {
  return readJson<Cutoffs>(path, "cutoffs file");
}

// ---- Section 12: the MDD ----

export interface PowerRow {
  m: "1" | "1-2" | "2-4";
  p0: number;
  rho: number;
  n: number;
  passes: number;
  mdd05: number;
  mdd025: number;
}
export const MIX_MEAN: Readonly<Record<PowerRow["m"], number>> = { "1": 1, "1-2": 1.5, "2-4": 3 };

export function parsePower(text: string): PowerRow[] {
  const out: PowerRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^m (\S+)\s+p0 ([\d.]+)\s+rho ([\d.]+)\s+n (\d+)\s+passes (\d+)\s+MDD05 ([\d.]+|None)\s+MDD025 ([\d.]+|None)/.exec(line.trim());
    if (m && m[6] !== "None" && m[7] !== "None") out.push({ m: m[1] as PowerRow["m"], p0: Number(m[2]), rho: Number(m[3]), n: Number(m[4]), passes: Number(m[5]), mdd05: Number(m[6]), mdd025: Number(m[7]) });
  }
  return out;
}

/**
 * The design MDD (section 12): the power.txt item mix nearest the audited units' mean items a unit (a tie takes the
 * larger MDD), at the tabled unit count nearest the actual one at or below it and the model's passes, the conservative
 * end over ICC and control rate, at alpha 0.025. A larger stage 1 re-estimate governs.
 */
export function designMdd(rows: readonly PowerRow[], o: { meanItems: number; n: number; passes: number; stage1?: number | null }): { mdd: number; mix: string[]; n: number; table: number; source: "table" | "stage 1" } {
  const ns = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b);
  const n = [...ns].reverse().find((x) => x <= o.n) ?? ns[0]!;
  const dist = (m: PowerRow["m"]) => Math.abs(MIX_MEAN[m] - o.meanItems);
  const best = Math.min(...(Object.keys(MIX_MEAN) as PowerRow["m"][]).map(dist));
  const mixes = (Object.keys(MIX_MEAN) as PowerRow["m"][]).filter((m) => Math.abs(dist(m) - best) < 1e-9);
  const table = Math.max(...rows.filter((r) => mixes.includes(r.m) && r.n === n && r.passes === o.passes).map((r) => r.mdd025));
  if (!Number.isFinite(table)) throw new PvError("E_USAGE", "power.txt has no row at " + n + " units and " + o.passes + " passes");
  const s1 = o.stage1 ?? null;
  return s1 !== null && s1 > table ? { mdd: s1, mix: mixes, n, table, source: "stage 1" } : { mdd: table, mix: mixes, n, table, source: "table" };
}

// ---- The command ----

const USAGE = "gstack-evals pv readings --stage 1|2 --family plan|brief --units <dir> --scores <scores.json> --map <label map> --labels <labels.ndjson> --rows <rows> --out <readings.json> [stage 1: --check-map <check map> --check-labels <check labels.ndjson> --twin-scores <plan-family stage 1 scores.json>] [stage 2: --stage1 <stage 1 readings.json>] [--cutoffs <cutoffs.json>] [--power <power.txt>]";

interface ScoresFile {
  family: Family;
  stage: 1 | 2;
  reviews: Review[];
  stock: StockCredit[];
  pairwise: Array<{ model: ModelId; contrast: string; judge: string; length_controlled: number | null; ci95: [number, number] | null }> | null;
}

export function run(argv: string[], io: Io): number {
  const a = parseArgs(argv, { stage: "one", family: "one", units: "one", scores: "one", map: "one", labels: "many", "check-map": "one", "check-labels": "many", rows: "many", out: "one", "twin-scores": "one", stage1: "one", cutoffs: "one", power: "one" }, USAGE);
  need(a, ["stage", "family", "units", "scores", "map", "labels", "rows", "out"], USAGE);
  const stage = Number(a.one.stage);
  const family = a.one.family as Family;
  if ((stage !== 1 && stage !== 2) || (family !== "plan" && family !== "brief")) throw new PvError("E_USAGE", "--stage is 1 or 2 and --family plan or brief; usage: " + USAGE);
  if (stage === 1) need(a, ["check-map", "check-labels"], USAGE);
  const paths: Array<[string, string]> = [["--units", a.one.units!], ["--scores", a.one.scores!], ["--map", a.one.map!], ["--out", a.one.out!]];
  for (const f of ["labels", "check-labels", "rows"]) for (const p of a.many[f] ?? []) paths.push(["--" + f, p]);
  for (const f of ["check-map", "twin-scores", "stage1", "cutoffs", "power"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  refuseInRepo("--out", a.one.out!);
  const units = loadUnits(a.one.units!, { keys: true });
  const scores = readJson<ScoresFile>(a.one.scores!, "scores file");
  if (scores.family !== family || scores.stage !== stage) throw new PvError("E_USAGE", "--scores holds the " + scores.family + " family's stage " + scores.stage + " scores");
  const map = readJson<PacketMap>(a.one.map!, "label map");
  const labels = a.many.labels!.flatMap((p) => readRecords<LabelRecord>(p, "labels file"));
  const rows = a.many.rows!.flatMap(readRows).filter((r) => r.family === family);
  const cutoffs = loadCutoffs(a.one.cutoffs);
  const power = parsePower(readFileSync(a.one.power ?? join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-403-product-value-prereg/power.txt"), "utf8"));
  const out: Record<string, unknown> = { version: 1, stage, family };
  const lines: string[] = [];
  const reviews = scores.reviews;
  const metas = [...units.values()].map((u) => u.meta);
  const keyed = [...units.values()].filter((u) => u.meta.set === (stage === 1 ? "calibration" : "comparison"));
  const meanItems = mean(keyed.map((u) => u.key!.primary.length));
  const leak = Object.fromEntries(MODELS.map((m) => [m, leakReading(keyed.map((u) => u.meta), m, cutoffs)]));
  out.leak = leak;
  for (const m of MODELS) if (!leak[m]!.stated) lines.push(m + ": no published training cutoff; it runs with that limit stated");
  if (stage === 1) {
    const judges = judgeCheck({ checkMap: readJson<PacketMap>(a.one["check-map"]!, "check map"), checkLabels: a.many["check-labels"]!.flatMap((p) => readRecords<LabelRecord>(p, "check labels file")), map, labels });
    const twinSrc = a.one["twin-scores"] ? readJson<ScoresFile>(a.one["twin-scores"], "twin scores").reviews : reviews;
    const twin = twinCheck(twinPairs(twinSrc, units));
    const path: Path = twin.track ? "pooled" : "public";
    const admitted = admittedUnits(units, path);
    const stock = stockReading(scores.stock.filter((c) => units.get(c.unit)?.meta.set === "calibration"), keyed.length);
    const none = reviews.filter((r) => r.model === "opus" && r.arm === "none" && admitted.includes(r.unit));
    const noneA = meanOverUnits(none);
    const allNone = reviews.filter((r) => r.arm === "none" && admitted.includes(r.unit) && (r.status === "scored" || r.status === "no-block"));
    const adm = admission({ path, noneA, stockFail: stock.fail, astraOnOpus: judges.find((j) => j.model === "opus")!.pass, parsed: allNone.filter((r) => r.status === "scored").length, completed: allNone.length });
    const smoke = smokeRules(family, { opus: rows.filter((r) => r.model === "opus" && r.arm === "skill").map(smokeSession), sol: rows.filter((r) => r.model === "sol" && r.arm === "skill").map(smokeSession), particle: rows.filter((r) => r.model === "particle" && r.arm === "skill").map(smokeSession) });
    const ceiling = Object.fromEntries(MODELS.map((m) => [m, ceilingFlag(meanOverUnits(reviews.filter((r) => r.model === m && r.arm === "none" && admitted.includes(r.unit) && !leak[m]!.exposed.includes(r.unit))), path)]));
    Object.assign(out, { twin, path, admitted, stock, judges, admission: adm, smoke, ceiling, mdd: Object.fromEntries(MODELS.map((m) => [m, designMdd(power, { meanItems, n: 80, passes: m === "opus" ? 2 : 1 })])) });
    lines.push("twin check: part (a) 90% interval " + r4(twin.ci90[0]) + " to " + r4(twin.ci90[1]) + (twin.a_fail ? " FAIL" : " ok") + "; part (b) " + r4(twin.observed) + " against its 95th percentile " + r4(twin.p95) + (twin.b_fail ? " FAIL" : " ok") + "; Spearman " + (twin.spearman === null ? "n/a" : r4(twin.spearman)) + " (prints only); " + (twin.track ? "the twins track: pooled path" : "the twins don't track: public-only path"));
    lines.push("admission (" + family + "): " + adm.reading + " (" + adm.reasons.join("; ") + ")");
    if (stock.fail) lines.push("E_PV_STOCK_FAIL " + stock.rows.filter((r) => r.fail).map((r) => JUDGE_NAME[r.model] + " row " + r.row + " on " + r.credited + " units, limit " + stock.limit).join("; "));
    for (const j of judges) lines.push((j.pass ? "" : j.shortfall ? "E_PV_NO_READ " : "E_PV_JUDGE_KAPPA ") + "judge check, " + j.judge + ": " + j.reading + "; gold " + j.anticipated + " anticipated (" + j.real_anticipated + " real, " + j.oracle_used + " oracle) and " + j.not + " not, from " + j.lists + " lists; catch " + fmt(j.catch_rate) + ", false-fail " + fmt(j.false_fail) + ", kappa " + fmt(j.kappa) + ", real-list kappa " + fmt(j.kappa_real));
    for (const c of smoke.codes) lines.push(c + " a smoke rule tripped; see smoke in " + a.one.out);
    if (smoke.instrument_fail) lines.push("smoke: FIX-METHOD on the instrument");
  } else {
    if (!a.one.stage1) throw new PvError("E_USAGE", "stage 2 readings need --stage1 <stage 1 readings.json> for admission, the path and the judge check");
    const s1 = readJson<{ path: Path; admission: { reading: Admission }; judges: JudgeReading[]; ceiling: Record<ModelId, boolean>; smoke: SmokeReading }>(a.one.stage1, "stage 1 readings");
    const recheck = goldRecheck(map, labels);
    const comparison = keyed.map((u) => u.meta.id);
    const stock = stockReading(scores.stock.filter((c) => comparison.includes(c.unit)), comparison.length);
    const rItems = keyed.reduce((s, u) => s + u.key!.items.filter((i) => i.kind === "R").length, 0);
    const results: Record<string, unknown>[] = [];
    for (const m of MODELS) {
      const primary = new Set(comparison.filter((u) => !leak[m]!.exposed.includes(u) && (s1.path === "pooled" || units.get(u)!.meta.source === "public")));
      if (!reviews.some((r) => r.model === m && primary.has(r.unit))) continue;
      const transposedInPrimary = [...primary].some((u) => units.get(u)!.meta.source === "transposed");
      const pr = primaries(reviews, units, { model: m, family, primary, transposedInPrimary });
      const skill = reviews.filter((r) => r.model === m && r.arm === "skill" && primary.has(r.unit) && r.exposed !== null);
      const exposure = skill.length ? skill.filter((r) => r.exposed).length / skill.length : null;
      const cov = (arm: ArmId) => {
        const rs = reviews.filter((r) => r.model === m && r.arm === arm && primary.has(r.unit));
        return rs.length ? rs.filter((r) => !isMissing(r)).length / rs.length : 0;
      };
      const judgePass = s1.judges.find((j) => j.model === m)!.pass && (recheck.find((j) => j.model === m)?.pass ?? true);
      const vs = pr.contrasts.map((c, i) => verdict({ delta: c.delta, ci95: c.ci95, holm: c.holm, spec_ci95: c.specificity?.ci95 ?? null, sign_ok: c.sources.consistent && c.inspiration.consistent, untested: untestedReasons({ exposure, coverage: [cov("skill"), cov(i === 0 ? "none" : "lens")], stockFail: stock.fail, judgePass, leak: leak[m]!.untested }) }));
      const noneS2 = meanOverUnits(reviews.filter((r) => r.model === m && r.arm === "none" && primary.has(r.unit)));
      const ceiling = s1.ceiling[m] || ceilingFlag(noneS2, s1.path);
      const lc = scores.pairwise?.find((p) => p.model === m && p.contrast === "skill-none") ?? null;
      const rd = readingRule({ none: { verdict: vs[0]!.verdict, ci95: pr.contrasts[0].ci95 }, lens: { verdict: vs[1]!.verdict, ci95: pr.contrasts[1].ci95 }, exposure, headroom: s1.admission.reading === "HEADROOM", stockPass: !stock.fail, judgePass, coverage: Math.min(cov("skill"), cov("none")), ceiling, pairwise: lc ? { rate: lc.length_controlled, ci95: lc.ci95 } : null, rItems });
      const descriptive = s1.smoke.rule4[m as "sol" | "particle"]?.descriptive ?? false;
      const mdd = designMdd(power, { meanItems, n: primary.size, passes: m === "opus" ? 2 : 1 });
      results.push({ model: m, itt: pr.itt, contrasts: pr.contrasts, itt_reads: pr.itt_reads, verdicts: vs, exposure, ceiling, reading: rd, descriptive, mdd });
      pr.contrasts.forEach((c, i) => lines.push(m + " " + c.contrast + (pr.itt ? " (intention to treat)" : "") + ": " + fmt(c.delta) + " [" + (c.ci95 ? fmt(c.ci95[0]) + ", " + fmt(c.ci95[1]) : "n/a") + "], p " + fmt(c.p) + ", Holm " + fmt(c.holm) + ", " + c.worse_units + " of " + c.units + " units worse; " + vs[i]!.verdict + " (" + vs[i]!.why + "); MDD " + mdd.mdd + (descriptive ? "; descriptive (smoke rule 4)" : "")));
      lines.push(...rd.lines.map((l) => m + ": " + l));
    }
    Object.assign(out, { stock, recheck, results, r_items: rItems });
    if (stock.fail) lines.push("E_PV_STOCK_FAIL every contrast of the " + family + " family reads untested (stock)");
    for (const j of recheck) lines.push((j.pass ? "" : "E_PV_JUDGE_KAPPA ") + "stage 2 gold re-check, " + j.judge + ": catch " + fmt(j.catch_rate) + ", false-fail " + fmt(j.false_fail) + ", kappa " + fmt(j.kappa) + ", real-list kappa " + fmt(j.kappa_real));
    const stop = interimStop(rows);
    out.interim = stop;
    if (stop.stop) lines.push("E_PV_EXPOSURE_STOP the first 32 Opus skill sessions were exposed in " + stop.exposed + "; the arm's cells read untested");
  }
  for (const m of MODELS) if (leak[m]!.exposed.length) lines.push("E_PV_LEAK_EXPOSED " + m + ": " + leak[m]!.exposed.length + " of " + leak[m]!.units + " units are leak-exposed" + (leak[m]!.untested ? "; its primaries read untested (leak)" : ""));
  out.lines = lines;
  writeJson(a.one.out!, out);
  for (const l of lines) (/^E_/.test(l) ? io.err : io.out)(l);
  return 0;
}

const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : String(r4(x)));
const meanOverUnits = (rs: readonly Review[]): number | null => {
  const byUnit = new Map<string, number[]>();
  for (const r of rs) if (r.A !== null) byUnit.set(r.unit, [...(byUnit.get(r.unit) ?? []), r.A]);
  return byUnit.size ? mean([...byUnit.values()].map(mean)) : null;
};
