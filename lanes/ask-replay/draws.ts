// Copyright (c) 2026 Garry Tan. MIT License.
// The two seeded draws from the real items (plan sections 7 and 10): the admission pilot's 40 items (16 must-ask
// and 24 needless, stratified by class and thread) and the label audit's 99 (40 must-ask, 40 duplicates and every
// permission and observable item). Each seed is minted from random bytes at the draw and recorded in custody; the
// same seed on the same items draws the same set.
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { FROZEN } from "./frozen.ts";
import { isNeedless } from "./score.ts";
import { LABELS, type AskItem } from "./types.ts";

export const mintSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!;

const byId = (items: readonly AskItem[]) => [...items].sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));

function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** n items from pool, spread over its (class, thread) strata in proportion to their sizes (largest remainder, random tie order), random within each stratum. */
function stratified(pool: readonly AskItem[], n: number, rng: () => number): AskItem[] {
  const strata = new Map<string, AskItem[]>();
  for (const it of pool) {
    const k = it.label + "|" + it.thread;
    const s = strata.get(k);
    if (s) s.push(it);
    else strata.set(k, [it]);
  }
  const keys = [...strata.keys()].sort();
  const take = Math.min(n, pool.length);
  const quota = keys.map((k) => (strata.get(k)!.length * take) / Math.max(1, pool.length));
  const alloc = quota.map(Math.floor);
  const tie = keys.map(() => rng());
  let left = take - alloc.reduce((s, x) => s + x, 0);
  for (const i of keys.map((_, i) => i).sort((a, b) => quota[b]! - alloc[b]! - (quota[a]! - alloc[a]!) || tie[a]! - tie[b]!)) {
    if (left <= 0) break;
    alloc[i]!++;
    left--;
  }
  return keys.flatMap((k, i) => shuffled(strata.get(k)!, rng).slice(0, alloc[i]));
}

/** The admission pilot's items: 16 must-ask and 24 needless, each stratified by class and thread. */
export function pilotDraw(items: readonly AskItem[], seed: number): AskItem[] {
  const rng = seededRandom(seed);
  const all = byId(items);
  return byId([...stratified(all.filter((i) => i.label === "DECISION"), FROZEN.pilot.must_ask, rng), ...stratified(all.filter((i) => isNeedless(i.label)), FROZEN.pilot.needless, rng)]);
}

/** The label audit's items: 40 must-ask and 40 duplicates at random within class, plus every permission and observable item. */
export function auditDraw(items: readonly AskItem[], seed: number): AskItem[] {
  const rng = seededRandom(seed);
  const all = byId(items);
  const a = FROZEN.label_audit;
  return byId([...shuffled(all.filter((i) => i.label === "DECISION"), rng).slice(0, a.must_ask), ...shuffled(all.filter((i) => i.label === "DUPLICATE"), rng).slice(0, a.duplicates), ...all.filter((i) => i.label === "PERMISSION_FOR_DEFAULT" || i.label === "OBSERVABLE")]);
}

/** Counts for a drawn set: per class and per thread, never ids or text. */
export function drawCounts(drawn: readonly AskItem[]) {
  const per_thread: Record<string, number> = {};
  for (const it of drawn) per_thread[it.thread] = (per_thread[it.thread] ?? 0) + 1;
  return { items: drawn.length, per_class: Object.fromEntries(LABELS.map((l) => [l, drawn.filter((i) => i.label === l).length])), per_thread };
}
