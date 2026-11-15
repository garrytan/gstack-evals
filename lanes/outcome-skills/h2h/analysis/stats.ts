// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 9's tests. The verdict test is McNemar's with the clustered variance of Obuchowski (1998), clusters being
// repositories: z is the paired difference over its cluster-robust standard error, two-sided. Exact McNemar sits beside
// it. Every interval is the 95% percentile interval of a repository-clustered bootstrap (10,000 resamples on
// bootstrap_seed, a fresh stream for each contrast). Piece G's lines ratio is the mean paired log-ratio with the same
// bootstrap and a bootstrap p.
import { clusteredPairedDelta, exactMcNemar, seededRandom } from "../../../../src/runner/stats/paired.ts";
import { phi } from "../../../../src/runner/stats/outcome-decision.ts";

export const DRAWS = 10_000;
export interface Pair { unit: string; repo: string; a: 0 | 1; b: 0 | 1 }

/** The Wilson score interval at 95% (lanes/autoplan-audit/stats.ts). */
export function wilson(k: number, n: number, z = 1.959964): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

/** numpy.percentile's default (linear) reading of q in [0, 100]; null on no values. */
export function percentile(xs: readonly number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const at = ((s.length - 1) * q) / 100, lo = Math.floor(at), hi = Math.ceil(at);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}
export const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);

/** Obuchowski's clustered McNemar: z = delta / se_cluster, p two-sided. Fewer than 2 clusters gives p = 1; a zero
 *  variance gives p = 1 with no difference and p = 0 with one. */
export function clusteredMcNemar(delta: number, se: number | null, clusters: number): { z: number | null; p: number } {
  if (clusters < 2 || se === null) return { z: null, p: 1 };
  if (se === 0) return { z: null, p: delta === 0 ? 1 : 0 };
  const z = delta / se;
  return { z, p: Math.min(1, 2 * (1 - phi(Math.abs(z)))) };
}

export interface PairedTest {
  n: number; n_repos: number; a_rate: number | null; b_rate: number | null;
  /** b minus a. */
  delta: number | null;
  /** Units only b fixed, units only a fixed. */
  b_only: number; a_only: number; discordant_share: number | null;
  se_cluster: number | null; z: number | null; p: number; p_exact: number; ci95: [number, number] | null;
}

/** Section 9's paired test on binary outcomes: the clustered McNemar p, exact McNemar and the clustered bootstrap
 *  interval of b minus a. */
export function pairedTest(pairs: readonly Pair[], seed: number, draws = DRAWS): PairedTest {
  const ex = exactMcNemar(pairs.map((p) => ({ id: p.unit, cluster: p.repo, a: p.a, b: p.b })));
  if (!pairs.length) return { n: 0, n_repos: 0, a_rate: null, b_rate: null, delta: null, b_only: 0, a_only: 0, discordant_share: null, se_cluster: null, z: null, p: 1, p_exact: 1, ci95: null };
  const d = clusteredPairedDelta(pairs.map((p) => ({ id: p.unit, cluster: p.repo, a: p.a, b: p.b })), { seed, draws });
  const t = clusteredMcNemar(d.delta, d.se_cluster, d.n_clusters);
  return {
    n: d.n_pairs, n_repos: d.n_clusters, a_rate: d.mean_a, b_rate: d.mean_b, delta: d.delta, b_only: ex.wins, a_only: ex.losses, discordant_share: ex.discordant / pairs.length,
    se_cluster: d.se_cluster, z: t.z, p: t.p, p_exact: ex.p_two_sided, ci95: d.ci95,
  };
}

export interface LogRatio {
  /** Units both arms fixed, those left out because either arm changed no counted line, and those used. */
  both_fixed: number; zero_excluded: number; n: number; n_repos: number;
  mean_log: number | null; sd_log: number | null; ratio: number | null; ci95: [number, number] | null; p: number;
}

/** Piece G (1): the paired log-ratio of lines changed, y over x, on units both arms fixed, with its clustered bootstrap
 *  interval (as a ratio) and bootstrap p (twice the smaller share of resampled means at or beyond 0). */
export function logRatio(units: readonly { repo: string; x: number; y: number }[], seed: number, draws = DRAWS): LogRatio {
  const used = units.filter((u) => u.x > 0 && u.y > 0);
  const logs = used.map((u) => Math.log(u.y / u.x));
  const m = mean(logs);
  const sd = logs.length > 1 ? Math.sqrt(logs.reduce((a, l) => a + (l - m!) ** 2, 0) / (logs.length - 1)) : null;
  const by = new Map<string, { sum: number; count: number }>();
  used.forEach((u, k) => {
    const c = by.get(u.repo) ?? { sum: 0, count: 0 };
    c.sum += logs[k]!;
    c.count++;
    by.set(u.repo, c);
  });
  const clusters = [...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
  const out: LogRatio = { both_fixed: units.length, zero_excluded: units.length - used.length, n: used.length, n_repos: clusters.length, mean_log: m, sd_log: sd, ratio: m === null ? null : Math.exp(m), ci95: null, p: 1 };
  if (clusters.length < 2) return out;
  const rng = seededRandom(seed);
  const boot = new Array<number>(draws);
  for (let i = 0; i < draws; i++) {
    let sum = 0, count = 0;
    for (let j = 0; j < clusters.length; j++) {
      const c = clusters[Math.floor(rng() * clusters.length)]!;
      sum += c.sum;
      count += c.count;
    }
    boot[i] = sum / count;
  }
  const lo = boot.filter((x) => x <= 0).length / draws, hi = boot.filter((x) => x >= 0).length / draws;
  boot.sort((a, b) => a - b);
  return { ...out, ci95: [Math.exp(boot[Math.floor(draws * 0.025)]!), Math.exp(boot[Math.ceil(draws * 0.975) - 1]!)], p: Math.min(1, 2 * Math.min(lo, hi)) };
}
