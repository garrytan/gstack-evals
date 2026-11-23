// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6's seeded draws, all from SEED, committed before any panel call. Gold: 40 HIT units; 40 ablated negatives
// (the built texts of later HIT draws with every paragraph of overlap 0.20 or more removed, a unit left with no such
// paragraph replaced by the next draw); 16 natural MISS units, the shortfall filled alternately from hits and ablations.
// One top-up of 24 per short class continues the same streams. The full-kind production sample of 40 is its own stream
// from the same seed, so a top-up never moves it. An exhausted stream gives fewer items; no call is sent for the rest.
import { seededRandom, shuffle } from "./stats.ts";

export const SEED = 20261110;
export const GOLD_HITS = 40, GOLD_ABLATED = 40, GOLD_MISSES = 16, TOP_UP = 24, FULL_SAMPLE = 40;
export const SUPPLY_HITS = 80, SUPPLY_ABLATABLE = 40;

export interface Candidate {
  id: string;
  hit: boolean;
  ablatable: boolean;
}

export interface GoldDraw {
  hits: string[];
  ablated: string[];
  misses: string[];
  /** Positions already used in each stream, so a top-up continues them. */
  hitOrder: string[];
  missOrder: string[];
  used: string[];
  fill: { hits: number; ablated: number };
}

export function supply(c: readonly Candidate[]): { hits: number; ablatable: number; ok: boolean } {
  const hits = c.filter((x) => x.hit).length;
  const ablatable = c.filter((x) => x.hit && x.ablatable).length;
  return { hits, ablatable, ok: hits >= SUPPLY_HITS && ablatable >= SUPPLY_ABLATABLE };
}

const byId = (a: Candidate, b: Candidate) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function nextFrom(order: readonly string[], used: Set<string>, ok: (id: string) => boolean): string | null {
  for (const id of order) if (!used.has(id) && ok(id)) return id;
  return null;
}

export function drawGold(c: readonly Candidate[], seed = SEED): GoldDraw {
  const rng = seededRandom(seed);
  const hitOrder = shuffle([...c].filter((x) => x.hit).sort(byId), rng).map((x) => x.id);
  const missOrder = shuffle([...c].filter((x) => !x.hit).sort(byId), rng).map((x) => x.id);
  const ablatable = new Set(c.filter((x) => x.ablatable).map((x) => x.id));
  const used = new Set<string>();
  const take = (order: readonly string[], n: number, ok: (id: string) => boolean) => {
    const out: string[] = [];
    while (out.length < n) {
      const id = nextFrom(order, used, ok);
      if (id === null) break;
      used.add(id);
      out.push(id);
    }
    return out;
  };
  const hits = take(hitOrder, GOLD_HITS, () => true);
  const ablated = take(hitOrder, GOLD_ABLATED, (id) => ablatable.has(id));
  const misses = take(missOrder, GOLD_MISSES, () => true);
  const fill = { hits: 0, ablated: 0 };
  for (let k = 0; misses.length + fill.hits + fill.ablated < GOLD_MISSES; k++) {
    const wantHit = (fill.hits + fill.ablated) % 2 === 0;
    const got = wantHit ? take(hitOrder, 1, () => true) : take(hitOrder, 1, (id) => ablatable.has(id));
    const other = got.length ? [] : wantHit ? take(hitOrder, 1, (id) => ablatable.has(id)) : take(hitOrder, 1, () => true);
    if (!got.length && !other.length) break;
    if ((wantHit && got.length) || (!wantHit && other.length)) {
      hits.push(...got, ...other);
      fill.hits++;
    } else {
      ablated.push(...got, ...other);
      fill.ablated++;
    }
  }
  return { hits, ablated, misses, hitOrder, missOrder, used: [...used], fill };
}

/** One top-up of TOP_UP items of a short class's kind: hits for LANDED, ablations for NOT_LANDED. */
export function topUp(d: GoldDraw, c: readonly Candidate[], kind: "hit" | "ablated"): string[] {
  const ablatable = new Set(c.filter((x) => x.ablatable).map((x) => x.id));
  const used = new Set(d.used);
  const out: string[] = [];
  while (out.length < TOP_UP) {
    const id = nextFrom(d.hitOrder, used, (x) => kind === "hit" || ablatable.has(x));
    if (id === null) break;
    used.add(id);
    out.push(id);
  }
  d.used = [...used];
  return out;
}

export function drawFullSample(ids: readonly string[], seed = SEED): string[] {
  return shuffle([...ids].sort(), seededRandom(seed + 1)).slice(0, FULL_SAMPLE);
}
