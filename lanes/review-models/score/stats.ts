// Copyright (c) 2026 Garry Tan. MIT License.
// The review-models eval's one standard error (prereg section 8, change 1 item 4): a unit-level value's mean and its
// clustered bootstrap standard error, clusters by PR for P units and by repository for B units, 10,000 draws from seed
// 20261124. A draw resamples whole clusters with replacement and takes the mean over the units they carry; the standard
// error is the draws' standard deviation, and the printed 95% interval is the mean plus or minus 1.96 of it. Every
// contrast and metric drawn on the same units resamples the same clusters, since the draws follow the sorted cluster ids.
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { BOOTSTRAP, rmFail, Z } from "./frozen.ts";

export interface UnitValue {
  unit: string;
  cluster: string;
  value: number;
}

export interface MeanSe {
  n_units: number;
  n_clusters: number;
  mean: number;
  /** Null with fewer than two clusters. */
  se: number | null;
  /** mean plus or minus 1.96 se. */
  interval: [number, number] | null;
}

export function clusteredMeanSe(values: readonly UnitValue[], o: { seed: number; draws: number } = BOOTSTRAP): MeanSe {
  if (!values.length) return rmFail("E_RM_SCORE_INPUT", "a mean needs at least one unit");
  if (!values.every((v) => Number.isFinite(v.value) && v.cluster)) rmFail("E_RM_SCORE_INPUT", "every unit value needs a finite value and a cluster");
  const byCluster = new Map<string, { sum: number; count: number }>();
  for (const v of values) {
    const c = byCluster.get(v.cluster) ?? { sum: 0, count: 0 };
    c.sum += v.value;
    c.count++;
    byCluster.set(v.cluster, c);
  }
  const clusters = [...byCluster.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, c]) => c);
  const g = clusters.length;
  const mean = values.reduce((s, v) => s + v.value, 0) / values.length;
  if (g < 2) return { n_units: values.length, n_clusters: g, mean, se: null, interval: null };
  const rng = seededRandom(o.seed);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < o.draws; i++) {
    let sum = 0, count = 0;
    for (let j = 0; j < g; j++) {
      const c = clusters[Math.floor(rng() * g)]!;
      sum += c.sum;
      count += c.count;
    }
    const m = sum / count;
    s1 += m;
    s2 += m * m;
  }
  const se = Math.sqrt(Math.max(0, (s2 - (s1 * s1) / o.draws) / (o.draws - 1)));
  return { n_units: values.length, n_clusters: g, mean, se, interval: [mean - Z.interval * se, mean + Z.interval * se] };
}
