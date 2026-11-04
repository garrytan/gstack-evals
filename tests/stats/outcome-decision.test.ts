import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compare, crossing, type AnalysisConfig } from "../../lanes/real-outcome/score/analysis.ts";
import { contrast, decideCells, exactSignFlip, futilityCells, futilityLook, G_DECISION, G_FUTILITY, phi, shareAbove, shareAtLeast, shareAtMost, type OutcomeTrial, type TaskCounts } from "../../src/runner/stats/outcome-decision.ts";
import { clusteredPairedDelta, seededRandom, type PairedItem } from "../../src/runner/stats/paired.ts";

const ARMS = { control: "none", treatment: "told" };
const ZC_PY = 1.959963984540054;
const repo = (i: number) => "r" + String(i).padStart(2, "0");
const trial = (task: string, repoId: string, arm: string, n: number, solved: boolean, o: Partial<OutcomeTrial> = {}): OutcomeTrial => ({ task, repo: repoId, arm, trial: n, status: "scored", solved, truncated: false, cost_usd: 1, exposed: arm === "none" ? null : true, ...o });

/** One task: k trials per arm, the first none and the first told of them solved; truncated lists told trials that were arm stops. */
function cell(task: string, repoId: string, k: number, none: number, told: number, truncated: number[] = []): OutcomeTrial[] {
  const out: OutcomeTrial[] = [];
  for (let i = 1; i <= k; i++) out.push(trial(task, repoId, "none", i, i <= none));
  for (let i = 1; i <= k; i++) out.push(trial(task, repoId, "told", i, !truncated.includes(i) && i <= told, { truncated: truncated.includes(i) }));
  return out;
}
const panel = (repos: number, per: number, k: number, none: number, told: number, truncated: number[] = []) =>
  Array.from({ length: repos }, (_, r) => Array.from({ length: per }, (_, j) => cell(repo(r) + "-t" + j, repo(r), k, none, told, truncated)).flat()).flat();

describe("exact repository sign-flip", () => {
  test("matches brute-force enumeration of every sign pattern, inclusive in both tails", () => {
    const rnd = seededRandom(7);
    for (let c = 0; c < 200; c++) {
      const g = 1 + Math.floor(rnd() * 12);
      const sums = Array.from({ length: g }, () => Math.floor(rnd() * 11) - 5);
      const obs = sums.reduce((a, b) => a + b, 0);
      let ge = 0, le = 0, two = 0;
      for (let m = 0; m < 2 ** g; m++) {
        let s = 0;
        for (let j = 0; j < g; j++) s += (m >> j) & 1 ? -sums[j]! : sums[j]!;
        if (s >= obs) ge++;
        if (s <= obs) le++;
        if (Math.abs(s) >= Math.abs(obs)) two++;
      }
      const f = exactSignFlip(sums);
      expect([f.greater, f.less, f.two_sided, f.patterns]).toEqual([BigInt(ge), BigInt(le), BigInt(two), BigInt(2 ** g)]);
    }
  });

  test("stays exact past 52 clusters, where counts outgrow a double", () => {
    const f = exactSignFlip([...Array(55).fill(1), ...Array(5).fill(0)]);
    expect([f.greater, f.less, f.two_sided, f.patterns]).toEqual([32n, 2n ** 60n, 64n, 2n ** 60n]);
    const rnd = seededRandom(3);
    const sums = Array.from({ length: 52 }, () => Math.floor(rnd() * 7) - 3);
    const a = exactSignFlip(sums), b = exactSignFlip([...sums, 0]);
    expect([b.greater, b.less, b.two_sided, b.patterns]).toEqual([2n * a.greater, 2n * a.less, 2n * a.two_sided, 2n * a.patterns]);
  });

  test("refuses sums that are not integers", () => {
    expect(() => exactSignFlip([1, 0.5])).toThrow();
    expect(() => exactSignFlip([])).toThrow();
  });
});

describe("the decision test, in both directions", () => {
  test("a told arm that solves more on every repository reads helps", () => {
    const same = contrast(panel(20, 3, 3, 1, 3), ARMS);
    expect(same.with_truncated!.z).toBeNull();
    expect(same.verdict).toBe("not_distinguished");
    const varied = [...panel(10, 3, 3, 1, 3), ...panel(10, 3, 3, 1, 2).map((t) => ({ ...t, repo: t.repo.replace("r", "s"), task: t.task.replace("r", "s") }))];
    const v = contrast(varied, ARMS);
    expect(v.verdict).toBe("helps");
    expect(v.with_truncated!.z!).toBeGreaterThan(G_DECISION.boundary);
    expect(v.with_truncated!.p_greater).toBe(1 / 2 ** 20);
    expect(v.with_truncated!.clusters).toBe(20);
  });

  test("a told arm that solves less on every repository reads hurts", () => {
    const varied = [...panel(10, 3, 3, 3, 1), ...panel(10, 3, 3, 2, 1).map((t) => ({ ...t, repo: t.repo.replace("r", "s"), task: t.task.replace("r", "s") }))];
    const c = contrast(varied, ARMS);
    expect(c.verdict).toBe("hurts");
    expect(c.with_truncated!.z!).toBeLessThan(-G_DECISION.boundary);
    expect(c.with_truncated!.p_less).toBe(1 / 2 ** 20);
  });

  test("z past the boundary on 3 repositories is not a claim: the sign-flip p can't reach 0.025", () => {
    const trials = [...panel(1, 10, 3, 0, 3), ...panel(2, 10, 3, 0, 2).map((t) => ({ ...t, repo: t.repo === "r00" ? "r08" : "r09", task: t.task.replace("r0", "q") }))];
    const c = contrast(trials, ARMS);
    expect(c.with_truncated!.clusters).toBe(3);
    expect(Math.abs(c.with_truncated!.z!)).toBeGreaterThan(G_DECISION.boundary);
    expect(c.with_truncated!.p_greater).toBe(1 / 8);
    expect(c.verdict).toBe("not_distinguished");
    expect(c.note).toContain("sign-flip test does not agree");
  });

  test("the ceiling: none above 85% makes no claim, and exactly 85% is not above it", () => {
    const at = (none: number) => contrast(Array.from({ length: 20 }, (_, r) => cell(repo(r) + "-t0", repo(r), 20, none, r % 2 ? 20 : 19)).flat(), ARMS);
    expect(at(17).verdict).not.toBe("ceiling");
    expect(at(17).with_truncated!.control_share).toBe(0.85);
    expect(at(18).verdict).toBe("ceiling");
    expect(at(18).note).toContain("85% ceiling");
  });

  test("the truncation guard: past 5% truncated, readings that disagree make no claim; readings that agree stand", () => {
    const disagree = contrast([...panel(10, 3, 3, 1, 3, [2, 3]), ...panel(10, 3, 3, 2, 3, [2, 3]).map((x) => ({ ...x, repo: x.repo.replace("r", "s"), task: x.task.replace("r", "s") }))], ARMS);
    expect(disagree.with_truncated!.verdict).toBe("hurts");
    expect(disagree.without_truncated!.verdict).toBe("helps");
    expect(disagree.truncation.tripped).toBe(true);
    expect(disagree.with_truncated!.verdict).not.toBe(disagree.without_truncated!.verdict);
    expect(disagree.verdict).toBe("not_distinguished");
    expect(disagree.note).toContain("truncation guard");
    const varied = (t: number[]) => [...panel(10, 3, 3, 1, 3, t), ...panel(10, 3, 3, 0, 3, t).map((x) => ({ ...x, repo: x.repo.replace("r", "s"), task: x.task.replace("r", "s") }))];
    const agree = contrast(varied([3]), ARMS);
    expect(agree.truncation.tripped).toBe(true);
    expect(agree.verdict).toBe("helps");
    const five = contrast([...Array.from({ length: 60 }, (_, i) => cell("t" + i, repo(i % 20), 1, 0, 1, i < 3 ? [1] : [])).flat()], ARMS);
    expect(five.truncation.treatment).toBe(0.05);
    expect(five.truncation.tripped).toBe(false);
    const six = contrast([...Array.from({ length: 60 }, (_, i) => cell("t" + i, repo(i % 20), 1, 0, 1, i < 4 ? [1] : [])).flat()], ARMS);
    expect(six.truncation.tripped).toBe(true);
  });

  test("gaps and contaminated trials leave the reading alone; a task missing an arm is dropped", () => {
    const base = panel(20, 3, 3, 1, 3);
    const noisy = [...base, trial("r00-t0", "r00", "told", 4, false, { status: "gap" }), trial("r01-t0", "r01", "none", 4, true, { status: "contaminated" }), trial("lonely", "r05", "none", 1, true)];
    const a = contrast(base, ARMS), b = contrast(noisy, ARMS);
    expect(b.with_truncated!.delta).toBe(a.with_truncated!.delta);
    expect(b.dropped).toEqual(["lonely"]);
    expect(b.with_truncated!.tasks).toBe(60);
  });

  test("unequal trial counts pair task means, exactly as paired.ts does", () => {
    const trials = [...cell("a", "r00", 3, 1, 3), ...cell("b", "r01", 2, 2, 1), ...cell("c", "r02", 4, 1, 2)].filter((t) => !(t.task === "a" && t.arm === "told" && t.trial === 3));
    const c = contrast(trials, ARMS);
    expect(c.with_truncated!.delta).toBeCloseTo((1 - 1 / 3 + (0.5 - 1) + (0.5 - 0.25)) / 3, 12);
  });

  test("bad input is refused, not read", () => {
    expect(() => contrast([trial("a", "r0", "none", 1, true), trial("a", "r0", "none", 1, false)], ARMS)).toThrow(/twice/);
    expect(() => contrast([trial("a", "r0", "none", 1, true), trial("a", "r1", "told", 1, false)], ARMS)).toThrow(/two repositories/);
    expect(() => contrast([trial("a", "r0", "told", 1, true, { truncated: true })], ARMS)).toThrow(/unsolved/);
  });
});

describe("parity with paired.ts and the lane's compare and crossing", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    test("random panel " + seed, () => {
      const rnd = seededRandom(seed);
      const trials: OutcomeTrial[] = [];
      const repos = 6 + ((seed * 5) % 15);
      const pt = 0.3 + 0.08 * seed;
      for (let r = 0; r < repos; r++) {
        const tasks = 1 + Math.floor(rnd() * 3);
        for (let j = 0; j < tasks; j++) {
          const k = 2 + Math.floor(rnd() * 3);
          for (let i = 1; i <= k; i++) {
            trials.push(trial(repo(r) + "-" + j, repo(r), "none", i, rnd() < 0.3));
            if (!(i === k && rnd() < 0.3)) trials.push(trial(repo(r) + "-" + j, repo(r), "told", i, rnd() < pt));
          }
        }
      }
      const c = contrast(trials, ARMS);
      const r = c.with_truncated!;
      const cells = new Map<string, { repo: string; a: number[]; b: number[] }>();
      for (const t of trials) {
        const e = cells.get(t.task) ?? { repo: t.repo, a: [], b: [] };
        (t.arm === "none" ? e.a : e.b).push(t.solved ? 1 : 0);
        cells.set(t.task, e);
      }
      const mean = (x: number[]) => x.reduce((s, y) => s + y, 0) / x.length;
      const pairs: PairedItem[] = [...cells.entries()].map(([id, e]) => ({ id, cluster: e.repo, a: mean(e.a), b: mean(e.b) }));
      const d = clusteredPairedDelta(pairs, G_DECISION.bootstrap);
      expect(d.p_method).toBe("exact-sign-flip");
      expect([r.p_greater, r.p_less, r.p_two_sided]).toEqual([d.p_greater, d.p_less, d.p_two_sided]);
      expect(r.ci95).toEqual(d.ci95);
      expect(r.delta).toBeCloseTo(d.delta, 12);
      const cfg = { control: "none", treatment: "told", min_trials: 1, bootstrap: G_DECISION.bootstrap } as unknown as AnalysisConfig;
      const lane = compare(trials.map((t) => ({ ...t, model: "m" })) as never, { metric: "solved", value: ((x: OutcomeTrial) => (x.solved ? 1 : 0)) as never, model: "m", tasks: null, cluster: "repo", truncated: true, boundary: G_DECISION.boundary }, cfg)!;
      if (lane.z === null) expect(r.z).toBeNull();
      else expect(r.z!).toBeCloseTo(lane.z, 10);
      const x = crossing(lane);
      const claim = x.crossed && x.agrees ? (x.direction > 0 ? "helps" : "hurts") : "not_distinguished";
      expect(r.verdict === "ceiling" ? "not_distinguished" : r.verdict).toBe(claim);
    });
  }
});

describe("parity with the prereg's power.py on its own simulated panels", () => {
  const fx = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/g-power-parity.json"), "utf8")) as {
    sha256: string;
    cases: Array<{ n: number; k: number; mdd: number; swap: boolean; repo: number[]; A: number[][]; B: number[][]; helps: boolean[]; hurts: boolean[]; ceiling: boolean[]; z: number[]; p_dir: number[]; futility: Array<{ half: number[]; z: number; cp_up: number; cp_dn: number; stop: boolean }> }>;
  };
  test("the fixture comes from the prereg's pinned power.py", () => {
    expect(fx.sha256).toBe("0c9dc8bac4b57fe911317301ca9fee0f3751691416ed653d33c0750cf6002617");
    expect(fx.cases.flatMap((c) => c.helps).filter(Boolean).length).toBeGreaterThan(50);
    expect(fx.cases.flatMap((c) => c.hurts).filter(Boolean).length).toBeGreaterThan(50);
  });
  const clusters = Array.from({ length: 20 }, (_, i) => repo(i));
  for (const c of fx.cases) {
    test(c.n + "x" + c.k + (c.swap ? ", arms swapped" : "") + ": the same helps, hurts, ceiling, z, sign-flip p and futility look", () => {
      const cfg = { ...G_DECISION, boundary: ZC_PY };
      c.A.forEach((A, i) => {
        const B = c.B[i]!;
        const cells: TaskCounts[] = A.map((a, t) => ({ task: "t" + String(t).padStart(3, "0"), cluster: repo(c.repo[t]!), a_solved: a, a_trials: c.k, b_solved: B[t]!, b_trials: c.k }));
        const d = decideCells(cells, { solved: A.reduce((s, x) => s + x, 0), trials: c.n * c.k }, cfg);
        expect([d.verdict === "helps", d.verdict === "hurts", d.verdict === "ceiling"]).toEqual([c.helps[i]!, c.hurts[i]!, c.ceiling[i]!]);
        expect(d.z ?? 0).toBeCloseTo(c.z[i]!, 9);
        if (d.flip) expect(Number(d.direction > 0 ? d.flip.greater : d.flip.less) / Number(d.flip.patterns)).toBe(c.p_dir[i]!);
        const f = c.futility[i]!;
        const half = f.half.map((t) => cells[t]!);
        const look = futilityCells(half, clusters, c.mdd, { ...G_FUTILITY, boundary: ZC_PY });
        expect(look.z ?? 0).toBeCloseTo(f.z, 9);
        expect(look.cp_plus).toBeCloseTo(f.cp_up, 9);
        expect(look.cp_minus).toBeCloseTo(f.cp_dn, 9);
        expect(look.stop).toBe(f.stop);
      });
    });
  }
});

describe("the futility look, in both directions", () => {
  const P = panel(20, 3, 3, 1, 1);
  const panelTasks = [...new Set(P.map((t) => t.task))].sort();
  const half = panelTasks.filter((t) => t.endsWith("-t0") || (t.endsWith("-t1") && Number(t.slice(1, 3)) < 10));
  const withHalf = (fn: (t: OutcomeTrial) => OutcomeTrial) => P.map((t) => (half.includes(t.task) ? fn(t) : t));
  const look = (trials: OutcomeTrial[], mdd: number) => futilityLook(trials, ARMS, { half, panel: panelTasks, mdd });

  test("an interim trending to helps runs on", () => {
    const f = look(withHalf((t) => (t.arm === "told" && t.trial === 2 && Number(t.task.slice(1, 3)) % 3 !== 0 ? { ...t, solved: true } : t)), 0.186);
    expect(f.direction).toBe("helps");
    expect(f.stop).toBe(false);
    expect(f.cp_plus).toBeGreaterThan(0.5);
    expect(f.loss_lead).toBe(false);
  });

  test("an interim trending to hurts runs on too, so the panel can read hurts", () => {
    const f = look(withHalf((t) => (t.arm === "none" && t.trial === 2 && Number(t.task.slice(1, 3)) % 3 !== 0 ? { ...t, solved: true } : t)), 0.186);
    expect(f.direction).toBe("hurts");
    expect(f.stop).toBe(false);
    expect(f.cp_minus).toBeGreaterThan(0.5);
    expect(f.loss_lead).toBe(false);
  });

  test("a look that can't reach either boundary stops, and an estimate in none's favor is a loss lead", () => {
    const down = look(withHalf((t) => (t.task === "r00-t0" && t.arm === "none" && t.trial === 2 ? { ...t, solved: true } : t)), 0.001);
    expect(down.stop).toBe(true);
    expect(down.cp_plus).toBeLessThan(0.1);
    expect(down.cp_minus).toBeLessThan(0.1);
    expect(down.direction).toBe("hurts");
    expect(down.loss_lead).toBe(true);
    expect(down.ci95).not.toBeNull();
    const up = look(withHalf((t) => (t.task === "r00-t0" && t.arm === "told" && t.trial === 2 ? { ...t, solved: true } : t)), 0.001);
    expect(up.stop).toBe(true);
    expect(up.loss_lead).toBe(false);
  });

  test("nothing varies: no stop", () => {
    const f = look(P, 0.001);
    expect(f.se).toBe(0);
    expect(f.stop).toBe(false);
  });

  test("the look reads exactly half of the panel, from inside it", () => {
    expect(() => futilityLook(P, ARMS, { half: half.slice(1), panel: panelTasks, mdd: 0.186 })).toThrow(/half/);
    expect(() => futilityLook(P, ARMS, { half: [...half.slice(1), "elsewhere"], panel: panelTasks, mdd: 0.186 })).toThrow(/panel/);
    expect(G_FUTILITY.threshold).toBe(0.1);
    expect(G_FUTILITY.t).toBe(0.5);
    expect(G_FUTILITY.boundary).toBe(1.959964);
  });
});

describe("frozen constants and exact shares", () => {
  test("G's decision configuration is the prereg's section 8", () => {
    expect(G_DECISION).toEqual({ boundary: 1.959964, agree: 0.025, ceiling: 0.85, truncation_guard: 0.05, bootstrap: { seed: 20261031, draws: 10000 } });
  });
  test("shares compare exactly at their levels", () => {
    expect(shareAtMost(26214, 2 ** 20, 0.025)).toBe(true);
    expect(shareAtMost(26215, 2 ** 20, 0.025)).toBe(false);
    expect(shareAbove(17, 20, 0.85)).toBe(false);
    expect(shareAbove(171, 200, 0.85)).toBe(true);
    expect(shareAtLeast(5, 24, 0.2)).toBe(true);
    expect(shareAtLeast(4, 24, 0.2)).toBe(false);
    expect(() => shareAbove(1, 2, 1e-7)).toThrow();
  });
  test("phi is the standard normal CDF to double precision", () => {
    expect(phi(0)).toBe(0.5);
    expect(phi(ZC_PY)).toBeCloseTo(0.975, 13);
    expect(phi(-3)).toBeCloseTo(0.0013498980316300946, 15);
    expect(phi(5)).toBeCloseTo(0.9999997133484281, 15);
    expect(phi(-8) / 6.22096057427178e-16).toBeCloseTo(1, 9);
    expect(phi(-Infinity)).toBe(0);
    expect(phi(Infinity)).toBe(1);
  });
});
