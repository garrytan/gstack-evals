// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's dry-run cases: fixedMatching on one fixture per M3 tie-break key and on PD-1's tied validator
// blocks, each with its inputs permuted, beside a first-found matcher that must fail the same checks.
import { fixedMatching } from "./match.ts";
import type { DryRunCase, Matching, MatchItem } from "../types.ts";

const e = (change: number, detail = false) => ({ change, detail });

/** One fixture per M3 key: the earlier keys tie (or key 1 decides), and the named key picks the named matching. */
export const TIE_BREAK_FIXTURES: { key: 1 | 2 | 3 | 4; name: string; items: MatchItem[]; expect: Matching }[] = [
  {
    key: 1,
    name: "more items credited beats a lower index vector",
    items: [
      { id: "i1", keyedDetail: false, edges: [e(1), e(2)] },
      { id: "i2", keyedDetail: false, edges: [e(1)] },
    ],
    expect: { assigned: { i1: 2, i2: 1 }, credited: 2, score: 4, detailCredited: 0 },
  },
  {
    key: 2,
    name: "with credit tied, the higher score wins over a lower index vector",
    items: [
      { id: "i1", keyedDetail: true, edges: [e(1), e(2, true)] },
      { id: "i2", keyedDetail: false, edges: [e(1), e(2)] },
    ],
    expect: { assigned: { i1: 2, i2: 1 }, credited: 2, score: 4, detailCredited: 1 },
  },
  {
    key: 3,
    name: "with credit and score tied, more details carried wins over a lower index vector",
    items: [
      { id: "i1", keyedDetail: false, edges: [e(1)] },
      { id: "i2", keyedDetail: true, edges: [e(1, true)] },
      { id: "i3", keyedDetail: true, edges: [e(2)] },
    ],
    expect: { assigned: { i1: null, i2: 1, i3: 2 }, credited: 2, score: 3, detailCredited: 1 },
  },
  {
    key: 4,
    name: "with keys 1 to 3 tied, the lowest change indices in key order win",
    items: [
      { id: "i1", keyedDetail: false, edges: [e(1), e(2)] },
      { id: "i2", keyedDetail: false, edges: [e(1), e(2)] },
    ],
    expect: { assigned: { i1: 1, i2: 2 }, credited: 2, score: 4, detailCredited: 0 },
  },
];

/** PD-1: three validator blocks in which one change matches two items, so tied matchings retain different items. */
export const PD1_BLOCKS: MatchItem[][] = [
  [
    { id: "i1", keyedDetail: false, edges: [e(3)] },
    { id: "i2", keyedDetail: false, edges: [e(3)] },
    { id: "i3", keyedDetail: false, edges: [e(5)] },
  ],
  [
    { id: "i1", keyedDetail: false, edges: [e(1)] },
    { id: "i2", keyedDetail: false, edges: [e(1), e(4)] },
    { id: "i3", keyedDetail: false, edges: [e(2)] },
  ],
  [
    { id: "i1", keyedDetail: false, edges: [e(6)] },
    { id: "i2", keyedDetail: false, edges: [e(6)] },
    { id: "i3", keyedDetail: false, edges: [e(7)] },
  ],
];
/** Credited in all three blocks under the fixed matching: i2 loses the shared change to i1 in blocks 1 and 3. */
export const PD1_UNANIMOUS = ["i1", "i3"];

/** PD-1 for the give-away check: one change in one block matches two items that survived step 5. */
export const PD1_GIVE_AWAY: MatchItem[][] = [
  [
    { id: "i1", keyedDetail: false, edges: [e(2)] },
    { id: "i2", keyedDetail: false, edges: [e(2)] },
  ],
  [
    { id: "i1", keyedDetail: false, edges: [] },
    { id: "i2", keyedDetail: false, edges: [] },
  ],
  [
    { id: "i1", keyedDetail: false, edges: [] },
    { id: "i2", keyedDetail: false, edges: [] },
  ],
];
/** The fixed matching credits i1 in the first block, so i1 is given away and i2 stays. */
export const PD1_KEPT_AFTER_GIVE_AWAY = ["i2"];

type Matcher = (items: readonly MatchItem[]) => Matching;

/** A matcher that keeps the first maximum matching it finds, by augmenting paths in input order. PD-1 says it must fail. */
export const firstFoundMatching: Matcher = (items) => {
  const owner = new Map<number, number>();
  const tryItem = (i: number, seen: Set<number>): boolean => {
    for (const { change } of items[i]!.edges) {
      if (seen.has(change)) continue;
      seen.add(change);
      const o = owner.get(change);
      if (o === undefined || tryItem(o, seen)) {
        owner.set(change, i);
        return true;
      }
    }
    return false;
  };
  items.forEach((_, i) => tryItem(i, new Set()));
  const assigned: Record<string, number | null> = {};
  items.forEach((item) => (assigned[item.id] = null));
  for (const [change, i] of owner) assigned[items[i]!.id] = change;
  const credited = owner.size;
  return { assigned, credited, score: 2 * credited, detailCredited: 0 };
};

/** Every order of the items, each also with every item's edges reversed and its first edge repeated. */
export function permutations(items: readonly MatchItem[]): MatchItem[][] {
  const orders: MatchItem[][] = [];
  const walk = (left: MatchItem[], acc: MatchItem[]) => {
    if (left.length === 0) return void orders.push(acc);
    left.forEach((x, i) => walk([...left.slice(0, i), ...left.slice(i + 1)], [...acc, x]));
  };
  walk([...items], []);
  return orders.flatMap((o) => [o, o.map((it) => ({ ...it, edges: [...it.edges].reverse().concat(it.edges.slice(0, 1)) }))]);
}

const credited = (m: Matching) => Object.keys(m.assigned).filter((id) => m.assigned[id] !== null);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Unanimous: credited in every block. Each block arrives in its own order, as permuted input would. */
export const unanimous = (blocks: MatchItem[][], match: Matcher) => blocks.map((b) => new Set(credited(match(b)))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
/** Kept after give-away: credited in no block. */
export const notGivenAway = (ids: string[], blocks: MatchItem[][], match: Matcher) => {
  const hit = new Set(blocks.flatMap((b) => credited(match(b))));
  return ids.filter((id) => !hit.has(id));
};

/** The key each order of the blocks and of their items gives; a fixed rule gives one key across all of them. */
function keysUnder(match: Matcher, read: (blocks: MatchItem[][]) => string[], blocks: MatchItem[][]): Set<string> {
  const keys = new Set<string>();
  const perms = blocks.map(permutations);
  const blockOrders = [[0, 1, 2], [2, 1, 0], [1, 0, 2]];
  for (let k = 0; k < perms[0]!.length; k++) {
    for (const order of blockOrders) {
      const permuted = order.map((b, j) => perms[b]![(k + j) % perms[b]!.length]!);
      keys.add(JSON.stringify(read(permuted).sort()));
    }
  }
  return keys;
}

export const pd1Keys = (match: Matcher) => ({
  unanimous: keysUnder(match, (b) => [...unanimous(b, match)], PD1_BLOCKS),
  giveAway: keysUnder(match, (b) => notGivenAway(["i1", "i2"], b, match), PD1_GIVE_AWAY),
});

export function cases(): DryRunCase[] {
  const out: DryRunCase[] = TIE_BREAK_FIXTURES.map((f) => ({
    rule: "M3",
    name: "key " + f.key + ": " + f.name,
    check: () => {
      for (const p of permutations(f.items)) {
        const got = fixedMatching(p);
        if (!same(got, f.expect)) return "expected " + JSON.stringify(f.expect) + ", got " + JSON.stringify(got);
      }
      return null;
    },
  }));
  out.push(
    {
      rule: "PD-1",
      name: "unanimous key from tied validator blocks is one fixed key under every input order",
      check: () => {
        const keys = pd1Keys(fixedMatching).unanimous;
        return same([...keys], [JSON.stringify(PD1_UNANIMOUS)]) ? null : "keys " + [...keys].join(" | ");
      },
    },
    {
      rule: "PD-1",
      name: "give-away check on a tied block keeps one fixed key under every input order",
      check: () => {
        const keys = pd1Keys(fixedMatching).giveAway;
        return same([...keys], [JSON.stringify(PD1_KEPT_AFTER_GIVE_AWAY)]) ? null : "keys " + [...keys].join(" | ");
      },
    },
    {
      rule: "PD-1",
      name: "a matcher that keeps the first maximum matching it finds fails both checks",
      check: () => {
        const k = pd1Keys(firstFoundMatching);
        return k.unanimous.size > 1 && k.giveAway.size > 1 ? null : "the first-found matcher gave one key: unanimous " + k.unanimous.size + ", give-away " + k.giveAway.size;
      },
    },
  );
  return out;
}
