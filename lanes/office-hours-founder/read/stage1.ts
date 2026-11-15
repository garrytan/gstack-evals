// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 1's frozen readings for the office-hours founder eval (prereg
// wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg, sections 7, 8 and 10), in section 10's read
// order: the fidelity audit, the twin check, the Opus judge check, STOCK FAIL on Opus blocks, the parse rate and the
// band, then the smoke rules. The twin check and the judge check's gold scoring are the product-value eval's
// (rules.ts), which this prereg names; the rest is written here. With the Captain's AN-2 ruling it also prints the
// reference's credit rate per item and model, the note that the room edge is close to automatic on Opus and Sol, and
// the drawing-out against deciding split, which is a finding only for particle-1. Every edge compares values rounded
// to four decimal places.
import { judgeScore, twinCheck as pvTwinCheck, type CheckCell, type JudgeReading, type TwinReading } from "../../product-value/rules.ts";
import { MODELS } from "../frozen.ts";
import type { ModelId, ScoredSession, StockCredit, UnitMeta } from "../types.ts";
import { r4, STAT, unitMean, W, type Metric } from "./stats.ts";

export type { CheckCell };

/** Section 10's band edges and the printed lower edge. */
export const BAND = { ceiling: 0.65, reference: 0.3, room: 0.15, low: 0.1 } as const;
export const KAPPA_BAR = 0.6;
export const NEAR_MISS_BAR = 0.8;
export const GOLD_FLOOR = 40;
export const PARSE_BAR = 0.95;
export const TWIN_FLOOR = 6;
/** Smoke rules 1 to 3: at least 5 of 6 parse and are exposed; at most 1 of the 6 Opus sessions hits a limit. */
export const SMOKE = { parse: 5, exposure: 5, limits: 1 } as const;
/** The repairs by the names the run side records in each session's repairs. */
export const REPAIR = { forced: "forced sentence", limit: "30-reply limit", simulator: "simulator prompt" } as const;
export const JUDGE_NAME: Readonly<Record<ModelId, string>> = { opus: "Astra on Opus blocks", sol: "Opus on Sol blocks", particle: "the panel on particle-1 blocks" };
export const MODEL_NAME: Readonly<Record<ModelId, string>> = { opus: "Opus", sol: "Sol", particle: "particle-1" };

const stage1 = (xs: readonly ScoredSession[], model: ModelId, kind: ScoredSession["kind"], arm: ScoredSession["arm"]) => xs.filter((s) => s.stage === 1 && s.model === model && s.kind === kind && s.arm === arm);

// ---- Section 10: the twin check ----

export interface TwinCheck {
  pairs: number;
  dropped: string[];
  test: TwinReading | null;
  track: boolean;
  reading: "track" | "NO READ (twin)";
}

/**
 * Opus none's W on each skin of the pinned pairs (6 to 8), 3 passes a side. A pair without 3 scored passes on each side drops and is
 * named; with fewer than 6 pairs left, or twins that don't track on either test, the stage reads NO READ (twin).
 */
export function twinCheck(sessions: readonly ScoredSession[], units: readonly UnitMeta[]): TwinCheck {
  const passes = (unit: string) => stage1(sessions, "opus", "arm", "none").filter((s) => s.unit === unit && s.W !== null).sort((x, y) => x.pass - y.pass).map((s) => s.W!);
  const pairs = units.filter((u) => u.twin_of).map((u) => ({ unit: u.twin_of!, twin: u.id, a: passes(u.twin_of!), b: passes(u.id) })).sort((x, y) => (x.unit < y.unit ? -1 : 1));
  const ok = pairs.filter((p) => p.a.length === 3 && p.b.length === 3);
  const dropped = pairs.filter((p) => !ok.includes(p)).map((p) => p.unit + " and " + p.twin);
  const test = ok.length >= TWIN_FLOOR ? pvTwinCheck(ok, STAT) : null;
  const track = test !== null && test.track;
  return { pairs: ok.length, dropped, test, track, reading: track ? "track" : "NO READ (twin)" };
}

// ---- Section 7: the judge check ----

/** A near-miss anchor cell, fixed by construction; an unlabelled cell counts as wrong. */
export interface NearMissCell {
  expected: boolean;
  judged: boolean | null;
}
export interface JudgeInput {
  /** The production judge's labels of the gold cells (Astra and Opus agree in the separate pass). */
  cells: readonly CheckCell[];
  unlabelled: number;
  near_miss: readonly NearMissCell[];
}
export interface JudgeCheck extends Omit<JudgeReading, "reading"> {
  near_miss: number | null;
  reading: "pass" | "fail" | "NO READ (judge)";
}

/**
 * Both kappas (overall and on real blocks) at least 0.6, near-miss accuracy at least 0.8, and at least 40 gold cells of
 * each class from at least 40 blocks with oracle cells at most half the credited gold cells (the product-value
 * judgeScore's cap: oracle cells used never outnumber the other credited cells).
 */
export function judgeCheck(model: ModelId, input: JudgeInput): JudgeCheck {
  const score = judgeScore(model, JUDGE_NAME[model], input.cells, { seed: STAT.seed, minimum: GOLD_FLOOR, unlabelled: input.unlabelled });
  const near_miss = input.near_miss.length ? r4(input.near_miss.filter((c) => c.judged === c.expected).length / input.near_miss.length) : null;
  const pass = score.pass && near_miss !== null && near_miss >= NEAR_MISS_BAR;
  return { ...score, near_miss, pass, reading: score.shortfall ? "NO READ (judge)" : pass ? "pass" : "fail" };
}

// ---- Section 8: STOCK FAIL ----

export interface StockRow {
  model: ModelId;
  row: 1 | 2 | 3;
  W: number;
  N: number;
  unlabelled: number;
  fail: boolean;
}

/**
 * Per production judge, from its own labels: any one row credited W on more than one unit in eight of the stage's
 * units (more than 2 of 16 in stage 1, more than 8 of 64 in stage 2) is STOCK FAIL for the model it serves. Every
 * row's W and N credits print.
 */
export function stockCheck(credits: readonly StockCredit[], stage: 1 | 2, units: readonly string[]): { limit: number; rows: StockRow[]; fail: Record<ModelId, boolean> } {
  const limit = Math.floor(units.length / 8);
  const set = new Set(units);
  const rows: StockRow[] = [];
  for (const model of MODELS)
    for (const row of [1, 2, 3] as const) {
      const mine = credits.filter((c) => c.stage === stage && c.model === model && c.row === row && set.has(c.unit));
      if (!mine.length) continue;
      const count = (f: (c: StockCredit) => boolean) => new Set(mine.filter(f).map((c) => c.unit)).size;
      const w = count((c) => c.W === 1);
      rows.push({ model, row, W: w, N: count((c) => c.N === 1), unlabelled: mine.filter((c) => c.W === null).length, fail: w > limit });
    }
  const fail = Object.fromEntries(MODELS.map((m) => [m, rows.some((r) => r.model === m && r.fail)])) as Record<ModelId, boolean>;
  return { limit, rows, fail };
}

// ---- Section 10: the parse rate and the band ----

/** At least 95% of Opus none sessions end on a parsable block; a session that never reached an end of its own (missing) is left out. */
export function parseRate(sessions: readonly ScoredSession[]): { parsed: number; sessions: number; rate: number; pass: boolean } {
  const ended = stage1(sessions, "opus", "arm", "none").filter((s) => s.end === "block" || s.end === "no-block" || s.end === "arm-stop");
  const parsed = ended.filter((s) => s.end === "block").length;
  const rate = ended.length ? r4(parsed / ended.length) : 0;
  return { parsed, sessions: ended.length, rate, pass: rate >= PARSE_BAR };
}

export type BandReading = "HEADROOM" | "CEILING" | "FLOOR" | "NO ROOM";
export interface Band {
  none: number;
  reference: number;
  room: number;
  a: boolean;
  b: boolean;
  c: boolean;
  reading: BandReading;
  /** The approved lower edge: plain Opus under 0.10 prints and stops nothing. */
  under_low: boolean;
  next: string;
}

/** The band's three edges, read in the order a, b, c, from section 10's arithmetic. */
export function bandDecide(none: number, reference: number, ceilingAttempt: boolean): Band {
  const room = r4(reference - none);
  const a = r4(none) <= BAND.ceiling, b = r4(reference) >= BAND.reference, c = room >= BAND.room;
  const reading: BandReading = !a ? "CEILING" : !b ? "FLOOR" : !c ? "NO ROOM" : "HEADROOM";
  const next = {
    HEADROOM: "stage 2 may start once every other stage 1 rule passes and the projection fits",
    CEILING: ceilingAttempt ? "FIX-METHOD (saturation: plain Opus already finds the supported first move), never a cut" : "R61's one ceiling-raise attempt: redraw the sets under the harder author variant and rerun stage 1",
    FLOOR: "FIX-METHOD (task fit: units): the keys don't follow from the facts",
    "NO ROOM": "FIX-METHOD (task fit): Opus decides the same with or without the hidden evidence",
  }[reading];
  return { none: r4(none), reference: r4(reference), room, a, b, c, reading, under_low: r4(none) < BAND.low, next };
}

/** The band on the calibration units: Opus none's W and Opus's full-information reference W, units weighing equally. */
export function band(sessions: readonly ScoredSession[], calibration: readonly string[], ceilingAttempt: boolean): Band {
  const cal = new Set(calibration);
  const on = (xs: readonly ScoredSession[]) => unitMean(xs.filter((s) => cal.has(s.unit)), W);
  const none = on(stage1(sessions, "opus", "arm", "none"));
  const reference = on(stage1(sessions, "opus", "reference", "none"));
  if (!none || !reference) throw new Error("the band needs scored Opus none and reference sessions on the calibration units");
  return bandDecide(none.mean, reference.mean, ceilingAttempt);
}

/** AN-2: the reference's credit rate per item and per model, beside none's W, and the drawing-out against deciding split. */
export function referenceReads(sessions: readonly ScoredSession[], calibration: readonly string[]) {
  const cal = new Set(calibration);
  return MODELS.map((model) => {
    const ref = stage1(sessions, model, "reference", "none").filter((s) => cal.has(s.unit));
    const rate = (m: Metric) => unitMean(ref, m)?.mean ?? null;
    const none = unitMean(stage1(sessions, model, "arm", "none").filter((s) => cal.has(s.unit)), W)?.mean ?? null;
    const w = rate(W);
    return {
      model,
      reference: { W: w, customer: rate((s) => s.W_customer), wedge: rate((s) => s.W_wedge) },
      none,
      drawing_out: w !== null && none !== null ? r4(w - none) : null,
      deciding: w !== null ? r4(1 - w) : null,
      finding: model === "particle",
    };
  });
}

// ---- Section 10: the smoke rules ----

export interface SmokeCount {
  sessions: number;
  parsed: number;
  exposed: number;
  limits: number;
  parse: boolean;
  exposure: boolean;
  /** Smoke rule 3 reads Opus only; null elsewhere. */
  limit: boolean | null;
}
export interface SmokeModel {
  first: SmokeCount;
  repairs: string[];
  resmoke: SmokeCount | null;
  status: "pass" | "re-smoke due" | "pass after repair" | "drop";
}

/** Smoke rules 1 to 3 on one model's office-hours sessions. A missing session neither parses nor shows exposure. */
export function smokeCount(model: ModelId, xs: readonly ScoredSession[]): SmokeCount {
  const parsed = xs.filter((s) => s.end === "block").length;
  const exposed = xs.filter((s) => s.exposed === true).length;
  const limits = xs.filter((s) => s.limit_hit || s.arm_stop).length;
  return { sessions: xs.length, parsed, exposed, limits, parse: parsed >= SMOKE.parse, exposure: exposed >= SMOKE.exposure, limit: model === "opus" ? limits <= SMOKE.limits : null };
}

const smokePass = (c: SmokeCount) => c.parse && c.exposure && c.limit !== false;

/**
 * Smoke rule 4: a parse or exposure failure gets the forced sentence on that model; a limit failure on Opus raises the
 * founder-reply limit to 30 for every arm, so every model re-smokes. One 6-session re-smoke per affected model must pass
 * every rule, else the arm drops for that model.
 */
export function smoke(first: readonly ScoredSession[], resmoke: readonly ScoredSession[]): Record<ModelId, SmokeModel> {
  const oh = (xs: readonly ScoredSession[], m: ModelId) => xs.filter((s) => s.model === m && s.arm === "office-hours");
  const counts = Object.fromEntries(MODELS.map((m) => [m, smokeCount(m, oh(first, m))])) as Record<ModelId, SmokeCount>;
  const limit = counts.opus.limit === false;
  return Object.fromEntries(
    MODELS.map((m) => {
      const c = counts[m];
      const repairs = [...(c.parse && c.exposure ? [] : [REPAIR.forced]), ...(limit ? [REPAIR.limit] : [])];
      if (!repairs.length) return [m, { first: c, repairs, resmoke: null, status: "pass" }];
      const again = oh(resmoke, m);
      if (!again.length) return [m, { first: c, repairs, resmoke: null, status: "re-smoke due" }];
      const r = smokeCount(m, again);
      return [m, { first: c, repairs, resmoke: r, status: smokePass(r) ? "pass after repair" : "drop" }];
    }),
  ) as Record<ModelId, SmokeModel>;
}

// ---- Section 10: the reading in its fixed order ----

export interface AuditResult {
  pass: boolean;
  /** Fewer than 20 founder turns in the stage. */
  no_read: boolean;
  /** The one repair of the prompt's rule wording already ran. */
  repaired: boolean;
}
export interface Stage1Input {
  /** Stage 1 sessions in force: none, reference and lens (the smoke goes in smoke and resmoke). */
  sessions: readonly ScoredSession[];
  units: readonly UnitMeta[];
  audit: AuditResult;
  judges: Readonly<Record<ModelId, JudgeInput>>;
  stock: readonly StockCredit[];
  smoke: readonly ScoredSession[];
  resmoke: readonly ScoredSession[];
  /** This stage 1 runs on the sets R61's ceiling-raise attempt redrew. */
  ceiling_attempt: boolean;
}
export interface Stage1Reading {
  audit: AuditResult;
  twin: TwinCheck;
  judges: Record<ModelId, JudgeCheck>;
  stock: ReturnType<typeof stockCheck>;
  parse: ReturnType<typeof parseRate>;
  band: Band;
  reference: ReturnType<typeof referenceReads>;
  smoke: Record<ModelId, SmokeModel>;
  /** The reading that ends the eval, the first in read order; null when none does. */
  ends: string | null;
  /** Model-wide untested conditions stage 1 hands to stage 2 (judge, stock), and the office-hours arm's smoke drop. */
  untested: Record<ModelId, string[]>;
  smoke_drop: Record<ModelId, boolean>;
  repairs: string[];
  codes: string[];
  /** Every stage 1 rule allows stage 2 (the projection rerun is section 13's, in projection.ts). */
  ready: boolean;
  lines: string[];
}

/** Section 10's read order; the first reading that ends the eval wins, and every reading still prints. */
export function readStage1(i: Stage1Input): Stage1Reading {
  const calibration = i.units.filter((u) => u.set === "calibration").map((u) => u.id).sort();
  const twin = twinCheck(i.sessions, i.units);
  const judges = Object.fromEntries(MODELS.map((m) => [m, judgeCheck(m, i.judges[m])])) as Record<ModelId, JudgeCheck>;
  const stock = stockCheck(i.stock, 1, calibration);
  const parse = parseRate(i.sessions);
  const b = band(i.sessions, calibration, i.ceiling_attempt);
  const reference = referenceReads(i.sessions, calibration);
  const sm = smoke(i.smoke, i.resmoke);
  const codes: string[] = [];
  const ends: string[] = [];
  if (i.audit.no_read || !i.audit.pass) codes.push("E_OF_SIM_AUDIT");
  if (i.audit.no_read) ends.push("NO READ (simulator): fewer than 20 founder turns; stage 2 is void");
  else if (!i.audit.pass && i.audit.repaired) ends.push("FIX-METHOD on the instrument (simulator): the audit failed after its one repair");
  if (!twin.track) ends.push("NO READ (twin), FIX-METHOD on the instrument: the score depends on the skin"), codes.push("E_OF_NO_READ");
  if (judges.opus.reading !== "pass") ends.push("FIX-METHOD on the instrument: the Opus judge check reads " + judges.opus.reading), codes.push(judges.opus.reading === "fail" ? "E_OF_JUDGE_KAPPA" : "E_OF_NO_READ");
  if (stock.fail.opus) ends.push("FIX-METHOD on the instrument: STOCK FAIL on Opus blocks"), codes.push("E_OF_STOCK_FAIL");
  if (!parse.pass) ends.push("FIX-METHOD on the instrument: Opus none parsed " + parse.parsed + " of " + parse.sessions + ", under 95%"), codes.push("E_OF_NO_READ");
  if (b.reading !== "HEADROOM" && !(b.reading === "CEILING" && !i.ceiling_attempt)) ends.push(b.reading + ": " + b.next);
  if (sm.opus.status === "drop") ends.push("FIX-METHOD on the instrument (exposure): office-hours dropped on Opus at the smoke");
  const untested = Object.fromEntries(
    MODELS.map((m) => [m, [...(m !== "opus" && judges[m].reading !== "pass" ? ["judge"] : []), ...(m !== "opus" && stock.fail[m] ? ["stock"] : [])]]),
  ) as Record<ModelId, string[]>;
  for (const m of MODELS) if (m !== "opus" && judges[m].reading !== "pass") codes.push(judges[m].reading === "fail" ? "E_OF_JUDGE_KAPPA" : "E_OF_NO_READ");
  for (const m of MODELS) if (m !== "opus" && stock.fail[m]) codes.push("E_OF_STOCK_FAIL");
  const smoke_drop = Object.fromEntries(MODELS.map((m) => [m, sm[m].status === "drop"])) as Record<ModelId, boolean>;
  const repairs = [...new Set([...(i.audit.repaired ? [REPAIR.simulator] : []), ...MODELS.flatMap((m) => sm[m].repairs)])];
  const ready = !ends.length && i.audit.pass && b.reading === "HEADROOM" && MODELS.every((m) => sm[m].status !== "re-smoke due");
  const lines = [
    "fidelity audit: " + (i.audit.no_read ? "NO READ (simulator)" : i.audit.pass ? "pass" : i.audit.repaired ? "fail after repair" : "fail: repair the prompt's rule wording once and rerun every stage 1 session"),
    "twin check: " + twin.reading + ", " + twin.pairs + " pairs" + (twin.dropped.length ? ", dropped " + twin.dropped.join(", ") : "") + (twin.test ? ", 90% interval " + twin.test.ci90.map(r4).join(" to ") + ", mean absolute difference " + r4(twin.test.observed) + " against re-split 95th percentile " + r4(twin.test.p95) : ""),
    ...MODELS.map((m) => "judge check, " + JUDGE_NAME[m] + ": " + judges[m].reading + ", kappa " + fmt(judges[m].kappa) + " overall and " + fmt(judges[m].kappa_real) + " on real blocks, near-miss " + fmt(judges[m].near_miss) + ", gold " + judges[m].anticipated + " credited and " + judges[m].not + " not from " + judges[m].lists + " blocks"),
    ...stock.rows.map((r) => "stock row " + r.row + ", " + JUDGE_NAME[r.model] + ": W on " + r.W + " and N on " + r.N + " of " + calibration.length + " units" + (r.fail ? ", STOCK FAIL" : "")),
    "parse rate: Opus none " + parse.parsed + " of " + parse.sessions + " (" + parse.rate + ")",
    "band: " + b.reading + ", Opus none W " + b.none + ", reference " + b.reference + ", room " + b.room + (b.under_low ? "; Opus none is under the approved 0.10 lower edge, which prints and stops nothing" : ""),
    "on Opus and Sol the room edge (c) is close to automatic, so the band's binding edge there is the ceiling (a)",
    ...reference.map((r) => MODEL_NAME[r.model] + " reference: W " + fmt(r.reference.W) + ", customer " + fmt(r.reference.customer) + ", wedge " + fmt(r.reference.wedge) + "; none W " + fmt(r.none) + "; drawing out " + fmt(r.drawing_out) + ", deciding " + fmt(r.deciding) + (r.finding ? " (a finding)" : " (descriptive, not a finding)")),
    ...MODELS.map((m) => "smoke, " + MODEL_NAME[m] + ": " + sm[m].status + (sm[m].repairs.length ? " (repairs: " + sm[m].repairs.join(", ") + ")" : "")),
  ];
  return { audit: i.audit, twin, judges, stock, parse, band: b, reference, smoke: sm, ends: ends[0] ?? null, untested, smoke_drop, repairs, codes: [...new Set(codes)], ready, lines };
}

const fmt = (x: number | null) => (x === null ? "n/a" : String(r4(x)));
