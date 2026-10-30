import { describe, expect, test } from "bun:test";
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { marginShiftedSignFlipP } from "../../src/runner/stats/sign-flip.ts";
import { decide, pairedTests, shiftedSignFlip, signFlipTail } from "../../lanes/review-noloss/stats.ts";

describe("exact margin-shifted sign-flip", () => {
  test("equals the kit's exact enumeration up to 20 PR clusters, at every margin and pass count", () => {
    const rng = seededRandom(11);
    let compared = 0;
    for (let t = 0; t < 150; t++) {
      const k = 2 + Math.floor(rng() * 15);
      const P = 1 + Math.floor(rng() * 2);
      const Q = 1 + Math.floor(rng() * 3);
      const pairs = [];
      for (let c = 0; c < k; c++) for (let i = 0, m = 1 + Math.floor(rng() * 4); i < m; i++) pairs.push({ id: c + "-" + i, cluster: "c" + String(c).padStart(2, "0"), a: Math.floor(rng() * (P + 1)) / P, b: Math.floor(rng() * (Q + 1)) / Q });
      for (const margin of [0, 7.5, 10, 15]) {
        const kit = marginShiftedSignFlipP(pairs, margin / 100, "higher", { seed: 1, draws: 1000 });
        if (kit === null) continue;
        expect(shiftedSignFlip(pairs, margin, [P, Q]).p).toBe(kit);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  test("stays exact past the kit's 20-cluster limit, where the kit samples", () => {
    const values = Array.from({ length: 24 }, (_, i) => (i % 3) - 1 + (i === 0 ? 5 : 0));
    let at = 0;
    for (let mask = 0; mask < 2 ** 24; mask += 1) {
      let s = 0;
      for (let j = 0; j < 24; j++) s += (mask >>> j) & 1 ? -values[j]! : values[j]!;
      if (s >= values.reduce((x, y) => x + y, 0)) at++;
    }
    expect(signFlipTail(values)).toBe(at / 2 ** 24);
  }, 10_000);

  test("no discordant blocker off ceiling and floor gives p = 2^-k; a true ceiling or floor stays null", () => {
    const same = (vals: number[]) => vals.map((v, i) => ({ id: String(i), cluster: "c" + i, a: v, b: v }));
    const mixed = shiftedSignFlip(same([1, 0, 1, 1, 0, 1]), 10, [1]);
    expect(mixed.p).toBe(2 ** -6);
    expect(mixed.reason).toBe("no discordant blocker");
    expect(decide(mixed.p, null)).toBe("NO_LOSS");
    expect(shiftedSignFlip(same([1, 1, 1]), 10, [1])).toMatchObject({ p: null, reason: expect.stringContaining("ceiling") });
    expect(shiftedSignFlip(same([0, 0, 0]), 10, [1])).toMatchObject({ p: null, reason: expect.stringContaining("floor") });
    expect(decide(null, null)).toBe("NOT_DISTINGUISHED");
  });

  test("the LOSS test reports its minimum reachable p from the discordant PRs", () => {
    const pairs = [
      { id: "1", cluster: "a", a: 1, b: 0 },
      { id: "2", cluster: "b", a: 1, b: 0 },
      { id: "3", cluster: "c", a: 1, b: 0 },
      ...Array.from({ length: 11 }, (_, i) => ({ id: "x" + i, cluster: "z" + i, a: 1, b: 1 })),
    ];
    const t = pairedTests(pairs, 10, [1, 1]);
    expect(t.loss.p).toBe(0.125);
    expect(t.loss.min_p).toBe(0.125);
    expect(decide(t.no_loss.p, t.loss.p)).toBe("NOT_DISTINGUISHED");
  });

  test("refuses a margin finer than a tenth of a point and values that are not shares of the passes", () => {
    const pairs = [{ id: "1", cluster: "a", a: 1, b: 0 }, { id: "2", cluster: "b", a: 0, b: 1 }];
    expect(() => shiftedSignFlip(pairs, 7.25, [1])).toThrow(/one decimal/);
    expect(() => shiftedSignFlip([{ id: "1", cluster: "a", a: 0.5, b: 0 }, ...pairs], 10, [1])).toThrow(/share/);
  });
});
