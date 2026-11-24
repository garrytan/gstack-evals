import { describe, expect, test } from "bun:test";
import type { Arm } from "../../../lanes/review-models/score/frozen.ts";
import { contrastsFor, finalRead, interimLook, renderFinal } from "../../../lanes/review-models/score/look.ts";
import type { Review } from "../../../lanes/review-models/score/score.ts";
import { clusteredMeanSe } from "../../../lanes/review-models/score/stats.ts";
import { seededRandom } from "../../../src/runner/stats/paired.ts";

const COST: Record<Arm, number> = { OS: 6.5, OA: 11, FS: 14, FA: 18.5, N: 0.6 };

/** A simulated counted run: each unit has a base catch for OS; each arm catches it with that base or with its own extra chance. */
function simulate(o: { units: number; arms: Arm[]; extra: Partial<Record<Arm, number>>; seed: number; gaps?: (unit: number, arm: Arm) => boolean }): { reviews: Review[]; order: string[] } {
  const rng = seededRandom(o.seed);
  const reviews: Review[] = [];
  const order: string[] = [];
  for (let u = 0; u < o.units; u++) {
    const unit = "u" + String(u).padStart(3, "0");
    order.push(unit);
    const base = rng() < 0.5;
    const pool = u % 5 === 4 ? "B" : "P";
    for (const arm of o.arms) {
      const caught = base || rng() < (o.extra[arm] ?? 0);
      const gap = o.gaps?.(u, arm) ?? false;
      const f = { id: "f1", source: (u % 3 ? "native" : "voice") as "native" | "voice", severity: "HIGH", path: "a.ts", line: 3, text: "claim" };
      reviews.push({ unit, arm, pool, cluster: pool === "B" ? "repo" + Math.floor(u / 10) : "pr" + u, ...(u % 4 === 0 ? { stratum: "S2-openai" } : {}), outcome: gap ? "gap" : "ok", contaminated: false, findings: gap ? [] : [f], judged: gap ? null : { rulings: { f1: caught ? "names" : "doesnt" }, reasons: {}, attempts: 1, failures: [], failed: false }, usd: COST[arm], wall_seconds: 300 });
    }
  }
  const shuffled = order.map((u) => ({ u, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.u);
  return { reviews, order: shuffled };
}

describe("the clustered bootstrap standard error", () => {
  test("matches the analytic standard error on independent units, is seeded, and gives mean plus or minus 1.96 SE", () => {
    const rng = seededRandom(5);
    const values = Array.from({ length: 400 }, (_, i) => ({ unit: "u" + i, cluster: "c" + i, value: rng() < 0.3 ? 25 : 0 }));
    const s = clusteredMeanSe(values);
    const m = s.mean, sd = Math.sqrt(values.reduce((a, v) => a + (v.value - m) ** 2, 0) / values.length);
    expect(s.se! / (sd / Math.sqrt(400))).toBeGreaterThan(0.95);
    expect(s.se! / (sd / Math.sqrt(400))).toBeLessThan(1.05);
    expect(clusteredMeanSe(values)).toEqual(s);
    expect(s.interval).toEqual([m - 1.96 * s.se!, m + 1.96 * s.se!]);
    expect(clusteredMeanSe([{ unit: "a", cluster: "c", value: 1 }, { unit: "b", cluster: "c", value: 3 }])).toMatchObject({ mean: 2, se: null, interval: null, n_clusters: 1 });
  });
  test("resamples whole clusters: duplicated units in one cluster widen the error", () => {
    const one = Array.from({ length: 50 }, (_, i) => ({ unit: "u" + i, cluster: "c" + i, value: i % 2 }));
    const twice = one.flatMap((v) => [v, { ...v, unit: v.unit + "b" }]);
    const a = clusteredMeanSe(one), b = clusteredMeanSe(twice);
    expect(b.mean).toBe(a.mean);
    expect(b.se!).toBeCloseTo(a.se!, 1);
  });
});

describe("the full 2x2 on simulated data with known answers", () => {
  // OS catches half the bugs. Fable with Sol adds about 5 points; both Astra cells catch every bug. So the main reviewer
  // gains about 2.5 points for $7.50 more per review (net about -6.9), and the voice about 47.5 points for $4.50 more
  // (net about +7.4).
  const { reviews, order } = simulate({ units: 100, arms: ["OS", "OA", "FS", "FA", "N"], extra: { FS: 0.1, FA: 1, OA: 1 }, seed: 20261124 });
  test("the look is at half the counted units, rounded down, and closes the main reviewer only", () => {
    const look = interimLook(reviews, "all", order, 100);
    expect(look.look_units).toEqual(order.slice(0, 50));
    const main = look.contrasts.find((c) => c.decision === "main")!;
    const voice = look.contrasts.find((c) => c.decision === "voice")!;
    expect(main.doesnt_pay).toBe(true);
    expect(main.upper.miss!).toBeLessThan(0);
    expect(main.upper.miss).toBe(main.net.miss!.mean + 2.797 * main.net.miss!.se!);
    expect(voice.doesnt_pay).toBe(false);
    expect(look.stop_cells).toEqual([]);
    expect(interimLook(reviews.slice(0, 81 * 5), "all", order.filter((u) => Number(u.slice(1)) < 81), 81).look_units).toHaveLength(40);
  });
  test("the end: Astra pays and catches more, Fable stays decided at the look", () => {
    const rows = finalRead(reviews, "all", { decidedAtLook: ["main reviewer: Fable minus Opus"] });
    const main = rows.find((r) => r.decision === "main")!;
    const voice = rows.find((r) => r.decision === "voice")!;
    expect(main).toMatchObject({ status: "decided at the look", pay_verdict: "doesn't pay" });
    expect(voice).toMatchObject({ status: "read", pay_verdict: "pays", readings_agree: true, catch_verdict: "catches more" });
    const net = voice.strict.miss.net!;
    expect(net.mean).toBeGreaterThan(5);
    expect(net.mean - 1.655 * net.se!).toBeGreaterThan(0);
    expect(net.mean).toBeCloseTo(25 * voice.strict.miss.catch!.mean - voice.strict.miss.usd!.mean, 9);
    expect(voice.strict.miss.usd!.mean).toBe(4.5);
    expect(voice.strict.miss.usd_per_extra_catch).toBeCloseTo(4.5 / voice.strict.miss.catch!.mean, 9);
    expect(voice.by_pool.P.miss.net!.n_units + voice.by_pool.B.miss.net!.n_units).toBe(100);
    expect(voice.s2_openai!.miss.net!.n_units).toBe(25);
    expect(rows.map((r) => r.name)).toEqual(contrastsFor("all").map((c) => c.name));
    expect(rows.find((r) => r.name === "OA minus N")).toMatchObject({ decision: null, status: "read", catch_p_holm: { dropped: null, miss: null } });
    expect(renderFinal(rows)[0]).toBe("main reviewer: Fable minus Opus: doesn't pay, decided at the look");
  });
  test("both decisions closed at the look stop every cell but OS and N", () => {
    const sim = simulate({ units: 100, arms: ["OS", "OA", "FS", "FA", "N"], extra: {}, seed: 7 });
    const look = interimLook(sim.reviews, "all", sim.order, 100);
    expect(look.contrasts.every((c) => c.doesnt_pay)).toBe(true);
    expect(look.stop_cells.sort()).toEqual(["FA", "FS", "OA"]);
  });
});

describe("the Opus-only voice pair after Fable leaves", () => {
  test("no gain at $4.50 more crosses at the look and stops OA alone", () => {
    const { reviews, order } = simulate({ units: 100, arms: ["OS", "OA", "N"], extra: {}, seed: 3 });
    const look = interimLook(reviews, "OS_OA_N", order, 100);
    expect(look.contrasts.map((c) => [c.name, c.doesnt_pay])).toEqual([["voice: OA minus OS", true]]);
    expect(look.stop_cells).toEqual(["OA"]);
  });
  test("an 18-point gain at $4.50 more breaks even: unsettled, not doesn't pay", () => {
    const { reviews, order } = simulate({ units: 100, arms: ["OS", "OA", "N"], extra: { OA: 0.36 }, seed: 11 });
    expect(interimLook(reviews, "OS_OA_N", order, 100).contrasts[0]!.doesnt_pay).toBe(false);
    const voice = finalRead(reviews, "OS_OA_N")[0]!;
    expect(Math.abs(voice.strict.miss.net!.mean)).toBeLessThan(3);
    expect(voice.pay_verdict).toBe("unsettled");
  });
  test("when the gap readings disagree the verdict is unsettled: gaps on OA's reviews pay when dropped and lose as misses", () => {
    const { reviews } = simulate({ units: 100, arms: ["OS", "OA", "N"], extra: { OA: 0.8 }, seed: 13, gaps: (u, arm) => arm === "OA" && u % 5 < 2 });
    const voice = finalRead(reviews, "OS_OA_N")[0]!;
    expect(voice.pay).toEqual({ dropped: "pays", miss: "doesn't pay" });
    expect(voice).toMatchObject({ pay_verdict: "unsettled", readings_agree: false });
    expect(voice.strict.dropped.net!.n_units).toBe(60);
    expect(renderFinal([voice])[0]).toBe("voice: OA minus OS: pays? unsettled (gap readings disagree); " + voice.catch_verdict);
  });
  test("an untested arm leaves its contrasts unread", () => {
    const { reviews } = simulate({ units: 20, arms: ["OS", "OA", "N"], extra: { OA: 0.5 }, seed: 17 });
    const rows = finalRead(reviews, "OS_OA_N", { untested: { OA: ["exposed in 80.0% of reviews, under 90%"] } });
    expect(rows[0]).toMatchObject({ status: "untested", pay_verdict: null, untested: ["OA: exposed in 80.0% of reviews, under 90%"] });
    expect(rows.find((r) => r.name === "OS minus N")!.status).toBe("read");
  });
  test("the look refuses an order that does not list the counted units", () => {
    const { reviews, order } = simulate({ units: 10, arms: ["OS", "OA", "N"], extra: {}, seed: 1 });
    expect(() => interimLook(reviews, "OS_OA_N", order.slice(1), 10)).toThrow(/^E_RM_SCORE_INPUT/);
  });
});

describe("the Sol-only set", () => {
  test("FS minus OS is the main reviewer's decision and the voice is not read", () => {
    expect(contrastsFor("OS_FS_N").map((c) => [c.name, c.decision])).toEqual([["main reviewer: FS minus OS", "main"], ["OS minus N", null], ["FS minus N", null]]);
    expect(contrastsFor("stop")).toEqual([]);
  });
});
