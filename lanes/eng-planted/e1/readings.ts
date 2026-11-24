// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's readings (prereg 2026-11-24-geva-587-design-time-state-modeling sections 7 and the Decision rows, the
// Interim look, and pre-run change 2's corrections). Keyless and pure: every input is a scored cell.
//
// - A unit's score for an arm and model is the mean of its builds' composites; a gap cell is left out (and scored 0 in
//   the gaps-0 reading). An arm reads untested on a model when its exposure share there (exposed over its non-gap cells)
//   is under 0.80 or more than 10% of the cells it ran there are gaps. N has nothing to expose, so only the gap rule
//   applies to it. An arm is read on a model exactly when it is not untested there (pre-run change 2).
// - X minus Y pools over the models both are read on: the mean over those models, each weighted equally, of the model's
//   mean over its pairs (a unit both arms scored there). The interval is a 95% two-stage cluster bootstrap (repositories,
//   then units within them, a unit's cells on every model kept together, the same model-weighted statistic in every
//   draw; points rounded to 1e-6 so a line is read on the number, not on float noise), and p is a two-sided cluster sign-flip over each repository's contribution (on each model, its pairs'
//   differences over that model's pair count, summed over models). Exact up to 16 repositories, else seeded Monte Carlo.
import { E1, type E1Arm, type E1Model } from "./frozen.ts";

export interface Cell {
  unit: string;
  repo: string;
  arm: E1Arm;
  model: E1Model;
  rep: number;
  /** The build's composite in [0, 1], or null for a gap. */
  composite: number | null;
  /** The review's exposure, or null for N and for a review that gapped. */
  exposed: boolean | null;
  /** The cell was left unrun by the futility stop: it leaves every denominator. */
  unrun?: boolean;
}

export interface Reading {
  estimate: number;
  lo: number;
  hi: number;
  p: number;
  pairs: number;
  repos: number;
  worse: number;
  models: E1Model[];
}

const ran = (c: Cell) => !c.unrun;
const isGap = (c: Cell) => c.composite === null;

export function armState(cells: Cell[], arm: E1Arm, model: E1Model): { cells: number; gaps: number; exposed: number; scored: number; exposure: number | null; gapShare: number; untested: boolean } {
  const mine = cells.filter((c) => c.arm === arm && c.model === model && ran(c));
  const gaps = mine.filter(isGap).length;
  const scored = mine.length - gaps;
  const exposed = mine.filter((c) => !isGap(c) && c.exposed === true).length;
  const exposure = arm === "N" ? null : scored ? exposed / scored : 0;
  const gapShare = mine.length ? gaps / mine.length : 0;
  const untested = !mine.length || gapShare > E1.exposure.maxGapShare || (exposure !== null && exposure < E1.exposure.final);
  return { cells: mine.length, gaps, exposed, scored, exposure, gapShare, untested };
}
export const isRead = (cells: Cell[], arm: E1Arm, model: E1Model) => !armState(cells, arm, model).untested;
export const readOnAny = (cells: Cell[], arm: E1Arm, models: readonly E1Model[]) => models.some((m) => isRead(cells, arm, m));

/** Unit scores for an arm and model: the mean of each unit's builds, gaps left out or scored 0. */
export function unitScores(cells: Cell[], arm: E1Arm, model: E1Model, gapsZero = false): Map<string, { repo: string; score: number }> {
  const by = new Map<string, { repo: string; xs: number[] }>();
  for (const c of cells) {
    if (c.arm !== arm || c.model !== model || !ran(c)) continue;
    if (c.composite === null && !gapsZero) continue;
    const e = by.get(c.unit) ?? { repo: c.repo, xs: [] };
    e.xs.push(c.composite ?? 0);
    by.set(c.unit, e);
  }
  return new Map([...by].map(([u, e]) => [u, { repo: e.repo, score: e.xs.reduce((a, b) => a + b, 0) / e.xs.length }]));
}

export interface Pair {
  unit: string;
  repo: string;
  model: E1Model;
  d: number;
}

export function pairsOf(cells: Cell[], x: E1Arm, y: E1Arm, models: readonly E1Model[], gapsZero = false): Pair[] {
  const out: Pair[] = [];
  for (const m of models) {
    const a = unitScores(cells, x, m, gapsZero);
    const b = unitScores(cells, y, m, gapsZero);
    for (const [u, s] of a) {
      const t = b.get(u);
      if (t) out.push({ unit: u, repo: s.repo, model: m, d: (s.score - t.score) * 100 });
    }
  }
  return out;
}

/** The model-weighted mean: each model's mean over its pairs, averaged with equal weights. */
export function weighted(pairs: readonly Pair[]): number {
  const by = new Map<E1Model, number[]>();
  for (const p of pairs) by.set(p.model, [...(by.get(p.model) ?? []), p.d]);
  const ms = [...by.values()];
  return ms.reduce((s, xs) => s + xs.reduce((a, b) => a + b, 0) / xs.length, 0) / ms.length;
}

/** A seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (xs: Float64Array, q: number) => {
  const i = (xs.length - 1) * q;
  const lo = Math.floor(i);
  return xs[lo]! + (xs[Math.min(lo + 1, xs.length - 1)]! - xs[lo]!) * (i - lo);
};

export function infer(pairs: readonly Pair[], seed: number, draws: number = 10000): Reading | null {
  if (!pairs.length) return null;
  const repos = new Map<string, Map<string, Pair[]>>();
  for (const p of pairs) {
    const r = repos.get(p.repo) ?? new Map<string, Pair[]>();
    r.set(p.unit, [...(r.get(p.unit) ?? []), p]);
    repos.set(p.repo, r);
  }
  const R = [...repos.values()].map((r) => [...r.values()]);
  const rand = rng(seed);
  const boot = new Float64Array(draws);
  for (let i = 0; i < draws; i++) {
    const drawn: Pair[] = [];
    for (let r = 0; r < R.length; r++) {
      const units = R[Math.floor(rand() * R.length)]!;
      for (let j = 0; j < units.length; j++) drawn.push(...units[Math.floor(rand() * units.length)]!);
    }
    boot[i] = weighted(drawn);
  }
  boot.sort();
  const count = new Map<E1Model, number>();
  for (const p of pairs) count.set(p.model, (count.get(p.model) ?? 0) + 1);
  const M = count.size;
  const contrib = R.map((units) => units.flat().reduce((s, p) => s + p.d / count.get(p.model)! / M, 0));
  const t = Math.abs(contrib.reduce((a, b) => a + b, 0)) - 1e-12;
  let hits = 0;
  let total = 0;
  if (R.length <= 16) {
    for (let mask = 0; mask < 1 << R.length; mask++) {
      let s = 0;
      for (let r = 0; r < R.length; r++) s += mask & (1 << r) ? -contrib[r]! : contrib[r]!;
      if (Math.abs(s) >= t) hits++;
      total++;
    }
  } else {
    for (let i = 0; i < draws; i++) {
      let s = 0;
      for (let r = 0; r < R.length; r++) s += rand() < 0.5 ? -contrib[r]! : contrib[r]!;
      if (Math.abs(s) >= t) hits++;
    }
    hits++;
    total = draws + 1;
  }
  const pts = (x: number) => Math.round(x * 1e6) / 1e6;
  return { estimate: pts(weighted(pairs)), lo: pts(quantile(boot, 0.025)), hi: pts(quantile(boot, 0.975)), p: hits / total, pairs: pairs.length, repos: R.length, worse: pairs.filter((p) => p.d < 0).length, models: [...count.keys()] };
}

/** X minus Y over the models both are read on, from the given candidates. */
export function contrast(cells: Cell[], x: E1Arm, y: E1Arm, models: readonly E1Model[], seed: number, o: { draws?: number; gapsZero?: boolean } = {}): Reading | null {
  const pool = models.filter((m) => isRead(cells, x, m) && isRead(cells, y, m));
  return infer(pairsOf(cells, x, y, pool, o.gapsZero), seed, o.draws);
}

export const gains = (r: Reading | null): boolean => r !== null && r.estimate >= E1.gain && r.lo > 0;

/** Holm's step-down; each row's adjusted p and whether it rejects at alpha. */
export function holm<K extends string>(rows: Array<{ key: K; p: number }>, alpha: number = E1.alpha): Array<{ key: K; p: number; adjusted: number; rejects: boolean }> {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  let open = true;
  let maxAdj = 0;
  return sorted.map((r, i) => {
    maxAdj = Math.max(maxAdj, Math.min(1, (sorted.length - i) * r.p));
    open = open && r.p <= alpha / (sorted.length - i);
    return { key: r.key, p: r.p, adjusted: maxAdj, rejects: open };
  });
}
