// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 2's frozen readings for the office-hours founder eval (prereg
// wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg, sections 6, 8 and 11): the manifest, coverage
// against it, matched passes, the verdict precedence with every untested condition, the specificity guard, the interim
// exposure stop, the reading rule and the framing readings, the sensitivity and intention-to-treat reads, the
// length-adjusted difference, the real stratum beside each verdict, the arm-guess flag, and the Captain's AN-1
// pitch-only readings. Only sessions on the primary manifest reach a primary number: the real stratum and the
// pitch-only cell have manifests of their own and never count toward the primary one or its coverage.
import { ARMS, MODELS, SEED } from "../frozen.ts";
import type { ArmId, ManifestEntry, ModelId, ScoredSession, SessionKind, StockCredit, UnitMeta } from "../types.ts";
import { realReadout } from "../score/score.ts";
import { stockCheck, type Stage1Reading } from "./stage1.ts";
import { compare, contrast, excludesZero, kappa, lengthAdjusted, matchUnits, r4, seededRandom, shuffle, unitMean, W, type Comparison, type Metric } from "./stats.ts";

/** Section 11's design: Opus at 2 passes, Sol and particle-1 at 1; a round is 4 units on one model and one pass. */
export const PASSES: Readonly<Record<ModelId, number>> = { opus: 2, sol: 1, particle: 1 };
export const ROUND = 4;
/** Section 13's net-envelope cuts, in their frozen order. */
export const CUTS = ["sol lens", "particle lens", "real sol and particle", "opus lens pass 2"] as const;
export type Cut = (typeof CUTS)[number];
export const LIMIT = { missing: 0.1, gstack: 0.05, exposure: 0.8, specificity: 0.9, alpha: 0.05, kappa: 0.6, guess: 0.7, margin: 0.05, worth: 0.15 } as const;
export const INTERIM = { sessions: 24, bar: 0.7 } as const;

const cutOut = (cuts: readonly Cut[], real: boolean, e: { model: ModelId; arm: ArmId; pass: number }) =>
  (cuts.includes("sol lens") && e.model === "sol" && e.arm === "lens") ||
  (cuts.includes("particle lens") && e.model === "particle" && e.arm === "lens") ||
  (cuts.includes("opus lens pass 2") && e.model === "opus" && e.arm === "lens" && e.pass === 2) ||
  (real && cuts.includes("real sol and particle") && e.model !== "opus");

/**
 * Every scheduled session, frozen before the first stage 2 lease, in run order: the units in seeded order (seed
 * 20261109), then per model and pass, rounds of 4 units with every arm. kind pitch is the AN-1 cell, one pass on every
 * model; real builds the real stratum's manifest. Lens cuts apply to the primary and the real stratum, not the pitch cell.
 */
export function manifest(units: readonly string[], o: { kind: Exclude<SessionKind, "reference">; real: boolean; cuts: readonly Cut[] }): ManifestEntry[] {
  const order = shuffle([...units].sort(), seededRandom(SEED));
  const out: ManifestEntry[] = [];
  for (const model of MODELS)
    for (let pass = 1; pass <= (o.kind === "pitch" ? 1 : PASSES[model]); pass++)
      for (let r = 0; r < order.length; r += ROUND)
        for (const unit of order.slice(r, r + ROUND))
          for (const arm of ARMS) if (o.kind === "pitch" || !cutOut(o.cuts, o.real, { model, arm, pass })) out.push({ stage: 2, kind: o.kind, unit, model, arm, pass });
  return out;
}

const entryKey = (e: ManifestEntry) => [e.stage, e.kind, e.model, e.arm, e.unit, e.pass].join("|");

/** The scored session behind each manifest entry, in manifest order; undefined when it never ran. */
export function onManifest(man: readonly ManifestEntry[], sessions: readonly ScoredSession[]): Array<{ entry: ManifestEntry; session: ScoredSession | undefined }> {
  const by = new Map(sessions.map((s) => [entryKey(s), s]));
  return man.map((entry) => ({ entry, session: by.get(entryKey(entry)) }));
}

export interface Cell {
  model: ModelId;
  arm: ArmId;
  scheduled: number;
  unrun: number;
  missing: number;
  missing_rate: number;
  no_block_rate: number;
  arm_stop_rate: number;
  gstack_reads: number;
  gstack_rate: number;
  /** Share of the manifest's passes with complete true-key and shuffled-key labels. */
  specificity_rate: number;
}

/** Coverage per arm and model against the manifest: a session with no W (missing, unscored or never run) is missing. */
export function cell(rows: ReturnType<typeof onManifest>, model: ModelId, arm: ArmId): Cell {
  const mine = rows.filter((r) => r.entry.model === model && r.entry.arm === arm);
  const n = mine.length;
  const count = (f: (s: ScoredSession) => boolean) => mine.filter((r) => r.session !== undefined && f(r.session)).length;
  const rate = (k: number) => (n ? r4(k / n) : 0);
  const missing = n - count((s) => s.W !== null);
  const gstack = count((s) => s.gstack_read);
  return {
    model,
    arm,
    scheduled: n,
    unrun: mine.filter((r) => !r.session).length,
    missing,
    missing_rate: rate(missing),
    no_block_rate: rate(count((s) => s.end === "no-block")),
    arm_stop_rate: rate(count((s) => s.end === "arm-stop")),
    gstack_reads: gstack,
    gstack_rate: rate(gstack),
    specificity_rate: rate(count((s) => s.W !== null && s.W_shuffled !== null)),
  };
}

/** Exposure on a model's scheduled office-hours sessions whose transcript the detector read. */
export function exposure(rows: ReturnType<typeof onManifest>, model: ModelId): { sessions: number; exposed: number; rate: number | null } {
  const read = rows.filter((r) => r.entry.model === model && r.entry.arm === "office-hours" && r.session && r.session.exposed !== null).map((r) => r.session!);
  const exposed = read.filter((s) => s.exposed).length;
  return { sessions: read.length, exposed, rate: read.length ? r4(exposed / read.length) : null };
}

/** The arm-guess probe (section 7): the post flags it when Astra guesses above 70% of blocks correctly. */
export const armGuess = (correct: number, total: number): { rate: number; flag: boolean } => {
  const rate = total ? r4(correct / total) : 0;
  return { rate, flag: rate > LIMIT.guess };
};

/** The interim stop reads exposure under 0.70. */
export const interimStops = (rate: number): boolean => r4(rate) < INTERIM.bar;

/** Section 11: after the first 24 Opus office-hours sessions of stage 2 in run order, exposure under 0.70 stops the arm. */
export function interimStop(rows: ReturnType<typeof onManifest>): { sessions: number; exposed: number; ready: boolean; stop: boolean } {
  const first = rows.filter((r) => r.entry.model === "opus" && r.entry.arm === "office-hours" && r.session && r.session.exposed !== null).slice(0, INTERIM.sessions);
  const exposed = first.filter((r) => r.session!.exposed).length;
  const ready = first.length === INTERIM.sessions;
  return { sessions: first.length, exposed, ready, stop: ready && interimStops(exposed / INTERIM.sessions) };
}

// ---- Section 11: verdicts ----

export type Verdict = "helps" | "hurts" | "not shown" | "no measurable difference" | "untested";
export interface VerdictInput {
  untested: readonly string[];
  w: Pick<Comparison, "delta" | "ci95" | "p"> | null;
  /** The specificity contrast and the W difference on passes with complete shuffled-key labels in both arms. */
  guard: { spec: number; w: number } | null;
  /** Both arms have complete true-key and shuffled-key labels on at least 90% of the manifest's passes. */
  spec_coverage: boolean;
}

/**
 * The precedence of section 11; the first that applies wins. helps or hurts needs p at most 0.05, a 95% interval that
 * excludes zero and the specificity guard: an estimate in the same direction of at least half the W difference.
 */
export function verdict(v: VerdictInput): { verdict: Verdict; why: string } {
  if (v.untested.length) return { verdict: "untested", why: v.untested.join("; ") };
  if (!v.w || !v.w.ci95) return { verdict: "untested", why: "fewer than two units with a matched pass" };
  if (!excludesZero(v.w.ci95)) return { verdict: "no measurable difference", why: "the interval " + r4(v.w.ci95[0]) + " to " + r4(v.w.ci95[1]) + " includes zero" };
  const dir = r4(v.w.ci95[0]) > 0 ? 1 : -1;
  const fails: string[] = [];
  if (r4(v.w.p) > LIMIT.alpha) fails.push("p " + r4(v.w.p) + " above 0.05");
  if (!v.spec_coverage) fails.push("specificity coverage: an arm has complete shuffled-key labels on under 90% of the manifest's passes");
  else if (!v.guard) fails.push("specificity guard: no pass with complete shuffled-key labels in both arms");
  else if (!(r4(v.guard.spec * dir) > 0 && r4(v.guard.spec * dir) >= r4((v.guard.w * dir) / 2))) fails.push("specificity guard: estimate " + r4(v.guard.spec) + " is not at least half the W difference " + r4(v.guard.w) + " in the same direction");
  if (fails.length) return { verdict: "not shown", why: fails.join("; ") };
  return { verdict: dir > 0 ? "helps" : "hurts", why: "p at most 0.05, the interval excludes zero and the specificity guard holds" };
}

export interface Untested {
  incomplete: boolean;
  headroom: boolean;
  smoke_drop: boolean;
  exposure: number | null;
  interim_stop: boolean;
  cells: readonly Cell[];
  stock: boolean;
  judge: readonly string[];
  voided: boolean;
}

/** Every untested condition that holds for one contrast; exposure, the interim stop and the smoke drop bind office-hours contrasts only. */
export function untestedReasons(model: ModelId, arms: readonly ArmId[], u: Untested): string[] {
  const oh = arms.includes("office-hours");
  const out: string[] = [];
  if (u.incomplete) out.push("incomplete: the run stopped with scheduled sessions unrun");
  if (!u.headroom) out.push("stage 1 did not read HEADROOM");
  if (oh && u.smoke_drop) out.push("smoke: office-hours dropped at the smoke");
  if (oh && (u.exposure === null || u.exposure < LIMIT.exposure)) out.push("exposure " + (u.exposure ?? "n/a") + " under 0.80");
  if (oh && model === "opus" && u.interim_stop) out.push("the interim exposure stop");
  for (const c of u.cells) if (arms.includes(c.arm) && c.missing_rate > LIMIT.missing) out.push("coverage: " + c.arm + " missing " + c.missing_rate + ", over 10%");
  if (u.stock) out.push("stock");
  for (const j of u.judge) out.push(j);
  if (u.voided) out.push("simulator: the stage 2 fidelity audit voided the stage");
  for (const c of u.cells) if (arms.includes(c.arm) && c.arm !== "office-hours" && c.gstack_rate > LIMIT.gstack) out.push("gstack reads: " + c.arm + " at " + c.gstack_rate + ", over 5%");
  return out;
}

// ---- Section 11: one contrast ----

export type ContrastName = "office-hours-none" | "lens-none" | "office-hours-lens";
const PAIRS: Readonly<Record<ContrastName, readonly [ArmId, ArmId]>> = { "office-hours-none": ["none", "office-hours"], "lens-none": ["none", "lens"], "office-hours-lens": ["lens", "office-hours"] };
const CONTRASTS = Object.keys(PAIRS) as ContrastName[];

const specMetric: Metric = (s) => (s.W === null || s.W_shuffled === null ? null : s.W - s.W_shuffled);
const wOnComplete: Metric = (s) => (s.W_shuffled === null ? null : s.W);
/** The sensitivity read treats every C1 zero (no block, arm stop) as missing. */
const sensitivityMetric: Metric = (s) => (s.end === "no-block" || s.end === "arm-stop" ? null : s.W);

export interface ContrastRead {
  name: ContrastName;
  w: Comparison | null;
  /** Passes scored on one arm only, which leave the contrast. */
  one_side: number;
  specificity: Comparison | null;
  w_complete: Comparison | null;
  sensitivity: Comparison | null;
  itt: Comparison | null;
  length: ReturnType<typeof lengthAdjusted>;
  untested: string[];
  verdict: Verdict;
  why: string;
}

/** One contrast: W on matched passes, the guard on passes with complete shuffled-key labels in both arms, and the side reads. */
export function readContrast(name: ContrastName, rows: ReturnType<typeof onManifest>, model: ModelId, u: Untested): ContrastRead {
  const [a, b] = PAIRS[name];
  const arm = (x: ArmId) => rows.filter((r) => r.entry.model === model && r.entry.arm === x);
  const scored = (x: ArmId) => arm(x).flatMap((r) => (r.session ? [r.session] : []));
  const w = contrast(scored(a), scored(b), W);
  const specificity = contrast(scored(a), scored(b), specMetric).cmp;
  const w_complete = contrast(scored(a), scored(b), wOnComplete).cmp;
  const itt0 = (x: ArmId) => arm(x).map((r) => ({ unit: r.entry.unit, pass: r.entry.pass, W: r.session?.W ?? 0 }));
  const itt = contrast(itt0(a), itt0(b), (r) => r.W).cmp;
  const untested = untestedReasons(model, [a, b], u);
  const spec_coverage = u.cells.filter((c) => c.arm === a || c.arm === b).every((c) => c.specificity_rate >= LIMIT.specificity);
  const v = verdict({ untested, w: w.cmp, guard: specificity && w_complete ? { spec: specificity.delta, w: w_complete.delta } : null, spec_coverage });
  return { name, w: w.cmp, one_side: w.one_side, specificity, w_complete, sensitivity: contrast(scored(a), scored(b), sensitivityMetric).cmp, itt, length: lengthAdjusted(scored(a), scored(b)), untested, ...v };
}

// ---- Section 11: the reading rule and the framing readings ----

export interface Reading {
  keep: boolean;
  /** KEEP flagged: N or E moved the other way with an interval that excludes zero. */
  flagged: boolean;
  fix_method: string | null;
  power: boolean;
  framing: "carries the gain" | "carries part of the gain" | null;
  lines: string[];
}

/** R48's reading rule as frozen: KEEP only on helps, never CUT-CANDIDATE, and FIX-METHOD with its reason otherwise. */
export function readingRule(c: Readonly<Record<ContrastName, Pick<ContrastRead, "verdict" | "why" | "w">>>, n: Comparison | null, e: Comparison | null): Reading {
  const primary = c["office-hours-none"];
  const keep = primary.verdict === "helps";
  const flagged = keep && [n, e].some((x) => x !== null && x.ci95 !== null && r4(x.ci95[1]) < 0);
  const hi = primary.w?.ci95 ? r4(primary.w.ci95[1]) : null;
  const power = !keep && primary.verdict !== "untested" && hi !== null && hi >= LIMIT.worth;
  const fix_method = keep ? null : primary.verdict === "untested" ? "untested (" + primary.why + ")" : "task fit: OH-1 and OH-8 stay untested" + (power ? "; power: the interval's upper bound " + hi + " reaches the 0.15 smallest effect worth acting on" : "");
  const ohLens = c["office-hours-lens"].w?.ci95 ?? null;
  const bound = ohLens !== null && !excludesZero(ohLens) && r4(ohLens[1]) < LIMIT.margin;
  const framing = keep && bound ? "carries the gain" : c["lens-none"].verdict === "helps" && !bound ? "carries part of the gain" : null;
  const lines = [
    keep ? "KEEP: office-hours sessions ended on the first customer or wedge the founder's own evidence supports more often than plain sessions" + (flagged ? " (flagged: N or E moved the other way with an interval that excludes zero)" : "") : "FIX-METHOD (" + fix_method + ")",
    ...(primary.verdict === "hurts" ? ["hurts goes to the Captain plainly: the skill moved the founder's first move away from what the founder's evidence supports"] : []),
    ...(framing ? ["the one-line framing " + framing + " (an R48 lead to cut lines that don't help, not a cut)"] : []),
  ];
  return { keep, flagged, fix_method, power, framing, lines };
}

// ---- The model read, the real stratum and the AN-1 pitch-only cell ----

/** Section 8's secondaries, each through the same paired machinery. */
export const SECONDARIES: ReadonlyArray<readonly [string, Metric]> = [
  ["W_customer", (s) => s.W_customer],
  ["W_wedge", (s) => s.W_wedge],
  ["W_both", (s) => s.W_both],
  ["W_alt", (s) => s.W_alt],
  ["W or W_alt", (s) => (s.W === null || s.W_alt === null ? null : Math.max(s.W, s.W_alt))],
  ["N", (s) => s.N],
  ["R", (s) => s.R],
  ["E", (s) => s.E],
  ["E_demand", (s) => s.E_demand],
  ["E_all", (s) => s.E_all],
  ["order", (s) => s.order_share],
  ["founder turns", (s) => s.founder_turns],
  ["questions", (s) => s.questions],
  ["pushes", (s) => s.pushes],
  ["specificity", specMetric],
];
/** Section 8's descriptive splits of the primary W difference. */
const SPLITS: ReadonlyArray<readonly [string, (u: UnitMeta) => string | null]> = [
  ["shape", (u) => (u.shape === null ? null : u.shape === "s5" ? "s5" : "other shapes")],
  ["type", (u) => u.type],
  ["author", (u) => u.author],
  ["founder stage", (u) => u.founder_stage],
];

export interface PitchRead {
  W_pitch: Record<ArmId, { units: number; mean: number } | null>;
  /** office-hours minus none on W_pitch, paired by unit. */
  diff: Comparison | null;
  /** The part the conversation adds: the W difference minus the pitch difference, paired by unit (mean_a is pitch, mean_b is W). */
  part: Comparison | null;
  /** AN-1's headline condition: the model reads helps and the pitch estimate is at least half the W estimate. */
  condition: boolean;
  /** The model's scheduled pitch-only sessions, and those that scored a W. */
  scheduled: number;
  scored: number;
  /** The Captain's pre-data completion rule: every scheduled session scored and the cell's launch did not stop. */
  complete: boolean;
}

/** AN-1: W_pitch per arm, office-hours minus none on it, and the conversation's part, on the pitch cell's own sessions. */
export function readPitch(pitch: readonly ScoredSession[], primary: Pick<ContrastRead, "verdict" | "w">, wUnits: ReadonlyMap<string, number>, cell: { scheduled: number; stopped: boolean }): PitchRead {
  const arm = (x: ArmId) => pitch.filter((s) => s.arm === x);
  const W_pitch = Object.fromEntries(ARMS.map((x) => [x, unitMean(arm(x), W)])) as PitchRead["W_pitch"];
  const pm = matchUnits(arm("none"), arm("office-hours"), W).units;
  const diff = compare(pm);
  const part = compare(pm.filter((u) => wUnits.has(u.unit)).map((u) => ({ unit: u.unit, a: u.b - u.a, b: wUnits.get(u.unit)!, passes: 1 })));
  const condition = primary.verdict === "helps" && primary.w !== null && diff !== null && r4(diff.delta) >= r4(primary.w.delta / 2);
  const scored = pitch.filter((s) => s.W !== null).length;
  return { W_pitch, diff, part, condition, scheduled: cell.scheduled, scored, complete: !cell.stopped && cell.scheduled > 0 && scored === cell.scheduled };
}

export interface ModelRead {
  model: ModelId;
  cells: Cell[];
  exposure: ReturnType<typeof exposure>;
  interim: ReturnType<typeof interimStop> | null;
  effective_units: number;
  mdd: number | null;
  contrasts: Record<ContrastName, ContrastRead>;
  secondaries: Array<{ name: string; contrast: ContrastName; cmp: Comparison | null }>;
  splits: Array<{ split: string; group: string; cmp: Comparison | null }>;
  reading: Reading;
  real: { W: Comparison | null; E: Comparison | null; N: Comparison | null; by_fame: Array<{ tercile: number; cmp: Comparison | null }> };
  pitch: PitchRead;
}

export interface Stage2Input {
  manifest: readonly ManifestEntry[];
  real_manifest: readonly ManifestEntry[];
  pitch_manifest: readonly ManifestEntry[];
  /** Every stage 2 session: primary, real stratum and pitch-only. */
  sessions: readonly ScoredSession[];
  units: readonly UnitMeta[];
  stage1: Pick<Stage1Reading, "band" | "untested" | "smoke_drop" | "repairs">;
  stock: readonly StockCredit[];
  /** The stage 2 gold re-check: each production judge's labels of the 40 gold cells inserted in its packets. */
  gold: Readonly<Record<ModelId, ReadonlyArray<{ gold: boolean; judged: boolean | null }>>>;
  /** The stage 2 fidelity audit failed. */
  voided: boolean;
  /** The stage stopped (a cap stop or any stopping code). */
  stopped: boolean;
  /** The pitch-only cell's launch stopped. */
  pitch_stopped: boolean;
  arm_guess: { correct: number; total: number };
  /** power.py's W MDD at a design (projection.ts), recomputed at the effective units. */
  mdd: (model: ModelId, units: number, passes: number) => number | null;
}

export interface Stage2Reading {
  models: Record<ModelId, ModelRead>;
  stock: ReturnType<typeof stockCheck>;
  gold_kappa: Record<ModelId, number | null>;
  arm_guess: { rate: number; flag: boolean };
  /** On Opus the real stratum's office-hours minus none has the opposite sign from the primary's, neither at zero. */
  real_opposite: boolean;
  repairs: string[];
  codes: string[];
}

export function readStage2(i: Stage2Input): Stage2Reading {
  const rows = onManifest(i.manifest, i.sessions);
  const real = new Set(realReadout(i.sessions));
  const named = new Set(i.sessions.filter((s) => s.stratum === "real" && !real.has(s)).map((s) => s.model + "|" + s.unit));
  const realRows = onManifest(i.real_manifest.filter((e) => !named.has(e.model + "|" + e.unit)), [...real]);
  const pitchRows = onManifest(i.pitch_manifest, i.sessions);
  const stock = stockCheck(i.stock, 2, [...new Set(i.manifest.map((e) => e.unit))]);
  const interim = interimStop(rows);
  const metas = new Map(i.units.map((u) => [u.id, u]));
  const gold_kappa = Object.fromEntries(MODELS.map((m) => [m, kappa(i.gold[m].filter((c) => c.judged !== null).map((c) => [c.gold, c.judged!] as const))])) as Record<ModelId, number | null>;
  const codes: string[] = [];
  if (interim.stop) codes.push("E_OF_EXPOSURE_STOP");
  if (i.voided) codes.push("E_OF_SIM_AUDIT");
  const models = Object.fromEntries(
    MODELS.map((model): [ModelId, ModelRead] => {
      const cells = ARMS.map((a) => cell(rows, model, a)).filter((c) => c.scheduled);
      const exp = exposure(rows, model);
      const gk = gold_kappa[model];
      const goldFail = gk === null || r4(gk) < LIMIT.kappa;
      if (goldFail) codes.push("E_OF_JUDGE_KAPPA");
      const judge = [...(i.stage1.untested[model].includes("judge") ? ["judge: the stage 1 judge check"] : []), ...(goldFail ? ["judge: the stage 2 gold re-check kappa " + (gk === null ? "n/a" : r4(gk)) + " under 0.6"] : [])];
      if (stock.fail[model]) codes.push("E_OF_STOCK_FAIL");
      const u: Untested = {
        incomplete: i.stopped && cells.some((c) => c.unrun > 0 && !(model === "opus" && c.arm === "office-hours" && interim.stop)),
        headroom: i.stage1.band.reading === "HEADROOM",
        smoke_drop: i.stage1.smoke_drop[model],
        exposure: exp.rate,
        interim_stop: interim.stop,
        cells,
        stock: stock.fail[model] || i.stage1.untested[model].includes("stock"),
        judge,
        voided: i.voided,
      };
      const contrasts = Object.fromEntries(CONTRASTS.map((n) => [n, readContrast(n, rows, model, u)])) as Record<ContrastName, ContrastRead>;
      const scored = (rs: typeof rows, arm: ArmId) => rs.filter((r) => r.entry.model === model && r.entry.arm === arm && r.session).map((r) => r.session!);
      const secondaries = CONTRASTS.flatMap((n) => SECONDARIES.map(([name, m]) => ({ name, contrast: n, cmp: contrast(scored(rows, PAIRS[n][0]), scored(rows, PAIRS[n][1]), m).cmp })));
      const sec = (name: string) => secondaries.find((s) => s.name === name && s.contrast === "office-hours-none")!.cmp;
      const splits = SPLITS.flatMap(([split, f]) => {
        const groupOf = (unit: string) => (metas.has(unit) ? f(metas.get(unit)!) : null);
        const groups = [...new Set(i.manifest.map((e) => groupOf(e.unit)).filter((g): g is string => g !== null))].sort();
        const inGroup = (g: string) => (s: ScoredSession) => groupOf(s.unit) === g;
        return groups.map((group) => ({ split, group, cmp: contrast(scored(rows, "none").filter(inGroup(group)), scored(rows, "office-hours").filter(inGroup(group)), W).cmp }));
      });
      const realCmp = (m: Metric, keep: (s: ScoredSession) => boolean = () => true) => contrast(scored(realRows, "none").filter(keep), scored(realRows, "office-hours").filter(keep), m).cmp;
      const primary = contrasts["office-hours-none"];
      const wUnits = new Map(matchUnits(scored(rows, "none"), scored(rows, "office-hours"), W).units.map((x) => [x.unit, x.b - x.a]));
      const effective_units = primary.w?.units ?? 0;
      return [
        model,
        {
          model,
          cells,
          exposure: exp,
          interim: model === "opus" ? interim : null,
          effective_units,
          mdd: effective_units ? i.mdd(model, effective_units, PASSES[model]) : null,
          contrasts,
          secondaries,
          splits,
          reading: readingRule(contrasts, sec("N"), sec("E")),
          real: {
            W: realCmp(W),
            E: realCmp((s) => s.E),
            N: realCmp((s) => s.N),
            by_fame: [1, 2, 3].map((t) => ({ tercile: t, cmp: realCmp(W, (s) => metas.get(s.unit)?.fame_tercile === t) })),
          },
          pitch: readPitch(pitchRows.filter((r) => r.entry.model === model && r.session).map((r) => r.session!), primary, wUnits, { scheduled: pitchRows.filter((r) => r.entry.model === model).length, stopped: i.pitch_stopped }),
        },
      ];
    }),
  ) as Record<ModelId, ModelRead>;
  const p = models.opus.contrasts["office-hours-none"].w?.delta ?? 0;
  const q = models.opus.real.W?.delta ?? 0;
  return {
    models,
    stock,
    gold_kappa,
    arm_guess: armGuess(i.arm_guess.correct, i.arm_guess.total),
    real_opposite: p !== 0 && q !== 0 && Math.sign(p) !== Math.sign(q),
    repairs: i.stage1.repairs,
    codes: [...new Set(codes)],
  };
}
