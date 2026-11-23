// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's frozen readings (prereg 2026-11-11-geva-522-eng-review-build-read-prereg, sections 5 and
// 8): the per-build measures, unit-paired contrasts clustered on the repository label with units nested in it, the
// pooled primary and the true fixed sequence, Holm as a sensitivity reading, the reach guard, the verdict words in their
// fixed precedence, gaps read as missing and as 0, every stratum the plan lists, and the MDD print. No judge and no key.
import { FROZEN } from "./frozen.ts";
import { finalUntested, type GateState } from "./gates.ts";
import type { AftermathItem, Arm, BuildUnit, CaseRuns, GradedBuild, Reviewer, ReviewRecord, SkillArm } from "./types.ts";

export const SKILL_ARMS: readonly SkillArm[] = ["precut", "engphase", "candidate"];
/** Two-sided z for alpha 0.05 plus z for 80% power: the MDD a reading's bootstrap SD supports. */
const MDD_Z = 1.959964 + 0.841621;

/** Rounds to 1e-9 before a frozen comparison, so 0.6 computed as 0.59999999997 still reads 0.60. */
export const at = (x: number) => Math.round(x * 1e9) / 1e9;
const mean = (xs: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s / xs.length;
};
export const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : (at(x) < 0 ? "-" : at(x) > 0 ? "+" : "") + Math.abs(x).toFixed(d));
export const lvl = (x: number | null | undefined, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(d));

// ---------------------------------------------------------------------------------------------------------------------
// Per-build measures (section 5).

const count = (r: CaseRuns | undefined, ok: (c: string) => boolean) => (r ? r.runs.filter(ok).length : 0);
/** Passes in at least 2 of the 3 runs. A case with no result counts as not passing. */
export const passes = (r: CaseRuns | undefined) => count(r, (c) => c === "pass") >= FROZEN.passOf;
/** A pass or an assertion-class result in at least 2 of the 3 runs. */
export const reaches = (r: CaseRuns | undefined) => count(r, (c) => c === "pass" || c === "assert") >= FROZEN.passOf;
const index = (rs: CaseRuns[] | undefined) => new Map((rs ?? []).map((r) => [r.id, r]));

export type CaseFilter = (item: AftermathItem, caseId: string) => boolean;
export type Measure = (b: GradedBuild, u: BuildUnit) => number | null;

/** The primary: per aftermath item, the share of its cases passing in at least 2 of 3 runs, averaged over the unit's items. */
export function primary(b: GradedBuild, u: BuildUnit, keep: CaseFilter = () => true): number | null {
  const shares: number[] = [];
  for (const item of u.aftermath) {
    const cases = item.cases.filter((c) => keep(item, c));
    if (!cases.length) continue;
    const got = index(b.aftermath[item.item]);
    shares.push(cases.filter((c) => passes(got.get(c))).length / cases.length);
  }
  return shares.length ? mean(shares) : null;
}

/** Reach: per item, the share of its aftermath and anchor cases giving a pass or an assertion-class result in 2 of 3 runs, item-weighted. */
export function reach(b: GradedBuild, u: BuildUnit): number | null {
  const shares: number[] = [];
  for (const item of u.aftermath) {
    const ids = [...item.cases, ...item.anchors];
    if (!ids.length) continue;
    const got = new Map([...index(b.aftermath[item.item]), ...index(b.anchors[item.item])]);
    shares.push(ids.filter((c) => reaches(got.get(c))).length / ids.length);
  }
  return shares.length ? mean(shares) : null;
}

/** Compatibility: the share of anchor and T-item cases that pass. */
export function compatibility(b: GradedBuild, u: BuildUnit): number | null {
  const results: boolean[] = [];
  for (const item of u.aftermath) {
    const got = index(b.anchors[item.item]);
    for (const c of item.anchors) results.push(passes(got.get(c)));
  }
  const t = index(b.tCases);
  for (const c of u.tCases) results.push(passes(t.get(c)));
  return results.length ? results.filter(Boolean).length / results.length : null;
}

/** Functional solved: every functional case passes in at least 2 of 3 runs. */
export function functional(b: GradedBuild, u: BuildUnit): number {
  const got = index(b.functional);
  return u.functional.length > 0 && u.functional.every((c) => passes(got.get(c))) ? 1 : 0;
}

/** Real-bug catch: the share of the unit's B items the build's own tests catch, among those the transplant could read. */
export function catchRate(b: GradedBuild): number | null {
  const v = Object.values(b.catches).filter((x): x is boolean => x !== null);
  return v.length ? v.filter(Boolean).length / v.length : null;
}

export const isGap = (b: { outcome: string }) => b.outcome === "upstream_gap" || b.outcome === "infra_gap";

// ---------------------------------------------------------------------------------------------------------------------
// Cluster inference: a two-stage bootstrap (repositories, then units within each drawn repository) and a two-sided
// sign-flip over repository sums (exact up to 16 repositories, else seeded Monte Carlo), both seeded.

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (sorted: Float64Array, p: number) => {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return lo + 1 < sorted.length ? sorted[lo]! + (h - lo) * (sorted[lo + 1]! - sorted[lo]!) : sorted[lo]!;
};

export interface Paired {
  unit: string;
  repo: string;
  d: number;
}

export interface Reading {
  estimate: number;
  lo: number;
  hi: number;
  p: number;
  units: number;
  repos: number;
  worse: number;
  sd: number;
  mdd: number;
}

export function infer(ds: Paired[], seed: number, draws: number = FROZEN.bootstrapDraws): Reading | null {
  if (!ds.length) return null;
  const byRepo = new Map<string, number[]>();
  for (const x of ds) byRepo.set(x.repo, [...(byRepo.get(x.repo) ?? []), x.d]);
  const repos = [...byRepo.values()];
  const R = repos.length;
  const rand = rng(seed);
  const boot = new Float64Array(draws);
  for (let i = 0; i < draws; i++) {
    let sum = 0;
    let n = 0;
    for (let r = 0; r < R; r++) {
      const units = repos[Math.floor(rand() * R)]!;
      for (let j = 0; j < units.length; j++) sum += units[Math.floor(rand() * units.length)]!;
      n += units.length;
    }
    boot[i] = sum / n;
  }
  boot.sort();
  const m = mean(boot);
  let ss = 0;
  for (let i = 0; i < draws; i++) ss += (boot[i]! - m) ** 2;
  const sd = Math.sqrt(ss / Math.max(draws - 1, 1));
  const sums = repos.map((u) => u.reduce((a, b) => a + b, 0));
  const t = Math.abs(sums.reduce((a, b) => a + b, 0)) - 1e-12;
  let hits = 0;
  let total = 0;
  if (R <= 16) {
    for (let mask = 0; mask < 1 << R; mask++) {
      let s = 0;
      for (let r = 0; r < R; r++) s += mask & (1 << r) ? -sums[r]! : sums[r]!;
      if (Math.abs(s) >= t) hits++;
      total++;
    }
  } else {
    for (let i = 0; i < draws; i++) {
      let s = 0;
      for (let r = 0; r < R; r++) s += rand() < 0.5 ? -sums[r]! : sums[r]!;
      if (Math.abs(s) >= t) hits++;
    }
    hits++;
    total = draws + 1;
  }
  return { estimate: mean(ds.map((x) => x.d)), lo: quantile(boot, 0.025), hi: quantile(boot, 0.975), p: hits / total, units: ds.length, repos: R, worse: ds.filter((x) => x.d < 0).length, sd, mdd: MDD_Z * sd };
}

export type Word = "helps" | "hurts" | "no measurable difference" | "not shown";

const holdsZero = (r: Reading) => at(r.lo) <= 0 && at(r.hi) >= 0;
/** helps or hurts needs p at most alpha and the interval clear of zero that way; an interval holding zero is no measurable difference; otherwise not shown. */
export function word(r: Reading): Word {
  const sig = at(r.p) <= FROZEN.alpha;
  if (sig && at(r.lo) > 0) return "helps";
  if (sig && at(r.hi) < 0) return "hurts";
  return holdsZero(r) ? "no measurable difference" : "not shown";
}

export const readingLine = (r: Reading | null) =>
  r === null ? "no paired units" : fmt(r.estimate) + " [" + fmt(r.lo) + ", " + fmt(r.hi) + "] p " + r.p.toFixed(4) + ", units " + r.units + " (worse " + r.worse + "), repos " + r.repos + ", MDD " + lvl(r.mdd);

// ---------------------------------------------------------------------------------------------------------------------
// Cells and contrasts.

export type GapRule = "missing" | "zero";
type BuildFilter = (b: GradedBuild) => boolean;

export interface Ctx {
  units: BuildUnit[];
  builds: GradedBuild[];
  reviewer: Reviewer;
  gaps: GapRule;
  seed: number;
  draws: number;
}

const cellKey = (unit: string, arm: Arm, reviewer: Reviewer | null) => unit + "|" + arm + "|" + (reviewer ?? "-");
const cells = new WeakMap<GradedBuild[], Map<string, GradedBuild[]>>();
function cell(ctx: Ctx, unit: string, arm: Arm): GradedBuild[] {
  let map = cells.get(ctx.builds);
  if (!map) {
    map = new Map();
    for (const b of ctx.builds) {
      const k = cellKey(b.unit, b.arm, b.reviewer);
      map.set(k, [...(map.get(k) ?? []), b]);
    }
    cells.set(ctx.builds, map);
  }
  return map.get(cellKey(unit, arm, arm === "none" ? null : ctx.reviewer)) ?? [];
}

/** A unit's arm score: the mean over its builds. A gap is dropped (missing) or scores 0 (zero). */
export function unitScore(ctx: Ctx, u: BuildUnit, arm: Arm, m: Measure, filter: BuildFilter = () => true): number | null {
  const vals: number[] = [];
  for (const b of cell(ctx, u.id, arm).filter(filter)) {
    if (isGap(b)) {
      if (ctx.gaps === "zero") vals.push(0);
      continue;
    }
    const v = m(b, u);
    if (v !== null) vals.push(v);
  }
  return vals.length ? mean(vals) : null;
}

export interface ContrastOpts {
  units?: BuildUnit[];
  /** Applies to the plus arms' builds only. */
  filter?: BuildFilter;
}

/** Per unit: the mean of the plus arms' scores (every plus arm needs a score) minus the minus arm's. */
export function paired(ctx: Ctx, plus: readonly Arm[], minus: Arm, m: Measure, o: ContrastOpts = {}): Paired[] {
  const out: Paired[] = [];
  for (const u of o.units ?? ctx.units) {
    const base = unitScore(ctx, u, minus, m);
    const tops = plus.map((a) => unitScore(ctx, u, a, m, o.filter));
    if (base === null || tops.some((x) => x === null)) continue;
    out.push({ unit: u.id, repo: u.repo, d: mean(tops as number[]) - base });
  }
  return out;
}

export const contrast = (ctx: Ctx, plus: readonly Arm[], minus: Arm, m: Measure, o: ContrastOpts = {}) => infer(paired(ctx, plus, minus, m, o), ctx.seed, ctx.draws);

/** A level (one arm's unit scores) with its clustered interval, for the pilot's lines and the per-arm measures. */
export function level(ctx: Ctx, arm: Arm, m: Measure, o: ContrastOpts = {}): Reading | null {
  const ds: Paired[] = [];
  for (const u of o.units ?? ctx.units) {
    const v = unitScore(ctx, u, arm, m, o.filter);
    if (v !== null) ds.push({ unit: u.id, repo: u.repo, d: v });
  }
  return infer(ds, ctx.seed, ctx.draws);
}

// ---------------------------------------------------------------------------------------------------------------------
// The fixed sequence, Holm and the verdicts (section 8).

export type StepStatus = "confirmatory" | "descriptive" | "untested";

export interface Step {
  test: "pooled" | SkillArm;
  status: StepStatus;
  reading: Reading | null;
  word: Word | null;
  rejects: boolean;
  why: string;
}

export interface ArmFacts {
  /** Why the arm reads untested, or null. */
  untested: string | null;
  reading: Reading | null;
  zero: Reading | null;
  functional: Reading | null;
  reachGuard: Reading | null;
  exposure: number | null;
  coverage: number;
}

/**
 * The true fixed sequence: pooled, then FROZEN.sequence, each at alpha. Testing stops at the first test that doesn't
 * reject, an untested one included, and every later arm is descriptive. An arm outside the pooled primary (it failed the
 * exposure gate) is skipped and reads untested without stopping the sequence.
 */
export function sequence(pooled: { untested: string | null; reading: Reading | null }, members: readonly SkillArm[], arms: Record<SkillArm, ArmFacts>): Step[] {
  const steps: Step[] = [];
  let open = true;
  const take = (test: Step["test"], untested: string | null, reading: Reading | null) => {
    if (untested) {
      steps.push({ test, status: "untested", reading, word: null, rejects: false, why: untested });
      open = false;
      return;
    }
    if (!open || reading === null) {
      steps.push({ test, status: "descriptive", reading, word: reading ? word(reading) : null, rejects: false, why: reading ? "after the sequence stopped" : "no paired units" });
      open = false;
      return;
    }
    const w = word(reading);
    const rejects = w === "helps" || w === "hurts";
    steps.push({ test, status: "confirmatory", reading, word: w, rejects, why: rejects ? "rejects at alpha " + FROZEN.alpha : "does not reject; the sequence stops here" });
    if (!rejects) open = false;
  };
  take("pooled", pooled.untested, pooled.reading);
  for (const arm of FROZEN.sequence) {
    if (!members.includes(arm)) {
      steps.push({ test: arm, status: "untested", reading: arms[arm].reading, word: null, rejects: false, why: "outside the pooled primary (failed the exposure gate); skipped" });
      continue;
    }
    take(arm, arms[arm].untested, arms[arm].reading);
  }
  return steps;
}

export interface HolmRow {
  arm: SkillArm;
  p: number;
  adjusted: number;
  rejects: boolean;
}

/** Holm across the arms in the pooled primary, printed as a sensitivity reading only. */
export function holm(rows: Array<{ arm: SkillArm; p: number }>, alpha: number = FROZEN.alpha): HolmRow[] {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  const m = sorted.length;
  let open = true;
  let maxAdj = 0;
  return sorted.map((r, i) => {
    maxAdj = Math.max(maxAdj, Math.min(1, (m - i) * r.p));
    open = open && at(r.p) <= at(alpha / (m - i));
    return { arm: r.arm, p: r.p, adjusted: maxAdj, rejects: open };
  });
}

export type Verdict = "untested" | "CUT-CANDIDATE" | "KEEP" | Word;

/** The fixed precedence: untested, then the candidate's cut rule, then KEEP, then the other words. One verdict per arm. */
export function verdict(arm: SkillArm, step: Step, f: ArmFacts): { verdict: Verdict; why: string } {
  if (f.untested) return { verdict: "untested", why: f.untested };
  if (step.status === "untested") return { verdict: "untested", why: step.why };
  const r = f.reading;
  if (r === null) return { verdict: "untested", why: "no paired units" };
  if (arm === "candidate" && at(r.hi) < FROZEN.cutUpper) return { verdict: "CUT-CANDIDATE", why: "upper bound " + fmt(r.hi) + " is below +" + FROZEN.cutUpper.toFixed(2) };
  const fnOk = f.functional !== null && at(f.functional.lo) > FROZEN.keepFunctionalLower;
  if (step.status === "confirmatory" && step.word === "helps" && fnOk) return { verdict: "KEEP", why: "helps in the fixed sequence; functional solved minus plain lower bound " + fmt(f.functional!.lo) + " is above " + FROZEN.keepFunctionalLower.toFixed(2) };
  if (step.status === "confirmatory") return { verdict: step.word!, why: step.why + (step.word === "helps" ? "; functional solved minus plain lower bound " + fmt(f.functional?.lo) + " is not above " + FROZEN.keepFunctionalLower.toFixed(2) + ", so no KEEP" : "") };
  return { verdict: holdsZero(r) ? "no measurable difference" : "not shown", why: "descriptive: " + step.why };
}

/** Why a skill arm reads untested, in the plan's order; null when it is tested. */
export function untestedWhy(o: { headroom: boolean; arm: SkillArm; gate: GateState; coverage: number; plainCoverage: number; reachGuard: Reading | null }): string | null {
  if (!o.headroom) return "the pilot did not admit headroom";
  if (!o.gate.passed[o.arm]) return "failed the exposure gate";
  if (o.gate.stopped[o.arm]) return "stopped at the interim exposure check";
  const e = o.gate.final[o.arm];
  if (finalUntested(e)) return "exposure " + lvl(e, 2) + " is under " + FROZEN.exposure.final.toFixed(2);
  if (at(o.coverage) < FROZEN.coverageMin) return "coverage " + lvl(o.coverage, 2) + " is under " + FROZEN.coverageMin.toFixed(2);
  if (at(o.plainCoverage) < FROZEN.coverageMin) return "plain coverage " + lvl(o.plainCoverage, 2) + " is under " + FROZEN.coverageMin.toFixed(2);
  if (o.reachGuard && at(o.reachGuard.hi) < FROZEN.reachGuard) return "reach guard: reach minus plain upper bound " + fmt(o.reachGuard.hi) + " is below " + FROZEN.reachGuard.toFixed(2);
  return null;
}

/** Why the pooled primary reads untested: no headroom, fewer than two arms through the gate, a member stopped or under 0.80 or short of coverage. A member's reach guard leaves the pooled reading alone. */
export function pooledUntested(headroom: boolean, gate: GateState, arms: Record<SkillArm, ArmFacts>, plainCoverage: number): string | null {
  if (!headroom) return "the pilot did not admit headroom";
  if (gate.members.length < FROZEN.exposure.minOpusArms) return "fewer than " + FROZEN.exposure.minOpusArms + " arms passed the exposure gate";
  for (const a of gate.members) {
    const why = arms[a].untested;
    if (why && !why.startsWith("reach guard")) return "member " + a + ": " + why;
  }
  if (at(plainCoverage) < FROZEN.coverageMin) return "plain coverage " + lvl(plainCoverage, 2) + " is under " + FROZEN.coverageMin.toFixed(2);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The whole reading.

export interface AnalysisInput {
  units: BuildUnit[];
  builds: GradedBuild[];
  /** The comparison's review sessions (not the exposure smoke), for word counts and the exposed-before-block split. */
  reviews: ReviewRecord[];
  reviewer: Reviewer;
  gate: GateState;
  /** The pilot read HEADROOM. */
  headroom: boolean;
  /** Planned builds per arm, for coverage. */
  planned: Record<Arm, number>;
  seed: number;
  draws?: number;
}

export interface Stratum {
  name: string;
  pooled: Reading | null;
  arms: Record<SkillArm, Reading | null>;
}

export interface ArmResult extends ArmFacts {
  verdict: Verdict;
  why: string;
  lengthAdjusted: { intercept: number; slopePer1000: number } | null;
}

export interface Analysis {
  reviewer: Reviewer;
  pooled: { untested: string | null; reading: Reading | null; zero: Reading | null; verdict: Verdict; family: boolean };
  steps: Step[];
  holm: HolmRow[];
  arms: Record<SkillArm, ArmResult>;
  secondaries: Array<{ name: string; reading: Reading | null }>;
  measures: Array<{ arm: Arm; values: Record<string, number | null> }>;
  tools: { coverage: number; mutation: number };
  strata: Stratum[];
  plainPilot: number | null;
  plainLater: number | null;
  conditional: boolean;
  lines: string[];
}

const toolShare = (builds: GradedBuild[], key: "coverage" | "mutation") => {
  const scored = builds.filter((b) => !isGap(b));
  return scored.length ? scored.filter((b) => b[key] !== null).length / scored.length : 0;
};

/** A tool's measure is reported only when it scored at least 90% of the trees. */
export const toolReported = (share: number) => at(share) >= FROZEN.toolTreesMin;

/** Each contrast regressed on the review word-count difference: the intercept is the contrast at equal words. */
function lengthAdjusted(ctx: Ctx, arm: SkillArm, reviews: ReviewRecord[]): { intercept: number; slopePer1000: number } | null {
  const words = (unit: string, a: Arm) => {
    const w = reviews.filter((r) => r.unit === unit && r.arm === a && r.reviewer === ctx.reviewer).map((r) => r.bundleWords);
    return w.length ? mean(w) : null;
  };
  const pts: Array<[number, number]> = [];
  for (const p of paired(ctx, [arm], "plain", primary)) {
    const a = words(p.unit, arm);
    const b = words(p.unit, "plain");
    if (a !== null && b !== null) pts.push([a - b, p.d]);
  }
  if (!pts.length) return null;
  const mw = mean(pts.map((x) => x[0]));
  const md = mean(pts.map((x) => x[1]));
  const v = pts.reduce((s, [w]) => s + (w - mw) ** 2, 0);
  const slope = v > 0 ? pts.reduce((s, [w, d]) => s + (w - mw) * (d - md), 0) / v : 0;
  return { intercept: md - slope * mw, slopePer1000: slope * 1000 };
}

export function analyze(inp: AnalysisInput): Analysis {
  const ctx: Ctx = { units: inp.units, builds: inp.builds, reviewer: inp.reviewer, gaps: "missing", seed: inp.seed, draws: inp.draws ?? FROZEN.bootstrapDraws };
  const zctx: Ctx = { ...ctx, gaps: "zero" };
  const fn: Measure = (b, u) => functional(b, u);
  const scoredOf = (arm: Arm) => inp.builds.filter((b) => b.arm === arm && (arm === "none" ? b.reviewer === null : b.reviewer === inp.reviewer) && !isGap(b)).length;
  const cov = (arm: Arm) => (inp.planned[arm] > 0 ? scoredOf(arm) / inp.planned[arm] : 0);
  const plainCoverage = cov("plain");

  const facts = {} as Record<SkillArm, ArmFacts>;
  for (const arm of SKILL_ARMS) {
    const reachGuard = contrast(ctx, [arm], "plain", reach);
    const f: ArmFacts = { untested: null, reading: contrast(ctx, [arm], "plain", primary), zero: contrast(zctx, [arm], "plain", primary), functional: contrast(ctx, [arm], "plain", fn), reachGuard, exposure: inp.gate.final[arm], coverage: cov(arm) };
    f.untested = untestedWhy({ headroom: inp.headroom, arm, gate: inp.gate, coverage: f.coverage, plainCoverage, reachGuard });
    facts[arm] = f;
  }
  const members = inp.gate.members;
  const pu = pooledUntested(inp.headroom, inp.gate, facts, plainCoverage);
  const pooledReading = members.length ? contrast(ctx, members, "plain", primary) : null;
  const pooledZero = members.length ? contrast(zctx, members, "plain", primary) : null;
  const steps = sequence({ untested: pu, reading: pooledReading }, members, facts);
  const pooledStep = steps[0]!;
  const pooledVerdict: Verdict = pu || pooledReading === null ? "untested" : word(pooledReading);
  const holmRows = holm(members.flatMap((a) => (facts[a].reading ? [{ arm: a, p: facts[a].reading!.p }] : [])));

  const arms = {} as Record<SkillArm, ArmResult>;
  for (const arm of SKILL_ARMS) arms[arm] = { ...facts[arm], ...verdict(arm, steps.find((s) => s.test === arm)!, facts[arm]), lengthAdjusted: lengthAdjusted(ctx, arm, inp.reviews) };
  const family = pooledVerdict === "helps" && pooledStep.status === "confirmatory" && !SKILL_ARMS.some((a) => arms[a].verdict === "helps" || arms[a].verdict === "KEEP");

  const secondaries = [
    { name: "plain - none", reading: contrast(ctx, ["plain"], "none", primary) },
    ...SKILL_ARMS.map((a) => ({ name: a + " - none", reading: contrast(ctx, [a], "none", primary) })),
    { name: "candidate - precut", reading: contrast(ctx, ["candidate"], "precut", primary) },
    { name: "engphase - precut", reading: contrast(ctx, ["engphase"], "precut", primary) },
  ];

  const tools = { coverage: toolShare(inp.builds, "coverage"), mutation: toolShare(inp.builds, "mutation") };
  const measures = (["none", "plain", ...SKILL_ARMS] as Arm[]).map((arm) => {
    const v = (m: Measure, c: Ctx = ctx) => level(c, arm, m)?.estimate ?? null;
    const rs = inp.reviews.filter((r) => r.arm === arm && r.reviewer === inp.reviewer);
    return {
      arm,
      values: {
        primary: v(primary),
        primary_gaps_zero: v(primary, zctx),
        reach: v(reach),
        compatibility: v(compatibility),
        functional_solved: v(fn),
        real_bug_catch: v((b) => catchRate(b)),
        coverage: toolReported(tools.coverage) ? v((b) => b.coverage) : null,
        mutation: toolReported(tools.mutation) ? v((b) => b.mutation) : null,
        test_lines_added: v((b) => b.testLinesAdded),
        cost_per_build: v((b) => b.costUsd),
        review_words: rs.length ? mean(rs.map((r) => r.bundleWords)) : null,
        stop_hook_blocks: rs.length ? mean(rs.map((r) => r.blocks)) : null,
        reviews_truncated: rs.length ? rs.filter((r) => r.truncated).length : null,
        repo_edits_discarded: rs.length ? rs.reduce((s, r) => s + r.repoEditsDiscarded, 0) : null,
        coverage_of_planned: cov(arm),
      },
    };
  });

  const strata: Stratum[] = [];
  const stratum = (name: string, o: { units?: BuildUnit[]; keep?: CaseFilter; filter?: BuildFilter }) => {
    const m: Measure = o.keep ? (b, u) => primary(b, u, o.keep) : primary;
    const c: ContrastOpts = { units: o.units ?? inp.units, filter: o.filter };
    const a = {} as Record<SkillArm, Reading | null>;
    for (const arm of SKILL_ARMS) a[arm] = contrast(ctx, [arm], "plain", m, c);
    strata.push({ name, pooled: members.length ? contrast(ctx, members, "plain", m, c) : null, arms: a });
  };
  const groups = (key: (u: BuildUnit) => string) => [...new Set(inp.units.map(key))].sort();
  for (const k of groups((u) => u.keying)) stratum("keying " + k, { units: inp.units.filter((u) => u.keying === k) });
  for (const t of groups((u) => u.type)) stratum("type " + t, { units: inp.units.filter((u) => u.type === t) });
  for (const base of ["pass", "fail", "no_result"] as const) stratum("base " + base, { keep: (item, c) => item.base[c] === base });
  for (const month of groups((u) => u.mergedMonth)) stratum("merged " + month, { units: inp.units.filter((u) => u.mergedMonth === month) });
  stratum("strict window", { units: inp.units.filter((u) => u.strictWindow) });
  stratum("outside the strict window", { units: inp.units.filter((u) => !u.strictWindow) });
  stratum("foreseeable yes or maybe", { keep: (item) => item.foreseeable === "yes" || item.foreseeable === "maybe" });
  stratum("foreseeable no", { keep: (item) => item.foreseeable === "no" });
  stratum("mentioned", { keep: (item) => item.mentioned });
  stratum("not mentioned", { keep: (item) => !item.mentioned });
  stratum("generic", { keep: (item) => item.generic });
  stratum("not generic", { keep: (item) => !item.generic });
  const pilotUnits = new Set(inp.builds.filter((b) => b.pilot).map((b) => b.unit));
  stratum("outside the pilot", { units: inp.units.filter((u) => !pilotUnits.has(u.id)) });
  const review = (b: GradedBuild) => inp.reviews.find((r) => r.unit === b.unit && r.arm === b.arm && r.reviewer === b.reviewer && r.rep === b.rep);
  stratum("skill review exposed before any block", { filter: (b) => review(b)?.exposedBeforeBlock === true });
  stratum("skill review exposed only after a block", { filter: (b) => review(b)?.exposedBeforeBlock !== true });

  const a: Analysis = {
    reviewer: inp.reviewer,
    pooled: { untested: pu, reading: pooledReading, zero: pooledZero, verdict: pooledVerdict, family },
    steps,
    holm: holmRows,
    arms,
    secondaries,
    measures,
    tools,
    strata,
    plainPilot: level(ctx, "plain", primary, { filter: (b) => b.pilot })?.estimate ?? null,
    plainLater: level(ctx, "plain", primary, { filter: (b) => !b.pilot })?.estimate ?? null,
    conditional: inp.reviewer === "opus" && pooledVerdict === "helps" && pooledStep.status === "confirmatory",
    lines: [],
  };
  a.lines = formatAnalysis(a);
  return a;
}

export function formatAnalysis(a: Analysis): string[] {
  const L: string[] = ["reviewer " + a.reviewer];
  L.push("pooled primary (skill arms - plain): " + a.pooled.verdict + (a.pooled.untested ? " (" + a.pooled.untested + ")" : "") + "; " + readingLine(a.pooled.reading) + "; gaps as 0: " + readingLine(a.pooled.zero));
  if (a.pooled.family) L.push("family finding: gstack's engineering review arms, taken together, led to builds that pass more of the real later-fix tests");
  for (const s of a.steps) L.push("sequence " + s.test + ": " + s.status + (s.word ? " " + s.word : "") + "; " + s.why);
  for (const h of a.holm) L.push("holm (sensitivity) " + h.arm + ": p " + h.p.toFixed(4) + ", adjusted " + h.adjusted.toFixed(4) + (h.rejects ? ", rejects" : ", does not reject"));
  for (const arm of SKILL_ARMS) {
    const f = a.arms[arm];
    L.push("arm " + arm + ": " + f.verdict + " (" + f.why + "); " + readingLine(f.reading) + "; gaps as 0: " + readingLine(f.zero));
    L.push("arm " + arm + " functional solved - plain: " + readingLine(f.functional) + "; reach - plain: " + readingLine(f.reachGuard) + "; exposure " + lvl(f.exposure, 2) + "; coverage " + lvl(f.coverage, 2));
    if (f.lengthAdjusted) L.push("arm " + arm + " length-adjusted: " + fmt(f.lengthAdjusted.intercept) + " at equal review words (slope " + fmt(f.lengthAdjusted.slopePer1000) + " per 1,000 words)");
    if (arm !== "candidate" && (f.verdict === "no measurable difference" || f.verdict === "not shown")) L.push("arm " + arm + " R48: FIX-METHOD (a null with MDD " + lvl(f.reading?.mdd) + "; ENG-1 and ENG-4 to ENG-7 stay untested, so no CUT-CANDIDATE)");
  }
  for (const s of a.secondaries) L.push("secondary " + s.name + ": " + readingLine(s.reading));
  L.push("tools: coverage scored " + lvl(a.tools.coverage, 2) + " of trees (" + (toolReported(a.tools.coverage) ? "reported" : "not reported") + "), mutation " + lvl(a.tools.mutation, 2) + " (" + (toolReported(a.tools.mutation) ? "reported" : "not reported") + ")");
  for (const m of a.measures) L.push("measures " + m.arm + ": " + Object.entries(m.values).map(([k, v]) => k + " " + lvl(v)).join(", "));
  L.push("plain pilot vs later: " + lvl(a.plainPilot) + " vs " + lvl(a.plainLater));
  for (const s of a.strata) L.push("stratum " + s.name + ": pooled " + (s.pooled ? fmt(s.pooled.estimate) + " [" + fmt(s.pooled.lo) + ", " + fmt(s.pooled.hi) + "] n " + s.pooled.units : "n/a") + "; " + SKILL_ARMS.map((arm) => arm + " " + (s.arms[arm] ? fmt(s.arms[arm]!.estimate) + " n " + s.arms[arm]!.units : "n/a")).join(", "));
  if (a.conditional) L.push("conditional Sol and particle-1 stage: triggered (the Opus pooled primary reads helps); its projection goes to the Captain and on to the owner before any spend");
  return L;
}
