// Value: protects=section 8's scorer: W and its secondaries from the production labels, C1's failure rows, the E shares, stock credits and the AN-1 and AN-2 prints.
import { describe, expect, test } from "bun:test";
import { block, KEY, row, stubCaller, turn, unit } from "../../../lanes/office-hours-founder/score/fixtures.ts";
import { pitchW, referenceRates, scoreSessions, stockCredits, unitMean, wOf } from "../../../lanes/office-hours-founder/score/score.ts";
import { judged } from "../../../lanes/office-hours-founder/score/seams.ts";
import type { ScoredSession } from "../../../lanes/office-hours-founder/types.ts";

const sell = "Sell " + KEY.wedge.toLowerCase() + " to " + KEY.customer.toLowerCase();
const twin = (id: string, o: Parameters<typeof unit>[1] = {}) => [id, unit(id, { set: "twin", ...o })] as const;

describe("W", () => {
  test("credited on a primary item and not multi-target", () => {
    const c = { customer: true, wedge: false, multi_target: false, next: null, alt: null, doubt: null };
    expect(wOf(c, ["customer"])).toBe(1);
    expect(wOf(c, ["wedge"])).toBe(0);
    expect(wOf({ ...c, multi_target: true }, ["customer"])).toBe(0);
    expect(wOf({ ...c, wedge: null }, ["customer"])).toBeNull();
    expect(wOf(undefined, ["customer"])).toBeNull();
  });
  test("the item scores follow the primary items, and multi-target voids them", async () => {
    const units = new Map([twin("a", { primary: ["wedge"] })]);
    const { scored } = await judged(units, [row({ unit: "a" }), row({ unit: "a", pass: 2, block: block(sell + ", target1, target2 and target3") })]);
    expect(scored[0]).toMatchObject({ W: 1, W_customer: null, W_wedge: 1, W_both: null, N: 1, W_alt: 0, R: 0 });
    expect(scored[1]).toMatchObject({ W: 0, W_wedge: 0 });
    const both = await judged(new Map([twin("b")]), [row({ unit: "b", block: block(sell, { other_moves: ["Sell it to " + KEY.customer.toLowerCase()], doubt: "Selling to chains" }) })]);
    expect(both.scored[0]).toMatchObject({ W: 1, W_customer: 1, W_wedge: 1, W_both: 1, W_alt: 1, R: 1 });
  });
  test("R is null on a no-pivot unit", async () => {
    const { scored } = await judged(new Map([twin("a", { key: { pivot: "none" } })]), [row({ unit: "a" })]);
    expect(scored[0]!.R).toBeNull();
  });
  test("only the model's production judge counts", async () => {
    const { built, labels } = await judged(new Map([twin("a")]), [row({ unit: "a" })]);
    const units = new Map([twin("a")]);
    const swapped = labels.map((l) => ({ ...l, judge: "opus" as const }));
    expect(scoreSessions({ rows: [row({ unit: "a" })], units, maps: [built.map], labels: swapped })[0]!.W).toBeNull();
  });
  test("W_shuffled reads the partner's key, and is null when its cells are incomplete while W stands", async () => {
    const units = new Map([twin("a"), twin("b", { key: { customer: "Teachers at rural schools", wedge: "A lesson pack" } })]);
    const rows = [row({ unit: "a" }), row({ unit: "b" })];
    const full = await judged(units, rows);
    expect(full.scored.map((s) => [s.W, s.W_shuffled])).toEqual([[1, 0], [0, 1]]);
    const shuffledIds = new Set(Object.values(full.built.map.packets).filter((p) => p.role === "shuffled").map((p) => p.id));
    const call = stubCaller();
    const partial = await judged(units, rows, async (c) => {
      const r = await call(c);
      if (![...shuffledIds].some((id) => c.label.startsWith(id + ":"))) return r;
      const obj = JSON.parse(r.text!);
      for (const l of obj.labels) delete l.wedge;
      return { ...r, text: JSON.stringify(obj) };
    });
    expect(partial.scored.map((s) => [s.W, s.W_shuffled])).toEqual([[1, null], [0, null]]);
  });
});

describe("C1 and the mechanical reads", () => {
  test("no-block and arm-stop score 0; missing, contaminated and gstack-read score null", async () => {
    const units = new Map([twin("a")]);
    const rows = [row({ unit: "a", end: "no-block", block: null }), row({ unit: "a", pass: 2, end: "arm-stop", block: null }), row({ unit: "a", pass: 3, end: "missing", block: null }), row({ unit: "a", pass: 4, end: "gstack-read", block: null, gstack_reads: ["x"] })];
    const { scored } = await judged(units, rows);
    expect(scored[0]).toMatchObject({ W: 0, N: 0, W_shuffled: 0, R: 0, W_alt: 0, E: 0 });
    expect(scored[1]).toMatchObject({ W: 0, N: 0, arm_stop: true });
    for (const s of scored.slice(2)) expect(s).toMatchObject({ W: null, N: null, R: null, E: null, order_share: null });
    expect(scored[3]!.gstack_read).toBe(true);
  });
  test("E, E_demand, E_all and the order share read the founder turns' revealed ids", async () => {
    const r = row({ unit: "a", founder_turns: [turn(1, ["f1"]), turn(2, ["f2", "f5"]), turn(3, ["f3"])], first_recommendation_reply: 2, questions: 4, pushes: 1, closing_sent: true, web: 0, usd: 1.5 });
    const { scored } = await judged(new Map([twin("a")]), [r]);
    expect(scored[0]).toMatchObject({ E: 0.75, E_demand: 1, E_all: 4 / 6, order_share: 0.5, founder_turns: 3, questions: 4, pushes: 1, limit_hit: true, usd: 1.5, first_move_words: 13 });
  });
  test("the reference has no simulator, so its E and order share are null", async () => {
    const { scored } = await judged(new Map([twin("a")]), [row({ unit: "a", kind: "reference" })]);
    expect(scored[0]).toMatchObject({ W: 1, E: null, order_share: null });
  });
});

test("stock credits come from each true-key label packet's production judge", async () => {
  const units = new Map([twin("a"), twin("b", { key: { customer: "Teachers at rural schools" } })]);
  const { built, labels } = await judged(units, [row({ unit: "a" }), row({ unit: "b", model: "sol" }), row({ unit: "a", kind: "reference" })]);
  const credits = stockCredits({ units, maps: [built.map], labels });
  expect(credits.map((c) => [c.unit, c.model, c.judge, c.row, c.W, c.N]).sort()).toEqual([
    ["a", "opus", "astra", 1, 0, 0],
    ["a", "opus", "astra", 2, 0, 0],
    ["a", "opus", "astra", 3, 0, 0],
    ["b", "sol", "opus", 1, 0, 0],
    ["b", "sol", "opus", 2, 0, 0],
    ["b", "sol", "opus", 3, 0, 0],
  ]);
});

describe("prints", () => {
  const s = (o: Partial<ScoredSession>) => ({ stratum: "constructed", kind: "arm", model: "opus", arm: "none", unit: "a", W: null, W_customer: null, W_wedge: null, ...o }) as ScoredSession;
  test("unit means weigh units equally", () => {
    expect(unitMean([s({ unit: "a", W: 1 }), s({ unit: "a", W: 0 }), s({ unit: "b", W: 1 }), s({ unit: "c", W: null })], (x) => x.W)).toEqual({ value: 0.75, units: 2 });
  });
  test("AN-2: the reference's W and its credit rate per item, per model, constructed units only", () => {
    const r = referenceRates([s({ kind: "reference", W: 1, W_customer: 1, W_wedge: 0 }), s({ kind: "reference", unit: "b", W: 0, W_customer: 0, W_wedge: 0 }), s({ kind: "reference", unit: "r", stratum: "real", W: 1 }), s({ W: 1 })]);
    expect(r.opus).toEqual({ W: 0.5, customer: 0.5, wedge: 0, units: 2 });
    expect(r.sol).toEqual({ W: null, customer: null, wedge: null, units: 0 });
  });
  test("AN-1: W_pitch per model and arm", () => {
    const r = pitchW([s({ kind: "pitch", arm: "office-hours", W: 1 }), s({ kind: "pitch", arm: "none", W: 0 }), s({ kind: "pitch", arm: "none", unit: "b", W: 1 }), s({ arm: "none", W: 1 })]);
    expect(r.opus).toEqual({ none: { value: 0.5, units: 2 }, lens: { value: null, units: 0 }, "office-hours": { value: 1, units: 1 } });
  });
});
