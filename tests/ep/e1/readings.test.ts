import { describe, expect, test } from "bun:test";
import { decide, type Readings } from "../../../lanes/eng-planted/e1/decide.ts";
import { RUNS_ON, type E1Arm, type E1Model } from "../../../lanes/eng-planted/e1/frozen.ts";
import { look } from "../../../lanes/eng-planted/e1/look.ts";
import { armState, contrast, holm, infer, isRead, pairsOf, unitScores, weighted, type Cell, type Reading } from "../../../lanes/eng-planted/e1/readings.ts";

const cell = (unit: string, repo: string, arm: E1Arm, model: E1Model, rep: number, composite: number | null, exposed: boolean | null = arm === "N" ? null : true): Cell => ({ unit, repo, arm, model, rep, composite, exposed });

/** Every arm on every model it runs on, two cells a unit, with composite set per arm. */
function grid(units: Array<[string, string]>, comp: (arm: E1Arm, model: E1Model, unit: string) => number, exposed: (arm: E1Arm, model: E1Model) => boolean = () => true): Cell[] {
  const out: Cell[] = [];
  for (const [u, r] of units) for (const a of Object.keys(RUNS_ON) as E1Arm[]) for (const m of RUNS_ON[a]) for (const k of [0, 1]) out.push(cell(u, r, a, m, k, comp(a, m, u), a === "N" ? null : exposed(a, m)));
  return out;
}
const units = (n: number, perRepo = 2) => Array.from({ length: n }, (_, i) => ["u" + i, "r" + Math.floor(i / perRepo)] as [string, string]);

describe("armState and untested", () => {
  const mk = (n: number, exposedN: number, gaps: number) => [
    ...Array.from({ length: n }, (_, i) => cell("u" + i, "r", "C", "opus", 0, 0.5, i < exposedN)),
    ...Array.from({ length: gaps }, (_, i) => cell("g" + i, "r", "C", "opus", 0, null, null)),
  ];
  test("exposure at 0.80 reads, under it is untested", () => {
    expect(isRead(mk(5, 4, 0), "C", "opus")).toBe(true);
    expect(isRead(mk(4, 3, 0), "C", "opus")).toBe(false);
  });
  test("gaps at 10% read, over 10% is untested", () => {
    expect(isRead(mk(9, 9, 1), "C", "opus")).toBe(true);
    expect(isRead(mk(17, 17, 2), "C", "opus")).toBe(false);
  });
  test("N has only the gap rule; an arm with no cells is untested", () => {
    expect(isRead([cell("u", "r", "N", "opus", 0, 0.5)], "N", "opus")).toBe(true);
    expect(isRead([], "C", "opus")).toBe(false);
  });
  test("exposure counts every cell it ran, gaps included; the look's share counts scored cells only", () => {
    const s = armState(mk(8, 8, 2), "C", "opus");
    expect([s.exposure, s.scoredExposure]).toEqual([0.8, 1]);
    const t = armState(mk(18, 15, 2), "C", "opus");
    expect([t.exposure, t.gapShare, t.untested]).toEqual([0.75, 0.1, true]);
    expect(t.scoredExposure!).toBeGreaterThan(0.8);
  });
  test("cells a stop left unrun leave every denominator", () => {
    const cs = [...mk(4, 4, 0), { ...cell("x", "r", "C", "opus", 0, null, null), unrun: true }, { ...cell("y", "r", "C", "opus", 0, 0.5, false), unrun: true }];
    const s = armState(cs, "C", "opus");
    expect([s.cells, s.gaps, s.exposure]).toEqual([4, 0, 1]);
  });
});

describe("scores and the pooled statistic", () => {
  test("a unit's score is its builds' mean, gaps left out or scored 0", () => {
    const cs = [cell("u", "r", "C", "opus", 0, 0.6), cell("u", "r", "C", "opus", 1, null, null)];
    expect(unitScores(cs, "C", "opus").get("u")!.score).toBeCloseTo(0.6);
    expect(unitScores(cs, "C", "opus", true).get("u")!.score).toBeCloseTo(0.3);
  });
  test("models weigh equally, whatever their pair counts", () => {
    expect(weighted([{ unit: "a", repo: "r", model: "opus", d: 10 }, { unit: "b", repo: "r", model: "opus", d: 10 }, { unit: "a", repo: "r", model: "sol", d: 0 }])).toBe(5);
  });
  test("pairs are in points and need both arms on the unit", () => {
    const cs = [cell("a", "r", "C", "opus", 0, 0.7), cell("a", "r", "N", "opus", 0, 0.5), cell("b", "r", "C", "opus", 0, 0.9)];
    const ps = pairsOf(cs, "C", "N", ["opus"]);
    expect(ps.length).toBe(1);
    expect(ps[0]!.d).toBeCloseTo(20);
  });
  test("the exact sign-flip and a constant difference", () => {
    const ps = [0, 1, 2].map((i) => ({ unit: "u" + i, repo: "r" + i, model: "opus" as E1Model, d: 5 }));
    const r = infer(ps, 1, 500)!;
    expect(r.p).toBe(0.25);
    expect([r.estimate, r.lo, r.hi, r.repos, r.worse]).toEqual([5, 5, 5, 3, 0]);
  });
  test("the bootstrap is seeded and reproducible", () => {
    const cs = grid(units(12), (a, _m, u) => (a === "C" ? 0.5 + (Number(u.slice(1)) % 5) / 20 : 0.5));
    const a = contrast(cs, "C", "N", ["opus", "sol", "particle"], 7, { draws: 400 });
    const b = contrast(cs, "C", "N", ["opus", "sol", "particle"], 7, { draws: 400 });
    expect(a).toEqual(b);
    expect(a!.lo).toBeLessThanOrEqual(a!.estimate);
    expect(a!.hi).toBeGreaterThanOrEqual(a!.estimate);
  });
  test("an untested model leaves the pool", () => {
    const cs = grid(units(4), (a, m) => (a === "C" ? (m === "sol" ? 0.1 : 0.7) : 0.5), (a, m) => !(a === "C" && m === "sol"));
    const r = contrast(cs, "C", "N", ["opus", "sol", "particle"], 1, { draws: 200 })!;
    expect(r.models.sort()).toEqual(["opus", "particle"]);
    expect(r.estimate).toBeCloseTo(20);
  });
  test("Holm steps down and stops at the first non-rejection", () => {
    const h = holm([{ key: "D", p: 0.01 }, { key: "C", p: 0.04 }, { key: "P", p: 0.02 }, { key: "G", p: 0.3 }]);
    expect(h.map((x) => [x.key, x.rejects])).toEqual([["D", true], ["P", false], ["C", false], ["G", false]]);
    expect(h.map((x) => x.adjusted)).toEqual([0.04, 0.06, 0.08, 0.3]);
  });
  test("Holm keeps a slot with no reading at p 1, and a held slot never rejects", () => {
    const h = holm([{ key: "D", p: 0.001 }, { key: "C", p: null }, { key: "P", p: 0.002, held: true }, { key: "G", p: 0.012 }]);
    expect(h.map((x) => [x.key, x.rejects, x.missing])).toEqual([["D", true, false], ["P", false, false], ["G", true, false], ["C", false, true]]);
    expect(h.map((x) => x.adjusted)).toEqual([0.004, 0.006, 0.024, 1]);
  });
});

const R = (estimate: number, lo: number, hi: number): Reading => ({ estimate, lo, hi, p: 0.5, pairs: 64, repos: 30, worse: 10, models: ["opus"] });
const none = R(0, -5, 5);
const base = (o: Partial<Readings>): Readings => ({ DN: none, CN: none, GN: none, PN: none, PC: none, CG: none, CNopus: none, CNsol: none, ...o });
const all = grid(units(2), () => 0.5);
const run = (o: Partial<Readings>, x: { cells?: Cell[]; stopped?: E1Arm[]; units?: number } = {}) => decide({ cells: x.cells ?? all, r: base(o), stopped: new Set(x.stopped ?? []), units: x.units ?? 64 });
const has = (d: { rows: string[] }, s: string) => d.rows.some((r) => r.includes(s));

describe("the C rows on both sides of their lines", () => {
  const win = { CG: R(3, 0.1, 6), CNopus: R(0, -5, 5), CNsol: R(0, -5, 5) };
  test("+10.0 with a lower bound of 0.1 drafts the step and sends eval 4 to Garry", () => {
    const d = run({ CN: R(10, 0.1, 20), ...win });
    expect(has(d, "GStack Minder drafts C's step")).toBe(true);
    expect(d.eval4).toBe("to Garry");
  });
  test("+9.9 is a small gain with no step", () => {
    const d = run({ CN: R(9.9, 0.1, 20), ...win });
    expect(has(d, "small gain")).toBe(true);
    expect(d.eval4).toBe("dropped");
  });
  test("a lower bound of 0.0 at +10 is not shown", () => {
    expect(has(run({ CN: R(10, 0, 20), ...win }), "not shown")).toBe(true);
  });
  test("per-model points at -0.1 hold the step, at 0.0 they don't", () => {
    expect(has(run({ CN: R(12, 1, 20), ...win, CNsol: R(-0.1, -9, 9) }), "below 0 on Sol")).toBe(true);
    expect(has(run({ CN: R(12, 1, 20), ...win, CNopus: R(-0.1, -9, 9) }), "below 0 on Opus")).toBe(true);
    expect(has(run({ CN: R(12, 1, 20), ...win, CNsol: R(0, -9, 9) }), "drafts C's step")).toBe(true);
  });
  test("a missing Sol estimate holds the draft", () => {
    expect(has(run({ CN: R(12, 1, 20), ...win, CNsol: null }), "Sol has no C minus N estimate")).toBe(true);
  });
  test("C minus G's lower bound at 0.0 does not beat G", () => {
    expect(has(run({ CN: R(12, 1, 20), ...win, CG: R(3, 0, 6) }), "does not beat G, and G does not gain")).toBe(true);
    expect(has(run({ CN: R(12, 1, 20), ...win, CG: R(3, 0, 6), GN: R(10, 0.1, 20) }), "KEEP lead")).toBe(true);
  });
  test("an interval holding both 0 and +10 is not distinguished; under +10 is no step; under 0 at 64 units is a loss", () => {
    expect(has(run({ CN: R(4, -1, 10) }), "not distinguished")).toBe(true);
    expect(has(run({ CN: R(4, -1, 9.9) }), "upper bound is under +10: no modeling step from C")).toBe(true);
    expect(has(run({ CN: R(-4, -8, -0.1) }), "reported as a loss")).toBe(true);
    expect(has(run({ CN: R(-4, -8, -0.1) }, { units: 48 }), "reported as a loss")).toBe(false);
    expect(has(run({ CN: R(-4, -8, 0) }), "reported as a loss")).toBe(false);
  });
  test("a stopped C takes only the no-action row and never gains", () => {
    const d = run({ CN: R(12, 1, 20), ...win }, { stopped: ["C"] });
    expect(has(d, "C stopped for futility")).toBe(true);
    expect(has(d, "drafts")).toBe(false);
    expect(d.eval4).toBe("dropped");
  });
});

describe("the P, D, G and closing rows", () => {
  test("P gaining over N and C sends the fold-in brief and skips the C rows", () => {
    const d = run({ PN: R(12, 1, 20), PC: R(10, 0.1, 20), CN: R(12, 1, 20) });
    expect(has(d, "port /statechart")).toBe(true);
    expect(has(d, "C gains")).toBe(false);
    expect(d.eval4).toBe("to Garry");
  });
  test("P over N but not over C lets the C rows decide", () => {
    const d = run({ PN: R(12, 1, 20), PC: R(9.9, 0.1, 20) });
    expect(has(d, "P gains over N but not over C")).toBe(true);
    expect(d.eval4).toBe("to Garry");
  });
  test("D's lines", () => {
    expect(run({ DN: R(9.9, 0.1, 20) }).words.D).toBe("KEEP");
    expect(has(run({ DN: R(9.9, 0.1, 20) }), "users are told")).toBe(false);
    expect(has(run({ DN: R(10, 0.1, 20) }), "users are told")).toBe(true);
    expect(run({ DN: R(10, 0, 20) }).words.D).toBe("FIX-METHOD");
    expect(run({ DN: R(4, -1, 10) }).words.D).toBe("FIX-METHOD");
    expect(run({ DN: R(4, -1, 9.9) }).words.D).toBe("CUT-CANDIDATE");
    expect(has(run({ DN: R(-4, -8, -0.1) }), "measurably cost points")).toBe(true);
    expect(run({ DN: null }).words.D).toBeUndefined();
  });
  test("G's rows", () => {
    expect(has(run({ GN: R(10, 0.1, 20) }), "plan-eng-review helps")).toBe(true);
    expect(has(run({ GN: R(9.9, 0.1, 20) }), "plan-eng-review helps")).toBe(false);
    expect(has(run({ GN: R(-4, -8, -0.1) }), "find out why")).toBe(true);
    expect(has(run({ GN: R(-4, -8, 0) }), "find out why")).toBe(false);
  });
  test("untested arms: the cause row, and the closing rows", () => {
    const pOff = grid(units(2), () => 0.5, (a) => a !== "P");
    const cOff = grid(units(2), () => 0.5, (a) => a !== "C");
    const both = grid(units(2), () => 0.5, (a) => a !== "C" && a !== "P");
    const gOff = grid(units(2), () => 0.5, (a, m) => !(a === "G" && m === "sol"));
    expect(run({}, { cells: pOff }).eval4).toBe("dropped");
    expect(has(run({}, { cells: pOff }), "P is reported as untested")).toBe(true);
    expect(run({}, { cells: cOff }).eval4).toBe("waits for a repaired run");
    expect(run({}, { cells: both }).eval4).toBe("neither started nor dropped");
    expect(has(run({}, { cells: gOff }), "untested: G on sol leaves every pooled contrast there; the cause goes to the Captain and GStack Minder")).toBe(true);
  });
  test("a contrast with no reading is unavailable, never no gain, and N untested everywhere goes to the Captain", () => {
    const c = run({ CN: null });
    expect([has(c, "C minus N has no reading"), c.eval4]).toEqual([true, "waits for a repaired run"]);
    const p = run({ PN: null });
    expect([has(p, "P minus N has no reading"), has(p, "P does not gain"), p.eval4]).toEqual([true, false, "dropped"]);
    expect(has(run({ GN: null }), "G minus N has no reading")).toBe(true);
    const nOff = all.map((x) => (x.arm === "N" ? { ...x, composite: null } : x));
    const n = run({ DN: null, CN: null, GN: null, PN: null, PC: null, CG: null, CNopus: null, CNsol: null }, { cells: nOff });
    expect([has(n, "N is untested on every model"), n.eval4]).toEqual([true, "neither started nor dropped"]);
  });
});

describe("the interim look", () => {
  const order = units(8).map(([u]) => u);
  const at = (c: number, p: number) => grid(units(8), (a) => (a === "C" ? c : a === "P" ? p : 0.5));
  test("upper bounds at +4.9 stop C and P; at +5.0 they don't", () => {
    expect(look(order, at(0.549, 0.549), 1, 200).stop).toBe(true);
    expect(look(order, at(0.55, 0.549), 1, 200).stop).toBe(false);
    expect(look(order, at(0.549, 0.55), 1, 200).stop).toBe(false);
  });
  test("it reads half the units, rounded down, and waits for every cell of them", () => {
    const cs = at(0.5, 0.5).filter((c) => !(c.unit === "u3" && c.arm === "G" && c.model === "sol" && c.rep === 1));
    const l = look(order.concat("u8"), cs, 1, 200);
    expect(l.units).toEqual(["u0", "u1", "u2", "u3"]);
    expect([l.ready, l.stop, l.missing]).toEqual([false, false, ["u3/G/sol/1"]]);
  });
  test("one arm untested everywhere: the other's bound decides; both untested: no stop", () => {
    const pOff = grid(units(8), (a) => (a === "C" ? 0.549 : a === "P" ? 0.9 : 0.5), (a) => a !== "P");
    expect(look(order, pOff, 1, 200).stop).toBe(true);
    const both = grid(units(8), () => 0.5, (a) => a !== "C" && a !== "P");
    expect(look(order, both, 1, 200).stop).toBe(false);
  });
});
