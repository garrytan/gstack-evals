import { describe, expect, test } from "bun:test";
import { admitChance, clopperPearson, halfWidth, kappa, labelAudit, loto, mdd, pairedInterval, pilotAdmit, spreadProjection } from "../../lanes/ask-replay/stats.ts";

const pairs = (spec: Array<[string, string, number]>) => spec.map(([thread, cluster, d], i) => ({ item: "i" + i, thread, cluster, d }));

describe("statistics (sections 9 and 10)", () => {
  test("the chain bootstrap is seeded, resamples clusters within thread, and returns the mean difference", () => {
    const p = pairs([["T1", "c1", -1], ["T1", "c1", -1], ["T1", "c2", 0], ["T2", "c3", -1], ["T2", "c4", 0], ["T3", "c5", -1]]);
    const a = pairedInterval(p, { seed: 5, draws: 10_000 });
    expect(a).toEqual(pairedInterval(p, { seed: 5, draws: 10_000 }));
    expect(a.delta).toBeCloseTo(-4 / 6, 4);
    expect(a.n_clusters).toBe(5);
    expect(a.lo).toBeLessThanOrEqual(a.delta);
    expect(a.hi).toBeGreaterThanOrEqual(a.delta);
    expect(pairedInterval(pairs([["T1", "a", 0.5], ["T2", "b", 0.5]]), { seed: 1, draws: 1000 })).toMatchObject({ lo: 0.5, hi: 0.5 });
  });
  test("leave-one-thread-out gives the lowest and highest estimate", () => {
    expect(loto(pairs([["T1", "a", -1], ["T2", "b", 0], ["T3", "c", 0]]))).toEqual([-0.5, 0]);
    expect(loto(pairs([["T1", "a", -1]]))).toBeNull();
  });
  test("planned detectable differences: 8.3 needless, 8.9 duplicates, 3.4 must-ask half-width", () => {
    expect(Math.round(mdd(0.35, 140) * 1000) / 10).toBe(8.3);
    expect(Math.round(mdd(0.35, 121) * 1000) / 10).toBe(8.9);
    expect(Math.round(halfWidth(0.25, 206) * 1000) / 10).toBe(3.4);
  });
  test("the pilot bar admits a true 10% rate about 9% of the time and 20% about 54%", () => {
    expect(admitChance(0.1, 24, 5)).toBeCloseTo(0.086, 2);
    expect(admitChance(0.2, 24, 5)).toBeCloseTo(0.54, 2);
  });
  test("pilot admission: on at least one frontier model, at least 5 needless sends and at most 8 must-ask misses", () => {
    const cell = (sends: number, misses: number) => ({ needless: Array.from({ length: 24 }, (_, i) => (i < sends ? [1, 1] : [0, 0])), must: Array.from({ length: 16 }, (_, i) => (i < misses ? [1, 1] : [0, 0])) });
    expect(pilotAdmit({ opus: cell(5, 8), sol: cell(0, 0) }).admit).toBe(true);
    expect(pilotAdmit({ opus: cell(4, 2), sol: cell(9, 9) }).admit).toBe(false);
    expect(pilotAdmit({ opus: { needless: [[1, 0], ...cell(4, 0).needless.slice(1)], must: [] } }).models.opus!.needless_sends).toBe(3.5);
  });
  test("the frozen spread formula sets k = 3 only past 12 points", () => {
    const low = spreadProjection(Array.from({ length: 24 }, (_, i) => (i < 4 ? [1, 1] : [0, 0])), 140);
    expect(low.W).toBe(0);
    expect(low.spread_k2).toBeCloseTo(Math.sqrt(low.B2), 3);
    expect(low.k).toBe(2);
    const noisy = spreadProjection(Array.from({ length: 24 }, () => [1, 0]), 20);
    expect(noisy.W).toBe(0.5);
    expect(noisy.mdd_k2).toBeGreaterThan(0.12);
    expect(noisy.k).toBe(3);
  });
  test("the label audit stands only when both labellers reach kappa 0.6 pooled and on duplicate against must-ask", () => {
    const rows = [...Array(20)].map((_, i) => ({ audit: (i % 2 ? "DUPLICATE" : "DECISION") as any, opus: (i % 2 ? "DUPLICATE" : "DECISION") as any, astra: (i % 2 ? "DUPLICATE" : "DECISION") as any }));
    expect(labelAudit(rows).stands).toBe(true);
    const bad = rows.map((r, i) => ({ ...r, astra: (i < 12 ? "OBSERVABLE" : r.astra) as any }));
    expect(labelAudit(bad).stands).toBe(false);
  });
  test("reused helpers: Clopper-Pearson and Cohen's kappa", () => {
    expect(clopperPearson(0, 11).lower).toBe(0);
    expect(kappa([[true, true], [false, false]])).toBe(1);
  });
});
