// Copyright (c) 2026 Garry Tan. MIT License.
// A seeded cluster bootstrap for ratios of summed values (bill and time ratios, prereg section 11). paired.ts's
// clusteredPairedDelta bootstraps a mean difference and outcome-cost.ts's resampler is task-level and computes cost per
// solved task, so neither fits; this one resamples whole repository clusters with paired.ts's seededRandom, in the same
// sorted cluster order and percentile convention as clusteredPairedDelta.
import { seededRandom } from "../../../src/runner/stats/paired.ts";

export interface RatioPair { cluster: string; a: number; b: number }
export interface ClusterRatio { ratio: number; ci95: [number, number] | null; n_pairs: number; n_clusters: number }

const ratioOf = (b: number, a: number) => (a === 0 ? (b === 0 ? 1 : Infinity) : b / a);

/** sum(b) / sum(a) with a 95% percentile interval from resampling whole clusters; null interval below two clusters. */
export function clusterRatio(pairs: readonly RatioPair[], options: { seed: number; draws: number }): ClusterRatio {
  if (!pairs.length) throw new Error("clusterRatio needs at least one pair");
  if (!Number.isSafeInteger(options.draws) || options.draws < 1000) throw new Error("clusterRatio needs at least 1000 draws");
  if (!pairs.every((p) => Number.isFinite(p.a) && Number.isFinite(p.b) && p.a >= 0 && p.b >= 0 && p.cluster)) throw new Error("clusterRatio needs finite non-negative values and a cluster on every pair");
  const by = new Map<string, { a: number; b: number }>();
  for (const p of pairs) { const c = by.get(p.cluster) ?? { a: 0, b: 0 }; c.a += p.a; c.b += p.b; by.set(p.cluster, c); }
  const clusters = [...by.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, c]) => c);
  const g = clusters.length;
  const ratio = ratioOf(clusters.reduce((s, c) => s + c.b, 0), clusters.reduce((s, c) => s + c.a, 0));
  if (g < 2) return { ratio, ci95: null, n_pairs: pairs.length, n_clusters: g };
  const rng = seededRandom(options.seed);
  const boot = new Array<number>(options.draws);
  for (let i = 0; i < options.draws; i++) {
    let a = 0, b = 0;
    for (let j = 0; j < g; j++) { const c = clusters[Math.floor(rng() * g)]!; a += c.a; b += c.b; }
    boot[i] = ratioOf(b, a);
  }
  boot.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return { ratio, ci95: [boot[Math.floor(options.draws * 0.025)]!, boot[Math.ceil(options.draws * 0.975) - 1]!], n_pairs: pairs.length, n_clusters: g };
}
