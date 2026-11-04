import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alone, bestPair, costPlan, d7, G_SKILLS, ladder, m1Decide, MDD_GRID, meteredPricer, pairPrice, PLANNED, priceModel, pyEnv, pyRound, pySum, renderResizeCases, renderResizeMetered, type GMetered } from "../../src/runner/stats/g-resize.ts";

const ROOT = join(import.meta.dir, "../..");
const PREREG = join(ROOT, "wiki/plans/2026-11-04-geva-262-g-family-admission-prereg");
const PLAN3 = join(ROOT, "wiki/plans/2026-11-03-geva-225-outcome-per-skill-plan");
const KEYS = ["MULT", "M_PER", "M_AP", "AUTH_PAID", "AUTH_EXTRA", "YIELD_G", "TOLD_SCALE", "P1RATIO", "AGENT_USER"];
const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k))) as Record<string, string>;
function python(script: string, env: Record<string, string> = {}): string {
  const r = spawnSync("python3", [script], { env: { ...CLEAN, ...env }, encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) throw new Error(script + " exited " + r.status + ": " + r.stderr);
  return r.stdout;
}
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const asEnv = (m: GMetered) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)]));

describe("the port reads plan v3's frozen bundle", () => {
  test("the MDD grid is mdd-grid.json, and the bundle matches resize.py's sha256 pins", () => {
    expect(MDD_GRID).toEqual(JSON.parse(readFileSync(join(PLAN3, "mdd-grid.json"), "utf8")));
    const pins = readFileSync(join(PREREG, "resize.py"), "utf8");
    for (const f of ["cost.py", "survivor.py", "mdd-grid.json"]) expect(pins).toContain('"' + f + '": "' + sha(join(PLAN3, f)) + '"');
    expect(sha(join(PREREG, "resize.py"))).toBe("1265268921e92667a85529bfe8eec8a5ecb20bc2f12b567a3c3ec3f44913ec34");
    expect(sha(join(PREREG, "resize.txt"))).toBe("b7f9d53dc363c428bccc78b13720158d9e721bd0ac91b7388be10a85c52af53a");
  });

  test("Python's float sum and round are kept", () => {
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6);
    expect(0.1 + 0.2 + 0.3).not.toBe(0.6);
    expect([pyRound(0.5), pyRound(1.5), pyRound(2.5), pyRound(2.6), pyRound(1212.4999)]).toEqual([0, 2, 2, 3, 1212]);
  });
});

describe("resize.py, byte for byte", () => {
  test("every planning case prints resize.txt exactly, house prices first", () => {
    const want = readFileSync(join(PREREG, "resize.txt"), "utf8");
    const got = renderResizeCases();
    expect(got).toBe(want);
    const house = "== " + got.split("== ")[1]!;
    const check = readFileSync(join(PREREG, "resize_check.py"), "utf8");
    expect(check).toContain('HOUSE_SHA = "' + createHash("sha256").update(house).digest("hex") + '"');
  });

  const metered: GMetered[] = [
    { MULT: 5 },
    { MULT: 5, M_PER: 2.2, M_AP: 10 },
    { MULT: 5, M_PER: 2.2, M_AP: 30, AUTH_PAID: 1.39, AUTH_EXTRA: 1.2 },
    { MULT: 5, M_PER: 30, M_AP: 2.2 },
    { MULT: 5, M_PER: 30, M_AP: 30 },
    { MULT: 10 },
    { MULT: 4.2, M_PER: 2.6, M_AP: 6.1, AUTH_PAID: 2.05, AUTH_EXTRA: 3.4 },
    { MULT: 3.1, M_PER: 1.9, M_AP: 4.4 },
    { MULT: 6.5, M_PER: 2.4, M_AP: 3.2, AUTH_EXTRA: 0.8 },
    { MULT: 5.25, M_PER: 2.53, M_AP: 5.75, AUTH_PAID: 1.1 },
  ];
  for (const m of metered) {
    test("metered " + JSON.stringify(m) + " prints what resize.py prints", () => {
      expect(renderResizeMetered(m)).toBe(python(join(PREREG, "resize.py"), asEnv(m)));
    });
  }

  test("metered inputs are checked as resize.py checks them", () => {
    expect(() => renderResizeMetered({} as GMetered)).toThrow(/MULT/);
    for (const bad of [0, -1, 1000, NaN, Infinity]) expect(() => renderResizeMetered({ MULT: bad })).toThrow(/bad metered input/);
    expect(() => renderResizeMetered({ MULT: 5, M_AP: 0 })).toThrow(/M_AP/);
  });
});

describe("cost.py's frozen sizing", () => {
  const envs: Record<string, string>[] = [
    { MULT: "5", P1RATIO: "0.41", AUTH_EXTRA: "1.2" },
    {},
    { MULT: "5", P1RATIO: "0.41", AUTH_EXTRA: "1.2", TOLD_SCALE: "1.15" },
    { MULT: "10", P1RATIO: "0.41", AUTH_EXTRA: "1.2", TOLD_SCALE: "1.5", AGENT_USER: "2.4" },
    { MULT: "5", P1RATIO: "0.41", AUTH_EXTRA: "6.2", AGENT_USER: "0.12" },
  ];
  for (const env of envs) {
    test("cost.py " + JSON.stringify(env), () => {
      expect(costPlan(priceModel(pyEnv(env)))).toEqual(JSON.parse(python(join(PLAN3, "cost.py"), env)));
    });
  }
});

describe("M1's survivor order, the Captain's pick C", () => {
  const house = meteredPricer({ MULT: 5, AUTH_EXTRA: 1.2 });
  test("both alive at house prices: plan v3's sizes", () => {
    const o = m1Decide(house, []);
    expect(o.runs["plan-eng-review"]).toMatchObject({ n: 60, k: 3, mdd: 18.6 });
    expect(o.runs.autoplan).toMatchObject({ n: 54, k: 3, mdd: 19.2 });
  });
  test("autoplan stops at items 1 to 4: plan-eng-review re-sizes alone to 48 x 4", () => {
    const o = m1Decide(house, ["autoplan"]);
    expect(o.runs["plan-eng-review"]).toEqual({ n: 48, k: 4, mdd: 18.6, price: 1650 });
    expect(o.runs.autoplan).toBeNull();
  });
  test("plan-eng-review stops at items 1 to 4: autoplan alone finds no rung at house prices", () => {
    const o = m1Decide(house, ["plan-eng-review"]);
    expect(o.runs["plan-eng-review"]).toBeNull();
    expect(o.runs.autoplan).toBeNull();
    expect(o.ladders.autoplan.tried.length).toBe(7);
  });
  const runsLine = (text: string, s: string) => {
    const m = new RegExp(s + " alone \\([a-z-]+ stops at admission\\): M1 ladder \\[[^\\]]*\\] -> runs (\\d+)x(\\d+), MDD ([\\d.]+), \\$(\\d+)").exec(text);
    return m ? { n: Number(m[1]), k: Number(m[2]), mdd: Number(m[3]), price: Number(m[4]) } : null;
  };
  const cases: Array<[GMetered, string, "plan-eng-review" | "autoplan" | null]> = [
    [{ MULT: 5, M_PER: 2.2, M_AP: 10 }, "both past the bound: autoplan stops, plan-eng-review alone", "plan-eng-review"],
    [{ MULT: 5, M_PER: 2.2, M_AP: 30, AUTH_PAID: 1.39, AUTH_EXTRA: 1.2 }, "no both-alive design: plan-eng-review alone", "plan-eng-review"],
    [{ MULT: 5, M_PER: 30, M_AP: 2.2 }, "plan-eng-review finds no rung: autoplan alone", "autoplan"],
    [{ MULT: 5, M_PER: 30, M_AP: 30 }, "neither finds a rung: both stop", null],
  ];
  for (const [m, name, survivor] of cases) {
    test(name, () => {
      const o = m1Decide(meteredPricer(m), []);
      const text = renderResizeMetered(m);
      for (const s of G_SKILLS) expect(o.runs[s]).toEqual(s === survivor ? runsLine(text, s) : null);
    });
  }
  test("one past the bound with both alive: it stops, the other re-sizes alone", () => {
    const m: GMetered = { MULT: 5, M_PER: 2.2, M_AP: 6.4 };
    const text = renderResizeMetered(m);
    const o = m1Decide(meteredPricer(m), []);
    if (text.includes("past the 20-point bound with both alive: autoplan; autoplan stops")) {
      expect(o.runs.autoplan).toBeNull();
      expect(o.runs["plan-eng-review"]).toEqual(runsLine(text, "plan-eng-review"));
    } else {
      expect(o.both).not.toBeNull();
    }
  });
  test("the ladder climbs back to the planned size and never searches", () => {
    const M = priceModel({ mult: 5, p1ratio: 0.41, authExtra: 1.2 });
    const l = ladder((n, k) => alone(M, "G", "plan-eng-review", n, k), ...PLANNED["plan-eng-review"]);
    expect(l.tried.map((t) => t.n + "x" + t.k)).toEqual(["60x3", "60x4", "54x4", "48x4"]);
    expect(d7(M, "plan-eng-review", 60, 3)).toMatchObject({ n: 60, k: 2, mdd: 21.6, stops: true });
    expect(bestPair(pairPrice(M, "G"))!.n).toEqual([60, 54]);
  });
});
