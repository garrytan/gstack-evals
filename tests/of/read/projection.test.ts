// Value: protects=section 13's allowances, round admission and cut order, and section 12's re-estimate and power.py rerun that decide whether stage 2 may start.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRE_SMOKE_ALLOWANCE, PRE_SMOKE_SIM_ALLOWANCE } from "../../../lanes/office-hours-founder/frozen.ts";
import { admitRound, allowances, CAPTAIN_STOP, estimate, moneyProjection, POWER_PY, powerMdd, project, rounds, type MoneyInput } from "../../../lanes/office-hours-founder/read/projection.ts";
import { session } from "../../../lanes/office-hours-founder/read/seams.ts";
import { CUTS, manifest } from "../../../lanes/office-hours-founder/read/stage2.ts";

const none = (unit: string, Ws: number[], model: "opus" | "sol" = "opus") => Ws.map((W, k) => session({ stage: 1, model, unit, pass: k + 1, W, W_shuffled: k === 0 ? 1 : 0 }));

describe("estimate", () => {
  test("the control rate, the one-way ANOVA ICC and the shuffled-key credit", () => {
    const xs = [...none("a", [1, 1, 1]), ...none("b", [1, 0, 0]), ...none("c", [0, 0, 0])];
    expect(estimate(xs, "opus", ["a", "b", "c"])).toEqual({ model: "opus", units: 3, sessions: 9, p0: 0.4444, rho: 0.6667, s: 0.3333 });
  });
  test("an ICC outside (0, 1) is clipped, one with no variance takes 0.5, and fewer than two units refuses", () => {
    expect(estimate([...none("a", [1, 1, 1]), ...none("b", [0, 0, 0])], "opus", ["a", "b"]).rho).toBe(0.99);
    expect(estimate([...none("a", [1, 1, 0]), ...none("b", [1, 0, 0])], "opus", ["a", "b"]).rho).toBe(0.01);
    expect(estimate([...none("a", [0, 0]), ...none("b", [0, 0])], "opus", ["a", "b"])).toMatchObject({ rho: 0.5, p0: 0.01 });
    expect(() => estimate(none("a", [1, 0]), "opus", ["a"])).toThrow("at least two");
  });
});

describe("powerMdd", () => {
  test("runs power.py as committed with the designs on stdin", () => {
    let seen = "";
    const out = powerMdd([{ p0: 0.25, rho: 0.5, s: 0.05, n: 64, passes: 2 }], (program, stdin) => {
      seen = program;
      expect(JSON.parse(stdin)).toEqual([{ p0: 0.25, rho: 0.5, s: 0.05, n: 64, passes: 2 }]);
      return '[{"w": 0.13, "guard": 0.14}]';
    });
    expect(out).toEqual([{ w: 0.13, guard: 0.14 }]);
    expect(seen).toContain(JSON.stringify(POWER_PY));
    const src = readFileSync(POWER_PY, "utf8");
    for (const name of ["def mdd(", "def helps_rate(", "STEPS =", "TAU =", "SEED ="]) expect(src).toContain(name);
  });
});

describe("allowances", () => {
  test("three times the median and at least the costliest; lens scaled from Opus; the simulator keeps its frozen figure", () => {
    const stage1 = (["opus", "sol", "particle"] as const).flatMap((model) => [1, 1, 1, 5].map((usd, k) => session({ stage: 1, model, unit: "u" + k, usd: model === "opus" ? usd : 1 })));
    const smoke = [
      ...[1, 2].map((usd) => session({ stage: 1, arm: "lens", usd })),
      ...(["opus", "sol", "particle"] as const).flatMap((model) => [2, 2, 3].map((usd) => session({ stage: 1, model, arm: "office-hours", usd }))),
    ];
    const a = allowances(stage1, smoke);
    expect(a.arm.none).toEqual({ opus: 5, sol: 3, particle: 3 });
    expect(a.arm.lens).toEqual({ opus: 4.5, sol: 2.7, particle: 0.45 });
    expect(a.arm["office-hours"].opus).toBe(6);
    expect(a.sim).toBe(PRE_SMOKE_SIM_ALLOWANCE);
    expect(() => allowances([], smoke)).toThrow("no measured none session");
  });
});

describe("admitRound", () => {
  const round = rounds(manifest(["a", "b", "c", "d", "e"], { kind: "arm", real: false, cuts: [] }))[0]!;
  const runs = 4 * (PRE_SMOKE_ALLOWANCE.none.opus + PRE_SMOKE_ALLOWANCE.lens.opus + PRE_SMOKE_ALLOWANCE["office-hours"].opus) * 2;
  const sim = 4 * 3 * PRE_SMOKE_SIM_ALLOWANCE * 2;
  const room = (cap: number) => ({ cap, settled: 0, open: 0 });
  test("a round leases twice each session's allowance and twice the simulator's", () => {
    expect(round.length).toBe(12);
    const a = admitRound(round, { arm: PRE_SMOKE_ALLOWANCE, sim: PRE_SMOKE_SIM_ALLOWANCE }, { runs: room(runs), simulator: room(sim), line: room(runs + sim) });
    expect(a).toEqual({ runs, sim, fits: true });
  });
  test("it starts only when both leases fit their items and the line", () => {
    const allow = { arm: PRE_SMOKE_ALLOWANCE, sim: PRE_SMOKE_SIM_ALLOWANCE };
    expect(admitRound(round, allow, { runs: { cap: runs, settled: 1, open: 0 }, simulator: room(sim), line: room(1e9) }).fits).toBe(false);
    expect(admitRound(round, allow, { runs: room(runs), simulator: { cap: sim, settled: 0, open: 1 }, line: room(1e9) }).fits).toBe(false);
    expect(admitRound(round, allow, { runs: room(runs), simulator: room(sim), line: room(runs + sim - 1) }).fits).toBe(false);
  });
});

describe("moneyProjection", () => {
  const one = { none: { opus: 1, sol: 1, particle: 1 }, lens: { opus: 1, sol: 1, particle: 1 }, "office-hours": { opus: 1, sol: 1, particle: 1 } };
  const per = { opus: 1, sol: 1, particle: 1 };
  const item = { cap: 1e6, spent: 0, extra: 0 };
  const input = (ceiling: number): MoneyInput => ({
    comparison: Array.from({ length: 8 }, (_, k) => "u" + k),
    real: ["r1", "r2"],
    cost: { session: one, sim: one, pitch: one, packet: per, pitch_packet: per },
    items: { "stage 2 runs": item, "real stratum runs": item, simulator: item, judges: item, "pitch-only runs": item, "pitch-only labels": item },
    others: [{ name: "stage 1", cap: 100, spent: 10, projected: 0 }],
    ceiling,
  });
  test("the pitch-only cell is its own item for runs and labels", () => {
    const p = project(input(1e6), []);
    expect(p.items.find((x) => x.name === "pitch-only runs")!.projected).toBe(8 * 3 * 3);
    expect(p.items.find((x) => x.name === "pitch-only labels")!.projected).toBe(8 * 3);
    expect(p.items.find((x) => x.name === "stage 2 runs")!.projected).toBe(8 * 3 * 4);
    expect(p.items.find((x) => x.name === "judges")!.projected).toBe(8 * 4 + 2 * 4);
  });
  test("cuts go in the frozen order until it fits", () => {
    const ceiling = project(input(0), CUTS.slice(0, 2)).total;
    const m = moneyProjection(input(ceiling));
    expect(m.cuts).toEqual(["sol lens", "particle lens"]);
    expect(m.captain).toBeNull();
    expect(moneyProjection(input(1e6)).cuts).toEqual([]);
    expect(moneyProjection(input(1)).captain).toBe("the projection doesn't fit after every cut");
  });
  test("a projection past the Captain stop goes to the Captain before any cut", () => {
    const i = input(1e9);
    const m = moneyProjection({ ...i, others: [{ name: "crew", cap: 1e9, spent: CAPTAIN_STOP, projected: 1 }] });
    expect(m.cuts).toEqual([]);
    expect(m.captain).toBe("the projection passes the Captain stop");
  });
});
