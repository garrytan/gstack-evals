// Copyright (c) 2026 Garry Tan. MIT License.
// The ask replay eval's statistics (prereg sections 7, 9 and 10). Everything is paired by item. The 95% interval is a
// seeded percentile bootstrap that resamples decision chains within each thread (10,000 resamples; items in no chain
// are their own clusters), with a leave-one-thread-out range beside it. The planned detectable difference is
// 2.8 * spread / sqrt(effective clusters). Exact binomial intervals and Cohen's kappa reuse the repo's helpers. The pilot
// admits when, on at least one frontier model, arm (b) sends at least 5 of the 24 needless items and misses at most 8 of
// the 16 must-asks, each item counted by its mean over its samples; its spread formula is frozen in frozen.json.
import { binomialCdf, clopperPearson } from "../../src/runner/stats/exact.ts";
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { kappa } from "../product-value/stats.ts";
import { FROZEN } from "./frozen.ts";
import type { Label, ModelKey } from "./types.ts";

export { clopperPearson, kappa };

export interface PairedDiff {
  item: string;
  thread: string;
  cluster: string;
  d: number;
}

export interface Interval {
  delta: number;
  lo: number;
  hi: number;
  n_items: number;
  n_clusters: number;
  /** Lowest and highest estimate with one thread left out; null with fewer than two threads. */
  loto: [number, number] | null;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Mean paired difference with its chain bootstrap interval (clusters resampled within thread) and leave-one-thread-out range. */
export function pairedInterval(pairs: readonly PairedDiff[], o: { seed: number; draws: number }): Interval {
  if (!pairs.length) throw new Error("pairedInterval needs at least one pair");
  const threads = new Map<string, Map<string, { sum: number; count: number }>>();
  for (const p of pairs) {
    const t = threads.get(p.thread) ?? new Map();
    const c = t.get(p.cluster) ?? { sum: 0, count: 0 };
    c.sum += p.d;
    c.count++;
    t.set(p.cluster, c);
    threads.set(p.thread, t);
  }
  const byKey = <T>(m: Map<string, T>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
  const strata = byKey(threads).map((t) => byKey(t));
  const delta = pairs.reduce((s, p) => s + p.d, 0) / pairs.length;
  const rng = seededRandom(o.seed);
  const boot = new Float64Array(o.draws);
  for (let i = 0; i < o.draws; i++) {
    let sum = 0;
    let count = 0;
    for (const s of strata) {
      for (let j = 0; j < s.length; j++) {
        const c = s[Math.floor(rng() * s.length)]!;
        sum += c.sum;
        count += c.count;
      }
    }
    boot[i] = sum / count;
  }
  boot.sort();
  return { delta: r4(delta), lo: r4(boot[Math.floor(o.draws * 0.025)]!), hi: r4(boot[Math.ceil(o.draws * 0.975) - 1]!), n_items: pairs.length, n_clusters: strata.reduce((n, s) => n + s.length, 0), loto: loto(pairs) };
}

export function loto(pairs: readonly PairedDiff[]): [number, number] | null {
  const threads = [...new Set(pairs.map((p) => p.thread))];
  if (threads.length < 2) return null;
  const est = threads.map((t) => {
    const rest = pairs.filter((p) => p.thread !== t);
    return rest.reduce((s, p) => s + p.d, 0) / rest.length;
  });
  return [r4(Math.min(...est)), r4(Math.max(...est))];
}

/** The planned detectable difference: 2.8 * spread / sqrt(effective clusters). */
export const mdd = (spread: number, clusters: number, factor = FROZEN.stats.mdd_factor): number => (factor * spread) / Math.sqrt(clusters);
/** A 95% interval's half-width on n items at a paired spread. */
export const halfWidth = (spread: number, n: number): number => (1.96 * spread) / Math.sqrt(n);
/** The chance a bar of at least x of n admits a true per-item rate p. */
export const admitChance = (p: number, n: number, x: number): number => 1 - binomialCdf(x - 1, n, p);

/** Per item, the 0 or 1 samples of one arm and model (MISSING samples left out). */
export type ItemSamples = number[][];

const meanOf = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface PilotCell {
  /** (b)'s sends on the needless items. */
  needless: ItemSamples;
  /** (b)'s misses on the must-ask items. */
  must: ItemSamples;
}

/** The admission rule (section 10) on the pilot's arm (b) cells. */
export function pilotAdmit(cells: Partial<Record<ModelKey, PilotCell>>): { admit: boolean; models: Record<string, { needless_sends: number; must_misses: number; admit: boolean }> } {
  const p = FROZEN.pilot;
  const models: Record<string, { needless_sends: number; must_misses: number; admit: boolean }> = {};
  for (const m of p.models) {
    const c = cells[m];
    if (!c) continue;
    const sends = c.needless.reduce((s, xs) => s + meanOf(xs), 0);
    const misses = c.must.reduce((s, xs) => s + meanOf(xs), 0);
    models[m] = { needless_sends: r4(sends), must_misses: r4(misses), admit: sends >= p.admit_min_needless_sends && misses <= p.admit_max_must_ask_misses };
  }
  return { admit: Object.values(models).some((m) => m.admit), models };
}

/** The frozen pilot spread formula (frozen.json pilot.spread_formula) and the replicate count it sets. */
export function spreadProjection(b: ItemSamples, clusters: number, kPilot = 2): { W: number; V: number; B2: number; spread_k2: number; spread_k3: number; mdd_k2: number; mdd_k3: number; k: number } {
  const multi = b.filter((xs) => xs.length >= 2);
  const W = meanOf(multi.map((xs) => xs.reduce((s, x) => s + (x - meanOf(xs)) ** 2, 0) / (xs.length - 1)));
  const means = b.filter((xs) => xs.length).map(meanOf);
  const mu = meanOf(means);
  const V = means.length > 1 ? means.reduce((s, x) => s + (x - mu) ** 2, 0) / (means.length - 1) : 0;
  const B2 = Math.max(0, V - W / kPilot);
  const spread = (k: number) => Math.sqrt(B2 + (2 * W) / k);
  const mdd_k2 = mdd(spread(2), clusters);
  return { W: r4(W), V: r4(V), B2: r4(B2), spread_k2: r4(spread(2)), spread_k3: r4(spread(3)), mdd_k2: r4(mdd_k2), mdd_k3: r4(mdd(spread(3), clusters)), k: mdd_k2 > FROZEN.pilot.k3_when_projected_mdd_above ? FROZEN.replicates.k_after_pilot_rule : FROZEN.replicates.k };
}

export interface AuditRow {
  audit: Label;
  opus: Label;
  astra: Label;
}

/** The label audit rule (section 7): each labeller's kappa against the audit labels, pooled and duplicate against must-ask alone. */
export function labelAudit(rows: readonly AuditRow[]): { stands: boolean; labellers: Record<"opus" | "astra", { pooled: number | null; duplicate: number | null }> } {
  const min = FROZEN.label_audit.kappa_min;
  const per = (who: "opus" | "astra") => {
    const pooled = kappa(rows.map((r) => [r.audit !== "DECISION", r[who] !== "DECISION"] as const));
    const dm = rows.filter((r) => r.audit === "DUPLICATE" || r.audit === "DECISION");
    const duplicate = kappa(dm.map((r) => [r.audit === "DUPLICATE", r[who] === "DUPLICATE"] as const));
    return { pooled: pooled === null ? null : r4(pooled), duplicate: duplicate === null ? null : r4(duplicate) };
  };
  const labellers = { opus: per("opus"), astra: per("astra") };
  const ok = (k: number | null) => k !== null && k >= min;
  return { stands: Object.values(labellers).every((l) => ok(l.pooled) && ok(l.duplicate)), labellers };
}
