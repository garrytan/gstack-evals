// Copyright (c) 2026 Garry Tan. MIT License.
// fixedMatching against a naive reference on 10,000 seeded random edge sets, under permuted inputs, on one fixture
// per M3 key and on PD-1's tied validator blocks, beside a first-found matcher that must fail them.
import { describe, expect, test } from "bun:test";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { fixedMatching } from "../../../lanes/design-constructed/score/match.ts";
import { cases, firstFoundMatching, pd1Keys, PD1_KEPT_AFTER_GIVE_AWAY, PD1_UNANIMOUS, permutations, TIE_BREAK_FIXTURES } from "../../../lanes/design-constructed/score/dryrun-cases.ts";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import type { Matching, MatchItem } from "../../../lanes/design-constructed/types.ts";

const less = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

/** Every function from items to (none or one of the item's own changes), kept when injective, ranked by M3 as a tuple. */
function reference(items: readonly MatchItem[]): Matching {
  const its = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const options = its.map((it) => [0, ...new Set(it.edges.map((e) => e.change))]);
  const carries = (it: MatchItem, ch: number) => it.edges.some((e) => e.change === ch && e.detail);
  let best: { tuple: number[]; pick: number[] } | null = null;
  const idx = options.map(() => 0);
  for (;;) {
    const pick = idx.map((k, i) => options[i]![k]!);
    const taken = pick.filter((p) => p !== 0);
    if (new Set(taken).size === taken.length) {
      const credited = taken.length;
      const score = pick.reduce((s, p, i) => s + (p === 0 ? 0 : !its[i]!.keyedDetail ? 2 : carries(its[i]!, p) ? 2 : 1), 0);
      const detail = pick.filter((p, i) => p !== 0 && its[i]!.keyedDetail && carries(its[i]!, p)).length;
      const tuple = [-credited, -score, -detail, ...pick.map((p) => (p === 0 ? 99 : p))];
      if (!best || less(tuple, best.tuple)) best = { tuple, pick };
    }
    let k = 0;
    while (k < idx.length && ++idx[k]! === options[k]!.length) idx[k++] = 0;
    if (k === idx.length) break;
  }
  const assigned: Record<string, number | null> = {};
  its.forEach((it, i) => (assigned[it.id] = best!.pick[i] === 0 ? null : best!.pick[i]!));
  return { assigned, credited: -best!.tuple[0]!, score: -best!.tuple[1]!, detailCredited: -best!.tuple[2]! };
}

/** A random edge set: up to 8 items and 8 changes, held to a naive search of at most 3,000 leaves. */
function randomItems(rand: () => number): MatchItem[] {
  const n = Math.floor(rand() * 9);
  const m = 1 + Math.floor(rand() * 8);
  const density = 0.1 + rand() * 0.6;
  const detailMode = rand() < 0.5;
  const items = Array.from({ length: n }, (_, i) => "i" + i).map((id) => {
    const edges: MatchItem["edges"] = [];
    for (let c = 1; c <= m; c++) if (rand() < density) edges.push({ change: c, detail: detailMode && rand() < 0.5 });
    if (rand() < 0.2 && edges.length) edges.push({ ...edges[0]! });
    return { id, keyedDetail: detailMode && rand() < 0.6, edges };
  });
  let leaves = items.reduce((p, it) => p * (new Set(it.edges.map((e) => e.change)).size + 1), 1);
  while (leaves > 3000) {
    const it = items.find((x) => x.edges.length > 1)!;
    it.edges.pop();
    leaves = items.reduce((p, x) => p * (new Set(x.edges.map((e) => e.change)).size + 1), 1);
  }
  return items;
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe("fixedMatching", () => {
  test("agrees with the naive reference on 10,000 seeded random edge sets", () => {
    const rand = seededRandom(20261114);
    let partial = 0;
    let detail = 0;
    for (let t = 0; t < 10000; t++) {
      const items = randomItems(rand);
      const got = fixedMatching(items);
      expect(got).toEqual(reference(items));
      if (got.credited > 0 && Object.values(got.assigned).includes(null)) partial++;
      if (got.score % 2 === 1) detail++;
    }
    expect(partial).toBeGreaterThan(1000);
    expect(detail).toBeGreaterThan(500);
  }, 60_000);

  test("gives the same output when changes, items and edges arrive in any order", () => {
    const rand = seededRandom(7);
    for (let t = 0; t < 2000; t++) {
      const items = randomItems(rand);
      const want = fixedMatching(items);
      for (let k = 0; k < 5; k++) {
        const permuted = shuffle(items, rand).map((it) => ({ ...it, edges: shuffle(it.edges, rand).concat(rand() < 0.3 ? it.edges.slice(0, 1) : []) }));
        expect(fixedMatching(permuted)).toEqual(want);
      }
    }
  });

  test("an empty key, and items with no edges, credit nothing", () => {
    expect(fixedMatching([])).toEqual({ assigned: {}, credited: 0, score: 0, detailCredited: 0 });
    expect(fixedMatching([{ id: "i1", keyedDetail: true, edges: [] }])).toEqual({ assigned: { i1: null }, credited: 0, score: 0, detailCredited: 0 });
  });

  test("8 items on 8 changes with every edge present runs exactly", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: "i" + i, keyedDetail: i % 2 === 0, edges: Array.from({ length: 8 }, (_, c) => ({ change: c + 1, detail: c === i })) }));
    expect(fixedMatching(items)).toEqual({ assigned: { i0: 1, i1: 2, i2: 3, i3: 4, i4: 5, i5: 6, i6: 7, i7: 8 }, credited: 8, score: 16, detailCredited: 4 });
  });

  test("refuses more than 8 items, a change outside 1 to 8 and repeated ids", () => {
    const item = (id: string, change = 1) => ({ id, keyedDetail: false, edges: [{ change, detail: false }] });
    expect(() => fixedMatching(Array.from({ length: 9 }, (_, i) => item("i" + i)))).toThrow(DcError);
    expect(() => fixedMatching([item("i1", 0)])).toThrow(DcError);
    expect(() => fixedMatching([item("i1", 9)])).toThrow(DcError);
    expect(() => fixedMatching([item("i1", 1.5)])).toThrow(DcError);
    expect(() => fixedMatching([item("i1"), item("i1")])).toThrow(DcError);
  });
});

describe("M3's tie-break keys, each deciding on its own fixture", () => {
  for (const f of TIE_BREAK_FIXTURES) {
    test("key " + f.key + ": " + f.name, () => {
      for (const p of permutations(f.items)) expect(fixedMatching(p)).toEqual(f.expect);
      expect(reference(f.items)).toEqual(f.expect);
    });
  }
  test("keys 2 and 3 overrule the index vector that key 4 alone would pick", () => {
    const byVector = (items: MatchItem[]) => {
      const m = fixedMatching(items.map((it) => ({ ...it, keyedDetail: false })));
      return m.assigned;
    };
    for (const f of TIE_BREAK_FIXTURES.filter((x) => x.key === 2 || x.key === 3)) expect(byVector(f.items)).not.toEqual(f.expect.assigned);
  });
});

describe("PD-1: tied validator blocks give one fixed key", () => {
  test("the unanimous check keeps the same items under every order of blocks, items and edges", () => {
    expect([...pd1Keys(fixedMatching).unanimous]).toEqual([JSON.stringify(PD1_UNANIMOUS)]);
  });
  test("the give-away check drops the same item under every order", () => {
    expect([...pd1Keys(fixedMatching).giveAway]).toEqual([JSON.stringify(PD1_KEPT_AFTER_GIVE_AWAY)]);
  });
  test("a matcher that keeps the first maximum matching it finds gives different keys, so it fails", () => {
    const k = pd1Keys(firstFoundMatching);
    expect(k.unanimous.size).toBeGreaterThan(1);
    expect(k.giveAway.size).toBeGreaterThan(1);
  });
  test("the score area's dry-run cases all pass", async () => {
    for (const c of cases()) expect(await c.check()).toBeNull();
  });
});
