import { describe, expect, test } from "bun:test";
import { clusteredPairedDelta, nonInferiorityP, seededRandom, type PairedItem } from "../../src/runner/stats/paired.ts";
import { marginShiftedSignFlipP } from "../../src/runner/stats/sign-flip.ts";

const OPTS = { seed: 7, draws: 2000 };
const tasks = (diffs: number[]): PairedItem[] => diffs.map((d, i) => ({ id: `t${i}`, cluster: `t${i}`, a: 0.5, b: 0.5 + d }));

describe("marginShiftedSignFlipP", () => {
  test("flips the signs of each task's difference plus the margin", () => {
    expect(marginShiftedSignFlipP(tasks([0.1, -0.05, 0.2]), 0.1, "higher", OPTS)).toBeCloseTo(1 / 8, 12);
    expect(marginShiftedSignFlipP(tasks([-0.1, 0.05, -0.2]), 0.1, "lower", OPTS)).toBeCloseTo(1 / 8, 12);
    expect(marginShiftedSignFlipP(tasks([-0.3, -0.3, -0.3]), 0.1, "higher", OPTS)).toBe(1);
  });

  test("a cluster's shift counts every item in it", () => {
    const pairs: PairedItem[] = [
      { id: "a1", cluster: "a", a: 1, b: 1 }, { id: "a2", cluster: "a", a: 1, b: 0.9 },
      { id: "b1", cluster: "b", a: 1, b: 0.8 }, { id: "c1", cluster: "c", a: 0, b: 0.2 },
    ];
    expect(marginShiftedSignFlipP(pairs, 0.1, "higher", OPTS)).toBeCloseTo(3 / 8, 12);
  });

  test("identical arms and a single cluster show nothing", () => {
    expect(marginShiftedSignFlipP(tasks(Array(12).fill(0)), 0.1, "higher", OPTS)).toBeNull();
    expect(marginShiftedSignFlipP([{ id: "x", cluster: "c", a: 0, b: 1 }, { id: "y", cluster: "c", a: 1, b: 1 }], 0.1, "higher", OPTS)).toBeNull();
    expect(() => marginShiftedSignFlipP(tasks([0.1, 0.2]), -0.1, "higher", OPTS)).toThrow("margin");
  });

  test("above 20 clusters it draws seeded patterns", () => {
    const p = marginShiftedSignFlipP(tasks(Array.from({ length: 30 }, (_, i) => (i % 3) * 0.1 - 0.1)), 0.1, "higher", OPTS)!;
    expect(p).toBe(marginShiftedSignFlipP(tasks(Array.from({ length: 30 }, (_, i) => (i % 3) * 0.1 - 0.1)), 0.1, "higher", OPTS)!);
    expect(p).toBeLessThan(0.01);
  });
});

// The size table in wiki/board/2026-10-28-gsta-14-noninferiority-bootstrap-few-tasks.md. Each task has a pass rate
// uniform on [0.2, 0.8]; each arm runs 3 trials; B's rate is A's minus the 0.10 margin, so every rejection at
// alpha 0.05 is a false non-inferiority claim.
function falsePasses(n: number, runs: number) {
  const rnd = seededRandom(1000 + n);
  const rate = (p: number) => { let s = 0; for (let i = 0; i < 3; i++) if (rnd() < p) s++; return s / 3; };
  let bootstrap = 0, signFlip = 0;
  for (let run = 0; run < runs; run++) {
    const pairs: PairedItem[] = Array.from({ length: n }, (_, t) => {
      const p = 0.2 + 0.6 * rnd();
      return { id: `t${t}`, cluster: `t${t}`, a: rate(p), b: rate(p - 0.1) };
    });
    const options = { seed: run + 1, draws: 2000 };
    const boot = nonInferiorityP(clusteredPairedDelta(pairs, options), 0.1, "higher");
    const flip = marginShiftedSignFlipP(pairs, 0.1, "higher", options);
    if (boot !== null && boot <= 0.05) bootstrap++;
    if (flip !== null && flip <= 0.05) signFlip++;
  }
  return { bootstrap, signFlip };
}

describe("false non-inferiority passes at the margin", () => {
  test("12, 30 and 200 tasks", () => {
    expect(falsePasses(12, 1500)).toEqual({ bootstrap: 101, signFlip: 73 });
    expect(falsePasses(30, 1000)).toEqual({ bootstrap: 41, signFlip: 41 });
    expect(falsePasses(200, 300)).toEqual({ bootstrap: 16, signFlip: 16 });
  }, 300_000);
});
