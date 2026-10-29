// gstack-evals (U2): the margin-shifted exact sign-flip test for non-inferiority over task clusters.
//
// The Captain's decision (GSTA-2, 2026-10-28): Lane A's --margin uses this test, because on few tasks the bootstrap
// lower bound that nonInferiorityP reads falsely passes more often than the plan's 5%. Parity at 30 tasks and up
// keeps decision 9's bootstrap bound in v1.1. tests/stats/sign-flip.test.ts reproduces the measured rates.
import { seededRandom, type PairedItem } from './paired.ts';

const EXACT_CLUSTER_LIMIT = 20;

/**
 * One-sided p-value that B is no worse than A by more than `margin` (metric units), oriented so a larger value is
 * better. Each cluster's oriented difference sum is shifted by the margin once per item, and the shifted sums' signs
 * are flipped: every pattern up to 20 clusters, `draws` seeded patterns above. Null when every paired difference
 * is zero, since a ceiling or a floor shows nothing, or when there are fewer than 2 clusters.
 */
export function marginShiftedSignFlipP(pairs: readonly PairedItem[], margin: number, direction: 'higher' | 'lower', options: { seed: number; draws: number }): number | null {
  if (!Number.isFinite(margin) || margin < 0) throw new Error('non-inferiority margin must be a finite number >= 0');
  if (!Number.isSafeInteger(options.draws) || options.draws < 1000) throw new Error('the sign-flip test needs at least 1000 draws');
  if (!pairs.every((p) => Number.isFinite(p.a) && Number.isFinite(p.b) && typeof p.cluster === 'string' && p.cluster)) throw new Error('invalid paired observations');
  const sign = direction === 'higher' ? 1 : -1;
  const byCluster = new Map<string, number>();
  for (const p of pairs) byCluster.set(p.cluster, (byCluster.get(p.cluster) ?? 0) + sign * (p.b - p.a) + margin);
  const shifted = [...byCluster.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, v]) => v);
  if (shifted.length < 2 || pairs.every((p) => p.b === p.a)) return null;
  const observed = shifted.reduce((s, v) => s + v, 0);
  const exact = shifted.length <= EXACT_CLUSTER_LIMIT;
  const patterns = exact ? 2 ** shifted.length : options.draws;
  const rng = seededRandom(options.seed);
  let atLeast = 0;
  for (let i = 0; i < patterns; i++) {
    let sum = 0;
    for (let j = 0; j < shifted.length; j++) sum += (exact ? ((i >>> j) & 1) === 1 : rng() < 0.5) ? -shifted[j]! : shifted[j]!;
    if (sum >= observed - 1e-12) atLeast++;
  }
  return exact ? atLeast / patterns : (atLeast + 1) / (patterns + 1);
}
