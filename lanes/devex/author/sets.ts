// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dx sets (prereg 2026-11-09-geva-417, section 4: sets, the supply reading, the supply rules and the miss
// sample; section 14, "Keys"). Units go through the funnel in draw order, each only after its window closes:
//   calibration  the next 16 keyed units released by 2026-09-09; supply rule 1 stops authoring with E_DX_SUPPLY_SHORT
//                when the set can't fill within 1,000 draws or $250 of authoring spend
//   miss sample  12 screen-negative and 12 triage-negative calibration draws, in draw order, get a key read anyway;
//                they print as miss rates and never enter a set
//   reading      the supply reading, sent to the Captain at once: counts at every step, keyed per key read, cost per
//                keyed unit (failures included), the miss sample, recognized units per model, the projection and the
//                DX scope rate; supply rule 2 picks the largest of 64, 56 and 48 whose all-in projection fits $3,960
//   comparison   the chosen size, then 6 reserves, from units released by 2026-09-30 not already drawn; supply rule 3
//                ends at the size reached when the frame runs out at 48 or more, and stops below 48
// A unit Opus recognizes stays out of every set (its descriptive stratum) and the next keyed unit takes its place.
//   dx sets calibration --units <dir> --work <dir> --item <item> --other-usd <n> --stage2-unit-usd <n> [--now <iso>]
//   dx sets comparison  --units <dir> --work <dir> --item <item> [--now <iso>] [--write]
// No reading is retried, re-drawn, re-seeded or re-screened: each step's file, once written, is final. Sealed ids and
// plans stay under --work; stdout carries counts only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MeterOptions } from "../../aftermath/meter.ts";
import type { Io } from "../cli.ts";
import { DEVEX_RELEASED_BY } from "../mine/units.ts";
import { MODEL_IDS, SEED, type ModelId } from "../types.ts";
import { authorOne, flag, listUnits, missOne, openAuthoring, put, readJson, type Authoring, type Outcome } from "./cli.ts";
import { DxError, type MissRead } from "./funnel.ts";
import { scopeRate, type ScopeRate } from "./scope.ts";

export const CALIBRATION_SIZE = 16;
export const RESERVE_SIZE = 6;
export const SIZES = [64, 56, 48] as const;
export const MIN_SIZE = 48;
export const RULE1_DRAWS = 1000;
export const RULE1_MICROS = 250_000_000;
/** The $4,000 line less its $40 reserve. */
export const LINE_MICROS = 3_960_000_000;
export const MISS_EACH = 12;
export const CALIBRATION_RELEASED_BY = "2026-09-09T23:59:59Z";

export interface Draw {
  id: string;
  draw_digest: string;
  release_at: string;
  window_to: string;
}

export type Author = (d: Draw, remainingMicros?: number) => Promise<Outcome>;

export interface Fill {
  status: "filled" | "short" | "waiting" | "exhausted";
  /** Which rule stopped it, or what it waits on. */
  reason: string | null;
  /** Every unit walked in this phase, in draw order, with its outcome. */
  walked: Outcome[];
  spent_micros: number;
}

const byDraw = (a: Draw, b: Draw) => (a.draw_digest < b.draw_digest ? -1 : a.draw_digest > b.draw_digest ? 1 : 0);
const shortCode = (e: unknown) => e instanceof DxError && e.code === "E_DX_SUPPLY_SHORT";

/** Supply rule 1: the calibration set fills from units released by 2026-09-09 within 1,000 draws and $250, or authoring stops. */
export async function fillCalibration(draws: readonly Draw[], author: Author): Promise<Fill & { set: string[] }> {
  const walked: Outcome[] = [], set: string[] = [];
  let spent = 0;
  const end = (status: Fill["status"], reason: string | null) => ({ status, reason, walked, spent_micros: spent, set });
  for (const d of [...draws].filter((d) => Date.parse(d.release_at) <= Date.parse(CALIBRATION_RELEASED_BY)).sort(byDraw)) {
    if (set.length === CALIBRATION_SIZE) break;
    if (walked.length === RULE1_DRAWS) return end("short", "rule 1: the calibration set did not fill within " + RULE1_DRAWS + " draws");
    let o: Outcome;
    try {
      o = await author(d, RULE1_MICROS - spent);
    } catch (e) {
      if (shortCode(e)) return end("short", "rule 1: authoring spend reached $" + RULE1_MICROS / 1e6 + " before the calibration set filled");
      throw e;
    }
    walked.push(o);
    spent += o.spent_micros;
    if (o.stage === "keyed") set.push(o.id);
    if (spent > RULE1_MICROS) return end("short", "rule 1: authoring spend passed $" + RULE1_MICROS / 1e6 + " before the calibration set filled");
  }
  return set.length === CALIBRATION_SIZE ? end("filled", null) : end("short", "rule 1: the early-release frame ran out after " + walked.length + " draws, before the calibration set filled");
}

/** The comparison set at the chosen size, then the reserves, from units released by 2026-09-30 that calibration did not draw; supply rule 3 when the frame runs out. */
export async function fillComparison(draws: readonly Draw[], size: number, drawn: ReadonlySet<string>, author: Author, now: string): Promise<Fill & { comparison: string[]; reserves: string[] }> {
  const walked: Outcome[] = [], comparison: string[] = [], reserves: string[] = [];
  let spent = 0;
  const end = (status: Fill["status"], reason: string | null) => ({ status, reason, walked, spent_micros: spent, comparison, reserves });
  for (const d of [...draws].filter((d) => Date.parse(d.release_at) <= Date.parse(DEVEX_RELEASED_BY) && !drawn.has(d.id)).sort(byDraw)) {
    if (comparison.length === size && reserves.length === RESERVE_SIZE) break;
    if (Date.parse(d.window_to) > Date.parse(now)) return end("waiting", "the next unit in draw order, " + d.id + ", has a window that closes " + d.window_to);
    const o = await author(d);
    walked.push(o);
    spent += o.spent_micros;
    if (o.stage === "keyed") (comparison.length < size ? comparison : reserves).push(o.id);
  }
  if (comparison.length === size) return end("filled", reserves.length < RESERVE_SIZE ? "the frame ran out with " + reserves.length + " of " + RESERVE_SIZE + " reserves" : null);
  return comparison.length >= MIN_SIZE ? end("exhausted", "rule 3: the frame ran out; the comparison set ends at " + comparison.length + " units and every MDD is reprinted at that size") : end("short", "rule 3: the frame ran out at " + comparison.length + " comparison units, under " + MIN_SIZE);
}

/** The miss sample: the first 12 screen-negative and the first 12 triage-negative calibration draws, in draw order. */
export function missSample(walked: readonly Outcome[]): { screen: string[]; triage: string[] } {
  const pick = (stage: Outcome["stage"]) => walked.filter((o) => o.stage === stage).slice(0, MISS_EACH).map((o) => o.id);
  return { screen: pick("screen-negative"), triage: pick("triage-negative") };
}

export interface Projection {
  /** Every line of the all-in projection other than authoring and stage 2 (stage 1, judges, stage 3, hosts, crew, the miss sample). */
  other_micros: number;
  /** The measured authoring cost per keyed unit, failures included. */
  per_keyed_micros: number;
  /** Stage 2's projected cost per comparison unit, every model-pass included. */
  stage2_per_unit_micros: number;
}

/** All-in at a comparison size: authoring for calibration, comparison and reserves at the measured cost, and stage 2 at that size. */
export const projectAt = (p: Projection, size: number) => p.other_micros + p.per_keyed_micros * (CALIBRATION_SIZE + size + RESERVE_SIZE) + p.stage2_per_unit_micros * size;

export interface SizeRule {
  size: (typeof SIZES)[number] | null;
  projections: Record<string, number>;
  /** A size under 64 runs only if the measured ICC and item mix bring its MDD within start rule 5's bound. */
  mdd_bound_applies: boolean;
}

/** Supply rule 2: the largest of 64, 56 and 48 whose all-in projection fits $3,960; null is E_DX_SUPPLY_SHORT. */
export function sizeRule(p: Projection): SizeRule {
  const projections = Object.fromEntries(SIZES.map((s) => [String(s), projectAt(p, s)]));
  const size = SIZES.find((s) => projectAt(p, s) <= LINE_MICROS) ?? null;
  return { size, projections, mdd_bound_applies: size !== null && size < SIZES[0] };
}

export interface MissRates {
  units: number;
  with_items: number;
  items: number;
}
const rates = (rs: readonly MissRead[]): MissRates => ({ units: rs.length, with_items: rs.filter((r) => r.items > 0).length, items: rs.reduce((s, r) => s + r.items, 0) });

export interface Reading {
  seed: number;
  draws: number;
  screen_positive: number;
  flagged: number;
  key_read: number;
  /** Units that entered the set; Opus-recognized keyed units count apart. */
  keyed: number;
  recognized_opus: number;
  /** Keyed units (set and Opus-recognized) recognized by each model. */
  recognized: Record<ModelId, number>;
  drops: Record<string, number>;
  keyed_per_key_read: number | null;
  spent_micros: number;
  cost_per_keyed_micros: number | null;
  miss: { screen: MissRates; triage: MissRates; spent_micros: number };
  size_rule: SizeRule;
  dx_scope: ScopeRate;
  stop: string | null;
}

/** The supply reading from the calibration walk, the miss sample and the projection inputs (other lines and stage 2). */
export function supplyReading(fill: Fill & { set: string[] }, miss: { screen: MissRead[]; triage: MissRead[] }, plans: readonly string[], p: Omit<Projection, "per_keyed_micros">): Reading {
  const w = fill.walked;
  const n = (f: (o: Outcome) => boolean) => w.filter(f).length;
  const keyRead = n((o) => !["screen-negative", "triage-negative"].includes(o.stage));
  const keyed = n((o) => o.stage === "keyed");
  const recognized = Object.fromEntries(MODEL_IDS.map((m) => [m, n((o) => o.recognized?.[m] === true)])) as Record<ModelId, number>;
  const per = keyed ? Math.round(fill.spent_micros / keyed) : null;
  const size_rule = sizeRule({ ...p, per_keyed_micros: per ?? Infinity });
  const drops: Record<string, number> = {};
  for (const o of w) if (o.stage !== "keyed") drops[o.stage] = (drops[o.stage] ?? 0) + 1;
  const stop = fill.status !== "filled" ? fill.reason : size_rule.size === null ? "rule 2: even " + MIN_SIZE + " comparison units do not fit $" + LINE_MICROS / 1e6 : null;
  return {
    seed: SEED,
    draws: w.length,
    screen_positive: n((o) => o.stage !== "screen-negative"),
    flagged: keyRead,
    key_read: keyRead,
    keyed,
    recognized_opus: n((o) => o.stage === "recognized-opus"),
    recognized,
    drops,
    keyed_per_key_read: keyRead ? keyed / keyRead : null,
    spent_micros: fill.spent_micros,
    cost_per_keyed_micros: per,
    miss: { screen: rates(miss.screen), triage: rates(miss.triage), spent_micros: [...miss.screen, ...miss.triage].reduce((s, r) => s + r.spent_micros, 0) },
    size_rule,
    dx_scope: scopeRate(plans),
    stop,
  };
}

/** The comparison set's units digest, fixed before the first stage 2 lease: sha256 of the seed and the ids in set order. */
export const unitsDigest = (ids: readonly string[]) => createHash("sha256").update(SEED + "\n" + ids.join("\n")).digest("hex");

const usd = (m: number | null) => (m === null ? "n/a" : (m / 1e6).toFixed(2));
const printReading = (r: Reading) =>
  [
    "dx sets: supply reading (seed " + r.seed + ")",
    "  draws " + r.draws + ", screen-positive " + r.screen_positive + ", flagged " + r.flagged + ", key-read " + r.key_read + ", keyed " + r.keyed + ", Opus-recognized " + r.recognized_opus,
    "  drops " + JSON.stringify(r.drops) + "; recognized per model " + JSON.stringify(r.recognized),
    "  keyed per key read " + (r.keyed_per_key_read?.toFixed(3) ?? "n/a") + "; authoring $" + usd(r.spent_micros) + ", per keyed unit $" + usd(r.cost_per_keyed_micros),
    "  miss sample: screen-negative " + JSON.stringify(r.miss.screen) + ", triage-negative " + JSON.stringify(r.miss.triage) + ", $" + usd(r.miss.spent_micros),
    "  projection " + Object.entries(r.size_rule.projections).map(([s, m]) => s + " units $" + usd(m)).join(", ") + "; size " + (r.size_rule.size ?? "none") + (r.size_rule.mdd_bound_applies ? " (runs only if the measured ICC and item mix bring its MDD within start rule 5's bound)" : ""),
    "  DX scope rate " + r.dx_scope.rate.toFixed(4) + " (" + r.dx_scope.loads + " of " + r.dx_scope.plans + ")",
  ].join("\n");

const CAL_USAGE = "dx sets calibration --units <dir> --work <dir> --item <item> --other-usd <n> --stage2-unit-usd <n> [--now <iso>]";
const CMP_USAGE = "dx sets comparison --units <dir> --work <dir> --item <item> [--now <iso>] [--write]";
const micros = (argv: string[], name: string) => {
  const v = Number(flag(argv, name));
  if (!Number.isFinite(v) || v < 0) throw new DxError("E_USAGE", CAL_USAGE);
  return Math.round(v * 1e6);
};
const authorWith = (a: Authoring): Author => (d, remaining) => authorOne(a, d.id, remaining);

export async function run(argv: string[], io: Io, over: Partial<MeterOptions> = {}): Promise<number> {
  const [what, ...rest] = argv;
  if (what !== "calibration" && what !== "comparison") throw new DxError("E_USAGE", CAL_USAGE + "\n" + CMP_USAGE);
  const work = flag(rest, "--work");
  const readingFile = work ? join(work, "reading.json") : "";
  if (what === "calibration") {
    const other = micros(rest, "--other-usd"), stage2 = micros(rest, "--stage2-unit-usd");
    if (work && existsSync(readingFile)) throw new DxError("E_USAGE", "dx sets: the supply reading in " + readingFile + " is written once and never retried");
    const a = await openAuthoring(rest, CAL_USAGE, over);
    try {
      const fill = await fillCalibration(listUnits(a.units), authorWith(a));
      const sample = fill.status === "filled" ? missSample(fill.walked) : { screen: [], triage: [] };
      const miss = { screen: [] as MissRead[], triage: [] as MissRead[] };
      for (const id of sample.screen) miss.screen.push(await missOne(a, id));
      for (const id of sample.triage) miss.triage.push(await missOne(a, id));
      const plans = fill.walked.filter((o) => o.stage === "keyed").map((o) => o.plan ?? "");
      const reading = supplyReading(fill, miss, plans, { other_micros: other, stage2_per_unit_micros: stage2 });
      put(join(a.work, "calibration.json"), { set: fill.set, walked: fill.walked.map((o) => o.id), miss: sample });
      put(readingFile, reading);
      io.out(printReading(reading));
      if (reading.stop) throw new DxError("E_DX_SUPPLY_SHORT", reading.stop + "; send the supply reading to the Captain");
    } finally {
      await a.meter.close();
    }
    return 0;
  }
  if (!work || !existsSync(readingFile)) throw new DxError("E_USAGE", "dx sets comparison needs the supply reading from dx sets calibration in --work");
  const reading = readJson<Reading>(readingFile);
  if (reading.stop || reading.size_rule.size === null) throw new DxError("E_DX_SUPPLY_SHORT", "the supply reading stopped authoring: " + (reading.stop ?? "no size fits"));
  const setsFile = join(work, "sets.json");
  if (existsSync(setsFile)) throw new DxError("E_USAGE", "dx sets: " + setsFile + " is fixed; the comparison set is drawn once");
  const cal = readJson<{ set: string[]; walked: string[] }>(join(work, "calibration.json"));
  const a = await openAuthoring(rest, CMP_USAGE, over);
  try {
    const fill = await fillComparison(listUnits(a.units), reading.size_rule.size, new Set(cal.walked), authorWith(a), a.now);
    if (fill.status === "waiting") {
      io.out("dx sets: waiting; " + fill.reason + " (comparison " + fill.comparison.length + " of " + reading.size_rule.size + ")");
      return 0;
    }
    if (fill.status === "short") throw new DxError("E_DX_SUPPLY_SHORT", fill.reason! + "; this stops before the first stage 2 lease");
    const plans = fill.comparison.map((id) => readFileSync(join(a.work, "units", id, "plan.md"), "utf8"));
    const scope = scopeRate(plans);
    put(setsFile, { seed: SEED, calibration: cal.set, comparison: fill.comparison, reserves: fill.reserves, size: fill.comparison.length, digest: unitsDigest(fill.comparison), status: fill.status, reason: fill.reason, scope });
    if (rest.includes("--write")) {
      const sets: Array<[string[], "calibration" | "comparison" | "reserve"]> = [[cal.set, "calibration"], [fill.comparison, "comparison"], [fill.reserves, "reserve"]];
      for (const [ids, set] of sets)
        ids.forEach((id, i) => {
          const f = join(a.units, id, "unit.json");
          const o = readJson<Outcome>(join(a.work, "units", id, "outcome.json"));
          if (existsSync(f)) put(f, { ...readJson<Record<string, unknown>>(f), set, rank: i + 1, recognized: o.recognized });
        });
    }
    io.out("dx sets: comparison " + fill.comparison.length + " (" + fill.status + (fill.reason ? "; " + fill.reason : "") + "), reserves " + fill.reserves.length + ", digest " + unitsDigest(fill.comparison));
    io.out("dx sets: DX scope rate on comparison plans " + scope.rate.toFixed(4) + " (" + scope.loads + " of " + scope.plans + "), " + (scope.passes ? "at or above 0.80" : "under 0.80: the rate goes to the Captain and no stage 2 lease opens until the Captain answers"));
  } finally {
    await a.meter.close();
  }
  return 0;
}
