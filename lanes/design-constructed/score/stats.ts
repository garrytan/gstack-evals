// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's small statistics: four-decimal rounding, seeded shuffles, random ids, the same-base-app derangement and Cohen's kappa.
// Copied from lanes/aftermath/stats.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94: maxMatching is not copied (every
// credit is fixedMatching's, build plan Big decision 2), kappa takes cell weights for the judge check's anchor rule, and
// seedOf reduces a string to a seed the PD-12 way (the first 8 hex digits of its sha256, read as an unsigned 32-bit integer).
import { createHash } from "node:crypto";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { ROUND_DECIMALS, SEED } from "../frozen.ts";

export { seededRandom };

/** M12: every statistic is rounded to four decimal places before it meets its threshold. */
export const r4 = (x: number): number => Math.round(x * 10 ** ROUND_DECIMALS) / 10 ** ROUND_DECIMALS;
export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** A seed from a string: the first 8 hex digits of its sha256 as an unsigned 32-bit integer (R2-21's reduction). */
export const seedOf = (text: string): number => parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16) >>> 0;
/** A generator seeded by the frozen seed, a newline and a purpose, so each use draws its own stream. */
export const rngFor = (purpose: string): (() => number) => seededRandom(seedOf(SEED + "\n" + purpose));

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A seeded random id of six letters and digits, unique within taken. */
export function randomId(rng: () => number, taken: Set<string>): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(rng() * 32)];
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/**
 * A seeded derangement that keeps each id inside its group where it can: each group of two or more is one random cycle
 * (Sattolo's shape), the singletons form one cycle together, and a lone singleton joins a random cycle. Null for fewer
 * than two ids. Returns id -> the id whose key it takes. No id maps to itself.
 */
export function derangeByGroup(ids: readonly string[], group: (id: string) => string, rng: () => number): Map<string, string> | null {
  if (ids.length < 2) return null;
  const groups = new Map<string, string[]>();
  for (const id of [...ids].sort()) groups.set(group(id), [...(groups.get(group(id)) ?? []), id]);
  const out = new Map<string, string>();
  const cycle = (members: string[]) => {
    const order = shuffle(members, rng);
    order.forEach((id, i) => out.set(id, order[(i + 1) % order.length]!));
  };
  const singles: string[] = [];
  for (const [, members] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (members.length >= 2) cycle(members);
    else singles.push(members[0]!);
  }
  if (singles.length >= 2) cycle(singles);
  else if (singles.length === 1) {
    const lone = singles[0]!;
    const hosts = [...out.keys()].sort();
    const host = hosts[Math.floor(rng() * hosts.length)]!;
    out.set(lone, out.get(host)!);
    out.set(host, lone);
  }
  return out;
}

/** One rated cell: the gold label, the judge's label and the cell's weight. */
export interface Rated {
  gold: boolean;
  judged: boolean;
  weight: number;
}

/** Cohen's kappa for two binary raters over weighted cells; null when there is no weight or chance agreement is 1. */
export function kappa(cells: readonly Rated[]): number | null {
  const w = cells.reduce((s, c) => s + c.weight, 0);
  if (!(w > 0)) return null;
  const share = (f: (c: Rated) => boolean) => cells.filter(f).reduce((s, c) => s + c.weight, 0) / w;
  const agree = share((c) => c.gold === c.judged);
  const pa = share((c) => c.gold);
  const pb = share((c) => c.judged);
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe >= 1 ? null : (agree - pe) / (1 - pe);
}
