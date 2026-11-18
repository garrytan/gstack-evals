// Value: protects=the second attempt's projection stop (its section 5.5): the Jeffreys 0.95 quantile against scipy's beta.ppf, as sizing.py takes it, the projection formula at the top-up bound of 30, its room and its scale. The 16 and 32 draw pilot read of pre-run change 1, item 4d, is gone with the pilot it read, and so are its tests.
import { describe, expect, test } from "bun:test";
import { PROJECTION, TOP_UP_BOUND } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { ATTEMPT_1, jeffreys, plus, predicted, projection, readProjection, roomLeft, type Counts } from "../../../lanes/office-hours-rewrite/author/pilot.ts";
import { betaQuantile } from "../../../lanes/office-hours-rewrite/read/stats.ts";
import { wilson } from "../../../lanes/autoplan-audit/stats.ts";

const NONE: Counts = { first: [0, 0], partners: {}, matched_draws: [0, 0], unpaired: { T7: [0, 0], T8: [0, 0], builder: [0, 0] } };
const NO_OPEN = { pairs: {}, unpaired: { T7: 0, T8: 0, builder: 0 } };

describe("Wilson score interval", () => {
  test("matches Newcombe's 1998 worked examples at 95% (Statistics in Medicine 17:857-872, Table I, method 3)", () => {
    const cases: [number, number, number, number][] = [[81, 263, 0.2553, 0.3662], [15, 148, 0.0624, 0.1605], [0, 20, 0, 0.1611], [1, 29, 0.0061, 0.1718]];
    for (const [k, n, lo, hi] of cases) {
      const [l, h] = wilson(k, n, 1.959964);
      expect(l).toBeCloseTo(lo, 4);
      expect(h).toBeCloseTo(hi, 4);
    }
  });
});

describe("the Jeffreys quantile (section 5.5)", () => {
  test("matches scipy 1.18.1's stats.beta.ppf(0.95, k + 0.5, n - k + 0.5), the jm of sizing.py, to 9 places", () => {
    const cases: [number, number, number][] = [[0, 0, 0.9938441703], [0, 1, 0.7714801862], [10, 15, 0.8342189907], [2, 41, 0.1285263637], [5, 41, 0.2246124471], [1, 2, 0.9026918183], [0, 20, 0.0904764265]];
    expect(PROJECTION.quantile).toBe(0.95);
    for (const [k, n, q] of cases) expect(jeffreys(k, n)).toBeCloseTo(q, 9);
  });
  test("closed forms: the arcsine law at Beta(0.5, 0.5), p^(1/a) at Beta(a, 1) and 1 - (1 - p)^(1/b) at Beta(1, b)", () => {
    expect(betaQuantile(0.95, 0.5, 0.5)).toBeCloseTo(Math.sin((0.95 * Math.PI) / 2) ** 2, 12);
    expect(betaQuantile(0.95, 2, 1)).toBeCloseTo(Math.sqrt(0.95), 12);
    expect(betaQuantile(0.3, 1, 4)).toBeCloseTo(1 - 0.7 ** 0.25, 12);
  });
  test("refuses a p outside (0, 1) or a shape that is not positive", () => {
    expect(() => betaQuantile(1, 1, 1)).toThrow("E_OHR_READ_INPUT");
    expect(() => betaQuantile(0.5, 0, 1)).toThrow("E_OHR_READ_INPUT");
  });
});

describe("the projection (section 5.5)", () => {
  test("a pair of type t costs (c1 / f + m * D * c2 + (1 - m) * 30 * c2) / m, and an unpaired brief of kind u cu / y", () => {
    const c: Counts = { first: [7, 9], partners: { T2: [3, 5] }, matched_draws: [12, 3], unpaired: { T7: [1, 6], T8: [0, 0], builder: [4, 10] } };
    const { first: c1, second: c2, unpaired: cu } = PROJECTION.usd;
    const f = jeffreys(7, 9), m = jeffreys(3, 5);
    expect(TOP_UP_BOUND).toBe(30);
    expect(projection(c, { pairs: { T2: 2 }, unpaired: { T7: 0, T8: 0, builder: 0 } }, 1)).toBeCloseTo((2 * (c1 / f + m * 4 * c2 + (1 - m) * 30 * c2)) / m, 10);
    expect(projection(c, { pairs: {}, unpaired: { T7: 3, T8: 0, builder: 1 } }, 1)).toBeCloseTo((3 * cu) / jeffreys(1, 6) + cu / jeffreys(4, 10), 10);
    expect(projection(c, { pairs: { T2: 2 }, unpaired: { T7: 3, T8: 0, builder: 1 } }, 2.5)).toBeCloseTo(2.5 * projection(c, { pairs: { T2: 2 }, unpaired: { T7: 3, T8: 0, builder: 1 } }, 1), 10);
  });
  test("at the first attempt's counts within the bound, T8 at T7's, it is $127.524047, what sizing.py's projection gives under scipy at the bound of 30", () => {
    const open = { pairs: { T1: 4, T2: 3, T3: 3, T4: 3, T5: 4, T6: 3 }, unpaired: { T7: 3, T8: 5, builder: 21 } };
    expect(projection({ ...ATTEMPT_1, unpaired: { ...ATTEMPT_1.unpaired, T8: ATTEMPT_1.unpaired.T7 } }, open, 1)).toBeCloseTo(127.524047, 6);
  });
  test("plus adds the run's counts to the first attempt's, type by type and kind by kind", () => {
    const run: Counts = { first: [4, 5], partners: { T1: [0, 2], T6: [1, 1] }, matched_draws: [3, 1], unpaired: { T7: [1, 8], T8: [2, 8], builder: [3, 8] } };
    expect(plus(ATTEMPT_1, run)).toEqual({ first: [14, 20], partners: { T1: [0, 3], T2: [1, 1], T3: [1, 1], T4: [1, 2], T5: [1, 1], T6: [3, 3] }, matched_draws: [53, 7], unpaired: { T7: [3, 49], T8: [2, 8], builder: [8, 49] } });
    expect(plus(NONE, NONE).partners).toEqual({ T1: [0, 0], T2: [0, 0], T3: [0, 0], T4: [0, 0], T5: [0, 0], T6: [0, 0] });
  });
  test("its room is the cap less the committed spend less 8 drafts at $3.50: $350.00 after a $31 pilot under the $409 cap, as sizing.txt prints", () => {
    expect(roomLeft(409, 31).toFixed(2)).toBe("350.00");
    expect([PROJECTION.held, predicted("first"), predicted("second"), predicted("unpaired")]).toEqual([8, 0.887, 0.093, 0.545]);
  });
  test("it stops only when the projection passes the room, and costs scale by spend over what the first attempt's figures predict", () => {
    const counts: Counts = { ...NONE, partners: { T3: [1, 2] } };
    const open = { ...NO_OPEN, pairs: { T3: 1 } };
    const at = (cap: number, spend = 1) => readProjection({ counts, open, spend, predicted: 1, cap, committed: 10, drafts: 3 });
    const p = at(409).projection;
    expect(at(p + 10 + 28 + 0.01).stop).toBe(false);
    expect(at(p + 10 + 28 - 0.01).stop).toBe(true);
    const edge = at(p + 10 + 28);
    expect(edge.stop).toBe(edge.projection > edge.room);
    expect(at(409, 3).projection).toBeCloseTo(3 * p, 10);
    expect(readProjection({ counts, open, spend: 0, predicted: 0, cap: 409, committed: 0, drafts: 0 }).scale).toBe(1);
  });
});
